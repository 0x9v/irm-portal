import enum
from datetime import datetime, timezone
from uuid import UUID, uuid4
from app.models.membership_permission import PermissionType, MembershipPermission

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, String, UniqueConstraint, Uuid, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MembershipStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    REJECTED = "REJECTED"
    REMOVED = "REMOVED"
    BANNED = "BANNED"


class MembershipRole(str, enum.Enum):
    MEMBER = "MEMBER"
    DELEGATE = "DELEGATE"
    MODERATOR = "MODERATOR"


class MembershipApplicantType(str, enum.Enum):
    STUDENT = "STUDENT"
    LAUREATE = "LAUREATE"


class MembershipIdentifierType(str, enum.Enum):
    MASSAR = "MASSAR"
    FOREIGN = "FOREIGN"


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "community_id", name="uq_memberships_user_community"),
        Index(
            "uq_memberships_community_active_delegate",
            "community_id",
            unique=True,
            postgresql_where=text("status = 'ACTIVE' AND role = 'DELEGATE'"),
            sqlite_where=text("status = 'ACTIVE' AND role = 'DELEGATE'")
        ),
        CheckConstraint(
            "applicant_type IS NULL OR applicant_type IN ('STUDENT', 'LAUREATE')",
            name="membership_applicant_type",
        ),
        CheckConstraint(
            "identifier_type IS NULL OR identifier_type IN ('MASSAR', 'FOREIGN')",
            name="membership_identifier_type",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    community_id: Mapped[UUID] = mapped_column(
        ForeignKey("communities.id", ondelete="CASCADE"), nullable=False
    )
    cne: Mapped[str | None] = mapped_column(String(50), nullable=True)
    applicant_type: Mapped[MembershipApplicantType | None] = mapped_column(
        Enum(MembershipApplicantType, name="membership_applicant_type", native_enum=False, length=20),
        nullable=True,
    )
    identifier_type: Mapped[MembershipIdentifierType | None] = mapped_column(
        Enum(MembershipIdentifierType, name="membership_identifier_type", native_enum=False, length=20),
        nullable=True,
    )
    applicant_first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    applicant_family_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    promotion: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[MembershipStatus] = mapped_column(
        Enum(MembershipStatus, name="membership_status", native_enum=False, length=20),
        default=MembershipStatus.PENDING,
        nullable=False,
    )
    role: Mapped[MembershipRole] = mapped_column(
        Enum(MembershipRole, name="membership_role", native_enum=False, length=20),
        default=MembershipRole.MEMBER,
        server_default="MEMBER",
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="memberships")
    community: Mapped["Community"] = relationship(back_populates="memberships")
    permissions: Mapped[list["MembershipPermission"]] = relationship(back_populates="membership", cascade="all, delete-orphan")
