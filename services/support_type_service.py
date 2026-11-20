"""Support catalog and shared group expertise. Default routing stays in xu_ly_mac_dinh."""
import re
from fastapi import HTTPException
from psycopg import sql
from core.database import database_schema
from services import manager_service as manager


def available(cur):
    name = sql.Identifier(database_schema(), 'nhom_loai_ho_tro').as_string(cur)
    cur.execute('SELECT to_regclass(%s) IS NOT NULL available', (name,))
    return cur.fetchone()['available']


def require_schema(cur):
    if not available(cur):
        raise HTTPException(503, 'Cần áp dụng migration 006_group_support_types.sql để quản lý nhiều nhóm cùng phụ trách.')


def expertise_table(cur):
    return 'nhom_loai_ho_tro' if available(cur) else 'xu_ly_mac_dinh'


def normalize_name(name):
    return re.sub(r'\s+', ' ', name).strip()


def type_row(cur, type_id, lock=False):
    manager.execute(cur, '''SELECT ht_ma::text id,ten name,mo_ta description,dang_hoat_dong active
        FROM {loai_ho_tro} WHERE ht_ma=%s''' + (' FOR UPDATE' if lock else ''), (type_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, 'Không tìm thấy loại hỗ trợ.')
    return row


def enrich(cur, rows):
    if not rows:
        return
    relation = expertise_table(cur)
    manager.execute(cur, '''SELECT e.ht_ma::text type_id,g.nhom_ma::text id,g.ten name,
        COALESCE(x.nhom_ma=e.nhom_ma,false) is_default FROM {''' + relation + '''} e JOIN {nhom_ho_tro} g USING(nhom_ma)
        LEFT JOIN {xu_ly_mac_dinh} x ON x.ht_ma=e.ht_ma
        WHERE e.ht_ma=ANY(%s::bigint[]) ORDER BY g.nhom_ma''', ([row['id'] for row in rows],))
    groups = {}
    for group in cur.fetchall():
        groups.setdefault(group.pop('type_id'), []).append(group)
    manager.execute(cur, '''SELECT ht_ma::text id,count(*) tickets,
        count(*) FILTER (WHERE t.ma='MOI') waiting FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma)
        WHERE ht_ma=ANY(%s::bigint[]) GROUP BY ht_ma''', ([row['id'] for row in rows],))
    counts = {item['id']: item for item in cur.fetchall()}
    for row in rows:
        row['groups'] = groups.get(row['id'], [])
        row['tickets'] = counts.get(row['id'], {}).get('tickets', 0)
        row['waiting'] = counts.get(row['id'], {}).get('waiting', 0)


def catalog(actor, search='', active=None, page=1, page_size=5):
    conditions = ['true']
    params = []
    if search.strip():
        conditions.append("(ht_ma::text=%s OR strpos(lower(ten),lower(%s))>0)")
        params += [search.strip(), search.strip()]
    if active is not None:
        conditions.append('dang_hoat_dong=%s')
        params.append(active)
    where = ' WHERE ' + ' AND '.join(conditions)
    with manager.manager_cursor(actor) as (cur, _):
        manager.execute(cur, 'SELECT count(*) total FROM {loai_ho_tro}' + where, params)
        total = cur.fetchone()['total']
        manager.execute(cur, '''SELECT ht_ma::text id,ten name,mo_ta description,dang_hoat_dong active
            FROM {loai_ho_tro}''' + where + ' ORDER BY ht_ma LIMIT %s OFFSET %s',
            [*params, page_size, (page-1)*page_size])
        rows = cur.fetchall()
        enrich(cur, rows)
        return dict(items=rows, total=total, page=page, page_size=page_size)


def save(actor, body, type_id=None):
    with manager.manager_cursor(actor, True) as (cur, events):
        if type_id is not None:
            current = type_row(cur, type_id, True)
            if any(current[key] != value for key, value in body.expected.model_dump().items()):
                raise HTTPException(409, 'Loại hỗ trợ đã thay đổi. Hãy tải lại trước khi lưu.')
        manager.execute(cur, 'SELECT ht_ma,ten FROM {loai_ho_tro}')
        key = normalize_name(body.name).casefold()
        if any(normalize_name(row['ten']).casefold() == key and str(row['ht_ma']) != str(type_id) for row in cur.fetchall()):
            raise HTTPException(409, 'Tên loại hỗ trợ đã tồn tại.')
        values = (normalize_name(body.name), body.description, body.active)
        if type_id is None:
            manager.execute(cur, '''INSERT INTO {loai_ho_tro}(ten,mo_ta,dang_hoat_dong)
                VALUES(%s,%s,%s) RETURNING ht_ma''', values)
            type_id = cur.fetchone()['ht_ma']
        else:
            manager.execute(cur, 'UPDATE {loai_ho_tro} SET ten=%s,mo_ta=%s,dang_hoat_dong=%s WHERE ht_ma=%s',
                            (*values, type_id))
        events.append(('support_type.create' if not hasattr(body, 'expected') else 'support_type.update', type_id))
        row = type_row(cur, type_id)
        enrich(cur, [row])
        return row


def delete(actor, type_id, expected):
    with manager.manager_cursor(actor, True) as (cur, events):
        row = type_row(cur, type_id, True)
        if any(row[key] != value for key, value in expected.model_dump().items()):
            raise HTTPException(409, 'Loại hỗ trợ đã thay đổi. Hãy tải lại.')
        relation = expertise_table(cur)
        manager.execute(cur, '''SELECT EXISTS(SELECT 1 FROM {phieu_ho_tro} WHERE ht_ma=%s)
            OR EXISTS(SELECT 1 FROM {xu_ly_mac_dinh} WHERE ht_ma=%s)
            OR EXISTS(SELECT 1 FROM {''' + relation + '''} WHERE ht_ma=%s) referenced''',
            (type_id, type_id, type_id))
        if cur.fetchone()['referenced']:
            raise HTTPException(409, 'Loại hỗ trợ có phiếu hoặc nhóm tham chiếu. Hãy sử dụng Ngừng hoạt động.')
        manager.execute(cur, 'DELETE FROM {loai_ho_tro} WHERE ht_ma=%s', (type_id,))
        events.append(('support_type.delete', type_id))
        return {'message': 'Đã xóa loại hỗ trợ chưa được sử dụng.'}


def group_types(actor, group_id):
    with manager.manager_cursor(actor) as (cur, _):
        manager.group_row(cur, group_id)
        manager.execute(cur, 'SELECT ht_ma::text id,ten name,mo_ta description,dang_hoat_dong active FROM {loai_ho_tro} ORDER BY ht_ma')
        rows = cur.fetchall()
        enrich(cur, rows)
        return dict(available=available(cur), items=rows)


def add_expertise(cur, group_id, type_id):
    require_schema(cur)
    group = manager.group_row(cur, group_id, True)
    row = type_row(cur, type_id, True)
    manager.execute(cur, 'SELECT 1 FROM {nhom_loai_ho_tro} WHERE nhom_ma=%s AND ht_ma=%s', (group_id, type_id))
    if cur.fetchone():
        return
    if not group['active'] or not row['active']:
        raise HTTPException(409, 'Nhóm và loại hỗ trợ phải đang hoạt động.')
    manager.execute(cur, 'SELECT count(*) total FROM {nhom_loai_ho_tro} WHERE nhom_ma=%s', (group_id,))
    if cur.fetchone()['total'] >= 2:
        raise HTTPException(409, 'Nhóm đã đạt giới hạn tối đa 2 loại hỗ trợ.')
    manager.execute(cur, 'INSERT INTO {nhom_loai_ho_tro}(nhom_ma,ht_ma) VALUES(%s,%s)', (group_id, type_id))


def change_expertise(actor, group_id, type_id, remove=False):
    with manager.manager_cursor(actor, True) as (cur, events):
        require_schema(cur)
        if remove:
            manager.group_row(cur, group_id, True)
            type_row(cur, type_id, True)
            manager.execute(cur, 'SELECT 1 FROM {xu_ly_mac_dinh} WHERE ht_ma=%s AND nhom_ma=%s', (type_id, group_id))
            if cur.fetchone():
                raise HTTPException(409, 'Hãy thay đổi hoặc bỏ nhóm mặc định trước khi bỏ quan hệ phụ trách này.')
            manager.execute(cur, 'DELETE FROM {nhom_loai_ho_tro} WHERE ht_ma=%s AND nhom_ma=%s RETURNING ht_ma', (type_id, group_id))
            if cur.fetchone() is None:
                raise HTTPException(409, 'Quan hệ phụ trách đã thay đổi. Hãy tải lại.')
        else:
            add_expertise(cur, group_id, type_id)
        events.append(('group.expertise.remove' if remove else 'group.expertise.add', f'{group_id}:{type_id}'))
        return {'message': 'Đã bỏ quan hệ phụ trách.' if remove else 'Đã thêm loại hỗ trợ cùng phụ trách.'}
