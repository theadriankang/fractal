// Checks the feedback-loop helpers in src/lib/feedbackLoop.js. Run: npm run validate:loop
import assert from 'node:assert/strict'
import {
  applyChanges, applyListChange, mergeChanges, offlineCorrection, addTestCase, positiveCase, casesForRun,
  proposedVersion, offlineTestRun, healthOf, atVersion,
} from '../src/lib/feedbackLoop.js'

const steps = ['Confirm the CHWST trend.', 'Check the strainer DP.', 'Stage up the standby chiller.']
let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`) }

check('replacing a step keeps its position', () => {
  assert.deepEqual(applyListChange(steps, { remove: [steps[1]], add: ['Read the VSD fault log, then the strainer DP.'] }),
    [steps[0], 'Read the VSD fault log, then the strainer DP.', steps[2]])
})
check('insertAfter puts a new step in order; -1 = first; plain add appends', () => {
  assert.deepEqual(applyListChange(steps, { add: ['X'], insertAfter: 0 }), [steps[0], 'X', steps[1], steps[2]])
  assert.deepEqual(applyListChange(steps, { add: ['X'], insertAfter: -1 }), ['X', ...steps])
  assert.deepEqual(applyListChange(steps, { add: ['X'] }), [...steps, 'X'])
  assert.deepEqual(applyListChange(steps, { add: [steps[0]] }), steps) // no duplicates
})
check('applyChanges handles list fields and whenToUse', () => {
  const e = { decisionLogic: steps, guardrails: [], whenToUse: 'old' }
  const patch = applyChanges(e, { guardrails: { add: ['Never bypass a trip.'], remove: [] }, bogus: { add: ['x'] } }, { whenToUse: 'new' })
  assert.deepEqual(patch, { guardrails: ['Never bypass a trip.'], whenToUse: 'new' })
})
check('mergeChanges skips near-duplicate lines', () => {
  const out = mergeChanges({ knowledge: { add: ['Dust on the door contacts causes most stops.'], remove: [] } },
    { knowledge: { add: ['Dust on the door contacts causes most stops', 'Rollers wear out after 5 years.'], remove: [] } })
  assert.equal(out.knowledge.add.length, 2)
})

const chiller = {
  id: 'exp-chiller-fault', name: 'Chiller Plant Fault Triage', version: '1.3', status: 'approved', domain: 'Technical Services',
  knowledge: ['k1'], decisionLogic: steps, guardrails: [], escalation: [], whenToUse: 'w',
  versions: [{ version: '1.2', snapshot: { knowledge: [], decisionLogic: steps.slice(0, 2), guardrails: [], escalation: [], whenToUse: 'w' } }, { version: '1.3' }],
  feedback: [],
}
const req = (correction, openProposals = []) => ({
  turns: [{ role: 'user', content: 'CHWST is 8.1 °C, what do I check?' }], correction, expertise: [atVersion(chiller)], targetId: chiller.id, openProposals,
})

check('atVersion returns the snapshot of an older version', () => {
  assert.deepEqual(atVersion(chiller, '1.2').decisionLogic, steps.slice(0, 2))
  assert.equal(atVersion(chiller).decisionLogic.length, 3)
})
check('offline correction: "step 2" replaces that step', () => {
  const r = offlineCorrection(req('Step 2 is wrong: read the VSD fault log first.'))
  assert.equal(r.diagnosis, 'expertise_wrong')
  assert.deepEqual(r.changes.decisionLogic.remove, [steps[1]])
  assert.equal(r.engine, 'offline')
  assert.equal(r.testCase.question, 'CHWST is 8.1 °C, what do I check?')
})
check('offline correction: never → guardrails, escalate → escalation, twin → mergeWith', () => {
  assert.ok(offlineCorrection(req('Never reset the VSD before reading its log.')).changes.guardrails)
  assert.ok(offlineCorrection(req('Escalate to the M&E contractor if both chillers trip.')).changes.escalation)
  const open = [{ id: 'prop-1', expertiseId: chiller.id, reason: 'read the VSD fault log before the strainer', changes: {} }]
  assert.equal(offlineCorrection(req('You should read the VSD fault log before the strainer', open)).mergeWith, 'prop-1')
})
check('test questions: no near-duplicates, capped, proposal question first', () => {
  let cases = []
  for (let i = 0; i < 25; i++) cases = addTestCase(cases, positiveCase(`Question number ${i} about chillers`, 'answer'))
  assert.equal(cases.length, 20)
  assert.equal(addTestCase(cases, positiveCase('Question number 24 about chillers', 'x')).length, 20)
  const run = casesForRun({ ...chiller, testCases: cases }, { testCase: { question: 'own?', mustDo: ['x'] } })
  assert.equal(run[0].id, 'proposal')
  assert.equal(run.length, 7)
})
check('proposedVersion applies the change; offline run is labelled', () => {
  const p = { changes: { decisionLogic: { remove: [steps[1]], add: ['NEW'] } } }
  assert.deepEqual(proposedVersion(chiller, p).decisionLogic, [steps[0], 'NEW', steps[2]])
  const out = offlineTestRun([{ id: 'proposal', own: true, question: 'q' }, { id: 'c', question: 'q2' }])
  assert.equal(out.engine, 'offline')
  assert.deepEqual([out.summary.fixed, out.summary.newPass, out.summary.oldPass], [1, 2, 1])
})
check('health: burst of 👎, low rate and rollback suggestion', () => {
  const day = new Date().toISOString()
  const fb = (rating, version, n) => Array.from({ length: n }, () => ({ rating, version, date: day }))
  const burst = healthOf({ ...chiller, feedback: fb('down', '1.3', 3) })
  assert.equal(burst.flag.kind, 'burst')
  const old = '2020-01-01T00:00:00Z'
  const low = healthOf({ ...chiller, feedback: [...fb('up', '1.3', 5), ...fb('down', '1.3', 5)].map((f) => ({ ...f, date: old })) })
  assert.equal(low.flag.kind, 'low')
  const versions = [{ version: '1.2', snapshot: {} }, { version: '1.3' }]
  const roll = healthOf({ ...chiller, versions, feedback: [...fb('up', '1.2', 9), ...fb('down', '1.2', 1), ...fb('up', '1.3', 6), ...fb('down', '1.3', 4)].map((f) => ({ ...f, date: old })) })
  assert.equal(roll.rollbackTo?.version, '1.2')
  assert.equal(healthOf({ ...chiller, feedback: [{ rating: 'down', date: day }] }).flag, null) // untagged feedback ignored
})

console.log(`\n${passed} feedback-loop checks passed`)
