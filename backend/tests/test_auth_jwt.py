"""Auth dependency (app/auth.py): verified Supabase JWT vs the unverified header fallback."""

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.models import Profile

ADRIAN = "a1b2c3d4-0000-4000-8000-00000000ad01"
JWT_SECRET = "test-secret-do-not-use-in-prod"


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    s = Session()
    s.add(Profile(id=ADRIAN, name="Adrian Kang", email="adrian@fractal.demo", role="reviewer", domains=[]))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def client(db, monkeypatch):
    monkeypatch.setattr(settings, "supabase_jwt_secret", JWT_SECRET)
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _token(sub=ADRIAN, secret=JWT_SECRET, **claims):
    return jwt.encode({"sub": sub, "aud": "authenticated", **claims}, secret, algorithm="HS256")


def test_valid_jwt_resolves_the_profile(client):
    res = client.get("/api/audit", headers={"Authorization": f"Bearer {_token()}"})
    assert res.status_code == 200


def test_tampered_signature_is_rejected(client):
    bad = _token(secret="wrong-secret")
    res = client.get("/api/audit", headers={"Authorization": f"Bearer {bad}"})
    assert res.status_code == 401


def test_jwt_for_unknown_user_is_404(client):
    res = client.get("/api/audit", headers={"Authorization": f"Bearer {_token(sub='00000000-0000-4000-8000-000000000000')}"})
    assert res.status_code == 404


def test_expired_jwt_is_rejected(client):
    import time
    expired = _token(exp=int(time.time()) - 60)
    res = client.get("/api/audit", headers={"Authorization": f"Bearer {expired}"})
    assert res.status_code == 401


def test_no_credentials_is_401(client):
    assert client.get("/api/audit").status_code == 401


def test_header_fallback_still_works_without_a_bearer_token(client):
    """The front end doesn't send a real JWT yet — X-User-Email must keep working."""
    res = client.get("/api/audit", headers={"X-User-Email": "adrian@fractal.demo"})
    assert res.status_code == 200


def test_bearer_token_takes_priority_over_header_fallback(client):
    """A present-but-invalid bearer token must not silently fall back to the header —
    otherwise an attacker could bypass JWT verification just by sending a bad token."""
    res = client.get(
        "/api/audit",
        headers={"Authorization": "Bearer garbage", "X-User-Email": "adrian@fractal.demo"},
    )
    assert res.status_code == 401
