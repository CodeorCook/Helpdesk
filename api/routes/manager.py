from schemas.conversation import Conversation
from services import conversation_service
from fastapi import HTTPException
from typing import Literal
from datetime import date
from fastapi import APIRouter,Depends,Path,Query
from fastapi.responses import FileResponse
from api.routes.auth import require_role
from api.routes.customer import mutation_guard
from schemas.auth import UserResponse
from schemas.manager import Account,AccountPage,AccountUpdate,EmployeeCreate,RoleChange,StoredRole,DashboardOverview
from schemas.manager import GroupInput,GroupUpdate,Group,GroupDetail,GroupPage,MemberInput,MembershipChange,Message,Routing,RoutingInput,SLAState
from schemas.manager import AssignmentInput, ManagerTicketPage
from schemas.manager import SLAInput,SLAUpdate,SLAApply,Policy,PolicyPage
from schemas.manager import ReportAnalytics,ReportPage,ActivityPage
from schemas.staff import StaffPage,StaffTicket,StaffDetail,Employee,Receipt
from schemas.customer import CatalogItem, MessageCreate
from services import manager_service as service
from services import report_service

router=APIRouter(prefix='/api/v1/manager',tags=['Quản lý'])
manager=require_role('manager')
def ID():
    return Path(gt=0,le=9223372036854775807)


@router.get('/overview',response_model=DashboardOverview)
def overview(preset: Literal['today','7d','month'] | None=None, user:UserResponse=Depends(manager)):
    options = {}
    if preset:
        start, end = report_service.report_period(preset, None, None)
        options = dict(from_date=start, to_date=end)
    result=service.overview(user.id, include_trends=True, **options)
    from services import escalation_service
    with service.manager_cursor(user.id) as (cur,_):
        result['escalation_available']=escalation_service.available(cur)
        result['pending_escalations']=None
        if result['escalation_available']:
            escalation_service.execute(cur,"SELECT count(*) total FROM {yeu_cau_dieu_phoi_phieu} WHERE trang_thai='CHO_XU_LY'")
            result['pending_escalations']=cur.fetchone()['total']
    return result


@router.get('/users',response_model=AccountPage)
def users(search:str=Query('',max_length=150),role:StoredRole|None=None,status:Literal['HOAT_DONG','KHOA']|None=None,page:int=Query(1,ge=1,le=100000),page_size:int=Query(10,ge=1,le=50),user:UserResponse=Depends(manager)):
    return service.users(user.id,search,role,status,page,page_size)


@router.post('/users',response_model=Account,status_code=201,dependencies=[Depends(mutation_guard)])
def create(body:EmployeeCreate,user:UserResponse=Depends(manager)):return service.create_employee(user.id,body)


@router.get('/users/{user_id}',response_model=Account)
def account(user_id:int=ID(),user:UserResponse=Depends(manager)):return service.account(user.id,user_id)


@router.patch('/users/{user_id}',response_model=Account,dependencies=[Depends(mutation_guard)])
def update(body:AccountUpdate,user_id:int=ID(),user:UserResponse=Depends(manager)):return service.update_account(user.id,user_id,body)


@router.post('/users/{user_id}/role',response_model=Account,dependencies=[Depends(mutation_guard)])
def role(body:RoleChange,user_id:int=ID(),user:UserResponse=Depends(manager)):return service.change_role(user.id,user_id,body)


@router.get('/groups',response_model=GroupPage)
def groups(page:int=Query(1,ge=1,le=100000),page_size:int=Query(20,ge=1,le=100),user:UserResponse=Depends(manager)):
    return service.groups(user.id,page,page_size)


@router.post('/groups',response_model=Group,status_code=201,dependencies=[Depends(mutation_guard)])
def create_group(body:GroupInput,user:UserResponse=Depends(manager)):return service.create_group(user.id,body)


@router.get('/groups/{group_id}',response_model=GroupDetail)
def group_detail(group_id:int=ID(),user:UserResponse=Depends(manager)):return service.group_detail(user.id,group_id)


@router.patch('/groups/{group_id}',response_model=Group,dependencies=[Depends(mutation_guard)])
def update_group(body:GroupUpdate,group_id:int=ID(),user:UserResponse=Depends(manager)):return service.update_group(user.id,group_id,body)


