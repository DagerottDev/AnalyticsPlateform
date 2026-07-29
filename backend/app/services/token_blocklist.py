"""Redis-backed JWT revocation blocklist.

JWTs are stateless by design — a signed, unexpired token stays valid on its
own regardless of what the server does. Logout can't truly invalidate one
without an external record of "this token, no more": every issued token's
`jti` is recorded here on logout with a TTL matching its own remaining
lifetime, and every request checks the presented token's `jti` against this
set before trusting it (see app.core.security.ensure_not_revoked).
"""

import logging
from abc import ABC, abstractmethod
from datetime import datetime

import redis.asyncio as redis

from app.config import get_settings

logger = logging.getLogger(__name__)

_KEY_PREFIX = "revoked_jwt:"


class TokenBlocklist(ABC):
    """Abstract so tests can substitute an in-memory fake instead of
    requiring a real Redis instance."""

    @abstractmethod
    async def revoke(self, jti: str, expires_at: datetime) -> None:
        """Block `jti` until `expires_at` — no need to remember it any
        longer than the token would have been valid for anyway."""

    @abstractmethod
    async def is_revoked(self, jti: str) -> bool:
        """Whether `jti` has been revoked (e.g. via logout)."""


class RedisTokenBlocklist(TokenBlocklist):
    def __init__(self, redis_url: str) -> None:
        # from_url() doesn't connect eagerly — the actual TCP connection is
        # opened lazily on the first command, so constructing this is cheap
        # and safe even before Redis is reachable.
        self._client: redis.Redis = redis.from_url(redis_url, decode_responses=True)

    async def revoke(self, jti: str, expires_at: datetime) -> None:
        ttl_seconds = max(1, int((expires_at - datetime.now(expires_at.tzinfo)).total_seconds()))
        try:
            await self._client.set(f"{_KEY_PREFIX}{jti}", "1", ex=ttl_seconds)
        except Exception:
            # Logout still succeeds either way (the broker session is torn
            # down regardless — see auth.logout) but a Redis outage means
            # this specific token stays technically valid until it expires
            # on its own, same as before this feature existed.
            logger.exception("Failed to record JWT revocation for jti=%s", jti)

    async def is_revoked(self, jti: str) -> bool:
        try:
            return bool(await self._client.exists(f"{_KEY_PREFIX}{jti}"))
        except Exception:
            # Fail OPEN: the JWT's own signature and expiry are still fully
            # verified regardless of this check, so a Redis outage degrades
            # revocation (defense-in-depth) rather than taking down every
            # authenticated endpoint in the app.
            logger.warning("Token blocklist check failed open (Redis unreachable)", exc_info=True)
            return False


_instance: TokenBlocklist | None = None


def get_token_blocklist() -> TokenBlocklist:
    """FastAPI dependency — overridden with an in-memory fake in tests (see
    conftest.py) so the test suite doesn't require a real Redis instance."""
    global _instance
    if _instance is None:
        _instance = RedisTokenBlocklist(get_settings().redis_url)
    return _instance
