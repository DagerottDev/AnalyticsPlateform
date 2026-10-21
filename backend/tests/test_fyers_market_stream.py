"""Tests for FyersMarketStreamManager's refcounted subscribe/unsubscribe
and thread-safe tick dispatch, with FyersDataSocket itself mocked out
(no real network/websocket in these tests).

FyersDataSocket is only ever constructed lazily, inside subscribe() (via
_ensure_connected), so the patch context must stay open for the whole test
body — not just around manager construction.
"""

import asyncio
import contextlib
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.fyers_market_stream import FyersMarketStreamManager

if TYPE_CHECKING:
    from collections.abc import Callable


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
async def test_upstream_close_reconnects_same_socket_and_replays_subscriptions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Fyers SDK socket that closes must not leave the session stalled.

    The SDK's built-in reconnect loop is bounded and can abandon a socket
    without invoking OnClose.  The manager owns the retry now — but
    FyersDataSocket is a process-wide singleton inside the SDK (its
    ``__new__`` always returns the same object), so it must reconnect by
    calling ``connect()`` again on the *same* object rather than
    constructing a second one (which would silently reset the first one's
    live state instead of replacing it — see fyers_market_stream.py).
    """
    socket = MagicMock()
    connected = {"value": False}
    socket.is_connected.side_effect = lambda: connected["value"]

    def do_connect() -> None:
        connected["value"] = True
        manager._on_connect()

    def do_close() -> None:
        # Mirrors the real SDK: close_connection() is what clears its
        # internal __ws_object / is_connected() state, not the on_close
        # callback firing on its own.
        connected["value"] = False

    socket.connect.side_effect = do_connect
    socket.close_connection.side_effect = do_close

    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_cls.return_value = socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.bind_loop()
        monkeypatch.setattr(manager, "_RECONNECT_BASE_DELAY_SECONDS", 0.01)
        monkeypatch.setattr(manager, "_RECONNECT_MAX_DELAY_SECONDS", 0.01)

        await asyncio.to_thread(manager.subscribe, ["NSE:NIFTY50-INDEX", "NSE:RELIANCE-EQ"])
        socket.subscribe.reset_mock()

        manager._on_close({"code": 1006, "message": "network drop"})
        for _ in range(20):
            await asyncio.sleep(0.01)
            if socket.subscribe.call_count:
                break

        assert mock_cls.call_count == 1  # never reconstructed — same singleton object
        assert mock_cls.call_args.kwargs["reconnect"] is False
        assert mock_cls.call_args.kwargs["litemode"] is False
        socket.close_connection.assert_called_once()
        assert socket.connect.call_count == 2  # initial connect + reconnect
        socket.subscribe.assert_called_once_with(
            symbols=["NSE:NIFTY50-INDEX", "NSE:RELIANCE-EQ"], data_type="SymbolUpdate"
        )
        manager.close()


@pytest.mark.asyncio
async def test_reconnect_loop_does_not_tear_down_a_connection_that_succeeded_during_its_sleep(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The SDK's handshake is asynchronous — connect() returns before
    on_connect necessarily fires (it's invoked later from the SDK's own
    background thread once the handshake completes) — so subscribe()'s
    cold-path fallback starts the reconnect supervisor on essentially every
    fresh subscribe, racing the real handshake. If the connection actually
    succeeds while that supervisor is asleep waiting for its first retry, it
    must not tear down the now-healthy socket and reconnect anyway."""
    socket = MagicMock()
    socket.is_connected.return_value = False
    # connect() does NOT call on_connect synchronously, unlike the other
    # tests in this file — this is what actually exercises the race, since
    # a synchronous mock connect() can never observe a "succeeded mid-sleep"
    # window at all.
    socket.connect.side_effect = lambda: None

    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_cls.return_value = socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.bind_loop()
        monkeypatch.setattr(manager, "_RECONNECT_BASE_DELAY_SECONDS", 0.05)
        monkeypatch.setattr(manager, "_RECONNECT_MAX_DELAY_SECONDS", 0.05)

        await asyncio.to_thread(manager.subscribe, ["NSE:NIFTY50-INDEX"])
        for _ in range(20):
            await asyncio.sleep(0.001)
            if manager._reconnect_task is not None:
                break
        assert manager._reconnect_task is not None  # started as subscribe()'s cold-path fallback

        async def _complete_handshake_mid_sleep() -> None:
            await asyncio.sleep(0.02)  # well before the 0.05s reconnect delay elapses
            manager._on_connect()

        await asyncio.gather(_complete_handshake_mid_sleep(), manager._reconnect_task)

        # The already-healthy connection must not have been torn down and
        # reconnected: connect() should still only have been called once,
        # and no teardown (close_connection, or a stale-ws_thread join via
        # _recreate_socket) should have fired.
        socket.connect.assert_called_once()
        manager.close()
        socket.close_connection.assert_not_called()


