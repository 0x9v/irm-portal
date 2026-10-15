"""Bounded, explicit sticker retention and maintenance operations."""

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import re
import stat
import time
from typing import Callable
from uuid import UUID

from sqlalchemy import select, text as sql_text
from sqlalchemy.orm import Session, sessionmaker

from app.core.stickers import sticker_storage_owner_id, validate_sticker_storage_key
from app.core.storage.local import LocalFileSystemStorage
from app.models.discussion_message import DiscussionMessage
from app.models.sticker_asset import StickerAsset


RETENTION = timedelta(days=30)
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z")
_TEMP = re.compile(r"\.sticker-tmp-[A-Za-z0-9_-]{6,32}\Z")


@dataclass(frozen=True)
class CleanupLimits:
    rows: int = 100
    files: int = 50
    bytes: int = 25 * 1024 * 1024
    seconds: int = 30

    def validate(self) -> None:
        if not (1 <= self.rows <= 500 and 1 <= self.files <= 500
                and 262_144 <= self.bytes <= 64 * 1024 * 1024
                and 1 <= self.seconds <= 120):
            raise ValueError("Maintenance limits are outside permitted bounds")


@dataclass
class CleanupReport:
    mode: str
    apply: bool
    rows_examined: int = 0
    files_examined: int = 0
    eligible: int = 0
    deleted: int = 0
    missing_recovered: int = 0
    skipped: int = 0
    failed: int = 0
    bytes_examined: int = 0
    next_cursor: str | int | None = None
    complete: bool = False
    stopped_reason: str | None = None

    def sanitized(self) -> dict[str, object]:
        return asdict(self)


def _eligible(asset: StickerAsset, cutoff: datetime) -> bool:
    # No owner-loss timestamp exists. For ownerless rows the asset's creation
    # age is the only stored age, and no new authorized sends are possible.
    if asset.owner_id is None:
        return _utc(asset.created_at) <= cutoff
    return asset.removed_at is not None and _utc(asset.removed_at) <= cutoff


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _statement_bound(db: Session, milliseconds: int) -> None:
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        duration = f"{max(1, min(milliseconds, 5000))}ms"
        db.execute(sql_text("SELECT set_config('statement_timeout', :duration, true)"),
                   {"duration": duration})
        db.execute(sql_text("SELECT set_config('lock_timeout', :duration, true)"),
                   {"duration": duration})


def _visit_asset(factory: sessionmaker[Session], storage: LocalFileSystemStorage,
                 asset_id: UUID, cutoff: datetime, *, apply: bool,
                 file_budget: int, byte_budget: int, full_byte_limit: int,
                 timeout_ms: int) -> tuple[str, int, bool, bool]:
    """Lock, recheck, and optionally remove exactly one unreferenced row/file.

    The file is removed before the row commits. On a failed/unknown commit the
    row can remain with a missing file; a later bounded pass recovers it.
    """
    file_checked = False
    amount = 0
    try:
        with factory() as db:
            with db.begin():
                _statement_bound(db, timeout_ms)
                asset = db.execute(select(StickerAsset).where(StickerAsset.id == asset_id)
                                   .with_for_update()).scalar_one_or_none()
                if asset is None or not _eligible(asset, cutoff):
                    return "skipped", 0, False, False
                if db.execute(select(DiscussionMessage.id).where(
                    DiscussionMessage.custom_sticker_id == asset_id
                ).limit(1)).first() is not None:
                    return "skipped", 0, False, False
                owner = sticker_storage_owner_id(asset.storage_key)
                stored_asset_id, _version = validate_sticker_storage_key(asset.storage_key, owner)
                if stored_asset_id != asset.id or (
                    asset.owner_id is not None and owner != asset.owner_id
                ):
                    return "failed", 0, False, False
                if file_budget < 1:
                    return "file_limit", 0, False, False
                file_checked = True
                size = storage.sticker_file_size(asset.storage_key, owner)
                amount = size or 0
                if amount > full_byte_limit:
                    return "oversized", 0, False, True
                if amount > byte_budget:
                    return "byte_limit", 0, False, True
                if apply:
                    # Let the database enforce RESTRICT before touching the
                    # filesystem. A failed file unlink rolls this DELETE back.
                    db.delete(asset)
                    db.flush()
                    present = storage.delete_sticker(asset.storage_key, owner)
                else:
                    present = size is not None
            # Reaching this point confirms commit. In particular, storage
            # failure or an uncertain database commit cannot count as deleted.
            return ("deleted" if apply else "eligible"), amount, not present, True
    except Exception:
        # Exact generated-key deletion may have happened before commit failed.
        # Do not retry in this transaction or claim a confirmed row deletion.
        return "failed", amount, False, file_checked


