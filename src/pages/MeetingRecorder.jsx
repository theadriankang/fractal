import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Mic, Square, Pencil, Check, Copy, Paperclip, X, FileText, Image as ImageIcon, Sparkles, Loader2,
  Trash2, ArrowLeft, ShieldCheck, Lock, CheckCircle2, AlertTriangle, History, ChevronDown, Route, BookOpen, Plus,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { useMeetingRecorder, joinBlocks } from '../hooks/useMeetingRecorder'
import { hasSupabase } from '../lib/supabase'
import { ACCEPT, MAX_FILES } from '../lib/readAttachment'
import { listMeetings } from '../lib/meetingsService'
import { canContribute, contributeBlock, isContributor } from '../lib/permissions'
import { TAXONOMY } from '../data/taxonomy'
import { Logo } from '../components/ui'
import TopBar from '../components/TopBar'

const fmt = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':')
const panel = 'rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-850'
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

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
  const recording = rec.stage === 'recording'
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
        <p className="text-sm font-medium">{recording ? 'Stop Recording' : rec.stage === 'saved' ? 'Record new meeting' : 'Start Recording'}</p>
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
  const recording = rec.stage === 'recording'
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

// ---------------------------------------------------------------- attachments
function AttachmentZone({ rec }) {
  const [over, setOver] = useState(false)
  const input = useRef(null)
  const locked = ['generating', 'insights', 'saving', 'saved'].includes(rec.stage)
  const full = rec.files.length >= MAX_FILES
  return (
    <div className={panel + ' p-4'}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">Context files <span className="font-normal text-gray-500">· grounding for key insights</span></p>
        <span className="text-xs text-gray-500">{rec.files.length}/{MAX_FILES}</span>
      </div>
      {!locked && (
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); rec.addFiles([...e.dataTransfer.files]) }}
          onClick={() => !full && input.current.click()}
          className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-sm transition
            ${over ? 'border-red-400 bg-red-500/5 text-gray-200' : 'border-gray-300 text-gray-500 hover:border-gray-400 dark:border-gray-800 dark:hover:border-gray-600'}
            ${full ? 'pointer-events-none opacity-40' : ''}`}
        >
          <Paperclip size={16} /> Drop files or click to attach · PDF, DOCX, TXT, CSV, PNG, JPG (≤10 MB)
          <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { rec.addFiles([...e.target.files]); e.target.value = '' }} />
        </div>
      )}
      {rec.files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {rec.files.map((f) => (
            <span key={f.id} className="flex items-center gap-1.5 rounded-lg bg-gray-100 py-1 pl-2 pr-1 text-xs dark:bg-gray-900 dark:ring-1 dark:ring-gray-800">
              {/\.(png|jpe?g)$/i.test(f.name) ? <ImageIcon size={13} /> : <FileText size={13} />}
              <span className="max-w-[200px] truncate">{f.name}</span>
              <span className="text-gray-500">{kb(f.size)}</span>
              {!locked && <button className="rounded p-0.5 hover:bg-white/10" onClick={() => rec.removeFile(f.id)} title="Remove"><X size={12} /></button>}
            </span>
          ))}
        </div>
      )}
      {rec.fileErrors.length > 0 && <p className="mt-2 text-xs text-amber-400">{rec.fileErrors.join(' · ')}</p>}
      <p className="mt-2 text-[11px] text-gray-500">Files are used only to generate insights. They are never uploaded to storage — only filenames are saved.</p>
    </div>
  )
}

// ---------------------------------------------------------------- stepper
const STEPS = ['Record', 'Review & amend', 'Key insights', 'Approve & save']
const stepIndex = { idle: 0, recording: 0, review: 1, generating: 2, insights: 2, saving: 3, saved: 3 }
function Stepper({ stage }) {
  const cur = stepIndex[stage]
  return (
    <ol className="flex items-center justify-center gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${i < cur || stage === 'saved' ? 'text-emerald-400' : i === cur ? 'bg-white/10 text-gray-100' : 'text-gray-500'}`}>
            {i < cur || stage === 'saved' ? <CheckCircle2 size={13} /> : <span className="font-mono">{i + 1}</span>} {s}
          </span>
          {i < STEPS.length - 1 && <span className="h-px w-5 bg-gray-700" />}
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------- step 1: review & amend
function ReviewStep({ rec }) {
  const ta = useRef(null)
  const [confirm, setConfirm] = useState(false)
  const busy = rec.stage === 'generating'
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(280, el.scrollHeight) + 'px'
  }, [rec.transcript])
  const words = rec.transcript.trim() ? rec.transcript.trim().split(/\s+/).length : 0
  return (
    <div className={`${panel} flex flex-col`}>
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-800">
        <p className="text-sm font-medium">Review &amp; Amend Transcript</p>
        <span className="text-xs text-gray-500">{words} words · {fmt(rec.elapsed)}</span>
      </div>
      <div className="px-5 py-4">
        <p className="mb-3 text-xs text-gray-500">Fix misheard words or add anything that was missed. This exact text is what gets analysed and saved as the raw transcript.</p>
        <textarea
          ref={ta}
          value={rec.transcript}
          disabled={busy}
          onChange={(e) => rec.setTranscript(e.target.value)}
          placeholder="Nothing was transcribed — type or paste the meeting notes here."
          className="w-full resize-none rounded-xl bg-gray-50 p-4 text-[15px] leading-7 outline-none ring-1 ring-gray-200 focus:ring-gray-400 disabled:opacity-60 dark:bg-gray-900 dark:ring-gray-800 dark:focus:ring-gray-600"
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-800">
        {confirm ? (
          <span className="flex items-center gap-2 text-sm">
            Discard this session?
            <button className="btn bg-red-600 text-white hover:bg-red-500" onClick={rec.discard}>Discard</button>
            <button className="btn-ghost" onClick={() => setConfirm(false)}>Keep</button>
          </span>
        ) : (
          <button className="btn-danger" disabled={busy} onClick={() => setConfirm(true)}><Trash2 size={15} /> Discard Session</button>
        )}
        <button className="btn bg-[#EF4444] px-4 py-2 text-white hover:bg-[#DC2626]" disabled={busy || !rec.transcript.trim()} onClick={rec.generate}>
          {busy ? <><Loader2 size={15} className="animate-spin" /> Generating insights…</> : <><Sparkles size={15} /> Generate Key Insights</>}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- step 2/3: read-only insights drawer
function Card({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
      <h3 className="label mb-2">{title}</h3>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- category selector (takeaway → Expertise)
const FIELD_OPTS = [['knowledge', 'Knowledge'], ['decisionLogic', 'Decision logic'], ['guardrails', 'Guardrail'], ['escalation', 'Escalation']]
const FIELD_LABEL = Object.fromEntries(FIELD_OPTS)
const sel = 'min-w-0 rounded-lg bg-white px-2 py-1 text-xs outline-none ring-1 ring-gray-200 focus:ring-gray-400 dark:bg-gray-850 dark:ring-gray-800 dark:focus:ring-gray-600'

function Confidence({ value }) {
  if (value == null) return null
  const [label, cls] = value >= 0.8 ? ['High', 'bg-emerald-500/15 text-emerald-400'] : value >= 0.6 ? ['Medium', 'bg-amber-500/15 text-amber-400'] : ['Low', 'bg-gray-500/15 text-gray-400']
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`} title={`Category selector confidence ${Math.round(value * 100)}%`}>{label} · {Math.round(value * 100)}%</span>
}

function LinkRow({ link, rec, expertise, readOnly }) {
  const user = useStore((s) => s.user)
  const target = expertise.find((e) => e.id === link.expertiseId)
  const isNew = !link.expertiseId
  const set = (patch) => rec.updateLink(link.key, patch)
  // Same rule as chat capture: only contributors who are experts in the target domain may route to it.
  const block = contributeBlock(user, isNew ? link.newExpertise?.domain : target?.domain)
  const myDomains = TAXONOMY.filter((t) => user.domains?.includes(t.domain))

  if (readOnly)
    return (
      <div className="rounded-lg bg-white px-2.5 py-2 text-xs ring-1 ring-gray-200 dark:bg-gray-850 dark:ring-gray-800">
        <p className="flex flex-wrap items-center gap-1.5 text-gray-500">
          <BookOpen size={12} />
          {target ? <Link to={`/expertise/${target.id}`} className="font-medium text-gray-700 hover:underline dark:text-gray-200">{target.name}</Link>
            : <span className="font-medium text-gray-700 dark:text-gray-200">{link.newExpertise?.name || 'New Expertise'} <span className="font-normal text-gray-500">(new)</span></span>}
          · {FIELD_LABEL[link.field] || link.field}
          <Confidence value={link.confidence} />
        </p>
        <p className="mt-1 text-gray-600 dark:text-gray-300">{link.entry}</p>
      </div>
    )

  const domains = TAXONOMY.map((t) => ({ ...t, items: expertise.filter((e) => e.domain === t.domain) }))
    .filter((d) => d.items.length && (user.domains?.includes(d.domain) || d.domain === target?.domain))
  const topics = TAXONOMY.find((t) => t.domain === link.newExpertise?.domain)?.topics || []
  return (
    <div className={`space-y-2 rounded-lg bg-white p-2.5 ring-1 ring-gray-200 transition dark:bg-gray-850 dark:ring-gray-800 ${link.include && !block ? '' : 'opacity-50'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <input type="checkbox" className="accent-emerald-500" disabled={!!block} checked={link.include && !block} onChange={(e) => set({ include: e.target.checked })} title={block || 'Send to the Review Queue on approval'} />
        <select
          className={`${sel} max-w-[220px] flex-1`}
          value={isNew ? 'new' : link.expertiseId}
          onChange={(e) => {
            const v = e.target.value
            const home = myDomains[0] || TAXONOMY[0]
            if (v === 'new') set({ expertiseId: null, newExpertise: link.newExpertise || { name: '', domain: home.domain, topic: home.topics[0] } })
            else set({ expertiseId: v })
          }}
          aria-label="Target Expertise"
        >
          {domains.map((d) => (
            <optgroup key={d.domain} label={d.domain}>
              {d.items.map((e) => <option key={e.id} value={e.id}>{e.name}{e.status !== 'approved' ? ` (${e.status.replace('_', ' ')})` : ''}</option>)}
            </optgroup>
          ))}
          <option value="new">＋ New Expertise…</option>
        </select>
        <select className={sel} value={link.field} onChange={(e) => set({ field: e.target.value })} aria-label="Section">
          {FIELD_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <Confidence value={link.confidence} />
        <button className="ml-auto rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-red-400 dark:hover:bg-white/5" onClick={() => rec.removeLink(link.key)} title="Remove link"><X size={13} /></button>
      </div>
      {isNew && (
        <div className="flex flex-wrap gap-1.5">
          <input className={`${sel} flex-1`} placeholder="New Expertise name" value={link.newExpertise?.name || ''} onChange={(e) => set({ newExpertise: { ...link.newExpertise, name: e.target.value } })} />
          <select className={sel} value={link.newExpertise?.domain} onChange={(e) => set({ newExpertise: { ...link.newExpertise, domain: e.target.value, topic: TAXONOMY.find((t) => t.domain === e.target.value).topics[0] } })}>
            {[...new Set([...myDomains.map((t) => t.domain), link.newExpertise?.domain].filter(Boolean))].map((d) => <option key={d}>{d}</option>)}
          </select>
          <select className={sel} value={link.newExpertise?.topic} onChange={(e) => set({ newExpertise: { ...link.newExpertise, topic: e.target.value } })}>
            {[...new Set([...topics, link.newExpertise?.topic].filter(Boolean))].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      )}
      <textarea
        rows={2}
        value={link.entry}
        onChange={(e) => set({ entry: e.target.value })}
        className="w-full resize-y rounded-md bg-gray-50 px-2 py-1.5 text-xs leading-5 outline-none ring-1 ring-transparent focus:ring-gray-400 dark:bg-gray-900 dark:focus:ring-gray-600"
        aria-label="Line to add to the Expertise"
      />
      {link.rationale && <p className="text-[11px] text-gray-500">{link.rationale}</p>}
      {block && <p className="flex items-center gap-1 text-[11px] text-amber-500"><Lock size={11} /> {block}</p>}
    </div>
  )
}

function TakeawaysCard({ rec, readOnly }) {
  const expertise = useStore((s) => s.expertise).filter((e) => e.status !== 'deprecated')
  const ins = rec.insights
  const user = useStore((s) => s.user)
  const domainOf = (l) => (l.expertiseId ? expertise.find((e) => e.id === l.expertiseId)?.domain : l.newExpertise?.domain)
  const routed = rec.links.filter((l) => l.include && canContribute(user, domainOf(l))).length
  return (
    <Card title="Key takeaways & decisions">
      {ins.key_takeaways.length ? (
        <>
          <p className="mb-3 flex items-start gap-1.5 text-xs text-gray-500">
            <Route size={13} className="mt-px shrink-0" />
            {readOnly
              ? (rec.links.length ? `${rec.links.length} takeaway link${rec.links.length > 1 ? 's' : ''} routed to Expertise.` : 'No takeaways were routed to Expertise.')
              : 'The category selector paired reusable know-how with the Expertise it belongs to. Adjust the target or section, edit the line, and untick anything that shouldn\'t go to the Review Queue.'}
          </p>
          <ul className="space-y-3">
            {ins.key_takeaways.map((t, i) => {
              const ls = rec.links.filter((l) => l.takeawayIndex === i)
              return (
                <li key={i}>
                  <p className="flex gap-2 text-sm leading-6"><span className="text-gray-500">•</span><span>{t}</span></p>
                  {(ls.length > 0 || !readOnly) && (
                    <div className="mt-1.5 space-y-1.5 pl-4">
                      {ls.map((l) => <LinkRow key={l.key} link={l} rec={rec} expertise={expertise} readOnly={readOnly} />)}
                      {!readOnly && (
                        <button className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300" onClick={() => rec.addLink(i)}>
                          <Plus size={12} /> {ls.length ? 'Link to another Expertise' : 'Link to Expertise'}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {ins.category_error && !readOnly && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-400"><AlertTriangle size={13} /> Category selector unavailable ({ins.category_error}). You can still link takeaways manually.</p>
          )}
          {!readOnly && !isContributor(user) && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-500"><Lock size={12} /> {contributeBlock(user)} Sign in as a domain expert to send these links to the Review Queue.</p>
          )}
          {!readOnly && <p className="mt-3 text-[11px] text-gray-500">{routed} link{routed === 1 ? '' : 's'} will be sent to the Review Queue when you approve. Only links into your own expert domains ({(user.domains || []).join(', ') || 'none'}) can be sent. Live Expertise only changes after a Reviewer merges them.</p>}
        </>
      ) : <p className="text-sm text-gray-500">None identified.</p>}
    </Card>
  )
}

function InsightsDrawer({ rec }) {
  const [showClean, setShowClean] = useState(false)
  const expertise = useStore((s) => s.expertise)
  const open = ['insights', 'saving', 'saved'].includes(rec.stage) && rec.insights
  if (!open) return null
  const ins = rec.insights
  const saving = rec.stage === 'saving'
  const done = rec.stage === 'saved'
  const asText = [
    rec.title, '', 'SUMMARY', ins.summary, '', 'KEY TAKEAWAYS',
    ...ins.key_takeaways.flatMap((t, i) => [
      `- ${t}`,
      ...rec.links.filter((l) => l.takeawayIndex === i && l.include).map((l) =>
        `    → ${l.expertiseId ? (expertise.find((e) => e.id === l.expertiseId)?.name || l.expertiseId) : `${l.newExpertise?.name || 'New Expertise'} (new)`} · ${FIELD_LABEL[l.field] || l.field}`),
    ]), '',
    'ACTION ITEMS', ...ins.action_items.map((a) => `- ${a.task} (${a.owner}, ${a.due_date})`),
  ].join('\n')

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm animate-fadeIn">
      <aside className="flex h-full w-full max-w-xl flex-col border-l border-gray-800 bg-white dark:bg-gray-850">
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div>
            <p className="flex items-center gap-2 text-base font-semibold"><Sparkles size={16} className="text-red-400" /> Key Insights</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500"><Lock size={11} /> Read-only · model-derived audit output · {rec.title}</p>
          </div>
          {!done && <button className="icon-btn" disabled={saving} onClick={rec.backToEdit} title="Back to edit (discards insights)"><X size={18} /></button>}
        </header>

        <div className="flex-1 select-text space-y-3 overflow-y-auto px-5 py-4" aria-readonly="true">
          <Card title="Meeting summary">
            <div className="space-y-2 text-sm leading-6 text-gray-700 dark:text-gray-200">
              {ins.summary.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </Card>
          <TakeawaysCard rec={rec} readOnly={saving || done} />
          <Card title="Action items">
            {ins.action_items.length ? (
              <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-100 text-xs text-gray-500 dark:bg-gray-850">
                    <tr><th className="px-3 py-2 font-medium">Task</th><th className="px-3 py-2 font-medium">Owner</th><th className="px-3 py-2 font-medium">Due</th></tr>
                  </thead>
                  <tbody>
                    {ins.action_items.map((a, i) => (
                      <tr key={i} className="border-t border-gray-200 align-top dark:border-gray-800">
                        <td className="px-3 py-2">{a.task}</td><td className="px-3 py-2 text-gray-500">{a.owner}</td><td className="whitespace-nowrap px-3 py-2 text-gray-500">{a.due_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-gray-500">No action items identified.</p>}
          </Card>
          <Card title="Cleaned transcript">
            <button className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300" onClick={() => setShowClean(!showClean)}>
              <ChevronDown size={13} className={showClean ? 'rotate-180' : ''} /> {showClean ? 'Hide' : 'Show'} cleaned transcript
            </button>
            {showClean && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600 dark:text-gray-300">{ins.cleaned_transcript}</p>}
          </Card>
          {(rec.files.length > 0 || rec.saved?.attached_files?.length > 0) && (
            <p className="text-xs text-gray-500">Grounded on: {(rec.files.length ? rec.files.map((f) => f.name) : rec.saved.attached_files.map((f) => f.filename)).join(', ')}</p>
          )}
        </div>

        <footer className="space-y-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
          {rec.error && <p className="flex items-center gap-1.5 text-sm text-red-400"><AlertTriangle size={14} /> {rec.error}</p>}
          {done ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 size={16} /> Approved &amp; saved to database</p>
                <button className="btn-outline" onClick={rec.discard}>New meeting</button>
              </div>
              {rec.captured && (rec.captured.proposals + rec.captured.drafts > 0) && (
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Route size={13} />
                  {[rec.captured.proposals && `${rec.captured.proposals} Expertise revision${rec.captured.proposals > 1 ? 's' : ''}`,
                    rec.captured.drafts && `${rec.captured.drafts} new Expertise draft${rec.captured.drafts > 1 ? 's' : ''}`].filter(Boolean).join(' and ')} sent for review{rec.captured.skipped ? ` (${rec.captured.skipped} outside your domains skipped)` : ''} ·
                  <Link to="/expertise/review" className="text-accent-500 hover:underline">Open Review Queue →</Link>
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1">
                <button className="btn-ghost" disabled={saving} onClick={rec.backToEdit}><ArrowLeft size={15} /> Back to edit</button>
                <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(asText)}><Copy size={15} /> Copy</button>
              </div>
              <button className="btn bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500" disabled={saving} onClick={rec.approve}>
                {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><ShieldCheck size={15} /> Approve &amp; Save to Database</>}
              </button>
            </div>
          )}
          {!done && <p className="text-[11px] text-gray-500">Going back to edit discards these insights so the saved record always matches its transcript.</p>}
        </footer>
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------- recent (approved) meetings
function RecentMeetings({ rec }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (rec.stage !== 'idle' || !hasSupabase) return
    listMeetings(10).then(setRows).catch((e) => setErr(e.message))
  }, [rec.stage])
  if (rec.stage !== 'idle' || (!rows?.length && !err)) return null
  return (
    <div className={`${panel} px-5 py-4`}>
      <p className="mb-2 flex items-center gap-2 text-sm font-medium"><History size={15} className="text-gray-500" /> Recent meetings</p>
      {err && <p className="text-sm text-red-400">Couldn't load meetings: {err}</p>}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {(rows || []).map((m) => (
          <button key={m.id} className="group block w-full py-2 text-left" onClick={() => rec.load(m)}>
            <span className="block truncate text-sm font-medium group-hover:text-accent-500">{m.title}</span>
            <span className="block truncate text-xs text-gray-500">
              {new Date(m.created_at).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {fmt(m.duration || 0)} · {m.summary.slice(0, 90)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page
export default function MeetingRecorder() {
  const user = useStore((s) => s.user)
  const rec = useMeetingRecorder()
  const live = rec.stage === 'idle' || rec.stage === 'recording'

  useEffect(() => {
    if (rec.stage === 'idle' || rec.stage === 'saved') return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [rec.stage])

  return (
    <div className="flex h-full flex-col dark:bg-gray-900">
      <TopBar>
        {rec.stage !== 'idle' ? (
          <input
            value={rec.title}
            onChange={(e) => rec.setTitle(e.target.value)}
            disabled={rec.stage === 'saved'}
            className="w-full max-w-sm rounded-lg bg-transparent px-2 py-1 text-sm font-medium outline-none hover:bg-gray-100 focus:bg-gray-100 dark:hover:bg-gray-850 dark:focus:bg-gray-850"
            aria-label="Meeting title"
          />
        ) : <span className="px-2 text-sm font-medium">Meeting Recorder</span>}
      </TopBar>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pb-10 pt-6">
          <div className="flex items-center justify-center gap-3 animate-fadeIn">
            <Logo size={34} />
            <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">Ready to record your meeting, {user.name.split(' ')[0]}?</h1>
          </div>
          <Stepper stage={rec.stage} />

          {!hasSupabase && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local and restart the dev server — insights and saving need it.
            </div>
          )}

          {rec.restored && rec.stage === 'idle' && (
            <div className={`${panel} flex items-center justify-between gap-3 px-4 py-3 text-sm`}>
              <span className="flex items-center gap-2"><History size={15} className="text-gray-400" /> Unsaved draft found: <b className="font-medium">{rec.restored.title}</b></span>
              <span className="flex gap-1">
                <button className="btn-ghost" onClick={rec.dismissDraft}>Dismiss</button>
                <button className="btn-outline" onClick={rec.resumeDraft}>Resume review</button>
              </span>
            </div>
          )}

          <RecentMeetings rec={rec} />

          {live ? (
            <>
              <RecordControl rec={rec} />
              <AttachmentZone rec={rec} />
              <Transcript rec={rec} />
            </>
          ) : (
            <>
              <AttachmentZone rec={rec} />
              <ReviewStep rec={rec} />
              {rec.error && rec.stage === 'review' && (
                <p className="flex items-center gap-1.5 text-sm text-red-400"><AlertTriangle size={14} /> {rec.error}</p>
              )}
            </>
          )}
        </div>
      </div>
      <InsightsDrawer rec={rec} />
    </div>
  )
}