@pytest.mark.asyncio
async def test_failed_initial_connect_is_retried_on_the_same_socket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An OnError that fires before the first refcount must still recover,
    by retrying connect() on the one socket object the manager owns rather
    than constructing a second (see the reconnect test above for why)."""
    socket = MagicMock()
    connected = {"value": False}
    socket.is_connected.side_effect = lambda: connected["value"]
    attempts = {"count": 0}

    def do_connect() -> None:
        attempts["count"] += 1
        if attempts["count"] == 1:
            return  # first attempt: simulate it failing before on_connect
        connected["value"] = True
        manager._on_connect()

    socket.connect.side_effect = do_connect

    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_cls.return_value = socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.bind_loop()
        monkeypatch.setattr(manager, "_RECONNECT_BASE_DELAY_SECONDS", 0.01)
        monkeypatch.setattr(manager, "_RECONNECT_MAX_DELAY_SECONDS", 0.01)

        await asyncio.to_thread(manager.subscribe, ["NSE:NIFTY50-INDEX"])
        for _ in range(20):
            await asyncio.sleep(0.01)
            if socket.subscribe.call_count:
                break

        assert mock_cls.call_count == 1
        # The first connect attempt never completed the handshake (never
        # went through close_connection's is_connected() guard), so the
        # teardown before retrying must join the stale ws_thread instead.
        socket.close_connection.assert_not_called()
        socket.ws_thread.join.assert_called_once_with(timeout=5.0)
        socket.subscribe.assert_called_once_with(
            symbols=["NSE:NIFTY50-INDEX"], data_type="SymbolUpdate"
        )
        manager.close()


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
async def test_unsubscribe_drops_local_refcount_without_corrupting_upstream_socket() -> None:
    """Fyers SDK unsubscribe has a state-corruption bug; reconnect reclaims it."""
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
        mock_socket.unsubscribe.assert_not_called()
        assert manager._refcounts == {}


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
        manager.close()


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
        manager.close()


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
            market_open_checker=lambda: True,
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
async def test_shared_quote_poll_stops_after_market_close() -> None:
    quote_fetcher = AsyncMock(return_value=[])
    manager = FyersMarketStreamManager(
        app_id="TESTAPP-100",
        access_token="fake-token",
        quote_fetcher=quote_fetcher,
        quote_poll_interval_seconds=0.01,
        market_open_checker=lambda: False,
    )
    manager._refcounts["NSE:NIFTY50-INDEX"] = 1
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


def test_refcount_methods_actually_acquire_the_shared_state_lock() -> None:
    """Regression test for the _state_lock fix.

    Before that fix, self._state_lock was acquired only inside _on_connect
    — _increment/_decrement (called from subscribe()/unsubscribe(), which
    run on a threadpool worker thread via asyncio.to_thread) mutated
    self._refcounts with no lock at all, so a lock held by one side
    provided no actual mutual exclusion against the other (the class of bug
    that can raise "RuntimeError: dictionary changed size during
    iteration" from _on_connect's list(self._refcounts.keys()), among other
    unsynchronized-access hazards).

    A stress test hammering both sides with real threads and asserting "no
    exception raised" turns out to be an unreliable way to prove this: for
    a small dict, CPython's GIL scheduling makes list(d.keys()) act
    atomically enough in practice that the race essentially never
    reproduces within a short test run, whether or not the lock is
    actually held (verified: an earlier version of this test passed
    identically with the fix reverted). A stress test that passes either
    way isn't a regression test. This instead directly proves the
    property that actually matters — that _increment (representative of
    every other state-touching method, all guarded the same way) really
    does block on manager._state_lock rather than skip it — by holding the
    lock from a separate thread and confirming _increment can't proceed
    until it's released.
    """
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_cls.return_value = MagicMock()
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")

        lock_acquired = threading.Event()
        release_lock = threading.Event()

        def hold_lock() -> None:
            with manager._state_lock:
                lock_acquired.set()
                release_lock.wait(timeout=5)

        holder = threading.Thread(target=hold_lock)
        holder.start()
        assert lock_acquired.wait(timeout=5)

        finished = threading.Event()

        def call_increment() -> None:
            manager._increment("NSE:NIFTY50-INDEX")
            finished.set()

        caller = threading.Thread(target=call_increment)
        caller.start()

        # Still blocked while the other thread holds the lock — this is
        # exactly what would NOT be true before the fix, since _increment
        # never touched the lock at all and would have finished instantly.
        assert not finished.wait(timeout=0.2)

        release_lock.set()
        assert finished.wait(timeout=5)  # unblocks once the lock is released

        holder.join(timeout=5)
        caller.join(timeout=5)
        assert manager._refcounts == {"NSE:NIFTY50-INDEX": 1}


# ── _fyers_ping_excepthook ───────────────────────────────────────────────


def _hook_args(exc_type: type[BaseException], thread_name: str | None) -> Any:
    from app.services import fyers_market_stream as module

    thread = None
    if thread_name is not None:
        thread = MagicMock()
        thread.name = thread_name
    return module.threading.ExceptHookArgs((exc_type, exc_type("boom"), None, thread))


def test_ping_excepthook_downgrades_a_broken_pipe_in_the_ping_thread(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import fyers_market_stream as module

    default_hook = MagicMock()
    monkeypatch.setattr(module, "_default_threading_excepthook", default_hook)

    module._fyers_ping_excepthook(_hook_args(BrokenPipeError, "Thread-__ping-1"))

    default_hook.assert_not_called()


def test_ping_excepthook_passes_through_a_different_exception_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import fyers_market_stream as module

    default_hook = MagicMock()
    monkeypatch.setattr(module, "_default_threading_excepthook", default_hook)

    args = _hook_args(ValueError, "Thread-__ping-1")
    module._fyers_ping_excepthook(args)

    default_hook.assert_called_once_with(args)


def test_ping_excepthook_passes_through_a_broken_pipe_on_an_unrelated_thread(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import fyers_market_stream as module

    default_hook = MagicMock()
    monkeypatch.setattr(module, "_default_threading_excepthook", default_hook)

    args = _hook_args(BrokenPipeError, "Thread-ws_thread")
    module._fyers_ping_excepthook(args)

    default_hook.assert_called_once_with(args)


def test_ping_excepthook_passes_through_when_thread_is_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import fyers_market_stream as module

    default_hook = MagicMock()
    monkeypatch.setattr(module, "_default_threading_excepthook", default_hook)

    args = _hook_args(BrokenPipeError, None)
    module._fyers_ping_excepthook(args)

    default_hook.assert_called_once_with(args)


# ── _quote_poll_loop error isolation ─────────────────────────────────────


@pytest.mark.asyncio
async def test_shared_quote_poll_survives_a_fetcher_exception() -> None:
    calls = 0

    async def flaky_fetcher(_symbols: list[str]) -> list[dict[str, Any]]:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("Fyers quote endpoint timed out")
        return [{"symbol": "NIFTY", "last_price": 1.0}]

    manager = FyersMarketStreamManager(
        app_id="TESTAPP-100",
        access_token="fake-token",
        quote_fetcher=flaky_fetcher,
        quote_poll_interval_seconds=0.01,
        market_open_checker=lambda: True,
    )
    manager.subscribe = lambda *_a, **_k: None  # unused here
    manager._refcounts["NSE:NIFTY50-INDEX"] = 1
    manager.bind_loop()
    try:
        for _ in range(200):
            if calls >= 2:
                break
            await asyncio.sleep(0.01)
        assert calls >= 2  # the loop kept polling after the first failure
    finally:
        manager.close()


# ── subscribe() while closing ────────────────────────────────────────────


def test_subscribe_is_a_noop_once_closing_has_started() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_socket = MagicMock()
        mock_cls.return_value = mock_socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager._closing = True

        manager.subscribe(["NSE:NIFTY50-INDEX"])

        mock_cls.assert_not_called()
        assert manager._refcounts == {}


# ── _cancel_task_on_loop ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cancel_task_on_loop_cancels_directly_when_called_from_the_owning_loop() -> None:
    manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
    manager.bind_loop()
    task = asyncio.get_running_loop().create_task(asyncio.sleep(10))

    manager._cancel_task_on_loop(task)

    assert task.cancelled() or task.cancelling() > 0
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


def test_cancel_task_on_loop_cancels_directly_when_the_loop_is_not_running() -> None:
    manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
    task = MagicMock()
    task.cancel = MagicMock()
    # manager._loop is None (never bound) -> the "loop not running" branch.

    manager._cancel_task_on_loop(task)

    task.cancel.assert_called_once()


@pytest.mark.asyncio
async def test_cancel_task_on_loop_schedules_threadsafe_cancel_from_another_thread() -> None:
    manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
    manager.bind_loop()
    task = asyncio.get_running_loop().create_task(asyncio.sleep(10))

    done = threading.Event()

    def cancel_from_another_thread() -> None:
        manager._cancel_task_on_loop(task)
        done.set()

    thread = threading.Thread(target=cancel_from_another_thread)
    thread.start()
    thread.join(timeout=5)
    assert done.is_set()

    for _ in range(50):
        if task.cancelled() or task.done():
            break
        await asyncio.sleep(0.01)
    assert task.cancelled() or task.done()


# ── _decrement on an untracked symbol ────────────────────────────────────


def test_decrement_an_untracked_symbol_returns_false_without_raising() -> None:
    manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")

    assert manager._decrement("NSE:NEVER-SUBSCRIBED-EQ") is False


# ── _ensure_connected edge cases ─────────────────────────────────────────


def test_ensure_connected_is_a_noop_once_closing_has_started() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager._closing = True

        manager._ensure_connected()

        mock_cls.assert_not_called()


def test_ensure_connected_marks_disconnected_and_reraises_when_connect_itself_raises() -> None:
    """The SDK usually reports connection failures via OnError rather than
    raising, but if it (or a future SDK version) does raise directly, the
    manager must not swallow it — the reconnect supervisor is what's
    responsible for retrying, not this call silently succeeding."""
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_socket = MagicMock()
        mock_socket.connect.side_effect = RuntimeError("handshake failed")
        mock_cls.return_value = mock_socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")

        with pytest.raises(RuntimeError, match="handshake failed"):
            manager._ensure_connected()

        assert manager._connected is False


# ── _on_close / _on_error early-return branches ──────────────────────────


def test_on_close_does_not_start_a_reconnect_once_closing_has_started() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket"):
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager._refcounts["NSE:NIFTY50-INDEX"] = 1
        manager._closing = True
        manager._loop = MagicMock()

        manager._on_close({"code": 1006, "message": "network drop"})

        manager._loop.call_soon_threadsafe.assert_not_called()


def test_on_close_does_not_start_a_reconnect_with_no_active_subscriptions() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket"):
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager._loop = MagicMock()

        manager._on_close({"code": 1006, "message": "network drop"})

        manager._loop.call_soon_threadsafe.assert_not_called()


def test_on_error_starts_a_reconnect_when_subscriptions_are_active() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket"):
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager._refcounts["NSE:NIFTY50-INDEX"] = 1
        manager._loop = MagicMock()

        manager._on_error({"code": -300, "message": "connection reset"})

        manager._loop.call_soon_threadsafe.assert_called_once_with(
            manager._start_reconnect_task
        )


def test_on_error_does_not_start_a_reconnect_once_closing_has_started() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket"):
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager._refcounts["NSE:NIFTY50-INDEX"] = 1
        manager._closing = True
        manager._loop = MagicMock()

        manager._on_error({"code": -300, "message": "connection reset"})

        manager._loop.call_soon_threadsafe.assert_not_called()


# ── _start_reconnect_task / _reconnect_loop early exits ──────────────────


def test_start_reconnect_task_does_nothing_with_no_active_subscriptions() -> None:
    manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")

    manager._start_reconnect_task()

    assert manager._reconnect_task is None


@pytest.mark.asyncio
async def test_reconnect_loop_returns_immediately_if_already_connected() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_socket = MagicMock()
        mock_cls.return_value = mock_socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.bind_loop()
        manager._refcounts["NSE:NIFTY50-INDEX"] = 1
        manager._socket = mock_socket
        manager._connected = True

        await manager._reconnect_loop()

        mock_socket.connect.assert_not_called()  # never even attempted a reconnect
        manager.close()


@pytest.mark.asyncio
async def test_reconnect_loop_survives_recreate_socket_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A generic exception from _recreate_socket (e.g. a broker-SDK bug on a
    future version) must be logged and retried, not left to crash the
    supervisor task and silently end reconnection forever."""
    socket = MagicMock()
    connected = {"value": False}
    socket.is_connected.side_effect = lambda: connected["value"]
    attempts = {"count": 0}

    def flaky_recreate() -> None:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise RuntimeError("teardown blew up")
        connected["value"] = True
        manager._connected = True

    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_cls.return_value = socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.bind_loop()
        monkeypatch.setattr(manager, "_RECONNECT_BASE_DELAY_SECONDS", 0.01)
        monkeypatch.setattr(manager, "_RECONNECT_MAX_DELAY_SECONDS", 0.01)
        monkeypatch.setattr(manager, "_recreate_socket", flaky_recreate)
        manager._refcounts["NSE:NIFTY50-INDEX"] = 1

        await manager._reconnect_loop()

        assert attempts["count"] == 2  # first attempt raised, second succeeded
        manager.close()


