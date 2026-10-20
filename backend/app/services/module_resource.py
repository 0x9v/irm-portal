"""Shared Document-backed implementation for typed module resources."""

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.module_resources import MAX_RESOURCE_IMAGE_OUTPUT_BYTES, canonical_https_link, canonical_youtube_video_id
from app.core.sessions import validate_session
from app.core.storage.exceptions import ModuleResourceStorageError, ObjectNotFoundError
from app.core.storage.local import LocalFileSystemStorage
from app.models.community import Community
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType, ResourceKind
from app.models.document_vote import DocumentVote, VoteValue
from app.models.management_event import ManagementEvent
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.module import Module
from app.models.user import User
from app.services.document import creation_status, lock_creation_membership, resolve_document_source
from app.services.document_vote import _evaluate_document_votes, _handle_vote_integrity_error


storage = LocalFileSystemStorage()


def _source_status_snapshot(db: Session, module: Module, membership: Membership,
                            requested_source: DocumentSource | None):
    source = resolve_document_source(db, membership, requested_source)
    state = creation_status(source, membership)
    snapshot = None
    if source == DocumentSource.STUDENT:
        community = db.query(Community).filter(Community.id == module.community_id).first()
        if community is None:
            raise HTTPException(status_code=404, detail="Module not found")
        snapshot = community.document_vote_threshold
    return source, state, snapshot


def create_url_resource(db: Session, module: Module, uploader_id: UUID,
                        membership: Membership, *, kind: ResourceKind,
                        title: str, description: str | None, url: str,
                        requested_source: DocumentSource | None,
                        category: DocumentType | None = None,
                        raw_token: str | None = None) -> Document:
    membership = lock_creation_membership(db, module, uploader_id, raw_token)
    source, state, snapshot = _source_status_snapshot(db, module, membership, requested_source)
    video_id = None
    external_url = None
    if kind == ResourceKind.YOUTUBE:
        video_id = canonical_youtube_video_id(url)
    elif kind == ResourceKind.LINK:
        external_url = canonical_https_link(url)
    else:
        raise HTTPException(status_code=422, detail="Invalid URL resource kind")
    doc = Document(
        id=uuid4(), module_id=module.id, uploader_id=uploader_id,
        title=title, description=description, resource_kind=kind,
        type=category, source=source, status=state,
        storage_path=None, preview_path=None, image_storage_key=None,
        youtube_video_id=video_id, external_url=external_url,
        vote_threshold_snapshot=snapshot,
    )
    try:
        db.add(doc)
        db.commit()
        db.refresh(doc)
    except Exception:
        db.rollback()
        raise
    return doc


def create_image_resource(db: Session, module: Module, uploader: User,
                          membership: Membership, *, title: str,
                          description: str | None, requested_source: DocumentSource | None,
                          canonical_image: bytes, category: DocumentType | None = None,
                          raw_token: str | None = None) -> Document:
    membership = lock_creation_membership(db, module, uploader.id, raw_token)
    source, state, snapshot = _source_status_snapshot(db, module, membership, requested_source)
    resource_id = uuid4()
    try:
        storage_key = storage.save_module_resource_image(
            module.community_id, module.id, resource_id, canonical_image
        )
    except ModuleResourceStorageError:
        raise HTTPException(status_code=500, detail="Resource image storage failed") from None

    doc = Document(
        id=resource_id, module_id=module.id, uploader_id=uploader.id,
        title=title, description=description, resource_kind=ResourceKind.IMAGE,
        type=category, source=source, status=state,
        storage_path=None, preview_path=None, image_storage_key=storage_key,
        youtube_video_id=None, external_url=None, vote_threshold_snapshot=snapshot,
    )
    db.add(doc)
    try:
        db.flush()
    except Exception:
        db.rollback()
        _delete_known_uncommitted_image(storage_key, module, resource_id)
        raise HTTPException(status_code=500, detail="Resource could not be saved") from None

    try:
        db.commit()
        db.refresh(doc)
        return doc
    except Exception:
        # A COMMIT exception can mean the server committed but its reply was
        # lost. Resolve only after rollback and a fresh read on the DB session.
        # If either operation is uncertain, retain the file.
        try:
            db.rollback()
            committed = db.query(Document).filter(Document.id == resource_id).first()
        except Exception:
            committed = None
            rollback_confirmed = False
        else:
            rollback_confirmed = True
        if committed is not None and committed.image_storage_key == storage_key:
            return committed
        if rollback_confirmed:
            _delete_known_uncommitted_image(storage_key, module, resource_id)
            raise HTTPException(status_code=500, detail="Resource could not be saved") from None
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Resource save outcome is uncertain; retry after checking the module",
        ) from None


