from fastapi import APIRouter, Depends, status, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_active_membership
from app.database.session import get_db
from app.models.user import User
from app.models.membership import Membership
from app.models.document import DocumentType, DocumentSource
from app.schemas.document import DocumentResponse
from app.services.module import get_community_module
from app.services.document import upload_document

router = APIRouter()

@router.post(
    "/{community_slug}/modules/{module_slug}/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a document to a module",
)
def upload_module_document(
    community_slug: str,
    module_slug: str,
    file: UploadFile = File(...),
    title: str = Form(...),
    type: DocumentType = Form(...),
    source: DocumentSource = Form(None),
    current_user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db)
):
    """
    Upload a document to a specific module within a community.
    """
    # Verify module exists in the community
    module = get_community_module(db, community_slug, module_slug)
    if not module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Module not found"
        )
        
    return upload_document(
        db=db,
        module=module,
        uploader_id=current_user.id,
        membership=membership,
        file=file,
        title=title,
        doc_type=type,
        requested_source=source
    )


@router.get(
    "/{community_slug}/modules/{module_slug}/documents",
    response_model=list[DocumentResponse],
    status_code=status.HTTP_200_OK,
    summary="List approved documents for a module",
)
def list_module_documents(
    community_slug: str,
    module_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List APPROVED documents belonging to a specific module.
    Documents are public to any authenticated user.
    """
    module = get_community_module(db, community_slug, module_slug)
    if not module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Module not found"
        )
        
    from app.services.document import list_approved_documents
    return list_approved_documents(db, module.id)


@router.get(
    "/{community_slug}/modules/{module_slug}/documents/{document_id}",
    response_model=DocumentResponse,
    status_code=status.HTTP_200_OK,
    summary="Get an approved document detail",
)
def get_module_document(
    community_slug: str,
    module_slug: str,
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get a single APPROVED document belonging to a specific module.
    Documents are public to any authenticated user.
    """
    module = get_community_module(db, community_slug, module_slug)
    if not module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Module not found"
        )
        
    from app.services.document import get_approved_document
    return get_approved_document(db, module.id, document_id)


@router.get(
    "/{community_slug}/modules/{module_slug}/documents/{document_id}/download",
    status_code=status.HTTP_200_OK,
    summary="Download an approved document",
)
def download_module_document(
    community_slug: str,
    module_slug: str,
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Download the physical file of an APPROVED document.
    Documents are public to any authenticated user.
    """
    module = get_community_module(db, community_slug, module_slug)
    if not module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Module not found"
        )
        
    from app.services.document import get_approved_document, get_document_download_info
    doc = get_approved_document(db, module.id, document_id)
    file_path, mime_type, safe_filename = get_document_download_info(doc)
    
    from fastapi.responses import FileResponse
    return FileResponse(
        path=file_path,
        media_type=mime_type,
        filename=safe_filename,
        content_disposition_type="attachment"
    )



from app.schemas.document import PendingDocumentResponse

@router.get(
    "/{community_slug}/documents/pending",
    response_model=list[PendingDocumentResponse],
    status_code=status.HTTP_200_OK,
    summary="List pending student documents in a community",
)
def api_list_pending_student_documents(
    community_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List PENDING STUDENT documents for the requested community.
    Requires ACTIVE membership in the community.
    Includes caller-specific state (my_vote, full_document_access, etc.).
    """
    from app.services.document import list_pending_student_documents
    from fastapi.responses import JSONResponse
    from fastapi.encoders import jsonable_encoder
    
    docs = list_pending_student_documents(db, community_slug, current_user)
    
    # We construct a custom JSONResponse to append Cache-Control headers
    encoded_docs = jsonable_encoder(docs)
    return JSONResponse(
        content=encoded_docs,
        headers={"Cache-Control": "private, no-store"}
    )
