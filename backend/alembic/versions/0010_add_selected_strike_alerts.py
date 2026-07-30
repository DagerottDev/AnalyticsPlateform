"""Persist selected-strike analysis alert definitions and calculation state.

Revision ID: 0010
Revises: 0009
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("alerts", sa.Column("analysis", sa.JSON(), nullable=True))
    op.add_column("alerts", sa.Column("analysis_state", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("alerts", "analysis_state")
    op.drop_column("alerts", "analysis")
