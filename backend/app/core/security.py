"""JWT token creation, verification, and authentication dependencies.

Uses python-jose for JWT operations. Authentication is API-key-based
through the native Fyers SDK — no passwords are stored or managed.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.config import Settings, get_settings

# HTTP Bearer scheme for JWT tokens
bearer_scheme = HTTPBearer(
    scheme_name="JWT",
    description="JWT token obtained from /api/v1/auth/login",
    auto_error=True,
)


def create_access_token(
    data: dict[str, Any],
    settings: Settings | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    """Create a JWT access token.

    Args:
        data: Payload to encode in the token.
        settings: Application settings. Uses default if not provided.
        expires_delta: Custom expiration time. Uses settings default if not provided.

    Returns:
        Encoded JWT string.
    """
    if settings is None:
        settings = get_settings()

    to_encode = data.copy()
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.jwt_expiry_minutes)
    )
    to_encode.update({"exp": expire, "iat": datetime.now(UTC)})

    return str(
        jwt.encode(
            to_encode,
            settings.jwt_secret,
            algorithm=settings.jwt_algorithm,
        )
    )


def decode_token(
    token: str,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Decode and verify a JWT token.

    Args:
        token: The JWT string to decode.
        settings: Application settings.

    Returns:
        Decoded token payload.

    Raises:
        HTTPException: If token is invalid or expired.
    """
    if settings is None:
        settings = get_settings()

    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
        return payload
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """FastAPI dependency to extract and validate the current user from JWT.

    Args:
        credentials: Bearer token from Authorization header.
        settings: Application settings.

    Returns:
        Decoded user payload from the JWT.

    Raises:
        HTTPException: If token is missing, invalid, or expired.
    """
    payload = decode_token(credentials.credentials, settings)

    # Validate required fields
    if "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing required 'sub' claim",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload
