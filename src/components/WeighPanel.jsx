// Renders a "Weigh across domains" result (POST /api/expertise/weigh). Not a comparison: every
// domain keeps its own voice, then the panel shows where they agree, where one domain's idea runs
// into another domain's rule, and suggestions that still carry each expert's view of them.
//
// Two view modes, chosen by the reader (remembered in localStorage):
// - "sections": every section stacked, with a scroll-spy table of contents alongside it —
//   mirrors the Expertise detail page's "On this page" nav.
// - "tabs": one section visible at a time, switched with a tab bar — best for a long result
//   with many domains where scrolling a full page is more than needed.
// Either way the domain pills + one-line summary stay visible above both, since that's the
// one thing every reader needs regardless of how deep they go (see WEIGH_UX_NOTES.md).
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Scale, Handshake, TriangleAlert, OctagonAlert, Lightbulb, UserCheck, CircleHelp, CircleCheck, CircleDot,
  Link2, Info, ChevronDown, ChevronRight, Rows3, Columns3,
} from 'lucide-react'
import { TAXONOMY } from '../data/taxonomy'

const domainMeta = (domain) => TAXONOMY.find((d) => d.domain === domain)
const VIEW_MODE_KEY = 'fractal:weighViewMode'

function loadViewMode() {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY)
    return v === 'tabs' ? 'tabs' : 'sections'
  } catch {
    return 'sections'
  }
}

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

// A section's heading, used identically in both view modes. In "sections" mode each one is
// also the scroll-spy anchor (registerRef); in "tabs" mode the tab bar already carries the
// title, so the page just renders the content below it.
function SectionHeading({ icon: Icon, tone, title, hint }) {
  return (
    <h4 className="flex flex-wrap items-center gap-x-1.5 text-base font-semibold tracking-tight">
      <Icon size={16} className={tone} /> {title}
      {hint && <span className="w-full pl-[22px] text-xs font-normal text-gray-500 sm:w-auto sm:pl-0">{hint}</span>}
    </h4>
  )
}

const STANCE = {
  supports: { icon: CircleCheck, tone: 'text-emerald-500', label: 'supports' },
  conditional: { icon: CircleDot, tone: 'text-amber-500', label: 'with conditions' },
  concern: { icon: TriangleAlert, tone: 'text-red-500', label: 'has a concern' },
}

// Collapsed by default: shows the domain + a one-line read of the position (so "what
// perspectives were considered" is answerable at a glance), full detail on click.
function ExpertCard({ x, p }) {
  const [open, setOpen] = useState(false)
  const meta = domainMeta(x.domain)
  return (
    <div className="rounded-xl ring-1 ring-gray-200 dark:ring-gray-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 p-3 text-left"
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta?.dot || 'bg-gray-400'}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="text-sm font-semibold">{x.domain}</span>
            {x.owner && <span className="text-xs text-gray-500">{x.owner}{x.ownerRole ? ` · ${x.ownerRole}` : ''}</span>}
          </span>
          {p && !open && <span className="mt-1 block truncate text-sm leading-relaxed text-gray-600 dark:text-gray-400">{p.position}</span>}
        </span>
        {open ? <ChevronDown size={16} className="mt-1 shrink-0 text-gray-400" /> : <ChevronRight size={16} className="mt-1 shrink-0 text-gray-400" />}
      </button>
      {open && (
        <div className="px-3 pb-3">
          <Link to={`/expertise/${x.id}`} className="block text-xs text-accent-600 hover:underline dark:text-accent-400">
            {x.name} <span className="font-mono">v{x.version}</span>
          </Link>
          {x.via === 'linked' && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-500" title="Pulled in because another expert's Expertise links to it">
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
      )}
    </div>
  )
}

