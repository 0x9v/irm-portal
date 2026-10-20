from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.services.document import get_document_preview_bytes

router = APIRouter()


@router.get(
    "/{document_id}/preview",
    status_code=status.HTTP_200_OK,
    summary="Get the preview image of a document",
)
def get_document_preview(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retrieve the first-page preview of a document.
    Requires authentication. Accessible if the document is PENDING or APPROVED.
    """
    preview_bytes = get_document_preview_bytes(db, document_id)
    
    return Response(
        content=preview_bytes,
        media_type="image/png"
    )

from app.schemas.document_vote import DocumentVoteCreate, DocumentVoteResponse
from app.services.document_vote import cast_document_vote

@router.post(
    "/{document_id}/vote",
    response_model=DocumentVoteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Vote on a pending student document",
)
def vote_on_document(
    document_id: str,
    vote_in: DocumentVoteCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Cast a vote (YES or NO) on a pending student document.
    Requires ACTIVE membership in the document's community.
    """
    return cast_document_vote(db, document_id, current_user, vote_in.vote)

import uuid
from fastapi import HTTPException
from fastapi.responses import FileResponse
from app.models.document import Document, DocumentStatus
from app.services.document import get_document_download_info, ALLOWED_MIME_TYPES
from app.services.document_vote import check_full_document_access

@router.get(
    "/{document_id}/download",
    status_code=status.HTTP_200_OK,
    summary="Download an original document based on global access rules",
)
def download_global_document(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Download the physical file of a document.
    Accessible if the document is APPROVED or if the user is an active member
    who voted YES on a PENDING STUDENT document.
    """
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    doc = db.query(Document).filter(Document.id == doc_uuid).first()
    if not doc or doc.removed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    # Evaluate authorization using the shared access decision
    if not check_full_document_access(db, doc, current_user):
        # Do not disclose if an unauthorized document actually exists
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    # Safe file resolution and MIME generation
    file_path, mime_type, safe_filename = get_document_download_info(doc)
    if db.query(Document.id).filter(Document.id == doc.id,
                                    Document.removed_at.is_(None)).first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    return FileResponse(
        path=file_path,
        media_type=mime_type,
        filename=safe_filename,
        content_disposition_type="attachment",
        headers={"Cache-Control": "private, no-store"}
    )


@router.get(
    "/{document_id}/view",
    status_code=status.HTTP_200_OK,
    summary="View an approved original document inline",
)
def view_approved_document(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    View the physical file of an APPROVED document inline.
    Requires authentication. Only APPROVED documents are eligible.
    PENDING and REJECTED documents return 404 Not Found.
    """
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    doc = db.query(Document).filter(Document.id == doc_uuid).first()
    if not doc or doc.removed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    # 1. Enforce APPROVED-only restriction explicitly:
    # PENDING documents (including for YES voters) and REJECTED documents must return safe 404
    if doc.status != DocumentStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    # 2. Evaluate authorization using the shared access decision
    if not check_full_document_access(db, doc, current_user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    # 3. Only after authorization succeeds, resolve physical file info
    file_path, mime_type, safe_filename = get_document_download_info(doc)

    # 4. Verify MIME type is supported for inline viewing (PDF, JPEG, PNG)
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported document format for inline viewing."
        )

    # 5. Return FileResponse with inline disposition and security headers
    return FileResponse(
        path=file_path,
        media_type=mime_type,
        filename=safe_filename,
        content_disposition_type="inline",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )

