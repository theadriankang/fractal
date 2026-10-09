// Upgrade only the new portfolio fixtures. Keep existing edits, deleted original
// fixtures, chats, settings, and review decisions intact.
export function migrateDemoState(state, version, additions, proposals) {
  if (version < 2) return {} // Preserve the previous pre-taxonomy reset behavior.
  if (version >= 3) return state

  const existing = state.expertise || []
  const existingIds = new Set(existing.map((e) => e.id))
  const expertise = [...existing, ...additions.filter((e) => !existingIds.has(e.id))]
  const approvedIds = new Set(expertise.filter((e) => e.status === 'approved').map((e) => e.id))
  const savedProposals = state.proposals || []
  const proposalIds = new Set(savedProposals.map((p) => p.id))
  return {
    ...state,
    expertise,
    proposals: [
      ...savedProposals,
      ...proposals.filter((p) => !proposalIds.has(p.id) && approvedIds.has(p.expertiseId)),
    ],
  }
}
