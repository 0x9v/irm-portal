import uuid
import pytest
import os
from datetime import timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base
from app.database.session import get_db

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

import uuid
import pytest
import os
from datetime import timedelta
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.sessions import create_session
from app.core.storage.local import LocalFileSystemStorage
storage = LocalFileSystemStorage()
from app.models.community import Community
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.document_vote import DocumentVote, VoteValue
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.module import Module
from app.models.user import User


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

def _create_document_with_file(db, module, uploader, source, status, filename="test.pdf", content=b"ORIGINAL_BYTES"):
    # Generate a unique physical path in local storage
    relative_path = f"modules/{module.id}/{uuid.uuid4()}/{filename}"
    
    storage.save(relative_path, content)
        
    d = Document(
        module_id=module.id,
        uploader_id=uploader.id,
        title="Doc",
        type=DocumentType.COURSE,
        source=source,
        status=status,
        storage_path=relative_path,
        vote_threshold_snapshot=10,
        preview_path="preview.png"
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


# 1. Guest receives 401
def test_guest_unauthorized(client):
    res = client.get(f"/api/v1/documents/{uuid.uuid4()}/download")
    assert res.status_code == 401


# 2. Unknown document receives 404
def test_unknown_document_receives_404(client, db_session):
    u = _create_user(db_session, "g_u1")
    t = _create_token(db_session, u)
    res = client.get(f"/api/v1/documents/{uuid.uuid4()}/download", cookies={settings.session_cookie_name: t})
    assert res.status_code == 404
    assert res.json()["detail"] == "Document not found."


# 3. Inaccessible documents receive 404 without metadata leakage
def test_inaccessible_document_is_404(client, db_session):
    c, m = _create_community_module(db_session, "g_inacc")
    upl = _create_user(db_session, "g_upl")
    u = _create_user(db_session, "g_u2")
    t = _create_token(db_session, u)
    doc = _create_document_with_file(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    
    res = client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t})
    assert res.status_code == 404
    assert res.json()["detail"] == "Document not found."


# 4 & 5. Approved documents downloadable by any authenticated user
def test_approved_document_downloadable_globally(client, db_session):
    c, m = _create_community_module(db_session, "g_app")
    upl = _create_user(db_session, "g_upl2")
    
    doc = _create_document_with_file(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.APPROVED, "approved.pdf", b"APP_CONTENT")
    
    # 4. Authenticated non-member
    u = _create_user(db_session, "g_non_mem")
    t = _create_token(db_session, u)
    res = client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t})
    assert res.status_code == 200
    # 6. Response body matches the original file bytes
    assert res.content == b"APP_CONTENT"
    
    # 5. Member of another community
    c_other, _ = _create_community_module(db_session, "g_other")
    _create_membership(db_session, u, c_other, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    res2 = client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t})
    assert res2.status_code == 200


# Pending Student Documents
def test_pending_student_document_download_rules(client, db_session):
    c, m = _create_community_module(db_session, "g_pend")
    upl = _create_user(db_session, "g_upl3")
    doc = _create_document_with_file(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING, "secret.pdf", b"SECRET")
    
    def try_download(user):
        t = _create_token(db_session, user)
        return client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t})

    # 9. Member without a vote cannot download
    u_novote = _create_user(db_session, "novote")
    _create_membership(db_session, u_novote, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    assert try_download(u_novote).status_code == 404
    
    # 8. NO voter cannot download
    u_no = _create_user(db_session, "no_voter")
    _create_membership(db_session, u_no, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    _cast_vote(db_session, u_no, doc, VoteValue.NO)
    assert try_download(u_no).status_code == 404
    
    # 7. ACTIVE member with their own YES vote can download
    u_yes = _create_user(db_session, "yes_voter")
    mem_yes = _create_membership(db_session, u_yes, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    _cast_vote(db_session, u_yes, doc, VoteValue.YES)
    res = try_download(u_yes)
    assert res.status_code == 200
    assert res.content == b"SECRET"
    
    # 10. Another user's YES does not grant access
    assert try_download(u_novote).status_code == 404
    
    # 11. User whose membership is no longer ACTIVE cannot download
    mem_yes.status = MembershipStatus.PENDING
    db_session.commit()
    assert try_download(u_yes).status_code == 404
    
    # 12. Pending/rejected membership cannot authorize download
    u_pend = _create_user(db_session, "pend_voter")
    _create_membership(db_session, u_pend, c, MembershipStatus.REJECTED, MembershipRole.MEMBER)
    _cast_vote(db_session, u_pend, doc, VoteValue.YES) # Note: DB doesn't block this manually, just for test
    assert try_download(u_pend).status_code == 404
    
    # 13. Membership in another community cannot authorize download
    c2, _ = _create_community_module(db_session, "g_pend2")
    u_other = _create_user(db_session, "other_com_voter")
    _create_membership(db_session, u_other, c2, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    _cast_vote(db_session, u_other, doc, VoteValue.YES)
    assert try_download(u_other).status_code == 404
    
    # 14. Uploader has no implicit bypass
    assert try_download(upl).status_code == 404
    
    # 15. Delegate/Moderator role alone has no implicit bypass
    u_del = _create_user(db_session, "del_no_vote")
    _create_membership(db_session, u_del, c, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    assert try_download(u_del).status_code == 404


def test_document_state_mutations(client, db_session):
    c, m = _create_community_module(db_session, "g_state")
    upl = _create_user(db_session, "g_upl4")
    u = _create_user(db_session, "u_state")
    t = _create_token(db_session, u)
    _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    doc = _create_document_with_file(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING)
    _cast_vote(db_session, u, doc, VoteValue.YES)
    
    # Baseline access
    assert client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t}).status_code == 200
    
    # 16. REJECTED document denies access despite an earlier YES
    doc.status = DocumentStatus.REJECTED
    db_session.commit()
    assert client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t}).status_code == 404
    
    # 17. PENDING OFFICIAL denies access
    doc.status = DocumentStatus.PENDING
    doc.source = DocumentSource.OFFICIAL
    db_session.commit()
    assert client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t}).status_code == 404
    
    # 18 & 19. Changing to APPROVED permits, changing to REJECTED blocks
    doc.source = DocumentSource.STUDENT
    doc.status = DocumentStatus.APPROVED
    db_session.commit()
    
    u2 = _create_user(db_session, "u2_visitor")
    t2 = _create_token(db_session, u2)
    assert client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t2}).status_code == 200
    
    doc.status = DocumentStatus.REJECTED
    db_session.commit()
    assert client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t2}).status_code == 404


