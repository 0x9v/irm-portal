import uuid
from datetime import datetime, timedelta, timezone
import time

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
from app.models.document_reading import DocumentReading
from app.models.module import Module
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
    user = User(username=name, email=f"{name}@example.test", password_hash="hash", first_name="Account", family_name="Name")
    db.add(user); db.commit(); db.refresh(user)
    return user


def create_document(db, *, community_slug="irm", status=DocumentStatus.APPROVED, title="Approved"):
    community = db.query(Community).filter_by(slug=community_slug).first()
    if community is None:
        community = Community(name=community_slug, slug=community_slug)
        db.add(community); db.commit(); db.refresh(community)
    module = db.query(Module).filter_by(community_id=community.id).first()
    if module is None:
        module = Module(community_id=community.id, name="Signals", slug=f"signals-{community_slug}")
        db.add(module); db.commit(); db.refresh(module)
    uploader = db.query(User).first() or create_user(db, f"uploader-{community_slug}")
    document = Document(
        module_id=module.id, uploader_id=uploader.id, title=title,
        type=DocumentType.COURSE, source=DocumentSource.OFFICIAL, status=status,
        storage_path="private/path.pdf", vote_threshold_snapshot=None,
    )
    db.add(document); db.commit(); db.refresh(document)
    return module, document


def auth_cookie(db, user):
    token, _ = create_session(db, user.id, timedelta(days=1))
    return {settings.session_cookie_name: token}


def reading_path(document_id):
    return f"/api/v1/communities/irm/documents/{document_id}/reading"


def test_open_restore_reopen_order_and_independent_users(client, db):
    first_user, second_user = create_user(db, "reader-a"), create_user(db, "reader-b")
    _, first_doc = create_document(db, title="First")
    _, second_doc = create_document(db, title="Second")
    auth_a, auth_b = auth_cookie(db, first_user), auth_cookie(db, second_user)

    opened = client.post(f"{reading_path(first_doc.id)}/open", cookies=auth_a)
    assert opened.status_code == 200 and opened.json() == {"last_page": 1}
    assert opened.headers["cache-control"] == "private, no-store"
    first_timestamp = db.query(DocumentReading).filter_by(user_id=first_user.id, document_id=first_doc.id).one().last_opened_at
    changed = client.put(f"{reading_path(first_doc.id)}/position", json={"page": 9}, cookies=auth_a)
    assert changed.status_code == 200 and changed.json() == {"last_page": 9}
    repeated = client.put(f"{reading_path(first_doc.id)}/position", json={"page": 9}, cookies=auth_a)
    assert repeated.json() == {"last_page": 9}
    assert db.query(DocumentReading).filter_by(user_id=first_user.id, document_id=first_doc.id).count() == 1

    assert client.post(f"{reading_path(second_doc.id)}/open", cookies=auth_a).json() == {"last_page": 1}
    time.sleep(0.002)
    reopened = client.post(f"{reading_path(first_doc.id)}/open", cookies=auth_a)
    assert reopened.json() == {"last_page": 9}
    first_record = db.query(DocumentReading).filter_by(user_id=first_user.id, document_id=first_doc.id).one()
    assert first_record.last_opened_at > first_timestamp
    recent = client.get("/api/v1/communities/irm/documents/recent", cookies=auth_a)
    assert recent.status_code == 200
    assert recent.headers["cache-control"] == "private, no-store"
    assert recent.json()["items"][0]["id"] == str(first_doc.id)
    assert recent.json()["items"][0]["last_page"] == 9

    assert client.post(f"{reading_path(first_doc.id)}/open", cookies=auth_b).json() == {"last_page": 1}
    assert client.put(f"{reading_path(first_doc.id)}/position", json={"page": 3}, cookies=auth_b).json() == {"last_page": 3}
    assert db.query(DocumentReading).filter_by(user_id=second_user.id, document_id=first_doc.id).one().last_page == 3
    assert db.query(DocumentReading).filter_by(user_id=first_user.id, document_id=first_doc.id).one().last_page == 9


@pytest.mark.parametrize("payload", [
    {"page": True}, {"page": 1.0}, {"page": "2"}, {"page": 0}, {"page": -1},
    {"page": 100001}, {"page": 2, "extra": "not allowed"}, {},
])
def test_page_update_strict_validation(client, db, payload):
    user = create_user(db, "strict-reader")
    _, document = create_document(db)
    response = client.put(f"{reading_path(document.id)}/position", json=payload, cookies=auth_cookie(db, user))
    assert response.status_code == 422
    assert db.query(DocumentReading).count() == 0


