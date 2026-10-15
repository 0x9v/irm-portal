import pytest
import uuid
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.sessions import create_session
from app.main import app
from app.models.community import Community
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.user import User
from app.models.announcement import Announcement

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
from app.database.session import get_db

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
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


def _create_user(db, username):
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="hashed_pw",
        first_name="First",
        family_name="Last"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _create_token(db, user):
    raw_token, _ = create_session(db, user.id, timedelta(days=1))
    return raw_token


def _create_community(db, slug):
    community = Community(name=f"Community {slug}", slug=slug)
    db.add(community)
    db.commit()
    db.refresh(community)
    return community


def _create_membership(db, user, community, status, role):
    membership = Membership(
        user_id=user.id,
        community_id=community.id,
        cne=f"CNE_{user.username}",
        status=status,
        role=role
    )
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return membership


def _create_announcement(db, community, author, title="Title", content="Content", created_at=None):
    ann = Announcement(
        community_id=community.id,
        author_id=author.id,
        title=title,
        content=content
    )
    if created_at is not None:
        ann.created_at = created_at
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return ann


# 1. Authorization: Detail access policies
def test_announcement_detail_authorization_matrix(client, db_session):
    c = _create_community(db_session, "irm")
    author = _create_user(db_session, "author_del")
    _create_membership(db_session, author, c, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    ann = _create_announcement(db_session, c, author, "Welcome to IRM", "First official update.")

    detail_url = f"/api/v1/communities/irm/announcements/{ann.id}"

    # 1a. Guest (unauthenticated) -> 401
    res_guest = client.get(detail_url)
    assert res_guest.status_code == 401

    # 1b. Authenticated user without community membership -> 403
    u_none = _create_user(db_session, "user_no_mem")
    t_none = _create_token(db_session, u_none)
    res_none = client.get(detail_url, cookies={settings.session_cookie_name: t_none})
    assert res_none.status_code == 403

    # 1c. PENDING member in target community -> 403
    u_pending = _create_user(db_session, "user_pending")
    _create_membership(db_session, u_pending, c, MembershipStatus.PENDING, MembershipRole.MEMBER)
    t_pending = _create_token(db_session, u_pending)
    res_pending = client.get(detail_url, cookies={settings.session_cookie_name: t_pending})
    assert res_pending.status_code == 403

    # 1d. REJECTED member in target community -> 403
    u_rejected = _create_user(db_session, "user_rejected")
    _create_membership(db_session, u_rejected, c, MembershipStatus.REJECTED, MembershipRole.MEMBER)
    t_rejected = _create_token(db_session, u_rejected)
    res_rejected = client.get(detail_url, cookies={settings.session_cookie_name: t_rejected})
    assert res_rejected.status_code == 403

    # 1e. Active member of ANOTHER community -> 403
    c_other = _create_community(db_session, "other_comm")
    u_other = _create_user(db_session, "user_other_comm")
    _create_membership(db_session, u_other, c_other, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    t_other = _create_token(db_session, u_other)
    res_other = client.get(detail_url, cookies={settings.session_cookie_name: t_other})
    assert res_other.status_code == 403

    # 1f. ACTIVE MEMBER -> 200
    u_member = _create_user(db_session, "user_active_member")
    _create_membership(db_session, u_member, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    t_member = _create_token(db_session, u_member)
    res_member = client.get(detail_url, cookies={settings.session_cookie_name: t_member})
    assert res_member.status_code == 200

    # 1g. ACTIVE MODERATOR (without announcement creation permission grant) -> 200
    u_mod = _create_user(db_session, "user_active_mod")
    _create_membership(db_session, u_mod, c, MembershipStatus.ACTIVE, MembershipRole.MODERATOR)
    t_mod = _create_token(db_session, u_mod)
    res_mod = client.get(detail_url, cookies={settings.session_cookie_name: t_mod})
    assert res_mod.status_code == 200

    # 1h. ACTIVE DELEGATE -> 200
    t_author = _create_token(db_session, author)
    res_del = client.get(detail_url, cookies={settings.session_cookie_name: t_author})
    assert res_del.status_code == 200


# 2. Scoping and Safe Error Handling
def test_announcement_detail_scoping_and_masking(client, db_session):
    c1 = _create_community(db_session, "c1")
    c2 = _create_community(db_session, "c2")

    u1 = _create_user(db_session, "u1")
    _create_membership(db_session, u1, c1, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    t1 = _create_token(db_session, u1)

    del2 = _create_user(db_session, "del2")
    _create_membership(db_session, del2, c2, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    ann_c2 = _create_announcement(db_session, c2, del2, "Secret C2 Announcement", "C2 private content.")

    # 2a. Unknown announcement ID -> safe 404
    non_existent_id = uuid.uuid4()
    res_unknown = client.get(
        f"/api/v1/communities/c1/announcements/{non_existent_id}",
        cookies={settings.session_cookie_name: t1}
    )
    assert res_unknown.status_code == 404
    assert res_unknown.json()["detail"] == "Announcement not found"

    # 2b. Cross-community announcement ID: Member of c1 queries announcement belonging to c2 -> same safe 404
    res_cross = client.get(
        f"/api/v1/communities/c1/announcements/{ann_c2.id}",
        cookies={settings.session_cookie_name: t1}
    )
    assert res_cross.status_code == 404
    assert res_cross.json()["detail"] == "Announcement not found"
    assert "Secret" not in res_cross.text

    # 2c. Malformed UUID parameter -> 422 Unprocessable Entity
    res_malformed = client.get(
        "/api/v1/communities/c1/announcements/not-a-valid-uuid",
        cookies={settings.session_cookie_name: t1}
    )
    assert res_malformed.status_code == 422

    # 2d. Unknown community slug -> 404
    res_unk_comm = client.get(
        f"/api/v1/communities/non-existent-comm/announcements/{ann_c2.id}",
        cookies={settings.session_cookie_name: t1}
    )
    assert res_unk_comm.status_code == 404


# 3. Response Schemas and Public Author Identity
def test_announcement_detail_safe_response_schema(client, db_session):
    c = _create_community(db_session, "irm")
    author = _create_user(db_session, "prof_turing")
    _create_membership(db_session, author, c, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    ann = _create_announcement(db_session, c, author, "Midterm Schedule", "The exam will be held next Tuesday.")

    reader = _create_user(db_session, "student_reader")
    _create_membership(db_session, reader, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    token = _create_token(db_session, reader)

    res = client.get(
        f"/api/v1/communities/irm/announcements/{ann.id}",
        cookies={settings.session_cookie_name: token}
    )
    assert res.status_code == 200
    data = res.json()

    assert data["id"] == str(ann.id)
    assert data["community_id"] == str(c.id)
    assert data["author_id"] == str(author.id)
    assert data["title"] == "Midterm Schedule"
    assert data["content"] == "The exam will be held next Tuesday."
    assert data["created_at"] is not None
    assert data["updated_at"] is not None
    # Public author identity is username
    assert data["author_username"] == "prof_turing"

    # Strict privacy assertions: never expose sensitive user/auth data
    assert "email" not in data
    assert "password" not in data
    assert "password_hash" not in data
    assert "cne" not in data
    assert "permissions" not in data


# 4. Cache-Control: private, no-store
def test_cache_control_headers_on_list_and_detail(client, db_session):
    c = _create_community(db_session, "irm")
    user = _create_user(db_session, "active_user")
    _create_membership(db_session, user, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    token = _create_token(db_session, user)

    # 4a. Empty list response has Cache-Control: private, no-store
    res_empty = client.get(
        "/api/v1/communities/irm/announcements",
        cookies={settings.session_cookie_name: token}
    )
    assert res_empty.status_code == 200
    assert res_empty.headers.get("cache-control") == "private, no-store"
    assert res_empty.json() == []

    # Create announcement
    ann = _create_announcement(db_session, c, user, "Title 1", "Body 1")

    # 4b. Populated list response has Cache-Control: private, no-store
    res_list = client.get(
        "/api/v1/communities/irm/announcements",
        cookies={settings.session_cookie_name: token}
    )
    assert res_list.status_code == 200
    assert res_list.headers.get("cache-control") == "private, no-store"

    # 4c. Detail response has Cache-Control: private, no-store
    res_detail = client.get(
        f"/api/v1/communities/irm/announcements/{ann.id}",
        cookies={settings.session_cookie_name: token}
    )
    assert res_detail.status_code == 200
    assert res_detail.headers.get("cache-control") == "private, no-store"


# 5. Bounded Latest Announcements and SQL-Level Limiting
def test_announcement_list_limit_and_latest_retrieval(client, db_session):
    c = _create_community(db_session, "irm")
    author = _create_user(db_session, "author")
    _create_membership(db_session, author, c, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    token = _create_token(db_session, author)

    base_time = datetime(2026, 3, 1, 10, 0, 0, tzinfo=timezone.utc)
    # Create 5 announcements with strictly distinct created_at
    ann1 = _create_announcement(db_session, c, author, "Announcement 1", "Content 1", created_at=base_time)
    ann2 = _create_announcement(db_session, c, author, "Announcement 2", "Content 2", created_at=base_time + timedelta(minutes=10))
    ann3 = _create_announcement(db_session, c, author, "Announcement 3", "Content 3", created_at=base_time + timedelta(minutes=20))
    ann4 = _create_announcement(db_session, c, author, "Announcement 4", "Content 4", created_at=base_time + timedelta(minutes=30))
    ann5 = _create_announcement(db_session, c, author, "Announcement 5", "Content 5", created_at=base_time + timedelta(minutes=40))

    # 5a. Home retrieval: limit=3 returns exactly the latest 3 announcements (ann5, ann4, ann3)
    res_3 = client.get(
        "/api/v1/communities/irm/announcements?limit=3",
        cookies={settings.session_cookie_name: token}
    )
    assert res_3.status_code == 200
    data_3 = res_3.json()
    assert len(data_3) == 3
    assert data_3[0]["id"] == str(ann5.id)
    assert data_3[1]["id"] == str(ann4.id)
    assert data_3[2]["id"] == str(ann3.id)

    # 5b. limit=1 returns only the single latest announcement
    res_1 = client.get(
        "/api/v1/communities/irm/announcements?limit=1",
        cookies={settings.session_cookie_name: token}
    )
    assert res_1.status_code == 200
    data_1 = res_1.json()
    assert len(data_1) == 1
    assert data_1[0]["id"] == str(ann5.id)

    # 5c. Parameter omitted: returns all 5 announcements ordered newest first
    res_all = client.get(
        "/api/v1/communities/irm/announcements",
        cookies={settings.session_cookie_name: token}
    )
    assert res_all.status_code == 200
    data_all = res_all.json()
    assert len(data_all) == 5
    assert [d["id"] for d in data_all] == [str(ann5.id), str(ann4.id), str(ann3.id), str(ann2.id), str(ann1.id)]

    # 5d. limit greater than available count (e.g. limit=10) returns all available (5)
    res_10 = client.get(
        "/api/v1/communities/irm/announcements?limit=10",
        cookies={settings.session_cookie_name: token}
    )
    assert res_10.status_code == 200
    assert len(res_10.json()) == 5


# 6. Limit Parameter Validation
def test_announcement_list_limit_validation(client, db_session):
    c = _create_community(db_session, "irm")
    user = _create_user(db_session, "active_user")
    _create_membership(db_session, user, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    token = _create_token(db_session, user)

    # 6a. limit=0 (must be strictly positive gt=0) -> 422
    res_0 = client.get(
        "/api/v1/communities/irm/announcements?limit=0",
        cookies={settings.session_cookie_name: token}
    )
    assert res_0.status_code == 422

    # 6b. limit=-5 (negative integer) -> 422
    res_neg = client.get(
        "/api/v1/communities/irm/announcements?limit=-5",
        cookies={settings.session_cookie_name: token}
    )
    assert res_neg.status_code == 422

    # 6c. limit=101 (exceeds max 100) -> 422
    res_over = client.get(
        "/api/v1/communities/irm/announcements?limit=101",
        cookies={settings.session_cookie_name: token}
    )
    assert res_over.status_code == 422

    # 6d. limit=abc (non-integer) -> 422
    res_str = client.get(
        "/api/v1/communities/irm/announcements?limit=invalid",
        cookies={settings.session_cookie_name: token}
    )
    assert res_str.status_code == 422


# 7. Deterministic Ordering with Equal Timestamps (Tie-Breaker)
def test_announcement_deterministic_tie_breaker(client, db_session):
    c = _create_community(db_session, "irm")
    author = _create_user(db_session, "author")
    _create_membership(db_session, author, c, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    token = _create_token(db_session, author)

    same_time = datetime(2026, 3, 5, 12, 0, 0, tzinfo=timezone.utc)
    ann_a = _create_announcement(db_session, c, author, "Announcement A", "Content A", created_at=same_time)
    ann_b = _create_announcement(db_session, c, author, "Announcement B", "Content B", created_at=same_time)
    ann_c = _create_announcement(db_session, c, author, "Announcement C", "Content C", created_at=same_time)

    res = client.get(
        "/api/v1/communities/irm/announcements",
        cookies={settings.session_cookie_name: token}
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 3

    # Tie breaker is id.desc()
    expected_sorted_ids = sorted([str(ann_a.id), str(ann_b.id), str(ann_c.id)], reverse=True)
    returned_ids = [d["id"] for d in data]
    assert returned_ids == expected_sorted_ids


# 8. Side-Effect Free Read Operations
def test_read_operations_have_no_side_effects(client, db_session):
    c = _create_community(db_session, "irm")
    user = _create_user(db_session, "user")
    _create_membership(db_session, user, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    token = _create_token(db_session, user)

    fixed_time = datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc)
    ann = _create_announcement(db_session, c, user, "Static Title", "Static Content", created_at=fixed_time)

    # Perform multiple list and detail read operations
    client.get("/api/v1/communities/irm/announcements", cookies={settings.session_cookie_name: token})
    client.get("/api/v1/communities/irm/announcements?limit=3", cookies={settings.session_cookie_name: token})
    client.get(f"/api/v1/communities/irm/announcements/{ann.id}", cookies={settings.session_cookie_name: token})

    db_session.expire_all()
    ann_refreshed = db_session.query(Announcement).filter(Announcement.id == ann.id).first()

    # Timestamps, titles, content, counts are completely unmutated
    assert ann_refreshed.created_at == ann.created_at
    assert ann_refreshed.updated_at == ann.updated_at
    assert ann_refreshed.title == "Static Title"
    assert ann_refreshed.content == "Static Content"
    assert db_session.query(Announcement).count() == 1
