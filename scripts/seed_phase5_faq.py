"""Preview by default. Opt-in approved FAQ seed, never overwrite/delete existing rows."""
import argparse
import re
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from core.database import get_connection,BASE_DIR
from services.faq_service import execute

def document():
    text=(BASE_DIR/'docs/references/01_FAQ_Noi_That_Phase5.md').read_text(encoding='utf-8')
    blocks=re.findall(r'\*\*(FAQ\d+)\. (.*?)\*\*\s*\nTrả lời gợi ý: (.*?)(?=\n\*\*FAQ|\n##|\Z)',text,re.S)
    rows=[]
    for code,question,tail in blocks:
        answer,category=tail.split('\nLoại:',1)
        caution=' Thông tin chính sách thương mại chưa được xác nhận; nhân viên cần kiểm tra trước khi cam kết.' if ('Cần chốt:' in category or 'cần chốt:' in category) else ''
        rows.append((question.strip(),(code+' '+re.sub(r'[*\n]','',category).split('.')[0])[:255],answer.strip()+caution))
    if len(rows)!=30 or any(len(r[0])>255 for r in rows):raise ValueError('Tài liệu FAQ thay đổi, cần kiểm tra lại trước khi seed.')
    return rows

def seed(cur,rows,apply=False):
    # No unique question index exists: serialize seed scripts without a migration.
    if apply:execute(cur,'LOCK TABLE {cau_hoi_mau} IN SHARE ROW EXCLUSIVE MODE')
    pending=[]
    for question,keywords,answer in rows:
        execute(cur,'SELECT ch_ma FROM {cau_hoi_mau} WHERE lower(btrim(noi_dung))=lower(btrim(%s))',(question,))
        if cur.fetchone() is None:
            pending.append(question)
            if apply:execute(cur,'INSERT INTO {cau_hoi_mau}(noi_dung,tu_khoa,cau_tra_loi,dang_hoat_dong) VALUES(%s,%s,%s,true)',(question,keywords,answer))
    return pending

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--approved',action='store_true');args=p.parse_args()
    if args.apply and not args.approved:p.error('Cần phê duyệt rõ ràng trước khi dùng --apply --approved.')
    rows=document()
    with get_connection() as conn,conn.transaction(),conn.cursor() as cur:
        pending=seed(cur,rows,args.apply)
        print(('Đã thêm' if args.apply else 'XEM TRƯỚC, chưa ghi DB')+f': {len(pending)} FAQ; giữ nguyên mọi FAQ hiện có, không ghi đè/xóa.')
        for question in pending:print('- '+question)
