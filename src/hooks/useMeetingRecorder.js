import { useCallback, useEffect, useRef, useState } from 'react'
import { useSpeechRecognition } from './useSpeechRecognition'
import { useMicAnalyser } from './useMicAnalyser'
import { generateInsights, saveMeeting } from '../lib/meetingsService'
import { readAttachment, validateFile, MAX_FILES } from '../lib/readAttachment'

const uid = () => Math.random().toString(36).slice(2, 10)
const PARAGRAPH_GAP_MS = 4000
const MAX_BLOCK_CHARS = 450
const DRAFT_KEY = 'fractal-meeting-draft'

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
    setFiles([]); setFileErrors([]); setInsights(null); setError(null); setSaved(null)
  }, [speech, mic])

  const generate = useCallback(async () => {
    if (!transcript.trim()) { setError('The transcript is empty.'); return }
    setError(null); setStage('generating')
    try {
      const parsed = await Promise.all(files.map((f) => readAttachment(f.file)))
      const result = await generateInsights({ transcript, files: parsed })
      setInsights(result); setStage('insights')
    } catch (e) {
      setError(e.message); setStage('review')
    }
  }, [transcript, files])

  // reopen an approved meeting (Recent meetings) — read-only, shown in the insights drawer
  const load = useCallback((row) => {
    setTitle(row.title); setTranscript(row.raw_transcript); setElapsed(row.duration || 0)
    setFiles([]); setFileErrors([]); setError(null); setSaved(row)
    setInsights({ cleaned_transcript: row.cleaned_transcript, summary: row.summary, key_takeaways: row.key_takeaways, action_items: row.action_items })
    setStage('saved')
  }, [])

  const backToEdit = useCallback(() => { setInsights(null); setStage('review') }, [])

  const approve = useCallback(async () => {
    if (!insights) return
    setError(null); setStage('saving')
    try {
      const row = await saveMeeting({
        title: title || defaultTitle(),
        raw_transcript: transcript,
        cleaned_transcript: insights.cleaned_transcript,
        attached_files: files.map((f) => ({ filename: f.name })),
        summary: insights.summary,
        key_takeaways: insights.key_takeaways,
        action_items: insights.action_items,
        duration: elapsed,
      })
      clearDraft(); setFiles([]); setSaved(row); setStage('saved')
    } catch (e) {
      setError(e.message); setStage('insights')
    }
  }, [insights, title, transcript, files, elapsed])

  return {
    stage, blocks, transcript, setTranscript, title, setTitle, elapsed, editingId, setEditingId,
    files, fileErrors, addFiles, removeFile,
    insights, saved, restored, resumeDraft, dismissDraft,
    interim: speech.interim,
    error: error || mic.error || speech.error,
    supported: speech.supported,
    analyser: mic.analyser,
    start, stop, discard, generate, backToEdit, approve, updateBlock, load,
  }
}
