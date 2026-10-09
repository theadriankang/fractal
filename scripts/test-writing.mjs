import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { open: false, watch: null }, appType: 'custom', define: { 'import.meta.env.VITE_USE_MOCK': JSON.stringify('false') } })
const originalFetch = globalThis.fetch
try {
  const { SEED_EXPERTISE } = await server.ssrLoadModule('/src/data/expertise.js')
  const { writingReference, validateWritingRequest, validateWritingResult, buildDemoWriting, generateWriting, gmailCompose, GMAIL_URL_LIMIT } = await server.ssrLoadModule('/src/lib/writingService.js')
  const reference = SEED_EXPERTISE.find((e) => e.id === 'exp-shutdown-notice')
  const request = { mode: 'summary', instructions: '', recipient: '', sender: 'Employee', tone: 'professional', expertise: [writingReference(reference)] }
  const summary = buildDemoWriting(request)
  assert(summary.summary.includes(reference.summary))
  assert(summary.summary.includes(reference.guardrails[0]))
  assert.equal(summary.email, null)
  assert.equal(summary.citations[0].version, reference.version)
  assert.equal(writingReference(reference).feedback, undefined)

  const emailRequest = { ...request, mode: 'email', instructions: 'Inform tenants about a shutdown' }
  const email = buildDemoWriting(emailRequest)
  assert.equal(email.summary, '')
  assert(email.email.body.includes('[recipient]'))
  assert(email.email.body.includes('[Add the verified situation'))
  assert(email.missingInformation.length)
  for (const status of ['draft', 'in_review', 'deprecated']) {
    assert.throws(() => validateWritingRequest({ ...request, expertise: [{ ...request.expertise[0], status }] }), /approved/)
  }
  assert.throws(() => validateWritingRequest({ ...request, expertise: [] }))
  assert.throws(() => validateWritingRequest({ ...request, expertise: Array(11).fill(request.expertise[0]) }))
  assert.throws(() => validateWritingRequest({ ...emailRequest, instructions: ' ' }))
  const emptyReference = { ...request.expertise[0], summary: '', whenToUse: '', knowledge: [], decisionLogic: [], guardrails: [], escalation: [] }
  assert.throws(() => validateWritingRequest({ ...request, expertise: [emptyReference] }), /no content/)
  assert(buildDemoWriting({ ...request, expertise: [{ ...emptyReference, guardrails: ['Never promise compensation.'] }] }).citations[0].excerpt.includes('compensation'))
  assert.throws(() => validateWritingResult({ ...summary, citations: [{ ...summary.citations[0], version: '99' }] }, request))
  assert.throws(() => validateWritingResult({ ...summary, citations: [{ ...summary.citations[0], excerpt: 'An invented company policy.' }] }, request))

  const draft = { subject: 'Water shutdown & access', body: 'Hi team,\n\nPlumbing work: 50% done + [date].' }
  const compose = gmailCompose({ to: ' ops@example.com ', ...draft })
  const params = new URL(compose.url).searchParams
  assert(compose.url.startsWith('https://mail.google.com/mail/?view=cm&fs=1&'))
  assert(compose.includesBody)
  assert.equal(params.get('to'), 'ops@example.com')
  assert.equal(params.get('su'), draft.subject)
  assert.equal(params.get('body'), draft.body)
  assert(!compose.url.includes('+'), 'spaces and plus signs must be percent-encoded')
  assert.equal(new URL(gmailCompose({ to: 'Tenant contact', ...draft }).url).searchParams.get('to'), null)
  const long = gmailCompose({ to: '', subject: 'Long', body: 'x'.repeat(GMAIL_URL_LIMIT) })
  assert(!long.includesBody && long.url.length <= GMAIL_URL_LIMIT)
  assert.equal(new URL(long.url).searchParams.get('body'), null)
  assert.equal(new URL(long.url).searchParams.get('su'), 'Long')

  const controller = new AbortController()
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/writing/generate')
    assert.equal(options.signal, controller.signal)
    const payload = JSON.parse(options.body)
    assert.deepEqual(payload.expertise[0], writingReference(reference))
    return new Response(JSON.stringify(summary), { status: 200 })
  }
  assert.deepEqual(await generateWriting(request, controller.signal), summary)
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Claude unavailable' }), { status: 503 })
  await assert.rejects(generateWriting(request), /Claude unavailable/)
  globalThis.fetch = async () => new Response(JSON.stringify({ ...summary, citations: [] }), { status: 200 })
  await assert.rejects(generateWriting(request), /incomplete/)
  globalThis.fetch = async () => { throw new TypeError('Offline') }
  await assert.rejects(generateWriting(request), /could not connect/)
  globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError') }
  await assert.rejects(generateWriting(request), (e) => e.name === 'AbortError')
  console.log('Writing Assistant passed: grounded demo results, request validation, citation verification, live payloads, backend errors and cancellation.')
} finally {
  globalThis.fetch = originalFetch
  await server.close()
}
