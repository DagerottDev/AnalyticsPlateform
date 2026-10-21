"""Tests for the Fyers headless (TOTP-automated, no-browser) login flow.

The 5-step flow (send_login_otp_v2 -> verify_otp -> verify_pin_v2 ->
/api/v3/token -> validate-authcode) is exercised against a fake
requests.Session so no real network call is ever made, following the same
pattern used for the NSE participant provider's requests.Session mocking
(see test_nse_participant_provider.py).
"""

from typing import Any

import pytest

from app.core.exceptions import BrokerAuthError
from app.services import fyers_headless
from app.services.fyers_headless import (
    _check_json,
    _headless_login_sync,
    _required_nested_string,
    _required_string,
    get_fyers_access_token_headless,
)

_TOTP_SECRET = "JBSWY3DPEHPK3PXP"  # well-known example base32 secret — valid, not real


class FakeResponse:
    def __init__(
        self, status_code: int, json_data: Any = None, content_type: str = "application/json"
    ) -> None:
        self.status_code = status_code
        self._json_data = json_data if json_data is not None else {}
        self.headers = {"content-type": content_type}
        self.text = str(self._json_data)[:500]

    def json(self) -> Any:
        return self._json_data


class FakeSession:
    """Records every POST so tests can assert all 5 steps reused the SAME
    session object — the whole point of fyers_headless.py's design (see its
    module docstring) is that Cloudflare cookies must persist across steps."""

    def __init__(self, responses: list[FakeResponse]) -> None:
        self.headers: dict[str, str] = {}
        self.calls: list[tuple[str, dict[str, Any] | None]] = []
        self._responses = list(responses)

    def post(self, url: str, json: dict[str, Any] | None = None) -> FakeResponse:
        self.calls.append((url, json))
        if not self._responses:
            raise AssertionError(f"No more fake responses queued; unexpected POST to {url}")
        return self._responses.pop(0)


def _ok(step_data: dict[str, Any]) -> FakeResponse:
    return FakeResponse(200, step_data)


def _happy_path_responses(step4_data: dict[str, Any] | None = None) -> list[FakeResponse]:
    return [
        _ok({"s": "ok", "request_key": "rk1"}),
        _ok({"s": "ok", "request_key": "rk2"}),
        _ok({"s": "ok", "data": {"access_token": "session-token-abc"}}),
        _ok(
            step4_data
            or {"code": 308, "Url": "http://127.0.0.1:3000/?auth_code=AUTHCODE123&state=None"}
        ),
        _ok({"s": "ok", "access_token": "final-access-token-xyz"}),
    ]


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """Both the TOTP-rotation guard and the retry backoff call sleep() —
    tests must not actually wait on real time."""
    monkeypatch.setattr(fyers_headless, "sleep", lambda _seconds: None)


def _patch_session(monkeypatch: pytest.MonkeyPatch, session: FakeSession) -> None:
    monkeypatch.setattr(fyers_headless.requests, "Session", lambda: session)


