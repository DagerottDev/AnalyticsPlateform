"""Authentication endpoints.

Handles login via Fyers — either the OAuth redirect flow or headless TOTP
auto-login — plus token verification, user profile retrieval, and logout.
No passwords are stored; authentication is delegated to Fyers' own APIs,
and only one broker session is active at a time (see session_manager).
"""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fyers_apiv3 import fyersModel

from app.config import Settings, get_settings
from app.core.exceptions import BrokerAuthError, BrokerConnectionError
from app.core.security import create_access_token, decode_token, get_current_user
from app.models.user import TradingMode
from app.schemas.auth import (
    AuthErrorResponse,
    LoginRequest,
    LoginResponse,
    TokenVerifyRequest,
    TokenVerifyResponse,
    UserProfileResponse,
)
from app.services.fyers_headless import get_fyers_access_token_headless
from app.services.fyers_service import FyersService
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])


async def _resolve_access_token(request: LoginRequest, settings: Settings) -> str:
    """Resolve a Fyers access_token from whichever auth method was chosen."""
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
    access_token: str, app_id: str, trading_mode: TradingMode, settings: Settings
) -> LoginResponse:
    """Verify a resolved Fyers access_token and establish the broker session.

    Shared by both /login and /auto-login once each has independently
    resolved an access_token via its own auth method.
    """
    service = FyersService(app_id=app_id, access_token=access_token, trading_mode=trading_mode)

    try:
        profile = await service.get_profile()

        token = create_access_token(data=profile.to_jwt_payload(), settings=settings)
        await session_manager.set_session(profile.client_id, service)

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

    except BrokerAuthError as e:
        await service.close()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=e.message) from e
    except BrokerConnectionError as e:
        await service.close()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=e.message
        ) from e


@router.post(
    "/login",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
    summary="Login with Fyers",
    description=(
        "Authenticate with Fyers via OAuth redirect (auth_code) or headless "
        "TOTP auto-login (client_id + totp_secret + pin). Returns a JWT for "
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
) -> LoginResponse:
    """Authenticate with Fyers and establish the single active broker session.

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

    return await _complete_login(access_token, request.app_id, trading_mode, settings)


@router.post(
    "/auto-login",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
    summary="Silent auto-login using server-configured credentials",
    description=(
        "Attempts a headless TOTP login using Fyers credentials configured "
        "server-side (backend/.env) rather than passed in the request body. "
        "Used by the frontend to skip the manual login form on startup when "
        "credentials are available. Returns 503 if none are configured."
    ),
    responses={
        401: {"model": AuthErrorResponse, "description": "Invalid credentials"},
        503: {
            "model": AuthErrorResponse,
            "description": "Auto-login not configured or broker unreachable",
        },
    },
)
async def auto_login(settings: Settings = Depends(get_settings)) -> LoginResponse:
    """Authenticate using server-side Fyers credentials, with no request body.

    Mirrors the TOTP auto-login branch of /login, but sources credentials
    from Settings instead of the request, so the frontend can attempt this
    silently before ever showing the login form.
    """
    if not settings.has_auto_login_credentials:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auto-login is not configured on the server.",
        )

    assert settings.fyers_client_id and settings.fyers_totp_secret and settings.fyers_pin
    assert settings.fyers_app_id and settings.fyers_api_secret

    try:
        access_token = await get_fyers_access_token_headless(
            client_id=settings.fyers_client_id,
            totp_secret=settings.fyers_totp_secret,
            pin=settings.fyers_pin,
            app_id=settings.fyers_app_id,
            app_secret=settings.fyers_api_secret,
            redirect_uri=settings.fyers_redirect_uri,
            ttl_seconds=settings.broker_token_cache_ttl_seconds,
        )
    except BrokerAuthError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=e.message) from e

    return await _complete_login(
        access_token,
        settings.fyers_app_id,
        TradingMode(settings.fyers_trading_mode),
        settings,
    )


@router.get(
    "/me",
    response_model=UserProfileResponse,
    summary="Get Current User Profile",
    description="Returns the authenticated user's profile from the JWT token.",
    responses={
        401: {"model": AuthErrorResponse, "description": "Not authenticated"},
    },
)
async def get_me(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> UserProfileResponse:
    """Get the currently authenticated user's profile.

    Args:
        current_user: Decoded JWT payload from the auth dependency.

    Returns:
        UserProfileResponse with current user information.
    """
    return UserProfileResponse(
        client_id=current_user["sub"],
        broker_name=current_user.get("broker", "Fyers"),
        trading_mode=current_user.get("trading_mode", "paper"),
        account_name=current_user.get("account_name", ""),
        connected_at=current_user.get("connected_at", ""),
    )


@router.post(
    "/verify",
    response_model=TokenVerifyResponse,
    summary="Verify Token",
    description="Verify if a JWT token is valid and not expired.",
)
async def verify_token(
    request: TokenVerifyRequest,
    settings: Settings = Depends(get_settings),
) -> TokenVerifyResponse:
    """Verify the validity of a JWT token.

    Args:
        request: Token to verify.
        settings: Application settings.

    Returns:
        TokenVerifyResponse indicating validity and decoded payload.
    """
    try:
        payload = decode_token(request.token, settings)
        return TokenVerifyResponse(valid=True, payload=payload)
    except HTTPException:
        return TokenVerifyResponse(valid=False, payload=None)


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="Logout",
    description="Invalidate the current session. Client should discard the token.",
)
async def logout(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, str]:
    """Logout the current user.

    Note: Since JWTs are stateless, true invalidation requires a Redis
    blocklist (implemented in M3 with database integration). For now,
    the client discards the token.

    Args:
        current_user: Decoded JWT payload.

    Returns:
        Success message.
    """
    client_id = current_user["sub"]
    await session_manager.remove_session(client_id)
    return {"message": "Successfully logged out", "client_id": client_id}
