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
from app.services.order_reconciliation import exit_order_tag, find_order_by_tag
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)

_EXIT_SIDE = {"Buy": "Sell", "Sell": "Buy"}
_TERMINAL_ENTRY_STATUSES = {"CANCELLED", "CANCELED", "REJECTED", "FAILED"}
# A basket must not be closed at the basket level (see _has_active_legs)
# while any leg is in one of these. PendingEntry/Open/Exiting are still
# being actively monitored — closing the basket would stop
# load_open_baskets from ever surfacing it again, orphaning that leg's
# in-flight entry/exit. NeedsReview is different: the monitor has stopped
# retrying it, but its actual outcome at the broker is still unknown — the
# basket must stay "Open" anyway, or a "Closed" basket record would
# misleadingly imply that leg's fate got resolved when it didn't.
_ACTIVE_LEG_STATUSES = {"PendingEntry", "Open", "Exiting", "NeedsReview"}
# How many consecutive reconciliation misses an "Exiting" leg gets (i.e. how
# many times _exit_leg is retried) before the monitor stops touching it
# automatically and flags it for manual review instead of retrying forever.
_MAX_EXIT_RECONCILE_ATTEMPTS = 2


def _has_active_legs(legs: list[dict[str, Any]]) -> bool:
    return any(leg.get("status") in _ACTIVE_LEG_STATUSES for leg in legs)


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


