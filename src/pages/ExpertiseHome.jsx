import { Link, useNavigate, useParams } from 'react-router-dom'
import { BookOpenCheck, TrendingUp, ShieldCheck, Users, ArrowRight, Plus, Sparkles, Clock, Flame } from 'lucide-react'
import { useStore } from '../store'
import { canContribute, contributeBlock } from '../lib/permissions'
import { TAXONOMY, buildTree, slugify, domainBySlug } from '../data/taxonomy'
import { StatusBadge, timeAgo } from '../components/ui'
import { Breadcrumb } from './ExpertiseLayout'

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

function Row({ e, meta }) {
  return (
    <Link to={`/expertise/${e.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-850">
      <span className="flex-1 truncate text-sm font-medium">{e.name}</span>
      <span className="shrink-0 text-xs text-gray-500">{meta}</span>
    </Link>
  )
}

export default function ExpertiseHome() {
  const { expertise } = useStore()
  const tree = buildTree(expertise)
  const approved = expertise.filter((e) => e.status === 'approved')
  const uses = expertise.reduce((a, e) => a + e.usageCount, 0)
  const owners = new Set(expertise.map((e) => e.owner)).size
  const rated = approved.filter((e) => e.successRate != null)
  const success = rated.length ? Math.round((rated.reduce((a, e) => a + e.successRate, 0) / rated.length) * 100) : 0
  const recent = [...expertise].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5)
  const popular = [...approved].sort((a, b) => b.usageCount - a.usageCount).slice(0, 5)

  return (
    <div className="mx-auto max-w-5xl px-8 pb-20 pt-8">
      <Breadcrumb items={[{ label: 'Expertise' }, { label: 'Overview' }]} />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Expertise</h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">
        Reusable, governed know-how captured from your team's conversations — organised by <b className="font-medium text-gray-900 dark:text-gray-100">domain</b> and <b className="font-medium text-gray-900 dark:text-gray-100">topic</b>. Approved Expertise is applied automatically whenever it's relevant, on any model.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={BookOpenCheck} label="Approved Expertise" value={approved.length} />
        <Stat icon={TrendingUp} label="Times applied" value={uses} />
        <Stat icon={ShieldCheck} label="Avg. helpful rating" value={`${success}%`} />
        <Stat icon={Users} label="Experts contributing" value={owners} />
      </div>

      <h2 className="mt-10 text-lg font-semibold">Browse by domain</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tree.map((d) => {
          const Icon = d.icon
          const live = d.topics.flatMap((t) => t.items).filter((e) => e.status === 'approved').length
          return (
            <Link key={d.domain} to={`/expertise/d/${slugify(d.domain)}`} className="card group flex flex-col p-4 transition hover:-translate-y-0.5 hover:shadow-lg dark:hover:ring-gray-700">
              <div className="flex items-center justify-between">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white ${d.gradient}`}><Icon size={17} /></span>
                <ArrowRight size={15} className="text-gray-400 opacity-0 transition group-hover:opacity-100" />
              </div>
              <h3 className="mt-3 font-semibold">{d.domain}</h3>
              <p className="mt-1 flex-1 text-sm text-gray-600 dark:text-gray-400">{d.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {d.topics.filter((t) => t.items.length).map((t) => (
                  <span key={t.name} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400">{t.name}</span>
                ))}
              </div>
              <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-800">
                {live} live · {d.count - live} in progress · {d.topics.length} topics
              </p>
            </Link>
          )
        })}
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-semibold"><Clock size={16} className="text-gray-400" /> Recently updated</h2>
          <div className="card p-1">{recent.map((e) => <Row key={e.id} e={e} meta={timeAgo(e.updatedAt)} />)}</div>
        </section>
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-semibold"><Flame size={16} className="text-gray-400" /> Most applied</h2>
          <div className="card p-1">{popular.map((e) => <Row key={e.id} e={e} meta={`${e.usageCount} uses`} />)}</div>
        </section>
      </div>
    </div>
  )
}

export function ExpertiseDomain() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { expertise, createExpertise, user } = useStore()
  const meta = domainBySlug(slug)
  if (!meta) return <p className="p-16 text-center text-gray-500">Domain not found.</p>
  const d = buildTree(expertise).find((x) => x.domain === meta.domain)
  const Icon = d.icon
  const add = (topic) => navigate(`/expertise/${createExpertise({ domain: d.domain, topic, name: `New ${topic} Expertise` })}?edit=1`)

  return (
    <div className="mx-auto max-w-4xl px-8 pb-20 pt-8">
      <Breadcrumb items={[{ label: 'Expertise', to: '/expertise' }, { label: d.domain }]} />
      <div className="mt-3 flex items-center gap-3">
        <span className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white ${d.gradient}`}><Icon size={20} /></span>
        <h1 className="text-3xl font-semibold tracking-tight">{d.domain}</h1>
      </div>
      <p className="mt-3 text-[15px] text-gray-600 dark:text-gray-400">{d.description}</p>

      {/* topic jump list */}
      <div className="mt-5 flex flex-wrap gap-1.5">
        {d.topics.map((t) => (
          <a key={t.name} href={`#topic-${slugify(t.name)}`} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 hover:bg-gray-200 dark:bg-gray-850 dark:text-gray-300 dark:hover:bg-gray-800">
            {t.name} <span className="text-gray-400">{t.items.length}</span>
          </a>
        ))}
      </div>

      {d.topics.map((t) => (
        <section key={t.name} id={`topic-${slugify(t.name)}`} className="mt-10 scroll-mt-6">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2 dark:border-gray-800">
            <h2 className="text-xl font-semibold">{t.name}</h2>
            <button className="btn-ghost text-xs" disabled={!canContribute(user, d.domain)} title={contributeBlock(user, d.domain) || ''} onClick={() => add(t.name)}><Plus size={14} /> Add</button>
          </div>
          {t.items.length ? (
            <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-850">
              {t.items.map((e) => (
                <Link key={e.id} to={`/expertise/${e.id}`} className="group flex items-start gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium group-hover:text-accent-500">
                      {e.name}
                      {e.origin === 'auto-detected' && e.status !== 'approved' && <Sparkles size={13} className="text-accent-500" />}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">{e.summary}</p>
                    <p className="mt-1 text-xs text-gray-500">{e.owner} · {(e.assetTypes || []).join(', ')}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={e.status} />
                    <span className="font-mono text-xs text-gray-500">v{e.version}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-gray-200 py-6 text-center text-sm text-gray-500 dark:border-gray-800">
              No Expertise in this topic yet — it'll fill up as people share know-how in chats.
            </p>
          )}
        </section>
      ))}
    </div>
  )
}
