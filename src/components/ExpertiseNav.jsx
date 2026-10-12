import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Search, ChevronRight, LayoutGrid, ShieldCheck, Plus, X, ClipboardList } from 'lucide-react'
import { useStore, reviewCount } from '../store'
import { contributeBlock, canOpenQueue } from '../lib/permissions'
import { buildTree, slugify, ASSET_TYPES, domainMeta } from '../data/taxonomy'
import { Toggle } from './ui'

const STATUS_DOT = {
  approved: 'bg-emerald-500',
  in_review: 'bg-amber-500',
  draft: 'bg-gray-400 dark:bg-gray-600',
  deprecated: 'bg-red-500',
}

export default function ExpertiseNav() {
  const { expertise, createExpertise, user } = useStore()
  const homeDomain = user.domains?.[0]
  const createBlock = contributeBlock(user, homeDomain)
  const pending = useStore(reviewCount)
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [asset, setAsset] = useState('All')
  const [approvedOnly, setApprovedOnly] = useState(false)
  const [open, setOpen] = useState(() => new Set())

  const filtered = useMemo(
    () =>
      expertise.filter(
        (e) =>
          (asset === 'All' || e.assetTypes?.includes(asset)) &&
          (!approvedOnly || e.status === 'approved') &&
          (!q || (e.name + ' ' + e.summary + ' ' + (e.topic || '') + ' ' + e.keywords.join(' ')).toLowerCase().includes(q.toLowerCase())),
      ),
    [expertise, q, asset, approvedOnly],
  )
  const tree = useMemo(() => buildTree(filtered), [filtered])
  const searching = !!q || asset !== 'All' || approvedOnly

  // Auto-expand the branch containing the open Expertise / domain page.
  useEffect(() => {
    const current = expertise.find((e) => e.id === id)
    const domainSlug = location.pathname.match(/\/expertise\/d\/([^/]+)/)?.[1]
    setOpen((prev) => {
      const next = new Set(prev)
      if (current) { next.add(current.domain); next.add(`${current.domain}/${current.topic}`) }
      if (domainSlug) tree.forEach((d) => slugify(d.domain) === domainSlug && next.add(d.domain))
      return next
    })
  }, [id, location.pathname]) // eslint-disable-line

  const toggle = (key) => setOpen((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const isOpen = (key) => searching || open.has(key)

  const linkCls = ({ isActive }) =>
    `flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${isActive ? 'bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-850 dark:hover:text-gray-100'}`

  return (
    <nav className="flex h-full w-64 shrink-0 flex-col border-r border-gray-100 dark:border-gray-850">
      <div className="space-y-2 p-3 pb-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input py-1.5 pl-9 pr-8" placeholder="Search Expertise" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" onClick={() => setQ('')}><X size={14} /></button>}
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-auto flex-1 py-1 text-xs" value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="All">All asset types</option>
            {ASSET_TYPES.map((a) => <option key={a}>{a}</option>)}
          </select>
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500" title="Show approved Expertise only">
            <Toggle checked={approvedOnly} onChange={setApprovedOnly} /> Live
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <div className="space-y-0.5 border-b border-gray-100 pb-2 dark:border-gray-850">
          <NavLink end to="/expertise" className={linkCls}><LayoutGrid size={15} /> Overview</NavLink>
          {canOpenQueue(user) && (
            <NavLink to="/expertise/review" className={linkCls}>
              <ShieldCheck size={15} /> <span className="flex-1">Review Queue</span>
              {pending > 0 && <span className="rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-500">{pending}</span>}
            </NavLink>
          )}
          {canOpenQueue(user) && (
            <NavLink to="/expertise/audit" className={linkCls}>
              <ClipboardList size={15} /> <span className="flex-1">Audit log</span>
            </NavLink>
          )}
        </div>

        {tree.map((d) => {
          if (searching && d.count === 0) return null
          const Icon = d.icon
          return (
            <div key={d.domain} className="mt-3">
              <div className="group flex items-center">
                <button onClick={() => toggle(d.domain)} className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-850">
                  <Icon size={15} className="text-gray-500" />
                  <span className="flex-1">{d.domain}</span>
                  <span className="text-[11px] font-normal text-gray-400">{d.count}</span>
                  <ChevronRight size={14} className={`text-gray-400 transition ${isOpen(d.domain) ? 'rotate-90' : ''}`} />
                </button>
              </div>

              {isOpen(d.domain) && (
                <div className="mt-0.5 space-y-0.5">
                  <NavLink end to={`/expertise/d/${slugify(d.domain)}`} className={(a) => linkCls(a) + ' ml-2 text-xs'}>
                    About this domain
                  </NavLink>
                  {d.topics.map((t) => {
                    if (searching && !t.items.length) return null
                    const key = `${d.domain}/${t.name}`
                    return (
                      <div key={key} className="ml-2">
                        <button
                          onClick={() => toggle(key)}
                          className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-850"
                        >
                          <ChevronRight size={13} className={`shrink-0 text-gray-400 transition ${isOpen(key) ? 'rotate-90' : ''}`} />
                          <span className="flex-1 truncate">{t.name}</span>
                          <span className="text-[11px] text-gray-400">{t.items.length || ''}</span>
                        </button>
                        {isOpen(key) && (
                          <div className="ml-[18px] border-l border-gray-200 py-0.5 pl-2 dark:border-gray-800">
                            {t.items.map((e) => (
                              <NavLink key={e.id} to={`/expertise/${e.id}`} className={linkCls} title={e.name}>
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[e.status]}`} title={e.status} />
                                <span className="truncate">{e.name}</span>
                              </NavLink>
                            ))}
                            {!t.items.length && <p className="px-2.5 py-1.5 text-xs italic text-gray-400">No Expertise yet</p>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {searching && filtered.length === 0 && <p className="px-3 py-8 text-center text-sm text-gray-500">No Expertise matches.</p>}
      </div>

      <div className="border-t border-gray-100 p-2 dark:border-gray-850">
        <button
          className="btn-ghost w-full justify-start"
          disabled={!!createBlock}
          title={createBlock || `New draft in ${homeDomain}`}
          onClick={() => navigate(`/expertise/${createExpertise({ domain: homeDomain, topic: domainMeta(homeDomain).topics[0] })}?edit=1`)}
        >
          <Plus size={15} /> New Expertise
        </button>
      </div>
    </nav>
  )
}
