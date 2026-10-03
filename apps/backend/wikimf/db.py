import os
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, ForeignKeyConstraint, Integer, JSON, String, UniqueConstraint, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def now():
    return datetime.now(timezone.utc)


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    display_name: Mapped[str] = mapped_column(String(100), default="Reader")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Tokyo")
    recording_epoch: Mapped[int] = mapped_column(Integer, default=1)
    collection_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_version: Mapped[str | None] = mapped_column(String(40))
    profile_public: Mapped[bool] = mapped_column(Boolean, default=False)
    publish_total_time: Mapped[bool] = mapped_column(Boolean, default=False)
    publish_achievements: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Identity(Base):
    __tablename__ = "auth_identities"
    __table_args__ = (UniqueConstraint("provider", "subject"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))
    subject: Mapped[str] = mapped_column(String(200))
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class WebSession(Base):
    __tablename__ = "web_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("id", "user_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(30))
    display_name: Mapped[str] = mapped_column(String(100))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    scopes: Mapped[list] = mapped_column(JSON, default=lambda: ["reading:write", "reading:read", "profile:read"])
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DeviceLink(Base):
    __tablename__ = "device_link_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    source: Mapped[str] = mapped_column(String(30))
    display_name: Mapped[str] = mapped_column(String(100))
    secret_hash: Mapped[str] = mapped_column(String(64))
    user_code: Mapped[str] = mapped_column(String(16))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    exchanged: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Article(Base):
    __tablename__ = "articles"
    __table_args__ = (UniqueConstraint("wiki", "page_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    wiki: Mapped[str] = mapped_column(String(10))
    page_id: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(500))
    canonical_url: Mapped[str] = mapped_column(String(2000))
    namespace: Mapped[int] = mapped_column(Integer, default=0)
    trackable: Mapped[bool] = mapped_column(Boolean, default=True)
    untrackable_reason: Mapped[str | None] = mapped_column(String(60))
    availability: Mapped[str] = mapped_column(String(20), default="available")
    latest_revision_id: Mapped[int | None] = mapped_column(Integer)
    resolved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ArticleAlias(Base):
    __tablename__ = "article_aliases"
    __table_args__ = (UniqueConstraint("wiki", "title"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wiki: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(500))
    article_id: Mapped[str] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"))
    resolved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ReadingSession(Base):
    __tablename__ = "reading_sessions"
    __table_args__ = (UniqueConstraint("user_id", "session_id"), ForeignKeyConstraint(["device_id", "user_id"], ["devices.id", "devices.user_id"]))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str] = mapped_column(String(36))
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"))
    article_id: Mapped[str] = mapped_column(ForeignKey("articles.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    document: Mapped[dict] = mapped_column(JSON)
    policy_version: Mapped[str] = mapped_column(String(40))
    quarantined: Mapped[bool] = mapped_column(Boolean, default=False)


class ReadingEvent(Base):
    __tablename__ = "reading_events"
    __table_args__ = (UniqueConstraint("user_id", "event_id"), UniqueConstraint("user_id", "device_id", "session_id", "seq"),
                      ForeignKeyConstraint(["device_id", "user_id"], ["devices.id", "devices.user_id"]),
                      ForeignKeyConstraint(["user_id", "session_id"], ["reading_sessions.user_id", "reading_sessions.session_id"]))
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[str] = mapped_column(String(36))
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"))
    session_id: Mapped[str] = mapped_column(String(36), index=True)
    article_id: Mapped[str] = mapped_column(ForeignKey("articles.id"))
    seq: Mapped[int] = mapped_column(Integer)
    digest: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ReadingInterval(Base):
    __tablename__ = "reading_intervals"
    __table_args__ = (UniqueConstraint("event_receipt_id", "start_at", "end_at"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_receipt_id: Mapped[int] = mapped_column(ForeignKey("reading_events.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    article_id: Mapped[str] = mapped_column(ForeignKey("articles.id"))
    session_id: Mapped[str] = mapped_column(String(36))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ManualState(Base):
    __tablename__ = "article_reading_states"
    __table_args__ = (UniqueConstraint("user_id", "article_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    article_id: Mapped[str] = mapped_column(ForeignKey("articles.id"))
    state: Mapped[str] = mapped_column(String(20))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DeletionMarker(Base):
    __tablename__ = "history_deletion_markers"
    __table_args__ = (UniqueConstraint("user_id", "article_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    article_id: Mapped[str] = mapped_column(ForeignKey("articles.id"))
    deleted_before: Mapped[datetime] = mapped_column(DateTime(timezone=True))


def database(url=None):
    url = url or os.getenv("DATABASE_URL", "postgresql+psycopg://wikimf:wikimf@127.0.0.1:54329/wikimf")
    engine = create_engine(url, pool_pre_ping=True, hide_parameters=True, connect_args={"check_same_thread": False} if url.startswith("sqlite") else {})
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def enforce_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
    return engine, sessionmaker(engine, expire_on_commit=False)
