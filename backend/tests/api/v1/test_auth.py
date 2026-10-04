import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.user import User
from app.models.session import Session


from sqlalchemy.pool import StaticPool

# Setup testing database
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

client = TestClient(app)


def test_register_user_success():
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": "testuser",
            "email": "test@example.com",
            "password": "StrongPassword123!",
            "first_name": "Test",
            "family_name": "User"
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["username"] == "testuser"
    assert data["email"] == "test@example.com"
    assert data["first_name"] == "Test"
    assert data["family_name"] == "User"
    assert "id" in data
    assert "created_at" in data
    assert "password_hash" not in data
    assert "password" not in data
    
    # Verify in DB directly
    db = TestingSessionLocal()
    user = db.query(User).filter(User.username == "testuser").first()
    assert user is not None
    assert user.password_hash != "StrongPassword123!"
    assert user.password_hash.startswith("$argon2")
    
    # Verify no session created
    sessions = db.query(Session).filter(Session.user_id == user.id).all()
    assert len(sessions) == 0
    db.close()

def test_register_duplicate_username():
    user_data = {
        "username": "dupuser",
        "email": "dup1@example.com",
        "password": "StrongPassword123!",
        "first_name": "Test",
        "family_name": "User"
    }
    client.post("/api/v1/auth/register", json=user_data)
    
    # Try again with same username
    user_data["email"] = "dup2@example.com"
    response = client.post("/api/v1/auth/register", json=user_data)
    
    assert response.status_code == 409
    assert "already taken" in response.json()["detail"]

def test_register_duplicate_email():
    user_data = {
        "username": "dupemail1",
        "email": "dupemail@example.com",
        "password": "StrongPassword123!",
        "first_name": "Test",
        "family_name": "User"
    }
    client.post("/api/v1/auth/register", json=user_data)
    
    # Try again with same email
    user_data["username"] = "dupemail2"
    response = client.post("/api/v1/auth/register", json=user_data)
    
    assert response.status_code == 409
    assert "already registered" in response.json()["detail"]

def test_register_invalid_email():
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": "bademail",
            "email": "not-an-email",
            "password": "StrongPassword123!",
            "first_name": "Test",
            "family_name": "User"
        },
    )
    assert response.status_code == 422
    
def test_register_short_password():
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": "shortpass",
            "email": "shortpass@example.com",
            "password": "short",
            "first_name": "Test",
            "family_name": "User"
        },
    )
    assert response.status_code == 422

from app.core.sessions import validate_session

def test_login_success():
    client.post(
        "/api/v1/auth/register",
        json={
            "username": "loginuser",
            "email": "login@example.com",
            "password": "StrongPassword123!",
            "first_name": "Test",
            "family_name": "User"
        },
    )
    
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "login@example.com",
            "password": "StrongPassword123!"
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "login@example.com"
    assert "password_hash" not in data
    assert "password" not in data
    
    # Verify cookie
    assert "session" in response.cookies
    raw_token = response.cookies.get("session")
    
    # Ensure raw token is not leaked in the JSON
    assert raw_token not in str(data)
    
    db = TestingSessionLocal()
    user = db.query(User).filter(User.email == "login@example.com").first()
    sessions = db.query(Session).filter(Session.user_id == user.id).all()
    assert len(sessions) == 1
    
    # Session validation
    validated = validate_session(db, raw_token)
    assert validated is not None
    assert validated.id == sessions[0].id
    db.close()


def test_login_wrong_password():
    client.post(
        "/api/v1/auth/register",
        json={
            "username": "wrongpass",
            "email": "wrongpass@example.com",
            "password": "StrongPassword123!",
            "first_name": "Test",
            "family_name": "User"
        },
    )
    
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "wrongpass@example.com",
            "password": "WrongPassword!"
        }
    )
    assert response.status_code == 401
    assert "session" not in response.cookies


def test_login_unknown_email():
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "unknown@example.com",
            "password": "StrongPassword123!"
        }
    )
    assert response.status_code == 401

def test_cookie_security_attributes():
    client.post(
        "/api/v1/auth/register",
        json={
            "username": "cookieattr",
            "email": "cookieattr@example.com",
            "password": "StrongPassword123!",
            "first_name": "Test",
            "family_name": "User"
        },
    )
    
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "cookieattr@example.com",
            "password": "StrongPassword123!"
        }
    )
    
    set_cookie_header = response.headers.get("set-cookie")
    assert set_cookie_header is not None
    assert "session=" in set_cookie_header
    assert "HttpOnly" in set_cookie_header
    assert "SameSite=lax" in set_cookie_header
    assert "Path=/" in set_cookie_header
    assert "Max-Age=" in set_cookie_header

def test_logout_success():
    # 1. Register and Login to get a valid session
    client.post(
        "/api/v1/auth/register",
        json={
            "username": "logoutuser",
            "email": "logout@example.com",
            "password": "StrongPassword123!",
            "first_name": "Test",
            "family_name": "User"
        },
    )
    login_response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "logout@example.com",
            "password": "StrongPassword123!"
        }
    )
    assert "session" in login_response.cookies
    raw_token = login_response.cookies.get("session")
    
    # Snapshot of session count before logout
    db = TestingSessionLocal()
    user = db.query(User).filter(User.email == "logout@example.com").first()
    sessions_before = db.query(Session).filter(Session.user_id == user.id).all()
    assert len(sessions_before) == 1
    session_id = sessions_before[0].id
    assert not sessions_before[0].is_revoked
    db.close()
    
    # 2. Call logout
    logout_response = client.post(
        "/api/v1/auth/logout",
        cookies={"session": raw_token}
    )
    assert logout_response.status_code == 200
    
    # 3. Cookie should be cleared
    set_cookie_header = logout_response.headers.get("set-cookie")
    assert set_cookie_header is not None
    assert "session=" in set_cookie_header
    assert "Max-Age=0" in set_cookie_header or "expires=" in set_cookie_header.lower()
    
    # 4. Session should be revoked, not deleted
    db = TestingSessionLocal()
    sessions_after = db.query(Session).filter(Session.user_id == user.id).all()
    assert len(sessions_after) == 1
    assert sessions_after[0].id == session_id
    assert sessions_after[0].is_revoked is True
    
    # 5. Token is no longer valid
    assert validate_session(db, raw_token) is None
    db.close()


def test_logout_without_cookie():
    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 200
    assert response.json() == {"detail": "Successfully logged out"}
    assert "session=" in response.headers.get("set-cookie", "")


def test_logout_with_invalid_cookie():
    response = client.post(
        "/api/v1/auth/logout",
        cookies={"session": "invalid-token-12345"}
    )
    assert response.status_code == 200
    assert response.json() == {"detail": "Successfully logged out"}
    assert "session=" in response.headers.get("set-cookie", "")


def test_logout_twice():
    client.post(
        "/api/v1/auth/register",
        json={
            "username": "logouttwice",
            "email": "logouttwice@example.com",
            "password": "StrongPassword123!",
            "first_name": "Test",
            "family_name": "User"
        },
    )
    login_response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "logouttwice@example.com",
            "password": "StrongPassword123!"
        }
    )
    raw_token = login_response.cookies.get("session")
    
    # First logout
    resp1 = client.post("/api/v1/auth/logout", cookies={"session": raw_token})
    assert resp1.status_code == 200
    
    # Second logout (token is now revoked in DB)
    resp2 = client.post("/api/v1/auth/logout", cookies={"session": raw_token})
    assert resp2.status_code == 200