# ── _recreate_socket edge cases ───────────────────────────────────────────


def test_recreate_socket_falls_back_to_ensure_connected_when_never_connected() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_socket = MagicMock()
        mock_cls.return_value = mock_socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        # self._socket is still None -- never subscribed/connected yet.

        manager._recreate_socket()

        mock_cls.assert_called_once()  # _ensure_connected constructed it
        mock_socket.connect.assert_called_once()


def test_recreate_socket_does_not_reconnect_once_closing_has_started() -> None:
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket") as mock_cls:
        mock_socket = MagicMock()
        mock_socket.is_connected.return_value = False
        mock_cls.return_value = mock_socket
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager._socket = mock_socket
        manager._refcounts["NSE:NIFTY50-INDEX"] = 1
        manager._closing = True

        manager._recreate_socket()

        mock_socket.connect.assert_not_called()


# ── _teardown_socket exception handling ──────────────────────────────────


def test_teardown_socket_logs_and_swallows_a_close_connection_failure() -> None:
    manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
    socket = MagicMock()
    socket.is_connected.return_value = True
    socket.close_connection.side_effect = RuntimeError("socket already gone")

    manager._teardown_socket(socket, log_exceptions=True)  # must not raise


def test_teardown_socket_joins_a_still_alive_stale_ws_thread() -> None:
    manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
    socket = MagicMock()
    socket.is_connected.return_value = False
    socket.ws_thread = MagicMock()
    socket.ws_thread.is_alive.return_value = True

    manager._teardown_socket(socket, log_exceptions=False)

    socket.ws_thread.join.assert_called_once_with(timeout=5.0)


