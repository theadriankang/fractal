import { useEffect, useRef } from 'react'
import { RotateCcw } from 'lucide-react'

// Live branching fractal for the landing hero.
// The whole simulation runs in a rAF loop on refs and typed arrays (never React
// state), pauses when off-screen or in a background tab, and collapses to a
// single static drawing under prefers-reduced-motion.

const MAX_DEPTH = 9
const HOLD = 9 // seconds the grown tree breathes before it reseeds
const FADE = 1.4 // seconds to fade out before regrowing
const BLOOM = 0.9 // seconds a new tip's ring takes to settle

function rng(seed) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Branches are stored depth-first with parents before children, so a single
// forward pass can place every branch relative to its parent's tip.
function buildTree(seed) {
  const rand = rng(seed)
  const branches = []
  const add = (parent, rel, len, depth, birth) => {
    const i = branches.length
    const dur = 0.45 + rand() * 0.3
    branches.push({ parent, rel, len, depth, birth, dur, phase: rand() * Math.PI * 2, leaf: false })
    if (depth === MAX_DEPTH || (depth > 5 && rand() < 0.14)) {
      branches[i].leaf = true
      return
    }
    const count = depth > 0 && depth < 5 && rand() < 0.25 ? 3 : 2
    const spread = 0.3 + rand() * 0.24
    for (let k = 0; k < count; k++) {
      const t = k / (count - 1) - 0.5
      add(i, t * 2 * spread + (rand() - 0.5) * 0.2, len * (0.68 + rand() * 0.12), depth + 1, birth + dur * 0.8)
    }
  }
  add(-1, 0, 1, 0, 0)

  const byDepth = Array.from({ length: MAX_DEPTH + 1 }, () => [])
  const leaves = []
  let total = 0
  branches.forEach((b, i) => {
    byDepth[b.depth].push(i)
    if (b.leaf) leaves.push(i)
    total = Math.max(total, b.birth + b.dur)
  })
  return { branches, byDepth, leaves, total: total + BLOOM }
}

