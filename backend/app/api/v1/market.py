import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.core.security import decode_token, get_current_user
from app.schemas.market import ExpiryList, Instrument, InstrumentResponse
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

    try:
        raw_instruments = await service.get_instruments(symbol.upper())
        instruments = [Instrument(**instr) for instr in raw_instruments]
        return InstrumentResponse(instruments=instruments)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/expiries/{symbol}", response_model=ExpiryList)
async def get_expiries(
    symbol: str, current_user: dict[str, Any] = Depends(get_current_user)
) -> ExpiryList:
    """Get a list of available expiries for a given symbol."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")
    try:
        raw_instruments = await service.get_instruments(symbol.upper())
        expiries = set()
        for instr in raw_instruments:
            if instr.get("expiry"):
                expiries.add(instr["expiry"])

        # Sort expiries by date (assuming DD-MMM-YYYY format)
        import datetime
        def parse_expiry(date_str: str) -> datetime.datetime:
            try:
                return datetime.datetime.strptime(date_str, "%d-%b-%Y")
            except ValueError:
                return datetime.datetime.max

        sorted_expiries = sorted(list(expiries), key=parse_expiry)
        return ExpiryList(expiries=sorted_expiries)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


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
    if hasattr(service, "get_quotes"):
        quotes = await service.get_quotes(symbol_list)
        return {"quotes": quotes}
    return {"quotes": []}


@router.websocket("/ws")
async def market_ws(websocket: WebSocket, token: str = Query(...)) -> None:
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
        stream = service.get_market_stream()
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
                if service is not None and hasattr(service, "get_quotes"):
                    try:
                        quotes = await service.get_quotes(symbols)
                        for q in quotes:
                            queue.put_nowait(q)
                    except Exception:
                        pass
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

    async def poller() -> None:
        """Periodic 1Hz quote polling loop, so ticker values keep updating
        even if the live Fyers websocket tick stream isn't flowing."""
        while True:
            await asyncio.sleep(1.0)
            if subscribed and service is not None and hasattr(service, "get_quotes"):
                try:
                    sym_list = [from_fyers_ws_symbol(s) for s in list(subscribed)]
                    quotes = await service.get_quotes(sym_list)
                    for q in quotes:
                        queue.put_nowait(q)
                except Exception:
                    pass

    try:
        await asyncio.gather(reader(), writer(), poller())
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Market data websocket connection failed")
    finally:
        if stream is not None:
            stream.remove_listener(on_tick)
            if subscribed:
                await asyncio.to_thread(stream.unsubscribe, list(subscribed))
