"""Tests for Delegate Member Management (Remove, Ban, Unban)."""

from datetime import datetime, timezone, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.announcement import Announcement
from app.models.community import Community
from app.models.community_post import CommunityPost
from app.models.discussion_message import DiscussionMessage
from app.models.document import Document
from app.models.management_event import ManagementEvent
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.membership_permission import MembershipPermission, PermissionType
from app.models.module import Module
from app.models.user import User


@pytest.fixture
def portal():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override

    db = TestingSession()
    now = datetime.now(timezone.utc)

    # Communities
    c_irm = Community(id=uuid4(), name="IRM Community", slug="irm", document_vote_threshold=10)
    c_foreign = Community(id=uuid4(), name="Foreign Community", slug="foreign", document_vote_threshold=10)
    db.add_all([c_irm, c_foreign])
    db.flush()

    # Module & Document
    mod = Module(id=uuid4(), community_id=c_irm.id, name="Test Module", slug="test-mod")
    db.add(mod)
    db.flush()

    # Users
    user_keys = [
        "delegate", "foreign_delegate", "member", "moderator", "pending", "rejected",
        "removed", "banned", "outsider", "target_member", "target_mod",
    ]
    users = {}
    tokens = {}
    for key in user_keys:
        u = User(
            id=uuid4(),
            username=key,
            email=f"{key}@test.invalid",
            password_hash="testhash",
            first_name="Test",
            family_name="User",
        )
        db.add(u)
        db.flush()
        users[key] = u
        raw_tok, _ = create_session(db, u.id, timedelta(hours=1))
        tokens[key] = raw_tok

    # Document owned by target_member
    doc = Document(
        id=uuid4(),
        module_id=mod.id,
        uploader_id=users["target_member"].id,
        title="Target Doc",
        type="COURSE",
        source="STUDENT",
        status="APPROVED",
        storage_path="path/to/doc.pdf",
        vote_threshold_snapshot=10,
        created_at=now,
        updated_at=now,
    )
    db.add(doc)

    # Post by target_member
    post = CommunityPost(
        id=uuid4(),
        community_id=c_irm.id,
        author_id=users["target_member"].id,
        title="Target Post",
        content="Post content",
        created_at=now,
    )
    db.add(post)

    # Discussion message by target_member
    msg = DiscussionMessage(
        id=uuid4(),
        community_id=c_irm.id,
        author_id=users["target_member"].id,
        kind="TEXT",
        content="Hello discussion",
        client_message_id=uuid4(),
        created_at=now,
    )
    db.add(msg)

    # Memberships in IRM
    mem_defs = [
        ("delegate", c_irm.id, MembershipRole.DELEGATE, MembershipStatus.ACTIVE),
        ("foreign_delegate", c_foreign.id, MembershipRole.DELEGATE, MembershipStatus.ACTIVE),
        ("member", c_irm.id, MembershipRole.MEMBER, MembershipStatus.ACTIVE),
        ("moderator", c_irm.id, MembershipRole.MODERATOR, MembershipStatus.ACTIVE),
        ("pending", c_irm.id, MembershipRole.MEMBER, MembershipStatus.PENDING),
        ("rejected", c_irm.id, MembershipRole.MEMBER, MembershipStatus.REJECTED),
        ("removed", c_irm.id, MembershipRole.MEMBER, MembershipStatus.REMOVED),
        ("banned", c_irm.id, MembershipRole.MEMBER, MembershipStatus.BANNED),
        ("target_member", c_irm.id, MembershipRole.MEMBER, MembershipStatus.ACTIVE),
        ("target_mod", c_irm.id, MembershipRole.MODERATOR, MembershipStatus.ACTIVE),
    ]
    memberships = {}
    for key, cid, role, status in mem_defs:
        m = Membership(
            id=uuid4(),
            user_id=users[key].id,
            community_id=cid,
            cne=f"CNE_{key}",
            role=role,
            status=status,
            created_at=now,
            updated_at=now,
        )
        db.add(m)
        db.flush()
        memberships[key] = m

    # Grant permissions to moderator and target_mod
    for mkey in ["moderator", "target_mod"]:
        p1 = MembershipPermission(id=uuid4(), membership_id=memberships[mkey].id, permission=PermissionType.CREATE_ANNOUNCEMENTS)
        p2 = MembershipPermission(id=uuid4(), membership_id=memberships[mkey].id, permission=PermissionType.MANAGE_DOCUMENT_VOTING)
        db.add_all([p1, p2])

    db.commit()

    class Portal:
        pass

    p = Portal()
    p.engine = engine
    p.db = db
    p.client = TestClient(app)
    p.users = users
    p.tokens = tokens
    p.memberships = memberships
    p.c_irm = c_irm
    p.c_foreign = c_foreign

    def auth_client(user_key: str | None) -> TestClient:
        c = TestClient(app)
        if user_key and user_key in tokens:
            c.cookies.set(settings.session_cookie_name, tokens[user_key])
        return c

    p.auth_client = auth_client
    yield p

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    db.close()


