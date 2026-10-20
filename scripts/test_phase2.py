"""Opt-in PostgreSQL integration tests; every fixture is rolled back."""
import argparse
from contextlib import contextmanager
from pathlib import Path
import json
import os
import secrets
import subprocess
import sys
import threading
import time
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from psycopg import sql
from core.database import BASE_DIR, database_schema, get_connection
from core.security import PASSWORD_HASHER
from api.routes.auth import _attempts, _registrations
from services import auth_service
from main import app


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--execute',action='store_true')
    parser.add_argument('--stage',choices=list('ABCDE'),default='A')
    parser.add_argument('--browser',action='store_true')
    args=parser.parse_args()
    if not args.execute:
        parser.error('Cần --execute để kiểm thử với dữ liệu tạm rollback; không seed dữ liệu sử dụng.')
    prefix=secrets.token_hex(10)
    password=secrets.token_urlsafe(24)+'!9'
    origin={'Origin':'http://localhost:5173'}
    body={'name':'Khách kiểm thử','email':f'{prefix}@example.com','phone':None,'password':password,'password_confirmation':password}
    _attempts.clear();_registrations.clear()
    with get_connection() as conn:
        schema=database_schema()
        gate=threading.RLock()
        checked_tables=['nguoi_dung','khach_hang','nhan_vien','quan_tri_vien','phieu_ho_tro','tin_nhan','tep_dinh_kem','lich_su_trang_thai','danh_gia']
        def counts():
            values={}
            with conn.cursor() as cur:
                for name in checked_tables:
                    cur.execute(sql.SQL('SELECT count(*) FROM {}').format(sql.Identifier(schema,name)))
                    values[name]=cur.fetchone()[0]
            return values
        baseline=counts()
        with conn.transaction(force_rollback=True):
            @contextmanager
            def connection():
                with gate, conn.transaction():
                    yield conn
            with patch.object(auth_service,'get_connection',connection), TestClient(app,raise_server_exceptions=False) as client:
                r=client.post('/api/v1/auth/register',json=body,headers=origin)
                assert r.status_code==201, f'register HTTP {r.status_code}'
                assert 'set-cookie' not in r.headers and password not in r.text
                with conn.cursor() as cur:
                    cur.execute(sql.SQL('SELECT n.nd_ma,n.mat_khau_hash,n.vai_tro,k.nd_ma FROM {} n LEFT JOIN {} k USING(nd_ma) WHERE email=%s').format(sql.Identifier(schema,'nguoi_dung'),sql.Identifier(schema,'khach_hang')),(body['email'],))
                    user_id, encoded, role, profile_id=cur.fetchone()
                    assert user_id==profile_id and role=='KHACH_HANG' and encoded.startswith('$argon2id$') and PASSWORD_HASHER.verify(encoded,password)
                assert client.post('/api/v1/auth/register',json={**body,'email':body['email'].upper()},headers=origin).status_code==409
                for invalid in [{}, {**body,'email':'bad@domain..com'}, {**body,'phone':'       '}, {**body,'password':'123456789012','password_confirmation':'123456789012'}, {**body,'password_confirmation':'different'}, {**body,'vai_tro':'QUAN_TRI_VIEN'}, {**body,'vai_tro':'NHAN_VIEN'}, {**body,'role':'staff'}, {**body,'nd_ma':123}]:
                    response=client.post('/api/v1/auth/register',json=invalid,headers=origin)
                    assert response.status_code==422 and password not in response.text
                assert client.post('/api/v1/auth/register',json=body).status_code==403
                assert client.post('/api/v1/auth/register',json=body,headers={'Origin':'https://untrusted.example'}).status_code==403
                failed_email=f'rollback-{prefix}@example.com'
                with patch.object(auth_service,'create_customer_profile',side_effect=RuntimeError('injected profile failure')):
                    assert client.post('/api/v1/auth/register',json={**body,'email':failed_email},headers=origin).status_code==500
                with conn.cursor() as cur:
                    cur.execute(sql.SQL('SELECT count(*) FROM {} WHERE email=%s').format(sql.Identifier(schema,'nguoi_dung')),(failed_email,))
                    assert cur.fetchone()[0]==0
                login=client.post('/api/v1/auth/login',json={'email':body['email'],'password':password},headers=origin)
                assert login.status_code==200 and login.json()['user']['role']=='customer'
                assert client.get('/api/v1/auth/me').json()['user']['id']==str(user_id)
                assert client.get('/api/v1/manager/dashboard').status_code==403
                assert client.post('/api/v1/auth/login',json={'email':body['email'],'password':'wrong'},headers=origin).status_code==401
                _registrations.clear()
                for _ in range(5):
                    assert client.post('/api/v1/auth/register',json=body,headers=origin).status_code==409
                assert client.post('/api/v1/auth/register',json=body,headers=origin).status_code==429
                _registrations.clear()
                print('PASS A: register/login/me, Argon2id, duplicate/case, validation/role injection, Origin, atomic rollback')
                if args.stage!='A':
                    run_customer_stages(args.stage,conn,client,connection,user_id,body,password,origin,args.browser)
        assert counts()==baseline,'test records did not fully roll back'
        with conn.cursor() as cur:
            cur.execute(sql.SQL('SELECT count(*) FROM {} WHERE email LIKE %s').format(sql.Identifier(schema,'nguoi_dung')),(f'%{prefix}%',))
            assert cur.fetchone()[0]==0
        print('PASS cleanup: all test accounts/data rolled back (identity sequences may advance)')


