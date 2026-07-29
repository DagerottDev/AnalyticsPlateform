"""Fyers headless (no-browser) authentication service.

Automates the Fyers V3 login flow using the internal Vagator APIs:
  1. send_login_otp_v2  — triggers TOTP on the registered device
  2. verify_otp         — submits the TOTP code
  3. verify_pin_v2      — submits the 4-digit PIN (returns a session access_token)
  4. POST /api/v3/token — exchanges session token for an auth_code via a redirect URL
  5. validate-authcode  — exchanges auth_code for the final 24-hour access token

KEY: Steps 3-4 MUST use the same requests.Session() so that Cloudflare/Fyers
     session cookies are preserved across calls. Dropping cookies between requests
     causes HTTP 429 rate-limit rejections on the /api/v3/token endpoint.

Successful tokens are cached for a TTL so repeated /login hits within the
same day don't re-trigger this flow and risk Cloudflare rate limiting.
"""

import asyncio
import base64
import hashlib
import logging
from datetime import datetime
from time import sleep
from urllib.parse import parse_qs, urlparse

import pyotp
import requests  # synchronous — needed for requests.Session() cookie persistence

from app.core.exceptions import BrokerAuthError
from app.core.retry import compute_backoff_delay
from app.services.token_cache import broker_token_cache

logger = logging.getLogger(__name__)

# ── Cloudflare-friendly headers for the vagator API ───────────────────────────
_VAGATOR_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    "Origin": "https://login.fyers.in",
    "Referer": "https://login.fyers.in/",
}


def _post_with_retry(
    ses: requests.Session,
    url: str,
    payload: dict[str, object],
    step: str,
    max_retries: int = 3,
) -> requests.Response:
    """POST with exponential backoff + jitter when Cloudflare returns 429 or a
    non-JSON challenge page. Retrying immediately just gets rate-limited again;
    backing off gives the IP-level window time to clear.
    """
    res = ses.post(url, json=payload)
    for attempt in range(max_retries):
        ct = res.headers.get("content-type", "")
        if res.status_code != 429 and "application/json" in ct:
            return res
        delay = compute_backoff_delay(attempt, base_delay=3, jitter=2)
        logger.warning(
            f"[Fyers headless] Step '{step}' got HTTP {res.status_code} "
            f"(retry {attempt + 1}/{max_retries}) — backing off {delay:.1f}s"
        )
        sleep(delay)
        res = ses.post(url, json=payload)
    return res


def _check_json(res: requests.Response, step: str) -> dict[str, object]:
    """Assert the response is JSON and return parsed data, raising BrokerAuthError otherwise."""
    ct = res.headers.get("content-type", "")
    if res.status_code == 429 or "application/json" not in ct:
        logger.error(
            f"Fyers {step}: HTTP {res.status_code}, content-type={ct}, "
            f"body={res.text[:200]}"
        )
        raise BrokerAuthError(
            f"Fyers headless login blocked at step '{step}' "
            f"(HTTP {res.status_code}). Cloudflare is rate-limiting this "
            "server's IP. Use the OAuth redirect login method instead — it "
            "runs entirely in your browser with no server-side requests to Fyers."
        )
    payload = res.json()
    if not isinstance(payload, dict):
        raise BrokerAuthError(f"Fyers {step} returned a non-object JSON payload")
    return {str(key): value for key, value in payload.items()}


