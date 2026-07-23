"""Persists the Fyers TOTP login credentials used for silent auto-login.

See `app.models.broker_credentials.BrokerCredentialsRecord` for why this
exists. Reuses the same Fernet-based encryption as broker_session_store for
the secret fields (api_secret, totp_secret, pin).
"""

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.crypto import decrypt_token, encrypt_token
from app.models.broker_credentials import BrokerCredentialsRecord

_SINGLETON_ID = "active"


@dataclass
class BrokerCredentials:
    app_id: str
    api_secret: str
    client_id: str
    totp_secret: str
    pin: str
    redirect_uri: str
    trading_mode: str


async def save_broker_credentials(
    db: AsyncSession,
    settings: Settings,
    *,
    app_id: str,
    api_secret: str,
    client_id: str,
    totp_secret: str,
    pin: str,
    redirect_uri: str,
    trading_mode: str,
) -> None:
    """Replace the persisted credentials with the ones just used for a
    successful headless login — this becomes the new source of truth for
    auto-login, superseding whatever (if anything) was stored before."""
    await db.execute(delete(BrokerCredentialsRecord))
    record = BrokerCredentialsRecord()
    record.id = _SINGLETON_ID
    record.app_id = app_id
    record.api_secret = encrypt_token(api_secret, settings)
    record.client_id = client_id
    record.totp_secret = encrypt_token(totp_secret, settings)
    record.pin = encrypt_token(pin, settings)
    record.redirect_uri = redirect_uri
    record.trading_mode = trading_mode
    record.updated_at = datetime.now(UTC)
    db.add(record)
    await db.commit()


async def load_broker_credentials(db: AsyncSession, settings: Settings) -> BrokerCredentials | None:
    result = await db.execute(
        select(BrokerCredentialsRecord).where(BrokerCredentialsRecord.id == _SINGLETON_ID)
    )
    record = result.scalar_one_or_none()
    if record is None:
        return None
    return BrokerCredentials(
        app_id=record.app_id,
        api_secret=decrypt_token(record.api_secret, settings),
        client_id=record.client_id,
        totp_secret=decrypt_token(record.totp_secret, settings),
        pin=decrypt_token(record.pin, settings),
        redirect_uri=record.redirect_uri,
        trading_mode=record.trading_mode,
    )
