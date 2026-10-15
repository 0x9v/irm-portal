import uuid
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.community_post import CommunityPost, PostModule
from app.models.community_post_reply import CommunityPostReply
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.membership_permission import MembershipPermission, PermissionType
from app.models.module import Module
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
def setup_overrides(monkeypatch):
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr("app.api.account_mutation_route.SessionLocal", TestingSessionLocal)
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
    return TestClient(app, headers={"Origin": settings.frontend_url.rstrip("/")})


def create_test_user(db, username="testuser", email="test@example.com") -> User:
    user = User(
        username=username,
        email=email,
        password_hash="fakehash",
        first_name="Test",
        family_name="User",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_test_community(db, name="IRM Hub", slug="irm") -> Community:
    community = Community(name=name, slug=slug)
    db.add(community)
    db.commit()
    db.refresh(community)
    return community


def create_test_module(db, community, name="Algorithms", slug="algo") -> Module:
    module = Module(community_id=community.id, name=name, slug=slug)
    db.add(module)
    db.commit()
    db.refresh(module)
    return module


def create_test_membership(
    db,
    user,
    community,
    status=MembershipStatus.ACTIVE,
    role=MembershipRole.MEMBER,
    permissions=None,
) -> Membership:
    membership = Membership(
        user_id=user.id,
        community_id=community.id,
        status=status,
        role=role,
        cne="CNE12345",
    )
    db.add(membership)
    db.commit()
    db.refresh(membership)
    if permissions:
        for perm in permissions:
            p = MembershipPermission(membership_id=membership.id, permission=perm)
            db.add(p)
        db.commit()
    return membership


def login_user(client, db, user) -> str:
    token, _ = create_session(db, user.id, timedelta(days=1))
    client.cookies.set(settings.session_cookie_name, token)
    return token


# ==============================================================================
# 1. AUTHORIZATION MATRIX TESTS
# ==============================================================================

def test_posts_guest_rejected(client, db_session):
    community = create_test_community(db_session)
    # No session cookie
    resp = client.get(f"/api/v1/communities/{community.slug}/posts")
    assert resp.status_code == 401

    resp_post = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Test Title", "content": "Test body", "module_ids": []},
    )
    assert resp_post.status_code == 401


def test_posts_no_membership_rejected(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    login_user(client, db_session, user)

    resp = client.get(f"/api/v1/communities/{community.slug}/posts")
    assert resp.status_code == 403

    resp_post = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Test Title", "content": "Test body", "module_ids": []},
    )
    assert resp_post.status_code == 403


def test_posts_pending_and_rejected_membership_denied(client, db_session):
    community = create_test_community(db_session)
    user_pending = create_test_user(db_session, "pending_u", "pending@example.com")
    create_test_membership(db_session, user_pending, community, status=MembershipStatus.PENDING)

    login_user(client, db_session, user_pending)
    resp = client.get(f"/api/v1/communities/{community.slug}/posts")
    assert resp.status_code == 403

    resp_post = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Pending Post", "content": "Content", "module_ids": []},
    )
    assert resp_post.status_code == 403

    user_rejected = create_test_user(db_session, "rejected_u", "rejected@example.com")
    create_test_membership(db_session, user_rejected, community, status=MembershipStatus.REJECTED)

    login_user(client, db_session, user_rejected)
    resp = client.get(f"/api/v1/communities/{community.slug}/posts")
    assert resp.status_code == 403


def test_posts_active_elsewhere_denied(client, db_session):
    comm_irm = create_test_community(db_session, "IRM", "irm")
    comm_other = create_test_community(db_session, "Other", "other")
    user = create_test_user(db_session)
    create_test_membership(db_session, user, comm_other, status=MembershipStatus.ACTIVE)

    login_user(client, db_session, user)
    # Accessing irm while only active in other
    resp = client.get(f"/api/v1/communities/{comm_irm.slug}/posts")
    assert resp.status_code == 403