def test_teardown_socket_force_clears_ws_object_even_when_close_connection_raises() -> None:
    """The actual regression test for "live feed goes stale and never
    recovers": MagicMock can't reproduce this because it has no real
    internal state, so the tests above (which use it) can't catch it.

    The real ``FyersDataSocket.close_connection()`` only sets its private
    ``__ws_object`` to ``None`` *after* calling ``self.__ws_object.close()``
    — and closing a transport that already died from a network drop
    (exactly what fyersDataSocket.log shows repeatedly: "Connection to
    remote host was lost.") routinely raises, aborting before that line.
    ``FyersDataSocket.connect()`` then treats a merely-non-``None``
    ``__ws_object`` as "already connected" and just re-fires the open
    callback without establishing a new transport — so without
    ``_force_clear_ws_object``, the manager marks itself connected forever
    with nothing live underneath, and no exception or log line points at
    why.
    """
    manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
    socket = MagicMock()
    socket.is_connected.return_value = True
    socket.close_connection.side_effect = RuntimeError("transport already gone")
    # Named after the real SDK's mangled attribute directly, rather than
    # relying on `self.__ws_object` inside a same-named class, so the
    # attribute exists on this MagicMock exactly as production code expects.
    socket._FyersDataSocket__ws_object = object()

    manager._teardown_socket(socket, log_exceptions=False)

    assert socket._FyersDataSocket__ws_object is None


