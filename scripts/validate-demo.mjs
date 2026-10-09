import assert from 'node:assert/strict'
import { createServer } from 'vite'

// Exercise the browser persistence path with an isolated in-memory storage.
const storage = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
})

// Use Vite's own resolver so validation follows the application's imports.
const server = await createServer({ server: { open: false, watch: null }, appType: 'custom' })
try {
  const { SEED_EXPERTISE: entries, SEED_PROPOSALS: proposals, CONTENT_FIELDS } = await server.ssrLoadModule('/src/data/expertise.js')
  const { PORTFOLIO_EXPERTISE: additions, PORTFOLIO_PROPOSALS: newProposals } = await server.ssrLoadModule('/src/data/expertisePortfolio.js')
  const { TAXONOMY, ASSET_TYPES, buildTree } = await server.ssrLoadModule('/src/data/taxonomy.js')
  const { matchExpertise } = await server.ssrLoadModule('/src/lib/mockApi.js')
  const { migrateDemoState } = await server.ssrLoadModule('/src/data/demoMigration.js')
  const { useStore } = await server.ssrLoadModule('/src/store.js')

  assert.equal(entries.length, 55)
  assert.equal(additions.length, 38)
  assert.equal(proposals.length, 5)
  const byId = new Map(entries.map((e) => [e.id, e]))
  assert.equal(byId.size, entries.length, 'Expertise IDs must be unique')
  assert.equal(new Set(proposals.map((p) => p.id)).size, proposals.length)
  const statuses = new Set(['draft', 'in_review', 'approved', 'deprecated'])
  for (const e of entries) {
    const context = `${e.id}: `
    assert(TAXONOMY.find((d) => d.domain === e.domain)?.topics.includes(e.topic), context + 'invalid taxonomy')
    assert(statuses.has(e.status), context + 'invalid status')
    assert(e.assetTypes.length && e.assetTypes.every((t) => ASSET_TYPES.includes(t)), context + 'invalid assets')
    assert(e.name && e.summary && e.owner && e.ownerRole, context + 'missing metadata')
    assert(e.keywords.length && e.keywords.every((k) => k.trim()), context + 'missing keywords')
    assert(Number.isInteger(e.usageCount) && e.usageCount >= 0, context + 'invalid usage')
    assert(e.successRate === null || (e.successRate >= 0 && e.successRate <= 1), context + 'invalid success rate')
    assert(Date.parse(e.createdAt) <= Date.parse(e.updatedAt), context + 'invalid timestamps')
    for (const field of CONTENT_FIELDS) {
      assert(field === 'summary' || field === 'whenToUse' ? typeof e[field] === 'string' : Array.isArray(e[field]), context + field)
    }
    for (const id of e.related) assert(byId.has(id) && id !== e.id, context + 'broken related link: ' + id)
    for (const source of e.sources) assert(source.title && source.excerpt && Number.isFinite(Date.parse(source.date)), context + 'invalid source')
    for (const feedback of e.feedback) assert(['up', 'down'].includes(feedback.rating) && feedback.comment, context + 'invalid feedback')
    if (e.status === 'approved') assert(e.reviewer && e.versions.length, context + 'missing approval history')
    if (e.versions.length) {
      assert.equal(e.versions.at(-1).version, e.version, context + 'version mismatch')
      let previousDate = Date.parse(e.createdAt)
      for (const v of e.versions) {
        assert(Date.parse(v.date) >= previousDate && Date.parse(v.date) <= Date.parse(e.updatedAt), context + 'version date order')
        previousDate = Date.parse(v.date)
      }
    }
  }
  for (const domain of buildTree(entries)) {
    for (const topic of domain.topics) assert(topic.items.length >= 2, `${domain.domain}/${topic.name}: insufficient coverage`)
  }
  for (const type of ASSET_TYPES) assert(entries.some((e) => e.assetTypes.includes(type)))
  for (const status of statuses) assert(entries.some((e) => e.status === status))
  for (const e of additions) {
    assert(e.whenToUse && e.knowledge.length >= 2 && e.decisionLogic.length >= 3 && e.guardrails.length && e.escalation.length, e.id + ': incomplete playbook')
    assert(e.sources.length >= 2, e.id + ': missing provenance fixtures')
  }
  for (const p of proposals) {
    const target = byId.get(p.expertiseId)
    assert.equal(target?.status, 'approved', p.id + ': proposal target must be approved')
    assert(p.reason && p.author && Object.keys(p.changes).length)
    for (const [field, { add, remove }] of Object.entries(p.changes)) {
      assert(['knowledge', 'decisionLogic', 'guardrails', 'escalation'].includes(field))
      assert(add.length || remove.length)
      for (const item of remove) assert(target[field].includes(item), p.id + ': removal does not match target')
      for (const item of add) assert(!target[field].includes(item), p.id + ': addition already exists')
    }
  }

  for (const [prompt, expected] of [
    ['Review the after-hours baseload', 'exp-after-hours-load'],
    ['Prepare a new tenant handover checklist', 'exp-tenant-onboarding'],
    ['Investigate recycling contamination', 'exp-waste-contamination'],
    ['Investigate a condensate drain pan leak', 'exp-condensate-leak'],
  ]) assert(matchExpertise(prompt, entries).some((e) => e.id === expected), 'Retrieval missed: ' + expected)
  for (const e of entries.filter((e) => e.status !== 'approved')) {
    assert(!matchExpertise(e.keywords.join(' '), entries).some((match) => match.id === e.id), e.id + ': non-approved auto-applied')
  }

  const edited = { ...byId.get('exp-meter-quality'), summary: 'User-authored summary', status: 'deprecated' }
  const original = { ...byId.get('exp-chiller-fault'), owner: 'Custom owner' }
  const saved = { expertise: [original, edited], proposals: [{ id: 'custom-proposal' }], chats: [{ id: 'custom-chat' }], settings: { theme: 'dark' }, user: { name: 'Tester' }, selectedModels: ['claude-sonnet'] }
  const before = structuredClone(saved)
  const upgraded = migrateDemoState(saved, 2, additions, newProposals)
  assert.deepEqual(saved, before, 'Migration mutated the saved input')
  assert.equal(upgraded.expertise.length, 39)
  assert.equal(upgraded.expertise.find((e) => e.id === edited.id), edited)
  assert.equal(upgraded.expertise.find((e) => e.id === original.id), original)
  assert(!upgraded.expertise.some((e) => e.id === 'exp-energy-peak'), 'Migration restored a deleted original fixture')
  assert(!upgraded.proposals.some((p) => p.id === 'prop-meter-coverage'), 'Migration added a proposal to a deprecated target')
  assert.equal(upgraded.chats, saved.chats)
  assert.equal(upgraded.settings, saved.settings)
  assert.equal(upgraded.user, saved.user)
  assert.equal(upgraded.selectedModels, saved.selectedModels)
  assert.deepEqual(migrateDemoState(upgraded, 2, additions, newProposals), upgraded, 'Repeated merge added duplicates')
  assert.equal(migrateDemoState(upgraded, 3, additions, newProposals), upgraded)
  assert.deepEqual(migrateDemoState(saved, 1, additions, newProposals), {})

  const seeded = useStore.getState().expertise
  assert.equal(seeded.length, 55)
  for (const e of seeded.filter((e) => e.versions.length)) {
    for (const field of CONTENT_FIELDS) assert.deepEqual(e.versions.at(-1).snapshot[field], e[field], e.id + ': latest snapshot mismatch')
    if (e.versions.length > 1) assert.notDeepEqual(e.versions[0].snapshot, e.versions.at(-1).snapshot, e.id + ': no version diff')
  }

  const additionIds = new Set(additions.map((e) => e.id))
  const oldEntries = seeded.filter((e) => !additionIds.has(e.id) && e.id !== 'exp-energy-peak')
    .map((e) => e.id === original.id ? { ...e, summary: 'Preserve my existing edit' } : e)
  localStorage.setItem('fractal-store', JSON.stringify({ version: 2, state: {
    expertise: oldEntries,
    proposals: [proposals[0]],
    chats: [{ id: 'saved-chat', messages: [] }],
    settings: { ...useStore.getState().settings, theme: 'light' },
    user: useStore.getState().user,
    selectedModels: ['claude-sonnet'],
  } }))
  await useStore.persist.rehydrate()
  const hydrated = useStore.getState()
  assert.equal(hydrated.expertise.length, 54)
  assert.equal(hydrated.expertise.find((e) => e.id === original.id).summary, 'Preserve my existing edit')
  assert.equal(hydrated.chats[0].id, 'saved-chat')
  assert.equal(hydrated.settings.theme, 'light')
  assert.equal(hydrated.proposals.length, 5)
  assert(hydrated.expertise.find((e) => e.id === 'exp-meter-quality').versions[0].snapshot)
  assert.equal(JSON.parse(localStorage.getItem('fractal-store')).version, 3)

  useStore.setState({ expertise: hydrated.expertise.filter((e) => e.id !== 'exp-waste-contamination'), proposals: [] })
  await useStore.persist.rehydrate()
  assert(!useStore.getState().expertise.some((e) => e.id === 'exp-waste-contamination'), 'Reload restored a deleted v3 fixture')
  assert.equal(useStore.getState().proposals.length, 0, 'Reload restored resolved proposals')
  const counts = Object.fromEntries([...statuses].map((status) => [status, entries.filter((e) => e.status === status).length]))
  console.log(`Validated ${entries.length} Expertise, ${TAXONOMY.length} domains, ${TAXONOMY.reduce((n, d) => n + d.topics.length, 0)} topics and ${proposals.length} proposals.`)
  console.log('Status coverage:', counts)
  console.log('Retrieval, version snapshots, proposal changes and non-destructive migration passed.')
} finally {
  await server.close()
}
