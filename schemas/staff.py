from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field
from schemas.customer import TicketCancel, StrictInput, TicketCreate, TicketResponse, MessageCreate, AttachmentResponse, HistoryResponse


class StaffTicket(TicketResponse):
    group_id: str | None
    group_name: str | None
    assigned_id: str | None
    priority_id: str
    priority_rank: int | None = None
    unread_customer_messages: int | None = None
    recommended: bool = False
    sla_name: str | None
    response_due: datetime | None
    resolution_due: datetime | None
    first_response_at: datetime | None
    resolved_at: datetime | None
    sla_state: str


class StaffPage(BaseModel):
    items: list[StaffTicket]
    total: int
    page: int
    page_size: int
    attention: int | None = None
    soon: int | None = None
    overdue: int | None = None
    server_now: datetime | None = None
    next_transition: datetime | None = None


class StaffOverview(BaseModel):
    assigned: int
    queue: int
    recommended: int
    team: int
    unrouted: int
    groups: int
    overdue: int


class StaffCreate(TicketCreate):
    customer_id: int = Field(gt=0, le=9223372036854775807)
    priority_id: int = Field(gt=0, le=32767)


class StaffApprove(TicketCreate):
    priority_id: int = Field(gt=0, le=32767)
    expected_updated_at: datetime


class StaffReject(TicketCancel):
    expected_updated_at: datetime


class RequestSnapshot(BaseModel):
    title: str
    description: str
    type_id: str | None
    type_name: str | None
    priority_id: str
    sla_name: str | None
    response_due: datetime | None
    resolution_due: datetime | None
    sla_state: str
    captured_at: datetime


class Classification(StrictInput):
    type_id: int = Field(gt=0, le=9223372036854775807)
    priority_id: int = Field(gt=0, le=32767)


class Transfer(StrictInput):
    employee_id: int = Field(gt=0, le=9223372036854775807)
    assignment_id: int = Field(gt=0, le=9223372036854775807)


class StatusChange(StrictInput):
    status: Literal['DANG_XU_LY', 'TAM_DUNG', 'DA_GIAI_QUYET']


class StaffMessage(MessageCreate):
    internal: bool = False


class Person(BaseModel):
    id: str
    name: str


class Receipt(BaseModel):
    id: str
    message: str


class Employee(Person):
    workload: int


class Assignment(BaseModel):
    id: str
    employee: str
    started_at: datetime
    ended_at: datetime | None


class StaffMessageResponse(BaseModel):
    id: str
    sender: str
    content: str
    internal: bool
    created_at: datetime


class StaffDetail(StaffTicket):
    request_snapshot: RequestSnapshot | None = None
    customer: Person
    messages: list[StaffMessageResponse]
    messages_truncated: bool
    attachments: list[AttachmentResponse]
    history: list[HistoryResponse]
    assignments: list[Assignment]
    assignment_id: str | None
    can_process: bool
    routing_warning: str | None
