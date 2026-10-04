from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.announcement import Announcement
from app.models.community import Community
from app.schemas.announcement import AnnouncementCreate

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
    return announcement


def list_announcements(db: Session, community_slug: str) -> list[Announcement]:
    """
    List announcements for a specific community, ordered newest first.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )
        
    return (
        db.query(Announcement)
        .filter(Announcement.community_id == community.id)
        .order_by(Announcement.created_at.desc())
        .all()
    )
