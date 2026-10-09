import { useCallback, useEffect, useRef, useState } from 'react'

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

const ERRORS = {
  'not-allowed': 'Microphone access was blocked. Allow it from the address bar and try again.',
  'service-not-allowed': 'Speech recognition is disabled in this browser.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech service unreachable — check your connection.',
}

// Chrome only finalizes a phrase when it hears a pause. During long, unbroken speech the interim
// result keeps growing until the recognizer stalls (it keeps rewriting the same words and stops
// adding new ones until the speaker pauses). To avoid that we "rotate" the session — stop() makes
// Chrome finalize what it has, and onend restarts immediately — whenever an utterance runs long
// or its interim text stops changing.
const MAX_UTTERANCE_MS = 8_000  // force-finalize an unbroken utterance after this long
const STALL_MS = 1_500          // …or when the interim text hasn't changed for this long
const WATCH_MS = 500
const ROTATE_GRACE_MS = 1_500   // if stop() doesn't end the session in time, abort it

/**
 * Thin wrapper over the Web Speech API.
 * - continuous + interimResults; finalized phrases go to onFinal(text)
 * - Chrome ends a session after ~60s or a long silence; we auto-restart while listening
 * - long or stalled utterances are force-finalized (see above); interim text that never got
 *   finalized when a session ends is committed rather than dropped
 */
export function useSpeechRecognition({ onFinal, lang = 'en-SG' } = {}) {
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)
  const [listening, setListening] = useState(false)
  const recRef = useRef(null)
  const wantRef = useRef(false)          // should we be listening?
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  // current utterance bookkeeping (for stall detection and loss protection)
  const pendingRef = useRef('')          // latest interim text not yet finalized
  const utterStartRef = useRef(0)        // when the current interim utterance began
  const lastChangeRef = useRef(0)        // when the interim text last changed
  const rotatingRef = useRef(false)
  const rotateTimerRef = useRef(null)
  const watchRef = useRef(null)

  const commit = (text) => {
    const t = text.trim()
    if (t) onFinalRef.current?.(t)
  }

  const commitPending = () => {
    commit(pendingRef.current)
    pendingRef.current = ''
    utterStartRef.current = 0
    setInterim('')
  }

  const start = useCallback(() => {
    if (!SR) { setError('Live transcription needs Chrome or Edge (Web Speech API).'); return false }
    setError(null)

    const launch = (restart = false) => {
      const rec = new SR()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = lang

      rec.onresult = (e) => {
        let live = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          const text = r[0].transcript
          if (r.isFinal) commit(text)
          else live += text
        }
        const now = Date.now()
        if (live !== pendingRef.current) lastChangeRef.current = now
        if (live && !pendingRef.current) utterStartRef.current = now
        if (!live) utterStartRef.current = 0
        pendingRef.current = live
        setInterim(live)
      }
      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return // harmless, onend restarts
        setError(ERRORS[e.error] || `Speech recognition error: ${e.error}`)
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') wantRef.current = false
      }
      rec.onend = () => {
        if (recRef.current !== rec) return // a newer session already replaced this one
        rec.onresult = null                // an ended session must never deliver text again
        clearTimeout(rotateTimerRef.current)
        rotatingRef.current = false
        // Whatever Chrome didn't finalize before the session ended would otherwise be lost.
        commitPending()
        if (wantRef.current) launch(true)
        else { recRef.current = null; setListening(false) }
      }

      recRef.current = rec
      try {
        rec.start()
        return true
      } catch (err) {
        // InvalidStateError right after an end: retry shortly instead of going silent.
        if (restart && wantRef.current) setTimeout(() => wantRef.current && recRef.current === rec && launch(true), 250)
        else setError(err.message)
        return false
      }
    }

    wantRef.current = true
    pendingRef.current = ''
    utterStartRef.current = 0
    if (!launch()) { wantRef.current = false; return false }
    setListening(true)

    clearInterval(watchRef.current)
    watchRef.current = setInterval(() => {
      const rec = recRef.current
      if (!wantRef.current || !rec || rotatingRef.current || !pendingRef.current) return
      const now = Date.now()
      const tooLong = utterStartRef.current && now - utterStartRef.current > MAX_UTTERANCE_MS
      const stalled = now - lastChangeRef.current > STALL_MS
      if (!tooLong && !stalled) return
      rotatingRef.current = true
      try { rec.stop() } catch { /* already stopping */ }
      // Safety net: if Chrome hangs on stop(), abort and restart anyway (pending text is kept).
      rotateTimerRef.current = setTimeout(() => {
        if (recRef.current !== rec || !rotatingRef.current) return
        rotatingRef.current = false
        commitPending()
        recRef.current = null
        rec.onresult = null
        try { rec.abort() } catch { /* ignore */ }
        if (wantRef.current) launch(true)
      }, ROTATE_GRACE_MS)
    }, WATCH_MS)
    return true
  }, [lang])

  const stop = useCallback(() => {
    wantRef.current = false
    clearInterval(watchRef.current)
    // flushes any pending final result before onend (unless a rotation stop() is already doing so)
    if (!rotatingRef.current) recRef.current?.stop()
    setListening(false)
  }, [])

  useEffect(() => () => {
    wantRef.current = false
    clearInterval(watchRef.current)
    clearTimeout(rotateTimerRef.current)
    recRef.current?.abort()
  }, [])

  return { supported: !!SR, listening, interim, error, start, stop }
}
