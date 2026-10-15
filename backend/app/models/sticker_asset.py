from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class StickerAsset(Base):
    """Immutable canonical sticker object and its owner-library availability."""

    __tablename__ = "sticker_assets"
    __table_args__ = (
        CheckConstraint("media_type = 'image/webp'", name="ck_sticker_assets_media_type"),
        CheckConstraint("width = 256 AND height = 256", name="ck_sticker_assets_dimensions"),
        CheckConstraint("byte_size > 0 AND byte_size <= 262144", name="ck_sticker_assets_byte_size"),
        Index("ix_sticker_assets_owner_created_id", "owner_id", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    owner_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    storage_key: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    media_type: Mapped[str] = mapped_column(String(30), nullable=False, default="image/webp")
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=256)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=256)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    owner: Mapped["User | None"] = relationship()
