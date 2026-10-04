import pytest
import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.models.document import Document, DocumentStatus, DocumentSource, DocumentType
from tests.api.v1.test_document_voting import _create_community_module, _create_user, _create_token, _create_membership
from app.models.membership import MembershipRole, MembershipStatus
from app.core.storage.local import LocalFileSystemStorage

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
from app.database.session import get_db

storage = LocalFileSystemStorage()
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
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

def _create_real_document(db, module, uploader, status, title, content=b"fake pdf data"):
    unique_filename = f"{uuid.uuid4()}.pdf"
    storage_key = f"{module.community_id}/{module.id}/{unique_filename}"
    storage.save(storage_key, content)
    doc = Document(
        module_id=module.id,
        uploader_id=uploader.id,
        title=title,
        type=DocumentType.COURSE,
        source=DocumentSource.STUDENT,
        status=status,
        storage_path=storage_key,
        vote_threshold_snapshot=2,
        preview_path=storage_key # mock preview
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc

def _create_voter(db, community, prefix):
    u = _create_user(db, f"flow_{prefix}")
    t = _create_token(db, u)
    _create_membership(db, u, community, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    return t, u

def test_approval_flow(client, db_session):
    c, m = _create_community_module(db_session, "app_flow")
    c.document_vote_threshold = 2
    db_session.commit()
    
    upl_u = _create_user(db_session, "upl_flow_1")
    upl_t = _create_token(db_session, upl_u)
    _create_membership(db_session, upl_u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    doc = _create_real_document(db_session, m, upl_u, DocumentStatus.PENDING, "Approval Flow Doc")
    doc_id = str(doc.id)
    
    v1_t, u1 = _create_voter(db_session, c, "app1")
    v2_t, u2 = _create_voter(db_session, c, "app2")
    
    # Discover pending
    disc_res = client.get("/api/v1/communities/app_flow/documents/pending", cookies={settings.session_cookie_name: v1_t})
    assert disc_res.status_code == 200
    assert any(d["id"] == doc_id for d in disc_res.json())
    
    # Preview
    prev_res = client.get(f"/api/v1/documents/{doc_id}/preview", cookies={settings.session_cookie_name: v1_t})
    assert prev_res.status_code == 200
    
    # Vote 1 (YES)
    r_v1 = client.post(f"/api/v1/documents/{doc_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: v1_t})
    assert r_v1.status_code == 201
    assert r_v1.json()["full_document_access"] is True
    
    # Vote 2 (YES) -> Approves
    r_v2 = client.post(f"/api/v1/documents/{doc_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: v2_t})
    assert r_v2.status_code == 201
    assert r_v2.json()["full_document_access"] is True
    
    # Absent from pending
    disc_res2 = client.get("/api/v1/communities/app_flow/documents/pending", cookies={settings.session_cookie_name: v1_t})
    assert not any(d["id"] == doc_id for d in disc_res2.json())
    
    # Present in approved
    app_res = client.get(f"/api/v1/communities/app_flow/modules/{m.slug}/documents", cookies={settings.session_cookie_name: v1_t})
    assert any(d["id"] == doc_id for d in app_res.json())
    
    # Non-member global download
    no_mem_u = _create_user(db_session, "nomem")
    no_mem_t = _create_token(db_session, no_mem_u)
    gd_res = client.get(f"/api/v1/documents/{doc_id}/download", cookies={settings.session_cookie_name: no_mem_t})
    assert gd_res.status_code == 200
    assert gd_res.content == b"fake pdf data"
    
    # Hierarchical download
    hd_res = client.get(f"/api/v1/communities/app_flow/modules/{m.slug}/documents/{doc_id}/download", cookies={settings.session_cookie_name: no_mem_t})
    assert hd_res.status_code == 200
    assert hd_res.content == b"fake pdf data"

def test_rejection_flow(client, db_session):
    c, m = _create_community_module(db_session, "rej_flow")
    c.document_vote_threshold = 2
    db_session.commit()
    
    upl_u = _create_user(db_session, "upl_flow_2")
    _create_membership(db_session, upl_u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    doc = _create_real_document(db_session, m, upl_u, DocumentStatus.PENDING, "Rej Flow Doc")
    doc_id = str(doc.id)
    
    v1_t, u1 = _create_voter(db_session, c, "rej1")
    v2_t, u2 = _create_voter(db_session, c, "rej2")
    v3_t, u3 = _create_voter(db_session, c, "rej3")
    
    # Vote 1 YES
    r_v1 = client.post(f"/api/v1/documents/{doc_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: v1_t})
    assert r_v1.status_code == 201
    
    # v1 can download
    gd_res1 = client.get(f"/api/v1/documents/{doc_id}/download", cookies={settings.session_cookie_name: v1_t})
    assert gd_res1.status_code == 200
    
    # Votes for Rejection
    client.post(f"/api/v1/documents/{doc_id}/vote", json={"vote": "NO"}, cookies={settings.session_cookie_name: v2_t})
    r_v3 = client.post(f"/api/v1/documents/{doc_id}/vote", json={"vote": "NO"}, cookies={settings.session_cookie_name: v3_t})
    
    assert r_v3.json()["full_document_access"] is False
    
    # v1 can no longer download
    gd_res2 = client.get(f"/api/v1/documents/{doc_id}/download", cookies={settings.session_cookie_name: v1_t})
    assert gd_res2.status_code == 404
    
    # Absent from pending
    disc_res = client.get("/api/v1/communities/rej_flow/documents/pending", cookies={settings.session_cookie_name: v1_t})
    assert not any(d["id"] == doc_id for d in disc_res.json())
    
    # Absent from approved
    app_res = client.get(f"/api/v1/communities/rej_flow/modules/{m.slug}/documents", cookies={settings.session_cookie_name: v1_t})
    assert not any(d["id"] == doc_id for d in app_res.json())

def test_tie_flow(client, db_session):
    c, m = _create_community_module(db_session, "tie_flow")
    c.document_vote_threshold = 2
    db_session.commit()
    
    upl_u = _create_user(db_session, "upl_flow_3")
    _create_membership(db_session, upl_u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    doc = _create_real_document(db_session, m, upl_u, DocumentStatus.PENDING, "Tie Flow Doc")
    doc_id = str(doc.id)
    
    v1_t, u1 = _create_voter(db_session, c, "tie1")
    v2_t, u2 = _create_voter(db_session, c, "tie2")
    
    client.post(f"/api/v1/documents/{doc_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: v1_t})
    client.post(f"/api/v1/documents/{doc_id}/vote", json={"vote": "NO"}, cookies={settings.session_cookie_name: v2_t})
    
    # Stays PENDING
    db_session.refresh(doc)
    assert doc.status == DocumentStatus.PENDING
    
    # Tie breaking vote
    v3_t, u3 = _create_voter(db_session, c, "tie3")
    r_v3 = client.post(f"/api/v1/documents/{doc_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: v3_t})
    assert r_v3.status_code == 201
    assert r_v3.json()["full_document_access"] is True
    
    db_session.refresh(doc)
    assert doc.status == DocumentStatus.APPROVED

