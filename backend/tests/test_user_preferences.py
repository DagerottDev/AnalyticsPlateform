"""Regression coverage for authenticated server-backed preference profiles."""

from pathlib import Path

import pytest
from httpx import AsyncClient

from alembic.config import Config
from alembic.script import ScriptDirectory
from app.core.security import create_access_token
from app.schemas.user_preferences import UserPreferences


def test_settings_migration_is_the_single_alembic_head() -> None:
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["0016_nse_participant_data"]


@pytest.mark.asyncio
async def test_settings_returns_defaults_without_creating_a_profile(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.get("/api/v1/settings", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["persisted"] is False
    assert body["general"]["defaultSymbol"] == "NIFTY"
    assert body["optionChain"]["strikesEachSide"] == 10
    assert body["optionChain"]["rollingSelectionMode"] == "smooth"
    assert body["greekWorkspace"]["timeframe"] == "3"
    assert body["combinedPremiumWorkspace"]["timeframe"] == "3"
    assert body["combinedPremiumWorkspace"]["seriesType"] == "candlestick"
    assert body["combinedPremiumWorkspace"]["indicators"]["calls"]["ema"]["enabled"] is True
    assert body["ivScreener"] == {"projectionDays": 14, "sigma": 1}
    assert body["charts"]["indicators"]["supertrend"]["parameters"] == {
        "period": 10,
        "multiplier": 3,
    }


@pytest.mark.asyncio
async def test_settings_put_round_trips_normalized_camel_case_payload(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = UserPreferences().model_dump(mode="json", by_alias=True)
    payload["general"] = {
        "defaultSymbol": " banknifty ",
        "watchlist": ["nifty", "BANKNIFTY", "NIFTY"],
    }
    payload["analytics"]["riskFreeRatePercent"]["NIFTY"] = 7.25
    payload["charts"]["indicators"]["ema"] = {"enabled": True, "parameters": {"period": 34}}
    payload["optionChain"]["rollingSelectionMode"] = "raw"
    payload["combinedPremiumWorkspace"]["seriesType"] = "line"
    payload["combinedPremiumWorkspace"]["indicators"]["both"]["rsi"] = {
        "enabled": True, "parameters": {"period": 21}
    }
    payload["ivScreener"] = {"projectionDays": 30, "sigma": 1.5}

    saved = await client.put("/api/v1/settings", headers=auth_headers, json=payload)
    loaded = await client.get("/api/v1/settings", headers=auth_headers)

    assert saved.status_code == 200
    assert saved.json()["persisted"] is True
    assert loaded.json()["general"] == {
        "defaultSymbol": "BANKNIFTY",
        "watchlist": ["NIFTY", "BANKNIFTY"],
    }
    assert loaded.json()["analytics"]["riskFreeRatePercent"]["NIFTY"] == 7.25
    assert loaded.json()["charts"]["indicators"]["ema"]["parameters"]["period"] == 34
    assert loaded.json()["optionChain"]["rollingSelectionMode"] == "raw"
    assert loaded.json()["combinedPremiumWorkspace"]["seriesType"] == "line"
    combined = loaded.json()["combinedPremiumWorkspace"]
    both_rsi_period = combined["indicators"]["both"]["rsi"]["parameters"]["period"]
    assert both_rsi_period == 21
    assert loaded.json()["ivScreener"] == {"projectionDays": 30, "sigma": 1.5}


@pytest.mark.asyncio
async def test_settings_are_isolated_by_authenticated_owner(
    client: AsyncClient, auth_headers: dict[str, str], test_settings
) -> None:
    payload = UserPreferences().model_dump(mode="json", by_alias=True)
    payload["general"]["defaultSymbol"] = "SENSEX"
    saved = await client.put("/api/v1/settings", headers=auth_headers, json=payload)
    assert saved.status_code == 200

    token = create_access_token(
        data={"sub": "OTHER_CLIENT", "broker": "TestBroker"}, settings=test_settings
    )
    other = await client.get("/api/v1/settings", headers={"Authorization": f"Bearer {token}"})

    assert other.status_code == 200
    assert other.json()["persisted"] is False
    assert other.json()["general"]["defaultSymbol"] == "NIFTY"


@pytest.mark.asyncio
async def test_settings_reject_invalid_values_and_reset_only_generic_preferences(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    invalid = UserPreferences().model_dump(mode="json", by_alias=True)
    invalid["charts"]["refreshSeconds"] = 7
    invalid["ivScreener"] = {"projectionDays": 61, "sigma": 1}
    invalid["unexpected"] = True

    rejected = await client.put("/api/v1/settings", headers=auth_headers, json=invalid)
    assert rejected.status_code == 422

    valid = UserPreferences().model_dump(mode="json", by_alias=True)
    valid["replay"]["speedMultiplier"] = 10
    saved = await client.put("/api/v1/settings", headers=auth_headers, json=valid)
    assert saved.status_code == 200

    reset = await client.delete("/api/v1/settings", headers=auth_headers)
    assert reset.status_code == 200
    assert reset.json()["persisted"] is False
    assert reset.json()["replay"]["speedMultiplier"] == 1
