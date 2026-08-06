"""Read-only, broker-independent NSE F&O participant-positioning API."""

from datetime import UTC, date, datetime, timedelta
from typing import cast

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.schemas.participant_flow import (
    ParticipantDataStatus,
    ParticipantFlowResponse,
    ParticipantFlowRow,
    ParticipantMetrics,
    ParticipantType,
)
from app.services.nse_participant_store import get_import_state, load_rows

router = APIRouter(prefix="/participant-flow", tags=["Participant Flow"])
_STALE_AFTER = timedelta(days=5)


def _metrics(snapshot: object, prefix: str) -> ParticipantMetrics:
    return ParticipantMetrics(
        **{
            field_name: float(getattr(snapshot, f"{prefix}_{field_name}"))
            for field_name in ParticipantMetrics.model_fields
        }
    )


@router.get("", response_model=ParticipantFlowResponse)
async def get_participant_flow(
    days: int = Query(default=90, ge=1, le=366),
    _current_user: dict[str, object] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ParticipantFlowResponse:
    """Return stored NSE reports only; no broker session or broker call is required."""
    state = await get_import_state(db)
    latest_report_date = state.last_successful_trade_date if state is not None else None
    start = (latest_report_date or date.today()) - timedelta(days=days - 1)
    snapshots = await load_rows(db, start=start)
    previous_by_participant: dict[str, float] = {}
    rows: list[ParticipantFlowRow] = []
    for snapshot in snapshots:
        net_oi = snapshot.oi_total_long - snapshot.oi_total_short
        previous = previous_by_participant.get(snapshot.participant_type)
        rows.append(
            ParticipantFlowRow(
                trade_date=snapshot.trade_date,
                participant_type=cast(ParticipantType, snapshot.participant_type),
                oi=_metrics(snapshot, "oi"),
                volume=_metrics(snapshot, "volume"),
                net_oi=net_oi,
                net_oi_change=None if previous is None else net_oi - previous,
            )
        )
        previous_by_participant[snapshot.participant_type] = net_oi

    now = datetime.now(UTC)
    if not rows:
        status: ParticipantDataStatus = (
            "unavailable" if state is not None and state.last_error else "backfilling"
        )
    elif state is not None and state.backfill_completed_at is None:
        status = "backfilling"
    elif latest_report_date is not None and now.date() - latest_report_date > _STALE_AFTER:
        status = "stale"
    else:
        status = "ready"
    return ParticipantFlowResponse(
        status=status,
        latest_report_date=latest_report_date,
        last_success_at=state.last_success_at if state is not None else None,
        last_attempt_at=state.last_attempt_at if state is not None else None,
        history_start_date=rows[0].trade_date if rows else None,
        backfill_target_start_date=state.backfill_target_start_date if state else None,
        backfill_completed_at=state.backfill_completed_at if state else None,
        last_error=state.last_error if state else None,
        rows=rows,
    )
