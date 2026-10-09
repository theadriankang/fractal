import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { SEED_EXPERTISE } from '../data/expertise'
import FractalTree from '../components/landing/FractalTree'
import GrowthSteps from '../components/landing/GrowthSteps'
import RouterDemo from '../components/landing/RouterDemo'

// Public landing page, rendered outside the app shell (no sidebar).
// z-index scale on this page: nav 20, sticky step visual 10, everything else auto.

const EXP = SEED_EXPERTISE.find((e) => e.id === 'exp-chiller-fault')

const SKILL_MD = `---
name: ${EXP.name}
domain: ${EXP.domain}
topic: ${EXP.topic}
version: ${EXP.version}
status: ${EXP.status}
owner: ${EXP.owner}
reviewer: ${EXP.reviewer}
---

# ${EXP.name}

${EXP.summary}`

// Fade-up on first view. The CSS only hides .reveal when motion is allowed,
// so content is never stuck invisible.
function useReveal(ref) {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.dataset.shown = ''
          io.unobserve(e.target)
        }
      },
      { threshold: 0.15 },
    )
    ref.current.querySelectorAll('.reveal').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [ref])
}

function PrimaryCta() {
  return (
    <Link to="/" className="btn-primary px-5 py-2.5 text-[15px] active:scale-[0.98]">
      Open workspace <ArrowRight size={16} strokeWidth={2} />
    </Link>
  )
}

function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-gray-200/70 bg-gray-50/80 backdrop-blur dark:border-gray-800/70 dark:bg-gray-950/80">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
        <Link to="/welcome" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <img src="/fractal.svg" alt="" className="h-7 w-7 grayscale" />
          Fractal
        </Link>
        <div className="flex items-center gap-1">
          <div className="hidden items-center gap-1 md:flex">
            <a href="#how" className="btn-ghost">How it works</a>
            <a href="#expertise" className="btn-ghost">Expertise</a>
            <a href="#models" className="btn-ghost">Models</a>
          </div>
          <Link to="/" className="btn-primary ml-2 active:scale-[0.98]">Open workspace</Link>
        </div>
      </nav>
    </header>
  )
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-6 px-4 pt-14 md:px-8 lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-12 lg:pt-0">
      <div className="lg:col-span-7 xl:col-span-6">
        <h1 className="reveal text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl lg:text-[3.5rem] xl:text-6xl">
          Know-how that grows with every answer.
        </h1>
        <p className="reveal mt-6 max-w-[42ch] text-lg leading-relaxed text-gray-600 dark:text-gray-400" style={{ '--i': 1 }}>
          Fractal captures what your experts already know, gets it approved, and grounds every answer on any frontier model.
        </p>
        <div className="reveal mt-8 flex flex-wrap gap-3" style={{ '--i': 2 }}>
          <PrimaryCta />
          <a href="#how" className="btn-outline px-5 py-2.5 text-[15px] active:scale-[0.98]">See how it works</a>
        </div>
      </div>
      <FractalTree className="h-[60vh] lg:col-span-5 lg:h-[calc(100dvh-4rem)] xl:col-span-6" />
    </section>
  )
}

function How() {
  return (
    <section id="how" className="mx-auto max-w-7xl scroll-mt-16 px-4 py-24 md:px-8 md:py-32">
      <p className="reveal text-xs font-medium uppercase tracking-[0.18em] text-gray-600 dark:text-gray-400">How it works</p>
      <h2 className="reveal mt-4 max-w-[18ch] text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl">
        Each review adds a level of depth.
      </h2>
      <div className="mt-8 lg:mt-0">
        <GrowthSteps />
      </div>
    </section>
  )
}

