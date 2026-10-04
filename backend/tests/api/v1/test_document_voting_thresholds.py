import pytest
from unittest.mock import patch

from datetime import timedelta
from fastapi.testclient import TestClient
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
import uuid
import os
from app.core.storage.local import LocalFileSystemStorage

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
    m = Module(community_id=c.id, name="Module", slug=f"mod-{slug}")
    db.add(m)
    db.commit()
    db.refresh(m)
    return c, m

def _create_membership(db, user, community, status, role):
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=status, role=role)
    db.add(m)
    db.commit()
    return m

def _upload_student_doc(client, community_slug, module_slug, user_token):
    with patch("app.services.preview.create_and_store_preview", return_value="mock_preview_key"):
        res = client.post(
            f"/api/v1/communities/{community_slug}/modules/{module_slug}/documents",
            data={"title": "Test", "type": "COURSE"},
            files={"file": ("test.pdf", b"abc", "application/pdf")},
            cookies={settings.session_cookie_name: user_token}
        )
    return res

# 1. Settings Endpoints
def test_settings_endpoints(client, db_session):
    c, m = _create_community_module(db_session, "settings")
    # Correct default
    assert c.document_vote_threshold == 10
    
    del_u = _create_user(db_session, "del_u")
    del_t = _create_token(db_session, del_u)
    _create_membership(db_session, del_u, c, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    
    mem_u = _create_user(db_session, "mem_u")
    mem_t = _create_token(db_session, mem_u)
    _create_membership(db_session, mem_u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    guest_res = client.get("/api/v1/communities/settings/document-voting/settings")
    assert guest_res.status_code == 401
    
    # Other callers denied
    assert client.get("/api/v1/communities/settings/document-voting/settings", cookies={settings.session_cookie_name: mem_t}).status_code == 403
    assert client.patch("/api/v1/communities/settings/document-voting/settings", json={"required_total_votes": 5}, cookies={settings.session_cookie_name: mem_t}).status_code == 403
    
    # Owning Delegate can read/update
    res = client.get("/api/v1/communities/settings/document-voting/settings", cookies={settings.session_cookie_name: del_t})
    assert res.status_code == 200
    assert res.json()["required_total_votes"] == 10
    assert "private" in res.headers.get("cache-control", "")
    
    # Invalid values and extra fields rejected
    assert client.patch("/api/v1/communities/settings/document-voting/settings", json={"required_total_votes": 0}, cookies={settings.session_cookie_name: del_t}).status_code == 422
    assert client.patch("/api/v1/communities/settings/document-voting/settings", json={"required_total_votes": -5}, cookies={settings.session_cookie_name: del_t}).status_code == 422
    assert client.patch("/api/v1/communities/settings/document-voting/settings", json={"required_total_votes": 1.5}, cookies={settings.session_cookie_name: del_t}).status_code == 422
    assert client.patch("/api/v1/communities/settings/document-voting/settings", json={"required_total_votes": 5, "extra": "field"}, cookies={settings.session_cookie_name: del_t}).status_code == 422
    
    patch_res = client.patch("/api/v1/communities/settings/document-voting/settings", json={"required_total_votes": 5}, cookies={settings.session_cookie_name: del_t})
    assert patch_res.status_code == 200
    assert patch_res.json()["required_total_votes"] == 5
    
    db_session.refresh(c)
    assert c.document_vote_threshold == 5


# 2. Snapshot assignment
def test_snapshot_assignment_and_immutability(client, db_session):
    c, m = _create_community_module(db_session, "snap")
    upl = _create_user(db_session, "u_upl")
    upl_t = _create_token(db_session, upl)
    _create_membership(db_session, upl, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    del_u = _create_user(db_session, "del_snap")
    del_t = _create_token(db_session, del_u)
    _create_membership(db_session, del_u, c, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    
    # New upload captures community threshold
    r1 = _upload_student_doc(client, "snap", "mod-snap", upl_t)
    assert r1.status_code == 201
    d1_id = r1.json()["id"]
    
    doc1 = db_session.query(Document).filter(Document.id == uuid.UUID(d1_id)).first()
    assert doc1.vote_threshold_snapshot == 10
    
    # Delegate updates settings
    client.patch("/api/v1/communities/snap/document-voting/settings", json={"required_total_votes": 3}, cookies={settings.session_cookie_name: del_t})
    
    # Later settings changes do not alter existing snapshot
    db_session.refresh(doc1)
    assert doc1.vote_threshold_snapshot == 10
    
    # A later upload captures changed value
    r2 = _upload_student_doc(client, "snap", "mod-snap", upl_t)
    doc2 = db_session.query(Document).filter(Document.id == uuid.UUID(r2.json()["id"])).first()
    assert doc2.vote_threshold_snapshot == 3
    
    # Official uploads remain approved and outside voting
    with patch("app.services.preview.create_and_store_preview", return_value="mock_preview_key"):
        r_off = client.post(
            f"/api/v1/communities/snap/modules/mod-snap/documents",
            data={"title": "Official", "type": "COURSE", "source": "OFFICIAL"},
            files={"file": ("off.pdf", b"abc", "application/pdf")},
            cookies={settings.session_cookie_name: del_t}
        )
    doc_off = db_session.query(Document).filter(Document.id == uuid.UUID(r_off.json()["id"])).first()
    assert doc_off.status == DocumentStatus.APPROVED


# 3. Algorithm Evaluation
def test_algorithm_evaluation(client, db_session):
    c, m = _create_community_module(db_session, "algo")
    c.document_vote_threshold = 3
    db_session.commit()
    
    upl = _create_user(db_session, "u_upl_algo")
    _create_membership(db_session, upl, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    def _create_voter(prefix):
        u = _create_user(db_session, f"{prefix}_voter")
        t = _create_token(db_session, u)
        _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
        return t, u
        
    v1_t, u1 = _create_voter("1")
    v2_t, u2 = _create_voter("2")
    v3_t, u3 = _create_voter("3")
    v4_t, u4 = _create_voter("4")
    
    # Below quorum remains pending (2 votes, threshold is 3)
    r_below = _upload_student_doc(client, "algo", "mod-algo", _create_token(db_session, upl))
    d_below_id = r_below.json()["id"]
    client.post(f"/api/v1/documents/{d_below_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: v1_t})
    client.post(f"/api/v1/documents/{d_below_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: v2_t})
    assert db_session.query(Document).filter(Document.id == uuid.UUID(d_below_id)).first().status == DocumentStatus.PENDING

    # Quorum + YES majority approves
    r_app = _upload_student_doc(client, "algo", "mod-algo", _create_token(db_session, upl))
    d_app_id = r_app.json()["id"]
    client.post(f"/api/v1/documents/{d_app_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: v1_t})
    client.post(f"/api/v1/documents/{d_app_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: v2_t})
    client.post(f"/api/v1/documents/{d_app_id}/vote", json={"vote": "NO"}, cookies={settings.session_cookie_name: v3_t})
    assert db_session.query(Document).filter(Document.id == uuid.UUID(d_app_id)).first().status == DocumentStatus.APPROVED
    
    # Already-final documents do not change & voting after finalization is blocked
    r_final = client.post(f"/api/v1/documents/{d_app_id}/vote", json={"vote": "NO"}, cookies={settings.session_cookie_name: v4_t})
    assert r_final.status_code == 409
    assert db_session.query(DocumentVote).filter(DocumentVote.document_id == uuid.UUID(d_app_id)).count() == 3

    # Tie at quorum remains pending
    c.document_vote_threshold = 4
    db_session.commit()
    r_tie = _upload_student_doc(client, "algo", "mod-algo", _create_token(db_session, upl))
    d_tie_id = r_tie.json()["id"]
    client.post(f"/api/v1/documents/{d_tie_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: v1_t})
    client.post(f"/api/v1/documents/{d_tie_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: v2_t})
    client.post(f"/api/v1/documents/{d_tie_id}/vote", json={"vote": "NO"}, cookies={settings.session_cookie_name: v3_t})
    client.post(f"/api/v1/documents/{d_tie_id}/vote", json={"vote": "NO"}, cookies={settings.session_cookie_name: v4_t})
    assert db_session.query(Document).filter(Document.id == uuid.UUID(d_tie_id)).first().status == DocumentStatus.PENDING
    
    # A later tie-breaking vote finalizes correctly
    v5_t, u5 = _create_voter("5")
    client.post(f"/api/v1/documents/{d_tie_id}/vote", json={"vote": "NO"}, cookies={settings.session_cookie_name: v5_t})
    assert db_session.query(Document).filter(Document.id == uuid.UUID(d_tie_id)).first().status == DocumentStatus.REJECTED


