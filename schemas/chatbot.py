from datetime import datetime
from typing import Literal
from pydantic import BaseModel,ConfigDict,Field,field_validator
from schemas.customer import TicketCreate,TicketResponse

class Strict(BaseModel):
    model_config=ConfigDict(extra='forbid')

class Draft(Strict):
    title: str = Field(max_length=200)
    description: str = Field(max_length=20000)
    type_id: str | None
    missing_information: list[str] = Field(max_length=8)
    ready_for_confirmation: bool

class AIAnswer(Strict):
    answer: str = Field(min_length=1,max_length=6000)
    offer_ticket: bool
    draft: Draft | None

class MessageInput(Strict):
    content: str = Field(min_length=1,max_length=2000)
    prepare_draft: bool = False
    @field_validator('content')
    @classmethod
    def nonblank(cls,v):
        if not v.strip():raise ValueError('Vui lòng nhập nội dung câu hỏi.')
        return v.strip()

class ConfirmInput(TicketCreate):
    draft_message_id: int = Field(gt=0,le=9223372036854775807)
    confirmed: Literal[True]

class Source(BaseModel):
    id: str
    question: str

class ChatMessage(BaseModel):
    id: str
    sender: str
    content: str
    created_at: datetime
    draft: Draft | None = None
    offer_ticket: bool = False
    sources: list[Source] = []

class Session(BaseModel):
    id: str
    created_at: datetime
    ticket_id: str | None

class SessionPage(BaseModel):
    items: list[Session]
    total: int
    page: int

class History(BaseModel):
    session: Session
    messages: list[ChatMessage]
    has_older: bool

class ConfirmResult(BaseModel):
    ticket: TicketResponse
    replayed: bool
