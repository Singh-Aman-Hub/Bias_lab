from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

DATABASE_URL = "sqlite:///./unbiased_ai.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    domain: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    sensitive_columns: Mapped[list[str]] = mapped_column(JSON, default=list)
    target_column: Mapped[str | None] = mapped_column(String(255), nullable=True)

    dataset_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    model_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    max_step: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    audit_runs: Mapped[list["AuditRun"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    monitoring_events: Mapped[list["MonitoringEvent"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    monitoring_logs: Mapped[list["MonitoringLog"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    alerts: Mapped[list["Alert"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class AuditRun(Base):
    __tablename__ = "audit_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    fairness_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    accuracy: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    risk_level: Mapped[str] = mapped_column(String(20), default="Yellow", nullable=False)
    results_json: Mapped[dict] = mapped_column(JSON, default=dict)
    decision: Mapped[str] = mapped_column(String(50), default="UNKNOWN", nullable=False)
    full_result_json: Mapped[dict] = mapped_column(JSON, default=dict)
    task_id: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)

    project: Mapped[Project] = relationship(back_populates="audit_runs")


class MonitoringEvent(Base):
    __tablename__ = "monitoring_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    fairness_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    alert_triggered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    note: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    group_breakdown: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    project: Mapped[Project] = relationship(back_populates="monitoring_events")

class MonitoringLog(Base):
    __tablename__ = "monitoring_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    fairness_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    data_drift_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    prediction_drift_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    key_metrics: Mapped[dict] = mapped_column(JSON, default=dict)

    project: Mapped[Project] = relationship(back_populates="monitoring_logs")

class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False) # BIAS, DRIFT, DEGRADATION
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False) # LOW, MEDIUM, HIGH
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    project: Mapped[Project] = relationship(back_populates="alerts")

class FairnessFlag(Base):
    __tablename__ = "fairness_flags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    record_id: Mapped[str] = mapped_column(String, nullable=False)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    flagged_by: Mapped[str] = mapped_column(String, default="user")
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)

    project: Mapped[Project] = relationship("Project", backref="fairness_flags")


Base.metadata.create_all(bind=engine)


def _add_missing_columns() -> None:
    """Lightweight auto-migration for SQLite.

    ``create_all`` only creates *missing tables*; it never alters a table that
    already exists. When a new column is added to a model (e.g.
    ``MonitoringEvent.group_breakdown``), an existing DB file keeps the old
    schema and queries fail with "no such column". This adds any mapped column
    that is missing from the physical table. Columns are added as nullable
    (SQLite cannot add a NOT NULL column to a populated table without a default);
    the ORM still applies model-level defaults on insert.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # freshly created by create_all — already current
            existing_cols = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_cols:
                    continue
                col_type = column.type.compile(dialect=engine.dialect)
                conn.execute(
                    text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}')
                )


_add_missing_columns()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
