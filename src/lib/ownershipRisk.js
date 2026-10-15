// Contributor coverage: how many distinct people have actually touched a
// topic's captured Expertise -- the original author plus anyone who later
// proposed a revision to it, not just who happened to write the first draft.
// This is purely a client-side rollup of data already in the store (the
// `owner` field on Expertise, the `author` field on Proposal); no backend
// change, no new tracking.
//
// Deliberately scoped to *topic*, not domain: a domain is a grouping of
// topics that can vary wildly in how many people have worked on each one,
// so rolling straight to a domain-wide verdict hides that variation and
// can make a broad, healthy domain look shaky because of one thin topic.

/** Every person who has touched this set of Expertise items: owners plus
 * anyone who filed a proposal against one of them. */
export function topicContributorSet(items, proposals) {
  const ids = new Set(items.map((it) => it.id))
  const names = new Set()
  for (const it of items) {
    if (it.owner) names.add(it.owner)
  }
  for (const p of proposals || []) {
    if (p.author && ids.has(p.expertiseId)) names.add(p.author)
  }
  return names
}

/**
 * Coverage for one topic's items. Returns null when there's nothing
 * captured yet -- too early to say anything either way.
 */
export function topicCoverage(items, proposals) {
  const total = items.length
  if (total === 0) return null
  const contributors = topicContributorSet(items, proposals)
  const distinctContributors = contributors.size
  const singleContributor = distinctContributors === 1
  return {
    total,
    distinctContributors,
    singleContributor,
    contributor: singleContributor ? [...contributors][0] : null,
    contributors: [...contributors],
  }
}

/**
 * Rolls topic-level coverage up into one proportional signal for a domain
 * card: how many of this domain's topics rely on a single contributor, out
 * of how many have anything captured. Returns null when nothing is flagged
 * (including when the domain has no captured topics yet) -- a healthy or
 * empty domain shows nothing, never a false alarm.
 *
 * `level`: 'high' when EVERY evaluated topic is single-contributor,
 * 'moderate' otherwise (at least one topic is fine).
 */
export function domainContributorCoverage(topics, proposals) {
  const evaluated = topics
    .map((t) => ({ name: t.name, coverage: topicCoverage(t.items, proposals) }))
    .filter((t) => t.coverage)
  if (evaluated.length === 0) return null

  const flagged = evaluated.filter((t) => t.coverage.singleContributor)
  if (flagged.length === 0) return null

  return {
    totalTopics: evaluated.length,
    flaggedTopics: flagged.length,
    flaggedNames: flagged.map((t) => t.name),
    level: flagged.length === evaluated.length ? 'high' : 'moderate',
  }
}
