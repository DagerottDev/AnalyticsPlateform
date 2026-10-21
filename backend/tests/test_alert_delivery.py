"""Tests for external alert delivery (email/webhook/slack/telegram).

test_alerts.py already covers the basic transient-failure-then-success retry
path via _deliver_with_retry; this file covers everything else: payload/
message shape, the retryable-vs-not classifier, email/webhook/slack/telegram
dispatch, delivery-settings decryption, and the "give up after N attempts
without ever raising" contract that lets one channel's failure not block
another's (see dispatch_alert_delivery's asyncio.gather).
"""

import smtplib
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.crypto import encrypt_token
from app.models.alert_delivery import AlertDeliverySettingsRecord
from app.services import alert_delivery
from app.services.alert_delivery import (
    DeliveryEvent,
    _deliver_with_retry,
    _is_retryable_delivery_error,
    _message,
    _post_json,
    _send_email,
    delivery_payload,
    dispatch_alert_delivery,
    load_delivery_settings,
)
from tests.conftest import get_test_settings

# alert_delivery.httpx IS this same module object (import httpx is a
# singleton) — patching AsyncClient on it also patches it here. Save the
# real class first so the fake factory doesn't end up calling itself.
_RealAsyncClient = httpx.AsyncClient


def _event(**overrides: Any) -> DeliveryEvent:
    defaults: dict[str, Any] = dict(
        owner_id="owner-1",
        trading_symbol="NIFTY",
        metric="Price",
        operator=">=",
        threshold=22000.0,
        value=22050.5,
        triggered_at=datetime(2026, 8, 6, 9, 15, tzinfo=UTC),
    )
    defaults.update(overrides)
    return DeliveryEvent(**defaults)


class TestDeliveryPayloadAndMessage:
    def test_payload_has_the_expected_shape_and_iso_utc_timestamp(self) -> None:
        payload = delivery_payload(_event())

        assert payload == {
            "type": "alert.triggered",
            "tradingSymbol": "NIFTY",
            "metric": "Price",
            "operator": ">=",
            "threshold": 22000.0,
            "value": 22050.5,
            "triggeredAt": "2026-08-06T09:15:00+00:00",
        }

    def test_payload_normalizes_a_non_utc_timestamp_to_utc(self) -> None:
        from datetime import timedelta, timezone

        ist = timezone(timedelta(hours=5, minutes=30))
        payload = delivery_payload(_event(triggered_at=datetime(2026, 8, 6, 14, 45, tzinfo=ist)))

        assert payload["triggeredAt"] == "2026-08-06T09:15:00+00:00"

    def test_message_includes_symbol_metric_operator_threshold_and_value(self) -> None:
        text = _message(_event())

        assert "NIFTY" in text
        assert "Price >= 22000.0" in text
        assert "22050.5000" in text  # value is formatted to 4 decimal places


class TestIsRetryableDeliveryError:
    @pytest.mark.parametrize(
        "error",
        [
            httpx.ConnectError("boom"),
            httpx.TimeoutException("boom"),
            smtplib.SMTPServerDisconnected("boom"),
            TimeoutError("boom"),
        ],
    )
    def test_transient_errors_are_retryable(self, error: Exception) -> None:
        assert _is_retryable_delivery_error(error) is True

    @pytest.mark.parametrize("status_code", [429, 500, 502, 503])
    def test_http_status_errors_are_retryable_on_429_and_5xx(self, status_code: int) -> None:
        response = httpx.Response(status_code, request=httpx.Request("POST", "https://x.test"))
        error = httpx.HTTPStatusError("boom", request=response.request, response=response)

        assert _is_retryable_delivery_error(error) is True

    @pytest.mark.parametrize("status_code", [400, 401, 403, 404])
    def test_http_status_errors_are_not_retryable_on_4xx_other_than_429(
        self, status_code: int
    ) -> None:
        response = httpx.Response(status_code, request=httpx.Request("POST", "https://x.test"))
        error = httpx.HTTPStatusError("boom", request=response.request, response=response)

        assert _is_retryable_delivery_error(error) is False

    def test_an_unrelated_error_is_not_retryable(self) -> None:
        assert _is_retryable_delivery_error(ValueError("bad payload")) is False


