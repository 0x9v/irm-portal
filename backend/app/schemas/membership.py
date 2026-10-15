from datetime import datetime
from uuid import UUID
import re
import unicodedata
from typing import Any

from pydantic import BaseModel, ConfigDict, StrictStr, field_validator, model_validator

from app.core.config import settings
from app.models.membership import (
    MembershipApplicantType,
    MembershipIdentifierType,
    MembershipStatus,
    MembershipRole,
)


NEW_APPLICATION_FIELDS = {
    "applicant_type", "applicant_first_name", "applicant_family_name",
    "identifier_type", "cne", "promotion",
}
CUSTOM_PROMOTION_FORMATS = ["YYYY", "YY", "YYYY/YYYY", "YY/YY"]


def promotion_options(current_year_start: int) -> list[str]:
    return [f"{year}/{year + 1}" for year in range(current_year_start - 1, current_year_start - 7, -1)]


def normalize_promotion(value: str, current_year_start: int) -> str:
    value = value.strip()
    year_pattern = r"(?:[0-9]{4}|[0-9]{2})"
    if not re.fullmatch(year_pattern + r"(?:/" + year_pattern + r")?", value, flags=re.ASCII):
        raise ValueError("Promotion must use YYYY, YY, YYYY/YYYY, or YY/YY format")
    parts = value.split("/")
    if len(parts) == 2 and len(parts[0]) != len(parts[1]):
        raise ValueError("Promotion year pairs must use matching year widths")

    def parse_year(part: str) -> int:
        return int("20" + part) if len(part) == 2 else int(part)

    years = [parse_year(part) for part in parts]
    end_year = years[-1]
    if len(years) == 2 and years[1] != years[0] + 1:
        raise ValueError("Promotion year pairs must be consecutive")
    if end_year > current_year_start:
        raise ValueError("Promotion cannot end after the current academic-year start")
    if len(years) == 1:
        return f"{years[0]:04d}"
    return f"{years[0]:04d}/{years[1]:04d}"


class MembershipCreate(BaseModel):
    cne: str | None = None
    applicant_type: MembershipApplicantType | None = None
    applicant_first_name: StrictStr | None = None
    applicant_family_name: StrictStr | None = None
    identifier_type: MembershipIdentifierType | None = None
    promotion: StrictStr | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def select_legacy_or_new_contract(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        application_keys = set(value) & (NEW_APPLICATION_FIELDS - {"cne"})
        if not application_keys:
            if "cne" not in value:
                raise ValueError("Legacy membership requests require cne")
            return value
        if "applicant_type" not in value or value.get("applicant_type") is None:
            raise ValueError("New membership applications require applicant_type")
        for field in ("cne", "applicant_first_name", "applicant_family_name", "promotion"):
            if field in value and value[field] is not None and not isinstance(value[field], str):
                raise ValueError(f"{field} must be a string")
        return value

    @field_validator("applicant_first_name", "applicant_family_name", mode="before")
    @classmethod
    def normalize_applicant_name(cls, value: Any) -> Any:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Applicant names must be strings")
        if any(unicodedata.category(char) in {"Cc", "Zl", "Zp"} for char in value):
            raise ValueError("Applicant names cannot contain control characters or line breaks")
        normalized = value.strip()
        if not normalized:
            raise ValueError("Applicant names cannot be empty")
        if len(normalized) > 100:
            raise ValueError("Applicant names cannot exceed 100 characters")
        return normalized

    @model_validator(mode="after")
    def validate_application_fields(self):
        if self.applicant_type is None:
            if self.cne is None:
                raise ValueError("Legacy membership requests require cne")
            return self

        if not self.applicant_first_name or not self.applicant_family_name:
            raise ValueError("New membership applications require both applicant names")

        if self.applicant_type is MembershipApplicantType.STUDENT:
            if self.identifier_type is None or self.cne is None:
                raise ValueError("Student applications require identifier_type and cne")
            if self.promotion is not None:
                raise ValueError("Student applications cannot include promotion")
            identifier = self.cne
            if any(unicodedata.category(char) == "Cc" for char in identifier):
                raise ValueError("Student identifiers cannot contain control characters")
            identifier = identifier.strip()
            if self.identifier_type is MembershipIdentifierType.MASSAR:
                if not re.fullmatch(r"[A-Za-z][0-9]{9}", identifier, flags=re.ASCII):
                    raise ValueError("MASSAR identifiers must be one ASCII letter followed by nine ASCII digits")
                identifier = identifier[0].upper() + identifier[1:]
            else:
                if not re.fullmatch(r"[A-Za-z0-9]{1,50}", identifier, flags=re.ASCII):
                    raise ValueError("FOREIGN identifiers must contain 1 to 50 ASCII letters or digits")
            self.cne = identifier
            return self

        if self.cne is not None or self.identifier_type is not None:
            raise ValueError("Laureate applications cannot include cne or identifier_type")
        if self.promotion is None:
            raise ValueError("Laureate applications require promotion")
        self.promotion = normalize_promotion(
            self.promotion, settings.membership_current_academic_year_start
        )
        return self


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
    cne: str | None
    applicant_type: MembershipApplicantType | None
    applicant_first_name: str | None
    applicant_family_name: str | None
    identifier_type: MembershipIdentifierType | None
    promotion: str | None
    created_at: datetime
    updated_at: datetime
    
    # Applicant details
    username: str
    first_name: str
    family_name: str
    
    model_config = ConfigDict(from_attributes=True)

class ActiveMembershipResponse(BaseModel):
    id: UUID
    status: MembershipStatus
    role: MembershipRole
    created_at: datetime
    updated_at: datetime
    
    # Member details
    username: str
    first_name: str
    family_name: str
    
    model_config = ConfigDict(from_attributes=True)

from typing import Literal

class RoleTransitionRequest(BaseModel):
    role: Literal['MEMBER', 'MODERATOR']

    model_config = ConfigDict(extra='forbid')


class MembershipDirectoryItem(BaseModel):
    id: UUID
    username: str
    status: MembershipStatus
    role: MembershipRole
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MembershipDirectoryResponse(BaseModel):
    items: list[MembershipDirectoryItem]
    next_cursor: UUID | None = None


class MembershipApplicationOptions(BaseModel):
    current_academic_year_start: int
    applicant_types: list[MembershipApplicantType]
    student_identifier_types: list[MembershipIdentifierType]
    promotion_options: list[str]
    custom_promotion_formats: list[str]
