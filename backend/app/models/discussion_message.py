from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.content_removal import ContentRemoval


class DiscussionMessage(ContentRemoval, Base):
    __tablename__ = "discussion_messages"
    __table_args__ = (
        CheckConstraint(
            "(kind = 'TEXT' AND content IS NOT NULL AND trim(content, ' \t\r\n') != '' AND sticker_id IS NULL AND custom_sticker_id IS NULL) OR "
            "(kind = 'STICKER' AND sticker_id IS NOT NULL AND content IS NULL AND custom_sticker_id IS NULL) OR "
            "(kind = 'CUSTOM_STICKER' AND custom_sticker_id IS NOT NULL AND content IS NULL AND sticker_id IS NULL)",
            name="ck_discussion_messages_kind_fields",
        ),
        UniqueConstraint(
            "community_id",
            "author_id",
            "client_message_id",
            name="uq_discussion_messages_community_author_client",
        ),
        Index(
            "ix_discussion_messages_community_id_created_at_id",
            "community_id",
            "created_at",
            "id",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    community_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    author_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    sticker_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    custom_sticker_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("sticker_assets.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    client_message_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    community: Mapped["Community"] = relationship(back_populates="discussion_messages")
    author: Mapped["User"] = relationship(back_populates="discussion_messages", foreign_keys=[author_id])
    reactions: Mapped[list["DiscussionReaction"]] = relationship(
        back_populates="message", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def author_username(self) -> str | None:
        return self.author.username if self.author else None
