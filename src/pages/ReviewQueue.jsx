import { Link } from 'react-router-dom'
import { Check, X, Sparkles, GitPullRequestArrow, FileEdit, ShieldCheck, Lock, MessageSquare, Mic, Quote, AlertTriangle } from 'lucide-react'
import { canEdit, contributeBlock, reviewBlock, isReviewer, isIntern } from '../lib/permissions'
import { readiness } from '../lib/readiness'
import { similarExpertise } from '../lib/capture'
import { useStore, queueFor } from '../store'
import { domainGradient } from '../data/taxonomy'
import { Breadcrumb } from './ExpertiseLayout'
import { StatusBadge, timeAgo } from '../components/ui'

// Where a captured item came from: the expert's own words + the extractor's confidence.
function Provenance({ sources, capture }) {
  const src = sources?.find((x) => x.type === 'conversation' || x.type === 'meeting')
  if (!src && !capture) return null
  return (
    <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-400 dark:ring-gray-800">
      {src?.excerpt && <p className="flex gap-1.5 italic"><Quote size={12} className="mt-0.5 shrink-0" /> {src.excerpt}</p>}
      <p className="mt-1 text-gray-500">
        {capture?.capturedBy || src?.capturedBy ? `Said by ${capture?.capturedBy || src.capturedBy}` : 'Source'}
        {capture?.confidence != null && ` · extractor confidence ${Math.round(capture.confidence * 100)}%`}
        {capture?.detector === 'keyword' && ' · keyword match (offline)'}
      </p>
    </div>
  )
}

const FIELD_LABELS = {
  knowledge: 'Knowledge & heuristics',
  decisionLogic: 'Decision logic',
  guardrails: 'Guardrails',
  escalation: 'Escalation rules',
}

// Tells each account which slice of the queue it is looking at and what it may decide.
function ScopeNotice() {
  const user = useStore((s) => s.user)
  if (isReviewer(user))
    return (
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-indigo-500/10 px-4 py-2.5 text-sm text-indigo-600 ring-1 ring-indigo-500/25 dark:text-indigo-300">
        <ShieldCheck size={16} /> You’re the Reviewer: every domain’s queue is shown and you can decide any item.
      </div>
    )
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl bg-gray-500/5 px-4 py-2.5 text-sm text-gray-600 ring-1 ring-gray-500/15 dark:text-gray-300">
      <ShieldCheck size={16} className="shrink-0" />
      Showing the {user.domains.join(' and ')} queue{user.domains.length > 1 ? 's' : ''}. You can approve other experts’ work here, never your own; the Reviewer sees every domain.
    </div>
  )
}

