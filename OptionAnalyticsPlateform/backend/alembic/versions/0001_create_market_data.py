"""Create market_data hypertable

Revision ID: 0001
Revises: 
Create Date: 2026-06-25 19:16:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Create the market_data table
    op.create_table(
        'market_data',
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('trading_symbol', sa.String(length=50), nullable=False),
        sa.Column('open', sa.Float(), nullable=False),
        sa.Column('high', sa.Float(), nullable=False),
        sa.Column('low', sa.Float(), nullable=False),
        sa.Column('close', sa.Float(), nullable=False),
        sa.Column('volume', sa.Integer(), nullable=False),
        sa.Column('open_interest', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('timestamp', 'trading_symbol')
    )
    op.create_index('ix_market_data_symbol_time', 'market_data', ['trading_symbol', 'timestamp'], unique=True)
    op.create_index(op.f('ix_market_data_timestamp'), 'market_data', ['timestamp'], unique=False)
    op.create_index(op.f('ix_market_data_trading_symbol'), 'market_data', ['trading_symbol'], unique=False)

    # 2. Convert to TimescaleDB hypertable
    # The 'create_hypertable' function is provided by the TimescaleDB extension.
    op.execute("SELECT create_hypertable('market_data', 'timestamp', if_not_exists => TRUE);")


def downgrade() -> None:
    op.drop_index(op.f('ix_market_data_trading_symbol'), table_name='market_data')
    op.drop_index(op.f('ix_market_data_timestamp'), table_name='market_data')
    op.drop_index('ix_market_data_symbol_time', table_name='market_data')
    op.drop_table('market_data')
