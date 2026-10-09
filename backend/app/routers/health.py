"""Health check router — DB connectivity + Claude config status."""

from fastapi import APIRouter

from ..db import check_db
from ..llm import claude
from ..schemas import HealthOut

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthOut)
def health():
    db_ok = check_db()
    claude_ok = claude.is_configured()
    all_ok = db_ok and claude_ok
    return HealthOut(
        status="ok" if all_ok else "degraded",
        database="connected" if db_ok else "disconnected",
        claude="configured" if claude_ok else "not_configured",
    )
