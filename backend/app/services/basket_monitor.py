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
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)

_EXIT_SIDE = {"Buy": "Sell", "Sell": "Buy"}


def _leg_pnl(leg: dict[str, Any], price_by_symbol: dict[str, float]) -> float | None:
    """Live P&L for one still-open leg, or None if no fresh quote is available."""
    price = price_by_symbol.get(leg["symbol"])
    if price is None:
        return None
    sign = 1 if leg["side"] == "Buy" else -1
    return (price - leg["entry_price"]) * leg["quantity"] * sign


def _realized_leg_pnl(leg: dict[str, Any]) -> float | None:
    """Locked-in P&L for a leg that already exited, for combined P&L accounting."""
    exit_price = leg.get("exit_price")
    if exit_price is None:
        return None
    sign = 1 if leg["side"] == "Buy" else -1
    return (exit_price - leg["entry_price"]) * leg["quantity"] * sign


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


async def _process_basket(service: Any, db: Any, basket: Any) -> None:
    legs: list[dict[str, Any]] = basket.legs
    open_legs = [leg for leg in legs if leg["status"] == "Open"]
    if not open_legs:
        await live_basket_store.close_basket(db, basket.id, reason="All legs already closed")
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

    changed = False
    for leg in open_legs:
        if leg.get("target") is None:
            continue
        pnl = _leg_pnl(leg, price_by_symbol)
        if pnl is None or pnl < leg["target"]:
            continue
        try:
            await _exit_leg(service, leg)
        except Exception:
            logger.exception("Could not exit leg %s for basket %s", leg["symbol"], basket.id)
            continue
        leg["status"] = "Closed"
        leg["exit_price"] = price_by_symbol.get(leg["symbol"])
        leg["close_reason"] = "Target hit"
        changed = True

    combined_pnl: float | None = 0.0
    for leg in legs:
        if leg["status"] == "Open":
            pnl = _leg_pnl(leg, price_by_symbol)
            if pnl is None:
                combined_pnl = None
                break
            combined_pnl += pnl
        else:
            realized = _realized_leg_pnl(leg)
            if realized is not None:
                combined_pnl += realized

    combined_close_reason: str | None = None
    if combined_pnl is not None:
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
    if service is None:
        return
    async with async_session_maker() as db:
        baskets = await live_basket_store.load_open_baskets(db)
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
