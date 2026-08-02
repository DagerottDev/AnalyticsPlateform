"""Custom exception classes and FastAPI exception handlers.

Provides structured error responses across the API.
"""

import logging
from typing import Any

from fastapi import Request, status
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


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


def is_broker_auth_error(exc: BaseException) -> bool:
    """Return whether an exception indicates an expired/invalid broker token.

    Broker adapters do not all expose authentication failures through the same
    exception type.  In particular, older Fyers paths wrapped a ``-15``
    response (``Please provide valid token``) in ``BrokerConnectionError``.
    Background jobs use this predicate to invalidate a persisted session once
    instead of retrying every symbol on every scheduler pass.
    """
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, BrokerAuthError):
            return True
        current = current.__cause__ or current.__context__

    message = str(exc).lower()
    auth_phrases = (
        "valid token",
        "invalid token",
        "token expired",
        "token has expired",
        "access token is invalid",
        "could not authenticate",
        "authentication failed",
        "unauthorized",
    )
    if any(phrase in message for phrase in auth_phrases):
        return True

    # Fyers uses -15/-16 for invalid or unauthenticated sessions.  Match the
    # code only when it appears as a response field, avoiding false positives
    # for unrelated exception text that happens to contain a negative number.
    return any(
        marker in message
        for marker in (
            "'code': -15",
            '"code": -15',
            "code=-15",
            "'code': -16",
            '"code": -16',
            "code=-16",
        )
    )


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
            "request_id": getattr(request.state, "request_id", None),
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
            "request_id": getattr(request.state, "request_id", None),
        },
    )


def register_exception_handlers(app: Any) -> None:
    """Register all custom exception handlers on the FastAPI app.

    Args:
        app: The FastAPI application instance.
    """
    app.add_exception_handler(BrokerConnectionError, broker_connection_error_handler)
    app.add_exception_handler(BrokerAuthError, broker_auth_error_handler)
