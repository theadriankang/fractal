import { useEffect, useRef, useState } from 'react'
import { X, Sparkles, Users } from 'lucide-react'
import { getProvider } from '../data/models'
import { STATUSES } from '../data/expertise'

export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-gray-900 dark:fill-white" />
      <g className="fill-accent-500 dark:fill-gray-900">
        <path d="M16 5l5 8.7H11z" />
        <path d="M10.5 14.5l5 8.7h-10z" />
        <path d="M21.5 14.5l5 8.7h-10z" />
      </g>
    </svg>
  )
}

export function ProviderIcon({ providerId, size = 20, auto = false }) {
  if (auto || !providerId)
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent-400 to-indigo-500 text-white"
        style={{ width: size, height: size }}
      >
        <Sparkles size={size * 0.6} />
      </span>
    )
  const p = getProvider(providerId)
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
      style={{ width: size, height: size, background: p.color, fontSize: size * 0.5, color: p.id === 'xai' ? '#111' : '#fff' }}
    >
      {p.initial}
    </span>
  )
}

export function StatusBadge({ status }) {
  const s = STATUSES[status]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.cls}`}>{s.label}</span>
}

// A soft, proportional note for a domain card: how many of its topics rely
// on a single contributor, out of how many have anything captured. Never a
// single verdict for the whole domain -- a domain with one thin topic and
// several well-covered ones reads as "1 of 4", not as the whole domain
// being shaky. `coverage` is domainContributorCoverage()'s return value;
// renders nothing when nothing is flagged.
export function ContributorCoverageNote({ coverage }) {
  if (!coverage) return null
  const cls = coverage.level === 'high' ? 'text-red-500 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
  const dotCls = coverage.level === 'high' ? 'bg-red-500' : 'bg-amber-500'
  const title = `Topics relying on one contributor: ${coverage.flaggedNames.join(', ')}. This reflects who has documented knowledge so far, not who the real experts are.`
  return (
    <span title={title} className={`mt-2 flex items-center gap-1.5 text-[11px] ${cls}`}>
      <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${dotCls}`} />
      {coverage.flaggedTopics} of {coverage.totalTopics} topics need more contributors
    </span>
  )
}

// The precise, topic-level signal: who has actually touched this topic's
// captured Expertise (author + anyone who proposed a revision). `coverage`
// is topicCoverage()'s return value; renders nothing with nothing captured.
export function TopicContributorBadge({ coverage }) {
  if (!coverage) return null
  if (coverage.singleContributor) {
    return (
      <span
        title={`All ${coverage.total} captured here trace back to ${coverage.contributor}. If they're unavailable, nobody else has touched this topic yet.`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-600 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25"
      >
        <span className="h-[5px] w-[5px] rounded-full bg-amber-500" /> Single contributor
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
      <Users size={11} /> {coverage.distinctContributors} contributors
    </span>
  )
}

export function useClickOutside(onOutside) {
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && onOutside()
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onOutside])
  return ref
}

export function Dropdown({ trigger, children, align = 'left', className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(() => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div className={`menu mt-1 ${align === 'right' ? 'right-0' : 'left-0'} ${className}`} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide = false }) {
  useEffect(() => {
    if (!open) return
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fadeIn" onMouseDown={onClose}>
      <div
        className={`card flex max-h-[85vh] w-full flex-col overflow-hidden shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 pt-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-accent-500' : 'bg-gray-300 dark:bg-gray-700'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
}

export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
