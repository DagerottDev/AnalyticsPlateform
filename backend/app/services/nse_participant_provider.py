"""Adapter for NSE's public F&O participant reports.

NSE's participant CSVs are public archive files.  ``nselib`` currently performs
an HTTP (rather than HTTPS) cookie bootstrap before requesting those files;
that bootstrap is rejected by some networks and makes an otherwise available
report look unavailable.  Fetch the official HTTPS archive directly and keep
the parsing layer independent from pandas so it is easy to test.
"""

import asyncio
import csv
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date

import requests

METRICS = (
    "future_index_long",
    "future_index_short",
    "future_stock_long",
    "future_stock_short",
    "option_index_call_long",
    "option_index_put_long",
    "option_index_call_short",
    "option_index_put_short",
    "option_stock_call_long",
    "option_stock_put_long",
    "option_stock_call_short",
    "option_stock_put_short",
    "total_long",
    "total_short",
)

_PARTICIPANT_TYPES = {
    "client": "CLIENT",
    "dii": "DII",
    "fii": "FII_FPI",
    "fpi": "FII_FPI",
    "fiifpi": "FII_FPI",
    "pro": "PROPRIETARY",
    "proprietary": "PROPRIETARY",
}
_HEADER_TO_METRIC = {
    "futureindexlong": "future_index_long",
    "futureindexshort": "future_index_short",
    "futurestocklong": "future_stock_long",
    "futurestockshort": "future_stock_short",
    "optionindexcalllong": "option_index_call_long",
    "optionindexputlong": "option_index_put_long",
    "optionindexcallshort": "option_index_call_short",
    "optionindexputshort": "option_index_put_short",
    "optionstockcalllong": "option_stock_call_long",
    "optionstockputlong": "option_stock_put_long",
    "optionstockcallshort": "option_stock_call_short",
    "optionstockputshort": "option_stock_put_short",
    "totallongcontracts": "total_long",
    "totalshortcontracts": "total_short",
}
_CLIENT_TYPE_HEADERS = {"clienttype", "participanttype", "participantcategory"}


class ParticipantReportUnavailableError(RuntimeError):
    """NSE has not published a usable report for the requested date yet."""


@dataclass(frozen=True)
class ParticipantReportRow:
    participant_type: str
    oi: dict[str, float]
    volume: dict[str, float]


def _header_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value).casefold())


def _number(value: object) -> float:
    if value is None or isinstance(value, bool):
        return 0.0
    if isinstance(value, int | float):
        return float(value) if math.isfinite(value) else 0.0
    cleaned = str(value).replace(",", "").strip()
    if not cleaned or cleaned in {"-", "--", "NA", "N/A"}:
        return 0.0
    try:
        candidate = float(cleaned)
    except ValueError:
        return 0.0
    return candidate if math.isfinite(candidate) else 0.0


def _records(frame: object) -> list[Mapping[str, object]]:
    """Support pandas data frames while keeping parsing independently testable."""
    if isinstance(frame, list) and all(isinstance(item, Mapping) for item in frame):
        return list(frame)
    to_dict = getattr(frame, "to_dict", None)
    if callable(to_dict):
        records = to_dict(orient="records")
        if isinstance(records, list) and all(isinstance(item, Mapping) for item in records):
            return records
    raise ParticipantReportUnavailableError("NSE participant report returned an unsupported shape")


_NSE_REPORT_HEADERS = {
    "Accept": "text/csv,application/octet-stream;q=0.9,*/*;q=0.8",
    "Referer": "https://www.nseindia.com/",
    # NSE rejects the default python-requests user agent intermittently.
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
}


def _report_urls(report_prefix: str, trade_date: date) -> tuple[str, ...]:
    stamp = trade_date.strftime("%d%m%Y")
    filename = f"{report_prefix}{stamp}.csv"
    return (
        f"https://nsearchives.nseindia.com/content/nsccl/{filename}",
        f"https://archives.nseindia.com/content/nsccl/{filename}",
    )


