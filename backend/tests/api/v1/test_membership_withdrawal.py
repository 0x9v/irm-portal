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


# ---- Lifecycle tests (sequential state transitions, not concurrent) ----
# These verify state-machine correctness. They do NOT verify PostgreSQL
# SELECT FOR UPDATE concurrent isolation, which is UNVERIFIED in this suite.

def test_withdraw_then_reapply_same_community(client, db_session):
    """Request → withdraw → reapply to same community creates new PENDING row."""
    community = _create_community(db_session, "irm-lifecycle")
    user = _create_user(db_session, "lifecycle1")
    m = Membership(user_id=user.id, community_id=community.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="CNE_L1")
    db_session.add(m)
    db_session.commit()

    token = _create_token(db_session, user)
    r = client.delete(f"/api/v1/communities/{community.slug}/membership/{m.id}", cookies={"session": token})
    assert r.status_code == 204
    assert db_session.query(Membership).filter(Membership.user_id == user.id).count() == 0

    r2 = client.post(f"/api/v1/communities/{community.slug}/membership",
                     json={"cne": "CNE_NEW"}, cookies={"session": token})
    assert r2.status_code == 201
    new_m = db_session.query(Membership).filter(Membership.user_id == user.id).first()
    assert new_m is not None
    assert str(new_m.id) != str(m.id)
    assert new_m.status == MembershipStatus.PENDING


def test_withdraw_then_apply_another_community(client, db_session):
    """Request → withdraw → apply to different community succeeds."""
    community_a = _create_community(db_session, "irm-a")
    community_b = _create_community(db_session, "irm-b")
    user = _create_user(db_session, "lifecycle2")
    m = Membership(user_id=user.id, community_id=community_a.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="CNE_L2")
    db_session.add(m)
    db_session.commit()

    token = _create_token(db_session, user)
    r = client.delete(f"/api/v1/communities/{community_a.slug}/membership/{m.id}", cookies={"session": token})
    assert r.status_code == 204

    r2 = client.post(f"/api/v1/communities/{community_b.slug}/membership",
                     json={"cne": "CNE_L2B"}, cookies={"session": token})
    assert r2.status_code == 201


def test_withdrawn_request_absent_from_delegate_queue(client, db_session):
    """Withdrawn request does not appear in the pending queue seen by a Delegate."""
    community = _create_community(db_session, "irm-queue")
    user = _create_user(db_session, "applicant")
    delegate_user = _create_user(db_session, "delegate")
    delegate_m = Membership(user_id=delegate_user.id, community_id=community.id,
                            status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="CNE_D")
    m = Membership(user_id=user.id, community_id=community.id,
                   status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="CNE_APP")
    db_session.add_all([delegate_m, m])
    db_session.commit()

    applicant_token = _create_token(db_session, user)
    delegate_token = _create_token(db_session, delegate_user)

    r = client.delete(f"/api/v1/communities/{community.slug}/membership/{m.id}",
                      cookies={"session": applicant_token})
    assert r.status_code == 204

    r2 = client.get(f"/api/v1/communities/{community.slug}/membership/pending",
                    cookies={"session": delegate_token})
    assert r2.status_code == 200
    ids = [item["id"] for item in r2.json()]
    assert str(m.id) not in ids


def test_approval_before_withdrawal_preserves_active(client, db_session):
    """Sequential: delegate approves → user tries to withdraw → 409, ACTIVE preserved.
    (Sequential state test; does NOT verify concurrent SELECT FOR UPDATE isolation.)
    """
    community = _create_community(db_session, "irm-seq")
    user = _create_user(db_session, "seq_user")
    delegate_user = _create_user(db_session, "seq_delegate")
    delegate_m = Membership(user_id=delegate_user.id, community_id=community.id,
                            status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="CNE_SD")
    m = Membership(user_id=user.id, community_id=community.id,
                   status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="CNE_SU")
    db_session.add_all([delegate_m, m])
    db_session.commit()

    delegate_token = _create_token(db_session, delegate_user)
    r_approve = client.post(f"/api/v1/communities/{community.slug}/membership/{m.id}/approve",
                            cookies={"session": delegate_token})
    assert r_approve.status_code == 200

    user_token = _create_token(db_session, user)
    r_withdraw = client.delete(f"/api/v1/communities/{community.slug}/membership/{m.id}",
                               cookies={"session": user_token})
    assert r_withdraw.status_code == 409

    db_session.expire(m)
    db_session.refresh(m)
    assert m.status == MembershipStatus.ACTIVE


def test_rejection_before_withdrawal_preserves_rejected(client, db_session):
    """Sequential: delegate rejects → user tries to withdraw → 409, REJECTED preserved."""
    community = _create_community(db_session, "irm-seq2")
    user = _create_user(db_session, "seq_user2")
    delegate_user = _create_user(db_session, "seq_delegate2")
    delegate_m = Membership(user_id=delegate_user.id, community_id=community.id,
                            status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="CNE_SD2")
    m = Membership(user_id=user.id, community_id=community.id,
                   status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="CNE_SU2")
    db_session.add_all([delegate_m, m])
    db_session.commit()

    delegate_token = _create_token(db_session, delegate_user)
    r_reject = client.post(f"/api/v1/communities/{community.slug}/membership/{m.id}/reject",
                           cookies={"session": delegate_token})
    assert r_reject.status_code == 200

    user_token = _create_token(db_session, user)
    r_withdraw = client.delete(f"/api/v1/communities/{community.slug}/membership/{m.id}",
                               cookies={"session": user_token})
    assert r_withdraw.status_code == 409

    db_session.expire(m)
    db_session.refresh(m)
    assert m.status == MembershipStatus.REJECTED


def test_user_session_intact_after_withdrawal(client, db_session):
    """User account and session remain usable after withdrawal."""
    community = _create_community(db_session, "irm-sess")
    user = _create_user(db_session, "sess_user")
    m = Membership(user_id=user.id, community_id=community.id,
                   status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="CNE_SESS")
    db_session.add(m)
    db_session.commit()

    token = _create_token(db_session, user)
    r = client.delete(f"/api/v1/communities/{community.slug}/membership/{m.id}", cookies={"session": token})
    assert r.status_code == 204

    # Auth/me should still return the user
    r_me = client.get("/api/v1/auth/me", cookies={"session": token})
    assert r_me.status_code == 200
    assert r_me.json()["username"] == "sess_user"

    # Self-membership should return membership=null
    r_self = client.get(f"/api/v1/communities/{community.slug}/membership/me", cookies={"session": token})
    assert r_self.status_code == 200
    assert r_self.json()["membership"] is None
