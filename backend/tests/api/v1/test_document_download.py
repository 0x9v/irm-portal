import pytest
import uuid
import os
from datetime import timedelta
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.sessions import create_session
from app.core.storage.local import LocalFileSystemStorage
from app.main import app
from app.models.community import Community
from app.models.document import Document, DocumentStatus, DocumentSource, DocumentType
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.module import Module
from app.models.user import User

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
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

def _create_user(db, username):
    user = User(username=username, email=f"{username}@example.com", password_hash="hash", first_name="First", family_name="Last")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

def _create_token(db, user):
    raw_token, _ = create_session(db, user.id, timedelta(days=1))
    return raw_token

def _create_community(db, slug):
    community = Community(name=f"Test {slug}", slug=slug)
    db.add(community)
    db.commit()
    db.refresh(community)
    return community

def _create_module(db, community, name, slug):
    module = Module(community_id=community.id, name=name, slug=slug)
    db.add(module)
    db.commit()
    db.refresh(module)
    return module

def _create_membership(db, user, community, status, role):
    membership = Membership(user_id=user.id, community_id=community.id, cne="123", status=status, role=role)
    db.add(membership)
    db.commit()
    return membership

def _create_real_document(db, module, uploader, status, title, content=b"fake data", ext=".pdf"):
    storage = LocalFileSystemStorage()
    unique_filename = f"{uuid.uuid4()}{ext}"
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
        vote_threshold_snapshot=10,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc

def test_unauthenticated_fails(client, db_session):
    c = _create_community(db_session, "irm")
    m = _create_module(db_session, c, "Mod", "mod")
    assert client.get(f"/api/v1/communities/irm/modules/mod/documents/{uuid.uuid4()}/download").status_code == 401


def test_authentication_roles(client, db_session):
    c = _create_community(db_session, "irm")
    m = _create_module(db_session, c, "Mod", "mod")
    user = _create_user(db_session, "owner")
    doc = _create_real_document(db_session, m, user, DocumentStatus.APPROVED, "Title 1")
    
    # 2. Registered non-member
    u_reg = _create_user(db_session, "reg")
    t_reg = _create_token(db_session, u_reg)
    assert client.get(f"/api/v1/communities/irm/modules/mod/documents/{doc.id}/download", cookies={settings.session_cookie_name: t_reg}).status_code == 200

    # 3. Pending member
    u_pend = _create_user(db_session, "pend")
    _create_membership(db_session, u_pend, c, MembershipStatus.PENDING, MembershipRole.MEMBER)
    t_pend = _create_token(db_session, u_pend)
    assert client.get(f"/api/v1/communities/irm/modules/mod/documents/{doc.id}/download", cookies={settings.session_cookie_name: t_pend}).status_code == 200

    # 4, 5, 6. Active Member, Moderator, Delegate
    for role in [MembershipRole.MEMBER, MembershipRole.MODERATOR, MembershipRole.DELEGATE]:
        u_role = _create_user(db_session, f"role_{role}")
        _create_membership(db_session, u_role, c, MembershipStatus.ACTIVE, role)
        t_role = _create_token(db_session, u_role)
        assert client.get(f"/api/v1/communities/irm/modules/mod/documents/{doc.id}/download", cookies={settings.session_cookie_name: t_role}).status_code == 200


def test_visibility_and_missing_file(client, db_session):
    c = _create_community(db_session, "irm")
    m = _create_module(db_session, c, "Mod", "mod")
    user = _create_user(db_session, "owner")
    t = _create_token(db_session, user)

    # 7. APPROVED downloads
    doc_approved = _create_real_document(db_session, m, user, DocumentStatus.APPROVED, "App")
    assert client.get(f"/api/v1/communities/irm/modules/mod/documents/{doc_approved.id}/download", cookies={settings.session_cookie_name: t}).status_code == 200

    # 8. PENDING -> 404
    doc_pending = _create_real_document(db_session, m, user, DocumentStatus.PENDING, "Pend")
    assert client.get(f"/api/v1/communities/irm/modules/mod/documents/{doc_pending.id}/download", cookies={settings.session_cookie_name: t}).status_code == 404

    # 9. REJECTED -> 404
    doc_rejected = _create_real_document(db_session, m, user, DocumentStatus.REJECTED, "Rej")
    assert client.get(f"/api/v1/communities/irm/modules/mod/documents/{doc_rejected.id}/download", cookies={settings.session_cookie_name: t}).status_code == 404

    # 19. Physical file missing safely handled
    storage = LocalFileSystemStorage()
    storage.delete(doc_approved.storage_path)
    res = client.get(f"/api/v1/communities/irm/modules/mod/documents/{doc_approved.id}/download", cookies={settings.session_cookie_name: t})
    assert res.status_code == 404
    assert "missing" in res.json()["detail"].lower()


def test_scoping(client, db_session):
    c1 = _create_community(db_session, "c1")
    c2 = _create_community(db_session, "c2")
    m1 = _create_module(db_session, c1, "M1", "m1")
    m2 = _create_module(db_session, c2, "M2", "m2")
    user = _create_user(db_session, "user")
    token = _create_token(db_session, user)

    doc1 = _create_real_document(db_session, m1, user, DocumentStatus.APPROVED, "Doc 1")
    
    # 10, 11. Unknown community, unknown module
    assert client.get(f"/api/v1/communities/unk/modules/m1/documents/{doc1.id}/download", cookies={settings.session_cookie_name: token}).status_code == 404
    assert client.get(f"/api/v1/communities/c1/modules/unk/documents/{doc1.id}/download", cookies={settings.session_cookie_name: token}).status_code == 404
    
    # 14. Mismatched path
    assert client.get(f"/api/v1/communities/c1/modules/m2/documents/{doc1.id}/download", cookies={settings.session_cookie_name: token}).status_code == 404

    # 12, 13. Document from another community/module accessed through valid path
    assert client.get(f"/api/v1/communities/c2/modules/m2/documents/{doc1.id}/download", cookies={settings.session_cookie_name: token}).status_code == 404


def test_response_correctness(client, db_session):
    c = _create_community(db_session, "irm")
    m = _create_module(db_session, c, "Mod", "mod")
    user = _create_user(db_session, "user")
    token = _create_token(db_session, user)

    content = b"pdf-data-here"
    doc = _create_real_document(db_session, m, user, DocumentStatus.APPROVED, "My Test Doc!!", content=content, ext=".pdf")
    
    res = client.get(f"/api/v1/communities/irm/modules/mod/documents/{doc.id}/download", cookies={settings.session_cookie_name: token})
    assert res.status_code == 200
    
    # 15. Correct Content-Type
    assert res.headers["content-type"] == "application/pdf"
    
    # 16. Content-Disposition present
    assert "content-disposition" in res.headers
    
    # 17. Filename safe (stripped exclamation marks)
    assert "My%20Test%20Doc.pdf" in res.headers["content-disposition"]
    
    # 18. Exact bytes match
    assert res.content == content
