"""Transactional community post reply image creation and private reads."""

import logging
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.core.post_reply_images import (
    MAX_REPLY_IMAGE_OUTPUT_BYTES,
    PostReplyImageError,
    request_fingerprint,
    validate_canonical_post_reply_image,
)
from app.core.storage.exceptions import ObjectNotFoundError, PostReplyImageStorageError
from app.core.storage.local import LocalFileSystemStorage
from app.database.session import SessionLocal
from app.models.community import Community
from app.models.community_post import CommunityPost
from app.models.community_post_reply import CommunityPostReply
from app.models.membership import Membership, MembershipStatus
from app.models.user import User


logger = logging.getLogger(__name__)


def _reply_query(db: Session, post_id: UUID, author_id: UUID, request_id: UUID):
    return (
        db.query(CommunityPostReply)
        .options(joinedload(CommunityPostReply.author), joinedload(CommunityPostReply.post).joinedload(CommunityPost.community))
        .filter(
            CommunityPostReply.post_id == post_id,
            CommunityPostReply.author_id == author_id,
            CommunityPostReply.client_request_id == request_id,
        )
    )


def _lock_authority_and_parent(
    db: Session, community: Community, post_id: UUID, author_id: UUID,
) -> CommunityPost | None:
    # Membership changes lock User then Membership; reply mutations follow the
    # same order and acquire the parent last (matching removal serialization).
    if db.query(User.id).filter(User.id == author_id).with_for_update().first() is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    membership = (
        db.query(Membership)
        .filter(Membership.user_id == author_id, Membership.community_id == community.id)
        .populate_existing()
        .with_for_update()
        .first()
    )
    if membership is None or membership.status != MembershipStatus.ACTIVE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Active community membership required")
    return (
        db.query(CommunityPost)
        .filter(CommunityPost.id == post_id, CommunityPost.community_id == community.id)
        .populate_existing()
        .with_for_update()
        .first()
    )


def _visible_reply(db: Session, reply_id: UUID, post_id: UUID, community_id: UUID):
    return (
        db.query(CommunityPostReply)
        .options(joinedload(CommunityPostReply.author), joinedload(CommunityPostReply.post).joinedload(CommunityPost.community))
        .join(CommunityPost, CommunityPostReply.post_id == CommunityPost.id)
        .filter(
            CommunityPostReply.id == reply_id,
            CommunityPostReply.post_id == post_id,
            CommunityPostReply.removed_at.is_(None),
            CommunityPost.id == post_id,
            CommunityPost.community_id == community_id,
            CommunityPost.removed_at.is_(None),
        )
        .populate_existing()
        .first()
    )


def create_image_reply(
    *, db: Session, community_slug: str, post_id: UUID, author_id: UUID,
    client_request_id: UUID, content: str, declared_mime: str,
    raw_image: bytes | None, canonical_image: bytes | None,
    storage: LocalFileSystemStorage,
) -> tuple[CommunityPostReply, bool]:
    """Publish an optional image and create/replay one idempotent reply."""
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if community is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Community not found")
    fingerprint = request_fingerprint(content, declared_mime, raw_image)
    published_key: str | None = None
    commit_confirmed = False
    reply_id = uuid4()
    parent: CommunityPost | None = None

    try:
        parent = _lock_authority_and_parent(db, community, post_id, author_id)
        prior = _reply_query(db, post_id, author_id, client_request_id).first()
        if prior is not None:
            if (prior.removed_at is not None or parent is None or parent.removed_at is not None
                    or prior.request_fingerprint != fingerprint):
                db.rollback()
                raise HTTPException(status.HTTP_409_CONFLICT, detail={
                    "code": "reply_request_conflict", "message": "Reply request conflicts with an existing submission",
                })
            db.rollback()
            return prior, True
        if parent is None or parent.removed_at is not None:
            db.rollback()
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Post not found")

        if canonical_image is not None:
            published_key = storage.save_post_reply_image_immutable(reply_id, canonical_image)
        reply = CommunityPostReply(
            id=reply_id,
            post_id=parent.id,
            author_id=author_id,
            content=content,
            image_storage_key=published_key,
            client_request_id=client_request_id,
            request_fingerprint=fingerprint,
        )
        db.add(reply)
        try:
            db.commit()
            commit_confirmed = True
        except Exception as commit_error:
            db.rollback()
            resolution = _resolve_commit(
                community_slug=community_slug, community_id=community.id, post_id=post_id,
                author_id=author_id, client_request_id=client_request_id,
                fingerprint=fingerprint, storage=storage,
            )
            if resolution is not None:
                resolved_reply, is_conflict = resolution
                if is_conflict:
                    raise HTTPException(status.HTTP_409_CONFLICT, detail={
                        "code": "reply_request_conflict", "message": "Reply request conflicts with an existing submission",
                    }) from None
                return resolved_reply, True
            if published_key is not None:
                try:
                    storage.delete_post_reply_image(published_key, reply_id)
                except Exception:
                    logger.error("post_reply_image_confirmed_rollback_cleanup_failed")
            # The fresh transaction acquired the same parent lock and observed
            # no row, proving that this commit did not publish a reply.
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Reply creation failed") from None

        saved = _visible_reply(db, reply.id, post_id, community.id)
        if saved is None:
            # The commit is confirmed. Never remove media on a post-commit
            # lookup failure; a concurrent moderator may have hidden the row.
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Content not found")
        return saved, False
    except HTTPException:
        raise
    except Exception as error:
        db.rollback()
        if published_key is None and isinstance(error, PostReplyImageStorageError):
            published_key = error.storage_key
        if published_key is not None and not commit_confirmed:
            try:
                storage.delete_post_reply_image(published_key, reply_id)
            except Exception:
                logger.error("post_reply_image_confirmed_rollback_cleanup_failed")
        raise


