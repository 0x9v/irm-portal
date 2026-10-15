from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DiscussionReaction(Base):
    __tablename__ = "discussion_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_discussion_reactions_message_user"),
        CheckConstraint(
            "emoji IN ('thumbs_up', 'heart', 'laugh', 'surprised', 'sad', 'thanks')",
            name="ck_discussion_reactions_emoji",
        ),
        Index("ix_discussion_reactions_message_id_emoji", "message_id", "emoji"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    message_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("discussion_messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    emoji: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    message: Mapped["DiscussionMessage"] = relationship(back_populates="reactions")
    user: Mapped["User"] = relationship(back_populates="discussion_reactions")
