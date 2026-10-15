from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.community import Community
from app.models.community_post import CommunityPost, PostModule
from app.models.community_post_reply import CommunityPostReply
from app.models.module import Module
from app.schemas.community_post import (
    CommunityPostCreate,
    CommunityPostReplyCreate,
)


def create_community_post(
    db: Session,
    community_slug: str,
    author_id: UUID,
    post_in: CommunityPostCreate,
) -> CommunityPost:
    """
    Create a new community post with optional module tags.
    Atomic: failure rolls back associations and post.
    Validates that all tagged modules belong to the requested community.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found",
        )

    modules: list[Module] = []
    if post_in.module_ids:
        modules = (
            db.query(Module)
            .filter(
                Module.id.in_(post_in.module_ids),
                Module.community_id == community.id,
            )
            .all()
        )
        if len(modules) != len(post_in.module_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more specified modules do not exist in this community",
            )

    post = CommunityPost(
        community_id=community.id,
        author_id=author_id,
        title=post_in.title,
        content=post_in.content,
    )
    post.modules = modules
    db.add(post)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    saved_post = (
        db.query(CommunityPost)
        .options(
            joinedload(CommunityPost.author),
            selectinload(CommunityPost.modules),
        )
        .filter(CommunityPost.id == post.id, CommunityPost.removed_at.is_(None))
        .first()
    )
    if not saved_post:
        raise HTTPException(404, "Post not found")
    return saved_post


def list_community_posts(
    db: Session,
    community_slug: str,
    limit: int = 20,
    after: UUID | None = None,
    module_id: UUID | None = None,
) -> tuple[list[CommunityPost], UUID | None]:
    """
    List posts in a community, ordered newest first (created_at desc, id desc).
    Supports cursor-based pagination and optional module filtering.
    Avoids row multiplication and per-item queries.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found",
        )

    if module_id is not None:
        module = (
            db.query(Module)
            .filter(
                Module.id == module_id,
                Module.community_id == community.id,
            )
            .first()
        )
        if not module:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Module not found",
            )

    query = (
        db.query(CommunityPost)
        .options(
            joinedload(CommunityPost.author),
            selectinload(CommunityPost.modules),
        )
        .filter(CommunityPost.community_id == community.id, CommunityPost.removed_at.is_(None))
    )

    if module_id is not None:
        query = query.join(
            PostModule, CommunityPost.id == PostModule.post_id
        ).filter(PostModule.module_id == module_id)

    if after is not None:
        cursor_q = db.query(CommunityPost.created_at, CommunityPost.id).filter(
            CommunityPost.id == after,
            CommunityPost.community_id == community.id,
        )
        if module_id is not None:
            cursor_q = cursor_q.join(
                PostModule, CommunityPost.id == PostModule.post_id
            ).filter(PostModule.module_id == module_id)

        cursor_post = cursor_q.first()
        if not cursor_post:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid pagination cursor",
            )

        query = query.filter(
            or_(
                CommunityPost.created_at < cursor_post.created_at,
                and_(
                    CommunityPost.created_at == cursor_post.created_at,
                    CommunityPost.id < cursor_post.id,
                ),
            )
        )

    query = query.order_by(CommunityPost.created_at.desc(), CommunityPost.id.desc())

    # Limit in SQL: fetch limit + 1 records to check if next page exists
    results = query.limit(limit + 1).all()

    has_next = len(results) > limit
    items = results[:limit]
    next_cursor = items[-1].id if has_next and items else None

    return items, next_cursor


def get_community_post_detail(
    db: Session,
    community_slug: str,
    post_id: UUID,
) -> CommunityPost:
    """
    Retrieve post detail ensuring it belongs to the specified community.
    Safely masks non-existent or cross-community posts with a 404.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found",
        )

    post = (
        db.query(CommunityPost)
        .options(
            joinedload(CommunityPost.author),
            selectinload(CommunityPost.modules),
        )
        .filter(
            CommunityPost.id == post_id,
            CommunityPost.community_id == community.id,
            CommunityPost.removed_at.is_(None),
        )
        .first()
    )
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )

    return post


def create_community_post_reply(
    db: Session,
    community_slug: str,
    post_id: UUID,
    author_id: UUID,
    reply_in: CommunityPostReplyCreate,
) -> CommunityPostReply:
    """
    Create a new reply to a community post.
    Ensures post exists and belongs to the requested community.
    Does not touch or modify parent post's created_at.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found",
        )

    post = (
        db.query(CommunityPost)
        .filter(
            CommunityPost.id == post_id,
            CommunityPost.community_id == community.id,
            CommunityPost.removed_at.is_(None),
        )
        .with_for_update()
        .first()
    )
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )

    reply = CommunityPostReply(
        post_id=post.id,
        author_id=author_id,
        content=reply_in.content,
    )
    db.add(reply)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    saved_reply = (
        db.query(CommunityPostReply)
        .options(joinedload(CommunityPostReply.author))
        .join(CommunityPost, CommunityPostReply.post_id == CommunityPost.id)
        .filter(CommunityPostReply.id == reply.id, CommunityPostReply.removed_at.is_(None),
                CommunityPost.removed_at.is_(None), CommunityPost.community_id == community.id)
        .first()
    )
    if not saved_reply:
        raise HTTPException(404, "Content not found")
    return saved_reply


def list_community_post_replies(
    db: Session,
    community_slug: str,
    post_id: UUID,
    limit: int = 20,
    after: UUID | None = None,
) -> tuple[list[CommunityPostReply], UUID | None]:
    """
    List replies for a community post, ordered oldest first (created_at asc, id asc).
    Uses cursor-based pagination bounded in SQL.
    Returns (items, next_cursor).
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found",
        )

    post = (
        db.query(CommunityPost)
        .filter(
            CommunityPost.id == post_id,
            CommunityPost.community_id == community.id,
            CommunityPost.removed_at.is_(None),
        )
        .first()
    )
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )

    query = (
        db.query(CommunityPostReply)
        .options(joinedload(CommunityPostReply.author))
        .join(CommunityPost, CommunityPostReply.post_id == CommunityPost.id)
        .filter(CommunityPostReply.post_id == post.id, CommunityPostReply.removed_at.is_(None),
                CommunityPost.removed_at.is_(None), CommunityPost.community_id == community.id)
    )

    if after is not None:
        cursor_reply = (
            db.query(CommunityPostReply.created_at, CommunityPostReply.id)
            .filter(
                CommunityPostReply.id == after,
                CommunityPostReply.post_id == post.id,
            )
            .first()
        )
        if not cursor_reply:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid pagination cursor",
            )

        query = query.filter(
            or_(
                CommunityPostReply.created_at > cursor_reply.created_at,
                and_(
                    CommunityPostReply.created_at == cursor_reply.created_at,
                    CommunityPostReply.id > cursor_reply.id,
                ),
            )
        )

    query = query.order_by(
        CommunityPostReply.created_at.asc(), CommunityPostReply.id.asc()
    )

    results = query.limit(limit + 1).all()

    has_next = len(results) > limit
    items = results[:limit]
    next_cursor = items[-1].id if has_next and items else None

    return items, next_cursor
