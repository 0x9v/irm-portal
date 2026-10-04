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
from app.models.document import Document
from app.services.document import get_document_download_info
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
    if not doc:
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

    return FileResponse(
        path=file_path,
        media_type=mime_type,
        filename=safe_filename,
        content_disposition_type="attachment",
        headers={"Cache-Control": "private, no-store"}
    )
