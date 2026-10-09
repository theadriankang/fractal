// Closing the loop (docs/FEEDBACK_LOOP.md): 👎 corrections → precise proposals → before/after
// test → reviewer approves → per-version health. Pure helpers used by the store and the UI.
//
// Live path: POST /api/loop/correction and /api/loop/test (Claude). When the backend can't be
// used, offlineCorrection() / offlineTestRun() give the same shapes, clearly labelled offline.

export const DIAGNOSIS = {
  expertise_wrong: { label: 'Outdated or wrong', tone: 'red' },
  expertise_incomplete: { label: 'Missing step or rule', tone: 'amber' },
  scope_wrong: { label: 'Applied out of scope', tone: 'indigo' },
  model_ignored: { label: 'Answer ignored the Expertise', tone: 'gray' },
  not_actionable: { label: 'No specific change', tone: 'gray' },
}

const LIST_FIELDS = ['knowledge', 'decisionLogic', 'guardrails', 'escalation']
const MAX_TEST_CASES = 20 // saved per Expertise
const RUN_CASES = 6 // saved questions per test run, plus the proposal's own question

const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 9)}`
const now = () => new Date().toISOString()
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9°%.\s]/g, ' ').replace(/\s+/g, ' ').trim()
const words = (s) => new Set(norm(s).split(' ').map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w.length > 2 || /\d/.test(w)))

/** Word-overlap similarity (Jaccard) between two texts, 0–1. */
export function similarity(a, b) {
  const A = words(a), B = words(b)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const w of A) if (B.has(w)) hit += 1
  return hit / (A.size + B.size - hit)
}

// ---------------------------------------------------------------- applying a change

/** Applies one list change. Removed lines are replaced in place when lines are added in the
 *  same change; `insertAfter` (index of the step new lines follow, -1 = first) keeps step order. */
export function applyListChange(list = [], { add = [], remove = [], insertAfter = null } = {}) {
  const fresh = add.filter((x) => !list.includes(x) || remove.includes(x))
  const firstRemoved = list.findIndex((x) => remove.includes(x))
  if (firstRemoved >= 0 && fresh.length) {
    const out = list.filter((x, i) => i < firstRemoved || !remove.includes(x))
    out.splice(firstRemoved, 0, ...fresh)
    return out
  }
  const kept = list.filter((x) => !remove.includes(x))
  if (insertAfter == null) return [...kept, ...fresh]
  const anchor = insertAfter >= 0 ? list[insertAfter] : null
  const pos = anchor == null ? -1 : kept.indexOf(anchor)
  const at = anchor == null ? 0 : pos < 0 ? kept.length : pos + 1
  const out = [...kept]
  out.splice(at, 0, ...fresh)
  return out
}

/** The content patch a proposal makes: list fields + any `set` string fields (e.g. whenToUse). */
export function applyChanges(e, changes = {}, set = {}) {
  const patch = {}
  for (const [field, change] of Object.entries(changes)) {
    if (LIST_FIELDS.includes(field)) patch[field] = applyListChange(e[field] || [], change)
  }
  for (const [field, value] of Object.entries(set || {})) {
    if (typeof value === 'string' && value.trim()) patch[field] = value.trim()
  }
  return patch
}

/** Adds a second report's lines to an open proposal without duplicating any. */
export function mergeChanges(into = {}, extra = {}) {
  const out = structuredClone(into)
  for (const [field, { add = [], remove = [], insertAfter = null }] of Object.entries(extra)) {
    out[field] ??= { add: [], remove: [] }
    for (const a of add) if (!out[field].add.some((x) => similarity(x, a) > 0.8)) out[field].add.push(a)
    for (const r of remove) if (!out[field].remove.includes(r)) out[field].remove.push(r)
    if (out[field].insertAfter == null && insertAfter != null) out[field].insertAfter = insertAfter
  }
  return out
}

// ---------------------------------------------------------------- correction request

const loopExpertise = (e, snap) => ({
  id: e.id, name: e.name, version: e.version, status: e.status, owner: e.owner || '', domain: e.domain || '',
  summary: e.summary || '', whenToUse: e.whenToUse || '',
  knowledge: [...(snap?.knowledge ?? e.knowledge ?? [])], decisionLogic: [...(snap?.decisionLogic ?? e.decisionLogic ?? [])],
  guardrails: [...(snap?.guardrails ?? e.guardrails ?? [])], escalation: [...(snap?.escalation ?? e.escalation ?? [])],
  ...(snap?.whenToUse != null ? { whenToUse: snap.whenToUse } : {}),
})

/** The Expertise as it was at `version` (from its version snapshots), else as it is now. */
export function atVersion(e, version) {
  const v = version && version !== e.version ? e.versions?.find((x) => x.version === version) : null
  return { ...loopExpertise(e, v?.snapshot), version: version || e.version }
}

/** Body for POST /api/loop/correction. */
export function buildCorrectionRequest({ user, chat, msgId, idx, correction, targetId, expertise, proposals }) {
  const end = chat.messages.findIndex((m) => m.id === msgId)
  const msg = chat.messages[end]
  const r = msg.responses[idx]
  const turns = chat.messages
    .slice(0, end)
    .map((m) => (m.role === 'user'
      ? { role: 'user', content: m.content }
      : { role: 'assistant', content: (m.responses.find((x) => x.content) || {}).content || '' }))
    .filter((t) => t.content)
    .slice(-6)
  const used = r.expertise.map((ref) => {
    const e = expertise.find((x) => x.id === ref.id)
    return e ? atVersion(e, ref.version) : null
  }).filter(Boolean)
  const ids = new Set(used.map((e) => e.id))
  return {
    user: { name: user.name, role: user.role, domains: user.domains || [] },
    turns: turns.length ? turns : [{ role: 'user', content: '(no question)' }],
    answer: r.content || '',
    correction: correction.trim(),
    expertise: used,
    targetId: targetId || null,
    openProposals: proposals
      .filter((p) => ids.has(p.expertiseId))
      .slice(0, 12)
      .map((p) => ({ id: p.id, expertiseId: p.expertiseId, reason: p.reason || '', changes: p.changes || {} })),
  }
}

// ---------------------------------------------------------------- offline correction

/** Keyword rules standing in for Claude when the backend is unavailable (clearly labelled). */
export function offlineCorrection(req) {
  const target = req.expertise.find((e) => e.id === req.targetId) || req.expertise[0]
  const text = req.correction.replace(/\s+/g, ' ').trim()
  // "Step 2 is out of date — since the retrofit we …" → "Since the retrofit we …"
  const body = text.replace(/^step\s+\d+\s*(?:is\s+)?[\w\s]{0,24}?\s*[:—–.-]+\s+/i, '') || text
  const line = body.charAt(0).toUpperCase() + body.slice(1)
  const step = text.match(/\bstep\s+(\d+)/i)
  let field = 'knowledge'
  let change = { add: [line], remove: [] }
  let diagnosis = 'expertise_incomplete'
  if (step && target.decisionLogic[Number(step[1]) - 1]) {
    field = 'decisionLogic'
    diagnosis = 'expertise_wrong'
    change = { add: [line], remove: [target.decisionLogic[Number(step[1]) - 1]] }
  } else if (/\b(never|don'?t|do not|must not|avoid)\b/i.test(text)) field = 'guardrails'
  else if (/\b(escalate|call|notify|inform|contact)\b/i.test(text)) field = 'escalation'
  else if (/\b(first|before|then|after)\b/i.test(text)) {
    field = 'decisionLogic'
    change = { ...change, insertAfter: /\bfirst\b/i.test(text) ? -1 : null }
  }
  const lastUser = [...req.turns].reverse().find((t) => t.role === 'user')?.content || text
  const twin = req.openProposals.find((p) => p.expertiseId === target.id && similarity(`${p.reason} ${JSON.stringify(p.changes)}`, text) >= 0.35)
  return {
    diagnosis, confidence: null, reason: 'Filed by keyword rules (offline mode) — check the section before approving.',
    expertiseId: target.id, changes: { [field]: change }, set: {}, mergeWith: twin?.id || null,
    testCase: { question: lastUser.slice(0, 1000), mustDo: [text.slice(0, 200)], mustNotDo: [] },
    engine: 'offline',
  }
}

// ---------------------------------------------------------------- test questions

/** A saved test question from a 👍 answer: the operator's question + the answer they approved. */
export function positiveCase(question, answer) {
  return { id: uid('case'), question: question.slice(0, 1000), mustDo: [], mustNotDo: [], referenceAnswer: answer.slice(0, 6000), source: 'thumbs_up', createdAt: now() }
}

/** Adds a test question to an Expertise's list: no near-duplicates, newest first, capped. */
export function addTestCase(list = [], c) {
  if (!c?.question || list.some((x) => similarity(x.question, c.question) > 0.85 && x.source === c.source)) return list
  return [{ id: c.id || uid('case'), createdAt: c.createdAt || now(), ...c }, ...list].slice(0, MAX_TEST_CASES)
}

/** Questions for a before/after run: the proposal's own question first, then saved corrections,
 *  then 👍 answers. Returns [] when there is nothing to test with. */
export function casesForRun(e, p) {
  const own = p.testCase?.question ? [{ ...p.testCase, id: 'proposal', source: 'correction', own: true }] : []
  const saved = [...(e.testCases || [])].sort((a, b) => (a.source === 'correction' ? 0 : 1) - (b.source === 'correction' ? 0 : 1))
  return [...own, ...saved.slice(0, RUN_CASES)]
}

/** The proposed version of `e` as the test endpoint expects it. */
export function proposedVersion(e, p) {
  const base = loopExpertise(e)
  return { ...base, ...applyChanges(base, p.changes, p.set), version: `${e.version}+proposed` }
}

/** Stand-in for /api/loop/test when the backend is unavailable: marks the run as simulated. */
export function offlineTestRun(cases) {
  const results = cases.map((c) => ({
    caseId: c.id, question: c.question, simulated: true,
    old: { answer: '', ok: !c.own, why: c.own ? 'This is the mistake the correction reported.' : 'Simulated.' },
    new: { answer: '', ok: true, why: 'Simulated.' },
    verdict: c.own ? 'fixed' : 'same_pass',
  }))
  return { results, summary: summarise(results), model: 'offline', graderModel: 'offline', engine: 'offline' }
}

export function summarise(results) {
  return {
    total: results.length,
    oldPass: results.filter((r) => r.old.ok === true).length,
    newPass: results.filter((r) => r.new.ok === true).length,
    fixed: results.filter((r) => r.verdict === 'fixed').length,
    broke: results.filter((r) => r.verdict === 'broke').length,
    errors: results.filter((r) => r.verdict === 'error').length,
  }
}

// ---------------------------------------------------------------- health per version

export const HEALTH = { minRated: 10, lowRate: 0.7, burstDowns: 3, burstDays: 7 }

/** 👍 rate per version, a "needs review" flag and a rollback suggestion, from feedback that
 *  recorded the version it rated (older feedback has no version and is left out). */
export function healthOf(e) {
  const byVersion = {}
  for (const f of e.feedback || []) {
    if (!f.version) continue
    const v = (byVersion[f.version] ??= { up: 0, down: 0 })
    v[f.rating === 'up' ? 'up' : 'down'] += 1
  }
  for (const v of Object.values(byVersion)) {
    v.rated = v.up + v.down
    v.rate = v.rated ? v.up / v.rated : null
  }
  const cur = byVersion[e.version]
  const since = Date.now() - HEALTH.burstDays * 864e5
  const recentDowns = (e.feedback || []).filter((f) => f.version === e.version && f.rating === 'down' && new Date(f.date).getTime() >= since).length

  let flag = null
  if (recentDowns >= HEALTH.burstDowns) flag = { kind: 'burst', text: `${recentDowns} 👎 on v${e.version} in the last ${HEALTH.burstDays} days` }
  else if (cur?.rated >= HEALTH.minRated && cur.rate < HEALTH.lowRate) flag = { kind: 'low', text: `Only ${Math.round(cur.rate * 100)}% 👍 on v${e.version} (${cur.rated} ratings)` }

  // Suggest going back when the previous version (with enough ratings) did clearly better.
  let rollbackTo = null
  const order = (e.versions || []).map((v) => v.version)
  const prev = order[order.indexOf(e.version) - 1]
  const p = prev && byVersion[prev]
  if (cur?.rated >= HEALTH.minRated && p?.rated >= 5 && p.rate - cur.rate >= 0.1 && e.versions.find((v) => v.version === prev)?.snapshot) {
    rollbackTo = { version: prev, rate: p.rate, currentRate: cur.rate }
  }
  return { byVersion, flag, rollbackTo }
}
