"""Add immutable custom sticker assets and Discussion references."""

from alembic import op
import sqlalchemy as sa


revision = "d1e2f3a4b5c6"
down_revision = "c96b4731ea20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sticker_assets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column("storage_key", sa.String(length=150), nullable=False),
        sa.Column("media_type", sa.String(length=30), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("media_type = 'image/webp'", name="ck_sticker_assets_media_type"),
        sa.CheckConstraint("width = 256 AND height = 256", name="ck_sticker_assets_dimensions"),
        sa.CheckConstraint("byte_size > 0 AND byte_size <= 262144", name="ck_sticker_assets_byte_size"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key", name="uq_sticker_assets_storage_key"),
    )
    op.create_index("ix_sticker_assets_owner_id", "sticker_assets", ["owner_id"])
    op.create_index("ix_sticker_assets_owner_created_id", "sticker_assets", ["owner_id", "created_at", "id"])

    op.add_column("discussion_messages", sa.Column("custom_sticker_id", sa.Uuid(), nullable=True))
    op.alter_column("discussion_messages", "kind", existing_type=sa.String(length=10), type_=sa.String(length=20), existing_nullable=False)
    op.create_foreign_key(
        "fk_discussion_messages_custom_sticker_id_sticker_assets",
        "discussion_messages", "sticker_assets", ["custom_sticker_id"], ["id"], ondelete="RESTRICT",
    )
    op.create_index("ix_discussion_messages_custom_sticker_id", "discussion_messages", ["custom_sticker_id"])
    op.drop_constraint("ck_discussion_messages_kind_fields", "discussion_messages", type_="check")
    op.create_check_constraint(
        "ck_discussion_messages_kind_fields", "discussion_messages",
        "(kind = 'TEXT' AND content IS NOT NULL AND trim(content, ' \t\r\n') != '' AND sticker_id IS NULL AND custom_sticker_id IS NULL) OR "
        "(kind = 'STICKER' AND sticker_id IS NOT NULL AND content IS NULL AND custom_sticker_id IS NULL) OR "
        "(kind = 'CUSTOM_STICKER' AND custom_sticker_id IS NOT NULL AND content IS NULL AND sticker_id IS NULL)",
    )


def downgrade() -> None:
    bind = op.get_bind()
    assets = bind.execute(sa.text("SELECT count(*) FROM sticker_assets")).scalar_one()
    references = bind.execute(sa.text("SELECT count(*) FROM discussion_messages WHERE custom_sticker_id IS NOT NULL")).scalar_one()
    if assets or references:
        raise RuntimeError(
            f"Cannot remove custom sticker foundation: {assets} asset(s), {references} message reference(s) remain"
        )

    op.drop_constraint("ck_discussion_messages_kind_fields", "discussion_messages", type_="check")
    op.create_check_constraint(
        "ck_discussion_messages_kind_fields", "discussion_messages",
        "(kind = 'TEXT' AND content IS NOT NULL AND trim(content, ' \t\r\n') != '' AND sticker_id IS NULL) OR "
        "(kind = 'STICKER' AND sticker_id IS NOT NULL AND content IS NULL)",
    )
    op.drop_index("ix_discussion_messages_custom_sticker_id", table_name="discussion_messages")
    op.drop_constraint("fk_discussion_messages_custom_sticker_id_sticker_assets", "discussion_messages", type_="foreignkey")
    op.drop_column("discussion_messages", "custom_sticker_id")
    op.alter_column("discussion_messages", "kind", existing_type=sa.String(length=20), type_=sa.String(length=10), existing_nullable=False)
    op.drop_index("ix_sticker_assets_owner_created_id", table_name="sticker_assets")
    op.drop_index("ix_sticker_assets_owner_id", table_name="sticker_assets")
    op.drop_table("sticker_assets")
