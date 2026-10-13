const ago = (days, hours = 0) => new Date(Date.now() - days * 864e5 - hours * 36e5).toISOString()

export const SEED_CHATS = [
  {
    id: 'chat-1',
    title: 'Level 23 too warm — chiller check',
    folder: 'Marina Tower',
    pinned: true,
    updatedAt: ago(0, 2),
    messages: [
      { id: 'm1', role: 'user', content: 'Tenants on Level 23 say it\'s too warm since 2pm. BMS shows CHWST at 8.1 °C. What should I check first?', createdAt: ago(0, 2) },
      {
        id: 'm2',
        role: 'assistant',
        createdAt: ago(0, 2),
        responses: [
          {
            modelId: 'claude-opus',
            auto: { category: 'Operational reasoning', reason: 'Detected a operational reasoning task' },
            expertise: [{ id: 'exp-chiller-fault', version: '1.3' }],
            content:
              "CHWST at **8.1 °C** is above the 7.5 °C threshold, so this looks like a **plant-level** issue rather than a single AHU on Level 23.\n\n**Check in this order:**\n\n1. **Running capacity vs. load** — if the running chillers are above ~85% load, stage up the standby chiller.\n2. **Condenser approach temperature** — if it's above 3 °C, inspect cooling-tower fans and water treatment before blaming the chiller.\n3. **Alarm history (last 2 h)** — look for a power dip or low-oil-pressure lockout.\n\n> ⚠️ If any chiller tripped on **high-pressure or freeze protection**, do **not** reset it — escalate to the Chief Engineer immediately.\n\nWant me to draft a holding message to the Level 23 tenant contact while you investigate?",
            rating: null,
          },
        ],
      },
    ],
  },
  { id: 'chat-2', title: 'Why is our September demand charge so high?', folder: null, updatedAt: ago(1, 3), messages: [] },
  { id: 'chat-3', title: 'Which tenants might not renew next year?', folder: null, updatedAt: ago(1, 6), messages: [] },
  { id: 'chat-4', title: 'Carbon numbers for Q3 report', folder: 'ESG', updatedAt: ago(3), messages: [] },
  { id: 'chat-5', title: 'Lift modernisation vendor comparison', folder: null, updatedAt: ago(5), messages: [] },
  { id: 'chat-6', title: 'Draft notice: water shutdown Sat', folder: 'Marina Tower', updatedAt: ago(12), messages: [] },
  { id: 'chat-7', title: 'Data centre UPS maintenance window', folder: null, updatedAt: ago(20), messages: [] },
]

export const SUGGESTIONS = [
  { title: 'Triage a chiller alarm', sub: 'CHWST rising on the BMS', prompt: 'CHWST has been rising to 8 °C for the last 20 minutes and two floors are complaining. What should I check?' },
  { title: 'Cut peak demand', sub: 'without hurting tenant comfort', prompt: 'Our Monday morning peak demand keeps breaching contracted capacity. How can we reduce it?' },
  { title: 'Spot renewal risk', sub: 'tenants expiring in 18 months', prompt: 'Which signals should I look at to spot tenants who may not renew their lease next year?' },
  { title: 'Respond to a complaint', sub: 'air quality on Level 12', prompt: 'A tenant on Level 12 complained about stuffy air for the third time this month. How should I respond?' },
]
