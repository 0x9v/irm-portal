from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from app.models.announcement import Announcement
from app.models.announcement_reply import AnnouncementReply
from app.models.community import Community
from app.schemas.announcement import AnnouncementCreate, AnnouncementReplyCreate

def create_announcement(
    db: Session,
    community_slug: str,
    author_id: UUID,
    announcement_in: AnnouncementCreate
) -> Announcement:
    """
    Create a new announcement for a community.
    Assumes the author is already authorized.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )

    announcement = Announcement(
        community_id=community.id,
        author_id=author_id,
        title=announcement_in.title,
        content=announcement_in.content
    )
    db.add(announcement)
    db.commit()
    db.refresh(announcement)
    if announcement.removed_at is not None:
        raise HTTPException(404, "Announcement not found")
    return announcement


def list_announcements(
    db: Session,
    community_slug: str,
    limit: int | None = None
) -> list[Announcement]:
    """
    List announcements for a specific community, ordered newest first.
    Deterministic ordering: created_at descending, id descending.
    Applies limit in SQL before materializing results.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )
        
    query = (
        db.query(Announcement)
        .filter(Announcement.community_id == community.id, Announcement.removed_at.is_(None))
        .order_by(Announcement.created_at.desc(), Announcement.id.desc())
    )
    if limit is not None:
        query = query.limit(limit)

    return query.all()


def get_announcement_detail(
    db: Session,
    community_slug: str,
    announcement_id: UUID
) -> Announcement:
    """
    Retrieve announcement detail ensuring it belongs to the specified community.
    Safely masks non-existent or cross-community announcements with a 404.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )

    announcement = (
        db.query(Announcement)
        .options(joinedload(Announcement.author))
        .filter(
            Announcement.id == announcement_id,
            Announcement.community_id == community.id,
            Announcement.removed_at.is_(None)
        )
        .first()
    )
    if not announcement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Announcement not found"
        )

    return announcement


def create_announcement_reply(
    db: Session,
    community_slug: str,
    announcement_id: UUID,
    author_id: UUID,
    reply_in: AnnouncementReplyCreate,
) -> AnnouncementReply:
    """
    Create a new reply to an announcement in a specific community.
    Safely ensures announcement exists and belongs to the specified community.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )

    announcement = (
        db.query(Announcement)
        .filter(
            Announcement.id == announcement_id,
            Announcement.community_id == community.id,
            Announcement.removed_at.is_(None),
        )
        .with_for_update()
        .first()
    )
    if not announcement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Announcement not found"
        )

    reply = AnnouncementReply(
        announcement_id=announcement.id,
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
        db.query(AnnouncementReply)
        .options(joinedload(AnnouncementReply.author))
        .join(Announcement, AnnouncementReply.announcement_id == Announcement.id)
        .filter(AnnouncementReply.id == reply.id, AnnouncementReply.removed_at.is_(None),
                Announcement.removed_at.is_(None), Announcement.community_id == community.id)
        .first()
    )
    if not saved_reply:
        raise HTTPException(404, "Content not found")
    return saved_reply


def list_announcement_replies(
    db: Session,
    community_slug: str,
    announcement_id: UUID,
    limit: int = 20,
    after: UUID | None = None,
) -> tuple[list[AnnouncementReply], UUID | None]:
    """
    List replies for an announcement, ordered oldest first (created_at asc, id asc).
    Uses cursor-based pagination bounded in SQL.
    Returns (items, next_cursor).
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )

    announcement = (
        db.query(Announcement)
        .filter(
            Announcement.id == announcement_id,
            Announcement.community_id == community.id,
            Announcement.removed_at.is_(None),
        )
        .first()
    )
    if not announcement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Announcement not found"
        )

    query = (
        db.query(AnnouncementReply)
        .options(joinedload(AnnouncementReply.author))
        .join(Announcement, AnnouncementReply.announcement_id == Announcement.id)
        .filter(AnnouncementReply.announcement_id == announcement.id, AnnouncementReply.removed_at.is_(None),
                Announcement.removed_at.is_(None), Announcement.community_id == community.id)
    )

    if after is not None:
        cursor_reply = (
            db.query(AnnouncementReply.created_at, AnnouncementReply.id)
            .filter(
                AnnouncementReply.id == after,
                AnnouncementReply.announcement_id == announcement.id,
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
                AnnouncementReply.created_at > cursor_reply.created_at,
                and_(
                    AnnouncementReply.created_at == cursor_reply.created_at,
                    AnnouncementReply.id > cursor_reply.id,
                ),
            )
        )

    query = query.order_by(AnnouncementReply.created_at.asc(), AnnouncementReply.id.asc())

    # Limit in SQL: fetch limit + 1 records to check if next page exists
    results = query.limit(limit + 1).all()

    has_next = len(results) > limit
    items = results[:limit]
    next_cursor = items[-1].id if has_next and items else None

    return items, next_cursor