@router.post('/groups/{group_id}/members',response_model=Message,dependencies=[Depends(mutation_guard)])
def add_member(body:MemberInput,group_id:int=ID(),user:UserResponse=Depends(manager)):return service.member_change(user.id,group_id,body.employee_id)


@router.post('/groups/{group_id}/members/remove',response_model=Message,dependencies=[Depends(mutation_guard)])
def remove_member(body:MemberInput,group_id:int=ID(),user:UserResponse=Depends(manager)):return service.member_change(user.id,group_id,body.employee_id,True)


@router.post('/groups/{group_id}/members/move', response_model=Message, dependencies=[Depends(mutation_guard)])
def move_member(body: MembershipChange, group_id: int = ID(), user: UserResponse = Depends(manager)):
    return service.change_employee_group(user.id, group_id, body)


@router.get('/routing',response_model=list[Routing])
def routing(user:UserResponse=Depends(manager)):return service.routing(user.id)


@router.patch('/routing/{type_id}',response_model=Message,dependencies=[Depends(mutation_guard)])
def update_routing(body:RoutingInput,type_id:int=ID(),user:UserResponse=Depends(manager)):return service.update_routing(user.id,type_id,body)


@router.delete('/routing/{type_id}', response_model=Message, dependencies=[Depends(mutation_guard)])
def remove_routing(type_id: int = ID(), expected_group_id: int = Query(..., gt=0, le=9223372036854775807),
                   user: UserResponse = Depends(manager)):
    return service.remove_routing(user.id, type_id, expected_group_id)


def ticket_filters(search:str=Query('',max_length=200),type_id:int|None=Query(None,alias='type',gt=0,le=9223372036854775807),
                   status:str|None=Query(None,max_length=30,pattern='^[A-Z_]+$'),priority:int|None=Query(None,gt=0,le=32767),
                   from_date:date|None=Query(None,alias='from',le=date(9998,12,31)),to_date:date|None=Query(None,alias='to',le=date(9998,12,31)),
                   group_id:int|None=Query(None,alias='group',gt=0,le=9223372036854775807),employee_id:int|None=Query(None,alias='employee',gt=0,le=9223372036854775807),
                   customer_status:Literal['HOAT_DONG','KHOA']|None=None,scope:Literal['all','waiting','unrouted']='all',
                   sla_state:SLAState|None=None):
    return dict(search=search,type_id=type_id,status=status,priority=priority,from_date=from_date,to_date=to_date,group_id=group_id,employee_id=employee_id,customer_status=customer_status,scope=scope,sla_state=sla_state)


@router.get('/tickets',response_model=ManagerTicketPage)
def tickets(filters:dict=Depends(ticket_filters),page:int=Query(1,ge=1,le=100000),page_size:int=Query(10,ge=1,le=50),
            dashboard_segment:Literal['attention','processing','closed','waiting','overdue','other']|None=None,
            sort:Literal['intervention']|None=None,urgent_only:bool=False,user:UserResponse=Depends(manager)):
    return service.tickets(user.id,page,page_size,dashboard_segment=dashboard_segment,sort=sort,urgent_only=urgent_only,**filters)


@router.get('/catalog/{kind}',response_model=list[CatalogItem])
def catalog(kind:Literal['types','statuses','priorities'],user:UserResponse=Depends(manager)):
    with service.manager_cursor(user.id) as (cur,_):
        statements={'types':'SELECT ht_ma::text id,ten name FROM {loai_ho_tro} WHERE dang_hoat_dong ORDER BY ht_ma',
                    'statuses':'SELECT tt_ma::text id,ten name,ma code FROM {trang_thai} ORDER BY tt_ma',
                    'priorities':'SELECT mdut_ma::text id,ten name FROM {muc_do_uu_tien} ORDER BY thu_tu'}
        service.execute(cur,statements[kind]);return cur.fetchall()


@router.get('/groups/{group_id}/eligible-employees',response_model=list[Employee])
def employees(group_id:int=ID(),user:UserResponse=Depends(manager)):return service.eligible_employees(user.id,group_id)


@router.get('/tickets/{ticket_id}',response_model=StaffDetail)
def ticket_detail(ticket_id:int=ID(),user:UserResponse=Depends(manager)):return service.ticket_detail(user.id,ticket_id)


