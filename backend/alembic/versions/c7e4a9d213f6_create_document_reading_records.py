"""Create private document reading records.

Revision ID: c7e4a9d213f6
Revises: b21d7a4c9e60
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7e4a9d213f6"
down_revision: Union[str, Sequence[str], None] = "b21d7a4c9e60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "document_reading_records",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("document_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("last_page", sa.Integer(), server_default="1", nullable=False),
        sa.Column("last_opened_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("last_page >= 1", name="ck_document_reading_last_page_positive"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "document_id", name="uq_document_reading_user_document"),
    )
    op.create_index(
        "ix_document_reading_user_opened_id",
        "document_reading_records",
        ["user_id", sa.text("last_opened_at DESC"), sa.text("id DESC")],
    )
    op.create_index("ix_document_reading_document_id", "document_reading_records", ["document_id"])


def downgrade() -> None:
    op.drop_index("ix_document_reading_document_id", table_name="document_reading_records")
    op.drop_index("ix_document_reading_user_opened_id", table_name="document_reading_records")
    op.drop_table("document_reading_records")
