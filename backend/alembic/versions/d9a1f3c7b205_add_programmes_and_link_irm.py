"""Add Programme identity and link the existing IRM community.

Revision ID: d9a1f3c7b205
Revises: c7e4a9d213f6
"""
from datetime import datetime, timezone
from typing import Sequence, Union
from uuid import UUID

from alembic import op
import sqlalchemy as sa


revision: str = "d9a1f3c7b205"
down_revision: Union[str, Sequence[str], None] = "c7e4a9d213f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


IRM_PROGRAMME_ID = UUID("9e85c0d8-08a8-4a25-8ca6-13fcaf412c20")


def upgrade() -> None:
    op.create_table(
        "programmes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("institution_slug", sa.String(length=100), nullable=False),
        sa.Column("institution_name", sa.String(length=150), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_programmes_slug"),
    )

    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # SQLite can add a nullable REFERENCES column directly. Batch mode
        # would rebuild/drop communities and can trigger child cascades when
        # foreign_keys is enabled, so keep this alteration in place.
        uuid_type = sa.Uuid().compile(dialect=bind.dialect)
        op.execute(
            sa.text(
                f"ALTER TABLE communities ADD COLUMN programme_id {uuid_type} "
                "CONSTRAINT fk_communities_programme_id_programmes "
                "REFERENCES programmes(id) ON DELETE RESTRICT"
            )
        )
    else:
        op.add_column(
            "communities",
            sa.Column(
                "programme_id",
                sa.Uuid(),
                sa.ForeignKey(
                    "programmes.id",
                    name="fk_communities_programme_id_programmes",
                    ondelete="RESTRICT",
                ),
                nullable=True,
            ),
        )
    op.create_index("ix_communities_programme_id", "communities", ["programme_id"], unique=False)

    # The fixed ID makes the seed identity stable; resolving by slug also keeps
    # an already-created matching row intact if this revision is replayed in a
    # manually reconciled installation.
    bind = op.get_bind()
    programme_table = sa.table(
        "programmes",
        sa.column("id", sa.Uuid()),
        sa.column("slug", sa.String()),
        sa.column("name", sa.String()),
        sa.column("institution_slug", sa.String()),
        sa.column("institution_name", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    programme_id = bind.execute(
        sa.select(programme_table.c.id).where(programme_table.c.slug == "irm")
    ).scalar_one_or_none()
    if programme_id is None:
        now = datetime.now(timezone.utc)
        programme_id = IRM_PROGRAMME_ID
        bind.execute(
            programme_table.insert().values(
                id=programme_id,
                slug="irm",
                name="IRM",
                institution_slug="fst-mohammedia",
                institution_name="FST Mohammedia",
                created_at=now,
                updated_at=now,
            )
        )

    bind.execute(
        sa.text(
            "UPDATE communities SET programme_id = :programme_id "
            "WHERE slug = 'irm' AND programme_id IS NULL"
        ).bindparams(sa.bindparam("programme_id", type_=sa.Uuid())),
        {"programme_id": programme_id},
    )


def downgrade() -> None:
    bind = op.get_bind()
    linked_communities = bind.execute(
        sa.text("SELECT count(*) FROM communities WHERE programme_id IS NOT NULL")
    ).scalar_one()
    if linked_communities:
        raise RuntimeError(
            "Cannot downgrade Programme foundation while communities reference a Programme; "
            "unlink them explicitly after verifying dependent application data."
        )

    op.drop_index("ix_communities_programme_id", table_name="communities")
    if bind.dialect.name == "sqlite":
        op.execute("ALTER TABLE communities DROP COLUMN programme_id")
    else:
        op.drop_column("communities", "programme_id")
    op.drop_table("programmes")
