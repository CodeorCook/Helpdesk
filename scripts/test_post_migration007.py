"""Opt-in, no DDL: installed migration 007 + API checks on rollback-only fixtures.

Never run migrations. All API DB entry points share one guarded connection and
savepoints; any unexpected psycopg.connect is blocked. No browser writes to DB.
"""
import argparse
from contextlib import ExitStack, contextmanager
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import secrets
import sys
from tempfile import TemporaryDirectory
import threading
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.errors import CheckViolation, ForeignKeyViolation, UniqueViolation
from psycopg.rows import dict_row
from psycopg.pq import TransactionStatus
from core.database import get_connection, database_schema
from core.security import PASSWORD_HASHER
from main import app
from services import auth_service,customer_service,staff_service,manager_service,escalation_service,email_service

S='helpdesk'
T='yeu_cau_dieu_phoi_phieu'


def metadata(conn):
    with conn.transaction(),conn.cursor(row_factory=dict_row) as cur:
        cur.execute('SET TRANSACTION READ ONLY')
        cur.execute('SELECT current_database() db')
        result=cur.fetchone()
        cur.execute("SELECT column_name,udt_name,is_nullable,column_default,is_identity,identity_generation,character_maximum_length FROM information_schema.columns WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position",(S,T))
        result['columns']=cur.fetchall()
        cur.execute("SELECT conname,contype,convalidated,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=to_regclass(%s) ORDER BY conname",(f'{S}.{T}',))
        result['constraints']=cur.fetchall()
        cur.execute("SELECT c.relname name,i.indisvalid valid,i.indisready ready,i.indisunique unique_index,pg_get_indexdef(i.indexrelid) definition,pg_get_expr(i.indpred,i.indrelid) predicate FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=to_regclass(%s) ORDER BY c.relname",(f'{S}.{T}',))
        result['indexes']=cur.fetchall()
        expected=[('yc_ma','int8',False),('phieu_ma','int8',False),('nhan_vien_gui_ma','int8',False),('nhom_gui_ma','int8',False),('phan_cong_gui_ma','int8',False),('ly_do','text',False),('ngay_gui','timestamptz',False),('trang_thai','varchar',False),('quan_ly_xu_ly_ma','int8',True),('ngay_xu_ly','timestamptz',True),('ghi_chu_xu_ly','text',True),('phan_cong_ket_qua_ma','int8',True)]
        assert result['db']=='DB_HELPDESK' and database_schema()==S,'Wrong database/schema: write tests stopped'
        assert [(c['column_name'],c['udt_name'],c['is_nullable']=='YES') for c in result['columns']]==expected,'Migration column mismatch: write tests stopped'
        columns={c['column_name']:c for c in result['columns']}
        assert columns['yc_ma']['is_identity']=='YES' and columns['yc_ma']['identity_generation']=='ALWAYS'
        assert columns['ngay_gui']['column_default']=='clock_timestamp()'
        assert 'CHO_XU_LY' in columns['trang_thai']['column_default'] and columns['trang_thai']['character_maximum_length']==20
        constraints=result['constraints']
        assert all(c['convalidated'] for c in constraints)
        assert [c['definition'] for c in constraints if c['contype']=='p']==['PRIMARY KEY (yc_ma)']
        fks=[c['definition'] for c in constraints if c['contype']=='f']
        assert len(fks)==6 and all('ON DELETE RESTRICT' in c for c in fks)
        for key,table,col in [('phieu_ma','phieu_ho_tro','phieu_ma'),('nhan_vien_gui_ma','nhan_vien','nd_ma'),('nhom_gui_ma','nhom_ho_tro','nhom_ma'),('phan_cong_gui_ma','lich_su_phan_cong','pc_ma'),('quan_ly_xu_ly_ma','quan_tri_vien','nd_ma'),('phan_cong_ket_qua_ma','lich_su_phan_cong','pc_ma')]:
            assert any(f'FOREIGN KEY ({key}) REFERENCES helpdesk.{table}({col})' in c for c in fks)
        checks=' '.join(c['definition'] for c in constraints if c['contype']=='c')
        assert sum(c['contype']=='c' for c in constraints)==3
        assert all(v in checks for v in ['CHO_XU_LY','DA_DIEU_PHOI','TU_CHOI','btrim(ly_do)','2000','ghi_chu_xu_ly IS NOT NULL','quan_ly_xu_ly_ma IS NOT NULL'])
        indexes={i['name']:i for i in result['indexes']}
        assert all(i['valid'] and i['ready'] for i in indexes.values())
        unique=indexes['uq_dieu_phoi_phieu_dang_cho']
        assert unique['unique_index'] and 'CHO_XU_LY' in unique['predicate'] and '(phieu_ma)' in unique['definition']
        assert '(nhan_vien_gui_ma, ngay_gui DESC)' in indexes['ix_dieu_phoi_nguoi_gui']['definition']
        cur.execute('SELECT count(*) total,count(*) FILTER(WHERE trang_thai=\'CHO_XU_LY\') pending FROM helpdesk.yeu_cau_dieu_phoi_phieu')
        result['existing_counts']=cur.fetchone()
        result['status']='PASS'
        return result


