from datetime import datetime, timezone
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, event, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now():
    return datetime.now(timezone.utc)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


vector_type = Vector().with_variant(JSON(), "sqlite")


class Holding(Base):
    __tablename__ = "holdings"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    data: Mapped[dict] = mapped_column(JSON)


class Price(Base):
    __tablename__ = "prices"
    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True, default=now)
    price: Mapped[float] = mapped_column(Float)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    previous_close: Mapped[float | None] = mapped_column(Float)
    change_percent: Mapped[float | None] = mapped_column(Float)
    volume: Mapped[float | None] = mapped_column(Float)
    demo: Mapped[bool] = mapped_column(default=False)


class Snapshot(Base):
    __tablename__ = "net_worth_snapshots"
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True, default=now)
    total: Mapped[float] = mapped_column(Float)
    cash: Mapped[float] = mapped_column(Float)
    cd: Mapped[float] = mapped_column(Float)
    stocks: Mapped[float] = mapped_column(Float)


class ResearchJob(Base):
    __tablename__ = "research_jobs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    topic: Mapped[str] = mapped_column(Text)
    questions: Mapped[list] = mapped_column(JSON, default=list)
    tickers: Mapped[list] = mapped_column(JSON, default=list)
    thread_id: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    report_id: Mapped[str | None] = mapped_column(String)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    job_id: Mapped[str | None] = mapped_column(String, unique=True)
    title: Mapped[str] = mapped_column(Text)
    topic: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    body_md: Mapped[str] = mapped_column(Text)
    tickers: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    summary_embedding: Mapped[list] = mapped_column(vector_type)
    embedding_model: Mapped[str] = mapped_column(String)
    suggested_triggers: Mapped[list] = mapped_column(JSON, default=list)
    demo: Mapped[bool] = mapped_column(default=False)


class ReportChunk(Base):
    __tablename__ = "report_chunks"
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), primary_key=True)
    idx: Mapped[int] = mapped_column(Integer, primary_key=True)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list] = mapped_column(vector_type)


class ReportSource(Base):
    __tablename__ = "report_sources"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(Text)
    publisher: Mapped[str] = mapped_column(String)
    published_at: Mapped[str | None] = mapped_column(String)
    excerpt: Mapped[str] = mapped_column(Text)


class Trigger(Base):
    __tablename__ = "triggers"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    spec: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String, default="active")
    thread_id: Mapped[str | None] = mapped_column(String)
    approval_key: Mapped[str | None] = mapped_column(String, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_polls: Mapped[dict] = mapped_column(JSON, default=dict)
    level: Mapped[str] = mapped_column(String, default="OK")


class SignalEvent(Base):
    __tablename__ = "signal_events"
    __table_args__ = (UniqueConstraint("trigger_id", "source", "external_id"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    trigger_id: Mapped[str] = mapped_column(ForeignKey("triggers.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    source: Mapped[str] = mapped_column(String)
    external_id: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text)
    raw: Mapped[dict] = mapped_column(JSON)


class Evaluation(Base):
    __tablename__ = "trigger_evaluations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    trigger_id: Mapped[str] = mapped_column(ForeignKey("triggers.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True, default=now)
    event_id: Mapped[str | None] = mapped_column(ForeignKey("signal_events.id"))
    magnitude: Mapped[float] = mapped_column(Float)
    exposure: Mapped[float] = mapped_column(Float)  # Raw portfolio fraction; E = min(exposure / .1, 1).
    credibility: Mapped[float] = mapped_column(Float)
    urgency: Mapped[float] = mapped_column(Float)
    adjustment: Mapped[float] = mapped_column(Float)
    severity: Mapped[float] = mapped_column(Float)
    level: Mapped[str] = mapped_column(String)
    triage: Mapped[dict] = mapped_column(JSON)
    suppressed_reason: Mapped[str | None] = mapped_column(String)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    trigger_id: Mapped[str] = mapped_column(ForeignKey("triggers.id"), index=True)
    evaluation_id: Mapped[str] = mapped_column(String)
    evaluation_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    level: Mapped[str] = mapped_column(String)
    severity: Mapped[float] = mapped_column(Float)
    summary: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list] = mapped_column(JSON)
    channel: Mapped[str] = mapped_column(String)
    call_reserved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivery_status: Mapped[str] = mapped_column(String, default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    acked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AppEvent(Base):
    __tablename__ = "app_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Database:
    def __init__(self, settings):
        url = settings.database_url.replace("postgres://", "postgresql://", 1)
        self.checkpoint_url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1).replace("sslmode=", "ssl=")
        self.engine = create_async_engine(url, pool_pre_ping=True)
        if url.startswith("sqlite"):
            @event.listens_for(self.engine.sync_engine, "connect")
            def sqlite_settings(connection, _):
                cursor = connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA busy_timeout=10000")
                cursor.close()
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.is_postgres = self.engine.dialect.name == "postgresql"

    async def initialize(self):
        async with self.engine.begin() as connection:
            if self.is_postgres:
                await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await connection.run_sync(Base.metadata.create_all)

    async def close(self):
        await self.engine.dispose()


def emit(session, kind, payload):
    session.add(AppEvent(kind=kind, payload=payload))


def row_dict(row, exclude=()):
    return {c.name: getattr(row, c.name) for c in row.__table__.columns if c.name not in exclude}
