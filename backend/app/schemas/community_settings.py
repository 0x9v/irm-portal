from pydantic import BaseModel, ConfigDict, Field

class DocumentVotingSettingsUpdate(BaseModel):
    required_total_votes: int = Field(..., ge=1, strict=True)
    
    model_config = ConfigDict(extra="forbid")

class DocumentVotingSettingsResponse(BaseModel):
    required_total_votes: int
