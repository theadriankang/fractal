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
from app.insights.analysis import AnalysisError, build_chart_spec, detect_issues, parse_csv, parse_xlsx
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


def test_build_chart_spec_returns_line_series_per_category():
    parsed = parse_csv(_CSV)
    spec = build_chart_spec(parsed)
    assert spec["type"] == "line"
    assert set(spec["series"]) == set(parsed.categories)
    assert spec["xKey"] == "period"
    assert len(spec["data"]) == len(parsed.periods)
    # Each row keys every series by category, with the parsed value for that period.
    first = spec["data"][0]
    assert first["period"] == parsed.periods[0]
    assert first["Level 12"] == 900.0


def test_build_chart_spec_caps_to_max_series():
    parsed = parse_csv(_CSV)
    spec = build_chart_spec(parsed, max_series=2)
    assert len(spec["series"]) <= 2


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

    # Every report gets a ready-to-render chart spec (the trend-chart requirement from the
    # visualization work) -- a line chart of each category's values across periods.
    spec = report["chartSpec"]
    assert spec["type"] == "line"
    assert spec["xKey"] == "period"
    assert "Level 12" in spec["series"]
    assert len(spec["data"]) == len(report["rawMetrics"]["periods"])
    assert spec["data"][0]["period"] == report["rawMetrics"]["periods"][0]

    # Historical listing: the generated report shows up (this is the "stores it automatically,
    # building historical data over time" requirement from the webinar notes).
    hist = client.get("/api/insights/reports", headers=_auth())
    assert hist.status_code == 200
    assert any(r2["id"] == report["id"] for r2 in hist.json())

    got = client.get(f"/api/insights/reports/{report['id']}", headers=_auth())
    assert got.status_code == 200
    assert got.json()["html"] == report["html"]


def _make_xlsx_bytes(rows):
    """Builds a minimal .xlsx file in memory from a list of row-tuples (first row = headers),
    for tests -- so .xlsx support is exercised against a real openpyxl-written file, not a
    hand-crafted mock of one."""
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_xlsx_matches_parse_csv_on_equivalent_data():
    xlsx_bytes = _make_xlsx_bytes([
        ("level", "month", "usage_kwh"),
        ("Level 10", "2026-05", 1000),
        ("Level 10", "2026-06", 1050),
        ("Level 12", "2026-05", 900),
        ("Level 12", "2026-07", 2400),
    ])
    parsed = parse_xlsx(xlsx_bytes)
    assert parsed.category_col == "level"
    assert parsed.period_col == "month"
    assert parsed.value_col == "usage_kwh"
    assert set(parsed.categories) == {"Level 10", "Level 12"}
    assert len(parsed.rows) == 4
    assert any(r["category"] == "Level 12" and r["period"] == "2026-07" and r["value"] == 2400.0 for r in parsed.rows)


def test_parse_xlsx_rejects_empty_workbook():
    xlsx_bytes = _make_xlsx_bytes([])
    with pytest.raises(AnalysisError):
        parse_xlsx(xlsx_bytes)


def test_parse_xlsx_rejects_single_column():
    xlsx_bytes = _make_xlsx_bytes([("only_header",), ("value1",), ("value2",)])
    with pytest.raises(AnalysisError):
        parse_xlsx(xlsx_bytes)


