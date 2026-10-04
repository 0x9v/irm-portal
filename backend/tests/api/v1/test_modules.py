import pytest
from datetime import timedelta
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
from app.models.membership import Membership, MembershipRole, MembershipStatus
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
        password_hash="hash",
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

def _create_membership(db, user, community, status):
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=status, role=MembershipRole.MEMBER)
    db.add(m)
    db.commit()
    return m

def _create_module(db, community, name, slug):
    module = Module(community_id=community.id, name=name, slug=slug)
    db.add(module)
    db.commit()
    db.refresh(module)
    return module

def test_unauthenticated_requests(client, db_session):
    community = _create_community(db_session, "irm")
    _create_module(db_session, community, "Mod", "mod")
    
    # 1. Guest/unauthenticated request to module list -> 401
    assert client.get("/api/v1/communities/irm/modules").status_code == 401
    
    # 2. Guest/unauthenticated request to module detail -> 401
    assert client.get("/api/v1/communities/irm/modules/mod").status_code == 401

def test_authorization_by_account_type(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    
    # Non-member
    user_non_member = _create_user(db_session, "nonmember")
    token_nm = _create_token(db_session, user_non_member)
    
    # 3. Registered non-member can list modules
    assert client.get("/api/v1/communities/irm/modules", cookies={settings.session_cookie_name: token_nm}).status_code == 200
    # 4. Registered non-member can view a module
    assert client.get(f"/api/v1/communities/irm/modules/{module.slug}", cookies={settings.session_cookie_name: token_nm}).status_code == 200
    
    # Pending member
    user_pending = _create_user(db_session, "pending")
    token_p = _create_token(db_session, user_pending)
    _create_membership(db_session, user_pending, community, MembershipStatus.PENDING)
    
    # 5. Pending member can list modules
    assert client.get("/api/v1/communities/irm/modules", cookies={settings.session_cookie_name: token_p}).status_code == 200
    
    # Active member
    user_active = _create_user(db_session, "active")
    token_a = _create_token(db_session, user_active)
    _create_membership(db_session, user_active, community, MembershipStatus.ACTIVE)
    
    # 6. Active member can list modules
    assert client.get("/api/v1/communities/irm/modules", cookies={settings.session_cookie_name: token_a}).status_code == 200

def test_module_listing_behavior(client, db_session):
    user = _create_user(db_session, "user")
    token = _create_token(db_session, user)
    
    community1 = _create_community(db_session, "comm1")
    community2 = _create_community(db_session, "comm2")
    
    # Create modules out of alphabetical order
    _create_module(db_session, community1, "Zebra", "zebra")
    _create_module(db_session, community1, "Apple", "apple")
    
    # Module in another community
    _create_module(db_session, community2, "Orange", "orange")
    
    response = client.get("/api/v1/communities/comm1/modules", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    data = response.json()
    
    # 7. Correct community modules are returned
    # 8. Modules from another community are not returned
    assert len(data) == 2
    
    # 10. Module ordering is deterministic (alphabetical by name)
    assert data[0]["name"] == "Apple"
    assert data[1]["name"] == "Zebra"
    
    # 9. Response contains only the intended safe fields
    keys = set(data[0].keys())
    assert keys == {"id", "community_id", "name", "slug", "created_at", "updated_at"}

def test_module_detail_behavior(client, db_session):
    user = _create_user(db_session, "user")
    token = _create_token(db_session, user)
    
    community1 = _create_community(db_session, "comm1")
    community2 = _create_community(db_session, "comm2")
    
    _create_module(db_session, community1, "Mod 1", "mod-1")
    _create_module(db_session, community2, "Mod 1 Again", "mod-1")
    
    # 11. Existing module can be retrieved
    resp1 = client.get("/api/v1/communities/comm1/modules/mod-1", cookies={settings.session_cookie_name: token})
    assert resp1.status_code == 200
    assert resp1.json()["name"] == "Mod 1"
    
    # 13. Existing module slug in another community cannot be accessed through the wrong community
    # e.g., if we try to access mod-1 under comm2, we get Mod 1 Again, not Mod 1
    resp2 = client.get("/api/v1/communities/comm2/modules/mod-1", cookies={settings.session_cookie_name: token})
    assert resp2.status_code == 200
    assert resp2.json()["name"] == "Mod 1 Again"
    
    # 12. Unknown module slug -> 404
    assert client.get("/api/v1/communities/comm1/modules/unknown", cookies={settings.session_cookie_name: token}).status_code == 404
    
    # 14. Unknown community -> 404
    assert client.get("/api/v1/communities/unknown/modules/mod-1", cookies={settings.session_cookie_name: token}).status_code == 404
