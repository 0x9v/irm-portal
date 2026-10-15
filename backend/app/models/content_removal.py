"""Two-field soft removal shared only by the five community content models."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column


class ContentRemoval:
    # Timestamp is the canonical predicate; actor may become null if an account
    # is deleted by a future, separate administrative operation.
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    removed_by_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
