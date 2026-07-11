"""CORS middleware configuration.

Provides configurable CORS settings based on the application environment.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings


def setup_cors(app: FastAPI) -> None:
    """Configure CORS middleware on the FastAPI application.

    In development, allows all origins for ease of testing.
    In production, restricts to configured origins only.

    Args:
        app: The FastAPI application instance.
    """
    settings = get_settings()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["X-Total-Count", "X-Request-Id"],
        max_age=600,  # Cache preflight for 10 minutes
    )
