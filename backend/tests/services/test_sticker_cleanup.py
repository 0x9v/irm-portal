"""Isolated retention and bounded sticker maintenance behavior."""

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import tempfile
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401 - register all FK targets
from app.core.storage.exceptions import StickerStorageError
from app.core.storage.local import LocalFileSystemStorage
from app.database import Base
from app.models.community import Community
from app.models.discussion_message import DiscussionMessage
from app.models.sticker_asset import StickerAsset
from app.models.user import User
from app.services.sticker_cleanup import CleanupLimits, run_asset_cleanup, run_namespace_inventory
from scripts.sticker_maintenance import main as maintenance_main


NOW = datetime(2026, 10, 13, tzinfo=timezone.utc)
OLD = NOW - timedelta(days=31)
RECENT = NOW - timedelta(days=29)


@pytest.fixture
def isolated(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'isolated.sqlite'}")

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    storage = LocalFileSystemStorage(tmp_path / "storage")
    with factory() as db:
        user = User(username="cleanup", email="cleanup@example.invalid", password_hash="x",
                    first_name="Test", family_name="User")
        community = Community(name="Test", slug="test")
        db.add_all([user, community])
        db.commit()
        owner_id, community_id = user.id, community.id
    yield factory, storage, owner_id, community_id
    engine.dispose()


def asset(factory, storage, owner_id, *, removed=OLD, created=OLD,
          ownerless=False, content=b"synthetic canonical bytes", key=None):
    asset_id = uuid4()
    if key is None:
        key = storage.save_sticker_immutable(owner_id, asset_id, content)
    with factory() as db:
        db.add(StickerAsset(id=asset_id, owner_id=None if ownerless else owner_id,
                            storage_key=key, byte_size=len(content), created_at=created,
                            removed_at=removed))
        db.commit()
    return asset_id, key


def message(factory, community_id, owner_id, asset_id, *, removed=False):
    with factory() as db:
        db.add(DiscussionMessage(community_id=community_id, author_id=owner_id,
                                 client_message_id=uuid4(), kind="CUSTOM_STICKER",
                                 custom_sticker_id=asset_id,
                                 removed_at=NOW if removed else None))
        db.commit()


def retained(factory, asset_id):
    with factory() as db:
        return db.get(StickerAsset, asset_id) is not None


def test_retention_references_ownerless_and_dry_run(isolated):
    factory, storage, owner, community = isolated
    available, available_key = asset(factory, storage, owner, removed=None)
    recent, recent_key = asset(factory, storage, owner, removed=RECENT)
    visible, visible_key = asset(factory, storage, owner)
    moderated, moderated_key = asset(factory, storage, owner)
    ownerless_ref, ownerless_ref_key = asset(factory, storage, owner, ownerless=True)
    ownerless_recent, ownerless_recent_key = asset(factory, storage, owner,
                                                   ownerless=True, created=RECENT)
    old, old_key = asset(factory, storage, owner)
    ownerless, ownerless_key = asset(factory, storage, owner, ownerless=True)
    message(factory, community, owner, visible)
    message(factory, community, owner, moderated, removed=True)
    message(factory, community, owner, ownerless_ref, removed=True)

    preview = run_asset_cleanup(factory, storage, CleanupLimits(), now=NOW)
    assert preview.deleted == 0 and preview.eligible == 2
    assert all(retained(factory, item) for item in
               (available, recent, visible, moderated, ownerless_ref, ownerless_recent,
                old, ownerless))

    result = run_asset_cleanup(factory, storage, CleanupLimits(), now=NOW, apply=True)
    assert result.deleted == 2 and result.failed == 0
    for item, key in ((available, available_key), (recent, recent_key),
                      (visible, visible_key), (moderated, moderated_key),
                      (ownerless_ref, ownerless_ref_key),
                      (ownerless_recent, ownerless_recent_key)):
        assert retained(factory, item) and (storage.root / key).is_file()
    for item, key in ((old, old_key), (ownerless, ownerless_key)):
        assert not retained(factory, item) and not (storage.root / key).exists()
    again = run_asset_cleanup(factory, storage, CleanupLimits(), now=NOW, apply=True)
    assert again.deleted == 0 and again.complete