export default function FractalTree({ className = '' }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const regrowRef = useRef(() => {})

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const reduceMq = matchMedia('(prefers-reduced-motion: reduce)')

    let reduce = reduceMq.matches
    let tree, n, ang, sx, sy, ex, ey, prog
    let clock = 0
    let growT = 0
    let fadeAt = -1
    let bend = 0
    let bendTarget = 0
    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let last = 0
    let visible = true
    let colors = readColors()

    function readColors() {
      const cs = getComputedStyle(canvas)
      return {
        branch: cs.getPropertyValue('--fr-branch').trim() || '155 155 155',
        tip: cs.getPropertyValue('--fr-tip').trim() || '245 245 245',
      }
    }

    function reseed() {
      tree = buildTree((Math.random() * 2 ** 31) | 0)
      n = tree.branches.length
      ang = new Float32Array(n)
      sx = new Float32Array(n)
      sy = new Float32Array(n)
      ex = new Float32Array(n)
      ey = new Float32Array(n)
      prog = new Float32Array(n)
      growT = 0
      fadeAt = -1
    }

    function draw(t, alpha) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (!w || !h || alpha <= 0) return
      const scale = Math.min(h * 0.25, w * 0.21) * dpr
      const rootX = w * 0.5 * dpr
      const rootY = h * dpr
      const { branches } = tree

      for (let i = 0; i < n; i++) {
        const b = branches[i]
        const p = Math.min(1, Math.max(0, (t - b.birth) / b.dur))
        prog[i] = p
        if (p === 0) continue
        // Sway is a wave travelling out from the trunk; bend follows the pointer.
        // Both are tiny per branch because angles accumulate down the chain.
        const sway = reduce ? 0 : Math.sin(clock * 0.9 - b.depth * 0.45 + b.phase * 0.4) * 0.014 + bend * 0.016
        const a = (b.parent < 0 ? -Math.PI / 2 : ang[b.parent]) + b.rel + sway
        const x0 = b.parent < 0 ? rootX : ex[b.parent]
        const y0 = b.parent < 0 ? rootY : ey[b.parent]
        const len = b.len * scale * (1 - (1 - p) ** 3)
        ang[i] = a
        sx[i] = x0
        sy[i] = y0
        ex[i] = x0 + Math.cos(a) * len
        ey[i] = y0 + Math.sin(a) * len
      }

      // One path per depth keeps this to ~10 strokes a frame.
      ctx.lineCap = 'round'
      for (let d = 0; d <= MAX_DEPTH; d++) {
        const idx = tree.byDepth[d]
        if (!idx.length) continue
        const outer = d >= MAX_DEPTH - 2
        const a = (outer ? 0.4 + (d - (MAX_DEPTH - 2)) * 0.15 : 0.8 - d * 0.07) * alpha
        ctx.strokeStyle = `rgb(${outer ? colors.tip : colors.branch} / ${a})`
        ctx.lineWidth = Math.max(0.75 * dpr, scale * 0.05 * 0.7 ** d)
        ctx.beginPath()
        for (const i of idx) {
          if (prog[i] === 0) continue
          ctx.moveTo(sx[i], sy[i])
          ctx.lineTo(ex[i], ey[i])
        }
        ctx.stroke()
      }

      const r = Math.max(1.4 * dpr, scale * 0.011)
      ctx.fillStyle = `rgb(${colors.tip} / ${0.9 * alpha})`
      ctx.beginPath()
      for (const i of tree.leaves) {
        if (prog[i] < 1) continue
        ctx.moveTo(ex[i] + r, ey[i])
        ctx.arc(ex[i], ey[i], r, 0, Math.PI * 2)
      }
      ctx.fill()

      if (reduce) return
      ctx.lineWidth = dpr
      for (const i of tree.leaves) {
        const age = t - (branches[i].birth + branches[i].dur)
        if (age < 0 || age > BLOOM) continue
        const k = age / BLOOM
        ctx.strokeStyle = `rgb(${colors.tip} / ${(1 - k) * 0.6 * alpha})`
        ctx.beginPath()
        ctx.arc(ex[i], ey[i], r + k * 10 * dpr, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    function frame(now) {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      clock += dt
      growT += dt
      bend += (bendTarget - bend) * Math.min(1, dt * 3)
      let alpha = 1
      if (fadeAt < 0 && growT > tree.total + HOLD) fadeAt = clock
      if (fadeAt >= 0) {
        const k = (clock - fadeAt) / FADE
        if (k >= 1) reseed()
        else alpha = 1 - k
      }
      draw(growT, alpha)
    }

    function start() {
      if (raf || reduce || !visible || document.hidden) return
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
    function stop() {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const drawStatic = () => draw(reduce ? Infinity : growT, 1)

    regrowRef.current = () => {
      if (reduce) {
        reseed()
        drawStatic()
      } else if (fadeAt < 0) {
        fadeAt = clock
      }
    }

    reseed()

    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect()
      w = rect.width
      h = rect.height
      dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      if (!raf) drawStatic()
    })
    ro.observe(wrap)

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      visible ? start() : stop()
    })
    io.observe(wrap)

    const onVisibility = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVisibility)

    const onReduce = (e) => {
      reduce = e.matches
      if (reduce) {
        stop()
        drawStatic()
      } else {
        start()
      }
    }
    reduceMq.addEventListener('change', onReduce)

    const themeObserver = new MutationObserver(() => {
      colors = readColors()
      if (!raf) drawStatic()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const onMove = (e) => {
      const rect = wrap.getBoundingClientRect()
      bendTarget = ((e.clientX - rect.left) / rect.width - 0.5) * 2
    }
    const onLeave = () => (bendTarget = 0)
    wrap.addEventListener('pointermove', onMove, { passive: true })
    wrap.addEventListener('pointerleave', onLeave)

    start()

    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      themeObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      reduceMq.removeEventListener('change', onReduce)
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="A branching fractal tree growing from a single trunk, its tips brightening as they form"
        className="absolute inset-0 h-full w-full"
      />
      <button
        type="button"
        onClick={() => regrowRef.current()}
        className="btn-ghost absolute bottom-4 right-4 text-xs active:scale-[0.98]"
      >
        <RotateCcw size={13} strokeWidth={2} /> Regrow
      </button>
    </div>
  )
}
