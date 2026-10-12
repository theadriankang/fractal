// Ratings on answers → Expertise feedback.
//
// One rating per person per answer: rating the same answer again replaces the earlier rating,
// and clicking the same thumb again takes the rating back. "Helpful %" is computed from the
// feedback that is actually stored, so it moves as people rate answers.

/** Stable key for one generated answer (a regenerated answer gets a new id, so a new key). */
export const responseKey = (msgId, idx, response) => response?.rid || response?.id || `${msgId}:${idx}`

/**
 * New feedback list for one Expertise after `userId` rates the answer `key`.
 * `entry` null removes the person's rating of that answer.
 */
export function upsertFeedback(feedback = [], key, userId, entry) {
  const rest = feedback.filter((f) => !(f.responseKey === key && f.userId === userId))
  return entry ? [entry, ...rest] : rest
}

/** { up, down, total, rate } over every stored rating (rate is null with no ratings). */
export function helpfulStats(e) {
  const fb = e?.feedback || []
  const up = fb.filter((f) => f.rating === 'up').length
  const down = fb.filter((f) => f.rating === 'down').length
  const total = up + down
  return { up, down, total, rate: total ? up / total : null }
}

/** "83%" or "—". */
export const fmtRate = (rate) => (rate == null ? '—' : `${Math.round(rate * 100)}%`)

/** Average helpful rate across Expertise that have at least one rating (null if none do). */
export function averageHelpful(list) {
  const rates = list.map((e) => helpfulStats(e).rate).filter((r) => r != null)
  return rates.length ? rates.reduce((a, r) => a + r, 0) / rates.length : null
}
