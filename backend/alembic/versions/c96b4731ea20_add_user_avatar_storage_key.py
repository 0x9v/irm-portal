"""Add the nullable account avatar storage reference."""

from alembic import op
import sqlalchemy as sa


revision = "c96b4731ea20"
down_revision = "f4b8c1d2e390"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_storage_key", sa.String(length=255), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    references = bind.execute(
        sa.text("SELECT count(*) FROM users WHERE avatar_storage_key IS NOT NULL")
    ).scalar_one()
    if references:
        raise RuntimeError(
            f"Cannot remove users.avatar_storage_key: {references} avatar reference(s) remain"
        )
    op.drop_column("users", "avatar_storage_key")
