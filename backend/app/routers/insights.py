"""Data Insights — a general-purpose capability of the platform, not tied to any one
Intelligence Pill: upload any tabular data, get an automated analysis report with
proactively-flagged top issues (stored historically), and ask follow-up questions that
the platform answers by pulling in whichever domains' approved Expertise are actually
relevant — demonstrating cross-domain coordination without hardcoding a domain.

This directly answers the worked example from Keppel's webinar ("an agent that takes raw
data, generates analysis and a report automatically, stores it ... and proactively flags
the top 5 issues ... [and can] discuss the data ... as if it were the [domain] manager"),
built domain-agnostic per their own note that the solution need not be real-estate-specific.
"""

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..insights.analysis import AnalysisError, detect_issues, parse_csv
from ..insights.report import render_html
from ..llm import claude
from ..models import DataReport, Expertise, Profile
from ..prompts import build_system_prompt
from ..retrieval.index import search as retrieval_search
from ..schemas import DataReportOut, DataReportSummary, ExpertiseIn, InsightsAskRequest, InsightsAskResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/insights", tags=["insights"])

MAX_BYTES = 5 * 1024 * 1024


def _report_to_out(r: DataReport) -> DataReportOut:
    return DataReportOut.model_validate(r)


@router.post("/reports/generate", response_model=DataReportOut)
async def generate_report(
    file: UploadFile = File(...),
    title: str = Form(""),
    domains: str = Form(""),
    db: Session = Depends(get_db),
    user: Profile = Depends(get_current_user),
):
    """Parses the uploaded CSV, runs generic anomaly detection, renders an HTML report,
    and stores it. Works on any tabular data — category/period/value columns are guessed
    from headers (app.insights.analysis._pick_columns), so this isn't energy-specific."""
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
    report_title = title.strip() or f"Analysis of {file.filename or 'uploaded data'}"
    html = render_html(report_title, parsed, issues)
    domain_list = [d.strip() for d in domains.split(",") if d.strip()]

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
        created_by=user.name or user.id,
    )
    db.add(row)
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
    plus whichever approved Expertise (from ANY domain — not filtered to one Pill) best
    matches the report's content and the question. The matched Expertise's domains are
    surfaced back to the caller so the UI can show which specialist areas were coordinated."""
    report = db.get(DataReport, report_id)
    if not report:
        raise HTTPException(404, "Report not found.")
    if not req.question.strip():
        raise HTTPException(400, "question is required.")
    if not claude.is_configured():
        raise HTTPException(400, "Claude isn't configured on the backend (ANTHROPIC_API_KEY missing).")

    issue_titles = "; ".join(i["title"] for i in (report.top_issues or []))
    query = f"{report.title}. {issue_titles}. {req.question}"
    matches = retrieval_search(db, query, limit=4)
    matched_rows = (
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
        for e in matched_rows
    ]
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
    return InsightsAskResponse(
        answer=answer,
        expertiseUsed=[
            {"id": e.id, "name": e.name, "domain": e.domain, "version": e.version}
            for e in matched_rows
        ],
        domainsCoordinated=domains_coordinated,
    )
