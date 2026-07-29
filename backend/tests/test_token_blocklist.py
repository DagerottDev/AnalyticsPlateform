"""Tests for the Redis-backed JWT revocation blocklist and its wiring into
get_current_user (app.core.security.ensure_not_revoked)."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.core.security import ensure_not_revoked
from app.services.token_blocklist import RedisTokenBlocklist


def _make_blocklist() -> RedisTokenBlocklist:
    with patch("app.services.token_blocklist.redis.from_url"):
        return RedisTokenBlocklist("redis://localhost:6380/0")


@pytest.mark.asyncio
async def test_revoke_sets_a_ttl_matching_remaining_lifetime() -> None:
    blocklist = _make_blocklist()
    blocklist._client.set = AsyncMock()

    expires_at = datetime.now(UTC) + timedelta(minutes=10)
    await blocklist.revoke("jti-123", expires_at)

    args, kwargs = blocklist._client.set.call_args
    assert args[0] == "revoked_jwt:jti-123"
    assert 590 <= kwargs["ex"] <= 600


@pytest.mark.asyncio
async def test_revoke_floors_ttl_at_one_second_for_already_expired_tokens() -> None:
    blocklist = _make_blocklist()
    blocklist._client.set = AsyncMock()

    await blocklist.revoke("jti-123", datetime.now(UTC) - timedelta(minutes=5))

    _, kwargs = blocklist._client.set.call_args
    assert kwargs["ex"] == 1


@pytest.mark.asyncio
async def test_revoke_swallows_redis_errors() -> None:
    """A Redis outage shouldn't break logout — the broker session is torn
    down regardless (see auth.logout)."""
    blocklist = _make_blocklist()
    blocklist._client.set = AsyncMock(side_effect=ConnectionError("down"))

    await blocklist.revoke("jti-123", datetime.now(UTC) + timedelta(minutes=10))  # must not raise


@pytest.mark.asyncio
async def test_is_revoked_true_when_present() -> None:
    blocklist = _make_blocklist()
    blocklist._client.exists = AsyncMock(return_value=1)
    assert await blocklist.is_revoked("jti-123") is True


@pytest.mark.asyncio
async def test_is_revoked_false_when_absent() -> None:
    blocklist = _make_blocklist()
    blocklist._client.exists = AsyncMock(return_value=0)
    assert await blocklist.is_revoked("jti-123") is False


@pytest.mark.asyncio
async def test_is_revoked_fails_open_on_redis_error() -> None:
    """A Redis outage degrades revocation (defense-in-depth) rather than
    locking every authenticated user out of the app."""
    blocklist = _make_blocklist()
    blocklist._client.exists = AsyncMock(side_effect=ConnectionError("down"))
    assert await blocklist.is_revoked("jti-123") is False


@pytest.mark.asyncio
async def test_ensure_not_revoked_passes_through_when_not_revoked() -> None:
    blocklist = _make_blocklist()
    blocklist._client.exists = AsyncMock(return_value=0)
    await ensure_not_revoked({"sub": "X", "jti": "jti-123"}, blocklist)  # must not raise


@pytest.mark.asyncio
async def test_ensure_not_revoked_raises_401_when_revoked() -> None:
    blocklist = _make_blocklist()
    blocklist._client.exists = AsyncMock(return_value=1)

    with pytest.raises(HTTPException) as exc_info:
        await ensure_not_revoked({"sub": "X", "jti": "jti-123"}, blocklist)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Token has been revoked"


@pytest.mark.asyncio
async def test_ensure_not_revoked_lets_tokens_without_a_jti_through() -> None:
    """Covers any token issued before this feature existed — it can't be
    checked against the blocklist, so it's let through rather than crashing."""
    blocklist = _make_blocklist()
    blocklist._client.exists = AsyncMock()

    await ensure_not_revoked({"sub": "X"}, blocklist)  # must not raise
    blocklist._client.exists.assert_not_called()
