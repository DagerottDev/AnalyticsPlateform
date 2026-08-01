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
    CreateGttOrderRequest,
    GttOrderResponse,
    GttOrdersResponse,
    ModifyOrderRequest,
    OrderActionResponse,
    OrdersResponse,
    PlaceBasketOrderRequest,
    PlaceOrderRequest,
)
from app.services import gtt_store, live_basket_store
from app.services.session_manager import session_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/orders", tags=["Orders"])


def _gtt_response(record: Any) -> GttOrderResponse:
    return GttOrderResponse(
        id=record.id,
        broker_name=record.broker_name,
        symbol=record.symbol,
        side=record.side,
        quantity=record.quantity,
        product_type=record.product_type,
        execution_type=record.execution_type,
        trigger_price=record.trigger_price,
        limit_price=record.limit_price,
        expires_at=record.expires_at,
        status=record.status,
        native_order_id=record.native_order_id,
        execution_order_id=record.execution_order_id,
        error_message=record.error_message,
        created_at=record.created_at,
        triggered_at=record.triggered_at,
        closed_at=record.closed_at,
    )


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


@router.get("/gtt", response_model=GttOrdersResponse)
async def get_gtt_orders(
    current_user: dict[str, Any] = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> GttOrdersResponse:
    return GttOrdersResponse(
        orders=[
            _gtt_response(record)
            for record in await gtt_store.list_for_owner(db, current_user["sub"])
        ]
    )


@router.post("/gtt", response_model=GttOrderResponse, status_code=status.HTTP_201_CREATED)
async def create_gtt_order(
    request: CreateGttOrderRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GttOrderResponse:
    service = _live_execution_service(current_user)
    try:
        quotes = await service.get_quotes([request.symbol])
        ltp = float(quotes[0].get("last_price", 0)) if quotes else 0
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"Could not verify GTT trigger price: {exc}"
        ) from exc
    if (
        ltp <= 0
        or (request.side == "Buy" and request.trigger_price <= ltp)
        or (request.side == "Sell" and request.trigger_price >= ltp)
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Buy GTT trigger must be above current LTP; "
                "Sell GTT trigger must be below current LTP"
            ),
        )
    broker_name = service.__class__.__name__.removesuffix("Service")
    record = await gtt_store.create(
        db,
        owner_id=current_user["sub"],
        broker_name=broker_name,
        values={
            "symbol": request.symbol,
            "side": request.side,
            "quantity": request.quantity,
            "product_type": request.product_type,
            "execution_type": request.execution_type,
            "trigger_price": request.trigger_price,
            "limit_price": request.limit_price,
            "expires_at": request.expires_at,
        },
    )
    if broker_name.lower() == "dhan" and hasattr(service, "place_gtt_order"):
        try:
            native = await service.place_gtt_order(request.model_dump())
            record.native_order_id = native.get("id")
            await db.commit()
        except Exception as exc:
            await gtt_store.finish(db, record, "Failed", error=str(exc)[:500])
    return _gtt_response(record)


@router.delete("/gtt/{gtt_id}", response_model=GttOrderResponse)
async def cancel_gtt_order(
    gtt_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GttOrderResponse:
    records = await gtt_store.list_for_owner(db, current_user["sub"])
    record = next((item for item in records if item.id == gtt_id), None)
    if record is None:
        raise HTTPException(status_code=404, detail="GTT order not found")
    if record.status != "Pending":
        raise HTTPException(status_code=409, detail="Only pending GTT orders can be cancelled")
    service = _live_execution_service(current_user)
    if (
        record.broker_name.lower() == "dhan"
        and record.native_order_id
        and hasattr(service, "cancel_gtt_order")
    ):
        await service.cancel_gtt_order(record.native_order_id)
    await gtt_store.finish(db, record, "Cancelled")
    return _gtt_response(record)


@router.post("", response_model=OrderActionResponse, status_code=status.HTTP_201_CREATED)
async def place_order(
    request: PlaceOrderRequest, current_user: dict[str, Any] = Depends(get_current_user)
) -> OrderActionResponse:
    service = _live_execution_service(current_user)
    result = await service.place_order(request.model_dump())
    logger.info(
        "Live order submitted for client=%s symbol=%s order_id=%s",
        current_user["sub"],
        request.symbol,
        result.get("id"),
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


@router.post("/basket", response_model=BasketOrderResponse, status_code=status.HTTP_201_CREATED)
async def place_basket_order(
    request: PlaceBasketOrderRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BasketOrderResponse:
    """Submit every leg as one basket and persist it for fill reconciliation.

    Stops are deliberately armed only after the monitor observes a broker
    fill.  An accepted order id is not evidence of a fill (especially for a
    partial order), and placing an opposite STOP before then can open an
    unwanted position.

    Partial failures are intentional: legs are reported individually rather
    than raising, since an earlier leg may have already reached the
    exchange by the time a later one fails.
    """
    service = _live_execution_service(current_user)

    # Fyers executes basket legs in the supplied order. Put protective/debit
    # buys first so a matching sell can receive the broker's spread-margin
    # benefit instead of briefly being evaluated as an uncovered short.
    ordered_legs = sorted(request.legs, key=lambda leg: 0 if leg.side == "Buy" else 1)
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
        for leg in ordered_legs
    ]
    entry_results = await service.place_basket_orders(entry_orders)

    persisted_legs: list[dict[str, Any]] = []
    leg_results: list[BasketLegResult] = []
    for leg, result in zip(ordered_legs, entry_results, strict=True):
        submitted = result.get("id") is not None
        persisted_legs.append(
            {
                "symbol": leg.symbol,
                "quantity": 0,
                "requested_quantity": leg.quantity,
                "side": leg.side,
                "entry_order_id": result.get("id"),
                "entry_price": 0.0,
                "product_type": leg.product_type,
                "stop_loss": leg.stop_loss,
                "target_price": leg.target_price,
                "target": leg.take_profit,
                "protective_stop_order_id": None,
                "status": "PendingEntry" if submitted else "Failed",
                "exit_price": None,
                "close_reason": None,
            }
        )
        leg_results.append(
            BasketLegResult(
                symbol=leg.symbol,
                id=result.get("id"),
                message=result.get("message", ""),
                status="PendingEntry" if submitted else "Failed",
            )
        )

    basket_id = None
    if any(leg["status"] == "PendingEntry" for leg in persisted_legs):
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
            basket_id,
            current_user["sub"],
            sum(1 for leg in persisted_legs if leg["status"] == "PendingEntry"),
            len(persisted_legs),
        )

    return BasketOrderResponse(basket_id=basket_id, legs=leg_results)
