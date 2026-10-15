"""Add delegate soft removal and transactional management events.

Revision ID: a916c0e16b01
Revises: f8c2b3d4e5f6
"""

from alembic import op
import sqlalchemy as sa

revision = "a916c0e16b01"
down_revision = "f8c2b3d4e5f6"
branch_labels = None
depends_on = None

CONTENT_TABLES = ("announcements", "announcement_replies", "community_posts",
                  "community_post_replies", "discussion_messages")


def upgrade() -> None:
    for table in CONTENT_TABLES:
        # batch also permits upgrade/downgrade verification on isolated SQLite.
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True))
            batch.add_column(sa.Column("removed_by_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key(f"fk_{table}_removed_by_id_users", "users",
                                     ["removed_by_id"], ["id"], ondelete="SET NULL")
    op.create_table(
        "management_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("community_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["community_id"], ["communities.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("community_id", "action", "target_type", "target_id",
                            name="uq_management_events_removal_target"),
    )


def downgrade() -> None:
    # No source rows are deleted. Downgrade discards removal metadata/events and
    # therefore makes preserved content visible again; never run on owner data.
    op.drop_table("management_events")
    for table in reversed(CONTENT_TABLES):
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"fk_{table}_removed_by_id_users", type_="foreignkey")
            batch.drop_column("removed_by_id")
            batch.drop_column("removed_at")