# ==============================================================================
# AUTHORIZATION TESTS
# ==============================================================================

def test_guest_cannot_mutate_members(portal):
    client = portal.auth_client(None)
    mid = str(portal.memberships["target_member"].id)
    url = f"/api/v1/communities/irm/memberships/{mid}"
    assert client.delete(url).status_code == 401
    assert client.put(f"{url}/ban").status_code == 401
    assert client.delete(f"{url}/ban").status_code == 401


def test_non_member_cannot_mutate_members(portal):
    client = portal.auth_client("outsider")
    mid = str(portal.memberships["target_member"].id)
    url = f"/api/v1/communities/irm/memberships/{mid}"
    assert client.delete(url).status_code == 403
    assert client.put(f"{url}/ban").status_code == 403
    assert client.delete(f"{url}/ban").status_code == 403


@pytest.mark.parametrize("caller", ["pending", "rejected", "removed", "banned", "member", "moderator"])
def test_non_delegate_callers_forbidden(portal, caller):
    client = portal.auth_client(caller)
    mid = str(portal.memberships["target_member"].id)
    url = f"/api/v1/communities/irm/memberships/{mid}"
    assert client.delete(url).status_code == 403
    assert client.put(f"{url}/ban").status_code == 403
    assert client.delete(f"{url}/ban").status_code == 403


def test_foreign_delegate_forbidden(portal):
    client = portal.auth_client("foreign_delegate")
    mid = str(portal.memberships["target_member"].id)
    url = f"/api/v1/communities/irm/memberships/{mid}"
    assert client.delete(url).status_code == 403
    assert client.put(f"{url}/ban").status_code == 403
    assert client.delete(f"{url}/ban").status_code == 403


def test_unknown_target_returns_404(portal):
    client = portal.auth_client("delegate")
    random_id = str(uuid4())
    url = f"/api/v1/communities/irm/memberships/{random_id}"
    assert client.delete(url).status_code == 404
    assert client.put(f"{url}/ban").status_code == 404
    assert client.delete(f"{url}/ban").status_code == 404


def test_foreign_target_returns_404(portal):
    client = portal.auth_client("delegate")
    foreign_mid = str(portal.memberships["foreign_delegate"].id)
    url = f"/api/v1/communities/irm/memberships/{foreign_mid}"
    assert client.delete(url).status_code == 404
    assert client.put(f"{url}/ban").status_code == 404
    assert client.delete(f"{url}/ban").status_code == 404


def test_malformed_uuid_returns_404(portal):
    client = portal.auth_client("delegate")
    url = "/api/v1/communities/irm/memberships/not-a-uuid"
    assert client.delete(url).status_code == 404
    assert client.put(f"{url}/ban").status_code == 404
    assert client.delete(f"{url}/ban").status_code == 404


def test_delegate_self_target_protected_409(portal):
    client = portal.auth_client("delegate")
    my_mid = str(portal.memberships["delegate"].id)
    url = f"/api/v1/communities/irm/memberships/{my_mid}"
    res_rem = client.delete(url)
    assert res_rem.status_code == 409
    res_ban = client.put(f"{url}/ban")
    assert res_ban.status_code == 409
    res_unban = client.delete(f"{url}/ban")
    assert res_unban.status_code == 409


