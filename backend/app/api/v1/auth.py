"""Authentication endpoints.

Handles Fyers OAuth/TOTP and Dhan Client ID/access-token login, token
verification, user profile retrieval, and logout. Only one broker session is
active at a time (see session_manager).
"""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fyers_apiv3 import fyersModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.core.exceptions import BrokerAuthError, BrokerConnectionError
from app.core.security import create_access_token, get_current_user
from app.db.session import get_db
from app.models.user import TradingMode
from app.schemas.auth import (
    AuthErrorResponse,
    BrokerSessionStatusResponse,
    LoginRequest,
    LoginResponse,
    UserProfileResponse,
)
from app.services.broker_credentials_store import load_broker_credentials, save_broker_credentials
from app.services.broker_session_store import (
    clear_broker_session,
    load_broker_session,
    save_broker_session,
)
from app.services.dhan_service import DhanService
from app.services.fyers_headless import get_fyers_access_token_headless
from app.services.fyers_service import FyersService
from app.services.market_data_backfill import request_market_data_backfill
from app.services.session_manager import session_manager
from app.services.token_blocklist import TokenBlocklist, get_token_blocklist

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])
_auto_login_lock = asyncio.Lock()


def _login_response_from_profile(
    profile: Any, settings: Settings
) -> LoginResponse:
    token = create_access_token(data=profile.to_jwt_payload(), settings=settings)
    return LoginResponse(
        access_token=token,
        expires_in=settings.jwt_expiry_minutes * 60,
        user=UserProfileResponse(
            client_id=profile.client_id,
            broker_name=profile.broker_name,
            trading_mode=profile.trading_mode.value,
            account_name=profile.account_name,
            connected_at=profile.connected_at,
        ),
    )


def _login_response_from_record(record: Any, settings: Settings) -> LoginResponse:
    broker_name = "Dhan" if record.broker == "dhan" else "Fyers"
    payload = {
        "sub": record.client_id,
        "broker": broker_name,
        "trading_mode": record.trading_mode,
        "account_name": record.account_name,
        "connected_at": record.connected_at.isoformat(),
    }
    return LoginResponse(
        access_token=create_access_token(payload, settings=settings),
        expires_in=settings.jwt_expiry_minutes * 60,
        user=UserProfileResponse(
            client_id=record.client_id,
            broker_name=broker_name,
            trading_mode=record.trading_mode,
            account_name=record.account_name,
            connected_at=record.connected_at,
        ),
    )


async def _resolve_access_token(request: LoginRequest, settings: Settings) -> str:
    """Resolve an access token from the selected broker's auth flow."""
    if request.broker == "dhan":
        assert request.access_token
        return request.access_token

    assert request.app_id and request.api_secret
    if request.auth_code:
        # API v3 requires the -100 appType suffix on the client_id
        client_id = request.app_id if request.app_id.endswith("-100") else f"{request.app_id}-100"
        session = fyersModel.SessionModel(
            client_id=client_id,
            secret_key=request.api_secret,
            redirect_uri=request.redirect_uri,
            response_type="code",
            grant_type="authorization_code",
        )
        session.set_token(request.auth_code)
        response = await asyncio.to_thread(session.generate_token)
        if response.get("s") != "ok":
            raise BrokerAuthError(
                f"Fyers token exchange failed: {response.get('message', 'Unknown error')}"
            )
        return str(response["access_token"])

    # Headless TOTP auto-login — request validation guarantees these are set.
    assert request.client_id and request.totp_secret and request.pin
    return await get_fyers_access_token_headless(
        client_id=request.client_id,
        totp_secret=request.totp_secret,
        pin=request.pin,
        app_id=request.app_id,
        app_secret=request.api_secret,
        redirect_uri=request.redirect_uri,
        ttl_seconds=settings.broker_token_cache_ttl_seconds,
    )


async def _complete_login(
    access_token: str,
    broker: str,
    app_id: str,
    client_id: str | None,
    trading_mode: TradingMode,
    settings: Settings,
    db: AsyncSession,
) -> LoginResponse:
    """Verify a resolved access token and establish the broker session.

    Shared by both /login and /auto-login once each has independently
    resolved an access_token via its own auth method.
    """
    service = (
        DhanService(client_id=client_id or "", access_token=access_token, trading_mode=trading_mode)
        if broker == "dhan"
        else FyersService(app_id=app_id, access_token=access_token, trading_mode=trading_mode)
    )

    try:
        profile = await service.get_profile()

        # Persist first. A database failure must not tear down the live
        # service that is currently feeding already-connected browser tabs.
        await save_broker_session(
            db,
            settings,
            client_id=profile.client_id,
            app_id=app_id,
            access_token=access_token,
            broker=broker,
            trading_mode=trading_mode,
            account_name=profile.account_name,
        )
        await session_manager.set_session(profile.client_id, service)
        if settings.market_data_backfill_enabled:
            request_market_data_backfill()
        return _login_response_from_profile(profile, settings)

    except BrokerAuthError as e:
        await service.close()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=e.message) from e
    except BrokerConnectionError as e:
        await service.close()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=e.message
        ) from e
    except Exception:
        # Persistence/setup failures happen before the service becomes active.
        # Do not leak the newly-created SDK client, but also do not close it if
        # activation itself succeeded and a later non-critical hook failed.
        if session_manager.get_active_session() is not service:
            await service.close()
        raise


