"""Persists the single active broker session across backend restarts.

See `app.models.broker_session.BrokerSessionRecord` for why this exists and
what's actually stored.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.crypto import decrypt_token, encrypt_token
from app.models.broker_session import BrokerSessionRecord
from app.models.user import TradingMode
from app.services.fyers_service import FyersService
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)

_SINGLETON_ID = "active"


async def save_broker_session(
    db: AsyncSession,
    settings: Settings,
    *,
    client_id: str,
    app_id: str,
    access_token: str,
    trading_mode: TradingMode,
    account_name: str,
) -> None:
    """Replace the persisted session row with the newly established one."""
    await db.execute(delete(BrokerSessionRecord))
    # `Base` (app.db.base_class) is built via the legacy `as_declarative()`
    # helper rather than SQLAlchemy 2.0's `DeclarativeBase`, so mypy doesn't
    # see the auto-generated kwargs `__init__` — assign attributes instead.
    record = BrokerSessionRecord()
    record.id = _SINGLETON_ID
    record.client_id = client_id
    record.app_id = app_id
    record.access_token = encrypt_token(access_token, settings)
    record.trading_mode = trading_mode.value
    record.account_name = account_name
    record.connected_at = datetime.now(UTC)
    db.add(record)
    await db.commit()


async def load_broker_session(db: AsyncSession) -> BrokerSessionRecord | None:
    result = await db.execute(
        select(BrokerSessionRecord).where(BrokerSessionRecord.id == _SINGLETON_ID)
    )
    return result.scalar_one_or_none()


async def clear_broker_session(db: AsyncSession) -> None:
    await db.execute(delete(BrokerSessionRecord))
    await db.commit()


async def restore_broker_session(db: AsyncSession, settings: Settings) -> None:
    """Reconstruct and re-activate the persisted session, if any and still fresh.

    Called once at app startup. A stale/expired persisted token is discarded
    rather than restored — the frontend's existing 401 -> auto-login recovery
    (or the manual login form) takes over from there, same as if this
    restore step didn't exist at all.
    """
    record = await load_broker_session(db)
    if record is None:
        return

    connected_at = record.connected_at
    if connected_at.tzinfo is None:
        connected_at = connected_at.replace(tzinfo=UTC)
    age_seconds = (datetime.now(UTC) - connected_at).total_seconds()

    if age_seconds >= settings.broker_token_cache_ttl_seconds:
        logger.info(
            "Persisted broker session for %s is stale (%.0fs old); discarding.",
            record.client_id,
            age_seconds,
        )
        await clear_broker_session(db)
        return

    service = FyersService(
        app_id=record.app_id,
        access_token=decrypt_token(record.access_token, settings),
        trading_mode=TradingMode(record.trading_mode),
        account_name=record.account_name,
    )
    await session_manager.set_session(record.client_id, service)
    logger.info("Restored broker session for %s from persisted state.", record.client_id)
