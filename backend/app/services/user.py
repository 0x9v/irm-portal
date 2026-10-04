from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import User
from app.schemas.user import UserCreate


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
