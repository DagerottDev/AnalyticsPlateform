"""Scheduled monitor for live basket orders.

This is the "fully automatic server-side exit" for a basket's per-leg
*target* and its combined stop-loss/target. It's deliberately not built on
Fyers' Bracket/Cover order fields — those were replaced by "Smart
Stop-loss and Target" after SEBI's Dec-2020 peak-margin rules removed the
leverage BO/CO depended on — nor on Fyers' Smart Exit, which monitors P&L
across the *whole account* rather than one specific basket. A leg's
protective *stop-loss* is instead a real exchange STOP order placed at
basket-entry time (see api/v1/orders.py's place_basket_order), so it stays
broker-enforced and survives this loop not running; this loop only needs to
watch per-leg targets and the combined threshold, and reconcile a leg's now
-stale protective stop once its target fires here first.

Runs on a much shorter interval than the read-only backfill/alert jobs
since it actively protects live money — if this process is down, neither
per-leg targets nor the combined basket stop-loss/target will fire.
"""

import asyncio
import logging
from typing import Any

from app.config import Settings
from app.db.session import async_session_maker
from app.services import live_basket_store
from app.services.market_session import is_regular_market_open
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)

_EXIT_SIDE = {"Buy": "Sell", "Sell": "Buy"}
_TERMINAL_ENTRY_STATUSES = {"CANCELLED", "CANCELED", "REJECTED", "FAILED"}


def _leg_pnl(leg: dict[str, Any], price_by_symbol: dict[str, float]) -> float | None:
    """Live P&L for one still-open leg, or None if no fresh quote is available."""
    price = price_by_symbol.get(leg["symbol"])
    if price is None:
        return None
    sign = 1 if leg["side"] == "Buy" else -1
    return (price - float(leg["entry_price"])) * int(leg["quantity"]) * sign


def _realized_leg_pnl(leg: dict[str, Any]) -> float | None:
    """Locked-in P&L for a leg that already exited, for combined P&L accounting."""
    exit_price = leg.get("exit_price")
    if exit_price is None:
        return None
    sign = 1 if leg["side"] == "Buy" else -1
    return (float(exit_price) - float(leg["entry_price"])) * int(leg["quantity"]) * sign


async def _exit_leg(service: Any, leg: dict[str, Any]) -> None:
    await service.place_order(
        {
            "symbol": leg["symbol"],
            "quantity": leg["quantity"],
            "side": _EXIT_SIDE[leg["side"]],
            "order_type": "MARKET",
            "product_type": leg["product_type"],
            "limit_price": 0,
            "stop_price": 0,
            "validity": "DAY",
            "disclosed_quantity": 0,
            "offline_order": False,
            "stop_loss": 0,
            "take_profit": 0,
        }
    )
    if leg.get("protective_stop_order_id"):
        try:
            await service.cancel_order(leg["protective_stop_order_id"])
        except Exception:
            # The position is already flat; a stop order left resting on it
            # is a nuisance (or, worse, could open a fresh naked position if
            # it later fills) but the exit itself already succeeded — this
            # must not be reported as the exit having failed.
            logger.exception(
                "Exited %s but could not cancel its now-stale protective stop", leg["symbol"]
            )


async def _reconcile_pending_entries(service: Any, legs: list[dict[str, Any]]) -> bool:
    """Turn accepted entry orders into protected open legs only after fill.

    Broker basket APIs return an order id before an order has traded.  We
    cancel any unfilled remainder on the first observed partial fill so the
    basket cannot grow later without a matching stop/target configuration.
    """
    pending = [leg for leg in legs if leg.get("status") == "PendingEntry"]
    if not pending:
        return False
    try:
        orders = await service.get_orders()
    except Exception:
        logger.exception("Could not reconcile pending basket entries")
        return False
    by_id = {str(order.get("id")): order for order in orders if order.get("id")}
    changed = False
    for leg in pending:
        order = by_id.get(str(leg.get("entry_order_id")))
        if not order:
            continue
        filled = int(order.get("filled_quantity", 0) or 0)
        remaining = int(order.get("remaining_quantity", 0) or 0)
        status = str(order.get("status", "")).upper()
        if filled <= 0:
            if status in _TERMINAL_ENTRY_STATUSES:
                leg["status"] = "Failed"
                leg["close_reason"] = f"Entry {status.title()}"
                changed = True
            continue
        if remaining > 0:
            try:
                await service.cancel_order(str(leg["entry_order_id"]))
            except Exception:
                logger.exception(
                    "Could not cancel basket entry remainder %s", leg["entry_order_id"]
                )
                continue
        leg["quantity"] = filled
        leg["entry_price"] = float(order.get("average_price", 0) or 0)
        leg["status"] = "Open"
        if leg.get("stop_loss"):
            try:
                stop = await service.place_order(
                    {
                        "symbol": leg["symbol"], "quantity": filled,
                        "side": _EXIT_SIDE[leg["side"]], "order_type": "STOP",
                        "product_type": leg["product_type"], "limit_price": 0,
                        "stop_price": leg["stop_loss"], "validity": "DAY",
                        "disclosed_quantity": 0, "offline_order": False,
                        "stop_loss": 0, "take_profit": 0,
                    }
                )
                leg["protective_stop_order_id"] = stop.get("id")
            except Exception:
                logger.exception("Could not arm protective stop for %s", leg["symbol"])
        changed = True
    return changed


