// Demo people. Until Supabase Auth lands (BUILD_PROMPTS Prompt 8) the signed-in user is picked
// from this list in the sidebar's user menu. The same shape should live in `profiles`
// (role + domains text[]) so the server can enforce the rules in src/lib/permissions.js.
//
// role:    'contributor' — captures and proposes know-how, ONLY in their own expert domains
//          'reviewer'    — approves / rejects / rolls back; does not author captured know-how
// domains: the taxonomy domains (src/data/taxonomy.js) this person is a recognised expert in.

export const DEMO_USERS = [
  { id: 'u-adrian', name: 'Adrian Kang', title: 'Head of Asset Operations', role: 'reviewer', domains: [] },
  { id: 'u-hafiz', name: 'Hafiz Rahman', title: 'Lift & Escalator Supervisor', role: 'contributor', domains: ['Technical Services'] },
  { id: 'u-nurul', name: 'Nurul Huda', title: 'Energy Manager', role: 'contributor', domains: ['Energy Optimisation', 'Sustainability'] },
  { id: 'u-marcus', name: 'Marcus Teo', title: 'Leasing Manager', role: 'contributor', domains: ['Leasing'] },
  { id: 'u-jasmine', name: 'Jasmine Ong', title: 'Tenant Relations Lead', role: 'contributor', domains: ['Tenant Experience'] },
]

export const DEFAULT_USER = DEMO_USERS[0]

/** Upgrades a saved `{name, role}` user (older demo state) to a full demo user. */
export function normalizeUser(u) {
  if (u?.id) return DEMO_USERS.find((x) => x.id === u.id) || u
  return DEMO_USERS.find((x) => x.name === u?.name) || DEMO_USERS.find((x) => x.role === u?.role) || DEFAULT_USER
}