def _required_string(payload: dict[str, object], key: str, step: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise BrokerAuthError(f"Fyers {step} response is missing a valid {key}")
    return value


def _required_nested_string(
    payload: dict[str, object], parent: str, key: str, step: str
) -> str:
    nested = payload.get(parent)
    if not isinstance(nested, dict):
        raise BrokerAuthError(f"Fyers {step} response is missing a valid {parent} object")
    return _required_string(
        {str(nested_key): value for nested_key, value in nested.items()}, key, step
    )


async def get_fyers_access_token_headless(
    client_id: str,
    totp_secret: str,
    pin: str,
    app_id: str,
    app_secret: str,
    redirect_uri: str = "http://127.0.0.1:3000",
    ttl_seconds: int = 82800,
) -> str:
    """Return a fresh Fyers API v3 access token via fully automated headless login.

    The key to avoiding Cloudflare 429s is to:
      a) Send browser-like headers on every request.
      b) Use a *persistent* requests.Session() from step 3 onwards so that
         Cloudflare/Fyers session cookies are preserved across the vagator→token call.
      c) Guard the TOTP submission against the 30-second rotation window.

    Args:
        client_id:    Fyers user ID, e.g. "YR02352".
        totp_secret:  32-character TOTP secret key.
        pin:          4-digit Fyers PIN.
        app_id:       Fyers App ID including suffix, e.g. "7MMS0TSPNO-100".
        app_secret:   Fyers API Secret.
        redirect_uri: Redirect URI registered in your Fyers app.
        ttl_seconds:  How long to cache the resulting access token for.

    Returns:
        24-hour Fyers access token string.

    Raises:
        BrokerAuthError: on any step failure.
    """
    cache_key = f"fyers:{client_id}"
    cached_token = broker_token_cache.get(cache_key)
    if cached_token:
        return cached_token

    try:
        access_token = await asyncio.to_thread(
            _headless_login_sync, client_id, totp_secret, pin, app_id, app_secret, redirect_uri
        )
    except BrokerAuthError:
        raise
    except Exception as e:
        logger.exception("Unexpected error during Fyers headless login")
        raise BrokerAuthError(f"Unexpected error during headless login: {e}") from e

    broker_token_cache.set(cache_key, access_token, ttl_seconds)
    return access_token


def _headless_login_sync(
    client_id: str,
    totp_secret: str,
    pin: str,
    app_id: str,
    app_secret: str,
    redirect_uri: str,
) -> str:
    """Synchronous implementation of the headless Fyers login flow.

    Runs in a thread pool via asyncio.to_thread() to avoid blocking the event loop.
    Uses requests.Session() to preserve Cloudflare cookies across all steps.
    """
    b64_client_id = base64.b64encode(client_id.encode()).decode()
    b64_pin = base64.b64encode(pin.encode()).decode()

    # ── One shared session for ALL requests (cookie persistence is critical) ──
    ses = requests.Session()
    ses.headers.update(_VAGATOR_HEADERS)

    # ── Step 1: Send Login OTP ────────────────────────────────────────────────
    logger.info(f"[Fyers headless] Step 1: send_login_otp_v2 for client={client_id}")
    res1 = _post_with_retry(
        ses,
        "https://api-t2.fyers.in/vagator/v2/send_login_otp_v2",
        {"fy_id": b64_client_id, "app_id": "2"},
        "send_login_otp_v2",
    )
    d1 = _check_json(res1, "send_login_otp_v2")
    if d1.get("s") != "ok":
        raise BrokerAuthError(f"Fyers send OTP failed: {d1}")
    request_key = _required_string(d1, "request_key", "send_login_otp_v2")

    # ── Step 2: Verify TOTP ───────────────────────────────────────────────────
    # Guard: if we're in the last 3 seconds of a 30-second TOTP window, wait for
    # the window to rotate so we don't submit a code that's about to expire.
    if datetime.now().second % 30 > 27:
        logger.info("[Fyers headless] Near TOTP rotation boundary — waiting 5s")
        sleep(5)

    totp_code = pyotp.TOTP(totp_secret).now()
    logger.info("[Fyers headless] Step 2: verify_otp")
    res2 = _post_with_retry(
        ses,
        "https://api-t2.fyers.in/vagator/v2/verify_otp",
        {"request_key": request_key, "otp": totp_code},
        "verify_otp",
    )
    d2 = _check_json(res2, "verify_otp")
    if d2.get("s") != "ok":
        raise BrokerAuthError(f"Fyers verify TOTP failed: {d2}")
    request_key_2 = _required_string(d2, "request_key", "verify_otp")

    # ── Step 3: Verify PIN ────────────────────────────────────────────────────
    logger.info("[Fyers headless] Step 3: verify_pin_v2")
    res3 = _post_with_retry(
        ses,
        "https://api-t2.fyers.in/vagator/v2/verify_pin_v2",
        {
            "request_key": request_key_2,
            "identity_type": "pin",
            "identifier": b64_pin,
        },
        "verify_pin_v2",
    )
    d3 = _check_json(res3, "verify_pin_v2")
    if d3.get("s") != "ok":
        raise BrokerAuthError(f"Fyers verify PIN failed: {d3}")

    session_token = _required_nested_string(d3, "data", "access_token", "verify_pin_v2")

    # ── Step 4: Generate auth_code via /api/v3/token ──────────────────────────
    # CRITICAL: use the SAME session so cookies from step 3 flow through.
    # Fyers returns a 308-style JSON: {"Url": "...?auth_code=<JWT>&...", "code": 308}
    ses.headers.update({"Authorization": f"Bearer {session_token}"})

    app_id_prefix = app_id.split("-")[0] if "-" in app_id else app_id
    auth_payload = {
        "fyers_id": client_id,
        "app_id": app_id_prefix,
        "redirect_uri": redirect_uri,
        "appType": "100",
        "code_challenge": "",
        "state": "None",
        "scope": "",
        "nonce": "",
        "response_type": "code",
        "create_cookie": True,
    }
    logger.info("[Fyers headless] Step 4: POST /api/v3/token")
    res4 = _post_with_retry(ses, "https://api-t1.fyers.in/api/v3/token", auth_payload, "token")
    d4 = _check_json(res4, "token")

    # Parse the redirect URL to extract auth_code
    redirect_url = d4.get("Url")
    if d4.get("code") == 308 and isinstance(redirect_url, str):
        parsed = urlparse(redirect_url)
        qs = parse_qs(parsed.query)
        auth_code = next(iter(qs.get("auth_code") or qs.get("code") or []), "")
        if not auth_code:
            raise BrokerAuthError(
                f"Fyers step 4 redirect URL is missing auth_code: {redirect_url}"
            )
    elif d4.get("s") == "error" or d4.get("code") not in (200, 308):
        raise BrokerAuthError(f"Fyers auth code generation failed: {d4}")
    elif "data" in d4:
        auth_code = _required_nested_string(d4, "data", "auth", "token")
    else:
        raise BrokerAuthError(f"Unexpected Fyers step 4 response format: {d4}")

    logger.info("[Fyers headless] Step 4 OK — auth_code extracted")

    # ── Step 5: Exchange auth_code for final access token ─────────────────────
    app_id_hash = hashlib.sha256(f"{app_id}:{app_secret}".encode()).hexdigest()
    logger.info("[Fyers headless] Step 5: validate-authcode")
    res5 = _post_with_retry(
        ses,
        "https://api-t1.fyers.in/api/v3/validate-authcode",
        {
            "grant_type": "authorization_code",
            "appIdHash": app_id_hash,
            "code": auth_code,
        },
        "validate-authcode",
    )
    d5 = _check_json(res5, "validate-authcode")
    if d5.get("s") != "ok":
        raise BrokerAuthError(f"Fyers token exchange failed: {d5}")

    access_token = d5.get("access_token")
    if not access_token:
        raise BrokerAuthError(f"Fyers step 5 response missing access_token: {d5}")

    logger.info("[Fyers headless] Login complete — access token obtained")
    return str(access_token)
