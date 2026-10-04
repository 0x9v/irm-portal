from datetime import timedelta
import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.sessions import create_session, revoke_session
from app.database import Base
from app.database.session import get_db
from app.models.user import User
from app.services.user import create_user
from app.schemas.user import UserCreate

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

# Small app for testing
test_app = FastAPI()
test_app.dependency_overrides[get_db] = override_get_db

router = APIRouter()

@router.get("/protected")
def protected_route(current_user: User = Depends(get_current_user)):
    return {"user_id": str(current_user.id), "username": current_user.username}

test_app.include_router(router)

@pytest.fixture(autouse=True)
def init_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

client = TestClient(test_app)

def create_test_user(db):
    user_in = UserCreate(
        username="depsuser",
        email="deps@example.com",
        password="StrongPassword123!",
        first_name="Deps",
        family_name="User"
    )
    return create_user(db, user_in)

def test_get_current_user_success():
    db = TestingSessionLocal()
    user = create_test_user(db)
    raw_token, session_model = create_session(db, user.id, timedelta(days=1))
    user_id_str = str(user.id)
    user_name_str = user.username
    db.close()

    response = client.get("/protected", cookies={settings.session_cookie_name: raw_token})
    assert response.status_code == 200
    assert response.json()["user_id"] == user_id_str
    assert response.json()["username"] == user_name_str

def test_get_current_user_no_cookie():
    response = client.get("/protected")
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"

def test_get_current_user_invalid_cookie():
    response = client.get("/protected", cookies={settings.session_cookie_name: "invalid_token_123"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"

def test_get_current_user_revoked_session():
    db = TestingSessionLocal()
    user = create_test_user(db)
    raw_token, session_model = create_session(db, user.id, timedelta(days=1))
    revoke_session(db, session_model.id)
    db.close()

    response = client.get("/protected", cookies={settings.session_cookie_name: raw_token})
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"

def test_get_current_user_expired_session():
    db = TestingSessionLocal()
    user = create_test_user(db)
    # create session that expired 1 day ago
    raw_token, session_model = create_session(db, user.id, timedelta(days=-1))
    db.close()

    response = client.get("/protected", cookies={settings.session_cookie_name: raw_token})
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"

def test_get_current_user_user_deleted():
    db = TestingSessionLocal()
    user = create_test_user(db)
    raw_token, session_model = create_session(db, user.id, timedelta(days=1))
    
    # Delete the user manually through db
    db.delete(user)
    db.commit()
    db.close()

    response = client.get("/protected", cookies={settings.session_cookie_name: raw_token})
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"
