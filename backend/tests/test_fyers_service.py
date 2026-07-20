"""Tests for FyersService's real (non-stub) broker API integrations."""

from unittest.mock import MagicMock, patch

import pytest

from app.core.exceptions import BrokerConnectionError
from app.models.user import TradingMode
from app.services.fyers_service import FyersService


def _make_service() -> FyersService:
    with patch("app.services.fyers_service.fyersModel.FyersModel"):
        return FyersService(
            app_id="TESTAPP-100",
            access_token="real-looking-token",  # noqa: S106 - not a real credential
            trading_mode=TradingMode.PAPER,
        )


@pytest.mark.asyncio
async def test_get_historical_data_parses_candles() -> None:
    """A successful Fyers `history()` response maps candles to MarketData-shaped rows."""
    service = _make_service()
    service.client.history = MagicMock(
        return_value={
            "s": "ok",
            "candles": [
                [1700000000, 100.0, 105.0, 99.0, 104.0, 1234],
                [1700000060, 104.0, 106.0, 103.5, 105.5, 987],
            ],
        }
    )

    rows = await service.get_historical_data(
        "NSE:NIFTY50-INDEX", "2023-11-15", "2023-11-15", "1"
    )

    assert len(rows) == 2
    assert rows[0]["open"] == 100.0
    assert rows[0]["high"] == 105.0
    assert rows[0]["low"] == 99.0
    assert rows[0]["close"] == 104.0
    assert rows[0]["volume"] == 1234
    assert rows[0]["open_interest"] == 0
    assert rows[0]["timestamp"].timestamp() == 1700000000

    service.client.history.assert_called_once_with(
        {
            "symbol": "NSE:NIFTY50-INDEX",
            "resolution": "1",
            "date_format": 1,
            "range_from": "2023-11-15",
            "range_to": "2023-11-15",
            "cont_flag": 0,
        }
    )


@pytest.mark.asyncio
async def test_get_historical_data_no_data_returns_empty_list() -> None:
    """Fyers' 'no_data' status is a legitimate empty result, not an error."""
    service = _make_service()
    service.client.history = MagicMock(return_value={"s": "no_data"})

    rows = await service.get_historical_data("NSE:NIFTY50-INDEX", "2023-11-15", "2023-11-15", "1")

    assert rows == []


@pytest.mark.asyncio
async def test_get_historical_data_error_raises_broker_connection_error() -> None:
    """A genuine Fyers error status raises, rather than silently returning []."""
    service = _make_service()
    service.client.history = MagicMock(return_value={"s": "error", "message": "Invalid symbol"})

    with pytest.raises(BrokerConnectionError):
        await service.get_historical_data("NSE:BADSYM-EQ", "2023-11-15", "2023-11-15", "1")


@pytest.mark.asyncio
async def test_mock_session_get_historical_data_returns_empty_list() -> None:
    """Paper/mock sessions never hit the network — get_historical_data short-circuits to []."""
    service = FyersService(
        app_id="TESTAPP-100", access_token="mock_token", trading_mode=TradingMode.PAPER
    )
    rows = await service.get_historical_data("NSE:NIFTY50-INDEX", "2023-11-15", "2023-11-15", "1")
    assert rows == []
