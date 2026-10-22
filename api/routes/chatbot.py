from fastapi import APIRouter,Depends,Path,Query
from api.routes.customer import customer,mutation_guard
from schemas.auth import UserResponse
from schemas.chatbot import Session,SessionPage,History,MessageInput,ConfirmInput,ConfirmResult
from services import chatbot_service as service

router=APIRouter(prefix='/api/v1/customer/chatbot',tags=['Trợ lý AI Khách hàng'])

@router.get('/sessions',response_model=SessionPage)
def sessions(page:int=Query(1,ge=1,le=10000),user:UserResponse=Depends(customer)):
    return service.sessions(user.id,page)

@router.post('/sessions',response_model=Session,status_code=201,dependencies=[Depends(mutation_guard)])
def new_session(user:UserResponse=Depends(customer)):
    service.rate(user.id,'session');return service.new_session(user.id)

@router.get('/sessions/{session_id}',response_model=History)
def history(session_id:int=Path(gt=0,le=9223372036854775807),before:int|None=Query(None,gt=0,le=9223372036854775807),user:UserResponse=Depends(customer)):
    return service.history(user.id,session_id,before)

@router.post('/sessions/{session_id}/messages',response_model=History,dependencies=[Depends(mutation_guard)])
def message(body:MessageInput,session_id:int=Path(gt=0,le=9223372036854775807),user:UserResponse=Depends(customer)):
    service.rate(user.id,'generate');return service.message(user.id,session_id,body)

@router.post('/sessions/{session_id}/draft',response_model=History,dependencies=[Depends(mutation_guard)])
def prepare(session_id:int=Path(gt=0,le=9223372036854775807),user:UserResponse=Depends(customer)):
    service.rate(user.id,'generate');return service.message(user.id,session_id,MessageInput(content='Tôi đồng ý chuẩn bị bản nháp yêu cầu hỗ trợ từ vấn đề vừa trao đổi. Hãy hỏi thêm nếu chưa đủ thông tin.',prepare_draft=True))

@router.post('/sessions/{session_id}/draft/cancel',response_model=History,dependencies=[Depends(mutation_guard)])
def cancel(session_id:int=Path(gt=0,le=9223372036854775807),user:UserResponse=Depends(customer)):
    return service.cancel(user.id,session_id)

@router.post('/sessions/{session_id}/confirm',response_model=ConfirmResult,dependencies=[Depends(mutation_guard)])
def confirm(body:ConfirmInput,session_id:int=Path(gt=0,le=9223372036854775807),user:UserResponse=Depends(customer)):
    return service.confirm(user.id,session_id,body)
