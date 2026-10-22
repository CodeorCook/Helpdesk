"""Real PostgreSQL/API/browser; only the outbound Gemini call is a controlled double."""
import argparse,json,os,secrets,sys,threading,time,subprocess
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from fastapi import HTTPException
from psycopg.rows import dict_row
from google import genai
from core.database import get_connection,BASE_DIR
from core.security import PASSWORD_HASHER
from services import auth_service,customer_service,staff_service,manager_service,chatbot_service,gemini_service
from services.faq_service import execute
from scripts.seed_phase5_faq import seed,document
from api.routes.auth import _attempts,_registrations
from main import app

TABLES=(*manager_service.TABLES,'cau_hoi_mau','phien_chat','tin_nhan_chatbot')
def counts():
    with get_connection() as c,c.cursor() as q:
        from psycopg import sql
        from core.database import database_schema
        result={}
        for t in set(TABLES):q.execute(sql.SQL('SELECT count(*) FROM {}').format(sql.Identifier(database_schema(),t)));result[t]=q.fetchone()[0]
        return result

class Provider:
    calls=[];mode='normal';kind=None;started=None;release=None
    def __init__(self,**kwargs):
        assert kwargs['api_key']=='phase5-fake-key-not-real' and kwargs['vertexai'] is False
        assert kwargs['http_options'].timeout==20000 and kwargs['http_options'].retry_options.attempts==1
        self.models=self
    def __enter__(self):return self
    def __exit__(self,*a):pass
    def generate_content(self,**kwargs):
        assert kwargs['model']=='phase5-fixture-model-not-a-real-name'
        assert kwargs['config'].response_schema is not None and kwargs['config'].automatic_function_calling.disable
        data=json.loads(kwargs['contents']);Provider.calls.append(data)
        assert len(data['recent'])<=8 and len(data['faq'])<=4
        assert 'api_key' not in data and 'csrf_token' not in kwargs['contents']
        if Provider.mode=='slow':Provider.started.set();Provider.release.wait(5)
        if Provider.mode=='quota':
            from google.genai.errors import ClientError
            raise ClientError(429,{'error':{'message':'do-not-leak-provider-secret'}})
        if Provider.mode=='timeout':raise TimeoutError('do-not-leak-provider-secret')
        if Provider.mode=='bad':return SimpleNamespace(text='not-json')
        if Provider.mode=='inject':return SimpleNamespace(text=json.dumps(dict(answer='Không làm vậy.',offer_ticket=True,draft=None,customer_id=999)))
        draft=None
        if data['collecting']:draft=dict(title='Yêu cầu kiểm tra sofa',description='Sofa bị lún đệm bên trái. Cần nhân viên kiểm tra.',type_id=Provider.kind,missing_information=[],ready_for_confirmation=True)
        if Provider.mode=='invalid-type' and draft:draft['type_id']='0'
        return SimpleNamespace(text=json.dumps(dict(answer='Tôi chưa có chính sách bảo hành được xác nhận. Bạn có muốn lập bản nháp để nhân viên kiểm tra sofa không?',offer_ticket=True,draft=draft),ensure_ascii=False))

