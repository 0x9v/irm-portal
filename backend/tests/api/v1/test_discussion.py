import uuid
from datetime import timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import discussion as discussion_endpoint
from app.api.v1.endpoints import stickers as sticker_endpoint
from app.api import account_mutation_route
from app.core.config import settings
from app.core.discussion import VALID_STICKER_IDS
from app.core.sessions import create_session
from app.core.stickers import process_sticker_image
from app.core.storage.local import LocalFileSystemStorage
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.discussion_message import DiscussionMessage
from app.models.discussion_reaction import DiscussionReaction
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.user import User
from app.models.sticker_asset import StickerAsset
from app.services import sticker_library

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_overrides():
    app.dependency_overrides[get_db] = override_get_db
    orig_session_local = discussion_endpoint.SessionLocal
    discussion_endpoint.SessionLocal = TestingSessionLocal
    orig_sticker_session_local = sticker_library.SessionLocal
    sticker_library.SessionLocal = TestingSessionLocal
    orig_account_session_local = account_mutation_route.SessionLocal
    account_mutation_route.SessionLocal = TestingSessionLocal
    yield
    app.dependency_overrides.clear()
    discussion_endpoint.SessionLocal = orig_session_local
    sticker_library.SessionLocal = orig_sticker_session_local
    account_mutation_route.SessionLocal = orig_account_session_local


@pytest.fixture(autouse=True)
def init_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    return TestClient(app)


# ==============================================================================
# FIXTURES & HELPERS
# ==============================================================================

def create_test_user(db, username=None, email=None) -> User:
    u = User(
        username=username or f"user_{uuid.uuid4().hex[:8]}",
        email=email or f"{uuid.uuid4().hex[:8]}@example.com",
        password_hash="argon2id$testhash",
        first_name="Test",
        family_name="User",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def create_test_community(db, name="IRM Hub", slug="irm") -> Community:
    c = Community(name=name, slug=slug)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def create_test_membership(
    db, user, community, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER
) -> Membership:
    m = Membership(
        user_id=user.id,
        community_id=community.id,
        status=status,
        role=role,
        cne=f"CNE_{uuid.uuid4().hex[:6]}",
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def login_user(client, db, user) -> str:
    token, _ = create_session(db, user.id, timedelta(days=1))
    client.cookies.set(settings.session_cookie_name, token)
    return token


# ==============================================================================
# 1. AUTHORIZATION MATRIX TESTS
# ==============================================================================

def test_discussion_guest_denied(client, db_session):
    community = create_test_community(db_session)

    # GET messages -> 401
    resp = client.get(f"/api/v1/communities/{community.slug}/discussion/messages")
    assert resp.status_code == 401

    # POST message -> 401
    resp = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={
            "client_message_id": str(uuid.uuid4()),
            "kind": "TEXT",
            "content": "Hello",
        },
    )
    assert resp.status_code == 401

    # GET stickers -> 401
    resp = client.get(f"/api/v1/communities/{community.slug}/discussion/stickers")
    assert resp.status_code == 401


def test_discussion_no_membership_denied(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    login_user(client, db_session, user)

    resp = client.get(f"/api/v1/communities/{community.slug}/discussion/messages")
    assert resp.status_code == 403


def test_discussion_pending_and_rejected_denied(client, db_session):
    community = create_test_community(db_session)
    u_pending = create_test_user(db_session)
    create_test_membership(db_session, u_pending, community, status=MembershipStatus.PENDING)

    u_rejected = create_test_user(db_session)
    create_test_membership(db_session, u_rejected, community, status=MembershipStatus.REJECTED)

    # Pending -> 403
    login_user(client, db_session, u_pending)
    resp = client.get(f"/api/v1/communities/{community.slug}/discussion/messages")
    assert resp.status_code == 403
    resp_post = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={
            "client_message_id": str(uuid.uuid4()),
            "kind": "TEXT",
            "content": "Pending attempt",
        },
    )
    assert resp_post.status_code == 403

    # Rejected -> 403
    login_user(client, db_session, u_rejected)
    resp = client.get(f"/api/v1/communities/{community.slug}/discussion/messages")
    assert resp.status_code == 403


def test_discussion_all_active_roles_permitted(client, db_session):
    community = create_test_community(db_session)

    for role in [MembershipRole.MEMBER, MembershipRole.MODERATOR, MembershipRole.DELEGATE]:
        user = create_test_user(db_session)
        create_test_membership(db_session, user, community, status=MembershipStatus.ACTIVE, role=role)
        login_user(client, db_session, user)

        resp = client.get(f"/api/v1/communities/{community.slug}/discussion/messages")
        assert resp.status_code == 200
        assert resp.headers["Cache-Control"] == "private, no-store"

        post_resp = client.post(
            f"/api/v1/communities/{community.slug}/discussion/messages",
            json={
                "client_message_id": str(uuid.uuid4()),
                "kind": "TEXT",
                "content": f"Message by {role.value}",
            },
        )
        assert post_resp.status_code == 201
        assert post_resp.headers["Cache-Control"] == "private, no-store"
        assert post_resp.json()["custom_sticker_id"] is None


# ==============================================================================
# 2. VALIDATION & BOUNDARY TESTS (TEXT, STICKERS, UNICODE)
# ==============================================================================

def test_stickers_catalog_and_validation(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # Catalog listing
    resp = client.get(f"/api/v1/communities/{community.slug}/discussion/stickers")
    assert resp.status_code == 200
    catalog = resp.json()
    assert len(catalog) >= 5
    ids = {s["id"] for s in catalog}
    assert ids == VALID_STICKER_IDS

    # Valid sticker creation
    first_id = list(VALID_STICKER_IDS)[0]
    cid = str(uuid.uuid4())
    create_resp = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={
            "client_message_id": cid,
            "kind": "STICKER",
            "sticker_id": first_id,
        },
    )
    assert create_resp.status_code == 201
    assert create_resp.json()["kind"] == "STICKER"
    assert create_resp.json()["author_id"] == str(user.id)
    assert create_resp.json()["sticker_id"] == first_id
    assert create_resp.json()["custom_sticker_id"] is None
    assert create_resp.json()["content"] is None

    # Invalid sticker ID -> 422
    bad_resp = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={
            "client_message_id": str(uuid.uuid4()),
            "kind": "STICKER",
            "sticker_id": "malicious_unregistered_pack",
        },
    )
    assert bad_resp.status_code == 422

    # Sticker with content -> 422
    bad_content = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={
            "client_message_id": str(uuid.uuid4()),
            "kind": "STICKER",
            "sticker_id": first_id,
            "content": "Not allowed",
        },
    )
    assert bad_content.status_code == 422


