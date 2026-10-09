"""Database engine + session factory backed by Supabase Postgres."""

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from .config import settings


def _normalise_url(url: str) -> str:
    """Ensure SQLAlchemy uses the psycopg v3 driver.

    Supabase connection strings start with ``postgresql://`` (or
    ``postgres://``) but we depend on ``psycopg`` (v3), not ``psycopg2``.
    Rewrite the scheme so SQLAlchemy picks the right driver.
    """
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    return url


engine = create_engine(
    _normalise_url(settings.database_url),
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency that yields a session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_db() -> bool:
    """Quick connectivity check used by /api/health."""
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
        return True
    except Exception:
        return False
