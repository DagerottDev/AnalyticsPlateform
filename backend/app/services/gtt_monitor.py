"""Server-hosted Fyers GTT evaluator; native Dhan orders are only expired here."""

import asyncio
import logging
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.session import async_session_maker
from app.services import gtt_store
from app.services.market_session import is_regular_market_open
from app.services.order_reconciliation import find_order_by_tag, gtt_order_tag
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)


async def _reconcile_unknown_gtt_orders(
    service: Any, db: AsyncSession, owner_id: str, settings: Settings
) -> None:
    """Resolve GTT records an earlier tick left "Unknown".

    "Unknown" means the trigger's `place_order` call raised *after* this
    monitor had already atomically claimed the row as "Triggered" — so the
    broker call was actually reached, but it's not known whether it
    succeeded there before the exception happened (vs. clearly failing
    client-side). Every such placement is tagged via `gtt_order_tag()` (see
    where `place_order` is called below, and api/v1/orders.py's Dhan-native
    creation path), so this searches the broker's own order book for that
    same tag rather than guessing.
    """
    unknown = await gtt_store.unknown_for_owner(db, owner_id)
    if not unknown:
        return
    try:
        orders = await service.get_orders()
    except Exception:
        logger.exception("Could not reconcile Unknown GTT orders for %s", owner_id)
        return
    now = datetime.now(UTC)
    for record in unknown:
        match = find_order_by_tag(orders, gtt_order_tag(record.id))
        if match is not None:
            await gtt_store.try_finish(
                db,
                record.id,
                from_status="Unknown",
                status="Placed",
                execution_order_id=match.get("id"),
            )
            continue
        # triggered_at is set at the same point the placement attempt (and
        # its tag) was made, so it's the right reference for "how long has
        # this tag had a chance to show up in the order book".
        reference_time = record.triggered_at or record.created_at
        elapsed = (now - reference_time).total_seconds() if reference_time else 0.0
        if elapsed > settings.order_reconciliation_timeout_seconds:
            logger.error(
                "GTT %s could not be reconciled with the broker's order book "
                "after %.0fs; marking Failed",
                record.id,
                elapsed,
            )
            await gtt_store.try_finish(
                db,
                record.id,
                from_status="Unknown",
                status="Failed",
                error="Could not confirm broker placement within the reconciliation window",
            )
        # else: still within the window — leave it "Unknown", try again next tick.


async def run_gtt_monitor(settings: Settings) -> None:
    service = session_manager.get_active_session()
    owner_id = session_manager.get_active_client_id()
    if service is None or owner_id is None:
        return
    async with async_session_maker() as db:
        await _reconcile_unknown_gtt_orders(service, db, owner_id, settings)
        for order in await gtt_store.pending_for_owner(db, owner_id):
            if order.expires_at <= datetime.now(UTC):
                # Atomically claim Pending -> Expired first: a concurrent
                # cancel (running in its own session, e.g. via the API) can
                # land on this exact record between pending_for_owner()'s
                # read above and this write. Claiming before touching the
                # broker avoids racing a user-initiated cancel of the same
                # native Dhan order, and avoids overwriting a status the
                # cancel endpoint already committed.
                claimed = await gtt_store.try_finish(
                    db, order.id, from_status="Pending", status="Expired"
                )
                if claimed is None:
                    continue
                if (
                    claimed.broker_name.lower() == "dhan"
                    and claimed.native_order_id
                    and hasattr(service, "cancel_gtt_order")
                ):
                    try:
                        await service.cancel_gtt_order(claimed.native_order_id)
                    except Exception:
                        logger.exception("Could not cancel expired Dhan GTT %s", claimed.id)
                continue
            # Native Dhan owns its trigger decision. Fyers has no GTT endpoint.
            if order.broker_name.lower() != "fyers":
                continue
            if not is_regular_market_open(segment="fno"):
                continue
            claimed = None
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
                # Claim the Pending -> Triggered transition atomically rather
                # than a blind write, for the same reason as the cancel
                # endpoint's write: a user cancelling this exact GTT between
                # pending_for_owner()'s read and here must not be silently
                # overridden into placing a live order anyway.
                claimed = await gtt_store.try_finish(
                    db, order.id, from_status="Pending", status="Triggered"
                )
                if claimed is None:
                    continue
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
                        # Lets _reconcile_unknown_gtt_orders find this exact
                        # attempt in the broker's order book if the call
                        # below raises before we get a clean answer.
                        "order_tag": gtt_order_tag(claimed.id),
                    }
                )
                await gtt_store.finish(db, claimed, "Placed", execution_order_id=result.get("id"))
            except Exception as exc:
                logger.exception("GTT execution failed for %s", order.id)
                if claimed is not None:
                    # The broker call itself was reached (we'd already
                    # atomically claimed "Triggered" before calling
                    # place_order) — this exception doesn't tell us whether
                    # the broker actually accepted the order before it was
                    # raised (e.g. a response timeout). Marking "Failed"
                    # here would be a guess that could hide a live,
                    # untracked order. "Unknown" defers that guess to
                    # _reconcile_unknown_gtt_orders, which checks the
                    # broker's own order book by tag instead.
                    await gtt_store.try_finish(
                        db, claimed.id, from_status="Triggered", status="Unknown",
                        error=str(exc)[:500],
                    )
                else:
                    # Nothing reached the broker (e.g. get_quotes or the
                    # Pending -> Triggered claim itself failed) — a clean
                    # local failure, safe to mark outright.
                    await gtt_store.finish(db, order, "Failed", error=str(exc)[:500])


async def gtt_monitor_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await run_gtt_monitor(settings)
        except Exception:
            # run_gtt_monitor only guards the per-order body (see the
            # try/except inside it) — a transient failure in the setup
            # around it (session_manager, gtt_store.pending_for_owner, the
            # DB connection itself) would otherwise propagate out of this
            # while loop and permanently kill the task. From that point on
            # no GTT ever triggers or expires again for the rest of the
            # process's life, with nothing beyond a swallowed asyncio
            # "Task exception was never retrieved" warning to notice it.
            # Log and retry next tick instead.
            logger.exception("GTT monitor cycle failed; will retry next tick")
        with suppress(TimeoutError):
            await asyncio.wait_for(stop_event.wait(), timeout=2.0)
