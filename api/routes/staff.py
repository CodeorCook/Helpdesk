from schemas.conversation import Conversation, ReadCustomerMessages
from services import conversation_service
from fastapi import HTTPException
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Path, Query, File, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from core.uploads import upload_limit, allowed_extensions
from api.routes.auth import require_role
from api.routes.customer import mutation_guard
from schemas.auth import UserResponse
from schemas.customer import CatalogItem, AttachmentResponse, UploadPolicy
from schemas.staff import (StaffOverview, StaffPage, StaffTicket, StaffDetail, StaffCreate, StaffApprove, StaffReject, Classification,
                           Transfer, StatusChange, StaffMessage, Person, Employee, Receipt)
from services import staff_service as service

router = APIRouter(prefix='/api/v1/staff', tags=['Nhân viên hỗ trợ'])
staff = require_role('staff')
def ID():
    return Path(gt=0, le=9223372036854775807)


@router.get('/overview', response_model=StaffOverview)
def overview(user: UserResponse = Depends(staff)):
    return service.overview(user.id)


@router.get('/ticket-types', response_model=list[CatalogItem])
def types(user: UserResponse = Depends(staff)):
    return service.catalog(user.id, 'types')


@router.get('/ticket-statuses', response_model=list[CatalogItem])
def statuses(user: UserResponse = Depends(staff)):
    return service.catalog(user.id, 'statuses')


@router.get('/priorities', response_model=list[CatalogItem])
def priorities(user: UserResponse = Depends(staff)):
    return service.catalog(user.id, 'priorities')


@router.get('/tickets', response_model=StaffPage)
def tickets(scope: Literal['queue','mine','recommended','team'] = 'queue', search: str = Query('',max_length=200),
            type_id: int | None = Query(None,alias='type',gt=0,le=9223372036854775807),
            status: str | None = Query(None,max_length=30,pattern='^[A-Z_]+$'), priority: int | None = Query(None,gt=0,le=32767),
            from_date: date | None = Query(None,alias='from',le=date(9998,12,31)), to_date: date | None = Query(None,alias='to',le=date(9998,12,31)),
            sort: Literal['newest','due','oldest'] | None = None, page: int = Query(1,ge=1,le=100000),page_size: int = Query(10,ge=1,le=50), user: UserResponse = Depends(staff)):
    if sort == 'oldest' and scope != 'mine':
        raise HTTPException(422, 'Sắp xếp cũ nhất chỉ áp dụng cho Phiếu của tôi.')
    return service.list_tickets(user.id,scope,search,type_id,status,priority,from_date,to_date,page,page_size,sort)


@router.post('/tickets/{ticket_id}/accept', response_model=StaffTicket, dependencies=[Depends(mutation_guard)])
def accept(ticket_id: int =ID(), user: UserResponse = Depends(staff)):
    raise HTTPException(409, 'Hãy mở yêu cầu, chuẩn hóa nội dung và chọn mức ưu tiên để lập phiếu hỗ trợ.')


@router.post('/tickets/{ticket_id}/approve', response_model=StaffTicket, dependencies=[Depends(mutation_guard)])
def approve(body: StaffApprove, ticket_id: int = ID(), user: UserResponse = Depends(staff)):
    return service.approve(user.id, ticket_id, body)


@router.post('/tickets/{ticket_id}/reject', response_model=StaffTicket, dependencies=[Depends(mutation_guard)])
def reject(body: StaffReject, ticket_id: int = ID(), user: UserResponse = Depends(staff)):
    return service.reject(user.id, ticket_id, body)


@router.get('/customers', response_model=list[Person])
def customers(search: str = Query('',max_length=150),user: UserResponse = Depends(staff)):
    return service.customers(user.id,search)


@router.post('/tickets',response_model=Receipt,status_code=201,dependencies=[Depends(mutation_guard)])
def create(body: StaffCreate,user: UserResponse = Depends(staff)):
    return service.create_ticket(user.id,body)


@router.get('/tickets/{ticket_id}',response_model=StaffDetail)
def detail(ticket_id: int =ID(),user: UserResponse = Depends(staff)):
    return service.detail(user.id,ticket_id)


