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
    
    # Unknown fields are rejected; callers cannot choose status, user_id, or role.
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
    
    assert response.status_code == 422
    assert db_session.query(Membership).filter_by(user_id=user.id).count() == 0

# Cross-community request rules

def test_pending_in_a_allows_request_in_b(client, db_session):
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
    assert response.status_code == 201
    assert db_session.query(Membership).filter_by(user_id=user.id, community_id=comm_a.id).one().status == MembershipStatus.PENDING
    assert db_session.query(Membership).filter_by(user_id=user.id, community_id=comm_b.id).one().status == MembershipStatus.PENDING
    
def test_active_in_a_allows_request_in_b(client, db_session):
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
    assert response.status_code == 201
    assert db_session.query(Membership).filter_by(user_id=user.id, community_id=comm_a.id).one().status == MembershipStatus.ACTIVE
    assert db_session.query(Membership).filter_by(user_id=user.id, community_id=comm_b.id).one().status == MembershipStatus.PENDING

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

def test_rejected_target_can_reopen_if_active_exists_elsewhere(client, db_session):
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
    assert response.status_code == 201
    
    # Verify A remains REJECTED
    db_session.refresh(m_rej)
    assert m_rej.status == MembershipStatus.PENDING
    db_session.refresh(m_act)
    assert m_act.status == MembershipStatus.ACTIVE

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

def test_db_allows_pending_and_active_across_communities(db_session):
    user = _create_user_and_token(db_session, "db1", "db1@example.com")[0]
    comm_1 = _create_community(db_session, "db-comm-1")
    comm_2 = _create_community(db_session, "db-comm-2")
    
    # 1. PENDING + PENDING
    db_session.add(Membership(user_id=user.id, community_id=comm_1.id, cne="1", status=MembershipStatus.PENDING, role=MembershipRole.MEMBER))
    db_session.commit()
    
    db_session.add(Membership(user_id=user.id, community_id=comm_2.id, cne="2", status=MembershipStatus.PENDING, role=MembershipRole.MEMBER))
    db_session.commit()
    
    # 2. PENDING + ACTIVE
    comm_3 = _create_community(db_session, "db-comm-6")
    db_session.add(Membership(user_id=user.id, community_id=comm_3.id, cne="3", status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER))
    db_session.commit()
    assert db_session.query(Membership).filter_by(user_id=user.id).count() == 3


def test_db_still_enforces_one_membership_per_user_and_community(db_session):
    from sqlalchemy.exc import IntegrityError
    user = _create_user_and_token(db_session, "db-pair", "db-pair@example.com")[0]
    community = _create_community(db_session, "db-pair-community")
    db_session.add(Membership(user_id=user.id, community_id=community.id, cne="1", status=MembershipStatus.PENDING))
    db_session.commit()
    db_session.add(Membership(user_id=user.id, community_id=community.id, cne="2", status=MembershipStatus.PENDING))
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

    # Also permits a current membership alongside rejected history.
    comm_3 = _create_community(db_session, "db-comm-5")
    db_session.add(Membership(user_id=user.id, community_id=comm_3.id, cne="3",
                              status=MembershipStatus.PENDING, role=MembershipRole.MEMBER))
    db_session.commit()


