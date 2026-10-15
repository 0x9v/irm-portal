from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, UniqueConstraint, Uuid, desc, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SavedDocument(Base):
    __tablename__ = "saved_documents"
    __table_args__ = (
        UniqueConstraint("user_id", "document_id", name="uq_saved_documents_user_document"),
        Index("ix_saved_documents_user_created_id", "user_id", desc("created_at"), desc("id")),
        Index("ix_saved_documents_document_id", "document_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="saved_documents")
    document: Mapped["Document"] = relationship(back_populates="saved_by")
