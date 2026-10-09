import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Pencil, Save, Send, Check, Archive, Download, MessageSquarePlus, Lightbulb, ListOrdered, ShieldBan,
  Siren, Target, History, Link2, ThumbsUp, ThumbsDown, RotateCcw, GitCompare, FileText, MessagesSquare, Mic,
  UserRound, ShieldCheck, Trash2, Sparkles, ChevronDown,
} from 'lucide-react'
import { useStore } from '../store'
import { DOMAINS, CONTENT_FIELDS } from '../data/expertise'
import TopBar from '../components/TopBar'
import { ExpertiseTabs, domainGradient } from './ExpertiseLibrary'
import { StatusBadge, fmtDate, timeAgo, Dropdown } from '../components/ui'

const LIST_SECTIONS = [
  { key: 'knowledge', title: 'Knowledge & heuristics', icon: Lightbulb, tone: 'text-sky-500', hint: 'What an expert knows that a newcomer doesn\'t. One per line.' },
  { key: 'decisionLogic', title: 'Decision logic', icon: ListOrdered, tone: 'text-violet-500', ordered: true, hint: 'The steps an expert follows, in order. One per line.' },
  { key: 'guardrails', title: 'Guardrails', icon: ShieldBan, tone: 'text-red-500', hint: 'What the AI must never recommend. One per line.' },
  { key: 'escalation', title: 'Escalation rules', icon: Siren, tone: 'text-amber-500', hint: 'When a human must take over, and who. One per line.' },
]

