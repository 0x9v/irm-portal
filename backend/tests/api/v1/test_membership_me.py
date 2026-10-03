import pytest
from fastapi.testclient import TestClient
from datetime import timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import uuid

from app.main import app
from app.database import Base
from app.database.session import get_db
from app.core.config import settings
from app.core.sessions import create_session
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
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

@pytest.fixture(autouse=True)
def setup_db():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()

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

def create_test_user(db, username, email):
    u = User(username=username, email=email, password_hash="hash", first_name="F", family_name="L")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u

def get_token(db, user):
    return create_session(db, user.id, timedelta(days=1))[0]

@pytest.fixture
def community(db_session):
    c = Community(name="Test Community", slug="test-comm", document_vote_threshold=10)
    db_session.add(c)
    db_session.commit()
    db_session.refresh(c)
    return c

def test_me_no_membership(client, db_session, community):
    user = create_test_user(db_session, "user", "u@e.com")
    token = get_token(db_session, user)
    
    response = client.get(f"/api/v1/communities/{community.slug}/membership/me", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    data = response.json()
    assert data["membership"] is None
    assert data["capabilities"]["create_announcements"] is False
    assert data["capabilities"]["manage_document_voting"] is False
    assert data["capabilities"]["upload_official_documents"] is False

def test_me_pending_membership(client, db_session, community):
    user = create_test_user(db_session, "user", "u@e.com")
    token = get_token(db_session, user)
    
    m = Membership(user_id=user.id, community_id=community.id, cne="M1", status=MembershipStatus.PENDING, role=MembershipRole.MEMBER)
    db_session.add(m)
    db_session.commit()
    
    response = client.get(f"/api/v1/communities/{community.slug}/membership/me", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    data = response.json()
    assert data["membership"]["status"] == "PENDING"
    assert data["capabilities"]["create_announcements"] is False

def test_me_active_delegate(client, db_session, community):
    user = create_test_user(db_session, "del", "d@e.com")
    token = get_token(db_session, user)
    
    m = Membership(user_id=user.id, community_id=community.id, cne="M1", status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE)
    db_session.add(m)
    db_session.commit()
    
    response = client.get(f"/api/v1/communities/{community.slug}/membership/me", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    data = response.json()
    assert data["capabilities"]["create_announcements"] is True
    assert data["capabilities"]["manage_document_voting"] is True
    assert data["capabilities"]["upload_official_documents"] is True

def test_me_active_moderator_no_grants(client, db_session, community):
    user = create_test_user(db_session, "mod", "m@e.com")
    token = get_token(db_session, user)
    
    m = Membership(user_id=user.id, community_id=community.id, cne="M1", status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR)
    db_session.add(m)
    db_session.commit()
    
    response = client.get(f"/api/v1/communities/{community.slug}/membership/me", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    data = response.json()
    assert data["capabilities"]["create_announcements"] is False

def test_me_active_moderator_with_grants(client, db_session, community):
    user = create_test_user(db_session, "mod", "m@e.com")
    token = get_token(db_session, user)
    
    m = Membership(user_id=user.id, community_id=community.id, cne="M1", status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR)
    db_session.add(m)
    db_session.commit()
    db_session.refresh(m)
    
    g = MembershipPermission(membership_id=m.id, permission=PermissionType.CREATE_ANNOUNCEMENTS)
    db_session.add(g)
    db_session.commit()
    
    response = client.get(f"/api/v1/communities/{community.slug}/membership/me", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    data = response.json()
    assert data["capabilities"]["create_announcements"] is True
    assert data["capabilities"]["manage_document_voting"] is False
