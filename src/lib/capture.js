// Know-how capture from chat ("AI Harvest").
// After an answer finishes, the latest exchange goes to POST /api/expertise/extract, which returns
// a Detection: { kind: 'none'|'new'|'revision', confidence, reason, target:{domain, topic, expertiseId?,
// expertiseName?}, draft?, items:[{field, text, quote}], allowed, blockedReason, source }.
// When the backend can't be used, the old keyword detector (mockApi.detectExpertise) is adapted
// to the same shape so the card and the governance flow behave the same in demo mode.

import { TAXONOMY } from '../data/taxonomy'
import { contributeBlock } from './permissions'

export const CAPTURE_MIN_WORDS = 12
export const FIELD_LABELS = { knowledge: 'Knowledge', decisionLogic: 'Decision logic', guardrails: 'Guardrails', escalation: 'Escalation' }
export const FIELD_ORDER = ['knowledge', 'decisionLogic', 'guardrails', 'escalation']

const words = (s) => (s.toLowerCase().match(/[a-z0-9°%.]+/g) || []).filter((w) => w.length > 2)

/** Up to `k` approved Expertise most related to `text` (keyword + name overlap), `first` ones always included. */
export function similarExpertise(text, all, first = [], k = 5) {
  const t = new Set(words(text))
  const scored = all
    .filter((e) => e.status === 'approved' && !first.some((f) => f.id === e.id))
    .map((e) => ({
      e,
      score: (e.keywords || []).filter((kw) => text.toLowerCase().includes(kw)).length * 2 + words(e.name).filter((w) => t.has(w)).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e)
  return [...first, ...scored].slice(0, k)
}

const brief = (e) => ({
  id: e.id, name: e.name, domain: e.domain, topic: e.topic || '', status: e.status, summary: e.summary || '',
  knowledge: e.knowledge, decisionLogic: e.decisionLogic, guardrails: e.guardrails, escalation: e.escalation,
})

/** Request body for /api/expertise/extract: the last few turns ending with this exchange. */
export function buildExtractRequest({ user, chat, asstMsgId, used, expertise }) {
  const end = chat.messages.findIndex((m) => m.id === asstMsgId)
  const turns = chat.messages
    .slice(0, end + 1)
    .map((m) => (m.role === 'user'
      ? { role: 'user', content: m.content }
      : { role: 'assistant', content: (m.responses.find((r) => r.content) || {}).content || '' }))
    .filter((t) => t.content)
    .slice(-6)
  const lastUser = [...turns].reverse().find((t) => t.role === 'user')?.content || ''
  return {
    user: { name: user.name, role: user.role, domains: user.domains || [] },
    turns,
    taxonomy: TAXONOMY.map(({ domain, topics }) => ({ domain, topics })),
    candidates: similarExpertise(lastUser, expertise, used).map(brief),
  }
}

/** Adapts the offline keyword detector's output to the Detection shape. */
export function fromKeywordDetector(det, user, expertise) {
  if (!det) return null
  if (det.kind === 'revision') {
    const e = expertise.find((x) => x.id === det.expertiseId)
    if (!e) return null
    const block = contributeBlock(user, e.domain)
    return {
      kind: 'revision', confidence: null, reason: 'Matched by keywords (offline mode).', source: 'keyword',
      target: { domain: e.domain, topic: e.topic, expertiseId: e.id, expertiseName: e.name },
      items: [{ field: 'knowledge', text: det.addition, quote: det.addition }],
      allowed: !block, blockedReason: block,
    }
  }
  const d = det.draft
  const block = contributeBlock(user, d.domain)
  return {
    kind: 'new', confidence: null, reason: 'Matched by keywords (offline mode).', source: 'keyword',
    target: { domain: d.domain, topic: d.topic },
    draft: { name: d.name, domain: d.domain, topic: d.topic, assetTypes: d.assetTypes, summary: d.summary, whenToUse: d.whenToUse, keywords: [] },
    items: d.knowledge.map((k) => ({ field: 'knowledge', text: k, quote: k })),
    allowed: !block, blockedReason: block,
  }
}
