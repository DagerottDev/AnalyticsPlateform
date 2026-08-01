"""Validated request and response models for broker order execution."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

OrderSide = Literal["Buy", "Sell"]
OrderType = Literal["MARKET", "LIMIT", "STOP", "STOP_LIMIT"]
ProductType = Literal["INTRADAY", "CNC", "MARGIN"]


class _OrderPrices(BaseModel):
    order_type: OrderType
    limit_price: float = Field(default=0, ge=0)
    stop_price: float = Field(default=0, ge=0)

    @model_validator(mode="after")
    def validate_prices(self) -> "_OrderPrices":
        if self.order_type == "LIMIT" and self.limit_price <= 0:
            raise ValueError("limit_price is required for a limit order")
        if self.order_type == "STOP" and self.stop_price <= 0:
            raise ValueError("stop_price is required for a stop-market order")
        if self.order_type == "STOP_LIMIT" and (self.limit_price <= 0 or self.stop_price <= 0):
            raise ValueError("limit_price and stop_price are required for a stop-limit order")
        return self


class PlaceOrderRequest(_OrderPrices):
    """One explicitly confirmed Fyers order. The API never accepts raw Fyers payloads."""

    symbol: str = Field(min_length=3, max_length=80)
    quantity: int = Field(gt=0, le=1_000_000)
    side: OrderSide
    product_type: ProductType = "INTRADAY"
    validity: Literal["DAY", "IOC"] = "DAY"
    disclosed_quantity: int = Field(default=0, ge=0)
    offline_order: bool = False
    stop_loss: float = Field(default=0, ge=0)
    take_profit: float = Field(default=0, ge=0)
    order_tag: str | None = Field(default=None, max_length=20)


class ModifyOrderRequest(_OrderPrices):
    """Only the safe, broker-supported mutable fields for a pending order."""

    quantity: int = Field(gt=0, le=1_000_000)


class OrderActionResponse(BaseModel):
    id: str | None = None
    message: str


class BasketLegRequest(_OrderPrices):
    """One entry leg of a prospective basket order."""

    symbol: str = Field(min_length=3, max_length=80)
    quantity: int = Field(gt=0, le=1_000_000)
    side: OrderSide
    product_type: ProductType = "INTRADAY"
    validity: Literal["DAY", "IOC"] = "DAY"
    disclosed_quantity: int = Field(default=0, ge=0)
    offline_order: bool = False
    order_tag: str | None = Field(default=None, max_length=20)
    # Broker-enforced exchange stop order placed right after entry, opposite
    # side, at this trigger price — survives the app/server going down.
    stop_loss: float | None = Field(default=None, ge=0)
    # Watched by the basket monitor loop, not a resting broker order — only
    # protected while the backend job is running and connected.
    take_profit: float | None = Field(default=None, ge=0)


class PlaceBasketOrderRequest(BaseModel):
    """A basket of entry legs, each optionally carrying its own protective
    stop-loss/target, plus optional combined thresholds across the whole
    basket (also monitor-loop enforced, not broker-native)."""

    legs: list[BasketLegRequest] = Field(min_length=1, max_length=10)
    combined_stop_loss: float | None = Field(default=None, ge=0)
    combined_take_profit: float | None = Field(default=None, ge=0)


class BasketLegResult(BaseModel):
    symbol: str
    id: str | None = None
    message: str


class BasketOrderResponse(BaseModel):
    basket_id: str | None = None
    legs: list[BasketLegResult]


class BrokerOrder(BaseModel):
    id: str
    trading_symbol: str
    side: OrderSide
    order_type: OrderType
    product_type: str
    quantity: int
    filled_quantity: int = 0
    remaining_quantity: int = 0
    limit_price: float = 0
    stop_price: float = 0
    status: str
    status_message: str | None = None
    order_time: str | None = None


class OrdersResponse(BaseModel):
    orders: list[BrokerOrder]
