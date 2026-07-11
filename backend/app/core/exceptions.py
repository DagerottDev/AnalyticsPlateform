"""Custom exception classes and FastAPI exception handlers.

Provides structured error responses across the API.
"""

from typing import Any

from fastapi import Request, status
from fastapi.responses import JSONResponse


class BrokerConnectionError(Exception):
    """Raised when the connection to a broker's API fails."""

    def __init__(self, message: str = "Unable to connect to broker") -> None:
        self.message = message
        super().__init__(self.message)


class BrokerAuthError(Exception):
    """Raised when broker API credential validation fails."""

    def __init__(self, message: str = "Invalid broker credentials") -> None:
        self.message = message
        super().__init__(self.message)


class BrokerNotConnectedError(Exception):
    """Raised when broker operations are attempted without an active connection."""

    def __init__(self, message: str = "Broker not connected") -> None:
        self.message = message
        super().__init__(self.message)


async def broker_connection_error_handler(
    request: Request,
    exc: BrokerConnectionError,
) -> JSONResponse:
    """Handle broker connection errors."""
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": exc.message,
            "error_type": "broker_connection_error",
        },
    )


async def broker_auth_error_handler(
    request: Request,
    exc: BrokerAuthError,
) -> JSONResponse:
    """Handle broker authentication errors."""
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={
            "detail": exc.message,
            "error_type": "broker_auth_error",
        },
    )


def register_exception_handlers(app: Any) -> None:
    """Register all custom exception handlers on the FastAPI app.

    Args:
        app: The FastAPI application instance.
    """
    app.add_exception_handler(BrokerConnectionError, broker_connection_error_handler)
    app.add_exception_handler(BrokerAuthError, broker_auth_error_handler)
