from pydantic import BaseModel, ConfigDict
from app.models.document_vote import VoteValue

class DocumentVoteCreate(BaseModel):
    vote: VoteValue
    
    model_config = ConfigDict(extra="forbid")

class DocumentVoteResponse(BaseModel):
    vote: VoteValue
    full_document_access: bool

    model_config = ConfigDict(from_attributes=True)