def run_customer_stages(stage,conn,client,connection,user_id,body,password,origin,browser=False):
    from services import customer_service as service
    with patch.object(service,'get_connection',connection):
        headers={**origin,'X-CSRF-Token':client.get('/api/v1/auth/csrf').json()['csrf_token']}
        types=client.get('/api/v1/customer/ticket-types')
        assert types.status_code==200 and types.json()
        payload={'title':'Kiểm thử tạo phiếu','description':'Nội dung kiểm thử thực tế','type_id':int(types.json()[0]['id'])}
        assert client.post('/api/v1/customer/tickets',json=payload,headers=origin).status_code==403
        assert client.post('/api/v1/customer/tickets',json={**payload,'khach_hang_ma':user_id},headers=headers).status_code==422
        assert client.post('/api/v1/customer/tickets',json={**payload,'type_id':9223372036854775807},headers=headers).status_code==422
        result=client.post('/api/v1/customer/tickets',json=payload,headers=headers)
        assert result.status_code==201, f'create ticket HTTP {result.status_code}'
        ticket=result.json()
        assert ticket['status']=='MOI'
        with conn.cursor() as cur:
            service.execute(cur,'SELECT khach_hang_ma,nguon_tao,mdut_ma FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket['id'],))
            owner,source,priority=cur.fetchone()
            assert owner==user_id and source=='KHACH_HANG'
            service.execute(cur,'SELECT count(*) FROM {lich_su_trang_thai} WHERE phieu_ma=%s AND tt_cu_ma IS NULL',(ticket['id'],))
            assert cur.fetchone()[0]==1
            service.execute(cur,'SELECT count(*) FROM {phieu_ho_tro} WHERE khach_hang_ma=%s',(user_id,))
            count=cur.fetchone()[0]
        with patch.object(service,'add_history',side_effect=RuntimeError('injected history failure')):
            assert client.post('/api/v1/customer/tickets',json=payload,headers=headers).status_code==500
        with conn.cursor() as cur:
            service.execute(cur,'SELECT count(*) FROM {phieu_ho_tro} WHERE khach_hang_ma=%s',(user_id,))
            assert cur.fetchone()[0]==count
        print('PASS B: catalogs, ticket MOI/source/owner, initial history, CSRF, ID injection, FK and atomic rollback')
        if stage!='B':
            run_remaining_stages(stage,conn,client,connection,user_id,body,password,origin,headers,ticket,payload,browser)


def run_remaining_stages(stage,conn,client,connection,user_id,body,password,origin,headers,ticket,payload,browser=False):
    from services import customer_service as service
    second={**body,'email':'other-'+body['email']}
    assert client.post('/api/v1/auth/register',json=second,headers=origin).status_code==201
    with TestClient(app,raise_server_exceptions=False) as other:
        assert other.post('/api/v1/auth/login',json={'email':second['email'],'password':password},headers=origin).status_code==200
        other_headers={**origin,'X-CSRF-Token':other.get('/api/v1/auth/csrf').json()['csrf_token']}
        other_ticket=other.post('/api/v1/customer/tickets',json={**payload,'title':'Phiếu riêng khách B'},headers=other_headers).json()
        result=client.get('/api/v1/customer/tickets').json()
        assert result['total']==1 and result['items'][0]['id']==ticket['id']
        assert client.get('/api/v1/customer/overview').json()['total']==1
        assert client.get('/api/v1/customer/tickets',params={'search':"' OR 1=1--"}).json()['total']==0
        assert client.get('/api/v1/customer/tickets',params={'search':'Kiểm thử','type':payload['type_id'],'status':'MOI','page_size':1}).json()['total']==1
        assert client.get('/api/v1/customer/tickets',params={'page':2,'page_size':1}).json()['items']==[]
        assert client.get('/api/v1/customer/tickets',params={'from':'2030-01-01','to':'2020-01-01'}).status_code==422
        assert client.get(f"/api/v1/customer/tickets/{other_ticket['id']}").status_code==404
        assert other.get(f"/api/v1/customer/tickets/{ticket['id']}").status_code==404
        detail=client.get(f"/api/v1/customer/tickets/{ticket['id']}")
        assert detail.status_code==200 and len(detail.json()['history'])==1
        assert 'mat_khau' not in detail.text and 'duong_dan' not in detail.text
        print('PASS C: two owners isolated, title/type/status/date filters, pagination, SQL injection, detail 404')
        if stage!='C':
            run_final_stages(stage,conn,client,other,headers,other_headers,ticket,other_ticket,body,user_id,browser)


def run_final_stages(stage,conn,client,other,headers,other_headers,ticket,other_ticket,body,user_id,browser=False):
    import io
    import os
    import tempfile
    from PIL import Image
    from pypdf import PdfWriter
    from services import customer_service as service
    base=f"/api/v1/customer/tickets/{ticket['id']}"
    assert client.post(base+'/messages',json={'content':'hello'},headers={'Origin':'http://localhost:5173'}).status_code==403
    assert client.post(base+'/messages',json={'content':'Phản hồi công khai'},headers=headers).status_code==201
    assert other.post(base+'/messages',json={'content':'cross owner'},headers=other_headers).status_code==404
    with conn.cursor() as cur:
        service.execute(cur,'INSERT INTO {tin_nhan} (phieu_ma,nguoi_gui_ma,noi_dung,la_ghi_chu_noi_bo) VALUES (%s,%s,%s,true)',(ticket['id'],user_id,'PRIVATE-INTERNAL-NOTE'))
    response=client.get(base)
    assert 'PRIVATE-INTERNAL-NOTE' not in response.text and len(response.json()['messages'])==1
    with tempfile.TemporaryDirectory(prefix='helpdesk-test-') as directory, patch.dict(os.environ,{'UPLOAD_DIR':directory}):
        result=client.post(base+'/attachments',files={'file':('test.txt',b'Xin chao','text/plain')},headers=headers)
        assert result.status_code==201, f'upload {result.status_code}'
        attachment=result.json()
        assert 'duong_dan' not in result.text and directory not in result.text
        path=base+'/attachments/'+attachment['id']
        download=client.get(path)
        assert download.status_code==200 and download.content==b'Xin chao' and 'attachment;' in download.headers['content-disposition']
        assert other.get(path).status_code==404
        assert other.post(base+'/attachments',files={'file':('test.txt',b'data','text/plain')},headers=other_headers).status_code==404
        for name,content,mime,expected in [('tool.exe',b'bad','application/octet-stream',415),('../secret.txt',b'data','text/plain',422),('fake.png',b'not png','image/png',415)]:
            assert client.post(base+'/attachments',files={'file':(name,content,mime)},headers=headers).status_code==expected
        with patch.dict(os.environ,{'UPLOAD_MAX_BYTES':'1024'}):
            assert client.post(base+'/attachments',files={'file':('big.txt',b'x'*1025,'text/plain')},headers=headers).status_code==413
            assert client.post(base+'/attachments',content=iter([b'x'*70000]),headers={**headers,'Content-Type':'multipart/form-data; boundary=test'}).status_code==413
        before=set(Path(directory).iterdir())
        with patch.object(service,'insert_attachment',side_effect=RuntimeError('metadata failure')):
            assert client.post(base+'/attachments',files={'file':('failure.txt',b'data','text/plain')},headers=headers).status_code==500
        assert set(Path(directory).iterdir())==before
        picture=io.BytesIO();Image.new('RGB',(2,2)).save(picture,format='PNG')
        assert client.post(base+'/attachments',files={'file':('image.png',picture.getvalue(),'image/png')},headers=headers).status_code==201
        pdf=io.BytesIO();writer=PdfWriter();writer.add_blank_page(width=10,height=10);writer.write(pdf)
        assert client.post(base+'/attachments',files={'file':('document.pdf',pdf.getvalue(),'application/pdf')},headers=headers).status_code==201
        print('PASS D: public messages, private-note filtering, upload/download TXT/PNG/PDF, 404 ownership, MIME/content/path/size/stream limits, disk cleanup')
        if stage!='D':
            run_stage_e(conn,client,other,headers,other_headers,ticket,user_id,base)
            if browser:
                run_browser(conn,body,body['password'])


def run_stage_e(conn,client,other,headers,other_headers,ticket,user_id,base):
    from services import customer_service as service
    from core.security import COOKIE_NAME, issue_session
    assert client.patch('/api/v1/customer/profile',json={'name':'Changed'}).status_code==403
    for invalid in [{'vai_tro':'QUAN_TRI_VIEN'},{'email':'changed@example.invalid'},{'name':None},{}]:
        assert client.patch('/api/v1/customer/profile',json=invalid,headers=headers).status_code==422
    result=client.patch('/api/v1/customer/profile',json={'name':'Tên đã cập nhật','phone':'+84901234567','gender':'KHAC'},headers=headers)
    assert result.status_code==200 and result.json()['name']=='Tên đã cập nhật'
    assert client.get('/api/v1/auth/me').json()['user']['name']=='Tên đã cập nhật'
    assert client.post(base+'/close',json={},headers=headers).status_code==409
    assert client.post(base+'/rating',json={'stars':5},headers=headers).status_code==409
    assert other.post(base+'/close',json={},headers=other_headers).status_code==404
    assert other.post(base+'/rating',json={'stars':5},headers=other_headers).status_code==404
    with conn.cursor() as cur:
        service.execute(cur,"UPDATE {phieu_ho_tro} SET tt_ma=(SELECT tt_ma FROM {trang_thai} WHERE ma='DA_GIAI_QUYET'),ngay_giai_quyet=now() WHERE phieu_ma=%s",(ticket['id'],))
    assert client.post(base+'/messages',json={'content':'blocked'},headers=headers).status_code==409
    with patch.object(service,'add_history',side_effect=RuntimeError('close history failure')):
        assert client.post(base+'/close',json={},headers=headers).status_code==500
    detail=client.get(base).json()
    assert detail['status']=='DA_GIAI_QUYET' and detail['closed_at'] is None
    result=client.post(base+'/close',json={},headers=headers)
    assert result.status_code==200 and result.json()['status']=='DA_DONG' and result.json()['closed_at']
    assert client.post(base+'/close',json={},headers=headers).status_code==409
    assert client.get(base+'/close').status_code==405
    assert client.post(base+'/attachments',files={'file':('closed.txt',b'test','text/plain')},headers=headers).status_code==409
    assert client.post(base+'/rating',json={'stars':0},headers=headers).status_code==422
    assert client.post(base+'/rating',json={'stars':5,'comment':'Ho tro tot'},headers=headers).status_code==201
    assert client.post(base+'/rating',json={'stars':4},headers=headers).status_code==409
    assert client.post('/api/v1/auth/register',content=b'x'*131073,headers={'Origin':'http://localhost:5173','Content-Type':'application/json'}).status_code==413
    with conn.cursor() as cur:
        service.execute(cur,'SELECT khach_hang_ma,so_sao FROM {danh_gia} WHERE phieu_ma=%s',(ticket['id'],))
        assert cur.fetchone()==(user_id,5)
        # Controlled role fixtures only; all rolled back, no public staff/manager registration.
        for stored,profile in [('NHAN_VIEN','nhan_vien'),('QUAN_TRI_VIEN','quan_tri_vien')]:
            email=f'{secrets.token_hex(10)}@example.invalid'
            service.execute(cur,'INSERT INTO {nguoi_dung} (ho_ten,email,mat_khau_hash,vai_tro) VALUES (%s,%s,%s,%s) RETURNING nd_ma',('Role fixture',email,PASSWORD_HASHER.hash(secrets.token_urlsafe(24)),stored))
            uid=cur.fetchone()[0]
            cur.execute(sql.SQL('INSERT INTO {} (nd_ma) VALUES (%s)').format(sql.Identifier(database_schema(),profile)),(uid,))
            with TestClient(app,raise_server_exceptions=False) as forbidden:
                token,csrf=issue_session(str(uid));forbidden.cookies.set(COOKIE_NAME,token,path='/api/v1')
                for path in ['/api/v1/customer/overview','/api/v1/customer/tickets','/api/v1/customer/profile',base]:
                    assert forbidden.get(path).status_code==403
                assert forbidden.post('/api/v1/customer/tickets',json={'title':'x','description':'x','type_id':1},headers={'Origin':'http://localhost:5173','X-CSRF-Token':csrf}).status_code==403
        service.execute(cur,'INSERT INTO {nguoi_dung} (ho_ten,email,mat_khau_hash,vai_tro) VALUES (%s,%s,%s,%s) RETURNING nd_ma',('Missing profile',f'{secrets.token_hex(10)}@example.com',PASSWORD_HASHER.hash(secrets.token_urlsafe(24)),'KHACH_HANG'))
        uid=cur.fetchone()[0]
        with TestClient(app,raise_server_exceptions=False) as missing:
            token,_=issue_session(str(uid));missing.cookies.set(COOKIE_NAME,token,path='/api/v1')
            assert missing.get('/api/v1/customer/profile').status_code==409
    print('PASS E: profile whitelist/CSRF, resolved-only close with atomic history, closed-only one-time owner rating, staff/manager forbidden')


def run_browser(conn,body,password):
    import uvicorn
    from schemas.auth import RegisterRequest
    from schemas.customer import TicketCreate
    from services import customer_service as service
    fixtures={}
    for project in ['desktop','mobile']:
        email=f"closed-{project}-{body['email']}"
        auth_service.register(RegisterRequest(**{**body,'email':email}))
        account=auth_service.find_account(email=email)
        types=service.catalog(account['nd_ma'],'types')
        ticket=service.create_ticket(account['nd_ma'],TicketCreate(title='Phiếu đã giải quyết để kiểm thử',description='Fixture rollback, không phải dữ liệu sử dụng',type_id=int(types[0]['id'])))
        with conn.cursor() as cur:
            service.execute(cur,"UPDATE {phieu_ho_tro} SET tt_ma=(SELECT tt_ma FROM {trang_thai} WHERE ma='DA_GIAI_QUYET'),ngay_giai_quyet=now() WHERE phieu_ma=%s",(ticket['id'],))
        fixtures[project]={'email':email,'ticket_id':ticket['id']}
    _attempts.clear();_registrations.clear()
    environment=os.environ.copy()
    environment['HELPDESK_PHASE2_PASSWORD']=password
    environment['HELPDESK_PHASE2_FIXTURES']=json.dumps(fixtures)
    with patch.dict(os.environ,{'FRONTEND_ORIGINS':os.getenv('FRONTEND_ORIGINS','http://localhost:5173')+',http://localhost:5174'}):
        server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8001,log_level='error'))
        worker=threading.Thread(target=server.run,daemon=True);worker.start()
        try:
            for _ in range(100):
                if server.started or not worker.is_alive():break
                time.sleep(.05)
            assert server.started,'test backend did not start'
            result=subprocess.run(['npm.cmd','exec','--','playwright','test','--config','playwright.phase2.config.ts'],cwd=BASE_DIR/'frontend',env=environment,check=False)
            assert result.returncode==0,'phase2 browser tests failed'
        finally:
            server.should_exit=True;worker.join(timeout=10)


if __name__=='__main__':
    main()
