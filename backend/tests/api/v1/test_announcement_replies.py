import uuid
from datetime import datetime, timezone, timedelta
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.announcement import Announcement
from app.models.announcement_reply import AnnouncementReply
from app.models.community import Community
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.membership_permission import MembershipPermission, PermissionType
from app.models.user import User

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
    yield
    app.dependency_overrides.clear()


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


def _create_user(db, username: str, email: str | None = None) -> User:
    email = email or f"{username}@example.com"
    user = User(
        username=username,
        email=email,
        password_hash="fakehash",
        first_name="First",
        family_name="Last",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _create_community(db, name="IRM", slug="irm") -> Community:
    c = Community(name=name, slug=slug)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _create_membership(
    db, user, community, role=MembershipRole.MEMBER, status=MembershipStatus.ACTIVE, cne="CNE123"
) -> Membership:
    m = Membership(
        user_id=user.id,
        community_id=community.id,
        role=role,
        status=status,
        cne=cne,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def _create_announcement(db, community, author, title="Notice", content="Body") -> Announcement:
    a = Announcement(
        community_id=community.id,
        author_id=author.id,
        title=title,
        content=content,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


def _login(client, db, user) -> str:
    token, _ = create_session(db, user.id, timedelta(days=1))
    client.cookies.set(settings.session_cookie_name, token)
    return token


# =========================================================================
# 1. AUTHORIZATION TESTS
# =========================================================================

def test_guest_cannot_reply_or_read_replies(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    # POST as guest
    res_post = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "Guest reply"},
    )
    assert res_post.status_code == 401

    # GET as guest
    res_get = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies"
    )
    assert res_get.status_code == 401


def test_non_member_cannot_reply_or_read_replies(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    non_member = _create_user(db_session, "non_member")
    _login(client, db_session, non_member)

    res_post = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "Non member reply"},
    )
    assert res_post.status_code == 403

    res_get = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies"
    )
    assert res_get.status_code == 403


def test_pending_and_rejected_members_cannot_reply_or_read_replies(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    # Pending applicant
    pending_user = _create_user(db_session, "pending_user")
    _create_membership(db_session, pending_user, community, status=MembershipStatus.PENDING, cne="P1")
    _login(client, db_session, pending_user)

    res_post = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "Pending reply"},
    )
    assert res_post.status_code == 403

    res_get = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies"
    )
    assert res_get.status_code == 403

    # Rejected applicant
    rejected_user = _create_user(db_session, "rejected_user")
    _create_membership(db_session, rejected_user, community, status=MembershipStatus.REJECTED, cne="R1")
    _login(client, db_session, rejected_user)

    res_post = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "Rejected reply"},
    )
    assert res_post.status_code == 403

    res_get = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies"
    )
    assert res_get.status_code == 403


def test_foreign_community_member_cannot_reply_or_read_replies(client, db_session):
    community_a = _create_community(db_session, name="Community A", slug="comm-a")
    community_b = _create_community(db_session, name="Community B", slug="comm-b")

    author_a = _create_user(db_session, "author_a")
    announcement_a = _create_announcement(db_session, community_a, author_a)

    user_b = _create_user(db_session, "user_b")
    _create_membership(db_session, user_b, community_b, status=MembershipStatus.ACTIVE, cne="B1")
    _login(client, db_session, user_b)

    res_post = client.post(
        f"/api/v1/communities/{community_a.slug}/announcements/{announcement_a.id}/replies",
        json={"content": "Intruder reply"},
    )
    assert res_post.status_code == 403

    res_get = client.get(
        f"/api/v1/communities/{community_a.slug}/announcements/{announcement_a.id}/replies"
    )
    assert res_get.status_code == 403


def test_active_ordinary_member_can_reply_and_read(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "ordinary_member")
    _create_membership(db_session, member, community, role=MembershipRole.MEMBER, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    # Ordinary member can reply
    res_post = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "Thanks for the announcement!"},
    )
    assert res_post.status_code == 201
    data = res_post.json()
    assert data["content"] == "Thanks for the announcement!"
    assert data["author_username"] == "ordinary_member"
    assert data["announcement_id"] == str(announcement.id)

    # Read replies
    res_get = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies"
    )
    assert res_get.status_code == 200
    list_data = res_get.json()
    assert len(list_data["items"]) == 1
    assert list_data["items"][0]["content"] == "Thanks for the announcement!"
    assert list_data["items"][0]["author_username"] == "ordinary_member"
    assert list_data["next_cursor"] is None


