"""Small in-memory HTTP rate limiter for protecting API and broker capacity."""

import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import Settings


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Fixed-window limiter keyed by client IP and request class."""

    def __init__(self, app: Callable[..., Awaitable[None]], settings: Settings) -> None:
        super().__init__(app)
        self.settings = settings
        self._requests: dict[str, deque[float]] = defaultdict(deque)

    def _bucket(self, path: str) -> tuple[str, int]:
        if path.startswith("/api/v1/auth/"):
            return "auth", self.settings.api_rate_limit_auth_requests
        if path.startswith(("/api/v1/market/", "/api/v1/volatility/", "/api/v1/portfolio/")):
            return "broker", self.settings.api_rate_limit_broker_requests
        return "api", self.settings.api_rate_limit_default_requests

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if (
            not self.settings.api_rate_limit_enabled
            or request.method == "OPTIONS"
            or request.url.path.endswith("/health")
        ):
            return await call_next(request)
        client_ip = request.client.host if request.client else "unknown"
        bucket, limit = self._bucket(request.url.path)
        key = f"{client_ip}:{bucket}"
        now = time.monotonic()
        window = self.settings.api_rate_limit_window_seconds
        history = self._requests[key]
        while history and history[0] <= now - window:
            history.popleft()
        remaining = max(0, limit - len(history))
        if len(history) >= limit:
            retry_after = max(1, int(window - (now - history[0])) + 1)
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Rate limit exceeded. Please retry shortly.",
                    "error_type": "rate_limit_exceeded",
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                },
            )
        history.append(now)
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, remaining - 1))
        return response
