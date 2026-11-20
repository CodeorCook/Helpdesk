"""SLA version assertions inside the phase4 rollback-only fixture transaction."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import threading
from unittest.mock import patch
from services import manager_service as manager, staff_service


def values(row):
    return {k: row[k] for k in ('name','priority_id','response_minutes','resolution_minutes','active')}


def run(admin, staff, customer, post, cur, prefix, existing_id, priority, type_id, original, get_connection):
    def q(statement, params=()):
        manager.execute(cur,statement,params)
        return cur
    def snapshot(ticket_id):
        return q('SELECT sla_ma,han_phan_hoi,han_xu_ly,ngay_tao,ngay_phan_hoi_dau,ngay_giai_quyet FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket_id,)).fetchone()
    def create(name,minutes=90):
        response=post(admin,'manager/sla',dict(name=f'{name} {prefix}',priority_id=priority,response_minutes=10,resolution_minutes=minutes))
        assert response.status_code==201,response.text
        assert response.json()['active'] is False
        return response.json()
    def activate(policy,active_id):
        return post(admin,f"manager/sla/{policy['id']}/state",dict(active=True,expected=values(policy),expected_active_id=active_id))
    def intake(title):
        response=post(customer,'customer/tickets',dict(title=title,description='SLA fixture request',type_id=type_id))
        assert response.status_code==201,response.text
        return response.json()['id']
    def approval(ticket_id,level=priority,**extra):
        ticket=q('SELECT tieu_de title,mo_ta description,ht_ma type_id,ngay_cap_nhat FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket_id,)).fetchone()
        return dict(title=ticket['title'],description=ticket['description'],type_id=ticket['type_id'],priority_id=level,expected_updated_at=ticket['ngay_cap_nhat'].isoformat(),**extra)

    old=snapshot(existing_id)
    waiting=intake('Waiting during replacement')
    provisional=snapshot(waiting)
    v2=create('Version 2')
    edited=post(admin,f"manager/sla/{v2['id']}",
                {**values(v2),'name':f'Edited version 2 {prefix}','expected':values(v2)},'PATCH')
    assert edited.status_code==200,edited.text
    v2=edited.json()
    assert admin.get(f"/api/v1/manager/sla/{original['id']}").json()['active'] is True
    assert post(admin,f"manager/sla/{original['id']}/state",dict(active=False,expected=values(original),expected_active_id=original['id'])).status_code==409
    assert post(staff,f"manager/sla/{v2['id']}/state",dict(active=True,expected=values(v2),expected_active_id=original['id'])).status_code==403
    assert admin.post(f"/api/v1/manager/sla/{v2['id']}/state",json=dict(active=True,expected=values(v2),expected_active_id=original['id'])).status_code==403
    analytics='/api/v1/manager/reports/analytics?preset=today&type='+str(type_id)
    metrics=admin.get(analytics).json()['metrics']
    assert activate(v2,original['id']).status_code==200
    assert admin.get(analytics).json()['metrics']==metrics
    assert snapshot(existing_id)==old and snapshot(waiting)==provisional
    assert admin.get(f"/api/v1/manager/tickets/{existing_id}").json()['sla_name']==original['name']
    history=customer.get(f'/api/v1/customer/tickets/{existing_id}').json()
    assert history['sla_id']==str(original['id']) and history['sla_name']==original['name']
    assert activate(v2,original['id']).status_code==409
    assert post(admin,f"manager/sla/{original['id']}",{**values(original),'active':False,'resolution_minutes':original['resolution_minutes']+1,'expected':{**values(original),'active':False}},'PATCH').status_code==409
    assert post(admin,'manager/sla',{**values(v2),'active':False,'resolution_minutes':0}).status_code==422
    assert post(admin,'manager/sla',{**values(v2),'active':False,'response_minutes':1000,'resolution_minutes':1}).status_code==422
    assert post(admin,'manager/sla',{**values(v2),'active':False,'resolution_minutes':2147483648}).status_code==422

    preview=staff.get('/api/v1/staff/sla-preview',params={'priority_id':priority})
    assert preview.status_code==200 and preview.json()['policy']['id']==v2['id']
    approved=post(staff,f'staff/tickets/{waiting}/approve',approval(waiting))
    assert approved.status_code==200,approved.text
    assert approved.json()['sla_id']==v2['id'] and approved.json()['sla_phase']=='official'
    attached=snapshot(waiting)
    assert attached['ngay_tao']==provisional['ngay_tao']
    assert (attached['han_xu_ly']-attached['ngay_tao']).total_seconds()==90*60
    original_snapshot=q('SELECT yeu_cau_goc FROM {phieu_ho_tro} WHERE phieu_ma=%s',(waiting,)).fetchone()['yeu_cau_goc']
    assert original_snapshot['sla_id_before_review']==str(original['id']) and original_snapshot['sla_phase_before_review']=='provisional'
    assert str(original['id']) in original_snapshot['_sla_used_ids'] and str(v2['id']) in original_snapshot['_sla_used_ids']

    # An old unmarked MOI must never silently lose an already stored SLA.
    legacy=intake('Legacy phase unknown')
    q('UPDATE {phieu_ho_tro} SET yeu_cau_goc=NULL WHERE phieu_ma=%s',(legacy,))
    before=snapshot(legacy)
    assert post(staff,f'staff/tickets/{legacy}/approve',approval(legacy)).status_code==409
    assert snapshot(legacy)==before
    assert post(staff,f'staff/tickets/{legacy}/approve',approval(legacy,confirm_legacy_sla_replacement=True)).status_code==200

    # Chosen priority wins, regardless of the provisional/default priority.
    high=q("SELECT mdut_ma FROM {muc_do_uu_tien} WHERE ten='Cao' ORDER BY mdut_ma LIMIT 1").fetchone()['mdut_ma']
    high_active=q('SELECT sla_ma FROM {chinh_sach_sla} WHERE mdut_ma=%s AND dang_hoat_dong',(high,)).fetchone()
    if high_active:
        high_id=high_active['sla_ma']
    else:
        r=post(admin,'manager/sla',dict(name=f'High {prefix}',priority_id=high,response_minutes=5,resolution_minutes=30,active=True));assert r.status_code==201,r.text
        high_id=int(r.json()['id'])
    chosen=intake('Chosen high priority')
    r=post(staff,f'staff/tickets/{chosen}/approve',approval(chosen,level=high))
    assert r.status_code==200 and int(r.json()['sla_id'])==int(high_id),r.text

    # Missing active policy rolls the entire approval back, keeping the draft/request intact.
    missing=intake('No policy available')
    unused=q('SELECT i FROM generate_series(29000,29999) i WHERE NOT EXISTS(SELECT 1 FROM {muc_do_uu_tien} WHERE mdut_ma=i OR thu_tu=i) LIMIT 1').fetchone()['i']
    q('INSERT INTO {muc_do_uu_tien}(mdut_ma,ten,thu_tu) VALUES(%s,%s,%s)',(unused,f'Fixture missing {prefix}',unused))
    assert staff.get('/api/v1/staff/sla-preview',params={'priority_id':unused}).json()['policy'] is None
    before=snapshot(missing)
    assert post(staff,f'staff/tickets/{missing}/approve',approval(missing,level=unused)).status_code==422
    assert snapshot(missing)==before
    assert q('SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s',(missing,)).fetchone()['n']==0
    huge=post(admin,'manager/sla',dict(name=f'Overflow fixture {prefix}',priority_id=unused,response_minutes=1,resolution_minutes=2147483647,active=True))
    assert huge.status_code==201,huge.text
    q("UPDATE {phieu_ho_tro} SET ngay_tao=TIMESTAMPTZ '9000-01-01 00:00:00+00' WHERE phieu_ma=%s",(missing,))
    overflow=post(staff,f'staff/tickets/{missing}/approve',approval(missing,level=unused))
    assert overflow.status_code==422 and 'timestamp' in overflow.json()['detail'],overflow.text
    q('UPDATE {phieu_ho_tro} SET ngay_tao=%s WHERE phieu_ma=%s',(before['ngay_tao'],missing))

    # Competing requests share the fixture connection; test the real DB lock separately below.
    a,b=create('Candidate A'),create('Candidate B',100)
    start=threading.Barrier(2)
    def compete(policy):
        start.wait(timeout=5)
        return activate(policy,v2['id']).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        result=list(pool.map(compete,[a,b]))
    assert sorted(result)==[200,409],result
    active=q('SELECT sla_ma FROM {chinh_sach_sla} WHERE mdut_ma=%s AND dang_hoat_dong',(priority,)).fetchone()['sla_ma']
    assert q('SELECT count(*) n FROM {chinh_sach_sla} WHERE mdut_ma=%s AND dang_hoat_dong',(priority,)).fetchone()['n']==1
    with get_connection() as connection,connection.cursor() as other:
        other.execute('SELECT pg_try_advisory_xact_lock(%s,%s)',(74104,priority))
        assert other.fetchone()[0] is False
    # Failed activation is atomic: old active flag is restored if enabling the target fails.
    target=create('Rollback target')
    original_execute=manager.execute
    def fail_update(cursor,statement,params=()):
        if 'SET dang_hoat_dong=true' in statement:raise RuntimeError('fixture activation failure')
        return original_execute(cursor,statement,params)
    with patch.object(manager,'execute',fail_update):
        assert activate(target,active).status_code==500
    assert q('SELECT sla_ma FROM {chinh_sach_sla} WHERE mdut_ma=%s AND dang_hoat_dong',(priority,)).fetchone()['sla_ma']==active

    concurrent=intake('Approval versus activation')
    body=approval(concurrent)
    start=threading.Barrier(2)
    def do_approve():
        start.wait(timeout=5)
        return post(staff,f'staff/tickets/{concurrent}/approve',body)
    def do_replace():
        start.wait(timeout=5)
        return activate(target,active)
    with ThreadPoolExecutor(max_workers=2) as pool:
        x,y=pool.submit(do_approve),pool.submit(do_replace)
        first,second=x.result(),y.result()
    assert first.status_code==200 and second.status_code==200,(first.text,second.text)
    applied=snapshot(concurrent)
    version=q('SELECT thoi_gian_phan_hoi_phut a,thoi_gian_xu_ly_phut b FROM {chinh_sach_sla} WHERE sla_ma=%s',(applied['sla_ma'],)).fetchone()
    assert (applied['han_phan_hoi']-applied['ngay_tao']).total_seconds()==version['a']*60
    assert (applied['han_xu_ly']-applied['ngay_tao']).total_seconds()==version['b']*60
    assert snapshot(existing_id)==old
    audit=[json.loads(line) for line in (Path(os.environ['MANAGER_AUDIT_DIR'])/'manager.jsonl').read_text(encoding='utf-8').splitlines()]
    assert any(row['action']=='sla.lock' and row['target']==str(original['id']) for row in audit)
    assert any(row['action']=='sla.activate' and row['target']==str(v2['id']) for row in audit)
    # Leave the caller's private fixture policy active for subsequent regression stages.
    original_now=admin.get(f"/api/v1/manager/sla/{original['id']}").json()
    assert activate(original_now,target['id']).status_code==200
    print('PASS SLA versions: multiple inactive, one active, atomic replacement/rollback, role/CSRF/stale conflicts, existing and MOI deadlines preserved; preview/high priority/missing SLA/legacy confirmation; concurrent HTTP activation and approval; independent PG priority lock.')