@pytest.mark.parametrize("role,permissions", [
    (MembershipRole.MEMBER, None),
    (MembershipRole.MODERATOR, None),
    (MembershipRole.MODERATOR, [PermissionType.CREATE_ANNOUNCEMENTS]),
    (MembershipRole.DELEGATE, None),
])
def test_posts_all_active_roles_allowed(client, db_session, role, permissions):
    community = create_test_community(db_session)
    user = create_test_user(db_session, f"user_{role.value}_{permissions is not None}")
    create_test_membership(db_session, user, community, status=MembershipStatus.ACTIVE, role=role, permissions=permissions)

    login_user(client, db_session, user)

    # Can list posts
    resp_list = client.get(f"/api/v1/communities/{community.slug}/posts")
    assert resp_list.status_code == 200

    # Can create posts without special announcement grant
    resp_create = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": f"Post by {role.value}", "content": "Valid body content", "module_ids": []},
    )
    assert resp_create.status_code == 201
    post_data = resp_create.json()
    assert post_data["title"] == f"Post by {role.value}"
    assert post_data["author_username"] == user.username


# ==============================================================================
# 2. VALIDATION & NORMALIZATION TESTS
# ==============================================================================

def test_post_creation_forbidden_extra_fields(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    resp = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={
            "title": "Title",
            "content": "Content",
            "module_ids": [],
            "author_id": str(uuid.uuid4()),  # Spoofing attempt
            "extra": "forbidden",
        },
    )
    assert resp.status_code == 422


def test_post_title_validation_boundaries(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # Empty title
    resp = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "", "content": "Content"},
    )
    assert resp.status_code == 422

    # Whitespace only title
    resp = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "   \n\t  ", "content": "Content"},
    )
    assert resp.status_code == 422

    # Non-string title
    resp = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": 12345, "content": "Content"},
    )
    assert resp.status_code == 422

    # Title 150 chars (valid)
    t_150 = "A" * 150
    resp_150 = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": t_150, "content": "Content"},
    )
    assert resp_150.status_code == 201

    # Title 151 chars (invalid)
    t_151 = "A" * 151
    resp_151 = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": t_151, "content": "Content"},
    )
    assert resp_151.status_code == 422

    # Title with surrounding whitespace stripped down to 150 characters succeeds
    t_padded = "   " + ("B" * 150) + "   \n\t"
    resp_padded = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": t_padded, "content": "Content"},
    )
    assert resp_padded.status_code == 201
    assert resp_padded.json()["title"] == "B" * 150

    # Exactly 150 Unicode code points (emojis) succeeds
    t_emoji_150 = "🌟" * 150
    resp_emoji_150 = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": t_emoji_150, "content": "Content"},
    )
    assert resp_emoji_150.status_code == 201
    assert resp_emoji_150.json()["title"] == t_emoji_150

    # 151 Unicode code points (emojis) fails safely before persistence
    t_emoji_151 = "🌟" * 151
    resp_emoji_151 = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": t_emoji_151, "content": "Content"},
    )
    assert resp_emoji_151.status_code == 422


def test_post_content_validation_boundaries(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # Empty content
    resp = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Title", "content": ""},
    )
    assert resp.status_code == 422

    # Whitespace only content
    resp = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Title", "content": "    \n   "},
    )
    assert resp.status_code == 422

    # Exactly 10,000 characters (valid)
    c_10000 = "B" * 10000
    resp_10k = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Title 10k", "content": c_10000},
    )
    assert resp_10k.status_code == 201
    assert resp_10k.json()["content"] == c_10000

    # 10,001 characters (invalid)
    c_10001 = "B" * 10001
    resp_10001 = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Title 10k+1", "content": c_10001},
    )
    assert resp_10001.status_code == 422


def test_post_content_preserves_internal_newlines(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    multiline = "Line 1\n\nLine 2 with code block:\n```python\nprint('hello')\n```\nLine 3"
    resp = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Multiline Post", "content": f"  {multiline}  "},
    )
    assert resp.status_code == 201
    # Trimmed boundaries, but internal newlines intact
    assert resp.json()["content"] == multiline


