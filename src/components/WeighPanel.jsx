// Renders a "Weigh across domains" result (POST /api/expertise/weigh). Not a comparison: every
// domain keeps its own voice, then the panel shows where they agree, where one domain's idea runs
// into another domain's rule, and suggestions that still carry each expert's view of them.
import { createContext, useContext } from 'react'
import { Link } from 'react-router-dom'
import {
  Scale, Handshake, TriangleAlert, OctagonAlert, Lightbulb, UserCheck, CircleHelp, CircleCheck, CircleDot, Link2, Info,
} from 'lucide-react'
import { TAXONOMY } from '../data/taxonomy'

const domainMeta = (domain) => TAXONOMY.find((d) => d.domain === domain)

// Domains with two experts in this weighing: their pills also name the Expertise, so
// "Energy Optimisation meets Energy Optimisation" never appears.
const SharedDomains = createContext(new Set())

function DomainPill({ expert, showName: forced = false }) {
  const shared = useContext(SharedDomains)
  if (!expert) return null
  const showName = forced || shared.has(expert.domain)
  const meta = domainMeta(expert.domain)
  const Icon = meta?.icon
  return (
    <Link
      to={`/expertise/${expert.id}`}
      title={`${expert.name} v${expert.version}${expert.owner ? ` — ${expert.owner}` : ''}`}
      className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
    >
      {Icon ? <Icon size={11} /> : <span className={`h-1.5 w-1.5 rounded-full ${meta?.dot || 'bg-gray-400'}`} />}
      {expert.domain}{showName && <span className="font-normal text-gray-500">· {expert.name}</span>}
    </Link>
  )
}

function Section({ icon: Icon, tone, title, hint, children }) {
  return (
    <section className="mt-5">
      <h4 className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold">
        <Icon size={15} className={tone} /> {title}
        {hint && <span className="w-full pl-5 text-xs font-normal text-gray-500 sm:w-auto sm:pl-0">{hint}</span>}
      </h4>
      <div className="mt-2">{children}</div>
    </section>
  )
}

const STANCE = {
  supports: { icon: CircleCheck, tone: 'text-emerald-500', label: 'supports' },
  conditional: { icon: CircleDot, tone: 'text-amber-500', label: 'with conditions' },
  concern: { icon: TriangleAlert, tone: 'text-red-500', label: 'has a concern' },
}

