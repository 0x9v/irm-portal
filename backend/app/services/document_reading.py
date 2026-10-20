from datetime import datetime, timezone
import uuid
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.community import Community
from app.models.document import Document, DocumentStatus, ResourceKind
from app.models.document_reading import DocumentReading
from app.models.module import Module
from app.models.user import User
from app.services.document_vote import check_full_document_access


def get_readable_approved_document(
    db: Session, community_slug: str, document_id: str, user: User
) -> Document:
    """Resolve a community-scoped approved document using the shared read policy."""
    try:
        document_uuid = uuid.UUID(document_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    document = (
        db.query(Document)
        .join(Module, Module.id == Document.module_id)
        .join(Community, Community.id == Module.community_id)
        .filter(
            Community.slug == community_slug,
            Document.id == document_uuid,
            Document.status == DocumentStatus.APPROVED,
            Document.removed_at.is_(None),
            Document.resource_kind.in_((ResourceKind.PDF, ResourceKind.IMAGE)),
            Document.storage_path.is_not(None),
            Document.storage_path.is_not(None),
        )
        .with_for_update()
        .first()
    )
    if document is None or not check_full_document_access(db, document, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return document


def _insert_for_dialect(db: Session):
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        return pg_insert(DocumentReading)
    if dialect == "sqlite":
        return sqlite_insert(DocumentReading)
    raise RuntimeError("Document reading records require PostgreSQL or SQLite")


def open_document(db: Session, *, user_id: UUID, document: Document) -> DocumentReading:
    """Record a deliberate open while preserving an existing page position."""
    now = datetime.now(timezone.utc)
    statement = _insert_for_dialect(db).values(
        user_id=user_id,
        document_id=document.id,
        last_page=1,
        last_opened_at=now,
    )
    statement = statement.on_conflict_do_update(
        index_elements=["user_id", "document_id"],
        set_={"last_opened_at": now},
    )
    db.execute(statement)
    db.commit()
    return db.query(DocumentReading).filter_by(user_id=user_id, document_id=document.id).one()


def update_document_page(
    db: Session, *, user_id: UUID, document: Document, page: int
) -> DocumentReading:
    """Persist a page; concurrent updates use last-committed-write-wins semantics."""
    now = datetime.now(timezone.utc)
    statement = _insert_for_dialect(db).values(
        user_id=user_id,
        document_id=document.id,
        last_page=page,
        last_opened_at=now,
    )
    statement = statement.on_conflict_do_update(
        index_elements=["user_id", "document_id"],
        set_={"last_page": page},
    )
    db.execute(statement)
    db.commit()
    return db.query(DocumentReading).filter_by(user_id=user_id, document_id=document.id).one()


def list_recent_documents(
    db: Session, *, user_id: UUID, community_slug: str, limit: int, after: UUID | None
):
    base = (
        select(DocumentReading, Document, Module)
        .join(Document, Document.id == DocumentReading.document_id)
        .join(Module, Module.id == Document.module_id)
        .join(Community, Community.id == Module.community_id)
        .where(
            DocumentReading.user_id == user_id,
            Community.slug == community_slug,
            Document.status == DocumentStatus.APPROVED,
            Document.removed_at.is_(None),
        )
    )
    if after is not None:
        cursor = db.execute(
            select(DocumentReading.last_opened_at, DocumentReading.id)
            .join(Document, Document.id == DocumentReading.document_id)
            .join(Module, Module.id == Document.module_id)
            .join(Community, Community.id == Module.community_id)
            .where(
                DocumentReading.id == after,
                DocumentReading.user_id == user_id,
                Community.slug == community_slug,
                Document.status == DocumentStatus.APPROVED,
                Document.removed_at.is_(None),
                Document.resource_kind.in_((ResourceKind.PDF, ResourceKind.IMAGE)),
                Document.storage_path.is_not(None),
            )
        ).first()
        if cursor is None:
            raise HTTPException(status_code=404, detail="Recent document cursor not found.")
        base = base.where(
            (DocumentReading.last_opened_at < cursor.last_opened_at)
            | (
                (DocumentReading.last_opened_at == cursor.last_opened_at)
                & (DocumentReading.id < cursor.id)
            )
        )

    rows = db.execute(
        base.order_by(DocumentReading.last_opened_at.desc(), DocumentReading.id.desc())
        .limit(limit + 1)
    ).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = rows[-1][0].id if has_more and rows else None
    return rows, next_cursor
