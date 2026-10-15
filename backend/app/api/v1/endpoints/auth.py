from datetime import timedelta
from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api.account_mutation_route import AccountMutationRoute
from app.core.config import settings
from app.core.sessions import create_session, revoke_session, validate_session
from app.database.session import get_db
from app.schemas.user import UserCreate, UserLogin, UserPasswordChange, UserProfileUpdate, UserResponse
from app.services.auth import authenticate_user
from app.services.password import change_password
from app.services.user import create_user, update_user_profile

router = APIRouter()

from app.api.deps import get_current_user
from app.models.user import User

@router.get(
    "/me",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Get current user",
)
def get_me(
    response: Response,
    current_user: User = Depends(get_current_user)
):
    """
    Get the currently authenticated user.
    """
    response.headers["Cache-Control"] = "private, no-store"
    return current_user


def patch_me(
    profile_in: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update only the caller's username and account names."""
    return update_user_profile(db=db, user_id=current_user.id, profile_in=profile_in)


router.add_api_route(
    "/me",
    patch_me,
    methods=["PATCH"],
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Update the authenticated user's profile",
    route_class_override=AccountMutationRoute,
)


def post_me_password(
    password_in: UserPasswordChange,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace this account's password and end all of its sessions."""
    change_password(
        db, current_user.id, request.cookies[settings.session_cookie_name], password_in
    )
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
    )
    return response


router.add_api_route(
    "/me/password",
    post_me_password,
    methods=["POST"],
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change the authenticated user's password",
    route_class_override=AccountMutationRoute,
)


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    """
    Create a new platform account.
    """
    user = create_user(db=db, user_in=user_in)
    return user

@router.post(
    "/login",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Log in a user",
)
def login(
    login_in: UserLogin, 
    response: Response, 
    db: Session = Depends(get_db)
):
    """
    Authenticate a user and create a session cookie.
    """
    user = authenticate_user(db=db, login_in=login_in)
    
    lifetime = timedelta(days=settings.session_lifetime_days)
    raw_token, session_model = create_session(
        db=db, 
        user_id=user.id, 
        lifetime=lifetime
    )
    
    response.set_cookie(
        key=settings.session_cookie_name,
        value=raw_token,
        max_age=int(lifetime.total_seconds()),
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )
    
    return user

@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="Log out a user",
)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """
    Log out a user by revoking their session and clearing the cookie.
    """
    raw_token = request.cookies.get(settings.session_cookie_name)
    
    if raw_token:
        session_model = validate_session(db, raw_token)
        if session_model:
            revoke_session(db, session_model.id)
            
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
    )
    
    return {"detail": "Successfully logged out"}
