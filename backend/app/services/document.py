import uuid
from fastapi import UploadFile, HTTPException, status
from sqlalchemy.orm import Session
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.module import Module
from app.core.storage.local import LocalFileSystemStorage

storage = LocalFileSystemStorage()

ALLOWED_MIME_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}

def upload_document(
    db: Session,
    module: Module,
    uploader_id: uuid.UUID,
    membership: Membership,
    file: UploadFile,
    title: str,
    doc_type: DocumentType,
    requested_source: DocumentSource | None = None
) -> Document:
    # 1. Determine source based on role
    if membership.role == MembershipRole.MEMBER:
        if requested_source == DocumentSource.OFFICIAL:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Members cannot create official documents."
            )
        final_source = DocumentSource.STUDENT
    elif membership.role == MembershipRole.DELEGATE:
        if requested_source is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Delegates and Moderators must explicitly provide a source."
            )
        final_source = requested_source
    elif membership.role == MembershipRole.MODERATOR:
        if requested_source is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Delegates and Moderators must explicitly provide a source."
            )
        if requested_source == DocumentSource.OFFICIAL:
            from app.models.membership_permission import MembershipPermission, PermissionType
            grant = db.query(MembershipPermission).filter(
                MembershipPermission.membership_id == membership.id,
                MembershipPermission.permission == PermissionType.UPLOAD_OFFICIAL_DOCUMENTS
            ).first()
            if not grant:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Moderator does not have permission to upload official documents."
                )
        final_source = requested_source
    # 1b. Determine status purely from the validated source
    if final_source == DocumentSource.OFFICIAL:
        final_status = DocumentStatus.APPROVED
    else:
        final_status = DocumentStatus.PENDING

    # 2. Validate file type
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Only PDF, JPEG, and PNG are allowed."
        )

    # 3. Generate safe storage identifier
    file_ext = ALLOWED_MIME_TYPES[file.content_type]
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    storage_key = f"{module.community_id}/{module.id}/{unique_filename}"
    
    from app.core.config import settings
    # Read file content safely, enforcing maximum size without trusting Content-Length
    max_bytes = settings.document_upload_max_bytes
    
    # Read up to max_bytes + 1 to detect overflow without loading a huge file into memory
    content = file.file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size is {max_bytes // (1024 * 1024)} MiB."
        )

    from app.core.storage.exceptions import StorageError
    from app.services.preview import create_and_store_preview

    try:
        storage.save(storage_key, content)
    except StorageError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Storage operation failed."
        )

    # 4. Generate preview
    # We must know the future document ID to generate the preview key.
    # UUID can be generated proactively.
    doc_id = uuid.uuid4()
    preview_key = None

    try:
        preview_key = create_and_store_preview(
            storage=storage,
            document_id=doc_id,
            community_id=module.community_id,
            module_id=module.id,
            content_type=file.content_type,
            original_content=content
        )
    except Exception as e:
        # Cleanup original file
        storage.delete(storage_key)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Preview generation failed: {e}"
        )

    # 5. Persist to DB
    # Assign threshold snapshot for new pending student documents
    snapshot = None
    if final_source == DocumentSource.STUDENT and final_status == DocumentStatus.PENDING:
        from app.models.community import Community
        community = db.query(Community).filter(Community.id == module.community_id).first()
        if not community:
            # Revert since something went very wrong with the hierarchy
            storage.delete(storage_key)
            if preview_key:
                storage.delete(preview_key)
            raise HTTPException(status_code=500, detail="Owning community not found.")
        snapshot = community.document_vote_threshold

    doc = Document(
        id=doc_id,
        module_id=module.id,
        uploader_id=uploader_id,
        title=title,
        type=doc_type,
        source=final_source,
        status=final_status,
        storage_path=storage_key,
        preview_path=preview_key,
        vote_threshold_snapshot=snapshot
    )
    
    try:
        db.add(doc)
        db.commit()
        db.refresh(doc)
    except Exception as e:
        # Cleanup stored file and preview if DB fails
        db.rollback()
        storage.delete(storage_key)
        if preview_key:
            storage.delete(preview_key)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist document to database."
        )

    return doc


def list_approved_documents(db: Session, module_id: uuid.UUID) -> list[Document]:
    """
    List all APPROVED documents for a given module, ordered by newest first.
    """
    return (
        db.query(Document)
        .filter(
            Document.module_id == module_id,
            Document.status == DocumentStatus.APPROVED
        )
        .order_by(Document.created_at.desc())
        .all()
    )


