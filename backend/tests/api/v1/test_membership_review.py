
def _create_test_community(db_session):
    from app.models.community import Community
    c = Community(id=uuid4(), name="Test", slug="test-comm")
    db_session.add(c)
    db_session.commit()
    return c
import pytest
import uuid
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
    community = Community(name="Test", slug=slug)
    db.add(community)
    db.commit()
    db.refresh(community)
    return community

def _create_membership(db, user, community, status, role):
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=status, role=role)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m

def test_unauthenticated_cannot_approve_reject(client, db_session):
    community = _create_community(db_session, "irm")
    user = _create_user(db_session, "target")
    m = _create_membership(db_session, user, community, MembershipStatus.PENDING, MembershipRole.MEMBER)
    
    # 1. Unauthenticated user cannot approve.
    assert client.post(f"/api/v1/communities/irm/membership/{m.id}/approve").status_code == 401
    # 2. Unauthenticated user cannot reject.
    assert client.post(f"/api/v1/communities/irm/membership/{m.id}/reject").status_code == 401

def test_active_member_cannot_approve_reject(client, db_session):
    community = _create_community(db_session, "irm")
    user = _create_user(db_session, "member")
    token = _create_token(db_session, user)
    _create_membership(db_session, user, community, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    target = _create_user(db_session, "target")
    m = _create_membership(db_session, target, community, MembershipStatus.PENDING, MembershipRole.MEMBER)
    
    # 3. ACTIVE MEMBER cannot approve.
    assert client.post(f"/api/v1/communities/irm/membership/{m.id}/approve", cookies={settings.session_cookie_name: token}).status_code == 403
    # 4. ACTIVE MEMBER cannot reject.
    assert client.post(f"/api/v1/communities/irm/membership/{m.id}/reject", cookies={settings.session_cookie_name: token}).status_code == 403

def test_delegate_cross_community_fails(client, db_session):
    comm_a = _create_community(db_session, "comm-a")
    comm_b = _create_community(db_session, "comm-b")
    
    delegate = _create_user(db_session, "delegate")
    token = _create_token(db_session, delegate)
    _create_membership(db_session, delegate, comm_a, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    
    target = _create_user(db_session, "target")
    m = _create_membership(db_session, target, comm_b, MembershipStatus.PENDING, MembershipRole.MEMBER)
    
    # 5. DELEGATE of Community A cannot approve a membership from Community B.
    assert client.post(f"/api/v1/communities/comm-b/membership/{m.id}/approve", cookies={settings.session_cookie_name: token}).status_code == 403
    # 6. DELEGATE of Community A cannot reject a membership from Community B.
    assert client.post(f"/api/v1/communities/comm-b/membership/{m.id}/reject", cookies={settings.session_cookie_name: token}).status_code == 403

def test_approval_flow(client, db_session):
    community = _create_community(db_session, "irm")
    delegate = _create_user(db_session, "delegate")
    token = _create_token(db_session, delegate)
    _create_membership(db_session, delegate, community, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    
    target = _create_user(db_session, "target")
    m = _create_membership(db_session, target, community, MembershipStatus.PENDING, MembershipRole.MEMBER)
    
    # 7. Delegate can approve a PENDING membership.
    response = client.post(f"/api/v1/communities/irm/membership/{m.id}/approve", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    
    data = response.json()
    # 8. Membership becomes ACTIVE.
    assert data["status"] == "ACTIVE"
    # 9. Approved membership remains MEMBER role.
    assert data["role"] == "MEMBER"
    
    db_session.expire_all()
    m_db = db_session.query(Membership).get(m.id)
    assert m_db.status == MembershipStatus.ACTIVE
    assert m_db.role == MembershipRole.MEMBER
    # 10. User/community/CNE remain unchanged.
    assert m_db.user_id == target.id
    assert m_db.community_id == community.id
    assert m_db.cne == "123"

def test_rejection_flow(client, db_session):
    community = _create_community(db_session, "irm")
    delegate = _create_user(db_session, "delegate")
    token = _create_token(db_session, delegate)
    _create_membership(db_session, delegate, community, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    
    target = _create_user(db_session, "target")
    m = _create_membership(db_session, target, community, MembershipStatus.PENDING, MembershipRole.MEMBER)
    
    # 11. Delegate can reject a PENDING membership.
    response = client.post(f"/api/v1/communities/irm/membership/{m.id}/reject", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    
    data = response.json()
    # 12. Membership becomes REJECTED.
    assert data["status"] == "REJECTED"
    # 13. Rejected membership remains MEMBER role.
    assert data["role"] == "MEMBER"
    
    db_session.expire_all()
    m_db = db_session.query(Membership).get(m.id)
    assert m_db.status == MembershipStatus.REJECTED
    assert m_db.role == MembershipRole.MEMBER
    # 14. User/community/CNE remain unchanged.
    assert m_db.user_id == target.id
    assert m_db.community_id == community.id
    assert m_db.cne == "123"

def test_invalid_transitions(client, db_session):
    community = _create_community(db_session, "irm")
    delegate = _create_user(db_session, "delegate")
    token = _create_token(db_session, delegate)
    _create_membership(db_session, delegate, community, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    
    user1 = _create_user(db_session, "active")
    m_active = _create_membership(db_session, user1, community, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    # 15. ACTIVE membership cannot be approved again.
    assert client.post(f"/api/v1/communities/irm/membership/{m_active.id}/approve", cookies={settings.session_cookie_name: token}).status_code == 409
    # 16. ACTIVE membership cannot be rejected.
    assert client.post(f"/api/v1/communities/irm/membership/{m_active.id}/reject", cookies={settings.session_cookie_name: token}).status_code == 409
    
    user2 = _create_user(db_session, "rejected")
    m_rejected = _create_membership(db_session, user2, community, MembershipStatus.REJECTED, MembershipRole.MEMBER)
    
    # 17. REJECTED membership cannot be approved.
    assert client.post(f"/api/v1/communities/irm/membership/{m_rejected.id}/approve", cookies={settings.session_cookie_name: token}).status_code == 409
    # 18. REJECTED membership cannot be rejected again.
    assert client.post(f"/api/v1/communities/irm/membership/{m_rejected.id}/reject", cookies={settings.session_cookie_name: token}).status_code == 409

def test_lookup_security(client, db_session):
    community = _create_community(db_session, "irm")
    delegate = _create_user(db_session, "delegate")
    token = _create_token(db_session, delegate)
    _create_membership(db_session, delegate, community, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    
    # 19. Non-existent membership returns an appropriate 404.
    fake_id = str(uuid.uuid4())
    assert client.post(f"/api/v1/communities/irm/membership/{fake_id}/approve", cookies={settings.session_cookie_name: token}).status_code == 404
    
    comm2 = _create_community(db_session, "other")
    user = _create_user(db_session, "user")
    m_other = _create_membership(db_session, user, comm2, MembershipStatus.PENDING, MembershipRole.MEMBER)
    
    # 20. Membership belonging to another community cannot be manipulated through a different community slug.
    # We query the `irm` route with `m_other.id`
    assert client.post(f"/api/v1/communities/irm/membership/{m_other.id}/approve", cookies={settings.session_cookie_name: token}).status_code == 404

# Lifecycle Tests

def test_full_lifecycle(client, db_session):
    community = _create_community(db_session, "lifecycle")
    delegate = _create_user(db_session, "lifedel")
    del_token = _create_token(db_session, delegate)
    _create_membership(db_session, delegate, community, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    
    target = _create_user(db_session, "target_life")
    target_token = _create_token(db_session, target)
    
    # 1. Request
    res1 = client.post("/api/v1/communities/lifecycle/membership", json={"cne": "123"}, cookies={settings.session_cookie_name: target_token})
    assert res1.status_code == 201
    m_id = res1.json()["id"]
    
    # 2. Reject
    res2 = client.post(f"/api/v1/communities/lifecycle/membership/{m_id}/reject", cookies={settings.session_cookie_name: del_token})
    assert res2.status_code == 200
    
    # 3. Request (Reapply)
    res3 = client.post("/api/v1/communities/lifecycle/membership", json={"cne": "456"}, cookies={settings.session_cookie_name: target_token})
    assert res3.status_code == 201
    assert res3.json()["id"] == m_id
    
    # 4. Approve
    res4 = client.post(f"/api/v1/communities/lifecycle/membership/{m_id}/approve", cookies={settings.session_cookie_name: del_token})
    assert res4.status_code == 200
    assert res4.json()["status"] == "ACTIVE"
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from uuid import uuid4

from app.models.user import User
from app.models.community import Community
from app.models.membership import Membership, MembershipStatus, MembershipRole


def _create_test_community_pending(db_session):
    from app.models.community import Community
    from uuid import uuid4
    c = Community(id=uuid4(), name="Test Pending", slug="test-pending")
    db_session.add(c)
    db_session.commit()
    return c

def test_pending_memberships_guest_denied(client, db_session):
    test_community = _create_test_community_pending(db_session)
    response = client.get(f"/api/v1/communities/{test_community.slug}/membership/pending")
    assert response.status_code == 401

def test_pending_memberships_active_member_denied(client, db_session):
    test_community = _create_test_community_pending(db_session)
    from app.core.sessions import create_session
    from app.models.user import User
    from app.models.membership import Membership, MembershipStatus, MembershipRole
    from uuid import uuid4
    
    _create_user(db_session, "mem2")
    user = db_session.query(User).filter_by(username="mem2").first()
    mem = Membership(user_id=user.id, community_id=test_community.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="M123")
    db_session.add(mem)
    db_session.commit()
    
    token = _create_token(db_session, user)
    response = client.get(f"/api/v1/communities/{test_community.slug}/membership/pending", cookies={settings.session_cookie_name: token})
    assert response.status_code == 403

def test_pending_memberships_moderator_denied(client, db_session):
    test_community = _create_test_community_pending(db_session)
    from app.core.sessions import create_session
    from app.models.user import User
    from app.models.membership import Membership, MembershipStatus, MembershipRole
    from uuid import uuid4
    
    _create_user(db_session, "mod2")
    user = db_session.query(User).filter_by(username="mod2").first()
    mem = Membership(user_id=user.id, community_id=test_community.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR, cne="MOD")
    db_session.add(mem)
    db_session.commit()
    
    token = _create_token(db_session, user)
    response = client.get(f"/api/v1/communities/{test_community.slug}/membership/pending", cookies={settings.session_cookie_name: token})
    assert response.status_code == 403

def test_pending_memberships_delegate_allowed(client, db_session):
    test_community = _create_test_community_pending(db_session)
    from app.core.sessions import create_session
    from app.models.user import User
    from app.models.membership import Membership, MembershipStatus, MembershipRole
    from uuid import uuid4
    
    _create_user(db_session, "del2")
    user = db_session.query(User).filter_by(username="del2").first()
    mem = Membership(user_id=user.id, community_id=test_community.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="DEL")
    db_session.add(mem)
    
    _create_user(db_session, "applicant1")
    app_user = db_session.query(User).filter_by(username="applicant1").first()
    app_mem = Membership(user_id=app_user.id, community_id=test_community.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="APP123")
    db_session.add(app_mem)
    
    db_session.commit()
    
    token = _create_token(db_session, user)
    response = client.get(f"/api/v1/communities/{test_community.slug}/membership/pending", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["cne"] == "APP123"
    assert data[0]["username"] == "applicant1"
    assert data[0]["first_name"] == "First"
    assert "password" not in data[0]
    assert "email" not in data[0]
    assert response.headers.get("Cache-Control") == "private, no-store"

def test_pending_memberships_wrong_community(client, db_session):
    test_community = _create_test_community_pending(db_session)
    from app.core.sessions import create_session
    from app.models.user import User
    from app.models.membership import Membership, MembershipStatus, MembershipRole
    from uuid import uuid4
    
    _create_user(db_session, "delw")
    user = db_session.query(User).filter_by(username="delw").first()
    mem = Membership(user_id=user.id, community_id=test_community.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="DEL")
    db_session.add(mem)
    db_session.commit()
    
    token = _create_token(db_session, user)
    
    response = client.get(f"/api/v1/communities/fake/membership/pending", cookies={settings.session_cookie_name: token})
    assert response.status_code == 404

