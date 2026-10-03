"""Normalize active intervals and backfill immutable accepted event evidence."""
from datetime import datetime,timedelta
from alembic import op
import sqlalchemy as sa

revision = "0002_intervals"
down_revision = "0001_mvp"
branch_labels = None
depends_on = None


def upgrade():
    table = op.create_table("reading_intervals",
        sa.Column("id",sa.Integer(),primary_key=True),
        sa.Column("event_receipt_id",sa.Integer(),sa.ForeignKey("reading_events.id",ondelete="CASCADE"),nullable=False),
        sa.Column("user_id",sa.String(36),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),
        sa.Column("article_id",sa.String(36),sa.ForeignKey("articles.id"),nullable=False),
        sa.Column("session_id",sa.String(36),nullable=False),
        sa.Column("start_at",sa.DateTime(timezone=True),nullable=False),
        sa.Column("end_at",sa.DateTime(timezone=True),nullable=False),
        sa.UniqueConstraint("event_receipt_id","start_at","end_at"))
    op.create_index("ix_reading_intervals_event_receipt_id","reading_intervals",["event_receipt_id"])
    op.create_index("ix_reading_intervals_user_id","reading_intervals",["user_id"])
    events = sa.table("reading_events",sa.column("id"),sa.column("user_id"),sa.column("article_id"),sa.column("session_id"),sa.column("payload",sa.JSON))
    bind = op.get_bind()
    for event in bind.execute(sa.select(events)).mappings():
        interval = event["payload"]["interval"]
        start = datetime.fromisoformat(interval["start_at"].replace("Z","+00:00"))
        for a,b in interval["active_spans_ms"]:
            bind.execute(table.insert().values(event_receipt_id=event["id"],user_id=event["user_id"],article_id=event["article_id"],session_id=event["session_id"],
                                               start_at=start+timedelta(milliseconds=a),end_at=start+timedelta(milliseconds=b)))


def downgrade():
    op.drop_table("reading_intervals")