async def _exit_leg(service: Any, leg: dict[str, Any]) -> str | None:
    """Place the exit order, tagged for reconciliation. Returns the
    broker's own id for the exit order (may be None even on success, if the
    broker's response doesn't happen to include one)."""
    result = await service.place_order(
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
            # Lets _reconcile_exiting_legs find this exact attempt in the
            # broker's order book if this call raises before returning
            # cleanly — see _attempt_exit_leg, which marks the leg
            # "Exiting" first for exactly that scenario. entry_order_id is
            # set on every leg placed via place_basket_order, but fall back
            # to the symbol rather than raising for any legacy record that
            # predates it — a less unique tag is still far better than
            # crashing the exit attempt entirely.
            "order_tag": exit_order_tag(str(leg.get("entry_order_id") or leg["symbol"])),
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
    order_id = result.get("id")
    return str(order_id) if order_id is not None else None


async def _attempt_exit_leg(
    service: Any, leg: dict[str, Any], price_by_symbol: dict[str, float], reason: str
) -> None:
    """Try to exit one leg, marking it "Exiting" *before* the broker call.

    If that call then raises, the leg is left "Exiting" rather than
    "Open" — _reconcile_exiting_legs (not the plain target/stop check that
    got us here) owns what happens to it next. Without this, a retry next
    tick would just call _exit_leg again blindly against the same
    still-true target/stop condition, risking a double-exit if the first
    call actually reached the broker before raising.

    Deliberately does not touch `exit_reconcile_misses`: a leg that misses
    reconciliation gets flipped back to "Open" (see _reconcile_exiting_legs)
    and lands right back here on the very next tick if its target/stop
    condition is still true, which would otherwise reset the counter to 0
    on every single attempt — the count would never reach the bound meant
    to stop it retrying forever. Only _reconcile_exiting_legs owns that
    counter.
    """
    leg["status"] = "Exiting"
    try:
        exit_order_id = await _exit_leg(service, leg)
    except Exception:
        logger.exception(
            "Could not exit leg %s (%s) — will reconcile next tick", leg["symbol"], reason
        )
        return
    leg["status"] = "Closed"
    leg["exit_price"] = price_by_symbol.get(leg["symbol"])
    leg["close_reason"] = reason
    leg["exit_order_id"] = exit_order_id


async def _reconcile_exiting_legs(service: Any, legs: list[dict[str, Any]]) -> bool:
    """Resolve legs left "Exiting" by an ambiguous _attempt_exit_leg failure.

    Searches the broker's order book for the tag submitted at the exit
    attempt (see exit_order_tag/_exit_leg) rather than guessing.
      - Found -> the exit actually went through; mark the leg Closed.
      - Not found, and this is the leg's first miss -> one bounded retry:
        flip back to Open so the normal target/stop logic re-attempts
        _exit_leg next tick.
      - Not found on a second consecutive miss -> stop automatically
        touching this leg. Flag it "NeedsReview" (logged at ERROR) instead
        of retrying forever.
    """
    exiting = [leg for leg in legs if leg.get("status") == "Exiting"]
    if not exiting:
        return False
    try:
        orders = await service.get_orders()
    except Exception:
        logger.exception("Could not reconcile exiting basket legs")
        return False
    for leg in exiting:
        # Must match whatever _exit_leg actually derived the tag from.
        tag = exit_order_tag(str(leg.get("entry_order_id") or leg["symbol"]))
        match = find_order_by_tag(orders, tag)
        if match is not None:
            leg["status"] = "Closed"
            leg["exit_order_id"] = match.get("id")
            leg.setdefault("close_reason", "Exit confirmed via reconciliation")
            continue
        misses = int(leg.get("exit_reconcile_misses", 0)) + 1
        leg["exit_reconcile_misses"] = misses
        if misses >= _MAX_EXIT_RECONCILE_ATTEMPTS:
            leg["status"] = "NeedsReview"
            logger.error(
                "Could not confirm exit for leg %s after %d attempt(s); "
                "leaving for manual review rather than retrying indefinitely",
                leg["symbol"],
                misses,
            )
        else:
            leg["status"] = "Open"  # one bounded retry
    return True


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


async def _arm_missing_protective_stops(service: Any, legs: list[dict[str, Any]]) -> bool:
    """Retry arming a leg's protective STOP if an earlier attempt failed.

    _reconcile_pending_entries only gets one attempt at this, immediately
    after fill confirmation — it never revisits a leg once its status is
    "Open". If that one attempt raised (a transient broker/network hiccup),
    the leg was left permanently unprotected for the rest of the basket's
    life with no way to notice or retry (the module's own docstring assumes
    the protective stop "stays broker-enforced and survives this loop not
    running", which is only true once it's actually been placed). Re-check
    every tick instead so a leg only ever stays unprotected as briefly as
    the next monitor cycle.
    """
    changed = False
    for leg in legs:
        if (
            leg.get("status") != "Open"
            or not leg.get("stop_loss")
            or leg.get("protective_stop_order_id")
        ):
            continue
        try:
            stop = await service.place_order(
                {
                    "symbol": leg["symbol"], "quantity": leg["quantity"],
                    "side": _EXIT_SIDE[leg["side"]], "order_type": "STOP",
                    "product_type": leg["product_type"], "limit_price": 0,
                    "stop_price": leg["stop_loss"], "validity": "DAY",
                    "disclosed_quantity": 0, "offline_order": False,
                    "stop_loss": 0, "take_profit": 0,
                }
            )
            leg["protective_stop_order_id"] = stop.get("id")
            changed = True
        except Exception:
            logger.exception(
                "Retry: could not arm protective stop for %s (will retry again next tick)",
                leg["symbol"],
            )
    return changed


async def _process_basket(service: Any, db: Any, basket: Any) -> None:
    legs: list[dict[str, Any]] = basket.legs
    reconciled = await _reconcile_pending_entries(service, legs)
    if await _arm_missing_protective_stops(service, legs):
        reconciled = True
    if await _reconcile_exiting_legs(service, legs):
        reconciled = True
    open_legs = [leg for leg in legs if leg["status"] == "Open"]
    if not open_legs:
        # _has_active_legs also covers "Exiting" (a leg reconciliation just
        # left there for another attempt) and "PendingEntry" — the basket
        # must stay "Open" at the basket level while either is true, or
        # load_open_baskets would never surface it again to finish the job.
        if not _has_active_legs(legs):
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
        await _attempt_exit_leg(
            service,
            leg,
            price_by_symbol,
            "Target price hit" if target_price is not None else "Target hit",
        )
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
            await _attempt_exit_leg(service, leg, price_by_symbol, combined_close_reason)
        await live_basket_store.update_legs(db, basket.id, legs)
        # Only actually close the basket once every leg has reached a
        # terminal state. A leg _attempt_exit_leg left "Exiting" (its
        # broker call was ambiguous) still needs _reconcile_exiting_legs to
        # run again — which never happens if the basket itself is marked
        # Closed here, since load_open_baskets would stop surfacing it.
        if not _has_active_legs(legs):
            await live_basket_store.close_basket(db, basket.id, reason=combined_close_reason)
        return

    if changed:
        await live_basket_store.update_legs(db, basket.id, legs)
        if not _has_active_legs(legs):
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
        try:
            await run_basket_monitor(settings)
        except Exception:
            # run_basket_monitor only guards the per-basket body (see the
            # try/except around _process_basket inside it) — a transient
            # failure in the setup around it (session_manager,
            # live_basket_store.load_open_baskets, the DB connection itself)
            # would otherwise propagate out of this while loop and
            # permanently kill the task, silently ending all target/
            # stop-loss enforcement for every open basket for the rest of
            # the process's life. Log and retry next tick instead.
            logger.exception("Basket monitor cycle failed; will retry next tick")
        stop_wait = asyncio.create_task(stop_event.wait())
        done, pending = await asyncio.wait(
            {stop_wait},
            timeout=settings.basket_monitor_interval_seconds,
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
