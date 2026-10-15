import pytest
import uuid
from datetime import datetime, timedelta, timezone
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

def _create_document(db, module, uploader, status, title="Doc", doc_type=DocumentType.COURSE, source=DocumentSource.STUDENT):
    doc = Document(
        module_id=module.id,
        uploader_id=uploader.id,
        title=title,
        type=doc_type,
        source=source,
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


def test_document_search_is_case_insensitive_literal_and_trimmed(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "search-user")
    token = _create_token(db_session, user)
    literal = _create_document(db_session, module, user, DocumentStatus.APPROVED, "Algebra %_ Notes")
    _create_document(db_session, module, user, DocumentStatus.APPROVED, "Algebra 99 Notes")
    _create_document(db_session, module, user, DocumentStatus.APPROVED, "Private Algebra %_",)
    hidden = db_session.query(Document).filter(Document.title == "Private Algebra %_").one()
    hidden.status = DocumentStatus.PENDING
    db_session.commit()

    url = "/api/v1/communities/irm/modules/mod/documents"
    exact_literal = client.get(url, params={"q": "  %_  "}, cookies={settings.session_cookie_name: token})
    assert exact_literal.status_code == 200
    assert [item["id"] for item in exact_literal.json()] == [str(literal.id)]

    insensitive = client.get(url, params={"q": "  algebra  "}, cookies={settings.session_cookie_name: token})
    assert insensitive.status_code == 200
    assert len(insensitive.json()) == 2

    whitespace = client.get(url, params={"q": "   "}, cookies={settings.session_cookie_name: token})
    assert whitespace.status_code == 200
    assert len(whitespace.json()) == 2


def test_document_search_treats_backslash_as_literal(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "backslash-search-user")
    token = _create_token(db_session, user)
    literal = _create_document(db_session, module, user, DocumentStatus.APPROVED, r"Matrix\Archive")
    _create_document(db_session, module, user, DocumentStatus.APPROVED, "MatrixArchive")

    response = client.get(
        "/api/v1/communities/irm/modules/mod/documents",
        params={"q": "\\"},
        cookies={settings.session_cookie_name: token},
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(literal.id)]


@pytest.mark.parametrize("doc_type", list(DocumentType))
def test_each_exact_document_type_filter(client, db_session, doc_type):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, f"type-{doc_type.value.lower()}")
    token = _create_token(db_session, user)
    selected = _create_document(db_session, module, user, DocumentStatus.APPROVED, f"{doc_type.value}", doc_type=doc_type)
    _create_document(db_session, module, user, DocumentStatus.APPROVED, "Other type", doc_type=next(item for item in DocumentType if item != doc_type))

    response = client.get("/api/v1/communities/irm/modules/mod/documents", params={"type": doc_type.value}, cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(selected.id)]


@pytest.mark.parametrize("source", list(DocumentSource))
def test_each_exact_document_source_filter(client, db_session, source):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, f"source-{source.value.lower()}")
    token = _create_token(db_session, user)
    selected = _create_document(db_session, module, user, DocumentStatus.APPROVED, source.value, source=source)
    other_source = next(item for item in DocumentSource if item != source)
    _create_document(db_session, module, user, DocumentStatus.APPROVED, "Other source", source=other_source)

    response = client.get("/api/v1/communities/irm/modules/mod/documents", params={"source": source.value}, cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(selected.id)]


def test_combined_filters_are_and_scoped_and_hidden_docs_stay_hidden(client, db_session):
    community = _create_community(db_session, "irm")
    other_community = _create_community(db_session, "other")
    module = _create_module(db_session, community, "Mod", "mod")
    other_module = _create_module(db_session, other_community, "Mod", "mod")
    user = _create_user(db_session, "combined-user")
    token = _create_token(db_session, user)
    match = _create_document(db_session, module, user, DocumentStatus.APPROVED, "Linear Algebra", DocumentType.TD, DocumentSource.OFFICIAL)
    _create_document(db_session, module, user, DocumentStatus.APPROVED, "Linear Algebra", DocumentType.EXAM, DocumentSource.OFFICIAL)
    _create_document(db_session, module, user, DocumentStatus.APPROVED, "Linear Algebra", DocumentType.TD, DocumentSource.STUDENT)
    _create_document(db_session, module, user, DocumentStatus.PENDING, "Linear Algebra", DocumentType.TD, DocumentSource.OFFICIAL)
    _create_document(db_session, other_module, user, DocumentStatus.APPROVED, "Linear Algebra", DocumentType.TD, DocumentSource.OFFICIAL)

    response = client.get(
        "/api/v1/communities/irm/modules/mod/documents",
        params={"q": " algebra ", "type": "TD", "source": "OFFICIAL"},
        cookies={settings.session_cookie_name: token},
    )
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(match.id)]


def test_invalid_search_filters_return_validation_errors(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "invalid-search-user")
    token = _create_token(db_session, user)
    url = "/api/v1/communities/irm/modules/mod/documents"
    cookies = {settings.session_cookie_name: token}

    assert client.get(url, params={"type": "BOOK"}, cookies=cookies).status_code == 422
    assert client.get(url, params={"source": "UNKNOWN"}, cookies=cookies).status_code == 422
    assert client.get(url, params={"q": "x" * 101}, cookies=cookies).status_code == 422


