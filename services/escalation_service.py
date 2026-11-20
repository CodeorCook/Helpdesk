"""Internal escalation requests; never messages, ticket states or auto assignment."""
from fastapi import HTTPException
from psycopg import sql
from psycopg.errors import UniqueViolation
from core.database import database_schema
from core.audit import record
from services import staff_service as staff

TABLE = 'yeu_cau_dieu_phoi_phieu'


def request_schema():
    return database_schema()


def execute(cur, statement, params=()):
    names = (*staff.TABLES, 'quan_tri_vien', TABLE)
    identifiers={t:sql.Identifier(database_schema(),t) for t in names}
    identifiers[TABLE]=sql.Identifier(request_schema(),TABLE)
    cur.execute(sql.SQL(statement).format(**identifiers),params)


def available(cur):
    cur.execute('SELECT to_regclass(%s) IS NOT NULL ok',
                (sql.Identifier(request_schema(),TABLE).as_string(cur),))
    return cur.fetchone()['ok']


def require_schema(cur):
    if not available(cur):
        raise HTTPException(503,'Cần áp dụng migration 007_ticket_escalation.sql để sử dụng điều phối khẩn.')


VIEW = '''SELECT e.yc_ma::text id,e.phieu_ma::text ticket_id,e.nhan_vien_gui_ma::text requester_id,
    a.ho_ten requester,e.nhom_gui_ma::text source_group_id,g.ten source_group,e.ly_do reason,
    e.ngay_gui created_at,e.trang_thai status,e.ngay_xu_ly handled_at,e.ghi_chu_xu_ly outcome,
    m.ho_ten manager,receiver.ho_ten assigned_to,result.nhan_vien_ma::text assigned_id,
    e.phan_cong_ket_qua_ma::text result_assignment_id
    FROM {yeu_cau_dieu_phoi_phieu} e JOIN {nguoi_dung} a ON a.nd_ma=e.nhan_vien_gui_ma
    JOIN {nhom_ho_tro} g ON g.nhom_ma=e.nhom_gui_ma
    LEFT JOIN {nguoi_dung} m ON m.nd_ma=e.quan_ly_xu_ly_ma
    LEFT JOIN {lich_su_phan_cong} result ON result.pc_ma=e.phan_cong_ket_qua_ma
    LEFT JOIN {nguoi_dung} receiver ON receiver.nd_ma=result.nhan_vien_ma'''


def history(cur,ticket_id,requester=None):
    if not available(cur):return []
    where=' WHERE e.phieu_ma=%s'
    params=[ticket_id]
    if requester is not None:
        where+=' AND e.nhan_vien_gui_ma=%s';params.append(requester)
    # A bounded history; newest outcomes first, never load public chat bodies.
    execute(cur,VIEW+where+' ORDER BY e.yc_ma DESC LIMIT 50',params)
    return cur.fetchall()


def pending(cur,ticket_id,lock=False):
    if not available(cur):return None
    execute(cur,"SELECT yc_ma,nhan_vien_gui_ma FROM {yeu_cau_dieu_phoi_phieu} WHERE phieu_ma=%s AND trang_thai='CHO_XU_LY'"+(' FOR UPDATE' if lock else ''),(ticket_id,))
    return cur.fetchone()


def request(actor,ticket_id,body):
    try:return create_request(actor,ticket_id,body)
    except UniqueViolation as exc:
        raise HTTPException(409,'Phiếu đang có yêu cầu điều phối chờ xử lý.') from exc


def create_request(actor,ticket_id,body):
    with staff.staff_cursor(actor,mutation=True) as cur:
        require_schema(cur)
        ticket,assignment=staff.processor(cur,actor,ticket_id)
        if ticket.get('sla_phase')=='provisional':
            raise HTTPException(409,'Phiếu chưa hoàn tất bước xét duyệt; không gửi điều phối khẩn từ yêu cầu tạm tính.')
        if ticket['updated_at']!=body.expected_updated_at:
            raise HTTPException(409,'Phiếu đã thay đổi. Hãy tải lại trước khi gửi.')
        if pending(cur,ticket_id,True):raise HTTPException(409,'Phiếu đang có yêu cầu điều phối chờ xử lý.')
        execute(cur,'''INSERT INTO {yeu_cau_dieu_phoi_phieu}
            (phieu_ma,nhan_vien_gui_ma,nhom_gui_ma,phan_cong_gui_ma,ly_do)
            VALUES(%s,%s,%s,%s,%s)''',(ticket_id,actor,ticket['group_id'],assignment['pc_ma'],body.reason))
        result=history(cur,ticket_id)
    record(actor,'escalation.request',ticket_id)
    return result[0]


def staff_history(actor,ticket_id):
    with staff.staff_cursor(actor) as cur:
        require_schema(cur)
        execute(cur,'SELECT nhan_vien_phu_trach_ma FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket_id,))
        row=cur.fetchone()
        if not row:raise HTTPException(404,'Không tìm thấy yêu cầu điều phối.')
        result=history(cur,ticket_id,None if str(row['nhan_vien_phu_trach_ma'])==str(actor) else actor)
        if not result and str(row['nhan_vien_phu_trach_ma'])!=str(actor):
            raise HTTPException(404,'Không tìm thấy yêu cầu điều phối.')
        return result


def finish(cur,request_id,actor,note,assignment_id=None):
    execute(cur,'''UPDATE {yeu_cau_dieu_phoi_phieu} SET trang_thai=%s,quan_ly_xu_ly_ma=%s,
        ngay_xu_ly=clock_timestamp(),ghi_chu_xu_ly=%s,phan_cong_ket_qua_ma=%s
        WHERE yc_ma=%s AND trang_thai='CHO_XU_LY' RETURNING yc_ma''',
        ('DA_DIEU_PHOI' if assignment_id else 'TU_CHOI',actor,note,assignment_id,request_id))
    if cur.fetchone() is None:raise HTTPException(409,'Yêu cầu điều phối đã được xử lý.')


def reject(actor,ticket_id,request_id,body):
    from services import manager_service as manager
    with manager.manager_cursor(actor,True) as (cur,events):
        require_schema(cur)
        ticket=manager.ticket_row(cur,ticket_id,True)
        manager.check_version(ticket,body.expected_updated_at)
        current=pending(cur,ticket_id,True)
        if not current or str(current['yc_ma'])!=str(request_id):
            raise HTTPException(409,'Yêu cầu điều phối đã thay đổi. Hãy tải lại.')
        finish(cur,request_id,actor,body.reason)
        events.append(('escalation.reject',request_id))
        return {'message':'Đã từ chối điều phối; người phụ trách và SLA được giữ nguyên.'}


def enrich_manager(cur,rows):
    if not rows or not available(cur):return
    execute(cur,VIEW+" WHERE e.phieu_ma=ANY(%s::bigint[]) AND e.trang_thai='CHO_XU_LY'",([r['id'] for r in rows],))
    requests={r['ticket_id']:r for r in cur.fetchall()}
    for row in rows:row['pending_escalation']=requests.get(row['id'])
