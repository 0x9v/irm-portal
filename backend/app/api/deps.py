from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.sessions import validate_session
from app.database.session import get_db
from app.models.user import User


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """
    Dependency to retrieve the currently authenticated user from the session cookie.
    
    Raises 401 Unauthorized if the session is missing, invalid, expired, revoked,
    or if the user no longer exists.
    """
    raw_token = request.cookies.get(settings.session_cookie_name)
    
    unauthorized_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )
    
    if not raw_token:
        raise unauthorized_exc
        
    session_model = validate_session(db, raw_token)
    if not session_model:
        raise unauthorized_exc
        
    user = db.query(User).filter(User.id == session_model.user_id).first()
    if not user:
        raise unauthorized_exc
        
    return user


from fastapi import Path
from app.models.community import Community
from app.models.membership import Membership, MembershipStatus, MembershipRole

def get_current_active_membership(
    community_slug: str = Path(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Membership:
    """
    Dependency to retrieve the current user's active membership in the specified community.
    
    Raises 404 if the community does not exist.
    Raises 403 if the user does not have an ACTIVE membership in the community.
    """
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found",
        )
        
    membership = db.query(Membership).filter(
        Membership.user_id == current_user.id,
        Membership.community_id == community.id,
    ).first()
    
    if not membership or membership.status != MembershipStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
        
    return membership

def require_community_delegate(
    membership: Membership = Depends(get_current_active_membership),
) -> Membership:
    """
    Dependency to verify that the active membership has the DELEGATE role.
    
    Raises 403 if the membership role is not DELEGATE.
    """
    if membership.role != MembershipRole.DELEGATE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    return membership

from app.models.membership_permission import PermissionType, MembershipPermission

def require_community_permission(required_permission: PermissionType):
    """
    Factory that returns a dependency ensuring the caller is either a DELEGATE
    or an ACTIVE MODERATOR with the specified permission in the active community.
    """
    def permission_dependency(
        membership: Membership = Depends(get_current_active_membership),
        db: Session = Depends(get_db)
    ) -> Membership:
        if membership.role == MembershipRole.DELEGATE:
            return membership
        elif membership.role == MembershipRole.MODERATOR:
            grant = db.query(MembershipPermission).filter(
                MembershipPermission.membership_id == membership.id,
                MembershipPermission.permission == required_permission
            ).first()
            if grant:
                return membership
        
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to perform this action."
        )
    return permission_dependency
