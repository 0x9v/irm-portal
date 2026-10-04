import uuid
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.models.community import Community
from app.models.module import Module
from app.models.document import Document, DocumentSource, DocumentStatus
from app.models.document_vote import DocumentVote, VoteValue
from app.models.membership import Membership, MembershipStatus
from app.models.user import User
from app.schemas.document_vote import DocumentVoteResponse


def check_full_document_access(
    db: Session, 
    doc: Document, 
    user: User | None,
    *,
    has_active_membership: bool | None = None,
    user_vote: VoteValue | None = None
) -> bool:
    """
    Reusable access decision function for future full-document serving endpoints.
    Can accept pre-fetched membership and vote states to avoid N+1 queries in lists.
    """
    if not user:
        return False
        
    if doc.status == DocumentStatus.APPROVED:
        return True
        
    if doc.status == DocumentStatus.PENDING and doc.source == DocumentSource.STUDENT:
        # User must have ACTIVE membership in the owning community
        if has_active_membership is None:
            module = db.query(Module).filter(Module.id == doc.module_id).first()
            if not module:
                return False
                
            membership = db.query(Membership).filter(
                Membership.user_id == user.id,
                Membership.community_id == module.community_id,
                Membership.status == MembershipStatus.ACTIVE
            ).first()
            active = membership is not None
        else:
            active = has_active_membership
            
        if not active:
            return False
            
        # User must have their own YES vote
        if has_active_membership is not None:
            # If context was provided, trust the provided user_vote
            return user_vote == VoteValue.YES
            
        vote = db.query(DocumentVote).filter(
            DocumentVote.document_id == doc.id,
            DocumentVote.voter_id == user.id,
            DocumentVote.vote == VoteValue.YES
        ).first()
        
        if vote:
            return True
            
    return False



def _evaluate_document_votes(db: Session, doc: Document) -> bool:
    """
    Evaluates the current vote totals against the document's threshold snapshot.
    Returns True if the document's status changed.
    Assumes the caller holds a lock on the document row.
    """
    if doc.status != DocumentStatus.PENDING or doc.source != DocumentSource.STUDENT:
        return False
        
    if doc.vote_threshold_snapshot is None:
        # Invalid internal state per rules: must not fall back to community setting
        from fastapi import HTTPException
        raise HTTPException(
            status_code=500,
            detail="Document is missing a vote threshold snapshot."
        )
        
    threshold = doc.vote_threshold_snapshot
    
    from sqlalchemy import func
    votes_query = db.query(
        DocumentVote.vote, func.count(DocumentVote.id)
    ).filter(
        DocumentVote.document_id == doc.id
    ).group_by(DocumentVote.vote).all()
    
    yes_count = 0
    no_count = 0
    
    for vote_val, count in votes_query:
        if vote_val == VoteValue.YES:
            yes_count = count
        elif vote_val == VoteValue.NO:
            no_count = count
            
    total = yes_count + no_count
    
    if total < threshold:
        return False
        
    if yes_count > no_count:
        doc.status = DocumentStatus.APPROVED
        return True
    elif no_count > yes_count:
        doc.status = DocumentStatus.REJECTED
        return True
        
    # Tie
    return False


def _handle_vote_integrity_error(e: IntegrityError):
    error_msg = str(e.orig).lower()
    if (
        "uq_document_votes_doc_voter" in error_msg
        or "unique constraint failed: document_votes.document_id, document_votes.voter_id" in error_msg
        # fallback for simple sqlite
        or "unique constraint failed" in error_msg and "document_votes" in error_msg
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already voted on this document."
        )
    raise e


def cast_document_vote(
    db: Session,
    document_id: str,
    user: User,
    vote_value: VoteValue
) -> DocumentVoteResponse:
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    # 1. Look up document and acquire lock if supported
    doc = db.query(Document).filter(Document.id == doc_uuid).with_for_update().populate_existing().first()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    # 2. Check owning community authorization
    module = db.query(Module).filter(Module.id == doc.module_id).first()
    if not module:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Module not found.")
        
    membership = db.query(Membership).filter(
        Membership.user_id == user.id,
        Membership.community_id == module.community_id,
        Membership.status == MembershipStatus.ACTIVE
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active membership in the owning community is required."
        )

    # 3. Check document eligibility
    if doc.status == DocumentStatus.APPROVED or doc.status == DocumentStatus.REJECTED or doc.source == DocumentSource.OFFICIAL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Voting is only allowed on pending student documents."
        )

    # 4. Check uploader restriction
    if doc.uploader_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Uploaders cannot vote on their own documents."
        )

    # 5. Check if vote already exists (pre-check before DB constraint)
    existing_vote = db.query(DocumentVote).filter(
        DocumentVote.document_id == doc.id,
        DocumentVote.voter_id == user.id
    ).first()
    if existing_vote:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already voted on this document."
        )

    # 6. Create vote
    new_vote = DocumentVote(
        document_id=doc.id,
        voter_id=user.id,
        vote=vote_value
    )
    db.add(new_vote)
    
    try:
        db.flush()  # Flush so the aggregate query includes the new vote
        _evaluate_document_votes(db, doc)
        
        db.commit()
        db.refresh(new_vote)
        db.refresh(doc) # Ensure doc has the latest status for access check
    except IntegrityError as e:
        db.rollback()
        _handle_vote_integrity_error(e)
    except Exception as e:
        db.rollback()
        raise e

    # Calculate resulting access decision for the caller
    has_access = check_full_document_access(db, doc, user)

    return DocumentVoteResponse(vote=new_vote.vote, full_document_access=has_access)
