"""Private sticker library mutations and owner-scoped reads."""

import base64
from datetime import datetime, timezone
import hashlib
import hmac
import logging
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.sessions import validate_session
from app.core.stickers import MAX_STORED_STICKER_BYTES, validate_canonical_sticker_bytes
from app.core.storage.exceptions import ObjectNotFoundError, StickerStorageError
from app.core.storage.local import LocalFileSystemStorage
from app.database.session import SessionLocal
from app.models.sticker_asset import StickerAsset
from app.models.user import User


logger = logging.getLogger(__name__)
MAX_USER_STICKERS = 100
MAX_USER_STICKER_BYTES = 26_214_400
DEFAULT_STICKER_PAGE_SIZE = 30
MAX_STICKER_PAGE_SIZE = 50


def _lock_user_and_session(db: Session, user_id: UUID, raw_token: str) -> User:
    user = (db.query(User).filter(User.id == user_id).populate_existing()
            .with_for_update().one_or_none())
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    session = validate_session(db, raw_token, refresh=True, lock=True)
    if session is None or session.user_id != user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user


def _cleanup_new_object(storage, owner_id: UUID, key: str | None, phase: str) -> None:
    if key is None:
        return
    try:
        storage.delete_sticker(key, owner_id)
    except Exception as error:
        # Logging is best effort and never masks the operation's actual outcome.
        try:
            logger.error("sticker_cleanup_failed phase=%s owner_id=%s outcome=%s",
                         phase, owner_id, getattr(error, "outcome", "unexpected"))
        except Exception:
            pass


def _asset_payload(asset: StickerAsset) -> dict[str, object]:
    return {
        "id": asset.id,
        "preview_url": f"/api/v1/auth/me/stickers/{asset.id}/image",
        "width": asset.width,
        "height": asset.height,
        "media_type": asset.media_type,
        "byte_size": asset.byte_size,
        "created_at": asset.created_at,
    }


def create_user_sticker(
    user_id: UUID,
    raw_token: str,
    canonical_webp: bytes,
    storage: LocalFileSystemStorage,
) -> dict[str, object]:
    """Reserve quota, publish immutable bytes, and commit one available asset."""
    if not 0 < len(canonical_webp) <= MAX_STORED_STICKER_BYTES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid canonical sticker")
    asset_id = uuid4()
    db = SessionLocal()
    storage_key: str | None = None
    commit_attempted = False
    try:
        _lock_user_and_session(db, user_id, raw_token)
        count, total = db.query(
            func.count(StickerAsset.id), func.coalesce(func.sum(StickerAsset.byte_size), 0)
        ).filter(
            StickerAsset.owner_id == user_id,
            StickerAsset.removed_at.is_(None),
        ).one()
        if count >= MAX_USER_STICKERS or total + len(canonical_webp) > MAX_USER_STICKER_BYTES:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={"code": "sticker_quota_exceeded"},
            )

        try:
            storage_key = storage.save_sticker_immutable(user_id, asset_id, canonical_webp)
        except StickerStorageError as error:
            storage_key = error.storage_key
            raise
        asset = StickerAsset(
            id=asset_id,
            owner_id=user_id,
            storage_key=storage_key,
            media_type="image/webp",
            width=256,
            height=256,
            byte_size=len(canonical_webp),
            created_at=datetime.now(timezone.utc),
        )
        db.add(asset)
        commit_attempted = True
        try:
            db.commit()
            return _asset_payload(asset)
        except Exception as error:
            # Resolve through an independent connection. If we cannot prove
            # there is no committed row, retaining the object is the safe path.
            try:
                db.rollback()
            except Exception:
                pass
            try:
                db.close()
            except Exception:
                pass
            try:
                with SessionLocal() as fresh:
                    # Wait for any in-flight original transaction holding this
                    # row lock before treating an absent asset as rollback.
                    persisted_user = (fresh.query(User.id).filter(User.id == user_id)
                                     .with_for_update().one_or_none())
                    if persisted_user is None:
                        raise RuntimeError("Account state unavailable")
                    persisted = fresh.query(StickerAsset).filter(
                        StickerAsset.id == asset_id,
                        StickerAsset.storage_key == storage_key,
                    ).one_or_none()
                    if persisted is not None and persisted.owner_id == user_id and persisted.removed_at is None:
                        resolved = _asset_payload(persisted)
                        confirmed_absent = False
                    elif persisted is None:
                        resolved = None
                        confirmed_absent = True
                    else:
                        raise RuntimeError("Asset state unavailable")
            except Exception:
                resolved = None
                confirmed_absent = False
                try:
                    logger.error("sticker_commit_outcome_unknown owner_id=%s asset_id=%s", user_id, asset_id)
                except Exception:
                    pass
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Sticker upload failed") from None
            if resolved is not None:
                return resolved
            if not confirmed_absent:
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Sticker upload failed") from error
            _cleanup_new_object(storage, user_id, storage_key, "resolved_rollback")
            storage_key = None
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Sticker upload failed") from error
    except HTTPException:
        try:
            db.rollback()
        except Exception:
            pass
        if not commit_attempted:
            _cleanup_new_object(storage, user_id, storage_key, "known_rollback")
        raise
    except StickerStorageError as error:
        try:
            db.rollback()
        except Exception:
            pass
        _cleanup_new_object(storage, user_id, storage_key or error.storage_key, "storage_failure")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Sticker upload failed") from None
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        if not commit_attempted:
            _cleanup_new_object(storage, user_id, storage_key, "known_rollback")
        raise
    finally:
        db.close()


