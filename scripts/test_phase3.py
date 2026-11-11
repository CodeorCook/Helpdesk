"""Opt-in isolated PostgreSQL fixtures. Default transaction is always rolled back."""
import argparse
from contextlib import contextmanager
import secrets
import sys
import os
import threading
import json
import subprocess
import time
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from psycopg.rows import dict_row
from core.database import BASE_DIR, database_schema, get_connection
from core.security import PASSWORD_HASHER
from services import auth_service, customer_service, manager_service, staff_service as service
from main import app


def main():
    p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');p.add_argument('--stage',choices=['AB','C','D','E'],default='AB');p.add_argument('--browser',action='store_true');args=p.parse_args()
    if not args.execute:p.error('Cần --execute; fixture được rollback, không seed dữ liệu sử dụng.')
    prefix=secrets.token_hex(12); password=secrets.token_urlsafe(24)+'!9'; origin={'Origin':'http://localhost:5173'}
    with TemporaryDirectory(prefix='helpdesk-phase3-') as upload_dir, patch.dict(os.environ,{'UPLOAD_DIR':upload_dir}), get_connection() as conn, conn.transaction(force_rollback=True), conn.cursor(row_factory=dict_row) as cur:
        gate=threading.RLock()
        @contextmanager
        def connection():
            with gate,conn.transaction():yield conn
        def q(s,params=()):service.execute(cur,s,params);return cur
        q("SET LOCAL lock_timeout = '5s'")
        assert database_schema() == 'helpdesk', 'Fixture migration targets helpdesk.'
        ids=[]
        for i,role in enumerate(['KHACH_HANG','KHACH_HANG','NHAN_VIEN','NHAN_VIEN','NHAN_VIEN','QUAN_TRI_VIEN']):
            uid=q('INSERT INTO {nguoi_dung}(ho_ten,email,mat_khau_hash,vai_tro) VALUES(%s,%s,%s,%s) RETURNING nd_ma',('Kiểm thử '+str(i),f'{prefix}-{i}@example.com',PASSWORD_HASHER.hash(password),role)).fetchone()['nd_ma'];ids.append(uid)
            profile={'KHACH_HANG':'khach_hang','NHAN_VIEN':'nhan_vien','QUAN_TRI_VIEN':'quan_tri_vien'}[role]
            manager_service.execute(cur,'INSERT INTO {'+profile+'}(nd_ma) VALUES(%s)',(uid,))
        group=q('INSERT INTO {nhom_ho_tro}(ten) VALUES(%s) RETURNING nhom_ma',('Fixture '+prefix,)).fetchone()['nhom_ma']
        for uid in ids[2:4]:q('INSERT INTO {thanh_vien_nhom}(nhom_ma,nhan_vien_ma) VALUES(%s,%s)',(group,uid))
        type_id=q('INSERT INTO {loai_ho_tro}(ten) VALUES(%s) RETURNING ht_ma',('Bảo hành sofa fixture '+prefix,)).fetchone()['ht_ma']
        q('INSERT INTO {xu_ly_mac_dinh}(ht_ma,nhom_ma) VALUES(%s,%s)',(type_id,group))
        with patch.object(auth_service,'get_connection',connection),patch.object(customer_service,'get_connection',connection),patch.object(service,'get_connection',connection),patch.object(manager_service,'get_connection',connection):
            clients=[]
            for i in range(len(ids)):
                c=TestClient(app,raise_server_exceptions=False);r=c.post('/api/v1/auth/login',json={'email':f'{prefix}-{i}@example.com','password':password},headers=origin);assert r.status_code==200,r.text;clients.append(c)
            def post(c,path,body=None,method='POST'):
                token=c.get('/api/v1/auth/csrf').json()['csrf_token'];return c.request(method,'/api/v1/'+path,json=body,headers={**origin,'X-CSRF-Token':token})
            approval_priority=q('SELECT i FROM generate_series(30000,32767) i WHERE NOT EXISTS(SELECT 1 FROM {muc_do_uu_tien} WHERE mdut_ma=i OR thu_tu=i) LIMIT 1').fetchone()['i']
            q('INSERT INTO {muc_do_uu_tien}(mdut_ma,ten,thu_tu) VALUES(%s,%s,%s)',(approval_priority,'Fixture '+prefix,approval_priority))
            def approve(c, ticket_id, **changes):
                version=q('SELECT ngay_cap_nhat FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket_id,)).fetchone()['ngay_cap_nhat']
                payload=dict(title='Bảo hành đã chuẩn hóa',description='Kiểm tra chân sofa',type_id=type_id,
                             priority_id=approval_priority,expected_updated_at=version.isoformat())
                return post(c,f'staff/tickets/{ticket_id}/approve',{**payload,**changes})
            def create(c=clients[0]):
                r=post(c,'customer/tickets',dict(title='Bảo hành sofa',description='Chân sofa cần kiểm tra',type_id=type_id));assert r.status_code==201,r.text;return r.json()['id']
            columns = q("""SELECT column_name FROM information_schema.columns
                WHERE table_schema='helpdesk' AND table_name='phieu_ho_tro'""").fetchall()
            present = {item['column_name'] for item in columns}
            if not {'yeu_cau_goc', 'ket_thuc_loai'} <= present:
                with conn.transaction(force_rollback=True):
                    probe = create()
                    def request_snapshot():
                        return q("""SELECT to_jsonb(p) ticket, (SELECT count(*) FROM {lich_su_trang_thai}
                            WHERE phieu_ma=p.phieu_ma) events, (SELECT count(*) FROM {lich_su_phan_cong}
                            WHERE phieu_ma=p.phieu_ma) assignments FROM {phieu_ho_tro} p WHERE phieu_ma=%s""",
                            (probe,)).fetchone()
                    before = request_snapshot()
                    if 'yeu_cau_goc' not in present:
                        blocked = approve(clients[2], probe)
                        assert blocked.status_code == 503 and '001_staff_request_snapshot.sql' in blocked.json()['detail'], blocked.text
                    if 'ket_thuc_loai' not in present:
                        blocked = post(clients[2], f'staff/tickets/{probe}/reject', dict(
                            reason='Kiểm thử thiếu migration', expected_updated_at=before['ticket']['ngay_cap_nhat']))
                        assert blocked.status_code == 503 and '002_request_rejection_and_email.sql' in blocked.json()['detail'], blocked.text
                    assert request_snapshot() == before
                    print('PASS missing migration: explicit 503, ticket and histories unchanged')
            for filename in ('001_staff_request_snapshot.sql', '002_request_rejection_and_email.sql'):
                migration = (BASE_DIR/'docs/migrations'/filename).read_text(encoding='ascii')
                cur.execute(migration.split('BEGIN;', 1)[1].rsplit('COMMIT;', 1)[0])
            ticket=create()
            for _ in range(3):
                other=create();r=approve(clients[3],other);assert r.status_code==200,r.text
            queue=clients[2].get('/api/v1/staff/tickets').json();item=next(t for t in queue['items'] if t['id']==ticket);assert item['recommended'] and item['assigned_id'] is None
            assert q('SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s',(ticket,)).fetchone()['n']==0
            assert clients[3].get('/api/v1/staff/tickets').json()['items'][0]['recommended'] is False
            assert clients[0].get('/api/v1/staff/tickets').status_code==403
            assert clients[4].get('/api/v1/staff/tickets/'+ticket).status_code==404
            assert approve(clients[4],ticket).status_code==404
            assert clients[2].post(f'/api/v1/staff/tickets/{ticket}/accept',headers=origin).status_code==403
            assert post(clients[2],f'staff/tickets/{ticket}/accept').status_code==409
            assert approve(clients[2],ticket,priority_id=None).status_code==422
            assert approve(clients[2],ticket,expected_updated_at='2020-01-01T00:00:00Z').status_code==409
            cancelled=create()
            assert post(clients[0],f'customer/tickets/{cancelled}/cancel',{'reason':'Dữ liệu kiểm thử'}).status_code==200
            assert approve(clients[2],cancelled).status_code==409
            def reject(c, request_id, reason='Không thuộc phạm vi hỗ trợ', version=None):
                if version is None:
                    version=q('SELECT ngay_cap_nhat FROM {phieu_ho_tro} WHERE phieu_ma=%s',(request_id,)).fetchone()['ngay_cap_nhat'].isoformat()
                return post(c,f'staff/tickets/{request_id}/reject',dict(reason=reason,expected_updated_at=version))
            assert reject(clients[2],cancelled).status_code==409
            assert reject(clients[2],other).status_code==409
            rejected_id=create()
            assert reject(clients[4],rejected_id).status_code==404
            assert reject(clients[2],rejected_id,reason='  ').status_code==422
            assert reject(clients[2],rejected_id,version='2020-01-01T00:00:00Z').status_code==409
            rejected=reject(clients[2],rejected_id)
            assert rejected.status_code==200,rejected.text
            assert approve(clients[2],rejected_id).status_code==409
            summary=clients[0].get('/api/v1/customer/tickets/'+rejected_id).json()
            assert summary['status']=='DA_HUY' and summary['termination_kind']=='TU_CHOI_YEU_CAU'
            assert summary['end_reason']=='Không thuộc phạm vi hỗ trợ' and summary['closed_at']
            assert post(clients[0],f'customer/tickets/{rejected_id}/rating',dict(stars=5)).status_code==409
            outbox=q("SELECT phieu_ma::text id,event,payload FROM helpdesk.email_outbox WHERE phieu_ma=ANY(%s::bigint[])",
                     ([rejected_id,cancelled,other],)).fetchall()
            assert {(item['id'],item['event']) for item in outbox}=={
                (rejected_id,'created'),(rejected_id,'rejected'),(cancelled,'created'),(cancelled,'cancelled'),(other,'created'),(other,'approved')}
            assert all(item['payload']['recipient']==f'{prefix}-0@example.com' for item in outbox)
            from services.email_service import enqueue
            enqueue(cur,rejected_id,'rejected','Lặp')
            assert q("SELECT count(*) n FROM helpdesk.email_outbox WHERE phieu_ma=%s AND event='rejected'",(rejected_id,)).fetchone()['n']==1
            with conn.transaction(force_rollback=True):
                temporary=create()
                assert q("SELECT count(*) n FROM helpdesk.email_outbox WHERE phieu_ma=%s",(temporary,)).fetchone()['n']==1
            assert q("SELECT count(*) n FROM helpdesk.email_outbox WHERE phieu_ma=%s",(temporary,)).fetchone()['n']==0
            print('PASS rejection and email enqueue: state/reason, no rating or approval, scoped access, four events, deduplication and rollback')
            newest=clients[2].get('/api/v1/staff/tickets',params={'scope':'queue','sort':'newest','page_size':1}).json()
            assert newest['items'][0]['id']==ticket and newest['total']==1
            with conn.transaction(force_rollback=True):
                pending=[create() for _ in range(6)]
                for request_id in pending:
                    q("UPDATE {phieu_ho_tro} SET sla_ma=NULL,han_phan_hoi=NULL,han_xu_ly=NULL WHERE phieu_ma=%s",(request_id,))
                oldest_due=pending[0]
                policy=q('INSERT INTO {chinh_sach_sla}(mdut_ma,ten,thoi_gian_phan_hoi_phut,thoi_gian_xu_ly_phut,dang_hoat_dong) VALUES(%s,%s,30,60,false) RETURNING sla_ma',(approval_priority,'Hạn hàng đợi '+prefix)).fetchone()['sla_ma']
                q("UPDATE {phieu_ho_tro} SET sla_ma=%s,ngay_tao=now()-interval '2 hours',han_phan_hoi=now()-interval '1 hour' WHERE phieu_ma=%s",(policy,oldest_due))
                q("UPDATE {phieu_ho_tro} SET sla_ma=%s,ngay_tao=now()-interval '10 minutes',han_phan_hoi=now()+interval '5 minutes' WHERE phieu_ma=%s",(policy,pending[1]))
                params=dict(scope='queue',sort='due',page_size=5)
                due=clients[2].get('/api/v1/staff/tickets',params=params).json()
                second_page=clients[2].get('/api/v1/staff/tickets',params={**params,'page':2}).json()
                assert due['total']==7 and due['overdue']>=1 and due['soon']>=1 and due['items'][0]['id']==oldest_due
                assert len(second_page['items'])==2 and not ({i['id'] for i in due['items']} & {i['id'] for i in second_page['items']})
                assert clients[2].get('/api/v1/staff/tickets',params={**params,'sort':'newest'}).json()['items'][0]['id']==pending[-1]
            with patch.object(customer_service,'add_history',side_effect=RuntimeError('fixture failure')):
                assert approve(clients[2],ticket).status_code==500
            assert q('SELECT nhan_vien_phu_trach_ma FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket,)).fetchone()['nhan_vien_phu_trach_ma'] is None
            r=approve(clients[2],ticket);assert r.status_code==200,r.text;assert r.json()['id']==ticket and r.json()['status']=='DANG_XU_LY'
            assert approve(clients[3],ticket).status_code==409
            assert q('SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s AND ket_thuc IS NULL',(ticket,)).fetchone()['n']==1
            snapshot=clients[2].get('/api/v1/staff/tickets/'+ticket).json()['request_snapshot']
            assert snapshot['title']=='Bảo hành sofa' and snapshot['description']=='Chân sofa cần kiểm tra'
            assert r.json()['priority_id']==str(approval_priority)
            assert q('''SELECT p.sla_ma IS NULL OR EXISTS(
                SELECT 1 FROM {chinh_sach_sla} s WHERE s.sla_ma=p.sla_ma AND s.mdut_ma=p.mdut_ma AND s.dang_hoat_dong
            ) AS valid FROM {phieu_ho_tro} p WHERE phieu_ma=%s''',(ticket,)).fetchone()['valid']
            assert clients[2].get('/api/v1/staff/overview').status_code==200
            with conn.transaction(force_rollback=True):
                migration = (BASE_DIR/'docs/migrations/003_staff_message_read.sql').read_text(encoding='ascii')
                cur.execute(migration.split('BEGIN;', 1)[1].rsplit('COMMIT;', 1)[0])
                assigned = [create() for _ in range(6)]
                for request_id in assigned:
                    assert approve(clients[2],request_id).status_code==200
                def mine(sort='newest', page=1, **filters):
                    result = clients[2].get('/api/v1/staff/tickets', params=dict(
                        scope='mine',sort=sort,page=page,page_size=5,**filters))
                    assert result.status_code==200,result.text
                    return result.json()['items']
                all_assigned = [ticket,*assigned]
                assert [x['id'] for x in mine()] == all_assigned[::-1][:5]
                assert [x['id'] for x in mine('oldest',2)] == all_assigned[5:]
                assert [x['id'] for x in mine('newest',2)] == all_assigned[::-1][5:]
                tpath=f'tickets/{ticket}'
                first=post(clients[0],f'customer/{tpath}/messages',dict(content='Khách gửi trước')).json()['id']
                feed=clients[2].get('/api/v1/staff/'+tpath+'/conversation').json()
                assert feed['can_mark_read'] and [m['id'] for m in feed['messages'] if m['from_customer']]==[first]
                second=post(clients[0],f'customer/{tpath}/messages',dict(content='Khách gửi sau khi tải')).json()['id']
                private=post(clients[2],f'staff/{tpath}/messages',dict(content='Nhờ Quản lý hỗ trợ',internal=True))
                assert private.status_code==201,private.text
                manager_feed=clients[5].get('/api/v1/manager/'+tpath+'/conversation').json()
                assert manager_feed['can_send_internal'] and not manager_feed['can_send']
                endpoint=f'manager/{tpath}/internal-messages'
                assert post(clients[2],endpoint,dict(content='Ngoài quyền')).status_code==403
                assert clients[5].post('/api/v1/'+endpoint,json=dict(content='Thiếu CSRF'),headers=origin).status_code==403
                assert post(clients[5],endpoint,dict(content='Bật công khai',internal=False)).status_code==422
                reply=post(clients[5],endpoint,dict(content='Phản hồi nội bộ của Quản lý'))
                assert reply.status_code==201,reply.text
                assert clients[2].get('/api/v1/staff/'+tpath).json()['first_response_at'] is None
                staff_feed=clients[2].get('/api/v1/staff/'+tpath+'/conversation').json()
                assert any(m['id']==reply.json()['id'] and m['internal'] for m in staff_feed['messages'])
                visible=clients[0].get('/api/v1/customer/'+tpath+'/conversation').json()
                assert [m['id'] for m in visible['messages']]==[first,second]
                staff_public=post(clients[2],f'staff/{tpath}/messages',dict(content='Nhân viên phản hồi công khai')).json()['id']
                assert mine(search=ticket)[0]['unread_customer_messages']==2
                read_path=f'staff/{tpath}/conversation/read'
                assert post(clients[3],read_path,dict(message_ids=[first])).status_code==409
                assert post(clients[2],read_path,dict(message_ids=[first,private.json()['id'],reply.json()['id'],staff_public])).status_code==204
                assert mine(search=ticket)[0]['unread_customer_messages']==1
                assert post(clients[2],read_path,dict(message_ids=[first])).status_code==204
                assert mine(search=ticket)[0]['unread_customer_messages']==1
                assert post(clients[2],read_path,dict(message_ids=[second])).status_code==204
                assert mine(search=ticket)[0]['unread_customer_messages']==0
                assignment=clients[2].get('/api/v1/staff/'+tpath).json()['assignment_id']
                assert post(clients[2],f'staff/{tpath}/transfer',dict(employee_id=ids[3],assignment_id=assignment)).status_code==200
                assert post(clients[2],f'staff/{tpath}/messages',dict(content='Đã chuyển người',internal=True)).status_code==409
                assert post(clients[3],f'staff/{tpath}/status',dict(status='DA_DONG')).status_code==422
                assert post(clients[3],f'staff/{tpath}/status',dict(status='DA_GIAI_QUYET')).status_code==200
                assert post(clients[5],endpoint,dict(content='Phiếu chỉ đọc')).status_code==409
                print('PASS mine sort, unread receipts and concurrent arrival, staff/manager privacy and status guards')
            print('PASS A/B: recommendation without assignment; workload 0 vs 3; accept same ID; second accept409; CSRF/role/group; injected history rollback; PostgreSQL fixtures rollback.')
            if args.stage=='AB':return
            priority=q('SELECT mdut_ma FROM {muc_do_uu_tien} ORDER BY thu_tu LIMIT 1').fetchone()['mdut_ma']
            r=post(clients[2],'staff/tickets',dict(title='Điện thoại: sửa bàn ăn',description='Khách gọi qua điện thoại',type_id=type_id,priority_id=priority,customer_id=ids[1]));assert r.status_code==201,r.text
            created=r.json()['id'];record=q('SELECT nguon_tao,nguoi_lap_ma,nhan_vien_phu_trach_ma FROM {phieu_ho_tro} WHERE phieu_ma=%s',(created,)).fetchone();assert record['nguon_tao']=='NHAN_VIEN' and record['nguoi_lap_ma']==ids[2] and record['nhan_vien_phu_trach_ma'] is None
            assert clients[1].get('/api/v1/customer/tickets/'+created).status_code==200
            assert clients[0].get('/api/v1/customer/tickets/'+created).status_code==404
            assert post(clients[2],'staff/tickets',dict(title='x',description='x',type_id=type_id,priority_id=priority,customer_id=ids[2])).status_code==422
            assert clients[2].get('/api/v1/staff/customers?search='+str(ids[0])).json()[0]['id']==str(ids[0])
            r=post(clients[2],f'staff/tickets/{ticket}/classification',dict(type_id=type_id,priority_id=priority),'PATCH');assert r.status_code==200,r.text
            assert post(clients[3],f'staff/tickets/{ticket}/classification',dict(type_id=type_id,priority_id=priority),'PATCH').status_code==409
            detail=clients[2].get('/api/v1/staff/tickets/'+ticket).json();assignment=detail['assignment_id']
            original_execute=service.execute
            def failed_assignment(cursor,statement,params=()):
                if statement.startswith('INSERT INTO {lich_su_phan_cong}'):
                    raise RuntimeError('fixture assignment failure')
                return original_execute(cursor,statement,params)
            with patch.object(service,'execute',side_effect=failed_assignment):
                assert post(clients[2],f'staff/tickets/{ticket}/transfer',dict(employee_id=ids[3],assignment_id=assignment)).status_code==500
            assert q('SELECT ket_thuc FROM {lich_su_phan_cong} WHERE pc_ma=%s',(assignment,)).fetchone()['ket_thuc'] is None
            assert post(clients[2],f'staff/tickets/{ticket}/transfer',dict(employee_id=ids[4],assignment_id=assignment)).status_code==422
            r=post(clients[2],f'staff/tickets/{ticket}/transfer',dict(employee_id=ids[3],assignment_id=assignment));assert r.status_code==200,r.text
            assert post(clients[2],f'staff/tickets/{ticket}/transfer',dict(employee_id=ids[3],assignment_id=assignment)).status_code==409
            hist=q('SELECT ket_thuc FROM {lich_su_phan_cong} WHERE phieu_ma=%s ORDER BY pc_ma',(ticket,)).fetchall();assert len(hist)==2 and hist[0]['ket_thuc'] is not None and hist[1]['ket_thuc'] is None
            assert clients[4].get('/api/v1/staff/tickets/'+ticket).status_code==404
            assert clients[2].get('/api/v1/staff/tickets?scope=team&search='+ticket).json()['total']==1
            assert clients[2].get('/api/v1/staff/tickets',params={'scope':'team','search':"' OR 1=1 --"}).json()['total']==0
            print('PASS C: staff creates one new unassigned ticket for real customer; source/creator; classification; authorized same-group transfer; preserved assignment history; BOLA and parameterized search.')
            if args.stage=='C':return
            assert post(clients[3],f'staff/tickets/{ticket}/messages',dict(content='Ghi chú bảo hành nội bộ',internal=True)).status_code==201
            assert clients[3].get('/api/v1/staff/tickets/'+ticket).json()['first_response_at'] is None
            assert post(clients[3],f'staff/tickets/{ticket}/messages',dict(content='Đã kiểm tra sofa cho khách',internal=False)).status_code==201
            assert clients[3].get('/api/v1/staff/tickets/'+ticket).json()['first_response_at'] is not None
            public=clients[0].get('/api/v1/customer/tickets/'+ticket).json()['messages'];assert len(public)==1 and public[0]['content']=='Đã kiểm tra sofa cho khách'
            assert len(clients[3].get('/api/v1/staff/tickets/'+ticket).json()['messages'])==2
            token=clients[3].get('/api/v1/auth/csrf').json()['csrf_token'];headers={**origin,'X-CSRF-Token':token}
            r=clients[3].post(f'/api/v1/staff/tickets/{ticket}/attachments',files={'file':('bien-ban.txt',b'Kiem tra sofa','text/plain')},headers=headers);assert r.status_code==201,r.text;attachment=r.json()['id']
            assert clients[0].get(f'/api/v1/customer/tickets/{ticket}/attachments/{attachment}').content==b'Kiem tra sofa'
            assert clients[4].get(f'/api/v1/staff/tickets/{ticket}/attachments/{attachment}').status_code==404
            assert clients[1].get(f'/api/v1/customer/tickets/{ticket}/attachments/{attachment}').status_code==404
            for name,content,mime in [('../bad.txt',b'x','text/plain'),('bad.png',b'fake','image/png'),('bad.exe',b'x','application/octet-stream')]:
                assert clients[3].post(f'/api/v1/staff/tickets/{ticket}/attachments',files={'file':(name,content,mime)},headers=headers).status_code in (415,422)
            files_before=set(Path(upload_dir).iterdir())
            with patch.object(customer_service,'insert_attachment',side_effect=RuntimeError('fixture metadata failure')):
                assert clients[3].post(f'/api/v1/staff/tickets/{ticket}/attachments',files={'file':('rollback.txt',b'x','text/plain')},headers=headers).status_code==500
            assert set(Path(upload_dir).iterdir())==files_before
            assert post(clients[3],f'staff/tickets/{ticket}/status',dict(status='DA_DONG')).status_code==422
            assert post(clients[3],f'staff/tickets/{ticket}/status',dict(status='DANG_XU_LY')).status_code==409
            assert post(clients[3],f'staff/tickets/{ticket}/status',dict(status='TAM_DUNG')).status_code==200
            with patch.object(customer_service,'add_history',side_effect=RuntimeError('fixture failure')):
                assert post(clients[3],f'staff/tickets/{ticket}/status',dict(status='DA_GIAI_QUYET')).status_code==500
            assert clients[3].get('/api/v1/staff/tickets/'+ticket).json()['status']=='TAM_DUNG'
            assert post(clients[3],f'staff/tickets/{ticket}/status',dict(status='DA_GIAI_QUYET')).status_code==200
            assert clients[3].get('/api/v1/staff/tickets/'+ticket).json()['resolved_at'] is not None
            assert post(clients[3],f'staff/tickets/{ticket}/messages',dict(content='Không được gửi')).status_code==409
            assert post(clients[0],f'customer/tickets/{ticket}/close',{}).status_code==200
            assert post(clients[0],f'customer/tickets/{ticket}/rating',dict(stars=5,comment='Đã sửa sofa')).status_code==201
            assert post(clients[0],f'customer/tickets/{ticket}/rating',dict(stars=5)).status_code==409
            print('PASS D: public/internal separation; real upload/download; BOLA/traversal/MIME; file cleanup; transitions + history rollback; customer->staff->customer close/rate once.')
            if args.stage=='D':return
            assert clients[3].get('/api/v1/staff/tickets/'+ticket).json()['sla_state']=='Chưa cấu hình SLA'
            sla_id=q('INSERT INTO {chinh_sach_sla}(mdut_ma,ten,thoi_gian_phan_hoi_phut,thoi_gian_xu_ly_phut,dang_hoat_dong) VALUES(%s,%s,30,60,true) RETURNING sla_ma',(approval_priority,'Fixture SLA '+prefix)).fetchone()['sla_ma']
            tracked=create();assert approve(clients[2],tracked).status_code==200
            actual=q('SELECT sla_ma,EXTRACT(EPOCH FROM han_phan_hoi-ngay_tao)/60 response,EXTRACT(EPOCH FROM han_xu_ly-ngay_tao)/60 resolution FROM {phieu_ho_tro} WHERE phieu_ma=%s',(tracked,)).fetchone()
            assert actual==dict(sla_ma=sla_id,response=30,resolution=60)
            for delta,expected in [(120,'Trong hạn'),(30,'Sắp quá hạn'),(-1,'Quá hạn')]:
                q("UPDATE {phieu_ho_tro} SET sla_ma=%s,han_xu_ly=now()+(%s * interval '1 minute'),han_phan_hoi=NULL WHERE phieu_ma=%s",(sla_id,delta,tracked))
                r=clients[2].get('/api/v1/staff/tickets/'+tracked);assert r.status_code==200,r.text;assert r.json()['sla_state']==expected,r.text
            assert clients[2].get('/api/v1/staff/overview').json()['overdue']==1
            assert clients[2].get('/api/v1/staff/tickets',params={'scope':'mine','search':'#HT-'+tracked,'priority':approval_priority,'status':'DANG_XU_LY','type':type_id,'page_size':1}).json()['total']==1
            assert clients[2].get('/api/v1/staff/tickets?from=2026-10-21&to=2026-10-20').status_code==422
            financial=q("SELECT ht_ma FROM {loai_ho_tro} WHERE ten='Thanh toán và hóa đơn'").fetchone()['ht_ma']
            r=post(clients[2],f'staff/tickets/{tracked}/classification',dict(type_id=financial,priority_id=priority),'PATCH');assert r.status_code==200 and r.json()['routing_warning'] and r.json()['group_id']==str(group) and r.json()['assigned_id']==str(ids[2])
            post(clients[2],f'staff/tickets/{tracked}/classification',dict(type_id=type_id,priority_id=2),'PATCH')
            untyped=q('INSERT INTO {loai_ho_tro}(ten) VALUES(%s) RETURNING ht_ma',('Unmapped fixture '+prefix,)).fetchone()['ht_ma']
            r=post(clients[0],'customer/tickets',dict(title='Chờ điều phối',description='Fixture chưa có nhóm',type_id=untyped));assert r.status_code==201;unmapped=r.json()['id']
            assert approve(clients[2],unmapped).status_code==404
            assert clients[2].get('/api/v1/staff/overview').json()['unrouted']>=1
            empty_group=q('INSERT INTO {nhom_ho_tro}(ten) VALUES(%s) RETURNING nhom_ma',('Empty fixture '+prefix,)).fetchone()['nhom_ma']
            q('INSERT INTO {xu_ly_mac_dinh}(ht_ma,nhom_ma) VALUES(%s,%s)',(untyped,empty_group))
            assert clients[2].get('/api/v1/staff/overview').json()['unrouted']>=1
            assert q('SELECT nhan_vien_phu_trach_ma FROM {phieu_ho_tro} WHERE phieu_ma=%s',(unmapped,)).fetchone()['nhan_vien_phu_trach_ma'] is None
            q('UPDATE {nhom_ho_tro} SET dang_hoat_dong=false WHERE nhom_ma=%s',(group,))
            assert post(clients[2],f'staff/tickets/{tracked}/messages',dict(content='Không nhận nhóm ngừng hoạt động')).status_code==403
            q('UPDATE {nhom_ho_tro} SET dang_hoat_dong=true WHERE nhom_ma=%s',(group,))
            q('DELETE FROM {nhan_vien} WHERE nd_ma=%s',(ids[4],))
            assert clients[4].get('/api/v1/staff/overview').status_code==409
            q('INSERT INTO {nhan_vien}(nd_ma) VALUES(%s)',(ids[4],))
            token=clients[2].get('/api/v1/auth/csrf').json()['csrf_token']
            q("UPDATE {nguoi_dung} SET trang_thai='KHOA' WHERE nd_ma=%s",(ids[2],))
            assert clients[2].get('/api/v1/auth/csrf').status_code==401
            assert clients[2].post(f'/api/v1/staff/tickets/{created}/approve',json={},
                                   headers={**origin,'X-CSRF-Token':token}).status_code==401
            print('PASS E: stored SLA only; missing/within/soon/overdue; own dashboard count; ID/type/status/priority filters; invalid dates; locked user blocked.')
            if args.browser:
                q("UPDATE {nguoi_dung} SET trang_thai='HOAT_DONG' WHERE nd_ma=%s",(ids[2],))
                fixtures={}
                for project in ['desktop','mobile']:
                    queued=create()
                    fixtures[project]={'ticket_id':queued,'staff_email':f'{prefix}-2@example.com','customer_email':f'{prefix}-0@example.com','customer_id':str(ids[0]),'type_id':str(type_id)}
                run_browser(fixtures,password)


def run_browser(fixtures,password):
    import uvicorn
    from api.routes.auth import _attempts
    _attempts.clear()
    environment={**os.environ,'HELPDESK_PHASE3_PASSWORD':password,'HELPDESK_PHASE3_FIXTURES':json.dumps(fixtures)}
    with patch.dict(os.environ,{'FRONTEND_ORIGINS':os.getenv('FRONTEND_ORIGINS','http://localhost:5173')+',http://localhost:5174'}):
        server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8001,log_level='error'))
        worker=threading.Thread(target=server.run,daemon=True);worker.start()
        try:
            for _ in range(100):
                if server.started or not worker.is_alive():break
                time.sleep(.05)
            assert server.started,'Không mở được backend kiểm thử 8001.'
            result=subprocess.run(['npm.cmd','exec','--','playwright','test','--config','playwright.phase3.config.ts'],cwd=BASE_DIR/'frontend',env=environment,check=False)
            assert result.returncode==0,'Phase3 browser failed'
        finally:
            server.should_exit=True;worker.join(timeout=10)


def counts():
    with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
        result={}
        for table in service.TABLES:
            service.execute(cur,'SELECT count(*) n FROM {'+table+'}')
            result[table]=cur.fetchone()['n']
        if service.read_receipts_available(cur):
            service.execute(cur,'SELECT count(*) n FROM {staff_message_read}')
            result['staff_message_read']=cur.fetchone()['n']
        return result


if __name__=='__main__':
    baseline=counts()
    try:main()
    finally:
        assert counts()==baseline,'Số bản ghi thay đổi ngoài transaction kiểm thử; cần kiểm tra.'
        print('PASS rollback verification: record counts unchanged across all phase3 tables; no sequence reset.')
