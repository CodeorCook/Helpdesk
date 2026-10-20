"""Real concurrent transactions; committed, randomly named private fixtures, exact-ID cleanup.

Unlike rollback-only tests, independent PostgreSQL connections must see committed fixtures.
Never changes existing accounts, groups, catalog entries, tickets, schema or sequences.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import secrets
import sys
from pathlib import Path
import threading
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from psycopg.rows import dict_row
from core.database import get_connection
from core.security import PASSWORD_HASHER
from services.staff_service import execute
from main import app


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    if not args.execute:parser.error('Cần --execute: fixture riêng được commit để test race rồi dọn đúng ID; không reset sequence.')
    prefix='phase3-race-'+secrets.token_hex(16);password=secrets.token_urlsafe(24)+'!9'
    users=[];group=None;kind=None
    try:
        with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
            for i,role in enumerate(['KHACH_HANG','NHAN_VIEN','NHAN_VIEN','NHAN_VIEN']):
                execute(cur,'INSERT INTO {nguoi_dung}(ho_ten,email,mat_khau_hash,vai_tro) VALUES(%s,%s,%s,%s) RETURNING nd_ma',(prefix+str(i),f'{prefix}-{i}@example.com',PASSWORD_HASHER.hash(password),role));uid=cur.fetchone()['nd_ma'];users.append(uid)
                execute(cur,'INSERT INTO {'+('khach_hang' if i==0 else 'nhan_vien')+'}(nd_ma) VALUES(%s)',(uid,))
            execute(cur,'INSERT INTO {nhom_ho_tro}(ten) VALUES(%s) RETURNING nhom_ma',(prefix,));group=cur.fetchone()['nhom_ma']
            execute(cur,'INSERT INTO {loai_ho_tro}(ten) VALUES(%s) RETURNING ht_ma',(prefix,));kind=cur.fetchone()['ht_ma']
            execute(cur,'INSERT INTO {xu_ly_mac_dinh}(ht_ma,nhom_ma) VALUES(%s,%s)',(kind,group))
            for uid in users[1:]:execute(cur,'INSERT INTO {thanh_vien_nhom}(nhom_ma,nhan_vien_ma) VALUES(%s,%s)',(group,uid))
        clients=[];origin={'Origin':'http://localhost:5173'}
        for i in range(4):
            c=TestClient(app,raise_server_exceptions=False);r=c.post('/api/v1/auth/login',json=dict(email=f'{prefix}-{i}@example.com',password=password),headers=origin);assert r.status_code==200,r.text;clients.append(c)
        headers=[{**origin,'X-CSRF-Token':c.get('/api/v1/auth/csrf').json()['csrf_token']} for c in clients]
        r=clients[0].post('/api/v1/customer/tickets',json=dict(title='Sofa race fixture',description='Private fixture',type_id=kind),headers=headers[0]);assert r.status_code==201,r.text;ticket=r.json()['id']
        barrier=threading.Barrier(2)
        def accept(i):
            barrier.wait(timeout=10)
            r=clients[i].post(f'/api/v1/staff/tickets/{ticket}/accept',headers=headers[i]);return i,r.status_code,r.text
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(accept,[1,2]))
        assert sorted(r[1] for r in results)==[200,409],results
        winner=next(i for i,status,_ in results if status==200)
        detail=clients[winner].get('/api/v1/staff/tickets/'+ticket).json();assignment=detail['assignment_id']
        with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
            execute(cur,'SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s AND ket_thuc IS NULL',(ticket,));assert cur.fetchone()['n']==1
            execute(cur,'SELECT count(*) n FROM {phieu_ho_tro} WHERE khach_hang_ma=%s',(users[0],));assert cur.fetchone()['n']==1
        barrier=threading.Barrier(2)
        def transfer(recipient):
            barrier.wait(timeout=10)
            r=clients[winner].post(f'/api/v1/staff/tickets/{ticket}/transfer',json=dict(employee_id=users[recipient],assignment_id=assignment),headers=headers[winner]);return r.status_code,r.text
        targets=[i for i in [1,2,3] if i!=winner]
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(transfer,targets))
        assert sorted(r[0] for r in results)==[200,409],results
        with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
            execute(cur,'SELECT ket_thuc FROM {lich_su_phan_cong} WHERE phieu_ma=%s ORDER BY pc_ma',(ticket,));history=cur.fetchall();assert len(history)==2 and history[0]['ket_thuc'] is not None and history[1]['ket_thuc'] is None
        print('PASS real PostgreSQL race: accept200/409, same ticket ID, one active assignment; transfer200/409, old assignment retained.')
    finally:
        if users:
            with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
                execute(cur,'SELECT nd_ma FROM {nguoi_dung} WHERE nd_ma=ANY(%s) AND ho_ten LIKE %s',(users,prefix+'%'));owned=[r['nd_ma'] for r in cur.fetchall()]
                # A failed setup transaction leaves no fixtures. Guard all cleanup by exact fixture identities.
                if owned:
                    assert set(owned)==set(users),'Fixture ownership mismatch: stop cleanup.'
                    execute(cur,'''SELECT count(*) n FROM {phieu_ho_tro} WHERE
                      (ht_ma=%s OR nhom_ma=%s OR nhan_vien_phu_trach_ma=ANY(%s) OR nguoi_lap_ma=ANY(%s))
                      AND NOT (khach_hang_ma=%s AND ht_ma IS NOT DISTINCT FROM %s)''',(kind,group,users,users,users[0],kind))
                    assert cur.fetchone()['n']==0,'External ticket references fixture; stop cleanup to preserve existing data.'
                    execute(cur,'DELETE FROM {phieu_ho_tro} WHERE khach_hang_ma=%s AND ht_ma=%s',(users[0],kind))
                    execute(cur,'DELETE FROM {thanh_vien_nhom} WHERE nhom_ma=%s AND nhan_vien_ma=ANY(%s)',(group,users[1:]))
                    execute(cur,'DELETE FROM {xu_ly_mac_dinh} WHERE ht_ma=%s AND nhom_ma=%s',(kind,group))
                    execute(cur,'DELETE FROM {loai_ho_tro} WHERE ht_ma=%s AND ten=%s',(kind,prefix))
                    execute(cur,'DELETE FROM {nhom_ho_tro} WHERE nhom_ma=%s AND ten=%s',(group,prefix))
                    execute(cur,'DELETE FROM {nhan_vien} WHERE nd_ma=ANY(%s)',(users[1:],))
                    execute(cur,'DELETE FROM {khach_hang} WHERE nd_ma=%s',(users[0],))
                    execute(cur,'DELETE FROM {nguoi_dung} WHERE nd_ma=ANY(%s) AND ho_ten LIKE %s',(users,prefix+'%'))
            with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
                execute(cur,'SELECT count(*) n FROM {nguoi_dung} WHERE nd_ma=ANY(%s)',(users,));assert cur.fetchone()['n']==0
            print('PASS cleanup: only recorded private fixture IDs removed; no identity sequence reset.')


if __name__=='__main__':main()
