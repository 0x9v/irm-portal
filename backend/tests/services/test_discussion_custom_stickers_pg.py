"""PostgreSQL locking acceptance for Discussion custom-sticker references."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
import pytest

from acceptance.isolation import disposable_database
from app.core.sessions import create_session
from app.core.stickers import process_sticker_image
from app.core.storage.local import LocalFileSystemStorage
from app.models.community import Community
from app.models.discussion_message import DiscussionMessage
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.sticker_asset import StickerAsset
from app.models.user import User
from app.schemas.discussion import DiscussionMessageCreate
from app.services import discussion, sticker_library
from app.services.content_removal import remove_content


@pytest.fixture
def pg_resource():
    with disposable_database() as resource:
        yield resource


def _setup(factory, storage):
    with factory() as db:
        user = User(username=f"cs4_{uuid4().hex}", email=f"{uuid4().hex}@example.invalid",
                    password_hash="opaque", first_name="Test", family_name="User")
        community = Community(name="CS4", slug=f"cs4-{uuid4().hex[:8]}")
        db.add_all([user, community])
        db.commit()
        membership = Membership(user_id=user.id, community_id=community.id,
                               status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE,
                               cne=f"CNE_{uuid4().hex[:6]}")
        db.add(membership)
        db.commit()
        token, _ = create_session(db, user.id, timedelta(days=1))
        asset_id = uuid4()
        content = _canonical()
        key = storage.save_sticker_immutable(user.id, asset_id, content)
        asset = StickerAsset(id=asset_id, owner_id=user.id, storage_key=key,
                             media_type="image/webp", width=256, height=256,
                             byte_size=len(content))
        db.add(asset)
        db.commit()
        return user.id, community.id, community.slug, token, asset_id, key


def _canonical():
    from io import BytesIO
    from PIL import Image

    output = BytesIO()
    Image.new("RGBA", (48, 32), (30, 180, 90, 160)).save(output, format="PNG")
    return process_sticker_image(output.getvalue(), "image/png")


def _send(factory, identity, client_message_id):
    user_id, community_id, slug, token, asset_id, _key = identity
    with factory() as db:
        user = db.get(User, user_id)
        return discussion.create_discussion_message(
            db, slug, user,
            DiscussionMessageCreate(client_message_id=client_message_id,
                                    kind="CUSTOM_STICKER", custom_sticker_id=asset_id),
            community_id=community_id, raw_token=token,
        )


def test_send_and_library_removal_both_serialized_orders(pg_resource, tmp_path, monkeypatch):
    factory = pg_resource.factory
    monkeypatch.setattr(sticker_library, "SessionLocal", factory)
    storage = LocalFileSystemStorage(tmp_path)
    identity = _setup(factory, storage)
    user_id, _community_id, _slug, token, asset_id, key = identity
    send_ready, removed = Barrier(2), Event()

    def remove_first():
        send_ready.wait(timeout=5)
        sticker_library.remove_user_sticker(user_id, token, asset_id)
        removed.set()
        return "removed"

    def send_after_remove():
        send_ready.wait(timeout=5)
        assert removed.wait(timeout=5)
        try:
            _send(factory, identity, uuid4())
        except HTTPException as error:
            return error.status_code
        return "unexpected-send"

    with ThreadPoolExecutor(max_workers=2) as pool:
        remove_future = pool.submit(remove_first)
        send_future = pool.submit(send_after_remove)
        assert remove_future.result(timeout=10) == "removed"
        assert send_future.result(timeout=10) == 404
    with factory() as db:
        assert db.query(DiscussionMessage).filter_by(custom_sticker_id=asset_id).count() == 0
    assert (tmp_path / key).is_file()

    # Opposite order: the successful send commits its FK reference before the
    # library-removal transaction acquires User -> Session -> StickerAsset.
    second_identity = _setup(factory, storage)
    user_id, _community_id, _slug, token, asset_id, key = second_identity
    sent, send_committed = Barrier(2), Event()

    def send_first():
        sent.wait(timeout=5)
        message, replay = _send(factory, second_identity, uuid4())
        send_committed.set()
        return message.id, replay

    def remove_after_send():
        sent.wait(timeout=5)
        assert send_committed.wait(timeout=5)
        sticker_library.remove_user_sticker(user_id, token, asset_id)
        return "removed"

    with ThreadPoolExecutor(max_workers=2) as pool:
        send_future = pool.submit(send_first)
        remove_future = pool.submit(remove_after_send)
        message_id, replay = send_future.result(timeout=10)
        assert remove_future.result(timeout=10) == "removed"
    assert replay is False
    with factory() as db:
        message = db.get(DiscussionMessage, message_id)
        asset = db.get(StickerAsset, asset_id)
        assert message.custom_sticker_id == asset_id
        assert asset.removed_at is not None
    assert (tmp_path / key).is_file()


def test_simultaneous_identical_custom_sends_have_one_winner(pg_resource, tmp_path):
    factory = pg_resource.factory
    storage = LocalFileSystemStorage(tmp_path)
    identity = _setup(factory, storage)
    barrier = Barrier(2)
    client_id = uuid4()

    def concurrent_send():
        barrier.wait(timeout=5)
        return _send(factory, identity, client_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(concurrent_send) for _ in range(2)]
        results = [future.result(timeout=10) for future in futures]
    assert sorted(replay for _message, replay in results) == [False, True]
    assert results[0][0].id == results[1][0].id
    with factory() as db:
        assert db.query(DiscussionMessage).filter_by(client_message_id=client_id).count() == 1


def test_message_insert_rollback_preserves_library_asset(pg_resource, tmp_path):
    factory = pg_resource.factory
    storage = LocalFileSystemStorage(tmp_path)
    identity = _setup(factory, storage)
    asset_id, key = identity[4], identity[5]
    engine = factory.kw["bind"]

    def fail_before_commit(session):
        if session.bind is engine:
            raise IntegrityError("controlled rollback", {}, RuntimeError("test"))

    event.listen(factory.class_, "before_commit", fail_before_commit)
    try:
        with pytest.raises(IntegrityError):
            _send(factory, identity, uuid4())
    finally:
        event.remove(factory.class_, "before_commit", fail_before_commit)
    with factory() as db:
        assert db.get(StickerAsset, asset_id) is not None
        assert db.query(DiscussionMessage).filter_by(custom_sticker_id=asset_id).count() == 0
    assert (tmp_path / key).is_file()


def test_send_and_moderation_removal_leave_only_concealed_reference(pg_resource, tmp_path):
    factory = pg_resource.factory
    storage = LocalFileSystemStorage(tmp_path)
    identity = _setup(factory, storage)
    message, replay = _send(factory, identity, uuid4())
    assert replay is False
    with factory() as db:
        assert remove_content(db, identity[1], identity[0], "discussion_message", message.id)
    with factory() as db:
        stored = db.get(DiscussionMessage, message.id)
        assert stored.removed_at is not None
        assert stored.custom_sticker_id == identity[4]


def test_idempotent_retry_racing_moderation_removal_is_concealed(pg_resource, tmp_path):
    factory = pg_resource.factory
    storage = LocalFileSystemStorage(tmp_path)
    identity = _setup(factory, storage)
    client_id = uuid4()
    original, replay = _send(factory, identity, client_id)
    assert replay is False
    start = Barrier(2)

    def retry():
        start.wait(timeout=5)
        try:
            _message, is_replay = _send(factory, identity, client_id)
            return "replay" if is_replay else "duplicate"
        except HTTPException as error:
            return error.status_code

    def moderate():
        start.wait(timeout=5)
        with factory() as db:
            remove_content(db, identity[1], identity[0], "discussion_message", original.id)
        return "removed"

    with ThreadPoolExecutor(max_workers=2) as pool:
        retry_future = pool.submit(retry)
        remove_future = pool.submit(moderate)
        retry_result = retry_future.result(timeout=10)
        assert remove_future.result(timeout=10) == "removed"
    assert retry_result in {"replay", 409}
    with factory() as db:
        stored = db.get(DiscussionMessage, original.id)
        assert stored.removed_at is not None
        assert stored.custom_sticker_id == identity[4]
