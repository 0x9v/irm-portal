import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import text
import os
from sqlalchemy.exc import IntegrityError
from app.models import User, Community, Membership, DocumentVote, Document, Module
from app.models.membership_permission import MembershipPermission
from app.models.membership import MembershipStatus, MembershipRole
from app.models.membership_permission import PermissionType
import uuid
import datetime

# Ensure we're using the postgres test DB
DB_URL = "postgresql+psycopg://irm_test:irm_test@127.0.0.1:5432/irm_integration_test"

engine = create_engine(DB_URL)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture
def db():
    # Cleanup before test
    session = TestingSessionLocal()
    session.execute(text("TRUNCATE TABLE membership_permissions CASCADE"))
    session.execute(text("TRUNCATE TABLE document_votes CASCADE"))
    session.execute(text("TRUNCATE TABLE documents CASCADE"))
    session.execute(text("TRUNCATE TABLE modules CASCADE"))
    session.execute(text("TRUNCATE TABLE memberships CASCADE"))
    session.execute(text("TRUNCATE TABLE communities CASCADE"))
    session.execute(text("TRUNCATE TABLE users CASCADE"))
    session.commit()
    yield session
    session.close()

def test_global_pending_active_uniqueness(db):
    u = User(id=uuid.uuid4(), username="u1", email="e1", password_hash="x", first_name="A", family_name="B")
    c1 = Community(id=uuid.uuid4(), name="c1", slug="c1")
    c2 = Community(id=uuid.uuid4(), name="c2", slug="c2")
    db.add_all([u, c1, c2])
    db.commit()
    
    m1 = Membership(user_id=u.id, community_id=c1.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="1")
    db.add(m1)
    db.commit()
    
    m2 = Membership(user_id=u.id, community_id=c2.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="2")
    db.add(m2)
    with pytest.raises(IntegrityError):
        db.commit()

def test_user_community_uniqueness(db):
    u = User(id=uuid.uuid4(), username="u1", email="e1", password_hash="x", first_name="A", family_name="B")
    c = Community(id=uuid.uuid4(), name="c1", slug="c1")
    db.add_all([u, c])
    db.commit()
    
    m1 = Membership(user_id=u.id, community_id=c.id, status=MembershipStatus.REJECTED, role=MembershipRole.MEMBER, cne="1")
    db.add(m1)
    db.commit()
    
    m2 = Membership(user_id=u.id, community_id=c.id, status=MembershipStatus.REJECTED, role=MembershipRole.MEMBER, cne="2")
    db.add(m2)
    with pytest.raises(IntegrityError):
        db.commit()

def test_one_active_delegate_per_community(db):
    c = Community(id=uuid.uuid4(), name="c1", slug="c1")
    u1 = User(id=uuid.uuid4(), username="u1", email="e1", password_hash="x", first_name="A", family_name="B")
    u2 = User(id=uuid.uuid4(), username="u2", email="e2", password_hash="x", first_name="A", family_name="B")
    db.add_all([c, u1, u2])
    db.commit()
    
    m1 = Membership(user_id=u1.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="1")
    db.add(m1)
    db.commit()
    
    m2 = Membership(user_id=u2.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="2")
    db.add(m2)
    with pytest.raises(IntegrityError):
        db.commit()

def test_membership_permission_uniqueness(db):
    c = Community(id=uuid.uuid4(), name="c1", slug="c1")
    u = User(id=uuid.uuid4(), username="u1", email="e1", password_hash="x", first_name="A", family_name="B")
    db.add_all([c, u])
    db.commit()
    
    m = Membership(user_id=u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR, cne="1")
    db.add(m)
    db.commit()
    
    p1 = MembershipPermission(membership_id=m.id, permission=PermissionType.CREATE_ANNOUNCEMENTS)
    db.add(p1)
    db.commit()
    
    p2 = MembershipPermission(membership_id=m.id, permission=PermissionType.CREATE_ANNOUNCEMENTS)
    db.add(p2)
    with pytest.raises(IntegrityError):
        db.commit()

def test_document_vote_uniqueness(db):
    c = Community(id=uuid.uuid4(), name="c1", slug="c1")
    u1 = User(id=uuid.uuid4(), username="u1", email="e1", password_hash="x", first_name="A", family_name="B")
    u2 = User(id=uuid.uuid4(), username="u2", email="e2", password_hash="x", first_name="A", family_name="B")
    db.add_all([c, u1, u2])
    db.commit()
    
    m_uploader = Membership(user_id=u1.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="1")
    m_voter = Membership(user_id=u2.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR, cne="2")
    db.add_all([m_uploader, m_voter])
    db.commit()
    
    mod = Module(id=uuid.uuid4(), community_id=c.id, name="mod", slug="mod")
    db.add(mod)
    db.commit()
    
    doc = Document(id=uuid.uuid4(), module_id=mod.id, uploader_id=u1.id, title="Doc", storage_path="x", status="PENDING", vote_threshold_snapshot=2, type="TD", source="STUDENT")
    db.add(doc)
    db.commit()
    
    v1 = DocumentVote(document_id=doc.id, voter_id=u2.id, vote="APPROVE")
    db.add(v1)
    db.commit()
    
    v2 = DocumentVote(document_id=doc.id, voter_id=u2.id, vote="REJECT")
    db.add(v2)
    with pytest.raises(IntegrityError):
        db.commit()
