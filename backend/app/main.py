"""FastAPI application entry point.

Creates the FastAPI app with middleware, routers, and lifespan management.
"""

import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.config import Settings, get_settings
from app.core.exceptions import register_exception_handlers
from app.core.observability import configure_observability
from app.db.session import async_session_maker
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.request_id import RequestIdMiddleware
from app.services.alert_evaluator import alert_evaluation_loop
from app.services.basket_monitor import basket_monitor_loop
from app.services.broker_session_store import restore_broker_session
from app.services.gtt_monitor import gtt_monitor_loop
from app.services.iv_universe_backfill import iv_universe_backfill_loop
from app.services.market_data_backfill import market_data_backfill_loop
from app.services.nse_participant_backfill import participant_data_loop
from app.services.open_interest_snapshots import open_interest_snapshot_loop
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager.

    Handles startup and shutdown events for resources like
    database connections, Redis pools, etc.
    """
    settings: Settings = app.state.settings
    # Startup
    logger.info("Starting %s v%s", settings.app_title, settings.app_version)
    logger.info("Environment: %s", settings.app_env)
    try:
        async with async_session_maker() as db:
            await restore_broker_session(db, settings)
    except Exception:
        # A DB outage (e.g. Postgres not up yet in dev) shouldn't block
        # startup — it just means the user logs in as normal, same as
        # before this restore step existed.
        logger.exception("Could not restore persisted broker session; continuing without one.")
    backfill_stop_event = asyncio.Event()
    backfill_task: asyncio.Task[None] | None = None
    if settings.market_data_backfill_enabled:
        backfill_task = asyncio.create_task(
            market_data_backfill_loop(settings, backfill_stop_event),
            name="market-data-backfill",
        )
    alert_stop_event = asyncio.Event()
    alert_task: asyncio.Task[None] | None = None
    if settings.alert_evaluation_enabled:
        alert_task = asyncio.create_task(
            alert_evaluation_loop(settings, alert_stop_event), name="alert-evaluation"
        )
    iv_universe_stop_event = asyncio.Event()
    iv_universe_task: asyncio.Task[None] | None = None
    if settings.iv_universe_backfill_enabled:
        iv_universe_task = asyncio.create_task(
            iv_universe_backfill_loop(settings, iv_universe_stop_event),
            name="iv-universe-backfill",
        )
    basket_monitor_stop_event = asyncio.Event()
    basket_monitor_task: asyncio.Task[None] | None = None
    if settings.basket_monitor_enabled:
        basket_monitor_task = asyncio.create_task(
            basket_monitor_loop(settings, basket_monitor_stop_event),
            name="basket-monitor",
        )
    gtt_stop_event = asyncio.Event()
    gtt_task = asyncio.create_task(gtt_monitor_loop(settings, gtt_stop_event), name="gtt-monitor")
    open_interest_stop_event = asyncio.Event()
    open_interest_task: asyncio.Task[None] | None = None
    if settings.open_interest_snapshot_enabled:
        open_interest_task = asyncio.create_task(
            open_interest_snapshot_loop(settings, open_interest_stop_event),
            name="open-interest-snapshots",
        )
    participant_data_stop_event = asyncio.Event()
    participant_data_task: asyncio.Task[None] | None = None
    if settings.participant_data_enabled:
        participant_data_task = asyncio.create_task(
            participant_data_loop(settings, participant_data_stop_event),
            name="nse-participant-data",
        )
    yield
    # Shutdown
    backfill_stop_event.set()
    if backfill_task is not None:
        await backfill_task
    alert_stop_event.set()
    if alert_task is not None:
        await alert_task
    iv_universe_stop_event.set()
    if iv_universe_task is not None:
        await iv_universe_task
    basket_monitor_stop_event.set()
    if basket_monitor_task is not None:
        await basket_monitor_task
    gtt_stop_event.set()
    await gtt_task
    open_interest_stop_event.set()
    if open_interest_task is not None:
        await open_interest_task
    participant_data_stop_event.set()
    if participant_data_task is not None:
        await participant_data_task
    await session_manager.clear()
    logger.info("Shutting down %s", settings.app_title)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = settings or get_settings()
    configure_observability(settings)

    app = FastAPI(
        title=settings.app_title,
        version=settings.app_version,
        description="Production-grade Indian options analytics platform",
        docs_url="/api/docs" if settings.is_development else None,
        redoc_url="/api/redoc" if settings.is_development else None,
        openapi_url="/api/openapi.json" if settings.is_development else None,
        lifespan=lifespan,
    )
    app.state.settings = settings

    # Register the limiter first, so CORS is the outer layer and also adds
    # browser-readable headers to 429 responses generated by the limiter.
    app.add_middleware(RateLimitMiddleware, settings=settings)
    app.add_middleware(RequestIdMiddleware)

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
    )

    register_exception_handlers(app)

    # Include API router
    app.include_router(api_router, prefix="/api")

    return app


app: FastAPI = create_app()
