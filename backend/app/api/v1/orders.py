"""Explicit, live-only order execution routes for the connected Fyers account."""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import get_current_user
from app.schemas.orders import (
    ModifyOrderRequest,
    OrderActionResponse,
    OrdersResponse,
    PlaceOrderRequest,
)
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
    return OrdersResponse(orders=await service.get_orders())


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
