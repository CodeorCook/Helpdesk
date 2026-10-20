"""Preview by default. Run --apply only after explicit approval of docs/PHASE3_GROUP_SETUP.md."""
import argparse
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from psycopg.rows import dict_row
from core.database import get_connection
from services.staff_service import execute

PLAN={
 'Tư vấn và đơn hàng':['Tư vấn sản phẩm nội thất','Hỗ trợ đơn hàng','Thanh toán và hóa đơn'],
 'Giao hàng và lắp đặt':['Giao hàng và lắp đặt'],
 'Bảo hành và bảo trì':['Bảo hành sản phẩm','Sửa chữa và bảo trì'],
 'Chất lượng và đổi trả':['Khiếu nại chất lượng','Đổi trả sản phẩm'],
}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    with get_connection() as conn,conn.transaction(),conn.cursor(row_factory=dict_row) as cur:
        if args.apply:cur.execute('SELECT pg_advisory_xact_lock(%s)',(713032026,))
        records=[]
        for name,types in PLAN.items():
            execute(cur,'SELECT nhom_ma,dang_hoat_dong FROM {nhom_ho_tro} WHERE ten=%s',(name,));group=cur.fetchone()
            if group and not group['dang_hoat_dong']:raise RuntimeError('Nhóm cùng tên đang ngừng hoạt động; cần Quản lý kiểm tra, không tự bật lại.')
            for kind in types:
                execute(cur,'''SELECT l.ht_ma,x.nhom_ma,g.ten group_name FROM {loai_ho_tro} l
                    LEFT JOIN {xu_ly_mac_dinh} x USING(ht_ma) LEFT JOIN {nhom_ho_tro} g ON g.nhom_ma=x.nhom_ma
                    WHERE l.ten=%s AND l.dang_hoat_dong''',(kind,));record=cur.fetchone()
                if not record:raise RuntimeError('Thiếu loại hoạt động: '+kind)
                if record['nhom_ma'] and record['group_name']!=name:raise RuntimeError('Đã có ánh xạ khác cho '+kind+'; dừng để bảo toàn cấu hình.')
                records.append((record['ht_ma'],kind,name))
        for ht,kind,name in records:
            print(f'{kind} -> {name}')
            if args.apply:
                execute(cur,'INSERT INTO {nhom_ho_tro}(ten) VALUES(%s) ON CONFLICT(ten) DO NOTHING',(name,))
                execute(cur,'SELECT nhom_ma FROM {nhom_ho_tro} WHERE ten=%s',(name,));gid=cur.fetchone()['nhom_ma']
                execute(cur,'INSERT INTO {xu_ly_mac_dinh}(ht_ma,nhom_ma) VALUES(%s,%s) ON CONFLICT(ht_ma) DO NOTHING',(ht,gid))
                execute(cur,'SELECT nhom_ma FROM {xu_ly_mac_dinh} WHERE ht_ma=%s',(ht,))
                if cur.fetchone()['nhom_ma']!=gid:raise RuntimeError('Cấu hình thay đổi đồng thời; rollback toàn bộ.')
        print('Đã áp dụng transaction; chạy lại không đổi cấu hình.' if args.apply else 'CHỈ XEM TRƯỚC: chưa ghi dữ liệu.')


if __name__=='__main__':main()
