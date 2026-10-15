// Knowledge gaps: what real questions needed that no approved Expertise covers yet.
// The Weigh engine already names this (app/weigh/engine.py's `gaps` field) every time it
// weighs a question against the Expertise it found -- this page is where that signal,
// previously shown once in the Weigh panel and then lost, accumulates so a reviewer or
// contributor can see what's worth documenting next, with repeats counted rather than
// re-listed.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleHelp, Lock, Check, X, Tag } from 'lucide-react'
import { useStore } from '../store'
import { USE_MOCK } from '../lib/api'
import { canOpenQueue, isReviewer } from '../lib/permissions'
import { timeAgo } from '../components/ui'
import { Breadcrumb } from './ExpertiseLayout'

const TABS = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' },
]

function HitBadge({ hits }) {
  if (hits <= 1) return <span className="text-[11px] text-gray-400">Asked once</span>
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
      Asked {hits}×
    </span>
  )
}

function GapCard({ gap, canTriage, onDismiss, onResolve, busy }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <CircleHelp size={16} className="mt-0.5 shrink-0 text-gray-400" />
          <p className="text-sm font-medium leading-snug text-gray-900 dark:text-gray-100">{gap.text}</p>
        </div>
        <HitBadge hits={gap.hits} />
      </div>

      {gap.domains?.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
          {gap.domains.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              <Tag size={10} /> {d}
            </span>
          ))}
        </div>
      )}

      {gap.question && (
        <p className="mt-2 pl-[26px] text-xs italic text-gray-500">Last asked: "{gap.question}"</p>
      )}

      <div className="mt-2.5 flex items-center justify-between pl-[26px]">
        <p className="text-[11px] text-gray-400">Last seen {timeAgo(gap.lastSeen)}</p>
        {canTriage && gap.status === 'open' && (
          <div className="flex items-center gap-1.5">
            <button className="btn-ghost h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => onDismiss(gap.id)}>
              <X size={13} /> Not a gap
            </button>
            <button className="btn-outline h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => onResolve(gap.id)}>
              <Check size={13} /> Mark resolved
            </button>
          </div>
        )}
        {gap.status !== 'open' && (
          <span className={`text-[11px] font-medium ${gap.status === 'resolved' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
            {gap.status === 'resolved' ? 'Resolved' : 'Dismissed'}
          </span>
        )}
      </div>
    </div>
  )
}

export default function KnowledgeGaps() {
  const user = useStore((s) => s.user)
  const [tab, setTab] = useState('open')
  const [gapsList, setGapsList] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const canView = canOpenQueue(user)
  const canTriage = isReviewer(user)

  useEffect(() => {
    if (!canView || USE_MOCK || !user) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const { apiFor } = await import('../lib/api')
        const res = await apiFor(user).listGaps(tab)
        if (!cancelled) setGapsList(res)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load knowledge gaps')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [canView, user, tab])

  async function act(id, kind) {
    setBusyId(id)
    try {
      const { apiFor } = await import('../lib/api')
      if (kind === 'dismiss') await apiFor(user).dismissGap(id)
      else await apiFor(user).resolveGap(id)
      setGapsList((list) => list.filter((g) => g.id !== id))
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setBusyId(null)
    }
  }

  if (!canView)
    return (
      <div className="mx-auto max-w-xl px-8 pt-24 text-center">
        <Lock size={22} className="mx-auto text-gray-400" />
        <h1 className="mt-3 text-xl font-semibold">Knowledge Gaps is for experts and reviewers</h1>
        <p className="mt-2 text-sm text-gray-500">As an intern you can read every approved Expertise, but what's missing is tracked for domain experts and the Reviewer to act on.</p>
        <Link to="/expertise" className="btn-outline mt-5">Browse Expertise</Link>
      </div>
    )

  if (USE_MOCK)
    return (
      <div className="mx-auto max-w-2xl px-8 pb-16 pt-8">
        <Breadcrumb items={[{ label: 'Expertise', to: '/expertise' }, { label: 'Knowledge Gaps' }]} />
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Knowledge Gaps</h1>
        <p className="mt-1 text-sm text-gray-500">What real questions needed that no approved Expertise covers yet.</p>
        <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
          <CircleHelp size={28} className="text-gray-400" />
          <p className="mt-3 text-sm font-medium text-gray-600 dark:text-gray-400">Knowledge Gaps requires the backend</p>
          <p className="mt-1 max-w-xs text-xs text-gray-500">Gaps are surfaced by the Weigh engine and stored in the database. Start the backend (see <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800">backend/README.md</code>) or set <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800">VITE_USE_MOCK=false</code>.</p>
        </div>
      </div>
    )

  return (
    <div className="mx-auto max-w-3xl px-8 pb-16 pt-8">
      <Breadcrumb items={[{ label: 'Expertise', to: '/expertise' }, { label: 'Knowledge Gaps' }]} />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Knowledge Gaps</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        What real questions needed that no approved Expertise covers -- surfaced automatically when the Weigh engine checks a question against the Expertise it found. A gap asked more than once is worth documenting first.
      </p>

      <div className="mt-6 flex items-center gap-1 border-b border-gray-100 dark:border-gray-850">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.key
                ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p className="mt-8 text-sm text-gray-500">Loading…</p>}
      {error && <p className="mt-8 text-sm text-red-500">{error}</p>}

      {gapsList && (
        <div className="mt-5 space-y-3">
          {gapsList.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
              <CircleHelp size={24} className="text-gray-400" />
              <p className="mt-3 text-sm font-medium text-gray-600 dark:text-gray-400">
                {tab === 'open' ? 'No open knowledge gaps' : `No ${tab} gaps`}
              </p>
              {tab === 'open' && <p className="mt-1 max-w-xs text-xs text-gray-500">Gaps appear here once a question in chat or Weigh needs something none of your approved Expertise covers.</p>}
            </div>
          )}
          {gapsList.map((g) => (
            <GapCard key={g.id} gap={g} canTriage={canTriage} busy={busyId === g.id}
              onDismiss={(id) => act(id, 'dismiss')} onResolve={(id) => act(id, 'resolve')} />
          ))}
        </div>
      )}
    </div>
  )
}
