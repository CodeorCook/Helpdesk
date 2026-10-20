from contextlib import contextmanager
from datetime import datetime, time, timedelta, timezone
import os
import secrets

from fastapi import HTTPException
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.errors import UniqueViolation

from core.database import ConfigurationError, database_schema, get_connection
from core.uploads import safe_path, validate_file
from schemas.customer import TicketCreate
from core.sla import attach_sla

TABLES = ("nguoi_dung", "khach_hang", "phieu_ho_tro", "loai_ho_tro", "muc_do_uu_tien", "trang_thai", "lich_su_trang_thai", "tin_nhan", "tep_dinh_kem", "danh_gia")


def execute(cur, statement, params=()):
    identifiers = {name: sql.Identifier(database_schema(), name) for name in TABLES}
    cur.execute(sql.SQL(statement).format(**identifiers), params)


@contextmanager
def customer_cursor(user_id,lock_user=False):
    with get_connection() as conn:
        with conn.transaction():
            with conn.cursor(row_factory=dict_row) as cur:
                execute(cur, "SELECT k.nd_ma FROM {khach_hang} k JOIN {nguoi_dung} n USING(nd_ma) WHERE k.nd_ma=%s AND n.vai_tro='KHACH_HANG' AND n.trang_thai='HOAT_DONG' "+('FOR UPDATE OF n' if lock_user else 'FOR SHARE OF n'), (user_id,))
                if cur.fetchone() is None:
                    raise HTTPException(409, "Tài khoản thiếu hồ sơ Khách hàng hoặc không còn hoạt động đúng vai trò. Vui lòng làm mới hoặc liên hệ Quản lý.")
                yield cur


TICKET_VIEW = """SELECT p.phieu_ma::text AS id,p.tieu_de AS title,p.mo_ta AS description,
    p.ht_ma::text AS type_id,l.ten AS type_name,t.ma AS status,t.ten AS status_label,u.ten AS priority,
    p.ngay_tao AS created_at,p.ngay_cap_nhat AS updated_at,p.ngay_dong AS closed_at,n.ho_ten AS assigned_to
    FROM {phieu_ho_tro} p JOIN {trang_thai} t ON t.tt_ma=p.tt_ma
    JOIN {muc_do_uu_tien} u ON u.mdut_ma=p.mdut_ma LEFT JOIN {loai_ho_tro} l ON l.ht_ma=p.ht_ma
    LEFT JOIN {nguoi_dung} n ON n.nd_ma=p.nhan_vien_phu_trach_ma """


def ticket_row(cur, user_id, ticket_id):
    execute(cur, TICKET_VIEW + " WHERE p.phieu_ma=%s AND p.khach_hang_ma=%s", (ticket_id, user_id))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Không tìm thấy phiếu hỗ trợ.")
    return row


def catalog(user_id, kind):
    with customer_cursor(user_id) as cur:
        if kind == "types":
            execute(cur, "SELECT ht_ma::text AS id,ten AS name FROM {loai_ho_tro} WHERE dang_hoat_dong ORDER BY ht_ma")
        else:
            execute(cur, "SELECT tt_ma::text AS id,ten AS name,ma AS code FROM {trang_thai} ORDER BY tt_ma")
        return cur.fetchall()


