"""Hash device codes and require fresh authentication for sensitive actions.

Five-minute pairing requests must be restarted. Linked devices and histories
are retained. Legacy web sessions stay readable but need reauthentication.
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_auth_boundaries"
down_revision = "0003_article_aliases"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("DELETE FROM device_link_requests"))
    with op.batch_alter_table("device_link_requests") as batch:
        batch.add_column(sa.Column("user_code_hash", sa.String(97), nullable=False))
        batch.drop_column("user_code")
    op.add_column("web_sessions", sa.Column("authenticated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    # Hashes cannot be reversed. Restart pending pairing on either transition.
    op.execute(sa.text("DELETE FROM device_link_requests"))
    with op.batch_alter_table("device_link_requests") as batch:
        batch.add_column(sa.Column("user_code", sa.String(16), nullable=False))
        batch.drop_column("user_code_hash")
    op.drop_column("web_sessions", "authenticated_at")
