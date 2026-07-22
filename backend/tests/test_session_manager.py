"""Tests for SessionManager's single-session-process-wide behavior.

Documents the existing (intentional, not a bug) behavior: only one broker
session is active at a time — a second login evicts the first, closing its
service and making it unreachable via its original client_id.
"""

from unittest.mock import AsyncMock

import pytest

from app.services.session_manager import SessionManager


@pytest.fixture
def manager() -> SessionManager:
    return SessionManager()


@pytest.mark.asyncio
async def test_get_session_returns_none_when_nothing_set(manager: SessionManager) -> None:
    assert manager.get_session("CLIENT_A") is None


@pytest.mark.asyncio
async def test_set_and_get_session_roundtrip(manager: SessionManager) -> None:
    service = AsyncMock()
    await manager.set_session("CLIENT_A", service)
    assert manager.get_session("CLIENT_A") is service


@pytest.mark.asyncio
async def test_get_session_returns_none_for_a_different_client_id(manager: SessionManager) -> None:
    service = AsyncMock()
    await manager.set_session("CLIENT_A", service)
    assert manager.get_session("CLIENT_B") is None


@pytest.mark.asyncio
async def test_second_login_evicts_the_first_session(manager: SessionManager) -> None:
    """Only one broker session is active process-wide — a second login
    replaces the first, and the first client_id can no longer reach it."""
    service_a = AsyncMock()
    service_b = AsyncMock()

    await manager.set_session("CLIENT_A", service_a)
    await manager.set_session("CLIENT_B", service_b)

    assert manager.get_session("CLIENT_A") is None
    assert manager.get_session("CLIENT_B") is service_b
    service_a.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_clear_closes_and_removes_the_active_session(manager: SessionManager) -> None:
    service = AsyncMock()
    await manager.set_session("CLIENT_A", service)
    await manager.clear()
    assert manager.get_session("CLIENT_A") is None
    service.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_remove_session_only_affects_the_matching_client_id(manager: SessionManager) -> None:
    service = AsyncMock()
    await manager.set_session("CLIENT_A", service)

    await manager.remove_session("CLIENT_B")  # no-op, different client
    assert manager.get_session("CLIENT_A") is service

    await manager.remove_session("CLIENT_A")
    assert manager.get_session("CLIENT_A") is None
    service.close.assert_awaited_once()
