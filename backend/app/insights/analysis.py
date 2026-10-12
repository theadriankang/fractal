"""Generic data-analysis pipeline: turns any uploaded tabular data into an automated report
with proactively-flagged top issues, independent of domain. Mirrors what Keppel's webinar
asked for as a worked example ("an agent that takes raw data, generates analysis and a
report automatically ... and proactively flags the top 5 issues management should be
looking at") — but built domain-agnostic, since the brief is explicit that the solution
need not be real-estate- or energy-specific.

Real-world uploads don't all share one shape, so this doesn't force everything into a
single "category, period, value" mould. Three shapes are detected automatically:

- "long": the data already has an explicit category + period + value column (e.g. a usage
  log: level, month, usage_kwh). Anomaly detection compares each category's values across
  its own periods -- the original, most common case.
- "wide": no period column, but two or more numeric columns whose headers differ only by an
  embedded number (e.g. "2018energyuseintensity" / "2019energyusintensity", or "q1_revenue"
  / "q2_revenue") -- these are melted into (category, period, value) triples, where the
  embedded number becomes the period. This is the common "one row per entity, one column
  per year/quarter" shape spreadsheets are often exported in.
- "snapshot": a pure cross-sectional listing -- one row per entity, a single numeric value
  column, no time axis at all (e.g. a one-time building listing). There's nothing to compare
  a category against *over time*, so anomaly detection instead flags entities whose value is
  an outlier against the whole population (population z-score), not a trend.

No pandas dependency: stdlib csv + a little arithmetic is enough for this.
"""

import csv
import difflib
import io
import re
import statistics
from dataclasses import dataclass, field

from openpyxl import load_workbook

# Column-name hints used to guess which column is the time axis vs. the metric in the "long"
# shape. Order matters -- first match wins.
_PERIOD_HINTS = ("period", "month", "date", "week", "day", "time")
_VALUE_HINTS = ("usage", "cost", "value", "amount", "count", "total", "spend", "consumption", "reading")

# Values that mean "missing" even though they're non-empty strings -- common spreadsheet
# conventions that would otherwise show up as a literal, misleading category/period label
# like "N/A spiked in N/A".
_MISSING_MARKERS = {"", "n/a", "na", "null", "none", "-", "--", "nil"}


@dataclass
class ParsedData:
    category_col: str
    period_col: str
    value_col: str
    rows: list[dict]  # [{category, period, value}], value coerced to float
    categories: list[str]
    periods: list[str]
    shape: str = "long"  # "long" | "wide" | "snapshot" -- see module docstring


class AnalysisError(ValueError):
    pass


def _coerce_float(raw) -> float | None:
    """Parses a cell as a number, tolerating common spreadsheet formatting (thousands
    separators, currency symbols, a trailing "%"). Rejects anything containing a letter --
    without this, a free-text cell like "1 Raffles Pl" would otherwise have its non-digit
    characters stripped down to "1" and get misread as a numeric value, which previously
    caused text columns (e.g. an address column) to be mistaken for the metric to analyse."""
    s = str(raw).strip()
    if not s or any(c.isalpha() for c in s):
        return None
    cleaned = "".join(c for c in s if c.isdigit() or c in ".-")
    if not cleaned or cleaned in ("-", "."):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _is_missing(raw) -> bool:
    return str(raw).strip().lower() in _MISSING_MARKERS


def _clean_label(raw) -> str:
    """A category/period cell value, normalised to '(unlabelled)' for any of the common
    missing-data conventions -- so a sparse column never produces a nonsense "N/A spiked in
    N/A" issue title."""
    s = str(raw).strip()
    return s if s and s.lower() not in _MISSING_MARKERS else "(unlabelled)"


def _is_numeric_col(header: str, sample_rows: list[dict], min_present: int = 1) -> bool:
    """True if every non-missing value in this column, across the sample, parses as a
    number -- and at least `min_present` of them actually do (an all-missing column is not
    numeric, it's just empty)."""
    present = 0
    for r in sample_rows:
        v = r.get(header, "")
        if _is_missing(v):
            continue
        if _coerce_float(v) is None:
            return False
        present += 1
    return present >= min_present


