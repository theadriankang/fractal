// Seed Expertise ("Intelligence Pills") for the Keppel AI HARVEST demo.
// Each Expertise is a governed, versioned, reusable domain capability.

export const DOMAINS = [
  'Asset Operations',
  'Energy Optimisation',
  'Leasing',
  'Technical Services',
  'Sustainability',
  'Tenant Experience',
]

export const STATUSES = {
  draft: { label: 'Draft', cls: 'bg-gray-500/15 text-gray-400 ring-gray-500/30' },
  in_review: { label: 'In Review', cls: 'bg-amber-500/15 text-amber-400 ring-amber-500/30' },
  approved: { label: 'Approved', cls: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30' },
  deprecated: { label: 'Deprecated', cls: 'bg-red-500/15 text-red-400 ring-red-500/30' },
}

// Fields that are versioned (snapshotted on every approved change).
export const CONTENT_FIELDS = ['summary', 'whenToUse', 'knowledge', 'decisionLogic', 'guardrails', 'escalation']

const d = (s) => new Date(s).toISOString()

export const SEED_EXPERTISE = [
  {
    id: 'exp-chiller-fault',
    name: 'Chiller Plant Fault Triage',
    domain: 'Technical Services',
    status: 'approved',
    version: '1.3',
    owner: 'Tan Wei Ming',
    ownerRole: 'Senior M&E Engineer',
    reviewer: 'Rachel Lim',
    keywords: ['chiller', 'chw', 'chilled water', 'cooling', 'hvac', 'temperature', 'too warm', 'hot'],
    usageCount: 142,
    successRate: 0.91,
    updatedAt: d('2026-10-02'),
    createdAt: d('2026-07-14'),
    summary:
      'Step-by-step triage for chiller plant alarms and tenant "too warm" complaints in Grade-A office towers, captured from 22 years of on-site M&E experience.',
    whenToUse:
      'Chiller trip alarms, rising chilled-water supply temperature, or clustered tenant complaints about warm floors.',
    knowledge: [
      'CHWST drifting above 7.5 °C for >15 min is the earliest reliable sign of a plant issue — earlier than tenant complaints.',
      'Tenant complaints on a single floor usually point to AHU/VAV issues, not the chiller plant.',
      'Condenser approach temperature >3 °C usually means fouled tubes or a cooling-tower problem.',
      'After a power dip, chillers often lock out on low oil pressure — reset is safe once oil heater has run 30 min.',
    ],
    decisionLogic: [
      'Check BMS: is CHWST above 7.5 °C? If no → treat as local AHU/VAV issue on affected floors.',
      'If yes: how many chillers are running vs. demand? Stage up a standby chiller if load > 85% of running capacity.',
      'Check condenser approach temperature. If >3 °C → inspect cooling tower fans and dosing before blaming the chiller.',
      'Check alarm history for low oil pressure or power dip in the last 2 h.',
      'If the chiller tripped on a safety (high pressure, freeze protection) → do NOT reset; escalate.',
    ],
    guardrails: [
      'Never recommend resetting a chiller tripped on high-pressure or freeze-protection safeties.',
      'Never recommend running all chillers at full load to "catch up" — risk of surge and demand-charge spike.',
      'Recommendations only — the duty engineer executes any BMS change.',
    ],
    escalation: [
      'Safety-trip on any chiller → Chief Engineer immediately.',
      'Two or more chillers unavailable during office hours → Facility Manager + notify tenants via Tenant Experience team.',
      'Refrigerant leak suspected → evacuate plant room, call vendor, follow SOP-ME-014.',
    ],
    sources: [
      { type: 'conversation', chatId: 'chat-1', title: 'Level 23 too warm — chiller check', excerpt: 'Before you touch the chillers, always check whether it\'s one floor or the whole building…', date: d('2026-07-14') },
      { type: 'interview', title: 'Expert interview — Tan Wei Ming (45 min)', excerpt: 'Approach temperature tells you more than the chiller panel does.', date: d('2026-07-20') },
      { type: 'document', title: 'SOP-ME-014 Refrigerant Leak Response.pdf', excerpt: 'Evacuate, ventilate, isolate.', date: d('2026-06-01') },
    ],
    versions: [
      { version: '1.0', date: d('2026-07-21'), author: 'Tan Wei Ming', approvedBy: 'Rachel Lim', note: 'Initial capture from chat + expert interview.' },
      { version: '1.1', date: d('2026-08-09'), author: 'Fractal (feedback)', approvedBy: 'Rachel Lim', note: 'Added condenser approach check after 3 misdiagnoses flagged by engineers.' },
      { version: '1.2', date: d('2026-09-01'), author: 'Tan Wei Ming', approvedBy: 'Rachel Lim', note: 'Added power-dip / low oil pressure knowledge.' },
      { version: '1.3', date: d('2026-10-02'), author: 'Rachel Lim', approvedBy: 'Daniel Koh', note: 'Tightened safety-trip guardrail wording.' },
    ],
    feedback: [
      { user: 'Ahmad R.', rating: 'up', comment: 'Approach temp check saved us a vendor call-out.', date: d('2026-10-05') },
      { user: 'Priya S.', rating: 'down', comment: 'Should mention checking the CHW pump VSD too.', date: d('2026-10-07') },
    ],
  },
  {
    id: 'exp-energy-peak',
    name: 'Peak Demand Shaving',
    domain: 'Energy Optimisation',
    status: 'approved',
    version: '2.0',
    owner: 'Nurul Huda',
    ownerRole: 'Energy Manager',
    reviewer: 'Daniel Koh',
    keywords: ['energy', 'peak', 'demand', 'kwh', 'kw', 'tariff', 'electricity', 'bill', 'load'],
    usageCount: 87,
    successRate: 0.88,
    updatedAt: d('2026-09-18'),
    createdAt: d('2026-06-30'),
    summary: 'How to reduce monthly peak-demand (kW) charges without affecting tenant comfort, using pre-cooling and staged AHU starts.',
    whenToUse: 'Monthly demand charge spikes, contracted capacity breaches, or planning for heatwave weeks.',
    knowledge: [
      'Most peak demand in Singapore offices occurs 9:00–10:30 when AHUs start together after the weekend.',
      'Pre-cooling from 7:00 with staggered AHU starts typically cuts the Monday peak by 8–12%.',
      'Space temperature can float to 25 °C for 30 min without measurable complaint increase.',
    ],
    decisionLogic: [
      'Pull last 3 months of 30-min interval data; identify the top 5 demand intervals.',
      'If peaks cluster at morning start-up → recommend staggered AHU start (5-min intervals by zone).',
      'If peaks are afternoon → check chiller sequencing and solar gain on west façade floors.',
      'Estimate savings = (peak reduction kW × demand rate) and present with comfort risk.',
    ],
    guardrails: [
      'Never let space temperature exceed 25.5 °C in tenant areas.',
      'Do not alter data-centre or critical-load setpoints.',
    ],
    escalation: ['Any change affecting tenant lease comfort clauses → Leasing + Asset Manager approval.'],
    sources: [{ type: 'conversation', chatId: 'chat-2', title: 'Why is our September demand charge so high?', excerpt: 'It\'s always the Monday morning start-up…', date: d('2026-06-30') }],
    versions: [
      { version: '1.0', date: d('2026-07-02'), author: 'Nurul Huda', approvedBy: 'Daniel Koh', note: 'Initial capture.' },
      { version: '2.0', date: d('2026-09-18'), author: 'Nurul Huda', approvedBy: 'Daniel Koh', note: 'Restructured decision logic; added afternoon-peak branch.' },
    ],
    feedback: [],
  },
  {
    id: 'exp-tenant-complaint',
    name: 'Tenant Complaint Handling (Comfort)',
    domain: 'Tenant Experience',
    status: 'approved',
    version: '1.1',
    owner: 'Jasmine Ong',
    ownerRole: 'Tenant Relations Lead',
    reviewer: 'Rachel Lim',
    keywords: ['tenant', 'complaint', 'complain', 'unhappy', 'comfort', 'feedback', 'service'],
    usageCount: 64,
    successRate: 0.94,
    updatedAt: d('2026-09-25'),
    createdAt: d('2026-08-01'),
    summary: 'Response playbook for comfort complaints (temperature, air quality, noise) that keeps tenants informed while engineering investigates.',
    whenToUse: 'Any inbound tenant complaint about physical comfort.',
    knowledge: [
      'Tenants care more about acknowledgement speed than fix speed — acknowledge within 15 min.',
      'Repeat complaints from the same tenant within 30 days are a renewal risk signal.',
    ],
    decisionLogic: [
      'Acknowledge within 15 minutes with an ETA for first update.',
      'Log ticket and route to Technical Services with floor/zone.',
      'If repeat complaint within 30 days → flag to Asset Manager as renewal risk.',
      'Close the loop with the tenant contact once resolved, including root cause in plain language.',
    ],
    guardrails: ['Never promise rent rebates or compensation.', 'Never share other tenants\' information.'],
    escalation: ['Anchor tenant or repeat complaint → Asset Manager within same day.'],
    sources: [],
    versions: [
      { version: '1.0', date: d('2026-08-03'), author: 'Jasmine Ong', approvedBy: 'Rachel Lim', note: 'Initial capture.' },
      { version: '1.1', date: d('2026-09-25'), author: 'Jasmine Ong', approvedBy: 'Rachel Lim', note: 'Added renewal-risk rule.' },
    ],
    feedback: [],
  },
  {
    id: 'exp-lease-renewal',
    name: 'Lease Renewal Risk Signals',
    domain: 'Leasing',
    status: 'in_review',
    version: '0.9',
    owner: 'Marcus Teo',
    ownerRole: 'Leasing Manager',
    reviewer: 'Daniel Koh',
    keywords: ['lease', 'renewal', 'renew', 'expiry', 'vacancy', 'churn', 'leasing'],
    usageCount: 0,
    successRate: null,
    updatedAt: d('2026-10-08'),
    createdAt: d('2026-10-08'),
    summary: 'Early-warning signals that a tenant may not renew, and the first conversations to have 12–18 months before expiry.',
    whenToUse: 'Portfolio reviews, tenants within 18 months of lease expiry.',
    knowledge: [
      'Headcount reduction or hybrid-work announcements precede downsizing requests by ~6 months.',
      'Declining access-card swipes (>25% drop YoY) correlate strongly with non-renewal.',
    ],
    decisionLogic: [
      'List tenants with expiry in 12–18 months.',
      'Score each on: occupancy trend, complaint history, news signals, payment behaviour.',
      'High-risk → schedule relationship review meeting; prepare flexible-space options.',
    ],
    guardrails: ['Do not use personal data of tenant employees.', 'Rent figures are indicative only — Leasing Manager confirms.'],
    escalation: ['Anchor tenant at risk → Head of Leasing.'],
    sources: [{ type: 'conversation', chatId: 'chat-3', title: 'Which tenants might not renew next year?', excerpt: 'Swipe data is the best leading indicator we have…', date: d('2026-10-08') }],
    versions: [],
    feedback: [],
    origin: 'auto-detected',
  },
  {
    id: 'exp-carbon-report',
    name: 'Scope 2 Carbon Reporting',
    domain: 'Sustainability',
    status: 'draft',
    version: '0.1',
    owner: 'Fractal (auto-draft)',
    ownerRole: 'Unassigned',
    reviewer: null,
    keywords: ['carbon', 'emission', 'scope 2', 'green mark', 'esg', 'sustainability', 'grid emission factor'],
    usageCount: 0,
    successRate: null,
    updatedAt: d('2026-10-09'),
    createdAt: d('2026-10-09'),
    summary: 'Method for computing Scope 2 emissions per building using EMA grid emission factors.',
    whenToUse: 'Monthly ESG reporting, BCA Green Mark submissions.',
    knowledge: ['Use the latest EMA published grid emission factor (kgCO2/kWh) for the reporting year.'],
    decisionLogic: ['Pull monthly kWh per meter.', 'Multiply by grid emission factor.', 'Report by building and intensity (kgCO2/m²).'],
    guardrails: ['Figures must be reviewed by Sustainability Lead before external disclosure.'],
    escalation: [],
    sources: [{ type: 'conversation', chatId: 'chat-4', title: 'Carbon numbers for Q3 report', excerpt: 'We always use the EMA factor, not the IEA one…', date: d('2026-10-09') }],
    versions: [],
    feedback: [],
    origin: 'auto-detected',
  },
]

// Pending revision proposals generated from feedback / corrections.
export const SEED_PROPOSALS = [
  {
    id: 'prop-1',
    expertiseId: 'exp-chiller-fault',
    type: 'revision',
    createdAt: d('2026-10-07'),
    author: 'Priya S. (via 👎 feedback)',
    reason: 'Should mention checking the CHW pump VSD too.',
    changes: {
      decisionLogic: {
        add: ['If CHWST is normal but floors are warm, check CHW pump VSD speed and differential pressure setpoint.'],
        remove: [],
      },
    },
  },
]