@router.post('/tickets/{ticket_id}/assignment',response_model=StaffTicket,dependencies=[Depends(mutation_guard)])
def assignment(body:AssignmentInput,ticket_id:int=ID(),user:UserResponse=Depends(manager)):return service.assign(user.id,ticket_id,body)


@router.get('/tickets/{ticket_id}/attachments/{attachment_id}',response_class=FileResponse)
def download(ticket_id:int=ID(),attachment_id:int=ID(),user:UserResponse=Depends(manager)):
    path,name=service.download(user.id,ticket_id,attachment_id)
    return FileResponse(path,filename=name,media_type='application/octet-stream',headers={'X-Content-Type-Options':'nosniff'})


@router.get('/sla',response_model=PolicyPage)
def policies(page:int=Query(1,ge=1,le=100000),page_size:int=Query(20,ge=1,le=100),user:UserResponse=Depends(manager)):return service.policies(user.id,page,page_size)


@router.post('/sla',response_model=Policy,status_code=201,dependencies=[Depends(mutation_guard)])
def create_sla(body:SLAInput,user:UserResponse=Depends(manager)):return service.save_policy(user.id,body)


@router.patch('/sla/{policy_id}',response_model=Policy,dependencies=[Depends(mutation_guard)])
def update_sla(body:SLAUpdate,policy_id:int=ID(),user:UserResponse=Depends(manager)):return service.save_policy(user.id,body,policy_id)


@router.post('/tickets/{ticket_id}/sla',response_model=StaffTicket,dependencies=[Depends(mutation_guard)])
def apply_sla(body:SLAApply,ticket_id:int=ID(),user:UserResponse=Depends(manager)):return service.apply_sla(user.id,ticket_id,body)


@router.get('/reports',response_model=ReportPage)
def reports(filters:dict=Depends(ticket_filters),page:int=Query(1,ge=1,le=100000),page_size:int=Query(10,ge=1,le=50),user:UserResponse=Depends(manager)):
    return service.reports(user.id,page,page_size,**filters)


def analytics_filters(preset: Literal['today','7d','30d','month','custom']='30d',
                      start: date | None=Query(None,le=date(9998,12,31)),
                      end: date | None=Query(None,le=date(9998,12,31)),
                      group_id: int | None=Query(None,alias='group',gt=0,le=9223372036854775807),
                      type_id: int | None=Query(None,alias='type',gt=0,le=9223372036854775807)):
    start, end = report_service.report_period(preset, start, end)
    return dict(start=start, end=end, group_id=group_id, type_id=type_id)


@router.get('/reports/analytics',response_model=ReportAnalytics)
def report_analytics(filters: dict=Depends(analytics_filters), user: UserResponse=Depends(manager)):
    return report_service.analytics(user.id, **filters)


@router.get('/reports/activity', response_model=ActivityPage)
def report_activity(filters: dict=Depends(analytics_filters), page: int=Query(1,ge=1,le=100000),
                    q: str=Query('',max_length=200), actor_name: str=Query('',max_length=100),
                    kind: Literal['status','dispatch','public','internal','attachment'] | None=None,
                    user: UserResponse=Depends(manager)):
    return report_service.report_activity(user.id, page=page, q=q, actor_name=actor_name, kind=kind, **filters)


@router.get('/activity',response_model=ActivityPage)
def activity(filters:dict=Depends(ticket_filters),page:int=Query(1,ge=1,le=100000),page_size:int=Query(20,ge=1,le=50),
             event_from:date|None=Query(None,le=date(9998,12,31)),event_to:date|None=Query(None,le=date(9998,12,31)),user:UserResponse=Depends(manager)):
    return service.activity(user.id,page,page_size,event_from,event_to,**filters)


@router.get('/tickets/{ticket_id}/conversation',response_model=Conversation)
def conversation(ticket_id:int=Path(gt=0,le=9223372036854775807),after:int|None=Query(None,gt=0,le=9223372036854775807),before:int|None=Query(None,gt=0,le=9223372036854775807),user:UserResponse=Depends(manager)):
    if after is not None and before is not None:
        raise HTTPException(422,'Chỉ chọn một hướng phân trang hội thoại.')
    return conversation_service.conversation('manager',user.id,ticket_id,after,before)


@router.post('/tickets/{ticket_id}/internal-messages', response_model=Receipt, status_code=201, dependencies=[Depends(mutation_guard)])
def send_internal_message(body: MessageCreate, ticket_id: int = Path(gt=0, le=9223372036854775807),
                          user: UserResponse = Depends(manager)):
    return service.send_internal_message(user.id, ticket_id, body.content)


