import { useCallback, useEffect, useRef, useState } from 'react'
import { useSpeechRecognition } from './useSpeechRecognition'
import { useMicAnalyser } from './useMicAnalyser'
import { createMeeting, updateMeeting } from '../lib/meetingsService'

const uid = () => Math.random().toString(36).slice(2, 10)
const PARAGRAPH_GAP_MS = 4000   // silence longer than this starts a new block
const MAX_BLOCK_CHARS = 450
const AUTOSAVE_MS = 1000

export const joinBlocks = (blocks) => blocks.map((b) => b.text.trim()).filter(Boolean).join('\n\n')
const defaultTitle = () =>
  `Meeting · ${new Date().toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`

/**
 * State machine: idle → recording → done
 * - blocks: [{ id, text, at }] — finalized paragraphs, each editable inline
 * - interim: live (not yet final) words
 * - editingId: block currently open in the editor; new speech never appends into it
 * - autosaves to Supabase (debounced) on any edit, and flushes on stop
 */
export function useMeetingRecorder() {
  const [status, setStatus] = useState('idle')
  const [blocks, setBlocks] = useState([])
  const [title, setTitle] = useState('')
  const [elapsed, setElapsed] = useState(0)          // seconds
  const [editingId, setEditingId] = useState(null)
  const [meeting, setMeeting] = useState(null)       // persisted row
  const [save, setSave] = useState({ state: 'idle', at: null, error: null })

  const editingRef = useRef(null)
  const lastFinalAt = useRef(0)
  const startedAt = useRef(0)
  const meetingPromise = useRef(null)
  editingRef.current = editingId
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  // ---------- transcription ----------
  const onFinal = useCallback((text) => {
    if (!text) return
    const t = Date.now()
    const gap = t - lastFinalAt.current > PARAGRAPH_GAP_MS
    lastFinalAt.current = t
    setBlocks((prev) => {
      const last = prev.at(-1)
      const canAppend = last && !gap && last.id !== editingRef.current && last.text.length < MAX_BLOCK_CHARS
      if (canAppend) return [...prev.slice(0, -1), { ...last, text: `${last.text} ${text}` }]
      return [...prev, { id: uid(), text: cap(text), at: Math.round((t - startedAt.current) / 1000) }]
    })
  }, [])

  const speech = useSpeechRecognition({ onFinal })
  const mic = useMicAnalyser()

  // ---------- timer ----------
  useEffect(() => {
    if (status !== 'recording') return
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 250)
    return () => clearInterval(id)
  }, [status])

  // ---------- persistence ----------
  const persist = useCallback(async (patch) => {
    const row = meeting || (await meetingPromise.current)
    if (!row) return
    setSave((s) => ({ ...s, state: 'saving', error: null }))
    try {
      await updateMeeting(row.id, patch)
      setSave({ state: 'saved', at: new Date(), error: null })
    } catch (e) {
      setSave({ state: 'error', at: null, error: e.message })
    }
  }, [meeting])

  // debounced autosave on edits / new speech / title change
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    if (status === 'idle') return
    const id = setTimeout(() => persist({ title: title || defaultTitle(), transcript_text: joinBlocks(blocks), duration: elapsed }), AUTOSAVE_MS)
    return () => clearTimeout(id)
    // elapsed intentionally excluded: we don't want a save every second
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, title, status, persist])

  // ---------- controls ----------
  const start = useCallback(async () => {
    const ok = await mic.open()            // permission prompt happens here
    if (!ok) return
    if (!speech.start()) { mic.close(); return }
    const t = title || defaultTitle()
    setTitle(t)
    setBlocks([]); setElapsed(0); setEditingId(null); setMeeting(null)
    startedAt.current = lastFinalAt.current = Date.now()
    setStatus('recording')
    setSave({ state: 'saving', at: null, error: null })
    meetingPromise.current = createMeeting({ title: t })
      .then((row) => { setMeeting(row); setSave({ state: 'saved', at: new Date(), error: null }); return row })
      .catch((e) => { setSave({ state: 'error', at: null, error: e.message }); return null })
  }, [mic, speech, title])

  const stop = useCallback(() => {
    speech.stop()
    mic.close()
    const duration = Math.floor((Date.now() - startedAt.current) / 1000)
    setElapsed(duration)
    setStatus('done')
    // let the recognizer flush its last final result, then save
    setTimeout(() => persist({ transcript_text: joinBlocks(blocksRef.current), duration }), 600)
  }, [speech, mic, persist])

  const updateBlock = useCallback((id, text) => {
    setBlocks((prev) => (text.trim() ? prev.map((b) => (b.id === id ? { ...b, text } : b)) : prev.filter((b) => b.id !== id)))
  }, [])

  const replaceTranscript = useCallback((text) => {
    setBlocks(text.split(/\n{2,}/).filter((p) => p.trim()).map((p) => ({ id: uid(), text: p.trim(), at: null })))
  }, [])

  const reset = useCallback(() => {
    setStatus('idle'); setBlocks([]); setTitle(''); setElapsed(0); setMeeting(null); setEditingId(null)
    setSave({ state: 'idle', at: null, error: null })
  }, [])

  return {
    status, blocks, title, setTitle, elapsed, editingId, setEditingId,
    interim: speech.interim,
    error: mic.error || speech.error,
    supported: speech.supported,
    analyser: mic.analyser,
    meeting, save,
    start, stop, reset, updateBlock, replaceTranscript,
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
