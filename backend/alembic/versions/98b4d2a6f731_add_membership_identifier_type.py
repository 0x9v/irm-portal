"""Add nullable membership identifier type.

Revision ID: 98b4d2a6f731
Revises: d7a9b6c4e213
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "98b4d2a6f731"
down_revision: Union[str, Sequence[str], None] = "d7a9b6c4e213"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("memberships") as batch:
            batch.add_column(sa.Column("identifier_type", sa.String(length=20), nullable=True))
            batch.create_check_constraint(
                "membership_identifier_type",
                "identifier_type IS NULL OR identifier_type IN ('MASSAR', 'FOREIGN')",
            )
        return

    op.add_column("memberships", sa.Column("identifier_type", sa.String(length=20), nullable=True))
    op.create_check_constraint(
        "membership_identifier_type",
        "memberships",
        "identifier_type IS NULL OR identifier_type IN ('MASSAR', 'FOREIGN')",
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("memberships") as batch:
            batch.drop_constraint("membership_identifier_type", type_="check")
            batch.drop_column("identifier_type")
        return

    op.drop_constraint("membership_identifier_type", "memberships", type_="check")
    op.drop_column("memberships", "identifier_type")
