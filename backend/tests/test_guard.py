"""Public-demo guard: access code and rate limit (backend/app/guard.py)."""

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

client = TestClient(app)


def test_guard_off_by_default():
    assert client.get("/api/access/check").json() == {"required": False, "ok": True}


def test_access_code_blocks_api_but_not_health(monkeypatch):
    monkeypatch.setattr(settings, "access_code", "keppel-demo")
    assert client.get("/api/models").status_code == 401
    assert client.get("/api/models", headers={"X-Access-Code": "keppel-demo"}).status_code == 200
    assert client.get("/api/access/check").json() == {"required": True, "ok": False}
    assert client.get("/api/access/check", headers={"X-Access-Code": "keppel-demo"}).json()["ok"] is True


def test_rate_limit_on_ai_endpoints(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 2)
    headers = {"X-Forwarded-For": "203.0.113.9"}
    # /api/files with no body fails validation (422) before touching the DB, but still counts.
    codes = [client.post("/api/files", headers=headers).status_code for _ in range(3)]
    assert codes[-1] == 429
    # Non-AI endpoints are not rate limited.
    assert all(client.get("/api/models", headers=headers).status_code == 200 for _ in range(4))
