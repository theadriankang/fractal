// Business-value / impact panel: a single read-only view aggregating numbers that
// already exist across Expertise, Proposal, Feedback and AuditLog -- how much
// governed know-how has actually been captured, how much of it is approved and in
// active use, and whether people found the answers it grounds helpful. None of this
// is a new data source; it's a summary that didn't exist anywhere before, so the
// only way to answer "is this actually working" was to page through individual
// records by hand.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, CheckCircle2, ThumbsUp, GitPullRequestArrow, Users, Lock } from 'lucide-react'
import { useStore } from '../store'
import { USE_MOCK } from '../lib/api'
import { isIntern } from '../lib/permissions'
import { Breadcrumb } from './ExpertiseLayout'

function pct(x) {
  return x == null ? '—' : `${Math.round(x * 100)}%`
}

// One consistent treatment for every stat -- a muted uppercase label with an inline
// icon (never a colored chip competing with its neighbors), a large number, and a
// short caption. Color is reserved for meaning (see ValueTone below), not decoration.
function StatCard({ label, value, sub, icon: Icon, valueTone, trend }) {
  const valueCls = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
  }[valueTone] || 'text-gray-900 dark:text-white'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex min-h-[28px] items-start gap-1.5 text-gray-400 dark:text-gray-500">
        <Icon size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
        <span className="text-[11px] font-medium uppercase leading-tight tracking-wide">{label}</span>
      </div>
      <p className={`mt-2 text-[28px] font-semibold leading-none tracking-tight ${valueCls}`}>{value}</p>
      {trend && <Sparkline values={trend} tone={valueTone} />}
      {sub && <p className="mt-2 text-xs leading-snug text-gray-500">{sub}</p>}
    </div>
  )
}

// A minimal trend line -- no axes, no gridlines, just the shape of the last
// 14 days, in the style of a report-card sparkline. Null points (e.g. a rate
// with no denominator yet) are skipped rather than drawn as zero.
function Sparkline({ values, tone = 'gray', width = 96, height = 26 }) {
  const points = (values || [])
    .map((v, i) => ({ x: i, y: v }))
    .filter((p) => p.y != null)
  if (points.length < 2) return null

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const pad = 2
  const coords = points.map((p) => {
    const x = pad + ((p.x - minX) / rangeX) * (width - pad * 2)
    const y = height - pad - ((p.y - minY) / rangeY) * (height - pad * 2)
    return [x, y]
  })
  const strokeCls = {
    emerald: 'stroke-emerald-500',
    amber: 'stroke-amber-500',
    gray: 'stroke-gray-400 dark:stroke-gray-600',
  }[tone] || 'stroke-gray-400 dark:stroke-gray-600'
  const dotCls = {
    emerald: 'fill-emerald-500',
    amber: 'fill-amber-500',
    gray: 'fill-gray-400 dark:fill-gray-600',
  }[tone] || 'fill-gray-400 dark:fill-gray-600'
  const [lastX, lastY] = coords[coords.length - 1]

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mt-2 overflow-visible">
      <polyline
        points={coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
        fill="none"
        className={strokeCls}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2" className={dotCls} />
    </svg>
  )
}

