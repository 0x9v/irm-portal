import pytest
from fastapi.testclient import TestClient
from datetime import timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base
from app.database.session import get_db
from app.core.config import settings
from app.core.sessions import create_session
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
def setup_db():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()

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

def create_test_user(db, username, email):
    u = User(username=username, email=email, password_hash="hash", first_name="F", family_name="L")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u

def get_token(db, user):
    return create_session(db, user.id, timedelta(days=1))[0]

def test_get_me_success(client, db_session):
    user = create_test_user(db_session, "me_user", "me@example.com")
    token = get_token(db_session, user)
    
    response = client.get("/api/v1/auth/me", cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(user.id)
    assert data["username"] == "me_user"
    assert data["email"] == "me@example.com"
    assert data["first_name"] == "F"
    assert data["family_name"] == "L"
    assert "password_hash" not in data
    assert "cne" not in data
    
    assert "no-store" in response.headers.get("Cache-Control", "")

def test_get_me_unauthorized(client):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
