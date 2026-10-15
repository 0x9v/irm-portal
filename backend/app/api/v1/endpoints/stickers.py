"""Authenticated owner-only sticker library API."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException

from app.api.deps import get_current_user
from app.api.sticker_routes import (
    MAX_STICKER_FILE_BYTES,
    StickerMutationRoute,
    StickerPrivateReadRoute,
)
from app.core.config import settings
from app.core.stickers import StickerImageError, process_sticker_image
from app.core.storage.exceptions import StickerStorageError
from app.core.storage.local import LocalFileSystemStorage
from app.database.session import get_db
from app.models.user import User
from app.services.sticker_library import (
    DEFAULT_STICKER_PAGE_SIZE,
    MAX_STICKER_PAGE_SIZE,
    create_user_sticker,
    list_user_stickers,
    read_user_sticker,
    remove_user_sticker,
)


router = APIRouter()
logger = logging.getLogger(__name__)


def get_sticker_storage() -> LocalFileSystemStorage:
    return LocalFileSystemStorage(settings.storage_root)


def _canonical_uuid(value: str) -> UUID:
    try:
        parsed = UUID(value)
        if str(parsed) != value:
            raise ValueError
        return parsed
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sticker not found") from None


async def upload_sticker(
    request: Request,
    current_user: User = Depends(get_current_user),
    storage: LocalFileSystemStorage = Depends(get_sticker_storage),
):
    form = None
    try:
        try:
            form = await request.form(max_files=2, max_fields=1, max_part_size=MAX_STICKER_FILE_BYTES + 1)
        except MultiPartException as error:
            message = str(error)
            if message.startswith("Too many files") or message.startswith("Too many fields"):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid sticker upload parts") from None
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Malformed multipart request") from None
        items = form.multi_items()
        if len(items) != 1 or items[0][0] != "file" or not isinstance(items[0][1], UploadFile):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid sticker upload parts")
        upload = items[0][1]
        declared_types = upload.headers.getlist("content-type")
        if len(declared_types) != 1 or not declared_types[0]:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported sticker input media type")
        declared_type = declared_types[0].split(";", 1)[0].strip().lower()
        if declared_type not in {"image/jpeg", "image/png"}:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported sticker input media type")
        raw_image = await upload.read(MAX_STICKER_FILE_BYTES + 1)
        if len(raw_image) > MAX_STICKER_FILE_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Sticker file size limit exceeded")
        try:
            canonical = await run_in_threadpool(process_sticker_image, raw_image, declared_type)
        except StickerImageError as error:
            if error.outcome == "input_too_large":
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Sticker file size limit exceeded") from None
            if error.outcome == "unsupported_media_type":
                raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported sticker input media type") from None
            if error.outcome == "webp_encoder_unavailable":
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Sticker processing unavailable") from None
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid sticker image") from None
        token = request.cookies.get(settings.session_cookie_name)
        if not token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
        try:
            result = await run_in_threadpool(
                create_user_sticker, current_user.id, token, canonical, storage
            )
        except StickerStorageError:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Sticker upload failed") from None
        return result
    finally:
        if form is not None:
            try:
                await form.close()
            except Exception:
                try:
                    logger.error("sticker_upload_temporary_file_close_failed")
                except Exception:
                    pass


def list_stickers(
    request: Request,
    limit: int = Query(DEFAULT_STICKER_PAGE_SIZE, ge=1, le=MAX_STICKER_PAGE_SIZE),
    before: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if before is not None and len(before) != 64:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "invalid_sticker_cursor"})
    raw_token = request.cookies.get(settings.session_cookie_name)
    if not raw_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return list_user_stickers(db, current_user.id, raw_token, limit, before)


async def remove_sticker(
    asset_id: str,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
):
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    await run_in_threadpool(remove_user_sticker, current_user.id, token, _canonical_uuid(asset_id))
    response.status_code = status.HTTP_204_NO_CONTENT
    response.headers["Cache-Control"] = "private, no-store"
    return response


def read_sticker_preview(
    asset_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: LocalFileSystemStorage = Depends(get_sticker_storage),
):
    content = read_user_sticker(db, current_user.id, _canonical_uuid(asset_id), storage)
    return Response(
        content=content,
        media_type="image/webp",
        headers={"Content-Disposition": "inline"},
    )


router.add_api_route(
    "/auth/me/stickers", upload_sticker, methods=["POST"], status_code=status.HTTP_201_CREATED,
    route_class_override=StickerMutationRoute, summary="Upload a private sticker",
)
router.add_api_route(
    "/auth/me/stickers", list_stickers, methods=["GET"],
    route_class_override=StickerPrivateReadRoute, summary="List private stickers",
)
router.add_api_route(
    "/auth/me/stickers/{asset_id}", remove_sticker, methods=["DELETE"],
    route_class_override=StickerMutationRoute, summary="Remove a sticker from the private library",
)
router.add_api_route(
    "/auth/me/stickers/{asset_id}/image", read_sticker_preview, methods=["GET"],
    route_class_override=StickerPrivateReadRoute, summary="Read a private sticker preview",
)
