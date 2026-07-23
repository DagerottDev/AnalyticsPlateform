import asyncio
import datetime
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.config import Settings, get_settings
from app.core.security import decode_token, get_current_user
from app.schemas.market import ExpiryList, Instrument, InstrumentResponse, MarginRequest, MarginResponse
from app.services.fyers_service import from_fyers_ws_symbol, to_fyers_ws_symbol
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/market", tags=["Market Data"])


@router.get("/instruments/{symbol}", response_model=InstrumentResponse)
async def get_instruments(
    symbol: str, current_user: dict[str, Any] = Depends(get_current_user)
) -> InstrumentResponse:
    """Get active instruments (options) for a given symbol."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")

    raw_instruments = await service.get_instruments(symbol.upper())
    instruments = [Instrument(**instr) for instr in raw_instruments]
    return InstrumentResponse(instruments=instruments)


@router.get("/expiries/{symbol}", response_model=ExpiryList)
async def get_expiries(
    symbol: str, current_user: dict[str, Any] = Depends(get_current_user)
) -> ExpiryList:
    """Get a list of available expiries for a given symbol."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")

    raw_instruments = await service.get_instruments(symbol.upper())
    expiries = set()
    for instr in raw_instruments:
        if instr.get("expiry"):
            expiries.add(instr["expiry"])

    # Sort expiries by date (assuming DD-MMM-YYYY format)
    def parse_expiry(date_str: str) -> datetime.datetime:
        try:
            return datetime.datetime.strptime(date_str, "%d-%b-%Y")
        except ValueError:
            return datetime.datetime.max

    sorted_expiries = sorted(expiries, key=parse_expiry)
    return ExpiryList(expiries=sorted_expiries)


@router.get("/quotes")
async def get_quotes(
    symbols: str = Query(..., description="Comma-separated list of symbols"),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Get live REST price quotes from Fyers for given symbols."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")

    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    quotes = await service.get_quotes(symbol_list)
    return {"quotes": quotes}


@router.get("/history")
async def get_history(
    symbol: str = Query(..., description="UI symbol (e.g. NIFTY) or Fyers-qualified symbol"),
    range_from: str = Query(..., description="Start date, YYYY-MM-DD"),
    range_to: str = Query(..., description="End date, YYYY-MM-DD"),
    resolution: str = Query("1", description="Candle resolution, e.g. '1', '5', 'D'"),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Fetch real historical OHLCV candles directly from the broker.

    Unlike /historical/ohlcv, this pulls live from Fyers rather than the
    backfilled DB table — used by Replay Mode so a session can be replayed
    from real market data without requiring a prior backfill job.
    """
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")

    fyers_symbol = to_fyers_ws_symbol(symbol)
    candles = await service.get_historical_data(fyers_symbol, range_from, range_to, resolution)
    return {"candles": candles}


@router.post("/margin", response_model=MarginResponse)
async def get_margin(
    request: MarginRequest, current_user: dict[str, Any] = Depends(get_current_user)
) -> MarginResponse:
    """Margin required to take a prospective basket of positions (e.g. the
    legs currently in the Strategy Builder) — no order is placed.

    Fyers' margin calculator response schema is sparsely documented and
    varies in the exact keys it returns, so this reads several candidate
    key spellings and always includes the raw payload as a fallback.
    """
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")

    if not request.legs:
        raise HTTPException(status_code=400, detail="At least one leg is required")

    orders = [
        {
            "symbol": leg.symbol,
            "quantity": leg.quantity,
            "side": leg.side,
            "product_type": leg.product_type,
        }
        for leg in request.legs
    ]
    data = await service.get_margin(orders)

    def first_of(*keys: str) -> float | None:
        for key in keys:
            value = data.get(key)
            if isinstance(value, int | float):
                return float(value)
        return None

    return MarginResponse(
        total_margin=first_of("margin_total", "total", "marginTotal"),
        available_margin=first_of("margin_avail", "marginAvail", "available_balance"),
        span_margin=first_of("span", "span_margin", "spanMargin"),
        exposure_margin=first_of("expo", "exposure", "exposure_margin"),
        premium=first_of("premium", "option_premium"),
        raw=data,
    )


@router.websocket("/ws")
async def market_ws(
    websocket: WebSocket, token: str = Query(...), settings: Settings = Depends(get_settings)
) -> None:
    """Proxies live Fyers ticks to the browser.

    The browser WebSocket API can't set an Authorization header, so the JWT
    is passed as a query param instead of reusing the get_current_user
    dependency (which reads it from the header).

    Protocol (JSON text frames):
      client -> server: {"action": "subscribe" | "unsubscribe", "symbols": [...]}
      server -> client: {"type": "tick", "data": {...}} | {"type": "info", "message": "..."}
    """
    try:
        payload = decode_token(token)
    except HTTPException:
        await websocket.close(code=4401)
        return

    client_id = payload.get("sub")
    service = session_manager.get_session(client_id) if client_id else None

    await websocket.accept()

    stream = None
    if service is not None:
        stream = service.get_market_stream(
            quote_poll_interval_seconds=settings.market_quote_poll_interval_seconds
        )
        stream.bind_loop()

    subscribed: set[str] = set()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    def on_tick(message: dict[str, Any]) -> None:
        queue.put_nowait(message)

    if stream is not None:
        stream.add_listener(on_tick)

    async def reader() -> None:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            symbols = msg.get("symbols") or []
            if not symbols or stream is None:
                continue
            fyers_symbols = [to_fyers_ws_symbol(s) for s in symbols]
            if msg.get("action") == "subscribe":
                subscribed.update(fyers_symbols)
                await asyncio.to_thread(stream.subscribe, fyers_symbols)
                if service is not None:
                    try:
                        quotes = await service.get_quotes(symbols)
                        for q in quotes:
                            queue.put_nowait(q)
                    except Exception:
                        logger.exception("Failed to seed quotes after subscribe for %s", symbols)
            elif msg.get("action") == "unsubscribe":
                subscribed.difference_update(fyers_symbols)
                await asyncio.to_thread(stream.unsubscribe, fyers_symbols)

    async def writer() -> None:
        while True:
            message = await queue.get()
            if "symbol" in message and "ltp" in message:
                # Raw live-tick shape from the Fyers websocket — translate the
                # upstream-qualified symbol back to what the frontend
                # subscribed with. Quote-shaped messages from get_quotes()
                # (different field names, symbol already de-aliased) pass
                # through unchanged.
                message = {**message, "symbol": from_fyers_ws_symbol(message["symbol"])}
            await websocket.send_json({"type": "tick", "data": message})

    try:
        await asyncio.gather(reader(), writer())
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Market data websocket connection failed")
    finally:
        if stream is not None:
            stream.remove_listener(on_tick)
            if subscribed:
                await asyncio.to_thread(stream.unsubscribe, list(subscribed))
