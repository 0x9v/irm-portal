import pytest
import uuid
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

def test_auth_roles(client, db_session):
    c = _create_community(db_session, "irm")
    payload = {"title": "Test Title", "content": "Test content"}
    
    # 1. Unauthenticated user -> 401
    assert client.post("/api/v1/communities/irm/announcements", json=payload).status_code == 401

    # 2. Registered non-member -> 403
    u_reg = _create_user(db_session, "reg")
    t_reg = _create_token(db_session, u_reg)
    assert client.post("/api/v1/communities/irm/announcements", json=payload, cookies={settings.session_cookie_name: t_reg}).status_code == 403

    # 3. PENDING member -> 403
    u_pend = _create_user(db_session, "pend")
    _create_membership(db_session, u_pend, c, MembershipStatus.PENDING, MembershipRole.MEMBER)
    t_pend = _create_token(db_session, u_pend)
    assert client.post("/api/v1/communities/irm/announcements", json=payload, cookies={settings.session_cookie_name: t_pend}).status_code == 403

    # 4. REJECTED member -> 403
    u_rej = _create_user(db_session, "rej")
    _create_membership(db_session, u_rej, c, MembershipStatus.REJECTED, MembershipRole.MEMBER)
    t_rej = _create_token(db_session, u_rej)
    assert client.post("/api/v1/communities/irm/announcements", json=payload, cookies={settings.session_cookie_name: t_rej}).status_code == 403

    # 5. ACTIVE MEMBER -> 403
    u_mem = _create_user(db_session, "mem")
    _create_membership(db_session, u_mem, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    t_mem = _create_token(db_session, u_mem)
    assert client.post("/api/v1/communities/irm/announcements", json=payload, cookies={settings.session_cookie_name: t_mem}).status_code == 403

    # 6. ACTIVE MODERATOR -> 403
    u_mod = _create_user(db_session, "mod")
    _create_membership(db_session, u_mod, c, MembershipStatus.ACTIVE, MembershipRole.MODERATOR)
    t_mod = _create_token(db_session, u_mod)
    assert client.post("/api/v1/communities/irm/announcements", json=payload, cookies={settings.session_cookie_name: t_mod}).status_code == 403

    # 7. ACTIVE DELEGATE -> allowed
    u_del = _create_user(db_session, "del")
    _create_membership(db_session, u_del, c, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    t_del = _create_token(db_session, u_del)
    assert client.post("/api/v1/communities/irm/announcements", json=payload, cookies={settings.session_cookie_name: t_del}).status_code == 201


def test_scoping(client, db_session):
    c1 = _create_community(db_session, "c1")
    c2 = _create_community(db_session, "c2")
    user = _create_user(db_session, "del")
    _create_membership(db_session, user, c1, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    token = _create_token(db_session, user)

    payload = {"title": "Test", "content": "Content"}

    # 8. Delegate of A cannot create in B
    assert client.post("/api/v1/communities/c2/announcements", json=payload, cookies={settings.session_cookie_name: token}).status_code == 403

    # 9. Unknown community slug -> 404
    assert client.post("/api/v1/communities/unk/announcements", json=payload, cookies={settings.session_cookie_name: token}).status_code == 404

    # 10. Created announcement linked to route community, not client input
    spoof_payload = {"title": "Spoof", "content": "Content", "community_id": str(c2.id)}
    res = client.post("/api/v1/communities/c1/announcements", json=spoof_payload, cookies={settings.session_cookie_name: token})
    assert res.status_code == 201
    assert res.json()["community_id"] == str(c1.id)


def test_validation(client, db_session):
    c = _create_community(db_session, "irm")
    user = _create_user(db_session, "del")
    _create_membership(db_session, user, c, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    token = _create_token(db_session, user)

    # 11. Missing title
    assert client.post("/api/v1/communities/irm/announcements", json={"content": "x"}, cookies={settings.session_cookie_name: token}).status_code == 422
    # 12. Empty/whitespace title
    assert client.post("/api/v1/communities/irm/announcements", json={"title": "   ", "content": "x"}, cookies={settings.session_cookie_name: token}).status_code == 422
    # 13. Missing content
    assert client.post("/api/v1/communities/irm/announcements", json={"title": "x"}, cookies={settings.session_cookie_name: token}).status_code == 422
    # 14. Empty/whitespace content
    assert client.post("/api/v1/communities/irm/announcements", json={"title": "x", "content": "  \n "}, cookies={settings.session_cookie_name: token}).status_code == 422
    # 15. Overly long title
    assert client.post("/api/v1/communities/irm/announcements", json={"title": "x"*256, "content": "x"}, cookies={settings.session_cookie_name: token}).status_code == 422


def test_server_controlled_fields_and_persistence(client, db_session):
    c = _create_community(db_session, "irm")
    user = _create_user(db_session, "del")
    _create_membership(db_session, user, c, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    token = _create_token(db_session, user)

    payload = {
        "title": "  Safe Title  ",
        "content": "  Safe Content  ",
        "author_id": str(uuid.uuid4()), # 16. Client cannot spoof author_id
        "role": "MODERATOR",            # 18. Client cannot submit role
        "status": "APPROVED",
        "created_at": "1999-01-01T00:00:00Z"
    }

    res = client.post("/api/v1/communities/irm/announcements", json=payload, cookies={settings.session_cookie_name: token})
    assert res.status_code == 201
    
    data = res.json()
    assert data["author_id"] == str(user.id)
    assert data["community_id"] == str(c.id)
    assert data["title"] == "Safe Title"     # trimmed
    assert data["content"] == "Safe Content" # trimmed
    assert data["created_at"] != "1999-01-01T00:00:00Z"
    assert data["updated_at"] is not None
    assert "role" not in data
    
    # 19. Successful request creates exactly one row
    db_session.expire_all()
    anns = db_session.query(Announcement).all()
    assert len(anns) == 1
    
    ann = anns[0]
    # 20. Author is the authenticated delegate
    assert ann.author_id == user.id
    # 21. created_at and updated_at populated
    assert ann.created_at is not None
    assert ann.updated_at is not None
    # 22. Response matches persisted announcement
    assert str(ann.id) == data["id"]
    assert str(ann.community_id) == data["community_id"]
    assert str(ann.author_id) == data["author_id"]
