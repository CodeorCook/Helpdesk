"""Staff operations. Recommendations never write assignments; every mutation locks the ticket."""
from contextlib import contextmanager
from datetime import datetime, time, timedelta, timezone
import secrets
from fastapi import HTTPException
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.errors import UndefinedColumn
from psycopg.types.json import Jsonb
from core.database import database_schema, get_connection
from core.uploads import safe_path, validate_file
from core.coordination import lock_operations
from core.sla import attach_sla
from services import customer_service as customer
from services.email_service import enqueue

TABLES = (*customer.TABLES, 'nhan_vien', 'nhom_ho_tro', 'thanh_vien_nhom', 'xu_ly_mac_dinh', 'lich_su_phan_cong', 'chinh_sach_sla')


def execute(cur, statement, params=()):
    cur.execute(sql.SQL(statement).format(**{t: sql.Identifier(database_schema(), t) for t in (*TABLES, 'staff_message_read')}), params)


@contextmanager
def staff_cursor(user_id,mutation=False):
    with get_connection() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        if mutation:lock_operations(cur)
        execute(cur, "SELECT v.nd_ma FROM {nhan_vien} v JOIN {nguoi_dung} n USING(nd_ma) WHERE v.nd_ma=%s AND n.vai_tro='NHAN_VIEN' AND n.trang_thai='HOAT_DONG'"+(' FOR SHARE OF n' if mutation else ''), (user_id,))
        if cur.fetchone() is None:
            raise HTTPException(409, 'Tài khoản thiếu hồ sơ nhân viên hoạt động. Vui lòng liên hệ Quản lý.')
        yield cur


GROUP = 'COALESCE(p.nhom_ma, (SELECT x.nhom_ma FROM {xu_ly_mac_dinh} x WHERE x.ht_ma=p.ht_ma))'
MEMBER = "EXISTS(SELECT 1 FROM {thanh_vien_nhom} m JOIN {nhom_ho_tro} g USING(nhom_ma) WHERE m.nhan_vien_ma=%s AND g.dang_hoat_dong AND m.nhom_ma=" + GROUP + ')'
ACCESS = '(p.nhan_vien_phu_trach_ma=%s OR ' + MEMBER + ')'
FROM = ''' FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma)
 JOIN {muc_do_uu_tien} u USING(mdut_ma) LEFT JOIN {loai_ho_tro} l USING(ht_ma)
 LEFT JOIN {nguoi_dung} n ON n.nd_ma=p.nhan_vien_phu_trach_ma
 LEFT JOIN {nhom_ho_tro} g ON g.nhom_ma=''' + GROUP + '''
 LEFT JOIN {chinh_sach_sla} s ON s.sla_ma=p.sla_ma '''
VIEW = '''SELECT p.phieu_ma::text id,p.tieu_de title,p.mo_ta description,p.ht_ma::text type_id,l.ten type_name,
 t.ma status,t.ten status_label,u.ten priority,u.thu_tu priority_rank,p.mdut_ma::text priority_id,p.ngay_tao created_at,
 p.ngay_cap_nhat updated_at,p.ngay_dong closed_at,n.ho_ten assigned_to,p.nhan_vien_phu_trach_ma::text assigned_id,
 g.nhom_ma::text group_id,g.ten group_name,s.ten sla_name,p.han_phan_hoi response_due,p.han_xu_ly resolution_due,
 p.ngay_phan_hoi_dau first_response_at,p.ngay_giai_quyet resolved_at''' + FROM


def sla(row):
    now = datetime.now(timezone.utc)
    if not row['sla_name']:
        return 'Chưa cấu hình SLA'
    if row['status'] in ('DA_GIAI_QUYET', 'DA_DONG', 'DA_HUY'):
        return 'Đã kết thúc theo dõi'
    due = [row['resolution_due']]
    if not row['first_response_at']:
        due.append(row['response_due'])
    values = [d for d in due if d is not None]
    if not values:
        return 'Chưa cấu hình SLA'
    if min(values) < now:
        return 'Quá hạn'
    return 'Sắp quá hạn' if min(values) <= now + timedelta(minutes=60) else 'Trong hạn'


def decorate(row):
    row['sla_state'] = sla(row)
    return row


