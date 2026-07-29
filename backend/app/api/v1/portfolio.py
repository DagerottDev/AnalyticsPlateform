"""Real broker account state — positions, holdings, and funds.

Unlike /historical/ohlcv (a backfilled DB table) or the paper positions
tracked client-side from Strategy Builder, everything here is a live pull
straight from the connected Fyers account.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_current_user
from app.schemas.portfolio import (
    BrokerHolding,
    BrokerPosition,
    FundsResponse,
    HoldingsResponse,
    PositionsResponse,
)
from app.services.session_manager import session_manager

router = APIRouter(prefix="/portfolio", tags=["Portfolio"])


@router.get("/positions", response_model=PositionsResponse)
async def get_positions(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> PositionsResponse:
    """Currently open broker positions (intraday + carry-forward), marked
    to Fyers' own last-traded price."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")

    rows = await service.get_positions()
    positions = [BrokerPosition(**row) for row in rows]
    return PositionsResponse(
        positions=positions,
        total_pnl=sum(p.pnl for p in positions),
        total_realized_pnl=sum(p.realized_pnl for p in positions),
        total_unrealized_pnl=sum(p.unrealized_pnl for p in positions),
    )


@router.get("/holdings", response_model=HoldingsResponse)
async def get_holdings(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> HoldingsResponse:
    """Delivery/long-term portfolio holdings, marked to Fyers' own last-traded price."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")

    rows = await service.get_holdings()
    holdings = [BrokerHolding(**row) for row in rows]
    return HoldingsResponse(
        holdings=holdings,
        total_market_value=sum(h.market_value for h in holdings),
        total_pnl=sum(h.pnl for h in holdings),
    )


# Case-insensitive keyword each named FundsResponse field is matched against,
# tried in order against every row's title until one hits — see FundsResponse's
# docstring for why this is tolerant-matched rather than keyed by a fixed id.
_FUNDS_FIELD_KEYWORDS: dict[str, tuple[str, ...]] = {
    "total_balance": ("total balance",),
    "available_balance": ("available balance",),
    "utilized_amount": ("utilized amount", "utilised amount"),
    "realized_pnl": ("realised profit", "realized profit"),
    "unrealized_pnl": ("unrealised profit", "unrealized profit"),
}


def _extract_funds_fields(fund_limit: list[dict[str, Any]]) -> dict[str, float | None]:
    fields: dict[str, float | None] = dict.fromkeys(_FUNDS_FIELD_KEYWORDS, None)
    for row in fund_limit:
        title = str(row.get("title", "")).strip().lower()
        amount = row.get("equityAmount")
        if not isinstance(amount, int | float):
            continue
        for field, keywords in _FUNDS_FIELD_KEYWORDS.items():
            if fields[field] is None and any(keyword in title for keyword in keywords):
                fields[field] = float(amount)
    return fields


@router.get("/funds", response_model=FundsResponse)
async def get_funds(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> FundsResponse:
    """Account funds/margin summary."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")

    data = await service.get_funds()
    fund_limit = data.get("fund_limit", [])
    return FundsResponse(**_extract_funds_fields(fund_limit), raw=fund_limit)
