"""Server-hosted Fyers GTT evaluator; native Dhan orders are only expired here."""

import asyncio
import logging
from contextlib import suppress
from datetime import UTC, datetime

from app.config import Settings
from app.db.session import async_session_maker
from app.services import gtt_store
from app.services.market_session import is_regular_market_open
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)


async def run_gtt_monitor(settings: Settings) -> None:
    service = session_manager.get_active_session()
    owner_id = session_manager.get_active_client_id()
    if service is None or owner_id is None:
        return
    async with async_session_maker() as db:
        for order in await gtt_store.pending_for_owner(db, owner_id):
            if order.expires_at <= datetime.now(UTC):
                if (
                    order.broker_name.lower() == "dhan"
                    and order.native_order_id
                    and hasattr(service, "cancel_gtt_order")
                ):
                    try:
                        await service.cancel_gtt_order(order.native_order_id)
                    except Exception:
                        logger.exception("Could not cancel expired Dhan GTT %s", order.id)
                await gtt_store.finish(db, order, "Expired")
                continue
            # Native Dhan owns its trigger decision. Fyers has no GTT endpoint.
            if order.broker_name.lower() != "fyers":
                continue
            if not is_regular_market_open(segment="fno"):
                continue
            try:
                quotes = await service.get_quotes([order.symbol])
                price = float(quotes[0].get("last_price", 0)) if quotes else 0
                hit = (
                    price >= order.trigger_price
                    if order.side == "Buy"
                    else price <= order.trigger_price
                )
                if not hit:
                    continue
                await gtt_store.finish(db, order, "Triggered")
                result = await service.place_order(
                    {
                        "symbol": order.symbol,
                        "quantity": order.quantity,
                        "side": order.side,
                        "order_type": order.execution_type,
                        "product_type": order.product_type,
                        "limit_price": order.limit_price,
                        "stop_price": 0,
                        "validity": "DAY",
                        "disclosed_quantity": 0,
                        "offline_order": False,
                        "stop_loss": 0,
                        "take_profit": 0,
                    }
                )
                await gtt_store.finish(db, order, "Placed", execution_order_id=result.get("id"))
            except Exception as exc:
                logger.exception("GTT execution failed for %s", order.id)
                await gtt_store.finish(db, order, "Failed", error=str(exc)[:500])


async def gtt_monitor_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        await run_gtt_monitor(settings)
        with suppress(TimeoutError):
            await asyncio.wait_for(stop_event.wait(), timeout=2.0)
