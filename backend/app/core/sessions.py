import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.session import Session


def _generate_raw_token() -> str:
    """Generate a high-entropy cryptographically secure random string."""
    # 32 bytes of randomness encoded in base64 results in 43 characters
    return secrets.token_urlsafe(32)


def _hash_token(raw_token: str) -> str:
    """Deterministically hash the raw token using SHA-256 for database lookup.
    
    This prevents the database from storing the credential that grants access,
    meaning a database dump alone doesn't compromise active user sessions.
    """
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def create_session(
    db: DBSession, user_id: UUID, lifetime: timedelta
) -> Tuple[str, Session]:
    """Create a new database-backed session for a user.

    Args:
        db: The database session.
        user_id: The UUID of the user.
        lifetime: How long the session should remain valid.

    Returns:
        A tuple containing the raw session credential (to be set as a cookie)
        and the created Session model instance.
    """
    raw_token = _generate_raw_token()
    token_hash = _hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + lifetime

    db_session = Session(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)

    return raw_token, db_session


def validate_session(db: DBSession, raw_token: str) -> Optional[Session]:
    """Validate a raw session credential and retrieve the corresponding Session.

    Args:
        db: The database session.
        raw_token: The raw credential presented by the client.

    Returns:
        The valid Session object if found and active, or None if invalid.
    """
    token_hash = _hash_token(raw_token)

    db_session = db.query(Session).filter(Session.token_hash == token_hash).first()

    if db_session is None:
        return None

    if db_session.is_revoked:
        return None

    expires_at = db_session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(timezone.utc):
        return None

    return db_session


def revoke_session(db: DBSession, session_id: UUID) -> bool:
    """Revoke a specific session.

    Args:
        db: The database session.
        session_id: The UUID of the session to revoke.

    Returns:
        True if the session was found and revoked, False if it wasn't found.
    """
    db_session = db.query(Session).filter(Session.id == session_id).first()
    if db_session:
        db_session.is_revoked = True
        db.commit()
        return True
    return False
