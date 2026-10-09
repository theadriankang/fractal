import { USE_MOCK } from './api'

export const MAX_WRITING_REFERENCES = 10
const FIELDS = ['id', 'name', 'version', 'status', 'owner', 'summary', 'whenToUse', 'knowledge', 'decisionLogic', 'guardrails', 'escalation']
export const writingReference = (e) => Object.fromEntries(FIELDS.map((field) => [field, e[field]]))
const referenceParts = (e) => [e.summary, e.whenToUse, ...e.knowledge, ...e.decisionLogic, ...e.guardrails, ...e.escalation]

export function validateWritingRequest(request) {
  if (!['summary', 'email'].includes(request.mode)) throw new Error('Choose a summary or an email draft.')
  if (!request.expertise.length || request.expertise.length > MAX_WRITING_REFERENCES) throw new Error('Select between 1 and 10 approved Expertise references.')
  if (request.expertise.some((e) => e.status !== 'approved')) throw new Error('Only approved Expertise can be used.')
  if (new Set(request.expertise.map((e) => e.id)).size !== request.expertise.length) throw new Error('Each reference can only be selected once.')
  if (request.expertise.some((e) => !referenceParts(e).some((part) => part?.trim()))) throw new Error('A selected Expertise page has no content. Choose a populated reference.')
  if (request.mode === 'email' && !request.instructions.trim()) throw new Error('Describe the email you want to draft.')
  if (JSON.stringify(request.expertise).length > 100000) throw new Error('These references are too long. Select fewer Expertise records.')
}

export function validateWritingResult(result, request) {
  if (!result || typeof result.summary !== 'string' || !Array.isArray(result.citations) || !result.citations.length || !Array.isArray(result.missingInformation) || result.missingInformation.some((s) => typeof s !== 'string')) throw new Error('The writing result is incomplete. Please try again.')
  if (request.mode === 'summary' && (!result.summary.trim() || result.email !== null)) throw new Error('The summary could not be generated.')
  if (request.mode === 'email' && (result.summary !== '' || !result.email?.subject?.trim() || !result.email?.body?.trim())) throw new Error('The email draft could not be generated.')
  for (const citation of result.citations) {
    const ref = request.expertise.find((e) => e.id === citation.expertiseId && e.version === citation.version)
    const text = ref && referenceParts(ref).join('\n')
    const excerpt = typeof citation.excerpt === 'string' && citation.excerpt.replace(/\s+/g, ' ').trim()
    if (!ref || !excerpt || !text.replace(/\s+/g, ' ').includes(excerpt)) throw new Error('The supporting references could not be verified. Please try again.')
  }
  return result
}

export function buildDemoWriting(request) {
  validateWritingRequest(request)
  const excerpt = (e) => referenceParts(e).find((part) => part?.trim())
  const lines = request.expertise.map((e) => `${e.name}\n${excerpt(e)}\n${e.guardrails.length ? 'Boundaries: ' + e.guardrails.join(' ') : ''}\n${e.escalation.length ? 'Escalation: ' + e.escalation.join(' ') : ''}`.trim())
  const result = {
    summary: request.mode === 'summary' ? lines.join('\n\n') : '',
    email: request.mode === 'email' ? {
      subject: 'Draft: ' + request.expertise[0].name,
      body: `Hi ${request.recipient.trim() || '[recipient]'},\n\nFor reference, our approved guidance states:\n\n${lines.join('\n\n')}\n\n[Add the verified situation, requested action and dates before using this draft.]\n\nBest regards,\n${request.sender.trim() || '[your name]'}`,
    } : null,
    citations: request.expertise.map((e) => ({ expertiseId: e.id, version: e.version, excerpt: excerpt(e).slice(0, 1000) })),
    missingInformation: request.mode === 'email' ? ['This demo assembles reference excerpts. Live generation is needed to tailor the email to your instructions and tone.'] : [],
  }
  return validateWritingResult(result, request)
}

// Gmail rejects very long compose URLs, so oversized bodies are left for the user to paste.
export const GMAIL_URL_LIMIT = 8000
const EMAIL_ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

export function gmailCompose({ to = '', subject, body }) {
  const params = [['view', 'cm'], ['fs', '1']]
  // The recipient field also accepts audiences like "Tenant contact"; only real addresses prefill To.
  if (EMAIL_ADDRESS.test(to.trim())) params.push(['to', to.trim()])
  params.push(['su', subject])
  const url = (extra = []) => 'https://mail.google.com/mail/?' + [...params, ...extra].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  const full = url([['body', body]])
  return full.length <= GMAIL_URL_LIMIT ? { url: full, includesBody: true } : { url: url(), includesBody: false }
}

export async function generateWriting(request, signal) {
  const payload = { ...request, expertise: request.expertise.map(writingReference) }
  validateWritingRequest(payload)
  if (USE_MOCK) return { ...buildDemoWriting(payload), demo: true }
  let response
  try {
    response = await fetch('/api/writing/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Writing Assistant could not connect. Start the backend or use demo mode (VITE_USE_MOCK=true).')
  }
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof result?.detail === 'string' ? result.detail : 'The writing request could not be completed. Check your inputs and try again.')
  return validateWritingResult(result, payload)
}
