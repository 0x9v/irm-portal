"""Authenticated account avatar upload, removal and image delivery."""

from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException

from app.api.avatar_routes import (
    MAX_AVATAR_FILE_BYTES,
    AvatarMutationRoute,
    PrivateAvatarReadRoute,
)
from app.api.deps import get_current_user
from app.core.config import settings
from app.core.storage.local import LocalFileSystemStorage
from app.database.session import get_db
from app.models.user import User
from app.services.avatar import process_avatar_image, read_current_avatar, remove_user_avatar, replace_user_avatar


router = APIRouter()
logger = logging.getLogger(__name__)


def get_avatar_storage() -> LocalFileSystemStorage:
    return LocalFileSystemStorage(settings.storage_root)


async def upload_own_avatar(
    request: Request,
    current_user: User = Depends(get_current_user),
    storage: LocalFileSystemStorage = Depends(get_avatar_storage),
):
    form = None
    try:
        try:
            form = await request.form(max_files=2, max_fields=1, max_part_size=MAX_AVATAR_FILE_BYTES + 1)
        except MultiPartException as error:
            # Parser bounds deliberately allow only enough parts to identify a
            # duplicate/extra request and reject it without unbounded spooling.
            message = str(error)
            if message.startswith("Too many files") or message.startswith("Too many fields"):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid avatar upload parts") from None
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Malformed multipart request") from None

        items = form.multi_items()
        if len(items) != 1 or items[0][0] != "file" or not isinstance(items[0][1], UploadFile):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid avatar upload parts")
        upload = items[0][1]
        declared_types = upload.headers.getlist("content-type")
        if len(declared_types) != 1 or not declared_types[0]:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported avatar input media type")
        declared_type = declared_types[0].split(";", 1)[0].strip().lower()
        if declared_type not in {"image/jpeg", "image/png"}:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported avatar input media type")

        raw_image = await upload.read(MAX_AVATAR_FILE_BYTES + 1)
        if len(raw_image) > MAX_AVATAR_FILE_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Avatar file size limit exceeded")
        canonical_jpeg = await run_in_threadpool(process_avatar_image, raw_image, declared_type)
        token = request.cookies.get(settings.session_cookie_name)
        if not token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
        avatar_url = await run_in_threadpool(
            replace_user_avatar, current_user.id, token, canonical_jpeg, storage
        )
        return {"avatar_url": avatar_url}
    finally:
        if form is not None:
            try:
                await form.close()
            except Exception:
                # Do not turn an already committed mutation into an apparent
                # failure because temporary upload cleanup itself failed.
                logger.error("avatar_upload_temporary_file_close_failed")


async def remove_own_avatar(
    request: Request,
    current_user: User = Depends(get_current_user),
    storage: LocalFileSystemStorage = Depends(get_avatar_storage),
):
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    await run_in_threadpool(remove_user_avatar, current_user.id, token, storage)
    return {"avatar_url": None}


def read_avatar_image(
    user_id: str,
    version: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: LocalFileSystemStorage = Depends(get_avatar_storage),
):
    try:
        owner_uuid = UUID(user_id)
        version_uuid = UUID(version)
        if str(owner_uuid) != user_id or str(version_uuid) != version:
            raise ValueError("Noncanonical UUID path")
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Avatar not found") from None

    content = read_current_avatar(db, owner_uuid, version_uuid, storage)
    return Response(
        content=content,
        media_type="image/jpeg",
        headers={"Content-Disposition": "inline"},
    )


router.add_api_route(
    "/auth/me/avatar",
    upload_own_avatar,
    methods=["PUT"],
    status_code=status.HTTP_200_OK,
    summary="Upload or replace the authenticated account avatar",
    route_class_override=AvatarMutationRoute,
)
router.add_api_route(
    "/auth/me/avatar",
    remove_own_avatar,
    methods=["DELETE"],
    status_code=status.HTTP_200_OK,
    summary="Remove the authenticated account avatar",
    route_class_override=AvatarMutationRoute,
)
router.add_api_route(
    "/users/{user_id}/avatar/{version}",
    read_avatar_image,
    methods=["GET"],
    summary="Read a current account avatar",
    route_class_override=PrivateAvatarReadRoute,
)
