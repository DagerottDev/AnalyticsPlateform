"""Cached, announced NSE corporate-event calendar for the IV screener.

This deliberately sits outside the IV snapshot pipeline: the screener can
continue to load its stored ATM-IV observations even when NSE corporate
filings are unavailable.  A calendar failure is surfaced to clients as an
explicit freshness state rather than being mistaken for an empty calendar.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")
_NSE_API_BASE = "https://www.nseindia.com/api"
_CACHE_TTL_SECONDS = 30 * 60
_MAX_CALENDAR_DAYS = 60
_NSE_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-application",
    "User-Agent": "Mozilla/5.0 (compatible; AnalyticsPlatform/1.0)",
}

CorporateEventType = Literal[
    "results", "board_meeting", "dividend", "split", "bonus", "buyback", "rights"
]
CorporateEventDateKind = Literal["meeting_date", "ex_date", "record_date"]
CalendarStatus = Literal["ready", "stale", "unavailable"]


@dataclass(frozen=True)
class CorporateCalendarEvent:
    symbol: str
    event_type: CorporateEventType
    title: str
    event_date: date
    date_kind: CorporateEventDateKind
    source: Literal["NSE"] = "NSE"


@dataclass(frozen=True)
class CorporateCalendarSnapshot:
    events: tuple[CorporateCalendarEvent, ...]
    status: CalendarStatus
    updated_at: datetime | None


class CorporateCalendarStore:
    """Process-local NSE corporate-filings cache with safe stale fallback."""

    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._client = http_client
        self._events: tuple[CorporateCalendarEvent, ...] = ()
        self._fetched_at = 0.0
        self._updated_at: datetime | None = None
        self._has_snapshot = False
        self._lock = asyncio.Lock()

    async def get(
        self, symbols: Iterable[str], start_date: date, end_date: date
    ) -> CorporateCalendarSnapshot:
        """Return only known events for the requested symbols/date range."""
        if not self._is_fresh():
            async with self._lock:
                if not self._is_fresh():
                    await self._refresh()

        requested_symbols = {symbol.strip().upper() for symbol in symbols if symbol.strip()}
        events = tuple(
            event
            for event in self._events
            if event.symbol in requested_symbols and start_date <= event.event_date <= end_date
        )
        status: CalendarStatus
        if self._is_fresh():
            status = "ready"
        elif self._has_snapshot:
            status = "stale"
        else:
            status = "unavailable"
        return CorporateCalendarSnapshot(events=events, status=status, updated_at=self._updated_at)

    def _is_fresh(self) -> bool:
        return self._has_snapshot and time.monotonic() - self._fetched_at < _CACHE_TTL_SECONDS

    async def _refresh(self) -> None:
        today = datetime.now(IST).date()
        end_date = today + timedelta(days=_MAX_CALENDAR_DAYS)
        try:
            if self._client is not None:
                events = await self._fetch(self._client, today, end_date)
            else:
                async with httpx.AsyncClient(timeout=20.0, headers=_NSE_HEADERS) as client:
                    events = await self._fetch(client, today, end_date)
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            logger.warning("Failed to fetch NSE corporate calendar: %s", exc)
            return

        self._events = tuple(events)
        self._fetched_at = time.monotonic()
        self._updated_at = datetime.now(IST)
        self._has_snapshot = True

    @staticmethod
    async def _fetch(
        client: httpx.AsyncClient, start_date: date, end_date: date
    ) -> list[CorporateCalendarEvent]:
        params = {
            "index": "equities",
            "from_date": start_date.strftime("%d-%m-%Y"),
            "to_date": end_date.strftime("%d-%m-%Y"),
        }
        actions_response, meetings_response, announcements_response = await asyncio.gather(
            client.get(f"{_NSE_API_BASE}/corporates-corporateActions", params=params),
            client.get(f"{_NSE_API_BASE}/corporate-board-meetings", params=params),
            client.get(f"{_NSE_API_BASE}/corporate-announcements", params=params),
        )
        responses = (actions_response, meetings_response, announcements_response)
        for response in responses:
            response.raise_for_status()

        action_rows = _rows(actions_response.json())
        meeting_rows = _rows(meetings_response.json())
        announcement_rows = _rows(announcements_response.json())
        events = [
            *_action_events(action_rows),
            *_meeting_events(meeting_rows),
            *_result_events(announcement_rows),
        ]
        return _dedupe(events)


def _rows(payload: Any) -> list[Mapping[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, Mapping)]
    if isinstance(payload, Mapping):
        for key in ("data", "records", "results"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, Mapping)]
    raise ValueError("NSE corporate-calendar response did not contain rows")


def _value(row: Mapping[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip() not in {"", "-", "NA", "N.A."}:
            return str(value).strip()
    return ""


def _parse_date(value: str) -> date | None:
    if not value:
        return None
    cleaned = value.strip().split("T", 1)[0]
    for pattern in (
        "%d-%b-%Y",
        "%d-%m-%Y",
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d %b %Y",
        "%b %d, %Y",
    ):
        try:
            return datetime.strptime(cleaned, pattern).date()
        except ValueError:
            pass
    return None


def _symbol(row: Mapping[str, Any]) -> str:
    return _value(row, "symbol", "symbolName", "sm_symbol").upper()


def _action_type(purpose: str) -> CorporateEventType | None:
    normalized = purpose.lower()
    if "dividend" in normalized:
        return "dividend"
    if "split" in normalized:
        return "split"
    if "bonus" in normalized:
        return "bonus"
    if "buy back" in normalized or "buyback" in normalized:
        return "buyback"
    if "right" in normalized:
        return "rights"
    return None


def _action_events(rows: Iterable[Mapping[str, Any]]) -> list[CorporateCalendarEvent]:
    events: list[CorporateCalendarEvent] = []
    for row in rows:
        symbol = _symbol(row)
        title = _value(row, "purpose", "subject", "description")
        event_type = _action_type(title)
        ex_date = _parse_date(_value(row, "exDate", "ex_date", "exDt"))
        record_date = _parse_date(_value(row, "recordDate", "record_date", "recordDt"))
        event_date = ex_date if ex_date is not None else record_date
        if not symbol or event_type is None or event_date is None:
            continue
        events.append(
            CorporateCalendarEvent(
                symbol=symbol,
                event_type=event_type,
                title=title,
                event_date=event_date,  # Ex-date is the relevant trading date.
                date_kind="ex_date" if ex_date is not None else "record_date",
            )
        )
    return events


def _meeting_events(rows: Iterable[Mapping[str, Any]]) -> list[CorporateCalendarEvent]:
    events: list[CorporateCalendarEvent] = []
    for row in rows:
        symbol = _symbol(row)
        title = _value(row, "purpose", "subject", "bm_desc")
        event_date = _parse_date(
            _value(row, "meetingDate", "meeting_date", "bm_date", "date")
        )
        if not symbol or not event_date:
            continue
        event_type: CorporateEventType = "results" if "result" in title.lower() else "board_meeting"
        events.append(
            CorporateCalendarEvent(
                symbol=symbol,
                event_type=event_type,
                title=title or "Board meeting",
                event_date=event_date,
                date_kind="meeting_date",
            )
        )
    return events


def _result_events(rows: Iterable[Mapping[str, Any]]) -> list[CorporateCalendarEvent]:
    """Keep only announcement rows that explicitly signal future results."""
    events: list[CorporateCalendarEvent] = []
    for row in rows:
        symbol = _symbol(row)
        title = _value(row, "subject", "desc", "announcementSubject")
        if not symbol or "result" not in title.lower():
            continue
        event_date = _parse_date(
            _value(row, "meetingDate", "meeting_date", "bm_date", "date")
        )
        if event_date is None:
            continue
        events.append(
            CorporateCalendarEvent(
                symbol=symbol,
                event_type="results",
                title=title,
                event_date=event_date,
                date_kind="meeting_date",
            )
        )
    return events


def _dedupe(events: Iterable[CorporateCalendarEvent]) -> list[CorporateCalendarEvent]:
    unique = {
        (event.symbol, event.event_type, event.title, event.event_date, event.date_kind): event
        for event in events
    }
    return sorted(
        unique.values(),
        key=lambda event: (event.symbol, event.event_date, event.event_type, event.title),
    )


corporate_calendar_store = CorporateCalendarStore()
