// Checks src/lib/ratings.js (one rating per person per answer, helpful % from stored ratings).
// Run: npm run validate:ratings
import assert from 'node:assert/strict'
import { upsertFeedback, helpfulStats, averageHelpful, fmtRate, responseKey } from '../src/lib/ratings.js'

const up = (userId, key) => ({ userId, responseKey: key, rating: 'up' })
const down = (userId, key) => ({ userId, responseKey: key, rating: 'down' })
const seed = [{ user: 'Ahmad R.', rating: 'up' }, { user: 'Priya S.', rating: 'down' }] // older entries, no key

let fb = seed
fb = upsertFeedback(fb, 'm1:0', 'u-hafiz', up('u-hafiz', 'm1:0'))
fb = upsertFeedback(fb, 'm1:0', 'u-hafiz', up('u-hafiz', 'm1:0'))
fb = upsertFeedback(fb, 'm1:0', 'u-hafiz', up('u-hafiz', 'm1:0'))
assert.equal(fb.length, 3, 'three clicks on 👍 keep one rating')

fb = upsertFeedback(fb, 'm1:0', 'u-hafiz', down('u-hafiz', 'm1:0'))
assert.deepEqual(fb.filter((f) => f.userId === 'u-hafiz').map((f) => f.rating), ['down'], '👎 replaces the earlier 👍')

fb = upsertFeedback(fb, 'm1:0', 'u-priya', up('u-priya', 'm1:0'))
assert.equal(fb.length, 4, 'another person rating the same answer adds a rating')

fb = upsertFeedback(fb, 'm1:0', 'u-hafiz', null)
assert.equal(fb.filter((f) => f.userId === 'u-hafiz').length, 0, 'taking a rating back removes it')
assert.equal(fb.length, 3, 'seed feedback is untouched')

assert.deepEqual(helpfulStats({ feedback: fb }), { up: 2, down: 1, total: 3, rate: 2 / 3 })
assert.equal(helpfulStats({ feedback: [] }).rate, null)
assert.equal(fmtRate(2 / 3), '67%')
assert.equal(fmtRate(null), '—')
assert.equal(averageHelpful([{ feedback: fb }, { feedback: [] }, { feedback: [up('a', 'k')] }]), (2 / 3 + 1) / 2)
assert.equal(averageHelpful([{ feedback: [] }]), null)
assert.equal(responseKey('m1', 0, {}), 'm1:0')
assert.equal(responseKey('m1', 0, { rid: 'r-x' }), 'r-x', 'a regenerated answer has its own key')
assert.equal(responseKey('m1', 0, { id: 'r-saved' }), 'r-saved', 'a saved answer is keyed by its id, so the key survives a reload')

console.log('ratings checks passed')
