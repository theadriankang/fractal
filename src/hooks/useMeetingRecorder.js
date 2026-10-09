import { useCallback, useEffect, useRef, useState } from 'react'
import { useSpeechRecognition } from './useSpeechRecognition'
import { useMicAnalyser } from './useMicAnalyser'
import { generateInsights, saveMeeting } from '../lib/meetingsService'
import { readAttachment, validateFile, MAX_FILES } from '../lib/readAttachment'
import { useStore } from '../store'
import { TAXONOMY } from '../data/taxonomy'
import { canContribute } from '../lib/permissions'

const uid = () => Math.random().toString(36).slice(2, 10)
const PARAGRAPH_GAP_MS = 4000
const MAX_BLOCK_CHARS = 450
const DRAFT_KEY = 'fractal-meeting-draft'
const AUTO_INCLUDE = 0.6 // category-selector confidence at or above which a link starts ticked

// Catalog sent to the category selector: everything except deprecated Expertise, trimmed to what routing needs.
const expertiseCatalog = () =>
  useStore.getState().expertise
    .filter((e) => e.status !== 'deprecated')
    .map(({ id, name, domain, topic, summary, whenToUse, keywords }) => ({ id, name, domain, topic, summary, whenToUse, keywords }))
const taxonomyPayload = () => TAXONOMY.map(({ domain, topics }) => ({ domain, topics }))

// Server shape (snake_case) → editable client link
const toLink = (l) => ({
  key: uid(),
  takeawayIndex: l.takeaway_index,
  expertiseId: l.expertise_id || null,
  newExpertise: l.new_expertise || null,
  field: l.field || 'knowledge',
  entry: l.entry || '',
  confidence: typeof l.confidence === 'number' ? l.confidence : null,
  rationale: l.rationale || '',
  include: (l.confidence ?? 1) >= AUTO_INCLUDE,
  manual: false,
})

export const joinBlocks = (blocks) => blocks.map((b) => b.text.trim()).filter(Boolean).join('\n\n')
export const defaultTitle = (d = new Date()) =>
  `Meeting - ${d.toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`

const loadDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) } catch { return null } }
const saveDraft = (d) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* private mode */ } }
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ } }

/**
 * Stages: idle → recording → review → generating → insights → saved
 *  - recording: live, click-to-edit blocks
 *  - review:    Step 1 — one editable textarea (user-amended transcript)
 *  - insights:  Step 2 — read-only Claude output; "Back to edit" discards it
 *  - saved:     Step 3 — written to Supabase on approval (the only DB write)
 * A local draft (browser cache) protects against refresh/crash; it is cleared on save or discard.
 * Attached files live in memory only and are discarded after insights are generated/saved.
 */
