from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.schemas.membership import MembershipCreate, MembershipResponse
from app.services.membership import create_membership_request

router = APIRouter()

@router.post(
    "/{community_slug}/membership",
    response_model=MembershipResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Request membership in a community",
)
def request_membership(
    community_slug: str,
    membership_in: MembershipCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Request membership for the currently authenticated user in the specified community.
    """
    membership = create_membership_request(
        db=db,
        user=current_user,
        community_slug=community_slug,
        cne=membership_in.cne
    )
    return membership



from app.schemas.self_membership import SelfMembershipResponse, SelfMembershipInfo, SelfMembershipCapabilities
from app.models.community import Community
from app.models.membership import MembershipStatus, MembershipRole
from app.models.membership_permission import MembershipPermission, PermissionType
from fastapi.responses import JSONResponse
from fastapi import HTTPException


from app.schemas.self_membership import SelfMembershipResponse, SelfMembershipInfo, SelfMembershipCapabilities
from app.models.community import Community
from app.models.membership import MembershipStatus, MembershipRole
from app.models.membership_permission import MembershipPermission, PermissionType
from fastapi.responses import JSONResponse
from fastapi import HTTPException
from app.api.deps import has_community_permission

@router.get(
    "/{community_slug}/membership/me",
    response_model=SelfMembershipResponse,
    status_code=status.HTTP_200_OK,
    summary="Get current user's membership and capabilities in a community"
)
def get_self_membership(
    community_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(status_code=404, detail="Community not found")
        
    membership = db.query(Membership).filter(
        Membership.user_id == current_user.id,
        Membership.community_id == community.id
    ).first()
    
    capabilities = SelfMembershipCapabilities(
        create_announcements=False,
        manage_document_voting=False,
        upload_official_documents=False
    )
    
    mem_info = None
    
    if membership:
        mem_info = SelfMembershipInfo(
            id=membership.id,
            status=membership.status,
            role=membership.role
        )
        
        capabilities.create_announcements = has_community_permission(db, membership, PermissionType.CREATE_ANNOUNCEMENTS)
        capabilities.manage_document_voting = has_community_permission(db, membership, PermissionType.MANAGE_DOCUMENT_VOTING)
        capabilities.upload_official_documents = has_community_permission(db, membership, PermissionType.UPLOAD_OFFICIAL_DOCUMENTS)

    response_data = SelfMembershipResponse(
        membership=mem_info,
        capabilities=capabilities
    )
    
    return JSONResponse(
        content=response_data.model_dump(mode='json'),
        headers={"Cache-Control": "private, no-store"}
    )


from app.api.deps import require_community_delegate, require_community_permission
from app.models.membership_permission import PermissionType
from app.models.membership import Membership
from app.services.membership import approve_membership, reject_membership


from app.schemas.membership import PendingMembershipResponse
from app.services.membership import get_pending_memberships

@router.get(
    "/{community_slug}/membership/pending",
    response_model=list[PendingMembershipResponse],
    status_code=status.HTTP_200_OK,
    summary="List pending membership requests"
)
def api_list_pending_memberships(
    community_slug: str,
    skip: int = 0,
    limit: int = 100,
    delegate: Membership = Depends(require_community_delegate),
    db: Session = Depends(get_db)
):
    """
    List pending membership requests for a community. Requires DELEGATE role.
    """
    results = get_pending_memberships(db, community_slug, skip=skip, limit=limit)
    return JSONResponse(
        content=[r.model_dump(mode='json') for r in results],
        headers={"Cache-Control": "private, no-store"}
    )

@router.post(
    "/{community_slug}/membership/{membership_id}/approve",
    response_model=MembershipResponse,
    status_code=status.HTTP_200_OK,
    summary="Approve a membership request",
)
def api_approve_membership(
    community_slug: str,
    membership_id: str,
    delegate: Membership = Depends(require_community_permission(PermissionType.MANAGE_DOCUMENT_VOTING)),
    db: Session = Depends(get_db)
):
    """
    Approve a pending membership. Requires DELEGATE role.
    """
    return approve_membership(db, community_slug, membership_id)


@router.post(
    "/{community_slug}/membership/{membership_id}/reject",
    response_model=MembershipResponse,
    status_code=status.HTTP_200_OK,
    summary="Reject a membership request",
)
def api_reject_membership(
    community_slug: str,
    membership_id: str,
    delegate: Membership = Depends(require_community_permission(PermissionType.MANAGE_DOCUMENT_VOTING)),
    db: Session = Depends(get_db)
):
    """
    Reject a pending membership. Requires DELEGATE role.
    """
    return reject_membership(db, community_slug, membership_id)


from app.services.membership import withdraw_membership_request

@router.delete(
    "/{community_slug}/membership/{membership_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Withdraw a pending membership request",
)
def api_withdraw_membership(
    community_slug: str,
    membership_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Withdraw the caller's own pending membership request.
    """
    withdraw_membership_request(db, community_slug, membership_id, current_user)
    # The return value for 204 must be empty
    return None

from app.schemas.community_settings import DocumentVotingSettingsUpdate, DocumentVotingSettingsResponse

from app.models.community import Community
from fastapi import HTTPException
from fastapi.responses import JSONResponse

@router.get(
    "/{community_slug}/document-voting/settings",
    response_model=DocumentVotingSettingsResponse,
    status_code=status.HTTP_200_OK,
    summary="Get document voting settings for a community",
)
def get_document_voting_settings(
    community_slug: str,
    delegate: Membership = Depends(require_community_permission(PermissionType.MANAGE_DOCUMENT_VOTING)),
    db: Session = Depends(get_db)
):
    """
    Get the document voting settings. Requires DELEGATE role.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(status_code=404, detail="Community not found")
        
    response_data = {"required_total_votes": community.document_vote_threshold}
    return JSONResponse(
        content=response_data,
        headers={"Cache-Control": "private, no-store"}
    )

@router.patch(
    "/{community_slug}/document-voting/settings",
    response_model=DocumentVotingSettingsResponse,
    status_code=status.HTTP_200_OK,
    summary="Update document voting settings for a community",
)
def update_document_voting_settings(
    community_slug: str,
    settings_in: DocumentVotingSettingsUpdate,
    delegate: Membership = Depends(require_community_permission(PermissionType.MANAGE_DOCUMENT_VOTING)),
    db: Session = Depends(get_db)
):
    """
    Update the document voting settings. Requires DELEGATE role.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(status_code=404, detail="Community not found")
        
    community.document_vote_threshold = settings_in.required_total_votes
    db.commit()
    
    response_data = {"required_total_votes": community.document_vote_threshold}
    return JSONResponse(
        content=response_data,
        headers={"Cache-Control": "private, no-store"}
    )

from app.schemas.membership_permission import MembershipPermissionsResponse, MembershipPermissionsUpdate
from app.services.membership import get_moderator_permissions, update_moderator_permissions

@router.get(
    "/{community_slug}/membership/{membership_id}/permissions",
    response_model=MembershipPermissionsResponse,
    status_code=status.HTTP_200_OK,
)
def api_get_permissions(
    community_slug: str,
    membership_id: str,
    delegate: Membership = Depends(require_community_delegate),
    db: Session = Depends(get_db)
):
    permissions = get_moderator_permissions(db, community_slug, membership_id)
    return JSONResponse(
        content=permissions.model_dump(),
        headers={"Cache-Control": "private, no-store"}
    )

@router.patch(
    "/{community_slug}/membership/{membership_id}/permissions",
    response_model=MembershipPermissionsResponse,
    status_code=status.HTTP_200_OK,
)
def api_update_permissions(
    community_slug: str,
    membership_id: str,
    permissions_in: MembershipPermissionsUpdate,
    delegate: Membership = Depends(require_community_delegate),
    db: Session = Depends(get_db)
):
    if not permissions_in.model_dump(exclude_unset=True):
        raise HTTPException(status_code=422, detail="Empty patch not allowed")
    
    permissions = update_moderator_permissions(db, community_slug, membership_id, permissions_in)
    return JSONResponse(
        content=permissions.model_dump(),
        headers={"Cache-Control": "private, no-store"}
    )
