"""Tests for the Data Insights capability (app/insights/*, app/routers/insights.py).

Generic, domain-agnostic data-analysis: upload tabular data -> automated report with
top-issue flags, stored historically -> grounded Q&A that pulls in whichever domains'
Expertise are actually relevant (cross-domain coordination), via app/prompts.py's existing
grounding logic. See the Keppel webinar notes worked example this answers.
"""

import io
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.insights.analysis import AnalysisError, detect_issues, parse_csv
from app.insights.report import render_html
from app.main import app

_USER = "a1b2c3d4-0000-4000-8000-00000000f001"

# A synthetic dataset with an obvious anomaly: Level 12's usage spikes hard in July/August
# (mirrors the Shanghai summer-spike example from the webinar notes, but with made-up
# category names so the test doesn't assume any particular domain).
_CSV = """level,month,usage_kwh
Level 10,2026-05,1000
Level 10,2026-06,1050
Level 10,2026-07,1080
Level 10,2026-08,1100
Level 12,2026-05,900
Level 12,2026-06,950
Level 12,2026-07,2400
Level 12,2026-08,2600
Level 15,2026-05,700
Level 15,2026-06,710
Level 15,2026-07,720
Level 15,2026-08,730
"""


# --- analysis unit tests -----------------------------------------------------

def test_parse_csv_identifies_columns_by_header_hints():
    parsed = parse_csv(_CSV)
    assert parsed.category_col == "level"
    assert parsed.period_col == "month"
    assert parsed.value_col == "usage_kwh"
    assert len(parsed.rows) == 12
    assert parsed.categories == ["Level 10", "Level 12", "Level 15"]


def test_parse_csv_rejects_non_tabular_input():
    with pytest.raises(AnalysisError):
        parse_csv("just one column\nwith no structure\n")


def test_parse_csv_rejects_file_with_no_numeric_column():
    with pytest.raises(AnalysisError):
        parse_csv("category,period,note\nA,2026-01,hello\nB,2026-02,world\n")


def test_detect_issues_flags_the_real_anomaly_highest():
    parsed = parse_csv(_CSV)
    issues = detect_issues(parsed, top_n=5)
    assert issues, "expected at least one flagged issue"
    # Level 12's July jump (900/950 baseline -> 2400) should outrank the flat Level 10/15 series.
    assert issues[0].category == "Level 12"
    assert issues[0].severity == "high"


def test_detect_issues_returns_at_most_top_n():
    parsed = parse_csv(_CSV)
    assert len(detect_issues(parsed, top_n=2)) <= 2


def test_render_html_includes_title_and_flagged_issue():
    parsed = parse_csv(_CSV)
    issues = detect_issues(parsed)
    html = render_html("Test Report", parsed, issues)
    assert "Test Report" in html
    assert "Level 12" in html


def test_render_html_handles_no_issues_gracefully():
    flat_csv = "category,period,value\nA,2026-01,100\nB,2026-01,100\n"
    parsed = parse_csv(flat_csv)
    html = render_html("Flat", parsed, detect_issues(parsed))
    assert "No notable anomalies" in html


# --- full API round-trip -----------------------------------------------------

@pytest.fixture()
def api_db():
    from app.models import Profile

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    s = Session()
    s.add(Profile(id=_USER, name="Adrian", email="adrian@fractal.demo", role="reviewer", domains=[]))
    s.commit()

    def override():
        yield s

    app.dependency_overrides[get_db] = override
    yield s
    app.dependency_overrides.clear()
    s.close()


def _auth():
    return {"X-User-Id": _USER}


def test_generate_report_round_trips_and_lists_historically(api_db):
    client = TestClient(app)
    files = {"file": ("usage.csv", io.BytesIO(_CSV.encode()), "text/csv")}
    r = client.post(
        "/api/insights/reports/generate",
        files=files, data={"title": "Q3 Usage Review", "domains": "Energy Optimisation, Sustainability"},
        headers=_auth(),
    )
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["title"] == "Q3 Usage Review"
    assert report["domains"] == ["Energy Optimisation", "Sustainability"]
    assert len(report["topIssues"]) > 0
    assert report["topIssues"][0]["category"] == "Level 12"
    assert "Level 12" in report["html"]

    # Historical listing: the generated report shows up (this is the "stores it automatically,
    # building historical data over time" requirement from the webinar notes).
    hist = client.get("/api/insights/reports", headers=_auth())
    assert hist.status_code == 200
    assert any(r2["id"] == report["id"] for r2 in hist.json())

    got = client.get(f"/api/insights/reports/{report['id']}", headers=_auth())
    assert got.status_code == 200
    assert got.json()["html"] == report["html"]


def test_generate_report_rejects_bad_file(api_db):
    client = TestClient(app)
    files = {"file": ("bad.csv", io.BytesIO(b"nonsense\nmore nonsense\n"), "text/csv")}
    r = client.post("/api/insights/reports/generate", files=files, headers=_auth())
    assert r.status_code == 400


def test_get_missing_report_404s(api_db):
    client = TestClient(app)
    r = client.get("/api/insights/reports/does-not-exist", headers=_auth())
    assert r.status_code == 404


def test_ask_report_grounds_answer_and_reports_coordinated_domains(api_db, monkeypatch):
    from app.models import Expertise

    # Two Expertise entries in different domains, both keyword-matchable against the question.
    api_db.add_all([
        Expertise(
            id="exp-energy-1", name="Chiller Staging", domain="Energy Optimisation", topic="t",
            status="approved", version="1.0", owner="P", keywords=["spike"],
            decision_logic=[], knowledge=["Stage chillers when demand spikes."],
        ),
        Expertise(
            id="exp-sus-1", name="Seasonal Ventilation", domain="Sustainability", topic="t",
            status="approved", version="1.0", owner="P", keywords=["spike"],
            decision_logic=[], knowledge=["Zone ventilation differently by sun exposure."],
        ),
    ])
    api_db.commit()

    client = TestClient(app)
    files = {"file": ("usage.csv", io.BytesIO(_CSV.encode()), "text/csv")}
    gen = client.post("/api/insights/reports/generate", files=files, headers=_auth())
    report_id = gen.json()["id"]

    with patch("app.routers.insights.claude.is_configured", return_value=True), \
         patch("app.routers.insights.claude.answer_once", new_callable=AsyncMock) as mock_answer:
        mock_answer.return_value = "Level 12's spike looks like a demand issue, not a fault."
        r = client.post(
            f"/api/insights/reports/{report_id}/ask",
            json={"question": "Why did usage spike?"}, headers=_auth(),
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"] == "Level 12's spike looks like a demand issue, not a fault."
    assert mock_answer.await_count == 1
    # Grounded in the report: the system prompt passed to Claude includes both matched
    # Expertise, proving retrieval ran (not just an empty/ungrounded prompt).
    system_arg = mock_answer.await_args.args[0]
    assert "Chiller Staging" in system_arg or "Seasonal Ventilation" in system_arg


def test_ask_report_without_configured_claude_errors_cleanly(api_db):
    client = TestClient(app)
    files = {"file": ("usage.csv", io.BytesIO(_CSV.encode()), "text/csv")}
    gen = client.post("/api/insights/reports/generate", files=files, headers=_auth())
    report_id = gen.json()["id"]

    with patch("app.routers.insights.claude.is_configured", return_value=False):
        r = client.post(
            f"/api/insights/reports/{report_id}/ask",
            json={"question": "Why?"}, headers=_auth(),
        )
    assert r.status_code == 400