def eligible(cur, group_id):
    execute(cur, '''SELECT n.nd_ma::text id,n.ho_ten name,
      (SELECT count(*) FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma)
       WHERE p.nhan_vien_phu_trach_ma=n.nd_ma AND NOT t.la_ket_thuc AND t.ma<>'DA_GIAI_QUYET') workload
      FROM {thanh_vien_nhom} m JOIN {nhom_ho_tro} g USING(nhom_ma)
      JOIN {nhan_vien} v ON v.nd_ma=m.nhan_vien_ma JOIN {nguoi_dung} n ON n.nd_ma=v.nd_ma
      WHERE g.nhom_ma=%s AND g.dang_hoat_dong AND n.trang_thai='HOAT_DONG' AND n.vai_tro='NHAN_VIEN'
      ORDER BY workload,(SELECT max(h.bat_dau) FROM {lich_su_phan_cong} h WHERE h.nhan_vien_ma=n.nd_ma) ASC NULLS FIRST,n.nd_ma''', (group_id,))
    return cur.fetchall()


def row(cur, user_id, ticket_id, lock=False):
    if lock:
        # Check access before waiting, then lock only the base row. Re-read the joined
        # view in a fresh READ COMMITTED statement after a competing update commits.
        # Locking the outer-joined view can recheck stale subplans and produce 404.
        row(cur,user_id,ticket_id)
        execute(cur,'SELECT phieu_ma FROM {phieu_ho_tro} WHERE phieu_ma=%s FOR UPDATE',(ticket_id,))
        if cur.fetchone() is None:raise HTTPException(404,'Không tìm thấy phiếu hỗ trợ.')
    execute(cur, VIEW + ' WHERE p.phieu_ma=%s AND ' + ACCESS, (ticket_id, user_id, user_id))
    result = cur.fetchone()
    if result is None:
        raise HTTPException(404, 'Không tìm thấy phiếu hỗ trợ trong phạm vi của bạn.')
    return decorate(result)


def active_assignment(cur, ticket_id):
    execute(cur, 'SELECT pc_ma,nhan_vien_ma FROM {lich_su_phan_cong} WHERE phieu_ma=%s AND ket_thuc IS NULL', (ticket_id,))
    return cur.fetchone()


def processor(cur, user_id, ticket_id):
    lock_operations(cur)
    ticket = row(cur, user_id, ticket_id, True)
    assignment = active_assignment(cur, ticket_id)
    if ticket['assigned_id'] != str(user_id) or not assignment or str(assignment['nhan_vien_ma']) != str(user_id):
        raise HTTPException(409, 'Phân công đã thay đổi hoặc bạn không phải người phụ trách. Hãy làm mới phiếu.')
    if str(user_id) not in {v['id'] for v in eligible(cur, ticket['group_id'])}:
        raise HTTPException(403, 'Bạn không còn thuộc nhóm hoạt động của phiếu. Vui lòng liên hệ Quản lý.')
    if ticket['status'] not in ('DANG_XU_LY', 'TAM_DUNG'):
        raise HTTPException(409, 'Phiếu đã giải quyết hoặc kết thúc; không thể tiếp tục xử lý.')
    return ticket, assignment


def catalog(user_id, kind):
    with staff_cursor(user_id) as cur:
        queries = {
            'types': 'SELECT ht_ma::text id,ten name FROM {loai_ho_tro} WHERE dang_hoat_dong ORDER BY ht_ma',
            'statuses': 'SELECT tt_ma::text id,ten name,ma code FROM {trang_thai} ORDER BY tt_ma',
            'priorities': 'SELECT mdut_ma::text id,ten name FROM {muc_do_uu_tien} ORDER BY thu_tu',
        }
        execute(cur, queries[kind])
        return cur.fetchall()


QUEUE_DUE = "CASE WHEN p.sla_ma IS NOT NULL AND p.han_phan_hoi > p.ngay_tao THEN p.han_phan_hoi END"
QUEUE_HALF = f"(p.ngay_tao + (({QUEUE_DUE}) - p.ngay_tao) / 2)"


def read_receipts_available(cur):
    name = sql.Identifier(database_schema(), 'staff_message_read').as_string(cur)
    cur.execute('SELECT to_regclass(%s) IS NOT NULL available', (name,))
    return cur.fetchone()['available']


