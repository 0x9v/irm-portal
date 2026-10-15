from uuid import UUID
from fastapi import APIRouter, Depends, status, UploadFile, File, Form, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_active_membership
from app.database.session import get_db
from app.models.user import User
from app.models.membership import Membership
from app.models.document import DocumentType, DocumentSource, DocumentStatus
from app.schemas.document import (
    DocumentResponse,
    MyDocumentSubmissionFeedResponse,
    MyDocumentSubmissionResponse,
    SavedDocumentFeedResponse,
    SavedDocumentResponse,
    SavedDocumentStateResponse,
)
from app.schemas.document_reading import (
    DocumentPageUpdate,
    DocumentReadingPositionResponse,
    RecentDocumentFeedResponse,
    RecentDocumentResponse,
)
from app.services.module import get_community_module
from app.services.document import upload_document

router = APIRouter()


@router.post(
    "/{community_slug}/documents/{document_id}/reading/open",
    response_model=DocumentReadingPositionResponse,
    summary="Record an authenticated user's approved-document open",
)
def open_document_for_reading(
    community_slug: str,
    document_id: str,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.document_reading import get_readable_approved_document, open_document

    response.headers["Cache-Control"] = "private, no-store"
    document = get_readable_approved_document(db, community_slug, document_id, current_user)
    record = open_document(db, user_id=current_user.id, document=document)
    return DocumentReadingPositionResponse(last_page=record.last_page)


@router.put(
    "/{community_slug}/documents/{document_id}/reading/position",
    response_model=DocumentReadingPositionResponse,
    summary="Update the authenticated user's approved-document page position",
)
def update_document_reading_position(
    community_slug: str,
    document_id: str,
    page_update: DocumentPageUpdate,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.document_reading import get_readable_approved_document, update_document_page

    response.headers["Cache-Control"] = "private, no-store"
    document = get_readable_approved_document(db, community_slug, document_id, current_user)
    record = update_document_page(db, user_id=current_user.id, document=document, page=page_update.page)
    return DocumentReadingPositionResponse(last_page=record.last_page)


@router.get(
    "/{community_slug}/documents/recent",
    response_model=RecentDocumentFeedResponse,
    summary="List the authenticated user's recently opened approved documents",
)
def list_recent_documents_endpoint(
    community_slug: str,
    response: Response,
    limit: int = Query(20, ge=1, le=50),
    after: UUID | None = Query(None, description="Optional recent-reading record UUID cursor"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.document_reading import list_recent_documents

    response.headers["Cache-Control"] = "private, no-store"
    rows, next_cursor = list_recent_documents(
        db, user_id=current_user.id, community_slug=community_slug, limit=limit, after=after
    )
    items = [
        RecentDocumentResponse(
            id=document.id,
            module_id=module.id,
            module_slug=module.slug,
            module_name=module.name,
            title=document.title,
            type=document.type,
            source=document.source,
            last_page=record.last_page,
            last_opened_at=record.last_opened_at,
        )
        for record, document, module in rows
    ]
    return RecentDocumentFeedResponse(items=items, next_cursor=next_cursor)


@router.get(
    "/{community_slug}/documents/saved",
    response_model=SavedDocumentFeedResponse,
    summary="List the authenticated user's saved approved documents",
)
def list_saved_documents_endpoint(
    community_slug: str,
    response: Response,
    limit: int = Query(20, ge=1, le=50),
    after: UUID | None = Query(None, description="Optional saved-record UUID cursor"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.saved_document import list_saved_documents

    response.headers["Cache-Control"] = "private, no-store"
    rows, next_cursor = list_saved_documents(
        db, user_id=current_user.id, community_slug=community_slug, limit=limit, after=after
    )
    if rows is None:
        raise HTTPException(status_code=404, detail="Saved document cursor not found")
    items = [
        SavedDocumentResponse(
            id=document.id,
            module_id=module.id,
            module_slug=module.slug,
            module_name=module.name,
            title=document.title,
            type=document.type,
            source=document.source,
            document_created_at=document.created_at,
            saved_at=save.created_at,
        )
        for save, document, module in rows
    ]
    return SavedDocumentFeedResponse(items=items, next_cursor=next_cursor)


@router.get(
    "/{community_slug}/documents/{document_id}/saved",
    response_model=SavedDocumentStateResponse,
    summary="Check whether an approved document is saved by the caller",
)
def get_saved_document_state(
    community_slug: str,
    document_id: UUID,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.saved_document import approved_document_query, is_saved

    response.headers["Cache-Control"] = "private, no-store"
    if db.execute(approved_document_query(community_slug, document_id)).first() is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return SavedDocumentStateResponse(
        saved=is_saved(db, current_user.id, community_slug, document_id)
    )


@router.put(
    "/{community_slug}/documents/{document_id}/saved",
    response_model=SavedDocumentStateResponse,
    summary="Save an approved document",
)
def put_saved_document(
    community_slug: str,
    document_id: UUID,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.saved_document import save_approved_document

    response.headers["Cache-Control"] = "private, no-store"
    if not save_approved_document(db, current_user.id, community_slug, document_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return SavedDocumentStateResponse(saved=True)


@router.delete(
    "/{community_slug}/documents/{document_id}/saved",
    response_model=SavedDocumentStateResponse,
    summary="Remove an approved document from the caller's saved documents",
)
def delete_saved_document(
    community_slug: str,
    document_id: UUID,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.saved_document import remove_saved_document

    response.headers["Cache-Control"] = "private, no-store"
    remove_saved_document(db, current_user.id, community_slug, document_id)
    return SavedDocumentStateResponse(saved=False)

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
    q: str | None = Query(default=None, description="Case-insensitive literal title search; maximum 100 characters after trimming."),
    type: DocumentType | None = Query(default=None),
    source: DocumentSource | None = Query(default=None),
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
        
    title_query = q.strip() if q is not None else None
    if title_query and len(title_query) > 100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Search query must be at most 100 characters after trimming.",
        )

    from app.services.document import list_approved_documents
    return list_approved_documents(
        db,
        module.id,
        title_query=title_query or None,
        doc_type=type,
        source=source,
    )


@router.get(
    "/{community_slug}/documents/mine",
    response_model=MyDocumentSubmissionFeedResponse,
    status_code=status.HTTP_200_OK,
    summary="List the authenticated user's document submissions",
)
def list_my_document_submissions(
    community_slug: str,
    response: Response,
    limit: int = Query(20, ge=1, le=50, description="Maximum submissions to return"),
    after: UUID | None = Query(None, description="Optional submission ID cursor"),
    status_filter: DocumentStatus | None = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
):
    """List only the caller's submissions in a community where they are active."""
    from app.services.document import list_my_document_submissions

    response.headers["Cache-Control"] = "private, no-store"
    rows, next_cursor = list_my_document_submissions(
        db,
        community_id=membership.community_id,
        uploader_id=current_user.id,
        limit=limit,
        after=after,
        status_filter=status_filter,
    )
    items = [
        MyDocumentSubmissionResponse(
            id=document.id,
            module_id=module.id,
            module_slug=module.slug,
            module_name=module.name,
            title=document.title,
            type=document.type,
            source=document.source,
            status=document.status,
            created_at=document.created_at,
            updated_at=document.updated_at,
        )
        for document, module in rows
    ]
    return MyDocumentSubmissionFeedResponse(items=items, next_cursor=next_cursor)


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
