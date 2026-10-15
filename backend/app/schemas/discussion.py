import unicodedata
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.core.discussion import (
    MAX_DISCUSSION_MESSAGE_LENGTH,
    VALID_REACTION_SET,
    VALID_STICKER_IDS,
)


class DiscussionMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_message_id: UUID
    kind: Literal["TEXT", "STICKER", "CUSTOM_STICKER"]
    content: str | None = None
    sticker_id: str | None = None
    custom_sticker_id: UUID | None = None

    @field_validator("content", mode="before")
    @classmethod
    def validate_content_type(cls, v: object) -> object:
        if v is not None and not isinstance(v, str):
            raise ValueError("Content must be a string")
        return v

    @field_validator("sticker_id", mode="before")
    @classmethod
    def validate_sticker_type(cls, v: object) -> object:
        if v is not None and not isinstance(v, str):
            raise ValueError("Sticker ID must be a string")
        return v

    @field_validator("custom_sticker_id", mode="before")
    @classmethod
    def validate_custom_sticker_type(cls, v: object) -> object:
        if v is not None and not isinstance(v, (UUID, str)):
            raise ValueError("Custom sticker ID must be a UUID")
        return v

    @model_validator(mode="after")
    def validate_kind_fields(self) -> "DiscussionMessageCreate":
        if self.kind == "TEXT":
            if self.sticker_id is not None or self.custom_sticker_id is not None:
                raise ValueError("Text messages cannot include sticker identifiers")
            if self.content is None:
                raise ValueError("Text messages require content")

            # Normalize Unicode code points (NFC) and trim boundaries
            normalized = unicodedata.normalize("NFC", self.content).strip()
            if not normalized:
                raise ValueError("Content cannot be empty or whitespace only")

            # Check Unicode code point length
            if len(normalized) > MAX_DISCUSSION_MESSAGE_LENGTH:
                raise ValueError(
                    f"Content cannot exceed {MAX_DISCUSSION_MESSAGE_LENGTH} characters"
                )

            self.content = normalized

        elif self.kind == "STICKER":
            if self.content is not None or self.custom_sticker_id is not None:
                raise ValueError("Sticker messages cannot include text content")
            if not self.sticker_id:
                raise ValueError("Sticker messages require a sticker_id")

            if self.sticker_id not in VALID_STICKER_IDS:
                raise ValueError(f"Unknown sticker ID: '{self.sticker_id}'")

        elif self.kind == "CUSTOM_STICKER":
            if self.content is not None or self.sticker_id is not None:
                raise ValueError("Custom sticker messages cannot include text or a built-in sticker_id")
            if self.custom_sticker_id is None:
                raise ValueError("Custom sticker messages require a custom_sticker_id")

        return self


class ReactionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    emoji: str
    count: int


class DiscussionMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: str
    content: str | None = None
    sticker_id: str | None = None
    custom_sticker_id: UUID | None = None
    author_id: UUID
    author_username: str
    created_at: datetime
    reactions: list[ReactionSummary] = []
    caller_reaction: str | None = None


class DiscussionHistoryResponse(BaseModel):
    items: list[DiscussionMessageResponse]
    older_cursor: UUID | None = None
    newer_cursor: UUID | None = None
    has_more_older: bool = False
    has_more_newer: bool = False


class DiscussionReactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    emoji: str

    @field_validator("emoji")
    @classmethod
    def validate_emoji(cls, v: str) -> str:
        if v not in VALID_REACTION_SET:
            raise ValueError(f"Invalid reaction emoji: '{v}'. Must be one of {sorted(VALID_REACTION_SET)}")
        return v


class DiscussionReactionSummaryResponse(BaseModel):
    message_id: UUID
    reactions: list[ReactionSummary]
    caller_reaction: str | None = None


class StickerItemResponse(BaseModel):
    id: str
    name: str
    description: str
