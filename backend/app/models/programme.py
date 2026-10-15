from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Programme(Base):
    """Stable academic identity under the EtudSup platform."""

    __tablename__ = "programmes"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_programmes_slug"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    institution_slug: Mapped[str] = mapped_column(String(100), nullable=False)
    institution_name: Mapped[str] = mapped_column(String(150), nullable=False)
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

    communities: Mapped[list["Community"]] = relationship(
        back_populates="programme", passive_deletes="all"
    )
    modules: Mapped[list["Module"]] = relationship(
        back_populates="programme", passive_deletes="all"
    )
