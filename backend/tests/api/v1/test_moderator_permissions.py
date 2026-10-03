import pytest
import uuid
from datetime import timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

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

def create_user(db, username, email):
    u = User(username=username, email=email, password_hash="hash", first_name="F", family_name="L")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u

def get_token(db, user):
    return create_session(db, user.id, timedelta(days=1))[0]

@pytest.fixture
def member_user(db_session):
    return create_user(db_session, "member_user", "member@example.com")

@pytest.fixture
def moderator_user(db_session):
    return create_user(db_session, "mod_user", "mod@example.com")

@pytest.fixture
def delegate_user(db_session):
    return create_user(db_session, "del_user", "del@example.com")

@pytest.fixture
def community(db_session):
    c = Community(name="Test Community", slug="test-comm", document_vote_threshold=10)
    db_session.add(c)
    db_session.commit()
    db_session.refresh(c)
    return c

@pytest.fixture
def memberships(db_session, community, member_user, moderator_user, delegate_user):
    m_mem = Membership(user_id=member_user.id, community_id=community.id, cne="M1", status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER)
    m_mod = Membership(user_id=moderator_user.id, community_id=community.id, cne="M2", status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR)
    m_del = Membership(user_id=delegate_user.id, community_id=community.id, cne="M3", status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE)
    
    db_session.add_all([m_mem, m_mod, m_del])
    db_session.commit()
    
    return {"member": m_mem, "moderator": m_mod, "delegate": m_del}

def test_delegate_can_read_permissions(client, db_session, delegate_user, memberships, community):
    token = get_token(db_session, delegate_user)
    mod_id = str(memberships["moderator"].id)
    
    response = client.get(
        f"/api/v1/communities/{community.slug}/membership/{mod_id}/permissions",
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["upload_official_documents"] is False

def test_delegate_can_update_permissions(client, db_session, delegate_user, memberships, community):
    token = get_token(db_session, delegate_user)
    mod_id = str(memberships["moderator"].id)
    
    response = client.patch(
        f"/api/v1/communities/{community.slug}/membership/{mod_id}/permissions",
        json={"upload_official_documents": True, "create_announcements": True},
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["upload_official_documents"] is True
    assert data["create_announcements"] is True
    assert data["manage_document_voting"] is False
    
    db_session.expire_all()
    grants = db_session.query(MembershipPermission).filter_by(membership_id=uuid.UUID(mod_id)).all()
    assert len(grants) == 2

def test_member_cannot_read_permissions(client, db_session, member_user, memberships, community):
    token = get_token(db_session, member_user)
    mod_id = str(memberships["moderator"].id)
    
    response = client.get(
        f"/api/v1/communities/{community.slug}/membership/{mod_id}/permissions",
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 403

def test_moderator_cannot_read_permissions(client, db_session, moderator_user, memberships, community):
    token = get_token(db_session, moderator_user)
    mod_id = str(memberships["moderator"].id)
    
    response = client.get(
        f"/api/v1/communities/{community.slug}/membership/{mod_id}/permissions",
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 403

def test_empty_patch_fails(client, db_session, delegate_user, memberships, community):
    token = get_token(db_session, delegate_user)
    mod_id = str(memberships["moderator"].id)
    
    response = client.patch(
        f"/api/v1/communities/{community.slug}/membership/{mod_id}/permissions",
        json={},
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 422

def test_invalid_target_fails(client, db_session, delegate_user, memberships, community):
    token = get_token(db_session, delegate_user)
    mem_id = str(memberships["member"].id)
    
    response = client.patch(
        f"/api/v1/communities/{community.slug}/membership/{mem_id}/permissions",
        json={"create_announcements": True},
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 409