def test_delegate_target_protected_409(portal):
    # Delegate cannot remove another delegate (if one existed)
    client = portal.auth_client("delegate")
    del_mid = str(portal.memberships["delegate"].id)
    url = f"/api/v1/communities/irm/memberships/{del_mid}"
    assert client.delete(url).status_code == 409
    assert client.put(f"{url}/ban").status_code == 409


# ==============================================================================
# STATE TRANSITIONS
# ==============================================================================

def test_remove_active_member(portal):
    client = portal.auth_client("delegate")
    mid = portal.memberships["target_member"].id
    url = f"/api/v1/communities/irm/memberships/{mid}"

    res = client.delete(url)
    assert res.status_code == 204
    assert res.content == b""
    assert res.headers.get("cache-control") == "private, no-store"

    portal.db.expire_all()
    m = portal.db.get(Membership, mid)
    assert m.status == MembershipStatus.REMOVED
    assert m.role == MembershipRole.MEMBER

    events = portal.db.query(ManagementEvent).filter(ManagementEvent.target_id == mid).all()
    assert len(events) == 1
    assert events[0].action == "remove"
    assert events[0].target_type == "membership"
    assert events[0].actor_id == portal.users["delegate"].id


def test_remove_moderator_clears_grants(portal):
    client = portal.auth_client("delegate")
    mid = portal.memberships["target_mod"].id
    url = f"/api/v1/communities/irm/memberships/{mid}"

    res = client.delete(url)
    assert res.status_code == 204

    portal.db.expire_all()
    m = portal.db.get(Membership, mid)
    assert m.status == MembershipStatus.REMOVED
    assert m.role == MembershipRole.MEMBER
    assert portal.db.query(MembershipPermission).filter(MembershipPermission.membership_id == mid).count() == 0


def test_remove_idempotent_produces_no_duplicate_event(portal):
    client = portal.auth_client("delegate")
    mid = portal.memberships["target_member"].id
    url = f"/api/v1/communities/irm/memberships/{mid}"

    res1 = client.delete(url)
    assert res1.status_code == 204
    res2 = client.delete(url)
    assert res2.status_code == 204

    events = portal.db.query(ManagementEvent).filter(ManagementEvent.target_id == mid).all()
    assert len(events) == 1


def test_remove_cannot_bypass_ban(portal):
    client = portal.auth_client("delegate")
    mid = portal.memberships["banned"].id
    url = f"/api/v1/communities/irm/memberships/{mid}"

    res = client.delete(url)
    assert res.status_code == 409


def test_ban_active_member(portal):
    client = portal.auth_client("delegate")
    mid = portal.memberships["target_member"].id
    url = f"/api/v1/communities/irm/memberships/{mid}/ban"

    res = client.put(url)
    assert res.status_code == 204
    assert res.content == b""
    assert res.headers.get("cache-control") == "private, no-store"

    portal.db.expire_all()
    m = portal.db.get(Membership, mid)
    assert m.status == MembershipStatus.BANNED
    assert m.role == MembershipRole.MEMBER

    events = portal.db.query(ManagementEvent).filter(ManagementEvent.target_id == mid).all()
    assert len(events) == 1
    assert events[0].action == "ban"


def test_ban_from_removed_state(portal):
    client = portal.auth_client("delegate")
    mid = portal.memberships["removed"].id
    url = f"/api/v1/communities/irm/memberships/{mid}/ban"

    res = client.put(url)
    assert res.status_code == 204

    portal.db.expire_all()
    m = portal.db.get(Membership, mid)
    assert m.status == MembershipStatus.BANNED


def test_ban_idempotent_produces_no_duplicate_event(portal):
    client = portal.auth_client("delegate")
    mid = portal.memberships["target_member"].id
    url = f"/api/v1/communities/irm/memberships/{mid}/ban"

    assert client.put(url).status_code == 204
    assert client.put(url).status_code == 204

    events = portal.db.query(ManagementEvent).filter(ManagementEvent.target_id == mid).all()
    assert len(events) == 1