def create_ticket(user_id, body: TicketCreate):
    with customer_cursor(user_id) as cur:
        execute(cur, "SELECT ht_ma FROM {loai_ho_tro} WHERE ht_ma=%s AND dang_hoat_dong FOR SHARE", (body.type_id,))
        if cur.fetchone() is None:
            raise HTTPException(422, "Loại hỗ trợ không hợp lệ hoặc đã ngừng sử dụng.")
        try:
            order = int(os.getenv("DEFAULT_PRIORITY_ORDER", "2"))
        except ValueError as exc:
            raise ConfigurationError("DEFAULT_PRIORITY_ORDER phải là số thứ tự ưu tiên hợp lệ.") from exc
        execute(cur, "SELECT mdut_ma FROM {muc_do_uu_tien} WHERE thu_tu=%s", (order,))
        priority = cur.fetchone()
        if priority is None:
            raise ConfigurationError("Thiếu mức ưu tiên mặc định trong danh mục.")
        execute(cur, "SELECT tt_ma FROM {trang_thai} WHERE ma=%s", ("MOI",))
        status = cur.fetchone()
        if status is None:
            raise ConfigurationError("Thiếu trạng thái MOI trong danh mục.")
        execute(cur, """INSERT INTO {phieu_ho_tro} (khach_hang_ma,nguon_tao,mdut_ma,ht_ma,tt_ma,tieu_de,mo_ta)
            VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING phieu_ma""",
            (user_id, "KHACH_HANG", priority["mdut_ma"], body.type_id, status["tt_ma"], body.title, body.description))
        ticket_id = cur.fetchone()["phieu_ma"]
        add_history(cur, ticket_id, None, status["tt_ma"], user_id)
        attach_sla(cur,ticket_id)
        return ticket_row(cur, user_id, ticket_id)


def add_history(cur, ticket_id, old_status, new_status, user_id):
    execute(cur, """INSERT INTO {lich_su_trang_thai} (phieu_ma,tt_cu_ma,tt_moi_ma,nguoi_thay_doi_ma)
        VALUES (%s,%s,%s,%s)""", (ticket_id, old_status, new_status, user_id))


def overview(user_id):
    with customer_cursor(user_id) as cur:
        execute(cur, """SELECT count(*) AS total,
            count(*) FILTER(WHERE t.ma IN ('MOI','DANG_XU_LY','TAM_DUNG')) AS active,
            count(*) FILTER(WHERE t.ma='DA_GIAI_QUYET') AS resolved,
            count(*) FILTER(WHERE t.ma='DA_DONG') AS closed
            FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma) WHERE p.khach_hang_ma=%s""", (user_id,))
        return cur.fetchone()


def list_tickets(user_id, search, type_id, status, from_date, to_date, page, page_size):
    if from_date and to_date and from_date > to_date:
        raise HTTPException(422, "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.")
    conditions = ["p.khach_hang_ma=%s"]
    params = [user_id]
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append("p.tieu_de ILIKE %s")
        params.append("%" + escaped + "%")
    if type_id is not None:
        conditions.append("p.ht_ma=%s")
        params.append(type_id)
    if status:
        conditions.append("t.ma=%s")
        params.append(status)
    vn = timezone(timedelta(hours=7))
    if from_date:
        conditions.append("p.ngay_tao >= %s")
        params.append(datetime.combine(from_date, time.min, vn))
    if to_date:
        conditions.append("p.ngay_tao < %s")
        params.append(datetime.combine(to_date, time.min, vn) + timedelta(days=1))
    where = " WHERE " + " AND ".join(conditions)
    with customer_cursor(user_id) as cur:
        execute(cur, "SELECT count(*) AS count FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma)" + where, params)
        count = cur.fetchone()["count"]
        execute(cur, TICKET_VIEW + where + " ORDER BY p.ngay_cap_nhat DESC,p.phieu_ma DESC LIMIT %s OFFSET %s", params + [page_size, (page-1)*page_size])
        return {"items":cur.fetchall(), "total":count, "page":page, "page_size":page_size}


