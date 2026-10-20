from schemas.conversation import Conversation
from services import conversation_service
from fastapi import HTTPException
from datetime import date
from fastapi import APIRouter, Depends, File, Header, Path, Query, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from api.routes.auth import require_role, session_claims
from core.security import check_csrf
from schemas.auth import UserResponse
from schemas.customer import (AttachmentResponse, CatalogItem, CloseRequest, MessageCreate, MessageResponse, Overview,
                              ProfileResponse, ProfileUpdate, RatingCreate, RatingResponse, TicketCreate, TicketDetail, TicketPage, TicketResponse)
from core.uploads import allowed_extensions, upload_limit
from schemas.customer import UploadPolicy
from services import customer_service as service

router = APIRouter(prefix="/api/v1/customer", tags=["Khách hàng"])
customer = require_role("customer")


@router.get("/attachment-policy", response_model=UploadPolicy)
def attachment_policy(user: UserResponse = Depends(customer)):
    # Vẫn kiểm tra hồ sơ Khách hàng 1–1, không công khai cấu hình đường dẫn lưu trữ.
    with service.customer_cursor(user.id):
        return {"max_bytes":upload_limit(),"max_files":20,"extensions":allowed_extensions()}


def mutation_guard(request: Request, claims: dict = Depends(session_claims),
                   csrf_header: str | None = Header(default=None, alias="X-CSRF-Token", description="Mã từ GET /api/v1/auth/csrf; bắt buộc cho thay đổi dữ liệu.")):
    check_csrf(request, claims)


@router.get("/ticket-types", response_model=list[CatalogItem])
def ticket_types(user: UserResponse = Depends(customer)):
    return service.catalog(user.id, "types")


@router.get("/ticket-statuses", response_model=list[CatalogItem])
def ticket_statuses(user: UserResponse = Depends(customer)):
    return service.catalog(user.id, "statuses")


@router.post("/tickets", response_model=TicketResponse, status_code=201, dependencies=[Depends(mutation_guard)])
def create_ticket(body: TicketCreate, user: UserResponse = Depends(customer)):
    return service.create_ticket(user.id, body)


@router.get("/overview", response_model=Overview)
def overview(user: UserResponse = Depends(customer)):
    return service.overview(user.id)


@router.get("/tickets", response_model=TicketPage)
def tickets(search: str = Query(default="", max_length=200), type_id: int | None = Query(default=None, alias="type", gt=0, le=9223372036854775807),
            status: str | None = Query(default=None, max_length=30, pattern=r"^[A-Z_]+$"),
            from_date: date | None = Query(default=None, alias="from",le=date(9998,12,31)), to_date: date | None = Query(default=None, alias="to",le=date(9998,12,31)),
            page: int = Query(default=1, ge=1, le=100000), page_size: int = Query(default=10, ge=1, le=50), user: UserResponse = Depends(customer)):
    return service.list_tickets(user.id, search, type_id, status, from_date, to_date, page, page_size)


@router.get("/tickets/{ticket_id}", response_model=TicketDetail)
def ticket_detail(ticket_id: int = Path(gt=0, le=9223372036854775807), user: UserResponse = Depends(customer)):
    return service.detail(user.id, ticket_id)


@router.post("/tickets/{ticket_id}/messages", response_model=MessageResponse, status_code=201, dependencies=[Depends(mutation_guard)])
def send_message(body: MessageCreate, ticket_id: int = Path(gt=0,le=9223372036854775807), user: UserResponse = Depends(customer)):
    return service.send_message(user.id,ticket_id,body)


@router.post("/tickets/{ticket_id}/attachments", response_model=AttachmentResponse, status_code=201, dependencies=[Depends(mutation_guard)])
async def upload_attachment(ticket_id: int = Path(gt=0,le=9223372036854775807), file: UploadFile = File(), user: UserResponse = Depends(customer)):
    try:
        content = await file.read(upload_limit()+1)
        return await run_in_threadpool(service.upload_attachment,user.id,ticket_id,file.filename,file.content_type,content)
    finally:
        await file.close()


@router.get("/tickets/{ticket_id}/attachments/{attachment_id}", response_class=FileResponse)
def download_attachment(ticket_id: int = Path(gt=0,le=9223372036854775807), attachment_id: int = Path(gt=0,le=9223372036854775807), user: UserResponse = Depends(customer)):
    path,name = service.download_attachment(user.id,ticket_id,attachment_id)
    return FileResponse(path,filename=name,media_type="application/octet-stream",headers={"X-Content-Type-Options":"nosniff"})


@router.post("/tickets/{ticket_id}/close", response_model=TicketResponse, dependencies=[Depends(mutation_guard)])
def close_ticket(body: CloseRequest, ticket_id: int = Path(gt=0,le=9223372036854775807), user: UserResponse = Depends(customer)):
    return service.close_ticket(user.id,ticket_id,body)


@router.post("/tickets/{ticket_id}/rating", response_model=RatingResponse, status_code=201, dependencies=[Depends(mutation_guard)])
def rate_ticket(body: RatingCreate, ticket_id: int = Path(gt=0,le=9223372036854775807), user: UserResponse = Depends(customer)):
    return service.rate_ticket(user.id,ticket_id,body)


@router.get("/profile", response_model=ProfileResponse)
def profile(user: UserResponse = Depends(customer)):
    return service.profile(user.id)


@router.patch("/profile", response_model=ProfileResponse, dependencies=[Depends(mutation_guard)])
def update_profile(body: ProfileUpdate, user: UserResponse = Depends(customer)):
    return service.update_profile(user.id,body)


@router.get('/tickets/{ticket_id}/conversation',response_model=Conversation)
def conversation(ticket_id:int=Path(gt=0,le=9223372036854775807),after:int|None=Query(None,gt=0,le=9223372036854775807),before:int|None=Query(None,gt=0,le=9223372036854775807),user:UserResponse=Depends(customer)):
    if after is not None and before is not None:
        raise HTTPException(422,'Chỉ chọn một hướng phân trang hội thoại.')
    return conversation_service.conversation('customer',user.id,ticket_id,after,before)


@router.get('/tickets/{ticket_id}/attachments/{attachment_id}/preview',response_class=FileResponse)
def preview_attachment(ticket_id:int=Path(gt=0,le=9223372036854775807),attachment_id:int=Path(gt=0,le=9223372036854775807),user:UserResponse=Depends(customer)):
    path,name,mime=conversation_service.preview('customer',user.id,ticket_id,attachment_id)
    return FileResponse(path,filename=name,media_type=mime,content_disposition_type='inline',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"})
