"""Tests for FyersMarketStreamManager's refcounted subscribe/unsubscribe
and thread-safe tick dispatch, with FyersDataSocket itself mocked out
(no real network/websocket in these tests).

FyersDataSocket is only ever constructed lazily, inside subscribe() (via
_ensure_connected), so the patch context must stay open for the whole test
body — not just around manager construction.
"""

import asyncio
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from app.services.fyers_market_stream import FyersMarketStreamManager


@pytest.mark.asyncio
async def test_subscribe_before_connect_only_tracks_refcounts() -> None:
    """Before the socket has completed its handshake, subscribe() must not
    call through to the (not-yet-open) socket — on_connect flushes it."""
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_socket = MagicMock()
        mock_cls.return_value = mock_socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")

        manager.subscribe(["NSE:NIFTY50-INDEX"])

        mock_socket.connect.assert_called_once()
        mock_socket.subscribe.assert_not_called()


@pytest.mark.asyncio
async def test_on_connect_flushes_accumulated_subscriptions() -> None:
    """Once the connection opens, on_connect subscribes everything
    accumulated so far in one call."""
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_socket = MagicMock()
        mock_cls.return_value = mock_socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.subscribe(["NSE:NIFTY50-INDEX", "NSE:RELIANCE-EQ"])

        manager._on_connect()

        mock_socket.subscribe.assert_called_once()
        _, kwargs = mock_socket.subscribe.call_args
        assert set(kwargs["symbols"]) == {"NSE:NIFTY50-INDEX", "NSE:RELIANCE-EQ"}


@pytest.mark.asyncio
async def test_subscribe_after_connect_calls_socket_directly_for_new_symbols() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_socket = MagicMock()
        mock_cls.return_value = mock_socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.subscribe(["seed"])  # force _ensure_connected
        manager._on_connect()
        mock_socket.subscribe.reset_mock()

        manager.subscribe(["NSE:NIFTY50-INDEX"])

        mock_socket.subscribe.assert_called_once_with(
            symbols=["NSE:NIFTY50-INDEX"], data_type="SymbolUpdate"
        )


@pytest.mark.asyncio
async def test_second_subscriber_for_same_symbol_does_not_resubscribe_upstream() -> None:
    """Two listeners both wanting the same symbol should only hit Fyers once."""
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_socket = MagicMock()
        mock_cls.return_value = mock_socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.subscribe(["NSE:NIFTY50-INDEX"])
        manager._on_connect()
        mock_socket.subscribe.reset_mock()

        manager.subscribe(["NSE:NIFTY50-INDEX"])

        mock_socket.subscribe.assert_not_called()


@pytest.mark.asyncio
async def test_unsubscribe_only_drops_upstream_when_refcount_hits_zero() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_socket = MagicMock()
        mock_cls.return_value = mock_socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.subscribe(["NSE:NIFTY50-INDEX"])
        manager._on_connect()
        manager.subscribe(["NSE:NIFTY50-INDEX"])  # second interested listener

        manager.unsubscribe(["NSE:NIFTY50-INDEX"])
        mock_socket.unsubscribe.assert_not_called()  # still one listener left

        manager.unsubscribe(["NSE:NIFTY50-INDEX"])
        mock_socket.unsubscribe.assert_called_once_with(
            symbols=["NSE:NIFTY50-INDEX"], data_type="SymbolUpdate"
        )


@pytest.mark.asyncio
async def test_on_message_dispatches_to_listeners_via_the_event_loop() -> None:
    """on_message is invoked from the SDK's background thread in real usage;
    this confirms the call_soon_threadsafe dispatch actually reaches
    listeners registered on the asyncio loop."""
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_cls.return_value = MagicMock()
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.bind_loop()
        manager.subscribe(["NSE:NIFTY50-INDEX"])

        received: list[dict[str, Any]] = []
        manager.add_listener(received.append)

        manager._on_message({"symbol": "NSE:NIFTY50-INDEX", "ltp": 100.5})
        await asyncio.sleep(0)  # let the scheduled call_soon_threadsafe callback run

        assert received == [{"symbol": "NSE:NIFTY50-INDEX", "ltp": 100.5}]


@pytest.mark.asyncio
async def test_remove_listener_stops_further_dispatch() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_cls.return_value = MagicMock()
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.bind_loop()
        manager.subscribe(["NSE:NIFTY50-INDEX"])

        received: list[dict[str, Any]] = []
        manager.add_listener(received.append)
        manager.remove_listener(received.append)

        manager._on_message({"symbol": "NSE:NIFTY50-INDEX", "ltp": 100.5})
        await asyncio.sleep(0)

        assert received == []


@pytest.mark.asyncio
async def test_on_message_before_bind_loop_is_a_safe_noop() -> None:
    """If a tick somehow arrives before bind_loop() has been called, it
    must be dropped silently rather than raising."""
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_cls.return_value = MagicMock()
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")

        manager._on_message({"symbol": "NSE:NIFTY50-INDEX", "ltp": 100.5})
        await asyncio.sleep(0)  # no exception expected


@pytest.mark.asyncio
async def test_subscribe_does_not_require_the_running_event_loop() -> None:
    """subscribe()/unsubscribe() do blocking I/O and are meant to run via
    asyncio.to_thread — they must not call asyncio.get_running_loop(),
    which raises when there is no loop on the calling (worker) thread."""
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_cls.return_value = MagicMock()
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")

        await asyncio.to_thread(manager.subscribe, ["NSE:NIFTY50-INDEX"])
        await asyncio.to_thread(manager.unsubscribe, ["NSE:NIFTY50-INDEX"])


@pytest.mark.asyncio
async def test_close_tears_down_socket_and_clears_state() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_socket = MagicMock()
        mock_cls.return_value = mock_socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.subscribe(["NSE:NIFTY50-INDEX"])
        manager.add_listener(lambda _msg: None)

        manager.close()

        mock_socket.close_connection.assert_called_once()
        assert manager._refcounts == {}
        assert manager._listeners == set()
