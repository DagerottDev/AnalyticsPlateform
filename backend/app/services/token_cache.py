"""In-memory TTL cache for broker access tokens.

Reused across auto-login flows so repeated login attempts within the
token's validity window don't re-trigger the broker's login endpoints.
"""

import time


class TokenCache:
    """Simple process-local TTL cache keyed by an arbitrary string."""

    def __init__(self) -> None:
        self._entries: dict[str, tuple[str, float]] = {}

    def get(self, key: str) -> str | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        token, expires_at = entry
        if time.monotonic() >= expires_at:
            del self._entries[key]
            return None
        return token

    def set(self, key: str, token: str, ttl_seconds: float) -> None:
        self._entries[key] = (token, time.monotonic() + ttl_seconds)


broker_token_cache = TokenCache()