def test_post_unicode_support(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    title_unicode = "سؤال حول الخوارزميات 🚀"
    content_unicode = "هل يمكن شرح خوارزمية البحث الثنائي؟ 💡 شكراً جزيلاً!"
    resp = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": title_unicode, "content": content_unicode},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == title_unicode
    assert data["content"] == content_unicode


# ==============================================================================
# 3. MODULE TAGGING & ATOMICITY TESTS
# ==============================================================================

def test_post_module_tag_limits_and_duplicates(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    m1 = create_test_module(db_session, community, "Mod 1", "mod-1")
    m2 = create_test_module(db_session, community, "Mod 2", "mod-2")
    m3 = create_test_module(db_session, community, "Mod 3", "mod-3")
    m4 = create_test_module(db_session, community, "Mod 4", "mod-4")

    # Untagged: module_ids = []
    resp_0 = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Untagged Post", "content": "Content", "module_ids": []},
    )
    assert resp_0.status_code == 201
    assert resp_0.json()["modules"] == []

    # Single tag
    resp_1 = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "1 Tag Post", "content": "Content", "module_ids": [str(m1.id)]},
    )
    assert resp_1.status_code == 201
    assert len(resp_1.json()["modules"]) == 1
    assert resp_1.json()["modules"][0]["slug"] == "mod-1"

    # Exactly 3 tags (maximum allowed)
    resp_3 = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={
            "title": "3 Tag Post",
            "content": "Content",
            "module_ids": [str(m1.id), str(m2.id), str(m3.id)],
        },
    )
    assert resp_3.status_code == 201
    assert len(resp_3.json()["modules"]) == 3

    # 4 tags (exceeds initial maximum of 3)
    resp_4 = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={
            "title": "4 Tag Post",
            "content": "Content",
            "module_ids": [str(m1.id), str(m2.id), str(m3.id), str(m4.id)],
        },
    )
    assert resp_4.status_code == 422

    # Duplicate module IDs rejected
    resp_dup = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={
            "title": "Duplicate Tag Post",
            "content": "Content",
            "module_ids": [str(m1.id), str(m1.id)],
        },
    )
    assert resp_dup.status_code == 422


def test_post_creation_foreign_or_unknown_module_rejected_and_rolled_back(client, db_session):
    comm_irm = create_test_community(db_session, "IRM", "irm")
    comm_other = create_test_community(db_session, "Other", "other")
    user = create_test_user(db_session)
    create_test_membership(db_session, user, comm_irm)
    login_user(client, db_session, user)

    # Module belonging to a different community
    foreign_module = create_test_module(db_session, comm_other, "Foreign", "foreign")
    random_uuid = uuid.uuid4()

    # Unknown module ID
    resp_unknown = client.post(
        f"/api/v1/communities/{comm_irm.slug}/posts",
        json={"title": "Post", "content": "Content", "module_ids": [str(random_uuid)]},
    )
    assert resp_unknown.status_code == 400

    # Foreign community module
    resp_foreign = client.post(
        f"/api/v1/communities/{comm_irm.slug}/posts",
        json={"title": "Post", "content": "Content", "module_ids": [str(foreign_module.id)]},
    )
    assert resp_foreign.status_code == 400

    # Verify atomic rollback: no orphan post was committed to database
    post_count = db_session.query(CommunityPost).count()
    assert post_count == 0


# ==============================================================================
# 4. FEED & DETAIL TESTS (EXCERPT, FILTERING, NO MULTIPLICATION)
# ==============================================================================

def test_feed_excerpt_and_detail_full_content(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    long_body = "W" * 500
    create_resp = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Long Post", "content": long_body},
    )
    assert create_resp.status_code == 201
    post_id = create_resp.json()["id"]

    # In feed: bounded excerpt
    feed_resp = client.get(f"/api/v1/communities/{community.slug}/posts")
    assert feed_resp.status_code == 200
    feed_item = feed_resp.json()["items"][0]
    assert len(feed_item["excerpt"]) <= 205
    assert feed_item["excerpt"].endswith("...")
    assert "content" not in feed_item  # Not exposing full 10k body

    # In detail: full content
    detail_resp = client.get(f"/api/v1/communities/{community.slug}/posts/{post_id}")
    assert detail_resp.status_code == 200
    detail_item = detail_resp.json()
    assert detail_item["content"] == long_body