def test_text_boundaries_unicode_and_newlines(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # Empty content -> 422
    assert client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": ""},
    ).status_code == 422

    # Whitespace only -> 422
    assert client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "   \n\t  "},
    ).status_code == 422

    # Preserves newlines
    multiline = "Line 1\nLine 2 with \t tabs\nLine 3"
    resp = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": multiline},
    )
    assert resp.status_code == 201
    assert resp.json()["content"] == multiline

    # Boundary: exactly 2,000 ASCII chars -> 201
    txt_2000 = "T" * 2000
    resp_2000 = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": txt_2000},
    )
    assert resp_2000.status_code == 201
    assert resp_2000.json()["content"] == txt_2000

    # Boundary: 2,001 ASCII chars -> 422
    txt_2001 = "T" * 2001
    resp_2001 = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": txt_2001},
    )
    assert resp_2001.status_code == 422

    # Boundary: exactly 2,000 Unicode emoji code points -> 201
    emoji_2000 = "🎉" * 2000
    resp_e2000 = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": emoji_2000},
    )
    assert resp_e2000.status_code == 201
    assert resp_e2000.json()["content"] == emoji_2000

    # Boundary: 2,001 Unicode emoji code points -> 422
    emoji_2001 = "🎉" * 2001
    resp_e2001 = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": emoji_2001},
    )
    assert resp_e2001.status_code == 422

    # Non-string content -> 422
    assert client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": 12345},
    ).status_code == 422

    # Text message cannot include sticker_id
    assert client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={
            "client_message_id": str(uuid.uuid4()),
            "kind": "TEXT",
            "content": "Valid",
            "sticker_id": "pepe_thumbs_up",
        },
    ).status_code == 422


# ==============================================================================
# 3. SAFE RETRIES & CONFLICTING REPLAYS
# ==============================================================================

def test_safe_retry_same_payload_returns_200(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    cid = str(uuid.uuid4())
    payload = {
        "client_message_id": cid,
        "kind": "TEXT",
        "content": "Idempotent submission",
    }

    # Initial creation: 201 Created
    resp1 = client.post(f"/api/v1/communities/{community.slug}/discussion/messages", json=payload)
    assert resp1.status_code == 201
    msg1_id = resp1.json()["id"]

    # Replay with identical payload: 200 OK returning existing message
    resp2 = client.post(f"/api/v1/communities/{community.slug}/discussion/messages", json=payload)
    assert resp2.status_code == 200
    assert resp2.json()["id"] == msg1_id
    assert resp1.json()["author_id"] == str(user.id)
    assert resp2.json()["author_id"] == str(user.id)

    # Verify database has exactly 1 record
    count = (
        db_session.query(DiscussionMessage)
        .filter(DiscussionMessage.client_message_id == uuid.UUID(cid))
        .count()
    )
    assert count == 1


def test_conflicting_replay_returns_409(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    cid = str(uuid.uuid4())
    payload_original = {
        "client_message_id": cid,
        "kind": "TEXT",
        "content": "Original content",
    }
    resp1 = client.post(f"/api/v1/communities/{community.slug}/discussion/messages", json=payload_original)
    assert resp1.status_code == 201

    # Replay with conflicting content
    payload_conflict = {
        "client_message_id": cid,
        "kind": "TEXT",
        "content": "Conflicting altered content",
    }
    resp2 = client.post(f"/api/v1/communities/{community.slug}/discussion/messages", json=payload_conflict)
    assert resp2.status_code == 409
    assert "different content" in resp2.json()["detail"]


# ==============================================================================
# 4. HISTORY RETRIEVAL & PAGINATION
# ==============================================================================

def test_discussion_history_chronological_and_pagination(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # Insert 35 messages
    for i in range(1, 36):
        client.post(
            f"/api/v1/communities/{community.slug}/discussion/messages",
            json={
                "client_message_id": str(uuid.uuid4()),
                "kind": "TEXT",
                "content": f"Message {i:02d}",
            },
        )

    # 1. Default initial page: 30 latest messages returned in chronological order
    resp = client.get(f"/api/v1/communities/{community.slug}/discussion/messages")
    assert resp.status_code == 200
    data = resp.json()
    items = data["items"]
    assert len(items) == 30
    assert data["has_more_older"] is True
    assert data["older_cursor"] is not None

    # Chronological check: items[0] is Message 06, items[-1] is Message 35
    assert items[0]["content"] == "Message 06"
    assert items[-1]["content"] == "Message 35"

    # 2. Page older messages using before cursor
    older_resp = client.get(
        f"/api/v1/communities/{community.slug}/discussion/messages?before={data['older_cursor']}"
    )
    assert older_resp.status_code == 200
    older_data = older_resp.json()
    older_items = older_data["items"]
    assert len(older_items) == 5
    assert older_data["has_more_older"] is False
    assert older_items[0]["content"] == "Message 01"
    assert older_items[-1]["content"] == "Message 05"

    # 3. Newer catch-up using after cursor
    after_cursor = items[20]["id"]  # Message 26
    newer_resp = client.get(
        f"/api/v1/communities/{community.slug}/discussion/messages?after={after_cursor}"
    )
    assert newer_resp.status_code == 200
    newer_data = newer_resp.json()
    newer_items = newer_data["items"]
    assert len(newer_items) == 9  # Messages 27 to 35
    assert newer_items[0]["content"] == "Message 27"
    assert newer_items[-1]["content"] == "Message 35"


def test_discussion_foreign_cursor_rejected(client, db_session):
    c1 = create_test_community(db_session, "Comm 1", "c1")
    c2 = create_test_community(db_session, "Comm 2", "c2")
    user1 = create_test_user(db_session, "user1")
    create_test_membership(db_session, user1, c1)

    user2 = create_test_user(db_session, "user2")
    create_test_membership(db_session, user2, c2)

    # Post in c2 using user2
    login_user(client, db_session, user2)
    resp_c2 = client.post(
        f"/api/v1/communities/{c2.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "Msg in C2"},
    )
    c2_msg_id = resp_c2.json()["id"]

    # Login as user1 in c1 and attempt to query c1 discussion with c2's cursor -> 404
    login_user(client, db_session, user1)

    # Try to use c2 message as cursor in c1 -> 404
    bad_cursor = client.get(
        f"/api/v1/communities/{c1.slug}/discussion/messages?before={c2_msg_id}"
    )
    assert bad_cursor.status_code == 404
    assert "Cursor message not found" in bad_cursor.json()["detail"]


# ==============================================================================
# 5. REACTIONS: ADD, CHANGE, REMOVE, SUMMARY
# ==============================================================================

def test_reactions_lifecycle_and_uniqueness(client, db_session):
    community = create_test_community(db_session)
    u1 = create_test_user(db_session, "user1")
    u2 = create_test_user(db_session, "user2")
    create_test_membership(db_session, u1, community)
    create_test_membership(db_session, u2, community)

    # U1 posts message
    login_user(client, db_session, u1)
    msg_resp = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "Post for reactions"},
    )
    msg_id = msg_resp.json()["id"]

    # U1 reacts with thumbs_up
    rx_resp = client.put(
        f"/api/v1/communities/{community.slug}/discussion/messages/{msg_id}/reaction",
        json={"emoji": "thumbs_up"},
    )
    assert rx_resp.status_code == 200
    rx_data = rx_resp.json()
    assert rx_data["caller_reaction"] == "thumbs_up"
    assert rx_data["reactions"] == [{"emoji": "thumbs_up", "count": 1}]

    # U2 reacts with heart
    login_user(client, db_session, u2)
    rx2_resp = client.put(
        f"/api/v1/communities/{community.slug}/discussion/messages/{msg_id}/reaction",
        json={"emoji": "heart"},
    )
    assert rx2_resp.status_code == 200
    assert rx2_resp.json()["caller_reaction"] == "heart"
    emojis = {r["emoji"]: r["count"] for r in rx2_resp.json()["reactions"]}
    assert emojis == {"thumbs_up": 1, "heart": 1}

    # U2 changes reaction to thumbs_up (replaces heart -> 2 thumbs_up, 0 hearts)
    rx2_change = client.put(
        f"/api/v1/communities/{community.slug}/discussion/messages/{msg_id}/reaction",
        json={"emoji": "thumbs_up"},
    )
    assert rx2_change.status_code == 200
    assert rx2_change.json()["caller_reaction"] == "thumbs_up"
    assert rx2_change.json()["reactions"] == [{"emoji": "thumbs_up", "count": 2}]

    # U2 deletes reaction
    del_resp = client.delete(
        f"/api/v1/communities/{community.slug}/discussion/messages/{msg_id}/reaction"
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["caller_reaction"] is None
    assert del_resp.json()["reactions"] == [{"emoji": "thumbs_up", "count": 1}]

    # Idempotent delete (U2 deletes again) -> 200 without error
    del_again = client.delete(
        f"/api/v1/communities/{community.slug}/discussion/messages/{msg_id}/reaction"
    )
    assert del_again.status_code == 200

    # Invalid emoji rejected -> 422
    bad_emoji = client.put(
        f"/api/v1/communities/{community.slug}/discussion/messages/{msg_id}/reaction",
        json={"emoji": "unauthorized_custom_emoji"},
    )
    assert bad_emoji.status_code == 422


# ==============================================================================
# 6. WEBSOCKET HANDSHAKE & EVENT BROADCASTING
# ==============================================================================

def test_websocket_unauthenticated_rejected(client, db_session):
    community = create_test_community(db_session)
    # Valid origin but no session cookie
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{community.slug}/discussion/ws",
            headers={"origin": "http://localhost:3000"},
        ) as ws:
            pass


def test_websocket_untrusted_origin_rejected(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{community.slug}/discussion/ws",
            headers={"origin": "http://evil-attacker.com"},
        ) as ws:
            pass


def test_websocket_origin_enforcement_matrix(client, db_session):
    """Verify exact rejection of missing, null, lookalike, and untrusted origins, plus production behavior."""
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # 1. Missing Origin header rejected
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{community.slug}/discussion/ws",
            headers={},
        ):
            pass

    # 2. "null" origin rejected
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{community.slug}/discussion/ws",
            headers={"origin": "null"},
        ):
            pass

    # 3. Lookalike origin rejected
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{community.slug}/discussion/ws",
            headers={"origin": "http://localhost:3000.attacker.com"},
        ):
            pass

    # 4. Untrusted port rejected
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{community.slug}/discussion/ws",
            headers={"origin": "http://localhost:3001"},
        ):
            pass

    # 5. Production mode: localhost rejected, only configured frontend_url permitted
    orig_env = settings.environment
    orig_frontend = settings.frontend_url
    try:
        settings.environment = "production"
        settings.frontend_url = "https://irm.fst.ma"
        with pytest.raises(Exception):
            with client.websocket_connect(
                f"/api/v1/communities/{community.slug}/discussion/ws",
                headers={"origin": "http://localhost:3000"},
            ):
                pass

        # Configured frontend_url accepted in production
        with client.websocket_connect(
            f"/api/v1/communities/{community.slug}/discussion/ws",
            headers={"origin": "https://irm.fst.ma"},
        ) as ws:
            pass
    finally:
        settings.environment = orig_env
        settings.frontend_url = orig_frontend


