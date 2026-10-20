"""Manual initialization from the supplied SQL, only for an empty application DB."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.database import BASE_DIR, get_connection


def main():
    parser = argparse.ArgumentParser(description="Khởi tạo DB_HELPDESK bằng SQL tham chiếu sau khi được đồng ý.")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if not args.execute:
        parser.error("Cần --execute để xác nhận khởi tạo; mặc định không thay đổi database.")
    source = (BASE_DIR / "docs" / "CSDL_Helpdesk.sql").read_text(encoding="utf-8-sig")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            if cur.fetchone()[0] != "DB_HELPDESK":
                raise RuntimeError("Sai database đích; dừng khởi tạo.")
            cur.execute("""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
                AND c.relkind IN ('r','p','v','m','S','f')""")
            if cur.fetchone()[0]:
                raise RuntimeError("Database đã có đối tượng ứng dụng; không tự chạy lại hoặc ghi đè.")
            cur.execute("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='helpdesk'""")
            if cur.fetchone()[0]:
                raise RuntimeError("Schema helpdesk đã có hàm; cần kiểm tra thủ công.")
        conn.commit()
        # SQL được cung cấp đã bao gồm BEGIN/COMMIT; không sửa nội dung file.
        conn.execute(source)
    print("Đã chạy SQL khởi tạo. Chưa tạo tài khoản.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        if isinstance(exc, RuntimeError):
            print(str(exc))
        else:
            print("Khởi tạo không thành công. Kiểm tra kết nối và SQL trong DBeaver; không tự xóa schema.")
        raise SystemExit(1)
