"""Opt-in Phase4 integration smoke; isolated fixtures and real SQL, always rollback."""
import argparse
from contextlib import contextmanager
from pathlib import Path
import os
import secrets
import sys
import threading
import json
import subprocess
import time
from tempfile import TemporaryDirectory
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from psycopg.rows import dict_row
from core.database import get_connection,BASE_DIR
from core.security import PASSWORD_HASHER
from services import auth_service,customer_service,staff_service,manager_service as service
from api.routes.auth import _attempts,_registrations
from main import app


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--stage',choices=list('ABCDE'),default='A');parser.add_argument('--browser',action='store_true');args=parser.parse_args()
    if not args.execute:parser.error('Cần --execute; fixture thật được rollback, không seed tài khoản sử dụng.')
    prefix=secrets.token_hex(12);password=secrets.token_urlsafe(24)+'!9';origin={'Origin':'http://localhost:5173'}
    _attempts.clear();_registrations.clear()
    with TemporaryDirectory(prefix='helpdesk-phase4-') as tmp,patch.dict(os.environ,{'MANAGER_AUDIT_DIR':tmp,'UPLOAD_DIR':str(Path(tmp)/'uploads')}),get_connection() as conn,conn.transaction(force_rollback=True),conn.cursor(row_factory=dict_row) as cur:
        gate=threading.RLock()
        @contextmanager
        def connection():
            with gate,conn.transaction():yield conn
        def q(statement,params=()):service.execute(cur,statement,params);return cur
        q("INSERT INTO {nguoi_dung}(ho_ten,email,mat_khau_hash,vai_tro) VALUES(%s,%s,%s,'QUAN_TRI_VIEN') RETURNING nd_ma",('Quản lý fixture '+prefix,f'manager-{prefix}@example.com',PASSWORD_HASHER.hash(password)))
        manager_id=cur.fetchone()['nd_ma'];q('INSERT INTO {quan_tri_vien}(nd_ma) VALUES(%s)',(manager_id,))
        with patch.object(service,'get_connection',connection),patch.object(auth_service,'get_connection',connection),patch.object(customer_service,'get_connection',connection),patch.object(staff_service,'get_connection',connection):
            admin=TestClient(app,raise_server_exceptions=False)
            def login(client,email):
                r=client.post('/api/v1/auth/login',json={'email':email,'password':password},headers=origin);assert r.status_code==200,r.text;return r.json()['user']
            assert login(admin,f'manager-{prefix}@example.com')['role']=='manager'
            def post(client,path,body=None,method='POST'):
                token=client.get('/api/v1/auth/csrf').json()['csrf_token'];return client.request(method,'/api/v1/'+path,json=body,headers={**origin,'X-CSRF-Token':token})
            employee_body=dict(name='Nhân viên fixture '+prefix,email=f'employee-{prefix}@example.com',phone=None,password=password,password_confirmation=password)
            r=post(admin,'manager/users',employee_body);assert r.status_code==201,r.text;employee=r.json();employee_id=employee['id']
            assert password not in r.text and 'mat_khau' not in r.text and 'hash' not in r.text
            assert q('SELECT mat_khau_hash FROM {nguoi_dung} WHERE nd_ma=%s',(employee_id,)).fetchone()['mat_khau_hash'].startswith('$argon2id$')
            assert post(admin,'manager/users',{**employee_body,'email':employee_body['email'].upper()}).status_code==409
            assert post(admin,'manager/users',{**employee_body,'role':'QUAN_TRI_VIEN'}).status_code==422
            with patch.object(service,'create_employee_profile',side_effect=RuntimeError('fixture profile failure')):
                failed=f'failed-{prefix}@example.com';assert post(admin,'manager/users',{**employee_body,'email':failed}).status_code==500
            assert q('SELECT count(*) n FROM {nguoi_dung} WHERE email=%s',(failed,)).fetchone()['n']==0
            employee_client=TestClient(app,raise_server_exceptions=False);assert login(employee_client,employee_body['email'])['role']=='staff'
            assert employee_client.get('/api/v1/manager/users').status_code==403
            assert admin.post('/api/v1/manager/users',json=employee_body,headers=origin).status_code==403
            assert post(admin,'manager/users/'+employee_id,dict(name=employee['name'],phone=None,status='KHOA',expected_updated_at=employee['updated_at']),'PATCH').status_code==200
            assert employee_client.get('/api/v1/auth/me').status_code==401
            locked=admin.get('/api/v1/manager/users/'+employee_id).json()
            assert post(admin,'manager/users/'+employee_id,dict(name=employee['name'],phone=None,status='HOAT_DONG',expected_updated_at=locked['updated_at']),'PATCH').status_code==200
            assert post(admin,'manager/users/'+employee_id,dict(name=employee['name'],phone=None,status='KHOA',expected_updated_at=employee['updated_at']),'PATCH').status_code==409
            own=admin.get('/api/v1/manager/users/'+str(manager_id)).json()
            assert post(admin,'manager/users/'+str(manager_id),dict(name=own['name'],phone=None,status='KHOA',expected_updated_at=own['updated_at']),'PATCH').status_code==409
            fresh=admin.get('/api/v1/manager/users/'+employee_id).json()
            assert post(admin,'manager/users/'+employee_id+'/role',dict(role='QUAN_TRI_VIEN',current_password='wrong',confirmed=True,expected_updated_at=fresh['updated_at'])).status_code==403
            r=post(admin,'manager/users',{**employee_body,'email':f'role-{prefix}@example.com'});assert r.status_code==201;unused=r.json()
            promoted=post(admin,'manager/users/'+unused['id']+'/role',dict(role='QUAN_TRI_VIEN',current_password=password,confirmed=True,expected_updated_at=unused['updated_at']));assert promoted.status_code==200,promoted.text
            privileged=TestClient(app,raise_server_exceptions=False);assert login(privileged,f'role-{prefix}@example.com')['role']=='manager'
            assert privileged.get('/api/v1/manager/users').status_code==200
            assert post(admin,'manager/users/'+unused['id']+'/role',dict(role='NHAN_VIEN',current_password=password,confirmed=True,expected_updated_at=promoted.json()['updated_at'])).status_code==200
            assert privileged.get('/api/v1/manager/users').status_code==403
            assert post(admin,'manager/users/'+str(manager_id)+'/role',dict(role='NHAN_VIEN',current_password=password,confirmed=True,expected_updated_at=own['updated_at'])).status_code==409
            assert admin.get('/api/v1/manager/overview').status_code==200
            assert admin.get('/api/v1/manager/users',params={'search':"' OR 1=1 --"}).json()['total']==0
            assert list(Path(tmp).glob('manager.jsonl'));assert password not in (Path(tmp)/'manager.jsonl').read_text(encoding='utf-8') and 'mat_khau' not in (Path(tmp)/'manager.jsonl').read_text(encoding='utf-8')
            print('PASS A: create staff+profile atomically; real Argon2/login/role; duplicate/injection; lock invalidates session; CSRF; stale update409; self-lock blocked; role confirmation; audit no secrets.')
            if args.stage=='A':return
            groups=admin.get('/api/v1/manager/groups').json()['items'];warranty=next(g for g in groups if g['name']=='Bảo hành và bảo trì');group_id=warranty['id']
            r=post(admin,f'manager/groups/{group_id}/members',dict(employee_id=employee_id));assert r.status_code==200,(r.status_code,r.text)
            r=post(admin,f'manager/groups/{group_id}/members',dict(employee_id=employee_id));assert r.status_code==200,(r.status_code,r.text)
            r=post(admin,'manager/groups',dict(name='Nhóm fixture '+prefix,description=None,active=True));assert r.status_code==201,r.text;extra_group=r.json()
            assert post(admin,f"manager/groups/{extra_group['id']}/members",dict(employee_id=employee_id)).status_code==200
            assert post(admin,f'manager/groups/{group_id}/members',dict(employee_id=manager_id)).status_code==422
            type_id=next(r['type_id'] for r in admin.get('/api/v1/manager/routing').json() if r['type_name']=='Bảo hành sản phẩm')
            customer=TestClient(app,raise_server_exceptions=False);customer_body={**employee_body,'name':'Khách hàng fixture '+prefix,'email':f'customer-{prefix}@example.com'}
            assert customer.post('/api/v1/auth/register',json=customer_body,headers=origin).status_code==201
            customer_id=login(customer,customer_body['email'])['id']
            r=post(customer,'customer/tickets',dict(title='Bảo hành sofa phase4',description='Chân sofa cần kiểm tra',type_id=type_id));assert r.status_code==201,r.text;ticket_id=r.json()['id']
            recommended=employee_client.get('/api/v1/staff/tickets?scope=recommended').json()
            item=next(t for t in recommended['items'] if t['id']==ticket_id);assert item['recommended'] and item['assigned_id'] is None
            assert q('SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s',(ticket_id,)).fetchone()['n']==0
            r=post(employee_client,f'staff/tickets/{ticket_id}/accept');assert r.status_code==200,r.text;assert r.json()['id']==ticket_id
            assert post(admin,f'manager/groups/{group_id}/members/remove',dict(employee_id=employee_id)).status_code==409
            current_group=admin.get('/api/v1/manager/groups/'+group_id).json();expected={k:current_group[k] for k in ['name','description','active']}
            assert post(admin,'manager/groups/'+group_id,{**expected,'active':False,'expected':expected},'PATCH').status_code==409
            current=admin.get('/api/v1/manager/users/'+employee_id).json()
            assert post(admin,'manager/users/'+employee_id,dict(name=current['name'],phone=None,status='KHOA',expected_updated_at=current['updated_at']),'PATCH').status_code==409
            assert employee_client.get('/api/v1/manager/groups').status_code==403
            temp_type=q('INSERT INTO {loai_ho_tro}(ten) VALUES(%s) RETURNING ht_ma',('Routing fixture '+prefix,)).fetchone()['ht_ma']
            assert post(admin,f'manager/routing/{temp_type}',dict(group_id=extra_group['id'],expected_group_id=None),'PATCH').status_code==200
            assert post(admin,f'manager/routing/{temp_type}',dict(group_id=group_id,expected_group_id=None),'PATCH').status_code==409
            print('PASS B: existing warranty group preserved; staff multi-group membership; routing explicit save+stale409; customer warranty ticket recommended but unassigned until accept same ID; active tasks block removal/group disable/account lock.')
            if args.stage=='B':return
            r=post(admin,'manager/users',{**employee_body,'name':'Nhân viên thứ hai '+prefix,'email':f'employee2-{prefix}@example.com'});assert r.status_code==201,r.text;employee2=r.json()['id']
            assert post(admin,f'manager/groups/{group_id}/members',dict(employee_id=employee2)).status_code==200
            second=TestClient(app,raise_server_exceptions=False);login(second,f'employee2-{prefix}@example.com')
            detail=admin.get('/api/v1/manager/tickets/'+ticket_id);assert detail.status_code==200,detail.text
            def assignment_body(d,g,e):return dict(group_id=g,employee_id=e,expected_assignment_id=d['assignment_id'],expected_updated_at=d['updated_at'],reason='Điều phối fixture có kiểm soát')
            body=assignment_body(detail.json(),group_id,employee2)
            with patch.object(service,'insert_assignment',side_effect=RuntimeError('fixture assignment failure')):
                assert post(admin,f'manager/tickets/{ticket_id}/assignment',body).status_code==500
            assert q('SELECT ket_thuc FROM {lich_su_phan_cong} WHERE pc_ma=%s',(detail.json()['assignment_id'],)).fetchone()['ket_thuc'] is None
            r=post(admin,f'manager/tickets/{ticket_id}/assignment',body);assert r.status_code==200,r.text;assert r.json()['assigned_id']==employee2
            assert post(admin,f'manager/tickets/{ticket_id}/assignment',body).status_code==409
            detail=admin.get('/api/v1/manager/tickets/'+ticket_id).json()
            r=post(admin,f'manager/tickets/{ticket_id}/assignment',assignment_body(detail,extra_group['id'],employee_id));assert r.status_code==200,r.text
            assert second.get('/api/v1/staff/tickets/'+ticket_id).status_code==404
            assert employee_client.get('/api/v1/staff/tickets/'+ticket_id).status_code==200
            detail=admin.get('/api/v1/manager/tickets/'+ticket_id).json()
            assert post(second,f'manager/tickets/{ticket_id}/assignment',assignment_body(detail,group_id,employee2)).status_code==403
            assert admin.post(f'/api/v1/manager/tickets/{ticket_id}/assignment',json=assignment_body(detail,group_id,employee2),headers=origin).status_code==403
            assert post(admin,f'manager/tickets/{ticket_id}/assignment',assignment_body(detail,extra_group['id'],None)).json()['status']=='MOI'
            assert q('SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s AND ket_thuc IS NULL',(ticket_id,)).fetchone()['n']==0
            assert post(employee_client,f'staff/tickets/{ticket_id}/accept').status_code==200
            assert q('SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s AND ket_thuc IS NULL',(ticket_id,)).fetchone()['n']==1
            assert admin.get('/api/v1/manager/tickets',params={'search':ticket_id,'group':extra_group['id'],'employee':employee_id}).json()['total']==1
            assert admin.get('/api/v1/manager/tickets',params={'search':"' OR 1=1 --"}).json()['total']==0
            print('PASS C: manager detail/filters; same-group and cross-group reassignment; stale409; outside-role/CSRF; assignment failure rollback; queue release MOI and staff accepts same ID; history preserved with one active assignment.')
            if args.stage=='C':return
            assert admin.get('/api/v1/manager/tickets/'+ticket_id).json()['sla_state']=='Chưa cấu hình SLA'
            priority=q('SELECT i FROM generate_series(30000,32767) i WHERE NOT EXISTS(SELECT 1 FROM {muc_do_uu_tien} WHERE mdut_ma=i OR thu_tu=i) LIMIT 1').fetchone()['i']
            q('INSERT INTO {muc_do_uu_tien}(mdut_ma,ten,thu_tu) VALUES(%s,%s,%s)',(priority,'Fixture SLA '+prefix,priority))
            policy_body=dict(name='SLA fixture '+prefix,priority_id=priority,response_minutes=30,resolution_minutes=120,active=True)
            r=post(admin,'manager/sla',policy_body);assert r.status_code==201,r.text;policy=r.json();policy_id=policy['id']
            assert post(admin,'manager/sla',policy_body).status_code==409
            assert post(admin,'manager/sla',{**policy_body,'response_minutes':0}).status_code==422
            assert post(employee_client,'manager/sla',policy_body).status_code==403
            assert admin.get('/api/v1/manager/tickets/'+ticket_id).json()['response_due'] is None
            assert post(employee_client,f'staff/tickets/{ticket_id}/classification',dict(type_id=type_id,priority_id=priority),'PATCH').status_code==200
            old=admin.get('/api/v1/manager/tickets/'+ticket_id).json()
            apply=dict(expected_updated_at=old['updated_at'],recalculate=False,confirmed=True)
            assert post(admin,f'manager/tickets/{ticket_id}/sla',apply).status_code==200
            assert post(admin,f'manager/tickets/{ticket_id}/sla',apply).status_code==409
            os.environ['DEFAULT_PRIORITY_ORDER']=str(priority)
            r=post(customer,'customer/tickets',dict(title='Phiếu SLA tự áp dụng',description='Fixture private priority',type_id=type_id));assert r.status_code==201,r.text;new_ticket_id=r.json()['id']
            applied=admin.get('/api/v1/manager/tickets/'+new_ticket_id).json();assert applied['sla_state']=='Sắp quá hạn' and applied['sla_name']==policy_body['name']
            deltas=q('SELECT EXTRACT(epoch FROM (han_phan_hoi-ngay_tao))/60 a,EXTRACT(epoch FROM (han_xu_ly-ngay_tao))/60 b FROM {phieu_ho_tro} WHERE phieu_ma=%s',(new_ticket_id,)).fetchone();assert deltas['a']==30 and deltas['b']==120
            assert post(admin,f'manager/sla/{policy_id}',{**policy_body,'resolution_minutes':180,'expected':policy_body},'PATCH').status_code==409
            for delta,label in [(120,'Trong hạn'),(30,'Sắp quá hạn'),(-1,'Quá hạn')]:
                q("UPDATE {phieu_ho_tro} SET han_xu_ly=now()+(%s*interval '1 minute'),han_phan_hoi=NULL WHERE phieu_ma=%s",(delta,new_ticket_id))
                assert admin.get('/api/v1/manager/tickets/'+new_ticket_id).json()['sla_state']==label
            previous=admin.get('/api/v1/manager/tickets/'+ticket_id).json()['resolution_due']
            assert post(admin,f'manager/sla/{policy_id}',{**policy_body,'active':False,'expected':policy_body},'PATCH').status_code==200
            assert post(admin,'manager/sla',{**policy_body,'name':'SLA v2 fixture '+prefix,'resolution_minutes':240}).status_code==201
            assert admin.get('/api/v1/manager/tickets/'+ticket_id).json()['resolution_due']==previous
            old=admin.get('/api/v1/manager/tickets/'+ticket_id).json()
            assert post(admin,f'manager/tickets/{ticket_id}/sla',dict(expected_updated_at=old['updated_at'],confirmed=True,recalculate=True)).status_code==200
            assert q('SELECT EXTRACT(epoch FROM (han_xu_ly-ngay_tao))/60 n FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket_id,)).fetchone()['n']==240
            assert post(employee_client,f'staff/tickets/{ticket_id}/messages',dict(content='Ghi chú quản lý không hiện cho khách',internal=True)).status_code==201
            assert employee_client.get('/api/v1/staff/tickets/'+ticket_id).json()['first_response_at'] is None
            assert post(employee_client,f'staff/tickets/{ticket_id}/messages',dict(content='Đã kiểm tra chân sofa',internal=False)).status_code==201
            assert employee_client.get('/api/v1/staff/tickets/'+ticket_id).json()['first_response_at'] is not None
            assert 'Ghi chú quản lý không hiện cho khách' not in customer.get('/api/v1/customer/tickets/'+ticket_id).text
            token=employee_client.get('/api/v1/auth/csrf').json()['csrf_token']
            r=employee_client.post(f'/api/v1/staff/tickets/{ticket_id}/attachments',files={'file':('kiem-tra.txt',b'Kiem tra sofa','text/plain')},headers={**origin,'X-CSRF-Token':token});assert r.status_code==201,r.text;attachment_id=r.json()['id']
            assert employee_client.get(f'/api/v1/staff/tickets/{ticket_id}/attachments/{attachment_id}').content==b'Kiem tra sofa'
            assert admin.get(f'/api/v1/manager/tickets/{ticket_id}/attachments/{attachment_id}').content==b'Kiem tra sofa'
            print('PASS D: SLA priority-only, continuous minutes; unique active policy; immutable used policies; new-ticket deadlines exact; old deadlines unchanged unless explicit recalc; within/soon/overdue/missing; internal notes do not set first response; staff/manager real download.')
            if args.stage=='D':return
            r=admin.get('/api/v1/manager/reports',params={'search':ticket_id,'employee':employee_id,'page_size':1});assert r.status_code==200,r.text;report=r.json()
            assert report['summary']['total']==1 and report['summary']['processing']==1 and report['total']==1
            for key in ['by_status','by_group','by_type','by_priority']:assert sum(x['count'] for x in report['summary'][key])==1
            assert report['items'][0]['active']==1 and report['locality_supported'] is False
            r=admin.get('/api/v1/manager/reports',params={'search':new_ticket_id});assert r.status_code==200,r.text;assert r.json()['summary']['overdue']==1
            r=admin.get('/api/v1/manager/activity',params={'search':ticket_id,'employee':employee_id,'page_size':50});assert r.status_code==200,r.text;kinds={x['kind'] for x in r.json()['items']};assert {'Phân công','Kết thúc phân công','Trạng thái','Ghi chú nội bộ','Phản hồi công khai','Tệp đính kèm'}<=kinds
            assert admin.get('/api/v1/manager/activity?event_from=2026-10-21&event_to=2026-10-20').status_code==422
            assert admin.get('/api/v1/manager/activity?search=no-such-fixture&page=2').json()['items']==[]
            assert employee_client.get('/api/v1/manager/reports').status_code==403
            assert customer.get('/api/v1/manager/activity').status_code==403
            assert post(employee_client,f'staff/tickets/{ticket_id}/status',dict(status='DA_GIAI_QUYET')).status_code==200
            assert post(customer,f'customer/tickets/{ticket_id}/close',{}).status_code==200
            assert post(customer,f'customer/tickets/{ticket_id}/rating',dict(stars=5,comment='Hoàn tất bảo hành sofa')).status_code==201
            assert post(customer,f'customer/tickets/{ticket_id}/rating',dict(stars=4)).status_code==409
            report=admin.get('/api/v1/manager/reports',params={'search':ticket_id,'employee':employee_id}).json();assert report['summary']['closed']==1 and report['items'][0]['average_rating']==5 and report['items'][0]['on_time']==1
            closed=admin.get('/api/v1/manager/tickets/'+ticket_id).json()
            assert post(admin,f'manager/tickets/{ticket_id}/assignment',assignment_body(closed,group_id,employee2)).status_code==409
            assert post(admin,f'manager/tickets/{ticket_id}/sla',dict(expected_updated_at=closed['updated_at'],recalculate=True,confirmed=True)).status_code==409
            print('PASS E: real filtered totals/distributions/performance vs SQL; SLA overdue count; paginated activity; role isolation; full customer->staff->manager transfer/SLA->staff resolved->customer close/rate->manager report; closed-ticket changes blocked.')
            used=admin.get('/api/v1/manager/users/'+employee_id).json()
            role_body=dict(role='QUAN_TRI_VIEN',current_password=password,confirmed=True,expected_updated_at=used['updated_at'])
            assert post(admin,'manager/users/'+employee_id+'/role',role_body).status_code==409
            assert post(admin,'manager/users/'+employee_id+'/role',role_body).status_code==429
            print('PASS privileged role confirmation: real grant/revoke applies to existing session; self-change and used accounts blocked; 5/min rate limit.')
            if args.browser:
                fixtures={}
                for project in ['desktop','mobile']:
                    browser_priority=q('SELECT i FROM generate_series(30000,32767) i WHERE NOT EXISTS(SELECT 1 FROM {muc_do_uu_tien} WHERE mdut_ma=i OR thu_tu=i) LIMIT 1').fetchone()['i']
                    q('INSERT INTO {muc_do_uu_tien}(mdut_ma,ten,thu_tu) VALUES(%s,%s,%s)',(browser_priority,'Browser '+project+' '+prefix[:8],browser_priority))
                    fixtures[project]=dict(manager_email=f'manager-{prefix}@example.com',prefix=prefix,type_id=str(temp_type),priority_id=str(browser_priority),type_name='Routing fixture '+prefix)
                run_browser(fixtures,password)


def run_browser(fixtures,password):
    import uvicorn
    _attempts.clear();_registrations.clear()
    environment={**os.environ,'HELPDESK_PHASE4_PASSWORD':password,'HELPDESK_PHASE4_FIXTURES':json.dumps(fixtures)}
    with patch.dict(os.environ,{'FRONTEND_ORIGINS':os.getenv('FRONTEND_ORIGINS','http://localhost:5173')+',http://localhost:5174'}):
        server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8001,log_level='error'))
        worker=threading.Thread(target=server.run,daemon=True);worker.start()
        try:
            for _ in range(100):
                if server.started or not worker.is_alive():break
                time.sleep(.05)
            assert server.started,'Không mở được backend kiểm thử 8001.'
            result=subprocess.run(['npm.cmd','exec','--','playwright','test','--config','playwright.phase4.config.ts'],cwd=BASE_DIR/'frontend',env=environment,check=False)
            assert result.returncode==0,'Phase4 browser failed'
        finally:
            server.should_exit=True;worker.join(timeout=10)


def counts():
    with get_connection() as conn,conn.cursor(row_factory=dict_row) as cur:
        result={}
        for table in service.TABLES:
            service.execute(cur,'SELECT count(*) n FROM {'+table+'}');result[table]=cur.fetchone()['n']
        return result


if __name__=='__main__':
    baseline=counts()
    try:main()
    finally:
        assert counts()==baseline,'Bản ghi thay đổi ngoài fixture; cần kiểm tra.'
        print('PASS cleanup: record counts unchanged; fixtures rolled back; no sequence reset.')