def test_unban_banned_member_transitions_to_removed(portal):
    client = portal.auth_client("delegate")
    mid = portal.memberships["banned"].id
    url = f"/api/v1/communities/irm/memberships/{mid}/ban"

    res = client.delete(url)
    assert res.status_code == 204
    assert res.headers.get("cache-control") == "private, no-store"

    portal.db.expire_all()
    m = portal.db.get(Membership, mid)
    # UNBAN sets status to REMOVED, requiring a fresh application
    assert m.status == MembershipStatus.REMOVED
    assert m.role == MembershipRole.MEMBER

    events = portal.db.query(ManagementEvent).filter(ManagementEvent.target_id == mid, ManagementEvent.action == "unban").all()
    assert len(events) == 1


def test_unban_idempotent_produces_no_duplicate_event(portal):
    client = portal.auth_client("delegate")
    mid = portal.memberships["banned"].id
    url = f"/api/v1/communities/irm/memberships/{mid}/ban"

    assert client.delete(url).status_code == 204
    assert client.delete(url).status_code == 204

    events = portal.db.query(ManagementEvent).filter(ManagementEvent.target_id == mid, ManagementEvent.action == "unban").all()
    assert len(events) == 1


@pytest.mark.parametrize("mkey", ["target_member", "pending", "rejected"])
def test_unban_on_non_banned_returns_409(portal, mkey):
    client = portal.auth_client("delegate")
    mid = portal.memberships[mkey].id
    url = f"/api/v1/communities/irm/memberships/{mid}/ban"
    assert client.delete(url).status_code == 409


# ==============================================================================
# REAPPLICATION BEHAVIOR
# ==============================================================================

def test_removed_user_can_reapply(portal):
    client = portal.auth_client("removed")
    res = client.post("/api/v1/communities/irm/membership", json={"cne": "CNE_NEW"})
    assert res.status_code == 201

    portal.db.expire_all()
    m = portal.db.get(Membership, portal.memberships["removed"].id)
    assert m.status == MembershipStatus.PENDING
    assert m.role == MembershipRole.MEMBER
    assert m.cne == "CNE_NEW"


def test_banned_user_cannot_reapply_403(portal):
    client = portal.auth_client("banned")
    res = client.post("/api/v1/communities/irm/membership", json={"cne": "CNE_BAN_TRY"})
    assert res.status_code == 403
    assert "banned" in res.json().get("detail", "").lower()


def test_unbanned_user_can_reapply(portal):
    del_client = portal.auth_client("delegate")
    banned_mid = portal.memberships["banned"].id
    assert del_client.delete(f"/api/v1/communities/irm/memberships/{banned_mid}/ban").status_code == 204

    user_client = portal.auth_client("banned")
    res = user_client.post("/api/v1/communities/irm/membership", json={"cne": "CNE_UNBANNED"})
    assert res.status_code == 201

    portal.db.expire_all()
    m = portal.db.get(Membership, banned_mid)
    assert m.status == MembershipStatus.PENDING
    assert m.role == MembershipRole.MEMBER


def test_rejected_user_can_still_reapply(portal):
    client = portal.auth_client("rejected")
    res = client.post("/api/v1/communities/irm/membership", json={"cne": "CNE_REJECT_RETRY"})
    assert res.status_code == 201


def test_application_is_allowed_while_active_in_foreign_community(portal):
    client = portal.auth_client("foreign_delegate")
    res = client.post("/api/v1/communities/irm/membership", json={"cne": "CNE_FOREIGN"})
    assert res.status_code == 201
    irm_membership = portal.db.query(Membership).filter_by(
        user_id=portal.users["foreign_delegate"].id,
        community_id=portal.c_irm.id,
    ).one()
    foreign_membership = portal.db.get(Membership, portal.memberships["foreign_delegate"].id)
    assert irm_membership.status is MembershipStatus.PENDING
    assert foreign_membership.status is MembershipStatus.ACTIVE