def test_ungranted_active_moderator_can_reply_and_read(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    # Moderator with NO CREATE_ANNOUNCEMENTS permission
    mod = _create_user(db_session, "ungranted_mod")
    _create_membership(db_session, mod, community, role=MembershipRole.MODERATOR, status=MembershipStatus.ACTIVE)
    _login(client, db_session, mod)

    # Replying must succeed (does not require CREATE_ANNOUNCEMENTS)
    res_post = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "Moderator replying without creation grant"},
    )
    assert res_post.status_code == 201
    assert res_post.json()["author_username"] == "ungranted_mod"


def test_active_delegate_can_reply_and_read(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    delegate = _create_user(db_session, "delegate_user")
    _create_membership(db_session, delegate, community, role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE)
    _login(client, db_session, delegate)

    res_post = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "Delegate comment here"},
    )
    assert res_post.status_code == 201
    assert res_post.json()["author_username"] == "delegate_user"


def test_unknown_and_cross_community_announcement_produces_404(client, db_session):
    community_a = _create_community(db_session, name="A", slug="comm-a")
    community_b = _create_community(db_session, name="B", slug="comm-b")

    author = _create_user(db_session, "author")
    announcement_b = _create_announcement(db_session, community_b, author)

    # Member of community A
    member_a = _create_user(db_session, "member_a")
    _create_membership(db_session, member_a, community_a, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member_a)

    random_id = uuid.uuid4()

    # 1. Random non-existent announcement in comm-a -> 404
    res_post = client.post(
        f"/api/v1/communities/{community_a.slug}/announcements/{random_id}/replies",
        json={"content": "Hello"},
    )
    assert res_post.status_code == 404
    assert res_post.json()["detail"] == "Announcement not found"

    res_get = client.get(
        f"/api/v1/communities/{community_a.slug}/announcements/{random_id}/replies"
    )
    assert res_get.status_code == 404
    assert res_get.json()["detail"] == "Announcement not found"

    # 2. Announcement belonging to comm-b requested under comm-a -> same safe 404
    res_cross_post = client.post(
        f"/api/v1/communities/{community_a.slug}/announcements/{announcement_b.id}/replies",
        json={"content": "Cross attempt"},
    )
    assert res_cross_post.status_code == 404
    assert res_cross_post.json()["detail"] == "Announcement not found"

    res_cross_get = client.get(
        f"/api/v1/communities/{community_a.slug}/announcements/{announcement_b.id}/replies"
    )
    assert res_cross_get.status_code == 404
    assert res_cross_get.json()["detail"] == "Announcement not found"


# =========================================================================
# 2. VALIDATION & SANITIZATION TESTS
# =========================================================================

def test_content_validation_blank_and_whitespace_only(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    # Empty string
    res = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": ""},
    )
    assert res.status_code == 422

    # Whitespace only
    res2 = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "   \n\t   "},
    )
    assert res2.status_code == 422


def test_content_validation_length_bounds(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    # Exactly 2000 chars -> OK
    exact_2000 = "x" * 2000
    res_2000 = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": exact_2000},
    )
    assert res_2000.status_code == 201
    assert len(res_2000.json()["content"]) == 2000

    # 2001 chars -> 422
    over_2001 = "x" * 2001
    res_2001 = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": over_2001},
    )
    assert res_2001.status_code == 422

    # Trimmed whitespace normalization before length check:
    # 2000 chars surrounded by whitespace -> 2000 chars after strip -> OK
    padded_2000 = "   " + ("y" * 2000) + "   "
    res_padded = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": padded_2000},
    )
    assert res_padded.status_code == 201
    assert len(res_padded.json()["content"]) == 2000


def test_content_validation_non_string_null_and_extra_fields(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    # Integer
    res_int = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": 12345},
    )
    assert res_int.status_code == 422

    # Null
    res_null = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": None},
    )
    assert res_null.status_code == 422

    # Extra fields forbidden
    res_extra = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "Valid text", "author_id": str(uuid.uuid4())},
    )
    assert res_extra.status_code == 422

    res_extra2 = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "Valid text", "author_username": "other"},
    )
    assert res_extra2.status_code == 422


def test_whitespace_normalization_and_newline_preservation(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    raw_content = "   Paragraph 1.\n\nParagraph 2 with   spaces inside.\nParagraph 3.   "
    expected = "Paragraph 1.\n\nParagraph 2 with   spaces inside.\nParagraph 3."

    res = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": raw_content},
    )
    assert res.status_code == 201
    assert res.json()["content"] == expected


