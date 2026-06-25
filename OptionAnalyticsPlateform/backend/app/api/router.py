"""Central API router.

Aggregates all versioned API routers into a single router
mounted at /api in the main application.
"""

from fastapi import APIRouter

from app.api.v1 import auth, health, market, historical, volatility

api_router = APIRouter()

# V1 routes
api_router.include_router(health.router, prefix="/v1/health", tags=["health"])
api_router.include_router(auth.router, prefix="/v1/auth", tags=["auth"])
api_router.include_router(market.router, prefix="/v1/market", tags=["market"])
api_router.include_router(historical.router, prefix="/v1/historical", tags=["historical"])
api_router.include_router(volatility.router, prefix="/v1/volatility", tags=["volatility"])
