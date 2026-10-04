from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.community import Community
from app.models.module import Module


def get_community_modules(db: Session, community_slug: str) -> list[Module]:
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )
        
    modules = db.query(Module).filter(
        Module.community_id == community.id
    ).order_by(Module.name.asc()).all()
    
    return modules


def get_community_module(db: Session, community_slug: str, module_slug: str) -> Module:
    community = db.query(Community).filter(Community.slug == community_slug).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )
        
    module = db.query(Module).filter(
        Module.community_id == community.id,
        Module.slug == module_slug
    ).first()
    
    if not module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Module not found"
        )
        
    return module
