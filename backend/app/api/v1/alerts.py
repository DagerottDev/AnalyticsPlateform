"""Authenticated CRUD API for durable, server-evaluated alerts."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.core.crypto import decrypt_token, encrypt_token
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.alert import AlertRecord, AlertTriggerRecord
from app.models.alert_delivery import AlertDeliverySettingsRecord
from app.schemas.alert_delivery import AlertDeliverySettingsResponse, AlertDeliverySettingsUpdate
from app.schemas.alerts import AlertCreate, AlertResponse, AlertTriggerResponse
from app.schemas.market import Instrument

router = APIRouter(prefix="/alerts", tags=["Alerts"])


def _delivery_response(
    record: AlertDeliverySettingsRecord | None, settings: Settings
) -> AlertDeliverySettingsResponse:
    if record is None:
        return AlertDeliverySettingsResponse()
    return AlertDeliverySettingsResponse(
        email_enabled=record.email_enabled,
        email_recipient=record.email_recipient,
        webhook_enabled=record.webhook_enabled,
        webhook_url=decrypt_token(record.webhook_url, settings) if record.webhook_url else None,
        telegram_enabled=record.telegram_enabled,
        telegram_bot_token_configured=bool(record.telegram_bot_token),
        telegram_chat_id=record.telegram_chat_id,
        slack_enabled=record.slack_enabled,
        slack_webhook_url=decrypt_token(record.slack_webhook_url, settings)
        if record.slack_webhook_url
        else None,
    )


def _response(alert: AlertRecord) -> AlertResponse:
    return AlertResponse.model_validate(
        {
            "id": alert.id,
            "instrument": Instrument.model_validate(alert.instrument),
            "metric": alert.metric,
            "operator": alert.operator,
            "threshold": alert.threshold,
            "cooldown_minutes": alert.cooldown_minutes,
            "status": alert.status,
            "created_at": alert.created_at,
            "triggered_at": alert.triggered_at,
            "snoozed_until": alert.snoozed_until,
        }
    )


@router.get("", response_model=list[AlertResponse])
async def list_alerts(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AlertResponse]:
    statement = (
        select(AlertRecord)
        .where(AlertRecord.owner_id == current_user["sub"])
        .order_by(AlertRecord.created_at.desc())
    )
    records = (await db.scalars(statement)).all()
    return [_response(record) for record in records]


@router.post("", response_model=AlertResponse, status_code=status.HTTP_201_CREATED)
async def create_alert(
    request: AlertCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AlertResponse:
    trading_symbol = request.instrument.trading_symbol.strip()
    if not trading_symbol:
        raise HTTPException(status_code=422, detail="instrument.trading_symbol is required")
    record = AlertRecord(
        id=str(uuid4()),
        owner_id=current_user["sub"],
        instrument=request.instrument.model_dump(),
        trading_symbol=trading_symbol,
        metric=request.metric,
        operator=request.operator,
        threshold=request.threshold,
        cooldown_minutes=request.cooldown_minutes,
        status="Active",
        created_at=datetime.now(UTC),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return _response(record)


@router.get("/delivery-settings", response_model=AlertDeliverySettingsResponse)
async def get_delivery_settings(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AlertDeliverySettingsResponse:
    return _delivery_response(
        await db.get(AlertDeliverySettingsRecord, current_user["sub"]), settings
    )


@router.put("/delivery-settings", response_model=AlertDeliverySettingsResponse)
async def update_delivery_settings(
    request: AlertDeliverySettingsUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AlertDeliverySettingsResponse:
    record = await db.get(AlertDeliverySettingsRecord, current_user["sub"])
    if record is None:
        record = AlertDeliverySettingsRecord(
            owner_id=current_user["sub"], updated_at=datetime.now(UTC)
        )
        db.add(record)
    record.email_enabled, record.email_recipient = (
        request.email_enabled,
        str(request.email_recipient) if request.email_recipient else None,
    )
    record.webhook_enabled = request.webhook_enabled
    record.webhook_url = (
        encrypt_token(str(request.webhook_url), settings) if request.webhook_url else None
    )
    record.telegram_enabled, record.telegram_chat_id = (
        request.telegram_enabled,
        request.telegram_chat_id,
    )
    if request.telegram_bot_token:
        record.telegram_bot_token = encrypt_token(request.telegram_bot_token, settings)
    record.slack_enabled = request.slack_enabled
    record.slack_webhook_url = (
        encrypt_token(str(request.slack_webhook_url), settings)
        if request.slack_webhook_url
        else None
    )
    record.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(record)
    return _delivery_response(record, settings)


@router.get("/events", response_model=list[AlertTriggerResponse])
async def list_events(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AlertTriggerResponse]:
    statement = (
        select(AlertTriggerRecord)
        .where(AlertTriggerRecord.owner_id == current_user["sub"])
        .order_by(AlertTriggerRecord.triggered_at.desc())
        .limit(50)
    )
    records = (await db.scalars(statement)).all()
    return [AlertTriggerResponse.model_validate(record, from_attributes=True) for record in records]


@router.delete("/events", status_code=status.HTTP_204_NO_CONTENT)
async def clear_events(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await db.execute(
        delete(AlertTriggerRecord).where(AlertTriggerRecord.owner_id == current_user["sub"])
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(
    alert_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    record = await db.get(AlertRecord, alert_id)
    if record is None or record.owner_id != current_user["sub"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    await db.delete(record)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