def get_approved_document(db: Session, module_id: uuid.UUID, document_id: str) -> Document:
    """
    Get a single APPROVED document by ID for a given module.
    """
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    doc = (
        db.query(Document)
        .filter(
            Document.id == doc_uuid,
            Document.module_id == module_id,
            Document.status == DocumentStatus.APPROVED
        )
        .first()
    )

    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    return doc


def get_document_download_info(doc: Document) -> tuple[str, str, str]:
    """
    Returns (physical_path, mime_type, safe_filename) for a document.
    Raises 404 if the physical file is missing from storage.
    """
    import os
    import re
    from app.core.storage.exceptions import ObjectNotFoundError

    try:
        file_path = storage.get_path(doc.storage_path)
    except ObjectNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The physical file for this document is missing."
        )

    # Determine mime type from extension
    ext = os.path.splitext(doc.storage_path)[1].lower()
    ext_to_mime = {v: k for k, v in ALLOWED_MIME_TYPES.items()}
    mime_type = ext_to_mime.get(ext, "application/octet-stream")

    # Sanitize title to prevent header injection or traversal in Content-Disposition
    # Keep only alphanumeric and a few safe characters
    safe_title = re.sub(r'[^a-zA-Z0-9_\-\s]', '', doc.title).strip()
    if not safe_title:
        safe_title = "document"
    safe_filename = f"{safe_title}{ext}"

    return file_path, mime_type, safe_filename


def get_document_preview_bytes(db: Session, document_id: str) -> bytes:
    """
    Retrieve the bytes of the generated preview image.
    Enforces visibility rules: only PENDING and APPROVED are allowed.
    Raises 404 if the document does not exist, is REJECTED, has no preview, or the physical file is missing.
    """
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    doc = (
        db.query(Document)
        .filter(Document.id == doc_uuid)
        .first()
    )

    # 1. Document must exist
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    # 2. Document must be PENDING or APPROVED. REJECTED is explicitly hidden.
    if doc.status == DocumentStatus.REJECTED:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found."
        )

    # 3. Document must have a preview_path assigned
    if not doc.preview_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No preview available for this document."
        )

    # 4. Read the bytes via StorageProvider
    from app.core.storage.exceptions import ObjectNotFoundError, StorageError
    try:
        return storage.read(doc.preview_path)
    except ObjectNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The preview file is missing from storage."
        )
    except StorageError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while retrieving the preview."
        )




from app.models.community import Community
from app.models.document_vote import DocumentVote
from app.models.user import User
from app.services.document_vote import check_full_document_access

def list_pending_student_documents(
    db: Session, 
    community_slug: str, 
    current_user: User
) -> list[dict]:
    """
    List PENDING STUDENT documents for a given community.
    Includes caller-specific state (votes, access) efficiently.
    """
    # Find the community first to ensure it exists
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )
        
    # Check membership for ACTIVE
    membership = db.query(Membership).filter(
        Membership.user_id == current_user.id,
        Membership.community_id == community.id,
        Membership.status == MembershipStatus.ACTIVE
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ACTIVE membership is required to view pending documents."
        )

    # Perform a joined query to fetch documents + user votes
    # Note: Outer join on DocumentVote specifically for the current user
    results = (
        db.query(Document, Module, DocumentVote)
        .join(Module, Document.module_id == Module.id)
        .outerjoin(
            DocumentVote,
            (DocumentVote.document_id == Document.id) &
            (DocumentVote.voter_id == current_user.id)
        )
        .filter(
            Module.community_id == community.id,
            Document.source == DocumentSource.STUDENT,
            Document.status == DocumentStatus.PENDING
        )
        .order_by(Document.created_at.asc(), Document.id.asc())
        .all()
    )

    response_list = []
    for doc, module, vote in results:
        is_uploader = (doc.uploader_id == current_user.id)
        user_vote_value = vote.vote if vote else None
        
        # Calculate can_vote natively
        can_vote = (not is_uploader) and (user_vote_value is None)
        
        # Share the exact access logic
        has_access = check_full_document_access(
            db=db,
            doc=doc,
            user=current_user,
            has_active_membership=True,
            user_vote=user_vote_value
        )
        
        response_list.append({
            "id": doc.id,
            "title": doc.title,
            "type": doc.type,
            "source": doc.source,
            "status": doc.status,
            "created_at": doc.created_at,
            "module_id": module.id,
            "module_slug": module.slug,
            "module_name": module.name,
            "is_uploader": is_uploader,
            "my_vote": user_vote_value,
            "can_vote": can_vote,
            "full_document_access": has_access
        })

    return response_list
