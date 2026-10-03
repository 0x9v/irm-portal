import pytest
from unittest import mock
import uuid
from fastapi import status
from app.models.community import Community
from app.models.module import Module
from app.models.user import User
from app.models.membership import Membership, MembershipStatus, MembershipRole
from app.models.document import Document
from app.core.sessions import create_session
from datetime import timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
from app.database.session import get_db
from app.main import app

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


def _create_community(db, slug="irm"):
    c = Community(id=uuid.uuid4(), name="IRM", slug=slug)
    db.add(c)
    db.commit()
    return c

def _create_module(db, community, name="Math", slug="math"):
    m = Module(id=uuid.uuid4(), community_id=community.id, name=name, slug=slug)
    db.add(m)
    db.commit()
    return m

def _create_user(db, username):
    u = User(id=uuid.uuid4(), email=f"{username}@example.com", username=username, password_hash="hash", first_name="A", family_name="B")
    db.add(u)
    db.commit()
    return u

def _create_membership(db, user_id, community_id, role_enum):
    m = Membership(user_id=user_id, community_id=community_id, status=MembershipStatus.ACTIVE, role=role_enum, cne=f"CNE_{user_id}")
    db.add(m)
    db.commit()
    return m

def _create_token(db, user):
    token, _ = create_session(db, user.id, timedelta(days=1))
    return token

@pytest.fixture
def test_data(db_session):
    community = _create_community(db_session)
    module = _create_module(db_session, community)
    user = _create_user(db_session, "uploader")
    _create_membership(db_session, user.id, community.id, MembershipRole.MEMBER)
    return community, module, user

# We use mock.patch to override the settings max size dynamically per test
def test_below_limit_upload_succeeds(client, db_session, test_data):
    community, module, user = test_data
    token = _create_token(db_session, user)

    file_content = b"%PDF-1.4 mock valid file" # 24 bytes
    with mock.patch("app.core.config.settings.document_upload_max_bytes", 100), mock.patch("app.services.preview.create_and_store_preview", return_value="dummy_preview_key"):
        response = client.post(
            f"/api/v1/communities/{community.slug}/modules/{module.slug}/documents",
            data={"title": "Small PDF", "type": "COURSE", "source": "STUDENT"},
            files={"file": ("test.pdf", file_content, "application/pdf")},
            cookies={"session": token}
        )
    assert response.status_code == 201

def test_exact_limit_upload_succeeds(client, db_session, test_data):
    community, module, user = test_data
    token = _create_token(db_session, user)

    file_content = b"%PDF-1.4 mock exact limit" # 25 bytes
    with mock.patch("app.core.config.settings.document_upload_max_bytes", len(file_content)), mock.patch("app.services.preview.create_and_store_preview", return_value="dummy_preview_key"):
        response = client.post(
            f"/api/v1/communities/{community.slug}/modules/{module.slug}/documents",
            data={"title": "Exact PDF", "type": "COURSE", "source": "STUDENT"},
            files={"file": ("test.pdf", file_content, "application/pdf")},
            cookies={"session": token}
        )
    assert response.status_code == 201

def test_one_byte_over_limit_fails(client, db_session, test_data):
    community, module, user = test_data
    token = _create_token(db_session, user)

    file_content = b"%PDF-1.4 mock exact limits" # 26 bytes
    with mock.patch("app.core.config.settings.document_upload_max_bytes", len(file_content) - 1):
        response = client.post(
            f"/api/v1/communities/{community.slug}/modules/{module.slug}/documents",
            data={"title": "Oversized PDF", "type": "COURSE", "source": "STUDENT"},
            files={"file": ("test.pdf", file_content, "application/pdf")},
            cookies={"session": token}
        )
    assert response.status_code == 413
    assert "File too large" in response.json()["detail"]

    # Verify no document/original/preview remains
    docs = db_session.query(Document).all()
    assert len(docs) == 0

def test_oversized_official_upload_fails(client, db_session):
    community = _create_community(db_session, "irm-off")
    module = _create_module(db_session, community, "Mod", "mod-off")
    user = _create_user(db_session, "del")
    _create_membership(db_session, user.id, community.id, MembershipRole.DELEGATE)
    token = _create_token(db_session, user)

    file_content = b"%PDF-1.4 mock exact limits" # 26 bytes
    with mock.patch("app.core.config.settings.document_upload_max_bytes", len(file_content) - 1):
        response = client.post(
            f"/api/v1/communities/{community.slug}/modules/{module.slug}/documents",
            data={"title": "Oversized Official PDF", "type": "COURSE", "source": "OFFICIAL"},
            files={"file": ("test.pdf", file_content, "application/pdf")},
            cookies={"session": token}
        )
    assert response.status_code == 413
    assert "File too large" in response.json()["detail"]

    docs = db_session.query(Document).all()
    assert len(docs) == 0