def test_storage_and_response_headers(client, db_session):
    c, m = _create_community_module(db_session, "g_stor")
    upl = _create_user(db_session, "g_upl5")
    doc = _create_document_with_file(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.APPROVED, "My Crazy File!.pdf", b"BYTES")
    
    u = _create_user(db_session, "g_u_stor")
    t = _create_token(db_session, u)
    
    res = client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t})
    assert res.status_code == 200
    # 20. Original bytes are served
    assert res.content == b"BYTES"
    # 23. Filename sanitation
    assert "filename=\"Doc.pdf\"" in res.headers.get("content-disposition", "")
    # 24. Internal storage paths do not appear
    assert str(doc.storage_path) not in str(res.headers)
    # 25. Successful response has private, no-store caching
    assert "private" in res.headers.get("cache-control", "")
    assert "no-store" in res.headers.get("cache-control", "")
    
    # 26. Requests do not modify document status, source, votes, or memberships
    db_session.refresh(doc)
    assert doc.status == DocumentStatus.APPROVED


def test_missing_file_behavior(client, db_session):
    c, m = _create_community_module(db_session, "g_miss")
    upl = _create_user(db_session, "g_upl6")
    doc = _create_document_with_file(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.APPROVED)
    
    # Remove the physical file
    storage.delete(doc.storage_path)
    
    u = _create_user(db_session, "g_u_miss")
    t = _create_token(db_session, u)
    
    # 21. Authorized missing-file response is safe
    res = client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t})
    assert res.status_code == 404
    assert "missing" in res.json()["detail"].lower()
    
    # 22. Unauthorized missing-file requests do not reveal storage state
    doc.status = DocumentStatus.PENDING
    db_session.commit()
    res2 = client.get(f"/api/v1/documents/{doc.id}/download", cookies={settings.session_cookie_name: t})
    assert res2.status_code == 404
    assert res2.json()["detail"] == "Document not found."


def test_existing_contracts_remain_intact(client, db_session):
    c, m = _create_community_module(db_session, "g_exist")
    upl = _create_user(db_session, "g_upl7")
    d_app = _create_document_with_file(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.APPROVED, content=b"1")
    d_pend = _create_document_with_file(db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING, content=b"2")
    
    u = _create_user(db_session, "g_u_exist")
    t = _create_token(db_session, u)
    
    # 27. Existing community/module listing hides pending
    res_list = client.get(f"/api/v1/communities/g_exist/modules/mod-g_exist/documents", cookies={settings.session_cookie_name: t})
    assert res_list.status_code == 200
    ids = [d["id"] for d in res_list.json()]
    assert str(d_app.id) in ids
    assert str(d_pend.id) not in ids
    
    # 28. Existing detail endpoint retains approved-only visibility
    assert client.get(f"/api/v1/communities/g_exist/modules/mod-g_exist/documents/{d_app.id}", cookies={settings.session_cookie_name: t}).status_code == 200
    assert client.get(f"/api/v1/communities/g_exist/modules/mod-g_exist/documents/{d_pend.id}", cookies={settings.session_cookie_name: t}).status_code == 404
    
    # 29. Existing hierarchical download retains approved-only behavior
    assert client.get(f"/api/v1/communities/g_exist/modules/mod-g_exist/documents/{d_app.id}/download", cookies={settings.session_cookie_name: t}).status_code == 200
    assert client.get(f"/api/v1/communities/g_exist/modules/mod-g_exist/documents/{d_pend.id}/download", cookies={settings.session_cookie_name: t}).status_code == 404

    # 30. Existing cross-community scoping checks remain intact
    c2, m2 = _create_community_module(db_session, "g_exist2")
    # Trying to fetch d_app through m2 should 404 in hierarchical route
    assert client.get(f"/api/v1/communities/g_exist2/modules/mod-g_exist2/documents/{d_app.id}", cookies={settings.session_cookie_name: t}).status_code == 404

