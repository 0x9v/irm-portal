from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.content_removal import ContentRemoval


class PostModule(Base):
    __tablename__ = "post_modules"
    __table_args__ = (
        Index("ix_post_modules_module_id", "module_id"),
    )

    post_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("community_posts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    module_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("modules.id", ondelete="CASCADE"),
        primary_key=True,
    )


class CommunityPost(ContentRemoval, Base):
    __tablename__ = "community_posts"
    __table_args__ = (
        Index(
            "ix_community_posts_community_id_created_at_id",
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
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    community: Mapped["Community"] = relationship(back_populates="posts")
    author: Mapped["User"] = relationship(back_populates="posts", foreign_keys=[author_id])
    # Many-to-many relationship with Module via post_modules
    modules: Mapped[list["Module"]] = relationship(
        secondary="post_modules", back_populates="posts"
    )
    replies: Mapped[list["CommunityPostReply"]] = relationship(
        back_populates="post", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def author_username(self) -> str | None:
        return self.author.username if self.author else None

    @property
    def excerpt(self) -> str:
        """Bounded plain-text excerpt for feed listings."""
        if len(self.content) > 200:
            return self.content[:200] + "..."
        return self.content
