"""Atomic own-account password replacement and account-wide session revocation."""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.core.security import hash_password, verify_password
from app.core.sessions import validate_session
from app.models.session import Session as AccountSession
from app.models.user import User
from app.schemas.user import UserPasswordChange


def change_password(
    db: DBSession, user_id: UUID, raw_token: str, password_in: UserPasswordChange
) -> None:
    """Lock fresh account/session state and commit hash plus revocations together."""
    try:
        user = (
            db.query(User).filter(User.id == user_id)
            .populate_existing().with_for_update().one_or_none()
        )
        if user is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

        # The dependency may have observed a now-revoked session. Refresh and
        # lock its row after acquiring the User lock before trusting it again.
        session = validate_session(db, raw_token, refresh=True, lock=True)
        if session is None or session.user_id != user_id:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

        if not verify_password(password_in.current_password, user.password_hash):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect.")
        if password_in.new_password == password_in.current_password:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, [{
                "loc": ["body", "new_password"],
                "type": "password_unchanged",
                "msg": "New password must differ from the current password",
            }])

        user.password_hash = hash_password(password_in.new_password)
        db.query(AccountSession).filter(AccountSession.user_id == user_id).update(
            {AccountSession.is_revoked: True}, synchronize_session=False
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