def test_websocket_real_login_issued_cookie(client, db_session):
    """
    Verify WebSocket authentication succeeds when using the actual session cookie
    issued by the real POST /api/v1/auth/login endpoint.
    """
    from app.core.security import hash_password
    password = "CorrectHorseBatteryStaple123!"
    user = User(
        id=uuid.uuid4(),
        username="real_login_user",
        email="real_login@example.com",
        password_hash=hash_password(password),
        first_name="Real",
        family_name="Login",
    )
    community = create_test_community(db_session)
    db_session.add(user)
    db_session.commit()
    create_test_membership(db_session, user, community)

    # Perform real login via REST endpoint
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
    )
    assert login_resp.status_code == 200
    assert settings.session_cookie_name in client.cookies

    # Connect to WebSocket using the client with the real login cookie
    with client.websocket_connect(
        f"/api/v1/communities/{community.slug}/discussion/ws",
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        pass


def test_websocket_connect_and_broadcast_message(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    with client.websocket_connect(
        f"/api/v1/communities/{community.slug}/discussion/ws",
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        # Create a message via REST
        resp = client.post(
            f"/api/v1/communities/{community.slug}/discussion/messages",
            json={
                "client_message_id": str(uuid.uuid4()),
                "kind": "TEXT",
                "content": "Broadcasted via WebSocket",
            },
        )
        assert resp.status_code == 201

        # Receive broadcast event
        event = ws.receive_json()
        assert event["type"] == "message_created"
        assert event["message"]["custom_sticker_id"] is None
        assert event["community_slug"] == community.slug
        assert event["message"]["content"] == "Broadcasted via WebSocket"
        assert event["message"]["author_username"] == user.username
        history = client.get(f"/api/v1/communities/{community.slug}/discussion/messages")
        history_item = next(item for item in history.json()["items"] if item["id"] == resp.json()["id"])
        assert event["message"]["author_id"] == resp.json()["author_id"]
        assert history_item["author_id"] == resp.json()["author_id"] == str(user.id)


def test_websocket_broadcast_reaction_change(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # Post message first
    post_resp = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={
            "client_message_id": str(uuid.uuid4()),
            "kind": "TEXT",
            "content": "Msg for WS reaction",
        },
    )
    msg_id = post_resp.json()["id"]

    with client.websocket_connect(
        f"/api/v1/communities/{community.slug}/discussion/ws",
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        # Update reaction via REST
        rx_resp = client.put(
            f"/api/v1/communities/{community.slug}/discussion/messages/{msg_id}/reaction",
            json={"emoji": "heart"},
        )
        assert rx_resp.status_code == 200

        # Receive reaction_changed event
        event = ws.receive_json()
        assert event["type"] == "reaction_changed"
        assert event["community_slug"] == community.slug
        assert event["message_id"] == str(msg_id)
        assert event["reactions"] == [{"emoji": "heart", "count": 1}]


def test_discussion_author_spoofing_forbidden(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    victim = create_test_user(db_session, "victim")
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # Attempt to spoof author_id or author_username -> 422 extra forbidden
    resp = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={
            "client_message_id": str(uuid.uuid4()),
            "kind": "TEXT",
            "content": "I am pretending to be victim",
            "author_id": str(victim.id),
        },
    )
    assert resp.status_code == 422

    resp2 = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={
            "client_message_id": str(uuid.uuid4()),
            "kind": "TEXT",
            "content": "I am pretending to be victim",
            "author_username": victim.username,
        },
    )
    assert resp2.status_code == 422


def test_history_author_ids_follow_foreign_keys_after_username_change(client, db_session):
    community = create_test_community(db_session)
    first = create_test_user(db_session, "first")
    second = create_test_user(db_session, "second")
    create_test_membership(db_session, first, community)
    create_test_membership(db_session, second, community)

    login_user(client, db_session, first)
    first_resp = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "from first"},
    )
    assert first_resp.status_code == 201
    assert first_resp.json()["author_id"] == str(first.id)

    login_user(client, db_session, second)
    second_resp = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "from second"},
    )
    assert second_resp.status_code == 201
    assert second_resp.json()["author_id"] == str(second.id)

    first.username = "renamed-first"
    db_session.commit()
    history = client.get(f"/api/v1/communities/{community.slug}/discussion/messages")
    assert history.status_code == 200
    by_content = {item["content"]: item for item in history.json()["items"]}
    assert by_content["from first"]["author_id"] == str(first.id)
    assert by_content["from first"]["author_username"] == "renamed-first"
    assert by_content["from second"]["author_id"] == str(second.id)


