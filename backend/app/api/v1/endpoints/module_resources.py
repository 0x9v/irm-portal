"""Additive typed module-resource API; Document remains the review identity."""

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException

from app.api.deps import get_current_active_membership, get_current_user
from app.api.module_resource_routes import ModuleResourceMutationRoute
from app.core.config import settings
from app.core.module_resources import (
    MAX_RESOURCE_IMAGE_UPLOAD_BYTES,
    ModuleResourceInputError,
    process_module_resource_image,
)
from app.database.session import get_db
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType, ResourceKind
from app.models.membership import Membership, MembershipRole
from app.models.module import Module
from app.models.user import User
from app.schemas.module_resource import (
    LinkResourceCreate,
    ModuleResourceFeedResponse,
    PendingResourceFeedResponse,
    PendingResourceResponse,
    PendingPdfResourceResponse,
    PendingImageResourceResponse,
    PendingYoutubeResourceResponse,
    PendingLinkResourceResponse,
    MyResourceFeedResponse,
    MyPdfResourceResponse,
    MyImageResourceResponse,
    MyYoutubeResourceResponse,
    MyLinkResourceResponse,
    ResourceApprovalResponse,
    ResourceVoteResponse,
    PdfResourceResponse,
    ImageResourceResponse,
    LinkResourceResponse,
    ResourceFileMetadata,
    ResourceResponse,
    YoutubeResourceCreate,
    YoutubeResourceResponse,
)
from app.services.module import get_community_module
from app.services.module_resource import create_image_resource, create_url_resource, list_approved_resources, read_resource_preview
from app.services.module_resource import approve_pending_resource, cast_resource_vote, list_pending_resources
from app.services.module_resource import can_remove_resource, list_my_resources, remove_resource
from app.services.document import upload_document
from app.schemas.document_vote import DocumentVoteCreate


router = APIRouter(route_class=ModuleResourceMutationRoute)
PRIVATE_HEADERS = {"Cache-Control": "private, no-store"}


def _resource_response(doc: Document, community_slug: str) -> ResourceResponse:
    common = dict(
        id=doc.id, module_id=doc.module_id, kind=doc.resource_kind, category=doc.type,
        title=doc.title, description=doc.description, source=doc.source,
        status=doc.status, created_at=doc.created_at, updated_at=doc.updated_at,
    )
    if doc.resource_kind == ResourceKind.PDF:
        return PdfResourceResponse(**common, document_type=doc.type)
    if doc.resource_kind == ResourceKind.IMAGE:
        return ImageResourceResponse(
            **common,
            preview_url=f"/api/v1/communities/{community_slug}/resources/{doc.id}/preview",
        )
    if doc.resource_kind == ResourceKind.YOUTUBE:
        return YoutubeResourceResponse(
            **common, video_id=doc.youtube_video_id,
            url=f"https://www.youtube.com/watch?v={doc.youtube_video_id}",
        )
    if doc.resource_kind == ResourceKind.LINK:
        return LinkResourceResponse(**common, url=doc.external_url)
    raise HTTPException(status_code=500, detail="Resource data is invalid")


