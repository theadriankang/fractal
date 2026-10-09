// ---------------------------------------------------------------------------
// Backend client (FastAPI in /backend, proxied at /api by vite.config.js).
// Live models come from GET /api/models; unavailable models (and everything
// when VITE_USE_MOCK=true) keep using src/lib/mockApi.js.
// ---------------------------------------------------------------------------

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

// Filled from GET /api/models on first load. Unavailable models keep the
// existing mock fallback so the front end always works, even with no keys.
let _liveModels = new Set()
let _fetched = false

async function refreshLiveModels() {
  if (_fetched) return
  try {
    const res = await fetch('/api/models')
    if (res.ok) {
      const list = await res.json()
      _liveModels = new Set(list.filter((m) => m.available).map((m) => m.id))
    }
  } catch {
    // Backend offline — leave _liveModels empty; isLive returns false.
  }
  _fetched = true
}

// Kick off the fetch eagerly (fire-and-forget).
refreshLiveModels()

/** True when this model's answers come from the backend rather than the mock. */
export function isLive(modelId) {
  return !USE_MOCK && _liveModels.has(modelId)
}

/** Re-fetch the live model list from the backend (returns a promise). */
export { refreshLiveModels }

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