def test_my_submissions_lists_all_own_statuses_across_modules_privately(client, db_session):
    community = _create_community(db_session, "irm")
    other_community = _create_community(db_session, "other")
    module_a = _create_module(db_session, community, "Algebra", "algebra")
    module_b = _create_module(db_session, community, "Physics", "physics")
    other_module = _create_module(db_session, other_community, "Other", "other")
    owner = _create_user(db_session, "submission-owner")
    another_user = _create_user(db_session, "other-uploader")
    _create_membership(db_session, owner, community, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    token = _create_token(db_session, owner)

    own = [
        _create_document(db_session, module_a, owner, DocumentStatus.PENDING, "Pending"),
        _create_document(db_session, module_b, owner, DocumentStatus.APPROVED, "Approved"),
        _create_document(db_session, module_a, owner, DocumentStatus.REJECTED, "Rejected"),
    ]
    _create_document(db_session, module_a, another_user, DocumentStatus.APPROVED, "Other uploader")
    _create_document(db_session, other_module, owner, DocumentStatus.APPROVED, "Other community")

    response = client.get(
        "/api/v1/communities/irm/documents/mine",
        cookies={settings.session_cookie_name: token},
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    body = response.json()
    assert {item["id"] for item in body["items"]} == {str(doc.id) for doc in own}
    assert {item["status"] for item in body["items"]} == {"PENDING", "APPROVED", "REJECTED"}
    assert {item["module_slug"] for item in body["items"]} == {"algebra", "physics"}
    assert body["next_cursor"] is None
    safe_keys = {
        "id", "module_id", "module_slug", "module_name", "title", "type",
        "source", "status", "created_at", "updated_at",
    }
    for item in body["items"]:
        assert set(item) == safe_keys
        assert "storage_path" not in item and "preview_path" not in item and "votes" not in item


def test_my_submissions_requires_auth_and_active_community_membership(client, db_session):
    community = _create_community(db_session, "irm")
    active = _create_user(db_session, "active-submissions")
    inactive = _create_user(db_session, "inactive-submissions")
    _create_membership(db_session, active, community, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    _create_membership(db_session, inactive, community, MembershipStatus.PENDING, MembershipRole.MEMBER)
    active_token = _create_token(db_session, active)
    inactive_token = _create_token(db_session, inactive)
    url = "/api/v1/communities/irm/documents/mine"

    assert client.get(url).status_code == 401
    assert client.get(url, cookies={settings.session_cookie_name: inactive_token}).status_code == 403
    assert client.get("/api/v1/communities/unknown/documents/mine", cookies={settings.session_cookie_name: active_token}).status_code == 404


def test_my_submissions_cursor_scope_limit_and_status_filter(client, db_session):
    community = _create_community(db_session, "irm")
    other_community = _create_community(db_session, "other")
    module = _create_module(db_session, community, "Mod", "mod")
    other_module = _create_module(db_session, other_community, "Other", "other")
    owner = _create_user(db_session, "cursor-owner")
    another_user = _create_user(db_session, "cursor-other")
    _create_membership(db_session, owner, community, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    token = _create_token(db_session, owner)
    fixed_time = datetime(2026, 1, 1, tzinfo=timezone.utc)
    docs = []
    for value in range(1, 5):
        doc = Document(
            id=uuid.UUID(int=value),
            module_id=module.id,
            uploader_id=owner.id,
            title=f"Equal time {value}",
            type=DocumentType.COURSE,
            source=DocumentSource.STUDENT,
            status=DocumentStatus.PENDING if value <= 3 else DocumentStatus.APPROVED,
            storage_path=f"fake/{value}",
            vote_threshold_snapshot=10 if value <= 3 else None,
            created_at=fixed_time,
            updated_at=fixed_time,
        )
        db_session.add(doc)
        docs.append(doc)
    forged_other = _create_document(db_session, module, another_user, DocumentStatus.APPROVED, "Not yours")
    forged_community = _create_document(db_session, other_module, owner, DocumentStatus.APPROVED, "Different community")
    db_session.commit()
    url = "/api/v1/communities/irm/documents/mine"
    cookies = {settings.session_cookie_name: token}

    first = client.get(url, params={"limit": 2}, cookies=cookies)
    assert first.status_code == 200
    assert [item["id"] for item in first.json()["items"]] == [str(docs[3].id), str(docs[2].id)]
    cursor = first.json()["next_cursor"]
    second = client.get(url, params={"limit": 2, "after": cursor}, cookies=cookies)
    assert second.status_code == 200
    assert [item["id"] for item in second.json()["items"]] == [str(docs[1].id), str(docs[0].id)]
    assert second.json()["next_cursor"] is None

    filtered = client.get(url, params={"limit": 1, "status": "PENDING"}, cookies=cookies)
    assert filtered.status_code == 200
    assert filtered.json()["items"][0]["status"] == "PENDING"
    filtered_next = client.get(url, params={"limit": 2, "status": "PENDING", "after": filtered.json()["next_cursor"]}, cookies=cookies)
    assert filtered_next.status_code == 200
    assert len(filtered_next.json()["items"]) == 2
    assert all(item["status"] == "PENDING" for item in filtered_next.json()["items"])

    assert client.get(url, params={"after": forged_other.id}, cookies=cookies).status_code == 404
    assert client.get(url, params={"after": forged_community.id}, cookies=cookies).status_code == 404
    assert client.get(url, params={"after": "not-a-uuid"}, cookies=cookies).status_code == 422
    assert client.get(url, params={"limit": 0}, cookies=cookies).status_code == 422
    assert client.get(url, params={"limit": 51}, cookies=cookies).status_code == 422
    assert client.get(url, params={"limit": 1}, cookies=cookies).status_code == 200
    assert client.get(url, params={"limit": 50}, cookies=cookies).status_code == 200
    assert client.get(url, params={"status": "PROCESSING"}, cookies=cookies).status_code == 422
