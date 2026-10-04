from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.schemas.module import ModuleResponse
from app.services.module import get_community_module, get_community_modules

router = APIRouter()

@router.get(
    "/{community_slug}/modules",
    response_model=list[ModuleResponse],
    status_code=status.HTTP_200_OK,
    summary="List community modules",
)
def list_community_modules(
    community_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List all modules in a community.
    Any authenticated user can view the module list.
    """
    return get_community_modules(db, community_slug)


@router.get(
    "/{community_slug}/modules/{module_slug}",
    response_model=ModuleResponse,
    status_code=status.HTTP_200_OK,
    summary="Get community module",
)
def get_single_community_module(
    community_slug: str,
    module_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retrieve a specific module within a community by slug.
    Any authenticated user can view module details.
    """
    return get_community_module(db, community_slug, module_slug)