async def _process_basket(service: Any, db: Any, basket: Any) -> None:
    legs: list[dict[str, Any]] = basket.legs
    reconciled = await _reconcile_pending_entries(service, legs)
    open_legs = [leg for leg in legs if leg["status"] == "Open"]
    if not open_legs:
        if not any(leg.get("status") == "PendingEntry" for leg in legs):
            if reconciled:
                await live_basket_store.update_legs(db, basket.id, legs)
            await live_basket_store.close_basket(db, basket.id, reason="All legs already closed")
        elif reconciled:
            await live_basket_store.update_legs(db, basket.id, legs)
        return

    try:
        quotes = await service.get_quotes(list({leg["symbol"] for leg in open_legs}))
    except Exception:
        logger.exception("Could not fetch quotes for basket %s", basket.id)
        return
    price_by_symbol = {
        str(quote.get("trading_symbol") or quote.get("symbol")): float(quote["last_price"])
        for quote in quotes
        if quote.get("last_price", 0) > 0
    }

    changed = reconciled
    # Some broker order books omit average traded price.  Once a fill is
    # confirmed, a contemporaneous quote is a safer fallback than retaining
    # zero and turning every later P&L calculation into nonsense.
    for leg in open_legs:
        if not leg.get("entry_price") and leg["symbol"] in price_by_symbol:
            leg["entry_price"] = price_by_symbol[leg["symbol"]]
            changed = True
    for leg in open_legs:
        price = price_by_symbol.get(leg["symbol"])
        target_price = leg.get("target_price")
        if target_price is not None:
            hit = price is not None and (
                price >= target_price if leg["side"] == "Buy" else price <= target_price
            )
        elif leg.get("target") is not None:  # pre-target_price basket records
            pnl = _leg_pnl(leg, price_by_symbol)
            hit = pnl is not None and pnl >= leg["target"]
        else:
            hit = False
        if not hit:
            continue
        try:
            await _exit_leg(service, leg)
        except Exception:
            logger.exception("Could not exit leg %s for basket %s", leg["symbol"], basket.id)
            continue
        leg["status"] = "Closed"
        leg["exit_price"] = price_by_symbol.get(leg["symbol"])
        leg["close_reason"] = "Target price hit" if target_price is not None else "Target hit"
        changed = True

    combined_pnl = 0.0
    missing_combined_quote = False
    for leg in legs:
        if leg["status"] == "Open":
            pnl = _leg_pnl(leg, price_by_symbol)
            if pnl is None:
                missing_combined_quote = True
                break
            combined_pnl += pnl
        else:
            realized = _realized_leg_pnl(leg)
            if realized is not None:
                combined_pnl += realized

    combined_close_reason: str | None = None
    if not missing_combined_quote:
        stop_loss = basket.combined_stop_loss
        if stop_loss is not None and combined_pnl <= -abs(stop_loss):
            combined_close_reason = "Combined stop-loss hit"
        elif (
            basket.combined_take_profit is not None
            and combined_pnl >= basket.combined_take_profit
        ):
            combined_close_reason = "Combined target hit"

    if combined_close_reason:
        for leg in legs:
            if leg["status"] != "Open":
                continue
            try:
                await _exit_leg(service, leg)
            except Exception:
                logger.exception(
                    "Could not exit leg %s for basket %s combined close", leg["symbol"], basket.id
                )
                continue
            leg["status"] = "Closed"
            leg["exit_price"] = price_by_symbol.get(leg["symbol"])
            leg["close_reason"] = combined_close_reason
        await live_basket_store.update_legs(db, basket.id, legs)
        await live_basket_store.close_basket(db, basket.id, reason=combined_close_reason)
        return

    if changed:
        await live_basket_store.update_legs(db, basket.id, legs)
        if all(leg["status"] != "Open" for leg in legs):
            await live_basket_store.close_basket(db, basket.id, reason="All legs closed")


async def run_basket_monitor(settings: Settings) -> None:
    """Sweep every open live basket once. One basket failing must not stop
    the rest from being checked — same isolation as the other scheduled jobs."""
    service = session_manager.get_active_session()
    owner_id = session_manager.get_active_client_id()
    if service is None or owner_id is None or not is_regular_market_open(segment="fno"):
        return
    async with async_session_maker() as db:
        baskets = await live_basket_store.load_open_baskets(db, owner_id=owner_id)
        for basket in baskets:
            try:
                await _process_basket(service, db, basket)
            except Exception:
                logger.exception("Basket monitor failed for basket %s", basket.id)


async def basket_monitor_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    """Run immediately, then repeat at the configured interval until shutdown."""
    while not stop_event.is_set():
        await run_basket_monitor(settings)
        stop_wait = asyncio.create_task(stop_event.wait())
        done, pending = await asyncio.wait(
            {stop_wait},
            timeout=settings.basket_monitor_interval_seconds,
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