def _best_category_col(headers: list[str], sample_rows: list[dict], exclude: set[str]) -> str | None:
    """Among the candidate (non-excluded) columns, picks whichever has the fewest missing
    values -- the one most likely to actually identify each row, rather than e.g. an address
    column that's frequently blank when a name column isn't. Ties go to whichever appears
    first (leftmost), to stay predictable."""
    candidates = [h for h in headers if h not in exclude]
    if not candidates:
        return None
    best, best_score = None, -1
    for h in candidates:
        present = sum(1 for r in sample_rows if not _is_missing(r.get(h, "")))
        if present > best_score:
            best, best_score = h, present
    return best


def _find_period_hint(headers: list[str]) -> str | None:
    for h in headers:
        if any(hint in h.lower() for hint in _PERIOD_HINTS):
            return h
    return None


def _find_value_hint(headers: list[str], sample_rows: list[dict], exclude: set[str]) -> str | None:
    for h in headers:
        if h in exclude:
            continue
        if any(hint in h.lower() for hint in _VALUE_HINTS):
            return h
    # Fall back to the first column that's fully numeric across the sample.
    for h in headers:
        if h in exclude:
            continue
        if _is_numeric_col(h, sample_rows):
            return h
    return None


_DIGIT_RUN = re.compile(r"\d+")


def _find_wide_melt_group(headers: list[str], sample_rows: list[dict], exclude: set[str]) -> list[tuple[str, str]] | None:
    """Looks for 2+ numeric columns whose header names are (near-)identical except for an
    embedded number (a year, a quarter, a version...) -- e.g. "2018energyuseintensity" and
    "2019energyusintensity" differ only in "2018"/"2019" once the digits are stripped out.
    Grouping tolerates small spelling inconsistencies between the otherwise-matching headers
    (real exports aren't always internally consistent -- e.g. a one-letter typo between a
    year's column and the next year's) by clustering on text similarity rather than requiring
    an exact match. Returns [(header, digit_token), ...] for the largest such group, or None
    if no such group exists. This is what lets a "one row per entity, one column per
    year" export melt into the same (category, period, value) shape a long-format upload
    already produces."""
    candidates: list[tuple[str, str, str]] = []  # (header, digit_token, digit-stripped text)
    for h in headers:
        if h in exclude:
            continue
        if not _is_numeric_col(h, sample_rows):
            continue
        digits = "".join(_DIGIT_RUN.findall(h))
        if not digits:
            continue  # nothing to distinguish this column from a same-shaped sibling
        candidates.append((h, digits, _DIGIT_RUN.sub("", h)))

    groups: list[list[tuple[str, str, str]]] = []
    for item in candidates:
        _, _, stripped = item
        match = next(
            (g for g in groups if difflib.SequenceMatcher(None, stripped, g[0][2]).ratio() >= 0.82),
            None,
        )
        if match is not None:
            match.append(item)
        else:
            groups.append([item])
    best = max((g for g in groups if len(g) >= 2), key=len, default=None)
    if best is None:
        return None
    return [(h, d) for h, d, _ in best]


def _period_label_for(digit_tokens: list[str]) -> str:
    """A human label for the melted period axis -- "year" when every token looks like a
    plausible calendar year, otherwise the generic "period"."""
    try:
        if all(len(t) == 4 and 1900 <= int(t) <= 2099 for t in digit_tokens):
            return "year"
    except ValueError:
        pass
    return "period"


def _pick_shape(headers: list[str], sample_rows: list[dict]):
    """Decides which of the three shapes (see module docstring) this upload is, and returns
    the columns needed to parse it. Returns one of:
      ("long", category_col, period_col, value_col)
      ("wide", category_col, melt_group)           # melt_group: [(header, digit_token), ...]
      ("snapshot", category_col, value_col)
    Raises AnalysisError if nothing usable can be found."""
    period_col = _find_period_hint(headers)
    value_col = _find_value_hint(headers, sample_rows, exclude={period_col} if period_col else set())

    if period_col and value_col:
        category_col = _best_category_col(headers, sample_rows, exclude={period_col, value_col})
        if category_col:
            return "long", category_col, period_col, value_col

    # No reliable period column -- look for a "one column per year/quarter" wide shape before
    # falling back to a plain snapshot. This runs whether or not a period hint matched, since
    # a stray column named e.g. "update_date" could win _find_period_hint on a dataset that's
    # actually wide -- the melt group, when one exists, is the stronger signal.
    melt_group = _find_wide_melt_group(headers, sample_rows, exclude=set())
    if melt_group:
        value_headers = {h for h, _ in melt_group}
        category_col = _best_category_col(headers, sample_rows, exclude=value_headers)
        if category_col:
            return "wide", category_col, melt_group

    if value_col:
        category_col = _best_category_col(headers, sample_rows, exclude={value_col})
        if category_col:
            return "snapshot", category_col, value_col

    raise AnalysisError(
        "Could not find a numeric column to analyse in this file, or couldn't tell which "
        "column identifies each row. Expected at least one numeric column and one label "
        "column (e.g. a name, category or address)."
    )