def main():
    p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');p.add_argument('--browser',action='store_true');args=p.parse_args()
    if not args.execute:p.error('Cần --execute; fixture rollback, tuyệt đối không seed tài khoản sử dụng.')
    prefix=secrets.token_hex(12);password=secrets.token_urlsafe(24)+'!9';origin={'Origin':'http://localhost:5173'}
    with get_connection() as conn,conn.transaction(force_rollback=True),conn.cursor(row_factory=dict_row) as cur,patch.dict(os.environ,{'GEMINI_KEY':'phase5-fake-key-not-real','GEMINI_MODEL':'phase5-fixture-model-not-a-real-name'}):
        gate=threading.RLock()
        @contextmanager
        def connection():
            with gate,conn.transaction():yield conn
        users=[]
        for i,role in enumerate(['KHACH_HANG','KHACH_HANG','NHAN_VIEN','QUAN_TRI_VIEN']):
            manager_service.execute(cur,'INSERT INTO {nguoi_dung}(ho_ten,email,mat_khau_hash,vai_tro) VALUES(%s,%s,%s,%s) RETURNING nd_ma',('Phase5 fixture '+str(i),f'p5-{prefix}-{i}@example.com',PASSWORD_HASHER.hash(password),role));uid=cur.fetchone()['nd_ma'];users.append(uid)
            manager_service.execute(cur,'INSERT INTO {'+{'KHACH_HANG':'khach_hang','NHAN_VIEN':'nhan_vien','QUAN_TRI_VIEN':'quan_tri_vien'}[role]+'}(nd_ma) VALUES(%s)',(uid,))
        customer_service.execute(cur,'SELECT ht_ma::text id FROM {loai_ho_tro} WHERE dang_hoat_dong ORDER BY (ten=%s) DESC,ht_ma LIMIT 1',('Bảo hành sản phẩm',));Provider.kind=cur.fetchone()['id']
        execute(cur,'INSERT INTO {cau_hoi_mau}(noi_dung,cau_tra_loi,dang_hoat_dong) VALUES(%s,%s,false) RETURNING ch_ma',('Sofa inactive fixture '+prefix,'NEVER SEND PRIVATE INACTIVE FAQ'));inactive=cur.fetchone()['ch_ma']
        with patch.object(auth_service,'get_connection',connection),patch.object(customer_service,'get_connection',connection),patch.object(staff_service,'get_connection',connection),patch.object(manager_service,'get_connection',connection),patch.object(genai,'Client',Provider):
            clients=[]
            for i in range(4):
                c=TestClient(app);assert c.post('/api/v1/auth/login',json=dict(email=f'p5-{prefix}-{i}@example.com',password=password),headers=origin).status_code==200;clients.append(c)
            a,b,staff,manager=clients;base='/api/v1/customer/chatbot'
            def post(client,path,body=None,headers=None):
                token=client.get('/api/v1/auth/csrf').json()['csrf_token'];return client.post(base+path,json=body,headers={**origin,'X-CSRF-Token':token,**(headers or {})})
            def session():
                chatbot_service._limits.clear();r=post(a,'/sessions');assert r.status_code==201,r.text;return r.json()['id']
            sid=session();url='/sessions/'+sid
            assert b.get(base+url).status_code==404
            for c in [staff,manager]:assert c.get(base+'/sessions').status_code==403 and post(c,url+'/draft').status_code==403
            assert TestClient(app).get(base+'/sessions').status_code==401
            assert a.post(base+'/sessions',headers=origin).status_code==403
            assert post(a,url+'/messages',dict(content='Sofa bảo hành',customer_id=users[1])).status_code==422
            assert post(a,url+'/messages',dict(content='x'*2001)).status_code==422
            assert post(a,url+'/messages',dict(content='password: do-not-store-secret')).status_code==422
            with patch.dict(os.environ,{'GEMINI_KEY':'','GEMINI_MODEL':''}):assert post(a,url+'/messages',dict(content='Bảo hành sofa')).status_code==503
            assert not a.get(base+url).json()['messages']
            r=post(a,url+'/messages',dict(content='Sofa của tôi bị lún, bảo hành thế nào?'));assert r.status_code==200,r.text;bot=r.json()['messages'][-1];assert bot['draft'] is None and bot['offer_ticket']
            assert len(Provider.calls[-1]['faq'])<=4 and not any(f['id']==str(inactive) for f in Provider.calls[-1]['faq'])
            assert 'NEVER SEND' not in json.dumps(Provider.calls[-1])
            ticket_before=cur.execute('SELECT 1').fetchone() # SQL cursor remains usable after request validation/errors.
            customer_service.execute(cur,'SELECT count(*) n FROM {phieu_ho_tro} WHERE khach_hang_ma=%s',(users[0],));count=cur.fetchone()['n'];assert count==0
            r=post(a,url+'/draft');assert r.status_code==200,r.text;draft_id=r.json()['messages'][-1]['id'];assert r.json()['messages'][-1]['draft']['ready_for_confirmation']
            body=dict(title='Tiêu đề khách đã sửa',description='Nội dung khách xác nhận sau chỉnh sửa.',type_id=Provider.kind,draft_message_id=draft_id,confirmed=True)
            assert post(a,url+'/confirm',{**body,'role':'QUAN_TRI_VIEN'}).status_code==422
            assert post(a,url+'/confirm',{**body,'confirmed':False}).status_code==422
            assert post(b,url+'/confirm',body).status_code==404
            r=post(a,url+'/confirm',body);assert r.status_code==200,r.text;ticket=r.json()['ticket'];assert ticket['title']==body['title'] and ticket['status']=='MOI' and ticket['assigned_to'] is None
            assert post(a,url+'/confirm',body).json()['replayed']
            assert post(a,url+'/confirm',{**body,'title':'different'}).status_code==409
            assert post(a,url+'/messages',dict(content='Lập phiếu nữa')).status_code==409
            assert post(a,url+'/confirm',body).json()['ticket']['id']==ticket['id']
            customer_service.execute(cur,'SELECT count(*) n FROM {phieu_ho_tro} WHERE khach_hang_ma=%s',(users[0],));assert cur.fetchone()['n']==1
            customer_service.execute(cur,'SELECT count(*) n FROM {lich_su_trang_thai} WHERE phieu_ma=%s',(ticket['id'],));assert cur.fetchone()['n']==1
            assert a.get('/api/v1/customer/tickets/'+ticket['id']).status_code==200 and b.get('/api/v1/customer/tickets/'+ticket['id']).status_code==404
            manager_service.execute(cur,'SELECT nhom_ma FROM {xu_ly_mac_dinh} WHERE ht_ma=%s',(Provider.kind,));group=cur.fetchone()['nhom_ma']
            manager_service.execute(cur,'INSERT INTO {thanh_vien_nhom}(nhom_ma,nhan_vien_ma) VALUES(%s,%s)',(group,users[2]))
            def mutate(c,path,body=None):
                token=c.get('/api/v1/auth/csrf').json()['csrf_token'];return c.post('/api/v1/'+path,json=body or {},headers={**origin,'X-CSRF-Token':token})
            tid=ticket['id'];assert mutate(staff,f'staff/tickets/{tid}/accept').status_code==200
            assert mutate(staff,f'staff/tickets/{tid}/messages',dict(content='Đã kiểm tra sofa',internal=False)).status_code==201
            assert mutate(staff,f'staff/tickets/{tid}/messages',dict(content='Ghi chú nhân viên không gửi AI',internal=True)).status_code==201
            assert 'Ghi chú nhân viên không gửi AI' not in a.get(base+url).text
            assert mutate(staff,f'staff/tickets/{tid}/status',dict(status='DA_GIAI_QUYET')).status_code==200
            assert mutate(a,f'customer/tickets/{tid}/close').status_code==200
            assert mutate(a,f'customer/tickets/{tid}/rating',dict(stars=5,comment='Đã hỗ trợ')).status_code==201
            assert mutate(a,f'customer/tickets/{tid}/rating',dict(stars=5)).status_code==409
            print('PASS lifecycle: chatbot-confirmed same ticket -> staff accepts -> public/internal reply -> resolved -> customer closes/rates once; internal staff note never included in chatbot history.')
            print('PASS sessions/FAQ/context: PostgreSQL ownership/roles/auth/CSRF, inactive FAQ excluded, capped prompt, missing config no writes, sensitive input blocked, SDK credentials/model/timeout/config checked with provider double.')
            print('PASS draft/confirmation: no ticket before explicit confirmation; edited fields respected; MOI/unassigned/history; same-session replay exactly one ticket; payload injection/BOLA/stale conflict blocked; submitted session immutable.')
            second=session();u='/sessions/'+second
            Provider.mode='invalid-type';r=post(a,u+'/draft');assert r.status_code==200 and r.json()['messages'][-1]['draft']['type_id'] is None;d=r.json()['messages'][-1]['id']
            Provider.mode='normal';assert post(a,u+'/draft/cancel').status_code==200
            assert post(a,u+'/confirm',{**body,'draft_message_id':d}).status_code==409
            for mode,status in [('quota',429),('timeout',504),('bad',502),('inject',502)]:
                chatbot_service._limits.clear();Provider.mode=mode;before=a.get(base+u).json()['messages'];r=post(a,u+'/messages',dict(content='Sofa cần hỗ trợ'));assert r.status_code==status,r.text;assert 'do-not-leak' not in r.text;assert a.get(base+u).json()['messages']==before
            Provider.mode='normal'
            third=session();u3='/sessions/'+third;r=post(a,u3+'/draft');d=r.json()['messages'][-1]['id']
            with patch.object(customer_service,'add_history',side_effect=RuntimeError('injected history failure')):
                try:post(a,u3+'/confirm',{**body,'draft_message_id':d})
                except RuntimeError:pass
                else:raise AssertionError('Failure injection did not fire')
            assert a.get(base+u3).json()['session']['ticket_id'] is None
            customer_service.execute(cur,'SELECT count(*) n FROM {phieu_ho_tro} WHERE khach_hang_ma=%s',(users[0],));assert cur.fetchone()['n']==1
            for i in range(60):execute(cur,"INSERT INTO {tin_nhan_chatbot}(phien_chat_ma,nguoi_gui,noi_dung) VALUES(%s,'KHACH',%s)",(third,'Context fixture '+str(i)))
            history=a.get(base+u3).json();assert len(history['messages'])==50 and history['has_older'];older=a.get(base+u3+'?before='+history['messages'][0]['id']).json();assert older['messages'] and not older['has_older']
            chatbot_service._limits.clear()
            for i in range(8):chatbot_service.rate(users[0],'generate')
            try:chatbot_service.rate(users[0],'generate')
            except HTTPException as e:assert e.status_code==429
            else:raise AssertionError('Rate limiter not enforced')
            assert seed(cur,document(),False)==[] # Approved real FAQ seed is repeat-safe.
            print('PASS cancel/invalid-type/errors: unknown type requires user choice, cancelled draft409, quota429/timeout504/invalidJSON502/role-injectedJSON502 with no partial messages or secrets; history pagination; rate limit; ticket/history/link rollback on failure; FAQ seed repeat preview0.')
            chatbot_service._limits.clear();_attempts.clear();_registrations.clear()
            if args.browser:run_browser(dict(email=f'p5-{prefix}-0@example.com',password=password,type_id=Provider.kind))

def run_browser(fixtures):
    import uvicorn
    env={**os.environ,'HELPDESK_PHASE5_FIXTURES':json.dumps(fixtures)}
    with patch.dict(os.environ,{'FRONTEND_ORIGINS':os.getenv('FRONTEND_ORIGINS','http://localhost:5173')+',http://localhost:5174'}):
        server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8001,log_level='error'));worker=threading.Thread(target=server.run,daemon=True);worker.start()
        try:
            for _ in range(100):
                if server.started or not worker.is_alive():break
                time.sleep(.05)
            assert server.started
            r=subprocess.run(['npm.cmd','exec','--','playwright','test','--config','playwright.phase5.config.ts'],cwd=BASE_DIR/'frontend',env=env,check=False)
            assert r.returncode==0,'Phase5 browser failed'
        finally:server.should_exit=True;worker.join(timeout=10)

if __name__=='__main__':
    baseline=counts()
    try:main()
    finally:
        assert counts()==baseline,'Fixture counts changed unexpectedly'
        print('PASS cleanup: all table counts unchanged; fixtures rolled back, no identity reset; Gemini API never called live.')
