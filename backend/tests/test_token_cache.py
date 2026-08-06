"""Tests for the in-memory TTL token cache used by the headless login flows."""

import pytest

from app.services.token_cache import TokenCache


def test_set_then_get_returns_the_cached_token() -> None:
    cache = TokenCache()
    cache.set("fyers:ABC", "token-123", ttl_seconds=60)

    assert cache.get("fyers:ABC") == "token-123"


def test_get_on_a_missing_key_returns_none() -> None:
    cache = TokenCache()

    assert cache.get("never-set") is None


def test_entry_expires_after_its_ttl_elapses(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = TokenCache()
    fake_now = [1000.0]
    monkeypatch.setattr("app.services.token_cache.time.monotonic", lambda: fake_now[0])

    cache.set("fyers:ABC", "token-123", ttl_seconds=30)
    fake_now[0] += 29.999
    assert cache.get("fyers:ABC") == "token-123"  # still just inside the window

    fake_now[0] += 0.002  # now 30.001s later — past the boundary
    assert cache.get("fyers:ABC") is None


def test_expired_entry_is_evicted_not_just_hidden(monkeypatch: pytest.MonkeyPatch) -> None:
    """A read past expiry must actually drop the stale entry, not merely
    return None while leaving it in memory — otherwise a long-lived process
    accumulates one dead entry per distinct cache key forever."""
    cache = TokenCache()
    fake_now = [1000.0]
    monkeypatch.setattr("app.services.token_cache.time.monotonic", lambda: fake_now[0])

    cache.set("fyers:ABC", "token-123", ttl_seconds=30)
    fake_now[0] += 31
    assert cache.get("fyers:ABC") is None
    assert "fyers:ABC" not in cache._entries


def test_setting_the_same_key_again_overwrites_the_previous_entry() -> None:
    cache = TokenCache()
    cache.set("fyers:ABC", "old-token", ttl_seconds=60)
    cache.set("fyers:ABC", "new-token", ttl_seconds=60)

    assert cache.get("fyers:ABC") == "new-token"


def test_different_keys_are_cached_independently() -> None:
    cache = TokenCache()
    cache.set("fyers:ABC", "token-abc", ttl_seconds=60)
    cache.set("dhan:XYZ", "token-xyz", ttl_seconds=60)

    assert cache.get("fyers:ABC") == "token-abc"
    assert cache.get("dhan:XYZ") == "token-xyz"
