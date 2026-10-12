"""Renders a ParsedData + detected Issues (+ optional expert-grounded narrative) into a
self-contained HTML report — the "outputs the report as HTML" part of the Keppel worked
example."""

from html import escape

from .analysis import Issue, ParsedData

_SEVERITY_COLOR = {"high": "#dc2626", "medium": "#d97706"}


def _narrative_html(narrative: str) -> str:
    """Narrative comes back as plain text with the four section headers the prompt asked
    for (see insights/narrative.py). Turn '1. Analysis' / 'Analysis' style lines into <h4>s
    and everything else into paragraphs — good enough without a full markdown renderer."""
    headers = ("Analysis", "Blind spots", "Top issues to focus on", "Potential resolutions")
    parts = []
    for raw_line in narrative.strip().splitlines():
        line = raw_line.strip()
        if not line:
            continue
        stripped = line.lstrip("0123456789. ")
        is_header = any(stripped.lower().startswith(h.lower()) for h in headers) and len(stripped) < 60
        if is_header:
            parts.append(f"<h4 style='margin:14px 0 4px'>{escape(stripped.rstrip(':'))}</h4>")
        else:
            parts.append(f"<p style='margin:2px 0;line-height:1.5'>{escape(line)}</p>")
    return "\n".join(parts)


def render_html(
    title: str, data: ParsedData, issues: list[Issue],
    narrative: str | None = None, expertise_used: list[dict] | None = None,
) -> str:
    rows_html = "".join(
        f"<tr><td style='padding:4px 10px'>{escape(i.title)}</td>"
        f"<td style='padding:4px 10px;color:{_SEVERITY_COLOR[i.severity]};font-weight:600'>{i.severity}</td>"
        f"<td style='padding:4px 10px'>{escape(i.detail)}</td></tr>"
        for i in issues
    )
    if not rows_html:
        rows_html = "<tr><td colspan='3' style='padding:8px'>No notable anomalies detected in this dataset.</td></tr>"

    narrative_section = ""
    if narrative:
        names = ", ".join(e["name"] for e in (expertise_used or []))
        grounded_line = (
            f"<p style='margin:0 0 10px;color:#6b7280;font-size:12px'>Grounded in approved Expertise: {escape(names)}</p>"
            if names else
            "<p style='margin:0 0 10px;color:#6b7280;font-size:12px'>No approved Expertise matched — general guidance only.</p>"
        )
        narrative_section = f"""
  <h3 style="margin:16px 0 4px">Expert analysis</h3>
  {grounded_line}
  <div style="font-size:14px">{_narrative_html(narrative)}</div>
"""

    return f"""
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:720px">
  <h2 style="margin:0 0 4px">{escape(title)}</h2>
  <p style="color:#6b7280;margin:0 0 16px">
    {len(data.rows)} rows · {len(data.categories)} categories ({escape(', '.join(data.categories[:6]))}{'…' if len(data.categories) > 6 else ''})
    · {len(data.periods)} periods ({escape(data.periods[0])} to {escape(data.periods[-1])})
  </p>
  <h3 style="margin:16px 0 8px">Top issues flagged</h3>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    <thead><tr style="text-align:left;border-bottom:1px solid #e5e7eb">
      <th style="padding:4px 10px">Issue</th><th style="padding:4px 10px">Severity</th><th style="padding:4px 10px">Detail</th>
    </tr></thead>
    <tbody>{rows_html}</tbody>
  </table>
{narrative_section}
</div>
""".strip()
