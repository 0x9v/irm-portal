from uuid import UUID
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.content_route import PrivateContentRoute
from app.api.deps import require_community_permission, get_current_active_membership, require_community_delegate
from app.services.content_removal import remove_content
from app.models.membership_permission import PermissionType
from app.database.session import get_db
from app.models.membership import Membership
from app.schemas.announcement import (
    AnnouncementCreate,
    AnnouncementResponse,
    AnnouncementDetailResponse,
    AnnouncementReplyCreate,
    AnnouncementReplyResponse,
    AnnouncementReplyListResponse,
)
from app.services.announcement import (
    create_announcement,
    list_announcements,
    get_announcement_detail,
    create_announcement_reply,
    list_announcement_replies,
)

router = APIRouter(route_class=PrivateContentRoute)


@router.delete("/{community_slug}/announcements/{announcement_id}", status_code=204)
def remove_announcement(
    community_slug: str, announcement_id: UUID,
    membership: Membership = Depends(require_community_delegate), db: Session = Depends(get_db),
) -> Response:
    remove_content(db, membership.community_id, membership.user_id, "announcement", announcement_id)
    return Response(status_code=204, headers={"Cache-Control": "private, no-store"})


@router.delete("/{community_slug}/announcements/{announcement_id}/replies/{reply_id}", status_code=204)
def remove_announcement_reply(
    community_slug: str, announcement_id: UUID, reply_id: UUID,
    membership: Membership = Depends(require_community_delegate), db: Session = Depends(get_db),
) -> Response:
    remove_content(db, membership.community_id, membership.user_id, "announcement_reply", reply_id, announcement_id)
    return Response(status_code=204, headers={"Cache-Control": "private, no-store"})

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
    response: Response,
    limit: int | None = Query(None, gt=0, le=100, description="Maximum number of announcements to return"),
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db)
):
    """
    List announcements for a community, ordered newest first.
    Requires an active membership in the community.
    Supports optional bounded limit for retrieving latest announcements.
    """
    response.headers["Cache-Control"] = "private, no-store"
    return list_announcements(db, community_slug, limit=limit)


@router.get(
    "/{community_slug}/announcements/{announcement_id}",
    response_model=AnnouncementDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Get announcement detail",
)
def get_community_announcement(
    community_slug: str,
    announcement_id: UUID,
    response: Response,
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db)
):
    """
    Get announcement detail for an authorized community member.
    Requires an active membership in the community.
    Safely scopes lookup to both announcement ID and community ID.
    """
    response.headers["Cache-Control"] = "private, no-store"
    return get_announcement_detail(db, community_slug, announcement_id)


@router.post(
    "/{community_slug}/announcements/{announcement_id}/replies",
    response_model=AnnouncementReplyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a reply to a community announcement",
)
def create_community_announcement_reply(
    community_slug: str,
    announcement_id: UUID,
    reply_in: AnnouncementReplyCreate,
    response: Response,
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
):
    """
    Create a new reply to an announcement in the community.
    Requires an active membership in the community (MEMBER, MODERATOR, or DELEGATE).
    Does NOT require CREATE_ANNOUNCEMENTS permission.
    """
    response.headers["Cache-Control"] = "private, no-store"
    return create_announcement_reply(
        db=db,
        community_slug=community_slug,
        announcement_id=announcement_id,
        author_id=membership.user_id,
        reply_in=reply_in,
    )


@router.get(
    "/{community_slug}/announcements/{announcement_id}/replies",
    response_model=AnnouncementReplyListResponse,
    status_code=status.HTTP_200_OK,
    summary="List replies to a community announcement",
)
def list_community_announcement_replies(
    community_slug: str,
    announcement_id: UUID,
    response: Response,
    limit: int = Query(20, ge=1, le=50, description="Maximum number of replies to return"),
    after: UUID | None = Query(None, description="Optional cursor (reply ID) to return replies after"),
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
):
    """
    List replies for an announcement, ordered oldest first.
    Requires an active membership in the community.
    Supports cursor-based pagination using the reply UUID.
    """
    response.headers["Cache-Control"] = "private, no-store"
    items, next_cursor = list_announcement_replies(
        db=db,
        community_slug=community_slug,
        announcement_id=announcement_id,
        limit=limit,
        after=after,
    )
    return AnnouncementReplyListResponse(items=items, next_cursor=next_cursor)
