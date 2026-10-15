import uuid
from datetime import timedelta

import pytest
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
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.module import Module
from app.models.saved_document import SavedDocument
from app.models.user import User

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def isolated_api_db():
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = _db_dependency
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def _db_dependency():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def db():
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    return TestClient(app)


def create_user(db, name):
    row = User(username=name, email=f"{name}@example.test", password_hash="hash", first_name="First", family_name="Last")
    db.add(row); db.commit(); db.refresh(row)
    return row


def create_doc(db, community_slug="irm", status=DocumentStatus.APPROVED, title="Approved"):
    community = db.query(Community).filter_by(slug=community_slug).first()
    if not community:
        community = Community(name=community_slug, slug=community_slug)
        db.add(community); db.commit(); db.refresh(community)
    module = db.query(Module).filter_by(community_id=community.id).first()
    if not module:
        module = Module(community_id=community.id, name="Signals", slug=f"signals-{community_slug}")
        db.add(module); db.commit(); db.refresh(module)
    user = db.query(User).first() or create_user(db, f"uploader-{community_slug}")
    doc = Document(module_id=module.id, uploader_id=user.id, title=title, type=DocumentType.COURSE,
                   source=DocumentSource.STUDENT, status=status, storage_path="private/path.pdf", vote_threshold_snapshot=10)
    db.add(doc); db.commit(); db.refresh(doc)
    return module, doc


def cookie(db, user):
    token, _ = create_session(db, user.id, timedelta(days=1))
    return {settings.session_cookie_name: token}


def test_nonmember_can_save_idempotently_and_list_safe_metadata(client, db):
    user = create_user(db, "saver")
    module, doc = create_doc(db)
    auth = cookie(db, user)
    path = f"/api/v1/communities/irm/documents/{doc.id}/saved"

    mutation = client.put(path, cookies=auth)
    assert mutation.json() == {"saved": True}
    assert mutation.headers["cache-control"] == "private, no-store"
    assert client.put(path, cookies=auth).json() == {"saved": True}
    assert db.query(SavedDocument).filter_by(user_id=user.id, document_id=doc.id).count() == 1
    response = client.get("/api/v1/communities/irm/documents/saved", cookies=auth)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert len(response.json()["items"]) == 1
    item = response.json()["items"][0]
    assert item["id"] == str(doc.id)
    assert item["module_slug"] == module.slug
    assert set(item) == {"id", "module_id", "module_slug", "module_name", "title", "type", "source", "document_created_at", "saved_at"}
    state = client.get(path, cookies=auth)
    assert state.json() == {"saved": True}
    assert state.headers["cache-control"] == "private, no-store"
    assert client.delete(path, cookies=auth).json() == {"saved": False}
    assert client.delete(path, cookies=auth).headers["cache-control"] == "private, no-store"
    assert client.delete(path, cookies=auth).json() == {"saved": False}


def test_hidden_foreign_and_other_user_saves_are_concealed(client, db):
    user_a = create_user(db, "saver-a")
    user_b = create_user(db, "saver-b")
    _, approved = create_doc(db, "irm")
    _, pending = create_doc(db, "irm", DocumentStatus.PENDING, "Pending")
    _, rejected = create_doc(db, "irm", DocumentStatus.REJECTED, "Rejected")
    _, other_community = create_doc(db, "other")
    auth_a, auth_b = cookie(db, user_a), cookie(db, user_b)
    assert client.put(f"/api/v1/communities/irm/documents/{approved.id}/saved", cookies=auth_a).status_code == 200

    for hidden in [pending, rejected, other_community]:
        assert client.put(f"/api/v1/communities/irm/documents/{hidden.id}/saved", cookies=auth_a).status_code == 404
        assert client.get(f"/api/v1/communities/irm/documents/{hidden.id}/saved", cookies=auth_a).status_code == 404
    own = client.get("/api/v1/communities/irm/documents/saved", cookies=auth_b)
    assert own.json() == {"items": [], "next_cursor": None}
    assert client.delete(f"/api/v1/communities/irm/documents/{approved.id}/saved", cookies=auth_b).status_code == 200
    assert [item["id"] for item in client.get("/api/v1/communities/irm/documents/saved", cookies=auth_a).json()["items"]] == [str(approved.id)]
    assert client.get("/api/v1/communities/other/documents/saved", cookies=auth_a).json()["items"] == []
    assert client.get("/api/v1/communities/irm/documents/saved").status_code == 401