class _FakeFyersDataSocket:  # noqa: N801 - name mangling below relies on the literal name
    """Faithful-enough stand-in for the real SDK socket's connect() /
    close_connection() / is_connected() semantics — MagicMock only records
    calls, it has no real internal state, so it cannot reproduce the actual
    bug this module works around (see ``_force_clear_ws_object``).
    """

    def __init__(self, *, close_raises: bool) -> None:
        # Deliberately assigned as the real class's mangled name (not this
        # class's own `__ws_object`, which would mangle to
        # `_FakeFyersDataSocket__ws_object`) — production code reaches into
        # this exact attribute name on whatever socket object it is given.
        self._FyersDataSocket__ws_object = None
        self._close_raises = close_raises
        self.real_connects = 0
        self.on_connect: Callable[[], None] | None = None
        self.ws_thread = None

    def is_connected(self) -> bool:
        return self._FyersDataSocket__ws_object is not None

    def connect(self) -> None:
        # Mirrors the real SDK: only a None __ws_object gets a genuine new
        # transport; otherwise this just re-fires the open callback.
        if self._FyersDataSocket__ws_object is None:
            self._FyersDataSocket__ws_object = object()
            self.real_connects += 1
        if self.on_connect is not None:
            self.on_connect()

    def close_connection(self) -> None:
        if self._FyersDataSocket__ws_object is not None:
            if self._close_raises:
                raise RuntimeError("transport already gone")
            self._FyersDataSocket__ws_object = None

    def subscribe(self, symbols: list[str], data_type: str = "SymbolUpdate") -> None:
        pass


