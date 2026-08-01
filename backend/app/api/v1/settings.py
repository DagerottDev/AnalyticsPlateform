"""Authenticated, server-backed user preference profile endpoints."""

from datetime import UTC, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user_preferences import UserPreferencesRecord
from app.schemas.user_preferences import UserPreferences, UserPreferencesResponse

router = APIRouter(prefix="/settings", tags=["Settings"])


def _response(record: UserPreferencesRecord | None) -> UserPreferencesResponse:
    if record is None:
        return UserPreferencesResponse()
    profile = UserPreferences.model_validate(record.settings)
    return UserPreferencesResponse(
        **profile.model_dump(), persisted=True, updated_at=record.updated_at
    )


@router.get("", response_model=UserPreferencesResponse)
async def get_preferences(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserPreferencesResponse:
    return _response(await db.get(UserPreferencesRecord, current_user["sub"]))


@router.put("", response_model=UserPreferencesResponse)
async def replace_preferences(
    request: UserPreferences,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserPreferencesResponse:
    owner_id = current_user["sub"]
    record = await db.get(UserPreferencesRecord, owner_id)
    now = datetime.now(UTC)
    settings = cast(dict[str, object], request.model_dump(mode="json"))
    if record is None:
        record = UserPreferencesRecord(
            owner_id=owner_id,
            schema_version=request.schema_version,
            settings=settings,
            updated_at=now,
        )
        db.add(record)
    else:
        record.schema_version = request.schema_version
        record.settings = settings
        record.updated_at = now
    await db.commit()
    await db.refresh(record)
    return _response(record)


@router.delete("", response_model=UserPreferencesResponse)
async def reset_preferences(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserPreferencesResponse:
    record = await db.get(UserPreferencesRecord, current_user["sub"])
    if record is not None:
        await db.delete(record)
        await db.commit()
    return UserPreferencesResponse()