// Verdict first (the one-line "so what"), supporting proof collapsed behind "Show evidence" —
// the point/reconcile pair is the full read for most people; the quote and deciding factor are
// there for whoever needs to check the reasoning, one click away instead of always on screen.
function TensionCard({ t, byId }) {
  const [showEvidence, setShowEvidence] = useState(false)
  const blocker = t.severity === 'blocker'
  const Icon = blocker ? OctagonAlert : TriangleAlert
  return (
    <li className={`rounded-xl p-3 ring-1 ${blocker ? 'bg-red-500/5 ring-red-500/25' : 'bg-amber-500/5 ring-amber-500/25'}`}>
      <p className="flex items-start gap-1.5 text-sm font-semibold leading-snug">
        <Icon size={15} className={`mt-0.5 shrink-0 ${blocker ? 'text-red-500' : 'text-amber-500'}`} />
        <span>
          <span className={`mr-1.5 rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${blocker ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'}`}>
            {blocker ? 'Blocker' : 'Caution'}
          </span>
          {t.point}
        </span>
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-gray-500">
        <DomainPill expert={byId[t.ideaFrom]} /> meets <DomainPill expert={byId[t.constraintFrom]} />
      </div>
      {t.reconcile && (
        <p className="mt-1.5 text-sm leading-relaxed"><span className="font-medium text-emerald-600 dark:text-emerald-400">Do this: </span>{t.reconcile}</p>
      )}
      {(t.detail || t.evidence || t.decidingFactor) && (
        <>
          <button
            type="button"
            onClick={() => setShowEvidence((v) => !v)}
            className="mt-1.5 flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            {showEvidence ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {showEvidence ? 'Hide' : 'Show'} evidence
          </button>
          {showEvidence && (
            <div className="mt-1.5 space-y-1.5">
              {t.detail && <p className="text-sm text-gray-700 dark:text-gray-300">{t.detail}</p>}
              {t.evidence && (
                <blockquote className="border-l-2 border-gray-300 pl-2 text-xs italic text-gray-600 dark:border-gray-700 dark:text-gray-400">
                  "{t.evidence}"
                </blockquote>
              )}
              {t.decidingFactor && (
                <p className="flex items-start gap-1.5 rounded-lg bg-white/60 px-2 py-1.5 text-sm ring-1 ring-gray-200 dark:bg-gray-900/40 dark:ring-gray-700">
                  <Scale size={14} className="mt-0.5 shrink-0 text-accent-500" />
                  <span><span className="font-medium">Deciding factor: </span>{t.decidingFactor}</span>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </li>
  )
}

function SuggestionCard({ s, i, byId }) {
  const others = s.views || []
  return (
    <li className="flex gap-2.5 rounded-xl p-3 ring-1 ring-gray-200 dark:ring-gray-800">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-[11px] font-semibold text-accent-600 dark:text-accent-400">{i + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-relaxed">{s.text}</p>
        {s.rationale && <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{s.rationale}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-gray-500">
          {s.general ? (
            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">General guidance — not from approved Expertise</span>
          ) : (
            <>Drawn from {s.basedOn.map((id) => <DomainPill key={id} expert={byId[id]} />)}</>
          )}
        </div>
        {/* Every expert's stance stays visible, unlike the evidence above — this is the one
            thing a reader must see without an extra click: who's on board and who isn't. */}
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
}

// Scroll-spy: tracks which registered section is nearest the top of the viewport so the nav
// can highlight it as the reader scrolls, the same pattern as the Expertise page's "On this
// page" sidebar.
function useScrollSpy(ids) {
  const [active, setActive] = useState(ids[0])
  const elsRef = useRef({})
  useEffect(() => {
    if (!ids.length) return undefined
    const els = ids.map((id) => elsRef.current[id]).filter(Boolean)
    if (!els.length) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        const topmost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b))
        setActive(topmost.target.dataset.sectionId)
      },
      { rootMargin: '-8% 0px -75% 0px', threshold: [0, 1] },
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join('|')])
  const registerRef = (id) => (el) => {
    if (el) el.dataset.sectionId = id
    elsRef.current[id] = el
  }
  return { active, registerRef }
}

function SectionNav({ sections, active, onJump }) {
  return (
    <nav className="hidden shrink-0 lg:block lg:w-44">
      <div className="sticky top-2 border-l border-gray-200 pl-3 text-xs dark:border-gray-800">
        <p className="mb-1.5 font-medium text-gray-400">On this answer</p>
        <ul className="space-y-1.5">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onJump(s.id)}
                className={`-ml-px border-l pl-2 text-left leading-snug transition ${
                  active === s.id
                    ? 'border-accent-500 font-semibold text-gray-900 dark:text-gray-100'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}

function ViewModeToggle({ mode, onChange }) {
  const opt = (value, Icon, label) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      title={`${label} view`}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition ${
        mode === value
          ? 'bg-accent-500/15 text-accent-600 dark:text-accent-400'
          : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      <Icon size={12} /> {label}
    </button>
  )
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
      {opt('sections', Rows3, 'Page')}
      {opt('tabs', Columns3, 'Tabs')}
    </div>
  )
}

export default function WeighPanel({ result }) {
  const [viewMode, setViewMode] = useState(loadViewMode)
  const setMode = (m) => {
    setViewMode(m)
    try { localStorage.setItem(VIEW_MODE_KEY, m) } catch { /* best-effort only */ }
  }

  const byId = Object.fromEntries(result.experts.map((x) => [x.id, x]))
  const persp = Object.fromEntries(result.perspectives.map((p) => [p.expertiseId, p]))
  const escalationsByExpert = result.experts
    .map((x) => ({ x, lines: result.escalations.filter((e) => e.expertiseId === x.id) }))
    .filter((g) => g.lines.length)
  const shared = new Set(result.experts.map((x) => x.domain).filter((d, i, all) => all.indexOf(d) !== i))

  const sections = useMemo(() => [
    result.experts.length > 0 && { id: 'experts', icon: Scale, tone: 'text-accent-500', label: "Each expert's view" },
    result.overlaps.length > 0 && { id: 'agreement', icon: Handshake, tone: 'text-emerald-500', label: 'Where they agree', hint: 'common ground to build on' },
    result.tensions.length > 0 && { id: 'tensions', icon: TriangleAlert, tone: 'text-amber-500', label: 'Where an idea may not hold', hint: "one expert's idea meets another's rule" },
    result.suggestions.length > 0 && { id: 'suggestions', icon: Lightbulb, tone: 'text-accent-500', label: 'Suggested way forward', hint: 'suggestions; the specialists decide' },
    escalationsByExpert.length > 0 && { id: 'escalations', icon: UserCheck, tone: 'text-sky-500', label: 'Loop in before acting', hint: "straight from each Expertise's escalation rules" },
    result.gaps.length > 0 && { id: 'gaps', icon: CircleHelp, tone: 'text-gray-400', label: 'Not covered' },
  ].filter(Boolean), [result, escalationsByExpert.length])

  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections])
  const { active, registerRef } = useScrollSpy(sectionIds)
  const [activeTab, setActiveTab] = useState(sectionIds[0])
  useEffect(() => { if (!sectionIds.includes(activeTab)) setActiveTab(sectionIds[0]) }, [sectionIds, activeTab])

  const jump = (id) => {
    document.querySelector(`[data-section-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (!result.experts.length) {
    return <p className="mt-2 text-[15px] text-gray-600 dark:text-gray-400">{result.summary}</p>
  }

  const content = {
    experts: (
      <div className={`grid gap-2 ${result.experts.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {result.experts.map((x) => <ExpertCard key={x.id} x={x} p={persp[x.id]} />)}
      </div>
    ),
    agreement: (
      <ul className="space-y-2">
        {result.overlaps.map((o, i) => (
          <li key={i} className="rounded-xl bg-emerald-500/5 p-3 ring-1 ring-emerald-500/20">
            <p className="text-sm font-semibold">{o.point}</p>
            {o.detail && <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{o.detail}</p>}
            <div className="mt-1.5 flex flex-wrap gap-1">{o.expertiseIds.map((id) => <DomainPill key={id} expert={byId[id]} />)}</div>
          </li>
        ))}
      </ul>
    ),
    tensions: (
      <ul className="space-y-2">
        {result.tensions.map((t, i) => <TensionCard key={i} t={t} byId={byId} />)}
      </ul>
    ),
    suggestions: (
      <ol className="space-y-2">
        {result.suggestions.map((s, i) => <SuggestionCard key={i} s={s} i={i} byId={byId} />)}
      </ol>
    ),
    escalations: (
      <ul className="space-y-1.5 text-sm">
        {escalationsByExpert.map(({ x, lines }) => (
          <li key={x.id} className="flex flex-wrap items-start gap-1.5">
            <DomainPill expert={x} />
            <span className="basis-full text-gray-700 dark:text-gray-300 sm:basis-0 sm:flex-1">{lines.map((l) => l.text).join(' · ')}</span>
          </li>
        ))}
      </ul>
    ),
    gaps: (
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-600 dark:text-gray-400">
        {result.gaps.map((g, i) => <li key={i}>{g}</li>)}
      </ul>
    ),
  }

  return (
    <SharedDomains.Provider value={shared}>
      <div className="mt-2 text-[15px]">
        <div className="flex flex-wrap items-center gap-1.5">
          {result.experts.map((x) => <DomainPill key={x.id} expert={x} />)}
          <div className="ml-auto flex items-center gap-1.5">
            <ViewModeToggle mode={viewMode} onChange={setMode} />
            <span
              className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              title={result.mode === 'model' ? `Weighed by Claude; every conflict was checked against the approved Expertise.` : result.note}
            >
              {result.mode === 'model' ? 'Weighed by Claude · checked against Expertise' : 'Quick mode · text matching'}
            </span>
          </div>
        </div>

        <p className="mt-3 border-l-2 border-accent-400/60 pl-3 text-base font-medium leading-relaxed dark:border-accent-500/50">
          {result.summary}
        </p>
        {result.note && result.mode !== 'model' && (
          <p className="mt-1 flex items-center gap-1 text-xs text-gray-500"><Info size={12} /> {result.note}</p>
        )}

        {viewMode === 'tabs' ? (
          <>
            <div className="mt-4 flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800">
              {sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveTab(s.id)}
                  className={`flex items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-sm font-medium transition ${
                    activeTab === s.id
                      ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  <s.icon size={14} className={s.tone} /> {s.label}
                </button>
              ))}
            </div>
            <div className="mt-3">
              {sections.filter((s) => s.id === activeTab).map((s) => (
                <div key={s.id}>
                  {s.hint && <p className="mb-2 text-xs text-gray-500">{s.hint}</p>}
                  {content[s.id]}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-4 flex gap-6">
            <div className="min-w-0 flex-1">
              {sections.map((s) => (
                <section key={s.id} ref={registerRef(s.id)} className="mt-5 scroll-mt-4 first:mt-0">
                  <SectionHeading icon={s.icon} tone={s.tone} title={s.label} hint={s.hint} />
                  <div className="mt-2">{content[s.id]}</div>
                </section>
              ))}
            </div>
            {sections.length > 2 && <SectionNav sections={sections} active={active} onJump={jump} />}
          </div>
        )}

        <p className="mt-4 text-[11px] text-gray-500">
          Every expert's view is kept visible, including disagreement, so the people accountable can decide.
          {result.dropped > 0 && ` ${result.dropped} model claim(s) that couldn't be traced to approved Expertise were removed.`}
        </p>
      </div>
    </SharedDomains.Provider>
  )
}
