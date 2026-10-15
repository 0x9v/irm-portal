"""Add typed payloads to the existing Document review identity.

Revision ID: b7c3e9a4d182
Revises: e8a4f6b1c932
"""

from alembic import op
import sqlalchemy as sa


revision = "b7c3e9a4d182"
down_revision = "e8a4f6b1c932"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    unknown = bind.execute(sa.text("""
        SELECT id FROM documents
        WHERE storage_path IS NULL
           OR NOT (
                lower(storage_path) LIKE '%.pdf'
                OR lower(storage_path) LIKE '%.jpg'
                OR lower(storage_path) LIKE '%.jpeg'
                OR lower(storage_path) LIKE '%.png'
           )
        LIMIT 5
    """)).scalars().all()
    if unknown:
        raise RuntimeError(
            "Cannot classify legacy document resource kind from persisted storage metadata; "
            f"unrecognized document IDs: {', '.join(str(value) for value in unknown)}"
        )

    op.add_column("documents", sa.Column("description", sa.String(length=2000), nullable=True))
    op.add_column("documents", sa.Column("resource_kind", sa.String(length=20), nullable=True))
    op.add_column("documents", sa.Column("image_storage_key", sa.String(length=1024), nullable=True))
    op.add_column("documents", sa.Column("youtube_video_id", sa.String(length=11), nullable=True))
    op.add_column("documents", sa.Column("external_url", sa.String(length=2048), nullable=True))

    bind.execute(sa.text("""
        UPDATE documents
        SET resource_kind = CASE
            WHEN lower(storage_path) LIKE '%.pdf' THEN 'PDF'
            WHEN lower(storage_path) LIKE '%.jpg'
              OR lower(storage_path) LIKE '%.jpeg'
              OR lower(storage_path) LIKE '%.png' THEN 'IMAGE'
            ELSE NULL
        END
    """))
    unmapped = bind.execute(sa.text(
        "SELECT id FROM documents WHERE resource_kind IS NULL LIMIT 5"
    )).scalars().all()
    if unmapped:
        raise RuntimeError(
            "Cannot classify legacy documents; migration made no committed changes; "
            f"unrecognized document IDs: {', '.join(str(value) for value in unmapped)}"
        )

    op.alter_column(
        "documents", "resource_kind", existing_type=sa.String(length=20),
        nullable=False, server_default="PDF",
    )
    op.alter_column(
        "documents", "storage_path", existing_type=sa.String(length=1024), nullable=True
    )
    op.alter_column(
        "documents", "type", existing_type=sa.String(length=20), nullable=True
    )
    op.create_unique_constraint(
        "uq_document_image_storage_key", "documents", ["image_storage_key"]
    )
    op.create_index(
        "ix_documents_module_resource_feed", "documents", ["module_id", "created_at", "id"]
    )
    op.create_check_constraint(
        "ck_document_description_length", "documents",
        "description IS NULL OR (length(description) <= 2000 "
        "AND length(trim(description)) > 0 AND description = trim(description))",
    )
    op.create_check_constraint(
        "ck_document_resource_kind", "documents",
        "resource_kind IN ('PDF', 'IMAGE', 'YOUTUBE', 'LINK')",
    )
    op.create_check_constraint(
        "ck_document_resource_payload", "documents",
        "(resource_kind = 'PDF' AND type IS NOT NULL AND storage_path IS NOT NULL AND image_storage_key IS NULL "
        "AND youtube_video_id IS NULL AND external_url IS NULL) OR "
        "(resource_kind = 'IMAGE' AND (storage_path IS NOT NULL OR image_storage_key IS NOT NULL) "
        "AND youtube_video_id IS NULL AND external_url IS NULL "
        "AND (image_storage_key IS NULL OR type IS NULL)) OR "
        "(resource_kind = 'YOUTUBE' AND type IS NULL AND storage_path IS NULL AND preview_path IS NULL "
        "AND image_storage_key IS NULL AND length(youtube_video_id) = 11 AND external_url IS NULL) OR "
        "(resource_kind = 'LINK' AND type IS NULL AND storage_path IS NULL AND preview_path IS NULL "
        "AND image_storage_key IS NULL AND youtube_video_id IS NULL AND external_url IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_document_resource_image_key", "documents",
        "image_storage_key IS NULL OR (resource_kind = 'IMAGE' AND storage_path IS NULL "
        "AND preview_path IS NULL)",
    )


def downgrade() -> None:
    bind = op.get_bind()
    populated = bind.execute(sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM documents
            WHERE resource_kind IN ('YOUTUBE', 'LINK')
               OR image_storage_key IS NOT NULL
               OR description IS NOT NULL
        )
    """)).scalar_one()
    if populated:
        raise RuntimeError(
            "Cannot downgrade typed module resources while URL resources, canonical images, "
            "or descriptions remain"
        )

    op.drop_constraint("ck_document_resource_image_key", "documents", type_="check")
    op.drop_constraint("ck_document_resource_payload", "documents", type_="check")
    op.drop_constraint("ck_document_resource_kind", "documents", type_="check")
    op.drop_constraint("ck_document_description_length", "documents", type_="check")
    op.drop_index("ix_documents_module_resource_feed", table_name="documents")
    op.drop_constraint("uq_document_image_storage_key", "documents", type_="unique")
    op.alter_column(
        "documents", "storage_path", existing_type=sa.String(length=1024), nullable=False
    )
    op.alter_column(
        "documents", "type", existing_type=sa.String(length=20), nullable=False
    )
    op.drop_column("documents", "external_url")
    op.drop_column("documents", "youtube_video_id")
    op.drop_column("documents", "image_storage_key")
    op.drop_column("documents", "resource_kind")
    op.drop_column("documents", "description")
