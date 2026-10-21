"""Exercise the real locally patched SDK with mocked network transports."""

import json
from importlib.metadata import version
from importlib.resources import files
from pathlib import Path
from unittest.mock import Mock

import pytest
from fyers_apiv3 import fyersModel
from fyers_apiv3.FyersWebsocket import data_ws, order_ws


def test_sdk_resources_and_version(tmp_path: Path) -> None:
    assert version("fyers-apiv3") == "3.1.14+oap.1"
    mapping = json.loads(files("fyers_apiv3.FyersWebsocket").joinpath("map.json").read_text())
    assert "data_val" in mapping and "position_mapper" in mapping
    for name in ("data_ws.py", "order_ws.py", "tbt_ws.py"):
        assert "pkg_resources" not in files("fyers_apiv3.FyersWebsocket").joinpath(name).read_text()
    market_socket = data_ws.FyersDataSocket(access_token="fixture-token", log_path=str(tmp_path))
    assert market_socket.data_val == mapping["data_val"]
    order_socket = order_ws.FyersOrderSocket(access_token="fixture-token", log_path=str(tmp_path))
    assert order_socket.position_mapper == mapping["position_mapper"]


def test_sdk_sync_rest_and_oauth_use_patched_requests(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    response = Mock(status_code=200)
    response.json.return_value = {"s": "ok", "access_token": "fixture-token"}
    session = Mock()
    session.get.return_value = response
    session.post.return_value = response
    monkeypatch.setattr(fyersModel.requests, "Session", lambda: session)
    model = fyersModel.FyersModel(
        client_id="fixture-app", token="fixture-token", log_path=str(tmp_path)
    )
    assert model.get_profile()["s"] == "ok"
    assert model.place_order({"symbol": "fixture"})["s"] == "ok"
    assert session.get.call_args.kwargs["headers"]["Authorization"] == "fixture-app:fixture-token"

    post = Mock(return_value=response)
    monkeypatch.setattr(fyersModel.requests, "post", post)
    oauth = fyersModel.SessionModel(
        client_id="fixture-app",
        secret_key="fixture-secret",
        redirect_uri="https://example.com",
        response_type="code",
        grant_type="authorization_code",
    )
    oauth.set_token("fixture-code")
    assert oauth.generate_token()["access_token"] == "fixture-token"
    assert post.call_args.kwargs["json"]["code"] == "fixture-code"


@pytest.mark.asyncio
async def test_sdk_async_rest_with_current_aiohttp(tmp_path: Path) -> None:
    import aiohttp
    from aiohttp.test_utils import TestServer
    from aiohttp.web import Application, Response

    async def reply(request):
        return Response(text='{"s":"ok"}', content_type="application/json")

    app = Application()
    app.router.add_get("/api/v3/profile", reply)
    async with TestServer(app) as server:
        model = fyersModel.FyersModel(
            is_async=True, client_id="fixture-app", token="fixture-token", log_path=str(tmp_path)
        )
        async with aiohttp.ClientSession() as session:
            model.service.session = session
            # Only the destination changes; the real SDK and aiohttp parse the response.
            original = fyersModel.Config.API
            try:
                fyersModel.Config.API = str(server.make_url("/api/v3"))
                assert (await model.get_profile())["s"] == "ok"
            finally:
                fyersModel.Config.API = original