def test_feed_no_duplicate_posts_from_multi_module_tags(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    m1 = create_test_module(db_session, community, "Mod 1", "mod-1")
    m2 = create_test_module(db_session, community, "Mod 2", "mod-2")
    m3 = create_test_module(db_session, community, "Mod 3", "mod-3")

    # Post with 3 modules
    client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={
            "title": "Triple Tagged Post",
            "content": "Content",
            "module_ids": [str(m1.id), str(m2.id), str(m3.id)],
        },
    )

    feed_resp = client.get(f"/api/v1/communities/{community.slug}/posts")
    assert feed_resp.status_code == 200
    items = feed_resp.json()["items"]
    # Must appear exactly once in feed
    assert len(items) == 1
    assert items[0]["title"] == "Triple Tagged Post"
    assert len(items[0]["modules"]) == 3


def test_module_filtered_feed(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    m_math = create_test_module(db_session, community, "Math", "math")
    m_phys = create_test_module(db_session, community, "Physics", "phys")
    m_empty = create_test_module(db_session, community, "Empty Mod", "empty")

    # Post 1 in math
    client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Math Post", "content": "Math body", "module_ids": [str(m_math.id)]},
    )
    # Post 2 in physics
    client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Physics Post", "content": "Phys body", "module_ids": [str(m_phys.id)]},
    )
    # Post 3 in both
    client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Both Post", "content": "Both body", "module_ids": [str(m_math.id), str(m_phys.id)]},
    )

    # Filter by math -> should return Both Post and Math Post (2 items)
    resp_math = client.get(f"/api/v1/communities/{community.slug}/posts?module_id={m_math.id}")
    assert resp_math.status_code == 200
    math_titles = [p["title"] for p in resp_math.json()["items"]]
    assert "Math Post" in math_titles
    assert "Both Post" in math_titles
    assert "Physics Post" not in math_titles

    # Filter by physics -> should return Both Post and Physics Post (2 items)
    resp_phys = client.get(f"/api/v1/communities/{community.slug}/posts?module_id={m_phys.id}")
    assert resp_phys.status_code == 200
    phys_titles = [p["title"] for p in resp_phys.json()["items"]]
    assert "Physics Post" in phys_titles
    assert "Both Post" in phys_titles
    assert "Math Post" not in phys_titles

    # Filter by empty module -> returns empty page with next_cursor null
    resp_empty = client.get(f"/api/v1/communities/{community.slug}/posts?module_id={m_empty.id}")
    assert resp_empty.status_code == 200
    assert resp_empty.json()["items"] == []
    assert resp_empty.json()["next_cursor"] is None

    # Filter by foreign community module -> 404 (do not expose foreign metadata)
    comm_other = create_test_community(db_session, "Other Comm", "other-comm")
    m_foreign = create_test_module(db_session, comm_other, "Foreign Mod", "foreign-mod")
    resp_foreign = client.get(f"/api/v1/communities/{community.slug}/posts?module_id={m_foreign.id}")
    assert resp_foreign.status_code == 404


# ==============================================================================
# 5. PAGINATION & CURSOR SCOPE TESTS
# ==============================================================================