function DomainBar({ domain, total, approved }) {
  const share = total ? Math.round((approved / total) * 100) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-gray-700 dark:text-gray-300">{domain}</span>
        <span className="text-gray-500">{approved}/{total} approved</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
        <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${share}%` }} />
      </div>
    </div>
  )
}

export default function Impact() {
  const user = useStore((s) => s.user)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const canView = !isIntern(user)

  useEffect(() => {
    if (!canView || USE_MOCK || !user) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const { apiFor } = await import('../lib/api')
        const res = await apiFor(user).getImpact()
        if (!cancelled) setData(res)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load impact data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [canView, user])

  if (!canView)
    return (
      <div className="mx-auto max-w-xl px-8 pt-24 text-center">
        <Lock size={22} className="mx-auto text-gray-400" />
        <h1 className="mt-3 text-xl font-semibold">Impact is for experts and reviewers</h1>
        <p className="mt-2 text-sm text-gray-500">As an intern you can read every approved Expertise, but the usage and governance summary is limited to domain experts and the Reviewer.</p>
        <Link to="/expertise" className="btn-outline mt-5">Browse Expertise</Link>
      </div>
    )

  if (USE_MOCK)
    return (
      <div className="mx-auto max-w-2xl px-8 pb-16 pt-8">
        <Breadcrumb items={[{ label: 'Expertise', to: '/expertise' }, { label: 'Impact' }]} />
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Impact</h1>
        <p className="mt-1 text-sm text-gray-500">How much governed know-how has been captured, approved and used.</p>
        <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
          <BarChart3 size={28} className="text-gray-400" />
          <p className="mt-3 text-sm font-medium text-gray-600 dark:text-gray-400">Impact requires the backend</p>
          <p className="mt-1 max-w-xs text-xs text-gray-500">These numbers are computed from the database through the FastAPI backend. Start the backend (see <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800">backend/README.md</code>) or set <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800">VITE_USE_MOCK=false</code>.</p>
        </div>
      </div>
    )

  return (
    <div className="mx-auto max-w-4xl px-8 pb-16 pt-8">
      <Breadcrumb items={[{ label: 'Expertise', to: '/expertise' }, { label: 'Impact' }]} />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Impact</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        How much governed know-how has been captured, approved and actually used — computed live from Expertise, feedback and the audit trail, not estimated.
      </p>

      {loading && <p className="mt-8 text-sm text-gray-500">Loading…</p>}
      {error && <p className="mt-8 text-sm text-red-500">{error}</p>}

      {data && (
        <>
          <div className="mt-6 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Scorecard</h2>
            {data.trend?.labels?.length > 0 && (
              <span className="text-[11px] text-gray-400">{data.trend.labels[0]}–{data.trend.labels[data.trend.labels.length - 1]} trend</span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              icon={BarChart3}
              label="Expertise captured"
              value={data.totalExpertise}
              trend={data.trend?.totalExpertise}
              sub={`${data.approvedExpertise} approved · ${data.inReviewExpertise} in review · ${data.draftExpertise} draft`}
            />
            <StatCard
              icon={CheckCircle2}
              valueTone="emerald"
              label="Approval rate"
              value={pct(data.approvalRate)}
              trend={data.trend?.approvalRate}
              sub="of Expertise that ever reached approved"
            />
            <StatCard
              icon={ThumbsUp}
              valueTone="emerald"
              label="Positive feedback"
              value={pct(data.feedbackPositiveRate)}
              trend={data.trend?.feedbackPositiveRate}
              sub={`${data.feedbackUp} 👍 · ${data.feedbackDown} 👎 on live answers`}
            />
            <StatCard
              icon={GitPullRequestArrow}
              valueTone="amber"
              label="Proposals reviewed"
              value={`${data.approvedProposals + data.rejectedProposals}`}
              trend={data.trend?.proposalsReviewed}
              sub={`${data.openProposals} open · ${pct(data.proposalApprovalRate)} approved`}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              icon={Users}
              label="Answers grounded"
              value={data.totalUsage}
              sub="times an approved Expertise was applied to a chat answer"
            />
            <StatCard
              icon={Users}
              label="Contributors"
              value={data.contributorCount}
              sub="distinct people who've captured or proposed know-how"
            />
            <StatCard
              icon={Users}
              label="Governance events"
              value={data.auditEventCount}
              sub="total audited actions (approve, reject, rollback, …)"
            />
          </div>

          {data.byDomain.length > 0 && (
            <div className="mt-10">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Coverage by domain</h2>
              <div className="mt-3 space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                {data.byDomain.map((d) => (
                  <DomainBar key={d.domain} domain={d.domain} total={d.total} approved={d.approved} />
                ))}
              </div>
            </div>
          )}

          <p className="mt-8 text-xs text-gray-400">
            Every number above is a live count from the database (Expertise, Feedback, Proposal, AuditLog) — nothing here is estimated.
          </p>
        </>
      )}
    </div>
  )
}