# ==============================================================================
# APPROVAL & STAFF ENDPOINTS CANNOT BYPASS REMOVED/BANNED
# ==============================================================================

@pytest.mark.parametrize("mkey", ["removed", "banned"])
def test_approval_and_rejection_fail_on_removed_or_banned(portal, mkey):
    client = portal.auth_client("delegate")
    mid = str(portal.memberships[mkey].id)
    assert client.post(f"/api/v1/communities/irm/membership/{mid}/approve").status_code == 409
    assert client.post(f"/api/v1/communities/irm/membership/{mid}/reject").status_code == 409


@pytest.mark.parametrize("mkey", ["removed", "banned"])
def test_staff_role_and_permissions_fail_on_removed_or_banned(portal, mkey):
    client = portal.auth_client("delegate")
    mid = str(portal.memberships[mkey].id)
    assert client.patch(f"/api/v1/communities/irm/membership/{mid}/role", json={"role": "MODERATOR"}).status_code == 409
    assert client.get(f"/api/v1/communities/irm/membership/{mid}/permissions").status_code == 409
    assert client.patch(f"/api/v1/communities/irm/membership/{mid}/permissions", json={"create_announcements": True}).status_code == 409


# ==============================================================================
# DATA PRESERVATION
# ==============================================================================

def test_data_preservation_after_removal_and_ban(portal):
    del_client = portal.auth_client("delegate")
    target_mid = portal.memberships["target_member"].id
    target_uid = portal.users["target_member"].id

    # Remove target
    assert del_client.delete(f"/api/v1/communities/irm/memberships/{target_mid}").status_code == 204

    portal.db.expire_all()
    # 1. User account remains
    u = portal.db.get(User, target_uid)
    assert u is not None and u.username == "target_member"

    # 2. Session remains valid
    user_client = portal.auth_client("target_member")
    me_res = user_client.get("/api/v1/auth/me")
    assert me_res.status_code == 200

    # 3. Documents and ownership remain
    docs = portal.db.query(Document).filter(Document.uploader_id == target_uid).all()
    assert len(docs) == 1 and docs[0].status == "APPROVED"

    # 4. Posts and discussion messages remain
    posts = portal.db.query(CommunityPost).filter(CommunityPost.author_id == target_uid).all()
    assert len(posts) == 1
    msgs = portal.db.query(DiscussionMessage).filter(DiscussionMessage.author_id == target_uid).all()
    assert len(msgs) == 1

    # 5. Membership identity and UUID remain
    m = portal.db.get(Membership, target_mid)
    assert m.id == target_mid and m.cne == "CNE_target_member"

    # 6. Audit event contains no sensitive data
    ev = portal.db.query(ManagementEvent).filter(ManagementEvent.target_id == target_mid).one()
    assert ev.action == "remove"
    assert ev.target_type == "membership"
    # No sensitive columns in ManagementEvent
    col_names = set(ManagementEvent.__table__.columns.keys())
    assert col_names == {"id", "community_id", "actor_id", "action", "target_type", "target_id", "created_at"}


# ==============================================================================
# ACCESS REVOCATION
# ==============================================================================

def test_fresh_protected_rest_requests_denied_after_removal(portal):
    del_client = portal.auth_client("delegate")
    target_mid = portal.memberships["target_member"].id
    assert del_client.delete(f"/api/v1/communities/irm/memberships/{target_mid}").status_code == 204

    target_client = portal.auth_client("target_member")

    # Protected discussion history
    assert target_client.get("/api/v1/communities/irm/discussion/messages").status_code == 403

    # Self-membership endpoint reflects removed status and zero capabilities
    me_mem = target_client.get("/api/v1/communities/irm/membership/me")
    assert me_mem.status_code == 200
    data = me_mem.json()
    assert data["membership"]["status"] == "REMOVED"
    assert data["capabilities"]["create_announcements"] is False
    assert data["capabilities"]["manage_document_voting"] is False
    assert data["capabilities"]["upload_official_documents"] is False
