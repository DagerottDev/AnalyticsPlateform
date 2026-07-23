"""Create broker_credentials table

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-23 13:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: str | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'broker_credentials',
        sa.Column('id', sa.String(length=20), nullable=False),
        sa.Column('app_id', sa.String(length=50), nullable=False),
        sa.Column('api_secret', sa.Text(), nullable=False),
        sa.Column('client_id', sa.String(length=50), nullable=False),
        sa.Column('totp_secret', sa.Text(), nullable=False),
        sa.Column('pin', sa.Text(), nullable=False),
        sa.Column('redirect_uri', sa.String(length=200), nullable=False),
        sa.Column('trading_mode', sa.String(length=10), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('broker_credentials')
