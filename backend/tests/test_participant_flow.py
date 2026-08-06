from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.nse_participant_snapshot import NseParticipantImportState, NseParticipantSnapshot
from app.services.nse_participant_provider import ParticipantReportRow
from app.services.nse_participant_store import NSE_PARTICIPANT_SOURCE, upsert_report


def _metrics(value: float) -> dict[str, float]:
    return {
        "future_index_long": value,
        "future_index_short": value / 2,
        "future_stock_long": 0,
        "future_stock_short": 0,
        "option_index_call_long": 0,
        "option_index_put_long": 0,
        "option_index_call_short": 0,
        "option_index_put_short": 0,
        "option_stock_call_long": 0,
        "option_stock_put_long": 0,
        "option_stock_call_short": 0,
        "option_stock_put_short": 0,
        "total_long": value,
        "total_short": value / 2,
    }


@pytest.mark.asyncio
async def test_upsert_report_updates_existing_daily_category(db_session: AsyncSession) -> None:
    row = ParticipantReportRow("FII_FPI", _metrics(100), _metrics(10))
    await upsert_report(db_session, trade_date=date(2026, 8, 3), rows=[row])
    await upsert_report(
        db_session,
        trade_date=date(2026, 8, 3),
        rows=[ParticipantReportRow("FII_FPI", _metrics(200), _metrics(20))],
    )

    snapshot = await db_session.get(NseParticipantSnapshot, (date(2026, 8, 3), "FII_FPI"))
    assert snapshot is not None
    assert snapshot.oi_total_long == 200
    assert snapshot.volume_total_long == 20


@pytest.mark.asyncio
async def test_participant_flow_uses_stored_data_without_broker_session(
    client, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    current_day = date.today() - timedelta(days=1)
    previous_day = current_day - timedelta(days=1)
    now = datetime.now(UTC)
    db_session.add(NseParticipantImportState(
        source=NSE_PARTICIPANT_SOURCE,
        last_successful_trade_date=current_day,
        last_success_at=now,
        last_attempt_at=now,
        backfill_target_start_date=previous_day,
        backfill_completed_at=now,
    ))
    for trade_date, value in [(previous_day, 100), (current_day, 130)]:
        await upsert_report(
            db_session,
            trade_date=trade_date,
            rows=[ParticipantReportRow("FII_FPI", _metrics(value), _metrics(value / 10))],
        )

    response = await client.get("/api/v1/participant-flow?days=7", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["latest_report_date"] == current_day.isoformat()
    assert payload["rows"][-1]["net_oi"] == 65
    assert payload["rows"][-1]["net_oi_change"] == 15


@pytest.mark.asyncio
async def test_participant_flow_marks_old_report_stale(
    client, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    old_day = date.today() - timedelta(days=10)
    db_session.add(NseParticipantImportState(
        source=NSE_PARTICIPANT_SOURCE,
        last_successful_trade_date=old_day,
        last_success_at=datetime.now(UTC) - timedelta(days=10),
        backfill_completed_at=datetime.now(UTC),
    ))
    await upsert_report(
        db_session,
        trade_date=old_day,
        rows=[ParticipantReportRow("CLIENT", _metrics(50), _metrics(5))],
    )

    response = await client.get("/api/v1/participant-flow", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["status"] == "stale"


@pytest.mark.asyncio
async def test_participant_flow_marks_failed_initial_import_unavailable(
    client, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    db_session.add(NseParticipantImportState(
        source=NSE_PARTICIPANT_SOURCE,
        last_error="NSE report has not been published yet",
    ))
    await db_session.commit()

    response = await client.get("/api/v1/participant-flow", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "unavailable"
    assert payload["last_error"] == "NSE report has not been published yet"


@pytest.mark.asyncio
async def test_participant_flow_validates_history_bound(
    client, auth_headers: dict[str, str]
) -> None:
    response = await client.get("/api/v1/participant-flow?days=367", headers=auth_headers)

    assert response.status_code == 422