def _build_long_rows(headers, all_rows, category_col, period_col, value_col):
    rows = []
    for r in all_rows:
        value = _coerce_float(r.get(value_col, ""))
        if value is None:
            continue
        rows.append({
            "category": _clean_label(r.get(category_col, "")),
            "period": _clean_label(r.get(period_col, "")),
            "value": value,
        })
    return rows, value_col, period_col


def _build_wide_rows(headers, all_rows, category_col, melt_group):
    digit_tokens = [d for _, d in melt_group]
    period_label = _period_label_for(digit_tokens)
    # The value column's display name is the shared text the melted headers had in common
    # (e.g. "energyuseintensity" out of "2018energyuseintensity"/"2019energyusintensity").
    value_label = _DIGIT_RUN.sub("", melt_group[0][0]).strip("_ -") or "value"
    rows = []
    for r in all_rows:
        category = _clean_label(r.get(category_col, ""))
        for header, digits in melt_group:
            value = _coerce_float(r.get(header, ""))
            if value is None:
                continue
            rows.append({"category": category, "period": digits, "value": value})
    return rows, value_label, period_label


def _build_snapshot_rows(headers, all_rows, category_col, value_col):
    rows = []
    for r in all_rows:
        value = _coerce_float(r.get(value_col, ""))
        if value is None:
            continue
        rows.append({"category": _clean_label(r.get(category_col, "")), "period": "(snapshot)", "value": value})
    return rows, value_col, "(snapshot)"


def _parse_rows(headers: list[str], all_rows: list[dict]) -> ParsedData:
    """Shared tabular-data pipeline, format-independent: both parse_csv (list[dict] from
    csv.DictReader) and parse_xlsx (list[dict] built from an openpyxl sheet) funnel through
    here once they've reduced their own format to the same {header: cell-value} row shape.
    Keeping this in one place means shape detection, coercion and validation behave
    identically regardless of which file format the data came from."""
    if len(headers) < 2:
        raise AnalysisError("This file doesn't look like tabular data (need at least 2 columns).")
    all_rows = [r for r in all_rows if any(not _is_missing(v) for v in r.values())]
    if not all_rows:
        raise AnalysisError("No data rows found in this file.")

    sample = all_rows[:100]
    shape, *rest = _pick_shape(headers, sample)

    if shape == "long":
        category_col, period_col, value_col = rest
        rows, value_label, period_label = _build_long_rows(headers, all_rows, category_col, period_col, value_col)
    elif shape == "wide":
        category_col, melt_group = rest
        rows, value_label, period_label = _build_wide_rows(headers, all_rows, category_col, melt_group)
    else:  # "snapshot"
        category_col, value_col = rest
        rows, value_label, period_label = _build_snapshot_rows(headers, all_rows, category_col, value_col)

    if not rows:
        raise AnalysisError("Found candidate columns, but none of the values in them were readable numbers.")

    categories = sorted({r["category"] for r in rows})
    periods = sorted({r["period"] for r in rows})
    return ParsedData(category_col, period_label, value_label, rows, categories, periods, shape=shape)


def parse_csv(raw_text: str) -> ParsedData:
    reader = csv.DictReader(io.StringIO(raw_text))
    headers = reader.fieldnames or []
    return _parse_rows(headers, list(reader))


