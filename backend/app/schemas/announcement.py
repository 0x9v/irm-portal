from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AnnouncementCreate(BaseModel):
    title: str = Field(..., max_length=255)
    content: str

    @field_validator("title", "content")
    @classmethod
    def strip_and_check_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Field cannot be empty or whitespace only")
        return v


class AnnouncementResponse(BaseModel):
    id: UUID
    community_id: UUID
    author_id: UUID
    title: str
    content: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AnnouncementDetailResponse(AnnouncementResponse):
    author_username: str | None = None


class AnnouncementReplyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str

    @field_validator("content", mode="before")
    @classmethod
    def validate_content_raw(cls, v: object) -> str:
        if not isinstance(v, str):
            raise ValueError("Content must be a string")
        v = v.strip()
        if not v:
            raise ValueError("Content cannot be empty or whitespace only")
        if len(v) > 2000:
            raise ValueError("Content cannot exceed 2000 characters")
        return v


class AnnouncementReplyResponse(BaseModel):
    id: UUID
    announcement_id: UUID
    author_username: str
    content: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AnnouncementReplyListResponse(BaseModel):
    items: list[AnnouncementReplyResponse]
    next_cursor: UUID | None = None