export default function WeighPanel({ result }) {
  const byId = Object.fromEntries(result.experts.map((x) => [x.id, x]))
  const persp = Object.fromEntries(result.perspectives.map((p) => [p.expertiseId, p]))
  const escalationsByExpert = result.experts
    .map((x) => ({ x, lines: result.escalations.filter((e) => e.expertiseId === x.id) }))
    .filter((g) => g.lines.length)

  const shared = new Set(result.experts.map((x) => x.domain).filter((d, i, all) => all.indexOf(d) !== i))

  if (!result.experts.length) {
    return <p className="mt-2 text-[15px] text-gray-600 dark:text-gray-400">{result.summary}</p>
  }

  return (
    <SharedDomains.Provider value={shared}>
    <div className="mt-2 text-[15px]">
      <div className="flex flex-wrap items-center gap-1.5">
        {result.experts.map((x) => <DomainPill key={x.id} expert={x} />)}
        <span
          className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          title={result.mode === 'model' ? `Weighed by ${result.model}; every conflict was checked against the approved Expertise.` : result.note}
        >
          {result.mode === 'model' ? 'Weighed by Claude · checked against Expertise' : 'Quick mode · text matching'}
        </span>
      </div>
      <p className="mt-3 leading-relaxed">{result.summary}</p>
      {result.note && result.mode !== 'model' && (
        <p className="mt-1 flex items-center gap-1 text-xs text-gray-500"><Info size={12} /> {result.note}</p>
      )}

      <Section icon={Scale} tone="text-accent-500" title="Each expert’s view">
        <div className={`grid gap-2 ${result.experts.length > 1 ? 'sm:grid-cols-2' : ''}`}>
          {result.experts.map((x) => {
            const p = persp[x.id]
            const meta = domainMeta(x.domain)
            return (
              <div key={x.id} className="rounded-xl p-3 ring-1 ring-gray-200 dark:ring-gray-800">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${meta?.dot || 'bg-gray-400'}`} />
                  <span className="text-sm font-semibold">{x.domain}</span>
                </div>
                <Link to={`/expertise/${x.id}`} className="mt-0.5 block text-xs text-accent-600 hover:underline dark:text-accent-400">
                  {x.name} <span className="font-mono">v{x.version}</span>
                </Link>
                {x.owner && <p className="text-xs text-gray-500">{x.owner}{x.ownerRole ? ` · ${x.ownerRole}` : ''}</p>}
                {x.via === 'linked' && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-500" title="Pulled in because another expert’s Expertise links to it">
                    <Link2 size={11} /> {x.reason}
                  </p>
                )}
                {p && <p className="mt-2 text-sm leading-relaxed">{p.position}</p>}
                {p?.keyPoints?.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-gray-600 dark:text-gray-400">
                    {p.keyPoints.map((k, i) => <li key={i}>{k}</li>)}
                  </ul>
                )}
                {p?.concerns?.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                    {p.concerns.map((c, i) => <li key={i} className="flex gap-1"><TriangleAlert size={12} className="mt-0.5 shrink-0" /> {c}</li>)}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {result.overlaps.length > 0 && (
        <Section icon={Handshake} tone="text-emerald-500" title="Where they agree" hint="common ground to build on">
          <ul className="space-y-2">
            {result.overlaps.map((o, i) => (
              <li key={i} className="rounded-xl bg-emerald-500/5 p-3 ring-1 ring-emerald-500/20">
                <p className="text-sm font-medium">{o.point}</p>
                {o.detail && <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{o.detail}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1">{o.expertiseIds.map((id) => <DomainPill key={id} expert={byId[id]} />)}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {result.tensions.length > 0 && (
        <Section icon={TriangleAlert} tone="text-amber-500" title="Where an idea may not hold" hint="one expert’s idea meets another’s rule">
          <ul className="space-y-2">
            {result.tensions.map((t, i) => {
              const blocker = t.severity === 'blocker'
              const Icon = blocker ? OctagonAlert : TriangleAlert
              return (
                <li key={i} className={`rounded-xl p-3 ring-1 ${blocker ? 'bg-red-500/5 ring-red-500/25' : 'bg-amber-500/5 ring-amber-500/25'}`}>
                  <p className="flex items-start gap-1.5 text-sm font-medium">
                    <Icon size={15} className={`mt-0.5 shrink-0 ${blocker ? 'text-red-500' : 'text-amber-500'}`} />
                    <span>
                      <span className={`mr-1.5 rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${blocker ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'}`}>
                        {blocker ? 'Blocker' : 'Caution'}
                      </span>
                      {t.point}
                    </span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                    Idea from <DomainPill expert={byId[t.ideaFrom]} /> meets a rule from <DomainPill expert={byId[t.constraintFrom]} />
                  </div>
                  {t.detail && <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300">{t.detail}</p>}
                  <blockquote className="mt-1.5 border-l-2 border-gray-300 pl-2 text-xs italic text-gray-600 dark:border-gray-700 dark:text-gray-400">
                    “{t.evidence}”
                  </blockquote>
                  {t.reconcile && (
                    <p className="mt-1.5 text-sm"><span className="font-medium text-emerald-600 dark:text-emerald-400">To make it work together: </span>{t.reconcile}</p>
                  )}
                  {t.decidingFactor && (
                    <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-white/60 px-2 py-1.5 text-sm ring-1 ring-gray-200 dark:bg-gray-900/40 dark:ring-gray-700">
                      <Scale size={14} className="mt-0.5 shrink-0 text-accent-500" />
                      <span><span className="font-medium">Deciding factor: </span>{t.decidingFactor}</span>
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {result.suggestions.length > 0 && (
        <Section icon={Lightbulb} tone="text-accent-500" title="Suggested way forward" hint="suggestions; the specialists decide">
          <ol className="space-y-2">
            {result.suggestions.map((s, i) => {
              const others = s.views || []
              return (
                <li key={i} className="flex gap-2.5 rounded-xl p-3 ring-1 ring-gray-200 dark:ring-gray-800">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-[11px] font-semibold text-accent-600 dark:text-accent-400">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-relaxed">{s.text}</p>
                    {s.rationale && <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{s.rationale}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                      {s.general ? (
                        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">General guidance — not from approved Expertise</span>
                      ) : (
                        <>Drawn from {s.basedOn.map((id) => <DomainPill key={id} expert={byId[id]} />)}</>
                      )}
                    </div>
                    {others.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2 dark:border-gray-800">
                        {others.map((v) => {
                          const st = STANCE[v.stance] || STANCE.conditional
                          return (
                            <li key={v.expertiseId} className="flex flex-wrap items-start gap-1.5 text-xs">
                              <st.icon size={13} className={`mt-0.5 shrink-0 ${st.tone}`} />
                              <DomainPill expert={byId[v.expertiseId]} />
                              <span className="font-medium">{st.label}</span>
                              {v.note && <span className="basis-full pl-5 text-gray-600 dark:text-gray-400 sm:basis-0 sm:flex-1 sm:pl-0">{v.note}</span>}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </Section>
      )}

      {escalationsByExpert.length > 0 && (
        <Section icon={UserCheck} tone="text-sky-500" title="Loop in before acting" hint="straight from each Expertise’s escalation rules">
          <ul className="space-y-1.5 text-sm">
            {escalationsByExpert.map(({ x, lines }) => (
              <li key={x.id} className="flex flex-wrap items-start gap-1.5">
                <DomainPill expert={x} />
                <span className="basis-full text-gray-700 dark:text-gray-300 sm:basis-0 sm:flex-1">{lines.map((l) => l.text).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {result.gaps.length > 0 && (
        <Section icon={CircleHelp} tone="text-gray-400" title="Not covered by any approved Expertise">
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-600 dark:text-gray-400">
            {result.gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </Section>
      )}

      <p className="mt-4 text-[11px] text-gray-500">
        Every expert’s view is kept visible, including disagreement, so the people accountable can decide.
        {result.dropped > 0 && ` ${result.dropped} model claim(s) that couldn’t be traced to approved Expertise were removed.`}
      </p>
    </div>
    </SharedDomains.Provider>
  )
}
