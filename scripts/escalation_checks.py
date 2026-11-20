"""Opt-in checks in phase4's rollback transaction; migration targets a fixture schema."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from pathlib import Path
from unittest.mock import patch
import threading
import json
import os
from psycopg import sql
from psycopg.errors import UniqueViolation
from core.database import BASE_DIR
from services import manager_service as manager,escalation_service as escalation


def run(admin,staff,second,privileged,customer,post,cur,prefix,ticket_id,group_id,employee2,other_group,other_employee):
    def q(statement,params=()):manager.execute(cur,statement,params);return cur
    def detail():return admin.get(f'/api/v1/manager/tickets/{ticket_id}').json()
    def request(client=staff,id=ticket_id):
        version=q('SELECT ngay_cap_nhat FROM {phieu_ho_tro} WHERE phieu_ma=%s',(id,)).fetchone()['ngay_cap_nhat']
        return post(client,f'staff/tickets/{id}/escalations',dict(reason='Escalation private '+prefix,expected_updated_at=version.isoformat()))
    def snapshot():
        return q('SELECT sla_ma,mdut_ma,han_phan_hoi,han_xu_ly,tt_ma,nhom_ma,nhan_vien_phu_trach_ma FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket_id,)).fetchone()
    def assignment(d,group,employee,request_id):
        return dict(group_id=group,employee_id=employee,expected_assignment_id=d['assignment_id'],expected_updated_at=d['updated_at'],expected_escalation_id=request_id,reason='Manager dispatch '+prefix)
    schema='fixture_escalation_'+prefix
    with patch.object(escalation,'request_schema',return_value=schema):
        assert request().status_code==503
        cur.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        migration=(BASE_DIR/'docs/migrations/007_ticket_escalation.sql').read_text(encoding='utf-8')
        body=migration.split('BEGIN;',1)[1].rsplit('COMMIT;',1)[0]
        body=body.replace('helpdesk.yeu_cau_dieu_phoi_phieu',sql.Identifier(schema,'yeu_cau_dieu_phoi_phieu').as_string(cur))
        cur.execute(body);cur.execute(body)  # repeat-safe DDL, references to fixture rows in helpdesk only
        assert escalation.available(cur)
        assert second.post(f'/api/v1/staff/tickets/{ticket_id}/escalations',json={}).status_code==403
        assert request(second).status_code==409
        assert request(customer).status_code==403
        # Verify pending requests are global and don't disappear with the current day cohort.
        created_before=q('SELECT ngay_tao FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket_id,)).fetchone()['ngay_tao']
        q("UPDATE {phieu_ho_tro} SET ngay_tao=now()-interval '60 days' WHERE phieu_ma=%s",(ticket_id,))
        before=snapshot()
        stats_before=admin.get('/api/v1/manager/overview?preset=today').json()['total']
        with patch.object(staff._transport,'raise_server_exceptions',True):first=request()
        assert first.status_code==201,first.text
        first=first.json()
        assert snapshot()==before
        assert request().status_code==409
        counter=admin.get('/api/v1/manager/overview?preset=today').json()
        assert counter['pending_escalations']==1 and counter['total']==stats_before
        today=datetime.now(timezone.utc).date().isoformat()
        for params in [dict(urgent_only=True,**{'from':today,'to':today}),dict(dashboard_segment='attention',sort='intervention',**{'from':today,'to':today})]:
            r=admin.get('/api/v1/manager/tickets',params={**params,'page_size':5});assert r.status_code==200,r.text
            assert r.json()['items'][0]['id']==ticket_id and r.json()['items'][0]['pending_escalation']['id']==first['id']
        assert 'Escalation private '+prefix not in customer.get(f'/api/v1/customer/tickets/{ticket_id}').text
        current=detail()
        rejection=dict(reason='Keep current assignment '+prefix,expected_updated_at=current['updated_at'])
        assert post(admin,f"manager/tickets/{ticket_id}/escalations/{first['id']}/reject",rejection).status_code==200
        assert snapshot()==before
        assert admin.get('/api/v1/manager/overview').json()['pending_escalations']==0
        assert staff.get(f'/api/v1/staff/tickets/{ticket_id}/escalations').json()[0]['status']=='TU_CHOI'
        assert post(admin,f"manager/tickets/{ticket_id}/escalations/{first['id']}/reject",rejection).status_code==409

        start=threading.Barrier(2)
        def compete(_):start.wait(timeout=5);return request()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(compete,[1,2]))
        assert sorted(r.status_code for r in results)==[201,409]
        pending=next(r.json() for r in results if r.status_code==201)
        # Unique partial index is tested through direct SQL as well as service locking.
        try:
            with cur.connection.transaction():
                escalation.execute(cur,'''INSERT INTO {yeu_cau_dieu_phoi_phieu}
                    (phieu_ma,nhan_vien_gui_ma,nhom_gui_ma,phan_cong_gui_ma,ly_do)
                    SELECT phieu_ma,nhan_vien_gui_ma,nhom_gui_ma,phan_cong_gui_ma,ly_do
                    FROM {yeu_cau_dieu_phoi_phieu} WHERE yc_ma=%s''',(pending['id'],))
        except UniqueViolation:pass
        else:raise AssertionError('Partial unique index allowed duplicate pending requests')
        current=detail();body=assignment(current,group_id,employee2,pending['id'])
        assert post(admin,f'manager/tickets/{ticket_id}/assignment',{**body,'employee_id':None}).status_code==422
        assert post(admin,f'manager/tickets/{ticket_id}/assignment',{**body,'expected_escalation_id':None}).status_code==409
        assert post(admin,f'manager/tickets/{ticket_id}/assignment',{**body,'group_id':other_group,'employee_id':other_employee}).status_code==422
        active_before=current['assignment_id']
        with patch.object(escalation,'finish',side_effect=RuntimeError('fixture completion failure')):
            assert post(admin,f'manager/tickets/{ticket_id}/assignment',body).status_code==500
        assert snapshot()==before and detail()['assignment_id']==active_before
        assert escalation.pending(cur,ticket_id)['yc_ma']==int(pending['id'])
        assigned=post(admin,f'manager/tickets/{ticket_id}/assignment',body)
        assert assigned.status_code==200,assigned.text
        after=snapshot()
        for field in ('sla_ma','mdut_ma','han_phan_hoi','han_xu_ly','tt_ma'):assert after[field]==before[field]
        history=staff.get(f'/api/v1/staff/tickets/{ticket_id}/escalations').json()
        assert history[0]['status']=='DA_DIEU_PHOI' and history[0]['assigned_id']==str(employee2)
        assert q('SELECT count(*) n FROM {lich_su_phan_cong} WHERE phieu_ma=%s AND ket_thuc IS NULL',(ticket_id,)).fetchone()['n']==1
        assert q('SELECT ket_thuc FROM {lich_su_phan_cong} WHERE pc_ma=%s',(active_before,)).fetchone()['ket_thuc'] is not None
        assert request().status_code==409  # former owner, still in the same group

        cross=request(second);assert cross.status_code==201,cross.text
        cross=cross.json();current=detail()
        # Legacy routing is the fallback expertise relation in this regression harness.
        # This is an uncommitted fixture configuration, restored immediately afterward.
        q('UPDATE {xu_ly_mac_dinh} SET nhom_ma=%s WHERE ht_ma=%s',(other_group,current['type_id']))
        transferred=post(admin,f'manager/tickets/{ticket_id}/assignment',assignment(current,other_group,other_employee,cross['id']))
        assert transferred.status_code==200,transferred.text
        q('UPDATE {xu_ly_mac_dinh} SET nhom_ma=%s WHERE ht_ma=%s',(group_id,current['type_id']))
        assert second.get(f'/api/v1/staff/tickets/{ticket_id}').status_code==404
        own=second.get(f'/api/v1/staff/tickets/{ticket_id}/escalations')
        assert own.status_code==200 and own.json()[0]['assigned_id']==str(other_employee)
        assert all(e['requester_id']==str(employee2) for e in own.json())
        assert request(second).status_code==404
        assert privileged.get(f'/api/v1/staff/tickets/{ticket_id}').status_code==200

        # New intake/approval fixtures produce six pending requests; pagination happens in SQL.
        for i in range(6):
            response=post(customer,'customer/tickets',dict(title=f'Escalation page {i} {prefix}',description='Fixture only',type_id=current['type_id']))
            assert response.status_code==201,response.text
            tid=response.json()['id']
            if i==0:
                # Only an unreviewed MOI may remain in an unassigned group queue.
                d=admin.get(f'/api/v1/manager/tickets/{tid}').json()
                payload=assignment(d,other_group,None,None)
                moved=post(admin,f'manager/tickets/{tid}/assignment',payload)
                assert moved.status_code==200 and moved.json()['status']=='MOI',moved.text
                d=admin.get(f'/api/v1/manager/tickets/{tid}').json()
                returned=post(admin,f'manager/tickets/{tid}/assignment',assignment(d,group_id,None,None))
                assert returned.status_code==200 and returned.json()['status']=='MOI',returned.text
            q('SELECT tieu_de title,mo_ta description,ht_ma type_id,mdut_ma priority_id,ngay_cap_nhat FROM {phieu_ho_tro} WHERE phieu_ma=%s',(tid,))
            row=cur.fetchone();row['expected_updated_at']=row.pop('ngay_cap_nhat').isoformat()
            assert request(staff,tid).status_code==409
            response=post(staff,f'staff/tickets/{tid}/approve',row);assert response.status_code==200,response.text
            assert request(staff,tid).status_code==201
        page1=admin.get('/api/v1/manager/tickets?urgent_only=true&page_size=5').json()
        page2=admin.get('/api/v1/manager/tickets?urgent_only=true&page_size=5&page=2').json()
        assert page1['total']==6 and len(page1['items'])==5 and len(page2['items'])==1
        assert not ({t['id'] for t in page1['items']}&{t['id'] for t in page2['items']})
        assert admin.get('/api/v1/manager/tickets?urgent_only=true&search=does-not-exist').json()['total']==0
        pending_request=post(customer,'customer/tickets',dict(title='Provisional assigned fixture',description='Not reviewed',type_id=current['type_id']))
        assert pending_request.status_code==201,pending_request.text
        provisional_id=pending_request.json()['id']
        draft=admin.get(f'/api/v1/manager/tickets/{provisional_id}').json()
        direct=post(admin,f'manager/tickets/{provisional_id}/assignment',assignment(draft,group_id,before['nhan_vien_phu_trach_ma'],None))
        assert direct.status_code==200,direct.text
        assert request(staff,provisional_id).status_code==409
        # Terminal tickets cannot create another escalation; pending requests remain explicit until a manager handles them.
        terminal=page1['items'][0]['id']
        q("UPDATE {phieu_ho_tro} SET tt_ma=(SELECT tt_ma FROM {trang_thai} WHERE ma='DA_GIAI_QUYET') WHERE phieu_ma=%s",(terminal,))
        assert request(staff,terminal).status_code==409
        terminal_request=escalation.pending(cur,terminal)
        closed_version=admin.get(f'/api/v1/manager/tickets/{terminal}').json()['updated_at']
        resolved=post(admin,f"manager/tickets/{terminal}/escalations/{terminal_request['yc_ma']}/reject",
                      dict(reason='Phiếu đã giải quyết trước khi điều phối',expected_updated_at=closed_version))
        assert resolved.status_code==200,resolved.text
        audit=[json.loads(line) for line in (Path(os.environ['MANAGER_AUDIT_DIR'])/'manager.jsonl').read_text(encoding='utf-8').splitlines()]
        assert {'escalation.request','escalation.reject','escalation.assign'} <= {row['action'] for row in audit}
        restore=post(admin,f'manager/tickets/{ticket_id}/assignment',assignment(detail(),group_id,before['nhan_vien_phu_trach_ma'],None))
        assert restore.status_code==200,restore.text
        q('UPDATE {phieu_ho_tro} SET ngay_tao=%s WHERE phieu_ma=%s',(created_before,ticket_id))
        print('PASS escalation migration in rollback-only fixture schema: FK/checks/unique index; owner/status/CSRF/role; duplicate requests; global old-period ranking and SQL pagination; rejection; atomic assignment+completion rollback; same/cross-group assignment; SLA/status/history preserved; former requester outcome access without ticket access.')
