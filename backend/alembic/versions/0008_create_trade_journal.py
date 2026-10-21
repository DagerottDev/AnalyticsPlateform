"""Create persistent trade journal entries.

Revision ID: 0008
Revises: 0007
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("trade_journal_entries", sa.Column("id", sa.String(36), primary_key=True), sa.Column("owner_id", sa.String(50), nullable=False), sa.Column("trading_symbol", sa.String(100), nullable=False), sa.Column("side", sa.String(4), nullable=False), sa.Column("quantity", sa.Integer(), nullable=False), sa.Column("entry_price", sa.Float(), nullable=False), sa.Column("exit_price", sa.Float()), sa.Column("stop_price", sa.Float()), sa.Column("entry_time", sa.DateTime(timezone=True), nullable=False), sa.Column("exit_time", sa.DateTime(timezone=True)), sa.Column("notes", sa.String(4000), nullable=False), sa.Column("tags", sa.JSON(), nullable=False), sa.Column("source", sa.String(12), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_trade_journal_entries_owner_id", "trade_journal_entries", ["owner_id"])
    op.create_index("ix_trade_journal_entries_trading_symbol", "trade_journal_entries", ["trading_symbol"])
    op.create_index("ix_trade_journal_entries_entry_time", "trade_journal_entries", ["entry_time"])
    op.create_index("ix_trade_journal_owner_exit", "trade_journal_entries", ["owner_id", "exit_time"])


def downgrade() -> None:
    op.drop_table("trade_journal_entries")