export function useMeetingRecorder() {
  const [stage, setStage] = useState('idle')
  const [blocks, setBlocks] = useState([])
  const [transcript, setTranscript] = useState('')      // review-stage text
  const [title, setTitle] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [editingId, setEditingId] = useState(null)
  const [files, setFiles] = useState([])                // [{ id, file, name, size }]
  const [fileErrors, setFileErrors] = useState([])
  const [insights, setInsights] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [links, setLinks] = useState([])                // category selector: takeaway → Expertise
  const [captured, setCaptured] = useState(null)        // { proposals, drafts } sent to the Review Queue
  const [restored, setRestored] = useState(null)        // draft found on load

  const editingRef = useRef(null)
  editingRef.current = editingId
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const lastFinalAt = useRef(0)
  const startedAt = useRef(0)

  // ---------- live transcription ----------
  const onFinal = useCallback((text) => {
    if (!text) return
    const t = Date.now()
    const gap = t - lastFinalAt.current > PARAGRAPH_GAP_MS
    lastFinalAt.current = t
    setBlocks((prev) => {
      const last = prev.at(-1)
      if (last && !gap && last.id !== editingRef.current && last.text.length < MAX_BLOCK_CHARS)
        return [...prev.slice(0, -1), { ...last, text: `${last.text} ${text}` }]
      return [...prev, { id: uid(), text: text.charAt(0).toUpperCase() + text.slice(1), at: Math.round((t - startedAt.current) / 1000) }]
    })
  }, [])
  const speech = useSpeechRecognition({ onFinal })
  const mic = useMicAnalyser()

  useEffect(() => {
    if (stage !== 'recording') return
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 250)
    return () => clearInterval(id)
  }, [stage])

  // ---------- local draft cache ----------
  useEffect(() => {
    const d = loadDraft()
    if (d?.transcript?.trim()) setRestored(d)
  }, [])
  useEffect(() => {
    if (stage === 'idle' || stage === 'saved') return
    const id = setTimeout(() => saveDraft({
      title, elapsed, savedAt: Date.now(),
      transcript: stage === 'recording' ? joinBlocks(blocks) : transcript,
    }), 500)
    return () => clearTimeout(id)
  }, [stage, blocks, transcript, title, elapsed])

  const resumeDraft = useCallback(() => {
    if (!restored) return
    setTitle(restored.title || defaultTitle()); setTranscript(restored.transcript)
    setElapsed(restored.elapsed || 0); setStage('review'); setRestored(null)
  }, [restored])
  const dismissDraft = useCallback(() => { clearDraft(); setRestored(null) }, [])

  // ---------- attachments ----------
  const addFiles = useCallback((list) => {
    const errs = []
    setFiles((cur) => {
      const next = [...cur]
      for (const f of list) {
        const err = validateFile(f)
        if (err) { errs.push(err); continue }
        if (next.length >= MAX_FILES) { errs.push(`Max ${MAX_FILES} files per meeting`); break }
        if (next.some((x) => x.name === f.name && x.size === f.size)) continue
        next.push({ id: uid(), file: f, name: f.name, size: f.size })
      }
      return next
    })
    setFileErrors(errs)
  }, [])
  const removeFile = useCallback((id) => setFiles((f) => f.filter((x) => x.id !== id)), [])

  // ---------- controls ----------
  const start = useCallback(async () => {
    setError(null)
    if (!(await mic.open())) return
    if (!speech.start()) { mic.close(); return }
    setTitle(defaultTitle()); setBlocks([]); setElapsed(0); setEditingId(null); setInsights(null); setSaved(null)
    startedAt.current = lastFinalAt.current = Date.now()
    setRestored(null)
    setStage('recording')
  }, [mic, speech])

  const stop = useCallback(() => {
    speech.stop(); mic.close()
    setElapsed(Math.floor((Date.now() - startedAt.current) / 1000))
    setEditingId(null)
    // give the recognizer a moment to flush its final phrase, then open Step 1
    setTimeout(() => {
      setTranscript(joinBlocks(blocksRef.current))
      setStage('review')
    }, 500)
  }, [speech, mic])

  const updateBlock = useCallback((id, text) => {
    setBlocks((prev) => (text.trim() ? prev.map((b) => (b.id === id ? { ...b, text } : b)) : prev.filter((b) => b.id !== id)))
  }, [])

  const discard = useCallback(() => {
    speech.stop(); mic.close(); clearDraft()
    setStage('idle'); setBlocks([]); setTranscript(''); setTitle(''); setElapsed(0)
    setFiles([]); setFileErrors([]); setInsights(null); setError(null); setSaved(null); setLinks([]); setCaptured(null)
  }, [speech, mic])

  const generate = useCallback(async () => {
    if (!transcript.trim()) { setError('The transcript is empty.'); return }
    setError(null); setStage('generating')
    try {
      const parsed = await Promise.all(files.map((f) => readAttachment(f.file)))
      const result = await generateInsights({ transcript, files: parsed, expertise: expertiseCatalog(), taxonomy: taxonomyPayload() })
      // Links start ticked only when confident AND inside the user's own expert domains.
      const { user, expertise } = useStore.getState()
      const domainOf = (l) => (l.expertiseId ? expertise.find((e) => e.id === l.expertiseId)?.domain : l.newExpertise?.domain)
      const links = (result.expertise_links || []).map(toLink).map((l) => ({ ...l, include: l.include && canContribute(user, domainOf(l)) }))
      setInsights(result); setLinks(links); setCaptured(null); setStage('insights')
    } catch (e) {
      setError(e.message); setStage('review')
    }
  }, [transcript, files])

  // reopen an approved meeting (Recent meetings) — read-only, shown in the insights drawer
  const load = useCallback((row) => {
    setTitle(row.title); setTranscript(row.raw_transcript); setElapsed(row.duration || 0)
    setFiles([]); setFileErrors([]); setError(null); setSaved(row)
    setInsights({ cleaned_transcript: row.cleaned_transcript, summary: row.summary, key_takeaways: row.key_takeaways, action_items: row.action_items })
    setLinks((row.expertise_links || []).map((l) => ({ ...toLink(l), include: true })))
    setCaptured(null)
    setStage('saved')
  }, [])

  const backToEdit = useCallback(() => { setInsights(null); setLinks([]); setStage('review') }, [])

  // ---------- category selector (human override) ----------
  const updateLink = useCallback((key, patch) => setLinks((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))), [])
  const removeLink = useCallback((key) => setLinks((ls) => ls.filter((l) => l.key !== key)), [])
  const addLink = useCallback((takeawayIndex) => {
    const text = insights?.key_takeaways?.[takeawayIndex] || ''
    setLinks((ls) => [...ls, {
      key: uid(), takeawayIndex, expertiseId: null, field: 'knowledge', entry: text, confidence: null,
      rationale: 'Added manually', include: true, manual: true,
      newExpertise: (() => {
        const home = TAXONOMY.find((t) => useStore.getState().user.domains?.includes(t.domain)) || TAXONOMY[0]
        return { name: '', domain: home.domain, topic: home.topics[0] }
      })(),
    }])
  }, [insights])

  const approve = useCallback(async () => {
    if (!insights) return
    setError(null); setStage('saving')
    const nameOf = (id) => useStore.getState().expertise.find((e) => e.id === id)?.name || ''
    const { user, expertise } = useStore.getState()
    const domainOf = (l) => (l.expertiseId ? expertise.find((e) => e.id === l.expertiseId)?.domain : l.newExpertise?.domain)
    const accepted = links.filter((l) => l.include && canContribute(user, domainOf(l)) && l.entry.trim() && (l.expertiseId || l.newExpertise?.name?.trim()))
      .map((l) => ({ ...l, entry: l.entry.trim() }))
    try {
      const row = await saveMeeting({
        title: title || defaultTitle(),
        raw_transcript: transcript,
        cleaned_transcript: insights.cleaned_transcript,
        attached_files: files.map((f) => ({ filename: f.name })),
        summary: insights.summary,
        key_takeaways: insights.key_takeaways,
        action_items: insights.action_items,
        expertise_links: accepted.map((l) => ({
          takeaway_index: l.takeawayIndex,
          expertise_id: l.expertiseId,
          expertise_name: l.expertiseId ? nameOf(l.expertiseId) : l.newExpertise?.name || '',
          field: l.field,
          entry: l.entry,
          confidence: l.confidence,
        })),
        duration: elapsed,
      })
      // Only after the meeting is safely stored: send the accepted know-how to the Review Queue.
      const result = useStore.getState().captureMeetingInsights({
        meetingId: row.id,
        title: row.title,
        links: accepted.map((l) => ({ ...l, takeaway: insights.key_takeaways[l.takeawayIndex] || '' })),
      })
      setCaptured(result)
      clearDraft(); setFiles([]); setSaved(row); setStage('saved')
    } catch (e) {
      setError(e.message); setStage('insights')
    }
  }, [insights, links, title, transcript, files, elapsed])

  return {
    stage, blocks, transcript, setTranscript, title, setTitle, elapsed, editingId, setEditingId,
    files, fileErrors, addFiles, removeFile,
    insights, saved, restored, resumeDraft, dismissDraft,
    links, updateLink, removeLink, addLink, captured,
    interim: speech.interim,
    error: error || mic.error || speech.error,
    supported: speech.supported,
    analyser: mic.analyser,
    start, stop, discard, generate, backToEdit, approve, updateBlock, load,
  }
}
