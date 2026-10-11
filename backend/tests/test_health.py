"""GET /api/health — surfaces DB/Claude config status plus the active TRANSCRIBE backend."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_transcribe_backend():
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["transcribe"] == "browser"  # only implemented backend (app/config.py)
