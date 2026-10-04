from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict


class ModuleResponse(BaseModel):
    id: UUID
    community_id: UUID
    name: str
    slug: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
