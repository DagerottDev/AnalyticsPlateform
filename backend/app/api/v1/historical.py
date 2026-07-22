from typing import Any

from fastapi import APIRouter, Depends
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
    limit: int = 1000,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> list[OHLCV]:
    """Retrieve historical OHLCV data from the database."""

    query = select(MarketData).where(
        MarketData.trading_symbol == symbol
    ).order_by(asc(MarketData.timestamp)).limit(limit)

    result = await db.execute(query)
    records = result.scalars().all()

    return [OHLCV.model_validate(record) for record in records]