def run_asset_cleanup(factory: sessionmaker[Session], storage: LocalFileSystemStorage,
                      limits: CleanupLimits, *, after_id: UUID | None = None,
                      apply: bool = False, now: datetime | None = None,
                      clock: Callable[[], float] = time.monotonic) -> CleanupReport:
    limits.validate()
    cutoff = _utc(now or datetime.now(timezone.utc)) - RETENTION
    deadline = clock() + limits.seconds
    report = CleanupReport(mode="assets", apply=apply)
    with factory() as db:
        _statement_bound(db, limits.seconds * 1000)
        query = select(StickerAsset.id).order_by(StickerAsset.id).limit(limits.rows)
        if after_id is not None:
            query = query.where(StickerAsset.id > after_id)
        ids = list(db.execute(query).scalars())
    cursor = after_id
    for asset_id in ids:
        if clock() >= deadline:
            report.stopped_reason = "time_limit"
            break
        outcome, amount, missing, file_checked = _visit_asset(
            factory, storage, asset_id, cutoff, apply=apply,
            file_budget=limits.files - report.files_examined,
            byte_budget=limits.bytes - report.bytes_examined,
            full_byte_limit=limits.bytes,
            timeout_ms=max(1, int((deadline - clock()) * 1000)),
        )
        report.rows_examined += 1
        if outcome in {"file_limit", "byte_limit"}:
            if file_checked:
                report.files_examined += 1
            report.stopped_reason = outcome
            break  # Leave this ID at the next checkpoint.
        cursor = asset_id
        if file_checked:
            report.files_examined += 1
            report.bytes_examined += min(amount, limits.bytes - report.bytes_examined)
        if outcome == "skipped":
            report.skipped += 1
        elif outcome == "failed":
            report.failed += 1
        elif outcome == "oversized":
            report.eligible += 1
            report.skipped += 1
        else:
            report.eligible += 1
            if outcome == "deleted":
                report.deleted += 1
                if missing:
                    report.missing_recovered += 1
    report.next_cursor = str(cursor) if cursor is not None else None
    if report.stopped_reason is None:
        if clock() >= deadline:
            report.stopped_reason = "time_limit"
            return report
        with factory() as db:
            _statement_bound(db, limits.seconds * 1000)
            following = db.execute(select(StickerAsset.id).where(
                StickerAsset.id > cursor
            ).limit(1)).first() if cursor is not None else None
        report.complete = following is None
        if not report.complete:
            report.stopped_reason = "row_limit"
    return report


def _namespace_entries(root: Path):
    """Walk only stickers/<owner>/<asset>/<leaf>, without following links."""
    namespace = root / "stickers"
    try:
        info = namespace.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISDIR(info.st_mode):
        yield "invalid", None, None
        return
    with os.scandir(namespace) as owners:
        for owner in owners:
            owner_info = owner.stat(follow_symlinks=False)
            if not stat.S_ISDIR(owner_info.st_mode) or not _UUID.fullmatch(owner.name):
                yield "invalid", None, None
                continue
            with os.scandir(owner.path) as assets:
                for asset in assets:
                    asset_info = asset.stat(follow_symlinks=False)
                    if not stat.S_ISDIR(asset_info.st_mode) or not _UUID.fullmatch(asset.name):
                        yield "invalid", None, None
                        continue
                    with os.scandir(asset.path) as leaves:
                        for leaf in leaves:
                            leaf_info = leaf.stat(follow_symlinks=False)
                            if not stat.S_ISREG(leaf_info.st_mode):
                                yield "invalid", None, None
                                continue
                            key = f"stickers/{owner.name}/{asset.name}/{leaf.name}"
                            if leaf.name.endswith(".webp"):
                                try:
                                    parsed_id, _ = validate_sticker_storage_key(key, UUID(owner.name))
                                except (TypeError, ValueError):
                                    yield "invalid", None, None
                                    continue
                                if parsed_id == UUID(asset.name):
                                    yield "orphan", key, leaf_info
                                else:
                                    yield "invalid", None, None
                            elif _TEMP.fullmatch(leaf.name):
                                yield "temporary", key, leaf_info
                            else:
                                yield "invalid", None, None


def run_namespace_inventory(factory: sessionmaker[Session], storage: LocalFileSystemStorage,
                            limits: CleanupLimits, *, mode: str, after_ordinal: int = 0,
                            now: datetime | None = None,
                            clock: Callable[[], float] = time.monotonic) -> CleanupReport:
    """Dry-run-only orphan/temporary inventory; writer coordination is absent."""
    limits.validate()
    if mode not in {"orphans", "temporaries"} or after_ordinal < 0:
        raise ValueError("Invalid inventory mode or cursor")
    deadline = clock() + limits.seconds
    cutoff = (_utc(now or datetime.now(timezone.utc)) - RETENTION).timestamp()
    report = CleanupReport(mode=mode, apply=False, next_cursor=after_ordinal)
    position = 0
    try:
        for kind, key, info in _namespace_entries(storage.root):
            position += 1
            if position <= after_ordinal:
                continue
            if clock() >= deadline:
                report.stopped_reason = "time_limit"
                break
            if report.files_examined >= limits.files:
                report.stopped_reason = "file_limit"
                break
            report.files_examined += 1
            report.next_cursor = position
            if kind != ("orphan" if mode == "orphans" else "temporary") or info is None or key is None:
                report.skipped += 1
                continue
            if info.st_size > limits.bytes - report.bytes_examined:
                report.skipped += 1
                continue
            report.bytes_examined += info.st_size
            if info.st_mtime > cutoff:
                report.skipped += 1
                continue
            if mode == "temporaries":
                report.eligible += 1
                continue
            if report.rows_examined >= limits.rows:
                report.stopped_reason = "row_limit"
                report.next_cursor = position - 1
                break
            asset_id = UUID(key.split("/")[2])
            with factory() as db:
                _statement_bound(db, limits.seconds * 1000)
                row = db.execute(select(StickerAsset.id).where(
                    (StickerAsset.storage_key == key) | (StickerAsset.id == asset_id)
                ).limit(1)).first()
            report.rows_examined += 1
            if row is None:
                report.eligible += 1
            else:
                report.skipped += 1
        else:
            report.complete = True
    except Exception:
        report.failed += 1
        report.stopped_reason = "scan_failed"
    # Enumeration order may shift while writers run. These inventories cannot
    # authorize deletion and are intentionally separate from the DB row pass.
    return report
