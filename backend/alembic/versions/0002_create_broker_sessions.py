"""Create broker_sessions table

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-23 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'broker_sessions',
        sa.Column('id', sa.String(length=20), nullable=False),
        sa.Column('client_id', sa.String(length=50), nullable=False),
        sa.Column('app_id', sa.String(length=50), nullable=False),
        sa.Column('access_token', sa.String(length=512), nullable=False),
        sa.Column('trading_mode', sa.String(length=10), nullable=False),
        sa.Column('account_name', sa.String(length=100), nullable=False),
        sa.Column('connected_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('broker_sessions')
