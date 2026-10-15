from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PostModuleSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    name: str


class CommunityPostCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    content: str
    module_ids: list[UUID] = Field(default_factory=list)

    @field_validator("title", mode="before")
    @classmethod
    def validate_title_raw(cls, v: object) -> str:
        if not isinstance(v, str):
            raise ValueError("Title must be a string")
        v = v.strip()
        if not v:
            raise ValueError("Title cannot be empty or whitespace only")
        if len(v) > 150:
            raise ValueError("Title cannot exceed 150 characters")
        return v

    @field_validator("content", mode="before")
    @classmethod
    def validate_content_raw(cls, v: object) -> str:
        if not isinstance(v, str):
            raise ValueError("Content must be a string")
        v = v.strip()
        if not v:
            raise ValueError("Content cannot be empty or whitespace only")
        if len(v) > 10000:
            raise ValueError("Content cannot exceed 10000 characters")
        return v

    @field_validator("module_ids")
    @classmethod
    def validate_module_ids(cls, v: list[UUID]) -> list[UUID]:
        if len(v) > 3:
            raise ValueError("At most 3 modules can be tagged")
        if len(v) != len(set(v)):
            raise ValueError("Duplicate module tags are not permitted")
        return v


class CommunityPostFeedItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    excerpt: str
    author_username: str
    created_at: datetime
    modules: list[PostModuleSummary]


class CommunityPostFeedResponse(BaseModel):
    items: list[CommunityPostFeedItemResponse]
    next_cursor: UUID | None = None


class CommunityPostDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    content: str
    author_username: str
    created_at: datetime
    modules: list[PostModuleSummary]


class CommunityPostReplyCreate(BaseModel):
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


class CommunityPostReplyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    post_id: UUID
    author_username: str
    content: str
    created_at: datetime
    image_url: str | None = None


class CommunityPostReplyListResponse(BaseModel):
    items: list[CommunityPostReplyResponse]
    next_cursor: UUID | None = None
