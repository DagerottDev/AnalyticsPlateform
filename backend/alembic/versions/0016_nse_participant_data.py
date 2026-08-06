"""Create NSE F&O participant OI and trading-volume snapshots.

Revision ID: 0016_nse_participant_data
Revises: 0015_open_interest_snapshots
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_nse_participant_data"
down_revision: str | None = "0015_open_interest_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_METRICS = (
    "future_index_long", "future_index_short", "future_stock_long", "future_stock_short",
    "option_index_call_long", "option_index_put_long", "option_index_call_short",
    "option_index_put_short", "option_stock_call_long", "option_stock_put_long",
    "option_stock_call_short", "option_stock_put_short", "total_long", "total_short",
)


def upgrade() -> None:
    columns: list[sa.Column[object]] = [
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("participant_type", sa.String(length=16), nullable=False),
    ]
    columns.extend(sa.Column(f"oi_{metric}", sa.Float(), nullable=False) for metric in _METRICS)
    columns.extend(sa.Column(f"volume_{metric}", sa.Float(), nullable=False) for metric in _METRICS)
    columns.append(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    columns.append(sa.PrimaryKeyConstraint("trade_date", "participant_type"))
    op.create_table("nse_participant_snapshots", *columns)
    op.create_index(
        "ix_nse_participant_snapshot_trade_date",
        "nse_participant_snapshots",
        ["trade_date"],
    )
    op.create_table(
        "nse_participant_import_state",
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("last_successful_trade_date", sa.Date(), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("backfill_target_start_date", sa.Date(), nullable=True),
        sa.Column("backfill_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("source"),
    )


def downgrade() -> None:
    op.drop_table("nse_participant_import_state")
    op.drop_index("ix_nse_participant_snapshot_trade_date", table_name="nse_participant_snapshots")
    op.drop_table("nse_participant_snapshots")
