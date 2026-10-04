import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import text
from fastapi import HTTPException
from app.models import User, Community, Membership, Module, Document, DocumentVote
from app.models.membership import MembershipStatus, MembershipRole
from app.services.membership import approve_membership, reject_membership, withdraw_membership_request, update_moderator_permissions, transition_membership_role
from app.schemas.membership_permission import MembershipPermissionsUpdate
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

def test_concurrent_withdrawal_vs_approval(db):
    c = Community(id=uuid.uuid4(), name="c1", slug="c1")
    u = User(id=uuid.uuid4(), username="u1", email="e1", password_hash="x", first_name="A", family_name="B")
    db.add_all([c, u])
    db.commit()
    
    m = Membership(id=uuid.uuid4(), user_id=u.id, community_id=c.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="1")
    db.add(m)
    db.commit()
    
    m_id_str = str(m.id)
    u_id_str = str(u.id)

    barrier = threading.Barrier(2)
    
    def run_withdrawal():
        s = SessionLocal()
        try:
            u_local = s.query(User).filter_by(id=u.id).first()
            barrier.wait()
            withdraw_membership_request(s, "c1", m_id_str, u_local)
            s.commit()
        except Exception as e:
            s.rollback()
        finally:
            s.close()
            
    def run_approval():
        s = SessionLocal()
        try:
            barrier.wait()
            approve_membership(s, "c1", m_id_str)
            s.commit()
        except Exception as e:
            s.rollback()
        finally:
            s.close()

    t1 = threading.Thread(target=run_withdrawal)
    t2 = threading.Thread(target=run_approval)
    t1.start(); t2.start()
    t1.join(); t2.join()
    
    s_verify = SessionLocal()
    m_final = s_verify.query(Membership).filter_by(id=m.id).first()
    s_verify.close()
    
    assert m_final is None or m_final.status == MembershipStatus.ACTIVE

def test_concurrent_permission_edit_vs_demotion(db):
    c = Community(id=uuid.uuid4(), name="c2", slug="c2")
    u = User(id=uuid.uuid4(), username="u2", email="e2", password_hash="x", first_name="A", family_name="B")
    db.add_all([c, u])
    db.commit()
    
    m = Membership(id=uuid.uuid4(), user_id=u.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR, cne="2")
    db.add(m)
    db.commit()
    
    m_id_str = str(m.id)

    barrier = threading.Barrier(2)
    
    def run_edit():
        s = SessionLocal()
        try:
            barrier.wait()
            update_moderator_permissions(s, "c2", m_id_str, MembershipPermissionsUpdate(create_announcements=True))
            s.commit()
        except Exception as e:
            s.rollback()
        finally:
            s.close()
            
    def run_demotion():
        s = SessionLocal()
        try:
            barrier.wait()
            transition_membership_role(s, "c2", m_id_str, MembershipRole.MEMBER)
            s.commit()
        except Exception as e:
            s.rollback()
        finally:
            s.close()

    t1 = threading.Thread(target=run_edit)
    t2 = threading.Thread(target=run_demotion)
    t1.start(); t2.start()
    t1.join(); t2.join()
    
    s_verify = SessionLocal()
    m_final = s_verify.query(Membership).filter_by(id=m.id).first()
    
    assert m_final.role == MembershipRole.MEMBER
    from app.models.membership_permission import MembershipPermission
    grants = s_verify.query(MembershipPermission).filter_by(membership_id=m.id).count()
    assert grants == 0
    s_verify.close()