function Expertise() {
  const clean = (s) => s.replace(/\s*[—–]\s*/g, ', ')
  return (
    <section id="expertise" className="mx-auto max-w-7xl scroll-mt-16 px-4 py-24 md:px-8 md:py-32">
      <h2 className="reveal max-w-[20ch] text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl">
        An Expertise is a page your team can audit.
      </h2>
      <p className="reveal mt-5 max-w-[60ch] text-lg leading-relaxed text-gray-600 dark:text-gray-400">
        Owner, boundaries, guardrails, escalation and version history in one place, each change signed off by a person.
      </p>

      <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-6">
        {/* A real seed Expertise, rendered the way the app shows it. */}
        <article className="reveal card flex flex-col p-6 md:p-8 lg:col-span-4 lg:row-span-2">
          <p className="text-sm text-gray-600 dark:text-gray-400">{EXP.domain} › {EXP.topic}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h3 className="text-2xl font-semibold tracking-tight md:text-3xl">{EXP.name}</h3>
            <span className="rounded-lg bg-gray-900/5 px-2 py-0.5 font-mono text-xs text-gray-700 ring-1 ring-gray-300 dark:bg-white/5 dark:text-gray-300 dark:ring-gray-700">
              v{EXP.version} approved
            </span>
          </div>
          <p className="mt-4 max-w-[60ch] leading-relaxed text-gray-600 dark:text-gray-400">{clean(EXP.summary)}</p>
          <h4 className="mt-8 font-medium">Decision logic</h4>
          <ol className="mt-3 space-y-3">
            {EXP.decisionLogic.slice(0, 3).map((step, i) => (
              <li key={i} className="grid grid-cols-[1.75rem_1fr] gap-2 text-[15px] leading-relaxed">
                <span className="font-mono text-sm text-gray-500">{i + 1}.</span>
                <span>{clean(step)}</span>
              </li>
            ))}
          </ol>
          <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-8">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Owned by {EXP.owner}, {EXP.ownerRole}.<br />Reviewed by {EXP.reviewer}.
            </p>
            <Link to={`/expertise/${EXP.id}`} className="btn-outline active:scale-[0.98]">
              Read the full Expertise <ArrowRight size={14} strokeWidth={2} />
            </Link>
          </div>
        </article>

        <div className="reveal rounded-2xl bg-gray-900/[0.04] p-6 ring-1 ring-gray-200 dark:bg-white/[0.04] dark:ring-gray-800 lg:col-span-2" style={{ '--i': 1 }}>
          <h3 className="text-lg font-semibold tracking-tight">Guardrails travel with it</h3>
          <p className="mt-3 leading-relaxed text-gray-700 dark:text-gray-300">“{clean(EXP.guardrails[0])}”</p>
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Escalation: {clean(EXP.escalation[0])}</p>
        </div>

        <div className="reveal card p-6 lg:col-span-2" style={{ '--i': 2 }}>
          <h3 className="text-lg font-semibold tracking-tight">Every change is versioned</h3>
          <ol className="mt-4 space-y-3">
            {[...EXP.versions].reverse().slice(0, 3).map((v) => (
              <li key={v.version} className="grid grid-cols-[2.5rem_1fr] gap-2 text-sm leading-snug">
                <span className="font-mono text-gray-500">{v.version}</span>
                <span className="text-gray-600 dark:text-gray-400">{clean(v.note)}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="reveal grid grid-cols-1 gap-6 rounded-2xl bg-gray-950 p-6 text-gray-100 ring-1 ring-gray-800 md:grid-cols-5 md:p-8 lg:col-span-6">
          <div className="md:col-span-2">
            <h3 className="text-lg font-semibold tracking-tight">Portable by design</h3>
            <p className="mt-3 max-w-[40ch] leading-relaxed text-gray-400">
              Export any Expertise as SKILL.md or JSON. It keeps working with whichever model you use next.
            </p>
          </div>
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-gray-900 p-4 font-mono text-[13px] leading-relaxed text-gray-300 ring-1 ring-gray-800 md:col-span-3">
            {SKILL_MD}
          </pre>
        </div>
      </div>
    </section>
  )
}

function Models() {
  return (
    <section id="models" className="mx-auto max-w-5xl scroll-mt-16 px-4 py-24 md:px-8 md:py-32">
      <h2 className="reveal text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl">Ask once. Auto picks the model.</h2>
      <p className="reveal mt-5 max-w-[60ch] text-lg leading-relaxed text-gray-600 dark:text-gray-400">
        Six providers and twelve models behind one composer. The same approved Expertise applies whichever model answers.
      </p>
      <div className="reveal mt-10">
        <RouterDemo />
      </div>
    </section>
  )
}

function Closing() {
  return (
    <section className="border-t border-gray-200 dark:border-gray-800">
      <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-24 text-center md:py-32">
        <img src="/fractal.svg" alt="" className="reveal h-12 w-12 grayscale" />
        <h2 className="reveal mt-8 text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl">Start with one conversation.</h2>
        <p className="reveal mt-5 max-w-[48ch] text-lg leading-relaxed text-gray-600 dark:text-gray-400">
          The workspace opens with demo data loaded. Ask it about a chiller alarm and watch the Expertise it uses.
        </p>
        <div className="reveal mt-8">
          <PrimaryCta />
        </div>
      </div>
    </section>
  )
}

export default function Landing() {
  const rootRef = useRef(null)
  useReveal(rootRef)

  return (
    <div
      ref={rootRef}
      className="h-full overflow-y-auto bg-gray-50 text-gray-900 [--fr-branch:103_103_103] [--fr-tip:23_23_23] motion-safe:scroll-smooth dark:bg-gray-950 dark:text-gray-100 dark:[--fr-branch:155_155_155] dark:[--fr-tip:245_245_245]"
    >
      <Nav />
      <main>
        <Hero />
        <How />
        <Expertise />
        <Models />
        <Closing />
      </main>
    </div>
  )
}