def test_missing_object_symlink_malformed_key_and_failure_recovery(isolated, monkeypatch):
    factory, storage, owner, _ = isolated
    missing, key = asset(factory, storage, owner)
    (storage.root / key).unlink()
    recovered = run_asset_cleanup(factory, storage, CleanupLimits(), now=NOW, apply=True)
    assert recovered.deleted == 1 and recovered.missing_recovered == 1
    assert not retained(factory, missing)

    linked, link_key = asset(factory, storage, owner)
    target = storage.root / link_key
    target.unlink()

    outside = storage.root.parent / "do-not-delete"
    outside.write_bytes(b"other")
    target.symlink_to(outside)
    failure = run_asset_cleanup(factory, storage, CleanupLimits(), now=NOW, apply=True)
    assert failure.failed == 1 and retained(factory, linked) and outside.read_bytes() == b"other"
    target.unlink()

    parent_linked, parent_key = asset(factory, storage, owner)
    parent = (storage.root / parent_key).parent
    moved = parent.with_name(parent.name + "-moved")
    parent.rename(moved)
    parent.symlink_to(moved)
    parent_failure = run_asset_cleanup(factory, storage, CleanupLimits(), now=NOW, apply=True)
    assert parent_failure.failed >= 1 and retained(factory, parent_linked)
    parent.unlink()
    moved.rename(parent)

    bad_id = uuid4()
    with factory() as db:
        db.add(StickerAsset(id=bad_id, owner_id=owner, storage_key=key,
                            byte_size=1, created_at=OLD, removed_at=OLD))
        db.commit()
    mismatch = run_asset_cleanup(factory, storage, CleanupLimits(), now=NOW, apply=True)
    assert mismatch.failed == 1 and retained(factory, bad_id)

    original = storage.delete_sticker
    def fail_delete(_key, _owner):
        raise StickerStorageError("delete_failed")
    monkeypatch.setattr(storage, "delete_sticker", fail_delete)
    legitimate, legitimate_key = asset(factory, storage, owner)
    failed = run_asset_cleanup(factory, storage, CleanupLimits(), now=NOW, apply=True)
    assert failed.failed >= 1 and retained(factory, bad_id)
    assert retained(factory, legitimate) and (storage.root / legitimate_key).is_file()
    monkeypatch.setattr(storage, "delete_sticker", original)


def test_commit_failure_keeps_row_for_bounded_missing_file_retry(isolated):
    factory, storage, owner, _ = isolated
    item, key = asset(factory, storage, owner)
    state = {"fail": True}

    @event.listens_for(Session, "before_commit")
    def fail_once(session):
        if state["fail"]:
            state["fail"] = False
            raise RuntimeError("synthetic commit uncertainty")

    try:
        result = run_asset_cleanup(factory, storage, CleanupLimits(), now=NOW, apply=True)
    finally:
        event.remove(Session, "before_commit", fail_once)
    assert result.failed == 1 and result.deleted == 0
    assert retained(factory, item) and not (storage.root / key).exists()
    retry = run_asset_cleanup(factory, storage, CleanupLimits(), now=NOW, apply=True)
    assert retry.deleted == 1 and retry.missing_recovered == 1 and not retained(factory, item)


def test_owned_key_must_match_stored_owner_before_unlink(isolated):
    factory, storage, owner, _ = isolated
    item, key = asset(factory, storage, owner)
    with factory() as db:
        other = User(username="other_owner", email="other@example.invalid", password_hash="x",
                     first_name="Other", family_name="Owner")
        db.add(other)
        db.flush()
        db.get(StickerAsset, item).owner_id = other.id
        db.commit()
    result = run_asset_cleanup(factory, storage, CleanupLimits(), now=NOW, apply=True)
    assert result.failed == 1 and result.deleted == 0
    assert retained(factory, item) and (storage.root / key).is_file()


def test_file_byte_row_and_time_limits_make_checkpoint_progress(isolated):
    factory, storage, owner, _ = isolated
    assets = [asset(factory, storage, owner) for _ in range(3)]
    limits = CleanupLimits(rows=1, files=1, bytes=262_144, seconds=30)
    cursor = None
    deleted = 0
    for _ in range(3):
        result = run_asset_cleanup(factory, storage, limits, after_id=cursor,
                                   now=NOW, apply=True)
        deleted += result.deleted
        cursor = UUID(result.next_cursor)
    assert deleted == 3 and all(not retained(factory, item) for item, _ in assets)

    first, _ = asset(factory, storage, owner, content=b"x" * 150_000)
    second, _ = asset(factory, storage, owner, content=b"y" * 150_000)
    byte_result = run_asset_cleanup(factory, storage, CleanupLimits(rows=10, files=10,
                                      bytes=262_144, seconds=30), now=NOW, apply=True)
    assert byte_result.deleted == 1 and byte_result.stopped_reason == "byte_limit"
    next_result = run_asset_cleanup(factory, storage, CleanupLimits(),
                                    after_id=UUID(byte_result.next_cursor), now=NOW, apply=True)
    assert next_result.deleted == 1 and not retained(factory, first) and not retained(factory, second)

    asset(factory, storage, owner)
    asset(factory, storage, owner)
    file_bound = run_asset_cleanup(factory, storage, CleanupLimits(rows=10, files=1),
                                   now=NOW, apply=True)
    assert file_bound.deleted == 1 and file_bound.stopped_reason == "file_limit"
    resume = run_asset_cleanup(factory, storage, CleanupLimits(),
                               after_id=UUID(file_bound.next_cursor), now=NOW, apply=True)
    assert resume.deleted == 1

    asset(factory, storage, owner)
    ticks = iter([0.0, 2.0])
    timed = run_asset_cleanup(factory, storage, CleanupLimits(seconds=1), now=NOW,
                              clock=lambda: next(ticks))
    assert timed.rows_examined == 0 and timed.stopped_reason == "time_limit"


