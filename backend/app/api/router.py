"""Central API router.

Aggregates all versioned API routers into a single router
mounted at /api in the main application.
"""

from fastapi import APIRouter

from app.api.v1 import (
    alerts,
    auth,
    greeks,
    health,
    historical,
    market,
    orders,
    portfolio,
    trade_journal,
    volatility,
)

api_router = APIRouter()

# V1 routes
# Each sub-router already declares its own path prefix (e.g. "/auth", "/market"),
# so only the shared "/v1" version prefix is added here.
api_router.include_router(health.router, prefix="/v1")
api_router.include_router(auth.router, prefix="/v1")
api_router.include_router(market.router, prefix="/v1")
api_router.include_router(historical.router, prefix="/v1")
api_router.include_router(volatility.router, prefix="/v1")
api_router.include_router(greeks.router, prefix="/v1")
api_router.include_router(alerts.router, prefix="/v1")
api_router.include_router(portfolio.router, prefix="/v1")
api_router.include_router(orders.router, prefix="/v1")
api_router.include_router(trade_journal.router, prefix="/v1")
