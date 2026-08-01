"""Explicit, live-only order execution routes for the connected Fyers account."""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.schemas.orders import (
    BasketLegResult,
    BasketOrderResponse,
    BrokerOrder,
    ModifyOrderRequest,
    OrderActionResponse,
    OrdersResponse,
    PlaceBasketOrderRequest,
    PlaceOrderRequest,
)
from app.services import live_basket_store
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/orders", tags=["Orders"])


def _live_execution_service(current_user: dict[str, Any]) -> Any:
    """Return a broker service only for a session created in live mode.

    This is intentionally enforced by the server from the signed JWT, rather
    than trusting a browser toggle. Paper mode remains isolated to the local
    simulator and can never accidentally reach Fyers' execution endpoint.
    """
    if current_user.get("trading_mode") != "live":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Live order execution requires a broker session connected in Live mode",
        )
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")
    return service


@router.get("", response_model=OrdersResponse)
async def get_orders(current_user: dict[str, Any] = Depends(get_current_user)) -> OrdersResponse:
    """Read today's order book. This remains available to either account mode."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")
    orders = await service.get_orders()
    return OrdersResponse(orders=[BrokerOrder.model_validate(order) for order in orders])


@router.post("", response_model=OrderActionResponse, status_code=status.HTTP_201_CREATED)
async def place_order(
    request: PlaceOrderRequest, current_user: dict[str, Any] = Depends(get_current_user)
) -> OrderActionResponse:
    service = _live_execution_service(current_user)
    result = await service.place_order(request.model_dump())
    logger.info(
        "Live order submitted for client=%s symbol=%s order_id=%s",
        current_user["sub"], request.symbol, result.get("id"),
    )
    return OrderActionResponse(**result)


@router.patch("/{order_id}", response_model=OrderActionResponse)
async def modify_order(
    order_id: str,
    request: ModifyOrderRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> OrderActionResponse:
    service = _live_execution_service(current_user)
    result = await service.modify_order(order_id, request.model_dump())
    logger.info("Live order modified for client=%s order_id=%s", current_user["sub"], order_id)
    return OrderActionResponse(**result)


@router.delete("/{order_id}", response_model=OrderActionResponse)
async def cancel_order(
    order_id: str, current_user: dict[str, Any] = Depends(get_current_user)
) -> OrderActionResponse:
    service = _live_execution_service(current_user)
    result = await service.cancel_order(order_id)
    logger.info("Live order cancelled for client=%s order_id=%s", current_user["sub"], order_id)
    return OrderActionResponse(**result)


@router.post(
    "/basket", response_model=BasketOrderResponse, status_code=status.HTTP_201_CREATED
)
async def place_basket_order(
    request: PlaceBasketOrderRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BasketOrderResponse:
    """Submit every leg as one basket, then arm each leg's protective
    stop-loss as a real exchange STOP order and persist the basket so the
    monitor loop can watch per-leg targets and the combined stop-loss/target.

    Partial failures are intentional: legs are reported individually rather
    than raising, since an earlier leg may have already reached the
    exchange by the time a later one fails.
    """
    service = _live_execution_service(current_user)

    entry_prices: dict[str, float] = {}
    try:
        quotes = await service.get_quotes([leg.symbol for leg in request.legs])
        entry_prices = {
            str(quote.get("trading_symbol") or quote.get("symbol")): float(quote["last_price"])
            for quote in quotes
            if quote.get("last_price", 0) > 0
        }
    except Exception:
        # A missing reference price only degrades the monitor loop's P&L
        # tracking for this leg — it must never block order entry itself.
        logger.exception("Could not snapshot entry quotes for basket (client=%s)", current_user["sub"])

    entry_orders = [
        {
            "symbol": leg.symbol,
            "quantity": leg.quantity,
            "side": leg.side,
            "order_type": leg.order_type,
            "product_type": leg.product_type,
            "limit_price": leg.limit_price,
            "stop_price": leg.stop_price,
            "validity": leg.validity,
            "disclosed_quantity": leg.disclosed_quantity,
            "offline_order": leg.offline_order,
            "stop_loss": 0,
            "take_profit": 0,
            "order_tag": leg.order_tag,
        }
        for leg in request.legs
    ]
    entry_results = await service.place_basket_orders(entry_orders)

    persisted_legs: list[dict[str, Any]] = []
    leg_results: list[BasketLegResult] = []
    exit_side = {"Buy": "Sell", "Sell": "Buy"}
    for leg, result in zip(request.legs, entry_results, strict=True):
        entered = result.get("id") is not None
        protective_stop_order_id = None
        if entered and leg.stop_loss:
            try:
                stop_result = await service.place_order(
                    {
                        "symbol": leg.symbol,
                        "quantity": leg.quantity,
                        "side": exit_side[leg.side],
                        "order_type": "STOP",
                        "product_type": leg.product_type,
                        "limit_price": 0,
                        "stop_price": leg.stop_loss,
                        "validity": "DAY",
                        "disclosed_quantity": 0,
                        "offline_order": False,
                        "stop_loss": 0,
                        "take_profit": 0,
                    }
                )
                protective_stop_order_id = stop_result.get("id")
            except Exception:
                logger.exception(
                    "Could not arm protective stop-loss for %s (client=%s)",
                    leg.symbol, current_user["sub"],
                )
        persisted_legs.append(
            {
                "symbol": leg.symbol,
                "quantity": leg.quantity,
                "side": leg.side,
                "entry_price": entry_prices.get(leg.symbol, 0.0),
                "product_type": leg.product_type,
                "target": leg.take_profit,
                "protective_stop_order_id": protective_stop_order_id,
                "status": "Open" if entered else "Failed",
                "exit_price": None,
                "close_reason": None,
            }
        )
        leg_results.append(
            BasketLegResult(symbol=leg.symbol, id=result.get("id"), message=result.get("message", ""))
        )

    basket_id = None
    if any(leg["status"] == "Open" for leg in persisted_legs):
        record = await live_basket_store.create_basket(
            db,
            owner_id=current_user["sub"],
            legs=persisted_legs,
            combined_stop_loss=request.combined_stop_loss,
            combined_take_profit=request.combined_take_profit,
        )
        basket_id = record.id
        logger.info(
            "Live basket %s submitted for client=%s (%d/%d legs entered)",
            basket_id, current_user["sub"],
            sum(1 for leg in persisted_legs if leg["status"] == "Open"), len(persisted_legs),
        )

    return BasketOrderResponse(basket_id=basket_id, legs=leg_results)
