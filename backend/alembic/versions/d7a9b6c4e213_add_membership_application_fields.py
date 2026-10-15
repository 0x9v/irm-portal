"""Add nullable community membership application details.

Revision ID: d7a9b6c4e213
Revises: c4d8e9f1a2b3
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d7a9b6c4e213"
down_revision: Union[str, Sequence[str], None] = "c4d8e9f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("memberships") as batch:
            batch.alter_column("cne", existing_type=sa.String(length=50), nullable=True)
            batch.add_column(sa.Column("applicant_type", sa.String(length=20), nullable=True))
            batch.add_column(sa.Column("applicant_first_name", sa.String(length=100), nullable=True))
            batch.add_column(sa.Column("applicant_family_name", sa.String(length=100), nullable=True))
            batch.add_column(sa.Column("promotion", sa.String(length=20), nullable=True))
            batch.create_check_constraint(
                "membership_applicant_type",
                "applicant_type IS NULL OR applicant_type IN ('STUDENT', 'LAUREATE')",
            )
        return

    op.alter_column("memberships", "cne", existing_type=sa.String(length=50), nullable=True)
    op.add_column("memberships", sa.Column("applicant_type", sa.String(length=20), nullable=True))
    op.add_column("memberships", sa.Column("applicant_first_name", sa.String(length=100), nullable=True))
    op.add_column("memberships", sa.Column("applicant_family_name", sa.String(length=100), nullable=True))
    op.add_column("memberships", sa.Column("promotion", sa.String(length=20), nullable=True))
    op.create_check_constraint(
        "membership_applicant_type",
        "memberships",
        "applicant_type IS NULL OR applicant_type IN ('STUDENT', 'LAUREATE')",
    )


def downgrade() -> None:
    bind = op.get_bind()
    null_cne_count = bind.execute(sa.text("SELECT count(*) FROM memberships WHERE cne IS NULL")).scalar_one()
    if null_cne_count:
        raise RuntimeError(
            f"Cannot downgrade membership application fields: {null_cne_count} membership row(s) have NULL cne; "
            "restore a real identifier before retrying. No schema changes were made."
        )

    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("memberships") as batch:
            batch.drop_constraint("membership_applicant_type", type_="check")
            batch.drop_column("applicant_type")
            batch.drop_column("applicant_first_name")
            batch.drop_column("applicant_family_name")
            batch.drop_column("promotion")
            batch.alter_column("cne", existing_type=sa.String(length=50), nullable=False)
        return

    op.drop_constraint("membership_applicant_type", "memberships", type_="check")
    op.drop_column("memberships", "applicant_type")
    op.drop_column("memberships", "applicant_first_name")
    op.drop_column("memberships", "applicant_family_name")
    op.drop_column("memberships", "promotion")
    op.alter_column("memberships", "cne", existing_type=sa.String(length=50), nullable=False)
