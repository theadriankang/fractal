import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList, Search, Check, X, RotateCcw, Plus, Pencil, Send, Archive,
  RotateCw, Trash2, GitPullRequestArrow, Eye, ThumbsUp, ThumbsDown, FileEdit,
  ShieldCheck, Lock,
} from 'lucide-react'
import { useStore } from '../store'
import { USE_MOCK } from '../lib/api'
import { isIntern, isReviewer } from '../lib/permissions'
import { TAXONOMY } from '../data/taxonomy'
import { timeAgo, fmtDate } from '../components/ui'
import { Breadcrumb } from './ExpertiseLayout'

const ACTION_ICON = {
  'expertise.create': Plus,
  'expertise.update': Pencil,
  'expertise.submit': Send,
  'expertise.approve': Check,
  'expertise.reject': X,
  'expertise.deprecate': Archive,
  'expertise.restore': RotateCw,
  'expertise.rollback': RotateCcw,
  'expertise.delete': Trash2,
  'proposal.create': GitPullRequestArrow,
  'proposal.approve': Check,
  'proposal.reject': X,
  'response.rate': ThumbsUp,
  'chat.view_source': Eye,
}

const ACTION_TONE = {
  'expertise.approve': 'text-emerald-500 bg-emerald-500/10',
  'proposal.approve': 'text-emerald-500 bg-emerald-500/10',
  'expertise.reject': 'text-red-500 bg-red-500/10',
  'proposal.reject': 'text-red-500 bg-red-500/10',
  'expertise.deprecate': 'text-amber-500 bg-amber-500/10',
  'expertise.delete': 'text-red-500 bg-red-500/10',
  'expertise.rollback': 'text-amber-500 bg-amber-500/10',
  'chat.view_source': 'text-gray-500 bg-gray-500/10',
  'response.rate': 'text-gray-500 bg-gray-500/10',
  'expertise.create': 'text-accent-500 bg-accent-500/10',
  'proposal.create': 'text-indigo-500 bg-indigo-500/10',
  'expertise.submit': 'text-indigo-500 bg-indigo-500/10',
}

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'expertise.approve', label: 'Approve' },
  { value: 'expertise.reject', label: 'Reject' },
  { value: 'expertise.create', label: 'Create' },
  { value: 'expertise.update', label: 'Update' },
  { value: 'expertise.submit', label: 'Submit' },
  { value: 'expertise.rollback', label: 'Rollback' },
  { value: 'expertise.deprecate', label: 'Deprecate' },
  { value: 'expertise.restore', label: 'Restore' },
  { value: 'expertise.delete', label: 'Delete' },
  { value: 'proposal.create', label: 'Proposal create' },
  { value: 'proposal.approve', label: 'Proposal approve' },
  { value: 'proposal.reject', label: 'Proposal reject' },
  { value: 'response.rate', label: 'Rating' },
  { value: 'chat.view_source', label: 'View source' },
]

function groupByDay(entries) {
  const groups = {}
  for (const e of entries) {
    const day = e.at.slice(0, 10)
    if (!groups[day]) groups[day] = []
    groups[day].push(e)
  }
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
}

function dayLabel(day) {
  const d = new Date(day + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = (today - d) / 864e5
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return fmtDate(day + 'T00:00:00')
}

function EntryRow({ entry }) {
  const Icon = ACTION_ICON[entry.action] || ClipboardList
  const tone = ACTION_TONE[entry.action] || 'text-gray-500 bg-gray-500/10'
  const linkTo =
    entry.targetType === 'expertise' && entry.targetId
      ? `/expertise/${entry.targetId}`
      : entry.targetType === 'chat' && entry.targetId
        ? `/c/${entry.targetId}`
        : null
  const content = (
    <>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}>
        <Icon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {entry.summary}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
          <span title={new Date(entry.at).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })}>
            {timeAgo(entry.at)}
          </span>
          {entry.domain && (
            <>
              <span>·</span>
              <span>{entry.domain}</span>
            </>
          )}
          {entry.version && (
            <>
              <span>·</span>
              <span className="font-mono">v{entry.version}</span>
            </>
          )}
          {entry.targetType && (
            <>
              <span>·</span>
              <span className="capitalize">{entry.targetType}</span>
            </>
          )}
          {linkTo && <span className="text-accent-500">→</span>}
        </div>
      </div>
    </>
  )
  return (
    <div className="flex items-start gap-3 py-2.5">
      {linkTo ? (
        <Link to={linkTo} className="flex w-full items-start gap-3 rounded-lg -mx-1 px-1 py-1 transition hover:bg-gray-50 dark:hover:bg-gray-850">
          {content}
        </Link>
      ) : (
        <div className="flex w-full items-start gap-3">{content}</div>
      )}
    </div>
  )
}

