import json
from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException

from app.api.content_route import PrivateContentRoute
from app.api.post_reply_routes import (
    PostReplyMutationRoute,
    PostReplyPrivateMediaRoute,
)
from app.api.deps import get_current_active_membership, require_community_delegate
from app.services.content_removal import remove_content
from app.database.session import get_db
from app.models.membership import Membership
from app.core.config import settings
from app.core.post_reply_images import (
    MAX_REPLY_IMAGE_UPLOAD_BYTES,
    PostReplyImageError,
    process_post_reply_image,
)
from app.core.storage.local import LocalFileSystemStorage
from app.services.post_reply_images import create_image_reply, read_private_reply_image
from app.schemas.community_post import (
    CommunityPostCreate,
    CommunityPostDetailResponse,
    CommunityPostFeedResponse,
    CommunityPostReplyCreate,
    CommunityPostReplyListResponse,
    CommunityPostReplyResponse,
)
from app.services.community_post import (
    create_community_post,
    create_community_post_reply,
    get_community_post_detail,
    list_community_post_replies,
    list_community_posts,
)

router = APIRouter(route_class=PrivateContentRoute)
logger = logging.getLogger(__name__)


def _json_object_without_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def get_post_reply_image_storage() -> LocalFileSystemStorage:
    return LocalFileSystemStorage(settings.storage_root)


@router.delete("/{community_slug}/posts/{post_id}", status_code=204)
def remove_post(
    community_slug: str, post_id: UUID,
    membership: Membership = Depends(require_community_delegate), db: Session = Depends(get_db),
) -> Response:
    remove_content(db, membership.community_id, membership.user_id, "community_post", post_id)
    return Response(status_code=204, headers={"Cache-Control": "private, no-store"})


@router.delete("/{community_slug}/posts/{post_id}/replies/{reply_id}", status_code=204)
def remove_post_reply(
    community_slug: str, post_id: UUID, reply_id: UUID,
    membership: Membership = Depends(require_community_delegate), db: Session = Depends(get_db),
) -> Response:
    remove_content(db, membership.community_id, membership.user_id, "community_post_reply", reply_id, post_id)
    return Response(status_code=204, headers={"Cache-Control": "private, no-store"})


@router.post(
    "/{community_slug}/posts",
    response_model=CommunityPostDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new community post",
)
def create_post(
    community_slug: str,
    post_in: CommunityPostCreate,
    response: Response,
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
):
    """
    Create a new post in the specified community with optional module tags.
    Requires an active membership in the community (MEMBER, MODERATOR, or DELEGATE).
    """
    response.headers["Cache-Control"] = "private, no-store"
    return create_community_post(
        db=db,
        community_slug=community_slug,
        author_id=membership.user_id,
        post_in=post_in,
    )


@router.get(
    "/{community_slug}/posts",
    response_model=CommunityPostFeedResponse,
    status_code=status.HTTP_200_OK,
    summary="List community posts feed",
)
def list_posts(
    community_slug: str,
    response: Response,
    limit: int = Query(20, ge=1, le=50, description="Number of posts to return"),
    after: UUID | None = Query(None, description="Optional cursor (post ID) to return posts after"),
    module_id: UUID | None = Query(None, description="Optional module ID to filter posts"),
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
):
    """
    List posts in a community ordered newest first.
    Requires an active membership in the community.
    Supports cursor pagination and module filtering.
    """
    response.headers["Cache-Control"] = "private, no-store"
    items, next_cursor = list_community_posts(
        db=db,
        community_slug=community_slug,
        limit=limit,
        after=after,
        module_id=module_id,
    )
    return CommunityPostFeedResponse(items=items, next_cursor=next_cursor)


@router.get(
    "/{community_slug}/posts/{post_id}",
    response_model=CommunityPostDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Get community post detail",
)
def get_post(
    community_slug: str,
    post_id: UUID,
    response: Response,
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
):
    """
    Retrieve community post detail.
    Requires an active membership in the community.
    Safely scopes lookup to both post ID and community ID.
    """
    response.headers["Cache-Control"] = "private, no-store"
    return get_community_post_detail(
        db=db,
        community_slug=community_slug,
        post_id=post_id,
    )


