"""Allow the existing document type category on every resource kind.

Revision ID: c8e4f1a2b603
Revises: b7c3e9a4d182
"""

from alembic import op
import sqlalchemy as sa


revision = "c8e4f1a2b603"
down_revision = "b7c3e9a4d182"
branch_labels = None
depends_on = None


OLD_PAYLOAD_CHECK = (
    "(resource_kind = 'PDF' AND type IS NOT NULL AND storage_path IS NOT NULL AND image_storage_key IS NULL "
    "AND youtube_video_id IS NULL AND external_url IS NULL) OR "
    "(resource_kind = 'IMAGE' AND (storage_path IS NOT NULL OR image_storage_key IS NOT NULL) "
    "AND youtube_video_id IS NULL AND external_url IS NULL AND (image_storage_key IS NULL OR type IS NULL)) OR "
    "(resource_kind = 'YOUTUBE' AND type IS NULL AND storage_path IS NULL AND preview_path IS NULL "
    "AND image_storage_key IS NULL AND length(youtube_video_id) = 11 AND external_url IS NULL) OR "
    "(resource_kind = 'LINK' AND type IS NULL AND storage_path IS NULL AND preview_path IS NULL "
    "AND image_storage_key IS NULL AND youtube_video_id IS NULL AND external_url IS NOT NULL)"
)

NEW_PAYLOAD_CHECK = (
    "(resource_kind = 'PDF' AND type IS NOT NULL AND storage_path IS NOT NULL AND image_storage_key IS NULL "
    "AND youtube_video_id IS NULL AND external_url IS NULL) OR "
    "(resource_kind = 'IMAGE' AND (storage_path IS NOT NULL OR image_storage_key IS NOT NULL) "
    "AND youtube_video_id IS NULL AND external_url IS NULL) OR "
    "(resource_kind = 'YOUTUBE' AND storage_path IS NULL AND preview_path IS NULL "
    "AND image_storage_key IS NULL AND length(youtube_video_id) = 11 AND external_url IS NULL) OR "
    "(resource_kind = 'LINK' AND storage_path IS NULL AND preview_path IS NULL "
    "AND image_storage_key IS NULL AND youtube_video_id IS NULL AND external_url IS NOT NULL)"
)


def upgrade() -> None:
    op.drop_constraint("ck_document_resource_payload", "documents", type_="check")
    op.create_check_constraint("ck_document_resource_payload", "documents", NEW_PAYLOAD_CHECK)


def downgrade() -> None:
    categorized = op.get_bind().execute(sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM documents
            WHERE type IS NOT NULL AND (
                resource_kind IN ('YOUTUBE', 'LINK')
                OR (resource_kind = 'IMAGE' AND image_storage_key IS NOT NULL)
            )
        )
    """)).scalar_one()
    if categorized:
        raise RuntimeError("Cannot restore resource payload constraint while categorized typed resources exist")
    op.drop_constraint("ck_document_resource_payload", "documents", type_="check")
    op.create_check_constraint("ck_document_resource_payload", "documents", OLD_PAYLOAD_CHECK)
