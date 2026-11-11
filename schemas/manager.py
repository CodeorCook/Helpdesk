from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator
from schemas.auth import RegisterRequest
from schemas.customer import StrictInput
from core.validation import validate_phone

StoredRole = Literal['KHACH_HANG','NHAN_VIEN','QUAN_TRI_VIEN']
ID_MAX = 9223372036854775807
SLAState = Literal['within','soon','overdue','ended','none']


class Membership(BaseModel):
    id: str
    name: str
    pending: int


class EmployeeCreate(RegisterRequest):
    """No role input: the server always creates NHAN_VIEN."""


class Account(BaseModel):
    id: str
    name: str
    email: str
    phone: str | None
    role: StoredRole
    role_label: str
    status: Literal['HOAT_DONG','KHOA']
    created_at: datetime
    updated_at: datetime
    memberships: list[Membership] = Field(default_factory=list)


class AccountPage(BaseModel):
    items: list[Account]
    total: int
    page: int
    page_size: int


class AccountUpdate(StrictInput):
    name: str = Field(min_length=1,max_length=100)
    phone: str | None = Field(default=None,max_length=20)
    status: Literal['HOAT_DONG','KHOA']
    expected_updated_at: datetime
    lock_reason: str | None = Field(default=None, max_length=500, repr=False)
    _phone_valid = field_validator('phone')(validate_phone)

    @field_validator('name')
    @classmethod
    def nonblank(cls,value):
        if not value.strip():raise ValueError('Họ tên không được trống.')
        return value.strip()


class RoleChange(StrictInput):
    role: StoredRole
    current_password: str = Field(min_length=1,max_length=1024,repr=False,json_schema_extra={'writeOnly':True})
    confirmed: Literal[True]
    expected_updated_at: datetime


class GroupInput(StrictInput):
    name: str = Field(min_length=1,max_length=100)
    description: str | None = Field(default=None,max_length=5000)
    active: bool = True
    @field_validator('name')
    @classmethod
    def nonblank(cls,value):
        if not value.strip():raise ValueError('Tên nhóm không được trống.')
        return value.strip()


class GroupUpdate(GroupInput):
    expected: GroupInput


class Group(BaseModel):
    id: str
    name: str
    description: str | None
    active: bool
    members: int
    pending: int


class Member(BaseModel):
    id: str
    name: str
    status: str
    workload: int
    memberships: list[Membership] = Field(default_factory=list)


class SimpleItem(BaseModel):
    id: str
    name: str


class TicketCounts(BaseModel):
    total: int
    waiting: int
    processing: int
    paused: int
    resolved: int
    closed: int
    overdue: int


class GroupDetail(Group):
    stats: TicketCounts
    people: list[Member]
    types: list[SimpleItem]


class Message(BaseModel):
    message: str


class Routing(BaseModel):
    type_id: str
    type_name: str
    type_active: bool
    group_id: str | None
    group_name: str | None
    group_active: bool | None
    waiting: int


class GroupPage(BaseModel):
    items: list[Group]
    total: int
    page: int
    page_size: int


class MemberInput(StrictInput):
    employee_id: int = Field(gt=0,le=ID_MAX)


class MembershipChange(MemberInput):
    expected_groups: list[int] = Field(min_length=1, max_length=100)


class RoutingInput(StrictInput):
    group_id: int = Field(gt=0,le=ID_MAX)
    expected_group_id: int | None = Field(default=None,gt=0,le=ID_MAX)


class AssignmentInput(StrictInput):
    group_id: int = Field(gt=0,le=ID_MAX)
    employee_id: int | None = Field(default=None,gt=0,le=ID_MAX)
    expected_assignment_id: int | None = Field(default=None,gt=0,le=ID_MAX)
    expected_updated_at: datetime
    reason: str = Field(min_length=1,max_length=1000)
    @field_validator('reason')
    @classmethod
    def nonblank(cls,value):
        if not value.strip():raise ValueError('Cần ghi lý do điều phối.')
        return value.strip()


class SLAInput(StrictInput):
    name: str = Field(min_length=1,max_length=100)
    priority_id: int = Field(gt=0,le=32767)
    response_minutes: int = Field(gt=0,le=2147483647)
    resolution_minutes: int = Field(gt=0,le=2147483647)
    active: bool = True
    @field_validator('name')
    @classmethod
    def nonblank(cls,value):
        if not value.strip():raise ValueError('Tên chính sách không được trống.')
        return value.strip()
    @model_validator(mode='after')
    def durations(self):
        if self.resolution_minutes<self.response_minutes:raise ValueError('Thời gian xử lý phải lớn hơn hoặc bằng thời gian phản hồi (phút).')
        return self


class SLAUpdate(SLAInput):
    expected: SLAInput


class Policy(SLAInput):
    id: str
    priority: str
    referenced: int


class PolicyPage(BaseModel):
    items: list[Policy]
    total: int
    page: int
    page_size: int


class SLAApply(StrictInput):
    expected_updated_at: datetime
    recalculate: bool = False
    confirmed: Literal[True]


class NamedCount(BaseModel):
    name: str
    count: int


class ManagerOverview(TicketCounts):
    users: int
    groups: int
    by_status: list[NamedCount]
    by_group: list[NamedCount]
    by_type: list[NamedCount]
    by_priority: list[NamedCount]


class DashboardOverview(ManagerOverview):
    by_week: list[NamedCount]
    by_month: list[NamedCount]


class Performance(BaseModel):
    id: str
    name: str
    assigned: int
    active: int
    resolved: int
    closed: int
    completed_with_deadline: int
    on_time: int
    average_first_response_minutes: float | None
    average_rating: float | None


class ReportPage(BaseModel):
    summary: ManagerOverview
    items: list[Performance]
    total: int
    page: int
    page_size: int
    locality_supported: Literal[False] = False


class Activity(BaseModel):
    id: str
    ticket_id: str
    title: str
    happened_at: datetime
    kind: str
    actor: str
    detail: str


class ActivityPage(BaseModel):
    items: list[Activity]
    total: int
    page: int
    page_size: int

class AnalyticsMetrics(BaseModel):
    created: int
    resolved: int
    response_samples: int
    response_avg: float | None
    resolution_avg: float | None
    response_on_time: int
    response_late: int
    resolution_on_time: int
    resolution_late: int
    resolution_quarter: int
    resolution_half: int
    resolution_full: int
    response_missing: int
    resolution_missing: int
    response_open_late: int
    response_open_on_time: int
    resolution_open_late: int
    resolution_open_on_time: int
    intake_missing_sla: int
    missing_resolution_time: int
    closed_in_period: int
    closed_with_rating: int
    ratings: int
    rating_avg: float | None
    positive: int


class AnalyticsGroup(AnalyticsMetrics):
    group_id: str
    group_name: str


class AnalyticsPoint(BaseModel):
    grain: Literal['day', 'week', 'month']
    date: date
    created: int
    resolved: int


class RatingBucket(BaseModel):
    stars: int
    count: int


class ReportAnalytics(BaseModel):
    start: date
    end: date
    snapshot_at: datetime
    group_id: str | None
    type_id: str | None
    metrics: AnalyticsMetrics
    groups: list[AnalyticsGroup]
    rating_distribution: list[RatingBucket]
    trend: list[AnalyticsPoint]
