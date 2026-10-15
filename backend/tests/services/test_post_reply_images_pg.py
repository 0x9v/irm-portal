"""Lease-guarded PostgreSQL migration and same-request concurrency tests."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier
from uuid import uuid4

from PIL import Image
from io import BytesIO
import pytest
from fastapi import HTTPException
from sqlalchemy import MetaData, Table, insert, inspect, select, text
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database, migrate
from app.core.post_reply_images import process_post_reply_image
from app.core.storage.local import LocalFileSystemStorage
from app.models.community import Community
from app.models.community_post import CommunityPost
from app.models.community_post_reply import CommunityPostReply
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.user import User
from app.services import post_reply_images as service
from app.services.content_removal import remove_content


PREVIOUS_HEAD = "d1e2f3a4b5c6"
NEW_HEAD = "e8a4f6b1c932"


def _image():
    stream = BytesIO()
    Image.new("RGB", (80, 40), "navy").save(stream, format="JPEG")
    raw = stream.getvalue()
    return raw, process_post_reply_image(raw, "image/jpeg")


def test_migration_preserves_legacy_rows_and_guards_downgrade():
    with disposable_database(upgrade=False) as resource:
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)
        with Session(resource.engine) as session:
            user = User(username="reply_migration", email="reply-migration@example.invalid",
                        password_hash="opaque", first_name="Legacy", family_name="Reply")
            community = Community(name="Reply migration", slug="reply-migration")
            session.add_all([user, community])
            session.flush()
            post = CommunityPost(community_id=community.id, author_id=user.id,
                                 title="Legacy post", content="text")
            session.add(post)
            session.flush()
            original_id, post_id, author_id = uuid4(), post.id, user.id
            session.commit()
        with resource.engine.begin() as connection:
            legacy = Table("community_post_replies", MetaData(), autoload_with=connection)
            connection.execute(insert(legacy), {
                "id": original_id, "post_id": post_id, "author_id": author_id,
                "content": "legacy reply", "created_at": datetime.now(timezone.utc),
                "removed_at": None, "removed_by_id": None,
            })
        migrate(resource.engine, resource.lease, NEW_HEAD)
        columns = {column["name"] for column in inspect(resource.engine).get_columns("community_post_replies")}
        assert {"image_storage_key", "client_request_id", "request_fingerprint"}.issubset(columns)
        with Session(resource.engine) as session:
            legacy_reply = session.get(CommunityPostReply, original_id)
            assert legacy_reply.content == "legacy reply" and legacy_reply.image_storage_key is None
            legacy_reply.client_request_id = uuid4()
            legacy_reply.request_fingerprint = "a" * 64
            session.commit()
        with pytest.raises(RuntimeError, match="Cannot downgrade: community post reply image/request data is populated"):
            migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        with resource.engine.begin() as connection:
            connection.execute(text("UPDATE community_post_replies SET client_request_id=NULL, request_fingerprint=NULL WHERE id=:id"), {"id": original_id})
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        assert "image_storage_key" not in {column["name"] for column in inspect(resource.engine).get_columns("community_post_replies")}


def test_concurrent_matching_requests_create_one_row_and_one_file(tmp_path, monkeypatch):
    with disposable_database() as resource:
        factory = resource.factory
        with factory() as session:
            user = User(username="reply_concurrent", email="reply-concurrent@example.invalid",
                        password_hash="opaque", first_name="Concurrent", family_name="Reply")
            community = Community(name="Reply concurrency", slug="reply-concurrency")
            session.add_all([user, community])
            session.flush()
            session.add(Membership(user_id=user.id, community_id=community.id, status=MembershipStatus.ACTIVE))
            post = CommunityPost(community_id=community.id, author_id=user.id,
                                 title="Concurrent post", content="text")
            session.add(post)
            session.commit()
            # Preserve scalar UUIDs before this session closes.
            author_id, post_id, community_slug = user.id, post.id, community.slug
        monkeypatch.setattr(service, "SessionLocal", factory)
        storage = LocalFileSystemStorage(tmp_path)
        raw, canonical = _image()
        request_id = uuid4()
        barrier = Barrier(2)

        def create_one():
            with factory() as session:
                barrier.wait(timeout=5)
                reply, replay = service.create_image_reply(
                    db=session, community_slug=community_slug, post_id=post_id,
                    author_id=author_id, client_request_id=request_id,
                    content="same", declared_mime="image/jpeg", raw_image=raw,
                    canonical_image=canonical, storage=storage,
                )
                return reply.id, replay

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: create_one(), range(2)))
        assert len({reply_id for reply_id, _ in results}) == 1
        assert sum(is_replay for _, is_replay in results) == 1
        with factory() as session:
            assert session.query(CommunityPostReply).filter_by(post_id=post_id).count() == 1
        assert len(list(tmp_path.rglob("*.jpg"))) == 1


def test_reply_creation_serializes_with_parent_removal_and_media_stays_hidden(tmp_path, monkeypatch):
    with disposable_database() as resource:
        factory = resource.factory
        with factory() as session:
            member = User(username="reply_race_member", email="reply-race-member@example.invalid",
                          password_hash="opaque", first_name="Race", family_name="Member")
            delegate = User(username="reply_race_delegate", email="reply-race-delegate@example.invalid",
                            password_hash="opaque", first_name="Race", family_name="Delegate")
            community = Community(name="Reply removal race", slug="reply-removal-race")
            session.add_all([member, delegate, community])
            session.flush()
            session.add_all([
                Membership(user_id=member.id, community_id=community.id, status=MembershipStatus.ACTIVE),
                Membership(user_id=delegate.id, community_id=community.id, role=MembershipRole.DELEGATE,
                           status=MembershipStatus.ACTIVE),
            ])
            post = CommunityPost(community_id=community.id, author_id=member.id,
                                 title="Race post", content="text")
            session.add(post)
            session.commit()
            author_id, delegate_id, community_id, slug, post_id = (
                member.id, delegate.id, community.id, community.slug, post.id
            )
        monkeypatch.setattr(service, "SessionLocal", factory)
        storage = LocalFileSystemStorage(tmp_path)
        raw, canonical = _image()
        request_id = uuid4()
        barrier = Barrier(2)

        def create_reply():
            with factory() as session:
                barrier.wait(timeout=5)
                try:
                    reply, replay = service.create_image_reply(
                        db=session, community_slug=slug, post_id=post_id,
                        author_id=author_id, client_request_id=request_id,
                        content="race", declared_mime="image/jpeg", raw_image=raw,
                        canonical_image=canonical, storage=storage,
                    )
                    return reply.id, replay
                except HTTPException as error:
                    return error.status_code, False

        def remove_parent():
            with factory() as session:
                barrier.wait(timeout=5)
                return remove_content(session, community_id, delegate_id, "community_post", post_id)

        with ThreadPoolExecutor(max_workers=2) as pool:
            created = pool.submit(create_reply)
            removed = pool.submit(remove_parent)
            result = created.result(timeout=10)
            assert removed.result(timeout=10) is True
        with factory() as session:
            parent = session.get(CommunityPost, post_id)
            assert parent.removed_at is not None
            reply = session.query(CommunityPostReply).filter_by(post_id=post_id).one_or_none()
            reply_id = reply.id if reply is not None else None
        if reply_id is not None:
            with factory() as session, pytest.raises(HTTPException) as hidden:
                service.read_private_reply_image(
                    db=session, community_slug=slug, post_id=post_id, reply_id=reply_id,
                    caller_user_id=author_id, storage=storage,
                )
            assert hidden.value.status_code == 404
            assert len(list(tmp_path.rglob("*.jpg"))) == 1
        else:
            assert result[0] == 404
            assert list(tmp_path.rglob("*.jpg")) == []
