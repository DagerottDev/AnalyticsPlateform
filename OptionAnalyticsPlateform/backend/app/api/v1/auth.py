"""Authentication endpoints.

Handles login via OpenAlgo API key, token verification, user profile
retrieval, and logout. No passwords — authentication is delegated to
OpenAlgo's broker connection.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import Settings, get_settings
from app.core.exceptions import OpenAlgoAuthError, OpenAlgoConnectionError
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
from app.services.openalgo_service import OpenAlgoService

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post(
    "/login",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
    summary="Login with OpenAlgo API Key",
    description="Authenticate using an OpenAlgo API key. Returns a JWT for subsequent requests.",
    responses={
        401: {"model": AuthErrorResponse, "description": "Invalid API key"},
        503: {"model": AuthErrorResponse, "description": "OpenAlgo unreachable"},
    },
)
async def login(
    request: LoginRequest,
    settings: Settings = Depends(get_settings),
) -> LoginResponse:
    """Authenticate a user via OpenAlgo API key.

    1. Connects to the specified OpenAlgo instance.
    2. Verifies the API key by attempting a funds query.
    3. Retrieves user profile information.
    4. Issues a JWT access token.

    Args:
        request: Login credentials with API key, host, and trading mode.
        settings: Application settings.

    Returns:
        LoginResponse with JWT token and user profile.
    """
    trading_mode = TradingMode(request.trading_mode)

    service = OpenAlgoService(
        host=request.host,
        api_key=request.api_key,
        trading_mode=trading_mode,
    )

    try:
        # Verify connection and get profile
        profile = await service.get_profile()

        # Create JWT token
        token = create_access_token(
            data=profile.to_jwt_payload(),
            settings=settings,
        )

        return LoginResponse(
            access_token=token,
            expires_in=settings.jwt_expiry_minutes * 60,
            user=UserProfileResponse(
                client_id=profile.client_id,
                broker_name=profile.broker_name,
                trading_mode=profile.trading_mode.value,
                openalgo_host=profile.openalgo_host,
                connected_at=profile.connected_at,
            ),
        )

    except OpenAlgoAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message,
        ) from e
    except OpenAlgoConnectionError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=e.message,
        ) from e
    finally:
        await service.close()


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
        openalgo_host=current_user.get("openalgo_host", ""),
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
    return {"message": "Successfully logged out", "client_id": current_user["sub"]}
