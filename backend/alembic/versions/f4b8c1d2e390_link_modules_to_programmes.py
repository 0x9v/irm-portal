"""Add nullable Programme linkage to community-owned Modules.

Revision ID: f4b8c1d2e390
Revises: e4b6c8d0f219
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4b8c1d2e390"
down_revision: Union[str, Sequence[str], None] = "e4b6c8d0f219"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        uuid_type = sa.Uuid().compile(dialect=bind.dialect)
        op.execute(
            sa.text(
                f"ALTER TABLE modules ADD COLUMN programme_id {uuid_type} "
                "CONSTRAINT fk_modules_programme_id_programmes "
                "REFERENCES programmes(id) ON DELETE RESTRICT"
            )
        )
    else:
        op.add_column(
            "modules",
            sa.Column(
                "programme_id",
                sa.Uuid(),
                sa.ForeignKey(
                    "programmes.id",
                    name="fk_modules_programme_id_programmes",
                    ondelete="RESTRICT",
                ),
                nullable=True,
            ),
        )

    op.create_index("ix_modules_programme_id", "modules", ["programme_id"], unique=False)
    bind.execute(
        sa.text(
            "UPDATE modules AS module "
            "SET programme_id = community.programme_id "
            "FROM communities AS community "
            "WHERE module.community_id = community.id "
            "AND community.programme_id IS NOT NULL "
            "AND module.programme_id IS NULL"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    linked_modules = bind.execute(
        sa.text("SELECT count(*) FROM modules WHERE programme_id IS NOT NULL")
    ).scalar_one()
    if linked_modules:
        raise RuntimeError(
            "Cannot downgrade Module Programme linkage while Modules reference a Programme; "
            "reconcile those links explicitly after verifying dependent application data."
        )

    op.drop_index("ix_modules_programme_id", table_name="modules")
    if bind.dialect.name == "sqlite":
        op.execute("ALTER TABLE modules DROP COLUMN programme_id")
    else:
        op.drop_column("modules", "programme_id")