def test_namespace_inventory_is_bounded_dry_run_and_sticker_only(isolated):
    factory, storage, owner, _ = isolated
    orphan_id = uuid4()
    key = storage.save_sticker_immutable(owner, orphan_id, b"orphan")
    orphan = storage.root / key
    os.utime(orphan, (OLD.timestamp(), OLD.timestamp()))
    temporary = orphan.parent / ".sticker-tmp-abcdef"
    temporary.write_bytes(b"stage")
    os.utime(temporary, (OLD.timestamp(), OLD.timestamp()))
    avatar = storage.root / "avatars" / "keep.jpg"
    avatar.parent.mkdir(parents=True)
    avatar.write_bytes(b"avatar")
    document = storage.root / "documents" / "keep.pdf"
    document.parent.mkdir(parents=True)
    document.write_bytes(b"document")

    orphans = run_namespace_inventory(factory, storage, CleanupLimits(files=1),
                                      mode="orphans", now=NOW)
    assert orphans.apply is False and orphans.files_examined == 1
    more = run_namespace_inventory(factory, storage, CleanupLimits(), mode="orphans",
                                   after_ordinal=int(orphans.next_cursor), now=NOW)
    assert orphans.eligible + more.eligible == 1
    temps = run_namespace_inventory(factory, storage, CleanupLimits(),
                                    mode="temporaries", now=NOW)
    assert temps.eligible == 1 and temps.deleted == 0
    assert orphan.is_file() and temporary.is_file() and avatar.is_file() and document.is_file()

    linked = orphan.parent / f"{uuid4()}.webp"
    linked.symlink_to(avatar)
    inventory = run_namespace_inventory(factory, storage, CleanupLimits(),
                                        mode="orphans", now=NOW)
    assert inventory.eligible == 1 and inventory.skipped >= 1 and avatar.is_file()


def test_command_requires_explicit_target_and_refuses_orphan_apply(monkeypatch, capsys):
    with tempfile.TemporaryDirectory(prefix="irm-sticker-maintenance-test-") as directory:
        base = Path(directory)
        database = base / "isolated.sqlite"
        storage_root = base / "storage"
        storage_root.mkdir()
        engine = create_engine(f"sqlite:///{database}")
        Base.metadata.create_all(engine)
        engine.dispose()
        flags = ["--storage-root", str(storage_root), "--expected-storage-root", str(storage_root),
                 "--expected-database", str(database), "--expected-role", "sqlite",
                 "--expected-schema", "main"]
        monkeypatch.delenv("IRM_STICKER_MAINTENANCE_DATABASE_URL", raising=False)
        assert maintenance_main(flags) == 2
        monkeypatch.setenv("IRM_STICKER_MAINTENANCE_DATABASE_URL", f"sqlite:///{database}")
        assert maintenance_main(flags) == 0
        assert maintenance_main([*flags, "--mode", "orphans", "--apply"]) == 2
        assert maintenance_main([*flags, "--apply"]) == 0
        output = capsys.readouterr()
        assert "maintenance_refused_or_failed" in output.err
        assert "isolated.sqlite" in output.out


def test_command_rejects_mismatched_storage_and_non_test_sqlite_apply(isolated, monkeypatch):
    factory, storage, _, _ = isolated
    database = Path(factory.kw["bind"].url.database)
    storage.root.mkdir(exist_ok=True)
    monkeypatch.setenv("IRM_STICKER_MAINTENANCE_DATABASE_URL", f"sqlite:///{database}")
    flags = ["--storage-root", str(storage.root), "--expected-storage-root", str(storage.root),
             "--expected-database", str(database), "--expected-role", "sqlite",
             "--expected-schema", "main"]
    assert maintenance_main([*flags, "--apply"]) == 2
    assert maintenance_main([*flags, "--apply", "--owner-apply"]) == 2
    other = storage.root.parent / "other"
    other.mkdir()
    flags[flags.index("--expected-storage-root") + 1] = str(other)
    assert maintenance_main(flags) == 2
