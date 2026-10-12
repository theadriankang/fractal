// Shared helpers for decisionLogic entries, which may be a plain string (legacy data) or a
// structured { text, condition, action, reasoning, escalateIf } object (mirrors the backend's
// DecisionStep -- backend/app/schemas.py). Every place that reads, dedupes or diffs a list field
// should use these instead of comparing/joining raw values -- they work the same for plain
// strings as for structured decisionLogic entries, so nothing else needs its own branch.

// Comparable identity for a list-field entry: the plain string itself, or a structured step's
// `text` (its stable identity -- mirrors backend/app/governance.py's _item_key).
export const itemKey = (x) => (typeof x === 'string' ? x : (x?.text || ''))

// Flattens one decisionLogic entry into a single readable line, folding in condition/action/
// reasoning/escalateIf when present (mirrors backend/app/schemas.py's decision_step_text).
// Safe to call on a plain string too -- returns it unchanged.
export function decisionStepText(x) {
  if (typeof x === 'string') return x
  if (!x) return ''
  const text = (x.text || '').trim()
  const bits = []
  if (x.condition?.trim()) bits.push(`if ${x.condition.trim()}`)
  if (x.action?.trim()) bits.push(`then ${x.action.trim()}`)
  if (x.reasoning?.trim()) bits.push(`because ${x.reasoning.trim()}`)
  if (x.escalateIf?.trim()) bits.push(`escalate if ${x.escalateIf.trim()}`)
  const extra = bits.join('; ')
  if (text && extra) return `${text} (${extra})`
  return text || extra
}

// True when x carries a structured breakdown (used by UI to decide whether to render the
// expanded card or just the plain text line).
export const isStructuredStep = (x) =>
  !!x && typeof x === 'object' && !!(x.condition?.trim() || x.action?.trim() || x.reasoning?.trim() || x.escalateIf?.trim())

// Normalizes every decisionLogic entry on a list of Expertise-shaped objects into the
// structured shape (wrapping legacy plain strings), without requiring every demo/seed data
// entry to be hand-authored as an object. Safe no-op on entries already structured.
export function normalizeExpertiseDecisionLogic(list) {
  return (list || []).map((e) => (
    Array.isArray(e?.decisionLogic)
      ? { ...e, decisionLogic: e.decisionLogic.map((x) => (typeof x === 'string' ? { text: x, condition: '', action: '', reasoning: '', escalateIf: '' } : x)) }
      : e
  ))
}
