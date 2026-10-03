from pydantic import BaseModel, ConfigDict
from typing import Optional

class MembershipPermissionsResponse(BaseModel):
    upload_official_documents: bool
    create_announcements: bool
    manage_document_voting: bool

    model_config = ConfigDict(from_attributes=True)

class MembershipPermissionsUpdate(BaseModel):
    upload_official_documents: Optional[bool] = None
    create_announcements: Optional[bool] = None
    manage_document_voting: Optional[bool] = None
