"""Generic data-analysis pipeline: turns any uploaded tabular data into an automated report
with proactively-flagged top issues, independent of domain. Mirrors what Keppel's webinar
asked for as a worked example ("an agent that takes raw data, generates analysis and a
report automatically ... and proactively flags the top 5 issues management should be
looking at") — but built domain-agnostic, since the brief is explicit that the solution
need not be real-estate- or energy-specific.

No pandas dependency: stdlib csv + a little arithmetic is enough for this.
"""

import csv
import io
import statistics
from dataclasses import dataclass, field

# Column-name hints used to guess which column is the time axis vs. the metric. Order matters —
# first match wins.
_PERIOD_HINTS = ("period", "month", "date", "week", "day", "time")
_VALUE_HINTS = ("usage", "cost", "value", "amount", "count", "total", "spend", "consumption", "reading")


@dataclass
class ParsedData:
    category_col: str
    period_col: str
    value_col: str
    rows: list[dict]  # [{category, period, value}], value coerced to float
    categories: list[str]
    periods: list[str]


class AnalysisError(ValueError):
    pass


def _coerce_float(raw: str) -> float | None:
    cleaned = "".join(c for c in str(raw).strip() if c.isdigit() or c in ".-")
    if not cleaned or cleaned in ("-", "."):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _pick_columns(headers: list[str], sample_rows: list[dict]) -> tuple[str, str, str]:
    lower = {h: h.lower() for h in headers}

    def find(hints):
        for h in headers:
            if any(hint in lower[h] for hint in hints):
                return h
        return None

    period_col = find(_PERIOD_HINTS)
    value_col = find(_VALUE_HINTS)

    # Fall back: whichever remaining column is numeric across the sample becomes the value column.
    if value_col is None:
        for h in headers:
            if h == period_col:
                continue
            if sample_rows and all(_coerce_float(r.get(h, "")) is not None for r in sample_rows if r.get(h) not in (None, "")):
                value_col = h
                break

    remaining = [h for h in headers if h not in (period_col, value_col)]
    if period_col is None and remaining:
        # Guess the period column as whichever remaining column isn't the obvious category —
        # prefer one that looks sequential/short; otherwise just take the next remaining column.
        period_col = remaining[0]
        remaining = remaining[1:]

    category_col = remaining[0] if remaining else (headers[0] if headers else None)

    if not all([category_col, period_col, value_col]):
        raise AnalysisError(
            "Could not identify a category, period and numeric value column in this file. "
            "Expected at least 3 columns, e.g. category, period, value."
        )
    return category_col, period_col, value_col


def parse_csv(raw_text: str) -> ParsedData:
    reader = csv.DictReader(io.StringIO(raw_text))
    headers = reader.fieldnames or []
    if len(headers) < 2:
        raise AnalysisError("This file doesn't look like tabular data (need at least 2 columns).")
    all_rows = [r for r in reader if any((v or "").strip() for v in r.values())]
    if not all_rows:
        raise AnalysisError("No data rows found in this file.")

    category_col, period_col, value_col = _pick_columns(headers, all_rows[:50])

    rows = []
    for r in all_rows:
        value = _coerce_float(r.get(value_col, ""))
        if value is None:
            continue
        rows.append({
            "category": (r.get(category_col) or "").strip() or "(unlabelled)",
            "period": (r.get(period_col) or "").strip() or "(unknown)",
            "value": value,
        })
    if not rows:
        raise AnalysisError(f"Column '{value_col}' had no readable numeric values.")

    categories = sorted({r["category"] for r in rows})
    periods = sorted({r["period"] for r in rows})
    return ParsedData(category_col, period_col, value_col, rows, categories, periods)


@dataclass
class Issue:
    category: str
    period: str
    value: float
    prev_value: float | None
    pct_change: float | None
    z_score: float | None
    severity: str  # "high" | "medium"
    title: str
    detail: str


def detect_issues(data: ParsedData, top_n: int = 5) -> list[Issue]:
    """Flags the top N category/period points that look anomalous: either a large jump
    vs. the previous period for that category, or a large deviation from that category's
    own mean (z-score) — whichever signal is stronger. Generic across any domain's data."""
    by_category: dict[str, list[tuple[str, float]]] = {}
    for r in data.rows:
        by_category.setdefault(r["category"], []).append((r["period"], r["value"]))

    candidates: list[Issue] = []
    for category, points in by_category.items():
        points = sorted(points, key=lambda p: p[0])
        values = [v for _, v in points]
        mean = statistics.fmean(values)
        std = statistics.pstdev(values) if len(values) > 1 else 0.0

        prev_value = None
        for period, value in points:
            z = (value - mean) / std if std > 1e-9 else None
            pct = ((value - prev_value) / prev_value * 100) if prev_value and prev_value != 0 else None

            score = max(abs(z) if z is not None else 0, abs(pct) / 50 if pct is not None else 0)
            if score > 0.01 and (z is not None or pct is not None):
                direction = "up" if value >= (prev_value if prev_value is not None else mean) else "down"
                severity = "high" if (z is not None and abs(z) >= 2) or (pct is not None and abs(pct) >= 50) else "medium"
                bits = []
                if pct is not None:
                    bits.append(f"{pct:+.0f}% vs. the previous period")
                if z is not None:
                    bits.append(f"{z:+.1f}σ from {category}'s own average")
                detail = f"{category} in {period}: {value:g} ({'; '.join(bits) or 'no prior baseline'})."
                candidates.append(Issue(
                    category=category, period=period, value=value,
                    prev_value=prev_value, pct_change=pct, z_score=z,
                    severity=severity,
                    title=f"{category} {'spiked' if direction == 'up' else 'dropped'} in {period}",
                    detail=detail,
                ))
            prev_value = value

    candidates.sort(key=lambda i: max(abs(i.z_score or 0), abs((i.pct_change or 0) / 50)), reverse=True)
    return candidates[:top_n]
