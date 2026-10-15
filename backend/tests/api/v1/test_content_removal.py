"""Moderation fixtures use only fresh SQLite databases, never application URLs."""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.websockets import WebSocketState

from app.api.v1.endpoints import discussion as discussion_api
from app.core.broadcaster import Connection, DiscussionBroadcaster
from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models import (Announcement, AnnouncementReply, Community, CommunityPost,
                        CommunityPostReply, DiscussionMessage, DiscussionReaction,
                        Document, ManagementEvent, Module, User)
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.membership_permission import MembershipPermission, PermissionType
from app.schemas.discussion import DiscussionMessageCreate
from app.services.content_removal import remove_content
from app.services.discussion import create_discussion_message

KINDS = ("announcement", "announcement_reply", "community_post", "community_post_reply", "discussion_message")
MODELS = dict(zip(KINDS, (Announcement, AnnouncementReply, CommunityPost, CommunityPostReply, DiscussionMessage)))
ROOT = "/api/v1/communities/irm"


@pytest.fixture
def portal(monkeypatch):
    engine = create_engine("sqlite:///:memory:", poolclass=StaticPool,
                           connect_args={"check_same_thread": False})
    assert engine.url.get_backend_name() == "sqlite" and engine.url.database == ":memory:"
    event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    communities = [Community(name=slug, slug=slug) for slug in ("irm", "foreign")]
    users = {name: User(username=name, email=f"{name}@example.test", password_hash="fixture",
                        first_name="Fixture", family_name="User")
             for name in ("delegate", "member", "moderator", "pending", "inactive", "outsider", "nonmember")}
    db.add_all([*communities, *users.values()]); db.flush()
    for name, role, state, community in (
        ("delegate", "DELEGATE", "ACTIVE", communities[0]), ("member", "MEMBER", "ACTIVE", communities[0]),
        ("moderator", "MODERATOR", "ACTIVE", communities[0]), ("pending", "DELEGATE", "PENDING", communities[0]),
        ("inactive", "DELEGATE", "REJECTED", communities[0]), ("outsider", "DELEGATE", "ACTIVE", communities[1]),
    ):
        membership = Membership(user_id=users[name].id, community_id=community.id, cne="fixture",
                                role=MembershipRole(role), status=MembershipStatus(state))
        db.add(membership); db.flush()
        if name == "moderator":
            for permission in PermissionType:
                db.add(MembershipPermission(membership_id=membership.id, permission=permission))
    db.commit()
    tokens = {name: create_session(db, user.id, timedelta(days=1))[0] for name, user in users.items()}

    def contents(community):
        announcement = Announcement(community_id=community.id, author_id=users["member"].id,
                                    title="Announcement", content="original announcement")
        post = CommunityPost(community_id=community.id, author_id=users["member"].id,
                             title="Post", content="original post")
        message = DiscussionMessage(community_id=community.id, author_id=users["member"].id,
                                    kind="TEXT", content="original message", client_message_id=uuid4())
        db.add_all([announcement, post, message]); db.flush()
        ar = AnnouncementReply(announcement_id=announcement.id, author_id=users["member"].id, content="original announcement reply")
        pr = CommunityPostReply(post_id=post.id, author_id=users["member"].id, content="original post reply")
        db.add_all([ar, pr]); db.commit()
        return dict(zip(KINDS, (announcement, ar, post, pr, message)))

    targets, foreign = contents(communities[0]), contents(communities[1])
    module = Module(community_id=communities[0].id, slug="fixture", name="Module")
    db.add(module); db.flush()
    targets["community_post"].modules.append(module)
    document = Document(module_id=module.id, uploader_id=users["member"].id, title="Preserved",
                        type="COURSE", source="OFFICIAL", status="APPROVED", storage_path="fixture.pdf")
    db.add(document); db.commit()

    def override_db():
        with factory() as session:
            yield session

    original_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr(discussion_api, "SessionLocal", factory)
    monkeypatch.setattr("app.api.account_mutation_route.SessionLocal", factory)
    with TestClient(app, headers={"Origin": settings.frontend_url.rstrip("/")}) as client:
        def login(name="delegate"):
            client.cookies.clear()
            if name != "guest": client.cookies.set(settings.session_cookie_name, tokens[name])
        yield SimpleNamespace(db=db, client=client, login=login, users=users, communities=communities,
                              targets=targets, foreign=foreign, module=module, document=document, factory=factory)
    app.dependency_overrides.clear(); app.dependency_overrides.update(original_overrides)
    db.close(); engine.dispose()