@pytest.mark.asyncio
class TestDeliverWithRetry:
    async def test_succeeds_on_the_first_attempt_without_sleeping(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = 0

        async def operation() -> None:
            nonlocal calls
            calls += 1

        async def fail_if_slept(_delay: float) -> None:
            raise AssertionError("should not sleep when the first attempt succeeds")

        monkeypatch.setattr(alert_delivery.asyncio, "sleep", fail_if_slept)

        await _deliver_with_retry("webhook", _event(), operation)

        assert calls == 1

    async def test_a_non_retryable_error_gives_up_after_one_attempt(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = 0

        async def operation() -> None:
            nonlocal calls
            calls += 1
            raise ValueError("permanently broken")

        async def fail_if_slept(_delay: float) -> None:
            raise AssertionError("should not retry a non-retryable error")

        monkeypatch.setattr(alert_delivery.asyncio, "sleep", fail_if_slept)

        await _deliver_with_retry("webhook", _event(), operation)  # must not raise

        assert calls == 1

    async def test_a_persistently_retryable_error_gives_up_after_the_max_attempts(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = 0

        async def operation() -> None:
            nonlocal calls
            calls += 1
            raise TimeoutError("still down")

        async def no_sleep(_delay: float) -> None:
            return None

        monkeypatch.setattr(alert_delivery.asyncio, "sleep", no_sleep)

        await _deliver_with_retry("webhook", _event(), operation)  # must not raise

        assert calls == alert_delivery._MAX_DELIVERY_ATTEMPTS


@pytest.mark.asyncio
class TestSendEmail:
    async def test_skips_silently_when_smtp_is_not_configured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        settings = get_test_settings()  # alert_smtp_host defaults to None
        called = False

        class _FailIfConstructed:
            def __init__(self, *_a: Any, **_k: Any) -> None:
                nonlocal called
                called = True

        monkeypatch.setattr(smtplib, "SMTP", _FailIfConstructed)

        await _send_email(settings, "trader@example.com", _event())

        assert called is False

    async def test_sends_via_smtp_with_starttls_and_login_when_configured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        settings = get_test_settings().model_copy(
            update={
                "alert_smtp_host": "smtp.example.com",
                "alert_smtp_port": 2525,
                "alert_smtp_from": "alerts@example.com",
                "alert_smtp_starttls": True,
                "alert_smtp_username": "user",
                "alert_smtp_password": "pass",
            }
        )

        class FakeSMTP:
            instances: list["FakeSMTP"] = []

            def __init__(self, host: str, port: int, timeout: int) -> None:
                self.host, self.port, self.timeout = host, port, timeout
                self.starttls_called = False
                self.login_args: tuple[str, str] | None = None
                self.sent_message = None
                FakeSMTP.instances.append(self)

            def __enter__(self) -> "FakeSMTP":
                return self

            def __exit__(self, *_a: Any) -> None:
                return None

            def starttls(self) -> None:
                self.starttls_called = True

            def login(self, username: str, password: str) -> None:
                self.login_args = (username, password)

            def send_message(self, message: Any) -> None:
                self.sent_message = message

        monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)

        await _send_email(settings, "trader@example.com", _event())

        assert len(FakeSMTP.instances) == 1
        smtp = FakeSMTP.instances[0]
        assert smtp.host == "smtp.example.com"
        assert smtp.port == 2525
        assert smtp.starttls_called is True
        assert smtp.login_args == ("user", "pass")
        assert smtp.sent_message is not None
        assert smtp.sent_message["To"] == "trader@example.com"
        assert smtp.sent_message["From"] == "alerts@example.com"
        assert "NIFTY" in smtp.sent_message["Subject"]

    async def test_does_not_call_login_when_credentials_are_not_configured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        settings = get_test_settings().model_copy(
            update={
                "alert_smtp_host": "smtp.example.com",
                "alert_smtp_from": "alerts@example.com",
                "alert_smtp_starttls": False,
                "alert_smtp_username": None,
                "alert_smtp_password": None,
            }
        )

        class FakeSMTP:
            def __init__(self, *_a: Any, **_k: Any) -> None:
                self.login_called = False
                self.starttls_called = False

            def __enter__(self) -> "FakeSMTP":
                return self

            def __exit__(self, *_a: Any) -> None:
                return None

            def starttls(self) -> None:
                self.starttls_called = True

            def login(self, *_a: Any) -> None:
                self.login_called = True

            def send_message(self, _message: Any) -> None:
                pass

        instances: list[FakeSMTP] = []
        monkeypatch.setattr(
            smtplib, "SMTP", lambda *a, **k: instances.append(FakeSMTP()) or instances[-1]
        )

        await _send_email(settings, "trader@example.com", _event())

        assert instances[0].starttls_called is False
        assert instances[0].login_called is False


@pytest.mark.asyncio
class TestPostJson:
    @pytest.fixture(autouse=True)
    async def public_dns(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            alert_delivery.asyncio.get_running_loop(), "getaddrinfo",
            AsyncMock(
                return_value=[(2, 1, 6, "", ("8.8.8.8", 443))]
            ),
        )

    async def test_posts_the_payload_and_raises_on_a_non_2xx_response(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(500, json={"error": "boom"})

        def fake_async_client(*_a: Any, **_k: Any) -> httpx.AsyncClient:
            return _RealAsyncClient(transport=httpx.MockTransport(handler))

        monkeypatch.setattr(alert_delivery.httpx, "AsyncClient", fake_async_client)

        with pytest.raises(httpx.HTTPStatusError):
            await _post_json("https://hooks.example.com/x", {"text": "hi"})

        assert len(seen) == 1

    async def test_posts_the_payload_successfully_on_a_2xx_response(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen: list[dict[str, Any]] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            import json

            seen.append(json.loads(request.content))
            return httpx.Response(200, json={"ok": True})

        def fake_async_client(*_a: Any, **_k: Any) -> httpx.AsyncClient:
            return _RealAsyncClient(transport=httpx.MockTransport(handler))

        monkeypatch.setattr(alert_delivery.httpx, "AsyncClient", fake_async_client)

        await _post_json("https://hooks.example.com/x", {"text": "hi"})

        assert seen == [{"text": "hi"}]


@pytest.mark.asyncio
class TestLoadDeliverySettings:
    async def test_returns_none_when_no_settings_are_persisted(
        self, db_session: AsyncSession, test_settings: Settings
    ) -> None:
        result = await load_delivery_settings(db_session, "owner-with-no-settings", test_settings)

        assert result is None

    async def test_decrypts_the_persisted_secrets(
        self, db_session: AsyncSession, test_settings: Settings
    ) -> None:
        record = AlertDeliverySettingsRecord(
            owner_id="owner-1",
            webhook_enabled=True,
            webhook_url=encrypt_token("https://hooks.example.com/secret", test_settings),
            telegram_enabled=True,
            telegram_bot_token=encrypt_token("bot-token-123", test_settings),
            telegram_chat_id="12345",
            slack_enabled=True,
            slack_webhook_url=encrypt_token("https://hooks.slack.com/secret", test_settings),
            updated_at=datetime.now(UTC),
        )
        db_session.add(record)
        await db_session.commit()

        result = await load_delivery_settings(db_session, "owner-1", test_settings)

        assert result is not None
        assert result.webhook_url == "https://hooks.example.com/secret"
        assert result.telegram_bot_token == "bot-token-123"
        assert result.slack_webhook_url == "https://hooks.slack.com/secret"


@pytest.mark.asyncio
class TestDispatchAlertDelivery:
    async def test_does_nothing_when_no_delivery_settings_exist(
        self, db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def fail_if_called(*_a: Any, **_k: Any) -> None:
            raise AssertionError("must not attempt delivery with no settings row")

        monkeypatch.setattr(alert_delivery, "_deliver_with_retry", fail_if_called)

        await dispatch_alert_delivery(db_session, _event(owner_id="owner-none"), test_settings)

    async def test_dispatches_only_the_enabled_and_fully_configured_channels(
        self, db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        record = AlertDeliverySettingsRecord(
            owner_id="owner-2",
            email_enabled=True,
            email_recipient="trader@example.com",
            webhook_enabled=True,
            webhook_url=encrypt_token("https://hooks.example.com/x", test_settings),
            # telegram enabled but missing chat_id -> not actually dispatchable
            telegram_enabled=True,
            telegram_bot_token=encrypt_token("bot-token", test_settings),
            telegram_chat_id=None,
            slack_enabled=False,
            updated_at=datetime.now(UTC),
        )
        db_session.add(record)
        await db_session.commit()

        dispatched: list[str] = []

        async def fake_deliver(channel: str, _event: DeliveryEvent, _op: Any) -> None:
            dispatched.append(channel)

        monkeypatch.setattr(alert_delivery, "_deliver_with_retry", fake_deliver)

        await dispatch_alert_delivery(db_session, _event(owner_id="owner-2"), test_settings)

        assert sorted(dispatched) == ["email", "webhook"]

    async def test_one_channel_failing_does_not_block_another(
        self, db_session: AsyncSession, test_settings: Settings, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """_deliver_with_retry already never raises (it swallows and logs),
        but this pins that contract end-to-end through dispatch's
        asyncio.gather — a regression here would mean one bad channel could
        silently swallow every other channel's delivery for the same alert."""
        record = AlertDeliverySettingsRecord(
            owner_id="owner-3",
            email_enabled=True,
            email_recipient="trader@example.com",
            webhook_enabled=True,
            webhook_url=encrypt_token("https://hooks.example.com/x", test_settings),
            updated_at=datetime.now(UTC),
        )
        db_session.add(record)
        await db_session.commit()

        async def always_fail_email(*_a: Any, **_k: Any) -> None:
            raise smtplib.SMTPException("mailbox full")

        completed: list[str] = []

        async def fake_post_json(url: str, _payload: dict[str, Any]) -> None:
            completed.append(url)

        monkeypatch.setattr(alert_delivery, "_send_email", always_fail_email)
        monkeypatch.setattr(alert_delivery, "_post_json", fake_post_json)
        monkeypatch.setattr(alert_delivery.asyncio, "sleep", lambda _d: _no_sleep())

        await dispatch_alert_delivery(db_session, _event(owner_id="owner-3"), test_settings)

        assert completed == ["https://hooks.example.com/x"]


async def _no_sleep() -> None:
    return None
