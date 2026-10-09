import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, GitPullRequestArrow, Check, ArrowRight, Loader2, Lock, X, Pencil, Plus, Quote } from 'lucide-react'
import { useStore } from '../store'
import { TAXONOMY } from '../data/taxonomy'
import { contributeBlock, isContributor } from '../lib/permissions'
import { FIELD_LABELS, FIELD_ORDER } from '../lib/capture'
import { readiness } from '../lib/readiness'

const sel = 'rounded-lg bg-white px-2 py-1 text-xs outline-none ring-1 ring-gray-200 focus:ring-gray-400 dark:bg-gray-900 dark:ring-gray-700'
const MISSING_PROMPTS = {
  guardrails: { label: 'a guardrail', placeholder: 'What must never be done here? e.g. Never reset the controller before…' },
  escalation: { label: 'an escalation rule', placeholder: 'When should a human or specialist take over, and who? e.g. Call the lift contractor if…' },
}

function Confidence({ det }) {
  if (det.source !== 'ai' || det.confidence == null)
    return <span className="rounded-full bg-gray-500/15 px-2 py-0.5 text-[10px] font-medium text-gray-400" title="Backend offline — matched by keywords">Keyword match</span>
  const v = det.confidence
  const [label, cls] = v >= 0.8 ? ['High', 'bg-emerald-500/15 text-emerald-500'] : v >= 0.6 ? ['Medium', 'bg-amber-500/15 text-amber-500'] : ['Low', 'bg-gray-500/15 text-gray-400']
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`} title={det.reason}>{label} · {Math.round(v * 100)}%</span>
}

/**
 * Shown under an answer when the chatting contributor shared reusable know-how.
 * States: checking → pending (editable) → saved | dismissed. Out-of-domain contributors see a
 * locked notice instead; reviewers never see capture (they approve, they don't author).
 */
export default function CaptureCard({ chatId, msg }) {
  const { user, expertise, acceptDetection, dismissDetection } = useStore()
  const navigate = useNavigate()
  const det = msg.detection
  const [editing, setEditing] = useState(false)
  const [items, setItems] = useState(() => (det?.items || []).map((x, i) => ({ ...x, key: i, include: true })))
  const [meta, setMeta] = useState(() => ({ name: det?.draft?.name || '', domain: det?.draft?.domain || '', topic: det?.draft?.topic || '' }))
  const [extras, setExtras] = useState([])
  const [adding, setAdding] = useState(null) // field being added
  const [addText, setAddText] = useState('')

  const target = det?.kind === 'revision' ? expertise.find((e) => e.id === det.target?.expertiseId) : null
  const domain = det?.kind === 'new' ? meta.domain : target?.domain || det?.target?.domain
  const block = contributeBlock(user, domain)

  const missing = useMemo(() => {
    if (det?.kind !== 'new') return []
    const kept = [...items.filter((x) => x.include), ...extras]
    const draft = { name: meta.name, summary: det.draft?.summary, whenToUse: det.draft?.whenToUse, ...Object.fromEntries(FIELD_ORDER.map((f) => [f, kept.filter((x) => x.field === f)])) }
    return readiness(draft).missing.map((m) => m.key).filter((k) => MISSING_PROMPTS[k])
  }, [det, items, extras, meta.name])

  if (msg.detectionState === 'checking') {
    if (!isContributor(user)) return null
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-gray-500 animate-fadeIn">
        <Loader2 size={13} className="animate-spin" /> Checking whether you shared reusable know-how…
      </p>
    )
  }
  if (!det || msg.detectionState === 'dismissed') return null

  if (msg.detectionState === 'saved') {
    const isNew = det.kind === 'new'
    const still = msg.detectionMissing || []
    return (
      <div className="mt-4 rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 ring-1 ring-emerald-500/25 animate-fadeIn dark:text-emerald-400">
        <div className="flex items-center gap-2">
          <Check size={16} />
          {isNew ? 'Saved as a draft Expertise.' : `Revision proposed for ${det.target.expertiseName}.`}
          <button
            className="ml-auto flex items-center gap-1 font-medium hover:underline"
            onClick={() => navigate(isNew ? `/expertise/${msg.detectionResult}` : '/expertise/review')}
          >
            {isNew ? 'Open draft' : 'View in Review Queue'} <ArrowRight size={14} />
          </button>
        </div>
        {isNew && (
          <p className="mt-1 pl-6 text-xs text-emerald-700/80 dark:text-emerald-300/70">
            {still.length ? `Before you can submit it for review it still needs: ${still.map((s) => s.toLowerCase()).join('; ')}.` : 'Ready to submit for review.'}
          </p>
        )}
      </div>
    )
  }

  // Reviewers don't author; contributors outside the target domain get a short explanation.
  if (!isContributor(user)) return null
  if (block)
    return (
      <div className="mt-3 flex items-start gap-2 rounded-xl bg-gray-500/5 px-3 py-2 text-xs text-gray-500 ring-1 ring-gray-500/15 animate-fadeIn">
        <Lock size={13} className="mt-0.5 shrink-0" />
        <span className="flex-1">
          Fractal spotted know-how for <b className="font-medium text-gray-600 dark:text-gray-300">{det.kind === 'revision' ? det.target.expertiseName : `${det.target.domain} › ${det.target.topic}`}</b>, but only {domain} experts can contribute it. {user.name.split(' ')[0]}'s domains: {(user.domains || []).join(', ')}.
        </span>
        <button className="rounded p-0.5 hover:bg-gray-500/10" onClick={() => dismissDetection(chatId, msg.id)} title="Dismiss"><X size={12} /></button>
      </div>
    )

  const setItem = (key, patch) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const selected = items.filter((x) => x.include).length + extras.length
  const domainsForUser = TAXONOMY.filter((t) => user.domains.includes(t.domain))
  const topics = TAXONOMY.find((t) => t.domain === meta.domain)?.topics || []
  const save = () => acceptDetection(chatId, msg.id, { items, extras, draft: det.kind === 'new' ? meta : undefined })
  const addExtra = () => {
    if (addText.trim()) setExtras((xs) => [...xs, { field: adding, text: addText.trim() }])
    setAdding(null)
    setAddText('')
  }

  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl bg-gradient-to-br from-accent-500/10 via-transparent to-indigo-500/10 p-4 ring-1 ring-accent-500/30 animate-fadeIn">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-500/15 text-accent-500">
          {det.kind === 'new' ? <Sparkles size={18} /> : <GitPullRequestArrow size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">
              {det.kind === 'new' ? 'Fractal noticed reusable know-how' : <>This could improve “{det.target.expertiseName}”{target && <span className="ml-1 font-mono text-xs text-gray-500">v{target.version}</span>}</>}
            </p>
            <Confidence det={det} />
          </div>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {det.kind === 'new'
              ? 'Save it so the next person gets the same answer. A reviewer approves it before it goes live.'
              : "You shared something the current version doesn't cover. Propose it as a revision for review?"}
          </p>

          <div className="mt-2 space-y-3 rounded-xl bg-white/60 p-3 text-sm ring-1 ring-gray-200 dark:bg-gray-900/60 dark:ring-gray-800">
            {det.kind === 'new' && (
              editing ? (
                <div className="flex flex-wrap gap-1.5">
                  <input className={`${sel} min-w-[180px] flex-1 text-sm`} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} aria-label="Expertise name" />
                  <select className={sel} value={meta.domain} onChange={(e) => setMeta({ ...meta, domain: e.target.value, topic: TAXONOMY.find((t) => t.domain === e.target.value).topics[0] })} aria-label="Domain">
                    {domainsForUser.map((t) => <option key={t.domain}>{t.domain}</option>)}
                  </select>
                  <select className={sel} value={meta.topic} onChange={(e) => setMeta({ ...meta, topic: e.target.value })} aria-label="Topic">
                    {[...new Set([...topics, meta.topic])].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <p className="font-medium">{meta.name}</p>
                  <p className="text-xs text-gray-500">{meta.domain} › {meta.topic}{det.draft?.assetTypes?.length ? ` · ${det.draft.assetTypes.join(', ')}` : ''}</p>
                </div>
              )
            )}

            {FIELD_ORDER.map((f) => {
              const rows = items.filter((x) => x.field === f)
              const added = extras.filter((x) => x.field === f)
              if (!rows.length && !added.length) return null
              return (
                <div key={f}>
                  <p className="label mb-1">{FIELD_LABELS[f]}</p>
                  <ul className="space-y-1.5">
                    {rows.map((x) => (
                      <li key={x.key} className={`flex gap-2 ${x.include ? '' : 'opacity-50'}`}>
                        <input type="checkbox" className="mt-1 accent-teal-500" checked={x.include} onChange={(e) => setItem(x.key, { include: e.target.checked })} aria-label="Include this line" />
                        <div className="min-w-0 flex-1">
                          {editing ? (
                            <div className="flex gap-1.5">
                              <textarea rows={2} className={`${sel} w-full resize-y text-sm`} value={x.text} onChange={(e) => setItem(x.key, { text: e.target.value })} />
                              <select className={`${sel} h-fit`} value={x.field} onChange={(e) => setItem(x.key, { field: e.target.value })} aria-label="Section">
                                {FIELD_ORDER.map((o) => <option key={o} value={o}>{FIELD_LABELS[o]}</option>)}
                              </select>
                            </div>
                          ) : <p className="text-gray-700 dark:text-gray-200">{x.text}</p>}
                          {x.quote && x.quote !== x.text && (
                            <p className="mt-0.5 flex gap-1 text-xs italic text-gray-500"><Quote size={11} className="mt-0.5 shrink-0" /> {x.quote}</p>
                          )}
                        </div>
                      </li>
                    ))}
                    {added.map((x, i) => (
                      <li key={`x${i}`} className="flex gap-2">
                        <Plus size={13} className="mt-1 shrink-0 text-accent-500" />
                        <p className="flex-1 text-gray-700 dark:text-gray-200">{x.text} <span className="text-xs text-gray-500">(added by you)</span></p>
                        <button className="rounded p-0.5 text-gray-500 hover:text-red-400" onClick={() => setExtras((xs) => xs.filter((y) => y !== x))} title="Remove"><X size={12} /></button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}

            {missing.length > 0 && (
              <div className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-600 dark:text-amber-400">
                {adding ? (
                  <div className="flex gap-1.5">
                    <input
                      autoFocus
                      className={`${sel} flex-1 text-xs`}
                      placeholder={MISSING_PROMPTS[adding].placeholder}
                      value={addText}
                      onChange={(e) => setAddText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addExtra(); if (e.key === 'Escape') setAdding(null) }}
                    />
                    <button className="btn-outline px-2 py-1 text-xs" onClick={addExtra}>Add</button>
                  </div>
                ) : (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    Not covered yet (needed before review):
                    {missing.map((k) => (
                      <button key={k} className="flex items-center gap-0.5 font-medium underline-offset-2 hover:underline" onClick={() => setAdding(k)}>
                        <Plus size={11} /> add {MISSING_PROMPTS[k].label}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-accent" disabled={!selected || (det.kind === 'new' && !meta.name.trim())} onClick={save}>
              {det.kind === 'new' ? 'Save as draft' : 'Propose revision'}
            </button>
            <button className="btn-outline" onClick={() => setEditing(!editing)}>{editing ? <><Check size={14} /> Done editing</> : <><Pencil size={14} /> Edit</>}</button>
            <button className="btn-ghost" onClick={() => dismissDetection(chatId, msg.id)}>Not now</button>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            Captured from your message by {user.name} ({user.domains.join(', ')} expert) · source conversation is linked{det.reason ? ` · Why: ${det.reason}` : ''}
          </p>
        </div>
      </div>
    </div>
  )
}
