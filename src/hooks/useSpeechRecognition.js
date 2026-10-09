import { useCallback, useEffect, useRef, useState } from 'react'

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

const ERRORS = {
  'not-allowed': 'Microphone access was blocked. Allow it from the address bar and try again.',
  'service-not-allowed': 'Speech recognition is disabled in this browser.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech service unreachable — check your connection.',
}

/**
 * Thin wrapper over the Web Speech API.
 * - continuous + interimResults; finalized phrases go to onFinal(text)
 * - Chrome ends a session after ~60s or a long silence; we auto-restart while `listening`
 */
export function useSpeechRecognition({ onFinal, lang = 'en-SG' } = {}) {
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)
  const [listening, setListening] = useState(false)
  const recRef = useRef(null)
  const wantRef = useRef(false)          // should we be listening?
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  const start = useCallback(() => {
    if (!SR) { setError('Live transcription needs Chrome or Edge (Web Speech API).'); return false }
    setError(null)
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = lang

    rec.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const text = r[0].transcript
        if (r.isFinal) onFinalRef.current?.(text.trim())
        else live += text
      }
      setInterim(live)
    }
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return // harmless, onend restarts
      setError(ERRORS[e.error] || `Speech recognition error: ${e.error}`)
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') wantRef.current = false
    }
    rec.onend = () => {
      setInterim('')
      if (wantRef.current) {
        try { rec.start() } catch { /* already started */ }
      } else setListening(false)
    }

    recRef.current = rec
    wantRef.current = true
    try { rec.start(); setListening(true); return true }
    catch (err) { setError(err.message); wantRef.current = false; return false }
  }, [lang])

  const stop = useCallback(() => {
    wantRef.current = false
    recRef.current?.stop()        // flushes any pending final result before onend
    setListening(false)
  }, [])

  useEffect(() => () => { wantRef.current = false; recRef.current?.abort() }, [])

  return { supported: !!SR, listening, interim, error, start, stop }
}
