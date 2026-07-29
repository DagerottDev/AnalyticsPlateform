"""Create encrypted per-user alert delivery settings.

Revision ID: 0007
Revises: 0006
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("alert_delivery_settings", sa.Column("owner_id", sa.String(50), primary_key=True), sa.Column("email_enabled", sa.Boolean(), nullable=False), sa.Column("email_recipient", sa.String(320)), sa.Column("webhook_enabled", sa.Boolean(), nullable=False), sa.Column("webhook_url", sa.Text()), sa.Column("telegram_enabled", sa.Boolean(), nullable=False), sa.Column("telegram_bot_token", sa.Text()), sa.Column("telegram_chat_id", sa.String(100)), sa.Column("slack_enabled", sa.Boolean(), nullable=False), sa.Column("slack_webhook_url", sa.Text()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))


def downgrade() -> None:
    op.drop_table("alert_delivery_settings")