def detail(user_id, ticket_id):
    with customer_cursor(user_id) as cur:
        ticket = ticket_row(cur, user_id, ticket_id)
        execute(cur, """SELECT m.tn_ma::text AS id,m.noi_dung AS content,n.ho_ten AS sender,
            m.nguoi_gui_ma=%s AS from_customer,m.thoi_gian AS created_at
            FROM {tin_nhan} m JOIN {nguoi_dung} n ON n.nd_ma=m.nguoi_gui_ma
            WHERE m.phieu_ma=%s AND m.la_ghi_chu_noi_bo=false ORDER BY m.thoi_gian DESC,m.tn_ma DESC LIMIT 201""", (user_id, ticket_id))
        messages = cur.fetchall()
        ticket["messages_truncated"] = len(messages)>200
        ticket["messages"] = list(reversed(messages[:200]))
        execute(cur, """SELECT tep_ma::text AS id,ten AS name,mime_type,kich_thuoc_byte AS size,ngay_tai_len AS created_at
            FROM {tep_dinh_kem} WHERE phieu_ma=%s ORDER BY tep_ma""", (ticket_id,))
        ticket["attachments"] = cur.fetchall()
        execute(cur, """SELECT old.ten AS previous,new.ten AS current,h.thoi_diem AS created_at
            FROM {lich_su_trang_thai} h LEFT JOIN {trang_thai} old ON old.tt_ma=h.tt_cu_ma
            JOIN {trang_thai} new ON new.tt_ma=h.tt_moi_ma WHERE h.phieu_ma=%s ORDER BY h.thoi_diem,h.ls_ma""", (ticket_id,))
        ticket["history"] = cur.fetchall()
        execute(cur, "SELECT so_sao AS stars,nhan_xet AS comment,ngay_tao AS created_at FROM {danh_gia} WHERE phieu_ma=%s AND khach_hang_ma=%s", (ticket_id,user_id))
        ticket["rating"] = cur.fetchone()
        return ticket


def locked_ticket(cur, user_id, ticket_id):
    execute(cur, """SELECT p.phieu_ma,p.tt_ma,t.ma FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma)
        WHERE p.phieu_ma=%s AND p.khach_hang_ma=%s FOR UPDATE OF p""", (ticket_id,user_id))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Không tìm thấy phiếu hỗ trợ.")
    return row


def require_interactive(ticket):
    if ticket["ma"] not in ("MOI", "DANG_XU_LY", "TAM_DUNG"):
        raise HTTPException(409, "Phiếu đã giải quyết hoặc kết thúc; không thể thêm trao đổi hay tệp.")


def send_message(user_id, ticket_id, body):
    with customer_cursor(user_id) as cur:
        require_interactive(locked_ticket(cur,user_id,ticket_id))
        execute(cur,"""INSERT INTO {tin_nhan} (phieu_ma,nguoi_gui_ma,noi_dung,la_ghi_chu_noi_bo)
            VALUES (%s,%s,%s,false) RETURNING tn_ma::text AS id,noi_dung AS content,thoi_gian AS created_at""", (ticket_id,user_id,body.content))
        message = cur.fetchone()
        execute(cur, "SELECT ho_ten FROM {nguoi_dung} WHERE nd_ma=%s", (user_id,))
        message.update(sender=cur.fetchone()["ho_ten"],from_customer=True)
        execute(cur, "UPDATE {phieu_ho_tro} SET ngay_cap_nhat=now() WHERE phieu_ma=%s", (ticket_id,))
        return message


def insert_attachment(cur, ticket_id, user_id, name, key, mime, size):
    execute(cur,"""INSERT INTO {tep_dinh_kem} (phieu_ma,nguoi_tai_len_ma,ten,duong_dan,mime_type,kich_thuoc_byte)
        VALUES (%s,%s,%s,%s,%s,%s) RETURNING tep_ma::text AS id,ten AS name,mime_type,kich_thuoc_byte AS size,ngay_tai_len AS created_at""", (ticket_id,user_id,name,key,mime,size))
    return cur.fetchone()


def upload_attachment(user_id, ticket_id, name, declared_mime, content):
    path = None
    created = False
    try:
        with customer_cursor(user_id) as cur:
            require_interactive(locked_ticket(cur,user_id,ticket_id))
            extension,mime = validate_file(name,declared_mime,content)
            execute(cur, "SELECT count(*) AS count FROM {tep_dinh_kem} WHERE phieu_ma=%s", (ticket_id,))
            if cur.fetchone()["count"] >= 20:
                raise HTTPException(409, "Mỗi phiếu được đính kèm tối đa 20 tệp.")
            key = secrets.token_hex(16)+extension
            path = safe_path(key)
            with path.open("xb") as output:
                created = True
                output.write(content)
            return insert_attachment(cur,ticket_id,user_id,name,key,mime,len(content))
    except BaseException:
        if created and path is not None:
            path.unlink(missing_ok=True)
        raise