def test_request_author_id_cannot_impersonate_and_caller_is_author(client, db_session):
    community = create_test_community(db_session)
    caller = create_test_user(db_session, "caller")
    other = create_test_user(db_session, "other")
    create_test_membership(db_session, caller, community)
    login_user(client, db_session, caller)
    response = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "trusted caller", "author_id": str(other.id)},
    )
    assert response.status_code == 422
    clean = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "trusted caller"},
    )
    assert clean.status_code == 201
    assert clean.json()["author_id"] == str(caller.id)


def test_discussion_equal_timestamps_tie_breaking(client, db_session):
    from datetime import datetime, timezone
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    fixed_time = datetime(2026, 10, 7, 12, 0, 0, tzinfo=timezone.utc)
    id1 = uuid.UUID("00000000-0000-0000-0000-000000000001")
    id2 = uuid.UUID("00000000-0000-0000-0000-000000000002")

    msg1 = DiscussionMessage(
        id=id1,
        community_id=community.id,
        author_id=user.id,
        kind="TEXT",
        content="Equal Time 1",
        client_message_id=uuid.uuid4(),
        created_at=fixed_time,
    )
    msg2 = DiscussionMessage(
        id=id2,
        community_id=community.id,
        author_id=user.id,
        kind="TEXT",
        content="Equal Time 2",
        client_message_id=uuid.uuid4(),
        created_at=fixed_time,
    )
    db_session.add_all([msg1, msg2])
    db_session.commit()

    resp = client.get(f"/api/v1/communities/{community.slug}/discussion/messages")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 2
    # Strict deterministic tie-breaking: id1 before id2
    assert items[0]["id"] == str(id1)
    assert items[1]["id"] == str(id2)