def test_concurrent_withdrawal_vs_rejection(db):
    c = Community(id=uuid.uuid4(), name="c3", slug="c3")
    u = User(id=uuid.uuid4(), username="u3", email="e3", password_hash="x", first_name="A", family_name="B")
    db.add_all([c, u])
    db.commit()
    
    m = Membership(id=uuid.uuid4(), user_id=u.id, community_id=c.id, status=MembershipStatus.PENDING, role=MembershipRole.MEMBER, cne="3")
    db.add(m)
    db.commit()
    
    m_id_str = str(m.id)
    barrier = threading.Barrier(2)
    
    def run_withdrawal():
        s = SessionLocal()
        try:
            u_local = s.query(User).filter_by(id=u.id).first()
            barrier.wait()
            withdraw_membership_request(s, "c3", m_id_str, u_local)
            s.commit()
        except Exception:
            s.rollback()
        finally:
            s.close()
            
    def run_rejection():
        s = SessionLocal()
        try:
            barrier.wait()
            reject_membership(s, "c3", m_id_str)
            s.commit()
        except Exception:
            s.rollback()
        finally:
            s.close()

    t1 = threading.Thread(target=run_withdrawal)
    t2 = threading.Thread(target=run_rejection)
    t1.start(); t2.start()
    t1.join(); t2.join()
    
    s_verify = SessionLocal()
    m_final = s_verify.query(Membership).filter_by(id=m.id).first()
    s_verify.close()
    
    # Must never result in ACTIVE, and status must be consistent (None or REJECTED)
    assert m_final is None or m_final.status == MembershipStatus.REJECTED

def test_concurrent_voters_decision_boundary(db):
    from app.services.document_vote import cast_document_vote
    from app.models.document_vote import VoteValue
    from app.models.document import DocumentStatus, DocumentType, DocumentSource

    c = Community(id=uuid.uuid4(), name="c4", slug="c4")
    u_owner = User(id=uuid.uuid4(), username="u_owner", email="e_owner", password_hash="x", first_name="A", family_name="B")
    u_v1 = User(id=uuid.uuid4(), username="u_v1", email="e_v1", password_hash="x", first_name="A", family_name="B")
    u_v2 = User(id=uuid.uuid4(), username="u_v2", email="e_v2", password_hash="x", first_name="A", family_name="B")
    db.add_all([c, u_owner, u_v1, u_v2])
    db.commit()

    m_owner = Membership(user_id=u_owner.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="cne_o")
    m_v1 = Membership(user_id=u_v1.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="cne_1")
    m_v2 = Membership(user_id=u_v2.id, community_id=c.id, status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER, cne="cne_2")
    db.add_all([m_owner, m_v1, m_v2])

    mod = Module(id=uuid.uuid4(), community_id=c.id, name="mod4", slug="mod4")
    db.add(mod)
    db.commit()

    # Threshold snapshot = 2
    doc = Document(
        id=uuid.uuid4(),
        module_id=mod.id,
        uploader_id=u_owner.id,
        title="Doc Decision",
        storage_path="path/doc",
        status=DocumentStatus.PENDING,
        vote_threshold_snapshot=2,
        type=DocumentType.COURSE,
        source=DocumentSource.STUDENT
    )
    db.add(doc)
    db.commit()

    doc_id_str = str(doc.id)
    barrier = threading.Barrier(2)

    def vote_v1():
        s = SessionLocal()
        try:
            u_loc = s.query(User).filter_by(id=u_v1.id).first()
            barrier.wait()
            cast_document_vote(s, doc_id_str, u_loc, VoteValue.YES)
        except Exception:
            s.rollback()
        finally:
            s.close()

    def vote_v2():
        s = SessionLocal()
        try:
            u_loc = s.query(User).filter_by(id=u_v2.id).first()
            barrier.wait()
            cast_document_vote(s, doc_id_str, u_loc, VoteValue.YES)
        except Exception:
            s.rollback()
        finally:
            s.close()

    t1 = threading.Thread(target=vote_v1)
    t2 = threading.Thread(target=vote_v2)
    t1.start(); t2.start()
    t1.join(); t2.join()

    s_verify = SessionLocal()
    doc_final = s_verify.query(Document).filter_by(id=doc.id).first()
    votes_count = s_verify.query(DocumentVote).filter_by(document_id=doc.id).count()
    s_verify.close()

    # Invariants: 2 YES votes reached threshold 2 -> Document is APPROVED
    assert votes_count == 2
    assert doc_final.status == DocumentStatus.APPROVED

