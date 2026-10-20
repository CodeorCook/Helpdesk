from datetime import datetime
from typing import Literal
from core.validation import validate_phone
from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TicketCreate(StrictInput):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=20000)
    type_id: int = Field(gt=0, le=9223372036854775807)

    @field_validator("title", "description")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("Nội dung không được để trống.")
        return value.strip()


class TicketResponse(BaseModel):
    id: str
    title: str
    description: str
    type_id: str | None
    type_name: str | None
    status: str
    status_label: str
    priority: str
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
    assigned_to: str | None


class CatalogItem(BaseModel):
    id: str
    name: str
    code: str | None = None


class TicketPage(BaseModel):
    items: list[TicketResponse]
    total: int
    page: int
    page_size: int


class Overview(BaseModel):
    total: int
    active: int
    resolved: int
    closed: int


class MessageResponse(BaseModel):
    id: str
    content: str
    sender: str
    from_customer: bool
    created_at: datetime


class AttachmentResponse(BaseModel):
    id: str
    name: str
    mime_type: str
    size: int
    created_at: datetime


class HistoryResponse(BaseModel):
    previous: str | None
    current: str
    created_at: datetime


class RatingResponse(BaseModel):
    stars: int
    comment: str | None
    created_at: datetime


class TicketDetail(TicketResponse):
    messages: list[MessageResponse]
    messages_truncated: bool
    attachments: list[AttachmentResponse]
    history: list[HistoryResponse]
    rating: RatingResponse | None


class MessageCreate(StrictInput):
    content: str = Field(min_length=1, max_length=10000)

    @field_validator("content")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("Tin nhắn không được để trống.")
        return value.strip()


class CloseRequest(StrictInput):
    reason: str | None = Field(default=None, max_length=1000)


class RatingCreate(StrictInput):
    stars: int = Field(ge=1, le=5, strict=True)
    comment: str | None = Field(default=None, max_length=2000)


class ProfileResponse(BaseModel):
    name: str
    email: str
    phone: str | None
    gender: str | None


class ProfileUpdate(StrictInput):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=20, pattern=r"^\+?[0-9 ()\-]{7,20}$")
    gender: Literal["NAM", "NU", "KHAC", "KHONG_TIET_LO"] | None = None
    _phone_valid = field_validator("phone")(validate_phone)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value):
        if value is None or not value.strip():
            raise ValueError("Họ tên không được để trống.")
        return value.strip()


class UploadPolicy(BaseModel):
    max_bytes: int
    max_files: int
    extensions: list[str]
