import uuid
import pytest
from datetime import timedelta
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base
from app.database.session import get_db
from app.core.config import settings
from app.core.sessions import create_session
from app.models.community import Community
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.document_vote import DocumentVote, VoteValue
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.module import Module
from app.models.user import User
from app.services.document_vote import check_full_document_access, _handle_vote_integrity_error
from fastapi import HTTPException

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
    u = User(username=username, email=f"{username}@example.com", password_hash="hash", first_name="A", family_name="B")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u

def _create_token(db, user):
    token, _ = create_session(db, user.id, timedelta(days=1))
    return token

def _create_community_module(db, slug):
    c = Community(name="Test", slug=slug)
    db.add(c)
    db.commit()
    db.refresh(c)
    m = Module(community_id=c.id, name="Module", slug=slug)
    db.add(m)
    db.commit()
    db.refresh(m)
    return c, m

def _create_membership(db, user, community, status, role):
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=status, role=role)
    db.add(m)
    db.commit()

def _create_document(db, module, uploader, source, status):
    d = Document(
        module_id=module.id,
        uploader_id=uploader.id,
        title="Doc",
        type=DocumentType.COURSE,
        source=source,
        status=status,
        storage_path="path/to/file",
        preview_path="path/to/preview",
        vote_threshold_snapshot=10
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return d

def test_unauthenticated_guest_receives_401(client):
    res = client.post("/api/v1/documents/123/vote", json={"vote": "YES"})
    assert res.status_code == 401

def test_unknown_document_receives_404(client, db_session):
    u = _create_user(db_session, "u1")
    t = _create_token(db_session, u)
    res = client.post(f"/api/v1/documents/{uuid.uuid4()}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: t})
    assert res.status_code == 404

def test_community_authorization_rules(client, db_session):
    c_own, m_own = _create_community_module(db_session, "own")
    c_other, _ = _create_community_module(db_session, "other")
    
    uploader = _create_user(db_session, "upl")
    doc = _create_document(db_session, m_own, uploader, DocumentSource.STUDENT, DocumentStatus.PENDING)
    
    def try_vote(user):
        t = _create_token(db_session, user)
        return client.post(f"/api/v1/documents/{doc.id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: t})
        
    # 3. Non-member receives 403
    u_non = _create_user(db_session, "non")
    assert try_vote(u_non).status_code == 403
    
    # 4. PENDING member receives 403
    u_pend = _create_user(db_session, "pend")
    _create_membership(db_session, u_pend, c_own, MembershipStatus.PENDING, MembershipRole.MEMBER)
    assert try_vote(u_pend).status_code == 403
    
    # 5. REJECTED member receives 403
    u_rej = _create_user(db_session, "rej")
    _create_membership(db_session, u_rej, c_own, MembershipStatus.REJECTED, MembershipRole.MEMBER)
    assert try_vote(u_rej).status_code == 403
    
    # 6. ACTIVE member of another community receives 403
    u_other = _create_user(db_session, "other")
    _create_membership(db_session, u_other, c_other, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    assert try_vote(u_other).status_code == 403
    
    # 7. ACTIVE member of owning community can vote
    u_act = _create_user(db_session, "act")
    _create_membership(db_session, u_act, c_own, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    assert try_vote(u_act).status_code == 201
    
    # 8. ACTIVE Moderator/Delegate can vote
    u_mod = _create_user(db_session, "mod")
    _create_membership(db_session, u_mod, c_own, MembershipStatus.ACTIVE, MembershipRole.MODERATOR)
    assert try_vote(u_mod).status_code == 201
    
    u_del = _create_user(db_session, "del")
    _create_membership(db_session, u_del, c_own, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    assert try_vote(u_del).status_code == 201

def test_document_eligibility(client, db_session):
    c, m = _create_community_module(db_session, "elig")
    upl = _create_user(db_session, "upl2")
    u = _create_user(db_session, "voter2")
    t = _create_token(db_session, u)
    _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    def vote(doc_id):
        return client.post(f"/api/v1/documents/{doc_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: t})
        
    # 9. PENDING STUDENT accepts vote
    d1 = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    assert vote(d1.id).status_code == 201
    
    # 10. OFFICIAL rejects voting (409)
    d2 = _create_document(db_session, m, upl, DocumentSource.OFFICIAL, DocumentStatus.PENDING)
    assert vote(d2.id).status_code == 409
    
    # 11. APPROVED rejects voting
    d3 = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.APPROVED)
    assert vote(d3.id).status_code == 409
    
    # 12. REJECTED rejects voting
    d4 = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.REJECTED)
    assert vote(d4.id).status_code == 409

def test_uploader_cannot_vote(client, db_session):
    # 13. Uploader cannot vote
    c, m = _create_community_module(db_session, "upl")
    upl = _create_user(db_session, "upl3")
    t = _create_token(db_session, upl)
    _create_membership(db_session, upl, c, MembershipStatus.ACTIVE, MembershipRole.DELEGATE) # Even privileged!
    
    doc = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    res = client.post(f"/api/v1/documents/{doc.id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: t})
    assert res.status_code == 403
    assert "uploaders" in res.json()["detail"].lower()
    assert db_session.query(DocumentVote).count() == 0

def test_persistence_and_immutability(client, db_session):
    c, m = _create_community_module(db_session, "pers")
    upl = _create_user(db_session, "upl4")
    d1 = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    d2 = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    
    u = _create_user(db_session, "v1")
    t = _create_token(db_session, u)
    _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    # 14. YES persists
    r1 = client.post(f"/api/v1/documents/{d1.id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: t})
    assert r1.status_code == 201
    v = db_session.query(DocumentVote).filter_by(document_id=d1.id).first()
    assert v.voter_id == u.id
    assert v.vote == VoteValue.YES
    
    # 15. NO persists
    r2 = client.post(f"/api/v1/documents/{d2.id}/vote", json={"vote": "NO"}, cookies={settings.session_cookie_name: t})
    assert r2.status_code == 201
    
    # 16. Duplicate YES receives 409
    r3 = client.post(f"/api/v1/documents/{d1.id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: t})
    assert r3.status_code == 409
    
    # 17. YES -> NO attempt 409
    r4 = client.post(f"/api/v1/documents/{d1.id}/vote", json={"vote": "NO"}, cookies={settings.session_cookie_name: t})
    assert r4.status_code == 409
    db_session.refresh(v)
    assert v.vote == VoteValue.YES
    
    # 18. NO -> YES attempt 409
    v2 = db_session.query(DocumentVote).filter_by(document_id=d2.id).first()
    r5 = client.post(f"/api/v1/documents/{d2.id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: t})
    assert r5.status_code == 409
    db_session.refresh(v2)
    assert v2.vote == VoteValue.NO
    
    # 19. Different eligible user can vote on d1
    u2 = _create_user(db_session, "v2")
    t2 = _create_token(db_session, u2)
    _create_membership(db_session, u2, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    r6 = client.post(f"/api/v1/documents/{d1.id}/vote", json={"vote": "NO"}, cookies={settings.session_cookie_name: t2})
    assert r6.status_code == 201
    
    # 20. Document source/status remain unchanged
    db_session.refresh(d1)
    assert d1.source == DocumentSource.STUDENT
    assert d1.status == DocumentStatus.PENDING

def test_access_decision(db_session):
    c, m = _create_community_module(db_session, "acc")
    upl = _create_user(db_session, "upla")
    u = _create_user(db_session, "v3")
    
    # Helper to check
    def can_access(doc):
        return check_full_document_access(db_session, doc, u)
        
    doc_pend_stud = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    
    # 25. No vote denies access
    _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    assert not can_access(doc_pend_stud)
    
    # 24. Caller's NO denies access
    v_no = DocumentVote(document_id=doc_pend_stud.id, voter_id=u.id, vote=VoteValue.NO)
    db_session.add(v_no)
    db_session.commit()
    assert not can_access(doc_pend_stud)
    
    # Switch NO to YES just for testing access directly (though API blocks it, we force DB)
    v_no.vote = VoteValue.YES
    db_session.commit()
    
    # 23. Caller's YES grants access while ACTIVE
    assert can_access(doc_pend_stud)
    
    # 27. Losing ACTIVE membership removes access
    mem = db_session.query(Membership).filter_by(user_id=u.id).first()
    mem.status = MembershipStatus.PENDING
    db_session.commit()
    assert not can_access(doc_pend_stud)
    mem.status = MembershipStatus.ACTIVE
    db_session.commit()
    
    # 26. Another person's YES denies access
    u_other = _create_user(db_session, "other2")
    _create_membership(db_session, u_other, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    assert not check_full_document_access(db_session, doc_pend_stud, u_other) # They have no vote
    
    # 28. REJECTED status denies access despite YES
    doc_pend_stud.status = DocumentStatus.REJECTED
    db_session.commit()
    assert not can_access(doc_pend_stud)
    
    # 29. PENDING OFFICIAL denies access
    doc_off = _create_document(db_session, m, upl, DocumentSource.OFFICIAL, DocumentStatus.PENDING)
    assert not can_access(doc_off)
    
    # 30. APPROVED document allows any visitor
    doc_app = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.APPROVED)
    assert can_access(doc_app)
    assert check_full_document_access(db_session, doc_app, u_other)

def test_request_validation(client, db_session):
    c, m = _create_community_module(db_session, "req")
    upl = _create_user(db_session, "u5")
    u = _create_user(db_session, "u6")
    t = _create_token(db_session, u)
    _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    d = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    
    def try_payload(payload):
        return client.post(f"/api/v1/documents/{d.id}/vote", json=payload, cookies={settings.session_cookie_name: t})
        
    # 32. Invalid vote value 422
    assert try_payload({"vote": "MAYBE"}).status_code == 422
    # 33. Missing vote
    assert try_payload({}).status_code == 422
    # 34. Extra fields 422
    assert try_payload({"vote": "YES", "user_id": str(u.id)}).status_code == 422
    assert try_payload({"vote": "YES", "status": "APPROVED"}).status_code == 422

def test_vote_response_fields(client, db_session):
    c, m = _create_community_module(db_session, "resp")
    upl = _create_user(db_session, "u7")
    u = _create_user(db_session, "u8")
    t = _create_token(db_session, u)
    _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    d = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    
    res = client.post(f"/api/v1/documents/{d.id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: t})
    data = res.json()
    assert list(data.keys()) == ["vote", "full_document_access"]
    assert data["vote"] == "YES"
    assert data["full_document_access"] is True


def test_integrity_error_classifier():
    # 21 & 22: Unrelated integrity failures are not mislabeled as duplicate votes
    class MockOrig:
        def __init__(self, s):
            self.s = s
        def __str__(self):
            return self.s
            
    # Mocking SQLite failure correctly translated
    try:
        _handle_vote_integrity_error(IntegrityError("", "", MockOrig("UNIQUE constraint failed: document_votes.document_id, document_votes.voter_id")))
        assert False
    except HTTPException as e:
        assert e.status_code == 409
        
    # Unrelated failure raised natively
    try:
        _handle_vote_integrity_error(IntegrityError("", "", MockOrig("FOREIGN KEY constraint failed")))
        assert False
    except IntegrityError:
        assert True

