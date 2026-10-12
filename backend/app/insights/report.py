"""Renders a ParsedData + detected Issues into a self-contained HTML report — the "outputs
the report as HTML" part of the Keppel worked example. The Expertise-grounded narrative is
real markdown (headings, bold, lists) and is rendered client-side with ReactMarkdown instead
of being baked in here — see src/pages/Insights.jsx."""

from html import escape

from .analysis import Issue, ParsedData

_SEVERITY_COLOR = {"high": "#dc2626", "medium": "#d97706"}


def render_html(title: str, data: ParsedData, issues: list[Issue]) -> str:
    rows_html = "".join(
        f"<tr><td style='padding:4px 10px'>{escape(i.title)}</td>"
        f"<td style='padding:4px 10px;color:{_SEVERITY_COLOR[i.severity]};font-weight:600'>{i.severity}</td>"
        f"<td style='padding:4px 10px'>{escape(i.detail)}</td></tr>"
        for i in issues
    )
    if not rows_html:
        rows_html = "<tr><td colspan='3' style='padding:8px'>No notable anomalies detected in this dataset.</td></tr>"

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
</div>
""".strip()
