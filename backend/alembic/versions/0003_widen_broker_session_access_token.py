"""Widen broker_sessions.access_token to Text for encrypted ciphertext

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-23 00:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        'broker_sessions',
        'access_token',
        existing_type=sa.String(length=512),
        type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        'broker_sessions',
        'access_token',
        existing_type=sa.Text(),
        type_=sa.String(length=512),
        existing_nullable=False,
    )