def fingerprints(conn):
    result={}
    with conn.transaction(),conn.cursor(row_factory=dict_row) as cur:
        cur.execute('SET TRANSACTION READ ONLY')
        cur.execute("SELECT tablename FROM pg_tables WHERE schemaname=%s ORDER BY tablename",(S,))
        for table in [r['tablename'] for r in cur.fetchall()]:
            cur.execute(sql.SQL("SELECT count(*) n,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) digest FROM {} t").format(sql.Identifier(S,table)))
            result[table]=cur.fetchone()
    return result


def sequences(conn):
    return dict(conn.execute('SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=%s',(S,)).fetchall())


def run(conn,observer,result,tmp):
    prefix='P007-'+secrets.token_hex(8)
    base=10**12+secrets.randbelow(10**11)
    serial=iter(range(base,base+10000))
    password=secrets.token_urlsafe(24)+'!9'
    password_hash=PASSWORD_HASHER.hash(password)
    gate=threading.RLock()
    pids=set()
    clients=[]
    def query(statement,params=()):
        cur=conn.cursor(row_factory=dict_row)
        manager_service.execute(cur,statement,params)
        return cur
    def insert(table,**values):
        with conn.cursor() as cur:
            cur.execute(sql.SQL('INSERT INTO {} ({}) OVERRIDING SYSTEM VALUE VALUES ({})').format(sql.Identifier(S,table),sql.SQL(',').join(map(sql.Identifier,values)),sql.SQL(',').join(sql.Placeholder() for _ in values)),list(values.values()))
    @contextmanager
    def same_connection():
        with gate:
            assert conn.info.transaction_status==TransactionStatus.INTRANS,'Outer rollback transaction lost'
            pids.add(conn.info.backend_pid)
            with conn.transaction():yield conn
    def account(role,label):
        uid=next(serial);email=f'{prefix}-{label}@example.invalid'
        insert('nguoi_dung',nd_ma=uid,ho_ten=f'{prefix} {label}',email=email,mat_khau_hash=password_hash,vai_tro=role,trang_thai='HOAT_DONG')
        insert({'QUAN_TRI_VIEN':'quan_tri_vien','NHAN_VIEN':'nhan_vien','KHACH_HANG':'khach_hang'}[role],nd_ma=uid)
        client=TestClient(app,raise_server_exceptions=False,client=(f'p007-{label}',50000));clients.append(client)
        response=client.post('/api/v1/auth/login',json={'email':email,'password':password},headers=origin)
        assert response.status_code==200,f'fixture login HTTP {response.status_code}'
        return uid,client
    def call(client,path,body=None,method='POST',expected=None):
        token=client.get('/api/v1/auth/csrf').json()['csrf_token']
        response=client.request(method,'/api/v1/'+path,json=body,headers={**origin,'X-CSRF-Token':token})
        if expected is not None:assert response.status_code==expected,f'{path}: HTTP {response.status_code}, expected {expected}: {response.text[:300]}'
        return response
    def detail(tid):
        response=admin.get(f'/api/v1/manager/tickets/{tid}');assert response.status_code==200,response.text[:300]
        return response.json()
    def escalation(client,tid,reason='Need specialist support',expected=201,**extra):
        version=query('SELECT ngay_cap_nhat FROM {phieu_ho_tro} WHERE phieu_ma=%s',(tid,)).fetchone()['ngay_cap_nhat'].isoformat()
        return call(client,f'staff/tickets/{tid}/escalations',dict(reason=reason,expected_updated_at=version,**extra),expected=expected)
    def ticket(status='DANG_XU_LY',owner=None,old=False,phase='official'):
        tid=next(serial);created=datetime.now(timezone.utc)-timedelta(days=45) if old else datetime.now(timezone.utc)
        responded=(created+timedelta(minutes=5) if old else created) if status!='MOI' else None
        values=dict(phieu_ma=tid,khach_hang_ma=customer_id,nguon_tao='KHACH_HANG',ht_ma=type_id,mdut_ma=priority,
                    tt_ma=states[status],tieu_de=f'{prefix} ticket {tid}',mo_ta='Preserve this request body',nhom_ma=group_a,
                    nhan_vien_phu_trach_ma=owner,sla_ma=sla,han_phan_hoi=created+timedelta(minutes=15),han_xu_ly=created+timedelta(minutes=90),
                    ngay_tao=created,ngay_phan_hoi_dau=responded,yeu_cau_goc=json.dumps({'_sla_phase':phase}))
        insert('phieu_ho_tro',**values)
        pc=None
        if owner:
            pc=next(serial);insert('lich_su_phan_cong',pc_ma=pc,phieu_ma=tid,nhan_vien_ma=owner,nguoi_phan_cong_ma=admin_id)
        insert('lich_su_trang_thai',ls_ma=next(serial),phieu_ma=tid,tt_moi_ma=states[status],nguoi_thay_doi_ma=admin_id)
        insert('tin_nhan',tn_ma=next(serial),phieu_ma=tid,nguoi_gui_ma=customer_id,noi_dung='Fixture public conversation',la_ghi_chu_noi_bo=False)
        insert('tin_nhan',tn_ma=next(serial),phieu_ma=tid,nguoi_gui_ma=staff_id,noi_dung='Fixture internal conversation',la_ghi_chu_noi_bo=True)
        if responded:
            insert('tin_nhan',tn_ma=next(serial),phieu_ma=tid,nguoi_gui_ma=staff_id,noi_dung='Fixture first public response',la_ghi_chu_noi_bo=False,thoi_gian=responded)
        return tid,pc
    def snapshot(tid):
        data={'ticket':query('SELECT to_jsonb(p) data FROM {phieu_ho_tro} p WHERE phieu_ma=%s',(tid,)).fetchone()['data']}
        for key,table,order in [('messages','tin_nhan','tn_ma'),('states','lich_su_trang_thai','ls_ma'),('assignments','lich_su_phan_cong','pc_ma')]:
            data[key]=query('SELECT to_jsonb(t) data FROM {'+table+'} t WHERE phieu_ma=%s ORDER BY '+order,(tid,)).fetchall()
        return data
    def preserved(before,after,assignment=False):
        excluded={'nhom_ma','nhan_vien_phu_trach_ma','ngay_cap_nhat'} if assignment else set()
        assert {k:v for k,v in before['ticket'].items() if k not in excluded}=={k:v for k,v in after['ticket'].items() if k not in excluded}
        assert before['messages']==after['messages'] and before['states']==after['states']
        if not assignment:assert before['assignments']==after['assignments']
    def assign(tid,target_group,target,request_id,expected=200,**extra):
        d=detail(tid)
        payload=dict(group_id=target_group,employee_id=target,
            expected_assignment_id=d['assignment_id'],expected_updated_at=d['updated_at'],expected_escalation_id=request_id,
            reason='Fixture controlled reassignment')
        payload.update(extra)
        return call(admin,f'manager/tickets/{tid}/assignment',payload,expected=expected)
    def record(case,statuses,note):
        result['cases'][case]={'status':'PASS','http':statuses,'note':note};print(f'PASS {case}: HTTP {statuses}')

    origin={'Origin':'http://localhost:5173'}
    with ExitStack() as stack:
        for module in [auth_service,customer_service,staff_service,manager_service]:stack.enter_context(patch.object(module,'get_connection',same_connection))
        # Fail closed if a service attempts an unbound connection or actual mail delivery.
        stack.enter_context(patch('psycopg.connect',side_effect=AssertionError('Unexpected independent database connection')))
        mail=stack.enter_context(patch.object(email_service,'deliver_next',side_effect=AssertionError('SMTP dispatch forbidden')))
        smtp=stack.enter_context(patch('smtplib.SMTP',side_effect=AssertionError('SMTP forbidden')))
        smtp_ssl=stack.enter_context(patch('smtplib.SMTP_SSL',side_effect=AssertionError('SMTP SSL forbidden')))
        admin_id,admin=account('QUAN_TRI_VIEN','manager')
        customer_id,customer=account('KHACH_HANG','customer')
        staff_id,staff=account('NHAN_VIEN','owner')
        peer_id,peer=account('NHAN_VIEN','peer')
        receiver_id,receiver=account('NHAN_VIEN','receiver')
        stranger_id,stranger=account('NHAN_VIEN','stranger')
        group_a,group_b,group_c,type_id,sla=[next(serial) for _ in range(5)]
        for gid in [group_a,group_b,group_c]:insert('nhom_ho_tro',nhom_ma=gid,ten=f'{prefix} group {gid}',dang_hoat_dong=True)
        for uid,gid in [(staff_id,group_a),(peer_id,group_a),(receiver_id,group_b),(stranger_id,group_c)]:insert('thanh_vien_nhom',nhom_ma=gid,nhan_vien_ma=uid)
        insert('loai_ho_tro',ht_ma=type_id,ten=f'{prefix} furniture',dang_hoat_dong=True)
        insert('xu_ly_mac_dinh',ht_ma=type_id,nhom_ma=group_a)
        for gid in [group_a,group_b]:insert('nhom_loai_ho_tro',nhom_ma=gid,ht_ma=type_id)
        priority=query('SELECT i FROM generate_series(30000,32767) i WHERE NOT EXISTS(SELECT 1 FROM {muc_do_uu_tien} WHERE mdut_ma=i OR thu_tu=i) LIMIT 1').fetchone()['i']
        insert('muc_do_uu_tien',mdut_ma=priority,ten=f'{prefix} fixture priority',thu_tu=priority)
        insert('chinh_sach_sla',sla_ma=sla,mdut_ma=priority,ten=f'{prefix} SLA',thoi_gian_phan_hoi_phut=15,thoi_gian_xu_ly_phut=90,dang_hoat_dong=True)
        states={r['ma']:r['tt_ma'] for r in query('SELECT ma,tt_ma FROM {trang_thai}').fetchall()}
        root_xid=query('SELECT txid_current() id').fetchone()['id']
        observed=observer.execute('SELECT count(*) FROM helpdesk.nguoi_dung WHERE nd_ma=%s',(admin_id,)).fetchone()[0]
        assert observed==0,'Fixture account visible outside rollback transaction'
        overview=admin.get('/api/v1/manager/overview?preset=today');assert overview.status_code==200
        base_pending=overview.json()['pending_escalations']
        get_list=admin.get('/api/v1/manager/tickets?urgent_only=true&page_size=5');assert get_list.status_code==200
        result['installed_get_apis']={'overview':overview.status_code,'tickets_urgent':get_list.status_code,'existing_pending':base_pending}
        tid,pc=ticket(owner=staff_id,old=True)
        normal,_=ticket(owner=staff_id)
        before=snapshot(tid)
        kpi_keys=['total','waiting','processing','paused','resolved','closed','overdue']
        kpi_before={preset:admin.get('/api/v1/manager/overview?preset='+preset).json() for preset in ['today','7d','month']}
        first=escalation(staff,tid).json()
        assert first['status']=='CHO_XU_LY' and first['requester_id']==str(staff_id) and first['source_group_id']==str(group_a)
        assert first['reason']=='Need specialist support' and first['created_at']
        preserved(before,snapshot(tid))
        for preset,prior in kpi_before.items():
            observed_kpi=admin.get('/api/v1/manager/overview?preset='+preset).json()
            assert {k:prior[k] for k in kpi_keys}=={k:observed_kpi[k] for k in kpi_keys}
        record('TC01',[201],'Installed helpdesk table; correct sender/group/time; ticket unchanged')
        escalation(staff,tid,expected=409)
        assert len(staff.get(f'/api/v1/staff/tickets/{tid}/escalations').json())==1
        try:
            with conn.transaction():
                conn.execute('''INSERT INTO helpdesk.yeu_cau_dieu_phoi_phieu
                    (phieu_ma,nhan_vien_gui_ma,nhom_gui_ma,phan_cong_gui_ma,ly_do)
                    SELECT phieu_ma,nhan_vien_gui_ma,nhom_gui_ma,phan_cong_gui_ma,ly_do
                    FROM helpdesk.yeu_cau_dieu_phoi_phieu WHERE yc_ma=%s''',(first['id'],))
        except UniqueViolation as exc:
            assert exc.diag.constraint_name=='uq_dieu_phoi_phieu_dang_cho'
        else:raise AssertionError('Installed unique index allowed duplicate pending row')
        record('TC02',[409],'Only one pending row')
        escalation(peer,tid,expected=409);escalation(stranger,tid,expected=404)
        escalation(customer,tid,expected=403)
        no_csrf=staff.post(f'/api/v1/staff/tickets/{tid}/escalations',json={'reason':'No token'},headers=origin)
        assert no_csrf.status_code==403
        record('TC03',[409,404,403,403],'Wrong owner, outside group, customer role and missing CSRF rejected')
        codes=[]
        for status in ['MOI','DA_DONG','DA_HUY','DA_GIAI_QUYET']:
            invalid,_=ticket(status=status,owner=staff_id if status!='MOI' else None,phase='provisional' if status=='MOI' else 'official')
            codes.append(escalation(staff,invalid,expected=409).status_code)
        record('TC04',codes,'New, closed, cancelled and resolved requests rejected')
        for reason in ['', '   ', 'x'*2001]:escalation(staff,tid,reason=reason,expected=422)
        call(staff,f'staff/tickets/{tid}/escalations',dict(expected_updated_at=detail(tid)['updated_at']),expected=422)
        record('TC05',[422,422,422,422],'Empty, whitespace, too long and missing reason')
        assert staff.get(f'/api/v1/staff/tickets/{tid}/escalations').status_code==200
        assert peer.get(f'/api/v1/staff/tickets/{tid}/escalations').status_code==404
        assert stranger.get(f'/api/v1/staff/tickets/{tid}/escalations').status_code==404
        assert customer.get(f'/api/v1/staff/tickets/{tid}/escalations').status_code==403
        record('TC06',[200,404,404,403],'History scoped to current owner or original requester')
        for preset in ['today','7d','month']:
            current=admin.get('/api/v1/manager/overview?preset='+preset);assert current.status_code==200
            assert current.json()['pending_escalations']==base_pending+1
            # This old fixture is outside every tested creation-date KPI cohort.
            assert current.json()['total']>=0
        overview_before=admin.get('/api/v1/manager/overview?preset=today').json()
        params={'search':prefix,'page_size':5,'from':overview_before['period_start'],'to':overview_before['period_end'],'sort':'intervention'}
        attention=admin.get('/api/v1/manager/tickets',params={**params,'dashboard_segment':'attention'}).json()
        assert attention['items'][0]['id']==str(tid)
        urgent=admin.get('/api/v1/manager/tickets',params={**params,'urgent_only':True}).json()
        assert urgent['total']==1 and urgent['items'][0]['id']==str(tid)
        assert observer.execute('SELECT count(*) FROM helpdesk.yeu_cau_dieu_phoi_phieu WHERE phieu_ma=%s',(tid,)).fetchone()[0]==0
        wrong=dict(reason='stale',expected_updated_at='2000-01-01T00:00:00Z')
        call(staff,f'staff/tickets/{tid}/escalations',wrong,expected=409)
        assign(tid,group_a,peer_id,None,expected=409)
        assign(tid,group_a,peer_id,first['id'],expected=409,expected_updated_at='2000-01-01T00:00:00Z')
        assign(tid,group_a,None,first['id'],expected=422)
        assign(tid,group_c,stranger_id,first['id'],expected=422)
        old_snapshot=snapshot(tid)
        assert old_snapshot==before
        with patch.object(escalation_service,'finish',side_effect=RuntimeError('Controlled fixture completion failure')):
            assign(tid,group_a,peer_id,first['id'],expected=500)
        assert snapshot(tid)==old_snapshot and escalation_service.pending(conn.cursor(row_factory=dict_row),tid)['yc_ma']==int(first['id'])
        record('TC10',[500],'Injected completion failure rolls back ticket, assignment and pending status')
        assigned=assign(tid,group_a,peer_id,first['id']).json()
        assert assigned['id']==str(tid) and assigned['assigned_id']==str(peer_id)
        after=snapshot(tid);preserved(before,after,assignment=True)
        assert len(after['assignments'])==len(before['assignments'])+1
        old_pc=next(r['data'] for r in before['assignments'] if r['data']['pc_ma']==pc)
        ended_pc=next(r['data'] for r in after['assignments'] if r['data']['pc_ma']==pc)
        assert ended_pc['ket_thuc'] is not None
        assert {k:v for k,v in old_pc.items() if k!='ket_thuc'}=={k:v for k,v in ended_pc.items() if k!='ket_thuc'}
        assert query('SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s AND ket_thuc IS NULL',(tid,)).fetchone()['n']==1
        assert staff.get(f'/api/v1/staff/tickets/{tid}/escalations').json()[0]['status']=='DA_DIEU_PHOI'
        record('TC07',[200],'Same-group assignment + completion, one active assignment, unchanged immutable fields')
        assign(tid,group_a,staff_id,first['id'],expected=409)
        call(admin,f"manager/tickets/{tid}/escalations/{first['id']}/reject",dict(reason='already processed',expected_updated_at=detail(tid)['updated_at']),expected=409)
        record('TC11',[409,409,409,409,409],'Stale staff/manager timestamp, request ID and replay cannot overwrite completed work')
        second=escalation(peer,tid).json()
        before_cross=snapshot(tid)
        assign(tid,group_b,receiver_id,second['id'])
        cross=snapshot(tid);preserved(before_cross,cross,assignment=True)
        assert cross['ticket']['nhom_ma']==group_b and cross['ticket']['nhan_vien_phu_trach_ma']==receiver_id
        assert peer.get(f'/api/v1/staff/tickets/{tid}').status_code==404
        own=peer.get(f'/api/v1/staff/tickets/{tid}/escalations');assert own.status_code==200
        assert all(e['requester_id']==str(peer_id) for e in own.json()) and own.json()[0]['assigned_id']==str(receiver_id)
        record('TC08',[200,404,200],'Actual N-N expertise, receiver has exactly one group; former sender sees only outcome')
        third=escalation(receiver,tid).json();before_reject=snapshot(tid)
        for reason in ['', '   ']:call(admin,f"manager/tickets/{tid}/escalations/{third['id']}/reject",dict(reason=reason,expected_updated_at=detail(tid)['updated_at']),expected=422)
        call(admin,f"manager/tickets/{tid}/escalations/{third['id']}/reject",dict(reason='Continue current specialist handling',expected_updated_at=detail(tid)['updated_at']),expected=200)
        preserved(before_reject,snapshot(tid))
        assert receiver.get(f'/api/v1/staff/tickets/{tid}/escalations').json()[0]['status']=='TU_CHOI'
        assert query('SELECT count(*) n FROM {yeu_cau_dieu_phoi_phieu} WHERE phieu_ma=%s',(tid,)).fetchone()['n']==3
        record('TC09',[422,422,200],'Reason required; multiple completed history rows, unchanged assignment/SLA')
        # Installed CHECK/FK constraints: invalid fixture-only inserts stay inside savepoints.
        for error,statement in [(CheckViolation,"UPDATE helpdesk.yeu_cau_dieu_phoi_phieu SET trang_thai='INVALID' WHERE yc_ma=%s"),(CheckViolation,"UPDATE helpdesk.yeu_cau_dieu_phoi_phieu SET ly_do=' ' WHERE yc_ma=%s"),(ForeignKeyViolation,"UPDATE helpdesk.yeu_cau_dieu_phoi_phieu SET nhan_vien_gui_ma=9223372036854775807 WHERE yc_ma=%s")]:
            try:
                with conn.transaction():conn.execute(statement,(third['id'],))
            except error:pass
            else:raise AssertionError('Installed constraint did not reject invalid fixture')
        pending_ids=[]
        for _ in range(6):
            page_tid,_=ticket(owner=staff_id,old=True)
            pending_ids.append(page_tid);escalation(staff,page_tid)
        p1=admin.get('/api/v1/manager/tickets',params={'urgent_only':True,'search':prefix,'page_size':5,'page':1}).json()
        p2=admin.get('/api/v1/manager/tickets',params={'urgent_only':True,'search':prefix,'page_size':5,'page':2}).json()
        assert p1['total']==p2['total']==6 and len(p1['items'])==5 and len(p2['items'])==1
        assert {int(r['id']) for r in p1['items']+p2['items']}==set(pending_ids)
        assert admin.get('/api/v1/manager/tickets?urgent_only=true&search=not-a-fixture-'+prefix).json()['total']==0
        for preset in ['today','7d','month']:
            current=admin.get('/api/v1/manager/overview?preset='+preset).json()
            assert current['pending_escalations']==base_pending+6
            assert current['pending_escalations']==query("SELECT count(*) n FROM {yeu_cau_dieu_phoi_phieu} WHERE trang_thai='CHO_XU_LY'").fetchone()['n']
        # Independent read-only connection cannot acquire the actual coordination lock.
        assert observer.execute('SELECT pg_try_advisory_xact_lock(741032026)').fetchone()[0] is False
        result['dashboard']={'status':'PASS','pagination':[5,1],'old_period_visible':True,'urgent_before_normal':True,'installed_counter_matches_sql':True,'kpi_unchanged_today_7d_month':True}
        assert query('SELECT txid_current() id').fetchone()['id']==root_xid
        assert pids=={conn.info.backend_pid}
        assert not mail.called and not smtp.called and not smtp_ssl.called
        audit=[json.loads(line) for line in (Path(tmp)/'manager.jsonl').read_text(encoding='utf-8').splitlines()]
        assert {'escalation.request','escalation.assign','escalation.reject'} <= {row['action'] for row in audit}
        result['isolation']={'same_connection_for_all_api_calls':True,'root_transaction_unchanged':True,'independent_observer_cannot_see_fixtures':True,'smtp_calls':0,'ddl_statements':0,'migration_runs':0}
        for client in clients:client.close()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    result={'schema':None,'cases':{},'status':'FAIL'}
    output=Path('docs/POST_MIGRATION007_TEST_DATA.json')
    # Observer is read-only and is opened before blocking all unexpected connections.
    with get_connection() as observer:
        observer.autocommit=True
        observer.execute('SET default_transaction_read_only=on')
        result['schema']=metadata(observer)  # any mismatch stops before fixture writes
        before=fingerprints(observer)
        sequences_before=sequences(observer)
        result['real_table_counts_before']={k:v['n'] for k,v in before.items()}
        if not args.execute:
            print('PASS installed schema; supply --execute for guarded rollback API fixtures');return
        try:
            with TemporaryDirectory(prefix='helpdesk-p007-') as tmp,patch.dict(os.environ,{'MANAGER_AUDIT_DIR':tmp,'SMTP_HOST':'','SMTP_FROM':'','MAIL_SERVER':'','MAIL_FROM':''}),get_connection() as conn:
                with conn.transaction(force_rollback=True):
                    conn.execute("SET LOCAL lock_timeout='5s'")
                    run(conn,observer,result,tmp)
            result['status']='PASS'
        except Exception as exc:
            result['error']={'type':type(exc).__name__,'message':str(exc)[:800]}
            raise
        finally:
            after=fingerprints(observer)
            sequences_after=sequences(observer)
            unchanged=before==after
            result['preservation']={'all_existing_rows_and_counts_unchanged':unchanged,'table_count_before':len(before),'table_count_after':len(after),'changed_tables':[t for t in before if before[t]!=after.get(t)],'fixtures_rolled_back':True,'sequences_reset':False,'sequence_gaps_possible':True}
            result['preservation']['sequences_advanced']=[name for name,value in sequences_before.items() if value!=sequences_after.get(name)]
            output.write_text(json.dumps(result,ensure_ascii=False,indent=2,default=str)+'\n',encoding='utf-8')
            assert unchanged,'Existing data changed during run; inspect concurrent activity before concluding'
            print('PASS rollback: all installed table row fingerprints/counts unchanged; no DDL, migration or SMTP')


if __name__=='__main__':main()
