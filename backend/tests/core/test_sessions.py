import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from uuid import uuid4

from app.database import Base
from app.models.user import User
from app.models.session import Session as SessionModel
from app.core.sessions import create_session, validate_session, revoke_session, _hash_token


@pytest.fixture(scope="module")
def engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session(engine):
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def test_user(db_session):
    user = User(
        username=f"testuser_{uuid4()}",
        email=f"test_{uuid4()}@example.com",
        password_hash="hash",
        first_name="Test",
        family_name="User"
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_create_session_returns_raw_credential(db_session, test_user):
    lifetime = timedelta(hours=1)
    raw_token, session_model = create_session(db_session, test_user.id, lifetime)
    
    assert isinstance(raw_token, str)
    assert len(raw_token) > 20
    assert session_model.id is not None


def test_raw_credential_not_stored_directly(db_session, test_user):
    raw_token, session_model = create_session(db_session, test_user.id, timedelta(hours=1))
    
    # Ensure the token_hash is not the raw token
    assert session_model.token_hash != raw_token
    # And ensure the raw token doesn't appear in the token_hash at all
    assert raw_token not in session_model.token_hash
    # Confirm it is stored as the hash
    assert session_model.token_hash == _hash_token(raw_token)


def test_successful_validation(db_session, test_user):
    raw_token, session_model = create_session(db_session, test_user.id, timedelta(hours=1))
    
    validated_session = validate_session(db_session, raw_token)
    assert validated_session is not None
    assert validated_session.id == session_model.id
    assert validated_session.user_id == test_user.id


def test_wrong_credential_fails(db_session, test_user):
    raw_token, session_model = create_session(db_session, test_user.id, timedelta(hours=1))
    
    # Attempt validation with wrong token
    wrong_token = raw_token + "a"
    validated_session = validate_session(db_session, wrong_token)
    
    assert validated_session is None


def test_revoked_session_fails(db_session, test_user):
    raw_token, session_model = create_session(db_session, test_user.id, timedelta(hours=1))
    
    # Explicitly revoke
    assert revoke_session(db_session, session_model.id) is True
    
    # Validation should now fail
    validated_session = validate_session(db_session, raw_token)
    assert validated_session is None


def test_expired_session_fails(db_session, test_user):
    # Create a session that expired 1 second ago
    raw_token, session_model = create_session(db_session, test_user.id, timedelta(seconds=-1))
    
    validated_session = validate_session(db_session, raw_token)
    assert validated_session is None


def test_different_sessions_receive_different_credentials(db_session, test_user):
    token1, sess1 = create_session(db_session, test_user.id, timedelta(hours=1))
    token2, sess2 = create_session(db_session, test_user.id, timedelta(hours=1))
    
    assert token1 != token2
    assert sess1.token_hash != sess2.token_hash
    assert sess1.id != sess2.id
