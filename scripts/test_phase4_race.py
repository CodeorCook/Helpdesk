"""Independent PostgreSQL connections; private committed fixtures + exact-ID cleanup."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import os
import secrets
import sys
import threading
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from psycopg.rows import dict_row
from core.database import get_connection
from core.security import PASSWORD_HASHER
from services.manager_service import execute,TABLES
from main import app


def counts():
    with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
        result={}
        for table in TABLES:
            execute(cur,'SELECT count(*) n FROM {'+table+'}');result[table]=cur.fetchone()['n']
        return result


def run():
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    if not args.execute:parser.error('Cần --execute; fixture riêng được commit để test race rồi cleanup đúng ID, không reset sequence.')
    prefix='p4race-'+secrets.token_hex(14);password=secrets.token_urlsafe(24)+'!9';users=[];groups=[];kind=None;origin={'Origin':'http://localhost:5173'};baseline=counts()
    try:
        with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
            for i,role in enumerate(['QUAN_TRI_VIEN','QUAN_TRI_VIEN','KHACH_HANG','NHAN_VIEN','NHAN_VIEN','KHACH_HANG','NHAN_VIEN']):
                execute(cur,'INSERT INTO {nguoi_dung}(ho_ten,email,mat_khau_hash,vai_tro) VALUES(%s,%s,%s,%s) RETURNING nd_ma',(prefix+str(i),f'{prefix}-{i}@example.com',PASSWORD_HASHER.hash(password),role));uid=cur.fetchone()['nd_ma'];users.append(uid)
                table={'QUAN_TRI_VIEN':'quan_tri_vien','KHACH_HANG':'khach_hang','NHAN_VIEN':'nhan_vien'}[role];execute(cur,'INSERT INTO {'+table+'}(nd_ma) VALUES(%s)',(uid,))
            for i in range(2):
                execute(cur,'INSERT INTO {nhom_ho_tro}(ten) VALUES(%s) RETURNING nhom_ma',(prefix+'-'+str(i),));groups.append(cur.fetchone()['nhom_ma'])
                for uid in users[3:5]:execute(cur,'INSERT INTO {thanh_vien_nhom}(nhom_ma,nhan_vien_ma) VALUES(%s,%s)',(groups[-1],uid))
            execute(cur,'INSERT INTO {loai_ho_tro}(ten) VALUES(%s) RETURNING ht_ma',(prefix,));kind=cur.fetchone()['ht_ma']
            execute(cur,'INSERT INTO {xu_ly_mac_dinh}(ht_ma,nhom_ma) VALUES(%s,%s)',(kind,groups[0]))
        clients=[];headers=[]
        for i in range(7):
            c=TestClient(app,raise_server_exceptions=False);r=c.post('/api/v1/auth/login',json=dict(email=f'{prefix}-{i}@example.com',password=password),headers=origin);assert r.status_code==200,r.text;clients.append(c);headers.append({**origin,'X-CSRF-Token':c.get('/api/v1/auth/csrf').json()['csrf_token']})
        def create():
            r=clients[2].post('/api/v1/customer/tickets',json=dict(title='Sofa race phase4',description='Private fixture',type_id=kind),headers=headers[2]);assert r.status_code==201,r.text;return r.json()['id']
        ticket=create();assert clients[3].post(f'/api/v1/staff/tickets/{ticket}/accept',headers=headers[3]).status_code==200
        d=clients[0].get('/api/v1/manager/tickets/'+ticket).json();barrier=threading.Barrier(2)
        def reassign(i):
            barrier.wait(timeout=10)
            r=clients[i].post(f'/api/v1/manager/tickets/{ticket}/assignment',json=dict(group_id=groups[i],employee_id=users[4],expected_assignment_id=d['assignment_id'],expected_updated_at=d['updated_at'],reason='Private race fixture'),headers=headers[i]);return r.status_code,r.text
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(reassign,[0,1]))
        assert sorted(r[0] for r in results)==[200,409],results
        with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
            execute(cur,'SELECT ket_thuc FROM {lich_su_phan_cong} WHERE phieu_ma=%s ORDER BY pc_ma',(ticket,));history=cur.fetchall();assert len(history)==2 and history[0]['ket_thuc'] is not None and history[1]['ket_thuc'] is None
        pending=create();barrier=threading.Barrier(2)
        def eligibility_race(i):
            barrier.wait(timeout=10)
            if i==0:r=clients[0].post(f'/api/v1/manager/groups/{groups[0]}/members/remove',json=dict(employee_id=users[3]),headers=headers[0])
            else:r=clients[3].post(f'/api/v1/staff/tickets/{pending}/accept',headers=headers[3])
            return r.status_code,r.text
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(eligibility_race,[0,1]))
        assert (results[0][0]==200 and results[1][0] in (403,404)) or (results[0][0]==409 and results[1][0]==200),results
        for target,role in [(5,'NHAN_VIEN'),(6,'QUAN_TRI_VIEN')]:
            snapshot=clients[0].get('/api/v1/manager/users/'+str(users[target])).json();barrier=threading.Barrier(2)
            def role_create_race(i):
                barrier.wait(timeout=10)
                if i==0:r=clients[0].post('/api/v1/manager/users/'+str(users[target])+'/role',json=dict(role=role,current_password=password,confirmed=True,expected_updated_at=snapshot['updated_at']),headers=headers[0])
                elif target==5:r=clients[target].post('/api/v1/customer/tickets',json=dict(title='Role race customer',description='Private fixture',type_id=kind),headers=headers[target])
                else:r=clients[target].post('/api/v1/staff/tickets',json=dict(title='Role race staff',description='Private fixture',type_id=kind,priority_id=2,customer_id=users[2]),headers=headers[target])
                return r.status_code,r.text
            with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(role_create_race,[0,1]))
            assert (results[0][0]==409 and results[1][0]==201) or (results[0][0]==200 and results[1][0] in (401,403,409)),results
        snapshots=[clients[0].get('/api/v1/manager/users/'+str(users[i])).json() for i in range(2)]
        barrier=threading.Barrier(2)
        def manager_lock(i):
            target=1-i;barrier.wait(timeout=10)
            r=clients[i].patch('/api/v1/manager/users/'+str(users[target]),json=dict(name=snapshots[target]['name'],phone=None,status='KHOA',expected_updated_at=snapshots[target]['updated_at']),headers=headers[i]);return r.status_code,r.text
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(manager_lock,[0,1]))
        assert sum(r[0]==200 for r in results)==1 and any(r[0] in (401,403) for r in results),results
        with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
            execute(cur,"SELECT count(*) n FROM {nguoi_dung} WHERE nd_ma=ANY(%s) AND trang_thai='HOAT_DONG'",(users[:2],));assert cur.fetchone()['n']==1
        print('PASS real races: reassignment200/409; removal vs accept safe; customer/staff create vs role change safe; cross-lock managers leaves one active. History preserved, one effective assignment.')
    finally:
        if users:
            with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
                execute(cur,'SELECT nd_ma FROM {nguoi_dung} WHERE nd_ma=ANY(%s) AND ho_ten LIKE %s',(users,prefix+'%'));owned=[r['nd_ma'] for r in cur.fetchall()]
                if owned:
                    assert set(owned)==set(users),'Fixture ownership mismatch; stop cleanup.'
                    execute(cur,'''SELECT count(*) n FROM {phieu_ho_tro} WHERE
                      (ht_ma=%s OR nhom_ma=ANY(%s) OR nhan_vien_phu_trach_ma=ANY(%s) OR nguoi_lap_ma=ANY(%s))
                      AND NOT (khach_hang_ma=ANY(%s) AND ht_ma IS NOT DISTINCT FROM %s)''',(kind,groups,users,users,[users[2],users[5]],kind))
                    assert cur.fetchone()['n']==0,'External ticket references fixture; stop cleanup to preserve existing data.'
                    execute(cur,'DELETE FROM {phieu_ho_tro} WHERE khach_hang_ma=ANY(%s) AND ht_ma=%s',([users[2],users[5]],kind))
                    execute(cur,'DELETE FROM {thanh_vien_nhom} WHERE nhom_ma=ANY(%s) AND nhan_vien_ma=ANY(%s)',(groups,users))
                    execute(cur,'DELETE FROM {xu_ly_mac_dinh} WHERE ht_ma=%s AND nhom_ma=ANY(%s)',(kind,groups))
                    execute(cur,'DELETE FROM {loai_ho_tro} WHERE ht_ma=%s AND ten=%s',(kind,prefix))
                    execute(cur,'DELETE FROM {nhom_ho_tro} WHERE nhom_ma=ANY(%s) AND ten LIKE %s',(groups,prefix+'%'))
                    execute(cur,'DELETE FROM {nhan_vien} WHERE nd_ma=ANY(%s)',(users,))
                    execute(cur,'DELETE FROM {khach_hang} WHERE nd_ma=ANY(%s)',(users,))
                    execute(cur,'DELETE FROM {quan_tri_vien} WHERE nd_ma=ANY(%s)',(users,))
                    execute(cur,'DELETE FROM {nguoi_dung} WHERE nd_ma=ANY(%s) AND ho_ten LIKE %s',(users,prefix+'%'))
        assert counts()==baseline,'Fixture cleanup/count mismatch.'
        print('PASS exact-ID cleanup: all counts restored, existing data untouched, no sequence reset.')


if __name__=='__main__':
    with TemporaryDirectory(prefix='phase4-race-audit-') as tmp,patch.dict(os.environ,{'MANAGER_AUDIT_DIR':tmp}):run()