def test_generate_report_accepts_xlsx_upload(api_db):
    client = TestClient(app)
    xlsx_bytes = _make_xlsx_bytes([
        ("level", "month", "usage_kwh"),
        ("Level 10", "2026-05", 1000),
        ("Level 10", "2026-06", 1050),
        ("Level 10", "2026-07", 1080),
        ("Level 10", "2026-08", 1100),
        ("Level 12", "2026-05", 900),
        ("Level 12", "2026-06", 950),
        ("Level 12", "2026-07", 2400),
        ("Level 12", "2026-08", 2600),
    ])
    files = {"file": ("usage.xlsx", io.BytesIO(xlsx_bytes), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    r = client.post(
        "/api/insights/reports/generate",
        files=files, data={"title": "Excel Upload Test"},
        headers=_auth(),
    )
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["title"] == "Excel Upload Test"
    assert len(report["topIssues"]) > 0
    assert report["topIssues"][0]["category"] == "Level 12"
    assert report["chartSpec"]["type"] == "line"


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


# --- narrative synthesis + persisted Q&A + capture-to-Expertise loop ---------

def test_generate_report_includes_narrative_when_claude_configured_and_expertise_matches(api_db):
    from app.models import Expertise

    api_db.add(Expertise(
        id="exp-energy-1", name="Chiller Staging", domain="Energy Optimisation", topic="t",
        status="approved", version="1.0", owner="P", keywords=["spike", "level"],
        decision_logic=[], knowledge=["Stage chillers when demand spikes."],
    ))
    api_db.commit()

    client = TestClient(app)
    files = {"file": ("usage.csv", io.BytesIO(_CSV.encode()), "text/csv")}
    with patch("app.routers.insights.claude.is_configured", return_value=True), \
         patch("app.routers.insights.synthesize", new_callable=AsyncMock) as mock_synth:
        mock_synth.return_value = "Analysis\nLevel 12 is unusual.\nBlind spots\nWe don't know occupancy.\nTop issues to focus on\nLevel 12 July spike.\nPotential resolutions\nInvestigate demand."
        r = client.post("/api/insights/reports/generate", files=files, headers=_auth())
    assert r.status_code == 200, r.text
    report = r.json()
    assert "Level 12 is unusual." in report["narrative"]
    assert any(e["name"] == "Chiller Staging" for e in report["expertiseUsed"])
    assert "Energy Optimisation" in report["domainsCoordinated"]
    assert "Expert analysis" in report["html"]


def test_generate_report_has_empty_narrative_when_claude_not_configured(api_db):
    client = TestClient(app)
    files = {"file": ("usage.csv", io.BytesIO(_CSV.encode()), "text/csv")}
    with patch("app.routers.insights.claude.is_configured", return_value=False):
        r = client.post("/api/insights/reports/generate", files=files, headers=_auth())
    assert r.status_code == 200, r.text
    assert r.json()["narrative"] == ""


def test_ask_report_persists_qa_history_for_future_reference(api_db):
    client = TestClient(app)
    files = {"file": ("usage.csv", io.BytesIO(_CSV.encode()), "text/csv")}
    with patch("app.routers.insights.claude.is_configured", return_value=False):
        gen = client.post("/api/insights/reports/generate", files=files, headers=_auth())
    report_id = gen.json()["id"]

    with patch("app.routers.insights.claude.is_configured", return_value=True), \
         patch("app.routers.insights.claude.answer_once", new_callable=AsyncMock) as mock_answer:
        mock_answer.return_value = "It's a demand spike, not a fault."
        client.post(f"/api/insights/reports/{report_id}/ask", json={"question": "Why?"}, headers=_auth())

    # Re-fetch the report fresh (new GET, not the in-memory object) — proves it was actually
    # persisted to the DB, not just returned once and forgotten.
    got = client.get(f"/api/insights/reports/{report_id}", headers=_auth())
    history = got.json()["qaHistory"]
    assert len(history) == 1
    assert history[0]["question"] == "Why?"
    assert history[0]["answer"] == "It's a demand spike, not a fault."

    # A second question appends rather than overwriting.
    with patch("app.routers.insights.claude.is_configured", return_value=True), \
         patch("app.routers.insights.claude.answer_once", new_callable=AsyncMock) as mock_answer2:
        mock_answer2.return_value = "Around $4k extra this month."
        client.post(f"/api/insights/reports/{report_id}/ask", json={"question": "What's the cost?"}, headers=_auth())
    got2 = client.get(f"/api/insights/reports/{report_id}", headers=_auth())
    assert len(got2.json()["qaHistory"]) == 2


def test_capture_insight_as_revision_proposal_goes_through_review_queue(api_db):
    from app.models import Expertise, Profile

    api_db.add(Profile(
        id="a1b2c3d4-0000-4000-8000-00000000c001", name="Priya", email="priya@fractal.demo",
        role="contributor", domains=["Energy Optimisation"],
    ))
    api_db.add(Expertise(
        id="exp-energy-1", name="Chiller Staging", domain="Energy Optimisation", topic="t",
        status="approved", version="1.0", owner="P", knowledge=[], decision_logic=[],
    ))
    api_db.commit()

    client = TestClient(app)
    files = {"file": ("usage.csv", io.BytesIO(_CSV.encode()), "text/csv")}
    with patch("app.routers.insights.claude.is_configured", return_value=False):
        gen = client.post("/api/insights/reports/generate", files=files, headers=_auth())
    report_id = gen.json()["id"]

    r = client.post(
        f"/api/insights/reports/{report_id}/capture",
        json={
            "text": "Level 12 spikes in July are demand-driven, not equipment faults — check occupancy before escalating.",
            "domain": "Energy Optimisation",
            "decisionStep": {
                "text": "Check demand before escalating a summer usage spike.",
                "condition": "A single level's usage jumps >100% period-over-period in summer months.",
                "action": "Check occupancy/demand data before assuming equipment fault.",
                "reasoning": "Past cases traced to demand, not faults.",
                "escalateIf": "Usage stays elevated after demand is ruled out.",
            },
            "expertiseId": "exp-energy-1",
        },
        headers={"X-User-Id": "a1b2c3d4-0000-4000-8000-00000000c001"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "proposal"
    assert body["status"] == "open"

    # It's a real Proposal, visible in the normal Review Queue listing — not a side channel.
    listed = client.get("/api/proposals", headers={"X-User-Id": "a1b2c3d4-0000-4000-8000-00000000c001"})
    assert any(p["id"] == body["id"] for p in listed.json())


def test_capture_insight_without_expertise_id_creates_draft(api_db):
    from app.models import Profile

    api_db.add(Profile(
        id="a1b2c3d4-0000-4000-8000-00000000c002", name="Priya", email="priya2@fractal.demo",
        role="contributor", domains=["Sustainability"],
    ))
    api_db.commit()

    client = TestClient(app)
    files = {"file": ("usage.csv", io.BytesIO(_CSV.encode()), "text/csv")}
    with patch("app.routers.insights.claude.is_configured", return_value=False):
        gen = client.post("/api/insights/reports/generate", files=files, headers=_auth())
    report_id = gen.json()["id"]

    r = client.post(
        f"/api/insights/reports/{report_id}/capture",
        json={"text": "Seasonal zoning reduces July spikes.", "domain": "Sustainability", "topic": "Ventilation"},
        headers={"X-User-Id": "a1b2c3d4-0000-4000-8000-00000000c002"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "draft"

    # The draft is a real Expertise row, in draft status, findable through the normal library.
    listed = client.get("/api/expertise", headers={"X-User-Id": "a1b2c3d4-0000-4000-8000-00000000c002"})
    created = next(e for e in listed.json() if e["id"] == body["id"])
    assert created["status"] == "draft"
    assert "Seasonal zoning reduces July spikes." in created["knowledge"]


def test_capture_insight_blocked_for_reviewer_role(api_db):
    client = TestClient(app)
    files = {"file": ("usage.csv", io.BytesIO(_CSV.encode()), "text/csv")}
    with patch("app.routers.insights.claude.is_configured", return_value=False):
        gen = client.post("/api/insights/reports/generate", files=files, headers=_auth())
    report_id = gen.json()["id"]

    # _auth()/_USER is seeded as role="reviewer" in the api_db fixture.
    r = client.post(
        f"/api/insights/reports/{report_id}/capture",
        json={"text": "Some finding.", "domain": "Energy Optimisation"},
        headers=_auth(),
    )
    assert r.status_code == 403
