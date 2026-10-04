from fastapi import APIRouter

from app.api.v1.endpoints import auth, communities, modules, documents, announcements, documents_global

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(communities.router, prefix="/communities", tags=["communities"])
api_router.include_router(modules.router, prefix="/communities", tags=["modules"])
api_router.include_router(documents.router, prefix="/communities", tags=["documents"])
api_router.include_router(documents_global.router, prefix="/documents", tags=["documents"])
api_router.include_router(announcements.router, prefix="/communities", tags=["announcements"])
