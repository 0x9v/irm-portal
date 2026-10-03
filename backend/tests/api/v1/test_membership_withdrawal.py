import pytest
import uuid
from datetime import timedelta
from unittest import mock
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.user import User
from app.models.membership import Membership, MembershipStatus, MembershipRole
from app.core.sessions import create_session

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

def _create_community(db, slug="irm"):
    c = Community(id=uuid.uuid4(), name="IRM", slug=slug)
    db.add(c)
    db.commit()
    return c

def _create_user(db, username):
    u = User(id=uuid.uuid4(), email=f"{username}@example.com", username=username, password_hash="hash", first_name="A", family_name="B")
    db.add(u)
    db.commit()
    return u

def _create_token(db, user):
    token, _ = create_session(db, user.id, timedelta(days=1))
    return token

def test_guest_cannot_withdraw(client, db_session):
    community = _create_community(db_session)
    response = client.delete(f"/api/v1/communities/{community.slug}/membership/{uuid.uuid4()}")
    assert response.status_code == 401

def test_cannot_withdraw_unknown_community(client, db_session):
    user = _create_user(db_session, "user1")
    token = _create_token(db_session, user)
    response = client.delete(f"/api/v1/communities/unknown/membership/{uuid.uuid4()}", cookies={"session": token})
    assert response.status_code == 404

def test_cannot_withdraw_other_users_membership(client, db_session):
    community = _create_community(db_session)
    other_user = _create_user(db_session, "other")
    m = Membership(user_id=other_user.id, community_id=community.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="CNE_O")
    db_session.add(m)
    db_session.commit()
    
    user = _create_user(db_session, "me")
    token = _create_token(db_session, user)
    
    response = client.delete(f"/api/v1/communities/{community.slug}/membership/{m.id}", cookies={"session": token})
    assert response.status_code == 404
    assert db_session.query(Membership).count() == 1

def test_can_withdraw_own_pending_membership(client, db_session):
    community = _create_community(db_session)
    user = _create_user(db_session, "me")
    m = Membership(user_id=user.id, community_id=community.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="CNE_ME")
    db_session.add(m)
    db_session.commit()
    
    token = _create_token(db_session, user)
    response = client.delete(f"/api/v1/communities/{community.slug}/membership/{m.id}", cookies={"session": token})
    assert response.status_code == 204
    assert db_session.query(Membership).count() == 0

def test_cannot_withdraw_own_active_membership(client, db_session):
    community = _create_community(db_session)
    user = _create_user(db_session, "me")
    m = Membership(user_id=user.id, community_id=community.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="CNE_ME")
    db_session.add(m)
    db_session.commit()
    
    token = _create_token(db_session, user)
    response = client.delete(f"/api/v1/communities/{community.slug}/membership/{m.id}", cookies={"session": token})
    assert response.status_code == 409
    assert db_session.query(Membership).count() == 1

def test_cannot_withdraw_own_rejected_membership(client, db_session):
    community = _create_community(db_session)
    user = _create_user(db_session, "me")
    m = Membership(user_id=user.id, community_id=community.id, status=MembershipStatus.REJECTED, role=MembershipRole.MEMBER, cne="CNE_ME")
    db_session.add(m)
    db_session.commit()
    
    token = _create_token(db_session, user)
    response = client.delete(f"/api/v1/communities/{community.slug}/membership/{m.id}", cookies={"session": token})
    assert response.status_code == 409
    assert db_session.query(Membership).count() == 1

def test_second_withdrawal_returns_404(client, db_session):
    community = _create_community(db_session)
    user = _create_user(db_session, "me")
    m = Membership(user_id=user.id, community_id=community.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="CNE_ME")
    db_session.add(m)
    db_session.commit()
    
    token = _create_token(db_session, user)
    response1 = client.delete(f"/api/v1/communities/{community.slug}/membership/{m.id}", cookies={"session": token})
    assert response1.status_code == 204
    
    response2 = client.delete(f"/api/v1/communities/{community.slug}/membership/{m.id}", cookies={"session": token})
    assert response2.status_code == 404

