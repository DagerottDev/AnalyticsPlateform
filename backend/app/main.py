"""FastAPI application entry point.

Creates the FastAPI app with middleware, routers, and lifespan management.
"""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.db.session import async_session_maker
from app.services.broker_session_store import restore_broker_session
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager.

    Handles startup and shutdown events for resources like
    database connections, Redis pools, etc.
    """
    settings = get_settings()
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
    yield
    # Shutdown
    await session_manager.clear()
    logger.info("Shutting down %s", settings.app_title)


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_title,
        version=settings.app_version,
        description="Production-grade Indian options analytics platform",
        docs_url="/api/docs" if settings.is_development else None,
        redoc_url="/api/redoc" if settings.is_development else None,
        openapi_url="/api/openapi.json" if settings.is_development else None,
        lifespan=lifespan,
    )

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    # Include API router
    app.include_router(api_router, prefix="/api")

    return app


app: FastAPI = create_app()