def _cursor_signature(asset_id: UUID, raw_token: str) -> bytes:
    message = b"irm-sticker-library-cursor-v1:" + asset_id.bytes
    return hmac.new(raw_token.encode("utf-8"), message, hashlib.sha256).digest()


def _encode_cursor(asset_id: UUID, raw_token: str) -> str:
    raw = asset_id.bytes + _cursor_signature(asset_id, raw_token)
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str, raw_token: str) -> UUID:
    try:
        if not cursor or len(cursor) != 64:
            raise ValueError
        raw = base64.urlsafe_b64decode(cursor)
        if len(raw) != 48:
            raise ValueError
        asset_id = UUID(bytes=raw[:16])
        expected = _cursor_signature(asset_id, raw_token)
        if not hmac.compare_digest(raw[16:], expected) or _encode_cursor(asset_id, raw_token) != cursor:
            raise ValueError
        return asset_id
    except (ValueError, TypeError, base64.binascii.Error):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "invalid_sticker_cursor"}) from None


def list_user_stickers(db: Session, owner_id: UUID, raw_token: str,
                       limit: int, before: str | None) -> dict[str, object]:
    query = db.query(StickerAsset).filter(
        StickerAsset.owner_id == owner_id,
        StickerAsset.removed_at.is_(None),
    )
    if before is not None:
        anchor_id = _decode_cursor(before, raw_token)
        # Anchor lookup is owner-scoped but includes removed rows so deletion
        # during pagination cannot strand the caller's remaining pages.
        anchor = db.query(StickerAsset).filter(
            StickerAsset.id == anchor_id, StickerAsset.owner_id == owner_id
        ).one_or_none()
        if anchor is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail={"code": "invalid_sticker_cursor"})
        query = query.filter(or_(
            StickerAsset.created_at < anchor.created_at,
            (StickerAsset.created_at == anchor.created_at) & (StickerAsset.id < anchor.id),
        ))
    rows = (query.order_by(StickerAsset.created_at.desc(), StickerAsset.id.desc())
            .limit(limit + 1).all())
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {
        "items": [_asset_payload(row) for row in rows],
        "next_cursor": _encode_cursor(rows[-1].id, raw_token) if has_more and rows else None,
    }


def remove_user_sticker(user_id: UUID, raw_token: str, asset_id: UUID) -> None:
    db = SessionLocal()
    commit_attempted = False
    try:
        _lock_user_and_session(db, user_id, raw_token)
        asset = (db.query(StickerAsset).filter(
            StickerAsset.id == asset_id, StickerAsset.owner_id == user_id
        ).populate_existing().with_for_update().one_or_none())
        if asset is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Sticker not found")
        if asset.removed_at is None:
            asset.removed_at = datetime.now(timezone.utc)
            commit_attempted = True
            db.commit()
    except HTTPException:
        try:
            db.rollback()
        except Exception:
            pass
        raise
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        if commit_attempted:
            try:
                db.close()
            except Exception:
                pass
            try:
                with SessionLocal() as fresh:
                    persisted_user = (fresh.query(User.id).filter(User.id == user_id)
                                      .with_for_update().one_or_none())
                    if persisted_user is None:
                        raise RuntimeError("Account state unavailable")
                    asset = fresh.query(StickerAsset).filter(
                        StickerAsset.id == asset_id,
                        StickerAsset.owner_id == user_id,
                    ).one_or_none()
                if asset is not None and asset.removed_at is not None:
                    return
            except Exception:
                pass
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Sticker removal failed") from None
    finally:
        db.close()


def read_user_sticker(db: Session, owner_id: UUID, asset_id: UUID,
                      storage: LocalFileSystemStorage) -> bytes:
    asset = db.query(StickerAsset).filter(
        StickerAsset.id == asset_id,
        StickerAsset.owner_id == owner_id,
        StickerAsset.removed_at.is_(None),
    ).first()
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sticker not found")
    try:
        content = storage.read_sticker_bounded(asset.storage_key, owner_id, MAX_STORED_STICKER_BYTES)
        validate_canonical_sticker_bytes(content)
        return content
    except (ObjectNotFoundError, StickerStorageError, ValueError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sticker not found") from None
