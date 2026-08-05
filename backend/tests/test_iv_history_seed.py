from datetime import UTC, date, datetime

import pytest

from app.services.iv_history_seed import seed_historical_atm_iv


class FakeOptionHistoryService:
    supports_historical_options = True

    def __init__(self) -> None:
        self.history_calls: list[str] = []

    async def get_instruments(self, symbol: str) -> list[dict[str, object]]:
        assert symbol == "RELIANCE"
        return [
            {
                "trading_symbol": "NSE:RELIANCE26DEC100CE",
                "expiry": "30-Dec-2026",
                "strike": 100.0,
                "option_type": "CE",
            },
            {
                "trading_symbol": "NSE:RELIANCE26DEC100PE",
                "expiry": "30-Dec-2026",
                "strike": 100.0,
                "option_type": "PE",
            },
        ]

    async def get_historical_data(
        self, symbol: str, from_date: str, to_date: str, resolution: str
    ) -> list[dict[str, object]]:
        self.history_calls.append(symbol)
        dates = [date(2026, 8, 1), date(2026, 8, 3)]
        if symbol == "NSE:RELIANCE-EQ":
            closes = [100.0, 101.0]
        elif symbol.endswith("CE"):
            closes = [10.0, 10.5]
        else:
            closes = [10.0, 9.5]
        return [
            {
                "timestamp": datetime.combine(item, datetime.min.time(), tzinfo=UTC),
                "close": close,
            }
            for item, close in zip(dates, closes, strict=True)
        ]


@pytest.mark.asyncio
async def test_seeds_true_daily_atm_iv_from_underlying_and_option_candles() -> None:
    service = FakeOptionHistoryService()

    observations = await seed_historical_atm_iv(
        service,
        "RELIANCE",
        today=date(2026, 8, 4),
        lookback_days=20,
    )

    assert [item.snapshot_date for item in observations] == [
        date(2026, 8, 1),
        date(2026, 8, 3),
    ]
    assert all(item.atm_iv > 0 for item in observations)
    assert service.history_calls[0] == "NSE:RELIANCE-EQ"
    assert set(service.history_calls[1:]) == {
        "NSE:RELIANCE26DEC100CE",
        "NSE:RELIANCE26DEC100PE",
    }


@pytest.mark.asyncio
async def test_seed_is_noop_for_brokers_without_option_history() -> None:
    class CurrentQuotesOnlyService:
        supports_historical_options = False

    observations = await seed_historical_atm_iv(
        CurrentQuotesOnlyService(),
        "RELIANCE",
        today=date(2026, 8, 4),
        lookback_days=20,
    )

    assert observations == []
