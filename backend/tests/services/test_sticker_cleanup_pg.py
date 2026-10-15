"""Guarded PostgreSQL row-lock and FK retention acceptance for sticker cleanup."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Event, current_thread
from uuid import uuid4

import pytest
from sqlalchemy import event, select

from acceptance.isolation import disposable_database
from app.core.storage.local import LocalFileSystemStorage
from app.models.community import Community
from app.models.discussion_message import DiscussionMessage
from app.models.sticker_asset import StickerAsset
from app.models.user import User
from app.services.sticker_cleanup import CleanupLimits, run_asset_cleanup


@pytest.fixture
def pg_resource():
    with disposable_database() as resource:
        yield resource


def test_cleanup_waits_for_competing_reference_and_retains_removed_message_asset(pg_resource, tmp_path):
    factory = pg_resource.factory
    storage = LocalFileSystemStorage(tmp_path)
    now = datetime.now(timezone.utc)
    with factory() as db:
        owner = User(username=f"cleanup_{uuid4().hex}", email=f"{uuid4().hex}@example.invalid",
                     password_hash="x", first_name="Test", family_name="User")
        community = Community(name="Cleanup", slug=f"cleanup-{uuid4().hex}")
        db.add_all([owner, community])
        db.commit()
        owner_id, community_id = owner.id, community.id
    asset_id = uuid4()
    key = storage.save_sticker_immutable(owner_id, asset_id, b"synthetic canonical bytes")
    with factory() as db:
        db.add(StickerAsset(id=asset_id, owner_id=owner_id, storage_key=key,
                            byte_size=25, created_at=now - timedelta(days=40),
                            removed_at=now - timedelta(days=31)))
        db.commit()

    locked = Event()
    release = Event()
    cleanup_select = Event()

    def observe(_connection, _cursor, statement, _parameters, _context, _executemany):
        if (current_thread().name.startswith("cleanup") and "sticker_assets" in statement
                and "FOR UPDATE" in statement):
            cleanup_select.set()

    def writer():
        with factory() as db:
            with db.begin():
                db.execute(select(StickerAsset).where(StickerAsset.id == asset_id)
                           .with_for_update()).scalar_one()
                locked.set()
                assert release.wait(4)
                db.add(DiscussionMessage(community_id=community_id, author_id=owner_id,
                                         client_message_id=uuid4(), kind="CUSTOM_STICKER",
                                         custom_sticker_id=asset_id, removed_at=now))

    event.listen(pg_resource.engine, "before_cursor_execute", observe)
    try:
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="writer") as writer_pool, \
                ThreadPoolExecutor(max_workers=1, thread_name_prefix="cleanup") as cleanup_pool:
            writer_result = writer_pool.submit(writer)
            assert locked.wait(4)
            cleanup_result = cleanup_pool.submit(run_asset_cleanup, factory, storage,
                                                 CleanupLimits(seconds=10), now=now, apply=True)
            assert cleanup_select.wait(4)
            release.set()
            writer_result.result(timeout=5)
            result = cleanup_result.result(timeout=8)
    finally:
        release.set()
        event.remove(pg_resource.engine, "before_cursor_execute", observe)
    assert result.deleted == 0 and result.skipped == 1 and result.failed == 0
    with factory() as db:
        assert db.get(StickerAsset, asset_id) is not None
        assert db.execute(select(DiscussionMessage).where(
            DiscussionMessage.custom_sticker_id == asset_id)).scalar_one().removed_at is not None
    assert (tmp_path / key).is_file()


def test_unreferenced_old_removed_asset_is_deleted_and_missing_retry_is_idempotent(pg_resource, tmp_path):
    factory = pg_resource.factory
    storage = LocalFileSystemStorage(tmp_path)
    now = datetime.now(timezone.utc)
    with factory() as db:
        owner = User(username=f"cleanup_{uuid4().hex}", email=f"{uuid4().hex}@example.invalid",
                     password_hash="x", first_name="Test", family_name="User")
        db.add(owner)
        db.commit()
        owner_id = owner.id
    asset_id = uuid4()
    key = storage.save_sticker_immutable(owner_id, asset_id, b"synthetic canonical bytes")
    with factory() as db:
        db.add(StickerAsset(id=asset_id, owner_id=owner_id, storage_key=key,
                            byte_size=25, created_at=now - timedelta(days=40),
                            removed_at=now - timedelta(days=31)))
        db.commit()
    result = run_asset_cleanup(factory, storage, CleanupLimits(), now=now, apply=True)
    assert result.deleted == 1 and result.failed == 0
    assert not (tmp_path / key).exists()
    assert run_asset_cleanup(factory, storage, CleanupLimits(), now=now, apply=True).deleted == 0
    with factory() as db:
        assert db.get(StickerAsset, asset_id) is None
