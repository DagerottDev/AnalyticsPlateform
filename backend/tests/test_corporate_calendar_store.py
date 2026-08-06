"""Tests for the cached NSE corporate-event feed used by the IV screener."""

from datetime import date, timedelta

import httpx
import pytest

from app.services.corporate_calendar_store import CorporateCalendarStore


def _store_with_transport(handler) -> CorporateCalendarStore:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return CorporateCalendarStore(http_client=client)


def _payloads() -> dict[str, list[dict[str, str]]]:
    return {
        "corporates-corporateActions": [
            {
                "symbol": "RELIANCE",
                "purpose": "Dividend - Rs 10 Per Share",
                "exDate": "10-Aug-2026",
            },
            {"symbol": "RELIANCE", "purpose": "Bonus issue", "recordDate": "12-Aug-2026"},
            {"symbol": "IGNORE", "purpose": "Stock Split", "exDate": "11-Aug-2026"},
            {"symbol": "RELIANCE", "purpose": "Interest payment", "exDate": "11-Aug-2026"},
        ],
        "corporate-board-meetings": [
            {"symbol": "RELIANCE", "purpose": "Financial Results", "meetingDate": "08-Aug-2026"},
            {"symbol": "TCS", "purpose": "Board Meeting Intimation", "bm_date": "Aug 09, 2026"},
        ],
        "corporate-announcements": [
            {"symbol": "RELIANCE", "subject": "Financial Results", "meetingDate": "08-Aug-2026"},
            {
                "symbol": "RELIANCE",
                "subject": "Investor presentation",
                "meetingDate": "09-Aug-2026",
            },
        ],
    }


@pytest.mark.asyncio
async def test_normalizes_filters_and_deduplicates_announced_events() -> None:
    payloads = _payloads()

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payloads[request.url.path.rsplit("/", 1)[-1]])

    store = _store_with_transport(handler)
    calendar = await store.get({"RELIANCE", "TCS"}, date(2026, 8, 5), date(2026, 8, 10))

    assert calendar.status == "ready"
    assert [(event.symbol, event.event_type, event.date_kind) for event in calendar.events] == [
        ("RELIANCE", "results", "meeting_date"),
        ("RELIANCE", "dividend", "ex_date"),
        ("TCS", "board_meeting", "meeting_date"),
    ]
    assert calendar.events[0].event_date == date(2026, 8, 8)


@pytest.mark.asyncio
async def test_uses_stale_events_after_a_refresh_failure() -> None:
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls <= 3:
            return httpx.Response(200, json=_payloads()[request.url.path.rsplit("/", 1)[-1]])
        return httpx.Response(503)

    store = _store_with_transport(handler)
    first = await store.get({"RELIANCE"}, date(2026, 8, 5), date(2026, 8, 10))
    store._fetched_at -= 31 * 60
    stale = await store.get({"RELIANCE"}, date(2026, 8, 5), date(2026, 8, 10))

    assert first.status == "ready"
    assert stale.status == "stale"
    assert stale.events == first.events


@pytest.mark.asyncio
async def test_initial_failure_is_explicitly_unavailable() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    store = _store_with_transport(handler)
    calendar = await store.get({"RELIANCE"}, date.today(), date.today() + timedelta(days=14))

    assert calendar.status == "unavailable"
    assert calendar.events == ()
