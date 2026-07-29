"""External delivery for durable alert trigger events."""

import asyncio
import logging
import smtplib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import EmailMessage
from typing import Any, Literal

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.crypto import decrypt_token
from app.core.retry import compute_backoff_delay
from app.models.alert_delivery import AlertDeliverySettingsRecord

logger = logging.getLogger(__name__)
DeliveryChannel = Literal["email", "webhook", "slack", "telegram"]
_MAX_DELIVERY_ATTEMPTS = 3


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
    smtp_host = settings.alert_smtp_host
    if not smtp_host or not settings.alert_smtp_from:
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
        with smtplib.SMTP(smtp_host, settings.alert_smtp_port, timeout=10) as smtp:
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


def _is_retryable_delivery_error(error: Exception) -> bool:
    transient_errors = (
        httpx.TransportError | httpx.TimeoutException | smtplib.SMTPException | TimeoutError
    )
    if isinstance(error, transient_errors):
        return True
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code == 429 or error.response.status_code >= 500
    return False


async def _deliver_with_retry(
    channel: DeliveryChannel, event: DeliveryEvent, operation: Callable[[], Awaitable[None]]
) -> None:
    """Attempt an external notification without letting one channel block another.

    The logs deliberately contain channel, owner, symbol, attempt and exception
    type—but never webhook URLs, recipient addresses, bot tokens, or payloads.
    That makes a failed delivery diagnosable while preserving credential privacy.
    """
    for attempt in range(_MAX_DELIVERY_ATTEMPTS):
        try:
            await operation()
            logger.info(
                "alert_delivery.sent channel=%s owner_id=%s symbol=%s attempt=%s",
                channel, event.owner_id, event.trading_symbol, attempt + 1,
            )
            return
        except Exception as error:
            retryable = _is_retryable_delivery_error(error)
            is_final_attempt = attempt + 1 == _MAX_DELIVERY_ATTEMPTS
            if not retryable or is_final_attempt:
                logger.warning(
                    "alert_delivery.failed channel=%s owner_id=%s symbol=%s "
                    "attempts=%s retryable=%s error_type=%s",
                    channel,
                    event.owner_id,
                    event.trading_symbol,
                    attempt + 1,
                    retryable,
                    type(error).__name__, exc_info=True,
                )
                return
            delay = compute_backoff_delay(attempt, base_delay=0.25, jitter=0.25)
            logger.info(
                "alert_delivery.retry channel=%s owner_id=%s symbol=%s attempt=%s "
                "delay_seconds=%.2f error_type=%s",
                channel,
                event.owner_id,
                event.trading_symbol,
                attempt + 1,
                delay,
                type(error).__name__,
            )
            await asyncio.sleep(delay)


async def dispatch_alert_delivery(
    db: AsyncSession, event: DeliveryEvent, settings: Settings
) -> None:
    channels = await load_delivery_settings(db, event.owner_id, settings)
    if channels is None:
        return
    payload = delivery_payload(event)
    jobs: list[tuple[DeliveryChannel, Callable[[], Awaitable[None]]]] = []
    if channels.email_enabled and channels.email_recipient:
        jobs.append(("email", lambda: _send_email(settings, channels.email_recipient or "", event)))
    if channels.webhook_enabled and channels.webhook_url:
        jobs.append(
            ("webhook", lambda: _post_json(channels.webhook_url or "", payload))
        )
    if channels.slack_enabled and channels.slack_webhook_url:
        jobs.append(
            (
                "slack",
                lambda: _post_json(
                    channels.slack_webhook_url or "", {"text": _message(event)}
                ),
            )
        )
    if channels.telegram_enabled and channels.telegram_bot_token and channels.telegram_chat_id:
        jobs.append(
            (
                "telegram",
                lambda: _post_json(
                    f"https://api.telegram.org/bot{channels.telegram_bot_token}/sendMessage",
                    {"chat_id": channels.telegram_chat_id or "", "text": _message(event)},
                ),
            )
        )
    configured = {
        "email": channels.email_enabled,
        "webhook": channels.webhook_enabled,
        "slack": channels.slack_enabled,
        "telegram": channels.telegram_enabled,
    }
    scheduled = {channel for channel, _ in jobs}
    for channel, enabled in configured.items():
        if enabled and channel not in scheduled:
            logger.warning(
                "alert_delivery.not_configured channel=%s owner_id=%s symbol=%s",
                channel, event.owner_id, event.trading_symbol,
            )
    await asyncio.gather(
        *(_deliver_with_retry(channel, event, operation) for channel, operation in jobs)
    )
