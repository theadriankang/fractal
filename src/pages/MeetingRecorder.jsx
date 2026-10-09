import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Mic, Square, Pencil, Check, CloudOff, Cloud, Loader2, RotateCcw, Lock, Copy, Sparkles, History, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { useMeetingRecorder, joinBlocks } from '../hooks/useMeetingRecorder'
import { hasSupabase } from '../lib/supabase'
import { listMeetings, deleteMeeting } from '../lib/meetingsService'
import { streamText } from '../lib/mockApi'
import { Logo } from '../components/ui'
import TopBar from '../components/TopBar'
import Composer from '../components/Composer'

const fmt = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':')
const panel = 'rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-850'

// ---------------------------------------------------------------- waveform
function Waveform({ analyser, active }) {
  const canvas = useRef(null)
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const W = c.clientWidth, H = c.clientHeight
    c.width = W * dpr; c.height = H * dpr; ctx.scale(dpr, dpr)
    const BARS = 48, gap = 3, bw = (W - gap * (BARS - 1)) / BARS
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    let raf, t = 0
    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      if (data) analyser.getByteFrequencyData(data)
      for (let i = 0; i < BARS; i++) {
        // mirror the spectrum so the waveform is symmetric around the centre
        const k = Math.abs(i - BARS / 2) / (BARS / 2)
        const v = data ? data[Math.floor(k * data.length * 0.6)] / 255 : 0.06 + 0.04 * Math.sin(t / 20 + i / 3)
        const h = Math.max(3, v * H * 0.95)
        ctx.fillStyle = active ? `rgba(239,68,68,${0.45 + v * 0.55})` : 'rgba(155,155,155,.35)'
        ctx.beginPath()
        ctx.roundRect(i * (bw + gap), (H - h) / 2, bw, h, bw / 2)
        ctx.fill()
      }
      t++
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [analyser, active])
  return <canvas ref={canvas} className="h-14 w-full max-w-md" aria-hidden />
}

// ---------------------------------------------------------------- record control
function RecordControl({ rec }) {
  const recording = rec.status === 'recording'
  return (
    <div className={`${panel} flex flex-col items-center gap-4 px-6 py-7`}>
      <button
        onClick={recording ? rec.stop : rec.start}
        className={`group relative flex h-24 w-24 items-center justify-center rounded-full text-white transition focus:outline-none focus-visible:ring-4 focus-visible:ring-red-500/40
          ${recording ? 'bg-[#DC2626] animate-recGlow' : 'bg-[#EF4444] shadow-lg shadow-red-500/20 hover:scale-105 hover:bg-[#DC2626] active:scale-95'}`}
        aria-pressed={recording}
        title={recording ? 'Stop recording' : 'Start recording'}
      >
        {recording ? <Square size={30} fill="currentColor" /> : <Mic size={36} />}
      </button>
      <div className="text-center">
        <p className="text-sm font-medium">{recording ? 'Stop Recording' : rec.status === 'done' ? 'Record again' : 'Start Recording'}</p>
        <p className="mt-1 flex items-center justify-center gap-2 font-mono text-2xl tabular-nums tracking-wider">
          {recording && <span className="h-2 w-2 rounded-full bg-red-500 animate-blink" />}
          {fmt(rec.elapsed)}
        </p>
      </div>
      <Waveform analyser={rec.analyser} active={recording} />
      {rec.error && <p className="max-w-md text-center text-sm text-red-400">{rec.error}</p>}
      {!rec.supported && !rec.error && (
        <p className="max-w-md text-center text-xs text-amber-400">Live transcription needs Chrome or Edge — this browser lacks the Web Speech API.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- transcript
function Block({ block, editing, onEdit, onSave, onCancel }) {
  const [draft, setDraft] = useState(block.text)
  const ta = useRef(null)
  useEffect(() => { if (!editing) setDraft(block.text) }, [block.text, editing])
  useLayoutEffect(() => {
    if (!editing || !ta.current) return
    ta.current.style.height = 'auto'
    ta.current.style.height = ta.current.scrollHeight + 'px'
  }, [editing, draft])

  if (editing)
    return (
      <div className="rounded-xl bg-gray-50 p-2 ring-1 ring-accent-500/50 dark:bg-gray-900">
        <textarea
          ref={ta}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onSave(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur() }
            if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          }}
          className="w-full resize-none bg-transparent text-[15px] leading-7 outline-none"
        />
        <p className="flex items-center gap-1 text-[11px] text-gray-500"><Check size={11} /> Enter to save · Shift+Enter new line · Esc to cancel</p>
      </div>
    )

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => e.key === 'Enter' && onEdit()}
      className="group relative -mx-2 cursor-text rounded-xl px-2 py-1 transition hover:bg-gray-50 dark:hover:bg-white/[0.03]"
    >
      {block.at != null && <span className="mr-2 font-mono text-[11px] text-gray-500">{fmt(block.at)}</span>}
      <span className="text-[15px] leading-7 text-gray-800 dark:text-gray-100">{block.text}</span>
      <Pencil size={13} className="absolute right-2 top-2 hidden text-gray-500 group-hover:block" />
    </div>
  )
}