def path(portal, kind, *, foreign=False):
    targets = portal.foreign if foreign else portal.targets
    obj = targets[kind]
    if kind == "announcement": return f"{ROOT}/announcements/{obj.id}"
    if kind == "announcement_reply": return f"{ROOT}/announcements/{targets['announcement'].id}/replies/{obj.id}"
    if kind == "community_post": return f"{ROOT}/posts/{obj.id}"
    if kind == "community_post_reply": return f"{ROOT}/posts/{targets['community_post'].id}/replies/{obj.id}"
    return f"{ROOT}/discussion/messages/{obj.id}"


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("actor,expected", [("guest", 401), ("nonmember", 403), ("pending", 403),
    ("inactive", 403), ("member", 403), ("moderator", 403), ("outsider", 403)])
def test_authorization_before_content_lookup(portal, kind, actor, expected):
    portal.login(actor)
    for target in (path(portal, kind), path(portal, kind).rsplit("/", 1)[0] + "/" + str(uuid4())):
        response = portal.client.delete(target)
        assert response.status_code == expected
        assert response.headers["cache-control"] == "private, no-store"
    assert portal.db.query(ManagementEvent).count() == 0


@pytest.mark.parametrize("kind", KINDS)
def test_removal_repeat_scope_and_source_preservation(portal, kind):
    portal.login()
    assert portal.client.delete(path(portal, kind, foreign=True)).status_code == 404
    assert portal.client.delete(path(portal, kind).rsplit("/", 1)[0] + "/" + str(uuid4())).status_code == 404
    obj = portal.targets[kind]
    original_body = obj.content
    response = portal.client.delete(path(portal, kind))
    assert response.status_code == 204 and response.content == b""
    assert response.headers["cache-control"] == "private, no-store"
    portal.db.expire_all()
    timestamp, actor = obj.removed_at, obj.removed_by_id
    assert timestamp and actor == portal.users["delegate"].id
    assert portal.client.delete(path(portal, kind)).status_code == 204
    portal.db.expire_all()
    assert (obj.removed_at, obj.removed_by_id, obj.content) == (timestamp, actor, original_body)
    logs = portal.db.query(ManagementEvent).all()
    assert len(logs) == 1
    log = logs[0]
    assert (log.community_id, log.actor_id, log.action, log.target_type, log.target_id) == (
        portal.communities[0].id, actor, "remove", kind, obj.id)
    assert log.created_at == timestamp
    assert set(ManagementEvent.__table__.columns.keys()) == {
        "id", "community_id", "actor_id", "action", "target_type", "target_id", "created_at"}
    assert portal.db.query(User).count() == 7 and portal.db.query(Module).count() == 1
    assert portal.db.get(Document, portal.document.id).storage_path == "fixture.pdf"
    assert portal.db.query(Membership).count() == 6
    assert all(portal.db.query(model).count() == 2 for model in MODELS.values())


@pytest.mark.parametrize("kind,parent", [("announcement_reply", "announcement"), ("community_post_reply", "community_post")])
def test_reply_wrong_parent_and_removed_parent(portal, kind, parent):
    portal.login()
    wrong = path(portal, kind).replace(str(portal.targets[parent].id), str(portal.foreign[parent].id))
    assert portal.client.delete(wrong).status_code == 404
    assert portal.client.delete(path(portal, parent)).status_code == 204
    replies = path(portal, parent) + "/replies"
    assert portal.client.get(path(portal, parent)).status_code == 404
    assert portal.client.get(replies).status_code == 404
    assert portal.client.post(replies, json={"content": "new reply"}).status_code == 404
    assert portal.client.delete(path(portal, kind)).status_code == 404
    portal.db.expire_all()
    assert portal.targets[kind].removed_at is None  # Parent removal does not rewrite children.


@pytest.mark.parametrize("kind", KINDS)
def test_log_failure_rolls_back_removal(portal, kind):
    def fail_log(session, *_):
        if any(isinstance(obj, ManagementEvent) for obj in session.new): raise RuntimeError("audit failure")
    event.listen(Session, "before_flush", fail_log)
    try:
        parent = portal.targets["announcement" if kind == "announcement_reply" else "community_post"].id if "reply" in kind else None
        with pytest.raises(RuntimeError, match="audit failure"):
            remove_content(portal.db, portal.communities[0].id, portal.users["delegate"].id,
                           kind, portal.targets[kind].id, parent)
    finally:
        event.remove(Session, "before_flush", fail_log)
    portal.db.expire_all()
    assert portal.targets[kind].removed_at is None
    assert portal.db.query(ManagementEvent).count() == 0