@pytest.mark.asyncio
async def test_reconnect_after_a_failing_close_still_establishes_a_real_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """End-to-end regression test: a broker drop whose teardown's
    close_connection() raises (the routine case for an already-dead
    transport — see fyersDataSocket.log's repeated "Connection to remote
    host was lost.") must still result in a genuine reconnect, not a
    manager that silently marks itself connected with a dead socket."""
    socket = _FakeFyersDataSocket(close_raises=True)
    with patch("app.services.fyers_market_stream.data_ws.FyersDataSocket", return_value=socket):
        manager = FyersMarketStreamManager(app_id="TESTAPP-100", access_token="fake-token")
        manager.bind_loop()
        socket.on_connect = manager._on_connect
        monkeypatch.setattr(manager, "_RECONNECT_BASE_DELAY_SECONDS", 0.01)
        monkeypatch.setattr(manager, "_RECONNECT_MAX_DELAY_SECONDS", 0.01)

        await asyncio.to_thread(manager.subscribe, ["NSE:NIFTY50-INDEX"])
        assert socket.real_connects == 1
        assert manager._is_connected()

        # Simulate exactly what fyersDataSocket.log shows happening
        # repeatedly during market hours.
        manager._on_close({"code": 1006, "message": "Connection to remote host was lost."})
        for _ in range(50):
            await asyncio.sleep(0.01)
            if socket.real_connects >= 2:
                break

        assert socket.real_connects == 2, (
            "connect() after the drop must establish a genuinely new transport "
            "instead of silently no-op'ing because __ws_object was left stale "
            "by a close_connection() that raised"
        )
        assert manager._is_connected()
        manager.close()
