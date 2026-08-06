"""Live Fyers market-data stream — wraps FyersDataSocket for one broker session.

Fyers pushes ticks over its own websocket, invoking on_message/on_connect/
on_close/on_error from a background thread owned by the SDK's own
websocket-client (see fyers_apiv3.FyersWebsocket.data_ws). None of that runs
on the asyncio event loop, so anything here that touches asyncio primitives
(the tick queueing) crosses back onto the loop via call_soon_threadsafe.

Known upstream limitation: Fyers' "scrips" (option/equity) tick payload has
its OI field stripped before on_message fires (see data_ws.py's
__response_output — it pops "OI" unconditionally for data_type="scrips").
Live ticks from this stream therefore never carry open interest; OI has to
keep coming from the periodic option-chain REST fetch in FyersService.
"""

import asyncio
import logging
import os
import threading
from collections.abc import Awaitable, Callable
from typing import Any

import certifi

# The underlying websocket-client library (used internally by
# fyers_apiv3.FyersWebsocket.data_ws) builds its own default SSL context and
# doesn't expose a way to pass ca_certs through FyersDataSocket's public
# constructor. On some machines the OS-resolved default CA bundle doesn't
# validate wss://socket.fyers.in, failing with "CERTIFICATE_VERIFY_FAILED:
# unable to get local issuer certificate". Pointing SSL_CERT_FILE at
# certifi's bundle (Python's ssl module reads this env var when building a
# default context) is the standard fix. setdefault() so it never overrides
# an explicit value the environment already set.
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

# websocket-client also silently honors HTTP_PROXY/HTTPS_PROXY from the
# environment. A stray proxy var left over from an unrelated debugging
# session (e.g. mitmproxy) then routes this connection through that proxy
# instead of straight to Fyers — if it isn't actually running, or its
# certificate isn't the one SSL_CERT_FILE above points at, the handshake
# fails with the exact same "unable to get local issuer certificate" error,
# which is easy to misdiagnose as a CA-bundle problem. This connection
# should always go directly to Fyers, so those vars are dropped outright
# (both casings — different libraries check different ones).
_PROXY_ENV_VARS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)
for _proxy_var in _PROXY_ENV_VARS:
    os.environ.pop(_proxy_var, None)

from fyers_apiv3.FyersWebsocket import data_ws  # noqa: E402

logger = logging.getLogger(__name__)

# data_ws.py's internal keep-alive ping thread (__ping) checks
# `self.__ws_object.sock.connected` and then calls `.send()` a line later
# with no lock around the pair — if the underlying TCP connection dies in
# that gap (network blip, laptop sleep/wake, broker-side idle disconnect)
# the send raises BrokenPipeError as an uncaught exception in that daemon
# thread. It's harmless: reconnection is handled independently by the
# socket's own on_close/restart_flag logic in its run_forever thread. But
# by default Python dumps a full traceback for it, which reads like a
# crash. Downgrade just this specific known race to a debug log so real
# uncaught thread exceptions elsewhere still surface normally.
_default_threading_excepthook = threading.excepthook


def _fyers_ping_excepthook(args: threading.ExceptHookArgs) -> None:
    if (
        args.exc_type is BrokenPipeError
        and args.thread is not None
        and "__ping" in args.thread.name
    ):
        logger.debug(
            "Fyers ping thread lost its connection (will auto-reconnect): %s",
            args.exc_value,
        )
        return
    _default_threading_excepthook(args)


threading.excepthook = _fyers_ping_excepthook

TickListener = Callable[[dict[str, Any]], None]
QuoteFetcher = Callable[[list[str]], Awaitable[list[dict[str, Any]]]]


