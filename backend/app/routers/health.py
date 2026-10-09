"""Health check router."""

from fastapi import APIRouter

from ..db import check_db
from ..schemas import HealthOut

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthOut)
def health():
    db_ok = check_db()
    return HealthOut(
        status="ok" if db_ok else "degraded",
        database="connected" if db_ok else "disconnected",
    )
