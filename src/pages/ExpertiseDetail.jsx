import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Pencil, Save, Send, Check, Archive, Download, MessageSquarePlus, RotateCcw, GitCompare, FileText, MessagesSquare, Mic,
  Link2, ThumbsUp, ThumbsDown, Trash2, ChevronDown, ChevronLeft, ChevronRight, Copy, ShieldCheck, Info, AlertTriangle,
} from 'lucide-react'
import { useStore } from '../store'
import { CONTENT_FIELDS } from '../data/expertise'
import { TAXONOMY, ASSET_TYPES, domainMeta, slugify, flatOrder } from '../data/taxonomy'
import { StatusBadge, fmtDate, timeAgo, Dropdown } from '../components/ui'
import { Breadcrumb } from './ExpertiseLayout'
import { canEdit, contributeBlock, canGovern, reviewBlock } from '../lib/permissions'
import { readiness } from '../lib/readiness'

const LIST_SECTIONS = [
  { key: 'knowledge', id: 'knowledge', title: 'Knowledge & heuristics', hint: 'What an expert knows that a newcomer doesn\'t. One per line.' },
  { key: 'decisionLogic', id: 'decision-logic', title: 'Decision logic', ordered: true, hint: 'The steps an expert follows, in order. One per line.' },
  { key: 'guardrails', id: 'guardrails', title: 'Guardrails', tone: 'red', hint: 'What the AI must never recommend. One per line.' },
  { key: 'escalation', id: 'escalation', title: 'Escalation rules', tone: 'amber', hint: 'When a human must take over, and who. One per line.' },
]

// ---------------------------------------------------------------- export helpers
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}
function toMarkdown(e) {
  const list = (xs, ordered) => xs.map((x, i) => `${ordered ? `${i + 1}.` : '-'} ${x}`).join('\n') || '_None_'
  return `---
name: ${e.name}
domain: ${e.domain}
topic: ${e.topic || ''}
asset_types: [${(e.assetTypes || []).join(', ')}]
version: ${e.version}
status: ${e.status}
owner: ${e.owner}
reviewer: ${e.reviewer || ''}
keywords: [${e.keywords.join(', ')}]
updated: ${e.updatedAt}
---

# ${e.name}

${e.summary}

## When to use
${e.whenToUse || '_Not specified_'}

## Knowledge & heuristics
${list(e.knowledge)}

## Decision logic
${list(e.decisionLogic, true)}

## Guardrails
${list(e.guardrails)}

## Escalation
${list(e.escalation)}

## Sources
${(e.sources || []).map((s) => `- ${s.type}: ${s.title}${s.date ? ` (${String(s.date).slice(0, 10)})` : ''}${s.excerpt ? ` — "${s.excerpt}"` : ''}`).join('\n') || '_None_'}
`
}

// ---------------------------------------------------------------- diff
function diffFields(from, to) {
  const out = []
  for (const f of CONTENT_FIELDS) {
    const a = from[f], b = to[f]
    if (Array.isArray(a)) {
      const removed = a.filter((x) => !b.includes(x))
      const added = b.filter((x) => !a.includes(x))
      if (removed.length || added.length) out.push({ field: f, removed, added })
    } else if (a !== b) out.push({ field: f, removed: a ? [a] : [], added: b ? [b] : [] })
  }
  return out
}
const FIELD_NAME = { summary: 'Summary', whenToUse: 'When to use', knowledge: 'Knowledge', decisionLogic: 'Decision logic', guardrails: 'Guardrails', escalation: 'Escalation' }

