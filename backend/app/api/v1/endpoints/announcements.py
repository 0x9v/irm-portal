from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import require_community_permission, get_current_active_membership
from app.models.membership_permission import PermissionType
from app.models.membership_permission import PermissionType
from app.database.session import get_db
from app.models.membership import Membership
from app.schemas.announcement import AnnouncementCreate, AnnouncementResponse
from app.services.announcement import create_announcement, list_announcements

router = APIRouter()

@router.post(
    "/{community_slug}/announcements",
    response_model=AnnouncementResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new community announcement",
)
def create_community_announcement(
    community_slug: str,
    announcement_in: AnnouncementCreate,
    membership: Membership = Depends(require_community_permission(PermissionType.CREATE_ANNOUNCEMENTS)),
    db: Session = Depends(get_db)
):
    """
    Create a new announcement in the community.
    Requires an active DELEGATE membership.
    """
    return create_announcement(
        db=db,
        community_slug=community_slug,
        author_id=membership.user_id,
        announcement_in=announcement_in
    )


@router.get(
    "/{community_slug}/announcements",
    response_model=list[AnnouncementResponse],
    status_code=status.HTTP_200_OK,
    summary="List community announcements",
)
def list_community_announcements(
    community_slug: str,
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db)
):
    """
    List announcements for a community.
    Requires an active membership in the community.
    """
    return list_announcements(db, community_slug)
