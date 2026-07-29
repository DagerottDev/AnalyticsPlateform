"""Scheduled, broker-backed evaluation for persisted alerts."""

import asyncio
import logging
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from app.config import Settings, get_settings
from app.db.session import async_session_maker
from app.models.alert import AlertRecord, AlertTriggerRecord
from app.services.alert_delivery import DeliveryEvent, dispatch_alert_delivery
from app.services.greeks import calculate_greeks, calculate_implied_volatility
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)


def _matches(value: float, operator: str, threshold: float) -> bool:
    return {
        ">": value > threshold,
        "<": value < threshold,
        ">=": value >= threshold,
        "<=": value <= threshold,
    }.get(operator, False)


def _time_to_expiry(expiry: object) -> float:
    if not isinstance(expiry, str):
        return 0.0001
    for pattern in ("%d-%b-%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S.%fZ"):
        try:
            expires = datetime.strptime(expiry, pattern).replace(hour=15, minute=30, tzinfo=UTC)
            return max((expires - datetime.now(UTC)).total_seconds() / (365 * 24 * 60 * 60), 0.0001)
        except ValueError:
            continue
    return 0.0001


def _lot_size(symbol: str) -> int:
    symbol = symbol.upper()
    if "BANKNIFTY" in symbol:
        return 15
    if "FINNIFTY" in symbol:
        return 40
    if "MIDCPNIFTY" in symbol:
        return 75
    return 50


def _quote_price(quote: dict[str, object] | None) -> float | None:
    value = quote.get("last_price") if quote else None
    return float(value) if isinstance(value, int | float) and value > 0 else None


async def _value_for_alert(
    alert: AlertRecord,
    quotes: dict[str, dict[str, object]],
    chains: dict[str, list[dict[str, object]]],
) -> float | None:
    instrument = alert.instrument
    quote = quotes.get(alert.trading_symbol)
    price = _quote_price(quote)
    if alert.metric == "Price":
        return price
    if alert.metric == "VWAP Breakout":
        atp = quote.get("atp") if quote else None
        if price is not None and isinstance(atp, int | float) and atp > 0:
            return price - float(atp)
        return None

    if alert.metric == "Net GEX":
        underlying = instrument.get("symbol")
        expiry = instrument.get("expiry")
        if not isinstance(underlying, str) or not isinstance(expiry, str):
            return None
        spot = _quote_price(quotes.get(underlying))
        chain = chains.get(f"{underlying}:{expiry}")
        if spot is None or not chain:
            return None
        net_gex = 0.0
        saw_contract = False
        for contract in chain:
            contract_symbol = contract.get("trading_symbol")
            strike = contract.get("strike")
            option_type = contract.get("option_type")
            if not (
                isinstance(contract_symbol, str)
                and isinstance(strike, int | float)
                and option_type in {"CE", "PE"}
            ):
                continue
            contract_quote = quotes.get(contract_symbol)
            premium = _quote_price(contract_quote)
            if premium is None:
                continue
            saw_contract = True
            iv = calculate_implied_volatility(
                option_type, spot, float(strike), _time_to_expiry(expiry), 0.10, premium
            )
            if iv <= 0:
                continue
            gamma = calculate_greeks(
                option_type, spot, float(strike), _time_to_expiry(expiry), 0.10, iv
            ).gamma
            quote_oi = contract_quote.get("open_interest") if contract_quote else None
            oi = (
                quote_oi
                if isinstance(quote_oi, int | float) and quote_oi > 0
                else contract.get("oi")
            )
            if isinstance(oi, int | float):
                net_gex += (
                    gamma
                    * float(oi)
                    * _lot_size(underlying)
                    * spot
                    * (1 if option_type == "CE" else -1)
                )
        return net_gex if saw_contract else None

    strike = instrument.get("strike")
    option_type = instrument.get("option_type")
    expiry = instrument.get("expiry")
    underlying = instrument.get("symbol")
    if not (
        isinstance(strike, int | float)
        and option_type in {"CE", "PE"}
        and isinstance(underlying, str)
        and price is not None
    ):
        return None
    spot = _quote_price(quotes.get(underlying))
    if spot is None:
        return None
    time_to_expiry = _time_to_expiry(expiry)
    iv = calculate_implied_volatility(option_type, spot, float(strike), time_to_expiry, 0.10, price)
    if alert.metric == "IV":
        return iv * 100
    if iv <= 0:
        return None
    greeks = calculate_greeks(option_type, spot, float(strike), time_to_expiry, 0.10, iv)
    values = {
        "Delta": greeks.delta,
        "Gamma": greeks.gamma,
        "Theta": greeks.theta,
        "Vega": greeks.vega,
    }
    if alert.metric in values:
        return values[alert.metric]
    if alert.metric in {"Call GEX", "Put GEX"}:
        oi = quote.get("open_interest") if quote else None
        return (
            greeks.gamma
            * float(oi or 0)
            * _lot_size(underlying)
            * spot
            * (1 if option_type == "CE" else -1)
        )
    return None


