from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict
from app.models.membership import MembershipStatus, MembershipRole


class MembershipCreate(BaseModel):
    cne: str


class MembershipResponse(BaseModel):
    id: UUID
    community_id: UUID
    status: MembershipStatus
    role: MembershipRole
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PendingMembershipResponse(BaseModel):
    id: UUID
    status: MembershipStatus
    role: MembershipRole
    cne: str
    created_at: datetime
    updated_at: datetime
    
    # Applicant details
    username: str
    first_name: str
    family_name: str
    
    model_config = ConfigDict(from_attributes=True)
