"""Tests for FyersMarketStreamManager's refcounted subscribe/unsubscribe
and thread-safe tick dispatch, with FyersDataSocket itself mocked out
(no real network/websocket in these tests).

FyersDataSocket is only ever constructed lazily, inside subscribe() (via
_ensure_connected), so the patch context must stay open for the whole test
body — not just around manager construction.
"""

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

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


def test_importing_module_strips_stray_proxy_env_vars() -> None:
    """Regression test: a leftover HTTP_PROXY/HTTPS_PROXY in the environment
    (e.g. from an unrelated mitmproxy debugging session) makes
    websocket-client route the Fyers connection through that proxy instead
    of straight to Fyers. If it isn't actually listening, the handshake
    fails with the exact same "unable to get local issuer certificate"
    error as a missing CA bundle — very easy to misdiagnose. Verified via a
    subprocess so the module is freshly imported (its env cleanup is
    module-import-time, and this test suite has already imported it once)."""
    backend_dir = Path(__file__).resolve().parent.parent
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import os; import app.services.fyers_market_stream; "
            "print(os.environ.get('HTTP_PROXY'), os.environ.get('https_proxy'))",
        ],
        env={**os.environ, "HTTP_PROXY": "http://127.0.0.1:8080", "https_proxy": "http://127.0.0.1:8080"},
        capture_output=True,
        text=True,
        cwd=str(backend_dir),
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "None None"


@pytest.mark.asyncio
async def test_shared_quote_poll_fetches_and_dispatches_to_all_listeners() -> None:
    """One shared poll loop per session, not one per websocket connection —
    a single quote_fetcher call result should reach every registered
    listener (i.e. every connected browser tab), and the fetcher is called
    with the union of subscribed symbols."""
    quote_fetcher = AsyncMock(return_value=[{"trading_symbol": "NIFTY", "last_price": 100.0}])
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_cls.return_value = MagicMock()
        manager = FyersMarketStreamManager(
            app_id="TESTAPP-100",
            access_token="fake-token",
            quote_fetcher=quote_fetcher,
            quote_poll_interval_seconds=0.01,
        )
        manager.bind_loop()

        received_a: list[dict[str, Any]] = []
        received_b: list[dict[str, Any]] = []
        manager.add_listener(received_a.append)
        manager.add_listener(received_b.append)

        await asyncio.to_thread(manager.subscribe, ["NSE:NIFTY50-INDEX"])
        await asyncio.sleep(0.05)

        manager.close()

    quote_fetcher.assert_called_with(["NSE:NIFTY50-INDEX"])
    assert received_a and received_a[0]["trading_symbol"] == "NIFTY"
    assert received_b and received_b[0]["trading_symbol"] == "NIFTY"


@pytest.mark.asyncio
async def test_shared_quote_poll_skips_fetch_when_nothing_subscribed() -> None:
    """No point hitting Fyers on a timer if nobody's actually subscribed to
    anything — keeps the loop from generating pointless API load."""
    quote_fetcher = AsyncMock(return_value=[])
    manager = FyersMarketStreamManager(
        app_id="TESTAPP-100",
        access_token="fake-token",
        quote_fetcher=quote_fetcher,
        quote_poll_interval_seconds=0.01,
    )
    manager.bind_loop()

    await asyncio.sleep(0.05)
    manager.close()

    quote_fetcher.assert_not_called()


@pytest.mark.asyncio
async def test_close_cancels_the_shared_quote_poll_task() -> None:
    quote_fetcher = AsyncMock(return_value=[])
    manager = FyersMarketStreamManager(
        app_id="TESTAPP-100",
        access_token="fake-token",
        quote_fetcher=quote_fetcher,
        quote_poll_interval_seconds=0.01,
    )
    manager.bind_loop()
    task = manager._quote_poll_task
    assert task is not None

    manager.close()
    await asyncio.sleep(0)

    assert task.cancelled() or task.done()