def test_feed_cursor_pagination_descending(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # Create 5 posts chronologically
    base_time = datetime(2026, 10, 6, 10, 0, 0, tzinfo=timezone.utc)
    for i in range(5):
        post = CommunityPost(
            community_id=community.id,
            author_id=user.id,
            title=f"Post {i + 1}",
            content=f"Content {i + 1}",
            created_at=base_time + timedelta(minutes=i),
        )
        db_session.add(post)
    db_session.commit()

    # Page 1: limit=2 (expect Post 5, Post 4)
    resp_p1 = client.get(f"/api/v1/communities/{community.slug}/posts?limit=2")
    assert resp_p1.status_code == 200
    data_p1 = resp_p1.json()
    assert len(data_p1["items"]) == 2
    assert data_p1["items"][0]["title"] == "Post 5"
    assert data_p1["items"][1]["title"] == "Post 4"
    cursor_1 = data_p1["next_cursor"]
    assert cursor_1 is not None

    # Page 2: limit=2, after=cursor_1 (expect Post 3, Post 2)
    resp_p2 = client.get(f"/api/v1/communities/{community.slug}/posts?limit=2&after={cursor_1}")
    assert resp_p2.status_code == 200
    data_p2 = resp_p2.json()
    assert len(data_p2["items"]) == 2
    assert data_p2["items"][0]["title"] == "Post 3"
    assert data_p2["items"][1]["title"] == "Post 2"
    cursor_2 = data_p2["next_cursor"]
    assert cursor_2 is not None

    # Page 3: limit=2, after=cursor_2 (expect Post 1, next_cursor=None)
    resp_p3 = client.get(f"/api/v1/communities/{community.slug}/posts?limit=2&after={cursor_2}")
    assert resp_p3.status_code == 200
    data_p3 = resp_p3.json()
    assert len(data_p3["items"]) == 1
    assert data_p3["items"][0]["title"] == "Post 1"
    assert data_p3["next_cursor"] is None


def test_feed_invalid_and_out_of_scope_cursor(client, db_session):
    comm_irm = create_test_community(db_session, "IRM", "irm")
    comm_other = create_test_community(db_session, "Other", "other")
    user = create_test_user(db_session)
    create_test_membership(db_session, user, comm_irm)
    login_user(client, db_session, user)

    # Post in comm_other
    post_other = CommunityPost(
        community_id=comm_other.id,
        author_id=user.id,
        title="Other Post",
        content="Body",
    )
    db_session.add(post_other)
    db_session.commit()

    # 1. Non-existent cursor UUID
    resp_bad = client.get(f"/api/v1/communities/{comm_irm.slug}/posts?after={uuid.uuid4()}")
    assert resp_bad.status_code == 400
    assert resp_bad.json()["detail"] == "Invalid pagination cursor"

    # 2. Cursor belonging to other community
    resp_cross = client.get(f"/api/v1/communities/{comm_irm.slug}/posts?after={post_other.id}")
    assert resp_cross.status_code == 400

    # 3. With module filter, cursor post not having that module
    m_algo = create_test_module(db_session, comm_irm, "Algo", "algo")
    post_no_module = CommunityPost(
        community_id=comm_irm.id,
        author_id=user.id,
        title="No Mod Post",
        content="Body",
    )
    db_session.add(post_no_module)
    db_session.commit()

    resp_mod_cursor = client.get(
        f"/api/v1/communities/{comm_irm.slug}/posts?module_id={m_algo.id}&after={post_no_module.id}"
    )
    assert resp_mod_cursor.status_code == 400


# ==============================================================================
# 6. REPLIES CRUD, PAGINATION & POST ORDER INVARIANCE
# ==============================================================================

def test_replies_creation_and_parent_created_at_invariance(client, db_session):
    community = create_test_community(db_session)
    author = create_test_user(db_session, "post_author", "post@example.com")
    replier = create_test_user(db_session, "replier", "replier@example.com")
    create_test_membership(db_session, author, community)
    create_test_membership(db_session, replier, community)

    # Author creates post
    login_user(client, db_session, author)
    resp_post = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Original Post", "content": "Original Content"},
    )
    post_id = resp_post.json()["id"]
    original_created_at = resp_post.json()["created_at"]

    # Replier logs in and replies
    login_user(client, db_session, replier)
    resp_reply = client.post(
        f"/api/v1/communities/{community.slug}/posts/{post_id}/replies",
        json={"content": "Here is my useful explanation.\nSecond line."},
    )
    assert resp_reply.status_code == 201
    reply_data = resp_reply.json()
    assert reply_data["post_id"] == post_id
    assert reply_data["author_username"] == replier.username
    assert reply_data["content"] == "Here is my useful explanation.\nSecond line."

    # Verify parent post created_at in DB was NOT changed
    post_in_db = db_session.query(CommunityPost).filter(CommunityPost.id == uuid.UUID(post_id)).first()
    assert post_in_db.created_at.isoformat() == original_created_at


