import pytest
import uuid
from datetime import timedelta
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.sessions import create_session
from app.main import app
from app.models.community import Community
from app.models.document import Document, DocumentStatus, DocumentSource, DocumentType
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.module import Module
from app.models.user import User

# Using the same test setup infrastructure as test_documents.py (which uses get_db override if we just import client)
# Actually, since test_documents.py uses a local `client` fixture, I should define one here or just use the global one if it exists.
# Let's write the fixtures here to be safe and independent.

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

def _create_document(db, module, uploader, status, title="Doc"):
    doc = Document(
        module_id=module.id,
        uploader_id=uploader.id,
        title=title,
        type=DocumentType.COURSE,
        source=DocumentSource.STUDENT,
        status=status,
        storage_path=f"fake/{uuid.uuid4()}", vote_threshold_snapshot=10
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_unauthenticated_fails(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    
    # 1. Unauthenticated list -> 401
    assert client.get("/api/v1/communities/irm/modules/mod/documents").status_code == 401
    
    # 2. Unauthenticated detail -> 401
    assert client.get(f"/api/v1/communities/irm/modules/mod/documents/{uuid.uuid4()}").status_code == 401


def test_registered_non_member_can_list(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "user1")
    doc = _create_document(db_session, module, user, DocumentStatus.APPROVED, "Title 1")
    token = _create_token(db_session, user)

    # 3. Registered non-member can list
    res = client.get("/api/v1/communities/irm/modules/mod/documents", cookies={settings.session_cookie_name: token})
    assert res.status_code == 200
    assert len(res.json()) == 1
    
    # 8. Approved document appears
    assert res.json()[0]["id"] == str(doc.id)


def test_pending_member_can_list(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "user2")
    _create_membership(db_session, user, community, MembershipStatus.PENDING, MembershipRole.MEMBER)
    token = _create_token(db_session, user)

    # 4. Pending member can list
    res = client.get("/api/v1/communities/irm/modules/mod/documents", cookies={settings.session_cookie_name: token})
    assert res.status_code == 200


def test_active_roles_can_list(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    
    for role, name in [(MembershipRole.MEMBER, "member"), (MembershipRole.MODERATOR, "mod"), (MembershipRole.DELEGATE, "del")]:
        user = _create_user(db_session, name)
        _create_membership(db_session, user, community, MembershipStatus.ACTIVE, role)
        token = _create_token(db_session, user)
        # 5, 6, 7. Active member, moderator, delegate can list
        assert client.get("/api/v1/communities/irm/modules/mod/documents", cookies={settings.session_cookie_name: token}).status_code == 200


def test_visibility_rules(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "user")
    token = _create_token(db_session, user)

    doc_approved = _create_document(db_session, module, user, DocumentStatus.APPROVED, "Approved Doc")
    doc_pending = _create_document(db_session, module, user, DocumentStatus.PENDING, "Pending Doc")
    doc_rejected = _create_document(db_session, module, user, DocumentStatus.REJECTED, "Rejected Doc")

    res = client.get("/api/v1/communities/irm/modules/mod/documents", cookies={settings.session_cookie_name: token})
    assert res.status_code == 200
    docs = res.json()
    assert len(docs) == 1
    assert docs[0]["id"] == str(doc_approved.id)
    # 9, 10. Pending and Rejected hidden from list
    titles = [d["title"] for d in docs]
    assert "Approved Doc" in titles
    assert "Pending Doc" not in titles
    assert "Rejected Doc" not in titles

    # Detail checks
    assert client.get(f"/api/v1/communities/irm/modules/mod/documents/{doc_approved.id}", cookies={settings.session_cookie_name: token}).status_code == 200
    # 11, 12. Pending and Rejected detail -> 404
    assert client.get(f"/api/v1/communities/irm/modules/mod/documents/{doc_pending.id}", cookies={settings.session_cookie_name: token}).status_code == 404
    assert client.get(f"/api/v1/communities/irm/modules/mod/documents/{doc_rejected.id}", cookies={settings.session_cookie_name: token}).status_code == 404


def test_scoping_rules(client, db_session):
    c1 = _create_community(db_session, "c1")
    c2 = _create_community(db_session, "c2")
    m1 = _create_module(db_session, c1, "M1", "m1")
    m2 = _create_module(db_session, c2, "M2", "m2")
    user = _create_user(db_session, "user")
    token = _create_token(db_session, user)

    doc1 = _create_document(db_session, m1, user, DocumentStatus.APPROVED, "Doc 1")
    
    # 13, 14. Unknown community, unknown module -> 404
    assert client.get("/api/v1/communities/unknown/modules/m1/documents", cookies={settings.session_cookie_name: token}).status_code == 404
    assert client.get("/api/v1/communities/c1/modules/unknown/documents", cookies={settings.session_cookie_name: token}).status_code == 404
    
    # 15. Wrong community/module path (m2 doesn't belong to c1)
    assert client.get("/api/v1/communities/c1/modules/m2/documents", cookies={settings.session_cookie_name: token}).status_code == 404

    # 16. Cross-community document access -> 404 (doc1 in m1/c1 accessed via c2/m2)
    assert client.get(f"/api/v1/communities/c2/modules/m2/documents/{doc1.id}", cookies={settings.session_cookie_name: token}).status_code == 404


def test_safe_metadata_and_ordering(client, db_session):
    import time
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "user")
    token = _create_token(db_session, user)

    doc1 = _create_document(db_session, module, user, DocumentStatus.APPROVED, "Older")
    time.sleep(0.01) # ensure order
    doc2 = _create_document(db_session, module, user, DocumentStatus.APPROVED, "Newer")

    res = client.get("/api/v1/communities/irm/modules/mod/documents", cookies={settings.session_cookie_name: token})
    assert res.status_code == 200
    docs = res.json()
    assert len(docs) == 2
    
    # 19. Results are newest-first (descending by created_at)
    assert docs[0]["id"] == str(doc2.id)
    assert docs[1]["id"] == str(doc1.id)

    # 17. Only safe metadata is returned, 18. storage_path is not exposed
    safe_keys = {"id", "module_id", "uploader_id", "title", "type", "source", "status", "created_at", "updated_at"}
    for doc in docs:
        assert set(doc.keys()) == safe_keys
        assert "storage_path" not in doc
