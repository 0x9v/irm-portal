import enum
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Uuid, CheckConstraint, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.content_removal import ContentRemoval


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


class ResourceKind(str, enum.Enum):
    PDF = "PDF"
    IMAGE = "IMAGE"
    YOUTUBE = "YOUTUBE"
    LINK = "LINK"


class Document(ContentRemoval, Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("image_storage_key", name="uq_document_image_storage_key"),
        Index("ix_documents_module_resource_feed", "module_id", "created_at", "id"),
        CheckConstraint("vote_threshold_snapshot >= 1", name="ck_document_vote_snapshot"),
        CheckConstraint("source != 'STUDENT' OR status != 'PENDING' OR vote_threshold_snapshot IS NOT NULL", name="ck_doc_pending_student_snapshot"),
        CheckConstraint(
            "description IS NULL OR (length(description) <= 2000 "
            "AND length(trim(description)) > 0 AND description = trim(description))",
            name="ck_document_description_length",
        ),
        CheckConstraint(
            "(resource_kind = 'PDF' AND type IS NOT NULL AND storage_path IS NOT NULL AND image_storage_key IS NULL AND youtube_video_id IS NULL AND external_url IS NULL) OR "
            "(resource_kind = 'IMAGE' AND (storage_path IS NOT NULL OR image_storage_key IS NOT NULL) AND youtube_video_id IS NULL AND external_url IS NULL) OR "
            "(resource_kind = 'YOUTUBE' AND storage_path IS NULL AND preview_path IS NULL AND image_storage_key IS NULL AND length(youtube_video_id) = 11 AND external_url IS NULL) OR "
            "(resource_kind = 'LINK' AND storage_path IS NULL AND preview_path IS NULL AND image_storage_key IS NULL AND youtube_video_id IS NULL AND external_url IS NOT NULL)",
            name="ck_document_resource_payload",
        ),
        CheckConstraint(
            "image_storage_key IS NULL OR (resource_kind = 'IMAGE' AND storage_path IS NULL AND preview_path IS NULL)",
            name="ck_document_resource_image_key",
        ),
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
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    resource_kind: Mapped[ResourceKind] = mapped_column(
        Enum(ResourceKind, name="resource_kind", native_enum=False, length=20),
        nullable=False,
        default=ResourceKind.PDF,
        server_default="PDF",
    )
    type: Mapped[DocumentType | None] = mapped_column(
        Enum(DocumentType, name="document_type", native_enum=False, length=20),
        nullable=True,
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
    storage_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    preview_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    image_storage_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    youtube_video_id: Mapped[str | None] = mapped_column(String(11), nullable=True)
    external_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
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
    uploader: Mapped["User"] = relationship(back_populates="documents", foreign_keys=[uploader_id])
    votes: Mapped[list["DocumentVote"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    saved_by: Mapped[list["SavedDocument"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )
    reading_records: Mapped[list["DocumentReading"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )
