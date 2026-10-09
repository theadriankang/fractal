// Simulated accounts for the demo sign-in (password for every account: demo1234).
// Until Supabase Auth replaces this, sign-in happens in the browser only. The same fields should
// live in `profiles` (role + domains) so the server can enforce src/lib/permissions.js.
//
// role:    'reviewer'    — Head reviewer: sees and decides every queue item in every domain; never authors.
//          'contributor' — Domain expert: contributes AND reviews, but only in their own `domains`,
//                          and never approves their own contribution.
//          'intern'      — Uses approved Expertise in chat and reads it; cannot contribute or review.
// domains: taxonomy domains (src/data/taxonomy.js) the person is a recognised expert in.

export const DEMO_PASSWORD = 'demo1234'

export const DEMO_USERS = [
  { id: 'u-adrian', name: 'Adrian Kang', email: 'adrian@fractal.demo', title: 'Head of Asset Operations', role: 'reviewer', domains: [], color: 'from-accent-500 to-indigo-500' },
  { id: 'u-hafiz', name: 'Hafiz Rahman', email: 'hafiz@fractal.demo', title: 'Lift & Escalator Supervisor', role: 'contributor', domains: ['Technical Services'], color: 'from-sky-400 to-blue-600' },
  { id: 'u-priya', name: 'Priya S.', email: 'priya@fractal.demo', title: 'Senior M&E Engineer', role: 'contributor', domains: ['Technical Services'], color: 'from-cyan-400 to-sky-600' },
  { id: 'u-nurul', name: 'Nurul Huda', email: 'nurul@fractal.demo', title: 'Energy Manager', role: 'contributor', domains: ['Energy Optimisation', 'Sustainability'], color: 'from-amber-400 to-orange-500' },
  { id: 'u-daniel', name: 'Daniel Koh', email: 'daniel@fractal.demo', title: 'Asset Manager', role: 'contributor', domains: ['Asset Operations'], color: 'from-slate-400 to-slate-600' },
  { id: 'u-jasmine', name: 'Jasmine Ong', email: 'jasmine@fractal.demo', title: 'Tenant Relations Lead', role: 'contributor', domains: ['Tenant Experience'], color: 'from-pink-400 to-rose-500' },
  { id: 'u-marcus', name: 'Marcus Teo', email: 'marcus@fractal.demo', title: 'Leasing Manager', role: 'contributor', domains: ['Leasing'], color: 'from-violet-400 to-purple-600' },
  { id: 'u-ethan', name: 'Ethan Lim', email: 'intern@fractal.demo', title: 'Operations Intern', role: 'intern', domains: [], color: 'from-emerald-400 to-green-600' },
]

export const DEFAULT_USER = DEMO_USERS[0]
export const userById = (id) => DEMO_USERS.find((u) => u.id === id) || null

export const ROLE_LABEL = { reviewer: 'Reviewer', contributor: 'Domain expert', intern: 'Intern' }

/** One-line description of what the account can do, for menus and the sign-in page. */
export const roleSummary = (u) =>
  u.role === 'reviewer' ? 'Reviewer · all domains'
    : u.role === 'intern' ? 'Intern · uses Expertise, read-only'
      : `Expert · ${u.domains.join(', ')}`

/** Simulated credential check. Returns the account or null. */
export function authenticate(email, password) {
  const u = DEMO_USERS.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase())
  return u && password === DEMO_PASSWORD ? u : null
}

/** Upgrades a saved `{name, role}` user (older demo state) to a full account. */
export function normalizeUser(u) {
  if (u?.id) return userById(u.id) || u
  return DEMO_USERS.find((x) => x.name === u?.name) || DEMO_USERS.find((x) => x.role === u?.role) || DEFAULT_USER
}
