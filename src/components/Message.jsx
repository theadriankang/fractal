import { useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ChartBlock from './ChartBlock'
import {
  Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, BookOpenCheck, FileText, Globe, X, Scale, Layers,
} from 'lucide-react'
import { useStore } from '../store'
import { ModelBadge } from './ModelSelector'
import CaptureCard from './CaptureCard'
import WeighPanel from './WeighPanel'
import { contributeBlock } from '../lib/permissions'
import { TAXONOMY } from '../data/taxonomy'

export function UserMessage({ msg }) {
  const expertise = useStore((s) => s.expertise)
  return (
    <div className="flex flex-col items-end gap-1.5 animate-fadeIn">
      {(msg.files?.length > 0 || msg.attachedExpertise?.length > 0 || msg.webSearch) && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {msg.webSearch && <span className="flex items-center gap-1 rounded-lg bg-sky-500/10 px-2 py-1 text-xs text-sky-500"><Globe size={12} /> Web search</span>}
          {msg.attachedExpertise?.map((id) => (
            <span key={id} className="flex items-center gap-1 rounded-lg bg-accent-500/10 px-2 py-1 text-xs text-accent-500">
              <BookOpenCheck size={12} /> {expertise.find((e) => e.id === id)?.name}
            </span>
          ))}
          {msg.files?.map((f, i) => (
            <span key={i} className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs dark:bg-gray-850"><FileText size={12} /> {f.name}</span>
          ))}
        </div>
      )}
      <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-gray-100 px-4 py-2.5 text-[15px] leading-relaxed dark:bg-gray-850">
        {msg.content}
      </div>
    </div>
  )
}

