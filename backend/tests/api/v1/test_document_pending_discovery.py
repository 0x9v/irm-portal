import uuid
import pytest
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

def _create_document(db, module, uploader, source, status, created_offset=0):
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

def _cast_vote(db, user, document, vote_value):
    v = DocumentVote(voter_id=user.id, document_id=document.id, vote=vote_value)
    db.add(v)
    db.commit()
    return v

# Authentication and authorization
def test_guest_unauthorized(client):
    res = client.get("/api/v1/communities/some-slug/documents/pending")
    assert res.status_code == 401

def test_unknown_community_receives_404(client, db_session):
    u = _create_user(db_session, "u1")
    t = _create_token(db_session, u)
    res = client.get("/api/v1/communities/unknown/documents/pending", cookies={settings.session_cookie_name: t})
    assert res.status_code == 404

def test_membership_authorization(client, db_session):
    c, m = _create_community_module(db_session, "authz")
    
    # 3. Non-member receives 403
    u_non = _create_user(db_session, "u_non")
    t_non = _create_token(db_session, u_non)
    assert client.get("/api/v1/communities/authz/documents/pending", cookies={settings.session_cookie_name: t_non}).status_code == 403
    
    # 4. PENDING member receives 403
    u_pend = _create_user(db_session, "u_pend")
    t_pend = _create_token(db_session, u_pend)
    _create_membership(db_session, u_pend, c, MembershipStatus.PENDING, MembershipRole.MEMBER)
    assert client.get("/api/v1/communities/authz/documents/pending", cookies={settings.session_cookie_name: t_pend}).status_code == 403
    
    # 5. REJECTED member receives 403
    u_rej = _create_user(db_session, "u_rej")
    t_rej = _create_token(db_session, u_rej)
    _create_membership(db_session, u_rej, c, MembershipStatus.REJECTED, MembershipRole.MEMBER)
    assert client.get("/api/v1/communities/authz/documents/pending", cookies={settings.session_cookie_name: t_rej}).status_code == 403
    
    # 6. ACTIVE membership elsewhere receives 403
    c2, _ = _create_community_module(db_session, "authz2")
    u_other = _create_user(db_session, "u_other")
    t_other = _create_token(db_session, u_other)
    _create_membership(db_session, u_other, c2, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    assert client.get("/api/v1/communities/authz/documents/pending", cookies={settings.session_cookie_name: t_other}).status_code == 403
    
    # 7. ACTIVE Member can list
    u_act = _create_user(db_session, "u_act")
    t_act = _create_token(db_session, u_act)
    _create_membership(db_session, u_act, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    assert client.get("/api/v1/communities/authz/documents/pending", cookies={settings.session_cookie_name: t_act}).status_code == 200

# Selection rules
def test_document_selection_rules(client, db_session):
    c, m1 = _create_community_module(db_session, "sel")
    m2 = Module(community_id=c.id, name="Module2", slug="mod2-sel")
    db_session.add(m2)
    db_session.commit()
    
    c_other, m_other = _create_community_module(db_session, "sel_other")
    upl = _create_user(db_session, "upl_sel")
    
    d_pend1 = _create_document(db_session, m1, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    d_pend2 = _create_document(db_session, m2, upl, DocumentSource.STUDENT, DocumentStatus.PENDING) # multiple modules
    
    d_off = _create_document(db_session, m1, upl, DocumentSource.OFFICIAL, DocumentStatus.PENDING)
    d_app = _create_document(db_session, m1, upl, DocumentSource.STUDENT, DocumentStatus.APPROVED)
    d_rej = _create_document(db_session, m1, upl, DocumentSource.STUDENT, DocumentStatus.REJECTED)
    d_other = _create_document(db_session, m_other, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    
    u = _create_user(db_session, "u_sel")
    t = _create_token(db_session, u)
    _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    res = client.get("/api/v1/communities/sel/documents/pending", cookies={settings.session_cookie_name: t})
    assert res.status_code == 200
    data = res.json()
    
    # 8, 9, 10, 11, 12, 13
    ids = [d["id"] for d in data]
    assert str(d_pend1.id) in ids
    assert str(d_pend2.id) in ids
    assert str(d_off.id) not in ids
    assert str(d_app.id) not in ids
    assert str(d_rej.id) not in ids
    assert str(d_other.id) not in ids
    
    # 15. Ordering created_at, id (Since d_pend1 created before d_pend2, it should be first)
    assert ids[0] == str(d_pend1.id)
    assert ids[1] == str(d_pend2.id)

def test_empty_results_return_200(client, db_session):
    c, m = _create_community_module(db_session, "empty")
    u = _create_user(db_session, "u_empty")
    t = _create_token(db_session, u)
    _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    res = client.get("/api/v1/communities/empty/documents/pending", cookies={settings.session_cookie_name: t})
    # 14. Empty results return 200 with empty list
    assert res.status_code == 200
    assert res.json() == []

# Caller-specific state
def test_caller_specific_state(client, db_session):
    c, m = _create_community_module(db_session, "state")
    upl = _create_user(db_session, "u_upl")
    
    d1 = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    d2 = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    d3 = _create_document(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    
    u = _create_user(db_session, "u_voter")
    t = _create_token(db_session, u)
    mem = _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    _cast_vote(db_session, u, d2, VoteValue.YES)
    _cast_vote(db_session, u, d3, VoteValue.NO)
    
    # Another user's vote shouldn't leak
    u_other = _create_user(db_session, "other")
    _cast_vote(db_session, u_other, d1, VoteValue.YES)
    
    res = client.get("/api/v1/communities/state/documents/pending", cookies={settings.session_cookie_name: t})
    assert res.status_code == 200
    docs = {d["id"]: d for d in res.json()}
    
    # 16. No vote (non-uploader)
    assert docs[str(d1.id)]["my_vote"] is None
    assert docs[str(d1.id)]["can_vote"] is True
    assert docs[str(d1.id)]["full_document_access"] is False
    
    # 17. Caller's YES
    assert docs[str(d2.id)]["my_vote"] == "YES"
    assert docs[str(d2.id)]["can_vote"] is False
    assert docs[str(d2.id)]["full_document_access"] is True
    
    # 18. Caller's NO
    assert docs[str(d3.id)]["my_vote"] == "NO"
    assert docs[str(d3.id)]["can_vote"] is False
    assert docs[str(d3.id)]["full_document_access"] is False
    
    # 20. Own upload
    t_upl = _create_token(db_session, upl)
    _create_membership(db_session, upl, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    res_upl = client.get("/api/v1/communities/state/documents/pending", cookies={settings.session_cookie_name: t_upl})
    docs_upl = {d["id"]: d for d in res_upl.json()}
    assert docs_upl[str(d1.id)]["is_uploader"] is True
    assert docs_upl[str(d1.id)]["can_vote"] is False
    
    # 21. Losing ACTIVE membership blocks entire endpoint
    mem.status = MembershipStatus.PENDING
    db_session.commit()
    assert client.get("/api/v1/communities/state/documents/pending", cookies={settings.session_cookie_name: t}).status_code == 403
    
    # 24. No internal paths or other voters
    assert "storage_path" not in docs[str(d1.id)]
    assert "uploader_id" not in docs[str(d1.id)]
    
    # 25. Private no-store caching
    assert "private" in res.headers.get("cache-control", "")
    assert "no-store" in res.headers.get("cache-control", "")

def test_preview_compatibility(client, db_session):
    c, m = _create_community_module(db_session, "prev")
    upl = _create_user(db_session, "u_prev")
    
    doc = Document(
        module_id=m.id, uploader_id=upl.id, title="Prev Doc",
        type=DocumentType.COURSE, source=DocumentSource.STUDENT, status=DocumentStatus.PENDING,
        storage_path="path", preview_path="some_preview_path", vote_threshold_snapshot=10
    )
    db_session.add(doc)
    db_session.commit()
    
    u = _create_user(db_session, "v_prev")
    t = _create_token(db_session, u)
    _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    res = client.get("/api/v1/communities/prev/documents/pending", cookies={settings.session_cookie_name: t})
    doc_id = res.json()[0]["id"]
    
    # 27. Returned IDs can be used with existing preview endpoint
    # Preview endpoint raises 404 from get_document_preview_bytes when storage file missing
    # We just ensure it doesn't fail auth for pending docs!
    res_prev = client.get(f"/api/v1/documents/{doc_id}/preview", cookies={settings.session_cookie_name: t})
    # Will be 404 because preview file isn't physically there, but we ensure it's not 401 or 403
    assert res_prev.status_code == 404
    assert res_prev.json()["detail"] == "The preview file is missing from storage."

    # 28. A listed eligible document can be voted on
    res_vote = client.post(f"/api/v1/documents/{doc_id}/vote", json={"vote": "YES"}, cookies={settings.session_cookie_name: t})
    assert res_vote.status_code == 201
    
    # 29. After YES, the listed access flag agrees with global download endpoint
    res2 = client.get("/api/v1/communities/prev/documents/pending", cookies={settings.session_cookie_name: t})
    assert res2.json()[0]["full_document_access"] is True
    assert res2.json()[0]["my_vote"] == "YES"

