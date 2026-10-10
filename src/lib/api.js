// ---------------------------------------------------------------------------
// Backend client (FastAPI in /backend, proxied at /api by vite.config.js).
// Live models come from GET /api/models; unavailable models (and everything
// when VITE_USE_MOCK=true) keep using src/lib/mockApi.js.
// ---------------------------------------------------------------------------

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

// Filled from GET /api/models on first load. Unavailable models keep the
// existing mock fallback so the front end always works, even with no keys.
let _liveModels = new Set()
let _modelAvailability = {} // { id: { available, provider } }
let _fetched = false
let _backendOnline = false
let _retryTimer = null
let _lastRetry = 0
const _RETRY_MS = 10_000

async function refreshLiveModels() {
  if (_fetched) return
  try {
    const res = await fetch('/api/models')
    if (res.ok) {
      const list = await res.json()
      _modelAvailability = Object.fromEntries(list.map((m) => [m.id, m]))
      _liveModels = new Set(list.filter((m) => m.available).map((m) => m.id))
      _fetched = true
      _backendOnline = true
    }
  } catch {
    // Backend offline — leave _liveModels empty; isLive returns false.
  }
}

// Kick off the fetch eagerly (fire-and-forget).
refreshLiveModels()

/** True when this model's answers come from the backend rather than the mock. */
export function isLive(modelId) {
  if (USE_MOCK) return false
  if (!_fetched) {
    // Throttle retries so a late-starting backend eventually serves real models.
    const now = Date.now()
    if (now - _lastRetry >= _RETRY_MS) {
      _lastRetry = now
      clearTimeout(_retryTimer)
      _retryTimer = setTimeout(() => { refreshLiveModels() }, 0)
    }
  }
  return _liveModels.has(modelId)
}

/** True when the backend responded to /api/models at least once. */
export function backendOnline() {
  return _backendOnline
}

/**
 * Full availability map from GET /api/models.
 * Returns { id: { available, provider } } or null when the backend hasn't
 * responded yet (so callers can distinguish "still loading" / "offline"
 * from "responded — here's the truth").
 */
export function getModelAvailability() {
  return _fetched ? _modelAvailability : null
}

/** Re-fetch the live model list from the backend (returns a promise). */
export { refreshLiveModels }

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

// Chat attachments. Limits match backend/app/files.py.
export const FILE_ACCEPT = '.pdf,.docx,.txt,.md,.csv,.png,.jpg,.jpeg'
export const MAX_FILES = 5
export const MAX_FILE_BYTES = 10 * 1024 * 1024

/** Returns an error message for a file the backend would reject, or null. */
export function checkFile(file) {
  const ext = '.' + file.name.toLowerCase().split('.').pop()
  if (!FILE_ACCEPT.split(',').includes(ext)) return 'Unsupported type'
  if (file.size > MAX_FILE_BYTES) return 'Larger than 10 MB'
  if (!file.size) return 'Empty file'
  return null
}

/** POST /api/files: stores one attachment. Resolves to {id, name, size, kind, mediaType, chars, pages}. */
export async function uploadFile(file) {
  const body = new FormData()
  body.append('file', file)
  let res
  try {
    res = await fetch('/api/files', { method: 'POST', body })
  } catch {
    throw new Error('Backend offline')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `Upload failed (${res.status})`)
  return data
}

/**
 * POST /api/expertise/match — semantic retrieval of approved Expertise.
 * Returns [{id, name, version, score, reason}] or null if the backend is offline.
 */
export async function matchExpertiseBackend(query, attachedIds = [], limit = 3) {
  if (USE_MOCK) return null
  try {
    const res = await fetch('/api/expertise/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, attachedIds, limit }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
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
export function streamChat({ model, messages, expertise = [], routing }, { onMeta, onDelta, onDone, onError }) {
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
        body: JSON.stringify({ model, messages, expertise: expertise.map(pickExpertise), routing }),
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

// ---------------------------------------------------------------------------
// Library, Review Queue and Chats — stored in Supabase through the backend.
// Until Supabase Auth (BUILD_PROMPTS Prompt 8) the demo account is sent as X-User-Email;
// backend/seed.py creates a matching profile for every account in src/data/users.js.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status // 0 = backend unreachable
  }
}

async function request(user, method, path, body) {
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user?.email ? { 'X-User-Email': user.email } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Backend offline.', 0)
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  // Vite's proxy answers with a non-JSON 5xx when nothing listens on /api.
  if (!res.ok) throw new ApiError(typeof data?.detail === 'string' ? data.detail : `Backend error (${res.status}).`, data ? res.status : 0)
  return data
}

// Fields an edit may change; status, version, feedback and usage change only through the actions below.
const EDITABLE = ['name', 'domain', 'topic', 'assetTypes', 'related', 'owner', 'ownerRole', 'keywords', 'summary', 'whenToUse',
  'knowledge', 'decisionLogic', 'guardrails', 'escalation', 'sources', 'origin']
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
const enc = encodeURIComponent

const toApiMessage = (m) => ({
  ...pick(m, ['role', 'files', 'attachedExpertise', 'webSearch', 'detection', 'detectionState', 'detectionResult', 'createdAt']),
  content: m.content || '',
  detectionMissing: m.detectionMissing || [],
  responses: (m.responses || []).map((r) => ({
    id: r.id, modelId: r.modelId, auto: r.auto, expertiseUsed: r.expertise || [], content: r.content || '', rating: r.rating,
  })),
})

const fromApiMessage = ({ responses, ...m }) =>
  m.role === 'user'
    ? m
    : { ...m, responses: responses.map(({ expertiseUsed, ...r }) => ({ ...r, expertise: expertiseUsed, streaming: false })) }

/** A chat from the API in the store's shape; `ownerId` is the signed-in demo account. */
export const fromApiChat = (c, ownerId) => ({ ...c, ownerId, messages: c.messages.map(fromApiMessage) })

/** Endpoint wrappers acting as `user` (bound when a write is queued, so it keeps its author). */
export function apiFor(user) {
  const call = (method, path, body) => request(user, method, path, body)
  return {
    listChats: () => call('GET', '/chats'),
    getChat: (id) => call('GET', `/chats/${enc(id)}`),
    saveChat: (c) => call('PUT', `/chats/${enc(c.id)}`, { title: c.title, folder: c.folder ?? null, pinned: !!c.pinned }),
    deleteChat: (id) => call('DELETE', `/chats/${enc(id)}`).catch((e) => { if (e.status !== 404) throw e }),
    saveMessage: (chatId, m) => call('PUT', `/chats/${enc(chatId)}/messages/${enc(m.id)}`, toApiMessage(m)),
    rateResponse: (id, body) => call('POST', `/responses/${enc(id)}/rating`, body),

    listExpertise: () => call('GET', '/expertise'),
    createExpertise: (e) => call('POST', '/expertise', e),
    updateExpertise: (id, patch) => call('PATCH', `/expertise/${enc(id)}`, pick(patch, EDITABLE)),
    deleteExpertise: (id) => call('DELETE', `/expertise/${enc(id)}`),
    recordUsage: (ids) => call('POST', '/expertise/usage', { ids }),
    // action: submit | approve | reject | deprecate | restore | rollback
    expertiseAction: (id, action, body) => call('POST', `/expertise/${enc(id)}/${action}`, body),

    listProposals: () => call('GET', '/proposals'),
    createProposal: (p) => call('POST', '/proposals', p),
    // action: approve (returns the updated Expertise) | reject
    proposalAction: (id, action) => call('POST', `/proposals/${enc(id)}/${action}`),
  }
}
