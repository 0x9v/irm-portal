from datetime import datetime
import unicodedata
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StrictStr, field_validator


PROFILE_TEXT_LIMITS = {
    "username": (3, 50),
    "first_name": (1, 100),
    "family_name": (1, 100),
}

_BIDI_FORMAT_CONTROLS = {
    *range(0x202A, 0x202F),
    *range(0x2066, 0x206A),
}


def normalize_profile_text(field_name: str, value: str) -> str:
    """Trim profile field boundaries and reject unsafe or blank text."""
    if any(
        unicodedata.category(char) in {"Cc", "Cs", "Zl", "Zp"}
        or ord(char) in _BIDI_FORMAT_CONTROLS
        for char in value
    ):
        raise ValueError("Field contains unsupported control characters")

    normalized = value.strip()
    minimum, maximum = PROFILE_TEXT_LIMITS[field_name]
    if not minimum <= len(normalized) <= maximum:
        if field_name == "username":
            raise ValueError("Username must contain 3 to 50 characters")
        raise ValueError(f"{field_name.replace('_', ' ').title()} must contain 1 to 100 characters")
    return normalized


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=8)
    first_name: str = Field(..., min_length=1, max_length=100)
    family_name: str = Field(..., min_length=1, max_length=100)


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)


class UserProfileUpdate(BaseModel):
    """Strict partial update for the authenticated account's public identity."""

    model_config = ConfigDict(extra="forbid")

    username: StrictStr | None = None
    first_name: StrictStr | None = None
    family_name: StrictStr | None = None

    @field_validator("username", "first_name", "family_name", mode="before")
    @classmethod
    def reject_null_and_require_text(cls, value: object, info):
        if value is None:
            raise ValueError("Field cannot be null")
        if not isinstance(value, str):
            # StrictStr reports the standard sanitized string_type error.
            return value
        return normalize_profile_text(info.field_name, value)


class UserPasswordChange(BaseModel):
    """Only the two untransformed secrets required for an own-account change."""

    model_config = ConfigDict(extra="forbid")

    current_password: StrictStr = Field(min_length=1)
    new_password: StrictStr = Field(min_length=8)


class UserResponse(BaseModel):
    id: UUID
    username: str
    email: str
    first_name: str
    family_name: str
    created_at: datetime
    updated_at: datetime
    avatar_url: str | None = None

    model_config = ConfigDict(from_attributes=True)
