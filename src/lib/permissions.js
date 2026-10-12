// Who may do what with Expertise. One place, used by the UI and re-checked inside store actions.
//
//  Reviewer (Adrian)  — sees every queue item in every domain; approves, rejects, rolls back,
//                       deprecates, restores. Never authors content.
//  Domain expert      — contributes (capture from chat/meetings, propose revisions incl. 👎
//                       corrections, create/edit drafts, submit) AND reviews queue items — but
//                       only in their own domains, and never their own contribution (four eyes).
//  Intern             — uses approved Expertise in chat and reads it; can rate answers but cannot
//                       contribute or review anything.
//
// Real enforcement moves server-side with Supabase Auth (BUILD_PROMPTS Prompt 8); the backend
// already repeats the contribution check for the know-how extractor.

export const isContributor = (user) => user?.role === 'contributor'
export const isReviewer = (user) => user?.role === 'reviewer'
export const isIntern = (user) => user?.role === 'intern'

const inDomain = (user, domain) => !!domain && (user?.domains || []).includes(domain)

/** True when `user` may contribute to Expertise in `domain`. */
export const canContribute = (user, domain) => isContributor(user) && inDomain(user, domain)

/** Human-readable reason `user` can't contribute to `domain`, or null if they can. */
export function contributeBlock(user, domain) {
  if (isIntern(user)) return 'Interns can use Expertise but can’t contribute to it.'
  if (isReviewer(user)) return 'Reviewers approve know-how but don’t contribute it.'
  if (!canContribute(user, domain)) return `Only ${domain} experts can contribute here. Your domains: ${(user?.domains || []).join(', ') || 'none'}.`
  return null
}

/** May the user edit this Expertise's content? Same rule as contributing. */
export const canEdit = (user, expertise) => canContribute(user, expertise?.domain)

/** Was this queue item contributed by `user`? (drafts: owner / capturer; proposals: author) */
export function isOwnContribution(user, item) {
  if (!user || !item) return false
  if (item.authorId) return item.authorId === user.id
  const who = item.capture?.capturedBy || item.author || item.owner || ''
  return who === user.name || who.startsWith(`${user.name} (`)
}

/** Does `user` see Review Queue items in `domain`? */
export const seesQueue = (user, domain) => isReviewer(user) || (isContributor(user) && inDomain(user, domain))

/** May the user open the Review Queue at all? */
export const canOpenQueue = (user) => isReviewer(user) || isContributor(user)

/**
 * May `user` approve or reject a queue item in `domain`? `item` (draft Expertise or proposal) is
 * used for the no-self-approval rule. Returns null if allowed, otherwise the reason.
 */
export function reviewBlock(user, domain, item) {
  if (isIntern(user)) return 'Interns can’t review Expertise.'
  if (isReviewer(user)) return null
  if (!inDomain(user, domain)) return `Only ${domain} experts or the Reviewer can decide this.`
  if (isOwnContribution(user, item)) return 'You can’t approve your own contribution — another expert or the Reviewer must.'
  return null
}
export const canReview = (user, domain, item) => !reviewBlock(user, domain, item)

/** Rollback, deprecate and restore change what is live for everyone: head reviewer only. */
export const canGovern = (user) => isReviewer(user)

/**
 * May `user` delete this Expertise? Returns null if allowed, otherwise the reason.
 * Live (approved) Expertise is never deleted directly — the Reviewer deprecates it first, which is
 * reversible. Drafts can be deleted by the Reviewer or an expert in the domain; anything else
 * (in review, deprecated) only by the Reviewer.
 */
export function deleteBlock(user, e) {
  if (!e) return 'Expertise not found.'
  if (e.status === 'approved') return 'Live Expertise can’t be deleted. Deprecate it first (Reviewer only).'
  if (canGovern(user)) return null
  if (e.status === 'draft' && canEdit(user, e)) return null
  return e.status === 'draft' ? `Only ${e.domain} experts or the Reviewer can delete this draft.` : 'Only the Reviewer can delete this.'
}