def count_unread_customer_messages(cur, user_id, items):
    if not items or not read_receipts_available(cur):
        return
    execute(cur, """SELECT m.phieu_ma::text id,count(*) unread
        FROM {tin_nhan} m JOIN {phieu_ho_tro} p USING(phieu_ma)
        WHERE m.phieu_ma=ANY(%s::bigint[]) AND p.nhan_vien_phu_trach_ma=%s
          AND m.nguoi_gui_ma=p.khach_hang_ma AND NOT m.la_ghi_chu_noi_bo
          AND NOT EXISTS (SELECT 1 FROM {staff_message_read} r WHERE r.nhan_vien_ma=%s AND r.tn_ma=m.tn_ma)
        GROUP BY m.phieu_ma""", ([item['id'] for item in items], user_id, user_id))
    counts = {row['id']: row['unread'] for row in cur.fetchall()}
    for item in items:
        item['unread_customer_messages'] = counts.get(item['id'], 0)


def mark_customer_messages_read(user_id, ticket_id, message_ids):
    with staff_cursor(user_id, mutation=True) as cur:
        ticket = row(cur, user_id, ticket_id, True)
        if ticket['assigned_id'] != str(user_id):
            raise HTTPException(409, 'Phiếu không còn được phân công cho bạn.')
        if not read_receipts_available(cur):
            raise HTTPException(503, 'Cần áp dụng migration 003_staff_message_read.sql để lưu trạng thái đọc.')
        execute(cur, """INSERT INTO {staff_message_read}(nhan_vien_ma,tn_ma)
            SELECT %s,m.tn_ma FROM {tin_nhan} m JOIN {phieu_ho_tro} p USING(phieu_ma)
            WHERE m.phieu_ma=%s AND m.tn_ma=ANY(%s::bigint[])
              AND m.nguoi_gui_ma=p.khach_hang_ma AND NOT m.la_ghi_chu_noi_bo
            ON CONFLICT DO NOTHING""", (user_id, ticket_id, message_ids))


