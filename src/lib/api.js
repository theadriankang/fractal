// ---------------------------------------------------------------------------
// Backend client (FastAPI in /backend, proxied at /api by vite.config.js).
// Only Claude models are served by the backend so far; every other model, and
// everything when VITE_USE_MOCK=true, keeps using src/lib/mockApi.js.
// ---------------------------------------------------------------------------

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const BACKEND_MODELS = new Set(['claude-opus', 'claude-sonnet', 'claude-haiku'])

/** True when this model's answers come from the backend rather than the mock. */
export const isLive = (modelId) => !USE_MOCK && BACKEND_MODELS.has(modelId)

/**
 * Know-how capture: POST /api/expertise/extract (see src/lib/capture.js for the request/response).
 * Resolves to a Detection; rejects when the backend is offline or errors, so callers can fall back.
 */
export async function extractKnowhow(body, { timeoutMs = 20000 } = {}) {
  if (USE_MOCK) throw new Error('Mock mode')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch('/api/expertise/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `Backend error (${res.status}).`)
    return { ...data, source: 'ai' }
  } finally {
    clearTimeout(timer)
  }
}

// The Expertise fields the backend's system prompt uses.
const EXPERTISE_FIELDS = ['id', 'name', 'version', 'status', 'owner', 'whenToUse', 'knowledge', 'decisionLogic', 'guardrails', 'escalation']
const pickExpertise = (e) => Object.fromEntries(EXPERTISE_FIELDS.map((f) => [f, e[f]]))

/**
 * Streams one model's answer from POST /api/chat/stream (Server-Sent Events).
 * handlers: onMeta({expertise}), onDelta(text), onDone({stopReason, model}), onError(message).
 * Returns an abort function; aborting fires no handler.
 */
export function streamChat({ model, messages, expertise = [] }, { onMeta, onDelta, onDone, onError }) {
  const ctrl = new AbortController()

  ;(async () => {
    let finished = false
    const dispatch = (event, data) => {
      if (event === 'meta') onMeta?.(data)
      else if (event === 'delta') onDelta?.(data.text)
      else if (event === 'done') (finished = true), onDone?.(data)
      else if (event === 'error') (finished = true), onError?.(data.message)
    }

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, expertise: expertise.map(pickExpertise) }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(typeof body?.detail === 'string' ? body.detail : `Backend error (${res.status}).`)
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        let cut
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, cut)
          buf = buf.slice(cut + 2)
          let event = 'message'
          let data = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7)
            else if (line.startsWith('data: ')) data += line.slice(6)
          }
          if (data) dispatch(event, JSON.parse(data))
        }
      }
      if (!finished) onError?.('The connection to the backend closed before the answer finished.')
    } catch (err) {
      if (err.name === 'AbortError') return
      // fetch() rejects with a TypeError when nothing is listening on /api.
      onError?.(err instanceof TypeError ? 'Backend offline. Start it (see backend/README.md) or set VITE_USE_MOCK=true for demo mode.' : err.message)
    }
  })()

  return () => ctrl.abort()
}
