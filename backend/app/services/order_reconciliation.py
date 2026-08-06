"""Shared helper for reconciling an ambiguous order-placement outcome
against the broker's own order book.

A broker call can raise for two reasons that look identical to the caller:
the broker *rejected* the request, or the broker *accepted* it but something
failed afterward (a response timeout is the common case — the request
reached the broker and was processed, but the confirmation never came back).
Treating both cases as "Failed" is wrong for the second one: it leaves a
live, untracked order at the broker.

The fix used across this app (see gtt_monitor.py's GTT-trigger placement and
basket_monitor.py's leg-exit placement) is to tag the *intent* with a unique
client-supplied identifier before ever calling place_order, so that if the
call itself is ambiguous, a later reconciliation pass can search the
broker's order book for that exact tag and find out what actually happened
— without needing the broker to support idempotency keys, and without
guessing based on symbol/quantity/timing.
"""

from typing import Any

# Dhan's correlationId field caps at 30 characters (Fyers' orderTag doesn't
# document as tight a limit) — truncating everywhere, including plain UUIDs
# like a GTT record's own id, to this shared length keeps the tag actually
# used at placement time and the tag searched for during reconciliation
# identical regardless of which broker adapter is involved. Do not change
# this without updating every caller that derives a tag from an id.
_MAX_TAG_LENGTH = 30


def gtt_order_tag(gtt_id: str) -> str:
    """Deterministic, broker-safe order tag for a GTT record's trigger/
    native placement — used both when placing (order_tag on the request)
    and when reconciling an ambiguous outcome (searched for via
    find_order_by_tag)."""
    return f"gtt-{gtt_id}"[:_MAX_TAG_LENGTH]


def exit_order_tag(entry_order_id: str) -> str:
    """Deterministic, broker-safe order tag for a basket leg's exit
    placement, keyed off its (already-unique) entry order id."""
    return f"exit-{entry_order_id}"[:_MAX_TAG_LENGTH]


def find_order_by_tag(orders: list[dict[str, Any]], tag: str) -> dict[str, Any] | None:
    """Search a normalized get_orders() result for a matching order_tag.

    `orders` is the list returned by a BrokerService.get_orders() call —
    each broker adapter surfaces its own tag field (Fyers' `orderTag`,
    Dhan's `correlationId`) as `"order_tag"` in that normalized dict.
    Returns the first match, or None if the tag isn't present in the book
    (yet, or ever).
    """
    for order in orders:
        if order.get("order_tag") == tag:
            return order
    return None
