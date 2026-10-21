"""Create server-backed user preference profiles.

Revision ID: 0014_create_user_preferences
Revises: 0013_create_gtt_orders
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014_create_user_preferences"
down_revision: str | None = "0013_create_gtt_orders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_preferences",
        sa.Column("owner_id", sa.String(length=50), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("owner_id"),
    )


def downgrade() -> None:
    op.drop_table("user_preferences")
