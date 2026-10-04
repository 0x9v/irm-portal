import pytest
import uuid
from datetime import timedelta
from fastapi.testclient import TestClient

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.module import Module
from app.models.user import User
from app.models.document import Document, DocumentStatus, DocumentSource, DocumentType
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
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="hash",
        first_name="First",
        family_name="Last"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

def _create_token(db, user):
    raw_token, _ = create_session(db, user.id, timedelta(days=1))
    return raw_token

def _create_community(db, slug):
    community = Community(name=f"Community {slug}", slug=slug)
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

def _create_membership(db, user, community, status, role=MembershipRole.MEMBER):
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=status, role=role)
    db.add(m)
    db.commit()
    return m

def _create_real_document(db, module, uploader, status, title, source=DocumentSource.STUDENT, preview_bytes=b"preview-data"):
    storage = LocalFileSystemStorage()
    # Create original
    storage_key = f"{module.community_id}/{module.id}/{uuid.uuid4()}.pdf"
    storage.save(storage_key, b"original document content")
    
    # Create preview
    doc_id = uuid.uuid4()
    if preview_bytes is not None:
        preview_key = f"{module.community_id}/{module.id}/{doc_id}_preview.png"
        storage.save(preview_key, preview_bytes)
    else:
        preview_key = None

    doc = Document(
        id=doc_id,
        module_id=module.id,
        uploader_id=uploader.id,
        title=title,
        type=DocumentType.COURSE,
        source=source,
        status=status,
        storage_path=storage_key,
        vote_threshold_snapshot=10,
        preview_path=preview_key
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_preview_authentication(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    owner = _create_user(db_session, "owner")
    doc = _create_real_document(db_session, module, owner, DocumentStatus.PENDING, "Doc")
    
    # 1. Guest request -> 401
    assert client.get(f"/api/v1/documents/{doc.id}/preview").status_code == 401
    
    # 2. Registered non-member -> allowed
    user2 = _create_user(db_session, "reg")
    t2 = _create_token(db_session, user2)
    assert client.get(f"/api/v1/documents/{doc.id}/preview", cookies={settings.session_cookie_name: t2}).status_code == 200
    
    # 3. Pending member -> allowed
    user3 = _create_user(db_session, "pend")
    _create_membership(db_session, user3, community, MembershipStatus.PENDING)
    t3 = _create_token(db_session, user3)
    assert client.get(f"/api/v1/documents/{doc.id}/preview", cookies={settings.session_cookie_name: t3}).status_code == 200

    # 4. Active member -> allowed
    user4 = _create_user(db_session, "act")
    _create_membership(db_session, user4, community, MembershipStatus.ACTIVE)
    t4 = _create_token(db_session, user4)
    assert client.get(f"/api/v1/documents/{doc.id}/preview", cookies={settings.session_cookie_name: t4}).status_code == 200


def test_document_states(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "user")
    token = _create_token(db_session, user)

    # 5. PENDING student document returns preview
    doc_pend = _create_real_document(db_session, module, user, DocumentStatus.PENDING, "Pend")
    res_pend = client.get(f"/api/v1/documents/{doc_pend.id}/preview", cookies={settings.session_cookie_name: token})
    assert res_pend.status_code == 200
    assert res_pend.content == b"preview-data"

    # 6. APPROVED official document returns preview
    doc_off = _create_real_document(db_session, module, user, DocumentStatus.APPROVED, "Off", source=DocumentSource.OFFICIAL)
    res_off = client.get(f"/api/v1/documents/{doc_off.id}/preview", cookies={settings.session_cookie_name: token})
    assert res_off.status_code == 200

    # 7. APPROVED student document returns preview
    doc_app = _create_real_document(db_session, module, user, DocumentStatus.APPROVED, "App", source=DocumentSource.STUDENT)
    res_app = client.get(f"/api/v1/documents/{doc_app.id}/preview", cookies={settings.session_cookie_name: token})
    assert res_app.status_code == 200

    # 8. REJECTED document is not exposed
    doc_rej = _create_real_document(db_session, module, user, DocumentStatus.REJECTED, "Rej")
    res_rej = client.get(f"/api/v1/documents/{doc_rej.id}/preview", cookies={settings.session_cookie_name: token})
    assert res_rej.status_code == 404

    # 9. Document with no preview_path is handled predictably
    doc_no_prev = _create_real_document(db_session, module, user, DocumentStatus.PENDING, "NoPrev", preview_bytes=None)
    res_no = client.get(f"/api/v1/documents/{doc_no_prev.id}/preview", cookies={settings.session_cookie_name: token})
    assert res_no.status_code == 404
    assert "No preview available" in res_no.json()["detail"]


def test_security_storage(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "user")
    token = _create_token(db_session, user)
    
    doc = _create_real_document(db_session, module, user, DocumentStatus.PENDING, "Sec", preview_bytes=b"real-preview-bytes")
    
    # 10. Missing preview object is handled predictably
    # Delete the physical preview file
    storage = LocalFileSystemStorage()
    storage.delete(doc.preview_path)
    res_miss = client.get(f"/api/v1/documents/{doc.id}/preview", cookies={settings.session_cookie_name: token})
    assert res_miss.status_code == 404
    assert "missing" in res_miss.json()["detail"].lower()

    # Restore the file to test content
    storage.save(doc.preview_path, b"real-preview-bytes")
    
    # 11. Response contains preview bytes, not original
    res = client.get(f"/api/v1/documents/{doc.id}/preview", cookies={settings.session_cookie_name: token})
    assert res.content == b"real-preview-bytes"
    assert res.content != b"original document content"
    
    # Content type check
    assert res.headers["content-type"] == "image/png"

    # 15. Nonexistent document
    assert client.get(f"/api/v1/documents/{uuid.uuid4()}/preview", cookies={settings.session_cookie_name: token}).status_code == 404
