"""Contract tests for the Dhan BrokerService adapter."""

import json

import httpx
import pytest

from app.models.user import TradingMode
from app.services.dhan_service import DhanService


@pytest.mark.asyncio
async def test_dhan_profile_validates_through_funds() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["access-token"] == "dhan-token"
        assert request.headers["client-id"] == "1100000001"
        assert request.url.path == "/v2/fundlimit"
        return httpx.Response(200, json={"availabelBalance": 1000})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", TradingMode.PAPER, http_client=client)
    profile = await service.get_profile()

    assert profile.client_id == "1100000001"
    assert profile.broker_name == "Dhan"
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_orders_are_normalized_and_placed_with_security_reference() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(
                200,
                json=[
                    {
                        "orderId": "123",
                        "tradingSymbol": "RELIANCE",
                        "transactionType": "BUY",
                        "orderType": "LIMIT",
                        "productType": "CNC",
                        "quantity": 2,
                        "filledQty": 1,
                        "price": 1500,
                        "orderStatus": "PENDING",
                    }
                ],
            )
        return httpx.Response(200, json={"orderId": "456", "remarks": "Order placed"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    orders = await service.get_orders()
    result = await service.place_order(
        {
            "symbol": "NSE_EQ:2885",
            "quantity": 2,
            "side": "Buy",
            "order_type": "LIMIT",
            "product_type": "CNC",
            "limit_price": 1500,
            "stop_price": 0,
            "validity": "DAY",
            "disclosed_quantity": 0,
            "offline_order": False,
            "take_profit": 0,
            "stop_loss": 0,
        }
    )

    assert orders[0]["id"] == "123"
    assert orders[0]["side"] == "Buy"
    assert result == {"id": "456", "message": "Order placed"}
    payload = json.loads(requests[1].content)
    assert payload["exchangeSegment"] == "NSE_EQ"
    assert payload["securityId"] == "2885"
    assert payload["transactionType"] == "BUY"
    await client.aclose()


def _leg(symbol: str = "NSE_EQ:2885") -> dict:
    return {
        "symbol": symbol,
        "quantity": 1,
        "side": "Buy",
        "order_type": "MARKET",
        "product_type": "INTRADAY",
        "limit_price": 0,
        "stop_price": 0,
        "validity": "DAY",
        "disclosed_quantity": 0,
        "offline_order": False,
        "take_profit": 0,
        "stop_loss": 0,
    }


@pytest.mark.asyncio
async def test_dhan_basket_orders_are_placed_sequentially_with_per_leg_isolation() -> None:
    """Dhan has no bulk endpoint, so each leg is its own request; one leg
    failing must not stop the rest, and results stay 1:1 with the input."""
    call_count = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            return httpx.Response(400, json={"remarks": "RMS:Insufficient funds"})
        return httpx.Response(200, json={"orderId": f"leg-{call_count}", "remarks": "Order placed"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    results = await service.place_basket_orders(
        [_leg("NSE_EQ:1"), _leg("NSE_EQ:2"), _leg("NSE_EQ:3")]
    )

    assert call_count == 3
    assert results[0]["id"] == "leg-1"
    assert results[1]["id"] is None
    assert "RMS" in results[1]["message"]
    assert results[2]["id"] == "leg-3"
    await client.aclose()
