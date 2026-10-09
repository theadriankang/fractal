import { Link } from 'react-router-dom'
import { Check, X, Sparkles, GitPullRequestArrow, FileEdit, ShieldAlert, MessageSquare, Mic } from 'lucide-react'
import { useStore } from '../store'
import { domainGradient } from '../data/taxonomy'
import { Breadcrumb } from './ExpertiseLayout'
import { StatusBadge, timeAgo } from '../components/ui'

const FIELD_LABELS = {
  knowledge: 'Knowledge & heuristics',
  decisionLogic: 'Decision logic',
  guardrails: 'Guardrails',
  escalation: 'Escalation rules',
}

function RoleNotice() {
  const role = useStore((s) => s.user.role)
  if (role === 'reviewer') return null
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-600 ring-1 ring-amber-500/25 dark:text-amber-400">
      <ShieldAlert size={16} /> You're a Contributor. Only Reviewers can approve changes — switch roles from the user menu to try it.
    </div>
  )
}

function ProposalCard({ p }) {
  const { expertise, approveProposal, rejectProposal, user } = useStore()
  const e = expertise.find((x) => x.id === p.expertiseId)
  if (!e) return null
  const canReview = user.role === 'reviewer'
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
          {p.chatId && <Link to={`/c/${p.chatId}`} className="mt-2 inline-block text-xs text-accent-500 hover:underline">View source conversation →</Link>}
          {p.meetingTitle && <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500"><Mic size={12} /> From meeting: {p.meetingTitle} · <Link to="/meetings" className="text-accent-500 hover:underline">Meeting Recorder →</Link></p>}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button className="btn-outline" disabled={!canReview} onClick={() => rejectProposal(p.id)}><X size={15} /> Reject</button>
          <button className="btn-accent" disabled={!canReview} onClick={() => approveProposal(p.id)}><Check size={15} /> Approve & merge</button>
        </div>
      </div>
    </div>
  )
}

function DraftCard({ e }) {
  const { approveExpertise, rejectExpertise, submitForReview, user } = useStore()
  const canReview = user.role === 'reviewer'
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
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Link to={`/expertise/${e.id}?edit=1`} className="btn-outline">Edit</Link>
          {e.status === 'draft' ? (
            <button className="btn-primary" onClick={() => submitForReview(e.id)}>Submit for review</button>
          ) : (
            <>
              <button className="btn-outline" disabled={!canReview} onClick={() => rejectExpertise(e.id)}><X size={15} /></button>
              <button className="btn-accent" disabled={!canReview} onClick={() => approveExpertise(e.id, 'Initial approval')}><Check size={15} /> Approve</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ReviewQueue() {
  const { expertise, proposals } = useStore()
  const inReview = expertise.filter((e) => e.status === 'in_review')
  const drafts = expertise.filter((e) => e.status === 'draft')

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
          <RoleNotice />
          <Group title="Awaiting approval" desc="Submitted Expertise ready for a reviewer's decision." n={inReview.length}>
            {inReview.map((e) => <DraftCard key={e.id} e={e} />)}
          </Group>
          <Group title="Proposed revisions" desc="Changes to live Expertise, generated from feedback and conversations." n={proposals.length}>
            {proposals.map((p) => <ProposalCard key={p.id} p={p} />)}
          </Group>
          <Group title="Drafts" desc="Captured or started, but not yet submitted. The owner should complete guardrails and decision logic first." n={drafts.length}>
            {drafts.map((e) => <DraftCard key={e.id} e={e} />)}
          </Group>
        </div>
      </div>
    </div>
  )
}
