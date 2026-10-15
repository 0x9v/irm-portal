"""Account avatar image processing and transactional pointer mutations."""

from io import BytesIO
import logging
import warnings
from uuid import UUID

from fastapi import HTTPException, status
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.core.avatars import (
    MAX_STORED_AVATAR_BYTES,
    InvalidAvatarStorageKey,
    avatar_url_from_storage_key,
    delete_avatar,
    parse_avatar_storage_key,
    read_avatar,
    store_avatar_jpeg,
)
from app.core.sessions import validate_session
from app.core.storage.exceptions import AvatarStorageError
from app.database.session import SessionLocal
from app.models.user import User


logger = logging.getLogger(__name__)
MAX_AVATAR_UPLOAD_BYTES = 2_097_152
MAX_AVATAR_DIMENSION = 4096
MIN_AVATAR_DIMENSION = 32
MAX_AVATAR_PIXELS = 16_000_000
AVATAR_SIZE = (256, 256)
_DECLARED_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG"}


def _invalid_image() -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid avatar image")


def process_avatar_image(data: bytes, declared_media_type: str) -> bytes:
    """Decode and canonicalize one static JPEG/PNG without retaining metadata."""
    media_type = declared_media_type.split(";", 1)[0].strip().lower()
    expected_format = _DECLARED_FORMATS.get(media_type)
    if expected_format is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported avatar input media type")
    if not data or len(data) > MAX_AVATAR_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Avatar file size limit exceeded")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as probe:
                detected_format = probe.format
                if detected_format != expected_format:
                    raise _invalid_image()
                _validate_dimensions(probe.size)
                if getattr(probe, "n_frames", 1) != 1 or getattr(probe, "is_animated", False):
                    raise _invalid_image()
                probe.verify()

            with Image.open(BytesIO(data)) as source:
                if source.format != expected_format:
                    raise _invalid_image()
                _validate_dimensions(source.size)
                if getattr(source, "n_frames", 1) != 1 or getattr(source, "is_animated", False):
                    raise _invalid_image()
                source.load()
                oriented = ImageOps.exif_transpose(source)
                _validate_dimensions(oriented.size)
                width, height = oriented.size
                side = min(width, height)
                left = (width - side) // 2
                top = (height - side) // 2
                square = oriented.crop((left, top, left + side, top + side))

                # Composite all source modes onto fresh white-backed RGB pixels;
                # no source info/exif/ICC/comment dictionary is copied forward.
                rgba = square.convert("RGBA")
                white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
                white.alpha_composite(rgba)
                rgb = white.convert("RGB")
                resized = rgb.resize(AVATAR_SIZE, Image.Resampling.LANCZOS)
                canonical = Image.new("RGB", AVATAR_SIZE, (255, 255, 255))
                canonical.paste(resized)
                output = BytesIO()
                canonical.save(output, format="JPEG", quality=85)
                encoded = output.getvalue()
    except HTTPException:
        raise
    except (Image.DecompressionBombWarning, Image.DecompressionBombError, UnidentifiedImageError,
            OSError, ValueError, SyntaxError, EOFError) as error:
        raise _invalid_image() from error
    except Exception as error:
        # Decoder/plugin failures are all treated as invalid user image data;
        # the response never contains exception text or source bytes.
        raise _invalid_image() from error

    if len(encoded) > MAX_STORED_AVATAR_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Canonical avatar size limit exceeded")
    return encoded


def _validate_dimensions(size: tuple[int, int]) -> None:
    width, height = size
    if (width < MIN_AVATAR_DIMENSION or height < MIN_AVATAR_DIMENSION
            or width > MAX_AVATAR_DIMENSION or height > MAX_AVATAR_DIMENSION
            or width * height > MAX_AVATAR_PIXELS):
        raise _invalid_image()


def _lock_account_and_session(db: Session, user_id: UUID, raw_token: str) -> User:
    user = (
        db.query(User).filter(User.id == user_id)
        .populate_existing().with_for_update().one_or_none()
    )
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    session = validate_session(db, raw_token, refresh=True, lock=True)
    if session is None or session.user_id != user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user


