from datetime import datetime
from typing import Annotated
from pydantic import BaseModel, Field
from schemas.customer import StrictInput


class ReadCustomerMessages(StrictInput):
    message_ids: list[Annotated[int, Field(gt=0, le=9223372036854775807)]] = Field(min_length=1, max_length=100)


class ChatMessage(BaseModel):
    id: str
    sender_id: str
    sender: str
    content: str
    internal: bool
    from_customer: bool = False
    created_at: datetime


class ChatEvent(BaseModel):
    id: str
    content: str
    created_at: datetime


class ChatAttachment(BaseModel):
    id: str
    name: str
    mime_type: str
    size: int
    sender_id: str | None
    sender: str
    created_at: datetime


class Conversation(BaseModel):
    ticket_id: str
    status: str
    status_label: str
    assigned_id: str | None
    assigned_to: str | None
    group_id: str | None
    can_send: bool
    can_view_internal: bool
    can_send_internal: bool = False
    can_mark_read: bool = False
    messages: list[ChatMessage]
    has_older: bool
    has_more: bool
    events: list[ChatEvent]
    attachments: list[ChatAttachment]
