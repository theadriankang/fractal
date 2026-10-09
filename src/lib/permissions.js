// Who may contribute know-how to which Expertise.
//
// Rule: only a CONTRIBUTOR who is an expert in an Expertise's DOMAIN may add to it — capture it
// from chat or a meeting, propose a revision, create or edit a draft, or submit it for review.
// Reviewers govern (approve, reject, roll back, deprecate, restore) but do not author content,
// so nobody approves their own contribution (separation of duties).
// These checks run in the UI and again inside store actions; the backend repeats them for the
// extractor, and real enforcement moves server-side with Supabase Auth (Prompt 8).

export const isContributor = (user) => user?.role === 'contributor'
export const isReviewer = (user) => user?.role === 'reviewer'

/** True when `user` may contribute to Expertise in `domain`. */
export const canContribute = (user, domain) => isContributor(user) && !!domain && (user.domains || []).includes(domain)

/** Human-readable reason `user` can't contribute to `domain`, or null if they can. */
export function contributeBlock(user, domain) {
  if (!isContributor(user)) return 'Only contributors can add know-how — reviewers approve it.'
  if (!canContribute(user, domain)) return `Only ${domain} experts can contribute here. Your domains: ${(user.domains || []).join(', ') || 'none'}.`
  return null
}

/** May the user edit this Expertise's content? Same rule: contributors expert in its domain. */
export const canEdit = (user, expertise) => canContribute(user, expertise?.domain)