def test_discussion_no_n_plus_one_queries(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # Insert 25 messages with reactions
    for i in range(25):
        m = DiscussionMessage(
            id=uuid.uuid4(),
            community_id=community.id,
            author_id=user.id,
            kind="TEXT",
            content=f"Batch msg {i}",
            client_message_id=uuid.uuid4(),
        )
        db_session.add(m)
        rx = DiscussionReaction(
            id=uuid.uuid4(),
            message_id=m.id,
            user_id=user.id,
            emoji="thumbs_up",
        )
        db_session.add(rx)
    db_session.commit()

    community_slug = community.slug
    query_count = 0

    def query_listener(conn, cursor, statement, parameters, context, executemany):
        nonlocal query_count
        query_count += 1

    from sqlalchemy import event
    event.listen(engine, "before_cursor_execute", query_listener)
    try:
        resp = client.get(f"/api/v1/communities/{community_slug}/discussion/messages")
        assert resp.status_code == 200
        # Expected bounded queries:
        # 1. validate_session (auth)
        # 2. get user (auth)
        # 3. get community (authz)
        # 4. get membership (authz)
        # 5. fetch messages joined with author
        # 6. aggregated reaction counts for all messages in page
        # 7. caller reactions for all messages in page
        # Total queries should be <= 8, regardless of 25 messages! (No N+1!)
        assert query_count <= 8, f"Too many queries ({query_count}), possible N+1 query issue!"
    finally:
        event.remove(engine, "before_cursor_execute", query_listener)


def test_websocket_community_isolation(client, db_session):
    c1 = create_test_community(db_session, "Comm A", "comm-a")
    c2 = create_test_community(db_session, "Comm B", "comm-b")

    u1 = create_test_user(db_session, "userA")
    create_test_membership(db_session, u1, c1)

    u2 = create_test_user(db_session, "userB")
    create_test_membership(db_session, u2, c2)

    login_user(client, db_session, u1)

    # Connect to Comm A
    with client.websocket_connect(
        f"/api/v1/communities/{c1.slug}/discussion/ws",
        headers={"origin": "http://localhost:3000"},
    ) as ws_a:
        # User 2 logs in and creates a message in Comm B
        login_user(client, db_session, u2)
        resp_b = client.post(
            f"/api/v1/communities/{c2.slug}/discussion/messages",
            json={
                "client_message_id": str(uuid.uuid4()),
                "kind": "TEXT",
                "content": "Secret message for Comm B",
            },
        )
        assert resp_b.status_code == 201

        # Now User 1 posts in Comm A
        login_user(client, db_session, u1)
        resp_a = client.post(
            f"/api/v1/communities/{c1.slug}/discussion/messages",
            json={
                "client_message_id": str(uuid.uuid4()),
                "kind": "TEXT",
                "content": "Message for Comm A",
            },
        )
        assert resp_a.status_code == 201

        # ws_a must receive Comm A event, and NEVER receive Comm B event!
        event = ws_a.receive_json()
        assert event["type"] == "message_created"
        assert event["community_slug"] == c1.slug
        assert event["message"]["content"] == "Message for Comm A"


def test_websocket_disconnect_cleanup(client, db_session):
    from app.core.broadcaster import broadcaster
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    with client.websocket_connect(
        f"/api/v1/communities/{community.slug}/discussion/ws",
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        assert len(broadcaster._connections.get(community.slug, set())) == 1

    # After exit context, connection is disconnected and cleaned up
    assert len(broadcaster._connections.get(community.slug, set())) == 0


@pytest.mark.asyncio
async def test_websocket_slow_client_queue_bounds():
    import asyncio
    from app.core.broadcaster import Connection
    from unittest.mock import AsyncMock, MagicMock
    from starlette.websockets import WebSocketState

    mock_ws = MagicMock()
    mock_ws.client_state = WebSocketState.CONNECTED
    mock_ws.close = AsyncMock()
    conn = Connection(websocket=mock_ws, user_id=uuid.uuid4(), community_slug="irm")

    # Enqueue 100 items (fills queue to WS_QUEUE_MAX_SIZE)
    for i in range(100):
        ok = conn.enqueue({"type": "test", "num": i})
        assert ok is True

    # 101st enqueue triggers queue overflow handling / immediate disconnect
    ok_overflow = conn.enqueue({"type": "test", "num": 101})
    assert ok_overflow is False
    assert conn.closed is True

    # Allow background close_and_cleanup task to execute
    await asyncio.sleep(0.05)
    mock_ws.close.assert_awaited_once()
    assert conn.queue.empty()


def test_reconnect_recovery_from_durable_history(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # User posts 3 messages while connected
    m1 = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "Msg 1"},
    ).json()
    m2 = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "Msg 2"},
    ).json()
    last_seen_id = m2["id"]

    # Client disconnects. During disconnection, 3 more messages are committed
    m3 = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "Msg 3"},
    ).json()
    m4 = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "Msg 4"},
    ).json()
    m5 = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "Msg 5"},
    ).json()

    # Client reconnects and queries durable history using after=last_seen_id
    reconnect_resp = client.get(
        f"/api/v1/communities/{community.slug}/discussion/messages?after={last_seen_id}"
    )
    assert reconnect_resp.status_code == 200
    recovered_items = reconnect_resp.json()["items"]
    assert len(recovered_items) == 3
    assert [m["content"] for m in recovered_items] == ["Msg 3", "Msg 4", "Msg 5"]


def test_two_user_reaction_isolation_and_broadcast(client, db_session):
    """
    Verify that User A's reaction never leaks into User B's selected caller_reaction,
    while both users observe the exact aggregate reaction count.
    Also verify WebSocket reaction_changed broadcast contains only aggregate counts
    and no user-specific identifiers.
    """
    from app.main import app

    community = create_test_community(db_session)
    user_a = create_test_user(db_session, "user_a")
    user_b = create_test_user(db_session, "user_b")
    create_test_membership(db_session, user_a, community)
    create_test_membership(db_session, user_b, community)

    # User A posts message
    login_user(client, db_session, user_a)
    msg_resp = client.post(
        f"/api/v1/communities/{community.slug}/discussion/messages",
        json={
            "client_message_id": str(uuid.uuid4()),
            "kind": "TEXT",
            "content": "Reaction test message",
        },
    )
    assert msg_resp.status_code == 201
    msg_id = msg_resp.json()["id"]

    # Open WebSocket for User B
    client_b = TestClient(app)
    login_user(client_b, db_session, user_b)
    with client_b.websocket_connect(
        f"/api/v1/communities/{community.slug}/discussion/ws",
        headers={"origin": "http://localhost:3000"},
    ) as ws_b:
        # User A reacts with "heart"
        rx_resp = client.put(
            f"/api/v1/communities/{community.slug}/discussion/messages/{msg_id}/reaction",
            json={"emoji": "heart"},
        )
        assert rx_resp.status_code == 200
        rx_data = rx_resp.json()
        assert rx_data["caller_reaction"] == "heart"
        assert rx_data["reactions"] == [{"emoji": "heart", "count": 1}]

        # User B receives broadcast
        event = ws_b.receive_json()
        assert event["type"] == "reaction_changed"
        assert event["message_id"] == str(msg_id)
        # Verify broadcast does NOT contain caller_reaction, user_id, or reactor username
        assert "caller_reaction" not in event
        assert "my_reaction" not in event
        assert "user_id" not in event
        assert event["reactions"] == [{"emoji": "heart", "count": 1}]

    # User A checks message via GET
    get_a = client.get(f"/api/v1/communities/{community.slug}/discussion/messages")
    item_a = [m for m in get_a.json()["items"] if m["id"] == msg_id][0]
    assert item_a["caller_reaction"] == "heart"
    assert item_a["reactions"] == [{"emoji": "heart", "count": 1}]

    # User B checks message via GET
    get_b = client_b.get(f"/api/v1/communities/{community.slug}/discussion/messages")
    item_b = [m for m in get_b.json()["items"] if m["id"] == msg_id][0]
    # User B's caller_reaction is None!
    assert item_b["caller_reaction"] is None
    # User B sees the aggregate count of 1
    assert item_b["reactions"] == [{"emoji": "heart", "count": 1}]


