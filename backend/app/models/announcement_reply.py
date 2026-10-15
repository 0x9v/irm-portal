from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.content_removal import ContentRemoval


class AnnouncementReply(ContentRemoval, Base):
    __tablename__ = "announcement_replies"
    __table_args__ = (
        Index("ix_announcement_replies_announcement_id_created_at_id", "announcement_id", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    announcement_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("announcements.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    announcement: Mapped["Announcement"] = relationship(back_populates="replies")
    author: Mapped["User"] = relationship(back_populates="announcement_replies", foreign_keys=[author_id])

    @property
    def author_username(self) -> str | None:
        return self.author.username if self.author else None
