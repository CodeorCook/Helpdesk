from datetime import datetime
from pydantic import BaseModel


class ChatMessage(BaseModel):
    id: str
    sender_id: str
    sender: str
    content: str
    internal: bool
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
    messages: list[ChatMessage]
    has_older: bool
    has_more: bool
    events: list[ChatEvent]
    attachments: list[ChatAttachment]
