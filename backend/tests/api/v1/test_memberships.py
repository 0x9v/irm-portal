import pytest
from fastapi.testclient import TestClient
from datetime import timedelta

from app.models.community import Community
from app.models.membership import Membership, MembershipStatus, MembershipRole
from app.models.user import User
from app.core.sessions import create_session
from app.core.config import settings
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.main import app
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

def _create_user_and_token(db, username, email):
    user = User(
        username=username,
        email=email,
        password_hash="hash",
        first_name="First",
        family_name="Last"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    raw_token, session_model = create_session(db, user.id, timedelta(days=1))
    return user, raw_token

def _create_community(db, slug):
    community = Community(
        name="Test Community",
        slug=slug
    )
    db.add(community)
    db.commit()
    db.refresh(community)
    return community

def test_unauthenticated_request(client):
    response = client.post("/api/v1/communities/irm/membership", json={"cne": "123"})
    assert response.status_code == 401

def test_authenticated_user_can_request_membership(client, db_session):
    user, token = _create_user_and_token(db_session, "user1", "user1@example.com")
    community = _create_community(db_session, "irm")
    
    response = client.post(
        "/api/v1/communities/irm/membership",
        json={"cne": "CNE12345"},
        cookies={settings.session_cookie_name: token}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["community_id"] == str(community.id)
    assert data["status"] == "PENDING"
    assert data["role"] == "MEMBER"
    
    # Verify in DB
    import uuid
    membership = db_session.query(Membership).filter_by(id=uuid.UUID(data["id"])).first()
    assert membership is not None
    assert membership.user_id == user.id
    assert membership.community_id == community.id
    assert membership.cne == "CNE12345"
    assert membership.status == MembershipStatus.PENDING
    assert membership.role == MembershipRole.MEMBER

def test_request_membership_unknown_community(client, db_session):
    user, token = _create_user_and_token(db_session, "user2", "user2@example.com")
    
    response = client.post(
        "/api/v1/communities/unknown/membership",
        json={"cne": "CNE12345"},
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 404

def test_request_membership_twice_pending(client, db_session):
    user, token = _create_user_and_token(db_session, "user3", "user3@example.com")
    community = _create_community(db_session, "irm-pending")
    
    # First request
    response1 = client.post(
        "/api/v1/communities/irm-pending/membership",
        json={"cne": "CNE12345"},
        cookies={settings.session_cookie_name: token}
    )
    assert response1.status_code == 201
    
    # Second request
    response2 = client.post(
        "/api/v1/communities/irm-pending/membership",
        json={"cne": "CNE12345"},
        cookies={settings.session_cookie_name: token}
    )
    assert response2.status_code == 409
    assert "pending" in response2.json()["detail"].lower()
    
    # Ensure no duplicate row
    count = db_session.query(Membership).filter_by(user_id=user.id, community_id=community.id).count()
    assert count == 1

def test_request_membership_while_active(client, db_session):
    user, token = _create_user_and_token(db_session, "user4", "user4@example.com")
    community = _create_community(db_session, "irm-active")
    
    # Create active membership directly in DB
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=MembershipStatus.ACTIVE)
    db_session.add(m)
    db_session.commit()
    
    response = client.post(
        "/api/v1/communities/irm-active/membership",
        json={"cne": "CNE12345"},
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 409
    assert "active" in response.json()["detail"].lower()
    
    # Ensure no duplicate row
    count = db_session.query(Membership).filter_by(user_id=user.id, community_id=community.id).count()
    assert count == 1

def test_request_membership_after_rejected(client, db_session):
    user, token = _create_user_and_token(db_session, "user5", "user5@example.com")
    community = _create_community(db_session, "irm-rejected")
    
    # Create rejected membership directly in DB
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=MembershipStatus.REJECTED, role=MembershipRole.DELEGATE)
    db_session.add(m)
    db_session.commit()
    
    response = client.post(
        "/api/v1/communities/irm-rejected/membership",
        json={"cne": "CNE12345"},
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 201
    
    data = response.json()
    assert data["status"] == "PENDING"
    assert data["role"] == "MEMBER"
    assert data["id"] == str(m.id)
    
    # Ensure no duplicate row and cne is updated
    db_session.refresh(m)
    count = db_session.query(Membership).filter_by(user_id=user.id, community_id=community.id).count()
    assert count == 1
    assert m.cne == "CNE12345"

def test_user_cannot_choose_own_status_or_owner_or_role(client, db_session):
    user, token = _create_user_and_token(db_session, "user6", "user6@example.com")
    other_user, _ = _create_user_and_token(db_session, "other", "other@example.com")
    community = _create_community(db_session, "irm-status")
    
    # Attempt to inject status, user_id, and role in payload
    response = client.post(
        "/api/v1/communities/irm-status/membership",
        json={
            "cne": "CNE12345",
            "status": "ACTIVE",
            "role": "DELEGATE",
            "user_id": str(other_user.id)
        },
        cookies={settings.session_cookie_name: token}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "PENDING"
    assert data["role"] == "MEMBER"
    
    # Verify in DB that it belongs to the authenticated user and is pending with MEMBER role
    import uuid
    membership = db_session.query(Membership).filter_by(id=uuid.UUID(data["id"])).first()
    assert membership.user_id == user.id  # Not other_user.id
    assert membership.status == MembershipStatus.PENDING
    assert membership.role == MembershipRole.MEMBER

# Global Request Rules Tests

def test_pending_in_a_blocks_request_in_b(client, db_session):
    user, token = _create_user_and_token(db_session, "global1", "g1@example.com")
    comm_a = _create_community(db_session, "comm-a-pend")
    comm_b = _create_community(db_session, "comm-b-pend")
    
    # Create PENDING in A
    m = Membership(user_id=user.id, community_id=comm_a.id, cne="123", status=MembershipStatus.PENDING, role=MembershipRole.MEMBER)
    db_session.add(m)
    db_session.commit()
    
    # Request in B
    response = client.post(
        "/api/v1/communities/comm-b-pend/membership",
        json={"cne": "CNE12345"},
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 409
    assert "another community" in response.json()["detail"].lower()
    
def test_active_in_a_blocks_request_in_b(client, db_session):
    user, token = _create_user_and_token(db_session, "global2", "g2@example.com")
    comm_a = _create_community(db_session, "comm-a-act")
    comm_b = _create_community(db_session, "comm-b-act")
    
    # Create ACTIVE in A
    m = Membership(user_id=user.id, community_id=comm_a.id, cne="123", status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER)
    db_session.add(m)
    db_session.commit()
    
    # Request in B
    response = client.post(
        "/api/v1/communities/comm-b-act/membership",
        json={"cne": "CNE12345"},
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 409
    assert "active membership in another community" in response.json()["detail"].lower()

def test_rejected_in_a_does_not_block_b(client, db_session):
    user, token = _create_user_and_token(db_session, "global3", "g3@example.com")
    comm_a = _create_community(db_session, "comm-a-rej")
    comm_b = _create_community(db_session, "comm-b-rej")
    
    # Create REJECTED in A
    m = Membership(user_id=user.id, community_id=comm_a.id, cne="123", status=MembershipStatus.REJECTED, role=MembershipRole.MEMBER)
    db_session.add(m)
    db_session.commit()
    
    # Request in B
    response = client.post(
        "/api/v1/communities/comm-b-rej/membership",
        json={"cne": "CNE12345"},
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 201

def test_rejected_target_cannot_reopen_if_active_exists(client, db_session):
    user, token = _create_user_and_token(db_session, "global4", "g4@example.com")
    comm_a = _create_community(db_session, "comm-a-target")
    comm_b = _create_community(db_session, "comm-b-other")
    
    # User was rejected in A
    m_rej = Membership(user_id=user.id, community_id=comm_a.id, cne="123", status=MembershipStatus.REJECTED, role=MembershipRole.MEMBER)
    db_session.add(m_rej)
    
    # But user is active in B
    m_act = Membership(user_id=user.id, community_id=comm_b.id, cne="123", status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER)
    db_session.add(m_act)
    db_session.commit()
    
    # Try to reopen A
    response = client.post(
        "/api/v1/communities/comm-a-target/membership",
        json={"cne": "CNE12345"},
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 409
    
    # Verify A remains REJECTED
    db_session.refresh(m_rej)
    assert m_rej.status == MembershipStatus.REJECTED

# Reapplication advanced assertions

def test_reapplication_preserves_created_at(client, db_session):
    user, token = _create_user_and_token(db_session, "reapp1", "reapp@example.com")
    community = _create_community(db_session, "comm-reapp")
    
    from datetime import datetime, timezone, timedelta
    old_time = datetime.now(timezone.utc) - timedelta(days=5)
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=MembershipStatus.REJECTED, role=MembershipRole.DELEGATE)
    m.created_at = old_time
    db_session.add(m)
    db_session.commit()
    
    response = client.post(
        "/api/v1/communities/comm-reapp/membership",
        json={"cne": "NEWCNE"},
        cookies={settings.session_cookie_name: token}
    )
    assert response.status_code == 201
    
    db_session.refresh(m)
    assert m.created_at.replace(tzinfo=timezone.utc) == old_time
    assert m.updated_at.replace(tzinfo=timezone.utc) > old_time
    assert m.cne == "NEWCNE"

# Database Enforcement Tests (testing the index directly)

def test_db_enforces_one_pending_or_active(db_session):
    from sqlalchemy.exc import IntegrityError
    user = _create_user_and_token(db_session, "db1", "db1@example.com")[0]
    comm_1 = _create_community(db_session, "db-comm-1")
    comm_2 = _create_community(db_session, "db-comm-2")
    
    # 1. PENDING + PENDING
    db_session.add(Membership(user_id=user.id, community_id=comm_1.id, cne="1", status=MembershipStatus.PENDING, role=MembershipRole.MEMBER))
    db_session.commit()
    
    db_session.add(Membership(user_id=user.id, community_id=comm_2.id, cne="2", status=MembershipStatus.PENDING, role=MembershipRole.MEMBER))
    import pytest
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    
    # 2. PENDING + ACTIVE
    db_session.add(Membership(user_id=user.id, community_id=comm_2.id, cne="2", status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

def test_db_allows_multiple_rejected(db_session):
    user = _create_user_and_token(db_session, "db2", "db2@example.com")[0]
    comm_1 = _create_community(db_session, "db-comm-3")
    comm_2 = _create_community(db_session, "db-comm-4")
    
    # REJECTED + REJECTED
    db_session.add(Membership(user_id=user.id, community_id=comm_1.id, cne="1", status=MembershipStatus.REJECTED, role=MembershipRole.MEMBER))
    db_session.add(Membership(user_id=user.id, community_id=comm_2.id, cne="2", status=MembershipStatus.REJECTED, role=MembershipRole.MEMBER))
    db_session.commit()  # Should succeed!
    
    # Also allows 1 PENDING alongside rejected
    comm_3 = _create_community(db_session, "db-comm-5")
    db_session.add(Membership(user_id=user.id, community_id=comm_3.id, cne="3", status=MembershipStatus.PENDING, role=MembershipRole.MEMBER))
    db_session.commit()  # Should succeed!
