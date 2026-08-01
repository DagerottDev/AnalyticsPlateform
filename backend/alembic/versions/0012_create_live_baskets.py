"""Create live baskets table.

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-01 00:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "live_baskets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("owner_id", sa.String(length=50), nullable=False),
        sa.Column("legs", sa.JSON(), nullable=False),
        sa.Column("combined_stop_loss", sa.Float(), nullable=True),
        sa.Column("combined_take_profit", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("close_reason", sa.String(length=50), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_live_baskets_owner_id", "live_baskets", ["owner_id"], unique=False)
    op.create_index(
        "ix_live_baskets_owner_status", "live_baskets", ["owner_id", "status"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_live_baskets_owner_status", table_name="live_baskets")
    op.drop_index("ix_live_baskets_owner_id", table_name="live_baskets")
    op.drop_table("live_baskets")
