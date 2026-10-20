"""Opt-in UX integration tests, real PostgreSQL fixtures in a rollback transaction."""
import argparse
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
import os
import secrets
import sys
import threading
import io
import json
import subprocess
import time
from PIL import Image
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from psycopg.rows import dict_row
from core.database import get_connection,BASE_DIR
from api.routes.auth import _attempts,_registrations
from core.security import PASSWORD_HASHER
from services import auth_service,customer_service,staff_service,manager_service
from main import app


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--stage',choices=list('ABCDE'),default='A');parser.add_argument('--browser',action='store_true');args=parser.parse_args()
    if not args.execute:parser.error('Cần --execute, chỉ ghi fixture rollback, không seed dữ liệu sử dụng.')
    prefix=secrets.token_hex(12);password=secrets.token_urlsafe(24)+'!9';origin={'Origin':'http://localhost:5173'}
    with TemporaryDirectory(prefix='helpdesk-ux-') as tmp,patch.dict(os.environ,{'UPLOAD_DIR':str(Path(tmp)/'uploads'),'MANAGER_AUDIT_DIR':tmp}),get_connection() as conn,conn.transaction(force_rollback=True),conn.cursor(row_factory=dict_row) as cur:
        gate=threading.RLock()
        @contextmanager
        def connection():
            with gate,conn.transaction():yield conn
        def q(statement,params=()):staff_service.execute(cur,statement,params);return cur
        users=[]
        for i,role in enumerate(['KHACH_HANG','KHACH_HANG','NHAN_VIEN','NHAN_VIEN','QUAN_TRI_VIEN']):
            uid=q('INSERT INTO {nguoi_dung}(ho_ten,email,mat_khau_hash,vai_tro) VALUES(%s,%s,%s,%s) RETURNING nd_ma',('UX fixture '+str(i),f'ux-{prefix}-{i}@example.com',PASSWORD_HASHER.hash(password),role)).fetchone()['nd_ma'];users.append(uid)
            manager_service.execute(cur,'INSERT INTO {'+{'KHACH_HANG':'khach_hang','NHAN_VIEN':'nhan_vien','QUAN_TRI_VIEN':'quan_tri_vien'}[role]+'}(nd_ma) VALUES(%s)',(uid,))
        group=q('INSERT INTO {nhom_ho_tro}(ten) VALUES(%s) RETURNING nhom_ma',('UX fixture '+prefix,)).fetchone()['nhom_ma']
        kind=q('INSERT INTO {loai_ho_tro}(ten) VALUES(%s) RETURNING ht_ma',('Bảo hành sofa UX '+prefix,)).fetchone()['ht_ma']
        q('INSERT INTO {xu_ly_mac_dinh}(ht_ma,nhom_ma) VALUES(%s,%s)',(kind,group))
        for uid in users[2:4]:q('INSERT INTO {thanh_vien_nhom}(nhom_ma,nhan_vien_ma) VALUES(%s,%s)',(group,uid))
        with patch.object(auth_service,'get_connection',connection),patch.object(customer_service,'get_connection',connection),patch.object(staff_service,'get_connection',connection),patch.object(manager_service,'get_connection',connection):
            clients=[]
            for i in range(5):
                c=TestClient(app,raise_server_exceptions=False);r=c.post('/api/v1/auth/login',json=dict(email=f'ux-{prefix}-{i}@example.com',password=password),headers=origin);assert r.status_code==200,r.text;clients.append(c)
            customer,other,employee,recipient,manager=clients
            def post(client,path,body=None):
                token=client.get('/api/v1/auth/csrf').json()['csrf_token'];return client.post('/api/v1/'+path,json=body,headers={**origin,'X-CSRF-Token':token})
            r=post(customer,'customer/tickets',dict(title='Bảo hành sofa UX',description='Fixture hội thoại',type_id=kind));assert r.status_code==201;ticket=r.json()['id']
            url=f'/api/v1/customer/tickets/{ticket}/conversation'
            r=customer.get(url);assert r.status_code==200,r.text;assert r.json()['can_send'] and r.json()['assigned_id'] is None
            assert other.get(url).status_code==404
            assert other.get(f'/api/v1/staff/tickets/{ticket}/conversation').status_code==403
            assert post(customer,f'customer/tickets/{ticket}/messages',dict(content='Khách bổ sung thông tin')).status_code==201
            assert post(employee,f'staff/tickets/{ticket}/accept').status_code==200
            r=customer.get(url).json();assert r['assigned_id']==str(users[2]) and any('đã tiếp nhận' in e['content'] for e in r['events'])
            assert post(employee,f'staff/tickets/{ticket}/messages',dict(content='Ghi chú nội bộ tuyệt đối riêng',internal=True)).status_code==201
            assert post(employee,f'staff/tickets/{ticket}/messages',dict(content='Phản hồi công khai',internal=False)).status_code==201
            public=customer.get(url);assert 'tuyệt đối riêng' not in public.text and len(public.json()['messages'])==2 and all(not m['internal'] for m in public.json()['messages'])
            assert len(employee.get(f'/api/v1/staff/tickets/{ticket}/conversation').json()['messages'])==3
            last=public.json()['messages'][-1]['id']
            for i in range(110):q('INSERT INTO {tin_nhan}(phieu_ma,nguoi_gui_ma,noi_dung,la_ghi_chu_noi_bo) VALUES(%s,%s,%s,false)',(ticket,users[0],f'Tin cũ fixture {i}'))
            first=customer.get(url,params={'after':last}).json();assert len(first['messages'])==100 and first['has_more']
            second=customer.get(url,params={'after':first['messages'][-1]['id']}).json();assert len(second['messages'])==10 and not second['has_more']
            latest=customer.get(url).json();older=customer.get(url,params={'before':latest['messages'][0]['id']}).json();assert latest['has_older'] and len(older['messages'])==12
            assert len({m['id'] for m in latest['messages']+older['messages']})==112
            assert customer.get(url,params={'after':last,'before':last}).status_code==422
            d=employee.get('/api/v1/staff/tickets/'+ticket).json()
            assert post(employee,f'staff/tickets/{ticket}/transfer',dict(employee_id=users[3],assignment_id=d['assignment_id'])).status_code==200
            transferred=customer.get(url).json();assert transferred['assigned_id']==str(users[3]) and len(transferred['messages'])==100 and len(transferred['events'])>len(r['events'])
            assert employee.get(f'/api/v1/staff/tickets/{ticket}/conversation').json()['can_send'] is False
            assert recipient.get(f'/api/v1/staff/tickets/{ticket}/conversation').json()['can_send'] is True
            print('PASS A: owner/role isolation; feed from creation; accepted/transferred events and current assignee; internal-note filtering before cursors; incremental/older pagination and unique IDs; former assignee read-only.')
            if args.stage=='A':return
            image=io.BytesIO();Image.new('RGB',(12,8),'teal').save(image,format='PNG');content=image.getvalue()
            token=recipient.get('/api/v1/auth/csrf').json()['csrf_token'];headers={**origin,'X-CSRF-Token':token}
            r=recipient.post(f'/api/v1/staff/tickets/{ticket}/attachments',files={'file':('Ảnh chân sofa.png',content,'image/png')},headers=headers);assert r.status_code==201,r.text;file_id=r.json()['id']
            feed=customer.get(url).json();file=next(a for a in feed['attachments'] if a['id']==file_id);assert file['name']=='Ảnh chân sofa.png' and file['size']==len(content) and file['sender_id']==str(users[3])
            preview=f'/api/v1/customer/tickets/{ticket}/attachments/{file_id}/preview'
            r=customer.get(preview);assert r.status_code==200 and r.content==content and r.headers['content-type']=='image/png' and r.headers['content-disposition'].startswith('inline') and r.headers['cache-control']=='no-store'
            assert other.get(preview).status_code==404
            assert manager.get(f'/api/v1/manager/tickets/{ticket}/attachments/{file_id}/preview').content==content
            assert customer.get(f'/api/v1/customer/tickets/{ticket}/attachments/{file_id}').content==content
            q('UPDATE {tep_dinh_kem} SET ten=%s WHERE tep_ma=%s',('a'*32+'.png',file_id))
            assert customer.get(url).json()['attachments'][0]['name']=='Tệp đính kèm.png'
            assert 'duong_dan' not in customer.get(url).text
            r=recipient.post(f'/api/v1/staff/tickets/{ticket}/attachments',files={'file':('Biên bản.txt',b'Bien ban sofa','text/plain')},headers=headers);assert r.status_code==201;text_id=r.json()['id']
            assert customer.get(f'/api/v1/customer/tickets/{ticket}/attachments/{text_id}/preview').status_code==415
            assert customer.get(f'/api/v1/customer/tickets/{ticket}/attachments/{text_id}').content==b'Bien ban sofa'
            assert recipient.post(f'/api/v1/staff/tickets/{ticket}/attachments',files={'file':('../bad.png',content,'image/png')},headers=headers).status_code==422
            assert recipient.post(f'/api/v1/staff/tickets/{ticket}/attachments',files={'file':('fake.png',b'fake','image/png')},headers=headers).status_code==415
            print('PASS B: original Unicode filenames, size/uploader; authenticated inline PNG preview; BOLA; non-image415; download exact bytes; legacy-key display fallback; traversal/fake image blocked.')
            if args.stage=='B':return
            if args.stage=='E':
                before=q('SELECT count(*) n FROM {chinh_sach_sla}').fetchone()['n']
                priority=q('SELECT mdut_ma FROM {muc_do_uu_tien} ORDER BY mdut_ma LIMIT 1').fetchone()['mdut_ma']
                body=dict(name='UX invalid SLA',priority_id=priority,response_minutes=120,resolution_minutes=60,active=False)
                r=post(manager,'manager/sla',body);assert r.status_code==422
                assert q('SELECT count(*) n FROM {chinh_sach_sla}').fetchone()['n']==before
                assert post(customer,'manager/sla',{**body,'resolution_minutes':120}).status_code==403
                print('PASS E API: resolution below response rejected422 without inserting policy; customer forbidden403. Existing schema validation retained.')
            if args.browser:
                fixtures={}
                for project in ['desktop','mobile']:
                    r=post(customer,'customer/tickets',dict(title='Hội thoại trình duyệt '+project,description='Fixture UX rollback',type_id=kind));assert r.status_code==201;tid=r.json()['id']
                    for i in range(110):q('INSERT INTO {tin_nhan}(phieu_ma,nguoi_gui_ma,noi_dung) VALUES(%s,%s,%s)',(tid,users[0],f'Tin cũ {i} fixture'))
                    fixtures[project]=dict(ticket_id=tid,customer=f'ux-{prefix}-0@example.com',staff=f'ux-{prefix}-2@example.com',manager=f'ux-{prefix}-4@example.com',recipient_id=str(users[3]),recipient=f'ux-{prefix}-3@example.com',png=__import__('base64').b64encode(content).decode())
                run_browser(fixtures,password,args.stage)