class TestHeadlessLoginSync:
    def test_full_five_step_flow_returns_the_final_access_token(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session = FakeSession(_happy_path_responses())
        _patch_session(monkeypatch, session)

        token = _headless_login_sync(
            "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret", "http://127.0.0.1:3000"
        )

        assert token == "final-access-token-xyz"
        assert len(session.calls) == 5

    def test_accepts_the_alternate_step_4_response_shape(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Step 4 can come back either as a 308-style redirect Url or as a
        {"data": {"auth": "<code>"}} payload — both must work."""
        session = FakeSession(
            _happy_path_responses(step4_data={"code": 200, "data": {"auth": "AUTHCODE456"}})
        )
        _patch_session(monkeypatch, session)

        token = _headless_login_sync(
            "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret", "http://127.0.0.1:3000"
        )

        assert token == "final-access-token-xyz"

    @pytest.mark.parametrize(
        "step_index,bad_response",
        [
            (0, {"s": "error", "message": "invalid client id"}),
            (1, {"s": "error", "message": "invalid otp"}),
            (2, {"s": "error", "message": "invalid pin"}),
        ],
    )
    def test_a_rejected_step_raises_broker_auth_error(
        self, monkeypatch: pytest.MonkeyPatch, step_index: int, bad_response: dict[str, Any]
    ) -> None:
        responses = _happy_path_responses()
        responses[step_index] = _ok(bad_response)
        # Truncate the queue at the failing step — nothing after it should
        # ever be requested.
        session = FakeSession(responses[: step_index + 1])
        _patch_session(monkeypatch, session)

        with pytest.raises(BrokerAuthError):
            _headless_login_sync(
                "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret", "http://127.0.0.1:3000"
            )

    def test_step_4_error_response_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        responses = _happy_path_responses(step4_data={"s": "error", "message": "bad app id"})
        session = FakeSession(responses[:4])
        _patch_session(monkeypatch, session)

        with pytest.raises(BrokerAuthError):
            _headless_login_sync(
                "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret", "http://127.0.0.1:3000"
            )

    def test_step_4_unrecognized_shape_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        responses = _happy_path_responses(step4_data={"code": 200, "something_else": True})
        session = FakeSession(responses[:4])
        _patch_session(monkeypatch, session)

        with pytest.raises(BrokerAuthError, match="Unexpected Fyers step 4"):
            _headless_login_sync(
                "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret", "http://127.0.0.1:3000"
            )

    def test_step_5_rejection_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        responses = _happy_path_responses()
        responses[4] = _ok({"s": "error", "message": "invalid auth code"})
        session = FakeSession(responses)
        _patch_session(monkeypatch, session)

        with pytest.raises(BrokerAuthError):
            _headless_login_sync(
                "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret", "http://127.0.0.1:3000"
            )

    def test_step_5_missing_access_token_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        responses = _happy_path_responses()
        responses[4] = _ok({"s": "ok"})  # no access_token key
        session = FakeSession(responses)
        _patch_session(monkeypatch, session)

        with pytest.raises(BrokerAuthError, match="missing access_token"):
            _headless_login_sync(
                "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret", "http://127.0.0.1:3000"
            )

    def test_a_cloudflare_rate_limit_response_retries_then_raises_a_clear_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A persistent 429/challenge-page response must not surface as a
        raw requests error or an opaque KeyError — it must tell the
        operator to fall back to OAuth login instead."""
        session = FakeSession(
            [FakeResponse(429, content_type="text/html") for _ in range(4)]  # 1 + 3 retries
        )
        _patch_session(monkeypatch, session)

        with pytest.raises(BrokerAuthError, match="Cloudflare is rate-limiting"):
            _headless_login_sync(
                "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret", "http://127.0.0.1:3000"
            )
        assert len(session.calls) == 4  # exhausted all retries, didn't retry forever

    def test_recovers_after_a_transient_429_then_a_json_response(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session = FakeSession(
            [FakeResponse(429, content_type="text/html"), _ok({"s": "ok", "request_key": "rk1"})]
            + _happy_path_responses()[1:]
        )
        _patch_session(monkeypatch, session)

        token = _headless_login_sync(
            "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret", "http://127.0.0.1:3000"
        )

        assert token == "final-access-token-xyz"
        assert len(session.calls) == 6  # one extra retry call on step 1


@pytest.mark.asyncio
class TestGetFyersAccessTokenHeadless:
    async def test_returns_the_cached_token_without_hitting_the_network(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(fyers_headless.broker_token_cache, "get", lambda _key: "cached-token")

        def _fail_if_called(*_a: Any, **_k: Any) -> str:
            raise AssertionError("should not perform a fresh login when a cached token exists")

        monkeypatch.setattr(fyers_headless, "_headless_login_sync", _fail_if_called)

        token = await get_fyers_access_token_headless(
            "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret"
        )

        assert token == "cached-token"

    async def test_caches_a_freshly_obtained_token_with_the_given_ttl(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(fyers_headless.broker_token_cache, "get", lambda _key: None)
        stored: dict[str, tuple[str, int]] = {}
        monkeypatch.setattr(
            fyers_headless.broker_token_cache,
            "set",
            lambda key, token, ttl_seconds: stored.update({key: (token, ttl_seconds)}),
        )
        monkeypatch.setattr(fyers_headless, "_headless_login_sync", lambda *_a, **_k: "fresh-token")

        token = await get_fyers_access_token_headless(
            "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret", ttl_seconds=100
        )

        assert token == "fresh-token"
        assert list(stored.values()) == [("fresh-token", 100)]
        assert "secret" not in next(iter(stored))

    async def test_wraps_an_unexpected_exception_as_a_broker_auth_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(fyers_headless.broker_token_cache, "get", lambda _key: None)

        def _boom(*_a: Any, **_k: Any) -> str:
            raise ValueError("something unrelated broke")

        monkeypatch.setattr(fyers_headless, "_headless_login_sync", _boom)

        with pytest.raises(BrokerAuthError, match="Unexpected error"):
            await get_fyers_access_token_headless(
                "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret"
            )

    async def test_a_broker_auth_error_from_login_propagates_unwrapped(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A BrokerAuthError already carries a specific, actionable message
        (e.g. the Cloudflare rate-limit guidance) — it must not get
        re-wrapped into a generic "Unexpected error" message that hides it."""
        monkeypatch.setattr(fyers_headless.broker_token_cache, "get", lambda _key: None)

        def _raise_specific(*_a: Any, **_k: Any) -> str:
            raise BrokerAuthError("Fyers verify TOTP failed: {'s': 'error'}")

        monkeypatch.setattr(fyers_headless, "_headless_login_sync", _raise_specific)

        with pytest.raises(BrokerAuthError, match="verify TOTP failed"):
            await get_fyers_access_token_headless(
                "YR02352", _TOTP_SECRET, "1234", "APPID-100", "secret"
            )


class TestResponseHelpers:
    def test_required_string_raises_on_missing_key(self) -> None:
        with pytest.raises(BrokerAuthError):
            _required_string({}, "request_key", "step")

    def test_required_string_raises_on_wrong_type(self) -> None:
        with pytest.raises(BrokerAuthError):
            _required_string({"request_key": 123}, "request_key", "step")

    def test_required_string_raises_on_empty_string(self) -> None:
        with pytest.raises(BrokerAuthError):
            _required_string({"request_key": ""}, "request_key", "step")

    def test_required_nested_string_raises_when_parent_is_not_a_dict(self) -> None:
        with pytest.raises(BrokerAuthError):
            _required_nested_string({"data": "not-a-dict"}, "data", "access_token", "step")

    def test_check_json_raises_with_a_clear_message_on_a_non_json_response(self) -> None:
        response = FakeResponse(200, content_type="text/html")
        with pytest.raises(BrokerAuthError, match="Cloudflare"):
            _check_json(response, "step")

    def test_check_json_raises_on_a_non_object_json_payload(self) -> None:
        response = FakeResponse(200, json_data=[1, 2, 3])
        with pytest.raises(BrokerAuthError, match="non-object"):
            _check_json(response, "step")
