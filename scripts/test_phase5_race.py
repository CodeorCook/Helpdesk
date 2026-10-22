"""Two independent PostgreSQL connections. Explicit opt-in fixture commit + exact-ID cleanup."""
import argparse,json,secrets,sys,threading
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from psycopg.rows import dict_row
from core.database import get_connection
from core.security import PASSWORD_HASHER
from services import customer_service,manager_service
from services.faq_service import execute
from scripts.test_phase5 import counts
from main import app

def main():
    p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');args=p.parse_args()
    if not args.execute:p.error('Cần --execute: chỉ commit fixture riêng để kiểm tra hai kết nối, dọn đúng ID, không reset sequence.')
    before=counts();prefix=secrets.token_hex(12);password=secrets.token_urlsafe(24)+'!9';email=f'phase5-race-{prefix}@example.com';uid=group=kind=sid=None
    try:
        with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
            manager_service.execute(cur,"INSERT INTO {nguoi_dung}(ho_ten,email,mat_khau_hash,vai_tro) VALUES(%s,%s,%s,'KHACH_HANG') RETURNING nd_ma",('Phase5 isolated race fixture',email,PASSWORD_HASHER.hash(password)));uid=cur.fetchone()['nd_ma']
            customer_service.execute(cur,'INSERT INTO {khach_hang}(nd_ma) VALUES(%s)',(uid,))
            manager_service.execute(cur,'INSERT INTO {nhom_ho_tro}(ten) VALUES(%s) RETURNING nhom_ma',('Phase5 race private '+prefix,));group=cur.fetchone()['nhom_ma']
            customer_service.execute(cur,'INSERT INTO {loai_ho_tro}(ten) VALUES(%s) RETURNING ht_ma',('Phase5 race private '+prefix,));kind=cur.fetchone()['ht_ma']
            manager_service.execute(cur,'INSERT INTO {xu_ly_mac_dinh}(ht_ma,nhom_ma) VALUES(%s,%s)',(kind,group))
            execute(cur,'INSERT INTO {phien_chat}(khach_hang_ma) VALUES(%s) RETURNING phien_chat_ma',(uid,));sid=cur.fetchone()['phien_chat_ma']
            envelope=dict(helpdesk_chatbot_v=1,answer='Bản nháp kiểm thử cô lập',draft=dict(title='Phase5 race '+prefix,description='Isolated race fixture',type_id=str(kind),missing_information=[],ready_for_confirmation=True),sources=[],collecting=True,offer_ticket=False)
            execute(cur,"INSERT INTO {tin_nhan_chatbot}(phien_chat_ma,nguoi_gui,noi_dung) VALUES(%s,'BOT',%s) RETURNING tncb_ma",(sid,json.dumps(envelope)));draft=cur.fetchone()['tncb_ma']
        a=TestClient(app);b=TestClient(app);origin={'Origin':'http://localhost:5173'};headers=[]
        for c in [a,b]:
            assert c.post('/api/v1/auth/login',json=dict(email=email,password=password),headers=origin).status_code==200
            headers.append({**origin,'X-CSRF-Token':c.get('/api/v1/auth/csrf').json()['csrf_token']})
        path=f'/api/v1/customer/chatbot/sessions/{sid}/confirm';body=dict(title='Phase5 race '+prefix,description='Isolated race fixture',type_id=kind,draft_message_id=draft,confirmed=True)
        entered=threading.Event();release=threading.Event();original=customer_service.add_history;out=[]
        def delay(cur,ticket,old,new,user):
            if str(user)==str(uid):entered.set();assert release.wait(8)
            return original(cur,ticket,old,new,user)
        def first():
            try:out.append(a.post(path,json=body,headers=headers[0]))
            except Exception as e:out.append(e)
        with patch.object(customer_service,'add_history',side_effect=delay):
            worker=threading.Thread(target=first);worker.start()
            try:
                assert entered.wait(8),'First request did not acquire session lock'
                conflict=b.post(path,json=body,headers=headers[1]);assert conflict.status_code==409,conflict.text
            finally:release.set();worker.join(10)
        assert not worker.is_alive() and len(out)==1
        if isinstance(out[0],Exception):raise out[0]
        assert out[0].status_code==200,out[0].text
        retry=b.post(path,json=body,headers=headers[1]);assert retry.status_code==200 and retry.json()['replayed'];ticket=retry.json()['ticket']['id']
        with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
            customer_service.execute(cur,'SELECT count(*) n FROM {phieu_ho_tro} WHERE khach_hang_ma=%s',(uid,));assert cur.fetchone()['n']==1
            customer_service.execute(cur,'SELECT count(*) n FROM {lich_su_trang_thai} WHERE phieu_ma=%s',(ticket,));assert cur.fetchone()['n']==1
            execute(cur,'SELECT phieu_ma FROM {phien_chat} WHERE phien_chat_ma=%s',(sid,));assert str(cur.fetchone()['phieu_ma'])==ticket
        print('PASS race: independent connections, one confirmation200, concurrent409, retry200/replayed, exactly one ticket/history/link. No Gemini call.')
    finally:
        with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
            if uid:
                customer_service.execute(cur,'SELECT email FROM {nguoi_dung} WHERE nd_ma=%s',(uid,));row=cur.fetchone()
                if row:
                    assert row['email']==email,'Refusing cleanup for an unrelated account'
                    execute(cur,'DELETE FROM {phien_chat} WHERE khach_hang_ma=%s',(uid,))
                    customer_service.execute(cur,'SELECT phieu_ma FROM {phieu_ho_tro} WHERE khach_hang_ma=%s',(uid,));tickets=[r['phieu_ma'] for r in cur.fetchall()]
                    for ticket in tickets:
                        manager_service.execute(cur,'DELETE FROM {lich_su_phan_cong} WHERE phieu_ma=%s',(ticket,))
                        for table in ['danh_gia','tep_dinh_kem','tin_nhan','lich_su_trang_thai']:
                            customer_service.execute(cur,'DELETE FROM {'+table+'} WHERE phieu_ma=%s',(ticket,))
                        customer_service.execute(cur,'DELETE FROM {phieu_ho_tro} WHERE phieu_ma=%s AND khach_hang_ma=%s',(ticket,uid))
                    customer_service.execute(cur,'DELETE FROM {khach_hang} WHERE nd_ma=%s',(uid,));customer_service.execute(cur,'DELETE FROM {nguoi_dung} WHERE nd_ma=%s AND email=%s',(uid,email))
            if kind:
                manager_service.execute(cur,'DELETE FROM {xu_ly_mac_dinh} WHERE ht_ma=%s AND nhom_ma=%s',(kind,group));customer_service.execute(cur,'DELETE FROM {loai_ho_tro} WHERE ht_ma=%s',(kind,))
            if group:manager_service.execute(cur,'DELETE FROM {nhom_ho_tro} WHERE nhom_ma=%s',(group,))
        assert counts()==before,'Fixture cleanup mismatch'
        print('PASS cleanup: exact fixture IDs removed, original table counts restored; no business records deleted and no identity reset.')

if __name__=='__main__':main()