def run_browser(fixtures,password,stage):
    import uvicorn
    _attempts.clear();_registrations.clear()
    env={**os.environ,'HELPDESK_UX_PASSWORD':password,'HELPDESK_UX_FIXTURES':json.dumps(fixtures),'HELPDESK_UX_STAGE':stage}
    with patch.dict(os.environ,{'FRONTEND_ORIGINS':os.getenv('FRONTEND_ORIGINS','http://localhost:5173')+',http://localhost:5174'}):
        server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8001,log_level='error'));worker=threading.Thread(target=server.run,daemon=True);worker.start()
        try:
            for _ in range(100):
                if server.started or not worker.is_alive():break
                time.sleep(.05)
            assert server.started
            result=subprocess.run(['npm.cmd','exec','--','playwright','test','--config','playwright.ux.config.ts'],cwd=BASE_DIR/'frontend',env=env,check=False)
            assert result.returncode==0,'UX browser failed'
        finally:server.should_exit=True;worker.join(timeout=10)


def counts():
    with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
        result={}
        for table in manager_service.TABLES:
            manager_service.execute(cur,'SELECT count(*) n FROM {'+table+'}');result[table]=cur.fetchone()['n']
        return result


if __name__=='__main__':
    baseline=counts()
    try:main()
    finally:
        assert counts()==baseline,'Fixture count mismatch.'
        print('PASS cleanup: all record counts unchanged, no sequence reset.')
