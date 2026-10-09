// ---------------------------------------------------------------------------
// Mock backend. Every function here is a stand-in for a real API endpoint.
// Swap the bodies for fetch() calls when the backend exists — the UI only
// depends on these signatures.
//
//   matchExpertise   → POST /api/expertise/match   (LlamaIndex retrieval)
//   generateReply    → POST /api/chat/completions  (streams tokens)
//   detectExpertise  → POST /api/expertise/detect  (LLM extraction pass)
// ---------------------------------------------------------------------------
import { getModel, getProvider } from '../data/models'
import { DOMAINS } from '../data/expertise'

const tokenize = (s) => s.toLowerCase()

/** Returns approved Expertise relevant to the prompt (+ any manually attached). */
export function matchExpertise(prompt, allExpertise, attachedIds = [], autoApply = true) {
  const p = tokenize(prompt)
  const attached = allExpertise.filter((e) => attachedIds.includes(e.id))
  if (!autoApply) return attached
  const auto = allExpertise
    .filter((e) => e.status === 'approved' && !attachedIds.includes(e.id))
    .map((e) => ({ e, score: e.keywords.filter((k) => p.includes(k)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.e)
  return [...attached, ...auto]
}

const OPENERS = {
  anthropic: 'Here\'s how I\'d approach this.',
  openai: 'Sure — here\'s a structured answer.',
  google: 'Let\'s break this down.',
  xai: 'Straight answer:',
  tencent: '好的 — here is a clear plan.',
  deepseek: 'Here is a concise answer.',
}

// Gives each provider a slightly different "voice" so side-by-side compare is visibly different.
const TAKES = {
  anthropic: '**My take:** start with step 1 — it rules out the most common cause in under five minutes.',
  openai: '**Quick estimate:** following these steps typically resolves ~80% of cases without a vendor call-out.',
  google: '**Worth checking too:** compare against the same period last year in your BMS trend logs.',
  xai: '**Bottom line:** follow the steps, respect the guardrail, escalate early if in doubt.',
  tencent: '**Next step:** I can turn this into a checklist for the duty team (中文 version available).',
  deepseek: '**Summary:** steps 1–2 first, then escalate if unresolved.',
}

/** Builds the (placeholder) reply text for one model. */
export function buildReply(prompt, modelId, expertise = []) {
  const model = getModel(modelId)
  const provider = getProvider(model?.provider)
  const opener = OPENERS[model?.provider] || 'Here\'s my answer.'

  if (expertise.length) {
    const e = expertise[0]
    const steps = e.decisionLogic.slice(0, 4).map((s, i) => `${i + 1}. ${s}`).join('\n')
    const guard = e.guardrails[0]
    const esc = e.escalation[0]
    let out = `${opener} Applying **${e.name}** (v${e.version}), owned by ${e.owner}.\n\n**Recommended steps**\n\n${steps}\n`
    if (e.knowledge[0]) out += `\n**Why:** ${e.knowledge[0]}\n`
    if (guard) out += `\n> ⚠️ **Guardrail:** ${guard}\n`
    if (esc) out += `\n**Escalate when:** ${esc}\n`
    if (expertise[1]) out += `\nI also drew on **${expertise[1].name}** — ${expertise[1].decisionLogic[0]?.toLowerCase()}\n`
    out += `\n${TAKES[model?.provider] || ''}\n\n_This is a recommendation — a qualified person should confirm before acting._`
    return out
  }

  return `${opener}\n\n_This is a placeholder response from **${model?.name}** (${provider?.name}). Connect a backend to get real answers._\n\n**Routed prompt:** _"${prompt.slice(0, 160)}${prompt.length > 160 ? '…' : ''}"_\n\nNo approved Expertise matched this prompt, so I answered from general knowledge. If your team has a proven way of handling this, Fractal can capture it as new Expertise.`
}

/** Simulates token streaming. Returns a cancel function. */
export function streamText(text, onChunk, onDone, speed = 1) {
  const parts = text.split(/(\s+)/)
  let i = 0
  let acc = ''
  const delay = 1000 / 60 / speed
  const id = setInterval(() => {
    const n = 2 + Math.floor(Math.random() * 4)
    for (let k = 0; k < n && i < parts.length; k++) acc += parts[i++]
    onChunk(acc)
    if (i >= parts.length) {
      clearInterval(id)
      onDone(acc)
    }
  }, delay * 3)
  return () => {
    clearInterval(id)
    onDone(acc)
  }
}

// Phrases that suggest the user is *sharing* know-how rather than asking.
const KNOWHOW = /\b(we always|we usually|we normally|always check|never|rule of thumb|in my experience|the trick is|our process|our sop|what works is|best practice|lesson learned|from experience|make sure to|you should first|first thing i)\b/i

const DOMAIN_HINTS = [
  ['Energy Optimisation', /\b(energy|kwh|demand|tariff|electricity|solar|load)\b/i],
  ['Technical Services', /\b(chiller|pump|ahu|lift|elevator|generator|ups|hvac|fault|maintenance|leak)\b/i],
  ['Leasing', /\b(lease|renewal|rent|vacancy|tenant mix|fit-?out)\b/i],
  ['Sustainability', /\b(carbon|emission|green mark|esg|waste|recycl|water usage)\b/i],
  ['Tenant Experience', /\b(complain|tenant|feedback|experience|concierge|amenit)\b/i],
  ['Asset Operations', /\b(asset|budget|capex|opex|portfolio|operations)\b/i],
]

/**
 * Decides whether this exchange contains reusable know-how worth capturing.
 * Returns a draft Expertise skeleton or null.
 */
export function detectExpertise(prompt, chat, matched) {
  const sharesKnowhow = KNOWHOW.test(prompt)
  const domain = DOMAIN_HINTS.find(([, re]) => re.test(prompt))?.[0]
  const isRevision = sharesKnowhow && matched.length > 0
  if (!sharesKnowhow && (matched.length || !domain || prompt.split(/\s+/).length < 14)) return null

  const sentences = prompt.split(/(?<=[.!?])\s+/).filter((s) => s.length > 12)
  const knowhow = sentences.filter((s) => KNOWHOW.test(s))
  const subject = (prompt.match(SUBJECTS) || [])[0]

  if (isRevision) {
    return {
      kind: 'revision',
      expertiseId: matched[0].id,
      expertiseName: matched[0].name,
      addition: knowhow[0] || sentences[0] || prompt,
    }
  }

  return {
    kind: 'new',
    draft: {
      name: subject ? `${titleCase(subject.replace(/s$/, ''))} ${NAME_SUFFIX[domain] || 'Know-how'}` : `${domain || 'Operational'} Know-how`,
      domain: domain || DOMAINS[0],
      summary: `Captured from a conversation: ${prompt.slice(0, 140)}${prompt.length > 140 ? '…' : ''}`,
      whenToUse: '',
      knowledge: knowhow.length ? knowhow : sentences.slice(0, 2),
      decisionLogic: [],
      guardrails: [],
      escalation: [],
    },
  }
}

const SUBJECTS = /\b(chiller|pump|ahu|lift|elevator|escalator|generator|ups|hvac|cooling tower|leak|lease renewal|rent review|vacancy|carbon|emission|green mark|waste|complaint|energy|peak demand|tariff|solar|budget|capex)s?\b/i
const NAME_SUFFIX = {
  'Technical Services': 'Fault Diagnosis',
  'Energy Optimisation': 'Optimisation',
  Leasing: 'Playbook',
  Sustainability: 'Reporting Method',
  'Tenant Experience': 'Response Playbook',
  'Asset Operations': 'Operating Guide',
}

function titleCase(s) {
  return s
    .trim()
    .split(/\s+/)
    .slice(0, 7)
    .map((w) => (w.length > 3 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

export function suggestTitle(prompt) {
  const t = prompt.replace(/\s+/g, ' ').trim()
  return t.length > 42 ? t.slice(0, 42).replace(/\s\S*$/, '') + '…' : t
}