function Transcript({ rec }) {
  const scroller = useRef(null)
  const recording = rec.status === 'recording'
  // follow the live text unless the user scrolled up or is editing
  useEffect(() => {
    const el = scroller.current
    if (!el || rec.editingId) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [rec.blocks, rec.interim, rec.editingId])

  const empty = !rec.blocks.length && !rec.interim
  return (
    <div className={`${panel} flex min-h-0 flex-col`}>
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-800">
        <p className="flex items-center gap-2 text-sm font-medium">
          Live Transcript
          {recording && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">Live</span>}
        </p>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Click any paragraph to edit</span>
          {!!rec.blocks.length && (
            <button className="icon-btn" title="Copy transcript" onClick={() => navigator.clipboard.writeText(joinBlocks(rec.blocks))}><Copy size={15} /></button>
          )}
        </div>
      </div>
      <div ref={scroller} className="min-h-[200px] flex-1 space-y-2 overflow-y-auto px-5 py-4">
        {empty && (
          <p className="py-10 text-center text-sm text-gray-500">
            {recording ? 'Listening… start speaking.' : 'Your transcript will stream here once you start recording.'}
          </p>
        )}
        {rec.blocks.map((b) => (
          <Block
            key={b.id}
            block={b}
            editing={rec.editingId === b.id}
            onEdit={() => rec.setEditingId(b.id)}
            onSave={(text) => { rec.updateBlock(b.id, text); rec.setEditingId(null) }}
            onCancel={() => rec.setEditingId(null)}
          />
        ))}
        {rec.interim && (
          <p className="px-0 text-[15px] leading-7 text-gray-500 italic">
            {rec.interim}<span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-red-400 animate-blink" />
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- post-meeting assistant (mock, local)
const ACTION = /\b(will|need to|needs to|action|follow[- ]?up|by (monday|tuesday|wednesday|thursday|friday|next week|eod|tomorrow)|deadline|assign|todo|to-do)\b/i

function summarise(blocks) {
  const sentences = blocks.flatMap((b) => b.text.split(/(?<=[.!?])\s+/)).filter((s) => s.trim().length > 12)
  const key = blocks.map((b) => b.text.split(/(?<=[.!?])\s+/)[0]).filter(Boolean).slice(0, 6)
  const actions = sentences.filter((s) => ACTION.test(s)).slice(0, 8)
  const words = blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0)
  // blank lines between blocks so Markdown keeps headings, meta line and lists separate
  return [
    `### Meeting summary`,
    `*${blocks.length} paragraphs · ~${words} words*`,
    `**Key points**`,
    key.map((k) => `- ${k}`).join('\n'),
    `**Action items**`,
    (actions.length ? actions.map((a) => `- [ ] ${a}`) : ['- _No explicit action items detected._']).join('\n'),
  ].join('\n\n')
}

function runCommand(text, rec) {
  const replace = text.match(/^(?:replace|change)\s+["“]?(.+?)["”]?\s+(?:with|to)\s+["“]?(.+?)["”]?$/i)
  if (replace) {
    const [, from, to] = replace
    const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const hits = rec.blocks.reduce((n, b) => n + (b.text.match(re)?.length || 0), 0)
    if (!hits) return `I couldn't find **"${from}"** in the transcript.`
    rec.replaceTranscript(joinBlocks(rec.blocks).replace(re, to))
    return `Replaced **${hits}** occurrence${hits > 1 ? 's' : ''} of "${from}" with "${to}". Changes auto-saved.`
  }
  const rename = text.match(/^(?:rename|title)(?:\s+(?:it|meeting|this))?\s+(?:to|as)?\s*["“]?(.+?)["”]?$/i)
  if (rename) { rec.setTitle(rename[1]); return `Renamed the meeting to **${rename[1]}**.` }
  if (/summar|recap|tl;?dr|key points|minutes/i.test(text)) return summarise(rec.blocks)
  if (/action|todo|to-do|next steps/i.test(text)) return summarise(rec.blocks).split('**Action items**')[1].trim()
  return [
    'I can work with this transcript. Try:',
    '- **"Summarise the meeting"** — key points + action items',
    '- **"List the action items"**',
    '- **"Replace Kepel with Keppel"** — fix a misheard word everywhere',
    '- **"Rename to Chiller plant review"**',
  ].join('\n')
}

function MeetingChat({ rec }) {
  const [turns, setTurns] = useState([])
  const [streaming, setStreaming] = useState(false)
  const cancel = useRef(null)
  const bottom = useRef(null)
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [turns])
  useEffect(() => { if (rec.status !== 'done') setTurns([]) }, [rec.status])

  const onSend = (text) => {
    const reply = runCommand(text, rec)
    const id = Math.random().toString(36).slice(2)
    setTurns((t) => [...t, { id, q: text, a: '' }])
    setStreaming(true)
    cancel.current = streamText(
      reply,
      (p) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, a: p } : x))),
      (f) => { setTurns((t) => t.map((x) => (x.id === id ? { ...x, a: f } : x))); setStreaming(false) },
    )
  }

  return (
    <>
      {turns.length > 0 && (
        <div className="space-y-5">
          {turns.map((t) => (
            <div key={t.id} className="space-y-3 animate-fadeIn">
              <div className="ml-auto w-fit max-w-[80%] rounded-3xl bg-gray-100 px-4 py-2 text-[15px] dark:bg-gray-850">{t.q}</div>
              <div className="flex gap-3">
                <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent-400 to-indigo-500 text-white"><Sparkles size={13} /></span>
                <div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{t.a}</ReactMarkdown></div>
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      )}
      <ChatDock>
        <Composer
          onSend={onSend} streaming={streaming} onStop={() => cancel.current?.()} autoFocus={false}
          showRouting={false} allowExpertise={false}
          placeholder='Ask about this meeting — e.g. "Summarise the meeting" or "Replace Kepel with Keppel"'
        />
      </ChatDock>
    </>
  )
}

const ChatDock = ({ children }) => (
  <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-white via-white to-transparent px-4 pb-3 pt-6 dark:from-gray-900 dark:via-gray-900">{children}</div>
)

function LockedComposer() {
  return (
    <ChatDock>
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 rounded-3xl border border-dashed border-gray-300 px-5 py-4 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-850">
        <Lock size={16} /> Chat unlocks when the recording ends — then ask me to summarise or edit the transcript.
      </div>
    </ChatDock>
  )
}

// ---------------------------------------------------------------- save indicator
function SaveBadge({ save }) {
  const map = {
    saving: [<Loader2 key="i" size={13} className="animate-spin" />, 'Saving…'],
    saved: [<Cloud key="i" size={13} />, hasSupabase ? 'Saved to Supabase' : 'Saved locally'],
    error: [<CloudOff key="i" size={13} className="text-red-400" />, 'Save failed'],
  }
  const v = map[save.state]
  if (!v) return null
  return <span className="mr-1 flex items-center gap-1.5 text-xs text-gray-500" title={save.error || ''}>{v[0]} {v[1]}</span>
}


// ---------------------------------------------------------------- recent meetings
function RecentMeetings({ rec }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const refresh = () => listMeetings(10).then(setRows).catch((e) => setErr(e.message))
  // reload whenever a recording finishes or the user returns to idle
  useEffect(() => { if (rec.status !== 'recording') refresh() }, [rec.status, rec.meeting?.id]) // eslint-disable-line
  if (rec.status === 'recording') return null
  const list = (rows || []).filter((r) => r.id !== rec.meeting?.id && (r.transcript_text || '').trim())
  if (!list.length && !err) return null
  return (
    <div className={`${panel} px-5 py-4`}>
      <p className="mb-2 flex items-center gap-2 text-sm font-medium"><History size={15} className="text-gray-500" /> Recent meetings</p>
      {err && <p className="text-sm text-red-400">Couldn't load meetings: {err}</p>}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {list.map((m) => (
          <div key={m.id} className="group flex items-center gap-3 py-2">
            <button className="min-w-0 flex-1 text-left" onClick={() => rec.load(m)}>
              <span className="block truncate text-sm font-medium group-hover:text-accent-500">{m.title}</span>
              <span className="block truncate text-xs text-gray-500">
                {new Date(m.created_at).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {fmt(m.duration || 0)} · {m.transcript_text.slice(0, 80)}
              </span>
            </button>
            <button
              className="icon-btn opacity-0 group-hover:opacity-100"
              title="Delete meeting"
              onClick={async () => { await deleteMeeting(m.id); refresh() }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page
export default function MeetingRecorder() {
  const user = useStore((s) => s.user)
  const rec = useMeetingRecorder()
  const recording = rec.status === 'recording'

  // warn before closing the tab mid-recording
  useEffect(() => {
    if (!recording) return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [recording])

  return (
    <div className="flex h-full flex-col">
      <TopBar
        right={
          <>
            <SaveBadge save={rec.save} />
            {rec.status === 'done' && (
              <button className="btn-ghost mr-1" onClick={rec.reset}><RotateCcw size={14} /> New meeting</button>
            )}
          </>
        }
      >
        {rec.status !== 'idle' ? (
          <input
            value={rec.title}
            onChange={(e) => rec.setTitle(e.target.value)}
            className="w-full max-w-sm rounded-lg bg-transparent px-2 py-1 text-sm font-medium outline-none hover:bg-gray-100 focus:bg-gray-100 dark:hover:bg-gray-850 dark:focus:bg-gray-850"
            aria-label="Meeting title"
          />
        ) : (
          <span className="px-2 text-sm font-medium">Meeting Recorder</span>
        )}
      </TopBar>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-5 px-4 pt-6">
          <div className="flex items-center justify-center gap-3 animate-fadeIn">
            <Logo size={34} />
            <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">Ready to record your meeting, {user.name.split(' ')[0]}?</h1>
          </div>

          <RecordControl rec={rec} />
          <Transcript rec={rec} />
          <RecentMeetings rec={rec} />

          <div className="mt-auto">
            {rec.status === 'done' ? <MeetingChat rec={rec} /> : <LockedComposer />}
          </div>
        </div>
      </div>
    </div>
  )
}
