"""Opt-in Phase4 integration smoke; isolated fixtures and real SQL, always rollback."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
import os
import secrets
import sys
import threading
import json
import subprocess
import time
from tempfile import TemporaryDirectory
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from psycopg.rows import dict_row
from core.database import get_connection,BASE_DIR
from core.security import PASSWORD_HASHER
from services import auth_service,customer_service,staff_service,manager_service as service
from api.routes.auth import _attempts,_registrations
from main import app


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--stage',choices=list('ABCDE'),default='A');parser.add_argument('--browser',action='store_true');args=parser.parse_args()
    if not args.execute:parser.error('Cần --execute; fixture thật được rollback, không seed tài khoản sử dụng.')
    prefix=secrets.token_hex(12);password=secrets.token_urlsafe(24)+'!9';origin={'Origin':'http://localhost:5173'}
    _attempts.clear();_registrations.clear()
    with TemporaryDirectory(prefix='helpdesk-phase4-') as tmp,patch.dict(os.environ,{'MANAGER_AUDIT_DIR':tmp,'UPLOAD_DIR':str(Path(tmp)/'uploads'),'SMTP_HOST':'','SMTP_FROM':'','MAIL_SERVER':'','MAIL_FROM':''}),get_connection() as conn,conn.transaction(force_rollback=True),conn.cursor(row_factory=dict_row) as cur:
        gate=threading.RLock()
        @contextmanager
        def connection():
            with gate,conn.transaction():yield conn
        def q(statement,params=()):service.execute(cur,statement,params);return cur
        q("SET LOCAL lock_timeout = '5s'")
        q('ALTER TABLE {phieu_ho_tro} ADD COLUMN IF NOT EXISTS yeu_cau_goc JSONB')
        migration = (BASE_DIR/'docs/migrations/004_account_lock_event.sql').read_text(encoding='ascii')
        cur.execute(migration.split('BEGIN;', 1)[1].rsplit('COMMIT;', 1)[0])
        q("INSERT INTO {nguoi_dung}(ho_ten,email,mat_khau_hash,vai_tro) VALUES(%s,%s,%s,'QUAN_TRI_VIEN') RETURNING nd_ma",('Quản lý fixture '+prefix,f'manager-{prefix}@example.com',PASSWORD_HASHER.hash(password)))
        manager_id=cur.fetchone()['nd_ma'];q('INSERT INTO {quan_tri_vien}(nd_ma) VALUES(%s)',(manager_id,))
        with patch.object(service,'get_connection',connection),patch.object(auth_service,'get_connection',connection),patch.object(customer_service,'get_connection',connection),patch.object(staff_service,'get_connection',connection):
            admin=TestClient(app,raise_server_exceptions=False)
            def login(client,email):
                r=client.post('/api/v1/auth/login',json={'email':email,'password':password},headers=origin);assert r.status_code==200,r.text;return r.json()['user']
            assert login(admin,f'manager-{prefix}@example.com')['role']=='manager'
            def post(client,path,body=None,method='POST'):
                token=client.get('/api/v1/auth/csrf').json()['csrf_token'];return client.request(method,'/api/v1/'+path,json=body,headers={**origin,'X-CSRF-Token':token})
            def approve(client,ticket_id):
                ticket=q('''SELECT tieu_de AS title,mo_ta AS description,ht_ma AS type_id,mdut_ma AS priority_id,
                    ngay_cap_nhat AS expected_updated_at FROM {phieu_ho_tro} WHERE phieu_ma=%s''',(ticket_id,)).fetchone()
                ticket['expected_updated_at']=ticket['expected_updated_at'].isoformat()
                return post(client,f'staff/tickets/{ticket_id}/approve',ticket)
            employee_body=dict(name='Nhân viên fixture '+prefix,email=f'employee-{prefix}@example.com',phone=None,password=password,password_confirmation=password)
            r=post(admin,'manager/users',employee_body);assert r.status_code==201,r.text;employee=r.json();employee_id=employee['id']
            assert password not in r.text and 'mat_khau' not in r.text and 'hash' not in r.text
            assert q('SELECT mat_khau_hash FROM {nguoi_dung} WHERE nd_ma=%s',(employee_id,)).fetchone()['mat_khau_hash'].startswith('$argon2id$')
            assert post(admin,'manager/users',{**employee_body,'email':employee_body['email'].upper()}).status_code==409
            assert post(admin,'manager/users',{**employee_body,'role':'QUAN_TRI_VIEN'}).status_code==422
            with patch.object(service,'create_employee_profile',side_effect=RuntimeError('fixture profile failure')):
                failed=f'failed-{prefix}@example.com';assert post(admin,'manager/users',{**employee_body,'email':failed}).status_code==500
            assert q('SELECT count(*) n FROM {nguoi_dung} WHERE email=%s',(failed,)).fetchone()['n']==0
            employee_client=TestClient(app,raise_server_exceptions=False);assert login(employee_client,employee_body['email'])['role']=='staff'
            assert employee_client.get('/api/v1/manager/users').status_code==403
            assert admin.post('/api/v1/manager/users',json=employee_body,headers=origin).status_code==403
            lock=dict(name=employee['name'],phone=None,status='KHOA',expected_updated_at=employee['updated_at'])
            assert post(admin,'manager/users/'+employee_id,{**lock,'lock_reason':'   '},'PATCH').status_code==422
            assert post(admin,'manager/users/'+employee_id,{**lock,'lock_reason':'Đối chiếu thông tin tài khoản'},'PATCH').status_code==200
            assert employee_client.get('/api/v1/auth/me').status_code==401
            rejected=employee_client.post('/api/v1/auth/login',json={'email':employee_body['email'],'password':password},headers=origin)
            assert rejected.status_code==403 and 'Đối chiếu thông tin tài khoản' in rejected.json()['detail']
            wrong=employee_client.post('/api/v1/auth/login',json={'email':employee_body['email'],'password':'wrong'},headers=origin)
            assert wrong.status_code==401 and 'Đối chiếu thông tin tài khoản' not in wrong.text
            locked=admin.get('/api/v1/manager/users/'+employee_id).json()
            assert post(admin,'manager/users/'+employee_id,dict(name=employee['name'],phone=None,status='HOAT_DONG',expected_updated_at=locked['updated_at']),'PATCH').status_code==200
            assert post(admin,'manager/users/'+employee_id,dict(name=employee['name'],phone=None,status='KHOA',expected_updated_at=employee['updated_at']),'PATCH').status_code==409
            assert employee_client.get('/api/v1/auth/me').status_code==401
            assert employee_client.get('/api/v1/auth/csrf').status_code==401
            assert login(employee_client,employee_body['email'])['role']=='staff'
            changes=q('SELECT actor_id,locked,reason FROM {account_lock_event} WHERE account_id=%s ORDER BY id',(employee_id,)).fetchall()
            assert [(row['actor_id'],row['locked'],row['reason']) for row in changes]==[
                (manager_id,True,'Đối chiếu thông tin tài khoản'),(manager_id,False,None)]
            audit=(Path(tmp)/'manager.jsonl').read_text(encoding='utf8').splitlines()
            actions=[entry['action'] for line in audit if (entry:=json.loads(line))['target']==employee_id]
            assert 'account.lock' in actions and 'account.unlock' in actions
            print('PASS lock/unlock: locked credentials and old cookies rejected, fresh login works, explicit audit events.')
            own=admin.get('/api/v1/manager/users/'+str(manager_id)).json()
            assert post(admin,'manager/users/'+str(manager_id),dict(name=own['name'],phone=None,status='KHOA',expected_updated_at=own['updated_at']),'PATCH').status_code==409
            fresh=admin.get('/api/v1/manager/users/'+employee_id).json()
            assert post(admin,'manager/users/'+employee_id+'/role',dict(role='QUAN_TRI_VIEN',current_password='wrong',confirmed=True,expected_updated_at=fresh['updated_at'])).status_code==403
            r=post(admin,'manager/users',{**employee_body,'email':f'role-{prefix}@example.com'});assert r.status_code==201;unused=r.json()
            promoted=post(admin,'manager/users/'+unused['id']+'/role',dict(role='QUAN_TRI_VIEN',current_password=password,confirmed=True,expected_updated_at=unused['updated_at']));assert promoted.status_code==200,promoted.text
            privileged=TestClient(app,raise_server_exceptions=False);assert login(privileged,f'role-{prefix}@example.com')['role']=='manager'
            assert privileged.get('/api/v1/manager/users').status_code==200
            assert post(admin,'manager/users/'+unused['id']+'/role',dict(role='NHAN_VIEN',current_password=password,confirmed=True,expected_updated_at=promoted.json()['updated_at'])).status_code==200
            assert privileged.get('/api/v1/manager/users').status_code==401
            assert login(privileged,f'role-{prefix}@example.com')['role']=='staff'
            assert privileged.get('/api/v1/manager/users').status_code==403
            assert post(admin,'manager/users/'+str(manager_id)+'/role',dict(role='NHAN_VIEN',current_password=password,confirmed=True,expected_updated_at=own['updated_at'])).status_code==409
            assert admin.get('/api/v1/manager/overview').status_code==200
            assert admin.get('/api/v1/manager/users',params={'search':"' OR 1=1 --"}).json()['total']==0
            assert list(Path(tmp).glob('manager.jsonl'));assert password not in (Path(tmp)/'manager.jsonl').read_text(encoding='utf-8') and 'mat_khau' not in (Path(tmp)/'manager.jsonl').read_text(encoding='utf-8')
            print('PASS A: create staff+profile atomically; real Argon2/login/role; duplicate/injection; lock invalidates session; CSRF; stale update409; self-lock blocked; role confirmation; audit no secrets.')
            if args.stage=='A':return
            groups=admin.get('/api/v1/manager/groups').json()['items'];warranty=next(g for g in groups if g['name']=='Bảo hành và bảo trì');group_id=warranty['id']
            r=post(admin,f'manager/groups/{group_id}/members',dict(employee_id=employee_id));assert r.status_code==200,(r.status_code,r.text)
            r=post(admin,f'manager/groups/{group_id}/members',dict(employee_id=employee_id));assert r.status_code==200,(r.status_code,r.text)
            r=post(admin,'manager/groups',dict(name='Nhóm fixture '+prefix,description=None,active=True));assert r.status_code==201,r.text;extra_group=r.json()
            assert post(admin,f"manager/groups/{extra_group['id']}/members",dict(employee_id=employee_id)).status_code==409
            with conn.transaction(force_rollback=True):
                index_script = (BASE_DIR/'docs/migrations/005_one_group_per_employee.sql').read_text(encoding='ascii')
                index_sql = index_script.split('BEGIN;', 1)[1].rsplit('COMMIT;', 1)[0]
                if q("SELECT to_regclass('helpdesk.uq_thanh_vien_nhom_nhan_vien') AS idx").fetchone()['idx'] is None:
                    q('INSERT INTO {thanh_vien_nhom}(nhom_ma,nhan_vien_ma) VALUES (%s,%s)',(extra_group['id'],employee_id))
                    detail=admin.get(f'/api/v1/manager/groups/{group_id}').json()
                    assert len(next(p for p in detail['people'] if p['id']==employee_id)['memberships'])==2
                    from psycopg.errors import RaiseException
                    try:
                        with conn.transaction():
                            cur.execute(index_sql)
                    except RaiseException as exc:
                        assert 'Resolve duplicate memberships' in str(exc)
                    else:
                        raise AssertionError('Migration 005 accepted duplicate membership')
                    move=post(admin,f'manager/groups/{group_id}/members/move',
                              dict(employee_id=employee_id,expected_groups=[group_id,extra_group['id']]))
                    assert move.status_code==200,move.text
                move=post(admin,f"manager/groups/{extra_group['id']}/members/move",
                          dict(employee_id=employee_id,expected_groups=[group_id]))
                assert move.status_code==200,move.text
                assert q('SELECT nhom_ma::text id FROM {thanh_vien_nhom} WHERE nhan_vien_ma=%s',(employee_id,)).fetchall()==[{'id':extra_group['id']}]
                assert post(admin,f'manager/groups/{group_id}/members/move',
                            dict(employee_id=employee_id,expected_groups=[group_id])).status_code==409
                cur.execute(index_sql)
                assert q("""SELECT indisunique AND indisvalid ok FROM pg_index
                    WHERE indexrelid=to_regclass('helpdesk.uq_thanh_vien_nhom_nhan_vien')""").fetchone()['ok']
            assert post(admin,f'manager/groups/{group_id}/members',dict(employee_id=manager_id)).status_code==422
            type_id=next(r['type_id'] for r in admin.get('/api/v1/manager/routing').json() if r['type_name']=='Bảo hành sản phẩm')
            customer=TestClient(app,raise_server_exceptions=False);customer_body={**employee_body,'name':'Khách hàng fixture '+prefix,'email':f'customer-{prefix}@example.com'}
            assert customer.post('/api/v1/auth/register',json=customer_body,headers=origin).status_code==201
            customer_id=login(customer,customer_body['email'])['id']
            priority=q('SELECT i FROM generate_series(30000,32767) i WHERE NOT EXISTS(SELECT 1 FROM {muc_do_uu_tien} WHERE mdut_ma=i OR thu_tu=i) LIMIT 1').fetchone()['i']
            q('INSERT INTO {muc_do_uu_tien}(mdut_ma,ten,thu_tu) VALUES(%s,%s,%s)',(priority,'Fixture SLA '+prefix,priority))
            os.environ['DEFAULT_PRIORITY_ORDER']=str(priority)
            r=post(customer,'customer/tickets',dict(title='Bảo hành sofa phase4',description='Chân sofa cần kiểm tra',type_id=type_id));assert r.status_code==201,r.text;ticket_id=r.json()['id']
            recommended=employee_client.get('/api/v1/staff/tickets?scope=recommended').json()
            item=next(t for t in recommended['items'] if t['id']==ticket_id);assert item['recommended'] and item['assigned_id'] is None
            assert q('SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s',(ticket_id,)).fetchone()['n']==0
            r=approve(employee_client,ticket_id);assert r.status_code==200,r.text;assert r.json()['id']==ticket_id
            pending_payload=dict(title='Phiếu thử hủy',description='Dữ liệu rollback',type_id=type_id)
            assert post(customer,f'customer/tickets/{ticket_id}',pending_payload,'PATCH').status_code==409
            assert post(customer,f'customer/tickets/{ticket_id}/cancel',dict(reason='Đã nhận')).status_code==409
            pending=post(customer,'customer/tickets',pending_payload)
            assert pending.status_code==201,pending.text
            cancelled_id=pending.json()['id']
            assert post(customer,f'customer/tickets/{cancelled_id}/cancel',dict(reason='Không cần nữa')).status_code==200
            assert approve(employee_client,cancelled_id).status_code in (404,409)
            assert all(item['id']!=cancelled_id for item in employee_client.get('/api/v1/staff/tickets?scope=queue').json()['items'])
            print('PASS accept/cancel precedence: accepted requests reject customer mutations and cancelled requests stay out of the queue')
            assert post(admin,f'manager/groups/{group_id}/members/remove',dict(employee_id=employee_id)).status_code==409
            assert post(admin,f"manager/groups/{extra_group['id']}/members/move",
                        dict(employee_id=employee_id,expected_groups=[group_id])).status_code==409
            current_group=admin.get('/api/v1/manager/groups/'+group_id).json();expected={k:current_group[k] for k in ['name','description','active']}
            assert post(admin,'manager/groups/'+group_id,{**expected,'active':False,'expected':expected},'PATCH').status_code==409
            current=admin.get('/api/v1/manager/users/'+employee_id).json()
            assert post(admin,'manager/users/'+employee_id,dict(name=current['name'],phone=None,status='KHOA',expected_updated_at=current['updated_at']),'PATCH').status_code==409
            assert employee_client.get('/api/v1/manager/groups').status_code==403
            temp_type=q('INSERT INTO {loai_ho_tro}(ten) VALUES(%s) RETURNING ht_ma',('Routing fixture '+prefix,)).fetchone()['ht_ma']
            assert post(admin,f'manager/routing/{temp_type}',dict(group_id=extra_group['id'],expected_group_id=None),'PATCH').status_code==200
            assert post(admin,f'manager/routing/{temp_type}',dict(group_id=group_id,expected_group_id=None),'PATCH').status_code==409
            # Reproduce a legacy 3/2 group entirely with fixture records.
            source_id=extra_group['id']
            assert post(admin,f'manager/groups/{source_id}/members',dict(employee_id=unused['id'])).status_code==200
            legacy_types=[]
            for label in ('Legacy B','Legacy C','Pending'):
                legacy_types.append(q('INSERT INTO {loai_ho_tro}(ten) VALUES(%s) RETURNING ht_ma',
                                      (label+' '+prefix,)).fetchone()['ht_ma'])
            for legacy in legacy_types[:2]:
                q('INSERT INTO {xu_ly_mac_dinh}(ht_ma,nhom_ma) VALUES(%s,%s)',(legacy,source_id))
            r=post(customer,'customer/tickets',dict(title='Phiếu fixture trước khi bỏ ánh xạ',description='Kiểm tra lịch sử phiếu cũ',type_id=temp_type))
            assert r.status_code==201,r.text
            old_id=r.json()['id']
            assert approve(privileged,old_id).status_code==200
            def old_ticket_snapshot():
                ticket=q('SELECT * FROM {phieu_ho_tro} WHERE phieu_ma=%s',(old_id,)).fetchone()
                assignment=q('SELECT * FROM {lich_su_phan_cong} WHERE phieu_ma=%s ORDER BY pc_ma',(old_id,)).fetchall()
                history=q('SELECT * FROM {lich_su_trang_thai} WHERE phieu_ma=%s ORDER BY ls_ma',(old_id,)).fetchall()
                return ticket,assignment,history
            before=old_ticket_snapshot()
            endpoint=f'manager/routing/{temp_type}?expected_group_id={source_id}'
            assert len(admin.get(f'/api/v1/manager/groups/{source_id}').json()['types'])==3
            preflight=admin.options('/api/v1/'+endpoint,headers={
                **origin,'Access-Control-Request-Method':'DELETE','Access-Control-Request-Headers':'X-CSRF-Token',
            })
            assert preflight.status_code==200
            assert admin.delete('/api/v1/'+endpoint,headers=origin).status_code==403
            assert post(employee_client,endpoint,method='DELETE').status_code==403
            assert post(admin,f'manager/routing/{temp_type}?expected_group_id={group_id}',method='DELETE').status_code==409
            r=post(admin,endpoint,method='DELETE')
            assert r.status_code==200,r.text
            assert post(admin,endpoint,method='DELETE').status_code==409
            assert len(admin.get(f'/api/v1/manager/groups/{source_id}').json()['types'])==2
            assert old_ticket_snapshot()==before
            assert q('SELECT count(*) n FROM {loai_ho_tro} WHERE ht_ma=%s',(temp_type,)).fetchone()['n']==1
            assert post(admin,f'manager/routing/{legacy_types[2]}',dict(group_id=source_id,expected_group_id=None),'PATCH').status_code==409
            assert post(admin,f'manager/routing/{legacy_types[0]}',dict(group_id=source_id,expected_group_id=source_id),'PATCH').status_code==200
            r=post(customer,'customer/tickets',dict(title='Phiếu fixture chưa có ánh xạ',description='Kiểm tra lưu phiếu khi không có nhóm',type_id=temp_type))
            assert r.status_code==201,r.text
            pending_id=r.json()['id']
            unassigned=admin.get('/api/v1/manager/tickets',params={'scope':'unrouted','search':pending_id}).json()['items']
            assert len(unassigned)==1 and unassigned[0]['group_id'] is None and unassigned[0]['assigned_id'] is None
            mapping=next(row for row in admin.get('/api/v1/manager/routing').json() if row['type_id']==str(temp_type))
            assert mapping['group_id'] is None and mapping['waiting']>=1
            params={'scope':'recommended','search':pending_id}
            assert privileged.get('/api/v1/staff/tickets',params=params).json()['items']==[]
            r=post(admin,'manager/groups',dict(name='Đích fixture '+prefix,description=None,active=True))
            assert r.status_code==201,r.text
            target_id=r.json()['id']
            assert post(admin,f'manager/routing/{legacy_types[0]}',dict(group_id=target_id,expected_group_id=source_id),'PATCH').status_code==200
            assert post(admin,f'manager/routing/{temp_type}',dict(group_id=source_id,expected_group_id=None),'PATCH').status_code==200
            suggested=privileged.get('/api/v1/staff/tickets',params=params).json()['items']
            assert len(suggested)==1 and suggested[0]['group_id']==source_id and suggested[0]['assigned_id'] is None
            assert old_ticket_snapshot()==before
            assert any(json.loads(line)['action']=='routing.remove' and json.loads(line)['target']==f'{temp_type}:{source_id}'
                       for line in (Path(tmp)/'manager.jsonl').read_text(encoding='utf8').splitlines())
            contender=q('INSERT INTO {loai_ho_tro}(ten) VALUES(%s) RETURNING ht_ma',
                        ('Contender '+prefix,)).fetchone()['ht_ma']
            with TestClient(app,raise_server_exceptions=False) as second_admin:
                login(second_admin,f'manager-{prefix}@example.com')
                start=threading.Barrier(2)
                def compete(client, category):
                    start.wait(timeout=5)
                    return post(client,f'manager/routing/{category}',
                                dict(group_id=target_id,expected_group_id=None),'PATCH').status_code
                with ThreadPoolExecutor(max_workers=2) as workers:
                    first=workers.submit(compete,admin,legacy_types[2])
                    second_result=workers.submit(compete,second_admin,contender)
                    assert sorted([first.result(),second_result.result()])==[200,409]
            assert len(admin.get(f'/api/v1/manager/groups/{target_id}').json()['types'])==2
            # A separate PostgreSQL transaction cannot take the coordination lock held by the mutation.
            with get_connection() as competing, competing.cursor() as other:
                other.execute('SELECT pg_try_advisory_xact_lock(%s)',(741032026,))
                assert not other.fetchone()[0]
            print('PASS routing: 3→2, rejects third, same-group no-op, move and reassign, stale/CSRF/role/audit, category and ticket history preserved, unassigned intake then suggestion, coordination lock across connections.')
            print('PASS B: exclusive membership; explicit legacy duplicate resolution and atomic group move; active assignments block move/removal; routing and approval.')
            if args.stage=='B':return
            r=post(admin,'manager/users',{**employee_body,'name':'Nhân viên thứ hai '+prefix,'email':f'employee2-{prefix}@example.com'});assert r.status_code==201,r.text;employee2=r.json()['id']
            assert post(admin,f'manager/groups/{group_id}/members',dict(employee_id=employee2)).status_code==200
            second=TestClient(app,raise_server_exceptions=False);login(second,f'employee2-{prefix}@example.com')
            detail=admin.get('/api/v1/manager/tickets/'+ticket_id);assert detail.status_code==200,detail.text
            def assignment_body(d,g,e):return dict(group_id=g,employee_id=e,expected_assignment_id=d['assignment_id'],expected_updated_at=d['updated_at'],reason='Điều phối fixture có kiểm soát')
            body=assignment_body(detail.json(),group_id,employee2)
            with patch.object(service,'insert_assignment',side_effect=RuntimeError('fixture assignment failure')):
                assert post(admin,f'manager/tickets/{ticket_id}/assignment',body).status_code==500
            assert q('SELECT ket_thuc FROM {lich_su_phan_cong} WHERE pc_ma=%s',(detail.json()['assignment_id'],)).fetchone()['ket_thuc'] is None
            r=post(admin,f'manager/tickets/{ticket_id}/assignment',body);assert r.status_code==200,r.text;assert r.json()['assigned_id']==employee2
            assert post(admin,f'manager/tickets/{ticket_id}/assignment',body).status_code==409
            detail=admin.get('/api/v1/manager/tickets/'+ticket_id).json()
            assert post(admin,f'manager/tickets/{ticket_id}/assignment',assignment_body(detail,extra_group['id'],employee_id)).status_code==422
            r=post(admin,f'manager/tickets/{ticket_id}/assignment',assignment_body(detail,extra_group['id'],unused['id']));assert r.status_code==200,r.text
            assert second.get('/api/v1/staff/tickets/'+ticket_id).status_code==404
            assert privileged.get('/api/v1/staff/tickets/'+ticket_id).status_code==200
            detail=admin.get('/api/v1/manager/tickets/'+ticket_id).json()
            assert post(second,f'manager/tickets/{ticket_id}/assignment',assignment_body(detail,group_id,employee2)).status_code==403
            assert admin.post(f'/api/v1/manager/tickets/{ticket_id}/assignment',json=assignment_body(detail,group_id,employee2),headers=origin).status_code==403
            assert post(admin,f'manager/tickets/{ticket_id}/assignment',assignment_body(detail,group_id,None)).json()['status']=='MOI'
            assert q('SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s AND ket_thuc IS NULL',(ticket_id,)).fetchone()['n']==0
            assert approve(employee_client,ticket_id).status_code==200
            assert q('SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s AND ket_thuc IS NULL',(ticket_id,)).fetchone()['n']==1
            assert admin.get('/api/v1/manager/tickets',params={'search':ticket_id,'group':group_id,'employee':employee_id}).json()['total']==1
            assert admin.get('/api/v1/manager/tickets',params={'search':"' OR 1=1 --"}).json()['total']==0
            print('PASS C: manager detail/filters; same-group and cross-group reassignment; stale409; outside-role/CSRF; assignment failure rollback; queue release MOI and staff accepts same ID; history preserved with one active assignment.')
            if args.stage=='C':return
            assert admin.get('/api/v1/manager/tickets/'+ticket_id).json()['sla_state']=='Chưa cấu hình SLA'
            policy_body=dict(name='SLA fixture '+prefix,priority_id=priority,response_minutes=30,resolution_minutes=120,active=True)
            r=post(admin,'manager/sla',policy_body);assert r.status_code==201,r.text;policy=r.json();policy_id=policy['id']
            assert post(admin,'manager/sla',policy_body).status_code==409
            assert post(admin,'manager/sla',{**policy_body,'response_minutes':0}).status_code==422
            assert post(employee_client,'manager/sla',policy_body).status_code==403
            assert admin.get('/api/v1/manager/tickets/'+ticket_id).json()['response_due'] is None
            assert post(employee_client,f'staff/tickets/{ticket_id}/classification',dict(type_id=type_id,priority_id=priority),'PATCH').status_code==200
            old=admin.get('/api/v1/manager/tickets/'+ticket_id).json()
            apply=dict(expected_updated_at=old['updated_at'],recalculate=False,confirmed=True)
            assert post(admin,f'manager/tickets/{ticket_id}/sla',apply).status_code==200
            assert post(admin,f'manager/tickets/{ticket_id}/sla',apply).status_code==409
            r=post(customer,'customer/tickets',dict(title='Phiếu SLA tự áp dụng',description='Fixture private priority',type_id=type_id));assert r.status_code==201,r.text;new_ticket_id=r.json()['id']
            applied=admin.get('/api/v1/manager/tickets/'+new_ticket_id).json();assert applied['sla_state']=='Sắp quá hạn' and applied['sla_name']==policy_body['name']
            deltas=q('SELECT EXTRACT(epoch FROM (han_phan_hoi-ngay_tao))/60 a,EXTRACT(epoch FROM (han_xu_ly-ngay_tao))/60 b FROM {phieu_ho_tro} WHERE phieu_ma=%s',(new_ticket_id,)).fetchone();assert deltas['a']==30 and deltas['b']==120
            assert post(admin,f'manager/sla/{policy_id}',{**policy_body,'resolution_minutes':180,'expected':policy_body},'PATCH').status_code==409
            for delta,label,code in [(120,'Trong hạn','within'),(30,'Sắp quá hạn','soon'),(-1,'Quá hạn','overdue')]:
                q("UPDATE {phieu_ho_tro} SET han_xu_ly=now()+(%s*interval '1 minute'),han_phan_hoi=NULL WHERE phieu_ma=%s",(delta,new_ticket_id))
                assert admin.get('/api/v1/manager/tickets/'+new_ticket_id).json()['sla_state']==label
                query=dict(search='#HT-'+new_ticket_id,sla_state=code,page_size=1)
                filtered=admin.get('/api/v1/manager/tickets',params=query).json()
                assert filtered['total']==1 and filtered['items'][0]['id']==new_ticket_id
                assert admin.get('/api/v1/manager/tickets',params={**query,'sla_state':'none'}).json()['total']==0
            previous=admin.get('/api/v1/manager/tickets/'+ticket_id).json()['resolution_due']
            assert post(admin,f'manager/sla/{policy_id}',{**policy_body,'active':False,'expected':policy_body},'PATCH').status_code==200
            assert post(admin,'manager/sla',{**policy_body,'name':'SLA v2 fixture '+prefix,'resolution_minutes':240}).status_code==201
            assert admin.get('/api/v1/manager/tickets/'+ticket_id).json()['resolution_due']==previous
            old=admin.get('/api/v1/manager/tickets/'+ticket_id).json()
            assert post(admin,f'manager/tickets/{ticket_id}/sla',dict(expected_updated_at=old['updated_at'],confirmed=True,recalculate=True)).status_code==200
            assert q('SELECT EXTRACT(epoch FROM (han_xu_ly-ngay_tao))/60 n FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket_id,)).fetchone()['n']==240
            analytics_path='/api/v1/manager/reports/analytics'
            analytics_params={'preset':'today','group':group_id,'type':type_id}
            response_samples=admin.get(analytics_path,params=analytics_params).json()['metrics']['response_samples']
            assert post(employee_client,f'staff/tickets/{ticket_id}/messages',dict(content='Ghi chú quản lý không hiện cho khách',internal=True)).status_code==201
            manager_feed=admin.get(f'/api/v1/manager/tickets/{ticket_id}/conversation').json()
            assert manager_feed['can_send_internal'] and any(m['internal'] and m['sender_id']==employee_id for m in manager_feed['messages'])
            reply=post(admin,f'manager/tickets/{ticket_id}/internal-messages',dict(content='Phản hồi riêng của Quản lý'))
            assert reply.status_code==201,reply.text
            staff_feed=employee_client.get(f'/api/v1/staff/tickets/{ticket_id}/conversation').json()
            assert any(m['id']==reply.json()['id'] and m['internal'] for m in staff_feed['messages'])
            assert 'Phản hồi riêng của Quản lý' not in customer.get(f'/api/v1/customer/tickets/{ticket_id}/conversation').text
            print(f'PASS same-ticket internal messages: PostgreSQL fixture #HT-{ticket_id}')
            assert employee_client.get('/api/v1/staff/tickets/'+ticket_id).json()['first_response_at'] is None
            assert post(customer,f'customer/tickets/{ticket_id}/messages',dict(content='Khách bổ sung nội dung fixture')).status_code==201
            response=admin.get(analytics_path,params=analytics_params)
            assert response.status_code==200,response.text
            assert response.json()['metrics']['response_samples']==response_samples
            assert employee_client.get(analytics_path).status_code==403
            assert admin.get(analytics_path,params={'preset':'custom','start':'2026-01-03','end':'2026-01-01'}).status_code==422

            assert post(employee_client,f'staff/tickets/{ticket_id}/messages',dict(content='Đã kiểm tra chân sofa',internal=False)).status_code==201
            assert employee_client.get('/api/v1/staff/tickets/'+ticket_id).json()['first_response_at'] is not None
            assert 'Ghi chú quản lý không hiện cho khách' not in customer.get('/api/v1/customer/tickets/'+ticket_id).text
            token=employee_client.get('/api/v1/auth/csrf').json()['csrf_token']
            r=employee_client.post(f'/api/v1/staff/tickets/{ticket_id}/attachments',files={'file':('kiem-tra.txt',b'Kiem tra sofa','text/plain')},headers={**origin,'X-CSRF-Token':token});assert r.status_code==201,r.text;attachment_id=r.json()['id']
            assert employee_client.get(f'/api/v1/staff/tickets/{ticket_id}/attachments/{attachment_id}').content==b'Kiem tra sofa'
            assert admin.get(f'/api/v1/manager/tickets/{ticket_id}/attachments/{attachment_id}').content==b'Kiem tra sofa'
            print('PASS D: SLA priority-only, continuous minutes; unique active policy; immutable used policies; new-ticket deadlines exact; old deadlines unchanged unless explicit recalc; within/soon/overdue/missing; internal notes do not set first response; staff/manager real download.')
            if args.stage=='D':return
            r=admin.get('/api/v1/manager/reports',params={'search':ticket_id,'employee':employee_id,'page_size':1});assert r.status_code==200,r.text;report=r.json()
            assert report['summary']['total']==1 and report['summary']['processing']==1 and report['total']==1
            for key in ['by_status','by_group','by_type','by_priority']:assert sum(x['count'] for x in report['summary'][key])==1
            assert report['items'][0]['active']==1 and report['locality_supported'] is False
            r=admin.get('/api/v1/manager/reports',params={'search':new_ticket_id});assert r.status_code==200,r.text;assert r.json()['summary']['overdue']==1
            r=admin.get('/api/v1/manager/activity',params={'search':ticket_id,'employee':employee_id,'page_size':50});assert r.status_code==200,r.text;kinds={x['kind'] for x in r.json()['items']};assert {'Phân công','Kết thúc phân công','Trạng thái','Ghi chú nội bộ','Phản hồi công khai','Tệp đính kèm'}<=kinds
            assert admin.get('/api/v1/manager/activity?event_from=2026-10-21&event_to=2026-10-20').status_code==422
            assert admin.get('/api/v1/manager/activity?search=no-such-fixture&page=2').json()['items']==[]
            assert employee_client.get('/api/v1/manager/reports').status_code==403
            assert customer.get('/api/v1/manager/activity').status_code==403
            assert post(employee_client,f'staff/tickets/{ticket_id}/status',dict(status='DA_GIAI_QUYET')).status_code==200
            assert post(customer,f'customer/tickets/{ticket_id}/close',{}).status_code==200
            assert post(customer,f'customer/tickets/{ticket_id}/rating',dict(stars=5,comment='Hoàn tất bảo hành sofa')).status_code==201
            assert post(customer,f'customer/tickets/{ticket_id}/rating',dict(stars=4)).status_code==409
            report=admin.get('/api/v1/manager/reports',params={'search':ticket_id,'employee':employee_id}).json();assert report['summary']['closed']==1 and report['items'][0]['average_rating']==5 and report['items'][0]['on_time']==1
            closed=admin.get('/api/v1/manager/tickets/'+ticket_id).json()
            assert post(admin,f'manager/tickets/{ticket_id}/assignment',assignment_body(closed,group_id,employee2)).status_code==409
            assert post(admin,f'manager/tickets/{ticket_id}/sla',dict(expected_updated_at=closed['updated_at'],recalculate=True,confirmed=True)).status_code==409
            print('PASS E: real filtered totals/distributions/performance vs SQL; SLA overdue count; paginated activity; role isolation; full customer->staff->manager transfer/SLA->staff resolved->customer close/rate->manager report; closed-ticket changes blocked.')
            used=admin.get('/api/v1/manager/users/'+employee_id).json()
            role_body=dict(role='QUAN_TRI_VIEN',current_password=password,confirmed=True,expected_updated_at=used['updated_at'])
            assert post(admin,'manager/users/'+employee_id+'/role',role_body).status_code==409
            assert post(admin,'manager/users/'+employee_id+'/role',role_body).status_code==429
            print('PASS privileged role confirmation: real grant/revoke requires a fresh session; self-change and used accounts blocked; 5/min rate limit.')
            if args.browser:
                fixtures={}
                for project in ['desktop','mobile']:
                    browser_priority=q('SELECT i FROM generate_series(30000,32767) i WHERE NOT EXISTS(SELECT 1 FROM {muc_do_uu_tien} WHERE mdut_ma=i OR thu_tu=i) LIMIT 1').fetchone()['i']
                    q('INSERT INTO {muc_do_uu_tien}(mdut_ma,ten,thu_tu) VALUES(%s,%s,%s)',(browser_priority,'Browser '+project+' '+prefix[:8],browser_priority))
                    browser_type_name='Loại trình duyệt '+project+' '+prefix
                    browser_type=q('INSERT INTO {loai_ho_tro}(ten) VALUES(%s) RETURNING ht_ma',(browser_type_name,)).fetchone()['ht_ma']
                    fixtures[project]=dict(manager_email=f'manager-{prefix}@example.com',prefix=prefix,type_id=str(browser_type),priority_id=str(browser_priority),type_name=browser_type_name)
                run_browser(fixtures,password)


def run_browser(fixtures,password):
    import uvicorn
    _attempts.clear();_registrations.clear()
    environment={**os.environ,'HELPDESK_PHASE4_PASSWORD':password,'HELPDESK_PHASE4_FIXTURES':json.dumps(fixtures)}
    with patch.dict(os.environ,{'FRONTEND_ORIGINS':os.getenv('FRONTEND_ORIGINS','http://localhost:5173')+',http://localhost:5174'}):
        server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8001,log_level='error'))
        worker=threading.Thread(target=server.run,daemon=True);worker.start()
        try:
            for _ in range(100):
                if server.started or not worker.is_alive():break
                time.sleep(.05)
            assert server.started,'Không mở được backend kiểm thử 8001.'
            result=subprocess.run(['npm.cmd','exec','--','playwright','test','--config','playwright.phase4.config.ts'],cwd=BASE_DIR/'frontend',env=environment,check=False)
            assert result.returncode==0,'Phase4 browser failed'
        finally:
            server.should_exit=True;worker.join(timeout=10)


def counts():
    with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
        result={}
        for table in service.TABLES:
            service.execute(cur,'SELECT count(*) n FROM {'+table+'}');result[table]=cur.fetchone()['n']
        return result


if __name__=='__main__':
    baseline=counts()
    try:main()
    finally:
        assert counts()==baseline,'Bản ghi thay đổi ngoài fixture; cần kiểm tra.'
        print('PASS cleanup: record counts unchanged; fixtures rolled back; no sequence reset.')
