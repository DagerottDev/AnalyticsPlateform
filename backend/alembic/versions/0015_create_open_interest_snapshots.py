"""Create owner-scoped intraday aggregate option OI snapshots.

Revision ID: 0015_open_interest_snapshots
Revises: 0014_create_user_preferences
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0015_open_interest_snapshots"
down_revision: str | None = "0014_create_user_preferences"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "open_interest_snapshots",
        sa.Column("owner_id", sa.String(length=50), nullable=False),
        sa.Column("symbol", sa.String(length=50), nullable=False),
        sa.Column("expiry", sa.String(length=32), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("total_call_oi", sa.Float(), nullable=False),
        sa.Column("total_put_oi", sa.Float(), nullable=False),
        sa.Column("total_call_change", sa.Float(), nullable=False),
        sa.Column("total_put_change", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("owner_id", "symbol", "expiry", "timestamp"),
    )
    op.create_index(
        "ix_open_interest_snapshot_owner_symbol_expiry_time",
        "open_interest_snapshots",
        ["owner_id", "symbol", "expiry", "timestamp"],
    )


def downgrade() -> None:
    op.drop_index("ix_open_interest_snapshot_owner_symbol_expiry_time", table_name="open_interest_snapshots")
    op.drop_table("open_interest_snapshots")
