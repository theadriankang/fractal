import { useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, BookOpenCheck, FileText, Globe, X,
} from 'lucide-react'
import { useStore } from '../store'
import { ModelBadge } from './ModelSelector'
import CaptureCard from './CaptureCard'
import { contributeBlock } from '../lib/permissions'

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

function ExpertiseUsed({ refs }) {
  const expertise = useStore((s) => s.expertise)
  if (!refs?.length) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-gray-500">Expertise applied</span>
      {refs.map((r) => {
        const e = expertise.find((x) => x.id === r.id)
        if (!e) return null
        return (
          <Link
            key={r.id}
            to={`/expertise/${r.id}`}
            className="group flex items-center gap-1.5 rounded-lg bg-accent-500/10 px-2 py-1 text-xs text-accent-600 ring-1 ring-accent-500/25 transition hover:bg-accent-500/20 dark:text-accent-400"
            title={`${e.summary}\n\nOwner: ${e.owner}`}
          >
            <BookOpenCheck size={13} />
            {e.name}
            <span className="rounded bg-accent-500/15 px-1 font-mono text-[10px]">v{r.version}</span>
          </Link>
        )
      })}
    </div>
  )
}

function ResponseCard({ chatId, msg, idx, compare }) {
  const r = msg.responses[idx]
  const { regenerate, rateResponse, user, expertise } = useStore()
  const usedDomain = expertise.find((e) => e.id === r.expertise?.[0]?.id)?.domain
  // Corrections become proposals, so they follow the contribution rule; anyone can still rate.
  const correctionBlock = usedDomain ? contributeBlock(user, usedDomain) : (user.role !== 'contributor' ? contributeBlock(user) : null)
  const [copied, setCopied] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [correction, setCorrection] = useState('')

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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.content}</ReactMarkdown>
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
          <ExpertiseUsed refs={r.expertise} />
          <div className="mt-2 flex items-center gap-0.5 text-gray-500">
            <button className="icon-btn" onClick={copy} title="Copy">{copied ? <Check size={15} /> : <Copy size={15} />}</button>
            <button className="icon-btn" onClick={() => regenerate(chatId, msg.id, idx)} title="Regenerate"><RefreshCw size={15} /></button>
            <button
              className={`icon-btn ${r.rating === 'up' ? 'text-emerald-500' : ''}`}
              onClick={() => rateResponse(chatId, msg.id, idx, 'up')}
              title="Good response"
            >
              <ThumbsUp size={15} fill={r.rating === 'up' ? 'currentColor' : 'none'} />
            </button>
            <button
              className={`icon-btn ${r.rating === 'down' ? 'text-red-500' : ''}`}
              onClick={() => setCorrecting(true)}
              title="Bad response — suggest a correction"
            >
              <ThumbsDown size={15} fill={r.rating === 'down' ? 'currentColor' : 'none'} />
            </button>
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
                : 'Your correction goes to the Review Queue as a proposed revision of the Expertise used. Nothing changes until a reviewer approves it.'}
          </p>
          {!correctionBlock && <textarea
            autoFocus
            rows={2}
            className="input resize-none"
            placeholder="e.g. You should also check the CHW pump VSD before staging up a chiller."
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
          />}
          <div className="mt-2 flex justify-end gap-2">
            <button className={correctionBlock ? 'btn-primary' : 'btn-ghost'} onClick={() => { rateResponse(chatId, msg.id, idx, 'down'); setCorrecting(false) }}>{correctionBlock ? 'Rate 👎' : 'Just 👎'}</button>
            {!correctionBlock && <button
              className="btn-primary"
              disabled={!correction.trim()}
              onClick={() => { rateResponse(chatId, msg.id, idx, 'down', correction); setCorrecting(false); setCorrection('') }}
            >
              Submit correction
            </button>}
          </div>
        </div>
      )}
    </div>
  )
}


export function AssistantMessage({ chatId, msg }) {
  const compare = msg.responses.length > 1
  return (
    <div className="animate-fadeIn">
      <div className={compare ? `grid gap-3 ${msg.responses.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}` : ''}>
        {msg.responses.map((_, i) => <ResponseCard key={i} chatId={chatId} msg={msg} idx={i} compare={compare} />)}
      </div>
      <CaptureCard key={msg.detection ? 'detected' : 'none'} chatId={chatId} msg={msg} />
    </div>
  )
}
