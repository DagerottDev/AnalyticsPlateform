"""External delivery for durable alert trigger events."""

import asyncio
import logging
import smtplib
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import EmailMessage
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.crypto import decrypt_token
from app.models.alert_delivery import AlertDeliverySettingsRecord

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DeliveryEvent:
    owner_id: str
    trading_symbol: str
    metric: str
    operator: str
    threshold: float
    value: float
    triggered_at: datetime


async def load_delivery_settings(
    db: AsyncSession, owner_id: str, settings: Settings
) -> AlertDeliverySettingsRecord | None:
    record = await db.get(AlertDeliverySettingsRecord, owner_id)
    if record is None:
        return None
    if record.telegram_bot_token:
        record.telegram_bot_token = decrypt_token(record.telegram_bot_token, settings)
    if record.webhook_url:
        record.webhook_url = decrypt_token(record.webhook_url, settings)
    if record.slack_webhook_url:
        record.slack_webhook_url = decrypt_token(record.slack_webhook_url, settings)
    return record


def delivery_payload(event: DeliveryEvent) -> dict[str, Any]:
    return {
        "type": "alert.triggered",
        "tradingSymbol": event.trading_symbol,
        "metric": event.metric,
        "operator": event.operator,
        "threshold": event.threshold,
        "value": event.value,
        "triggeredAt": event.triggered_at.astimezone(UTC).isoformat(),
    }


def _message(event: DeliveryEvent) -> str:
    return (
        f"Alert triggered: {event.trading_symbol}\n{event.metric} {event.operator} "
        f"{event.threshold} (current: {event.value:.4f})"
    )


async def _send_email(settings: Settings, recipient: str, event: DeliveryEvent) -> None:
    if not settings.alert_smtp_host or not settings.alert_smtp_from:
        logger.warning("Skipping email delivery: ALERT_SMTP_HOST/FROM are not configured")
        return
    message = EmailMessage()
    message["Subject"], message["From"], message["To"] = (
        f"Market alert: {event.trading_symbol}",
        settings.alert_smtp_from,
        recipient,
    )
    message.set_content(_message(event))

    def send() -> None:
        with smtplib.SMTP(settings.alert_smtp_host, settings.alert_smtp_port, timeout=10) as smtp:
            if settings.alert_smtp_starttls:
                smtp.starttls()
            if settings.alert_smtp_username and settings.alert_smtp_password:
                smtp.login(settings.alert_smtp_username, settings.alert_smtp_password)
            smtp.send_message(message)

    await asyncio.to_thread(send)


async def _post_json(url: str, payload: dict[str, Any]) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()


async def dispatch_alert_delivery(
    db: AsyncSession, event: DeliveryEvent, settings: Settings
) -> None:
    channels = await load_delivery_settings(db, event.owner_id, settings)
    if channels is None:
        return
    payload = delivery_payload(event)
    jobs: list[tuple[str, Any]] = []
    if channels.email_enabled and channels.email_recipient:
        jobs.append(("email", _send_email(settings, channels.email_recipient, event)))
    if channels.webhook_enabled and channels.webhook_url:
        jobs.append(("webhook", _post_json(channels.webhook_url, payload)))
    if channels.slack_enabled and channels.slack_webhook_url:
        jobs.append(("slack", _post_json(channels.slack_webhook_url, {"text": _message(event)})))
    if channels.telegram_enabled and channels.telegram_bot_token and channels.telegram_chat_id:
        jobs.append(
            (
                "telegram",
                _post_json(
                    f"https://api.telegram.org/bot{channels.telegram_bot_token}/sendMessage",
                    {"chat_id": channels.telegram_chat_id, "text": _message(event)},
                ),
            )
        )
    results = await asyncio.gather(*(job for _, job in jobs), return_exceptions=True)
    for (channel, _), result in zip(jobs, results, strict=True):
        if isinstance(result, Exception):
            logger.warning("Alert %s delivery failed: %s", channel, result)
