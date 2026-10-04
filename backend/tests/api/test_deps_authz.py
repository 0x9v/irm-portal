import pytest
from datetime import timedelta
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_active_membership, require_community_delegate
from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.models.community import Community
from app.models.membership import Membership, MembershipRole, MembershipStatus
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

test_app = FastAPI()
test_app.dependency_overrides[get_db] = override_get_db

router = APIRouter()

@router.get("/communities/{community_slug}/active")
def active_route(membership: Membership = Depends(get_current_active_membership)):
    return {"status": "ok", "membership_id": str(membership.id)}

@router.get("/communities/{community_slug}/delegate")
def delegate_route(membership: Membership = Depends(require_community_delegate)):
    return {"status": "ok", "role": membership.role.value}

test_app.include_router(router)

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
    return TestClient(test_app)

def _create_user_token(db, username):
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
    raw_token, _ = create_session(db, user.id, timedelta(days=1))
    return user, raw_token

def _create_community(db, slug):
    community = Community(name="Test", slug=slug)
    db.add(community)
    db.commit()
    db.refresh(community)
    return community

def test_unauthenticated_fails(client):
    # 9. Unauthenticated access still fails
    response = client.get("/communities/irm/active")
    assert response.status_code == 401
    
    response = client.get("/communities/irm/delegate")
    assert response.status_code == 401

def test_no_membership_fails(client, db_session):
    # 4. User with no membership fails
    _, token = _create_user_token(db_session, "user1")
    _create_community(db_session, "irm")
    
    response = client.get("/communities/irm/active", cookies={settings.session_cookie_name: token})
    assert response.status_code == 403

def test_missing_community_fails(client, db_session):
    # 8. Wrong/nonexistent community slug fails safely
    _, token = _create_user_token(db_session, "user2")
    
    response = client.get("/communities/unknown/active", cookies={settings.session_cookie_name: token})
    assert response.status_code == 404

def test_active_member_passes_active(client, db_session):
    # 1. Authenticated ACTIVE MEMBER passes the active-membership dependency
    user, token = _create_user_token(db_session, "user3")
    community = _create_community(db_session, "irm")
    
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER)
    db_session.add(m)
    db_session.commit()
    
    response = client.get("/communities/irm/active", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    
    # 6. Active MEMBER fails the delegate dependency
    response_del = client.get("/communities/irm/delegate", cookies={settings.session_cookie_name: token})
    assert response_del.status_code == 403

def test_pending_membership_fails(client, db_session):
    # 2. PENDING membership fails
    user, token = _create_user_token(db_session, "user4")
    community = _create_community(db_session, "irm2")
    
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=MembershipStatus.PENDING, role=MembershipRole.MEMBER)
    db_session.add(m)
    db_session.commit()
    
    response = client.get("/communities/irm2/active", cookies={settings.session_cookie_name: token})
    assert response.status_code == 403
    
    response = client.get("/communities/irm2/delegate", cookies={settings.session_cookie_name: token})
    assert response.status_code == 403

def test_rejected_membership_fails(client, db_session):
    # 3. REJECTED membership fails
    user, token = _create_user_token(db_session, "user5")
    community = _create_community(db_session, "irm3")
    
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=MembershipStatus.REJECTED, role=MembershipRole.MEMBER)
    db_session.add(m)
    db_session.commit()
    
    response = client.get("/communities/irm3/active", cookies={settings.session_cookie_name: token})
    assert response.status_code == 403

def test_active_delegate_passes(client, db_session):
    # 5. Active DELEGATE passes the delegate dependency
    user, token = _create_user_token(db_session, "user6")
    community = _create_community(db_session, "irm4")
    
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE)
    db_session.add(m)
    db_session.commit()
    
    response = client.get("/communities/irm4/delegate", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    assert response.json()["role"] == "DELEGATE"

def test_delegate_scoping(client, db_session):
    # 7. A delegate in one community does not gain delegate privileges in another community
    user, token = _create_user_token(db_session, "user7")
    community1 = _create_community(db_session, "irm-delegate")
    community2 = _create_community(db_session, "irm-member")
    
    m1 = Membership(user_id=user.id, community_id=community1.id, cne="123", status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE)
    db_session.add(m1)
    db_session.commit()
    
    # Passes in community1
    assert client.get("/communities/irm-delegate/delegate", cookies={settings.session_cookie_name: token}).status_code == 200
    
    # Fails in community2
    assert client.get("/communities/irm-member/delegate", cookies={settings.session_cookie_name: token}).status_code == 403


def test_active_moderator_fails_delegate(client, db_session):
    user, token = _create_user_token(db_session, "user8")
    community = _create_community(db_session, "irm5")
    
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR)
    db_session.add(m)
    db_session.commit()
    
    # Passes active membership dependency
    response_active = client.get("/communities/irm5/active", cookies={settings.session_cookie_name: token})
    assert response_active.status_code == 200
    
    # Fails delegate dependency
    response_del = client.get("/communities/irm5/delegate", cookies={settings.session_cookie_name: token})
    assert response_del.status_code == 403