def list_tickets(user_id, scope='queue', search='', type_id=None, status=None, priority=None, from_date=None, to_date=None, page=1, page_size=10, sort=None):
    if from_date and to_date and from_date > to_date:
        raise HTTPException(422, 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.')
    conditions = [ACCESS]; params = [user_id, user_id]
    if scope == 'mine':
        conditions.append('p.nhan_vien_phu_trach_ma=%s'); params.append(user_id)
    elif scope in ('queue', 'recommended'):
        conditions.append("t.ma='MOI' AND p.nhan_vien_phu_trach_ma IS NULL AND NOT EXISTS(SELECT 1 FROM {lich_su_phan_cong} h WHERE h.phieu_ma=p.phieu_ma AND h.ket_thuc IS NULL)")
    if search:
        escaped = search.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
        conditions.append("(p.tieu_de ILIKE %s OR p.phieu_ma::text=%s)"); params += ['%'+escaped+'%', search.removeprefix('#HT-')]
    for value, column in [(type_id,'p.ht_ma'), (status,'t.ma'), (priority,'p.mdut_ma')]:
        if value is not None:
            conditions.append(column+'=%s'); params.append(value)
    for date, operator, extra in [(from_date, '>=', 0), (to_date, '<', 1)]:
        if date:
            conditions.append('p.ngay_tao'+operator+'%s'); params.append(datetime.combine(date, time.min, timezone(timedelta(hours=7)))+timedelta(days=extra))
    with staff_cursor(user_id) as cur:
        # Rank is calculated once per group, not once per ticket. It never claims or locks a ticket.
        preferred = []
        if scope != 'mine':
            execute(cur, 'SELECT nhom_ma FROM {thanh_vien_nhom} m JOIN {nhom_ho_tro} g USING(nhom_ma) WHERE m.nhan_vien_ma=%s AND g.dang_hoat_dong', (user_id,))
            groups = [r['nhom_ma'] for r in cur.fetchall()]
            for group in groups:
                people = eligible(cur, group)
                if people and people[0]['id'] == str(user_id): preferred.append(group)
        if scope == 'recommended':
            conditions.append(GROUP+'=ANY(%s)'); params.append(preferred)
        where = ' WHERE '+' AND '.join(conditions)
        if scope == 'queue':
            execute(cur, f"""SELECT count(*) total, now() server_now,
                count(*) FILTER (WHERE {QUEUE_DUE} <= now()) overdue,
                count(*) FILTER (WHERE {QUEUE_DUE} > now() AND {QUEUE_HALF} <= now()) soon,
                min(CASE WHEN {QUEUE_HALF} > now() THEN {QUEUE_HALF}
                    WHEN {QUEUE_DUE} > now() THEN {QUEUE_DUE} END) next_transition""" + FROM + where, params)
        else:
            execute(cur, 'SELECT count(*) total' + FROM + where, params)
        counts = cur.fetchone()
        if scope == 'queue':
            counts['attention'] = counts['soon'] + counts['overdue']
        if scope == 'mine':
            order = 'p.ngay_tao ASC,p.phieu_ma ASC' if sort == 'oldest' else 'p.ngay_tao DESC,p.phieu_ma DESC'
            order_params = []
        elif scope == 'queue' and sort:
            order = (QUEUE_DUE + ' ASC NULLS LAST,' if sort == 'due' else '') + 'p.ngay_tao DESC,p.phieu_ma DESC'
            order_params = []
        else:
            order = '(' + GROUP + '=ANY(%s)) DESC NULLS LAST,u.thu_tu DESC,p.ngay_tao,p.phieu_ma'
            order_params = [preferred]
        execute(cur, VIEW + where + ' ORDER BY ' + order + ' LIMIT %s OFFSET %s',
                [*params, *order_params, page_size, (page-1)*page_size])
        items=cur.fetchall()
        if scope == 'mine':
            count_unread_customer_messages(cur, user_id, items)
        for item in items:
            item['recommended'] = item['assigned_id'] is None and item['status']=='MOI' and item['group_id'] in {str(g) for g in preferred}
            decorate(item)
        return dict(items=items, **counts, page=page, page_size=page_size)


def overview(user_id):
    result={key:list_tickets(user_id,scope)['total'] for key,scope in [('assigned','mine'),('queue','queue'),('recommended','recommended'),('team','team')]}
    with staff_cursor(user_id) as cur:
        execute(cur, "SELECT count(*) value FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma) LEFT JOIN {nhom_ho_tro} g ON g.nhom_ma="+GROUP+" WHERE t.ma='MOI' AND p.nhan_vien_phu_trach_ma IS NULL AND (g.nhom_ma IS NULL OR NOT g.dang_hoat_dong OR NOT EXISTS(SELECT 1 FROM {thanh_vien_nhom} m JOIN {nhan_vien} v ON v.nd_ma=m.nhan_vien_ma JOIN {nguoi_dung} a ON a.nd_ma=v.nd_ma WHERE m.nhom_ma=g.nhom_ma AND a.trang_thai='HOAT_DONG' AND a.vai_tro='NHAN_VIEN'))")
        result['unrouted']=cur.fetchone()['value']
        execute(cur, 'SELECT count(*) value FROM {thanh_vien_nhom} m JOIN {nhom_ho_tro} g USING(nhom_ma) WHERE m.nhan_vien_ma=%s AND g.dang_hoat_dong',(user_id,));result['groups']=cur.fetchone()['value']
        execute(cur, "SELECT count(*) value"+FROM+" WHERE p.nhan_vien_phu_trach_ma=%s AND NOT t.la_ket_thuc AND t.ma<>'DA_GIAI_QUYET' AND s.sla_ma IS NOT NULL AND (p.han_xu_ly<now() OR (p.ngay_phan_hoi_dau IS NULL AND p.han_phan_hoi<now()))",(user_id,));result['overdue']=cur.fetchone()['value']
    return result


def change_status(cur, user_id, ticket_id, old, target):
    execute(cur,'SELECT tt_ma FROM {trang_thai} WHERE ma=%s',(target,)); new=cur.fetchone()
    if new is None: raise HTTPException(409,'Thiếu trạng thái trong cấu hình.')
    execute(cur,"UPDATE {phieu_ho_tro} SET tt_ma=%s,ngay_giai_quyet=CASE WHEN %s='DA_GIAI_QUYET' THEN now() ELSE ngay_giai_quyet END WHERE phieu_ma=%s",(new['tt_ma'],target,ticket_id))
    execute(cur,'SELECT tt_ma FROM {trang_thai} WHERE ma=%s',(old,)); previous=cur.fetchone()['tt_ma']
    customer.add_history(cur,ticket_id,previous,new['tt_ma'],user_id)


def review_pending(cur, user_id, ticket_id, expected):
    ticket = row(cur, user_id, ticket_id, True)
    if ticket['status'] != 'MOI' or ticket['assigned_id'] is not None or active_assignment(cur, ticket_id):
        raise HTTPException(409, 'Yêu cầu đã được tiếp nhận hoặc kết thúc. Hãy làm mới danh sách.')
    if ticket['updated_at'] != expected:
        raise HTTPException(409, 'Yêu cầu đã được cập nhật. Hãy tải lại trước khi xác nhận.')
    if str(user_id) not in {person['id'] for person in eligible(cur, ticket['group_id'])}:
        raise HTTPException(403, 'Bạn không thuộc nhóm phù hợp đang hoạt động.')
    return ticket


def approve(user_id, ticket_id, body):
    try:
        with staff_cursor(user_id, mutation=True) as cur:
            ticket = review_pending(cur, user_id, ticket_id, body.expected_updated_at)
            valid_classification(cur, body.type_id, body.priority_id)
            if str(body.type_id) != ticket['type_id']:
                execute(cur, 'SELECT nhom_ma::text id FROM {xu_ly_mac_dinh} WHERE ht_ma=%s', (body.type_id,))
                destination = cur.fetchone()
                if not destination or destination['id'] != ticket['group_id']:
                    raise HTTPException(422, 'Loại hỗ trợ thuộc phạm vi khác hoặc chưa có nhóm. Vui lòng liên hệ Quản lý để điều phối.')
            snapshot = {key: ticket[key] for key in (
                'title', 'description', 'type_id', 'type_name', 'priority_id', 'sla_name',
                'response_due', 'resolution_due', 'sla_state',
            )}
            for key in ('response_due', 'resolution_due'):
                snapshot[key] = snapshot[key].isoformat() if snapshot[key] else None
            snapshot['captured_at'] = datetime.now(timezone.utc).isoformat()
            execute(cur, """UPDATE {phieu_ho_tro}
                SET yeu_cau_goc=COALESCE(yeu_cau_goc,%s),tieu_de=%s,mo_ta=%s,ht_ma=%s,mdut_ma=%s,
                    nhan_vien_phu_trach_ma=%s,nhom_ma=%s,sla_ma=NULL,han_phan_hoi=NULL,han_xu_ly=NULL
                WHERE phieu_ma=%s""", (Jsonb(snapshot), body.title, body.description, body.type_id,
                body.priority_id, user_id, ticket['group_id'], ticket_id))
            attach_sla(cur, ticket_id)
            execute(cur, """INSERT INTO {lich_su_phan_cong}(phieu_ma,nhan_vien_ma,nguoi_phan_cong_ma)
                VALUES (%s,%s,%s)""", (ticket_id, user_id, user_id))
            change_status(cur, user_id, ticket_id, 'MOI', 'DANG_XU_LY')
            enqueue(cur, ticket_id, 'approved')
            return row(cur, user_id, ticket_id)
    except UndefinedColumn as exc:
        if 'yeu_cau_goc' not in str(exc):
            raise
        raise HTTPException(503, 'Thiếu cột lưu nội dung gốc. Hãy chạy migration 001_staff_request_snapshot.sql trước khi lập phiếu hỗ trợ.') from exc


def reject(user_id, ticket_id, body):
    try:
        with staff_cursor(user_id, mutation=True) as cur:
            review_pending(cur, user_id, ticket_id, body.expected_updated_at)
            execute(cur, """SELECT 1 FROM {lich_su_phan_cong} WHERE phieu_ma=%s
                UNION ALL SELECT 1 FROM {phieu_ho_tro} p WHERE p.phieu_ma=%s
                AND (p.ngay_giai_quyet IS NOT NULL OR to_jsonb(p)->>'yeu_cau_goc' IS NOT NULL) LIMIT 1""",
                (ticket_id, ticket_id))
            if cur.fetchone():
                raise HTTPException(409, 'Phiếu từng được phân công hoặc phê duyệt, không thể từ chối như yêu cầu mới.')
            execute(cur, """UPDATE {phieu_ho_tro} SET ket_thuc_loai='TU_CHOI_YEU_CAU',
                ngay_dong=clock_timestamp(),ly_do_dong=%s WHERE phieu_ma=%s""", (body.reason, ticket_id))
            change_status(cur, user_id, ticket_id, 'MOI', 'DA_HUY')
            enqueue(cur, ticket_id, 'rejected', body.reason)
            return {**row(cur, user_id, ticket_id), 'termination_kind': 'TU_CHOI_YEU_CAU',
                    'status_label': 'Đã đóng – Không tiếp nhận', 'end_reason': body.reason}
    except UndefinedColumn as exc:
        if 'ket_thuc_loai' not in str(exc):
            raise
        raise HTTPException(503, 'Thiếu cột lưu loại kết thúc. Hãy chạy migration 002_request_rejection_and_email.sql trước khi không tiếp nhận yêu cầu.') from exc


def customers(user_id, search):
    with staff_cursor(user_id) as cur:
        if len(search.strip()) < 2: return []
        escaped=search.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
        execute(cur,"SELECT n.nd_ma::text id,n.ho_ten name FROM {khach_hang} k JOIN {nguoi_dung} n USING(nd_ma) WHERE n.vai_tro='KHACH_HANG' AND n.trang_thai='HOAT_DONG' AND (n.ho_ten ILIKE %s OR lower(n.email)=lower(%s) OR n.nd_ma::text=%s) ORDER BY n.nd_ma LIMIT 20",('%'+escaped+'%',search.strip(),search.strip()))
        return cur.fetchall()


def valid_classification(cur, type_id, priority_id):
    execute(cur,'SELECT ht_ma FROM {loai_ho_tro} WHERE ht_ma=%s AND dang_hoat_dong FOR SHARE',(type_id,))
    if cur.fetchone() is None: raise HTTPException(422,'Loại hỗ trợ không hợp lệ hoặc đã ngừng sử dụng.')
    execute(cur,'SELECT mdut_ma FROM {muc_do_uu_tien} WHERE mdut_ma=%s',(priority_id,))
    if cur.fetchone() is None: raise HTTPException(422,'Mức ưu tiên không hợp lệ.')


def create_ticket(user_id, body):
    with staff_cursor(user_id,mutation=True) as cur:
        valid_classification(cur,body.type_id,body.priority_id)
        execute(cur,"SELECT k.nd_ma FROM {khach_hang} k JOIN {nguoi_dung} n USING(nd_ma) WHERE k.nd_ma=%s AND n.vai_tro='KHACH_HANG' AND n.trang_thai='HOAT_DONG' FOR SHARE OF n",(body.customer_id,))
        if cur.fetchone() is None: raise HTTPException(422,'Khách hàng không hợp lệ hoặc đã khóa.')
        execute(cur,"SELECT tt_ma FROM {trang_thai} WHERE ma='MOI'");state=cur.fetchone()
        if state is None: raise HTTPException(409,'Thiếu trạng thái MOI trong cấu hình.')
        execute(cur,"""INSERT INTO {phieu_ho_tro}(khach_hang_ma,nguoi_lap_ma,nguon_tao,mdut_ma,ht_ma,tt_ma,tieu_de,mo_ta)
            VALUES(%s,%s,'NHAN_VIEN',%s,%s,%s,%s,%s) RETURNING phieu_ma::text id""",(body.customer_id,user_id,body.priority_id,body.type_id,state['tt_ma'],body.title,body.description))
        ticket_id=cur.fetchone()['id'];customer.add_history(cur,ticket_id,None,state['tt_ma'],user_id)
        attach_sla(cur,ticket_id)
        # Creation is distinct from accepting. Caller gets only a receipt if routed outside their groups.
        return {'id':ticket_id,'message':'Đã lập phiếu mới thay khách hàng. Phiếu đang chờ tiếp nhận; chưa phân công.'}


def classify(user_id,ticket_id,body):
    with staff_cursor(user_id,mutation=True) as cur:
        processor(cur,user_id,ticket_id);valid_classification(cur,body.type_id,body.priority_id)
        execute(cur,'UPDATE {phieu_ho_tro} SET ht_ma=%s,mdut_ma=%s WHERE phieu_ma=%s',(body.type_id,body.priority_id,ticket_id))
    return detail(user_id,ticket_id)


def recipients(user_id,ticket_id):
    with staff_cursor(user_id) as cur:
        ticket,_=processor(cur,user_id,ticket_id)
        return [p for p in eligible(cur,ticket['group_id']) if p['id']!=str(user_id)]


def transfer(user_id,ticket_id,body):
    with staff_cursor(user_id,mutation=True) as cur:
        ticket,assignment=processor(cur,user_id,ticket_id)
        if assignment['pc_ma']!=body.assignment_id: raise HTTPException(409,'Phân công đã thay đổi. Hãy làm mới phiếu.')
        if str(body.employee_id)==str(user_id) or str(body.employee_id) not in {p['id'] for p in eligible(cur,ticket['group_id'])}:
            raise HTTPException(422,'Người nhận phải là nhân viên hoạt động khác trong cùng nhóm.')
        execute(cur,'UPDATE {lich_su_phan_cong} SET ket_thuc=clock_timestamp() WHERE pc_ma=%s',(assignment['pc_ma'],))
        execute(cur,'INSERT INTO {lich_su_phan_cong}(phieu_ma,nhan_vien_ma,nguoi_phan_cong_ma,bat_dau) VALUES(%s,%s,%s,clock_timestamp())',(ticket_id,body.employee_id,user_id))
        execute(cur,'UPDATE {phieu_ho_tro} SET nhan_vien_phu_trach_ma=%s WHERE phieu_ma=%s',(body.employee_id,ticket_id))
        return row(cur,user_id,ticket_id)


def update_status(user_id,ticket_id,body):
    allowed={'DANG_XU_LY':{'TAM_DUNG','DA_GIAI_QUYET'},'TAM_DUNG':{'DANG_XU_LY','DA_GIAI_QUYET'}}
    with staff_cursor(user_id,mutation=True) as cur:
        ticket,_=processor(cur,user_id,ticket_id)
        if body.status not in allowed.get(ticket['status'],set()):raise HTTPException(409,'Chuyển trạng thái không hợp lệ.')
        change_status(cur,user_id,ticket_id,ticket['status'],body.status)
        return row(cur,user_id,ticket_id)


def detail(user_id,ticket_id):
    with staff_cursor(user_id) as cur:
        ticket=row(cur,user_id,ticket_id)
        execute(cur, "SELECT to_jsonb(p)->'yeu_cau_goc' AS snapshot FROM {phieu_ho_tro} p WHERE phieu_ma=%s", (ticket_id,))
        ticket['request_snapshot'] = cur.fetchone()['snapshot']
        execute(cur,'SELECT n.nd_ma::text id,n.ho_ten name FROM {phieu_ho_tro} p JOIN {nguoi_dung} n ON n.nd_ma=p.khach_hang_ma WHERE p.phieu_ma=%s',(ticket_id,));ticket['customer']=cur.fetchone()
        execute(cur,'''SELECT m.tn_ma::text id,n.ho_ten sender,m.noi_dung content,m.la_ghi_chu_noi_bo internal,m.thoi_gian created_at
            FROM {tin_nhan} m JOIN {nguoi_dung} n ON n.nd_ma=m.nguoi_gui_ma WHERE m.phieu_ma=%s ORDER BY m.thoi_gian DESC,m.tn_ma DESC LIMIT 201''',(ticket_id,))
        messages=cur.fetchall();ticket['messages_truncated']=len(messages)>200;ticket['messages']=list(reversed(messages[:200]))
        execute(cur,'SELECT tep_ma::text id,ten name,mime_type,kich_thuoc_byte size,ngay_tai_len created_at FROM {tep_dinh_kem} WHERE phieu_ma=%s ORDER BY tep_ma',(ticket_id,));ticket['attachments']=cur.fetchall()
        execute(cur,'''SELECT old.ten previous,new.ten current,h.thoi_diem created_at FROM {lich_su_trang_thai} h
            LEFT JOIN {trang_thai} old ON old.tt_ma=h.tt_cu_ma JOIN {trang_thai} new ON new.tt_ma=h.tt_moi_ma
            WHERE h.phieu_ma=%s ORDER BY h.thoi_diem,h.ls_ma''',(ticket_id,));ticket['history']=cur.fetchall()
        execute(cur,'''SELECT h.pc_ma::text id,n.ho_ten employee,h.bat_dau started_at,h.ket_thuc ended_at
            FROM {lich_su_phan_cong} h JOIN {nguoi_dung} n ON n.nd_ma=h.nhan_vien_ma WHERE h.phieu_ma=%s ORDER BY h.bat_dau,h.pc_ma''',(ticket_id,));ticket['assignments']=cur.fetchall()
        assignment=active_assignment(cur,ticket_id)
        ticket['assignment_id']=str(assignment['pc_ma']) if assignment else None
        ticket['can_process']=ticket['status'] in ('DANG_XU_LY','TAM_DUNG') and ticket['assigned_id']==str(user_id) and assignment is not None and str(assignment['nhan_vien_ma'])==str(user_id) and str(user_id) in {p['id'] for p in eligible(cur,ticket['group_id'])}
        execute(cur,'SELECT nhom_ma::text id FROM {xu_ly_mac_dinh} WHERE ht_ma=%s',(ticket['type_id'],));default=cur.fetchone()
        ticket['routing_warning']='Loại hiện tại có nhóm mặc định khác hoặc chưa cấu hình. Giữ nguyên nhóm/người phụ trách; liên hệ Quản lý để điều phối khác nhóm.' if ticket['assigned_id'] and (not default or default['id']!=ticket['group_id']) else None
        return ticket


def send_message(user_id,ticket_id,body):
    with staff_cursor(user_id,mutation=True) as cur:
        processor(cur,user_id,ticket_id)
        execute(cur,'INSERT INTO {tin_nhan}(phieu_ma,nguoi_gui_ma,noi_dung,la_ghi_chu_noi_bo) VALUES(%s,%s,%s,%s) RETURNING tn_ma::text id',(ticket_id,user_id,body.content,body.internal));result=cur.fetchone()
        execute(cur,'UPDATE {phieu_ho_tro} SET ngay_cap_nhat=now(),ngay_phan_hoi_dau=CASE WHEN %s THEN ngay_phan_hoi_dau ELSE COALESCE(ngay_phan_hoi_dau,now()) END WHERE phieu_ma=%s',(body.internal,ticket_id))
        return result


def upload_attachment(user_id,ticket_id,name,declared_mime,content):
    path=None;created=False
    try:
        with staff_cursor(user_id,mutation=True) as cur:
            # A staff creator may attach while this newly created ticket is still unassigned.
            lock_operations(cur)
            execute(cur,'SELECT nguoi_lap_ma,nhan_vien_phu_trach_ma,t.ma FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma) WHERE phieu_ma=%s FOR UPDATE OF p',(ticket_id,));ticket=cur.fetchone()
            creator=ticket and str(ticket['nguoi_lap_ma'])==str(user_id) and ticket['nhan_vien_phu_trach_ma'] is None and ticket['ma']=='MOI'
            if not creator: processor(cur,user_id,ticket_id)
            extension,mime=validate_file(name,declared_mime,content)
            execute(cur,'SELECT count(*) n FROM {tep_dinh_kem} WHERE phieu_ma=%s',(ticket_id,))
            if cur.fetchone()['n']>=20:raise HTTPException(409,'Mỗi phiếu tối đa 20 tệp.')
            key=secrets.token_hex(16)+extension;path=safe_path(key)
            with path.open('xb') as out:created=True;out.write(content)
            return customer.insert_attachment(cur,ticket_id,user_id,name,key,mime,len(content))
    except BaseException:
        if created and path:path.unlink(missing_ok=True)
        raise


def download_attachment(user_id,ticket_id,attachment_id):
    with staff_cursor(user_id) as cur:
        row(cur,user_id,ticket_id)
        execute(cur,'SELECT ten,duong_dan FROM {tep_dinh_kem} WHERE phieu_ma=%s AND tep_ma=%s',(ticket_id,attachment_id));record=cur.fetchone()
        if record is None:raise HTTPException(404,'Không tìm thấy tệp.')
        path=safe_path(record['duong_dan'])
        if not path.is_file():raise HTTPException(404,'Không tìm thấy tệp.')
        return path,record['ten']
