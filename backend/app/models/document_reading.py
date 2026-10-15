from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    UniqueConstraint,
    Uuid,
    desc,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DocumentReading(Base):
    """Private per-user activity and page position for an approved document."""

    __tablename__ = "document_reading_records"
    __table_args__ = (
        UniqueConstraint("user_id", "document_id", name="uq_document_reading_user_document"),
        CheckConstraint("last_page >= 1", name="ck_document_reading_last_page_positive"),
        Index("ix_document_reading_user_opened_id", "user_id", desc("last_opened_at"), desc("id")),
        Index("ix_document_reading_document_id", "document_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    last_page: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    last_opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )

    user: Mapped["User"] = relationship(back_populates="document_readings")
    document: Mapped["Document"] = relationship(back_populates="reading_records")
