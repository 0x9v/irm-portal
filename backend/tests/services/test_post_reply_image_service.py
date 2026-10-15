from datetime import datetime, timezone
from io import BytesIO
from uuid import uuid4

from fastapi import HTTPException
from PIL import Image
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.post_reply_images import process_post_reply_image
from app.core.storage.local import LocalFileSystemStorage
from app.database import Base
from app.models.community import Community
from app.models.community_post import CommunityPost
from app.models.community_post_reply import CommunityPostReply
from app.models.membership import Membership, MembershipStatus
from app.models.user import User
from app.services import post_reply_images as service


def _image():
    output = BytesIO()
    Image.new("RGB", (64, 48), "teal").save(output, format="PNG")
    raw = output.getvalue()
    return raw, process_post_reply_image(raw, "image/png")


@pytest.fixture
def context(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    with factory() as db:
        user = User(username="reply_service", email="reply-service@example.invalid", password_hash="x",
                    first_name="Reply", family_name="Service")
        community = Community(name="Reply service", slug="reply-service")
        db.add_all([user, community])
        db.flush()
        db.add(Membership(user_id=user.id, community_id=community.id, status=MembershipStatus.ACTIVE))
        post = CommunityPost(community_id=community.id, author_id=user.id, title="Post", content="Body")
        db.add(post)
        db.commit()
        # Carry scalar ids across the session boundary.
        values = (user.id, community.id, community.slug, post.id)
    storage = LocalFileSystemStorage(tmp_path)
    monkeypatch.setattr(service, "SessionLocal", factory)
    yield factory, storage, tmp_path, values
    Base.metadata.drop_all(engine)
    engine.dispose()


def _create(factory, storage, values, request_id=None, *, text="caption", raw=None, canonical=None):
    author_id, community_id, slug, post_id = values
    raw = raw if raw is not None else None
    with factory() as db:
        reply, replay = service.create_image_reply(
            db=db, community_slug=slug, post_id=post_id, author_id=author_id,
            client_request_id=request_id or uuid4(), content=text,
            declared_mime="image/png" if raw is not None else "",
            raw_image=raw, canonical_image=canonical, storage=storage,
        )
        return reply.id, replay


def test_matching_retry_returns_original_and_removed_retry_conflicts(context):
    factory, storage, root, values = context
    raw, canonical = _image()
    request_id = uuid4()
    original_id, replay = _create(factory, storage, values, request_id, raw=raw, canonical=canonical)
    same_id, replayed = _create(factory, storage, values, request_id, raw=raw, canonical=canonical)
    assert replay is False and replayed is True and same_id == original_id
    assert len(list(root.rglob("*.jpg"))) == 1
    with factory() as db:
        stored = db.query(CommunityPostReply).filter_by(id=original_id).one()
        stored.removed_at = datetime.now(timezone.utc)
        db.commit()
    with pytest.raises(HTTPException) as error:
        _create(factory, storage, values, request_id, raw=raw, canonical=canonical)
    assert error.value.status_code == 409


@pytest.mark.parametrize("mode,expected_status,expected_files,expected_rows", [
    ("before", 500, 0, 0),
    ("after", 200, 1, 1),
])
def test_raised_commit_resolution_cleans_only_confirmed_rollback(
    context, monkeypatch, mode, expected_status, expected_files, expected_rows
):
    factory, storage, root, values = context
    raw, canonical = _image()
    real_commit = Session.commit
    state = {"raised": False}

    def raising_commit(session):
        if not state["raised"] and session.bind is factory.kw["bind"]:
            state["raised"] = True
            if mode == "after":
                real_commit(session)
            raise RuntimeError("simulated commit transport failure")
        return real_commit(session)

    monkeypatch.setattr(Session, "commit", raising_commit)
    request_id = uuid4()
    try:
        reply_id, replay = _create(factory, storage, values, request_id, raw=raw, canonical=canonical)
        status_code = 200 if replay else 201
        assert reply_id
    except HTTPException as error:
        status_code = error.status_code
    assert status_code == expected_status
    assert len(list(root.rglob("*.jpg"))) == expected_files
    with factory() as db:
        assert db.query(CommunityPostReply).count() == expected_rows


def test_unresolved_commit_retains_potentially_committed_media(context, monkeypatch):
    factory, storage, root, values = context
    raw, canonical = _image()
    real_commit = Session.commit
    state = {"raised": False}

    def fail_before_commit(session):
        if not state["raised"] and session.bind is factory.kw["bind"]:
            state["raised"] = True
            raise RuntimeError("simulated unknown commit result")
        return real_commit(session)

    monkeypatch.setattr(Session, "commit", fail_before_commit)
    monkeypatch.setattr(service, "SessionLocal", lambda: (_ for _ in ()).throw(OSError("resolver unavailable")))
    with pytest.raises(HTTPException) as error:
        _create(factory, storage, values, uuid4(), raw=raw, canonical=canonical)
    assert error.value.status_code == 503
    assert len(list(root.rglob("*.jpg"))) == 1


def test_private_read_requires_visible_reply_parent_and_active_member(context):
    factory, storage, _, values = context
    author_id, community_id, slug, post_id = values
    raw, canonical = _image()
    reply_id, _ = _create(factory, storage, values, raw=raw, canonical=canonical)
    with factory() as db:
        content = service.read_private_reply_image(
            db=db, community_slug=slug, post_id=post_id, reply_id=reply_id,
            caller_user_id=author_id, storage=storage,
        )
        assert content == canonical
        other_community = Community(name="Other reply service", slug="other-reply-service")
        db.add(other_community)
        db.flush()
        db.add(Membership(user_id=author_id, community_id=other_community.id, status=MembershipStatus.ACTIVE))
        wrong_community_slug = other_community.slug
        db.commit()
        with pytest.raises(HTTPException) as wrong_parent:
            service.read_private_reply_image(
                db=db, community_slug=slug, post_id=uuid4(), reply_id=reply_id,
                caller_user_id=author_id, storage=storage,
            )
        assert wrong_parent.value.status_code == 404
        with pytest.raises(HTTPException) as wrong_community:
            service.read_private_reply_image(
                db=db, community_slug=wrong_community_slug, post_id=post_id, reply_id=reply_id,
                caller_user_id=author_id, storage=storage,
            )
        assert wrong_community.value.status_code == 404
        membership = db.query(Membership).filter_by(user_id=author_id, community_id=community_id).one()
        membership.status = MembershipStatus.REMOVED
        db.commit()
    with factory() as db, pytest.raises(HTTPException) as denied:
        service.read_private_reply_image(
            db=db, community_slug=slug, post_id=post_id, reply_id=reply_id,
            caller_user_id=author_id, storage=storage,
        )
    assert denied.value.status_code == 403