@pytest.mark.parametrize("kind,parent,model,fk", [
    ("announcement_reply", "announcement", AnnouncementReply, "announcement_id"),
    ("community_post_reply", "community_post", CommunityPostReply, "post_id"),
])
def test_removed_reply_cursor_and_filter_before_lookahead(portal, kind, parent, model, fk):
    portal.login()
    timestamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    existing = portal.targets[kind]; existing.created_at = timestamp; existing.id = UUID(int=1)
    rows = [model(id=UUID(int=i), **{fk: portal.targets[parent].id}, author_id=portal.users["member"].id,
                  content=f"reply {i}", created_at=timestamp) for i in range(2, 8)]
    portal.db.add_all(rows); portal.db.commit()
    url = path(portal, parent) + "/replies"
    assert portal.client.delete(url + "/" + str(rows[1].id)).status_code == 204
    assert portal.client.delete(url + "/" + str(rows[2].id)).status_code == 204
    page = portal.client.get(url, params={"limit": 2}).json()
    assert [UUID(item["id"]).int for item in page["items"]] == [1, 2]
    # The returned cursor itself can be removed before the next request.
    assert portal.client.delete(url + "/" + page["next_cursor"]).status_code == 204
    next_page = portal.client.get(url, params={"limit": 2, "after": page["next_cursor"]}).json()
    assert [UUID(item["id"]).int for item in next_page["items"]] == [5, 6]
    final = portal.client.get(url, params={"limit": 2, "after": next_page["next_cursor"]}).json()
    assert [UUID(item["id"]).int for item in final["items"]] == [7] and final["next_cursor"] is None
    assert portal.client.get(url, params={"after": str(portal.foreign[kind].id)}).status_code == 400
    assert portal.client.get(url, params={"after": str(uuid4())}).status_code == 400
    assert portal.client.get(url, params={"after": "malformed"}).status_code == 422


def test_announcement_latest_and_post_feed_module_cursor(portal):
    portal.login()
    stamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for model, collection in [(Announcement, "announcements"), (CommunityPost, "posts")]:
        parent_kind = "announcement" if model is Announcement else "community_post"
        portal.targets[parent_kind].created_at = stamp + timedelta(seconds=1)
        rows = [model(id=UUID(int=100+i), community_id=portal.communities[0].id,
                      author_id=portal.users["member"].id, title=f"title {i}", content=f"body {i}",
                      created_at=stamp) for i in range(6)]
        portal.db.add_all(rows)
        if model is CommunityPost:
            for row in rows: row.modules.append(portal.module)
        portal.db.commit()
        for row in rows[3:]:
            assert portal.client.delete(f"{ROOT}/{collection}/{row.id}").status_code == 204
        params = {"limit": 2}
        if model is CommunityPost: params["module_id"] = str(portal.module.id)
        response = portal.client.get(f"{ROOT}/{collection}", params=params).json()
        items = response if model is Announcement else response["items"]
        # Existing fixture content is newer than these rows; latest SQL filtering
        # still fills the page from the next visible rows, not removed rows.
        assert [item['id'] for item in items] == [str(portal.targets[parent_kind].id), str(rows[2].id)]
        if model is CommunityPost:
            older = portal.client.get(f"{ROOT}/posts", params={**params, "after": str(rows[4].id)}).json()
            assert [item['id'] for item in older['items']] == [str(rows[2].id), str(rows[1].id)]
            tail = portal.client.get(f"{ROOT}/posts", params={**params, "after": older['next_cursor']}).json()
            assert [item['id'] for item in tail['items']] == [str(rows[0].id)] and tail['next_cursor'] is None
            assert portal.client.get(f"{ROOT}/posts", params={**params, "after": str(portal.foreign['community_post'].id)}).status_code == 400


@pytest.mark.parametrize("kind,payload", [("TEXT", {"content": "secret text"}),
                                         ("STICKER", {"sticker_id": "pepe_thumbs_up"})])
