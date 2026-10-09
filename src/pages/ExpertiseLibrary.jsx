import { useMemo, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Plus, Search, BookOpenCheck, Sparkles, Users, TrendingUp, Upload, LayoutGrid, List, ShieldCheck } from 'lucide-react'
import { useStore, reviewCount } from '../store'
import { DOMAINS, STATUSES } from '../data/expertise'
import TopBar from '../components/TopBar'
import { StatusBadge, timeAgo } from '../components/ui'

export function ExpertiseTabs() {
  const pending = useStore(reviewCount)
  const cls = ({ isActive }) =>
    `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${isActive ? 'bg-gray-100 dark:bg-gray-800' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-100'}`
  return (
    <nav className="flex gap-1">
      <NavLink end to="/expertise" className={cls}><BookOpenCheck size={15} /> Library</NavLink>
      <NavLink to="/expertise/review" className={cls}>
        <ShieldCheck size={15} /> Review Queue
        {pending > 0 && <span className="rounded-full bg-amber-500/15 px-1.5 text-[11px] text-amber-500">{pending}</span>}
      </NavLink>
    </nav>
  )
}

const DOMAIN_COLORS = {
  'Asset Operations': 'from-slate-400 to-slate-600',
  'Energy Optimisation': 'from-amber-400 to-orange-500',
  Leasing: 'from-violet-400 to-purple-600',
  'Technical Services': 'from-sky-400 to-blue-600',
  Sustainability: 'from-emerald-400 to-green-600',
  'Tenant Experience': 'from-pink-400 to-rose-500',
}
export const domainGradient = (d) => DOMAIN_COLORS[d] || 'from-gray-400 to-gray-600'

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-gray-800"><Icon size={17} /></span>
      <div>
        <p className="text-xl font-semibold leading-tight">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  )
}

function ExpertiseCard({ e }) {
  return (
    <Link to={`/expertise/${e.id}`} className="card group flex flex-col p-4 transition hover:-translate-y-0.5 hover:shadow-lg dark:hover:ring-gray-700">
      <div className="flex items-start justify-between gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white ${domainGradient(e.domain)}`}>
          <BookOpenCheck size={17} />
        </span>
        <div className="flex items-center gap-1.5">
          {e.origin === 'auto-detected' && e.status !== 'approved' && (
            <span className="flex items-center gap-1 text-[11px] text-accent-500" title="Auto-detected from a conversation"><Sparkles size={11} /> Auto</span>
          )}
          <StatusBadge status={e.status} />
        </div>
      </div>
      <h3 className="mt-3 font-semibold leading-snug">{e.name}</h3>
      <p className="text-xs text-gray-500">{e.domain}</p>
      <p className="mt-2 line-clamp-2 flex-1 text-sm text-gray-600 dark:text-gray-400">{e.summary || 'No summary yet.'}</p>
      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-800">
        <span className="truncate">{e.owner}</span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="font-mono">v{e.version}</span>
          <span>{e.usageCount} uses</span>
        </span>
      </div>
    </Link>
  )
}

function ExpertiseRow({ e }) {
  return (
    <Link to={`/expertise/${e.id}`} className="grid grid-cols-12 items-center gap-3 border-b border-gray-100 px-4 py-3 text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-850">
      <span className="col-span-5 flex items-center gap-3">
        <span className={`h-7 w-7 shrink-0 rounded-lg bg-gradient-to-br ${domainGradient(e.domain)}`} />
        <span className="truncate font-medium">{e.name}</span>
      </span>
      <span className="col-span-2 truncate text-gray-500">{e.domain}</span>
      <span className="col-span-2"><StatusBadge status={e.status} /></span>
      <span className="col-span-1 font-mono text-gray-500">v{e.version}</span>
      <span className="col-span-1 text-gray-500">{e.usageCount}</span>
      <span className="col-span-1 text-right text-gray-500">{timeAgo(e.updatedAt)}</span>
    </Link>
  )
}

export default function ExpertiseLibrary() {
  const { expertise, createExpertise, showToast } = useStore()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [domain, setDomain] = useState('All')
  const [status, setStatus] = useState('all')
  const [view, setView] = useState('grid')

  const list = useMemo(
    () =>
      expertise
        .filter((e) => domain === 'All' || e.domain === domain)
        .filter((e) => status === 'all' || e.status === status)
        .filter((e) => (e.name + e.summary + e.domain + e.owner).toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [expertise, q, domain, status],
  )

  const approved = expertise.filter((e) => e.status === 'approved')
  const uses = expertise.reduce((a, e) => a + e.usageCount, 0)
  const owners = new Set(expertise.map((e) => e.owner)).size
  const rated = approved.filter((e) => e.successRate != null)
  const success = rated.length ? Math.round((rated.reduce((a, e) => a + e.successRate, 0) / rated.length) * 100) : 0

  return (
    <div className="flex h-full flex-col">
      <TopBar><ExpertiseTabs /></TopBar>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Expertise</h1>
              <p className="mt-1 max-w-xl text-sm text-gray-500">
                Reusable, governed know-how captured from your team's conversations. Approved Expertise is applied automatically whenever it's relevant — on any model.
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-outline" onClick={() => showToast('Import from Markdown / JSON — coming with the backend')}><Upload size={15} /> Import</button>
              <button className="btn-primary" onClick={() => navigate(`/expertise/${createExpertise()}?edit=1`)}><Plus size={15} /> New Expertise</button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={BookOpenCheck} label="Approved Expertise" value={approved.length} />
            <Stat icon={TrendingUp} label="Times applied" value={uses} />
            <Stat icon={ShieldCheck} label="Avg. helpful rating" value={`${success}%`} />
            <Stat icon={Users} label="Experts contributing" value={owners} />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9" placeholder="Search Expertise…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <div className="ml-auto flex rounded-xl p-0.5 ring-1 ring-gray-200 dark:ring-gray-800">
              <button className={`icon-btn ${view === 'grid' ? 'bg-gray-100 dark:bg-gray-800' : ''}`} onClick={() => setView('grid')}><LayoutGrid size={15} /></button>
              <button className={`icon-btn ${view === 'list' ? 'bg-gray-100 dark:bg-gray-800' : ''}`} onClick={() => setView('list')}><List size={15} /></button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {['All', ...DOMAINS].map((d) => (
              <button
                key={d}
                onClick={() => setDomain(d)}
                className={`rounded-full px-3 py-1 text-xs transition ${domain === d ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-850 dark:text-gray-300 dark:hover:bg-gray-800'}`}
              >
                {d}
              </button>
            ))}
          </div>

          {view === 'grid' ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((e) => <ExpertiseCard key={e.id} e={e} />)}
            </div>
          ) : (
            <div className="card mt-5 overflow-hidden">
              <div className="grid grid-cols-12 gap-3 border-b border-gray-200 px-4 py-2 text-xs text-gray-500 dark:border-gray-800">
                <span className="col-span-5">Name</span><span className="col-span-2">Domain</span><span className="col-span-2">Status</span>
                <span className="col-span-1">Version</span><span className="col-span-1">Uses</span><span className="col-span-1 text-right">Updated</span>
              </div>
              {list.map((e) => <ExpertiseRow key={e.id} e={e} />)}
            </div>
          )}
          {list.length === 0 && <p className="py-16 text-center text-sm text-gray-500">No Expertise matches these filters.</p>}
        </div>
      </div>
    </div>
  )
}
