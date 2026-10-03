import pytest
import uuid
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

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

from app.services.provisioning import appoint_delegate
from app.models.community import Community
from app.models.user import User
from app.models.membership import Membership, MembershipStatus, MembershipRole

def _create_community(db, slug="irm-prov"):
    c = Community(id=uuid.uuid4(), name="IRM Prov", slug=slug)
    db.add(c)
    db.commit()
    return c

def _create_user(db, username="provuser"):
    u = User(id=uuid.uuid4(), email=f"{username}@example.com", username=username, password_hash="hash", first_name="A", family_name="B")
    db.add(u)
    db.commit()
    return u

def test_dry_run_makes_no_changes(db_session):
    c = _create_community(db_session, "dry")
    u = _create_user(db_session, "dryu")
    success, msg = appoint_delegate(db_session, c.slug, str(u.id), cne="CNE_DRY", apply=False)
    assert success
    assert "Would create" in msg
    assert db_session.query(Membership).count() == 0

def test_new_valid_account_can_become_active_delegate(db_session):
    c = _create_community(db_session, "newd")
    u = _create_user(db_session, "newdu")
    success, msg = appoint_delegate(db_session, c.slug, str(u.id), cne="CNE_NEW", apply=True)
    assert success
    assert "Created new" in msg
    m = db_session.query(Membership).first()
    assert m.status == MembershipStatus.ACTIVE
    assert m.role == MembershipRole.DELEGATE

def test_existing_active_member_can_be_promoted(db_session):
    c = _create_community(db_session, "promoted")
    u = _create_user(db_session, "promoteu")
    m = Membership(user_id=u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="CNE_P")
    db_session.add(m)
    db_session.commit()
    
    success, msg = appoint_delegate(db_session, c.slug, str(u.id), apply=True)
    assert success
    assert "Promoted" in msg
    db_session.refresh(m)
    assert m.role == MembershipRole.DELEGATE
    assert db_session.query(Membership).count() == 1

def test_existing_delegate_operation_is_idempotent(db_session):
    c = _create_community(db_session, "idem")
    u = _create_user(db_session, "idemu")
    m = Membership(user_id=u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="CNE_I")
    db_session.add(m)
    db_session.commit()
    
    success, msg = appoint_delegate(db_session, c.slug, str(u.id), apply=True)
    assert success
    assert "idempotent" in msg

def test_rejected_target_row_is_reused_correctly(db_session):
    c = _create_community(db_session, "reuserej")
    u = _create_user(db_session, "reusereju")
    m = Membership(user_id=u.id, community_id=c.id, status=MembershipStatus.REJECTED, role=MembershipRole.MEMBER, cne="CNE_OLD")
    db_session.add(m)
    db_session.commit()
    
    success, msg = appoint_delegate(db_session, c.slug, str(u.id), cne="CNE_NEW", apply=True)
    assert success
    assert "Reopened" in msg
    db_session.refresh(m)
    assert m.status == MembershipStatus.ACTIVE
    assert m.role == MembershipRole.DELEGATE
    assert m.cne == "CNE_NEW"
    assert db_session.query(Membership).count() == 1

def test_required_cne_validation(db_session):
    c = _create_community(db_session, "nocne")
    u = _create_user(db_session, "nocneu")
    success, msg = appoint_delegate(db_session, c.slug, str(u.id), apply=True)
    assert not success
    assert "valid CNE is required" in msg

def test_unknown_targets_fail_safely(db_session):
    c = _create_community(db_session, "unk")
    u = _create_user(db_session, "unku")
    success, msg = appoint_delegate(db_session, "unk2", str(u.id), apply=True)
    assert not success
    assert "Unknown community slug" in msg

def test_pending_membership_blocks_appointment(db_session):
    c = _create_community(db_session, "pendb")
    u = _create_user(db_session, "pendbu")
    m = Membership(user_id=u.id, community_id=c.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="CNE_P")
    db_session.add(m)
    db_session.commit()
    success, msg = appoint_delegate(db_session, c.slug, str(u.id), apply=True)
    assert not success
    assert "pending membership request" in msg

def test_active_membership_elsewhere_blocks_appointment(db_session):
    c1 = _create_community(db_session, "other")
    c2 = _create_community(db_session, "target")
    u = _create_user(db_session, "otheru")
    m = Membership(user_id=u.id, community_id=c1.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="CNE_O")
    db_session.add(m)
    db_session.commit()
    success, msg = appoint_delegate(db_session, c2.slug, str(u.id), cne="CNE_NEW", apply=True)
    assert not success
    assert "membership in another community" in msg

def test_existing_different_delegate_blocks_appointment(db_session):
    c = _create_community(db_session, "diffdel")
    u1 = _create_user(db_session, "del1")
    u2 = _create_user(db_session, "del2")
    m1 = Membership(user_id=u1.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="CNE_D1")
    db_session.add(m1)
    db_session.commit()
    
    success, msg = appoint_delegate(db_session, c.slug, str(u2.id), cne="CNE_D2", apply=True)
    assert not success
    assert "already has a different active delegate" in msg

def test_unsupported_moderator_promotion(db_session):
    c = _create_community(db_session, "modp")
    u = _create_user(db_session, "modpu")
    m = Membership(user_id=u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR, cne="CNE_M")
    db_session.add(m)
    db_session.commit()
    success, msg = appoint_delegate(db_session, c.slug, str(u.id), apply=True)
    assert not success
    assert "promotion from moderator is currently unsupported" in msg.lower()
