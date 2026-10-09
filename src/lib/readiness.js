// What a draft Expertise needs before its owner can submit it for review.
// Shown as a checklist on the draft page and as "still needed" hints on the capture card.

export const READINESS = [
  { key: 'name', label: 'A clear name', required: true, ok: (e) => !!e.name?.trim() && !/^untitled|^new .* expertise$/i.test(e.name.trim()) },
  { key: 'summary', label: 'One-sentence summary', required: true, ok: (e) => !!e.summary?.trim() },
  { key: 'whenToUse', label: 'When to use it', required: true, ok: (e) => !!e.whenToUse?.trim() },
  { key: 'knowledge', label: 'At least one piece of knowledge or a decision step', required: true, ok: (e) => (e.knowledge?.length || 0) + (e.decisionLogic?.length || 0) > 0 },
  { key: 'guardrails', label: 'At least one guardrail (what must never be done)', required: true, ok: (e) => (e.guardrails?.length || 0) > 0 },
  { key: 'escalation', label: 'At least one escalation rule (when a human takes over)', required: true, ok: (e) => (e.escalation?.length || 0) > 0 },
  { key: 'decisionLogic', label: 'Decision steps in order', required: false, ok: (e) => (e.decisionLogic?.length || 0) > 0 },
  { key: 'keywords', label: 'Keywords so it gets matched in chat', required: false, ok: (e) => (e.keywords?.length || 0) > 0 },
]

export function readiness(e) {
  const checks = READINESS.map((r) => ({ ...r, done: r.ok(e) }))
  const missing = checks.filter((c) => c.required && !c.done)
  return { checks, missing, ready: missing.length === 0 }
}