// "Expertise applied" chips under an answer. Each chip carries its domain; when the answer drew on
// more than one domain, a "Drew on: …" line says so, in the same style as Data Insights reports.
function ExpertiseUsed({ refs, domainsCoordinated }) {
  const expertise = useStore((s) => s.expertise)
  if (!refs?.length) return null
  const shown = refs
    .map((r) => ({ r, e: expertise.find((x) => x.id === r.id) }))
    .filter(({ e }) => e)
    .map(({ r, e }) => ({ r, e, domain: r.domain || e.domain }))
  // The backend's list when present (live answers); otherwise derived from the chips (saved/mock answers).
  const domains = domainsCoordinated?.length ? domainsCoordinated : [...new Set(shown.map((x) => x.domain).filter(Boolean))].sort()
  return (
    <div className="mt-3">
      {domains.length > 1 && (
        <p className="mb-1.5 flex items-center gap-1 text-[11px] text-gray-500" title="This answer combined approved Expertise from more than one domain">
          <Layers size={11} /> Drew on: {domains.join(', ')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500">Expertise applied</span>
        {shown.map(({ r, e, domain }) => {
          const meta = TAXONOMY.find((d) => d.domain === domain)
          return (
            <Link
              key={r.id}
              to={`/expertise/${r.id}`}
              className="group flex items-center gap-1.5 rounded-lg bg-accent-500/10 px-2 py-1 text-xs text-accent-600 ring-1 ring-accent-500/25 transition hover:bg-accent-500/20 dark:text-accent-400"
              title={`${e.summary}\n\nDomain: ${domain}\nOwner: ${e.owner}`}
            >
              <BookOpenCheck size={13} />
              {e.name}
              <span className="rounded bg-accent-500/15 px-1 font-mono text-[10px]">v{r.version}</span>
              {domain && (
                <span className="flex items-center gap-1 whitespace-nowrap border-l border-accent-500/25 pl-1.5 text-[10px] text-gray-600 dark:text-gray-400">
                  <span className={`h-1.5 w-1.5 rounded-full ${meta?.dot || 'bg-gray-400'}`} />
                  {domain}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A fenced ```chart block (JSON spec — see ChartBlock.jsx) renders as an actual chart
 * instead of a code block. The model is told this convention in the system prompt
 * (backend/app/prompts.py). While streaming, the JSON may still be incomplete — that
 * parse failure is expected and just falls back to rendering nothing until it completes,
 * rather than flashing broken JSON at the person.
 */
// Explicit, clearly-stepped sizes for named sections ("Recommended approach", "Warnings") so
// they read as real headings at a glance, rather than leaning on the prose plugin's default
// scale (which, at prose-sm/base, lands close enough to bold body text that a header and a
// bold lead-in sentence were hard to tell apart — see docs/UX_FONT_SCALE_NOTES).
const markdownComponents = {
  code(props) {
    const { children, className, node, ...rest } = props
    const match = /language-(\w+)/.exec(className || '')
    if (match?.[1] === 'chart') {
      const raw = String(children).replace(/\n$/, '')
      try {
        return <ChartBlock spec={JSON.parse(raw)} />
      } catch {
        return null
      }
    }
    return <code {...rest} className={className}>{children}</code>
  },
  h1: ({ children }) => <h1 className="mb-2.5 mt-5 text-xl font-bold tracking-tight first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-bold tracking-tight first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-3 text-[15px] font-semibold first:mt-0">{children}</h4>,
}

function ResponseCard({ chatId, msg, idx, compare, readOnly }) {
  const r = msg.responses[idx]
  const { regenerate, rateResponse, user, expertise } = useStore()
  const [copied, setCopied] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [correction, setCorrection] = useState('')
  // Which applied Expertise the correction is about (asked only when more than one was used).
  const used = (r.expertise || []).map((x) => expertise.find((e) => e.id === x.id)).filter(Boolean)
  const [targetId, setTargetId] = useState(null)
  const target = used.find((e) => e.id === targetId) || used[0]
  // Corrections become proposals, so they follow the contribution rule; anyone can still rate.
  const correctionBlock = target ? contributeBlock(user, target.domain) : (user.role !== 'contributor' ? contributeBlock(user) : null)

  const copy = () => {
    navigator.clipboard?.writeText(r.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`min-w-0 ${compare ? 'rounded-2xl p-4 ring-1 ring-gray-200 dark:ring-gray-800' : ''}`}>
      <ModelBadge response={r} />
      <div className="prose prose-sm mt-2 max-w-none dark:prose-invert prose-p:leading-relaxed prose-li:my-0.5 sm:prose-base sm:text-[15px]">
        {r.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{r.content}</ReactMarkdown>
        ) : r.error ? null : (
          <div className="flex gap-1 py-2">
            {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-pulse rounded-full bg-gray-400" style={{ animationDelay: `${i * 150}ms` }} />)}
          </div>
        )}
        {r.streaming && r.content && <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-blink bg-gray-400" />}
      </div>
      {r.error && <p className="mt-2 text-sm text-red-500">{r.error}</p>}

      {!r.streaming && (
        <>
          <ExpertiseUsed refs={r.expertise} domainsCoordinated={r.domainsCoordinated} />
          <div className="mt-2 flex items-center gap-0.5 text-gray-500">
            <button className="icon-btn" onClick={copy} title="Copy">{copied ? <Check size={15} /> : <Copy size={15} />}</button>
            {!readOnly && <button className="icon-btn" onClick={() => regenerate(chatId, msg.id, idx)} title="Regenerate"><RefreshCw size={15} /></button>}
            {!readOnly && (<>
            <button
              className={`icon-btn ${r.rating === 'up' ? 'text-emerald-500' : ''}`}
              onClick={() => rateResponse(chatId, msg.id, idx, 'up')}
              title={r.rating === 'up' ? 'Remove your rating' : 'Good response'}
              aria-pressed={r.rating === 'up'}
            >
              <ThumbsUp size={15} fill={r.rating === 'up' ? 'currentColor' : 'none'} />
            </button>
            <button
              className={`icon-btn ${r.rating === 'down' ? 'text-red-500' : ''}`}
              onClick={() => (r.rating === 'down' ? rateResponse(chatId, msg.id, idx, 'down') : setCorrecting(true))}
              title={r.rating === 'down' ? 'Remove your rating' : 'Bad response — suggest a correction'}
              aria-pressed={r.rating === 'down'}
            >
              <ThumbsDown size={15} fill={r.rating === 'down' ? 'currentColor' : 'none'} />
            </button>
            </>)}
          </div>
        </>
      )}

      {correcting && (
        <div className="mt-2 rounded-2xl bg-gray-50 p-3 ring-1 ring-gray-200 animate-fadeIn dark:bg-gray-850 dark:ring-gray-800">
          <div className="flex items-start justify-between">
            <p className="text-sm font-medium">What should it have said?</p>
            <button className="icon-btn p-1" onClick={() => setCorrecting(false)}><X size={14} /></button>
          </div>
          <p className="mb-2 text-xs text-gray-500">
            {!r.expertise?.length
              ? 'Your feedback helps Fractal improve.'
              : correctionBlock
                ? `Your feedback is recorded on the Expertise used. ${correctionBlock}`
                : 'Fractal turns your correction into a precise change to the Expertise used and sends it to the Review Queue. Nothing changes until a reviewer approves it.'}
          </p>
          {!correctionBlock && used.length > 1 && (
            <label className="mb-2 flex items-center gap-2 text-xs text-gray-500">
              Which Expertise was wrong?
              <select className="input w-auto py-1 text-xs" value={target?.id} onChange={(ev) => setTargetId(ev.target.value)}>
                {used.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
          )}
          {!correctionBlock && <textarea
            autoFocus
            rows={2}
            className="input resize-none"
            placeholder="e.g. Step 2 is out of date — since the retrofit we check the VSD fault log before the strainer."
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
          />}
          <div className="mt-2 flex justify-end gap-2">
            <button className={correctionBlock ? 'btn-primary' : 'btn-ghost'} onClick={() => { rateResponse(chatId, msg.id, idx, 'down'); setCorrecting(false) }}>{correctionBlock ? 'Rate 👎' : 'Just 👎'}</button>
            {!correctionBlock && <button
              className="btn-primary"
              disabled={!correction.trim()}
              onClick={() => { rateResponse(chatId, msg.id, idx, 'down', correction, target?.id); setCorrecting(false); setCorrection('') }}
            >
              Submit correction
            </button>}
          </div>
        </div>
      )}
    </div>
  )
}


// Shown under an answer only when weighing came into play for it (see checkForConflict in store.js):
// the question asked about two areas or a trade-off, or the experts behind it conflict.
function WeighedSection({ msg }) {
  const result = msg.responses.find((r) => r.auto?.weigh)?.auto.weigh
  if (msg.weighCheck === 'checking' && !result) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 animate-fadeIn">
        <Scale size={12} className="animate-pulse text-accent-500" /> Checking whether the experts agree…
      </p>
    )
  }
  if (!result) return null
  return (
    <div className="mt-4 rounded-2xl p-4 ring-1 ring-accent-500/30 animate-fadeIn">
      {/* Domain count used to repeat here AND as pills in WeighPanel's own header right below —
          dropped here since the pills already say it, and said it more usefully (which domains,
          not just how many). */}
      <div className="flex items-center gap-2">
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-accent-600 dark:text-accent-400"><Scale size={13} /></span>
        <span className="text-sm font-semibold">Experts weighed together</span>
      </div>
      {result.trigger && <p className="mt-1 pl-[30px] text-xs text-gray-500">{result.trigger}</p>}
      <WeighPanel result={result} />
    </div>
  )
}

export function AssistantMessage({ chatId, msg, readOnly = false }) {
  const compare = msg.responses.length > 1
  return (
    <div className="animate-fadeIn">
      <div className={compare ? `grid gap-3 ${msg.responses.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}` : ''}>
        {msg.responses.map((_, i) => <ResponseCard key={i} chatId={chatId} msg={msg} idx={i} compare={compare} readOnly={readOnly} />)}
      </div>
      <WeighedSection msg={msg} />
      {!readOnly && <CaptureCard key={msg.detection ? 'detected' : 'none'} chatId={chatId} msg={msg} />}
    </div>
  )
}
