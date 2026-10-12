"""Data Insights — a general-purpose capability of the platform, not tied to any one
Intelligence Pill: upload any tabular data and get back an Expertise-grounded briefing
(analysis, blind spots, prioritised issues, potential resolutions — "as if management were
talking to the relevant domain expert"), stored historically. Follow-up questions are
answered the same grounded way and persisted alongside the report. Either the report's own
finding or a specific Q&A exchange can be captured into governed Expertise through the same
propose -> review -> approve loop everything else uses — so discussions here compound into
the organisation's knowledge instead of evaporating once the tab is closed.

This directly answers the worked example from Keppel's webinar notes (see docs/ or the
project's Keppel Webinar Notes doc): "an agent that takes raw data, generates analysis and
a report automatically, stores it ... and proactively flags the top 5 issues ... [and can]
discuss the data ... as if it were the [domain] manager" — built domain-agnostic per their
own note that the solution need not be real-estate-specific, and closing the loop they
explicitly asked about: "how do we facilitate capturing knowledge and skills, get them
approved, and make them available for others to use in future?"
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_contributor
from ..db import get_db
from ..governance import audit
from ..insights.analysis import AnalysisError, build_chart_spec, detect_issues, parse_csv
from ..insights.narrative import synthesize
from ..insights.report import render_html
from ..llm import claude
from ..models import DataReport, Expertise, Profile, Proposal
from ..prompts import build_system_prompt
from ..retrieval.index import search as retrieval_search
from ..schemas import (
    DataReportOut, DataReportSummary, ExpertiseIn, InsightsAskRequest, InsightsAskResponse,
    InsightsCaptureRequest, InsightsCaptureResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/insights", tags=["insights"])

MAX_BYTES = 5 * 1024 * 1024
NARRATIVE_MATCH_LIMIT = 5


def _report_to_out(r: DataReport) -> DataReportOut:
    return DataReportOut.model_validate(r)


def _ground(db: Session, query: str, limit: int = NARRATIVE_MATCH_LIMIT):
    """Shared grounding step: matches approved Expertise against `query` and returns
    (matched_rows, applied ExpertiseIn list) for build_system_prompt. Used by both report
    generation and /ask so the two stay consistent."""
    matches = retrieval_search(db, query, limit=limit)
    rows = (
        db.query(Expertise).filter(Expertise.id.in_([m["id"] for m in matches])).all()
        if matches else []
    )
    applied = [
        ExpertiseIn(
            id=e.id, name=e.name, version=e.version, status=e.status,
            owner=e.owner or "", whenToUse=e.when_to_use or "",
            knowledge=e.knowledge or [], decisionLogic=e.decision_logic or [],
            guardrails=e.guardrails or [], escalation=e.escalation or [],
        )
        for e in rows
    ]
    return rows, applied


@router.post("/reports/generate", response_model=DataReportOut)
async def generate_report(
    file: UploadFile = File(...),
    title: str = Form(""),
    domains: str = Form(""),
    db: Session = Depends(get_db),
    user: Profile = Depends(get_current_user),
):
    """Parses the uploaded CSV, runs generic anomaly detection, grounds an expert-style
    briefing in whichever approved Expertise matches (any domain — this isn't energy-
    specific), renders the HTML report, and stores it. Column guessing lives in
    app.insights.analysis._pick_columns, so this works on any tabular data."""
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File is larger than 5 MB.")
    try:
        text = data.decode("utf-8-sig", errors="replace")
    except Exception as e:
        raise HTTPException(400, f"Could not read file as text: {e}") from e

    try:
        parsed = parse_csv(text)
    except AnalysisError as e:
        raise HTTPException(400, str(e)) from e

    issues = detect_issues(parsed)
    chart_spec = build_chart_spec(parsed)
    report_title = title.strip() or f"Analysis of {file.filename or 'uploaded data'}"
    domain_list = [d.strip() for d in domains.split(",") if d.strip()]

    # Ground the briefing in whichever domains' Expertise actually match this dataset's
    # content — not filtered to the tagged domains, so a dataset can surface Expertise from
    # a domain nobody thought to tag (e.g. a Sustainability guardrail on an energy dataset).
    issue_titles = "; ".join(i.title for i in issues)
    query = f"{report_title}. {', '.join(parsed.categories[:10])}. {issue_titles}"
    matched_rows, applied = _ground(db, query)
    narrative = await synthesize(report_title, parsed, issues, applied)

    expertise_used = [{"id": e.id, "name": e.name, "domain": e.domain, "version": e.version} for e in matched_rows]
    domains_coordinated = sorted({e.domain for e in matched_rows})
    html = render_html(report_title, parsed, issues, narrative=narrative, expertise_used=expertise_used)

    row = DataReport(
        title=report_title,
        source_filename=file.filename or "",
        domains=domain_list,
        html=html,
        top_issues=[
            {
                "category": i.category, "period": i.period, "value": i.value,
                "prevValue": i.prev_value, "pctChange": i.pct_change, "zScore": i.z_score,
                "severity": i.severity, "title": i.title, "detail": i.detail,
            }
            for i in issues
        ],
        raw_metrics={
            "categoryColumn": parsed.category_col, "periodColumn": parsed.period_col,
            "valueColumn": parsed.value_col, "rowCount": len(parsed.rows),
            "categories": parsed.categories, "periods": parsed.periods,
        },
        narrative=narrative or "",
        chart_spec=chart_spec,
        expertise_used=expertise_used,
        domains_coordinated=domains_coordinated,
        qa_history=[],
        created_by=user.name or user.id,
    )
    db.add(row)
    audit(db, user, "insights.generate", "data_report", row.id, title=report_title, domainsCoordinated=domains_coordinated)
    db.commit()
    return _report_to_out(row)


@router.get("/reports", response_model=list[DataReportSummary])
def list_reports(db: Session = Depends(get_db), user: Profile = Depends(get_current_user)):
    rows = db.query(DataReport).order_by(DataReport.created_at.desc()).limit(50).all()
    return [
        DataReportSummary(
            id=r.id, title=r.title, source_filename=r.source_filename, domains=r.domains or [],
            top_issue_count=len(r.top_issues or []), created_at=r.created_at, created_by=r.created_by,
        )
        for r in rows
    ]


@router.get("/reports/{report_id}", response_model=DataReportOut)
def get_report(report_id: str, db: Session = Depends(get_db), user: Profile = Depends(get_current_user)):
    row = db.get(DataReport, report_id)
    if not row:
        raise HTTPException(404, "Report not found.")
    return _report_to_out(row)


@router.post("/reports/{report_id}/ask", response_model=InsightsAskResponse)
async def ask_report(
    report_id: str, req: InsightsAskRequest,
    db: Session = Depends(get_db), user: Profile = Depends(get_current_user),
):
    """Answers a follow-up question about this report, grounded in the report's own data
    plus whichever approved Expertise (from ANY domain) best matches the report's content
    and the question — surfaced back as domainsCoordinated. The exchange is appended to the
    report's qa_history and persisted, so it stays available for future reference rather
    than living only in the browser tab."""
    report = db.get(DataReport, report_id)
    if not report:
        raise HTTPException(404, "Report not found.")
    if not req.question.strip():
        raise HTTPException(400, "question is required.")
    if not claude.is_configured():
        raise HTTPException(400, "Claude isn't configured on the backend (ANTHROPIC_API_KEY missing).")

    issue_titles = "; ".join(i["title"] for i in (report.top_issues or []))
    query = f"{report.title}. {issue_titles}. {req.question}"
    matched_rows, applied = _ground(db, query, limit=4)
    system = build_system_prompt(applied)

    issues_block = "\n".join(f"- {i['title']}: {i['detail']}" for i in (report.top_issues or [])) or "(none flagged)"
    user_text = (
        f"Report: {report.title}\n"
        f"Dataset: {report.raw_metrics.get('rowCount', '?')} rows, "
        f"categories: {', '.join(report.raw_metrics.get('categories', [])[:10])}, "
        f"periods: {', '.join(report.raw_metrics.get('periods', []))}\n"
        f"Top issues flagged:\n{issues_block}\n\n"
        f"Answer as the manager responsible for this data would, grounded only in the report "
        f"above and any Expertise provided. Question: {req.question}"
    )

    try:
        answer = await claude.answer_once(system, user_text)
    except Exception as e:
        logger.warning("insights ask failed: %s", e)
        raise HTTPException(502, "Claude couldn't answer this time. Try again.") from e

    domains_coordinated = sorted({e.domain for e in matched_rows})
    expertise_used = [{"id": e.id, "name": e.name, "domain": e.domain, "version": e.version} for e in matched_rows]

    report.qa_history = [
        *(report.qa_history or []),
        {
            "question": req.question, "answer": answer, "expertiseUsed": expertise_used,
            "domainsCoordinated": domains_coordinated, "askedAt": datetime.now(timezone.utc).isoformat(),
        },
    ]
    db.commit()

    return InsightsAskResponse(answer=answer, expertiseUsed=expertise_used, domainsCoordinated=domains_coordinated)


@router.post("/reports/{report_id}/capture", response_model=InsightsCaptureResponse)
def capture_insight(
    report_id: str, req: InsightsCaptureRequest,
    db: Session = Depends(get_db), user: Profile = Depends(get_current_user),
):
    """Turns a reviewed finding (the report's own analysis, or a specific Q&A exchange)
    into governed Expertise content — a revision Proposal against an existing Expertise, or
    a new draft Expertise if none fits. Goes through the exact same propose -> review ->
    approve loop as chat/meeting capture (app/routers/proposals.py, app/routers/expertise.py)
    — nothing from here ever reaches live Expertise without a Reviewer's approval. This is
    the "discussions here build up Expertise, and future similar cases can be referred to"
    loop: once approved, the captured line is retrievable like any other Expertise content,
    including by a later Data Insights report or chat answer on a similar dataset."""
    report = db.get(DataReport, report_id)
    if not report:
        raise HTTPException(404, "Report not found.")
    if not req.text.strip():
        raise HTTPException(400, "text is required.")
    require_contributor(user, req.domain)

    source = {"type": "insight", "reportId": report.id, "title": report.title}
    if req.qa_index is not None:
        qa = (report.qa_history or [])
        if 0 <= req.qa_index < len(qa):
            source["question"] = qa[req.qa_index].get("question", "")

    changes = {"knowledge": {"add": [req.text.strip()], "remove": []}}
    if req.decision_step:
        changes["decisionLogic"] = {"add": [req.decision_step], "remove": []}

    if req.expertise_id:
        e = db.get(Expertise, req.expertise_id)
        if not e:
            raise HTTPException(404, "Expertise not found.")
        if e.status != "approved":
            raise HTTPException(400, "Can only propose a revision against approved Expertise.")
        pid = f"prop-{uuid.uuid4().hex[:8]}"
        p = Proposal(
            id=pid, expertise_id=e.id, type="revision", author=user.name, author_id=user.id,
            reason=req.reason or f"Captured from Data Insights report “{report.title}”.",
            changes=changes, status="open", sources=[source],
        )
        db.add(p)
        audit(db, user, "insights.capture", "proposal", pid, expertiseId=e.id, reportId=report.id)
        db.commit()
        return InsightsCaptureResponse(kind="proposal", id=pid, expertise_id=e.id, status="open")

    new_id = f"exp-{uuid.uuid4().hex[:8]}"
    draft = Expertise(
        id=new_id, name=f"{report.title} — captured insight", domain=req.domain, topic=req.topic or "",
        status="draft", version="0.1", owner=user.name, owner_role=user.role,
        summary=f"Captured from the Data Insights report “{report.title}”.",
        when_to_use="", knowledge=[req.text.strip()],
        decision_logic=[req.decision_step] if req.decision_step else [],
        guardrails=[], escalation=[], sources=[source], origin="insight",
    )
    db.add(draft)
    audit(db, user, "insights.capture", "expertise", new_id, reportId=report.id, kind="draft")
    db.commit()
    return InsightsCaptureResponse(kind="draft", id=new_id, expertise_id=new_id, status="draft")
