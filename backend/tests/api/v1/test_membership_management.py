import pytest
import uuid
from datetime import timedelta
from app.models.membership import MembershipRole, MembershipStatus, Membership
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
from app.database.session import get_db
from app.main import app

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
from app.models.membership_permission import MembershipPermission, PermissionType
from app.core.sessions import create_session
from app.models.user import User
from app.models.community import Community

def _create_community(db, slug):
    c = Community(id=uuid.uuid4(), name=slug, slug=slug)
    db.add(c)
    db.commit()
    return c

def _create_user(db, username):
    u = User(id=uuid.uuid4(), username=username, email=f"{username}@example.com", password_hash="dummy", first_name="First", family_name="Family")
    db.add(u)
    db.commit()
    return u

def _create_token(db, user):
    token, _ = create_session(db, user.id, timedelta(days=1))
    return token

def test_roster_delegate_only_and_scoped(client, db_session):
    c1 = _create_community(db_session, "c1")
    c2 = _create_community(db_session, "c2")
    
    # Active delegate in c1
    del1 = _create_user(db_session, "del1")
    m_del1 = Membership(user_id=del1.id, community_id=c1.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="D1")
    
    # Active member in c1
    mem1 = _create_user(db_session, "mem1")
    m_mem1 = Membership(user_id=mem1.id, community_id=c1.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="M1")
    
    # Active member in c2
    mem2 = _create_user(db_session, "mem2")
    m_mem2 = Membership(user_id=mem2.id, community_id=c2.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="M2")
    
    # Pending member in c1
    pend1 = _create_user(db_session, "pend1")
    m_pend1 = Membership(user_id=pend1.id, community_id=c1.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="P1")
    
    db_session.add_all([m_del1, m_mem1, m_mem2, m_pend1])
    db_session.commit()
    
    token = _create_token(db_session, del1)
    
    r = client.get(f"/api/v1/communities/{c1.slug}/membership/active", cookies={"session": token})
    print("RESPONSE:", r.json())
    print(r.json())
    data = r.json()
    assert len(data) == 2  # del1, mem1
    assert "private" in r.headers["Cache-Control"]
    
    ids = [d["id"] for d in data]
    assert str(m_del1.id) in ids
    assert str(m_mem1.id) in ids
    assert str(m_mem2.id) not in ids
    assert str(m_pend1.id) not in ids
    
    # Check safe fields
    assert "cne" not in data[0]

def test_delegate_promotes_active_member(client, db_session):
    c = _create_community(db_session, "promo")
    del_u = _create_user(db_session, "pdel")
    mem_u = _create_user(db_session, "pmem")
    
    db_session.add_all([
        Membership(user_id=del_u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="D"),
        Membership(user_id=mem_u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="M")
    ])
    db_session.commit()
    m_mem = db_session.query(Membership).filter(Membership.user_id == mem_u.id).first()
    
    token = _create_token(db_session, del_u)
    r = client.patch(f"/api/v1/communities/{c.slug}/membership/{m_mem.id}/role", json={"role": "MODERATOR"}, cookies={"session": token})
    print("RESPONSE:", r.json())
    assert r.json()["role"] == "MODERATOR"
    
    db_session.refresh(m_mem)
    assert m_mem.role == MembershipRole.MODERATOR
    assert len(m_mem.permissions) == 0

def test_delegate_demotes_moderator_deletes_grants(client, db_session):
    c = _create_community(db_session, "demo")
    del_u = _create_user(db_session, "ddel")
    mod_u = _create_user(db_session, "dmod")
    
    m_del = Membership(user_id=del_u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="D")
    m_mod = Membership(user_id=mod_u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR, cne="M")
    db_session.add_all([m_del, m_mod])
    db_session.commit()
    
    p = MembershipPermission(membership_id=m_mod.id, permission=PermissionType.CREATE_ANNOUNCEMENTS)
    db_session.add(p)
    db_session.commit()
    
    token = _create_token(db_session, del_u)
    r = client.patch(f"/api/v1/communities/{c.slug}/membership/{m_mod.id}/role", json={"role": "MEMBER"}, cookies={"session": token})
    print("RESPONSE:", r.json())
    assert r.json()["role"] == "MEMBER"
    
    db_session.refresh(m_mod)
    assert m_mod.role == MembershipRole.MEMBER
    assert db_session.query(MembershipPermission).count() == 0

def test_invalid_role_rejected(client, db_session):
    c = _create_community(db_session, "inv")
    del_u = _create_user(db_session, "idel")
    mem_u = _create_user(db_session, "imem")
    
    m_mem = Membership(user_id=mem_u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="M")
    db_session.add_all([
        Membership(user_id=del_u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="D"),
        m_mem
    ])
    db_session.commit()
    
    token = _create_token(db_session, del_u)
    r = client.patch(f"/api/v1/communities/{c.slug}/membership/{m_mem.id}/role", json={"role": "DELEGATE"}, cookies={"session": token})
    assert r.status_code == 422
    
    r2 = client.patch(f"/api/v1/communities/{c.slug}/membership/{m_mem.id}/role", json={"role": "ADMIN"}, cookies={"session": token})
    assert r2.status_code == 422

def test_cannot_demote_delegate(client, db_session):
    c = _create_community(db_session, "dd")
    del_u = _create_user(db_session, "dddel")
    m_del = Membership(user_id=del_u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="D")
    db_session.add(m_del)
    db_session.commit()
    
    token = _create_token(db_session, del_u)
    r = client.patch(f"/api/v1/communities/{c.slug}/membership/{m_del.id}/role", json={"role": "MEMBER"}, cookies={"session": token})
    assert r.status_code == 409
    
def test_moderator_cannot_manage_roles(client, db_session):
    c = _create_community(db_session, "mcmr")
    mod_u = _create_user(db_session, "mmod")
    mem_u = _create_user(db_session, "mmem")
    
    m_mem = Membership(user_id=mem_u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="M")
    db_session.add_all([
        Membership(user_id=mod_u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR, cne="M1"),
        m_mem
    ])
    db_session.commit()
    
    token = _create_token(db_session, mod_u)
    r = client.patch(f"/api/v1/communities/{c.slug}/membership/{m_mem.id}/role", json={"role": "MODERATOR"}, cookies={"session": token})
    assert r.status_code == 403

def test_permission_edit_after_demotion_fails(client, db_session):
    c = _create_community(db_session, "pead")
    del_u = _create_user(db_session, "padel")
    mod_u = _create_user(db_session, "pamod")
    
    m_del = Membership(user_id=del_u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="D")
    m_mod = Membership(user_id=mod_u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="M") # Demoted!
    db_session.add_all([m_del, m_mod])
    db_session.commit()
    
    token = _create_token(db_session, del_u)
    r = client.patch(f"/api/v1/communities/{c.slug}/membership/{m_mod.id}/permissions", json={"create_announcements": True}, cookies={"session": token})
    assert r.status_code == 409
