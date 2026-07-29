from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import asc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.market_data import MarketData
from app.schemas.historical import OHLCV

router = APIRouter(prefix="/historical", tags=["Historical Data"])


@router.get("/ohlcv/{symbol}", response_model=list[OHLCV])
async def get_historical_ohlcv(
    symbol: str,
    start: datetime | None = Query(default=None, description="Inclusive UTC start timestamp"),
    end: datetime | None = Query(default=None, description="Inclusive UTC end timestamp"),
    limit: int = Query(default=1000, ge=1, le=5000),
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> list[OHLCV]:
    """Retrieve historical OHLCV data from the database."""

    query = select(MarketData).where(MarketData.trading_symbol == symbol)
    if start is not None:
        query = query.where(MarketData.timestamp >= start)
    if end is not None:
        query = query.where(MarketData.timestamp <= end)

    query = query.order_by(asc(MarketData.timestamp)).limit(limit)

    result = await db.execute(query)
    records = result.scalars().all()

    return [OHLCV.model_validate(record) for record in records]
