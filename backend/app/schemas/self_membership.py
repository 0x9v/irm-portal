from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from app.models.membership import (
    MembershipApplicantType,
    MembershipIdentifierType,
    MembershipStatus,
    MembershipRole,
)

class SelfMembershipInfo(BaseModel):
    id: UUID
    status: MembershipStatus
    role: MembershipRole
    cne: str | None = None
    applicant_type: MembershipApplicantType | None = None
    applicant_first_name: str | None = None
    applicant_family_name: str | None = None
    identifier_type: MembershipIdentifierType | None = None
    promotion: str | None = None

class SelfMembershipCapabilities(BaseModel):
    create_announcements: bool
    manage_document_voting: bool
    upload_official_documents: bool

class SelfMembershipResponse(BaseModel):
    membership: Optional[SelfMembershipInfo]
    capabilities: SelfMembershipCapabilities
