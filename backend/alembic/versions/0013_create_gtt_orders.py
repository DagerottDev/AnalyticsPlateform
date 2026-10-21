"""create gtt orders

Revision ID: 0013_create_gtt_orders
Revises: 0012
"""

import sqlalchemy as sa

from alembic import op

revision = "0013_create_gtt_orders"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gtt_orders",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(50), nullable=False),
        sa.Column("broker_name", sa.String(20), nullable=False),
        sa.Column("symbol", sa.String(80), nullable=False),
        sa.Column("side", sa.String(4), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("product_type", sa.String(20), nullable=False),
        sa.Column("execution_type", sa.String(10), nullable=False),
        sa.Column("trigger_price", sa.Float(), nullable=False),
        sa.Column("limit_price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="Pending"),
        sa.Column("native_order_id", sa.String(80), nullable=True),
        sa.Column("execution_order_id", sa.String(80), nullable=True),
        sa.Column("error_message", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_gtt_orders_owner_status", "gtt_orders", ["owner_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_gtt_orders_owner_status", table_name="gtt_orders")
    op.drop_table("gtt_orders")