def _csv_records(content: bytes) -> list[Mapping[str, object]]:
    """Decode an NSE report, tolerating its title row and trailing footer."""
    text = content.decode("utf-8-sig", errors="replace")
    lines = text.splitlines()
    if not lines:
        raise ParticipantReportUnavailableError("NSE participant report was empty")

    # The published files have a human-readable title before the CSV header.
    # A zero-offset retry also handles mirrors that omit that title.
    for offset in (1, 0):
        if offset >= len(lines):
            continue
        reader = csv.DictReader(lines[offset:])
        records: list[Mapping[str, object]] = []
        for row in reader:
            records.append({str(key): value for key, value in row.items() if key is not None})
        if any(
            _header_key(key) in _CLIENT_TYPE_HEADERS
            for record in records
            for key in record
        ):
            return records
    raise ParticipantReportUnavailableError(
        "NSE participant report did not contain a recognized participant column"
    )


def _fetch_report_csv(report_prefix: str, trade_date: date) -> list[Mapping[str, object]]:
    """Fetch one official report, trying both current NSE archive hosts."""
    last_error = "no matching archive file"
    with requests.Session() as session:
        for url in _report_urls(report_prefix, trade_date):
            try:
                response = session.get(url, headers=_NSE_REPORT_HEADERS, timeout=(5, 20))
            except requests.RequestException as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                continue

            if response.status_code in {404, 410}:
                last_error = f"HTTP {response.status_code}"
                continue
            if response.status_code != 200:
                last_error = f"HTTP {response.status_code}"
                continue
            try:
                return _csv_records(response.content)
            except ParticipantReportUnavailableError as exc:
                last_error = str(exc)
                continue

    report_name = "open-interest" if "_oi_" in report_prefix else "trading-volume"
    raise ParticipantReportUnavailableError(
        f"NSE {report_name} report for {trade_date.isoformat()} unavailable: {last_error}"
    )


def _parse_report(frame: object) -> dict[str, dict[str, float]]:
    parsed: dict[str, dict[str, float]] = {}
    for record in _records(frame):
        participant_value = next(
            (value for key, value in record.items() if _header_key(key) in _CLIENT_TYPE_HEADERS),
            None,
        )
        participant = _PARTICIPANT_TYPES.get(_header_key(participant_value))
        if participant is None:
            continue
        values = {metric: 0.0 for metric in METRICS}
        for key, value in record.items():
            metric = _HEADER_TO_METRIC.get(_header_key(key))
            if metric is not None:
                values[metric] = _number(value)
        parsed[participant] = values
    if not parsed:
        raise ParticipantReportUnavailableError(
            "NSE participant report contained no recognized categories"
        )
    return parsed


class NseParticipantProvider:
    """Fetch and normalize the two official NSE participant reports."""

    def _fetch_sync(self, trade_date: date) -> tuple[object, object]:
        return (
            _fetch_report_csv("fao_participant_oi_", trade_date),
            _fetch_report_csv("fao_participant_vol_", trade_date),
        )

    async def fetch(self, trade_date: date) -> list[ParticipantReportRow]:
        try:
            oi_frame, volume_frame = await asyncio.to_thread(self._fetch_sync, trade_date)
            oi_by_participant = _parse_report(oi_frame)
            volume_by_participant = _parse_report(volume_frame)
        except ParticipantReportUnavailableError:
            raise
        except Exception as exc:
            raise ParticipantReportUnavailableError(str(exc)) from exc

        participants = set(oi_by_participant) & set(volume_by_participant)
        if not participants:
            raise ParticipantReportUnavailableError(
                "NSE OI and volume categories did not overlap"
            )
        return [
            ParticipantReportRow(
                participant_type=participant,
                oi=oi_by_participant[participant],
                volume=volume_by_participant[participant],
            )
            for participant in sorted(participants)
        ]