// ---------------------------------------------------------------- export
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
`
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

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
    <div className="space-y-2 rounded-xl bg-gray-50 p-3 font-mono text-[13px] dark:bg-gray-900">
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

// ---------------------------------------------------------------- sections
function Block({ icon: Icon, tone, title, children }) {
  return (
    <section className="card p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Icon size={16} className={tone} /> {title}</h3>
      {children}
    </section>
  )
}

function ListView({ items, ordered }) {
  if (!items.length) return <p className="text-sm italic text-gray-500">Nothing captured yet.</p>
  return (
    <ol className="space-y-2">
      {items.map((x, i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {ordered ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-500 dark:bg-gray-800">{i + 1}</span>
          ) : (
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
          )}
          <span>{x}</span>
        </li>
      ))}
    </ol>
  )
}

function Overview({ e, edit, draft, setDraft }) {
  const setList = (k, v) => setDraft({ ...draft, [k]: v.split('\n').map((s) => s.trim()).filter(Boolean) })
  return (
    <div className="space-y-4">
      <Block icon={Target} tone="text-accent-500" title="Purpose">
        {edit ? (
          <div className="space-y-3">
            <div>
              <p className="label mb-1">Summary</p>
              <textarea rows={2} className="input resize-none" value={draft.summary} onChange={(ev) => setDraft({ ...draft, summary: ev.target.value })} />
            </div>
            <div>
              <p className="label mb-1">When to use</p>
              <textarea rows={2} className="input resize-none" value={draft.whenToUse} onChange={(ev) => setDraft({ ...draft, whenToUse: ev.target.value })} />
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{e.summary || <i className="text-gray-500">No summary yet.</i>}</p>
            {e.whenToUse && (
              <p className="mt-3 text-sm"><span className="font-medium">When to use: </span><span className="text-gray-600 dark:text-gray-400">{e.whenToUse}</span></p>
            )}
          </>
        )}
      </Block>
      {LIST_SECTIONS.map((s) => (
        <Block key={s.key} icon={s.icon} tone={s.tone} title={s.title}>
          {edit ? (
            <>
              <p className="mb-1.5 text-xs text-gray-500">{s.hint}</p>
              <textarea
                rows={Math.max(3, draft[s.key].length + 1)}
                className="input resize-y leading-relaxed"
                defaultValue={draft[s.key].join('\n')}
                onBlur={(ev) => setList(s.key, ev.target.value)}
              />
            </>
          ) : (
            <ListView items={e[s.key]} ordered={s.ordered} />
          )}
        </Block>
      ))}
    </div>
  )
}

function Versions({ e }) {
  const { rollbackExpertise, user } = useStore()
  const [open, setOpen] = useState(null)
  const versions = [...e.versions].reverse()
  if (!versions.length)
    return <p className="card p-8 text-center text-sm text-gray-500">No approved versions yet. The first approval creates v1.0.</p>
  return (
    <div className="card divide-y divide-gray-100 dark:divide-gray-800">
      {versions.map((v, i) => {
        const current = i === 0
        return (
          <div key={v.version + i} className="p-4">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 rounded-lg px-2 py-0.5 font-mono text-xs ${current ? 'bg-emerald-500/15 text-emerald-500' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>v{v.version}</span>
              <div className="flex-1">
                <p className="text-sm font-medium">{v.note}</p>
                <p className="text-xs text-gray-500">
                  {fmtDate(v.date)} · by {v.author} · approved by {v.approvedBy}{current && ' · current'}
                </p>
              </div>
              {!current && v.snapshot && (
                <div className="flex gap-1">
                  <button className="btn-ghost text-xs" onClick={() => setOpen(open === i ? null : i)}><GitCompare size={14} /> Compare</button>
                  <button className="btn-ghost text-xs" disabled={user.role !== 'reviewer'} onClick={() => rollbackExpertise(e.id, v.version)} title={user.role !== 'reviewer' ? 'Reviewer only' : ''}>
                    <RotateCcw size={14} /> Roll back
                  </button>
                </div>
              )}
            </div>
            {open === i && (
              <div className="mt-3 animate-fadeIn">
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

const SOURCE_ICON = { conversation: MessagesSquare, interview: Mic, document: FileText }
function Sources({ e }) {
  if (!e.sources.length) return <p className="card p-8 text-center text-sm text-gray-500">No linked sources.</p>
  return (
    <div className="space-y-2">
      {e.sources.map((s, i) => {
        const Icon = SOURCE_ICON[s.type] || Link2
        const inner = (
          <div className="card flex gap-3 p-4 transition hover:ring-gray-300 dark:hover:ring-gray-700">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800"><Icon size={16} /></span>
            <div>
              <p className="text-sm font-medium">{s.title}</p>
              <p className="text-xs capitalize text-gray-500">{s.type} · {fmtDate(s.date)}</p>
              <p className="mt-1.5 text-sm italic text-gray-600 dark:text-gray-400">"{s.excerpt}"</p>
            </div>
          </div>
        )
        return s.chatId ? <Link key={i} to={`/c/${s.chatId}`}>{inner}</Link> : <div key={i}>{inner}</div>
      })}
    </div>
  )
}

function Feedback({ e }) {
  if (!e.feedback.length) return <p className="card p-8 text-center text-sm text-gray-500">No feedback yet. Ratings on answers that used this Expertise appear here.</p>
  return (
    <div className="card divide-y divide-gray-100 dark:divide-gray-800">
      {e.feedback.map((f, i) => (
        <div key={i} className="flex gap-3 p-4">
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

function Governance({ e, edit, draft, setDraft }) {
  const Row = ({ label, children }) => (
    <div className="flex justify-between gap-3 py-2 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
  const up = e.feedback.filter((f) => f.rating === 'up').length
  return (
    <aside className="space-y-4">
      <div className="card p-5">
        <h3 className="mb-1 text-sm font-semibold">Governance</h3>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          <Row label="Owner">
            {edit ? <input className="input py-1 text-right" value={draft.owner} onChange={(ev) => setDraft({ ...draft, owner: ev.target.value })} /> : (
              <span><span className="font-medium">{e.owner}</span>{e.ownerRole && <span className="block text-xs text-gray-500">{e.ownerRole}</span>}</span>
            )}
          </Row>
          <Row label="Reviewer">{e.reviewer || <span className="text-gray-500">Unassigned</span>}</Row>
          <Row label="Approval required">Reviewer role</Row>
          <Row label="Status"><StatusBadge status={e.status} /></Row>
          <Row label="Version"><span className="font-mono">v{e.version}</span></Row>
          <Row label="Created">{fmtDate(e.createdAt)}</Row>
          <Row label="Last updated">{timeAgo(e.updatedAt)}</Row>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">Boundaries</h3>
        <div className="space-y-2.5 text-sm">
          <p className="flex gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" /><span><b className="font-medium">May recommend</b> — the decision logic steps above.</span></p>
          <p className="flex gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" /><span><b className="font-medium">Needs a human</b> — any action; Fractal never executes.</span></p>
          <p className="flex gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" /><span><b className="font-medium">Must escalate</b> — {e.escalation.length} rule{e.escalation.length !== 1 && 's'} defined.</span></p>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">Usage</h3>
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-xl bg-gray-50 py-3 dark:bg-gray-900"><p className="text-xl font-semibold">{e.usageCount}</p><p className="text-xs text-gray-500">times applied</p></div>
          <div className="rounded-xl bg-gray-50 py-3 dark:bg-gray-900">
            <p className="text-xl font-semibold">{e.successRate != null ? `${Math.round(e.successRate * 100)}%` : e.feedback.length ? `${Math.round((up / e.feedback.length) * 100)}%` : '—'}</p>
            <p className="text-xs text-gray-500">helpful</p>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-1 text-sm font-semibold">Trigger keywords</h3>
        <p className="mb-2 text-xs text-gray-500">Used to auto-apply this Expertise in chats.</p>
        {edit ? (
          <input className="input" value={draft.keywords.join(', ')} onChange={(ev) => setDraft({ ...draft, keywords: ev.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        ) : (
          <div className="flex flex-wrap gap-1">
            {e.keywords.map((k) => <span key={k} className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400">{k}</span>)}
          </div>
        )}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------- page
export default function ExpertiseDetail() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const store = useStore()
  const { expertise, user, updateExpertise, submitForReview, approveExpertise, deprecateExpertise, deleteExpertise, proposeRevision, showToast } = store
  const e = expertise.find((x) => x.id === id)
  const edit = params.get('edit') === '1'
  const [tab, setTab] = useState('overview')
  const [draft, setDraft] = useState(null)

  useEffect(() => { if (e && edit) setDraft(structuredClone(e)) }, [edit, id]) // eslint-disable-line
  if (!e) return (
    <div className="flex h-full flex-col"><TopBar><ExpertiseTabs /></TopBar>
      <p className="p-16 text-center text-gray-500">Expertise not found. <Link className="text-accent-500" to="/expertise">Back to library</Link></p>
    </div>
  )

  const isReviewer = user.role === 'reviewer'
  const startEdit = () => setParams({ edit: '1' })
  const cancel = () => { setParams({}); setDraft(null) }
  const save = () => {
    if (e.status === 'approved') {
      const changes = {}
      for (const f of ['knowledge', 'decisionLogic', 'guardrails', 'escalation']) {
        const add = draft[f].filter((x) => !e[f].includes(x)), remove = e[f].filter((x) => !draft[f].includes(x))
        if (add.length || remove.length) changes[f] = { add, remove }
      }
      updateExpertise(e.id, { name: draft.name, domain: draft.domain, summary: draft.summary, whenToUse: draft.whenToUse, owner: draft.owner, keywords: draft.keywords })
      if (Object.keys(changes).length) proposeRevision(e.id, changes, 'Edited by ' + user.name)
      else showToast('Saved')
    } else {
      updateExpertise(e.id, draft)
      showToast('Draft saved')
    }
    setParams({})
  }
  const view = edit && draft ? draft : e

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'versions', label: 'Versions', n: e.versions.length },
    { id: 'sources', label: 'Sources', n: e.sources.length },
    { id: 'feedback', label: 'Feedback', n: e.feedback.length },
  ]

  return (
    <div className="flex h-full flex-col">
      <TopBar><ExpertiseTabs /></TopBar>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-4">
          <button onClick={() => navigate('/expertise')} className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
            <ArrowLeft size={15} /> All Expertise
          </button>

          {/* header */}
          <div className="flex flex-wrap items-start gap-4">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white ${domainGradient(view.domain)}`}>
              <Sparkles size={22} />
            </span>
            <div className="min-w-0 flex-1">
              {edit && draft ? (
                <div className="flex flex-wrap gap-2">
                  <input className="input max-w-md text-lg font-semibold" value={draft.name} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} />
                  <select className="input w-auto" value={draft.domain} onChange={(ev) => setDraft({ ...draft, domain: ev.target.value })}>
                    {DOMAINS.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight">{e.name}</h1>
                    <StatusBadge status={e.status} />
                    <span className="font-mono text-sm text-gray-500">v{e.version}</span>
                  </div>
                  <p className="text-sm text-gray-500">{e.domain} · owned by {e.owner}</p>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {edit ? (
                <>
                  <button className="btn-ghost" onClick={cancel}>Cancel</button>
                  <button className="btn-primary" onClick={save}>
                    <Save size={15} /> {e.status === 'approved' ? 'Propose changes' : 'Save draft'}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-outline" onClick={() => navigate('/', { state: { attach: e.id } })} disabled={e.status !== 'approved'} title={e.status !== 'approved' ? 'Only approved Expertise can be used in chat' : ''}>
                    <MessageSquarePlus size={15} /> Use in chat
                  </button>
                  <Dropdown
                    align="right"
                    trigger={() => <button className="btn-outline"><Download size={15} /> Export <ChevronDown size={13} /></button>}
                  >
                    <button className="menu-item" onClick={() => download(`${slug(e.name)}.md`, toMarkdown(e), 'text/markdown')}><FileText size={15} /> Markdown (SKILL.md)</button>
                    <button className="menu-item" onClick={() => download(`${slug(e.name)}.json`, JSON.stringify(e, null, 2), 'application/json')}><FileText size={15} /> JSON</button>
                  </Dropdown>
                  <button className="btn-outline" onClick={startEdit}><Pencil size={15} /> Edit</button>
                  {e.status === 'draft' && <button className="btn-primary" onClick={() => submitForReview(e.id)}><Send size={15} /> Submit for review</button>}
                  {e.status === 'in_review' && (
                    <button className="btn-accent" disabled={!isReviewer} onClick={() => approveExpertise(e.id, 'Initial approval')} title={!isReviewer ? 'Reviewer only' : ''}>
                      <Check size={15} /> Approve
                    </button>
                  )}
                  <Dropdown align="right" trigger={() => <button className="btn-ghost px-2">•••</button>}>
                    {e.status === 'approved' && (
                      <button className="menu-item" disabled={!isReviewer} onClick={() => deprecateExpertise(e.id)}><Archive size={15} /> Deprecate</button>
                    )}
                    {e.status === 'deprecated' && (
                      <button className="menu-item" disabled={!isReviewer} onClick={() => updateExpertise(e.id, { status: 'approved' })}><RotateCcw size={15} /> Restore</button>
                    )}
                    <button className="menu-item text-red-500" onClick={() => { deleteExpertise(e.id); navigate('/expertise') }}><Trash2 size={15} /> Delete</button>
                  </Dropdown>
                </>
              )}
            </div>
          </div>

          {edit && e.status === 'approved' && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-indigo-500/10 px-4 py-2.5 text-sm text-indigo-500 ring-1 ring-indigo-500/25">
              <ShieldCheck size={16} /> This Expertise is live. Changes to its content will be sent to the Review Queue as a proposed revision.
            </div>
          )}

          {/* tabs */}
          <div className="mt-6 flex gap-1 border-b border-gray-200 dark:border-gray-800">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-3 pb-2.5 text-sm font-medium transition ${tab === t.id ? 'border-gray-900 dark:border-white' : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-100'}`}
              >
                {t.label} {t.n > 0 && <span className="ml-1 text-xs text-gray-500">{t.n}</span>}
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_300px]">
            <div className="min-w-0">
              {tab === 'overview' && <Overview e={e} edit={edit && !!draft} draft={draft} setDraft={setDraft} />}
              {tab === 'versions' && <Versions e={e} />}
              {tab === 'sources' && <Sources e={e} />}
              {tab === 'feedback' && <Feedback e={e} />}
            </div>
            <Governance e={e} edit={edit && !!draft} draft={draft} setDraft={setDraft} />
          </div>
        </div>
      </div>
    </div>
  )
}