def _resolve_commit(
    *, community_slug: str, community_id: UUID, post_id: UUID, author_id: UUID,
    client_request_id: UUID, fingerprint: str, storage: LocalFileSystemStorage,
) -> tuple[CommunityPostReply, bool] | None:
    """Resolve a raised commit under fresh authority and parent locks.

    Returns None only after the locked parent confirms the idempotency row is
    absent; exceptions mean the outcome remains unknown and media is retained.
    """
    resolver = None
    try:
        resolver = SessionLocal()
        community = resolver.query(Community).filter(
            Community.id == community_id, Community.slug == community_slug
        ).first()
        if community is None:
            raise RuntimeError("resolution unavailable")
        parent = _lock_authority_and_parent(resolver, community, post_id, author_id)
        prior = _reply_query(resolver, post_id, author_id, client_request_id).first()
        if prior is not None:
            conflict = (
                prior.removed_at is not None or parent is None or parent.removed_at is not None
                or prior.request_fingerprint != fingerprint
            )
            return prior, conflict
        if parent is None:
            # A hard-deleted parent is not enough evidence that an in-flight
            # transaction has resolved; retain the object conservatively.
            raise RuntimeError("parent resolution unavailable")
        return None
    except Exception as error:
        logger.warning("post_reply_commit_outcome_unresolved")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail={
            "code": "reply_outcome_unknown", "message": "Reply outcome is uncertain; check the discussion before retrying",
        }) from error
    finally:
        if resolver is not None:
            resolver.close()


def read_private_reply_image(
    *, db: Session, community_slug: str, post_id: UUID, reply_id: UUID,
    caller_user_id: UUID, storage: LocalFileSystemStorage,
) -> bytes:
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if community is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    # Recheck current membership and serialize the read against post/reply
    # soft removal using the same user→membership→parent lock order.
    parent = _lock_authority_and_parent(db, community, post_id, caller_user_id)
    reply = _visible_reply(db, reply_id, post_id, community.id) if parent and parent.removed_at is None else None
    if reply is None or not reply.image_storage_key:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    key = reply.image_storage_key
    try:
        raw = storage.read_post_reply_image_bounded(key, reply.id, MAX_REPLY_IMAGE_OUTPUT_BYTES)
        validate_canonical_post_reply_image(raw)
    except (ObjectNotFoundError, PostReplyImageStorageError, PostReplyImageError):
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found") from None
    # Refresh visibility and authorization after the bounded storage read.
    membership = (
        db.query(Membership)
        .filter(Membership.user_id == caller_user_id, Membership.community_id == community.id)
        .populate_existing()
        .first()
    )
    visible_again = _visible_reply(db, reply_id, post_id, community.id)
    if (membership is None or membership.status != MembershipStatus.ACTIVE
            or visible_again is None or visible_again.image_storage_key != key):
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    db.rollback()
    return raw