async def create_post_reply(
    community_slug: str,
    post_id: UUID,
    request: Request,
    response: Response,
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
    storage: LocalFileSystemStorage = Depends(get_post_reply_image_storage),
):
    """
    Create a new reply to a community post.
    Requires an active membership in the community.
    """
    response.headers["Cache-Control"] = "private, no-store"
    content_type_values = request.headers.getlist("content-type")
    if len(content_type_values) != 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Content-Type")
    media_type = content_type_values[0].split(";", 1)[0].strip().lower()
    if media_type == "application/json":
        try:
            body = json.loads(await request.body(), object_pairs_hook=_json_object_without_duplicates)
            reply_in = CommunityPostReplyCreate.model_validate(body)
        except Exception as error:
            if isinstance(error, HTTPException):
                raise
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid reply request") from None
        return await run_in_threadpool(
            create_community_post_reply,
            db=db, community_slug=community_slug, post_id=post_id,
            author_id=membership.user_id, reply_in=reply_in,
        )
    if media_type != "multipart/form-data":
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported request media type")

    form = None
    try:
        try:
            form = await request.form(max_files=2, max_fields=3, max_part_size=8193)
        except MultiPartException:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid reply upload parts") from None
        items = form.multi_items()
        names = [name for name, _ in items]
        if (len(items) > 3 or len(names) != len(set(names))
                or any(name not in {"client_request_id", "content", "image"} for name in names)):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid reply upload parts")
        values = dict(items)
        request_id_raw = values.get("client_request_id")
        if not isinstance(request_id_raw, str):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid client request ID")
        try:
            request_id = UUID(request_id_raw)
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid client request ID") from None
        if str(request_id) != request_id_raw or request_id.version != 4:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid client request ID")
        raw_content = values.get("content", "")
        if not isinstance(raw_content, str):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid reply content")
        if len(raw_content.encode("utf-8")) > 8192:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Reply text limit exceeded")
        content = raw_content.strip()
        if len(content) > 2000:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Reply text limit exceeded")
        upload = values.get("image")
        if upload is not None and not isinstance(upload, UploadFile):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid reply image")
        if not content and upload is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Reply text or image is required")
        declared_mime = ""
        raw_image = None
        canonical_image = None
        if upload is not None:
            declared_values = upload.headers.getlist("content-type")
            if len(declared_values) != 1 or not declared_values[0]:
                raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported reply image type")
            declared_mime = declared_values[0].split(";", 1)[0].strip().lower()
            if declared_mime not in {"image/jpeg", "image/png"}:
                raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported reply image type")
            raw_image = await upload.read(MAX_REPLY_IMAGE_UPLOAD_BYTES + 1)
            if len(raw_image) > MAX_REPLY_IMAGE_UPLOAD_BYTES:
                raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Reply image limit exceeded")
            try:
                canonical_image = await run_in_threadpool(process_post_reply_image, raw_image, declared_mime)
            except PostReplyImageError as error:
                if error.code == "input_too_large":
                    raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Reply image limit exceeded") from None
                if error.code == "unsupported_media_type":
                    raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported reply image type") from None
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid reply image") from None
        reply, replay = await run_in_threadpool(
            create_image_reply,
            db=db, community_slug=community_slug, post_id=post_id,
            author_id=membership.user_id, client_request_id=request_id,
            content=content, declared_mime=declared_mime,
            raw_image=raw_image, canonical_image=canonical_image, storage=storage,
        )
        if replay:
            response.status_code = status.HTTP_200_OK
        return reply
    finally:
        if form is not None:
            try:
                await form.close()
            except Exception:
                logger.error("post_reply_upload_temporary_file_close_failed")


router.add_api_route(
    "/{community_slug}/posts/{post_id}/replies",
    create_post_reply,
    methods=["POST"],
    response_model=CommunityPostReplyResponse,
    status_code=status.HTTP_201_CREATED,
    route_class_override=PostReplyMutationRoute,
    summary="Create a reply to a community post",
)


async def read_post_reply_image(
    community_slug: str,
    post_id: UUID,
    reply_id: UUID,
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
    storage: LocalFileSystemStorage = Depends(get_post_reply_image_storage),
):
    content = await run_in_threadpool(
        read_private_reply_image,
        db=db, community_slug=community_slug, post_id=post_id, reply_id=reply_id,
        caller_user_id=membership.user_id, storage=storage,
    )
    return Response(
        content=content,
        media_type="image/jpeg",
        headers={"Content-Disposition": "inline"},
    )


router.add_api_route(
    "/{community_slug}/posts/{post_id}/replies/{reply_id}/image",
    read_post_reply_image,
    methods=["GET"],
    route_class_override=PostReplyPrivateMediaRoute,
    summary="Read a private community post reply image",
)


@router.get(
    "/{community_slug}/posts/{post_id}/replies",
    response_model=CommunityPostReplyListResponse,
    status_code=status.HTTP_200_OK,
    summary="List replies to a community post",
)
def list_post_replies(
    community_slug: str,
    post_id: UUID,
    response: Response,
    limit: int = Query(20, ge=1, le=50, description="Number of replies to return"),
    after: UUID | None = Query(None, description="Optional cursor (reply ID) to return replies after"),
    membership: Membership = Depends(get_current_active_membership),
    db: Session = Depends(get_db),
):
    """
    List replies to a community post, ordered oldest first.
    Requires an active membership in the community.
    Supports cursor pagination.
    """
    response.headers["Cache-Control"] = "private, no-store"
    items, next_cursor = list_community_post_replies(
        db=db,
        community_slug=community_slug,
        post_id=post_id,
        limit=limit,
        after=after,
    )
    return CommunityPostReplyListResponse(items=items, next_cursor=next_cursor)
