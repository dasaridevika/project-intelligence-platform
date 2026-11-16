from fastapi import APIRouter
from app.api.v1.analytics import router as analytics_router
from app.api.v1.auth import router as auth_router
from app.api.v1.monitoring import router as monitoring_router
from app.api.v1.projects import router as projects_router
from app.api.v1.search import router as search_router
from app.api.v1.sectors import router as sectors_router

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(auth_router)
api_v1_router.include_router(search_router)
api_v1_router.include_router(projects_router)
api_v1_router.include_router(sectors_router)
api_v1_router.include_router(analytics_router)
api_v1_router.include_router(monitoring_router)
