from uuid import UUID

from sqlalchemy import literal, select, true
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.community import Community
from app.models.document import Document, DocumentStatus
from app.models.module import Module
from app.models.saved_document import SavedDocument


def approved_document_query(community_slug: str, document_id: UUID):
    return (
        select(Document.id)
        .join(Module, Module.id == Document.module_id)
        .join(Community, Community.id == Module.community_id)
        .where(
            Community.slug == community_slug,
            Document.id == document_id,
            Document.status == DocumentStatus.APPROVED,
            Document.storage_path.is_not(None),
        )
    )


def is_saved(db: Session, user_id: UUID, community_slug: str, document_id: UUID) -> bool:
    return db.execute(
        select(SavedDocument.id)
        .join(Document, Document.id == SavedDocument.document_id)
        .join(Module, Module.id == Document.module_id)
        .join(Community, Community.id == Module.community_id)
        .where(
            SavedDocument.user_id == user_id,
            Community.slug == community_slug,
            Document.id == document_id,
            Document.status == DocumentStatus.APPROVED,
            Document.storage_path.is_not(None),
        )
    ).first() is not None


def save_approved_document(db: Session, user_id: UUID, community_slug: str, document_id: UUID) -> bool:
    dialect = db.get_bind().dialect.name
    insert = pg_insert if dialect == "postgresql" else sqlite_insert
    source = approved_document_query(community_slug, document_id)
    statement = insert(SavedDocument).from_select(
        ["user_id", "document_id"],
        select(literal(user_id), source.subquery().c.id).where(true()),
    ).on_conflict_do_nothing(index_elements=["user_id", "document_id"])
    db.execute(statement)
    db.commit()
    return db.execute(approved_document_query(community_slug, document_id)).first() is not None


def remove_saved_document(db: Session, user_id: UUID, community_slug: str, document_id: UUID) -> None:
    db.query(SavedDocument).filter(
        SavedDocument.user_id == user_id,
        SavedDocument.document_id == document_id,
        SavedDocument.document_id.in_(
            select(Document.id)
            .join(Module, Module.id == Document.module_id)
            .join(Community, Community.id == Module.community_id)
            .where(Community.slug == community_slug)
        ),
    ).delete(synchronize_session=False)
    db.commit()


def list_saved_documents(db: Session, *, user_id: UUID, community_slug: str, limit: int, after: UUID | None):
    base = (
        select(SavedDocument, Document, Module)
        .join(Document, Document.id == SavedDocument.document_id)
        .join(Module, Module.id == Document.module_id)
        .join(Community, Community.id == Module.community_id)
        .where(
            SavedDocument.user_id == user_id,
            Community.slug == community_slug,
            Document.status == DocumentStatus.APPROVED,
            Document.storage_path.is_not(None),
        )
    )
    if after is not None:
        cursor = db.execute(
            select(SavedDocument.created_at, SavedDocument.id)
            .join(Document, Document.id == SavedDocument.document_id)
            .join(Module, Module.id == Document.module_id)
            .join(Community, Community.id == Module.community_id)
            .where(
                SavedDocument.id == after,
                SavedDocument.user_id == user_id,
                Community.slug == community_slug,
                Document.status == DocumentStatus.APPROVED,
                Document.storage_path.is_not(None),
            )
        ).first()
        if cursor is None:
            return None, None
        base = base.where(
            (SavedDocument.created_at < cursor.created_at)
            | ((SavedDocument.created_at == cursor.created_at) & (SavedDocument.id < cursor.id))
        )
    rows = db.execute(
        base.order_by(SavedDocument.created_at.desc(), SavedDocument.id.desc()).limit(limit + 1)
    ).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = rows[-1][0].id if has_more and rows else None
    return rows, next_cursor
