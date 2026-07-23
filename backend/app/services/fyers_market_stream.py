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
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"
)
for _proxy_var in _PROXY_ENV_VARS:
    os.environ.pop(_proxy_var, None)

from fyers_apiv3.FyersWebsocket import data_ws  # noqa: E402

logger = logging.getLogger(__name__)

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
        self._ensure_connected()
        new_symbols = [s for s in symbols if self._increment(s) == 1]
        if new_symbols and self._connected and self._socket is not None:
            self._socket.subscribe(symbols=new_symbols, data_type="SymbolUpdate")

    def unsubscribe(self, symbols: list[str]) -> None:
        """Drop refcounts and unsubscribe upstream for symbols whose
        refcount just hit zero."""
        drop_symbols = [s for s in symbols if self._decrement(s)]
        if drop_symbols and self._connected and self._socket is not None:
            self._socket.unsubscribe(symbols=drop_symbols, data_type="SymbolUpdate")

    def close(self) -> None:
        if self._quote_poll_task is not None:
            self._quote_poll_task.cancel()
            self._quote_poll_task = None
        if self._socket is not None:
            try:
                self._socket.close_connection()
            except Exception:
                logger.exception("Error closing Fyers market stream socket")
            self._socket = None
        self._connected = False
        self._refcounts.clear()
        self._listeners.clear()

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
        if self._socket is not None:
            return
        self._socket = data_ws.FyersDataSocket(
            access_token=f"{self._app_id}:{self._access_token}",
            log_path="",
            litemode=False,
            write_to_file=False,
            reconnect=True,
            on_connect=self._on_connect,
            on_close=self._on_close,
            on_error=self._on_error,
            on_message=self._on_message,
        )
        self._socket.connect()

    # ── Callbacks — invoked from the SDK's background thread ──────────────

    def _on_connect(self) -> None:
        self._connected = True
        if self._refcounts and self._socket is not None:
            self._socket.subscribe(
                symbols=list(self._refcounts.keys()), data_type="SymbolUpdate"
            )

    def _on_close(self, message: dict[str, Any]) -> None:
        self._connected = False

    def _on_error(self, message: Any) -> None:
        logger.error("Fyers market stream error: %s", message)

    def _on_message(self, message: dict[str, Any]) -> None:
        self._dispatch(message)

    def _dispatch(self, message: dict[str, Any]) -> None:
        if self._loop is None:
            return
        for listener in list(self._listeners):
            self._loop.call_soon_threadsafe(listener, message)
