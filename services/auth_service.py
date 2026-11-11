from fastapi import HTTPException
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.errors import UniqueViolation

from core.database import ConfigurationError, database_schema, get_connection
from core.security import PASSWORD_HASHER, account_session_version, burn_password_check, verify_password
from schemas.auth import RegisterRequest, UserResponse


def register(body: RegisterRequest):
    encoded = PASSWORD_HASHER.hash(body.password)
    try:
        with get_connection() as conn:
            with conn.transaction():
                table = account_table(conn)
                with conn.cursor() as cur:
                    cur.execute(sql.SQL("INSERT INTO {} (ho_ten,email,so_dien_thoai,mat_khau_hash,vai_tro,trang_thai) VALUES (%s,%s,%s,%s,%s,%s) RETURNING nd_ma").format(table),
                                (body.name, body.email, body.phone, encoded, "KHACH_HANG", "HOAT_DONG"))
                    user_id = cur.fetchone()[0]
                    create_customer_profile(cur, user_id)
    except UniqueViolation as exc:
        raise HTTPException(409, "Email đã được đăng ký.") from exc


def create_customer_profile(cur, user_id):
    cur.execute(sql.SQL("INSERT INTO {} (nd_ma) VALUES (%s)").format(sql.Identifier(database_schema(), "khach_hang")), (user_id,))

ROLES = {
    "KHACH_HANG": ("customer", "Khách hàng"),
    "NHAN_VIEN": ("staff", "Nhân viên hỗ trợ"),
    "QUAN_TRI_VIEN": ("manager", "Quản lý"),
}


def account_table(conn):
    schema = database_schema()
    with conn.cursor() as cur:
        cur.execute("""SELECT column_name FROM information_schema.columns
                       WHERE table_schema = %s AND table_name = %s""", (schema, "nguoi_dung"))
        columns = {r[0] for r in cur.fetchall()}
    required = {"nd_ma", "ho_ten", "email", "mat_khau_hash", "vai_tro", "trang_thai", "ngay_cap_nhat"}
    if not required.issubset(columns):
        raise ConfigurationError("Chưa có bảng xác thực phù hợp trong DB_SCHEMA. Cần khởi tạo CSDL theo SQL đã được duyệt.")
    return sql.Identifier(schema, "nguoi_dung")


def find_account(*, email: str | None = None, user_id: str | None = None):
    with get_connection() as conn:
        table = account_table(conn)
        condition = sql.SQL("lower(email) = lower(%s)") if email is not None else sql.SQL("nd_ma = %s")
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql.SQL("SELECT nd_ma, ho_ten, email, mat_khau_hash, vai_tro, trang_thai, ngay_cap_nhat FROM {} WHERE {}").format(
                table, condition), (email.strip() if email is not None else user_id,))
            rows = cur.fetchmany(2)
            if len(rows) > 1:
                raise ConfigurationError("Định danh tài khoản chưa duy nhất; cần kiểm tra ràng buộc CSDL.")
            return rows[0] if rows else None


def public_user(account: dict) -> UserResponse:
    role = ROLES.get(str(account["vai_tro"]))
    if role is None:
        raise HTTPException(403, "Vai trò tài khoản không được hỗ trợ.")
    return UserResponse(id=str(account["nd_ma"]), name=account["ho_ten"], email=account["email"], role=role[0], role_label=role[1])


def login(email: str, password: str) -> tuple[UserResponse, str]:
    account = find_account(email=email)
    if account is None:
        burn_password_check(password)
        raise HTTPException(401, "Email hoặc mật khẩu không chính xác, hoặc tài khoản không hoạt động.")
    valid = verify_password(password, account["mat_khau_hash"])
    if not valid:
        raise HTTPException(401, "Email hoặc mật khẩu không chính xác, hoặc tài khoản không hoạt động.")
    if account["trang_thai"] == "KHOA":
        reason = active_lock_reason(account["nd_ma"])
        detail = "Tài khoản của bạn đã bị khóa."
        if reason:
            detail += f"\nLý do: {reason}"
        raise HTTPException(403, detail + "\nVui lòng liên hệ bộ phận quản lý để được hỗ trợ.")
    if account["trang_thai"] != "HOAT_DONG":
        raise HTTPException(401, "Email hoặc mật khẩu không chính xác, hoặc tài khoản không hoạt động.")
    return public_user(account), account_session_version(account["ngay_cap_nhat"])


def active_lock_reason(account_id):
    table = sql.Identifier(database_schema(), 'account_lock_event')
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT to_regclass(%s)', (table.as_string(cur),))
        if cur.fetchone()[0] is None:
            return None
        cur.execute(sql.SQL('SELECT reason FROM {} WHERE account_id=%s ORDER BY id DESC LIMIT 1').format(table), (account_id,))
        row = cur.fetchone()
        return row[0] if row else None


def current_user(user_id: str, account_version: str) -> UserResponse:
    if not user_id.isascii() or not user_id.isdecimal() or len(user_id) > 19 or int(user_id) > 9223372036854775807:
        raise HTTPException(401, "Phiên không hợp lệ.")
    account = find_account(user_id=user_id)
    if account is None or account["trang_thai"] != "HOAT_DONG":
        raise HTTPException(401, "Tài khoản không tồn tại hoặc không hoạt động.")
    if account_session_version(account["ngay_cap_nhat"]) != account_version:
        raise HTTPException(401, "Phiên đã hết hiệu lực. Vui lòng đăng nhập lại.")
    return public_user(account)