def _delete_known_uncommitted_image(key: str, module: Module, resource_id: UUID) -> None:
    try:
        storage.delete_module_resource_image(key, module.community_id, module.id, resource_id)
    except ModuleResourceStorageError:
        pass


def list_approved_resources(db: Session, module: Module, *, kind: ResourceKind | None,
                            category: DocumentType | None = None,
                            title_query: str | None, source: DocumentSource | None,
                            limit: int, after: UUID | None) -> tuple[list[Document], UUID | None]:
    query = db.query(Document).filter(
        Document.module_id == module.id,
        Document.status == DocumentStatus.APPROVED,
        Document.removed_at.is_(None),
    )
    if kind is not None:
        query = query.filter(Document.resource_kind == kind)
    if category is not None:
        query = query.filter(Document.type == category)
    if title_query:
        escaped = title_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(Document.title.ilike(f"%{escaped}%", escape="\\"))
    if source is not None:
        query = query.filter(Document.source == source)
    if after is not None:
        cursor = query.with_entities(Document.created_at, Document.id).filter(Document.id == after).first()
        if cursor is None:
            raise HTTPException(status_code=404, detail="Resource cursor not found")
        query = query.filter(or_(Document.created_at < cursor.created_at,
                                 and_(Document.created_at == cursor.created_at, Document.id < cursor.id)))
    rows = query.order_by(Document.created_at.desc(), Document.id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    items = rows[:limit]
    return items, items[-1].id if has_more and items else None


def get_resource(db: Session, community_slug: str, resource_id: UUID) -> tuple[Document, Module]:
    row = (
        db.query(Document, Module)
        .join(Module, Module.id == Document.module_id)
        .join(Community, Community.id == Module.community_id)
        .filter(Community.slug == community_slug, Document.id == resource_id,
                Document.removed_at.is_(None))
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    return row


def list_pending_resources(db: Session, community_slug: str, user_id: UUID, *,
                           limit: int, after: UUID | None):
    """One bounded community queue with caller-specific review state."""
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if community is None:
        raise HTTPException(status_code=404, detail="Community not found")
    membership = db.query(Membership).filter(
        Membership.user_id == user_id, Membership.community_id == community.id,
        Membership.status == MembershipStatus.ACTIVE,
    ).first()
    if membership is None:
        raise HTTPException(status_code=403, detail="Active membership required")

    scope = (Module.community_id == community.id,
             Document.source == DocumentSource.STUDENT,
             Document.status == DocumentStatus.PENDING,
             Document.removed_at.is_(None))
    query = (db.query(Document, Module, DocumentVote)
             .join(Module, Module.id == Document.module_id)
             .outerjoin(DocumentVote, and_(DocumentVote.document_id == Document.id,
                                           DocumentVote.voter_id == user_id))
             .filter(*scope))
    if after is not None:
        cursor = (db.query(Document.created_at, Document.id)
                  .join(Module, Module.id == Document.module_id)
                  .filter(*scope, Document.id == after).first())
        if cursor is None:
            raise HTTPException(status_code=404, detail="Resource cursor not found")
        query = query.filter(or_(
            Document.created_at < cursor.created_at,
            and_(Document.created_at == cursor.created_at, Document.id < cursor.id),
        ))
    rows = query.order_by(Document.created_at.desc(), Document.id.desc()).limit(limit + 1).all()
    items = rows[:limit]
    cursor = items[-1][0].id if len(rows) > limit and items else None
    return items, cursor, membership


def list_my_resources(db: Session, community_id: UUID, uploader_id: UUID, *,
                      status_filter: DocumentStatus | None, limit: int,
                      after: UUID | None):
    """All resource kinds, without changing the legacy file-only mine feed."""
    scope = (Module.community_id == community_id,
             Document.uploader_id == uploader_id,
             Document.removed_at.is_(None))
    if status_filter is not None:
        scope += (Document.status == status_filter,)
    query = (db.query(Document, Module).join(Module, Module.id == Document.module_id)
             .filter(*scope))
    if after is not None:
        cursor = (db.query(Document.created_at, Document.id)
                  .join(Module, Module.id == Document.module_id)
                  .filter(*scope, Document.id == after).first())
        if cursor is None:
            raise HTTPException(status_code=404, detail="Resource cursor not found")
        query = query.filter(or_(
            Document.created_at < cursor.created_at,
            and_(Document.created_at == cursor.created_at, Document.id < cursor.id),
        ))
    rows = query.order_by(Document.created_at.desc(), Document.id.desc()).limit(limit + 1).all()
    items = rows[:limit]
    return items, items[-1][0].id if len(rows) > limit and items else None


def _lock_review_actor_and_resource(db: Session, community_slug: str,
                                    resource_id: UUID, actor_id: UUID,
                                    raw_token: str | None = None,
                                    conceal_nonmember: bool = False):
    """Use User→Session→Membership→Document order for guarded mutations."""
    resource, module = get_resource(db, community_slug, resource_id)
    if db.query(User.id).filter(User.id == actor_id).with_for_update().first() is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if raw_token is not None:
        session = validate_session(db, raw_token, refresh=True, lock=True)
        if session is None or session.user_id != actor_id:
            raise HTTPException(status_code=401, detail="Not authenticated")
    membership = (db.query(Membership)
                  .filter(Membership.user_id == actor_id,
                          Membership.community_id == module.community_id)
                  .with_for_update().populate_existing().first())
    if membership is None and conceal_nonmember:
        raise HTTPException(status_code=404, detail="Resource not found")
    if membership is None or membership.status != MembershipStatus.ACTIVE:
        raise HTTPException(status_code=403, detail="Active membership required")
    resource = (db.query(Document).filter(Document.id == resource_id)
                .with_for_update().populate_existing().first())
    if resource is None or resource.module_id != module.id or resource.removed_at is not None:
        raise HTTPException(status_code=404, detail="Resource not found")
    return resource, module, membership


def can_remove_resource(resource: Document, membership: Membership) -> bool:
    return (resource.removed_at is None
            and resource.status in (DocumentStatus.PENDING, DocumentStatus.REJECTED)
            and (resource.uploader_id == membership.user_id
                 or membership.role == MembershipRole.DELEGATE))


def remove_resource(db: Session, community_slug: str, resource_id: UUID,
                    actor_id: UUID, raw_token: str | None = None) -> None:
    """Serialize with votes/approval and commit metadata plus audit atomically."""
    try:
        resource, module, membership = _lock_review_actor_and_resource(
            db, community_slug, resource_id, actor_id, raw_token, True,
        )
        if resource.uploader_id != actor_id and membership.role != MembershipRole.DELEGATE:
            raise HTTPException(status_code=403, detail="Resource removal forbidden")
        if resource.status == DocumentStatus.APPROVED:
            raise HTTPException(status_code=409, detail="Approved resources cannot be deleted")
        if not can_remove_resource(resource, membership):
            raise HTTPException(status_code=404, detail="Resource not found")
        timestamp = datetime.now(timezone.utc)
        resource.removed_at = timestamp
        resource.removed_by_id = actor_id
        db.add(ManagementEvent(
            community_id=module.community_id, actor_id=actor_id,
            action="remove", target_type="module_resource", target_id=resource.id,
            created_at=timestamp,
        ))
        db.commit()
    except Exception:
        db.rollback()
        raise


def cast_resource_vote(db: Session, community_slug: str, resource_id: UUID,
                       voter_id: UUID, vote: VoteValue) -> bool:
    """Share the legacy threshold evaluator and DocumentVote identity."""
    try:
        resource, _module, _membership = _lock_review_actor_and_resource(
            db, community_slug, resource_id, voter_id,
        )
        if resource.status != DocumentStatus.PENDING or resource.source != DocumentSource.STUDENT:
            raise HTTPException(status_code=409, detail="Resource already decided or ineligible")
        if resource.uploader_id == voter_id:
            raise HTTPException(status_code=403, detail="Uploaders cannot vote on their own resources")
        if db.query(DocumentVote.id).filter(
            DocumentVote.document_id == resource_id, DocumentVote.voter_id == voter_id,
        ).first():
            raise HTTPException(status_code=409, detail="You have already voted on this resource")
        db.add(DocumentVote(document_id=resource_id, voter_id=voter_id, vote=vote))
        db.flush()
        _evaluate_document_votes(db, resource)
        db.commit()
        return (resource.status == DocumentStatus.APPROVED
                or resource.resource_kind != ResourceKind.PDF
                or vote == VoteValue.YES)
    except IntegrityError as error:
        db.rollback()
        _handle_vote_integrity_error(error)
    except Exception:
        db.rollback()
        raise


def approve_pending_resource(db: Session, community_slug: str, resource_id: UUID,
                             actor_id: UUID) -> None:
    """Commit one staff transition and its metadata-only event atomically."""
    try:
        resource, module, membership = _lock_review_actor_and_resource(
            db, community_slug, resource_id, actor_id,
        )
        if membership.role not in (MembershipRole.MODERATOR, MembershipRole.DELEGATE):
            raise HTTPException(status_code=403, detail="Staff role required")
        if resource.status != DocumentStatus.PENDING or resource.source != DocumentSource.STUDENT:
            raise HTTPException(status_code=409, detail="Resource already decided or ineligible")
        resource.status = DocumentStatus.APPROVED
        db.add(ManagementEvent(
            community_id=module.community_id, actor_id=actor_id,
            action="approve", target_type="module_resource", target_id=resource.id,
        ))
        db.commit()
    except Exception:
        db.rollback()
        raise


def read_resource_preview(db: Session, community_slug: str, resource_id: UUID,
                          user_id: UUID) -> tuple[Document, bytes | dict, str]:
    doc, module = get_resource(db, community_slug, resource_id)
    if doc.status == DocumentStatus.REJECTED:
        raise HTTPException(status_code=404, detail="Resource not found")
    if doc.status == DocumentStatus.PENDING:
        active = db.query(Membership.id).filter(
            Membership.user_id == user_id,
            Membership.community_id == module.community_id,
            Membership.status == MembershipStatus.ACTIVE,
        ).first()
        if active is None:
            raise HTTPException(status_code=404, detail="Resource not found")

    def deliver(payload: bytes | dict, media_type: str):
        # A concurrent removal may commit during disk I/O. Refresh visibility
        # before constructing the response; already delivered bytes cannot be recalled.
        current = db.query(Document.removed_at, Document.status).filter(Document.id == doc.id).first()
        if current is None or current.removed_at is not None or current.status == DocumentStatus.REJECTED:
            raise HTTPException(status_code=404, detail="Resource not found")
        if current.status == DocumentStatus.PENDING:
            still_active = db.query(Membership.id).filter(
                Membership.user_id == user_id, Membership.community_id == module.community_id,
                Membership.status == MembershipStatus.ACTIVE,
            ).first()
            if still_active is None:
                raise HTTPException(status_code=404, detail="Resource not found")
        return doc, payload, media_type

    if doc.resource_kind == ResourceKind.PDF:
        if not doc.preview_path:
            raise HTTPException(status_code=404, detail="Resource preview unavailable")
        try:
            return deliver(storage.read(doc.preview_path), "image/png")
        except ObjectNotFoundError:
            raise HTTPException(status_code=404, detail="Resource preview unavailable") from None
    if doc.resource_kind == ResourceKind.IMAGE:
        if doc.image_storage_key:
            try:
                content = storage.read_module_resource_image_bounded(
                    doc.image_storage_key, module.community_id, module.id, doc.id,
                    MAX_RESOURCE_IMAGE_OUTPUT_BYTES,
                )
                return deliver(content, "image/webp")
            except (ObjectNotFoundError, ModuleResourceStorageError):
                raise HTTPException(status_code=404, detail="Resource preview unavailable") from None
        if doc.preview_path:
            try:
                return deliver(storage.read(doc.preview_path), "image/png")
            except ObjectNotFoundError:
                raise HTTPException(status_code=404, detail="Resource preview unavailable") from None
        raise HTTPException(status_code=404, detail="Resource preview unavailable")
    if doc.resource_kind == ResourceKind.YOUTUBE:
        return deliver({"kind": "YOUTUBE", "title": doc.title, "description": doc.description,
                     "video_id": doc.youtube_video_id,
                     "url": f"https://www.youtube.com/watch?v={doc.youtube_video_id}"}, "application/json")
    if doc.resource_kind == ResourceKind.LINK:
        return deliver({"kind": "LINK", "title": doc.title, "description": doc.description,
                        "url": doc.external_url}, "application/json")
    raise HTTPException(status_code=404, detail="Resource not found")
