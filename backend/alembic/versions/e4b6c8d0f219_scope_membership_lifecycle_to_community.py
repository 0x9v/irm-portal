"""Allow independent current memberships in different communities.

Revision ID: e4b6c8d0f219
Revises: d9a1f3c7b205
Create Date: 2026-10-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e4b6c8d0f219"
down_revision: Union[str, Sequence[str], None] = "d9a1f3c7b205"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEX_NAME = "uq_memberships_global_active_pending"


def upgrade() -> None:
    # Membership rows and all attached data remain unchanged. The
    # (user_id, community_id) unique constraint remains the row identity rule.
    op.drop_index(INDEX_NAME, table_name="memberships")


def downgrade() -> None:
    bind = op.get_bind()
    duplicate_users = bind.execute(
        sa.text(
            "SELECT user_id FROM memberships "
            "WHERE status IN ('PENDING', 'ACTIVE') "
            "GROUP BY user_id HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if duplicate_users is not None:
        raise RuntimeError(
            "Cannot restore global PENDING/ACTIVE membership exclusivity: "
            "a user has current memberships in multiple communities. "
            "Resolve with an approved preservation migration and product decision first."
        )

    op.create_index(
        INDEX_NAME,
        "memberships",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('PENDING', 'ACTIVE')"),
        sqlite_where=sa.text("status IN ('PENDING', 'ACTIVE')"),
    )
