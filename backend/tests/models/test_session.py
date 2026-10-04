import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.user import User
from app.models.session import Session


@pytest.fixture(scope="module")
def engine():
    # Use SQLite in-memory for testing the models
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

def test_session_association(db_session):
    user = User(
        username="testuser",
        email="test@example.com",
        password_hash="hash",
        first_name="Test",
        family_name="User"
    )
    db_session.add(user)
    db_session.commit()
    
    sess = Session(
        user_id=user.id,
        token_hash="hashed_token_here",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1)
    )
    db_session.add(sess)
    db_session.commit()
    
    assert sess.user == user
    assert sess in user.sessions

def test_session_unique_identifier(db_session):
    from sqlalchemy.exc import IntegrityError
    user = User(
        username="uniqueuser",
        email="unique@example.com",
        password_hash="hash",
        first_name="Test",
        family_name="User"
    )
    db_session.add(user)
    db_session.commit()

    sess1 = Session(
        user_id=user.id,
        token_hash="same_hash",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1)
    )
    db_session.add(sess1)
    db_session.commit()

    sess2 = Session(
        user_id=user.id,
        token_hash="same_hash",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1)
    )
    db_session.add(sess2)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

def test_session_revocation(db_session):
    user = User(
        username="revoketest",
        email="revoke@example.com",
        password_hash="hash",
        first_name="Test",
        family_name="User"
    )
    db_session.add(user)
    db_session.commit()
    
    sess = Session(
        user_id=user.id,
        token_hash="revoke_token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        is_revoked=True
    )
    db_session.add(sess)
    db_session.commit()
    
    assert sess.is_revoked is True

def test_deleting_user_deletes_sessions(db_session):
    user = User(
        username="deluser",
        email="del@example.com",
        password_hash="hash",
        first_name="Test",
        family_name="User"
    )
    db_session.add(user)
    db_session.commit()
    
    sess = Session(
        user_id=user.id,
        token_hash="del_token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1)
    )
    db_session.add(sess)
    db_session.commit()
    
    sess_id = sess.id
    # Check session exists
    assert db_session.query(Session).filter_by(id=sess_id).first() is not None
    
    db_session.delete(user)
    db_session.commit()
    
    # Session should be deleted by cascade
    assert db_session.query(Session).filter_by(id=sess_id).first() is None
