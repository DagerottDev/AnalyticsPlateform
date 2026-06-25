"""Custom exception classes and FastAPI exception handlers.

Provides structured error responses across the API.
"""

from typing import Any

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse


class OpenAlgoConnectionError(Exception):
    """Raised when the connection to OpenAlgo fails."""

    def __init__(self, message: str = "Unable to connect to OpenAlgo") -> None:
        self.message = message
        super().__init__(self.message)


class OpenAlgoAuthError(Exception):
    """Raised when OpenAlgo API key validation fails."""

    def __init__(self, message: str = "Invalid OpenAlgo API key") -> None:
        self.message = message
        super().__init__(self.message)


class BrokerNotConnectedError(Exception):
    """Raised when broker operations are attempted without an active connection."""

    def __init__(self, message: str = "Broker not connected") -> None:
        self.message = message
        super().__init__(self.message)


async def openalgo_connection_error_handler(
    request: Request,
    exc: OpenAlgoConnectionError,
) -> JSONResponse:
    """Handle OpenAlgo connection errors."""
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": exc.message,
            "error_type": "openalgo_connection_error",
        },
    )


async def openalgo_auth_error_handler(
    request: Request,
    exc: OpenAlgoAuthError,
) -> JSONResponse:
    """Handle OpenAlgo authentication errors."""
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={
            "detail": exc.message,
            "error_type": "openalgo_auth_error",
        },
    )


def register_exception_handlers(app: Any) -> None:
    """Register all custom exception handlers on the FastAPI app.

    Args:
        app: The FastAPI application instance.
    """
    app.add_exception_handler(OpenAlgoConnectionError, openalgo_connection_error_handler)
    app.add_exception_handler(OpenAlgoAuthError, openalgo_auth_error_handler)
