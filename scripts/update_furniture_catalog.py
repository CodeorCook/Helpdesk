"""Preview/apply an explicitly approved catalog plan. No schema changes/deletes."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.database import database_schema, get_connection
from psycopg.rows import dict_row

DESIRED = [
    ("Tư vấn sản phẩm nội thất", "Tư vấn lựa chọn, kích thước, chất liệu và cách sử dụng sản phẩm nội thất."),
    ("Hỗ trợ đơn hàng", "Giải đáp thông tin và tiếp nhận vấn đề liên quan đến đơn hàng nội thất."),
    ("Giao hàng và lắp đặt", "Hỗ trợ lịch giao hàng, tình trạng giao nhận và vấn đề lắp đặt nội thất."),
    ("Bảo hành sản phẩm", "Tiếp nhận yêu cầu kiểm tra điều kiện và hỗ trợ bảo hành sản phẩm nội thất."),
    ("Sửa chữa và bảo trì", "Tiếp nhận yêu cầu sửa chữa, bảo trì và hướng dẫn bảo quản nội thất."),
    ("Đổi trả sản phẩm", "Tiếp nhận yêu cầu đổi trả sản phẩm để đội ngũ hỗ trợ xem xét theo chính sách áp dụng."),
    ("Khiếu nại chất lượng", "Tiếp nhận phản ánh về chất lượng sản phẩm nội thất và dịch vụ liên quan."),
    ("Thanh toán và hóa đơn", "Giải đáp vấn đề thanh toán và hỗ trợ thông tin hóa đơn."),
]
RENAMES = {"Thanh toán": "Thanh toán và hóa đơn", "Khiếu nại": "Khiếu nại chất lượng"}
LEGACY = {"Tài khoản", "Kỹ thuật", "Khác"}


def snapshot(conn):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT current_database() AS name")
        if cur.fetchone()["name"] != "DB_HELPDESK" or database_schema() != "helpdesk":
            raise RuntimeError("Chỉ hỗ trợ DB_HELPDESK/schema helpdesk; dừng để tránh sửa nhầm.")
        cur.execute("""SELECT l.ht_ma AS id,l.ten AS name,l.mo_ta AS description,l.dang_hoat_dong AS active,
            (SELECT count(*) FROM helpdesk.phieu_ho_tro p WHERE p.ht_ma=l.ht_ma) AS tickets,
            (SELECT count(*) FROM helpdesk.xu_ly_mac_dinh x WHERE x.ht_ma=l.ht_ma) AS routing
            FROM helpdesk.loai_ho_tro l ORDER BY l.ht_ma""")
        return cur.fetchall()


def build_plan(rows):
    by_name = {row["name"]: row for row in rows}
    operations = []
    for name, description in DESIRED:
        row = by_name.get(name)
        if row is None:
            previous = next((old for old, new in RENAMES.items() if new == name), None)
            candidate = by_name.get(previous)
            # Never relabel a category already used by a ticket/routing rule.
            row = candidate if candidate and not candidate["tickets"] and not candidate["routing"] else None
        if row is None:
            operations.append({"action":"insert", "name":name, "description":description})
        elif (row["name"], row["description"], row["active"]) != (name, description, True):
            operations.append({"action":"update", "id":row["id"], "previous":row["name"], "name":name, "description":description, "active":True})
    for row in rows:
        if row["name"] in LEGACY and row["active"]:
            operations.append({"action":"deactivate", "id":row["id"], "name":row["name"]})
    return operations


def plan_digest(rows, operations):
    return hashlib.sha256(json.dumps({"rows":rows,"operations":operations},ensure_ascii=False,sort_keys=True).encode()).hexdigest()


def apply_plan(conn, operations):
    with conn.cursor() as cur:
        for item in operations:
            if item["action"] == "insert":
                cur.execute("INSERT INTO helpdesk.loai_ho_tro (ten,mo_ta,dang_hoat_dong) VALUES (%s,%s,true)", (item["name"],item["description"]))
            elif item["action"] == "update":
                cur.execute("UPDATE helpdesk.loai_ho_tro SET ten=%s,mo_ta=%s,dang_hoat_dong=true WHERE ht_ma=%s", (item["name"],item["description"],item["id"]))
            else:
                cur.execute("UPDATE helpdesk.loai_ho_tro SET dang_hoat_dong=false WHERE ht_ma=%s", (item["id"],))


def main():
    parser = argparse.ArgumentParser(description="Xem trước danh mục nội thất; chỉ ghi theo plan đã được duyệt.")
    parser.add_argument("--execute",action="store_true")
    parser.add_argument("--expect-plan",help="SHA-256 của preview đã duyệt; bắt buộc khi --execute.")
    args = parser.parse_args()
    if args.execute and not args.expect_plan:
        parser.error("Cần --expect-plan từ preview đã được duyệt. Chưa ghi dữ liệu.")
    with get_connection() as conn:
        if not args.execute:
            conn.read_only = True
        with conn.transaction():
            if args.execute:
                conn.execute("SET LOCAL lock_timeout = '3s'")
                conn.execute("LOCK TABLE helpdesk.loai_ho_tro IN SHARE ROW EXCLUSIVE MODE")
                conn.execute("LOCK TABLE helpdesk.phieu_ho_tro,helpdesk.xu_ly_mac_dinh IN SHARE MODE")
            rows = snapshot(conn)
            operations = build_plan(rows)
            digest = plan_digest(rows,operations)
            print(json.dumps({"snapshot":rows,"operations":operations,"plan_sha256":digest},ensure_ascii=False,indent=2))
            if args.execute:
                if operations and digest != args.expect_plan:
                    raise RuntimeError("Dữ liệu/ảnh hưởng đã đổi so với preview. Rollback; cần xem và duyệt plan mới.")
                apply_plan(conn,operations)
                if build_plan(snapshot(conn)):
                    raise RuntimeError("Hậu kiểm chưa đạt; rollback toàn bộ.")
    if not args.execute:
        print("CHỈ XEM TRƯỚC — chưa thay đổi dữ liệu.")
    else:
        print("Đã áp dụng và commit." if operations else "Không còn thay đổi cần áp dụng; không ghi dữ liệu.")


if __name__ == "__main__":
    main()
