"""Read-only database metadata inspection; never prints credentials or hashes."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.database import get_connection


def inspect():
    with get_connection() as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            for label, statement in [
                ("Database", "SELECT current_database()"),
                ("Tables", """SELECT table_schema, table_name FROM information_schema.tables
                    WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = 'BASE TABLE' ORDER BY 1,2"""),
                ("Account columns", """SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns WHERE table_name IN ('nguoi_dung','khach_hang','nhan_vien','quan_tri_vien') ORDER BY 1,2,ordinal_position"""),
                ("Constraints", """SELECT n.nspname, c.relname, pg_get_constraintdef(p.oid)
                    FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE c.relname IN ('nguoi_dung','khach_hang','nhan_vien','quan_tri_vien') ORDER BY 1,2"""),
            ]:
                cur.execute(statement)
                print(label, cur.fetchall())


if __name__ == "__main__":
    try:
        inspect()
    except Exception:
        print("Không thể đọc metadata PostgreSQL. Kiểm tra cấu hình và quyền kết nối.")
        raise SystemExit(1)