def _pending_resource_response(doc: Document, module: Module, vote,
                               membership: Membership, community_slug: str) -> PendingResourceResponse:
    base = _resource_response(doc, community_slug).model_dump()
    preview_url = f"/api/v1/communities/{community_slug}/resources/{doc.id}/preview"
    state = dict(
        module_slug=module.slug, module_name=module.name,
        is_uploader=doc.uploader_id == membership.user_id,
        my_vote=vote.vote if vote is not None else None,
        can_vote=doc.uploader_id != membership.user_id and vote is None,
        can_approve=membership.role in (MembershipRole.MODERATOR, MembershipRole.DELEGATE),
        can_delete=can_remove_resource(doc, membership),
        full_resource_access=(doc.resource_kind != ResourceKind.PDF
                              or vote is not None and vote.vote.value == "YES"),
    )
    if doc.resource_kind == ResourceKind.PDF:
        return PendingPdfResourceResponse(**base, **state, preview={"url": preview_url, "media_type": "image/png"})
    if doc.resource_kind == ResourceKind.IMAGE:
        media_type = "image/webp" if doc.image_storage_key else "image/png"
        return PendingImageResourceResponse(**base, **state, preview={"url": preview_url, "media_type": media_type})
    if doc.resource_kind == ResourceKind.YOUTUBE:
        return PendingYoutubeResourceResponse(**base, **state, preview={"url": base["url"]})
    if doc.resource_kind == ResourceKind.LINK:
        return PendingLinkResourceResponse(**base, **state, preview={"url": base["url"]})
    raise HTTPException(status_code=500, detail="Resource data is invalid")


def _my_resource_response(doc: Document, module: Module, community_slug: str,
                          membership: Membership):
    base = _resource_response(doc, community_slug).model_dump()
    state = dict(module_slug=module.slug, module_name=module.name,
                 can_delete=can_remove_resource(doc, membership))
    if doc.resource_kind == ResourceKind.PDF:
        return MyPdfResourceResponse(**base, **state)
    if doc.resource_kind == ResourceKind.IMAGE:
        return MyImageResourceResponse(**base, **state)
    if doc.resource_kind == ResourceKind.YOUTUBE:
        return MyYoutubeResourceResponse(**base, **state)
    if doc.resource_kind == ResourceKind.LINK:
        return MyLinkResourceResponse(**base, **state)
    raise HTTPException(status_code=500, detail="Resource data is invalid")


def _parse_source(value: str | None) -> DocumentSource | None:
    if value is None:
        return None
    try:
        return DocumentSource(value)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid resource source") from None


def _field_values(items):
    data = {}
    files = []
    allowed = {"kind", "title", "description", "source", "type", "file"}
    for key, value in items:
        if key not in allowed:
            raise HTTPException(status_code=422, detail="Unexpected resource upload field")
        if isinstance(value, UploadFile):
            if key != "file":
                raise HTTPException(status_code=422, detail="Unexpected resource upload field")
            files.append(value)
            continue
        if key == "file" or key in data or not isinstance(value, str):
            raise HTTPException(status_code=422, detail="Invalid resource upload fields")
        data[key] = value
    return data, files


