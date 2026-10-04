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
