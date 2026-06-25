"""Health check endpoint.

Provides a simple health check for monitoring and Docker health probes.
"""

from fastapi import APIRouter

from app.config import get_settings
from app.schemas.auth import HealthResponse

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health Check",
    description="Returns the health status of the API service.",
)
async def health_check() -> HealthResponse:
    """Check if the API service is healthy.

    Returns:
        HealthResponse with status, version, and environment.
    """
    settings = get_settings()
    return HealthResponse(
        status="healthy",
        version=settings.app_version,
        environment=settings.app_env,
    )
