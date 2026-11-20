"""Checks called inside test_phase4's rollback-only connection, never migrate helpdesk.

The new relation lives in pg_temp; all existing fixture rows roll back with the caller.
"""
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import threading
from psycopg import sql
from core.database import database_schema
from services import manager_service as manager, support_type_service as service, staff_service
from fastapi import HTTPException


def run(admin, employee_client, customer, post, cur, prefix, existing_ticket, get_connection):
    cur.execute('CREATE TEMP TABLE nhom_loai_ho_tro (nhom_ma bigint NOT NULL, ht_ma bigint NOT NULL, PRIMARY KEY(nhom_ma,ht_ma)) ON COMMIT DROP')

    def execute(cursor, statement, params=()):
        identifiers = {t: sql.Identifier(database_schema(), t) for t in (*manager.TABLES, 'account_lock_event')}
        identifiers['nhom_loai_ho_tro'] = sql.Identifier('pg_temp', 'nhom_loai_ho_tro')
        cursor.execute(sql.SQL(statement).format(**identifiers), params)

    # Missing migration is explicit; the real schema is untouched.
    with patch.object(service, 'available', return_value=False):
        group = admin.get('/api/v1/manager/groups').json()['items'][0]
        assert admin.get(f"/api/v1/manager/groups/{group['id']}/support-types").json()['available'] is False
        assert post(admin, f"manager/groups/{group['id']}/support-types/1").status_code == 503

    with patch.object(manager, 'execute', execute), patch.object(service, 'available', return_value=True):
        def q(statement, params=()):
            execute(cur, statement, params)
            return cur

        # Mirror the migration's non-destructive backfill, twice (idempotence).
        for _ in range(2):
            q('INSERT INTO {nhom_loai_ho_tro} SELECT nhom_ma,ht_ma FROM {xu_ly_mac_dinh} ON CONFLICT DO NOTHING')
        types = []
        for i in range(7):
            response = post(admin, 'manager/support-types', dict(name=f'Catalog {prefix} {i}', description=None, active=True))
            assert response.status_code == 201, response.text
            types.append(response.json())
        page = admin.get('/api/v1/manager/support-types', params={'search': prefix, 'page_size': 5}).json()
        assert len(page['items']) == 5 and page['total'] >= 7
        assert employee_client.get('/api/v1/manager/support-types').status_code == 403
        assert admin.post('/api/v1/manager/support-types', json=dict(name='Forbidden')).status_code == 403
        assert post(admin, 'manager/support-types', dict(name=f'  CATALOG   {prefix}  0 ', active=True)).status_code == 409
        assert post(admin, 'manager/support-types', dict(name='   ', active=True)).status_code == 422

        def snapshot(row):
            return {key: row[key] for key in ('name', 'description', 'active')}

        first = types[0]
        updated = post(admin, f"manager/support-types/{first['id']}",
                       dict(name=f'Renamed {prefix}', description='Description', active=False, expected=snapshot(first)), 'PATCH')
        assert updated.status_code == 200, updated.text
        assert updated.json()['id'] == first['id']
        assert post(admin, f"manager/support-types/{first['id']}",
                    dict(**snapshot(first), expected=snapshot(first)), 'PATCH').status_code == 409
        updated = post(admin, f"manager/support-types/{first['id']}",
                       dict(name=updated.json()['name'], description='Description', active=True, expected=snapshot(updated.json())), 'PATCH')
        assert updated.status_code == 200
        groups = [post(admin, 'manager/groups', dict(name=f'Expertise {prefix} {i}', active=True)).json()['id'] for i in range(3)]
        base = lambda gid, tid: f'manager/groups/{gid}/support-types/{tid}'
        assert post(admin, base(groups[0], first['id'])).status_code == 200
        assert post(admin, base(groups[1], first['id'])).status_code == 200
        assert post(admin, base(groups[0], types[1]['id'])).status_code == 200
        assert post(admin, base(groups[0], types[2]['id'])).status_code == 409
        assert post(admin, base(groups[0], first['id'])).status_code == 200  # idempotent, no double counting
        assert post(admin, f"manager/routing/{first['id']}", dict(group_id=groups[0], expected_group_id=None), 'PATCH').status_code == 200
        assert post(admin, base(groups[0], first['id']), method='DELETE').status_code == 409  # default invariant
        assert post(admin, f"manager/routing/{first['id']}", dict(group_id=groups[1], expected_group_id=groups[0]), 'PATCH').status_code == 200
        assert post(admin, base(groups[0], first['id']), method='DELETE').status_code == 200
        row = admin.get(f"/api/v1/manager/groups/{groups[1]}/support-types").json()
        assert row['available'] and next(t for t in row['items'] if t['id'] == first['id'])['groups'][0]['is_default']
        assert post(admin, f"manager/support-types/{first['id']}", dict(expected=snapshot(updated.json())), 'DELETE').status_code == 409
        # Legacy 3/2 expertise can be reduced without changing defaults or tickets.
        for t in types[2:5]:
            q('INSERT INTO {nhom_loai_ho_tro} VALUES(%s,%s)', (groups[2], t['id']))
        assert post(admin, base(groups[2], types[2]['id']), method='DELETE').status_code == 200
        assert admin.get(f'/api/v1/manager/groups/{groups[2]}').json()['type_count'] == 2

        # Two simultaneous HTTP requests compete for one free place. The fixture
        # connection is serialized by the harness; a second PG connection also
        # verifies that the actual coordination lock excludes other transactions.
        start = threading.Barrier(2)
        def add(t):
            start.wait(timeout=5)
            return post(admin, base(groups[0], t['id'])).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(add, [types[5], types[6]]))
        assert sorted(results) == [200, 409], results
        with get_connection() as other, other.cursor() as cursor:
            cursor.execute('SELECT pg_try_advisory_xact_lock(741032026)')
            assert cursor.fetchone()[0] is False

        ticket = q('SELECT ht_ma,nhom_ma,nhan_vien_phu_trach_ma FROM {phieu_ho_tro} WHERE phieu_ma=%s', (existing_ticket,)).fetchone()
        referenced = service.type_row(cur, ticket['ht_ma'])
        assert post(admin, f"manager/support-types/{ticket['ht_ma']}", dict(expected=referenced), 'DELETE').status_code == 422  # strict snapshot rejects id
        assert post(admin, f"manager/support-types/{ticket['ht_ma']}", dict(expected=snapshot(referenced)), 'DELETE').status_code == 409
        assert q('SELECT ht_ma,nhom_ma,nhan_vien_phu_trach_ma FROM {phieu_ho_tro} WHERE phieu_ma=%s', (existing_ticket,)).fetchone() == ticket
        # Existing MOI stays editable/reviewable after catalog deactivation;
        # inactive types disappear from the new-request catalog and are rejected for new intake.
        body = dict(title='Existing pending fixture', description='Furniture support', type_id=ticket['ht_ma'])
        pending = post(customer, 'customer/tickets', body)
        assert pending.status_code == 201, pending.text
        pending_id = pending.json()['id']
        inactive = post(admin, f"manager/support-types/{ticket['ht_ma']}",
                        dict(**{**snapshot(referenced), 'active':False}, expected=snapshot(referenced)), 'PATCH')
        assert inactive.status_code == 200, inactive.text
        assert str(ticket['ht_ma']) not in [t['id'] for t in customer.get('/api/v1/customer/ticket-types').json()]
        assert post(customer, 'customer/tickets', body).status_code == 422
        edited = post(customer, f'customer/tickets/{pending_id}', body, 'PATCH')
        assert edited.status_code == 200, edited.text
        review = q('SELECT ngay_cap_nhat FROM {phieu_ho_tro} WHERE phieu_ma=%s', (pending_id,)).fetchone()
        approved = post(employee_client, f'staff/tickets/{pending_id}/approve',
                        dict(**body, priority_id=priority_id(cur, execute), expected_updated_at=review['ngay_cap_nhat'].isoformat()))
        assert approved.status_code == 200, approved.text
        assert post(admin, f"manager/support-types/{ticket['ht_ma']}",
                    dict(**snapshot(referenced), expected=snapshot(inactive.json())), 'PATCH').status_code == 200
        print('PASS inactive category: excluded/rejected for new customer intake; existing MOI edit and staff approval still succeed.')
        unused = types[4]
        # Remove the fixture-only expertise before deleting a genuinely unused type.
        assert post(admin, base(groups[2], unused['id']), method='DELETE').status_code == 200
        assert post(admin, f"manager/support-types/{unused['id']}", dict(expected=snapshot(unused)), 'DELETE').status_code == 200
        q('UPDATE {loai_ho_tro} SET dang_hoat_dong=false WHERE ht_ma=%s', (first['id'],))
        priority = q('SELECT mdut_ma FROM {muc_do_uu_tien} LIMIT 1').fetchone()['mdut_ma']
        staff_service.valid_classification(cur, first['id'], priority, first['id'])
        try:
            staff_service.valid_classification(cur, first['id'], priority)
            raise AssertionError('Inactive type accepted for new classification')
        except HTTPException as exc:
            assert exc.status_code == 422
        print('PASS support catalog: CRUD, normalized duplicates, pagination, role/CSRF, stale snapshot, referenced deletion blocked, no historical ticket changes.')
        print('PASS expertise: shared types, default routing independent, 2-type cap, 3→2 cleanup, concurrent HTTP contention and cross-transaction PG coordination lock; pg_temp only.')


def priority_id(cur, execute):
    execute(cur, 'SELECT mdut_ma FROM {muc_do_uu_tien} ORDER BY thu_tu LIMIT 1')
    return cur.fetchone()['mdut_ma']