def test_discussion_removal_replay_reactions_and_postcommit_event(portal, monkeypatch, kind, payload):
    portal.login("member")
    url = f"{ROOT}/discussion/messages"
    body = {"kind": kind, "client_message_id": str(uuid4()), **payload}
    created = portal.client.post(url, json=body)
    assert created.status_code == 201
    message_id = created.json()["id"]
    assert portal.client.post(url, json=body).status_code == 200
    assert portal.client.put(f"{url}/{message_id}/reaction", json={"emoji": "heart"}).status_code == 200
    events = []
    async def broadcast(slug, shared):
        # A separate session sees the committed state and event before broadcast.
        with portal.factory() as db:
            assert db.get(DiscussionMessage, UUID(message_id)).removed_at is not None
            assert db.query(ManagementEvent).filter_by(target_id=UUID(message_id)).count() == 1
        events.append((slug, shared))
    monkeypatch.setattr(discussion_api.broadcaster, "broadcast", broadcast)
    portal.login()
    assert portal.client.delete(f"{url}/{message_id}").status_code == 204
    assert portal.client.delete(f"{url}/{message_id}").status_code == 204
    assert events == [("irm", {"type": "message_removed", "community_slug": "irm", "message_id": message_id})]
    assert "author_id" not in events[0][1]
    assert set(events[0][1]) == {"type", "community_slug", "message_id"}
    assert "secret" not in str(events) and "sticker_id" not in str(events)
    portal.login("member")
    replay = portal.client.post(url, json=body)
    assert replay.status_code == 409 and "secret text" not in replay.text and "pepe_thumbs_up" not in replay.text
    assert portal.client.put(f"{url}/{message_id}/reaction", json={"emoji": "heart"}).status_code == 404
    assert portal.client.delete(f"{url}/{message_id}/reaction").status_code == 404
    for params in ({}, {"before": message_id}, {"after": message_id}):
        response = portal.client.get(url, params=params)
        assert response.status_code == 200 and all(item["id"] != message_id for item in response.json()["items"])
    assert portal.db.query(DiscussionReaction).count() == 1


def test_removal_broadcast_failure_is_committed(portal, monkeypatch):
    portal.login()
    async def fail(*_): raise RuntimeError("broadcast unavailable")
    monkeypatch.setattr(discussion_api.broadcaster, "broadcast", fail)
    assert portal.client.delete(path(portal, "discussion_message")).status_code == 204
    portal.db.expire_all()
    assert portal.targets["discussion_message"].removed_at is not None
    assert portal.db.query(ManagementEvent).count() == 1


def test_discussion_history_removed_cursor_and_bounded_paging(portal):
    portal.login()
    stamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    target = portal.targets["discussion_message"]; target.created_at = stamp; target.id = UUID(int=1)
    rows = [DiscussionMessage(id=UUID(int=i), community_id=portal.communities[0].id,
                             author_id=portal.users["member"].id, kind="TEXT", content=f"message {i}",
                             client_message_id=uuid4(), created_at=stamp) for i in range(2, 9)]
    portal.db.add_all(rows); portal.db.commit()
    url = f"{ROOT}/discussion/messages"
    for row in rows[2:4]: assert portal.client.delete(f"{url}/{row.id}").status_code == 204
    latest = portal.client.get(url, params={"limit": 3}).json()
    assert [UUID(item["id"]).int for item in latest["items"]] == [6, 7, 8]
    assert latest["has_more_older"]
    assert portal.client.delete(f"{url}/{UUID(int=6)}").status_code == 204
    older = portal.client.get(url, params={"limit": 3, "before": str(UUID(int=6))}).json()
    assert [UUID(item["id"]).int for item in older["items"]] == [1, 2, 3]
    newer = portal.client.get(url, params={"limit": 3, "after": str(UUID(int=3))}).json()
    assert [UUID(item["id"]).int for item in newer["items"]] == [7, 8]
    assert not newer["has_more_newer"]
    assert portal.client.get(url, params={"after": str(portal.foreign['discussion_message'].id)}).status_code == 404
    assert portal.client.get(url, params={"after": "bad"}).status_code == 422


def test_stale_create_and_reaction_results_do_not_escape_removal(portal, monkeypatch):
    portal.login("member")
    msg = portal.targets["discussion_message"]
    def remove_then_return(*_, **__):
        with portal.factory() as db:
            remove_content(db, portal.communities[0].id, portal.users['delegate'].id, "discussion_message", msg.id)
        return msg, False
    broadcasts = AsyncMock()
    monkeypatch.setattr(discussion_api, "create_discussion_message", remove_then_return)
    monkeypatch.setattr(discussion_api.broadcaster, "broadcast", broadcasts)
    response = portal.client.post(f"{ROOT}/discussion/messages", json={"kind": "TEXT", "client_message_id": str(uuid4()), "content": "retry"})
    assert response.status_code == 409 and msg.content not in response.text
    broadcasts.assert_not_awaited()


