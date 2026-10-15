from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.models.document import DocumentSource, DocumentType

MAX_READER_PAGE = 100_000


class DocumentPageUpdate(BaseModel):
    page: StrictInt = Field(ge=1, le=MAX_READER_PAGE)

    model_config = ConfigDict(extra="forbid")


class DocumentReadingPositionResponse(BaseModel):
    last_page: int


class RecentDocumentResponse(BaseModel):
    id: UUID
    module_id: UUID
    module_slug: str
    module_name: str
    title: str
    type: DocumentType
    source: DocumentSource
    last_page: int
    last_opened_at: datetime


class RecentDocumentFeedResponse(BaseModel):
    items: list[RecentDocumentResponse]
    next_cursor: UUID | None = None
