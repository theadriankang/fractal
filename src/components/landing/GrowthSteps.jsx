import { useEffect, useRef, useState } from 'react'

// Scroll story: the Sierpinski triangle (Fractal's logo is its first level)
// gains one level of depth for each step the reader reaches. Step changes come
// from an IntersectionObserver line at mid-viewport, not scroll listeners.

const STEPS = [
  {
    title: 'Capture',
    body: 'When someone explains how they really handle a problem in chat, Fractal offers to save it as a draft Expertise, linked to that conversation.',
  },
  {
    title: 'Review',
    body: 'A reviewer edits, approves or rejects it. Nothing reaches an answer until a person has signed it off.',
  },
  {
    title: 'Apply',
    body: 'Approved Expertise grounds answers on any model. Each answer shows which Expertise, and which version, it used.',
  },
  {
    title: 'Improve',
    body: 'A thumbs-down with a correction becomes a proposed revision. Every version can be compared and rolled back.',
  },
]

const H = 86.6
const ROOT = [[50, 0], [0, H], [100, H]]

function subdivide(tris) {
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  return tris.flatMap(([a, b, c]) => {
    const ab = mid(a, b)
    const bc = mid(b, c)
    const ca = mid(c, a)
    return [[a, ab, ca], [ab, b, bc], [ca, bc, c]]
  })
}

// LEVELS[0] is the logo (3 triangles); each step adds one level.
const LEVELS = STEPS.reduce((acc) => [...acc, subdivide(acc.length ? acc[acc.length - 1] : [ROOT])], [])

function Sierpinski({ depth }) {
  return (
    <svg viewBox={`-2 -2 104 ${H + 4}`} className="h-full w-full" aria-hidden="true">
      <polygon points={ROOT.map((p) => p.join(',')).join(' ')} className="fill-none stroke-gray-300 dark:stroke-gray-800" strokeWidth="0.3" />
      {LEVELS.map((tris, level) => (
        <g key={level}>
          {tris.map((t, k) => {
            const state = level === depth ? 'opacity-100 scale-100' : level < depth ? 'opacity-0 scale-100' : 'opacity-0 scale-0'
            return (
              <polygon
                key={k}
                points={t.map((p) => p.join(',')).join(' ')}
                style={{ transformBox: 'fill-box', transformOrigin: 'center', transitionDelay: `${level === depth ? (k / tris.length) * 500 : 0}ms` }}
                className={`fill-gray-900 transition-[transform,opacity] duration-700 ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none dark:fill-gray-100 ${state}`}
              />
            )
          })}
        </g>
      ))}
    </svg>
  )
}

export default function GrowthSteps() {
  const [active, setActive] = useState(0)
  const stepRefs = useRef([])

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number(e.target.dataset.step))
      },
      { rootMargin: '-50% 0px -50% 0px' },
    )
    stepRefs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div className="grid grid-cols-1 gap-x-16 lg:grid-cols-2">
      {/* Mobile: a short sticky strip under the nav. Desktop: a tall sticky column. */}
      <div className="sticky top-16 z-10 -mx-4 h-48 bg-gray-50/95 px-4 py-4 backdrop-blur dark:bg-gray-950/95 lg:top-24 lg:mx-0 lg:h-[70vh] lg:bg-transparent lg:p-0 lg:backdrop-blur-none lg:dark:bg-transparent">
        <Sierpinski depth={active} />
      </div>
      <ol>
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            ref={(el) => (stepRefs.current[i] = el)}
            data-step={i}
            className={`flex min-h-[50vh] flex-col justify-center transition-opacity duration-500 lg:min-h-[70vh] ${active === i ? 'opacity-100' : 'opacity-40'}`}
          >
            <h3 className="text-3xl font-semibold tracking-tight md:text-4xl">{s.title}</h3>
            <p className="mt-4 max-w-[46ch] text-lg leading-relaxed text-gray-600 dark:text-gray-400">{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