def test_discussion_simultaneous_before_and_after_rejected(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    uid1 = uuid.uuid4()
    uid2 = uuid.uuid4()
    resp = client.get(
        f"/api/v1/communities/{community.slug}/discussion/messages?before={uid1}&after={uid2}"
    )
    assert resp.status_code == 400
    assert "Cannot specify both" in resp.json()["detail"]


def test_discussion_history_limit_boundaries(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # limit = 0 -> 422
    resp0 = client.get(f"/api/v1/communities/{community.slug}/discussion/messages?limit=0")
    assert resp0.status_code == 422

    # limit = 51 (> MAX_DISCUSSION_HISTORY_LIMIT) -> 422
    resp51 = client.get(f"/api/v1/communities/{community.slug}/discussion/messages?limit=51")
    assert resp51.status_code == 422

    # limit = 50 -> 200
    resp50 = client.get(f"/api/v1/communities/{community.slug}/discussion/messages?limit=50")
    assert resp50.status_code == 200


def test_broadcaster_failure_after_commit_does_not_abort_mutation(client, db_session):
    """Verify that a committed REST mutation succeeds even if WebSocket broadcaster fails."""
    from unittest.mock import patch
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    cid = uuid.uuid4()
    with patch("app.api.v1.endpoints.discussion.broadcaster.broadcast", side_effect=RuntimeError("Broadcast failure")):
        resp = client.post(
            f"/api/v1/communities/{community.slug}/discussion/messages",
            json={
                "client_message_id": str(cid),
                "kind": "TEXT",
                "content": "Message despite broadcaster failure",
            },
        )
        assert resp.status_code == 201
        # Verify persisted in database
        persisted = db_session.query(DiscussionMessage).filter(DiscussionMessage.client_message_id == cid).first()
        assert persisted is not None
        assert persisted.content == "Message despite broadcaster failure"


def test_authorization_matrix_foreign_community_member_denied(client, db_session):
    """Verify that an active member of another community only cannot access IRM discussion."""
    irm = create_test_community(db_session, "IRM Hub", "irm")
    other_comm = create_test_community(db_session, "Other Community", "other")

    user = create_test_user(db_session, "other_member")
    create_test_membership(db_session, user, other_comm, status=MembershipStatus.ACTIVE)
    login_user(client, db_session, user)

    # REST GET messages -> 403
    resp_get = client.get(f"/api/v1/communities/{irm.slug}/discussion/messages")
    assert resp_get.status_code == 403

    # REST POST message -> 403
    resp_post = client.post(
        f"/api/v1/communities/{irm.slug}/discussion/messages",
        json={
            "client_message_id": str(uuid.uuid4()),
            "kind": "TEXT",
            "content": "Intrusion attempt",
        },
    )
    assert resp_post.status_code == 403

    # WebSocket handshake -> rejected with 1008
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{irm.slug}/discussion/ws",
            headers={"origin": "http://localhost:3000"},
        ) as ws:
            pass


def test_authorization_matrix_websocket_handshake_all_personas(client, db_session):
    """Verify WebSocket handshake rejection vs acceptance across the full persona spectrum."""
    irm = create_test_community(db_session, "IRM Hub", "irm")

    # 1. Guest -> rejected
    client.cookies.clear()
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{irm.slug}/discussion/ws",
            headers={"origin": "http://localhost:3000"},
        ) as ws:
            pass

    # 2. Authenticated user without IRM membership -> rejected
    u_no_mem = create_test_user(db_session)
    login_user(client, db_session, u_no_mem)
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{irm.slug}/discussion/ws",
            headers={"origin": "http://localhost:3000"},
        ) as ws:
            pass

    # 3. PENDING applicant -> rejected
    u_pending = create_test_user(db_session)
    create_test_membership(db_session, u_pending, irm, status=MembershipStatus.PENDING)
    login_user(client, db_session, u_pending)
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{irm.slug}/discussion/ws",
            headers={"origin": "http://localhost:3000"},
        ) as ws:
            pass

    # 4. REJECTED applicant -> rejected
    u_rejected = create_test_user(db_session)
    create_test_membership(db_session, u_rejected, irm, status=MembershipStatus.REJECTED)
    login_user(client, db_session, u_rejected)
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{irm.slug}/discussion/ws",
            headers={"origin": "http://localhost:3000"},
        ) as ws:
            pass

    # 4b. Active member of another community only -> rejected
    other_comm = create_test_community(db_session, "Other", "other-comm")
    u_other = create_test_user(db_session)
    create_test_membership(db_session, u_other, other_comm, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER)
    login_user(client, db_session, u_other)
    with pytest.raises(Exception):
        with client.websocket_connect(
            f"/api/v1/communities/{irm.slug}/discussion/ws",
            headers={"origin": "http://localhost:3000"},
        ) as ws:
            pass

    # 5. ACTIVE IRM MEMBER -> accepted
    u_member = create_test_user(db_session)
    create_test_membership(db_session, u_member, irm, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER)
    login_user(client, db_session, u_member)
    with client.websocket_connect(
        f"/api/v1/communities/{irm.slug}/discussion/ws",
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        pass

    # 6. ACTIVE IRM MODERATOR without announcement grants -> accepted
    u_mod_no_grant = create_test_user(db_session)
    create_test_membership(db_session, u_mod_no_grant, irm, status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR)
    login_user(client, db_session, u_mod_no_grant)
    with client.websocket_connect(
        f"/api/v1/communities/{irm.slug}/discussion/ws",
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        pass

    # 7. ACTIVE IRM MODERATOR with announcement grants -> accepted
    u_mod_grant = create_test_user(db_session)
    m_grant = create_test_membership(db_session, u_mod_grant, irm, status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR)
    m_grant.can_create_announcements = True
    db_session.commit()
    login_user(client, db_session, u_mod_grant)
    with client.websocket_connect(
        f"/api/v1/communities/{irm.slug}/discussion/ws",
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        pass

    # 8. ACTIVE IRM DELEGATE -> accepted
    u_delegate = create_test_user(db_session)
    create_test_membership(db_session, u_delegate, irm, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE)
    login_user(client, db_session, u_delegate)
    with client.websocket_connect(
        f"/api/v1/communities/{irm.slug}/discussion/ws",
        headers={"origin": "http://localhost:3000"},
    ) as ws:
        pass


def test_cross_community_reaction_isolation(client, db_session):
    """Verify that users cannot react to or delete reactions on messages belonging to another community."""
    c1 = create_test_community(db_session, "Comm 1", "c1")
    c2 = create_test_community(db_session, "Comm 2", "c2")

    u1 = create_test_user(db_session, "user_c1")
    create_test_membership(db_session, u1, c1)

    u2 = create_test_user(db_session, "user_c2")
    create_test_membership(db_session, u2, c2)

    # Post message in c2
    login_user(client, db_session, u2)
    resp = client.post(
        f"/api/v1/communities/{c2.slug}/discussion/messages",
        json={"client_message_id": str(uuid.uuid4()), "kind": "TEXT", "content": "Private to c2"},
    )
    c2_msg_id = resp.json()["id"]

    # User 1 (member of c1) attempts to react to c2's message under c1's endpoint -> 404 (masked)
    login_user(client, db_session, u1)
    rx_resp = client.put(
        f"/api/v1/communities/{c1.slug}/discussion/messages/{c2_msg_id}/reaction",
        json={"emoji": "thumbs_up"},
    )
    assert rx_resp.status_code == 404
    assert "Discussion message not found" in rx_resp.json()["detail"]

    # Delete reaction on c2 message from c1 endpoint -> 404
    del_resp = client.delete(
        f"/api/v1/communities/{c1.slug}/discussion/messages/{c2_msg_id}/reaction"
    )
    assert del_resp.status_code == 404


@pytest.mark.asyncio
async def test_broadcaster_shutdown_and_lifecycle_resource_release():
    """Verify that broadcaster shutdown cancels all sender/revalidation tasks and releases connection registrations."""
    import asyncio
    from unittest.mock import AsyncMock, MagicMock
    from starlette.websockets import WebSocketState
    from app.core.broadcaster import Connection, DiscussionBroadcaster

    bc = DiscussionBroadcaster()
    conns = []
    for i in range(5):
        mock_ws = MagicMock()
        mock_ws.client_state = WebSocketState.CONNECTED
        mock_ws.close = AsyncMock()
        conn = Connection(websocket=mock_ws, user_id=uuid.uuid4(), community_slug="irm")
        await bc.connect(conn)
        conns.append(conn)

    assert len(bc._connections["irm"]) == 5

    # Trigger graceful shutdown
    await bc.shutdown()
    await asyncio.sleep(0.01)

    # All connections unregistered and closed
    assert len(bc._connections) == 0
    for conn in conns:
        assert conn.closed is True
        assert conn.sender_task.done() or conn.sender_task.cancelled()
        assert conn.queue.empty()
        conn.websocket.close.assert_awaited_once_with(code=1001, reason="Server shutting down")


@pytest.mark.asyncio
async def test_broadcaster_bounded_concurrent_workload_and_resource_release():
    """
    Exercise repeated connect/disconnect cycles and concurrent subscribers.
    Verifies that broadcaster connection set, sender tasks, revalidation tasks,
    and queues are completely released without leaking.
    """
    import asyncio
    from unittest.mock import AsyncMock, MagicMock
    from starlette.websockets import WebSocketState
    from app.core.broadcaster import Connection, DiscussionBroadcaster

    bc = DiscussionBroadcaster()

    # Phase 1: Rapid connect / disconnect cycles (20 iterations)
    for _ in range(20):
        mock_ws = MagicMock()
        mock_ws.client_state = WebSocketState.CONNECTED
        mock_ws.close = AsyncMock()
        mock_ws.send_json = AsyncMock()
        conn = Connection(websocket=mock_ws, user_id=uuid.uuid4(), community_slug="irm")
        await bc.connect(conn)
        assert len(bc._connections["irm"]) == 1
        await bc.broadcast("irm", {"type": "ping"})
        await bc.disconnect(conn)
        await asyncio.sleep(0)
        assert "irm" not in bc._connections
        assert conn.closed is True
        assert conn.sender_task.done() or conn.sender_task.cancelled()
        assert conn.queue.empty()

    # Phase 2: Concurrent group of 10 clients receiving multiple broadcasts
    active_conns: list[Connection] = []
    for _ in range(10):
        mock_ws = MagicMock()
        mock_ws.client_state = WebSocketState.CONNECTED
        mock_ws.close = AsyncMock()
        mock_ws.send_json = AsyncMock()
        conn = Connection(websocket=mock_ws, user_id=uuid.uuid4(), community_slug="irm")
        await bc.connect(conn)
        active_conns.append(conn)

    assert len(bc._connections["irm"]) == 10

    for i in range(5):
        await bc.broadcast("irm", {"type": "message_created", "seq": i})

    # Allow sender loops to process
    await asyncio.sleep(0.05)

    # Disconnect half normally
    for conn in active_conns[:5]:
        await bc.disconnect(conn)

    assert len(bc._connections["irm"]) == 5

    # Shutdown the remaining half
    await bc.shutdown()
    await asyncio.sleep(0.01)

    assert len(bc._connections) == 0
    for conn in active_conns:
        assert conn.closed is True
        assert conn.sender_task.done() or conn.sender_task.cancelled()
        assert conn.queue.empty()


def _create_custom_sticker_asset(db, owner, storage):
    from io import BytesIO
    from PIL import Image

    source = BytesIO()
    Image.new("RGBA", (40, 80), (12, 90, 170, 127)).save(source, format="PNG")
    canonical = process_sticker_image(source.getvalue(), "image/png")
    asset_id = uuid.uuid4()
    key = storage.save_sticker_immutable(owner.id, asset_id, canonical)
    asset = StickerAsset(id=asset_id, owner_id=owner.id, storage_key=key,
                         media_type="image/webp", width=256, height=256,
                         byte_size=len(canonical))
    db.add(asset)
    db.commit()
    return asset, canonical


def test_custom_sticker_send_retry_history_event_and_protected_media(
    client, db_session, tmp_path, monkeypatch
):
    community = create_test_community(db_session)
    other_community = create_test_community(db_session, name="Other", slug="other")
    owner = create_test_user(db_session)
    reader = create_test_user(db_session)
    create_test_membership(db_session, owner, community)
    create_test_membership(db_session, reader, community, role=MembershipRole.DELEGATE)
    create_test_membership(db_session, reader, other_community)
    storage = LocalFileSystemStorage(tmp_path)
    asset, expected_bytes = _create_custom_sticker_asset(db_session, owner, storage)
    second_asset, _ = _create_custom_sticker_asset(db_session, owner, storage)
    app.dependency_overrides[discussion_endpoint.get_discussion_sticker_storage] = lambda: storage
    app.dependency_overrides[sticker_endpoint.get_sticker_storage] = lambda: storage

    token = login_user(client, db_session, owner)
    body = {"client_message_id": str(uuid.uuid4()), "kind": "CUSTOM_STICKER",
            "custom_sticker_id": str(asset.id)}
    events = []

    async def capture_event(slug, event):
        events.append((slug, event))

    monkeypatch.setattr(discussion_endpoint.broadcaster, "broadcast", capture_event)
    path = f"/api/v1/communities/{community.slug}/discussion/messages"
    created = client.post(path, json=body)
    assert created.status_code == 201, created.text
    sent = created.json()
    assert sent["kind"] == "CUSTOM_STICKER"
    assert sent["custom_sticker_id"] == str(asset.id)
    assert sent["sticker_id"] is None and sent["content"] is None
    assert sent["author_id"] == str(owner.id)
    owner_preview = client.get(f"/api/v1/auth/me/stickers/{asset.id}/image")
    assert owner_preview.status_code == 200
    conflict = client.post(path, json={**body, "custom_sticker_id": str(second_asset.id)})
    assert conflict.status_code == 409
    assert len(events) == 1
    event_message = events[0][1]["message"]
    assert event_message["custom_sticker_id"] == sent["custom_sticker_id"]
    assert event_message["author_id"] == sent["author_id"]
    history = client.get(path).json()["items"]
    history_message = next(item for item in history if item["id"] == sent["id"])
    assert history_message["custom_sticker_id"] == sent["custom_sticker_id"]
    assert history_message["author_id"] == sent["author_id"]

    login_user(client, db_session, reader)
    media_path = f"{path}/{sent['id']}/sticker"
    media = client.get(media_path)
    assert media.status_code == 200
    assert media.content == expected_bytes
    assert media.headers["Content-Type"] == "image/webp"
    assert media.headers["Content-Disposition"] == "inline"
    assert media.headers["Cache-Control"] == "private, no-store"
    assert "Cookie" in {value.strip() for value in media.headers["Vary"].split(",")}
    assert media.headers["X-Content-Type-Options"] == "nosniff"
    owner_preview = client.get(f"/api/v1/auth/me/stickers/{asset.id}/image")
    assert owner_preview.status_code == 404, owner_preview.text
    assert client.get(
        f"/api/v1/communities/{other_community.slug}/discussion/messages/{sent['id']}/sticker"
    ).status_code == 404
    wrong_kind = DiscussionMessage(
        community_id=community.id, author_id=owner.id, kind="TEXT", content="text only",
        client_message_id=uuid.uuid4(),
    )
    db_session.add(wrong_kind)
    db_session.commit()
    assert client.get(f"{path}/{wrong_kind.id}/sticker").status_code == 404
    guest = create_test_user(db_session)
    login_user(client, db_session, guest)
    assert client.get(media_path).status_code == 403
    login_user(client, db_session, reader)

    # Library removal leaves message-scoped delivery and idempotent replay intact.
    from app.services.sticker_library import remove_user_sticker
    remove_user_sticker(owner.id, token, asset.id)
    client.cookies.set(settings.session_cookie_name, token)
    assert client.get(f"/api/v1/auth/me/stickers/{asset.id}/image").status_code == 404
    replay = client.post(path, json=body)
    assert replay.status_code == 200
    assert replay.json()["id"] == sent["id"]
    assert replay.json()["custom_sticker_id"] == str(asset.id)
    assert replay.json()["author_id"] == str(owner.id)
    assert len(events) == 1
    client.cookies.set(settings.session_cookie_name, "")
    login_user(client, db_session, reader)
    assert client.get(media_path).content == expected_bytes
    storage.delete_sticker(asset.storage_key, owner.id)
    unavailable = client.get(media_path)
    assert unavailable.status_code == 404
    assert unavailable.headers["Cache-Control"] == "private, no-store"
    assert "Cookie" in {value.strip() for value in unavailable.headers["Vary"].split(",")}
    assert unavailable.headers["X-Content-Type-Options"] == "nosniff"

    # Corrupt canonical storage fails closed without decoder details.
    client.cookies.set(settings.session_cookie_name, token)
    corrupt_asset, _ = _create_custom_sticker_asset(db_session, owner, storage)
    corrupt_body = {"client_message_id": str(uuid.uuid4()), "kind": "CUSTOM_STICKER",
                    "custom_sticker_id": str(corrupt_asset.id)}
    corrupt_message = client.post(path, json=corrupt_body)
    assert corrupt_message.status_code == 201
    corrupt_path = storage.root / corrupt_asset.storage_key
    corrupt_path.write_bytes(b"not a webp")
    client.cookies.set(settings.session_cookie_name, "")
    login_user(client, db_session, reader)
    corrupt_read = client.get(f"{path}/{corrupt_message.json()['id']}/sticker")
    assert corrupt_read.status_code == 404
    assert corrupt_read.headers["Cache-Control"] == "private, no-store"

    removed = client.delete(f"{path}/{sent['id']}")
    assert removed.status_code == 204
    assert events[-1][1] == {
        "type": "message_removed", "community_slug": community.slug,
        "message_id": sent["id"],
    }
    assert client.get(media_path).status_code == 404
    client.cookies.set(settings.session_cookie_name, token)
    removed_retry = client.post(path, json=body)
    assert removed_retry.status_code == 409
    assert "custom_sticker_id" not in removed_retry.text


def test_custom_sticker_request_shape_and_asset_ownership(client, db_session, tmp_path):
    community = create_test_community(db_session)
    owner = create_test_user(db_session)
    caller = create_test_user(db_session)
    create_test_membership(db_session, owner, community)
    create_test_membership(db_session, caller, community)
    storage = LocalFileSystemStorage(tmp_path)
    asset, _ = _create_custom_sticker_asset(db_session, owner, storage)
    removed_asset, _ = _create_custom_sticker_asset(db_session, owner, storage)
    ownerless_asset, _ = _create_custom_sticker_asset(db_session, owner, storage)
    from datetime import datetime, timezone
    removed_asset.removed_at = datetime.now(timezone.utc)
    ownerless_asset.owner_id = None
    db_session.commit()
    login_user(client, db_session, caller)
    path = f"/api/v1/communities/{community.slug}/discussion/messages"
    body = {"client_message_id": str(uuid.uuid4()), "kind": "CUSTOM_STICKER",
            "custom_sticker_id": str(asset.id)}
    assert client.post(path, json=body).status_code == 404
    assert client.post(path, json={**body, "client_message_id": str(uuid.uuid4()),
                                   "custom_sticker_id": str(removed_asset.id)}).status_code == 404
    assert client.post(path, json={**body, "client_message_id": str(uuid.uuid4()),
                                   "custom_sticker_id": str(ownerless_asset.id)}).status_code == 404
    assert client.post(path, json={**body, "content": "conflict"}).status_code == 422
    assert client.post(path, json={**body, "sticker_id": next(iter(VALID_STICKER_IDS))}).status_code == 422
    assert client.post(path, json={**body, "author_id": str(owner.id)}).status_code == 422
    assert client.post(path, json={**body, "image_url": "https://example.invalid/x"}).status_code == 422
    assert client.post(path, json={**body, "storage_key": asset.storage_key}).status_code == 422


def test_custom_sticker_message_created_websocket_event(client, db_session, tmp_path):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    storage = LocalFileSystemStorage(tmp_path)
    asset, _ = _create_custom_sticker_asset(db_session, user, storage)
    app.dependency_overrides[discussion_endpoint.get_discussion_sticker_storage] = lambda: storage
    login_user(client, db_session, user)
    client_id = str(uuid.uuid4())
    path = f"/api/v1/communities/{community.slug}/discussion/messages"

    with client.websocket_connect(
        f"/api/v1/communities/{community.slug}/discussion/ws",
        headers={"origin": "http://localhost:3000"},
    ) as websocket:
        response = client.post(path, json={
            "client_message_id": client_id,
            "kind": "CUSTOM_STICKER",
            "custom_sticker_id": str(asset.id),
        })
        assert response.status_code == 201, response.text
        event = websocket.receive_json()
        assert event["type"] == "message_created"
        assert event["message"]["custom_sticker_id"] == str(asset.id)
        assert event["message"]["author_id"] == str(user.id)
        assert event["message"]["id"] == response.json()["id"]


