from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ManagementEvent(Base):
    __tablename__ = "management_events"
    __table_args__ = (
        Index(
            "uq_management_events_removal_target",
            "community_id",
            "action",
            "target_type",
            "target_id",
            unique=True,
            postgresql_where=text("target_type != 'membership'"),
            sqlite_where=text("target_type != 'membership'"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    community_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("communities.id", ondelete="RESTRICT"), nullable=False
    )
    actor_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # No polymorphic FK/cascade into source content. UUID and type identify it.
    target_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
