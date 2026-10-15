"""Add delegate member management status and partial index.

Revision ID: c4d8e9f1a2b3
Revises: a916c0e16b01
Create Date: 2026-10-10 22:45:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c4d8e9f1a2b3"
down_revision: Union[str, Sequence[str], None] = "a916c0e16b01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.engine.name == "postgresql":
        # 1. Update check constraint on memberships status
        op.create_check_constraint(
            "membership_status",
            "memberships",
            sa.column("status").in_(["PENDING", "ACTIVE", "REJECTED", "REMOVED", "BANNED"]),
        )
        # 2. Replace whole-table unique constraint with partial unique index excluding membership targets
        op.drop_constraint("uq_management_events_removal_target", "management_events", type_="unique")
        op.create_index(
            "uq_management_events_removal_target",
            "management_events",
            ["community_id", "action", "target_type", "target_id"],
            unique=True,
            postgresql_where=sa.text("target_type != 'membership'"),
        )
    else:
        with op.batch_alter_table("memberships") as batch_op:
            batch_op.create_check_constraint(
                "membership_status",
                sa.column("status").in_(["PENDING", "ACTIVE", "REJECTED", "REMOVED", "BANNED"]),
            )
        with op.batch_alter_table("management_events") as batch_op:
            batch_op.drop_constraint("uq_management_events_removal_target", type_="unique")
            batch_op.create_index(
                "uq_management_events_removal_target",
                ["community_id", "action", "target_type", "target_id"],
                unique=True,
                sqlite_where=sa.text("target_type != 'membership'"),
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.engine.name == "postgresql":
        # 1. Restore whole-table unique constraint on management_events
        op.drop_index("uq_management_events_removal_target", table_name="management_events")
        op.create_unique_constraint(
            "uq_management_events_removal_target",
            "management_events",
            ["community_id", "action", "target_type", "target_id"],
        )
        # 2. Drop check constraint on memberships
        op.drop_constraint("membership_status", "memberships", type_="check")
    else:
        with op.batch_alter_table("management_events") as batch_op:
            batch_op.drop_index("uq_management_events_removal_target")
            batch_op.create_unique_constraint(
                "uq_management_events_removal_target",
                ["community_id", "action", "target_type", "target_id"],
            )
        with op.batch_alter_table("memberships") as batch_op:
            batch_op.drop_constraint("membership_status", type_="check")