def test_unapproved_saved_row_is_filtered_and_cursor_is_scoped(client, db):
    user = create_user(db, "cursor-user")
    _, first = create_doc(db)
    _, second = create_doc(db, title="Second")
    auth = cookie(db, user)
    for doc in (first, second):
        db.add(SavedDocument(user_id=user.id, document_id=doc.id))
    db.commit()
    first_page = client.get("/api/v1/communities/irm/documents/saved?limit=1", cookies=auth)
    assert first_page.status_code == 200
    assert len(first_page.json()["items"]) == 1
    assert first_page.json()["next_cursor"]
    foreign_cursor = uuid.uuid4()
    assert client.get(f"/api/v1/communities/irm/documents/saved?after={foreign_cursor}", cookies=auth).status_code == 404
    other_user = create_user(db, "other-cursor-user")
    db.add(SavedDocument(user_id=other_user.id, document_id=first.id)); db.commit()
    other_cursor = db.query(SavedDocument).filter_by(user_id=other_user.id).one().id
    assert client.get(f"/api/v1/communities/irm/documents/saved?after={other_cursor}", cookies=auth).status_code == 404
    assert client.get("/api/v1/communities/irm/documents/saved?after=not-a-uuid", cookies=auth).status_code == 422

    first.status = DocumentStatus.REJECTED
    db.commit()
    feed = client.get("/api/v1/communities/irm/documents/saved", cookies=auth)
    assert all(item["id"] != str(first.id) for item in feed.json()["items"])


def test_equal_timestamp_ordering_and_keyset_pagination(client, db):
    from datetime import datetime, timezone

    user = create_user(db, "ordered-user")
    _, older_doc = create_doc(db)
    _, newer_doc = create_doc(db, title="Second approved")
    timestamp = datetime(2026, 2, 1, tzinfo=timezone.utc)
    older_save_id, newer_save_id = uuid.UUID(int=10), uuid.UUID(int=20)
    db.add_all([
        SavedDocument(id=older_save_id, user_id=user.id, document_id=older_doc.id, created_at=timestamp),
        SavedDocument(id=newer_save_id, user_id=user.id, document_id=newer_doc.id, created_at=timestamp),
    ])
    db.commit()
    auth = cookie(db, user)
    first = client.get("/api/v1/communities/irm/documents/saved?limit=1", cookies=auth)
    assert first.status_code == 200
    assert [item["id"] for item in first.json()["items"]] == [str(newer_doc.id)]
    assert first.json()["next_cursor"] == str(newer_save_id)
    second = client.get(f"/api/v1/communities/irm/documents/saved?limit=1&after={first.json()['next_cursor']}", cookies=auth)
    assert [item["id"] for item in second.json()["items"]] == [str(older_doc.id)]
    assert second.json()["next_cursor"] is None


def test_limit_validation_and_cursor_outside_owner_scope(client, db):
    user = create_user(db, "limit-user")
    _, doc = create_doc(db)
    auth = cookie(db, user)
    assert client.get("/api/v1/communities/irm/documents/saved?limit=0", cookies=auth).status_code == 422
    assert client.get("/api/v1/communities/irm/documents/saved?limit=51", cookies=auth).status_code == 422
    assert client.get(f"/api/v1/communities/irm/documents/saved?after={doc.id}", cookies=auth).status_code == 404