def download_attachment(user_id, ticket_id, attachment_id):
    with customer_cursor(user_id) as cur:
        ticket_row(cur,user_id,ticket_id)
        execute(cur,"SELECT ten,duong_dan FROM {tep_dinh_kem} WHERE tep_ma=%s AND phieu_ma=%s", (attachment_id,ticket_id))
        record = cur.fetchone()
        if record is None:
            raise HTTPException(404, "Không tìm thấy tệp.")
        path = safe_path(record["duong_dan"])
        if not path.is_file():
            raise HTTPException(404, "Không tìm thấy tệp.")
        return path, record["ten"]


def close_ticket(user_id, ticket_id, body):
    with customer_cursor(user_id) as cur:
        ticket = locked_ticket(cur,user_id,ticket_id)
        if ticket["ma"] != "DA_GIAI_QUYET":
            raise HTTPException(409, "Chỉ được xác nhận đóng phiếu đã giải quyết.")
        execute(cur, "SELECT tt_ma FROM {trang_thai} WHERE ma=%s", ("DA_DONG",))
        target = cur.fetchone()
        if target is None:
            raise ConfigurationError("Thiếu trạng thái DA_DONG trong danh mục.")
        execute(cur, "UPDATE {phieu_ho_tro} SET tt_ma=%s,ngay_dong=now(),ly_do_dong=%s WHERE phieu_ma=%s",
                (target["tt_ma"],body.reason,ticket_id))
        add_history(cur,ticket_id,ticket["tt_ma"],target["tt_ma"],user_id)
        return ticket_row(cur,user_id,ticket_id)


def rate_ticket(user_id, ticket_id, body):
    try:
        with customer_cursor(user_id) as cur:
            ticket = locked_ticket(cur,user_id,ticket_id)
            if ticket["ma"] != "DA_DONG":
                raise HTTPException(409, "Bạn chỉ có thể đánh giá sau khi đã xác nhận đóng phiếu.")
            execute(cur,"""INSERT INTO {danh_gia} (phieu_ma,khach_hang_ma,so_sao,nhan_xet) VALUES (%s,%s,%s,%s)
                RETURNING so_sao AS stars,nhan_xet AS comment,ngay_tao AS created_at""", (ticket_id,user_id,body.stars,body.comment))
            return cur.fetchone()
    except UniqueViolation as exc:
        raise HTTPException(409, "Phiếu này đã được đánh giá. Không thể gửi đánh giá lần hai.") from exc


def profile(user_id):
    with customer_cursor(user_id) as cur:
        execute(cur,"SELECT ho_ten AS name,email,so_dien_thoai AS phone,gioi_tinh AS gender FROM {nguoi_dung} WHERE nd_ma=%s", (user_id,))
        return cur.fetchone()


def update_profile(user_id, body):
    values = body.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(422, "Chọn thông tin hồ sơ cần cập nhật.")
    columns = {"name":"ho_ten", "phone":"so_dien_thoai", "gender":"gioi_tinh"}
    assignments = [sql.SQL("{}=%s").format(sql.Identifier(columns[key])) for key in values]
    with customer_cursor(user_id,lock_user=True) as cur:
        query = sql.SQL("UPDATE {} SET {},ngay_cap_nhat=now() WHERE nd_ma=%s RETURNING ho_ten AS name,email,so_dien_thoai AS phone,gioi_tinh AS gender").format(
            sql.Identifier(database_schema(),"nguoi_dung"),sql.SQL(",").join(assignments))
        cur.execute(query,[*values.values(),user_id])
        return cur.fetchone()
