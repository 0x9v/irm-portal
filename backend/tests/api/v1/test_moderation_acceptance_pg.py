"""PostgreSQL Moderation Acceptance Tests for Subtask 0.1.7.

Tests the five removal endpoints, atomic persistence, concurrent repeated removal,
parent behavior, pagination lookahead filtering, and discussion behavior on real PostgreSQL.
Target DB: irm_integration_test
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier
from uuid import UUID, uuid4
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text, event
from sqlalchemy.orm import Session, sessionmaker

from app.api.v1.endpoints import discussion as discussion_api
from app.api.deps import get_db
from app.core.config import settings
from app.core.sessions import create_session
from app.main import app
from app.models import (
    Announcement,
    AnnouncementReply,
    Community,
    CommunityPost,
    CommunityPostReply,
    DiscussionMessage,
    DiscussionReaction,
    Document,
    ManagementEvent,
    Module,
    User,
)
from app.models.community_post import PostModule
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.membership_permission import MembershipPermission, PermissionType
from app.services.content_removal import remove_content
from app.services.discussion import set_discussion_reaction

engine = None
TestingSessionLocal = None
_owned_pg = None


@pytest.fixture(scope="module", autouse=True)
def owned_pg_factories(isolated_pg):
    global engine, TestingSessionLocal, _owned_pg
    engine, TestingSessionLocal, _owned_pg = isolated_pg.engine, isolated_pg.factory, isolated_pg
    yield
    engine = TestingSessionLocal = _owned_pg = None


KINDS = ("announcement", "announcement_reply", "community_post", "community_post_reply", "discussion_message")
MODELS = {
    "announcement": Announcement,
    "announcement_reply": AnnouncementReply,
    "community_post": CommunityPost,
    "community_post_reply": CommunityPostReply,
    "discussion_message": DiscussionMessage,
}
ROOT = "/api/v1/communities/irm"


def verify_test_db_identity(session: Session) -> None:
    _owned_pg.verify_session(session)


@pytest.fixture
def pg_portal(monkeypatch):
    # Guard check & clean truncation
    with TestingSessionLocal() as session:
        verify_test_db_identity(session)
        _owned_pg.truncate(session, ['management_events', 'discussion_reactions', 'discussion_messages', 'community_post_replies', 'post_modules', 'community_posts', 'announcement_replies', 'announcements', 'document_votes', 'documents', 'modules', 'membership_permissions', 'memberships', 'sessions', 'communities', 'users'])
        session.commit()

        # Seed test communities and users
        comm_irm_id = uuid4()
        comm_foreign_id = uuid4()
        comm_irm = Community(id=comm_irm_id, name="IRM Community", slug="irm", document_vote_threshold=10)
        comm_foreign = Community(id=comm_foreign_id, name="Foreign Community", slug="foreign", document_vote_threshold=10)
        session.add_all([comm_irm, comm_foreign])
        session.flush()

        user_names = ["delegate", "member", "moderator", "pending", "inactive", "outsider", "nonmember"]
        user_ids = {}
        users = {}
        for name in user_names:
            uid = uuid4()
            user_ids[name] = uid
            u = User(
                id=uid,
                username=name,
                email=f"{name}@test.invalid",
                password_hash="testhash",
                first_name="Test",
                family_name="User",
            )
            users[name] = u
            session.add(u)
        session.flush()

        # Seed memberships
        session.add(Membership(id=uuid4(), user_id=user_ids["delegate"], community_id=comm_irm_id, role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE, cne="CNE_DEL"))
        session.add(Membership(id=uuid4(), user_id=user_ids["member"], community_id=comm_irm_id, role=MembershipRole.MEMBER, status=MembershipStatus.ACTIVE, cne="CNE_MEM"))
        mod_m = Membership(id=uuid4(), user_id=user_ids["moderator"], community_id=comm_irm_id, role=MembershipRole.MODERATOR, status=MembershipStatus.ACTIVE, cne="CNE_MOD")
        session.add(mod_m)
        session.flush()
        for perm in PermissionType:
            session.add(MembershipPermission(membership_id=mod_m.id, permission=perm))
        session.add(Membership(id=uuid4(), user_id=user_ids["pending"], community_id=comm_irm_id, role=MembershipRole.DELEGATE, status=MembershipStatus.PENDING, cne="CNE_PEN"))
        session.add(Membership(id=uuid4(), user_id=user_ids["inactive"], community_id=comm_irm_id, role=MembershipRole.DELEGATE, status=MembershipStatus.REJECTED, cne="CNE_INACT"))
        session.add(Membership(id=uuid4(), user_id=user_ids["outsider"], community_id=comm_foreign_id, role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE, cne="CNE_OUT"))
        session.commit()

        tokens = {}
        for name, uid in user_ids.items():
            token, _ = create_session(session, uid, timedelta(days=1))
            tokens[name] = token
        session.commit()

        # Seed initial content in IRM and foreign
        def create_content(cid, slug):
            ann = Announcement(id=uuid4(), community_id=cid, author_id=user_ids["member"], title=f"Ann in {slug}", content="Ann body")
            post = CommunityPost(id=uuid4(), community_id=cid, author_id=user_ids["member"], title=f"Post in {slug}", content="Post body")
            msg = DiscussionMessage(id=uuid4(), community_id=cid, author_id=user_ids["member"], kind="TEXT", content="Msg body", client_message_id=uuid4())
            session.add_all([ann, post, msg])
            session.flush()
            ann_rep = AnnouncementReply(id=uuid4(), announcement_id=ann.id, author_id=user_ids["member"], content="Ann rep body")
            post_rep = CommunityPostReply(id=uuid4(), post_id=post.id, author_id=user_ids["member"], content="Post rep body")
            session.add_all([ann_rep, post_rep])
            session.commit()
            return (
                {"announcement": ann.id, "announcement_reply": ann_rep.id, "community_post": post.id, "community_post_reply": post_rep.id, "discussion_message": msg.id},
                {"announcement": ann.content, "announcement_reply": ann_rep.content, "community_post": post.content, "community_post_reply": post_rep.content, "discussion_message": msg.content},
            )

        irm_target_ids, irm_contents = create_content(comm_irm_id, "irm")
        foreign_target_ids, foreign_contents = create_content(comm_foreign_id, "foreign")

        module_id = uuid4()
        module = Module(id=module_id, community_id=comm_irm_id, name="Test Module", slug="test-mod")
        session.add(module)
        session.flush()
        session.add(PostModule(post_id=irm_target_ids["community_post"], module_id=module_id))
        doc_id = uuid4()
        doc = Document(id=doc_id, module_id=module_id, uploader_id=user_ids["member"], title="Doc", type="COURSE", source="OFFICIAL", status="APPROVED", storage_path="/path/test.pdf", vote_threshold_snapshot=10)
        session.add(doc)
        session.commit()

    # Wire TestClient overrides
    def override_get_db():
        with TestingSessionLocal() as s:
            yield s

    original_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(discussion_api, "SessionLocal", TestingSessionLocal)

    class Portal:
        def __init__(self):
            self.client = TestClient(app)
            self.user_ids = user_ids
            self.tokens = tokens
            self.target_ids = irm_target_ids
            self.target_contents = irm_contents
            self.foreign_target_ids = foreign_target_ids
            self.comm_irm_id = comm_irm_id
            self.comm_irm_slug = "irm"
            self.comm_foreign_id = comm_foreign_id
            self.comm_foreign_slug = "foreign"
            self.module_id = module_id
            self.doc_id = doc_id

        def login(self, user_name="delegate"):
            self.client.cookies.clear()
            if user_name != "guest":
                self.client.cookies.set(settings.session_cookie_name, self.tokens[user_name])

    portal = Portal()
    try:
        yield portal
    finally:
        portal.client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)


def get_endpoint_path(portal, kind: str, foreign: bool = False) -> str:
    target_ids = portal.foreign_target_ids if foreign else portal.target_ids
    base = f"/api/v1/communities/{portal.comm_foreign_slug if foreign else portal.comm_irm_slug}"
    obj_id = target_ids[kind]
    if kind == "announcement":
        return f"{base}/announcements/{obj_id}"
    elif kind == "announcement_reply":
        return f"{base}/announcements/{target_ids['announcement']}/replies/{obj_id}"
    elif kind == "community_post":
        return f"{base}/posts/{obj_id}"
    elif kind == "community_post_reply":
        return f"{base}/posts/{target_ids['community_post']}/replies/{obj_id}"
    elif kind == "discussion_message":
        return f"{base}/discussion/messages/{obj_id}"
    raise ValueError(f"Unknown kind {kind}")


# ==============================================================================
# SECTION 6.1: ENDPOINTS & STATUS MATRIX & PRIVATE CACHE HEADERS
# ==============================================================================

@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("actor,expected_status", [
    ("guest", 401),
    ("nonmember", 403),
    ("pending", 403),
    ("inactive", 403),
    ("member", 403),
    ("moderator", 403),
    ("outsider", 403),
])
def test_moderation_authorization_matrix(pg_portal, kind, actor, expected_status):
    pg_portal.login(actor)
    url = get_endpoint_path(pg_portal, kind)
    res = pg_portal.client.delete(url)
    assert res.status_code == expected_status
    assert res.headers.get("cache-control") == "private, no-store"

    # Verify no audit event created on unauthorized attempt
    with TestingSessionLocal() as s:
        assert s.query(ManagementEvent).count() == 0


@pytest.mark.parametrize("kind", KINDS)
def test_moderation_unknown_and_cross_community_target_404(pg_portal, kind):
    pg_portal.login("delegate")
    # 1. Random unknown target UUID in valid community
    url = get_endpoint_path(pg_portal, kind).rsplit("/", 1)[0] + "/" + str(uuid4())
    res = pg_portal.client.delete(url)
    assert res.status_code == 404
    assert res.headers.get("cache-control") == "private, no-store"

    # 2. Foreign community target accessed via IRM delegate
    foreign_url = get_endpoint_path(pg_portal, kind, foreign=True)
    res_foreign = pg_portal.client.delete(foreign_url)
    # Since foreign_url has slug "foreign" and caller is IRM delegate, they lack authority -> 403
    assert res_foreign.status_code == 403


# ==============================================================================
# SECTION 6.A: ATOMIC PERSISTENCE & FIRST/REPEAT REMOVAL
# ==============================================================================

@pytest.mark.parametrize("kind", KINDS)
def test_atomic_persistence_and_repeat_removal(pg_portal, kind):
    pg_portal.login("delegate")
    url = get_endpoint_path(pg_portal, kind)
    target_id = pg_portal.target_ids[kind]
    original_content = pg_portal.target_contents[kind]

    # 1. First removal: 204
    res = pg_portal.client.delete(url)
    assert res.status_code == 204
    assert res.content == b""
    assert res.headers.get("cache-control") == "private, no-store"

    with TestingSessionLocal() as s:
        # Source row is retained
        model_cls = MODELS[kind]
        db_obj = s.get(model_cls, target_id)
        assert db_obj is not None
        assert db_obj.content == original_content
        assert db_obj.removed_at is not None
        assert db_obj.removed_by_id == pg_portal.user_ids["delegate"]
        first_removed_at = db_obj.removed_at

        # Exactly one management event
        events = s.query(ManagementEvent).all()
        assert len(events) == 1
        ev = events[0]
        assert ev.community_id == pg_portal.comm_irm_id
        assert ev.actor_id == pg_portal.user_ids["delegate"]
        assert ev.action == "remove"
        assert ev.target_type == kind
        assert ev.target_id == target_id
        assert ev.created_at == first_removed_at

    # 2. Repeated removal of same target: 204 (idempotent contract)
    res2 = pg_portal.client.delete(url)
    assert res2.status_code == 204
    assert res2.content == b""
    assert res2.headers.get("cache-control") == "private, no-store"

    with TestingSessionLocal() as s:
        model_cls = MODELS[kind]
        db_obj = s.get(model_cls, target_id)
        # Original removal metadata is preserved
        assert db_obj.removed_at == first_removed_at
        assert db_obj.removed_by_id == pg_portal.user_ids["delegate"]

        # No duplicate management event created
        events = s.query(ManagementEvent).all()
        assert len(events) == 1


@pytest.mark.parametrize("kind", KINDS)
def test_forced_error_before_commit_rolls_back_both(pg_portal, kind):
    def fail_event(session, *_):
        if any(isinstance(obj, ManagementEvent) for obj in session.new):
            raise RuntimeError("FORCED_AUDIT_ERROR")

    event.listen(Session, "before_flush", fail_event)
    target_id = pg_portal.target_ids[kind]

    try:
        with TestingSessionLocal() as s:
            parent_id = None
            if kind == "announcement_reply":
                parent_id = pg_portal.target_ids["announcement"]
            elif kind == "community_post_reply":
                parent_id = pg_portal.target_ids["community_post"]

            with pytest.raises(RuntimeError, match="FORCED_AUDIT_ERROR"):
                remove_content(
                    s,
                    pg_portal.comm_irm_id,
                    pg_portal.user_ids["delegate"],
                    kind,
                    target_id,
                    parent_id,
                )
    finally:
        event.remove(Session, "before_flush", fail_event)

    # Verify both source change and management event are rolled back
    with TestingSessionLocal() as s:
        model_cls = MODELS[kind]
        db_obj = s.get(model_cls, target_id)
        assert db_obj.removed_at is None
        assert db_obj.removed_by_id is None
        assert s.query(ManagementEvent).count() == 0


# ==============================================================================
# SECTION 6.B: CONCURRENT REPEATED REMOVAL ON REAL POSTGRESQL
# ==============================================================================

@pytest.mark.parametrize("kind", KINDS)
def test_concurrent_repeated_removal_pg(pg_portal, kind):
    target_id = pg_portal.target_ids[kind]
    parent_id = None
    if kind == "announcement_reply":
        parent_id = pg_portal.target_ids["announcement"]
    elif kind == "community_post_reply":
        parent_id = pg_portal.target_ids["community_post"]

    barrier = Barrier(4)
    actors = [pg_portal.user_ids["delegate"] for _ in range(4)]

    def worker(actor_id):
        with TestingSessionLocal() as s:
            barrier.wait(timeout=5)
            # Each thread executes remove_content with its own transaction on real PG
            return remove_content(
                s,
                pg_portal.comm_irm_id,
                actor_id,
                kind,
                target_id,
                parent_id,
            )

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(worker, actors))

    # Exactly one removal call returned True (the first), others returned False (idempotent repeat)
    assert sum(1 for r in results if r is True) == 1
    assert sum(1 for r in results if r is False) == 3

    with TestingSessionLocal() as s:
        events = s.query(ManagementEvent).filter(ManagementEvent.target_id == target_id).all()
        assert len(events) == 1
        model_cls = MODELS[kind]
        db_obj = s.get(model_cls, target_id)
        assert db_obj.removed_at is not None
        assert db_obj.removed_by_id == actors[0]


# ==============================================================================
# SECTION 6.C: PARENT BEHAVIOR
# ==============================================================================

@pytest.mark.parametrize("parent_kind,reply_kind", [
    ("announcement", "announcement_reply"),
    ("community_post", "community_post_reply"),
])
def test_parent_removal_hides_detail_and_replies_preserves_children(pg_portal, parent_kind, reply_kind):
    pg_portal.login("delegate")
    parent_id = pg_portal.target_ids[parent_kind]
    reply_id = pg_portal.target_ids[reply_kind]

    parent_url = f"{ROOT}/{'announcements' if parent_kind == 'announcement' else 'posts'}/{parent_id}"
    replies_url = f"{parent_url}/replies"

    # Remove parent
    res = pg_portal.client.delete(parent_url)
    assert res.status_code == 204

    # Parent detail is now 404
    assert pg_portal.client.get(parent_url).status_code == 404

    # Replies listing for removed parent is 404
    assert pg_portal.client.get(replies_url).status_code == 404

    # New reply to removed parent is rejected with 404
    res_new = pg_portal.client.post(replies_url, json={"content": "new reply to dead parent"})
    assert res_new.status_code == 404

    # Deleting reply of removed parent is 404
    reply_delete_url = f"{replies_url}/{reply_id}"
    assert pg_portal.client.delete(reply_delete_url).status_code == 404

    # Child source records remain intact in DB, not deleted or modified
    with TestingSessionLocal() as s:
        model_reply = MODELS[reply_kind]
        child_in_db = s.get(model_reply, reply_id)
        assert child_in_db is not None
        assert child_in_db.removed_at is None  # Not altered


def test_removing_one_reply_leaves_parent_and_sibling_visible(pg_portal):
    pg_portal.login("delegate")
    ann_id = pg_portal.target_ids["announcement"]
    reply1_id = pg_portal.target_ids["announcement_reply"]

    # Create sibling reply
    with TestingSessionLocal() as s:
        reply2 = AnnouncementReply(
            id=uuid4(),
            announcement_id=ann_id,
            author_id=pg_portal.user_ids["member"],
            content="Sibling reply",
            created_at=datetime.now(timezone.utc),
        )
        s.add(reply2)
        s.commit()
        reply2_id = reply2.id

    replies_url = f"{ROOT}/announcements/{ann_id}/replies"

    # Remove reply1
    res = pg_portal.client.delete(f"{replies_url}/{reply1_id}")
    assert res.status_code == 204

    # Parent detail remains visible
    assert pg_portal.client.get(f"{ROOT}/announcements/{ann_id}").status_code == 200

    # Replies listing shows only sibling reply2
    res_list = pg_portal.client.get(replies_url)
    assert res_list.status_code == 200
    items = res_list.json()["items"]
    item_ids = [item["id"] for item in items]
    assert str(reply2_id) in item_ids
    assert str(reply1_id) not in item_ids


# ==============================================================================
# SECTION 6.D: PAGINATION LOOKAHEAD & TIEBREAKING & CURSOR COMPATIBILITY
# ==============================================================================

def test_pagination_visibility_filtering_before_limit_and_cursors(pg_portal):
    pg_portal.login("delegate")
    now = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)

    # Insert 6 posts with equal timestamp to test deterministic ID ordering
    post_ids = [UUID(f"00000000-0000-0000-0000-00000000000{i}") for i in range(1, 7)]
    with TestingSessionLocal() as s:
        for pid in post_ids:
            p = CommunityPost(
                id=pid,
                community_id=pg_portal.comm_irm_id,
                author_id=pg_portal.user_ids["member"],
                title=f"Post {pid}",
                content=f"Content {pid}",
                created_at=now,
            )
            s.add(p)
        s.commit()

    posts_url = f"{ROOT}/posts"

    # Remove posts 3 and 4
    for pid in (post_ids[2], post_ids[3]):
        assert pg_portal.client.delete(f"{posts_url}/{pid}").status_code == 204

    # Page 1 with limit=2 (descending order by (created_at, id))
    page1 = pg_portal.client.get(posts_url, params={"limit": 2}).json()
    assert len(page1["items"]) == 2
    # Verify removed posts do NOT consume slots
    assert all(UUID(item["id"]) not in (post_ids[2], post_ids[3]) for item in page1["items"])

    # Traverse through all pages
    all_visible_ids = []
    cursor = None
    for _ in range(5):
        params = {"limit": 2}
        if cursor:
            params["after"] = cursor
        res = pg_portal.client.get(posts_url, params=params).json()
        all_visible_ids.extend([item["id"] for item in res["items"]])
        cursor = res.get("next_cursor")
        if not cursor:
            break

    # No duplicate IDs returned across pages
    assert len(all_visible_ids) == len(set(all_visible_ids))
    # None of the removed posts were ever returned
    assert str(post_ids[2]) not in all_visible_ids
    assert str(post_ids[3]) not in all_visible_ids

    # Cursor usability: using a removed post ID as cursor remains valid within scope
    res_removed_cursor = pg_portal.client.get(posts_url, params={"after": str(post_ids[2])})
    assert res_removed_cursor.status_code == 200

    # Cross-community cursor rejected: foreign post ID as cursor -> 400
    foreign_post_id = pg_portal.foreign_target_ids["community_post"]
    res_cross_cursor = pg_portal.client.get(posts_url, params={"after": str(foreign_post_id)})
    assert res_cross_cursor.status_code == 400


# ==============================================================================
# SECTION 6.E: DISCUSSION BEHAVIOR (HISTORY, REACTION 404, REPLAY 409)
# ==============================================================================

def test_discussion_removal_history_reaction_and_replay_pg(pg_portal):
    pg_portal.login("member")
    msg_url = f"{ROOT}/discussion/messages"
    cmid = uuid4()

    # 1. Post a new message
    res = pg_portal.client.post(msg_url, json={"kind": "TEXT", "content": "PG discussion test", "client_message_id": str(cmid)})
    assert res.status_code == 201
    msg_data = res.json()
    msg_id = msg_data["id"]

    # 2. Add reaction
    react_url = f"{msg_url}/{msg_id}/reaction"
    assert pg_portal.client.put(react_url, json={"emoji": "heart"}).status_code == 200

    # 3. Delegate removes message
    pg_portal.login("delegate")
    assert pg_portal.client.delete(f"{msg_url}/{msg_id}").status_code == 204

    # 4. Message does not appear in history
    pg_portal.login("member")
    hist_res = pg_portal.client.get(f"{ROOT}/discussion/messages", params={"limit": 20})
    assert hist_res.status_code == 200
    hist_ids = [m["id"] for m in hist_res.json()["items"]]
    assert msg_id not in hist_ids

    # 5. Reaction mutation on removed message returns 404
    assert pg_portal.client.put(react_url, json={"emoji": "heart"}).status_code == 404
    assert pg_portal.client.delete(react_url).status_code == 404

    # 6. Replay with exact same client_message_id returns 409 without original payload
    replay_res = pg_portal.client.post(msg_url, json={"kind": "TEXT", "content": "PG discussion test", "client_message_id": str(cmid)})
    assert replay_res.status_code == 409
    assert "PG discussion test" not in replay_res.text

    # 7. Repeated removal does not create another event
    pg_portal.login("delegate")
    assert pg_portal.client.delete(f"{msg_url}/{msg_id}").status_code == 204
    with TestingSessionLocal() as s:
        events = s.query(ManagementEvent).filter(ManagementEvent.target_id == UUID(msg_id)).all()
        assert len(events) == 1
