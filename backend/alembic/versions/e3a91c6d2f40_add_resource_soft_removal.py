"""Add soft removal metadata to resources.

Revision ID: e3a91c6d2f40
Revises: c8e4f1a2b603
"""

from alembic import op
import sqlalchemy as sa

revision = "e3a91c6d2f40"
down_revision = "c8e4f1a2b603"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.add_column(sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("removed_by_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key("fk_documents_removed_by_id_users", "users",
                                 ["removed_by_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM documents WHERE removed_at IS NOT NULL LIMIT 1")).first():
        raise RuntimeError("Cannot downgrade resource removal while removed resources exist")
    if connection.execute(sa.text("SELECT 1 FROM management_events WHERE target_type = 'module_resource' AND action = 'remove' LIMIT 1")).first():
        raise RuntimeError("Cannot downgrade resource removal while removal audit events exist")
    with op.batch_alter_table("documents") as batch:
        batch.drop_constraint("fk_documents_removed_by_id_users", type_="foreignkey")
        batch.drop_column("removed_by_id")
        batch.drop_column("removed_at")
