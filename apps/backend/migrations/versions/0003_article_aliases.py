"""Persist title-to-canonical cache mappings without changing article identities.

Upgrade seeds canonical titles from existing metadata, preferring the newest
verified row if legacy titles collide. Downgrade removes only derived aliases.
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_article_aliases"
down_revision = "0002_intervals"
branch_labels = None
depends_on = None


def upgrade():
    aliases = op.create_table("article_aliases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("wiki", sa.String(10), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("article_id", sa.String(36), sa.ForeignKey("articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("wiki", "title"))
    articles = sa.table("articles", sa.column("id"), sa.column("wiki"), sa.column("title"), sa.column("resolved_at", sa.DateTime(timezone=True)))
    bind = op.get_bind()
    seen = set()
    for article in bind.execute(sa.select(articles).order_by(articles.c.wiki, articles.c.title, articles.c.resolved_at.desc(), articles.c.id)).mappings():
        key = (article["wiki"], article["title"])
        if key not in seen:
            bind.execute(aliases.insert().values(wiki=article["wiki"], title=article["title"], article_id=article["id"], resolved_at=article["resolved_at"]))
            seen.add(key)


def downgrade():
    op.drop_table("article_aliases")
