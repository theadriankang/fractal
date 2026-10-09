import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, BookOpenCheck, FileText, Globe, Sparkles, X, GitPullRequestArrow, ArrowRight,
} from 'lucide-react'
import { useStore } from '../store'
import { ModelBadge } from './ModelSelector'

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
  const { regenerate, rateResponse } = useStore()
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
        ) : (
          <div className="flex gap-1 py-2">
            {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-pulse rounded-full bg-gray-400" style={{ animationDelay: `${i * 150}ms` }} />)}
          </div>
        )}
        {r.streaming && r.content && <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-blink bg-gray-400" />}
      </div>

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
            {r.expertise?.length
              ? 'Your correction goes to the Review Queue as a proposed revision of the Expertise used. Nothing changes until a reviewer approves it.'
              : 'Your feedback helps Fractal improve.'}
          </p>
          <textarea
            autoFocus
            rows={2}
            className="input resize-none"
            placeholder="e.g. You should also check the CHW pump VSD before staging up a chiller."
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => { rateResponse(chatId, msg.id, idx, 'down'); setCorrecting(false) }}>Just 👎</button>
            <button
              className="btn-primary"
              disabled={!correction.trim()}
              onClick={() => { rateResponse(chatId, msg.id, idx, 'down', correction); setCorrecting(false); setCorrection('') }}
            >
              Submit correction
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DetectionCard({ chatId, msg }) {
  const { acceptDetection, dismissDetection, user } = useStore()
  const navigate = useNavigate()
  const d = msg.detection
  if (!d || msg.detectionState === 'dismissed') return null

  if (msg.detectionState === 'saved')
    return (
      <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 ring-1 ring-emerald-500/25 animate-fadeIn dark:text-emerald-400">
        <Check size={16} />
        {d.kind === 'new' ? 'Saved as a draft Expertise.' : `Revision proposed for ${d.expertiseName}.`}
        <button
          className="ml-auto flex items-center gap-1 font-medium hover:underline"
          onClick={() => navigate(d.kind === 'new' ? `/expertise/${msg.detectionResult}` : '/expertise/review')}
        >
          {d.kind === 'new' ? 'Open draft' : 'View in Review Queue'} <ArrowRight size={14} />
        </button>
      </div>
    )

  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl bg-gradient-to-br from-accent-500/10 via-transparent to-indigo-500/10 p-4 ring-1 ring-accent-500/30 animate-fadeIn">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-500/15 text-accent-500">
          {d.kind === 'new' ? <Sparkles size={18} /> : <GitPullRequestArrow size={18} />}
        </span>
        <div className="flex-1">
          <p className="font-medium">
            {d.kind === 'new' ? 'Fractal noticed reusable know-how' : `This could improve "${d.expertiseName}"`}
          </p>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {d.kind === 'new'
              ? <>Save it as a draft Expertise in <b className="text-gray-700 dark:text-gray-200">{d.draft.domain} › {d.draft.topic}</b> so the next person gets the same answer. A reviewer approves it before it goes live.</>
              : 'You shared something the current version doesn\'t cover. Propose it as a revision for review?'}
          </p>
          <div className="mt-2 rounded-xl bg-white/60 p-3 text-sm ring-1 ring-gray-200 dark:bg-gray-900/60 dark:ring-gray-800">
            {d.kind === 'new' ? (
              <>
                <p className="font-medium">{d.draft.name}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-600 dark:text-gray-400">
                  {d.draft.knowledge.slice(0, 3).map((k, i) => <li key={i}>{k}</li>)}
                </ul>
              </>
            ) : (
              <p className="text-gray-600 dark:text-gray-400"><span className="text-emerald-500">+ </span>{d.addition}</p>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-accent" onClick={() => acceptDetection(chatId, msg.id)}>
              {d.kind === 'new' ? 'Save as draft' : 'Propose revision'}
            </button>
            <button className="btn-ghost" onClick={() => dismissDetection(chatId, msg.id)}>Not now</button>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">Captured by {user.name} · source conversation will be linked</p>
        </div>
      </div>
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
      <DetectionCard chatId={chatId} msg={msg} />
    </div>
  )
}
