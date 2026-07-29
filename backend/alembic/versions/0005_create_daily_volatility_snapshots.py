"""Create daily volatility snapshots table.

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-29 16:30:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "daily_volatility_snapshots",
        sa.Column("symbol", sa.String(length=50), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("atm_iv", sa.Float(), nullable=False),
        sa.Column("realized_volatility", sa.Float(), nullable=False),
        sa.Column("iv_rank", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("symbol", "snapshot_date"),
    )
    op.create_index(
        "ix_daily_volatility_snapshot_symbol_date",
        "daily_volatility_snapshots",
        ["symbol", "snapshot_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_daily_volatility_snapshot_symbol_date", table_name="daily_volatility_snapshots")
    op.drop_table("daily_volatility_snapshots")
