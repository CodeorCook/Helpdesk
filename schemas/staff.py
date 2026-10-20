from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field
from schemas.customer import StrictInput, TicketCreate, TicketResponse, MessageCreate, AttachmentResponse, HistoryResponse


class StaffTicket(TicketResponse):
    group_id: str | None
    group_name: str | None
    assigned_id: str | None
    priority_id: str
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
    customer: Person
    messages: list[StaffMessageResponse]
    messages_truncated: bool
    attachments: list[AttachmentResponse]
    history: list[HistoryResponse]
    assignments: list[Assignment]
    assignment_id: str | None
    can_process: bool
    routing_warning: str | None