@router.post(
    "/{community_slug}/modules/{module_slug}/resources",
    response_model=ResourceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a typed module learning resource",
)
async def create_module_resource(
    community_slug: str,
    module_slug: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
):
    module = get_community_module(db, community_slug, module_slug)
    if module is None:
        raise HTTPException(status_code=404, detail="Module not found")

    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type == "application/json":
        try:
            payload = await request.json()
            kind = ResourceKind(payload.get("kind"))
            if kind == ResourceKind.YOUTUBE:
                create_data = YoutubeResourceCreate.model_validate(payload)
            elif kind == ResourceKind.LINK:
                create_data = LinkResourceCreate.model_validate(payload)
            else:
                raise HTTPException(status_code=422, detail="File resources require multipart upload")
        except HTTPException:
            raise
        except (ValidationError, ValueError, AttributeError):
            raise HTTPException(status_code=422, detail="Invalid URL resource fields") from None
        try:
            doc = await run_in_threadpool(
                create_url_resource, db, module, current_user.id, membership,
                kind=create_data.kind, title=create_data.title,
                description=create_data.description, url=create_data.url,
                requested_source=create_data.source, category=create_data.type,
                raw_token=request.cookies.get(settings.session_cookie_name),
            )
        except ModuleResourceInputError:
            raise HTTPException(status_code=422, detail="Invalid resource URL") from None
        return _resource_response(doc, community_slug)

    if content_type != "multipart/form-data":
        raise HTTPException(status_code=415, detail="Unsupported resource request media type")

    form = None
    try:
        try:
            form = await request.form(max_files=2, max_fields=8, max_part_size=16 * 1024)
        except MultiPartException as error:
            message = str(error)
            if message.startswith("Too many files") or message.startswith("Too many fields"):
                raise HTTPException(status_code=422, detail="Invalid resource upload fields") from None
            raise HTTPException(status_code=400, detail="Malformed resource upload") from None

        data, files = _field_values(form.multi_items())
        try:
            metadata = ResourceFileMetadata.model_validate(data)
        except ValidationError:
            raise HTTPException(status_code=422, detail="Invalid resource upload fields") from None
        if len(files) != 1:
            raise HTTPException(status_code=422, detail="Exactly one resource file is required")
        file = files[0]
        if metadata.kind not in (ResourceKind.PDF, ResourceKind.IMAGE):
            raise HTTPException(status_code=422, detail="URL resources do not accept files")
        declared_types = file.headers.getlist("content-type")
        if len(declared_types) != 1 or not declared_types[0]:
            raise HTTPException(status_code=415, detail="Unsupported resource file type")
        declared_type = declared_types[0].split(";", 1)[0].strip().lower()

        if metadata.kind == ResourceKind.PDF:
            if declared_type != "application/pdf":
                raise HTTPException(status_code=415, detail="PDF resources require a PDF file")
            if metadata.type is None:
                raise HTTPException(status_code=422, detail="PDF type is required")
            max_bytes = settings.document_upload_max_bytes
            content = await file.read(max_bytes + 1)
            if len(content) > max_bytes:
                raise HTTPException(status_code=413, detail="Resource file size limit exceeded")
            await file.seek(0)
            doc = await run_in_threadpool(
                upload_document, db, module, current_user.id, membership, file,
                metadata.title, metadata.type, metadata.source, metadata.description,
                request.cookies.get(settings.session_cookie_name),
            )
        else:
            if declared_type not in ("image/jpeg", "image/png"):
                raise HTTPException(status_code=415, detail="Image resources accept JPEG or PNG")
            raw_image = await file.read(MAX_RESOURCE_IMAGE_UPLOAD_BYTES + 1)
            if len(raw_image) > MAX_RESOURCE_IMAGE_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="Resource image size limit exceeded")
            try:
                canonical = await run_in_threadpool(process_module_resource_image, raw_image, declared_type)
            except ModuleResourceInputError as error:
                if error.outcome in ("input_too_large", "output_too_large"):
                    raise HTTPException(status_code=413, detail="Resource image size limit exceeded") from None
                if error.outcome in ("webp_encoder_unavailable", "image_processing_failed"):
                    raise HTTPException(status_code=500, detail="Image processing unavailable") from None
                raise HTTPException(status_code=422, detail="Invalid resource image") from None
            doc = await run_in_threadpool(
                create_image_resource, db, module, current_user, membership,
                title=metadata.title, description=metadata.description,
                requested_source=metadata.source, canonical_image=canonical,
                category=metadata.type, raw_token=request.cookies.get(settings.session_cookie_name),
            )
        return _resource_response(doc, community_slug)
    finally:
        if form is not None:
            try:
                await form.close()
            except Exception:
                pass


