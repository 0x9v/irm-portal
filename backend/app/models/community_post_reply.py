from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.content_removal import ContentRemoval


class CommunityPostReply(ContentRemoval, Base):
    __tablename__ = "community_post_replies"
    __table_args__ = (
        UniqueConstraint(
            "post_id", "author_id", "client_request_id",
            name="uq_post_reply_request_identity",
        ),
        CheckConstraint(
            "(client_request_id IS NULL AND request_fingerprint IS NULL) OR "
            "(client_request_id IS NOT NULL AND request_fingerprint IS NOT NULL)",
            name="ck_post_reply_request_identity_pair",
        ),
        CheckConstraint(
            "length(trim(content)) > 0 OR image_storage_key IS NOT NULL",
            name="ck_post_reply_content_or_image",
        ),
        Index(
            "ix_community_post_replies_post_id_created_at_id",
            "post_id",
            "created_at",
            "id",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    post_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("community_posts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    author_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    image_storage_key: Mapped[str | None] = mapped_column(String(240), nullable=True)
    client_request_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    request_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    post: Mapped["CommunityPost"] = relationship(back_populates="replies")
    author: Mapped["User"] = relationship(back_populates="post_replies", foreign_keys=[author_id])

    @property
    def author_username(self) -> str | None:
        return self.author.username if self.author else None

    @property
    def image_url(self) -> str | None:
        if not self.image_storage_key or not self.post or not self.post.community:
            return None
        return (
            f"/api/v1/communities/{self.post.community.slug}/posts/"
            f"{self.post_id}/replies/{self.id}/image"
        )
