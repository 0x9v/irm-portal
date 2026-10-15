"""Add private community post reply images and request identity.

Revision ID: e8a4f6b1c932
Revises: d1e2f3a4b5c6
"""

from alembic import op
import sqlalchemy as sa


revision = "e8a4f6b1c932"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("community_post_replies", sa.Column("image_storage_key", sa.String(length=240), nullable=True))
    op.add_column("community_post_replies", sa.Column("client_request_id", sa.Uuid(as_uuid=True), nullable=True))
    op.add_column("community_post_replies", sa.Column("request_fingerprint", sa.String(length=64), nullable=True))
    op.create_unique_constraint(
        "uq_post_reply_request_identity",
        "community_post_replies",
        ["post_id", "author_id", "client_request_id"],
    )
    op.create_check_constraint(
        "ck_post_reply_request_identity_pair",
        "community_post_replies",
        "(client_request_id IS NULL AND request_fingerprint IS NULL) OR "
        "(client_request_id IS NOT NULL AND request_fingerprint IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_post_reply_content_or_image",
        "community_post_replies",
        "length(trim(content)) > 0 OR image_storage_key IS NOT NULL",
    )


def downgrade() -> None:
    populated = op.get_bind().execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM community_post_replies "
        "WHERE image_storage_key IS NOT NULL OR client_request_id IS NOT NULL "
        "OR request_fingerprint IS NOT NULL)"
    )).scalar_one()
    if populated:
        raise RuntimeError("Cannot downgrade: community post reply image/request data is populated")
    op.drop_constraint("ck_post_reply_content_or_image", "community_post_replies", type_="check")
    op.drop_constraint("ck_post_reply_request_identity_pair", "community_post_replies", type_="check")
    op.drop_constraint("uq_post_reply_request_identity", "community_post_replies", type_="unique")
    op.drop_column("community_post_replies", "request_fingerprint")
    op.drop_column("community_post_replies", "client_request_id")
    op.drop_column("community_post_replies", "image_storage_key")
