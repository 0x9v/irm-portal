import enum
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Uuid, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DocumentType(str, enum.Enum):
    COURSE = "COURSE"
    TD = "TD"
    TP = "TP"
    EXAM = "EXAM"
    SOLUTION = "SOLUTION"
    OTHER = "OTHER"


class DocumentSource(str, enum.Enum):
    OFFICIAL = "OFFICIAL"
    STUDENT = "STUDENT"


class DocumentStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("vote_threshold_snapshot >= 1", name="ck_document_vote_snapshot"),
        CheckConstraint("source != 'STUDENT' OR status != 'PENDING' OR vote_threshold_snapshot IS NOT NULL", name="ck_doc_pending_student_snapshot"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    module_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("modules.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploader_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[DocumentType] = mapped_column(
        Enum(DocumentType, name="document_type", native_enum=False, length=20),
        nullable=False,
    )
    source: Mapped[DocumentSource] = mapped_column(
        Enum(DocumentSource, name="document_source", native_enum=False, length=20),
        nullable=False,
    )
    status: Mapped[DocumentStatus] = mapped_column(
        Enum(DocumentStatus, name="document_status", native_enum=False, length=20),
        default=DocumentStatus.PENDING,
        nullable=False,
    )
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    preview_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    vote_threshold_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)
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

    module: Mapped["Module"] = relationship(back_populates="documents")
    uploader: Mapped["User"] = relationship(back_populates="documents")
    votes: Mapped[list["DocumentVote"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