@router.get('/tickets/{ticket_id}/attachments/{attachment_id}/preview',response_class=FileResponse)
def preview_attachment(ticket_id:int=Path(gt=0,le=9223372036854775807),attachment_id:int=Path(gt=0,le=9223372036854775807),user:UserResponse=Depends(manager)):
    path,name,mime=conversation_service.preview('manager',user.id,ticket_id,attachment_id)
    return FileResponse(path,filename=name,media_type=mime,content_disposition_type='inline',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"})


from services import support_type_service as support_types
from schemas.manager import SupportTypeInput, SupportTypeUpdate, SupportTypeDelete, SupportType, SupportTypePage, GroupTypes


@router.get('/support-types', response_model=SupportTypePage)
def support_catalog(search: str=Query('',max_length=200), active: bool|None=None,
                    page: int=Query(1,ge=1,le=100000), page_size: int=Query(5,ge=1,le=100), user: UserResponse=Depends(manager)):
    return support_types.catalog(user.id,search,active,page,page_size)


@router.post('/support-types', response_model=SupportType, status_code=201, dependencies=[Depends(mutation_guard)])
def create_support_type(body: SupportTypeInput,user: UserResponse=Depends(manager)):
    return support_types.save(user.id,body)


@router.patch('/support-types/{type_id}', response_model=SupportType, dependencies=[Depends(mutation_guard)])
def update_support_type(body: SupportTypeUpdate,type_id: int=ID(),user: UserResponse=Depends(manager)):
    return support_types.save(user.id,body,type_id)


@router.delete('/support-types/{type_id}', response_model=Message, dependencies=[Depends(mutation_guard)])
def delete_support_type(body: SupportTypeDelete,type_id: int=ID(),user: UserResponse=Depends(manager)):
    return support_types.delete(user.id,type_id,body.expected)


@router.get('/groups/{group_id}/support-types', response_model=GroupTypes)
def group_support_types(group_id: int=ID(),user: UserResponse=Depends(manager)):
    return support_types.group_types(user.id,group_id)


@router.post('/groups/{group_id}/support-types/{type_id}', response_model=Message, dependencies=[Depends(mutation_guard)])
def add_group_expertise(group_id: int=ID(),type_id: int=ID(),user: UserResponse=Depends(manager)):
    return support_types.change_expertise(user.id,group_id,type_id)


@router.delete('/groups/{group_id}/support-types/{type_id}', response_model=Message, dependencies=[Depends(mutation_guard)])
def remove_group_expertise(group_id: int=ID(),type_id: int=ID(),user: UserResponse=Depends(manager)):
    return support_types.change_expertise(user.id,group_id,type_id,True)


from schemas.manager import SLAStateChange


@router.get('/sla/{policy_id}', response_model=Policy)
def policy_detail(policy_id:int=ID(),user:UserResponse=Depends(manager)):
    with service.manager_cursor(user.id) as (cur,_):
        return service.policy_row(cur,policy_id)


@router.post('/sla/{policy_id}/state', response_model=Policy, dependencies=[Depends(mutation_guard)])
def policy_state(body:SLAStateChange,policy_id:int=ID(),user:UserResponse=Depends(manager)):
    return service.policy_state(user.id,policy_id,body)


@router.get('/sla/{policy_id}/state')
def policy_state_preview(policy_id:int=ID(),user:UserResponse=Depends(manager)):
    with service.manager_cursor(user.id) as (cur,_):
        policy=service.policy_row(cur,policy_id)
        service.execute(cur,service.POLICY_VIEW+' WHERE s.mdut_ma=%s AND s.dang_hoat_dong',(policy['priority_id'],))
        return {'policy':policy,'current':cur.fetchone()}


from schemas.manager import ManagerTicketPage
from schemas.staff import EscalationRequest
from services import escalation_service


@router.post('/tickets/{ticket_id}/escalations/{request_id}/reject',response_model=Message,dependencies=[Depends(mutation_guard)])
def reject_escalation(body:EscalationRequest,ticket_id:int=ID(),request_id:int=ID(),user:UserResponse=Depends(manager)):
    return escalation_service.reject(user.id,ticket_id,request_id,body)