def test_stale_reaction_result_is_not_broadcast(portal, monkeypatch):
    portal.login("member")
    msg = portal.targets["discussion_message"]
    def remove_then_return(*_, **__):
        with portal.factory() as db:
            remove_content(db, portal.communities[0].id, portal.users['delegate'].id, "discussion_message", msg.id)
        return msg.id, [], 'heart'
    broadcasts = AsyncMock()
    monkeypatch.setattr(discussion_api, "set_discussion_reaction", remove_then_return)
    monkeypatch.setattr(discussion_api.broadcaster, "broadcast", broadcasts)
    response = portal.client.put(f"{ROOT}/discussion/messages/{msg.id}/reaction", json={"emoji": "heart"})
    assert response.status_code == 404
    broadcasts.assert_not_awaited()


def test_sender_purges_removed_payload_and_checks_late_events(portal):
    msg = portal.targets["discussion_message"]
    async def run():
        socket = MagicMock(); socket.client_state = WebSocketState.CONNECTED; socket.send_json = AsyncMock()
        conn = Connection(socket, portal.users["member"].id, "irm", discussion_api.check_message_visible)
        created = {"type": "message_created", "message": {"id": str(msg.id), "content": "secret"}}
        conn.enqueue(created)
        conn.enqueue({"type": "reaction_changed", "message_id": str(msg.id), "reactions": []})
        removal = {"type": "message_removed", "community_slug": "irm", "message_id": str(msg.id)}
        conn.enqueue(removal)
        assert conn.queue.qsize() == 1
        with portal.factory() as db:
            remove_content(db, portal.communities[0].id, portal.users["delegate"].id, "discussion_message", msg.id)
        conn.enqueue(created)  # Late creation event, after removal event delivery/failure.
        sender = asyncio.create_task(conn.send_loop())
        await asyncio.wait_for(conn.queue.join(), timeout=2)
        socket.send_json.assert_awaited_once_with(removal)
        sender.cancel()
        with pytest.raises(asyncio.CancelledError):
            await sender
    asyncio.run(run())


def test_removed_idempotency_integrity_error_recovery(portal, monkeypatch):
    msg = portal.targets["discussion_message"]
    remove_content(portal.db, portal.communities[0].id, portal.users['delegate'].id, "discussion_message", msg.id)
    # Force a fast-path miss to exercise the uniqueness-conflict recovery path.
    original_query = portal.db.query
    first = True
    def query(*entities, **kwargs):
        nonlocal first
        result = original_query(*entities, **kwargs)
        if first and entities == (DiscussionMessage,):
            first = False
            return result.filter(DiscussionMessage.id == uuid4())
        return result
    monkeypatch.setattr(portal.db, "query", query)
    with pytest.raises(HTTPException) as exc:
        create_discussion_message(portal.db, "irm", portal.users["member"],
            DiscussionMessageCreate(kind="TEXT", content=msg.content, client_message_id=msg.client_message_id))
    assert exc.value.status_code == 409
    assert original_query(DiscussionMessage).filter_by(client_message_id=msg.client_message_id).count() == 1


def test_removal_event_is_community_scoped_and_visibility_errors_fail_closed():
    async def run():
        bc = DiscussionBroadcaster()
        connections = []
        for slug in ('irm', 'foreign'):
            socket = MagicMock(); socket.client_state = WebSocketState.CONNECTED
            socket.send_json = AsyncMock(); socket.close = AsyncMock()
            def unavailable(*_): raise RuntimeError('database unavailable')
            conn = Connection(socket, uuid4(), slug, unavailable)
            await bc.connect(conn); connections.append(conn)
        msg_id = str(uuid4())
        await bc.broadcast('irm', {'type': 'message_created', 'message': {'id': msg_id, 'content': 'secret'}})
        await asyncio.wait_for(connections[0].queue.join(), timeout=2)
        removal = {'type': 'message_removed', 'community_slug': 'irm', 'message_id': msg_id}
        await bc.broadcast('irm', removal)
        await asyncio.wait_for(connections[0].queue.join(), timeout=2)
        connections[0].websocket.send_json.assert_awaited_once_with(removal)
        connections[1].websocket.send_json.assert_not_awaited()
        await bc.shutdown()
    asyncio.run(run())
