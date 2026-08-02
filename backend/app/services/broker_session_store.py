"""Persists the single active broker session across backend restarts.

See `app.models.broker_session.BrokerSessionRecord` for why this exists and
what's actually stored.
"""

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.crypto import decrypt_token, encrypt_token
from app.core.exceptions import is_broker_auth_error
from app.db.session import async_session_maker
from app.models.broker_session import BrokerSessionRecord
from app.models.user import TradingMode
from app.services.dhan_service import DhanService
from app.services.fyers_service import FyersService
from app.services.session_manager import session_manager

if TYPE_CHECKING:
    from app.services.broker_base import BrokerService

logger = logging.getLogger(__name__)

_SINGLETON_ID = "active"


async def save_broker_session(
    db: AsyncSession,
    settings: Settings,
    *,
    client_id: str,
    app_id: str,
    access_token: str,
    broker: str = "fyers",
    trading_mode: TradingMode,
    account_name: str,
) -> None:
    """Replace the persisted session row with the newly established one."""
    await db.execute(delete(BrokerSessionRecord))
    record = BrokerSessionRecord(
        id=_SINGLETON_ID,
        broker=broker,
        client_id=client_id,
        app_id=app_id,
        access_token=encrypt_token(access_token, settings),
        trading_mode=trading_mode.value,
        account_name=account_name,
        connected_at=datetime.now(UTC),
    )
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


async def invalidate_broker_session(db: AsyncSession | None = None) -> None:
    """Drop the active in-memory and persisted session after auth failure.

    Background jobs may discover an expired token after startup validation has
    already completed.  Clearing both copies prevents the next scheduler pass
    (or process restart) from retrying the same invalid credentials.
    """
    try:
        await session_manager.clear()
    except Exception:
        # Closing a broker websocket should not prevent the persisted row from
        # being removed; the token is unusable regardless.
        logger.exception("Could not close the invalid broker session cleanly")

    try:
        if db is not None:
            await clear_broker_session(db)
        else:
            async with async_session_maker() as cleanup_db:
                await clear_broker_session(cleanup_db)
    except Exception:
        # Do not turn an already handled broker-auth failure into a scheduler
        # traceback.  The next restart can retry the cleanup if the DB was
        # temporarily unavailable.
        logger.exception("Could not clear the persisted invalid broker session")


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

    access_token = decrypt_token(record.access_token, settings)
    service: BrokerService
    if record.broker == "dhan":
        service = DhanService(
            client_id=record.client_id,
            access_token=access_token,
            trading_mode=TradingMode(record.trading_mode),
            account_name=record.account_name,
        )
    else:
        service = FyersService(
            app_id=record.app_id,
            access_token=access_token,
            trading_mode=TradingMode(record.trading_mode),
            account_name=record.account_name,
        )
    # A token can be revoked or expire before the local cache TTL.  Validate
    # the restored session once before background jobs start; otherwise every
    # IV/history symbol would independently retry the same dead token and fill
    # startup logs with identical broker errors.
    try:
        await service.get_profile()
    except Exception as exc:
        try:
            await service.close()
        except Exception:
            logger.exception("Could not close rejected broker session during restore")
        if is_broker_auth_error(exc):
            logger.warning(
                "Persisted broker session for %s is invalid or expired; "
                "discarding it. Reconnect the broker to resume live data.",
                record.client_id,
            )
            await clear_broker_session(db)
            return
        raise

    await session_manager.set_session(record.client_id, service)
    logger.info("Restored broker session for %s from persisted state.", record.client_id)
