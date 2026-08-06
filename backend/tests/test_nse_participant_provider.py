from datetime import date

import pytest

from app.services.nse_participant_provider import (
    NseParticipantProvider,
    ParticipantReportUnavailableError,
    _fetch_report_csv,
    _parse_report,
)


class FakeFrame:
    def __init__(self, records: list[dict[str, object]]) -> None:
        self.records = records

    def to_dict(self, *, orient: str) -> list[dict[str, object]]:
        assert orient == "records"
        return self.records


def _report(client_type: str, long: object, short: object) -> FakeFrame:
    return FakeFrame([
        {
            "Client Type": client_type,
            "Future Index Long": long,
            "Future Index Short": short,
            "Total Long Contracts": "1,234",
            "Total Short Contracts": "1,000",
        }
    ])


def test_parse_report_normalizes_categories_and_numbers() -> None:
    parsed = _parse_report(_report("FII/FPI", "45", "-"))

    assert parsed["FII_FPI"]["future_index_long"] == 45
    assert parsed["FII_FPI"]["future_index_short"] == 0
    assert parsed["FII_FPI"]["total_long"] == 1234


def test_parse_report_rejects_unrecognized_categories() -> None:
    with pytest.raises(ParticipantReportUnavailableError):
        _parse_report(_report("Unknown", 1, 2))


def test_fetch_report_csv_uses_https_archive_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResponse:
        def __init__(self, status_code: int, content: bytes = b"") -> None:
            self.status_code = status_code
            self.content = content

    class FakeSession:
        def __init__(self) -> None:
            self.urls: list[str] = []

        def __enter__(self) -> "FakeSession":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def get(self, url: str, **_kwargs: object) -> FakeResponse:
            self.urls.append(url)
            if len(self.urls) == 1:
                return FakeResponse(404)
            return FakeResponse(
                200,
                b"Participant wise report\nClient Type,Future Index Long,Future Index Short\n"
                b"FII/FPI,45,10\n",
            )

    session = FakeSession()
    monkeypatch.setattr("app.services.nse_participant_provider.requests.Session", lambda: session)

    records = _fetch_report_csv("fao_participant_oi_", date(2026, 8, 5))

    assert records == [{
        "Client Type": "FII/FPI",
        "Future Index Long": "45",
        "Future Index Short": "10",
    }]
    assert session.urls == [
        "https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_05082026.csv",
        "https://archives.nseindia.com/content/nsccl/fao_participant_oi_05082026.csv",
    ]


@pytest.mark.asyncio
async def test_provider_merges_oi_and_volume_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = NseParticipantProvider()
    monkeypatch.setattr(
        provider,
        "_fetch_sync",
        lambda _day: (_report("Pro", 40, 11), _report("PROPRIETARY", 9, 7)),
    )

    rows = await provider.fetch(date(2026, 8, 4))

    assert len(rows) == 1
    assert rows[0].participant_type == "PROPRIETARY"
    assert rows[0].oi["future_index_long"] == 40
    assert rows[0].volume["future_index_short"] == 7
