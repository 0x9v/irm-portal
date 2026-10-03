import enum
from uuid import UUID, uuid4

from sqlalchemy import Enum, ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PermissionType(str, enum.Enum):
    UPLOAD_OFFICIAL_DOCUMENTS = "UPLOAD_OFFICIAL_DOCUMENTS"
    CREATE_ANNOUNCEMENTS = "CREATE_ANNOUNCEMENTS"
    MANAGE_DOCUMENT_VOTING = "MANAGE_DOCUMENT_VOTING"


class MembershipPermission(Base):
    __tablename__ = "membership_permissions"
    __table_args__ = (
        UniqueConstraint("membership_id", "permission", name="uq_membership_permissions"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    membership_id: Mapped[UUID] = mapped_column(
        ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False
    )
    permission: Mapped[PermissionType] = mapped_column(
        Enum(PermissionType, name="permission_type", native_enum=False, length=50),
        nullable=False,
    )

    membership: Mapped["Membership"] = relationship(back_populates="permissions")