@router.get(
    "/{community_slug}/modules/{module_slug}/resources",
    response_model=ModuleResourceFeedResponse,
    summary="List approved resources for a module",
)
def list_module_resources(
    community_slug: str,
    module_slug: str,
    response: Response,
    kind: ResourceKind | None = None,
    category: DocumentType | None = None,
    q: str | None = Query(None, max_length=100),
    source: DocumentSource | None = None,
    limit: int = Query(20, ge=1, le=50),
    after: UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    module = get_community_module(db, community_slug, module_slug)
    if module is None:
        raise HTTPException(status_code=404, detail="Module not found")
    query = q.strip() if q is not None else None
    if query and len(query) > 100:
        raise HTTPException(status_code=422, detail="Search query must be at most 100 characters")
    documents, cursor = list_approved_resources(
        db, module, kind=kind, category=category, title_query=query or None,
        source=source, limit=limit, after=after,
    )
    response.headers.update(PRIVATE_HEADERS)
    return ModuleResourceFeedResponse(
        items=[_resource_response(doc, community_slug) for doc in documents],
        next_cursor=cursor,
    )


@router.get(
    "/{community_slug}/resources/pending",
    response_model=PendingResourceFeedResponse,
    summary="List pending student resources in the active community",
)
def pending_module_resources(
    community_slug: str,
    response: Response,
    limit: int = Query(20, ge=1, le=50),
    after: UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows, cursor, membership = list_pending_resources(
        db, community_slug, current_user.id, limit=limit, after=after,
    )
    response.headers.update(PRIVATE_HEADERS)
    return PendingResourceFeedResponse(
        items=[_pending_resource_response(doc, module, vote, membership, community_slug)
               for doc, module, vote in rows],
        next_cursor=cursor,
    )


@router.get(
    "/{community_slug}/resources/mine",
    response_model=MyResourceFeedResponse,
    summary="List the current member's typed resource submissions",
)
def my_module_resources(
    community_slug: str,
    response: Response,
    limit: int = Query(20, ge=1, le=50),
    after: UUID | None = None,
    status_filter: DocumentStatus | None = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
):
    rows, cursor = list_my_resources(
        db, membership.community_id, current_user.id,
        status_filter=status_filter, limit=limit, after=after,
    )
    response.headers.update(PRIVATE_HEADERS)
    return MyResourceFeedResponse(
        items=[_my_resource_response(doc, module, community_slug, membership) for doc, module in rows],
        next_cursor=cursor,
    )


@router.delete(
    "/{community_slug}/resources/{resource_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft remove an unapproved resource under the current community policy",
)
async def delete_resource(
    community_slug: str,
    resource_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if await request.body():
        raise HTTPException(status_code=422, detail="Resource removal takes no body")
    await run_in_threadpool(remove_resource, db, community_slug, resource_id,
                            current_user.id, request.cookies.get(settings.session_cookie_name))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{community_slug}/resources/{resource_id}/vote",
    response_model=ResourceVoteResponse,
    summary="Cast one immutable vote on a pending student resource",
)
def vote_on_resource(
    community_slug: str,
    resource_id: UUID,
    vote_in: DocumentVoteCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    access = cast_resource_vote(db, community_slug, resource_id, current_user.id, vote_in.vote)
    return ResourceVoteResponse(vote=vote_in.vote, full_resource_access=access)


@router.post(
    "/{community_slug}/resources/{resource_id}/approve",
    response_model=ResourceApprovalResponse,
    summary="Immediately approve a pending student resource as community staff",
)
async def approve_resource(
    community_slug: str,
    resource_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # An explicit empty JSON object makes unexpected action parameters fail closed.
    try:
        if await request.json() != {}:
            raise ValueError
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=422, detail="Invalid approval body") from None
    await run_in_threadpool(approve_pending_resource, db, community_slug, resource_id, current_user.id)
    return ResourceApprovalResponse(id=resource_id, status=DocumentStatus.APPROVED)


@router.get(
    "/{community_slug}/resources/{resource_id}/preview",
    summary="Preview an approved or community-pending resource",
)
def resource_preview(
    community_slug: str,
    resource_id: UUID,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document, payload, media_type = read_resource_preview(
        db, community_slug, resource_id, current_user.id,
    )
    headers = {**PRIVATE_HEADERS, "Vary": "Cookie", "X-Content-Type-Options": "nosniff"}
    if isinstance(payload, dict):
        return JSONResponse(payload, media_type=media_type, headers=headers)
    response.headers.update(headers)
    return Response(content=payload, media_type=media_type, headers=headers)


