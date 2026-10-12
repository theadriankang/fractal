// Provider + model catalogue.
// Placeholder list for the front-end prototype — edit freely when the backend
// exposes the real model list (e.g. GET /api/models).

import { USE_MOCK } from '../lib/api'

export const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', color: '#d97757', initial: 'A' },
  { id: 'openai', name: 'OpenAI', color: '#10a37f', initial: 'O' },
  { id: 'google', name: 'Google', color: '#4285f4', initial: 'G' },
  { id: 'xai', name: 'xAI', color: '#e5e5e5', initial: 'x' },
  { id: 'tencent', name: 'Tencent Hunyuan', color: '#0052d9', initial: 'T' },
  { id: 'deepseek', name: 'DeepSeek', color: '#4d6bfe', initial: 'D' },
]

export const MODELS = [
  { id: 'claude-opus', provider: 'anthropic', name: 'Claude Opus', tags: ['reasoning', 'writing', 'coding'], context: '200K', speed: 2, cost: 3 },
  { id: 'claude-sonnet', provider: 'anthropic', name: 'Claude Sonnet', tags: ['coding', 'agentic', 'writing'], context: '200K', speed: 3, cost: 2 },
  { id: 'claude-haiku', provider: 'anthropic', name: 'Claude Haiku', tags: ['fast', 'cheap'], context: '200K', speed: 5, cost: 1 },
  { id: 'gpt-5', provider: 'openai', name: 'GPT-5', tags: ['reasoning', 'general', 'math'], context: '400K', speed: 2, cost: 3 },
  { id: 'gpt-5-mini', provider: 'openai', name: 'GPT-5 mini', tags: ['fast', 'general'], context: '400K', speed: 4, cost: 1 },
  { id: 'gemini-pro', provider: 'google', name: 'Gemini Pro', tags: ['long-context', 'multimodal', 'analysis'], context: '1M', speed: 3, cost: 2 },
  { id: 'gemini-flash', provider: 'google', name: 'Gemini Flash', tags: ['fast', 'multimodal', 'cheap'], context: '1M', speed: 5, cost: 1 },
  { id: 'grok-4', provider: 'xai', name: 'Grok 4', tags: ['realtime', 'news', 'reasoning'], context: '256K', speed: 3, cost: 2 },
  { id: 'grok-fast', provider: 'xai', name: 'Grok Fast', tags: ['fast', 'realtime'], context: '2M', speed: 5, cost: 1 },
  { id: 'hunyuan-t1', provider: 'tencent', name: 'Hunyuan Hy3', tags: ['reasoning', 'chinese', 'math'], context: '128K', speed: 3, cost: 1 },
  { id: 'hunyuan-turbos', provider: 'tencent', name: 'Hunyuan A13B', tags: ['fast', 'chinese', 'general'], context: '128K', speed: 5, cost: 1 },
  { id: 'deepseek-v3', provider: 'deepseek', name: 'DeepSeek V3', tags: ['coding', 'cheap', 'general'], context: '128K', speed: 4, cost: 1 },
]

export const AUTO_MODEL = { id: 'auto', name: 'Auto', provider: null }

export const getModel = (id) => MODELS.find((m) => m.id === id)
export const getProvider = (id) => PROVIDERS.find((p) => p.id === id)

// ---------------------------------------------------------------------------
// Auto router (mock). The real version would live in the backend and could use
// a small classifier model. Here: keyword heuristics → task category → model.
// ---------------------------------------------------------------------------
export const ROUTES = [
  { category: 'Coding', model: 'claude-sonnet', re: /\b(code|bug|function|python|javascript|react|sql|api|regex|script|debug|error|typescript)\b/i },
  { category: 'Live / current events', model: 'grok-4', re: /\b(today|latest|news|current|this week|right now|trending|price of)\b/i },
  { category: 'Math & quantitative', model: 'gpt-5', re: /\b(calculate|equation|forecast|kwh|npv|irr|roi|percentage|statistic|probability|\d+\s*[x×*/+-]\s*\d+)\b/i },
  { category: 'Long document analysis', model: 'gemini-pro', re: /\b(summari[sz]e|this document|report|pdf|attached|contract|lease agreement|transcript)\b/i },
  { category: 'Chinese language', model: 'hunyuan-t1', re: /[一-鿿]/ },
  { category: 'Operational reasoning', model: 'claude-opus', re: /\b(chillers?|hvac|ahu|pumps?|lifts?|elevators?|escalators?|generators?|ups|tenants?|lease|energy|maintenance|faults?|escalat\w*|assets?|buildings?|facility|sustainab\w*|carbon|occupancy|technicians?)\b/i },
  { category: 'Writing', model: 'claude-opus', re: /\b(write|draft|email|essay|rewrite|proposal|memo|letter)\b/i },
]

export function routeAuto(prompt = '') {
  for (const r of ROUTES) {
    if (r.re.test(prompt)) {
      return { modelId: r.model, category: r.category, reason: `Detected a ${r.category.toLowerCase()} task` }
    }
  }
  if (prompt.trim().split(/\s+/).length < 8) {
    return { modelId: 'gemini-flash', category: 'Quick question', reason: 'Short prompt — fastest capable model' }
  }
  return { modelId: 'gpt-5-mini', category: 'General', reason: 'General task — balanced cost and quality' }
}

// ---------------------------------------------------------------------------
// Availability helpers (used by the UI and auto-routing fallback).
// ---------------------------------------------------------------------------

/** Best Claude model to fall back to, in preference order. */
export const CLAUDE_FALLBACK_ORDER = ['claude-sonnet', 'claude-opus', 'claude-haiku']

/**
 * Returns a function isModelAvailable(modelId) that respects:
 * - VITE_USE_MOCK=true → everything is available (demo fallback)
 * - backend offline (null map) → everything is available (keep today's mock behaviour)
 * - backend responded → use the availability map
 */
export function makeAvailabilityChecker(modelAvailability) {
  return (modelId) => {
    if (USE_MOCK) return true
    if (modelAvailability === null) return true // backend offline → keep mock behaviour
    const info = modelAvailability[modelId]
    return info ? info.available : false
  }
}

/**
 * Picks the best available Claude model for auto-routing fallback.
 * Returns a model id or null if no Claude model is available.
 */
export function bestAvailableClaude(isAvailable) {
  return CLAUDE_FALLBACK_ORDER.find((id) => isAvailable(id)) || null
}

/**
 * Wraps routeAuto with availability awareness. If the originally routed model
 * is unavailable, falls back to the best available Claude model and rewrites
 * the reason to be honest about the fallback.
 */
export function routeAutoWithFallback(prompt = '', isAvailable) {
  const route = routeAuto(prompt)
  if (isAvailable(route.modelId)) return route

  const fallbackId = bestAvailableClaude(isAvailable)
  if (!fallbackId) return route // nothing available — let the mock handle it

  const fallbackModel = getModel(fallbackId)
  return {
    modelId: fallbackId,
    category: route.category,
    reason: `${route.category} → ${fallbackModel?.name || fallbackId} (${getModel(route.modelId)?.name || route.modelId} not configured)`,
  }
}
