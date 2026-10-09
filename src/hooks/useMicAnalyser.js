import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Opens the mic (triggers the permission prompt) and exposes an AnalyserNode
 * for the live waveform. Kept separate from speech recognition so the visualizer
 * works even while SpeechRecognition is restarting between sessions.
 */
export function useMicAnalyser() {
  const [analyser, setAnalyser] = useState(null)
  const [error, setError] = useState(null)
  const ctxRef = useRef(null)
  const streamRef = useRef(null)

  const open = useCallback(async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) { setError('This browser cannot access the microphone.'); return false }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const node = ctx.createAnalyser()
      node.fftSize = 256
      node.smoothingTimeConstant = 0.75
      ctx.createMediaStreamSource(stream).connect(node)
      streamRef.current = stream
      ctxRef.current = ctx
      setAnalyser(node)
      return true
    } catch (e) {
      setError(
        e.name === 'NotAllowedError' ? 'Microphone permission denied. Click the mic icon in the address bar to allow it.'
          : e.name === 'NotFoundError' ? 'No microphone detected.'
            : e.message,
      )
      return false
    }
  }, [])

  const close = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    ctxRef.current?.close().catch(() => {})
    streamRef.current = ctxRef.current = null
    setAnalyser(null)
  }, [])

  useEffect(() => close, [close])
  return { analyser, error, open, close }
}