function ProposalCard({ p }) {
  const { expertise, approveProposal, rejectProposal, user } = useStore()
  const e = expertise.find((x) => x.id === p.expertiseId)
  if (!e) return null
  const block = reviewBlock(user, e.domain, p)
  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400"><GitPullRequestArrow size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">Revision to <Link to={`/expertise/${e.id}`} className="hover:underline">{e.name}</Link></p>
            <span className="font-mono text-xs text-gray-500">v{e.version} → v{e.version.split('.')[0]}.{Number(e.version.split('.')[1] || 0) + 1}</span>
          </div>
          <p className="text-xs text-gray-500">{p.author} · {timeAgo(p.createdAt)}</p>
          <p className="mt-2 flex items-start gap-1.5 text-sm text-gray-600 dark:text-gray-400"><MessageSquare size={14} className="mt-0.5 shrink-0" /> "{p.reason}"</p>
          <div className="mt-3 space-y-2 rounded-xl bg-gray-50 p-3 font-mono text-[13px] dark:bg-gray-900">
            {Object.entries(p.changes).map(([field, { add = [], remove = [] }]) => (
              <div key={field}>
                <p className="mb-1 font-sans text-xs font-medium text-gray-500">{FIELD_LABELS[field] || field}</p>
                {remove.map((r, i) => <p key={'r' + i} className="text-red-500">− {r}</p>)}
                {add.map((a, i) => <p key={'a' + i} className="text-emerald-500">+ {a}</p>)}
              </div>
            ))}
          </div>
          {p.capture && <Provenance sources={p.sources} capture={p.capture} />}
          {p.chatId && <Link to={`/c/${p.chatId}`} className="mt-2 inline-block text-xs text-accent-500 hover:underline">View source conversation →</Link>}
          {p.meetingTitle && <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500"><Mic size={12} /> From meeting: {p.meetingTitle} · <Link to="/meetings" className="text-accent-500 hover:underline">Meeting Recorder →</Link></p>}
          {block && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-500"><Lock size={12} /> {block}</p>}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button className="btn-outline" disabled={!!block} title={block || ''} onClick={() => rejectProposal(p.id)}><X size={15} /> Reject</button>
          <button className="btn-accent" disabled={!!block} title={block || ''} onClick={() => approveProposal(p.id)}><Check size={15} /> Approve & merge</button>
        </div>
      </div>
    </div>
  )
}

function DraftCard({ e }) {
  const { approveExpertise, rejectExpertise, submitForReview, user, expertise } = useStore()
  const decideBlock = reviewBlock(user, e.domain, e)
  const mayEdit = canEdit(user, e)
  const block = contributeBlock(user, e.domain)
  const { missing } = readiness(e)
  // Possible near-duplicate in the same domain, so the reviewer can merge instead of approving twice.
  const overlap = similarExpertise(`${e.name} ${e.summary} ${e.knowledge.join(' ')}`, expertise.filter((x) => x.id !== e.id && x.domain === e.domain), [], 1)[0]
  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white ${domainGradient(e.domain)}`}>
          {e.origin === 'auto-detected' ? <Sparkles size={17} /> : <FileEdit size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/expertise/${e.id}`} className="font-medium hover:underline">{e.name}</Link>
            <StatusBadge status={e.status} />
          </div>
          <p className="text-xs text-gray-500">
            {e.domain} › {e.topic} · {e.origin === 'auto-detected' ? `Auto-detected from a ${e.sources?.[0]?.type === 'meeting' ? 'meeting' : 'conversation'}` : `Created by ${e.owner}`} · {timeAgo(e.updatedAt)}
          </p>
          <p className="mt-2 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">{e.summary}</p>
          <div className="mt-2 flex gap-4 text-xs text-gray-500">
            <span>{e.knowledge.length} knowledge items</span>
            <span>{e.decisionLogic.length} decision steps</span>
            <span className={e.guardrails.length ? '' : 'text-amber-500'}>{e.guardrails.length} guardrails</span>
            <span className={e.escalation.length ? '' : 'text-amber-500'}>{e.escalation.length} escalation rules</span>
          </div>
          {e.origin === 'auto-detected' && <Provenance sources={e.sources} capture={e.capture} />}
          {overlap && (
            <p className="mt-2 text-xs text-amber-500">
              <AlertTriangle size={12} className="mr-1.5 inline -translate-y-px" />
              Possible overlap with <Link to={`/expertise/${overlap.id}`} className="underline">{overlap.name}</Link>. Consider a revision instead.
            </p>
          )}
          {e.status === 'draft' && missing.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">Still needs: {missing.map((m) => m.label.toLowerCase()).join('; ')}</p>
          )}
          {e.status === 'in_review' && decideBlock && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-500"><Lock size={12} /> {decideBlock}</p>}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {mayEdit && <Link to={`/expertise/${e.id}?edit=1`} className="btn-outline">Edit</Link>}
          {e.status === 'draft' ? (
            <button className="btn-primary" disabled={!mayEdit || missing.length > 0} title={block || (missing.length ? 'Complete the checklist on the draft first' : '')} onClick={() => submitForReview(e.id)}>Submit for review</button>
          ) : (
            <>
              <button className="btn-outline" disabled={!!decideBlock} title={decideBlock || 'Send back to draft'} onClick={() => rejectExpertise(e.id)}><X size={15} /></button>
              <button className="btn-accent" disabled={!!decideBlock} title={decideBlock || ''} onClick={() => approveExpertise(e.id, 'Initial approval')}><Check size={15} /> Approve</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ReviewQueue() {
  const state = useStore()
  if (isIntern(state.user))
    return (
      <div className="mx-auto max-w-xl px-8 pt-24 text-center">
        <Lock size={22} className="mx-auto text-gray-400" />
        <h1 className="mt-3 text-xl font-semibold">The Review Queue is for experts and reviewers</h1>
        <p className="mt-2 text-sm text-gray-500">As an intern you can read every approved Expertise and Fractal applies it to your answers automatically. Contributing and reviewing need a domain expert account.</p>
        <Link to="/expertise" className="btn-outline mt-5">Browse Expertise</Link>
      </div>
    )
  const { inReview, drafts, proposals } = queueFor(state)

  const Group = ({ title, desc, children, n }) => (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 font-semibold">{title} <span className="text-sm font-normal text-gray-500">{n}</span></h2>
      <p className="mb-3 text-sm text-gray-500">{desc}</p>
      <div className="space-y-3">{n ? children : <p className="rounded-2xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-500 dark:border-gray-800">Nothing here 🎉</p>}</div>
    </section>
  )

  return (
    <div>
      <div>
        <div className="mx-auto max-w-4xl px-8 pb-16 pt-8">
          <Breadcrumb items={[{ label: 'Expertise', to: '/expertise' }, { label: 'Review Queue' }]} />
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Review Queue</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Nothing reaches operational use without a human. New Expertise and every change to an existing one — from experts, corrections or 👎 feedback — waits here for a Reviewer.
          </p>
          <ScopeNotice />
          <Group title="Awaiting approval" desc="Submitted Expertise ready for a reviewer's decision." n={inReview.length}>
            {inReview.map((e) => <DraftCard key={e.id} e={e} />)}
          </Group>
          <Group title="Proposed revisions" desc="Changes to live Expertise, generated from feedback and conversations." n={proposals.length}>
            {proposals.map((p) => <ProposalCard key={p.id} p={p} />)}
          </Group>
          <Group title="Drafts" desc="Captured or started, but not yet submitted. Only experts in the draft's domain can complete and submit it." n={drafts.length}>
            {drafts.map((e) => <DraftCard key={e.id} e={e} />)}
          </Group>
        </div>
      </div>
    </div>
  )
}