async def run_alert_evaluation(session_factory: object = async_session_maker) -> int:
    """Evaluate all due alerts once. Returns the number of new trigger events."""
    now = datetime.now(UTC)
    triggered = 0
    deliveries: list[DeliveryEvent] = []
    # The injectable factory keeps the evaluator deterministic in tests while
    # production uses the application's normal async session maker.
    async with session_factory() as db:  # type: ignore[operator]
        snoozed = (
            await db.scalars(select(AlertRecord).where(AlertRecord.status == "Snoozed"))
        ).all()
        for alert in snoozed:
            if alert.snoozed_until and alert.snoozed_until <= now:
                alert.status, alert.snoozed_until = "Active", None
        await db.flush()
        active = (await db.scalars(select(AlertRecord).where(AlertRecord.status == "Active"))).all()
        by_owner: dict[str, list[AlertRecord]] = {}
        for alert in active:
            by_owner.setdefault(alert.owner_id, []).append(alert)

        for owner_id, alerts in by_owner.items():
            service = session_manager.get_session(owner_id)
            if service is None:
                continue
            symbols = {alert.trading_symbol for alert in alerts}
            symbols.update(
                str(alert.instrument["symbol"])
                for alert in alerts
                if isinstance(alert.instrument.get("symbol"), str)
            )
            chains: dict[str, list[dict[str, object]]] = {}
            for alert in alerts:
                if alert.metric != "Net GEX":
                    continue
                underlying = alert.instrument.get("symbol")
                expiry = alert.instrument.get("expiry")
                if not isinstance(underlying, str) or not isinstance(expiry, str):
                    continue
                key = f"{underlying}:{expiry}"
                if key in chains:
                    continue
                try:
                    instruments = await service.get_instruments(underlying)
                except Exception:
                    logger.exception("Alert chain lookup failed for %s", underlying)
                    continue
                chain = [
                    item
                    for item in instruments
                    if isinstance(item, dict)
                    and item.get("expiry") == expiry
                    and item.get("option_type") in {"CE", "PE"}
                ]
                chains[key] = chain
                symbols.update(
                    str(item["trading_symbol"])
                    for item in chain
                    if isinstance(item.get("trading_symbol"), str)
                )
            try:
                response = await service.get_quotes(sorted(symbols))
            except Exception:
                logger.exception("Alert quote lookup failed for %s", owner_id)
                continue
            quotes = {
                str(quote.get("trading_symbol") or quote.get("symbol")): quote
                for quote in response
                if isinstance(quote, dict)
            }
            for alert in alerts:
                value = await _value_for_alert(alert, quotes, chains)
                if value is None or not _matches(value, alert.operator, alert.threshold):
                    continue
                db.add(
                    AlertTriggerRecord(
                        id=str(uuid4()),
                        owner_id=alert.owner_id,
                        alert_id=alert.id,
                        trading_symbol=alert.trading_symbol,
                        metric=alert.metric,
                        operator=alert.operator,
                        threshold=alert.threshold,
                        value=value,
                        triggered_at=now,
                    )
                )
                deliveries.append(
                    DeliveryEvent(
                        owner_id=alert.owner_id,
                        trading_symbol=alert.trading_symbol,
                        metric=alert.metric,
                        operator=alert.operator,
                        threshold=alert.threshold,
                        value=value,
                        triggered_at=now,
                    )
                )
                triggered += 1
                if alert.cooldown_minutes > 0:
                    alert.status = "Snoozed"
                    alert.triggered_at = now
                    alert.snoozed_until = now + timedelta(minutes=alert.cooldown_minutes)
                else:
                    await db.delete(alert)
        await db.commit()
        settings = get_settings()
        for event in deliveries:
            await dispatch_alert_delivery(db, event, settings)
    return triggered


async def alert_evaluation_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    """Run alert evaluation until shutdown without tying it to any browser tab."""
    while not stop_event.is_set():
        try:
            count = await run_alert_evaluation()
            if count:
                logger.info("Server-side alert evaluation recorded %s trigger(s)", count)
        except Exception:
            logger.exception("Server-side alert evaluation failed")
        with suppress(TimeoutError):
            await asyncio.wait_for(
                stop_event.wait(), timeout=settings.alert_evaluation_interval_seconds
            )