class FyersMarketStreamManager:
    """Owns one FyersDataSocket connection for a session, fanning incoming
    ticks out to any number of registered listeners. Symbol subscriptions
    are refcounted across listeners so a symbol is only dropped from the
    upstream Fyers socket once nothing still needs it.

    Also runs a single shared REST-quote-poll loop (a resilience fallback so
    ticker values keep updating even when the live tick stream isn't
    flowing) against that same refcounted symbol set. This is deliberately
    one loop per *session*, not one per websocket connection — N browser
    tabs subscribed to the same symbols used to mean N independent pollers
    all hitting Fyers' quotes endpoint on their own timers, needlessly
    multiplying API load and making the effective per-tab update cadence
    depend on how many tabs happened to be open.
    """

    _RECONNECT_BASE_DELAY_SECONDS = 1.0
    _RECONNECT_MAX_DELAY_SECONDS = 30.0

    def __init__(
        self,
        app_id: str,
        access_token: str,
        quote_fetcher: QuoteFetcher | None = None,
        quote_poll_interval_seconds: float = 3.0,
    ) -> None:
        self._app_id = app_id
        self._access_token = access_token
        self._socket: data_ws.FyersDataSocket | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._listeners: set[TickListener] = set()
        self._refcounts: dict[str, int] = {}
        self._connected = False
        self._quote_fetcher = quote_fetcher
        self._quote_poll_interval_seconds = quote_poll_interval_seconds
        self._quote_poll_task: asyncio.Task[None] | None = None
        self._reconnect_task: asyncio.Task[None] | None = None
        self._state_lock = threading.RLock()
        self._closing = False

    def bind_loop(self) -> None:
        """Capture the asyncio event loop that should receive dispatched
        ticks, and start the shared quote-poll loop on it. Must be called
        once from a coroutine actually running on that loop (e.g. the
        websocket endpoint), before subscribe()/unsubscribe() — those do
        blocking I/O and are meant to be run via asyncio.to_thread, where
        asyncio.get_running_loop() would fail.
        """
        if self._loop is None:
            self._loop = asyncio.get_running_loop()
            if self._quote_fetcher is not None:
                self._quote_poll_task = self._loop.create_task(self._quote_poll_loop())

    async def _quote_poll_loop(self) -> None:
        assert self._quote_fetcher is not None
        while True:
            await asyncio.sleep(self._quote_poll_interval_seconds)
            symbols = list(self._refcounts.keys())
            if not symbols:
                continue
            try:
                quotes = await self._quote_fetcher(symbols)
                for quote in quotes:
                    self._dispatch(quote)
            except Exception:
                logger.exception("Shared quote-poll failed for %s", symbols)

    def add_listener(self, listener: TickListener) -> None:
        self._listeners.add(listener)

    def remove_listener(self, listener: TickListener) -> None:
        self._listeners.discard(listener)

    def subscribe(self, symbols: list[str]) -> None:
        """Bump refcounts and subscribe upstream for symbols that just went
        from 0 to 1 interested listener. Before the socket has completed
        its handshake, this only updates refcounts — on_connect flushes the
        full accumulated set once the connection (or reconnection) opens.

        Does blocking I/O (a Fyers REST call to resolve symbol tokens, plus
        a hardcoded sleep on first connect) — callers on an asyncio event
        loop must run this via asyncio.to_thread, not call it directly.
        """
        if self._closing:
            return
        self._ensure_connected()
        new_symbols = [s for s in symbols if self._increment(s) == 1]
        if new_symbols and self._connected and self._socket is not None:
            self._socket.subscribe(symbols=new_symbols, data_type="SymbolUpdate")
        elif self._loop is not None and self._refcounts:
            # A failed initial SDK connect can report OnError before the
            # refcount is incremented, so that callback has no symbols with
            # which to start the supervisor.  Re-check after recording the
            # subscription to cover that race.
            self._loop.call_soon_threadsafe(self._start_reconnect_task)

    def unsubscribe(self, symbols: list[str]) -> None:
        """Drop local refcounts without mutating Fyers' live socket state.

        The current Fyers SDK regularly raises inside ``unsubscribe`` (and
        can corrupt its ``channel_num``/symbol bookkeeping afterwards) when
        React unmounts a large Option Chain subscription.  Once corrupted,
        later valid subscriptions stop producing ticks.  Keep an unused
        symbol subscribed upstream until the next normal reconnect instead;
        it is no longer REST-polled because it leaves ``_refcounts``, and the
        browser proxy filters it out.  Reconnects replay only current
        refcounts, reclaiming the upstream set safely.
        """
        for symbol in symbols:
            self._decrement(symbol)

    def close(self) -> None:
        self._closing = True
        reconnect_task = self._reconnect_task
        if reconnect_task is not None and not reconnect_task.done():
            self._cancel_task_on_loop(reconnect_task)
        self._reconnect_task = None
        if self._quote_poll_task is not None:
            self._cancel_task_on_loop(self._quote_poll_task)
            self._quote_poll_task = None
        socket = self._socket
        self._socket = None
        self._connected = False
        if socket is not None:
            self._teardown_socket(socket, log_exceptions=True)
        self._refcounts.clear()
        self._listeners.clear()

    def _cancel_task_on_loop(self, task: asyncio.Task[None]) -> None:
        """Cancel an asyncio task safely from either the loop or SDK thread."""
        if self._loop is None or not self._loop.is_running():
            task.cancel()
            return
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None
        if running_loop is self._loop:
            task.cancel()
        else:
            self._loop.call_soon_threadsafe(task.cancel)

    def _increment(self, symbol: str) -> int:
        self._refcounts[symbol] = self._refcounts.get(symbol, 0) + 1
        return self._refcounts[symbol]

    def _decrement(self, symbol: str) -> bool:
        """Returns True if this symbol's refcount just hit zero."""
        if symbol not in self._refcounts:
            return False
        self._refcounts[symbol] -= 1
        if self._refcounts[symbol] <= 0:
            del self._refcounts[symbol]
            return True
        return False

    def _ensure_connected(self) -> None:
        """Connect the shared SDK socket, constructing it at most once.

        ``data_ws.FyersDataSocket`` is a process-wide singleton internally
        (its ``__new__`` caches and always returns the same object — see the
        installed ``fyers_apiv3`` package). Calling the constructor again on
        every reconnect attempt, as this used to do, does not get a fresh
        object: it re-runs ``__init__`` on the *same* one, replacing its
        locks/queues/thread handles while a background thread from the
        previous connection attempt (``ws_thread``/``ping_thread``/
        ``message_thread``) can still be alive and holding references to the
        versions being replaced. Two threads then drive what looks like one
        socket concurrently, which is what produced the
        "[SSL] record layer failure" errors and left the manager stuck
        offline. Constructing once and only ever calling ``connect()`` /
        ``close_connection()`` on that same instance afterwards avoids the
        race entirely.
        """
        if self._closing:
            return
        if self._socket is not None:
            return
        socket = data_ws.FyersDataSocket(
            access_token=f"{self._app_id}:{self._access_token}",
            log_path="",
            # The Fyers SDK's full-mode decoder currently raises IndexError
            # for index update packets before it calls On_message, which
            # leaves browser clients on the REST fallback despite a connected
            # broker session. Lite mode emits the symbol and LTP directly —
            # exactly what this live ticker needs. REST seeds/fallbacks still
            # provide the non-stream quote fields (OHLC, volume, etc.).
            litemode=True,
            write_to_file=False,
            # The SDK stops retrying after a small fixed number of attempts
            # and then leaves the socket object alive without invoking
            # OnClose.  Reconnect supervision lives here instead, where it
            # can retry for the lifetime of the authenticated session.
            reconnect=False,
            on_connect=self._on_connect,
            on_close=self._on_close,
            on_error=self._on_error,
            on_message=self._on_message,
        )
        # Assign before connect(): a synchronous on_error/on_close fired from
        # inside connect() must see self._socket already set, or its
        # call_soon_threadsafe(self._start_reconnect_task) would race ahead
        # of this assignment.
        self._socket = socket
        try:
            socket.connect()
        except Exception:
            # Fyers' SDK usually reports connection errors through OnError
            # rather than raising, but if an adapter or a future SDK version
            # does raise, keep the reference anyway — see _recreate_socket's
            # docstring for why constructing a second FyersDataSocket is
            # unsafe. The reconnect supervisor retries connect() on this same
            # object instead of us discarding it here.
            self._connected = False
            raise

    # ── Callbacks — invoked from the SDK's background thread ──────────────

    def _on_connect(self) -> None:
        with self._state_lock:
            self._connected = True
            socket = self._socket
            symbols = list(self._refcounts.keys())
        if symbols and socket is not None:
            socket.subscribe(
                symbols=symbols, data_type="SymbolUpdate"
            )

    def _on_close(self, message: dict[str, Any]) -> None:
        self._connected = False
        logger.warning("Fyers market stream closed: %s", message)
        if self._closing or not self._refcounts or self._loop is None:
            return
        # Fyers invokes this callback from its websocket-client thread.  Only
        # create/cancel asyncio tasks on the owning event loop.
        self._loop.call_soon_threadsafe(self._start_reconnect_task)

    def _on_error(self, message: Any) -> None:
        logger.error("Fyers market stream error: %s", message)
        if self._closing or not self._refcounts or self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._start_reconnect_task)

    def _on_message(self, message: dict[str, Any]) -> None:
        self._dispatch(message)

    def _dispatch(self, message: dict[str, Any]) -> None:
        if self._loop is None:
            return
        for listener in list(self._listeners):
            self._loop.call_soon_threadsafe(listener, message)

    def _start_reconnect_task(self) -> None:
        """Start one supervisor task on the manager's asyncio loop."""
        if self._closing or not self._refcounts:
            return
        if self._reconnect_task is None or self._reconnect_task.done():
            self._reconnect_task = asyncio.create_task(self._reconnect_loop())

    async def _reconnect_loop(self) -> None:
        """Recreate the SDK socket until it opens or the session closes.

        The SDK's own reconnect flag is deliberately disabled (see
        ``_ensure_connected``), because its bounded retry loop can abandon a
        dead socket without notifying this manager.  This task retains the
        refcounted symbol set and lets ``_on_connect`` replay it on every new
        socket.
        """
        task = asyncio.current_task()
        attempt = 0
        try:
            while not self._closing and self._refcounts:
                if self._connected and self._socket is not None:
                    return
                delay = min(
                    self._RECONNECT_BASE_DELAY_SECONDS * 2**attempt,
                    self._RECONNECT_MAX_DELAY_SECONDS,
                )
                if delay > 0:
                    await asyncio.sleep(delay)
                if self._closing or not self._refcounts:
                    return
                try:
                    await asyncio.to_thread(self._recreate_socket)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception("Fyers market stream reconnect attempt failed")
                if self._connected:
                    return
                attempt += 1
        finally:
            if self._reconnect_task is task:
                self._reconnect_task = None

    def _recreate_socket(self) -> None:
        """Tear down the dead connection attempt and reconnect.

        Despite the name (kept for a smaller diff against the reconnect
        supervisor calling it), this does *not* construct a new
        ``FyersDataSocket`` — see ``_ensure_connected``'s docstring: the SDK
        object is a process-wide singleton, so a second construction would
        silently reset the *same* object's locks/queues while a background
        thread from the dying connection could still be running against
        them. Instead it tears down and calls ``connect()`` again on the one
        object the manager already owns. If the very first connect never
        happened at all (``self._socket`` still ``None``), falls back to
        ``_ensure_connected()``, which owns that first construction.
        """
        self._connected = False
        socket = self._socket
        if socket is None:
            self._ensure_connected()
            return
        self._teardown_socket(socket, log_exceptions=False)
        if self._closing or not self._refcounts:
            return
        socket.connect()

    def _teardown_socket(self, socket: "data_ws.FyersDataSocket", *, log_exceptions: bool) -> None:
        """Block until ``socket``'s background threads have actually ended.

        ``close_connection()`` only does anything once the handshake has
        completed (it's a no-op while its internal ``__ws_object`` is still
        unset). If a connection attempt fails or errors before that point,
        its ``ws_thread`` is left running with no join — and because the SDK
        socket is a singleton (see ``_ensure_connected``), reconnecting
        without waiting for that thread to actually finish would start a
        second one racing the first over the same object. Cover both paths
        explicitly rather than relying on the ``__ws_object`` guard alone.
        """
        try:
            if socket.is_connected():
                socket.close_connection()  # joins ws/message/ping threads
            else:
                ws_thread = getattr(socket, "ws_thread", None)
                if ws_thread is not None and ws_thread.is_alive():
                    ws_thread.join(timeout=5.0)
        except Exception:
            if log_exceptions:
                logger.exception("Error closing Fyers market stream socket")
            else:
                logger.debug("Error closing stale Fyers market stream socket", exc_info=True)
