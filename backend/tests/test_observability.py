"""Request-correlation and structured logging tests."""

import json
import logging

import pytest
from httpx import AsyncClient

from app.core.observability import JsonFormatter, request_id_context


@pytest.mark.asyncio
async def test_request_id_is_echoed_on_api_responses(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health", headers={"X-Request-ID": "trace-123"})
    assert response.status_code == 200
    assert response.headers["x-request-id"] == "trace-123"


def test_json_logs_include_active_request_id() -> None:
    token = request_id_context.set("trace-456")
    try:
        record = logging.LogRecord("test.logger", logging.INFO, "", 0, "hello %s", ("world",), None)
        payload = json.loads(JsonFormatter().format(record))
    finally:
        request_id_context.reset(token)
    assert payload["message"] == "hello world"
    assert payload["request_id"] == "trace-456"