def test_active_a_application_and_approval_in_b_are_independent(client, db_session):
    user, token = _create_user_and_token(db_session, "multi-active", "multi-active@example.com")
    community_a = _create_community(db_session, "multi-a")
    community_b = _create_community(db_session, "multi-b")
    active_a = Membership(user_id=user.id, community_id=community_a.id, cne="A-CNE", status=MembershipStatus.ACTIVE)
    reviewer = _create_user_and_token(db_session, "multi-reviewer", "multi-reviewer@example.com")[0]
    db_session.add(Membership(user_id=reviewer.id, community_id=community_b.id, cne="B-STAFF",
                              status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE))
    db_session.add(active_a)
    db_session.commit()
    reviewer_token = create_session(db_session, reviewer.id, timedelta(days=1))[0]

    applied = client.post("/api/v1/communities/multi-b/membership", json={"cne": "B-CNE"},
                          cookies={settings.session_cookie_name: token})
    assert applied.status_code == 201
    pending_b_id = applied.json()["id"]
    approved = client.post(f"/api/v1/communities/multi-b/membership/{pending_b_id}/approve",
                           cookies={settings.session_cookie_name: reviewer_token})
    assert approved.status_code == 200 and approved.json()["status"] == "ACTIVE"

    db_session.refresh(active_a)
    assert active_a.status == MembershipStatus.ACTIVE
    own_a = client.get("/api/v1/communities/multi-a/membership/me", cookies={settings.session_cookie_name: token})
    own_b = client.get("/api/v1/communities/multi-b/membership/me", cookies={settings.session_cookie_name: token})
    assert own_a.json()["membership"]["cne"] == "A-CNE"
    assert own_b.json()["membership"]["cne"] == "B-CNE"
    directory_b = client.get("/api/v1/communities/multi-b/memberships",
                             cookies={settings.session_cookie_name: reviewer_token})
    directory_ids = {row["id"] for row in directory_b.json()["items"]}
    assert pending_b_id in directory_ids
    assert str(active_a.id) not in directory_ids


def test_rejecting_b_leaves_pending_a_and_private_review_is_target_scoped(client, db_session):
    applicant, token = _create_user_and_token(db_session, "multi-pending", "multi-pending@example.com")
    community_a = _create_community(db_session, "multi-pending-a")
    community_b = _create_community(db_session, "multi-pending-b")
    pending_a = Membership(user_id=applicant.id, community_id=community_a.id, cne="A-PRIVATE",
                           applicant_first_name="Applicant A", status=MembershipStatus.PENDING)
    delegate = _create_user_and_token(db_session, "multi-pending-delegate", "multi-pending-delegate@example.com")[0]
    db_session.add_all([pending_a, Membership(user_id=applicant.id, community_id=community_b.id, cne="B-PRIVATE",
                      applicant_first_name="Applicant B", status=MembershipStatus.PENDING),
                      Membership(user_id=delegate.id, community_id=community_b.id, cne="STAFF",
                                 status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE)])
    db_session.commit()
    delegate_token = create_session(db_session, delegate.id, timedelta(days=1))[0]

    target_b = db_session.query(Membership).filter_by(user_id=applicant.id, community_id=community_b.id).one()
    pending_b = client.get("/api/v1/communities/multi-pending-b/membership/pending",
                           cookies={settings.session_cookie_name: delegate_token})
    assert pending_b.status_code == 200
    target_review = next(row for row in pending_b.json() if row["id"] == str(target_b.id))
    assert target_review["cne"] == "B-PRIVATE"
    assert target_review["applicant_first_name"] == "Applicant B"
    assert all(row["id"] != str(pending_a.id) for row in pending_b.json())
    rejected = client.post(f"/api/v1/communities/multi-pending-b/membership/{target_b.id}/reject",
                           cookies={settings.session_cookie_name: delegate_token})
    assert rejected.status_code == 200
    db_session.refresh(pending_a)
    assert pending_a.status == MembershipStatus.PENDING

    private_a = client.get("/api/v1/communities/multi-pending-a/membership/me", cookies={settings.session_cookie_name: token})
    assert private_a.json()["membership"]["cne"] == "A-PRIVATE"


