from fastapi import APIRouter

from app.api.v1.endpoints import auth, avatars, communities, modules, documents, announcements, documents_global, community_posts, discussion, stickers, module_resources

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(avatars.router, tags=["avatars"])
api_router.include_router(stickers.router, tags=["stickers"])
api_router.include_router(communities.router, prefix="/communities", tags=["communities"])
api_router.include_router(modules.router, prefix="/communities", tags=["modules"])
api_router.include_router(documents.router, prefix="/communities", tags=["documents"])
api_router.include_router(module_resources.router, prefix="/communities", tags=["module_resources"])
api_router.include_router(documents_global.router, prefix="/documents", tags=["documents"])
api_router.include_router(announcements.router, prefix="/communities", tags=["announcements"])
api_router.include_router(community_posts.router, prefix="/communities", tags=["community_posts"])
api_router.include_router(discussion.router, prefix="/communities", tags=["discussion"])
