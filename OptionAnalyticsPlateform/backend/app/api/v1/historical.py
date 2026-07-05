from typing import List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, asc

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models.market_data import MarketData
from app.schemas.historical import OHLCV, BackfillRequest, BackfillResponse
from app.services.session_manager import session_manager

router = APIRouter(prefix="/historical", tags=["Historical Data"])

async def process_backfill(
    request: BackfillRequest,
    client_id: str,
    db: AsyncSession
):
    """Background task to fetch and save historical data."""
    service = session_manager.get_session(client_id)
    if not service:
        print(f"Session not found for {client_id}")
        return
    
    try:
        raw_data = await service.get_historical_data(
            request.symbol, request.from_date, request.to_date, request.resolution
        )
        
        # Save to DB
        records = []
        for row in raw_data:
            # We use merge or ignore conflicts in a real app,
            # here we just insert ignoring existing for simplicity in MVP.
            # Postgres: INSERT ... ON CONFLICT DO NOTHING
            from sqlalchemy.dialects.postgresql import insert
            
            stmt = insert(MarketData).values(
                timestamp=row["timestamp"],
                trading_symbol=request.symbol,
                open=row["open"],
                high=row["high"],
                low=row["low"],
                close=row["close"],
                volume=row["volume"],
                open_interest=row["open_interest"],
            ).on_conflict_do_nothing(
                index_elements=['trading_symbol', 'timestamp']
            )
            await db.execute(stmt)
        
        await db.commit()
    except Exception as e:
        print(f"Backfill failed for {request.symbol}: {e}")
        await db.rollback()


@router.post("/backfill", response_model=BackfillResponse)
async def trigger_backfill(
    request: BackfillRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> BackfillResponse:
    """Trigger a background job to backfill historical OHLCV data."""
    
    # We trigger the backfill async
    background_tasks.add_task(process_backfill, request, current_user["sub"], db)
    
    return BackfillResponse(
        message=f"Backfill job started for {request.symbol} from {request.from_date} to {request.to_date}",
        records_inserted=0  # Since it's async
    )


@router.get("/ohlcv/{symbol}", response_model=List[OHLCV])
async def get_historical_ohlcv(
    symbol: str,
    limit: int = 1000,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> List[OHLCV]:
    """Retrieve historical OHLCV data from the database."""
    
    query = select(MarketData).where(
        MarketData.trading_symbol == symbol
    ).order_by(asc(MarketData.timestamp)).limit(limit)
    
    result = await db.execute(query)
    records = result.scalars().all()
    
    return records
