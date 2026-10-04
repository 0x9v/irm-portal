from typing import Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.core.security import verify_password
from app.models.user import User
from app.schemas.user import UserLogin


def authenticate_user(db: Session, login_in: UserLogin) -> User:
    """
    Authenticate a user by email and password.
    Returns the User object if successful.
    Raises an HTTPException (401) if authentication fails.
    """
    user = db.query(User).filter(User.email == login_in.email).first()
    
    # Generic error message so we don't leak whether the email exists
    auth_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect email or password",
    )
    
    if not user:
        raise auth_exception
        
    if not verify_password(login_in.password, user.password_hash):
        raise auth_exception
        
    return user
