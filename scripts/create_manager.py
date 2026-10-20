"""Explicit, manual account creation. No default credentials or automatic seeding."""
import argparse
import getpass
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import psycopg
from psycopg import sql
from core.database import ConfigurationError, database_schema, get_connection
from core.security import PASSWORD_HASHER
from services.auth_service import account_table


def main():
    parser = argparse.ArgumentParser(description="Tạo tài khoản Quản lý khi được yêu cầu.")
    parser.add_argument("--execute", action="store_true", help="Xác nhận ghi tài khoản mới vào CSDL đã cấu hình.")
    args = parser.parse_args()
    if not args.execute:
        parser.error("Chưa ghi dữ liệu. Chỉ thêm --execute khi bạn chủ động muốn tạo tài khoản.")
    name = os.getenv("MANAGER_NAME") or input("Họ tên: ").strip()
    email = (os.getenv("MANAGER_EMAIL") or input("Email: ")).strip()
    password = os.getenv("MANAGER_PASSWORD") or getpass.getpass("Mật khẩu (không hiển thị): ")
    if not name or len(name) > 100 or len(email) > 150 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("Họ tên/email không hợp lệ.")
    if len(password) < 12 or len(password) > 1024:
        raise ValueError("Mật khẩu cần từ 12 đến 1024 ký tự.")
    with get_connection() as conn:
        table = account_table(conn)
        with conn.cursor() as cur:
            # Xác minh cả bảng phụ trước khi INSERT; lỗi sẽ rollback toàn transaction.
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND table_name=%s", (database_schema(), "quan_tri_vien"))
            if "nd_ma" not in {row[0] for row in cur.fetchall()}:
                raise ConfigurationError("Thiếu bảng phụ của vai trò Quản lý theo SQL tham chiếu.")
            cur.execute(sql.SQL("INSERT INTO {} (ho_ten,email,mat_khau_hash,vai_tro,trang_thai) VALUES (%s,%s,%s,%s,%s) RETURNING nd_ma").format(table),
                        (name, email, PASSWORD_HASHER.hash(password), "QUAN_TRI_VIEN", "HOAT_DONG"))
            user_id = cur.fetchone()[0]
            cur.execute(sql.SQL("INSERT INTO {} (nd_ma) VALUES (%s)").format(sql.Identifier(database_schema(), "quan_tri_vien")), (user_id,))
    print("Đã tạo tài khoản Quản lý. Không ghi log mật khẩu.")


if __name__ == "__main__":
    try:
        main()
    except psycopg.errors.UniqueViolation:
        print("Email đã tồn tại. Không thay đổi tài khoản cũ.")
        raise SystemExit(1)
    except (psycopg.Error, ConfigurationError):
        print("Không thể tạo tài khoản. Kiểm tra cấu hình/schema; transaction đã được rollback.")
        raise SystemExit(1)
    except ValueError as exc:
        print(str(exc))
        raise SystemExit(1)
