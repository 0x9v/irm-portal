import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import text
from sqlalchemy.exc import IntegrityError, DBAPIError
from app.models import User, Community, Membership, DocumentVote, Document, Module
from app.models.membership import MembershipStatus, MembershipRole
from app.models.document import DocumentStatus, DocumentType, DocumentSource
from app.models.membership_permission import MembershipPermission, PermissionType
import uuid
import threading
import time

DB_URL = "postgresql+psycopg://irm_test:irm_test@127.0.0.1:5432/irm_integration_test"
engine = create_engine(DB_URL, pool_size=10, max_overflow=20)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture
def db():
    session = SessionLocal()
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

def run_concurrent(fn1, fn2):
    t1 = threading.Thread(target=fn1)
    t2 = threading.Thread(target=fn2)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

# (1) Simultaneous applications to different communities by one user.
# The user cannot be PENDING/ACTIVE in more than one community globally.
def test_concurrent_simultaneous_applications(db):
    u = User(id=uuid.uuid4(), username="u1", email="e1", password_hash="x", first_name="A", family_name="B")
    c1 = Community(id=uuid.uuid4(), name="c1", slug="c1")
    c2 = Community(id=uuid.uuid4(), name="c2", slug="c2")
    db.add_all([u, c1, c2])
    db.commit()

    barrier = threading.Barrier(2)
    
    def app1():
        s = SessionLocal()
        try:
            m = Membership(user_id=u.id, community_id=c1.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="1")
            s.add(m)
            barrier.wait()
            s.commit()
        except Exception:
            s.rollback()
        finally:
            s.close()
            
    def app2():
        s = SessionLocal()
        try:
            m = Membership(user_id=u.id, community_id=c2.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="2")
            s.add(m)
            barrier.wait()
            s.commit()
        except Exception:
            s.rollback()
        finally:
            s.close()

    run_concurrent(app1, app2)
    
    count = db.query(Membership).count()
    assert count == 1, "Only one application should succeed"

# (2) Duplicate votes by one voter
def test_concurrent_duplicate_votes(db):
    c = Community(id=uuid.uuid4(), name="c1", slug="c1")
    u1 = User(id=uuid.uuid4(), username="u1", email="e1", password_hash="x", first_name="A", family_name="B")
    u2 = User(id=uuid.uuid4(), username="u2", email="e2", password_hash="x", first_name="A", family_name="B")
    db.add_all([c, u1, u2])
    db.commit()
    
    mod = Module(id=uuid.uuid4(), community_id=c.id, name="mod", slug="mod")
    db.add(mod)
    db.commit()
    
    doc = Document(id=uuid.uuid4(), module_id=mod.id, uploader_id=u1.id, title="Doc", storage_path="x", status=DocumentStatus.PENDING, vote_threshold_snapshot=2, type=DocumentType.TD, source=DocumentSource.STUDENT)
    db.add(doc)
    db.commit()
    
    barrier = threading.Barrier(2)
    
    def vote1():
        s = SessionLocal()
        try:
            v = DocumentVote(document_id=doc.id, voter_id=u2.id, vote="APPROVE")
            s.add(v)
            barrier.wait()
            s.commit()
        except Exception:
            s.rollback()
        finally:
            s.close()
            
    def vote2():
        s = SessionLocal()
        try:
            v = DocumentVote(document_id=doc.id, voter_id=u2.id, vote="REJECT")
            s.add(v)
            barrier.wait()
            s.commit()
        except Exception:
            s.rollback()
        finally:
            s.close()
            
    run_concurrent(vote1, vote2)
    
    count = db.query(DocumentVote).count()
    assert count == 1, "Only one vote should succeed"

# (3) Two Delegate appointments to the same community
def test_concurrent_delegate_appointments(db):
    c = Community(id=uuid.uuid4(), name="c1", slug="c1")
    u1 = User(id=uuid.uuid4(), username="u1", email="e1", password_hash="x", first_name="A", family_name="B")
    u2 = User(id=uuid.uuid4(), username="u2", email="e2", password_hash="x", first_name="A", family_name="B")
    db.add_all([c, u1, u2])
    db.commit()

    barrier = threading.Barrier(2)
    
    def app1():
        s = SessionLocal()
        try:
            m = Membership(user_id=u1.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="1")
            s.add(m)
            barrier.wait()
            s.commit()
        except Exception:
            s.rollback()
        finally:
            s.close()
            
    def app2():
        s = SessionLocal()
        try:
            m = Membership(user_id=u2.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE, cne="2")
            s.add(m)
            barrier.wait()
            s.commit()
        except Exception:
            s.rollback()
        finally:
            s.close()
            
    run_concurrent(app1, app2)
    
    count = db.query(Membership).filter_by(role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE).count()
    assert count == 1, "Only one delegate should be appointed"