def test_html_text_stored_as_plain_text(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    html_payload = "<script>alert('xss')</script><b>Bold Title</b> &amp; 'quotes'"
    res = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": html_payload},
    )
    assert res.status_code == 201
    assert res.json()["content"] == html_payload


def test_safe_response_fields_and_username_only(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author", email="secret_author@example.com")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "reply_user", email="secret_reply@example.com")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE, cne="SECRET_CNE")
    _login(client, db_session, member)

    res = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "Reply content"},
    )
    assert res.status_code == 201
    data = res.json()

    # Exact expected fields
    assert set(data.keys()) == {"id", "announcement_id", "author_username", "content", "created_at"}
    assert data["author_username"] == "reply_user"
    assert "email" not in data
    assert "cne" not in data
    assert "password_hash" not in data
    assert "author_id" not in data


def test_cache_control_headers_on_replies(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    # Empty GET has private, no-store
    res_empty = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies"
    )
    assert res_empty.status_code == 200
    assert res_empty.headers.get("Cache-Control") == "private, no-store"

    # POST has private, no-store
    res_post = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "First reply"},
    )
    assert res_post.status_code == 201
    assert res_post.headers.get("Cache-Control") == "private, no-store"

    # Populated GET has private, no-store
    res_get = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies"
    )
    assert res_get.status_code == 200
    assert res_get.headers.get("Cache-Control") == "private, no-store"


# =========================================================================
# 3. PAGINATION & CURSOR BEHAVIOR TESTS
# =========================================================================

def test_cursor_pagination_ascending_and_multiple_pages(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    # Create 5 replies with distinct timestamps in ascending order
    base_time = datetime(2026, 10, 1, 10, 0, 0, tzinfo=timezone.utc)
    reply_ids = []
    for i in range(5):
        r = AnnouncementReply(
            announcement_id=announcement.id,
            author_id=member.id,
            content=f"Reply #{i + 1}",
            created_at=base_time + timedelta(minutes=i),
        )
        db_session.add(r)
        db_session.commit()
        reply_ids.append(str(r.id))

    # Page 1: limit=2
    res_p1 = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies?limit=2"
    )
    assert res_p1.status_code == 200
    p1 = res_p1.json()
    assert len(p1["items"]) == 2
    assert p1["items"][0]["content"] == "Reply #1"
    assert p1["items"][1]["content"] == "Reply #2"
    cursor_1 = p1["next_cursor"]
    assert cursor_1 == reply_ids[1]

    # Page 2: limit=2, after=cursor_1
    res_p2 = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies?limit=2&after={cursor_1}"
    )
    assert res_p2.status_code == 200
    p2 = res_p2.json()
    assert len(p2["items"]) == 2
    assert p2["items"][0]["content"] == "Reply #3"
    assert p2["items"][1]["content"] == "Reply #4"
    cursor_2 = p2["next_cursor"]
    assert cursor_2 == reply_ids[3]

    # Page 3: limit=2, after=cursor_2
    res_p3 = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies?limit=2&after={cursor_2}"
    )
    assert res_p3.status_code == 200
    p3 = res_p3.json()
    assert len(p3["items"]) == 1
    assert p3["items"][0]["content"] == "Reply #5"
    assert p3["next_cursor"] is None


def test_cursor_pagination_equal_timestamps(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    # Create 4 replies with EXACT same timestamp
    exact_time = datetime(2026, 10, 1, 12, 0, 0, tzinfo=timezone.utc)
    for i in range(4):
        r = AnnouncementReply(
            announcement_id=announcement.id,
            author_id=member.id,
            content=f"SameTime #{i + 1}",
            created_at=exact_time,
        )
        db_session.add(r)
    db_session.commit()

    # Query all in one go to know the deterministic tie-breaker order (id asc)
    res_all = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies?limit=10"
    )
    assert res_all.status_code == 200
    all_items = res_all.json()["items"]
    assert len(all_items) == 4

    # Now step through one by one using limit=1
    paginated_items = []
    cursor = None
    for _ in range(4):
        url = f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies?limit=1"
        if cursor:
            url += f"&after={cursor}"
        res = client.get(url)
        assert res.status_code == 200
        data = res.json()
        assert len(data["items"]) == 1
        paginated_items.append(data["items"][0])
        cursor = data["next_cursor"]

    # Verify no skips and no duplicates
    assert [item["id"] for item in paginated_items] == [item["id"] for item in all_items]
    assert [item["content"] for item in paginated_items] == [item["content"] for item in all_items]
    assert cursor is None


