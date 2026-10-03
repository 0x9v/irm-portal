import uuid
from typing import Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.models.community import Community
from app.models.user import User
from app.models.membership import Membership, MembershipStatus, MembershipRole

def appoint_delegate(
    db: Session,
    community_slug: str,
    user_id_str: str,
    cne: Optional[str] = None,
    apply: bool = False
) -> Tuple[bool, str]:
    """
    Appoints an existing user as the ACTIVE DELEGATE for a community.
    Returns (success, message).
    """
    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        return False, f"Invalid user ID format: {user_id_str}"
        
    # Lock order to avoid deadlocks:
    # 1. Community (to serialize appointments per community)
    # 2. User (consistent with all other membership operations)
    # 3. Membership (consistent with all other membership operations)
    # Since other operations lock User -> Membership without locking Community,
    # locking Community first here will not cause cycles because Community is
    # a root lock that no other operation competes for out of order.
    
    community = db.query(Community).filter(Community.slug == community_slug).with_for_update().first()
    if not community:
        return False, f"Unknown community slug: {community_slug}"
        
    user = db.query(User).filter(User.id == user_uuid).with_for_update().first()
    if not user:
        return False, f"Unknown user ID: {user_id_str}"
        
    # Check if this community already has a different active delegate
    existing_delegate = db.query(Membership).filter(
        Membership.community_id == community.id,
        Membership.status == MembershipStatus.ACTIVE,
        Membership.role == MembershipRole.DELEGATE,
    ).first()
    
    if existing_delegate and existing_delegate.user_id != user.id:
        return False, f"Community already has a different active delegate (User {existing_delegate.user_id})"
        
    # Check user's global memberships
    # We must lock the target membership if it exists
    target_membership = db.query(Membership).filter(
        Membership.user_id == user.id,
        Membership.community_id == community.id
    ).populate_existing().with_for_update().first()
    
    # Check for active/pending memberships in ANY community
    global_active_pending = db.query(Membership).filter(
        Membership.user_id == user.id,
        Membership.status.in_([MembershipStatus.PENDING, MembershipStatus.ACTIVE])
    ).all()
    
    for m in global_active_pending:
        if m.community_id != community.id:
            return False, f"User has active/pending membership in another community (ID: {m.community_id})"
        if m.status == MembershipStatus.PENDING:
            return False, "User has a pending membership request in this community. Withdraw or review it first."
            
    if target_membership:
        if target_membership.status == MembershipStatus.ACTIVE:
            if target_membership.role == MembershipRole.DELEGATE:
                return True, "User is already the ACTIVE Delegate for this community (idempotent)."
            if target_membership.role == MembershipRole.MODERATOR:
                return False, "User is an ACTIVE MODERATOR. Promotion from moderator is currently unsupported."
            
            # Case B: User is an ACTIVE MEMBER of the target community
            if apply:
                target_membership.role = MembershipRole.DELEGATE
                db.commit()
            return True, f"Promoted existing ACTIVE MEMBER to DELEGATE (ID: {target_membership.id})"
            
        elif target_membership.status == MembershipStatus.REJECTED:
            # Case A (rejected): reuse the row
            if not cne or not cne.strip():
                return False, "A valid CNE is required when reopening a rejected membership."
                
            if apply:
                target_membership.status = MembershipStatus.ACTIVE
                target_membership.role = MembershipRole.DELEGATE
                target_membership.cne = cne.strip()
                # Clear any stale permission metadata
                for p in list(target_membership.permissions):
                    db.delete(p)
                db.commit()
            return True, f"Reopened REJECTED membership as ACTIVE DELEGATE (ID: {target_membership.id})"
            
    else:
        # Case A (no membership): Create new
        if not cne or not cne.strip():
            return False, "A valid CNE is required when creating a new membership."
            
        if apply:
            new_m = Membership(
                user_id=user.id,
                community_id=community.id,
                status=MembershipStatus.ACTIVE,
                role=MembershipRole.DELEGATE,
                cne=cne.strip()
            )
            db.add(new_m)
            db.commit()
            return True, "Created new ACTIVE DELEGATE membership."
        else:
            return True, "Would create new ACTIVE DELEGATE membership."
            
    return False, "Unhandled case."