def test_removed_or_banned_b_does_not_change_active_a(client, db_session):
    from app.models.membership_permission import MembershipPermission, PermissionType

    user, token = _create_user_and_token(db_session, "multi-ban", "multi-ban@example.com")
    community_a = _create_community(db_session, "multi-ban-a")
    community_b = _create_community(db_session, "multi-ban-b")
    active_a = Membership(user_id=user.id, community_id=community_a.id, cne="A-STABLE", status=MembershipStatus.ACTIVE,
                          role=MembershipRole.MODERATOR)
    removed_b = Membership(user_id=user.id, community_id=community_b.id, cne="B-OLD", status=MembershipStatus.REMOVED,
                           role=MembershipRole.DELEGATE)
    db_session.add_all([active_a, removed_b])
    db_session.flush()
    permission_a = MembershipPermission(membership_id=active_a.id,
                                        permission=PermissionType.MANAGE_DOCUMENT_VOTING)
    db_session.add(permission_a)
    db_session.commit()
    old_id = removed_b.id

    reapplied = client.post("/api/v1/communities/multi-ban-b/membership", json={"cne": "B-NEW"},
                            cookies={settings.session_cookie_name: token})
    assert reapplied.status_code == 201 and reapplied.json()["id"] == str(old_id)
    db_session.refresh(active_a)
    assert active_a.status == MembershipStatus.ACTIVE and active_a.role == MembershipRole.MODERATOR

    db_session.refresh(removed_b)
    removed_b.status = MembershipStatus.BANNED
    db_session.commit()
    denied = client.post("/api/v1/communities/multi-ban-b/membership", json={"cne": "B-AGAIN"},
                         cookies={settings.session_cookie_name: token})
    assert denied.status_code == 403
    own_a = client.get("/api/v1/communities/multi-ban-a/membership/me", cookies={settings.session_cookie_name: token})
    assert own_a.json()["membership"]["status"] == "ACTIVE"
    assert own_a.json()["membership"]["role"] == "MODERATOR"
    assert own_a.json()["capabilities"]["manage_document_voting"] is True
    assert db_session.query(MembershipPermission).filter_by(membership_id=active_a.id).count() == 1
    assert client.get("/api/v1/communities/multi-ban-a/announcements",
                      cookies={settings.session_cookie_name: token}).status_code == 200
    assert client.get("/api/v1/communities/multi-ban-b/announcements",
                      cookies={settings.session_cookie_name: token}).status_code == 403


def test_moderator_permission_is_attached_to_community_membership(client, db_session):
    from app.models.membership_permission import MembershipPermission, PermissionType

    user, token = _create_user_and_token(db_session, "multi-moderator", "multi-moderator@example.com")
    community_a = _create_community(db_session, "multi-mod-a")
    community_b = _create_community(db_session, "multi-mod-b")
    moderator_a = Membership(user_id=user.id, community_id=community_a.id, cne="A",
                             status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR)
    member_b = Membership(user_id=user.id, community_id=community_b.id, cne="B",
                          status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER)
    db_session.add_all([moderator_a, member_b])
    db_session.flush()
    db_session.add(MembershipPermission(membership_id=moderator_a.id,
                                        permission=PermissionType.MANAGE_DOCUMENT_VOTING))
    db_session.commit()

    response_a = client.get("/api/v1/communities/multi-mod-a/membership/me",
                            cookies={settings.session_cookie_name: token})
    response_b = client.get("/api/v1/communities/multi-mod-b/membership/me",
                            cookies={settings.session_cookie_name: token})
    assert response_a.json()["capabilities"]["manage_document_voting"] is True
    assert response_b.json()["capabilities"]["manage_document_voting"] is False


def test_each_community_keeps_one_active_delegate(db_session):
    from sqlalchemy.exc import IntegrityError

    first = _create_user_and_token(db_session, "delegate-first", "delegate-first@example.com")[0]
    second = _create_user_and_token(db_session, "delegate-second", "delegate-second@example.com")[0]
    community_a = _create_community(db_session, "delegate-a")
    community_b = _create_community(db_session, "delegate-b")
    db_session.add_all([
        Membership(user_id=first.id, community_id=community_a.id, cne="A", status=MembershipStatus.ACTIVE,
                   role=MembershipRole.DELEGATE),
        Membership(user_id=first.id, community_id=community_b.id, cne="B", status=MembershipStatus.ACTIVE,
                   role=MembershipRole.DELEGATE),
    ])
    db_session.commit()
    db_session.add(Membership(user_id=second.id, community_id=community_a.id, cne="C",
                              status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
