from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import User
from app.schemas.user import UserCreate, UserProfileUpdate


def create_user(db: Session, user_in: UserCreate) -> User:
    try:
        user = User(
            username=user_in.username,
            email=user_in.email,
            password_hash=hash_password(user_in.password),
            first_name=user_in.first_name,
            family_name=user_in.family_name,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    except IntegrityError as e:
        db.rollback()
        # Handle unique constraint violations dynamically
        error_msg = str(e.orig).lower() if e.orig else str(e).lower()
        if "username" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username is already taken.",
            )
        elif "email" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email is already registered.",
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Account creation failed due to a conflict.",
            )


def _is_username_unique_violation(error: IntegrityError) -> bool:
    original = error.orig
    diagnostic = getattr(original, "diag", None)
    sqlstate = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
    constraint_name = getattr(diagnostic, "constraint_name", None)
    if sqlstate == "23505" and constraint_name == "uq_users_username":
        return True

    # SQLite does not expose PostgreSQL's constraint diagnostics. Keep its
    # fallback exact so unrelated unique violations are never mislabeled.
    return str(original) == "UNIQUE constraint failed: users.username"


def update_user_profile(
    db: Session,
    user_id,
    profile_in: UserProfileUpdate,
) -> User:
    """Atomically update only supplied profile fields on the locked User row."""
    supplied = profile_in.model_dump(exclude_unset=True)
    try:
        user = (
            db.query(User)
            .filter(User.id == user_id)
            .populate_existing()
            .with_for_update()
            .one_or_none()
        )
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
            )

        changed = {
            field: value
            for field, value in supplied.items()
            if getattr(user, field) != value
        }
        if not changed:
            return user

        # Never assign omitted columns; concurrent updates to them survive.
        for field, value in changed.items():
            setattr(user, field, value)

        db.commit()
        db.refresh(user)
        return user
    except IntegrityError as exc:
        db.rollback()
        if _is_username_unique_violation(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username is already taken.",
            ) from None
        raise
    except Exception:
        db.rollback()
        raise
