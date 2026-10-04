import pytest
import time
from datetime import timedelta
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
    user = User(username=username, email=f"{username}@example.com", password_hash="hash", first_name="First", family_name="Last")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

def _create_token(db, user):
    raw_token, _ = create_session(db, user.id, timedelta(days=1))
    return raw_token

def _create_community(db, slug):
    community = Community(name=f"Test {slug}", slug=slug)
    db.add(community)
    db.commit()
    db.refresh(community)
    return community

def _create_membership(db, user, community, status, role):
    membership = Membership(user_id=user.id, community_id=community.id, cne="123", status=status, role=role)
    db.add(membership)
    db.commit()
    return membership

def _create_announcement(db, community, author, title="Title"):
    ann = Announcement(community_id=community.id, author_id=author.id, title=title, content="Content")
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return ann

def test_auth_roles(client, db_session):
    c = _create_community(db_session, "irm")
    
    # 1. Unauthenticated request -> 401
    assert client.get("/api/v1/communities/irm/announcements").status_code == 401

    # 2. Registered non-member -> 403
    u_reg = _create_user(db_session, "reg")
    t_reg = _create_token(db_session, u_reg)
    assert client.get("/api/v1/communities/irm/announcements", cookies={settings.session_cookie_name: t_reg}).status_code == 403

    # 3. PENDING member -> 403
    u_pend = _create_user(db_session, "pend")
    _create_membership(db_session, u_pend, c, MembershipStatus.PENDING, MembershipRole.MEMBER)
    t_pend = _create_token(db_session, u_pend)
    assert client.get("/api/v1/communities/irm/announcements", cookies={settings.session_cookie_name: t_pend}).status_code == 403

    # 4. REJECTED member -> 403
    u_rej = _create_user(db_session, "rej")
    _create_membership(db_session, u_rej, c, MembershipStatus.REJECTED, MembershipRole.MEMBER)
    t_rej = _create_token(db_session, u_rej)
    assert client.get("/api/v1/communities/irm/announcements", cookies={settings.session_cookie_name: t_rej}).status_code == 403

    # 5, 6, 7. ACTIVE MEMBER, MODERATOR, DELEGATE -> allowed
    for role in [MembershipRole.MEMBER, MembershipRole.MODERATOR, MembershipRole.DELEGATE]:
        u_act = _create_user(db_session, f"act_{role}")
        _create_membership(db_session, u_act, c, MembershipStatus.ACTIVE, role)
        t_act = _create_token(db_session, u_act)
        assert client.get("/api/v1/communities/irm/announcements", cookies={settings.session_cookie_name: t_act}).status_code == 200

def test_community_isolation_and_visibility(client, db_session):
    c1 = _create_community(db_session, "c1")
    c2 = _create_community(db_session, "c2")
    user = _create_user(db_session, "user")
    _create_membership(db_session, user, c1, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    token = _create_token(db_session, user)

    # 8. Member of A cannot list B
    assert client.get("/api/v1/communities/c2/announcements", cookies={settings.session_cookie_name: token}).status_code == 403

    # 9. Unknown community -> 404
    assert client.get("/api/v1/communities/unk/announcements", cookies={settings.session_cookie_name: token}).status_code == 404

    # 12. Empty community returns empty list
    res = client.get("/api/v1/communities/c1/announcements", cookies={settings.session_cookie_name: token})
    assert res.status_code == 200
    assert res.json() == []

    # Create announcements in c1 and c2
    ann1 = _create_announcement(db_session, c1, user, "Ann 1")
    ann2 = _create_announcement(db_session, c2, user, "Ann 2")

    res2 = client.get("/api/v1/communities/c1/announcements", cookies={settings.session_cookie_name: token})
    assert res2.status_code == 200
    data = res2.json()
    assert len(data) == 1
    
    # 10. Returned announcements all belong to requested community
    assert data[0]["community_id"] == str(c1.id)
    assert data[0]["id"] == str(ann1.id)
    
    # 11. Announcements from other communities are not returned
    assert data[0]["id"] != str(ann2.id)

def test_ordering_and_response_safety(client, db_session):
    c = _create_community(db_session, "irm")
    user = _create_user(db_session, "user")
    _create_membership(db_session, user, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    token = _create_token(db_session, user)

    ann1 = _create_announcement(db_session, c, user, "Old")
    time.sleep(0.01) # to ensure strict timestamp ordering
    ann2 = _create_announcement(db_session, c, user, "New")

    res = client.get("/api/v1/communities/irm/announcements", cookies={settings.session_cookie_name: token})
    assert res.status_code == 200
    data = res.json()
    
    assert len(data) == 2
    
    # 13. Multiple announcements returned newest-first
    assert data[0]["id"] == str(ann2.id)
    assert data[1]["id"] == str(ann1.id)
    
    # 14. Response contains only intended announcement fields
    expected_keys = {"id", "community_id", "author_id", "title", "content", "created_at", "updated_at"}
    for ann in data:
        assert set(ann.keys()) == expected_keys
        # 15. No password/session data is exposed
        assert "password" not in ann
        assert "password_hash" not in ann
        assert "email" not in ann