@router.patch('/tickets/{ticket_id}/classification',response_model=StaffDetail,dependencies=[Depends(mutation_guard)])
def classification(body: Classification,ticket_id: int =ID(),user: UserResponse = Depends(staff)):
    return service.classify(user.id,ticket_id,body)


@router.get('/tickets/{ticket_id}/recipients',response_model=list[Employee])
def recipients(ticket_id: int =ID(),user: UserResponse = Depends(staff)):
    return service.recipients(user.id,ticket_id)


@router.post('/tickets/{ticket_id}/transfer',response_model=StaffTicket,dependencies=[Depends(mutation_guard)])
def transfer(body: Transfer,ticket_id: int =ID(),user: UserResponse = Depends(staff)):
    return service.transfer(user.id,ticket_id,body)


@router.post('/tickets/{ticket_id}/status',response_model=StaffTicket,dependencies=[Depends(mutation_guard)])
def status(body: StatusChange,ticket_id: int =ID(),user: UserResponse = Depends(staff)):
    return service.update_status(user.id,ticket_id,body)


@router.post('/tickets/{ticket_id}/messages',response_model=Receipt,status_code=201,dependencies=[Depends(mutation_guard)])
def message(body: StaffMessage,ticket_id: int =ID(),user: UserResponse = Depends(staff)):
    result=service.send_message(user.id,ticket_id,body)
    return {**result,'message':'Đã lưu ghi chú nội bộ.' if body.internal else 'Đã gửi phản hồi công khai.'}


@router.post('/tickets/{ticket_id}/conversation/read', status_code=204, dependencies=[Depends(mutation_guard)])
def mark_read(body: ReadCustomerMessages, ticket_id: int = ID(), user: UserResponse = Depends(staff)):
    service.mark_customer_messages_read(user.id, ticket_id, body.message_ids)


@router.get('/attachment-policy',response_model=UploadPolicy)
def policy(user: UserResponse = Depends(staff)):
    with service.staff_cursor(user.id):
        return dict(max_bytes=upload_limit(),max_files=20,extensions=allowed_extensions())


@router.post('/tickets/{ticket_id}/attachments',response_model=AttachmentResponse,status_code=201,dependencies=[Depends(mutation_guard)])
async def upload(ticket_id: int =ID(),file: UploadFile = File(),user: UserResponse = Depends(staff)):
    try:
        content=await file.read(upload_limit()+1)
        return await run_in_threadpool(service.upload_attachment,user.id,ticket_id,file.filename,file.content_type,content)
    finally:await file.close()


@router.get('/tickets/{ticket_id}/attachments/{attachment_id}',response_class=FileResponse)
def download(ticket_id: int =ID(),attachment_id: int =ID(),user: UserResponse = Depends(staff)):
    path,name=service.download_attachment(user.id,ticket_id,attachment_id)
    return FileResponse(path,filename=name,media_type='application/octet-stream',headers={'X-Content-Type-Options':'nosniff'})


@router.get('/tickets/{ticket_id}/conversation',response_model=Conversation)
def conversation(ticket_id:int=Path(gt=0,le=9223372036854775807),after:int|None=Query(None,gt=0,le=9223372036854775807),before:int|None=Query(None,gt=0,le=9223372036854775807),user:UserResponse=Depends(staff)):
    if after is not None and before is not None:
        raise HTTPException(422,'Chỉ chọn một hướng phân trang hội thoại.')
    return conversation_service.conversation('staff',user.id,ticket_id,after,before)


@router.get('/tickets/{ticket_id}/attachments/{attachment_id}/preview',response_class=FileResponse)
def preview_attachment(ticket_id:int=Path(gt=0,le=9223372036854775807),attachment_id:int=Path(gt=0,le=9223372036854775807),user:UserResponse=Depends(staff)):
    path,name,mime=conversation_service.preview('staff',user.id,ticket_id,attachment_id)
    return FileResponse(path,filename=name,media_type=mime,content_disposition_type='inline',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"})
