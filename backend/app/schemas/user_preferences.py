"""Strict API contracts for the authenticated application settings profile."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

INDEX_SYMBOLS = ("NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX")
DEFAULT_RATE_SYMBOL = "DEFAULT"

ThemeMode = Literal["dark", "light"]
Timeframe = Literal["1", "3", "5", "10", "15"]
ReplayResolution = Literal["1", "5", "15"]
ReplaySpeed = Literal[1, 5, 10, 100]
OptionSide = Literal["BOTH", "CE", "PE"]
MoneynessFilter = Literal["all", "itm", "atm", "otm"]
RollingSelectionMode = Literal["smooth", "raw"]
PremiumChartSeriesType = Literal["candlestick", "line"]
GreekOverlay = Literal["none", "sma", "ema", "bbands", "supertrend"]
GreekMetric = Literal[
    "delta", "gamma", "theta", "vega", "rho", "vanna", "vomma", "charm",
    "speed", "color", "zomma", "ultima",
]
StrategyPreset = Literal[
    "Iron Condor", "Straddle", "Strangle", "Butterfly", "Calendar", "Diagonal",
]
AlertMetric = Literal[
    "Price", "IV", "Delta", "Gamma", "Theta", "Vega", "Call GEX", "Put GEX",
    "Net GEX", "VWAP Breakout",
]
AlertOperator = Literal[">", "<", ">=", "<="]
Symbol = Annotated[str, Field(min_length=1, max_length=50, pattern=r"^[A-Z0-9&._-]+$")]


def _camel(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(part.capitalize() for part in tail)


class PreferenceModel(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True, extra="forbid")


class AppearancePreferences(PreferenceModel):
    theme: ThemeMode = "dark"


class GeneralPreferences(PreferenceModel):
    default_symbol: Symbol = "NIFTY"
    watchlist: list[Symbol] = Field(default_factory=lambda: ["NIFTY", "BANKNIFTY"], max_length=20)

    @field_validator("default_symbol", mode="before")
    @classmethod
    def normalize_symbol(cls, value: object) -> str:
        return str(value).strip().upper()

    @field_validator("watchlist", mode="before")
    @classmethod
    def normalize_watchlist(cls, value: object) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("watchlist must be a list")
        symbols: list[str] = []
        for item in value:
            symbol = str(item).strip().upper()
            if symbol and symbol not in symbols:
                symbols.append(symbol)
        if not symbols:
            raise ValueError("watchlist must include at least one symbol")
        return symbols


class NotificationPreferences(PreferenceModel):
    toast: bool = True
    desktop: bool = False


class PeriodParameters(PreferenceModel):
    period: int = Field(20, ge=2, le=500)


class MultiplierParameters(PeriodParameters):
    multiplier: float = Field(2, ge=0.1, le=10)


class PeriodIndicatorPreference(PreferenceModel):
    enabled: bool = False
    parameters: PeriodParameters


class MultiplierIndicatorPreference(PreferenceModel):
    enabled: bool = False
    parameters: MultiplierParameters


class ChartIndicatorsPreferences(PreferenceModel):
    sma: PeriodIndicatorPreference = Field(
        default_factory=lambda: PeriodIndicatorPreference(parameters=PeriodParameters(period=20))
    )
    ema: PeriodIndicatorPreference = Field(
        default_factory=lambda: PeriodIndicatorPreference(parameters=PeriodParameters(period=20))
    )
    bbands: MultiplierIndicatorPreference = Field(
        default_factory=lambda: MultiplierIndicatorPreference(
            parameters=MultiplierParameters(period=20, multiplier=2)
        )
    )
    rsi: PeriodIndicatorPreference = Field(
        default_factory=lambda: PeriodIndicatorPreference(parameters=PeriodParameters(period=14))
    )
    supertrend: MultiplierIndicatorPreference = Field(
        default_factory=lambda: MultiplierIndicatorPreference(
            parameters=MultiplierParameters(period=10, multiplier=3)
        )
    )


class ChartPreferences(PreferenceModel):
    timeframe: Timeframe = "1"
    history_days: int = Field(7, ge=1, le=30)
    refresh_seconds: Literal[15, 30, 60] = 30
    indicators: ChartIndicatorsPreferences = Field(default_factory=ChartIndicatorsPreferences)


class OptionChainPreferences(PreferenceModel):
    show_greeks: bool = True
    show_buildup: bool = True
    moneyness: MoneynessFilter = "all"
    strikes_each_side: Literal[5, 10, 20] | None = 10
    default_gtt_validity_days: int = Field(30, ge=1)
    rolling_selection_mode: RollingSelectionMode = "smooth"


class GreekPanelPreferences(PreferenceModel):
    overlay: GreekOverlay = "none"
    period: int = Field(20, ge=2, le=500)
    multiplier: float = Field(2, ge=0.1, le=10)


def _default_visible_greeks() -> list[GreekMetric]:
    return ["delta", "gamma", "theta", "vega", "vanna", "vomma"]


class GreekWorkspacePreferences(PreferenceModel):
    timeframe: Timeframe = "5"
    visible_greeks: list[GreekMetric] = Field(
        default_factory=_default_visible_greeks, min_length=1, max_length=12
    )
    panels: dict[GreekMetric, GreekPanelPreferences] = Field(default_factory=dict)
    education_open: bool = False
    sync_charts: bool = False

    @field_validator("visible_greeks")
    @classmethod
    def unique_metrics(cls, value: list[GreekMetric]) -> list[GreekMetric]:
        if len(set(value)) != len(value):
            raise ValueError("visible_greeks cannot contain duplicates")
        return value


def _premium_indicators() -> ChartIndicatorsPreferences:
    indicators = ChartIndicatorsPreferences()
    indicators.ema.enabled = True
    return indicators


def _premium_indicator_map() -> dict[Literal["calls", "puts", "both"], ChartIndicatorsPreferences]:
    return {
        "calls": _premium_indicators(),
        "puts": _premium_indicators(),
        "both": _premium_indicators(),
    }


class CombinedPremiumWorkspacePreferences(PreferenceModel):
    """Saved display-only controls for synthetic combined-premium charts."""

    timeframe: Timeframe = "5"
    sync_charts: bool = True
    series_type: PremiumChartSeriesType = "candlestick"
    indicators: dict[Literal["calls", "puts", "both"], ChartIndicatorsPreferences] = Field(
        default_factory=_premium_indicator_map
    )


class ReplayPreferences(PreferenceModel):
    resolution: ReplayResolution = "1"
    speed_multiplier: ReplaySpeed = 1
    option_side: OptionSide = "BOTH"
    fallback_iv_percent: dict[str, float] = Field(
        default_factory=lambda: _default_fallback_iv_rates()
    )

    @field_validator("fallback_iv_percent")
    @classmethod
    def normalize_iv_rates(cls, value: dict[str, float]) -> dict[str, float]:
        result = _normalize_rate_map(value, defaults={
            "NIFTY": 14, "BANKNIFTY": 18, "FINNIFTY": 17, "MIDCPNIFTY": 20,
            "SENSEX": 15, DEFAULT_RATE_SYMBOL: 15,
        })
        if any(rate <= 0 or rate > 300 for rate in result.values()):
            raise ValueError("fallback IV must be greater than 0% and no more than 300%")
        return result


class AnalyticsPreferences(PreferenceModel):
    risk_free_rate_percent: dict[str, float] = Field(
        default_factory=lambda: _default_risk_free_rates()
    )

    @field_validator("risk_free_rate_percent")
    @classmethod
    def normalize_risk_free_rates(cls, value: dict[str, float]) -> dict[str, float]:
        result = _normalize_rate_map(
            value, defaults={symbol: 10 for symbol in (*INDEX_SYMBOLS, DEFAULT_RATE_SYMBOL)}
        )
        if any(rate < 0 or rate > 50 for rate in result.values()):
            raise ValueError("risk-free rates must be between 0% and 50%")
        return result


def _normalize_rate_map(value: dict[str, float], defaults: dict[str, float]) -> dict[str, float]:
    result = dict(defaults)
    for key, rate in value.items():
        symbol = key.strip().upper()
        valid_symbol = all(character.isalnum() or character in "&._-" for character in symbol)
        if not symbol or len(symbol) > 50 or not valid_symbol:
            raise ValueError("rate-map symbols must be uppercase symbols")
        result[symbol] = float(rate)
    return result


def _default_fallback_iv_rates() -> dict[str, float]:
    return {
        "NIFTY": 14.0,
        "BANKNIFTY": 18.0,
        "FINNIFTY": 17.0,
        "MIDCPNIFTY": 20.0,
        "SENSEX": 15.0,
        DEFAULT_RATE_SYMBOL: 15.0,
    }


def _default_risk_free_rates() -> dict[str, float]:
    return {symbol: 10.0 for symbol in (*INDEX_SYMBOLS, DEFAULT_RATE_SYMBOL)}


class StrategyPreferences(PreferenceModel):
    default_preset: StrategyPreset = "Iron Condor"
    backtest_holding_days: int = Field(5, ge=1, le=60)
    backtest_days_to_expiry: int = Field(30, ge=1, le=365)


class AlertPreferences(PreferenceModel):
    metric: AlertMetric = "Price"
    operator: AlertOperator = ">"
    cooldown_minutes: int = Field(15, ge=0, le=240)


class UserPreferences(PreferenceModel):
    schema_version: Literal[1] = 1
    appearance: AppearancePreferences = Field(default_factory=AppearancePreferences)
    general: GeneralPreferences = Field(default_factory=GeneralPreferences)
    notifications: NotificationPreferences = Field(default_factory=NotificationPreferences)
    charts: ChartPreferences = Field(default_factory=lambda: ChartPreferences.model_validate({}))
    option_chain: OptionChainPreferences = Field(
        default_factory=lambda: OptionChainPreferences.model_validate({})
    )
    greek_workspace: GreekWorkspacePreferences = Field(default_factory=GreekWorkspacePreferences)
    combined_premium_workspace: CombinedPremiumWorkspacePreferences = Field(
        default_factory=CombinedPremiumWorkspacePreferences
    )
    replay: ReplayPreferences = Field(default_factory=ReplayPreferences)
    analytics: AnalyticsPreferences = Field(default_factory=AnalyticsPreferences)
    strategy: StrategyPreferences = Field(
        default_factory=lambda: StrategyPreferences.model_validate({})
    )
    alerts: AlertPreferences = Field(default_factory=lambda: AlertPreferences.model_validate({}))


class UserPreferencesResponse(UserPreferences):
    persisted: bool = False
    updated_at: datetime | None = None