def _log_cleanup_failure(user_id: UUID, phase: str, error: Exception) -> None:
    outcome = getattr(error, "outcome", "unexpected")
    logger.error(
        "avatar_cleanup_failed phase=%s user_id=%s outcome=%s; no automatic retry is configured",
        phase,
        user_id,
        outcome,
    )


def _delete_owned_file(storage, user_id: UUID, key: str | None, phase: str) -> None:
    if not key:
        return
    try:
        delete_avatar(storage, user_id, key)
    except Exception as error:
        _log_cleanup_failure(user_id, phase, error)


def _resolve_commit_after_error(db: Session, user_id: UUID, expected_key: str | None) -> bool | None:
    """Return committed/not-committed, or None when database outcome is unknown."""
    try:
        db.rollback()
        current_key = db.query(User.avatar_storage_key).filter(User.id == user_id).scalar()
    except Exception:
        return None
    return current_key == expected_key


def replace_user_avatar(user_id: UUID, raw_token: str, canonical_jpeg: bytes, storage) -> str:
    """Save a new immutable file and atomically move the account pointer."""
    db = SessionLocal()
    new_key: str | None = None
    old_key: str | None = None
    commit_attempted = False
    committed = False
    try:
        user = _lock_account_and_session(db, user_id, raw_token)
        old_key = user.avatar_storage_key
        try:
            new_key = store_avatar_jpeg(storage, user_id, canonical_jpeg)
        except AvatarStorageError as error:
            new_key = error.storage_key
            raise
        user.avatar_storage_key = new_key
        commit_attempted = True
        try:
            db.commit()
            committed = True
        except Exception:
            resolved = _resolve_commit_after_error(db, user_id, new_key)
            if resolved is None:
                logger.error(
                    "avatar_commit_outcome_unknown user_id=%s; retained new and previous files for safety",
                    user_id,
                )
                raise
            if not resolved:
                _delete_owned_file(storage, user_id, new_key, "uncertain_commit_rollback")
                new_key = None
                raise
            committed = True
    except Exception:
        if not commit_attempted:
            try:
                db.rollback()
            except Exception:
                pass
            _delete_owned_file(storage, user_id, new_key, "precommit_rollback")
        raise
    finally:
        db.close()

    if committed:
        _delete_owned_file(storage, user_id, old_key, "postcommit_replacement")
    assert new_key is not None
    return avatar_url_from_storage_key(user_id, new_key) or ""


def remove_user_avatar(user_id: UUID, raw_token: str, storage) -> None:
    """Commit a NULL avatar pointer before deleting the captured old object."""
    db = SessionLocal()
    old_key: str | None = None
    commit_attempted = False
    committed = False
    try:
        user = _lock_account_and_session(db, user_id, raw_token)
        old_key = user.avatar_storage_key
        if old_key is None:
            return
        user.avatar_storage_key = None
        commit_attempted = True
        try:
            db.commit()
            committed = True
        except Exception:
            resolved = _resolve_commit_after_error(db, user_id, None)
            if resolved is None:
                logger.error(
                    "avatar_removal_commit_outcome_unknown user_id=%s; retained previous file for safety",
                    user_id,
                )
                raise
            if not resolved:
                raise
            committed = True
    except Exception:
        if not commit_attempted:
            try:
                db.rollback()
            except Exception:
                pass
        raise
    finally:
        db.close()

    if committed:
        _delete_owned_file(storage, user_id, old_key, "postcommit_removal")


def read_current_avatar(db: Session, user_id: UUID, requested_version: UUID, storage) -> bytes:
    """Read only the current version for the specified account, concealing all misses."""
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.avatar_storage_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Avatar not found")
    try:
        actual_version = parse_avatar_storage_key(user.avatar_storage_key, user_id)
        if actual_version != requested_version:
            raise InvalidAvatarStorageKey("Avatar version is not current")
        return read_avatar(storage, user_id, user.avatar_storage_key)
    except (InvalidAvatarStorageKey, AvatarStorageError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Avatar not found") from None