def test_reply_validation_limits(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    resp_post = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Post", "content": "Content"},
    )
    post_id = resp_post.json()["id"]

    # Empty reply
    assert client.post(
        f"/api/v1/communities/{community.slug}/posts/{post_id}/replies",
        json={"content": ""},
    ).status_code == 422

    # Whitespace only reply
    assert client.post(
        f"/api/v1/communities/{community.slug}/posts/{post_id}/replies",
        json={"content": "   \n  "},
    ).status_code == 422

    # Non-string reply
    assert client.post(
        f"/api/v1/communities/{community.slug}/posts/{post_id}/replies",
        json={"content": 123},
    ).status_code == 422

    # Forbidden extra fields
    assert client.post(
        f"/api/v1/communities/{community.slug}/posts/{post_id}/replies",
        json={"content": "Valid", "extra": "forbidden"},
    ).status_code == 422

    # Exactly 2,000 chars (valid)
    assert client.post(
        f"/api/v1/communities/{community.slug}/posts/{post_id}/replies",
        json={"content": "R" * 2000},
    ).status_code == 201

    # 2,001 chars (invalid)
    assert client.post(
        f"/api/v1/communities/{community.slug}/posts/{post_id}/replies",
        json={"content": "R" * 2001},
    ).status_code == 422

    # Reply with surrounding whitespace stripped down to 2,000 chars succeeds
    resp_reply_padded = client.post(
        f"/api/v1/communities/{community.slug}/posts/{post_id}/replies",
        json={"content": "  " + ("W" * 2000) + "  \n"},
    )
    assert resp_reply_padded.status_code == 201
    assert resp_reply_padded.json()["content"] == "W" * 2000

    # Exactly 2,000 Unicode code points (emojis) succeeds
    resp_reply_emoji_2k = client.post(
        f"/api/v1/communities/{community.slug}/posts/{post_id}/replies",
        json={"content": "💬" * 2000},
    )
    assert resp_reply_emoji_2k.status_code == 201
    assert resp_reply_emoji_2k.json()["content"] == "💬" * 2000

    # 2,001 Unicode code points (emojis) fails safely
    resp_reply_emoji_2001 = client.post(
        f"/api/v1/communities/{community.slug}/posts/{post_id}/replies",
        json={"content": "💬" * 2001},
    )
    assert resp_reply_emoji_2001.status_code == 422


