from typing import Literal

from pydantic import BaseModel, Field

from app.services.option_math import DEFAULT_RISK_FREE_RATE


class GreeksRequest(BaseModel):
    option_type: Literal["CE", "PE"]
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    time_to_expiry: float = Field(..., gt=0, description="Years to expiry")
    volatility: float = Field(..., ge=0, description="Decimal, e.g. 0.15 for 15%")
    risk_free_rate: float = DEFAULT_RISK_FREE_RATE


class OptionPriceResponse(BaseModel):
    price: float


class GreeksResponse(BaseModel):
    price: float
    delta: float
    gamma: float
    theta: float
    vega: float
    rho: float
    vanna: float
    vomma: float
    charm: float
    speed: float
    color: float
    zomma: float
    ultima: float


class ImpliedVolatilityRequest(BaseModel):
    option_type: Literal["CE", "PE"]
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    time_to_expiry: float = Field(..., gt=0, description="Years to expiry")
    market_price: float = Field(..., ge=0)
    risk_free_rate: float = DEFAULT_RISK_FREE_RATE


class ImpliedVolatilityResponse(BaseModel):
    implied_volatility: float
