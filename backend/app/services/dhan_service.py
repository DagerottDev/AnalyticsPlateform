"""Dhan broker adapter.

This adapter uses Dhan's HTTP API directly rather than coupling the platform
to the optional ``dhanhq`` SDK.  A Dhan access token is short-lived, so the
caller supplies the Client ID and a currently valid access token at login.
"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any

import httpx

from app.core.exceptions import BrokerAuthError, BrokerConnectionError
from app.models.user import TradingMode, UserProfile
from app.services.broker_base import BrokerService


class DhanPollingMarketStream:
    """Broker-neutral quote polling stream used until Dhan's websocket is enabled.

    It exposes the same small surface used by ``/market/ws``. This keeps
    dashboards live without pretending that REST polling is a tick socket.
    """

    def __init__(
        self,
        quote_fetcher: Callable[[list[str]], Awaitable[list[dict[str, Any]]]],
        interval_seconds: float,
    ) -> None:
        self._quote_fetcher = quote_fetcher
        self._interval_seconds = interval_seconds
        self._listeners: set[Callable[[dict[str, Any]], None]] = set()
        self._symbols: set[str] = set()
        self._task: asyncio.Task[None] | None = None

    def bind_loop(self) -> None:
        if self._task is None:
            self._task = asyncio.get_running_loop().create_task(self._poll())

    def add_listener(self, listener: Callable[[dict[str, Any]], None]) -> None:
        self._listeners.add(listener)

    def remove_listener(self, listener: Callable[[dict[str, Any]], None]) -> None:
        self._listeners.discard(listener)

    def subscribe(self, symbols: list[str]) -> None:
        self._symbols.update(symbols)

    def unsubscribe(self, symbols: list[str]) -> None:
        self._symbols.difference_update(symbols)

    async def _poll(self) -> None:
        while True:
            await asyncio.sleep(self._interval_seconds)
            if not self._symbols:
                continue
            try:
                for quote in await self._quote_fetcher(list(self._symbols)):
                    for listener in list(self._listeners):
                        listener(quote)
            except Exception:
                # The REST endpoint is also called by the normal quote route;
                # transient failures should not take down browser websockets.
                continue

    def close(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None
        self._listeners.clear()
        self._symbols.clear()


class DhanService(BrokerService):
    """Concrete ``BrokerService`` implementation for Dhan."""

    _BASE_URL = "https://api.dhan.co/v2"
    # Dhan's LTP endpoint uses the public NIFTY index reference rather than
    # the exchange-qualified security references used by option contracts.
    _INDEX_QUOTE_REFS = {"NIFTY": ("IDX_I", "13")}
    _ORDER_TYPES = {
        "MARKET": "MARKET",
        "LIMIT": "LIMIT",
        "STOP": "STOP_LOSS",
        "STOP_LIMIT": "STOP_LOSS",
    }
    _PRODUCT_TYPES = {"INTRADAY": "INTRADAY", "CNC": "CNC", "MARGIN": "MTF"}

    def __init__(
        self,
        client_id: str,
        access_token: str,
        trading_mode: TradingMode = TradingMode.PAPER,
        account_name: str = "Default",
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(trading_mode, account_name)
        self.client_id = client_id
        self.access_token = access_token
        self._client = http_client or httpx.AsyncClient(base_url=self._BASE_URL, timeout=20.0)
        self._client.headers.update(
            {
                "access-token": access_token,
                "client-id": client_id,
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )
        self._owns_client = http_client is None
        self._market_stream: DhanPollingMarketStream | None = None

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = await self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise BrokerConnectionError(f"Dhan request failed: {exc}") from exc

        try:
            data = response.json()
        except ValueError:
            data = {"message": response.text}

        if response.status_code in {401, 403}:
            message = data.get("message") or data.get("remarks") or "Dhan access token is invalid"
            raise BrokerAuthError(str(message))
        if response.is_error:
            message = data.get("message") or data.get("remarks") or str(data)
            raise BrokerConnectionError(
                f"Dhan API request failed ({response.status_code}): {message}"
            )
        return data

    @staticmethod
    def _security_ref(value: str) -> tuple[str, str]:
        """Split Dhan's explicit ``EXCHANGE_SEGMENT:SECURITY_ID`` reference."""
        segment, separator, security_id = value.partition(":")
        if not separator or not segment or not security_id:
            raise BrokerConnectionError(
                "Dhan symbols must use EXCHANGE_SEGMENT:SECURITY_ID, " "for example NSE_EQ:11536."
            )
        return segment.upper(), security_id

    async def get_profile(self) -> UserProfile:
        # Dhan's v2 trading APIs authenticate with client ID + token but do
        # not expose the Fyers-style profile endpoint this app relies on.
        # A lightweight authenticated funds request validates credentials.
        await self.get_funds()
        return UserProfile(
            client_id=self.client_id,
            broker_name="Dhan",
            trading_mode=self.trading_mode,
            account_name=(
                self.account_name if self.account_name != "Default" else f"Dhan {self.client_id}"
            ),
        )

    async def get_instruments(self, symbol: str) -> list[dict[str, Any]]:
        # Dhan's v2 option-chain API is keyed by the underlying security id.
        # NIFTY's public IDX_I id is documented by Dhan; other underlyings
        # remain safely unavailable until their instrument-master mapping is
        # loaded rather than risking an order against a guessed security id.
        underlyings = {"NIFTY": (13, "IDX_I")}
        reference = underlyings.get(symbol.upper())
        if reference is None:
            return []
        underlying_id, underlying_segment = reference
        expiry_response = await self._request(
            "POST",
            "/optionchain/expirylist",
            json={"UnderlyingScrip": underlying_id, "UnderlyingSeg": underlying_segment},
        )
        expiry_values = expiry_response.get("data", [])
        instruments: list[dict[str, Any]] = []
        for raw_expiry in expiry_values:
            try:
                expiry = datetime.strptime(str(raw_expiry), "%Y-%m-%d").strftime("%d-%b-%Y")
            except ValueError:
                continue
            response = await self._request(
                "POST",
                "/optionchain",
                json={
                    "UnderlyingScrip": underlying_id,
                    "UnderlyingSeg": underlying_segment,
                    "Expiry": raw_expiry,
                },
            )
            chain = response.get("data", {}).get("oc", {})
            for raw_strike, row in chain.items():
                for option_key, option_type in (("ce", "CE"), ("pe", "PE")):
                    option = row.get(option_key) if isinstance(row, dict) else None
                    if not isinstance(option, dict) or not option.get("security_id"):
                        continue
                    security_id = str(option["security_id"])
                    instruments.append(
                        {
                            "trading_symbol": f"NSE_FNO:{security_id}",
                            "symbol": symbol.upper(),
                            "instrument_type": "OPTIDX",
                            "expiry": expiry,
                            "strike": float(raw_strike),
                            "option_type": option_type,
                            "exchange": "NFO",
                            "oi": option.get("oi"),
                            "oi_change": float(option.get("oi", 0) or 0)
                            - float(option.get("previous_oi", 0) or 0),
                            "oi_change_percent": None,
                            "lot_size": None,
                        }
                    )
        return instruments

    async def get_expiries(self, symbol: str) -> list[str]:
        reference = {"NIFTY": (13, "IDX_I")}.get(symbol.upper())
        if reference is None:
            return []
        response = await self._request(
            "POST",
            "/optionchain/expirylist",
            json={"UnderlyingScrip": reference[0], "UnderlyingSeg": reference[1]},
        )
        values: list[str] = []
        for raw_expiry in response.get("data", []):
            try:
                values.append(datetime.strptime(str(raw_expiry), "%Y-%m-%d").strftime("%d-%b-%Y"))
            except ValueError:
                continue
        return values

    async def get_quotes(self, symbols: list[str]) -> list[dict[str, Any]]:
        if not symbols:
            return []
        grouped: dict[str, list[int]] = {}
        names: dict[tuple[str, str], str] = {}
        for symbol in symbols:
            normalized_symbol = str(symbol).strip()
            if ":" in normalized_symbol:
                segment, security_id = self._security_ref(normalized_symbol)
                quote_name = normalized_symbol
            else:
                reference = self._INDEX_QUOTE_REFS.get(normalized_symbol.upper())
                if reference is None:
                    raise BrokerConnectionError(
                        "Dhan bare quote symbols are unsupported; use "
                        "EXCHANGE_SEGMENT:SECURITY_ID or a supported index alias."
                    )
                segment, security_id = reference
                quote_name = normalized_symbol.upper()
            try:
                grouped.setdefault(segment, []).append(int(security_id))
            except ValueError as exc:
                raise BrokerConnectionError(f"Invalid Dhan security ID: {security_id}") from exc
            names[(segment, security_id)] = quote_name

        data = await self._request("POST", "/marketfeed/ltp", json=grouped)
        rows: list[dict[str, Any]] = []
        for segment, values in data.get("data", data).items():
            if not isinstance(values, dict):
                continue
            for security_id, value in values.items():
                if not isinstance(value, dict):
                    continue
                ref = names.get((segment, str(security_id)), f"{segment}:{security_id}")
                ltp = value.get("last_price", value.get("lastTradedPrice", value.get("ltp", 0)))
                rows.append(
                    {
                        "symbol": ref,
                        # Keep the exact symbol requested by the UI. Dhan may
                        # return a display-only tradingSymbol for an option,
                        # but the websocket handler is keyed by this request
                        # symbol (for example NIFTY or NSE_FNO:26009).
                        "trading_symbol": ref,
                        "last_price": float(ltp or 0),
                        "volume": int(value.get("volume", 0) or 0),
                        "open_interest": int(value.get("oi", 0) or 0),
                        "change": float(value.get("change", 0) or 0),
                        "change_percent": float(value.get("changePercent", 0) or 0),
                        "open_price": float(value.get("open", 0) or 0),
                        "high_price": float(value.get("high", 0) or 0),
                        "low_price": float(value.get("low", 0) or 0),
                        "prev_close_price": float(value.get("close", 0) or 0),
                        "ask": float(value.get("ask", 0) or 0),
                        "bid": float(value.get("bid", 0) or 0),
                        "atp": float(value.get("avgPrice", 0) or 0),
                        "timestamp": int(value.get("timestamp", 0) or 0),
                    }
                )
        return rows

    async def get_historical_data(
        self, symbol: str, from_date: str, to_date: str, resolution: str
    ) -> list[dict[str, Any]]:
        segment, security_id = self._security_ref(symbol)
        data = await self._request(
            "POST",
            "/charts/historical",
            json={
                "securityId": security_id,
                "exchangeSegment": segment,
                "instrument": "INDEX" if "IDX" in segment else "EQUITY",
                "expiryCode": 0,
                "fromDate": from_date,
                "toDate": to_date,
            },
        )
        timestamps = data.get("timestamp", [])
        return [
            {
                "timestamp": timestamp,
                "open": data.get("open", [])[index],
                "high": data.get("high", [])[index],
                "low": data.get("low", [])[index],
                "close": data.get("close", [])[index],
                "volume": data.get("volume", [0] * len(timestamps))[index],
            }
            for index, timestamp in enumerate(timestamps)
        ]

    async def get_margin(self, orders: list[dict[str, Any]]) -> dict[str, Any]:
        """Calculate the combined requirement for prospective Dhan orders.

        Dhan's multi-order calculator evaluates the whole basket, which is
        essential for a hedged option position: calculating legs separately
        would hide the broker's hedge benefit.
        """
        if not orders:
            return {}

        scrip_list: list[dict[str, Any]] = []
        for order in orders:
            segment, security_id = self._security_ref(str(order["symbol"]))
            product_type = str(order.get("product_type") or "INTRADAY").upper()
            scrip_list.append(
                {
                    "exchangeSegment": segment,
                    "transactionType": str(order["side"]).upper(),
                    "quantity": abs(int(order["quantity"])),
                    "productType": self._PRODUCT_TYPES.get(product_type, product_type),
                    "securityId": security_id,
                    "price": float(order.get("limit_price") or 0),
                    "triggerPrice": float(order.get("stop_price") or 0),
                }
            )

        data = await self._request(
            "POST",
            "/margincalculator/multi",
            json={
                "dhanClientId": self.client_id,
                "includePosition": True,
                "includeOrder": True,
                "scripList": scrip_list,
            },
        )
        if not isinstance(data, dict):
            raise BrokerConnectionError("Dhan margin calculator returned an invalid response")
        return data

    async def get_positions(self) -> list[dict[str, Any]]:
        data = await self._request("GET", "/positions")
        rows = data if isinstance(data, list) else data.get("data", data.get("positions", []))
        positions: list[dict[str, Any]] = []
        for row in rows:
            quantity = float(row.get("netQty", 0) or 0)
            realized = float(row.get("realizedProfit", 0) or 0)
            unrealized = float(row.get("unrealizedProfit", 0) or 0)
            positions.append(
                {
                    "trading_symbol": str(row.get("tradingSymbol", row.get("securityId", ""))),
                    "symbol": f"{row.get('exchangeSegment', '')}:{row.get('securityId', '')}",
                    "product_type": str(row.get("productType", "")),
                    "quantity": quantity,
                    "side": "Buy" if quantity > 0 else "Sell" if quantity < 0 else "Flat",
                    "avg_price": float(row.get("netAvg", 0) or 0),
                    "last_price": float(row.get("ltp", 0) or 0),
                    "realized_pnl": realized,
                    "unrealized_pnl": unrealized,
                    "pnl": realized + unrealized,
                }
            )
        return positions

    async def get_holdings(self) -> list[dict[str, Any]]:
        data = await self._request("GET", "/holdings")
        rows = data if isinstance(data, list) else data.get("data", data.get("holdings", []))
        return [
            {
                "trading_symbol": str(row.get("tradingSymbol", row.get("securityId", ""))),
                "symbol": f"{row.get('exchangeSegment', '')}:{row.get('securityId', '')}",
                "holding_type": str(row.get("holdingType", "CNC")),
                "quantity": float(row.get("totalQty", row.get("quantity", 0)) or 0),
                "avg_price": float(row.get("avgCostPrice", row.get("avgPrice", 0)) or 0),
                "last_price": float(row.get("ltp", 0) or 0),
                "market_value": float(row.get("marketValue", 0) or 0),
                "pnl": float(row.get("unrealizedProfit", row.get("profit", 0)) or 0),
            }
            for row in rows
        ]

    async def get_funds(self) -> dict[str, Any]:
        data = await self._request("GET", "/fundlimit")
        raw = data if isinstance(data, list) else data.get("data", data)
        return {"fund_limit": raw if isinstance(raw, list) else [raw]}

    def _normalise_order(self, row: dict[str, Any]) -> dict[str, Any]:
        quantity = int(row.get("quantity", 0) or 0)
        filled = int(row.get("filledQty", row.get("filledQuantity", 0)) or 0)
        order_type = str(row.get("orderType", "MARKET")).upper()
        return {
            "id": str(row.get("orderId", "")),
            "trading_symbol": str(row.get("tradingSymbol", row.get("securityId", ""))),
            "side": "Buy" if str(row.get("transactionType", "BUY")).upper() == "BUY" else "Sell",
            "order_type": "STOP" if order_type == "STOP_LOSS" else order_type,
            "product_type": str(row.get("productType", "")),
            "quantity": quantity,
            "filled_quantity": filled,
            "remaining_quantity": int(row.get("remainingQuantity", max(quantity - filled, 0)) or 0),
            "average_price": float(row.get("averageTradedPrice", row.get("averagePrice", 0)) or 0),
            "limit_price": float(row.get("price", 0) or 0),
            "stop_price": float(row.get("triggerPrice", 0) or 0),
            "status": str(row.get("orderStatus", "Unknown")),
            "status_message": row.get("remarks"),
            "order_time": row.get("createTime"),
        }

    async def get_orders(self) -> list[dict[str, Any]]:
        data = await self._request("GET", "/orders")
        rows = data if isinstance(data, list) else data.get("data", data.get("orders", []))
        return [order for row in rows if (order := self._normalise_order(row))["id"]]

    async def place_order(self, order: dict[str, Any]) -> dict[str, Any]:
        segment, security_id = self._security_ref(order["symbol"])
        payload = {
            "securityId": security_id,
            "exchangeSegment": segment,
            "transactionType": "BUY" if order["side"] == "Buy" else "SELL",
            "quantity": order["quantity"],
            "orderType": self._ORDER_TYPES[order["order_type"]],
            "productType": self._PRODUCT_TYPES[order["product_type"]],
            "price": order["limit_price"],
            "triggerPrice": order["stop_price"],
            "validity": order["validity"],
            "disclosedQuantity": order["disclosed_quantity"],
            "afterMarketOrder": order["offline_order"],
            "boProfitValue": order["take_profit"],
            "boStopLossValue": order["stop_loss"],
        }
        data = await self._request("POST", "/orders", json=payload)
        return {
            "id": str(data.get("orderId", "")) or None,
            "message": str(data.get("remarks", "Order submitted")),
        }

    async def place_gtt_order(self, order: dict[str, Any]) -> dict[str, Any]:
        """Create Dhan's native SINGLE Forever Order (their GTT primitive)."""
        segment, security_id = self._security_ref(order["symbol"])
        data = await self._request(
            "POST",
            "/forever/orders",
            json={
                "dhanClientId": self.client_id,
                "correlationId": f"gtt-{security_id}"[:30],
                "orderFlag": "SINGLE",
                "transactionType": "BUY" if order["side"] == "Buy" else "SELL",
                "exchangeSegment": segment,
                "productType": self._PRODUCT_TYPES[order["product_type"]],
                "orderType": order["execution_type"],
                "validity": "DAY",
                "securityId": security_id,
                "quantity": order["quantity"],
                "disclosedQuantity": 0,
                "price": order["limit_price"],
                "triggerPrice": order["trigger_price"],
            },
        )
        return {
            "id": str(data.get("orderId", "")) or None,
            "message": str(data.get("remarks", "GTT submitted")),
        }

    async def cancel_gtt_order(self, order_id: str) -> dict[str, Any]:
        data = await self._request("DELETE", f"/forever/orders/{order_id}")
        return {"id": order_id, "message": str(data.get("remarks", "GTT cancelled"))}

    async def place_basket_orders(self, orders: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Dhan's v2 API has no bulk-placement endpoint, so each leg is
        submitted one at a time. This is sequential and non-atomic — unlike
        Fyers' single-call basket endpoint, a later leg's request only
        happens after the previous one's response, and one leg failing
        doesn't prevent the rest from being tried."""
        results: list[dict[str, Any]] = []
        for order in orders:
            try:
                results.append(await self.place_order(order))
            except Exception as e:
                results.append({"id": None, "message": f"Leg failed: {e}"})
        return results

    async def modify_order(self, order_id: str, order: dict[str, Any]) -> dict[str, Any]:
        data = await self._request(
            "PUT",
            f"/orders/{order_id}",
            json={
                "quantity": order["quantity"],
                "orderType": self._ORDER_TYPES[order["order_type"]],
                "price": order["limit_price"],
                "triggerPrice": order["stop_price"],
                "validity": "DAY",
            },
        )
        return {"id": order_id, "message": str(data.get("remarks", "Order modified"))}

    async def cancel_order(self, order_id: str) -> dict[str, Any]:
        data = await self._request("DELETE", f"/orders/{order_id}")
        return {"id": order_id, "message": str(data.get("remarks", "Order cancelled"))}

    def get_market_stream(
        self, quote_poll_interval_seconds: float = 3.0
    ) -> DhanPollingMarketStream:
        if self._market_stream is None:
            self._market_stream = DhanPollingMarketStream(
                self.get_quotes, quote_poll_interval_seconds
            )
        return self._market_stream

    async def close(self) -> None:
        if self._market_stream is not None:
            self._market_stream.close()
            self._market_stream = None
        if self._owns_client:
            await self._client.aclose()
