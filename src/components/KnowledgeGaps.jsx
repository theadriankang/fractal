// "Knowledge gaps" tab of the Review Queue: questions approved Expertise couldn't answer
// (backend/app/gaps.py), most-asked first. Experts capture them as draft Expertise; approving that
// draft resolves the gap. The Reviewer, or an expert in the gap's domain, can dismiss off-topic ones.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CircleHelp, Users, PenLine, RefreshCw, X, CheckCircle2, Loader2, MessagesSquare } from 'lucide-react'
import { useStore } from '../store'
import { contributeBlock, isReviewer } from '../lib/permissions'
import { domainGradient } from '../data/taxonomy'
import { timeAgo } from './ui'

const STATUS = {
  open: { label: 'Open', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  drafting: { label: 'Being captured', cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  resolved: { label: 'Answered', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  dismissed: { label: 'Dismissed', cls: 'bg-gray-500/10 text-gray-500' },
}

function GapCard({ g }) {
  const { user, expertise, captureGap, recheckGap, dismissGap } = useStore()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const domain = g.domain || (user.domains[0] ?? null)
  const captureBlock = contributeBlock(user, domain || 'this')
  const mayDismiss = isReviewer(user) || (g.domain && user.domains.includes(g.domain))
  const draft = g.expertiseId && expertise.find((e) => e.id === g.expertiseId)
  const closed = g.status === 'resolved' || g.status === 'dismissed'
  const others = g.examples.filter((x) => x.question !== g.question)
  const people = g.askers.length

  const capture = () => navigate(`/expertise/${captureGap(g)}?edit=1`)
  const recheck = async () => { setBusy(true); await recheckGap(g.id); setBusy(false) }

  return (
    <div className={`card p-4 ${closed ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${g.domain ? `bg-gradient-to-br ${domainGradient(g.domain)}` : 'bg-gray-400 dark:bg-gray-600'}`}>
          <CircleHelp size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[g.status].cls}`}>{STATUS[g.status].label}</span>
            <span className="text-xs text-gray-500">{g.domain || 'Unsorted'}</span>
            <span className="flex items-center gap-1 text-xs text-gray-500" title={g.askers.map((a) => a.name).join(', ')}>
              <Users size={12} /> asked {g.askCount}× by {people} {people === 1 ? 'person' : 'people'}
            </span>
            <span className="text-xs text-gray-500">· last {timeAgo(g.lastAskedAt)}</span>
          </div>
          <p className="mt-1.5 font-medium">“{g.question}”</p>
          {others.length > 0 && (
            <div className="mt-1 text-xs text-gray-500">
              <button className="hover:underline" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Hide' : `${others.length} other wording${others.length > 1 ? 's' : ''}`}
              </button>
              {showAll && (
                <ul className="mt-1 space-y-0.5">
                  {others.map((x, i) => (
                    <li key={i} className="flex gap-1.5"><MessagesSquare size={12} className="mt-0.5 shrink-0" /> “{x.question}” — {x.asker}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="mt-1.5 text-xs text-gray-500">
            {g.kind === 'weak'
              ? `Only a weak match today (score ${g.bestScore.toFixed(2)}${g.nearestExpertiseName ? `, closest: ${g.nearestExpertiseName}` : ''}).`
              : `No approved Expertise matched${g.nearestExpertiseName ? `; closest is ${g.nearestExpertiseName}` : ''}.`}
          </p>
          {g.status === 'drafting' && draft && (
            <p className="mt-1 text-xs text-sky-600 dark:text-sky-400">
              Draft in progress: <Link to={`/expertise/${draft.id}`} className="underline">{draft.name}</Link> ({draft.status.replace('_', ' ')}). Approving it closes this gap.
            </p>
          )}
          {closed && g.resolution && (
            <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
              {g.status === 'resolved' && <CheckCircle2 size={12} className="text-emerald-500" />}
              {g.resolution}{g.resolvedBy ? ` · ${g.resolvedBy}` : ''}
              {g.status === 'resolved' && g.expertiseId && <> · <Link to={`/expertise/${g.expertiseId}`} className="underline">open</Link></>}
            </p>
          )}
        </div>
        {!closed && (
          <div className="flex w-full shrink-0 flex-wrap justify-end gap-1.5 sm:w-auto">
            {mayDismiss && (
              <button className="btn-outline" title="Not something to capture (off-topic, one-off, vendor's problem)" onClick={() => dismissGap(g.id)}>
                <X size={15} />
              </button>
            )}
            <button className="btn-outline" disabled={busy} title="Check whether approved Expertise answers it now" onClick={recheck}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            </button>
            {g.status === 'open' && (
              <button className="btn-accent" disabled={!!captureBlock} title={captureBlock || 'Start a draft Expertise from this question'} onClick={capture}>
                <PenLine size={15} /> Capture this
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function KnowledgeGaps() {
  const { gaps, loadGaps, user, dataSource } = useStore()
  const [loading, setLoading] = useState(true)
  const [showClosed, setShowClosed] = useState(false)
  useEffect(() => { loadGaps().finally(() => setLoading(false)) }, [loadGaps, dataSource])

  if (dataSource !== 'supabase') {
    return <p className="mt-8 rounded-2xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-500 dark:border-gray-800">Knowledge gaps need the Fractal backend; it isn’t connected.</p>
  }
  const active = gaps.filter((g) => g.status === 'open' || g.status === 'drafting')
  const closed = gaps.filter((g) => g.status === 'resolved' || g.status === 'dismissed')
  const mine = isReviewer(user) ? active : active.filter((g) => g.domain && user.domains.includes(g.domain))
  const rest = active.filter((g) => !mine.includes(g))
  const totalAsks = active.reduce((n, g) => n + g.askCount, 0)
  const openCount = active.filter((g) => g.status === 'open').length
  const drafting = active.length - openCount

  const List = ({ title, desc, items }) => (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 font-semibold">{title} <span className="text-sm font-normal text-gray-500">{items.length}</span></h2>
      {desc && <p className="mb-3 text-sm text-gray-500">{desc}</p>}
      <div className="space-y-3">
        {items.length ? items.map((g) => <GapCard key={g.id} g={g} />) : <p className="rounded-2xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-500 dark:border-gray-800">Nothing here 🎉</p>}
      </div>
    </section>
  )

  return (
    <div>
      <p className="mt-4 text-sm text-gray-500">
        Questions people asked that no approved Expertise could answer, most-asked first. This is what to capture next.
        {active.length > 0 && <> <span className="font-medium text-gray-700 dark:text-gray-300">{openCount} open{drafting ? `, ${drafting} being captured` : ''} · asked {totalAsks} times in all.</span></>}
      </p>
      {loading && !gaps.length ? (
        <p className="mt-8 flex items-center justify-center gap-2 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" /> Loading knowledge gaps…</p>
      ) : (
        <>
          {isReviewer(user) ? (
            <List title="Open gaps" desc="Every domain. Experts capture these; you can dismiss off-topic ones." items={mine} />
          ) : (
            <>
              <List title={`For your domains (${user.domains.join(', ')})`} desc="Questions your colleagues needed an answer to. Capture one to start a draft." items={mine} />
              {rest.length > 0 && <List title="Other domains and unsorted" desc="Visible so you can spot overlaps; only that domain’s experts can capture them." items={rest} />}
            </>
          )}
          {closed.length > 0 && (
            <div className="mt-8">
              <button className="text-sm text-gray-500 hover:underline" onClick={() => setShowClosed((v) => !v)}>
                {showClosed ? 'Hide' : 'Show'} answered and dismissed ({closed.length})
              </button>
              {showClosed && <div className="mt-3 space-y-3">{closed.map((g) => <GapCard key={g.id} g={g} />)}</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