function Diff({ changes }) {
  if (!changes.length) return <p className="text-sm text-gray-500">No differences.</p>
  return (
    <div className="space-y-2 rounded-xl bg-gray-50 p-3 font-mono text-[13px] dark:bg-gray-950">
      {changes.map((c) => (
        <div key={c.field}>
          <p className="mb-0.5 font-sans text-xs font-medium text-gray-500">{FIELD_NAME[c.field]}</p>
          {c.removed.map((x, i) => <p key={'r' + i} className="text-red-500">− {x}</p>)}
          {c.added.map((x, i) => <p key={'a' + i} className="text-emerald-500">+ {x}</p>)}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- building blocks
function H2({ id, children, count }) {
  return (
    <h2 id={id} className="group mt-12 flex scroll-mt-6 items-baseline gap-2 text-[22px] font-semibold tracking-tight">
      <a href={`#${id}`} className="hover:underline-offset-4">{children}</a>
      {count != null && <span className="text-sm font-normal text-gray-400">{count}</span>}
    </h2>
  )
}

function ListView({ items, ordered, tone }) {
  if (!items.length) return <p className="mt-3 text-sm italic text-gray-500">Nothing captured yet.</p>
  const marker = { red: 'bg-red-500', amber: 'bg-amber-500' }[tone] || 'bg-gray-400'
  return (
    <ol className="mt-3 space-y-2.5">
      {items.map((x, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
          {ordered ? (
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">{i + 1}</span>
          ) : (
            <span className={`mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full ${marker}`} />
          )}
          <span>{x}</span>
        </li>
      ))}
    </ol>
  )
}

// Draft → review gate: what the owner still has to fill in before "Submit for review" unlocks.
function ReadinessChecklist({ e }) {
  const { checks, missing } = readiness(e)
  const done = checks.filter((c) => c.required && c.done).length
  const total = checks.filter((c) => c.required).length
  return (
    <div className={`mt-6 rounded-2xl px-4 py-3.5 ring-1 ${missing.length ? 'bg-amber-500/5 ring-amber-500/25' : 'bg-emerald-500/5 ring-emerald-500/25'}`}>
      <p className="flex items-center justify-between text-sm font-semibold">
        {missing.length ? 'Before this can be submitted for review' : 'Ready to submit for review'}
        <span className="font-mono text-xs font-normal text-gray-500">{done}/{total} required</span>
      </p>
      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.key} className={`flex items-start gap-1.5 ${c.done ? 'text-gray-500' : c.required ? '' : 'text-gray-500'}`}>
            {c.done ? <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" /> : <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ring-1 ${c.required ? 'ring-amber-500' : 'ring-gray-400'}`} />}
            <span>{c.label}{!c.required && <span className="text-xs text-gray-500"> (recommended)</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Callout({ icon: Icon, tone = 'gray', title, children }) {
  const cls = {
    gray: 'bg-gray-50 ring-gray-200 dark:bg-gray-850 dark:ring-gray-800',
    indigo: 'bg-indigo-500/10 ring-indigo-500/25 text-indigo-600 dark:text-indigo-300',
    amber: 'bg-amber-500/10 ring-amber-500/25',
  }[tone]
  return (
    <div className={`mt-6 flex gap-3 rounded-2xl px-4 py-3.5 ring-1 ${cls}`}>
      <Icon size={18} className="mt-0.5 shrink-0 text-gray-500" />
      <div className="text-sm leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- sections
function Versions({ e }) {
  const { rollbackExpertise, user } = useStore()
  const [open, setOpen] = useState(null)
  const versions = [...e.versions].reverse()
  if (!versions.length) return <p className="mt-3 text-sm text-gray-500">No approved versions yet. The first approval creates v1.0.</p>
  return (
    <div className="mt-4 border-l border-gray-200 pl-5 dark:border-gray-800">
      {versions.map((v, i) => {
        const current = i === 0
        return (
          <div key={v.version + i} className="relative pb-5">
            <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-gray-900 ${current ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`} />
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <span className="font-mono text-sm font-medium">v{v.version}</span>
              <p className="min-w-0 flex-1 text-sm">{v.note}</p>
              {!current && v.snapshot && (
                <span className="flex gap-1">
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(open === i ? null : i)}><GitCompare size={13} /> Compare</button>
                  <button className="btn-ghost px-2 py-1 text-xs" disabled={!canGovern(user)} onClick={() => rollbackExpertise(e.id, v.version)} title={!canGovern(user) ? 'Only the Reviewer can roll back' : ''}>
                    <RotateCcw size={13} /> Roll back
                  </button>
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">{fmtDate(v.date)} · by {v.author} · approved by {v.approvedBy}{current && ' · current'}</p>
            {open === i && (
              <div className="mt-2 animate-fadeIn">
                <p className="mb-1.5 text-xs text-gray-500">Changes from v{v.version} → current (v{e.version})</p>
                <Diff changes={diffFields(v.snapshot, e)} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const SOURCE_ICON = { conversation: MessagesSquare, interview: Mic, meeting: Mic, document: FileText }
function Sources({ e }) {
  if (!e.sources.length) return <p className="mt-3 text-sm text-gray-500">No linked sources.</p>
  return (
    <div className="mt-4 space-y-2">
      {e.sources.map((s, i) => {
        const Icon = SOURCE_ICON[s.type] || Link2
        const inner = (
          <div className="flex gap-3 rounded-xl p-3 ring-1 ring-gray-200 transition hover:bg-gray-50 dark:ring-gray-800 dark:hover:bg-gray-850">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800"><Icon size={16} /></span>
            <div>
              <p className="text-sm font-medium">{s.title}</p>
              <p className="text-xs capitalize text-gray-500">{s.type} · {fmtDate(s.date)}</p>
              <p className="mt-1 text-sm italic text-gray-600 dark:text-gray-400">"{s.excerpt}"</p>
            </div>
          </div>
        )
        return s.chatId ? <Link key={i} to={`/c/${s.chatId}`} className="block">{inner}</Link> : <div key={i}>{inner}</div>
      })}
    </div>
  )
}

function Feedback({ e }) {
  if (!e.feedback.length) return <p className="mt-3 text-sm text-gray-500">No feedback yet. Ratings on answers that used this Expertise appear here.</p>
  return (
    <div className="mt-4 divide-y divide-gray-100 rounded-xl ring-1 ring-gray-200 dark:divide-gray-800 dark:ring-gray-800">
      {e.feedback.map((f, i) => (
        <div key={i} className="flex gap-3 p-3">
          {f.rating === 'up' ? <ThumbsUp size={16} className="mt-0.5 text-emerald-500" /> : <ThumbsDown size={16} className="mt-0.5 text-red-500" />}
          <div>
            <p className="text-sm">{f.comment || <i className="text-gray-500">No comment</i>}</p>
            <p className="text-xs text-gray-500">{f.user} · {timeAgo(f.date)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function Related({ e }) {
  const all = useStore((s) => s.expertise)
  const rel = (e.related || []).map((id) => all.find((x) => x.id === id)).filter(Boolean)
  if (!rel.length) return <p className="mt-3 text-sm text-gray-500">No related Expertise linked.</p>
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {rel.map((r) => {
        const m = domainMeta(r.domain)
        const Icon = m.icon
        return (
          <Link key={r.id} to={`/expertise/${r.id}`} className="flex items-start gap-3 rounded-xl p-3 ring-1 ring-gray-200 transition hover:bg-gray-50 dark:ring-gray-800 dark:hover:bg-gray-850">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white ${m.gradient}`}><Icon size={15} /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{r.name}</span>
              <span className="block text-xs text-gray-500">{r.domain} › {r.topic}</span>
            </span>
          </Link>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- table of contents (scroll spy)
function Toc({ items }) {
  const [active, setActive] = useState(items[0]?.id)
  useEffect(() => {
    const root = document.getElementById('expertise-scroll')
    if (!root) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { root, rootMargin: '0px 0px -70% 0px' },
    )
    items.forEach((it) => { const el = document.getElementById(it.id); el && obs.observe(el) })
    return () => obs.disconnect()
  }, [items])
  return (
    <aside className="sticky top-0 hidden h-fit w-52 self-start shrink-0 pt-10 xl:block">
      <p className="mb-2 text-xs font-medium text-gray-500">On this page</p>
      <nav className="border-l border-gray-200 dark:border-gray-800">
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            className={`-ml-px block border-l-2 py-1 pl-3 text-[13px] transition ${active === it.id ? 'border-gray-900 font-medium text-gray-900 dark:border-white dark:text-white' : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'}`}
          >
            {it.label}
          </a>
        ))}
      </nav>
    </aside>
  )
}

// ---------------------------------------------------------------- page
export default function ExpertiseDetail() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { expertise, user, updateExpertise, submitForReview, approveExpertise, deprecateExpertise, restoreExpertise, deleteExpertise, proposeRevision, showToast } = useStore()
  const e = expertise.find((x) => x.id === id)
  const edit = params.get('edit') === '1'
  const [draft, setDraft] = useState(null)

  useEffect(() => { if (e && edit) setDraft(structuredClone(e)) }, [edit, id]) // eslint-disable-line
  useEffect(() => { document.getElementById('expertise-scroll')?.scrollTo({ top: 0 }) }, [id])

  const order = useMemo(() => flatOrder(expertise), [expertise])
  const toc = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      ...LIST_SECTIONS.map((s) => ({ id: s.id, label: s.title })),
      { id: 'related', label: 'Related Expertise' },
      { id: 'sources', label: 'Sources' },
      { id: 'feedback', label: 'Feedback' },
      { id: 'history', label: 'Version history' },
    ],
    [],
  )

  if (!e) return <p className="p-16 text-center text-gray-500">Expertise not found. <Link className="text-accent-500" to="/expertise">Back to overview</Link></p>

  const governs = canGovern(user)
  const decideBlock = reviewBlock(user, e.domain, e)
  const mayDelete = governs || (e.status === 'draft' && canEdit(user, e))
  // Content can only be changed by contributors who are experts in this Expertise's domain.
  const mayEdit = canEdit(user, e)
  const editBlock = contributeBlock(user, e.domain)
  const ready = readiness(e)
  const editing = edit && !!draft && mayEdit
  const view = editing ? draft : e
  const meta = domainMeta(view.domain)
  const idx = order.findIndex((x) => x.id === e.id)
  const prev = order[idx - 1], next = order[idx + 1]
  const set = (patch) => setDraft({ ...draft, ...patch })
  const setList = (k, v) => set({ [k]: v.split('\n').map((s) => s.trim()).filter(Boolean) })

  const cancel = () => { setParams({}); setDraft(null) }
  const save = () => {
    const meta = { name: draft.name, domain: draft.domain, topic: draft.topic, assetTypes: draft.assetTypes, summary: draft.summary, whenToUse: draft.whenToUse, owner: draft.owner, keywords: draft.keywords }
    if (e.status === 'approved') {
      const changes = {}
      for (const f of ['knowledge', 'decisionLogic', 'guardrails', 'escalation']) {
        const add = draft[f].filter((x) => !e[f].includes(x)), remove = e[f].filter((x) => !draft[f].includes(x))
        if (add.length || remove.length) changes[f] = { add, remove }
      }
      updateExpertise(e.id, meta)
      if (Object.keys(changes).length) proposeRevision(e.id, changes, 'Edited by ' + user.name)
      else showToast('Saved')
    } else {
      updateExpertise(e.id, draft)
      showToast('Draft saved')
    }
    setParams({})
  }

  const up = e.feedback.filter((f) => f.rating === 'up').length
  const helpful = e.successRate != null ? `${Math.round(e.successRate * 100)}%` : e.feedback.length ? `${Math.round((up / e.feedback.length) * 100)}%` : '—'

  return (
    <div className="mx-auto flex max-w-6xl gap-10 px-8">
      <article className="min-w-0 max-w-3xl flex-1 pb-24 pt-8">
        <Breadcrumb
          items={[
            { label: 'Expertise', to: '/expertise' },
            { label: view.domain, to: `/expertise/d/${slugify(view.domain)}` },
            { label: view.topic || 'General', to: `/expertise/d/${slugify(view.domain)}#topic-${slugify(view.topic || 'General')}` },
          ]}
        />

        {/* title row */}
        <div id="overview" className="mt-3 flex scroll-mt-6 flex-wrap items-start justify-between gap-3">
          {editing ? (
            <input className="input max-w-lg text-2xl font-semibold" value={draft.name} onChange={(ev) => set({ name: ev.target.value })} />
          ) : (
            <h1 className="text-[32px] font-semibold leading-tight tracking-tight">{e.name}</h1>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {editing ? (
              <>
                <button className="btn-ghost" onClick={cancel}>Cancel</button>
                <button className="btn-primary" onClick={save}><Save size={15} /> {e.status === 'approved' ? 'Propose changes' : 'Save draft'}</button>
              </>
            ) : (
              <>
                <Dropdown align="right" trigger={() => <button className="btn-outline"><Copy size={14} /> Copy page <ChevronDown size={13} /></button>}>
                  <button className="menu-item" onClick={() => { navigator.clipboard?.writeText(toMarkdown(e)); showToast('Copied as Markdown') }}><Copy size={15} /> Copy as Markdown</button>
                  <button className="menu-item" onClick={() => download(`${slugify(e.name)}.md`, toMarkdown(e), 'text/markdown')}><Download size={15} /> Download .md (SKILL.md)</button>
                  <button className="menu-item" onClick={() => download(`${slugify(e.name)}.json`, JSON.stringify(e, null, 2), 'application/json')}><Download size={15} /> Download .json</button>
                </Dropdown>
                <button className="btn-outline" disabled={!mayEdit} title={editBlock || ''} onClick={() => setParams({ edit: '1' })}><Pencil size={14} /> Edit</button>
                {e.status === 'draft' && (
                  <button
                    className="btn-primary"
                    disabled={!mayEdit || !ready.ready}
                    title={editBlock || (!ready.ready ? `Still needs: ${ready.missing.map((m) => m.label.toLowerCase()).join('; ')}` : '')}
                    onClick={() => submitForReview(e.id)}
                  >
                    <Send size={14} /> Submit for review
                  </button>
                )}
                {e.status === 'in_review' && (
                  <button className="btn-accent" disabled={!!decideBlock} onClick={() => approveExpertise(e.id, 'Initial approval')} title={decideBlock || ''}><Check size={14} /> Approve</button>
                )}
                {e.status === 'approved' && (
                  <button className="btn-primary" onClick={() => navigate('/', { state: { attach: e.id } })}><MessageSquarePlus size={14} /> Use in chat</button>
                )}
                <Dropdown align="right" trigger={() => <button className="btn-ghost px-2">•••</button>}>
                  {e.status === 'approved' && <button className="menu-item disabled:opacity-40" disabled={!governs} title={governs ? '' : 'Only the Reviewer can deprecate'} onClick={() => deprecateExpertise(e.id)}><Archive size={15} /> Deprecate</button>}
                  {e.status === 'deprecated' && <button className="menu-item disabled:opacity-40" disabled={!governs} title={governs ? '' : 'Only the Reviewer can restore'} onClick={() => restoreExpertise(e.id)}><RotateCcw size={15} /> Restore</button>}
                  <button className="menu-item text-red-500 disabled:opacity-40" disabled={!mayDelete} title={mayDelete ? '' : 'Only the Reviewer, or a domain expert for a draft, can delete'} onClick={() => { if (deleteExpertise(e.id)) navigate('/expertise') }}><Trash2 size={15} /> Delete</button>
                </Dropdown>
              </>
            )}
          </div>
        </div>

        {/* lead / summary */}
        {editing ? (
          <textarea rows={2} className="input mt-3 resize-none text-[15px]" placeholder="One-sentence summary" value={draft.summary} onChange={(ev) => set({ summary: ev.target.value })} />
        ) : (
          <p className="mt-3 text-[17px] leading-relaxed text-gray-600 dark:text-gray-400">{e.summary || <i>No summary yet.</i>}</p>
        )}

        {/* metadata strip */}
        {editing ? (
          <div className="mt-5 grid gap-3 rounded-2xl p-4 ring-1 ring-gray-200 sm:grid-cols-2 dark:ring-gray-800">
            <label className="text-sm"><span className="label mb-1 block">Domain</span>
              <select className="input" value={draft.domain} onChange={(ev) => set({ domain: ev.target.value, topic: domainMeta(ev.target.value).topics[0] })}>
                {TAXONOMY.filter((t) => user.domains?.includes(t.domain) || t.domain === e.domain).map((t) => <option key={t.domain}>{t.domain}</option>)}
              </select>
            </label>
            <label className="text-sm"><span className="label mb-1 block">Topic</span>
              <select className="input" value={draft.topic} onChange={(ev) => set({ topic: ev.target.value })}>
                {domainMeta(draft.domain).topics.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-sm"><span className="label mb-1 block">Owner</span>
              <input className="input" value={draft.owner} onChange={(ev) => set({ owner: ev.target.value })} />
            </label>
            <label className="text-sm"><span className="label mb-1 block">Trigger keywords</span>
              <input className="input" value={draft.keywords.join(', ')} onChange={(ev) => set({ keywords: ev.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
            </label>
            <div className="text-sm sm:col-span-2"><span className="label mb-1.5 block">Asset types</span>
              <div className="flex flex-wrap gap-1.5">
                {ASSET_TYPES.map((a) => {
                  const on = draft.assetTypes?.includes(a)
                  return (
                    <button key={a} type="button" onClick={() => set({ assetTypes: on ? draft.assetTypes.filter((x) => x !== a) : [...(draft.assetTypes || []), a] })}
                      className={`rounded-full px-3 py-1 text-xs ring-1 ${on ? 'bg-gray-900 text-white ring-gray-900 dark:bg-white dark:text-gray-900' : 'ring-gray-200 dark:ring-gray-700'}`}>
                      {a}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-gray-100 py-3 text-sm dark:border-gray-850">
            <StatusBadge status={e.status} />
            <span className="font-mono text-gray-500">v{e.version}</span>
            <span><span className="text-gray-500">Owner </span>{e.owner}</span>
            <span><span className="text-gray-500">Reviewer </span>{e.reviewer || '—'}</span>
            <span className="text-gray-500">Updated {timeAgo(e.updatedAt)}</span>
            <span className="text-gray-500">{e.usageCount} uses · {helpful} helpful</span>
            <span className="flex gap-1">{(e.assetTypes || []).map((a) => <span key={a} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400">{a}</span>)}</span>
          </div>
        )}

        {!editing && editBlock && e.status !== 'deprecated' && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500"><ShieldCheck size={13} /> {editBlock}</p>
        )}

        {e.capture && (
          <Callout icon={MessagesSquare} tone="indigo" title="Captured from a conversation">
            By {e.capture.capturedBy || e.owner}
            {e.capture.confidence != null && <> · extractor confidence {Math.round(e.capture.confidence * 100)}%</>}
            {e.capture.detector === 'keyword' && <> · keyword match (offline)</>}
            {e.capture.reason && <span className="block text-xs opacity-80">Why: {e.capture.reason}</span>}
          </Callout>
        )}

        {e.status === 'draft' && <ReadinessChecklist e={view} />}

        {editing && e.status === 'approved' && (
          <Callout icon={ShieldCheck} tone="indigo">This Expertise is live. Changes to its content will go to the Review Queue as a proposed revision.</Callout>
        )}

        {/* when to use */}
        {editing ? (
          <div className="mt-6"><p className="label mb-1">When to use</p>
            <textarea rows={2} className="input resize-none" value={draft.whenToUse} onChange={(ev) => set({ whenToUse: ev.target.value })} />
          </div>
        ) : (
          e.whenToUse && <Callout icon={Info} title="When to use">{e.whenToUse}</Callout>
        )}

        {!editing && (
          <Callout icon={AlertTriangle} tone="amber" title="Boundaries">
            Fractal <b>may recommend</b> the decision-logic steps below. Any action <b>needs a human</b> — Fractal never executes.
            {e.escalation.length > 0 && <> It <b>must escalate</b> in {e.escalation.length} defined situation{e.escalation.length > 1 && 's'}.</>}
          </Callout>
        )}

        {/* content sections */}
        {LIST_SECTIONS.map((s) => (
          <section key={s.key}>
            <H2 id={s.id}>{s.title}</H2>
            {editing ? (
              <>
                <p className="mb-1.5 mt-1 text-xs text-gray-500">{s.hint}</p>
                <textarea rows={Math.max(3, draft[s.key].length + 1)} className="input resize-y leading-relaxed" defaultValue={draft[s.key].join('\n')} onBlur={(ev) => setList(s.key, ev.target.value)} />
              </>
            ) : (
              <ListView items={e[s.key]} ordered={s.ordered} tone={s.tone} />
            )}
          </section>
        ))}

        <section><H2 id="related" count={(e.related || []).length || null}>Related Expertise</H2><Related e={e} /></section>
        <section><H2 id="sources" count={e.sources.length || null}>Sources</H2><Sources e={e} /></section>
        <section><H2 id="feedback" count={e.feedback.length || null}>Feedback</H2><Feedback e={e} /></section>
        <section><H2 id="history" count={e.versions.length || null}>Version history</H2><Versions e={e} /></section>

        {/* prev / next */}
        <div className="mt-14 grid gap-3 border-t border-gray-100 pt-6 sm:grid-cols-2 dark:border-gray-850">
          {prev ? (
            <Link to={`/expertise/${prev.id}`} className="rounded-xl p-4 ring-1 ring-gray-200 transition hover:bg-gray-50 dark:ring-gray-800 dark:hover:bg-gray-850">
              <span className="flex items-center gap-1 text-xs text-gray-500"><ChevronLeft size={13} /> Previous</span>
              <span className="mt-1 block font-medium">{prev.name}</span>
            </Link>
          ) : <span />}
          {next && (
            <Link to={`/expertise/${next.id}`} className="rounded-xl p-4 text-right ring-1 ring-gray-200 transition hover:bg-gray-50 dark:ring-gray-800 dark:hover:bg-gray-850">
              <span className="flex items-center justify-end gap-1 text-xs text-gray-500">Next <ChevronRight size={13} /></span>
              <span className="mt-1 block font-medium">{next.name}</span>
            </Link>
          )}
        </div>
        <p className="mt-6 text-xs text-gray-400">Created {fmtDate(e.createdAt)} · {meta.domain} › {e.topic}</p>
      </article>

      <Toc items={toc} />
    </div>
  )
}
