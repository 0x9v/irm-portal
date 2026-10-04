from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Integer, String, UniqueConstraint, Uuid, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Community(Base):
    __tablename__ = "communities"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_communities_slug"),
        CheckConstraint("document_vote_threshold >= 1", name="ck_community_vote_threshold"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    document_vote_threshold: Mapped[int] = mapped_column(
        Integer, nullable=False, default=10, server_default="10"
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

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="community", cascade="all, delete-orphan"
    )

    modules: Mapped[list["Module"]] = relationship(
        back_populates="community", cascade="all, delete-orphan"
    )
    announcements: Mapped[list["Announcement"]] = relationship(
        back_populates="community", cascade="all, delete-orphan"
    )
