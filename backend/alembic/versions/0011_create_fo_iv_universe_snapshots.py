"""Create F&O IV universe snapshots table.

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-01 00:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "fo_iv_universe_snapshots",
        sa.Column("symbol", sa.String(length=50), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("atm_iv", sa.Float(), nullable=False),
        sa.Column("spot", sa.Float(), nullable=True),
        sa.Column("iv_rank", sa.Float(), nullable=True),
        sa.Column("iv_percentile", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("symbol", "snapshot_date"),
    )
    op.create_index(
        "ix_fo_iv_universe_snapshot_symbol_date",
        "fo_iv_universe_snapshots",
        ["symbol", "snapshot_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_fo_iv_universe_snapshot_symbol_date", table_name="fo_iv_universe_snapshots"
    )
    op.drop_table("fo_iv_universe_snapshots")