@router.get(
    "/session",
    response_model=BrokerSessionStatusResponse,
    summary="Verify that the authenticated browser still has a live broker service",
)
async def broker_session_status(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> BrokerSessionStatusResponse:
    """Check the restored in-memory session without logging into Fyers again."""
    client_id = current_user.get("sub")
    service, generation, _ = session_manager.get_session_snapshot(client_id)
    if service is None:
        raise HTTPException(status_code=401, detail="Active broker session not found")
    return BrokerSessionStatusResponse(active=True, generation=generation)


@router.post(
    "/login",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
    summary="Login with Fyers or Dhan",
    description=(
        "Authenticate with Fyers via OAuth/TOTP or Dhan via Client ID plus "
        "access token. Returns a JWT for "
        "subsequent requests. Only one broker session is active at a time — "
        "logging in replaces any existing session."
    ),
    responses={
        401: {"model": AuthErrorResponse, "description": "Invalid credentials"},
        503: {"model": AuthErrorResponse, "description": "Broker API unreachable"},
    },
)
async def login(
    request: LoginRequest,
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """Authenticate the selected broker and establish the active session.

    1. Resolves an access_token via OAuth code exchange or headless TOTP login.
    2. Verifies the token by fetching the Fyers profile.
    3. Issues a JWT access token and stores the session (replacing any prior one).

    Args:
        request: Login credentials — either OAuth auth_code or TOTP fields.
        settings: Application settings.

    Returns:
        LoginResponse with JWT token and user profile.
    """
    trading_mode = TradingMode(request.trading_mode)

    try:
        access_token = await _resolve_access_token(request, settings)
    except BrokerAuthError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=e.message) from e

    response = await _complete_login(
        access_token,
        request.broker,
        request.app_id or "",
        request.client_id,
        trading_mode,
        settings,
        db,
    )

    if request.totp_secret:
        # A successful headless TOTP login gives us everything /auto-login
        # needs to silently re-authenticate later — persist it (encrypted)
        # as the new source of truth, superseding whatever was saved before.
        assert request.client_id and request.pin
        await save_broker_credentials(
            db,
            settings,
            app_id=request.app_id or "",
            api_secret=request.api_secret or "",
            client_id=request.client_id,
            totp_secret=request.totp_secret,
            pin=request.pin,
            redirect_uri=request.redirect_uri,
            trading_mode=request.trading_mode,
        )

    return response


@router.post(
    "/auto-login",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
    summary="Silent auto-login using previously-saved credentials",
    description=(
        "Attempts a headless TOTP login using the credentials persisted "
        "from the last successful /login call made with client_id + "
        "totp_secret + pin (see save_broker_credentials). Used by the "
        "frontend to skip the manual login form on startup. Returns 503 "
        "if no TOTP login has ever succeeded."
    ),
    responses={
        401: {"model": AuthErrorResponse, "description": "Invalid credentials"},
        503: {
            "model": AuthErrorResponse,
            "description": "Auto-login not configured or broker unreachable",
        },
    },
)
async def auto_login(
    settings: Settings = Depends(get_settings), db: AsyncSession = Depends(get_db)
) -> LoginResponse:
    """Authenticate using DB-persisted Fyers TOTP credentials, no request body.

    Mirrors the TOTP auto-login branch of /login, but sources credentials
    from broker_credentials_store instead of the request, so the frontend
    can attempt this silently before ever showing the login form.
    """
    # Multiple tabs can start together. Serialize the whole recovery and
    # re-check the persisted/in-memory session after acquiring the lock so
    # all but the first request reuse the service it established.
    async with _auto_login_lock:
        record = await load_broker_session(db)
        if record is not None and session_manager.get_session(record.client_id) is not None:
            return _login_response_from_record(record, settings)

        creds = await load_broker_credentials(db, settings)
        if creds is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Auto-login is not configured — log in once with TOTP credentials first.",
            )

        try:
            access_token = await get_fyers_access_token_headless(
                client_id=creds.client_id,
                totp_secret=creds.totp_secret,
                pin=creds.pin,
                app_id=creds.app_id,
                app_secret=creds.api_secret,
                redirect_uri=creds.redirect_uri,
                ttl_seconds=settings.broker_token_cache_ttl_seconds,
            )
        except BrokerAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=e.message) from e

        return await _complete_login(
            access_token,
            "fyers",
            creds.app_id,
            creds.client_id,
            TradingMode(creds.trading_mode),
            settings,
            db,
        )


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="Logout",
    description="Invalidate the current session and revoke its token.",
)
async def logout(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    blocklist: TokenBlocklist = Depends(get_token_blocklist),
) -> dict[str, str]:
    """Logout the current user.

    Records this token's jti in the Redis-backed revocation blocklist (see
    app.services.token_blocklist) so it's rejected by every other endpoint
    from this point on, not just discarded client-side — the token's own
    `exp` still bounds how long the blocklist entry needs to live.

    Args:
        current_user: Decoded JWT payload.
        db: Database session, used to drop the persisted broker session.
        blocklist: JWT revocation blocklist.

    Returns:
        Success message.
    """
    client_id = current_user["sub"]
    jti = current_user.get("jti")
    exp = current_user.get("exp")
    if jti and exp:
        await blocklist.revoke(jti, datetime.fromtimestamp(exp, tz=UTC))
    await session_manager.remove_session(client_id)
    await clear_broker_session(db)
    return {"message": "Successfully logged out", "client_id": client_id}
