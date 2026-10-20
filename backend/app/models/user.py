from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.core.avatars import avatar_url_from_storage_key


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("username", name="uq_users_username"),
        UniqueConstraint("email", name="uq_users_email"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    username: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    family_name: Mapped[str] = mapped_column(String(100), nullable=False)
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
    avatar_storage_key: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)

    @property
    def avatar_url(self) -> str | None:
        """Return a safe, versioned URL without exposing the storage key."""
        return avatar_url_from_storage_key(self.id, self.avatar_storage_key)

    sessions: Mapped[list["Session"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    documents: Mapped[list["Document"]] = relationship(
        back_populates="uploader", cascade="all, delete-orphan", foreign_keys="Document.uploader_id"
    )
    announcements: Mapped[list["Announcement"]] = relationship(
        foreign_keys="Announcement.author_id", back_populates="author", cascade="all, delete-orphan"
    )
    document_votes: Mapped[list["DocumentVote"]] = relationship(
        back_populates="voter", cascade="all, delete-orphan"
    )
    saved_documents: Mapped[list["SavedDocument"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    document_readings: Mapped[list["DocumentReading"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    announcement_replies: Mapped[list["AnnouncementReply"]] = relationship(
        foreign_keys="AnnouncementReply.author_id", back_populates="author", cascade="all, delete-orphan", passive_deletes=True
    )
    posts: Mapped[list["CommunityPost"]] = relationship(
        foreign_keys="CommunityPost.author_id", back_populates="author", cascade="all, delete-orphan", passive_deletes=True
    )
    post_replies: Mapped[list["CommunityPostReply"]] = relationship(
        foreign_keys="CommunityPostReply.author_id", back_populates="author", cascade="all, delete-orphan", passive_deletes=True
    )
    discussion_messages: Mapped[list["DiscussionMessage"]] = relationship(
        foreign_keys="DiscussionMessage.author_id", back_populates="author", cascade="all, delete-orphan", passive_deletes=True
    )
    discussion_reactions: Mapped[list["DiscussionReaction"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
