from datetime import datetime
from uuid import UUID
from pydantic import BaseModel
from app.models.document import DocumentType, DocumentSource, DocumentStatus

class DocumentResponse(BaseModel):
    id: UUID
    title: str
    module_id: UUID
    uploader_id: UUID
    type: DocumentType
    source: DocumentSource
    status: DocumentStatus
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

from typing import Optional
from app.models.document_vote import VoteValue

class PendingDocumentResponse(BaseModel):
    id: UUID
    title: str
    type: DocumentType
    source: DocumentSource
    status: DocumentStatus
    created_at: datetime
    
    module_id: UUID
    module_slug: str
    module_name: str
    
    is_uploader: bool
    my_vote: Optional[VoteValue] = None
    can_vote: bool
    full_document_access: bool

    model_config = {"from_attributes": True}


class MyDocumentSubmissionResponse(BaseModel):
    id: UUID
    module_id: UUID
    module_slug: str
    module_name: str
    title: str
    type: DocumentType
    source: DocumentSource
    status: DocumentStatus
    created_at: datetime
    updated_at: datetime


class MyDocumentSubmissionFeedResponse(BaseModel):
    items: list[MyDocumentSubmissionResponse]
    next_cursor: UUID | None = None


class SavedDocumentStateResponse(BaseModel):
    saved: bool


class SavedDocumentResponse(BaseModel):
    id: UUID
    module_id: UUID
    module_slug: str
    module_name: str
    title: str
    type: DocumentType
    source: DocumentSource
    document_created_at: datetime
    saved_at: datetime


class SavedDocumentFeedResponse(BaseModel):
    items: list[SavedDocumentResponse]
    next_cursor: UUID | None = None
