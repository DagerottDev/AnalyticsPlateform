"""Tests for the shared order-tag reconciliation helper."""

from app.services.order_reconciliation import find_order_by_tag


def test_find_order_by_tag_returns_the_matching_order() -> None:
    orders = [
        {"id": "1", "order_tag": "gtt-abc"},
        {"id": "2", "order_tag": "gtt-xyz"},
    ]
    assert find_order_by_tag(orders, "gtt-xyz") == {"id": "2", "order_tag": "gtt-xyz"}


def test_find_order_by_tag_returns_none_when_no_match() -> None:
    orders = [{"id": "1", "order_tag": "gtt-abc"}]
    assert find_order_by_tag(orders, "gtt-xyz") is None


def test_find_order_by_tag_returns_none_for_an_empty_book() -> None:
    assert find_order_by_tag([], "gtt-xyz") is None


def test_find_order_by_tag_ignores_orders_with_no_tag() -> None:
    """Older orders (or a broker adapter that doesn't surface a tag) simply
    have no order_tag key/value — must not accidentally match a search."""
    orders = [{"id": "1"}, {"id": "2", "order_tag": None}]
    assert find_order_by_tag(orders, "gtt-abc") is None
