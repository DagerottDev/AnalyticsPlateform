from typing import Any

from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.schemas.greeks import (
    GreeksRequest,
    GreeksResponse,
    ImpliedVolatilityRequest,
    ImpliedVolatilityResponse,
    OptionPriceResponse,
)
from app.services.greeks import (
    calculate_greeks,
    calculate_implied_volatility,
    calculate_option_price,
)

router = APIRouter(prefix="/greeks", tags=["Greeks"])


@router.post("/price", response_model=OptionPriceResponse)
async def get_option_price(
    request: GreeksRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> OptionPriceResponse:
    """Black-Scholes theoretical price for a single option."""
    price = calculate_option_price(
        request.option_type,
        request.spot,
        request.strike,
        request.time_to_expiry,
        request.risk_free_rate,
        request.volatility,
    )
    return OptionPriceResponse(price=price)


@router.post("", response_model=GreeksResponse)
async def get_greeks(
    request: GreeksRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> GreeksResponse:
    """Full first/second/third-order Black-Scholes Greeks for a single option."""
    result = calculate_greeks(
        request.option_type,
        request.spot,
        request.strike,
        request.time_to_expiry,
        request.risk_free_rate,
        request.volatility,
    )
    return GreeksResponse(**result.__dict__)


@router.post("/implied-volatility", response_model=ImpliedVolatilityResponse)
async def get_implied_volatility(
    request: ImpliedVolatilityRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> ImpliedVolatilityResponse:
    """Implied volatility solved from an observed market price (Newton-Raphson,
    falling back to bisection when Newton-Raphson doesn't converge)."""
    iv = calculate_implied_volatility(
        request.option_type,
        request.spot,
        request.strike,
        request.time_to_expiry,
        request.risk_free_rate,
        request.market_price,
    )
    return ImpliedVolatilityResponse(implied_volatility=iv)
