"""Create persistent saved-document relationships.

Revision ID: b21d7a4c9e60
Revises: 98b4d2a6f731
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "b21d7a4c9e60"
down_revision: Union[str, Sequence[str], None] = "98b4d2a6f731"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "saved_documents",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("document_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "document_id", name="uq_saved_documents_user_document"),
    )
    op.create_index(
        "ix_saved_documents_user_created_id",
        "saved_documents",
        ["user_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.create_index("ix_saved_documents_document_id", "saved_documents", ["document_id"])


def downgrade() -> None:
    op.drop_index("ix_saved_documents_document_id", table_name="saved_documents")
    op.drop_index("ix_saved_documents_user_created_id", table_name="saved_documents")
    op.drop_table("saved_documents")