def parse_xlsx(raw_bytes: bytes) -> ParsedData:
    """Same pipeline as parse_csv, for an uploaded .xlsx file. Reads the first (or only)
    worksheet, treats its first row as headers, and converts every other row into the same
    {header: cell-value} shape _parse_rows expects -- so shape detection and anomaly
    detection work identically regardless of upload format."""
    try:
        wb = load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
    except Exception as e:
        raise AnalysisError(f"Couldn't read this as an Excel file: {e}") from e

    try:
        ws = wb.active
        if ws is None:
            raise AnalysisError("This workbook has no worksheets.")
        rows_iter = ws.iter_rows(values_only=True)
        try:
            header_row = next(rows_iter)
        except StopIteration:
            raise AnalysisError("This workbook's first sheet is empty.")

        headers = [str(h).strip() if h is not None else "" for h in header_row]
        headers = [h for h in headers if h]  # drop trailing blank header cells
        if len(headers) < 2:
            raise AnalysisError("This file doesn't look like tabular data (need at least 2 columns).")

        all_rows = []
        for row in rows_iter:
            cells = dict(zip(headers, row))
            all_rows.append({k: ("" if v is None else v) for k, v in cells.items()})
    finally:
        wb.close()

    return _parse_rows(headers, all_rows)


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


def _detect_issues_trend(data: ParsedData, top_n: int) -> list[Issue]:
    """Original algorithm, for "long" and "wide" shapes: flags the top N category/period
    points that look anomalous versus that category's own history -- either a large jump
    vs. the previous period, or a large deviation from that category's own mean."""
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


def _detect_issues_snapshot(data: ParsedData, top_n: int) -> list[Issue]:
    """For "snapshot" shape: there's only one value per category, so there's no history to
    compare against -- instead this flags entities whose value is an outlier against the
    whole population (every row's z-score relative to the dataset's overall mean/std)."""
    values = [r["value"] for r in data.rows]
    if len(values) < 2:
        return []
    mean = statistics.fmean(values)
    std = statistics.pstdev(values)
    if std <= 1e-9:
        return []

    candidates: list[Issue] = []
    for r in data.rows:
        z = (r["value"] - mean) / std
        if abs(z) < 1.0:
            continue
        direction = "above" if z > 0 else "below"
        severity = "high" if abs(z) >= 2 else "medium"
        detail = f"{r['category']}: {r['value']:g} ({z:+.1f}σ {direction} the average of {mean:.3g})."
        candidates.append(Issue(
            category=r["category"], period=r["period"], value=r["value"],
            prev_value=None, pct_change=None, z_score=z,
            severity=severity,
            title=f"{r['category']} is an outlier ({direction} average)",
            detail=detail,
        ))
    candidates.sort(key=lambda i: abs(i.z_score or 0), reverse=True)
    return candidates[:top_n]


def detect_issues(data: ParsedData, top_n: int = 5) -> list[Issue]:
    """Flags the top N most anomalous points in the dataset, generically across any domain
    and any of the three shapes _parse_rows can produce (see module docstring)."""
    if data.shape == "snapshot":
        return _detect_issues_snapshot(data, top_n)
    return _detect_issues_trend(data, top_n)


def build_chart_spec(data: ParsedData, max_series: int = 8) -> dict:
    """A ready-to-render chart spec (see src/components/ChartBlock.jsx) summarising the
    dataset. "long"/"wide" shapes get a trend line of every category's values across
    periods, capped to the `max_series` largest-range categories so a dataset with many
    categories doesn't render an unreadable chart. "snapshot" shape has no time axis, so it
    gets a bar chart of the most extreme values instead -- a line with one point per
    category wouldn't show anything."""
    if data.shape == "snapshot":
        top = sorted(data.rows, key=lambda r: r["value"], reverse=True)[:max_series * 2]
        return {
            "type": "bar",
            "title": f"{data.value_col} by {data.category_col} (top {len(top)})",
            "data": [{"category": r["category"], data.value_col: r["value"]} for r in top],
            "xKey": "category",
            "series": [data.value_col],
        }

    by_period: dict[str, dict[str, float]] = {}
    ranges: dict[str, float] = {}
    by_category: dict[str, list[float]] = {}
    for r in data.rows:
        by_period.setdefault(r["period"], {})[r["category"]] = r["value"]
        by_category.setdefault(r["category"], []).append(r["value"])
    for cat, values in by_category.items():
        ranges[cat] = (max(values) - min(values)) if len(values) > 1 else 0.0

    categories = sorted(data.categories, key=lambda c: ranges.get(c, 0.0), reverse=True)[:max_series]
    chart_rows = [
        {"period": period, **{cat: by_period.get(period, {}).get(cat) for cat in categories}}
        for period in data.periods
    ]
    return {
        "type": "line",
        "title": f"{data.value_col} by {data.category_col}, over {data.period_col}",
        "data": chart_rows,
        "xKey": "period",
        "series": categories,
    }
