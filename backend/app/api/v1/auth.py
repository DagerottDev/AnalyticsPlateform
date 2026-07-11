"""Authentication endpoints.

Handles login via native broker credentials (Fyers or Zerodha), token
verification, user profile retrieval, and logout. No passwords —
authentication is delegated to the broker's own API.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

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
    AutoLoginRequest,
)
from app.services.fyers_service import FyersService
from app.services.session_manager import session_manager
from app.services.zerodha_service import ZerodhaService
from app.services.zerodha_auto_login import generate_zerodha_access_token

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post(
    "/login",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
    summary="Login with Broker Credentials",
    description=(
        "Authenticate using native Fyers or Zerodha credentials. "
        "Returns a JWT for subsequent requests."
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
    """Authenticate a user via native broker credentials.

    1. Connects to the requested broker (Fyers or Zerodha) using the given credentials.
    2. Verifies the credentials by fetching the broker profile.
    3. Retrieves user profile information.
    4. Issues a JWT access token.

    Args:
        request: Login credentials with broker name, API key/app ID, access token, and trading mode.
        settings: Application settings.

    Returns:
        LoginResponse with JWT token and user profile.
    """
    trading_mode = TradingMode(request.trading_mode)

    service: FyersService | ZerodhaService
    if request.broker_name.lower() == "fyers":
        service = FyersService(
            app_id=request.app_id or "",
            access_token=request.access_token or "",
            trading_mode=trading_mode,
        )
    elif request.broker_name.lower() == "zerodha":
        service = ZerodhaService(
            api_key=request.api_key or "",
            access_token=request.access_token or "",
            trading_mode=trading_mode,
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported broker",
        )

    try:
        # Verify connection and get profile
        profile = await service.get_profile()

        # Create JWT token
        token = create_access_token(
            data=profile.to_jwt_payload(),
            settings=settings,
        )

        # Store service in memory session
        session_manager.set_session(profile.client_id, service)

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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message,
        ) from e
    except BrokerConnectionError as e:
        await service.close()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=e.message,
        ) from e


@router.post(
    "/auto-login",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
    summary="Auto Login with Broker Credentials and TOTP",
    description="Automate broker login using user ID, password, and TOTP secret.",
    responses={
        401: {"model": AuthErrorResponse, "description": "Invalid credentials or TOTP"},
        503: {"model": AuthErrorResponse, "description": "Broker API unreachable"},
    },
)
async def auto_login(
    request: AutoLoginRequest,
    settings: Settings = Depends(get_settings),
) -> LoginResponse:
    """Automate the broker login process.

    Currently supports only Zerodha. Automates the flow by generating the TOTP,
    fetching the request_token, and exchanging it for an access_token.
    """
    trading_mode = TradingMode(request.trading_mode)

    if request.broker_name.lower() != "zerodha":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Auto login is currently supported only for Zerodha",
        )

    try:
        # 1. Automate the login to get access_token
        access_token = await generate_zerodha_access_token(
            user_id=request.user_id,
            password=request.password,
            totp_secret=request.totp_secret,
            api_key=request.api_key,
            api_secret=request.api_secret,
        )

        # 2. Initialize the service with the acquired access_token
        service = ZerodhaService(
            api_key=request.api_key,
            access_token=access_token,
            trading_mode=trading_mode,
        )

        # 3. Verify connection and get profile
        profile = await service.get_profile()

        # 4. Create JWT token
        token = create_access_token(
            data=profile.to_jwt_payload(),
            settings=settings,
        )

        # 5. Store service in memory session
        session_manager.set_session(profile.client_id, service)

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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        ) from e
    except BrokerConnectionError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        ) from e


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
        broker_name=current_user.get("broker", "Unknown"),
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
