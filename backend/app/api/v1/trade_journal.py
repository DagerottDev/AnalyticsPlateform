"""Persistent trade journal and derived performance analytics."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.trade_journal import TradeJournalRecord
from app.schemas.trade_journal import JournalSummary, TradeCreate, TradeResponse, TradeUpdate

router = APIRouter(prefix="/journal", tags=["Trade Journal"])


def _metrics(record: TradeJournalRecord) -> tuple[float | None, float | None]:
    if record.exit_price is None:
        return None, None
    pnl = (record.exit_price - record.entry_price) * record.quantity
    if record.side == "Sell":
        pnl *= -1
    risk = abs(record.entry_price - record.stop_price) * record.quantity if record.stop_price else 0
    return pnl, pnl / risk if risk > 0 else None


def _response(record: TradeJournalRecord) -> TradeResponse:
    pnl, risk_reward = _metrics(record)
    return TradeResponse(
        id=record.id, trading_symbol=record.trading_symbol, side=record.side,
        quantity=record.quantity, entry_price=record.entry_price, exit_price=record.exit_price,
        stop_price=record.stop_price, entry_time=record.entry_time, exit_time=record.exit_time,
        notes=record.notes, tags=record.tags, source=record.source, pnl=pnl,
        risk_reward=risk_reward, created_at=record.created_at, updated_at=record.updated_at,
    )


@router.get("/trades", response_model=list[TradeResponse])
async def list_trades(
    current_user: dict[str, Any] = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[TradeResponse]:
    statement = select(TradeJournalRecord).where(
        TradeJournalRecord.owner_id == current_user["sub"]
    ).order_by(TradeJournalRecord.entry_time.desc())
    return [_response(record) for record in (await db.scalars(statement)).all()]


@router.post("/trades", response_model=TradeResponse, status_code=status.HTTP_201_CREATED)
async def create_trade(
    request: TradeCreate, current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TradeResponse:
    now = datetime.now(UTC)
    record = TradeJournalRecord(
        id=str(uuid4()), owner_id=current_user["sub"],
        trading_symbol=request.trading_symbol.upper(), side=request.side, quantity=request.quantity,
        entry_price=request.entry_price, exit_price=request.exit_price, stop_price=request.stop_price,
        entry_time=request.entry_time, exit_time=request.exit_time, notes=request.notes,
        tags=[tag.strip() for tag in request.tags if tag.strip()], source=request.source,
        created_at=now, updated_at=now,
    )
    db.add(record); await db.commit(); await db.refresh(record)
    return _response(record)


@router.patch("/trades/{trade_id}", response_model=TradeResponse)
async def close_trade(
    trade_id: str, request: TradeUpdate, current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TradeResponse:
    record = await db.get(TradeJournalRecord, trade_id)
    if record is None or record.owner_id != current_user["sub"]:
        raise HTTPException(status_code=404, detail="Trade not found")
    if request.exit_time < record.entry_time:
        raise HTTPException(status_code=422, detail="exit_time must not precede entry_time")
    record.exit_price, record.exit_time = request.exit_price, request.exit_time
    if request.notes is not None: record.notes = request.notes
    if request.tags is not None: record.tags = [tag.strip() for tag in request.tags if tag.strip()]
    record.updated_at = datetime.now(UTC)
    await db.commit(); await db.refresh(record)
    return _response(record)


@router.get("/summary", response_model=JournalSummary)
async def journal_summary(
    current_user: dict[str, Any] = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> JournalSummary:
    statement = select(TradeJournalRecord).where(
        TradeJournalRecord.owner_id == current_user["sub"], TradeJournalRecord.exit_time.is_not(None)
    ).order_by(TradeJournalRecord.exit_time.asc())
    records = (await db.scalars(statement)).all()
    pnls = [_metrics(record)[0] or 0 for record in records]
    rrs = [rr for record in records if (rr := _metrics(record)[1]) is not None]
    equity, curve = 0.0, []
    for record, pnl in zip(records, pnls, strict=True):
        equity += pnl
        curve.append({"date": record.exit_time.isoformat() if record.exit_time else "", "equity": round(equity, 2)})
    return JournalSummary(closed_trades=len(records), win_rate=(sum(pnl > 0 for pnl in pnls) / len(pnls) * 100) if pnls else None, average_risk_reward=sum(rrs) / len(rrs) if rrs else None, net_pnl=round(equity, 2), equity_curve=curve)
