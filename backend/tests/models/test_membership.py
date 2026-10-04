import pytest
from sqlalchemy.exc import IntegrityError
from app.models.community import Community
from app.models.membership import Membership, MembershipStatus, MembershipRole
from app.models.user import User
from app.database import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

@pytest.fixture(scope="module")
def engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db_session(engine):
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()

def test_membership_creation(db_session):
    # test_user and test_community fixtures assumed to exist. If not, we'll create them.
    # Actually, we should just create them manually to avoid fixture dependency issues if they don't exist.
    user = User(
        username="memuser",
        email="mem@example.com",
        password_hash="hash",
        first_name="Mem",
        family_name="User"
    )
    community = Community(
        name="Test Community",
        slug="test-community"
    )
    db_session.add(user)
    db_session.add(community)
    db_session.commit()

    membership = Membership(
        user_id=user.id,
        community_id=community.id,
        cne="123456789"
    )
    db_session.add(membership)
    db_session.commit()

    assert membership.id is not None
    assert membership.status == MembershipStatus.PENDING
    assert membership.role == MembershipRole.MEMBER
    assert membership.cne == "123456789"
    assert membership.user == user
    assert membership.community == community

    # Verify relationships
    assert membership in user.memberships
    assert membership in community.memberships


def test_database_accepts_moderator_role(db_session):
    user = User(username="moduser", email="mod@example.com", password_hash="hash", first_name="Mod", family_name="User")
    community = Community(name="Mod Community", slug="mod-community")
    db_session.add(user)
    db_session.add(community)
    db_session.commit()

    membership = Membership(
        user_id=user.id,
        community_id=community.id,
        cne="999",
        role=MembershipRole.MODERATOR
    )
    db_session.add(membership)
    db_session.commit()

    assert membership.id is not None
    assert membership.role == MembershipRole.MODERATOR


def test_duplicate_membership_rejected(db_session):
    user = User(
        username="dupuser",
        email="dup@example.com",
        password_hash="hash",
        first_name="Dup",
        family_name="User"
    )
    community = Community(
        name="Dup Community",
        slug="dup-community"
    )
    db_session.add(user)
    db_session.add(community)
    db_session.commit()

    m1 = Membership(
        user_id=user.id,
        community_id=community.id,
        cne="111"
    )
    db_session.add(m1)
    db_session.commit()

    m2 = Membership(
        user_id=user.id,
        community_id=community.id,
        cne="222"
    )
    db_session.add(m2)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_cascade_delete_user(db_session):
    user = User(
        username="deluser",
        email="del@example.com",
        password_hash="hash",
        first_name="Del",
        family_name="User"
    )
    community = Community(
        name="Del Community",
        slug="del-community"
    )
    db_session.add(user)
    db_session.add(community)
    db_session.commit()

    membership = Membership(
        user_id=user.id,
        community_id=community.id,
        cne="333"
    )
    db_session.add(membership)
    db_session.commit()
    
    membership_id = membership.id

    db_session.delete(user)
    db_session.commit()

    # Membership should be deleted
    assert db_session.query(Membership).filter_by(id=membership_id).first() is None


def test_cascade_delete_community(db_session):
    user = User(
        username="delcomuser",
        email="delcom@example.com",
        password_hash="hash",
        first_name="Del",
        family_name="User"
    )
    community = Community(
        name="Del Com Community",
        slug="del-com-community"
    )
    db_session.add(user)
    db_session.add(community)
    db_session.commit()

    membership = Membership(
        user_id=user.id,
        community_id=community.id,
        cne="444"
    )
    db_session.add(membership)
    db_session.commit()
    
    membership_id = membership.id

    db_session.delete(community)
    db_session.commit()

    # Membership should be deleted
    assert db_session.query(Membership).filter_by(id=membership_id).first() is None
