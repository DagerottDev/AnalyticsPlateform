"""Create durable server-side alert tables.

Revision ID: 0006
Revises: 0005
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("alerts", sa.Column("id", sa.String(36), primary_key=True), sa.Column("owner_id", sa.String(50), nullable=False), sa.Column("instrument", sa.JSON(), nullable=False), sa.Column("trading_symbol", sa.String(100), nullable=False), sa.Column("metric", sa.String(30), nullable=False), sa.Column("operator", sa.String(2), nullable=False), sa.Column("threshold", sa.Float(), nullable=False), sa.Column("cooldown_minutes", sa.Integer(), nullable=False), sa.Column("status", sa.String(10), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("triggered_at", sa.DateTime(timezone=True)), sa.Column("snoozed_until", sa.DateTime(timezone=True)))
    op.create_index("ix_alerts_owner_id", "alerts", ["owner_id"])
    op.create_index("ix_alerts_trading_symbol", "alerts", ["trading_symbol"])
    op.create_index("ix_alerts_owner_status", "alerts", ["owner_id", "status"])
    op.create_table("alert_trigger_events", sa.Column("id", sa.String(36), primary_key=True), sa.Column("owner_id", sa.String(50), nullable=False), sa.Column("alert_id", sa.String(36), nullable=False), sa.Column("trading_symbol", sa.String(100), nullable=False), sa.Column("metric", sa.String(30), nullable=False), sa.Column("operator", sa.String(2), nullable=False), sa.Column("threshold", sa.Float(), nullable=False), sa.Column("value", sa.Float(), nullable=False), sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_alert_trigger_events_owner_id", "alert_trigger_events", ["owner_id"])
    op.create_index("ix_alert_trigger_events_alert_id", "alert_trigger_events", ["alert_id"])
    op.create_index("ix_alert_trigger_events_triggered_at", "alert_trigger_events", ["triggered_at"])
    op.create_index("ix_alert_events_owner_time", "alert_trigger_events", ["owner_id", "triggered_at"])


def downgrade() -> None:
    op.drop_table("alert_trigger_events")
    op.drop_table("alerts")