def test_authentication_and_approved_community_access(client, db):
    user = create_user(db, "access-reader")
    _, approved = create_document(db)
    _, pending = create_document(db, status=DocumentStatus.PENDING, title="Pending")
    _, rejected = create_document(db, status=DocumentStatus.REJECTED, title="Rejected")
    _, foreign = create_document(db, community_slug="other", title="Foreign")
    assert client.post(f"{reading_path(approved.id)}/open").status_code == 401
    assert client.get("/api/v1/communities/irm/documents/recent").status_code == 401
    assert client.put(f"{reading_path(approved.id)}/position", json={"page": 2}).status_code == 401

    auth = auth_cookie(db, user)
    assert client.post(f"{reading_path(pending.id)}/open", cookies=auth).status_code == 404
    assert client.put(f"{reading_path(rejected.id)}/position", json={"page": 2}, cookies=auth).status_code == 404
    assert client.post(f"{reading_path(foreign.id)}/open", cookies=auth).status_code == 404
    assert client.post(f"{reading_path(uuid.uuid4())}/open", cookies=auth).status_code == 404
    assert client.post(f"{reading_path('not-a-uuid')}/open", cookies=auth).status_code == 404
    assert db.query(DocumentReading).count() == 0


def test_non_reader_document_routes_do_not_create_activity(client, db, monkeypatch, tmp_path):
    user = create_user(db, "passive-reader")
    module, document = create_document(db)
    auth = auth_cookie(db, user)
    assert client.get(f"/api/v1/communities/irm/modules/{module.slug}/documents", cookies=auth).status_code == 200
    assert client.get(f"/api/v1/communities/irm/modules/{module.slug}/documents/{document.id}", cookies=auth).status_code == 200

    fake_pdf = tmp_path / "synthetic.pdf"
    fake_pdf.write_bytes(b"%PDF synthetic test file")
    monkeypatch.setattr(
        "app.api.v1.endpoints.documents_global.get_document_download_info",
        lambda _document: (str(fake_pdf), "application/pdf", "synthetic.pdf"),
    )
    assert client.get(f"/api/v1/documents/{document.id}/download", cookies=auth).status_code == 200
    assert client.get(f"/api/v1/documents/{document.id}/view", cookies=auth).status_code == 200
    assert db.query(DocumentReading).count() == 0


def test_recent_pagination_scoping_metadata_and_unavailable_filter(client, db):
    user, other_user = create_user(db, "recent-reader"), create_user(db, "other-reader")
    _, doc_a = create_document(db, title="Recent A")
    _, doc_b = create_document(db, title="Recent B")
    _, hidden = create_document(db, status=DocumentStatus.APPROVED, title="Will be hidden")
    timestamp = datetime(2026, 5, 1, tzinfo=timezone.utc)
    newest_id, older_id = uuid.UUID(int=200), uuid.UUID(int=100)
    db.add_all([
        DocumentReading(id=older_id, user_id=user.id, document_id=doc_a.id, last_page=12, last_opened_at=timestamp),
        DocumentReading(id=newest_id, user_id=user.id, document_id=doc_b.id, last_page=4, last_opened_at=timestamp),
        DocumentReading(user_id=user.id, document_id=hidden.id, last_page=2, last_opened_at=datetime(2026, 4, 30, tzinfo=timezone.utc)),
        DocumentReading(user_id=other_user.id, document_id=doc_a.id, last_page=99, last_opened_at=datetime(2026, 5, 3, tzinfo=timezone.utc)),
    ])
    db.commit()
    auth = auth_cookie(db, user)

    first_page = client.get("/api/v1/communities/irm/documents/recent?limit=1", cookies=auth)
    assert first_page.status_code == 200
    assert [item["id"] for item in first_page.json()["items"]] == [str(doc_b.id)]
    assert first_page.json()["next_cursor"] == str(newest_id)
    item = first_page.json()["items"][0]
    assert item["last_page"] == 4 and item["module_slug"].startswith("signals-")
    assert set(item) == {"id", "module_id", "module_slug", "module_name", "title", "type", "source", "last_page", "last_opened_at"}
    second_page = client.get(f"/api/v1/communities/irm/documents/recent?limit=1&after={newest_id}", cookies=auth)
    assert [item["id"] for item in second_page.json()["items"]] == [str(doc_a.id)]
    assert second_page.json()["next_cursor"]
    third_page = client.get(
        f"/api/v1/communities/irm/documents/recent?limit=1&after={second_page.json()['next_cursor']}",
        cookies=auth,
    )
    assert [item["id"] for item in third_page.json()["items"]] == [str(hidden.id)]
    assert third_page.json()["next_cursor"] is None

    outsider_cursor = db.query(DocumentReading).filter_by(user_id=other_user.id, document_id=doc_a.id).one().id
    assert client.get(f"/api/v1/communities/irm/documents/recent?after={outsider_cursor}", cookies=auth).status_code == 404
    assert client.get("/api/v1/communities/irm/documents/recent?after=invalid", cookies=auth).status_code == 422
    assert client.get("/api/v1/communities/irm/documents/recent?limit=0", cookies=auth).status_code == 422
    assert client.get("/api/v1/communities/irm/documents/recent?limit=51", cookies=auth).status_code == 422
    hidden.status = DocumentStatus.REJECTED
    db.commit()
    feed = client.get("/api/v1/communities/irm/documents/recent", cookies=auth)
    assert all(item["id"] != str(hidden.id) for item in feed.json()["items"])