def test_reply_pagination_ascending(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    post = CommunityPost(
        community_id=community.id,
        author_id=user.id,
        title="Post For Replies",
        content="Content",
    )
    db_session.add(post)
    db_session.commit()

    base_time = datetime(2026, 10, 6, 12, 0, 0, tzinfo=timezone.utc)
    for i in range(5):
        r = CommunityPostReply(
            post_id=post.id,
            author_id=user.id,
            content=f"Reply {i + 1}",
            created_at=base_time + timedelta(seconds=i),
        )
        db_session.add(r)
    db_session.commit()

    # Page 1: limit 2 (expect Reply 1, Reply 2)
    resp_p1 = client.get(f"/api/v1/communities/{community.slug}/posts/{post.id}/replies?limit=2")
    assert resp_p1.status_code == 200
    p1 = resp_p1.json()
    assert len(p1["items"]) == 2
    assert p1["items"][0]["content"] == "Reply 1"
    assert p1["items"][1]["content"] == "Reply 2"
    cursor_1 = p1["next_cursor"]
    assert cursor_1 is not None

    # Page 2: limit 2, after cursor_1 (expect Reply 3, Reply 4)
    resp_p2 = client.get(f"/api/v1/communities/{community.slug}/posts/{post.id}/replies?limit=2&after={cursor_1}")
    assert resp_p2.status_code == 200
    p2 = resp_p2.json()
    assert len(p2["items"]) == 2
    assert p2["items"][0]["content"] == "Reply 3"
    assert p2["items"][1]["content"] == "Reply 4"
    cursor_2 = p2["next_cursor"]
    assert cursor_2 is not None

    # Page 3: limit 2, after cursor_2 (expect Reply 5, next_cursor None)
    resp_p3 = client.get(f"/api/v1/communities/{community.slug}/posts/{post.id}/replies?limit=2&after={cursor_2}")
    assert resp_p3.status_code == 200
    p3 = resp_p3.json()
    assert len(p3["items"]) == 1
    assert p3["items"][0]["content"] == "Reply 5"
    assert p3["next_cursor"] is None


def test_reply_cursor_scope_validation(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    post1 = CommunityPost(community_id=community.id, author_id=user.id, title="Post 1", content="Body 1")
    post2 = CommunityPost(community_id=community.id, author_id=user.id, title="Post 2", content="Body 2")
    db_session.add_all([post1, post2])
    db_session.commit()

    reply_on_post2 = CommunityPostReply(post_id=post2.id, author_id=user.id, content="Reply on post 2")
    db_session.add(reply_on_post2)
    db_session.commit()

    # Pass reply from post2 as cursor to post1 -> 400 Invalid pagination cursor
    resp = client.get(f"/api/v1/communities/{community.slug}/posts/{post1.id}/replies?after={reply_on_post2.id}")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid pagination cursor"


# ==============================================================================
# 7. CACHE-CONTROL HEADERS & CROSS-COMMUNITY MASKING
# ==============================================================================

def test_cache_control_headers_on_all_post_endpoints(client, db_session):
    community = create_test_community(db_session)
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    # 1. Post creation
    res_create = client.post(
        f"/api/v1/communities/{community.slug}/posts",
        json={"title": "Post Header Test", "content": "Content"},
    )
    assert res_create.status_code == 201
    assert res_create.headers.get("cache-control") == "private, no-store"
    post_id = res_create.json()["id"]

    # 2. Feed list
    res_feed = client.get(f"/api/v1/communities/{community.slug}/posts")
    assert res_feed.status_code == 200
    assert res_feed.headers.get("cache-control") == "private, no-store"

    # 3. Post detail
    res_detail = client.get(f"/api/v1/communities/{community.slug}/posts/{post_id}")
    assert res_detail.status_code == 200
    assert res_detail.headers.get("cache-control") == "private, no-store"

    # 4. Reply creation
    res_reply_create = client.post(
        f"/api/v1/communities/{community.slug}/posts/{post_id}/replies",
        json={"content": "Reply Header Test"},
    )
    assert res_reply_create.status_code == 201
    assert res_reply_create.headers.get("cache-control") == "private, no-store"

    # 5. Reply list
    res_reply_list = client.get(f"/api/v1/communities/{community.slug}/posts/{post_id}/replies")
    assert res_reply_list.status_code == 200
    assert res_reply_list.headers.get("cache-control") == "private, no-store"


def test_cross_community_post_detail_masked_as_404(client, db_session):
    comm_irm = create_test_community(db_session, "IRM", "irm")
    comm_other = create_test_community(db_session, "Other", "other")
    user = create_test_user(db_session)
    create_test_membership(db_session, user, comm_irm)
    login_user(client, db_session, user)

    post_other = CommunityPost(
        community_id=comm_other.id,
        author_id=user.id,
        title="Other Comm Post",
        content="Other body",
    )
    db_session.add(post_other)
    db_session.commit()

    # Querying comm_other's post via comm_irm endpoint returns 404 Post not found
    resp = client.get(f"/api/v1/communities/{comm_irm.slug}/posts/{post_other.id}")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Post not found"


def test_reply_creation_does_not_bump_parent_post_created_at_or_feed_ordering(client, db_session):
    community = create_test_community(db_session, "IRM", "irm")
    user = create_test_user(db_session)
    create_test_membership(db_session, user, community)
    login_user(client, db_session, user)

    t1 = datetime(2026, 10, 1, 10, 0, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 10, 2, 10, 0, 0, tzinfo=timezone.utc)

    p1 = CommunityPost(
        community_id=community.id,
        author_id=user.id,
        title="Post 1",
        content="Content 1",
        created_at=t1,
    )
    p2 = CommunityPost(
        community_id=community.id,
        author_id=user.id,
        title="Post 2",
        content="Content 2",
        created_at=t2,
    )
    db_session.add_all([p1, p2])
    db_session.commit()

    # Initial feed order: Post 2, then Post 1
    resp = client.get(f"/api/v1/communities/{community.slug}/posts")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert items[0]["id"] == str(p2.id)
    assert items[1]["id"] == str(p1.id)

    # Add reply to Post 1
    resp_reply = client.post(
        f"/api/v1/communities/{community.slug}/posts/{p1.id}/replies",
        json={"content": "New reply on older post"},
    )
    assert resp_reply.status_code == 201

    # Verify Post 1's created_at in DB is unchanged
    db_session.refresh(p1)
    p1_time = p1.created_at if p1.created_at.tzinfo else p1.created_at.replace(tzinfo=timezone.utc)
    assert p1_time == t1

    # Feed order MUST STILL BE Post 2, then Post 1 (Post 1 was NOT bumped)
    resp_after = client.get(f"/api/v1/communities/{community.slug}/posts")
    assert resp_after.status_code == 200
    items_after = resp_after.json()["items"]
    assert items_after[0]["id"] == str(p2.id)
    assert items_after[1]["id"] == str(p1.id)


def test_cross_community_reply_and_module_tag_rejection(client, db_session):
    comm_irm = create_test_community(db_session, "IRM", "irm")
    comm_other = create_test_community(db_session, "Other", "other")
    foreign_module = create_test_module(db_session, comm_other, "Foreign Mod", "foreign-mod")

    user = create_test_user(db_session)
    create_test_membership(db_session, user, comm_irm)
    login_user(client, db_session, user)

    # 1. Tagging post in IRM with module belonging to other community -> 400 Bad Request
    resp = client.post(
        f"/api/v1/communities/{comm_irm.slug}/posts",
        json={
            "title": "Post With Foreign Module",
            "content": "Should be rejected",
            "module_ids": [str(foreign_module.id)],
        },
    )
    assert resp.status_code == 400
    assert "do not exist in this community" in resp.json()["detail"]

    # 2. Creating reply to other community post via IRM route -> 404 Post not found
    other_post = CommunityPost(
        community_id=comm_other.id,
        author_id=user.id,
        title="Other Comm Post",
        content="Other Comm Body",
    )
    db_session.add(other_post)
    db_session.commit()

    resp_reply = client.post(
        f"/api/v1/communities/{comm_irm.slug}/posts/{other_post.id}/replies",
        json={"content": "Cross-community reply attempt"},
    )
    assert resp_reply.status_code == 404
    assert resp_reply.json()["detail"] == "Post not found"

    # 3. Listing replies to other community post via IRM route -> 404 Post not found
    resp_list = client.get(f"/api/v1/communities/{comm_irm.slug}/posts/{other_post.id}/replies")
    assert resp_list.status_code == 404
    assert resp_list.json()["detail"] == "Post not found"


def test_rejected_and_pending_members_denied_all_post_endpoints(client, db_session):
    community = create_test_community(db_session, "IRM", "irm")
    user_pend = create_test_user(db_session, "pend_user", "pend@example.com")
    create_test_membership(db_session, user_pend, community, status=MembershipStatus.PENDING)

    user_rej = create_test_user(db_session, "rej_user", "rej@example.com")
    create_test_membership(db_session, user_rej, community, status=MembershipStatus.REJECTED)

    post = CommunityPost(
        community_id=community.id,
        author_id=user_pend.id,
        title="Existing Post",
        content="Existing Body",
    )
    db_session.add(post)
    db_session.commit()

    for u in [user_pend, user_rej]:
        login_user(client, db_session, u)

        # GET feed -> 403
        r = client.get(f"/api/v1/communities/{community.slug}/posts")
        assert r.status_code == 403

        # POST post -> 403
        r = client.post(
            f"/api/v1/communities/{community.slug}/posts",
            json={"title": "Denied", "content": "Denied"},
        )
        assert r.status_code == 403

        # GET detail -> 403
        r = client.get(f"/api/v1/communities/{community.slug}/posts/{post.id}")
        assert r.status_code == 403

        # POST reply -> 403
        r = client.post(
            f"/api/v1/communities/{community.slug}/posts/{post.id}/replies",
            json={"content": "Denied"},
        )
        assert r.status_code == 403

        # GET replies -> 403
        r = client.get(f"/api/v1/communities/{community.slug}/posts/{post.id}/replies")
        assert r.status_code == 403
