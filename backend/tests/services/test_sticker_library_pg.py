"""Concurrency acceptance for sticker-library row locks on owned PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import UUID, uuid4

from fastapi import HTTPException
import pytest

from acceptance.isolation import disposable_database
from app.core.sessions import create_session
from app.core.stickers import process_sticker_image
from app.core.storage.local import LocalFileSystemStorage
from app.models.sticker_asset import StickerAsset
from app.models.user import User
from app.models.session import Session as AccountSession
from app.services import sticker_library
from app.services.sticker_library import create_user_sticker, remove_user_sticker


@pytest.fixture
def pg_resource():
    with disposable_database() as resource:
        yield resource


def _create_account(factory):
    with factory() as db:
        user = User(username=f"sticker_pg_{uuid4().hex}", email=f"{uuid4().hex}@example.invalid",
                    password_hash="opaque", first_name="PG", family_name="Sticker")
        db.add(user)
        db.commit()
        raw, session = create_session(db, user.id, timedelta(days=1))
        return user.id, raw, session.id


def _canonical():
    from io import BytesIO
    from PIL import Image

    source = BytesIO()
    Image.new("RGBA", (40, 32), (220, 30, 40, 255)).save(source, format="PNG")
    return process_sticker_image(source.getvalue(), "image/png")


def test_concurrent_uploads_respect_count_quota_and_preserve_files(pg_resource, tmp_path, monkeypatch):
    factory = pg_resource.factory
    monkeypatch.setattr(sticker_library, "SessionLocal", factory)
    monkeypatch.setattr(sticker_library, "MAX_USER_STICKERS", 1)
    monkeypatch.setattr(sticker_library, "MAX_USER_STICKER_BYTES", 26_214_400)
    storage = LocalFileSystemStorage(tmp_path)
    owner_id, token, _ = _create_account(factory)
    canonical = _canonical()
    barrier = Barrier(2)

    def upload():
        barrier.wait()
        try:
            return create_user_sticker(owner_id, token, canonical, storage)["id"]
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: upload(), range(2)))
    assert sum(isinstance(result, UUID) for result in results) == 1
    assert results.count(409) == 1
    with factory() as db:
        rows = db.query(StickerAsset).filter(StickerAsset.owner_id == owner_id,
                                              StickerAsset.removed_at.is_(None)).all()
        assert len(rows) == 1
    assert len(list(tmp_path.rglob("*.webp"))) == 1


def test_concurrent_uploads_respect_byte_quota(pg_resource, tmp_path, monkeypatch):
    factory = pg_resource.factory
    monkeypatch.setattr(sticker_library, "SessionLocal", factory)
    canonical = _canonical()
    monkeypatch.setattr(sticker_library, "MAX_USER_STICKERS", 100)
    monkeypatch.setattr(sticker_library, "MAX_USER_STICKER_BYTES", len(canonical))
    storage = LocalFileSystemStorage(tmp_path)
    owner_id, token, _ = _create_account(factory)
    barrier = Barrier(2)

    def upload():
        barrier.wait()
        try:
            return create_user_sticker(owner_id, token, canonical, storage)["id"]
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: upload(), range(2)))
    assert sum(isinstance(result, UUID) for result in results) == 1
    assert results.count(409) == 1
    with factory() as db:
        rows = db.query(StickerAsset).filter(StickerAsset.owner_id == owner_id,
                                              StickerAsset.removed_at.is_(None)).all()
        assert len(rows) == 1 and sum(row.byte_size for row in rows) == len(canonical)
    assert len(list(tmp_path.rglob("*.webp"))) == 1


def test_upload_and_removal_are_serialized_and_session_revocation_is_rechecked(
    pg_resource, tmp_path, monkeypatch
):
    factory = pg_resource.factory
    monkeypatch.setattr(sticker_library, "SessionLocal", factory)
    monkeypatch.setattr(sticker_library, "MAX_USER_STICKERS", 1)
    monkeypatch.setattr(sticker_library, "MAX_USER_STICKER_BYTES", 26_214_400)
    storage = LocalFileSystemStorage(tmp_path)
    owner_id, token, session_id = _create_account(factory)
    canonical = _canonical()
    existing = create_user_sticker(owner_id, token, canonical, storage)
    old_key = None
    with factory() as db:
        old_key = db.query(StickerAsset.storage_key).filter(StickerAsset.id == existing["id"]).one()[0]
    barrier = Barrier(2)

    def upload():
        barrier.wait()
        try:
            return create_user_sticker(owner_id, token, canonical, storage)["id"]
        except HTTPException as error:
            return error.status_code

    def remove():
        barrier.wait()
        remove_user_sticker(owner_id, token, existing["id"])
        return 204

    with ThreadPoolExecutor(max_workers=2) as pool:
        upload_future, remove_future = pool.submit(upload), pool.submit(remove)
        upload_result, remove_result = upload_future.result(), remove_future.result()
    assert remove_result == 204
    assert upload_result == 409 or isinstance(upload_result, UUID)
    assert (tmp_path / old_key).is_file()  # Library removal never deletes the immutable object.
    with factory() as db:
        available = db.query(StickerAsset).filter(
            StickerAsset.owner_id == owner_id, StickerAsset.removed_at.is_(None)
        ).all()
        assert len(available) == (1 if isinstance(upload_result, UUID) else 0)
        session = db.get(AccountSession, session_id)
        session.is_revoked = True
        db.commit()
    with pytest.raises(HTTPException) as error:
        create_user_sticker(owner_id, token, canonical, storage)
    assert error.value.status_code == 401
    with factory() as db:
        assert db.query(StickerAsset).filter(StickerAsset.owner_id == owner_id,
                                              StickerAsset.removed_at.is_(None)).count() == len(available)
