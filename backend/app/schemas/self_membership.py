from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from app.models.membership import MembershipStatus, MembershipRole

class SelfMembershipInfo(BaseModel):
    id: UUID
    status: MembershipStatus
    role: MembershipRole

class SelfMembershipCapabilities(BaseModel):
    create_announcements: bool
    manage_document_voting: bool
    upload_official_documents: bool

class SelfMembershipResponse(BaseModel):
    membership: Optional[SelfMembershipInfo]
    capabilities: SelfMembershipCapabilities