def test_invalid_and_cross_announcement_cursors(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement_1 = _create_announcement(db_session, community, author, title="A1")
    announcement_2 = _create_announcement(db_session, community, author, title="A2")

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    # Create reply on announcement 2
    r2 = AnnouncementReply(
        announcement_id=announcement_2.id,
        author_id=member.id,
        content="Reply on A2",
    )
    db_session.add(r2)
    db_session.commit()

    # 1. Unknown UUID cursor -> 400 Bad Request
    unknown_uuid = uuid.uuid4()
    res_unknown = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement_1.id}/replies?after={unknown_uuid}"
    )
    assert res_unknown.status_code == 400
    assert res_unknown.json()["detail"] == "Invalid pagination cursor"

    # 2. Cross-announcement cursor (r2 belongs to A2, queried under A1) -> 400 Bad Request
    res_cross = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement_1.id}/replies?after={r2.id}"
    )
    assert res_cross.status_code == 400
    assert res_cross.json()["detail"] == "Invalid pagination cursor"

    # 3. Malformed non-UUID cursor -> 422 Unprocessable Entity
    res_malformed = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement_1.id}/replies?after=invalid-uuid-format"
    )
    assert res_malformed.status_code == 422


def test_pagination_limit_query_boundaries(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    # limit=0 -> 422
    res_0 = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies?limit=0"
    )
    assert res_0.status_code == 422

    # limit=51 -> 422
    res_51 = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies?limit=51"
    )
    assert res_51.status_code == 422

    # limit=1 -> OK
    res_1 = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies?limit=1"
    )
    assert res_1.status_code == 200

    # limit=50 -> OK
    res_50 = client.get(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies?limit=50"
    )
    assert res_50.status_code == 200


# =========================================================================
# 4. LIFECYCLE & TRANSACTIONAL INTEGRITY TESTS
# =========================================================================

def test_parent_announcement_updated_at_unchanged_on_reply(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)
    initial_updated_at = announcement.updated_at

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    res = client.post(
        f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
        json={"content": "New reply added"},
    )
    assert res.status_code == 201

    db_session.refresh(announcement)
    assert announcement.updated_at == initial_updated_at


def test_sql_level_bounded_retrieval_and_no_n_plus_one_author_queries(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    # Create 5 distinct users who each post a reply
    for i in range(5):
        u = _create_user(db_session, f"user_{i}")
        _create_membership(db_session, u, community, status=MembershipStatus.ACTIVE)
        r = AnnouncementReply(
            announcement_id=announcement.id,
            author_id=u.id,
            content=f"Comment {i}",
        )
        db_session.add(r)
    db_session.commit()

    reader = _create_user(db_session, "reader")
    _create_membership(db_session, reader, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, reader)

    # Monitor executed SQL queries on db engine
    queries = []

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        queries.append(statement)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        res = client.get(
            f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies?limit=5"
        )
        assert res.status_code == 200
        assert len(res.json()["items"]) == 5
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)

    # Check queries:
    # There should NOT be 5 separate SELECT FROM users queries!
    user_selects = [q for q in queries if "FROM users" in q and "JOIN" not in q]
    # At most 1 for session authentication user lookup
    assert len(user_selects) <= 1, f"Expected joined author loading, but observed {len(user_selects)} user queries: {user_selects}"

    # Verify LIMIT in SQL query
    reply_queries = [q for q in queries if "FROM announcement_replies" in q]
    assert any("LIMIT" in q for q in reply_queries), f"Expected SQL query to contain LIMIT: {reply_queries}"


def test_failed_creation_leaves_no_partial_reply(client, db_session):
    community = _create_community(db_session)
    author = _create_user(db_session, "author")
    announcement = _create_announcement(db_session, community, author)

    member = _create_user(db_session, "member")
    _create_membership(db_session, member, community, status=MembershipStatus.ACTIVE)
    _login(client, db_session, member)

    from sqlalchemy.orm import Session as OrmSession
    with patch.object(OrmSession, "commit", side_effect=Exception("Simulated DB Crash")):
        with pytest.raises(Exception, match="Simulated DB Crash"):
            client.post(
                f"/api/v1/communities/{community.slug}/announcements/{announcement.id}/replies",
                json={"content": "Should roll back cleanly"},
            )

    # Verify no partial reply exists in DB
    count = db_session.query(AnnouncementReply).filter(AnnouncementReply.announcement_id == announcement.id).count()
    assert count == 0