export default function AuditLog() {
  const user = useStore((s) => s.user)
  const [entries, setEntries] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [before, setBefore] = useState(null)

  const [actionFilter, setActionFilter] = useState('')
  const [personFilter, setPersonFilter] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const [searchText, setSearchText] = useState('')

  const canView = !isIntern(user)

  const fetchAudit = async ({ reset = false } = {}) => {
    if (USE_MOCK) { setLoading(false); return }
    if (!user) return
    try {
      setLoading(true)
      setError(null)
      const { apiFor } = await import('../lib/api')
      const api = apiFor(user)
      const params = {}
      if (actionFilter) params.action = actionFilter
      if (personFilter) params.actor = personFilter
      if (domainFilter) params.domain = domainFilter
      if (!reset && before) params.before = before
      params.limit = 50
      const page = await api.listAudit(params)
      if (reset) {
        setEntries(page.entries)
      } else {
        setEntries((prev) => [...prev, ...page.entries])
      }
      setHasMore(page.hasMore)
    } catch (err) {
      setError(err.message || 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }

  // Re-fetch when filters change (debounce person/search).
  useEffect(() => {
    if (!canView || USE_MOCK) return
    setBefore(null)
    setEntries([])
    const t = setTimeout(() => fetchAudit({ reset: true }), 250)
    return () => clearTimeout(t)
  }, [actionFilter, domainFilter, personFilter, canView]) // eslint-disable-line

  // Search filters the client-side entries (summary text match).
  const filtered = useMemo(() => {
    if (!searchText) return entries
    const q = searchText.toLowerCase()
    return entries.filter((e) => e.summary.toLowerCase().includes(q))
  }, [entries, searchText])

  if (!canView)
    return (
      <div className="mx-auto max-w-xl px-8 pt-24 text-center">
        <Lock size={22} className="mx-auto text-gray-400" />
        <h1 className="mt-3 text-xl font-semibold">The Audit Log is for experts and reviewers</h1>
        <p className="mt-2 text-sm text-gray-500">As an intern you can read every approved Expertise, but the audit trail is limited to domain experts and the Reviewer.</p>
        <Link to="/expertise" className="btn-outline mt-5">Browse Expertise</Link>
      </div>
    )

  if (USE_MOCK)
    return (
      <div className="mx-auto max-w-2xl px-8 pb-16 pt-8">
        <Breadcrumb items={[{ label: 'Expertise', to: '/expertise' }, { label: 'Audit log' }]} />
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-gray-500">Every governance action — approvals, rejections, rollbacks and more — recorded for accountability.</p>
        <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
          <ClipboardList size={28} className="text-gray-400" />
          <p className="mt-3 text-sm font-medium text-gray-600 dark:text-gray-400">Audit log requires the backend</p>
          <p className="mt-1 max-w-xs text-xs text-gray-500">The audit trail is stored in the database and read through the FastAPI backend. Start the backend (see <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800">backend/README.md</code>) or set <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800">VITE_USE_MOCK=false</code>.</p>
        </div>
      </div>
    )

  const groups = groupByDay(filtered)

  return (
    <div className="mx-auto max-w-4xl px-8 pb-16 pt-8">
      <Breadcrumb items={[{ label: 'Expertise', to: '/expertise' }, { label: 'Audit log' }]} />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Audit log</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Every governance action — approvals, rejections, rollbacks and more — recorded for accountability.{' '}
        {isReviewer(user) ? 'You see every domain.' : `Showing ${user.domains.join(' and ')} only.`}
      </p>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <select
          className="input w-auto py-1.5 text-sm"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          className="input w-auto py-1.5 text-sm"
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
        >
          <option value="">All domains</option>
          {TAXONOMY.map((t) => <option key={t.domain} value={t.domain}>{t.domain}</option>)}
        </select>
        <input
          className="input w-48 py-1.5 text-sm"
          placeholder="Filter by email"
          value={personFilter}
          onChange={(e) => setPersonFilter(e.target.value)}
        />
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input w-full py-1.5 pl-9 pr-3 text-sm"
            placeholder="Search summaries"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-6 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 ring-1 ring-red-500/25 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Timeline */}
      {loading && entries.length === 0 ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-gray-500">
          <RotateCw size={15} className="animate-spin" /> Loading audit log…
        </div>
      ) : groups.length === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
          <ClipboardList size={28} className="text-gray-400" />
          <p className="mt-3 text-sm font-medium text-gray-600 dark:text-gray-400">No audit entries match</p>
          <p className="mt-1 text-xs text-gray-500">Try clearing your filters.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map(([day, dayEntries]) => (
            <section key={day}>
              <h2 className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                {dayLabel(day)}
                <span className="rounded-full bg-gray-500/10 px-1.5 text-[11px] font-normal">{dayEntries.length}</span>
              </h2>
              <div className="divide-y divide-gray-100 rounded-xl bg-white ring-1 ring-gray-200 dark:divide-gray-800 dark:bg-gray-900 dark:ring-gray-800">
                {dayEntries.map((e) => <EntryRow key={e.id} entry={e} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <div className="mt-6 flex justify-center">
          <button
            className="btn-outline"
            onClick={() => {
              const last = entries[entries.length - 1]
              if (last) {
                setBefore(last.at)
                setTimeout(() => fetchAudit(), 0)
              }
            }}
          >
            Load more
          </button>
        </div>
      )}

      {/* Loading more indicator */}
      {loading && entries.length > 0 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
          <RotateCw size={14} className="animate-spin" /> Loading…
        </div>
      )}
    </div>
  )
}
