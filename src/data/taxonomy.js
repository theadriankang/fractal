// Expertise taxonomy: Domain → Topic → Expertise.
// Domains map 1:1 to Keppel's "Intelligence Pill" areas; topics are the
// systems / processes inside each domain. Asset types are a cross-cutting facet.
import { Building2, Zap, KeyRound, Wrench, Leaf, HeartHandshake } from 'lucide-react'

export const TAXONOMY = [
  {
    domain: 'Technical Services',
    icon: Wrench,
    gradient: 'from-sky-400 to-blue-600',
    dot: 'bg-sky-500',
    description: 'Fault diagnosis, maintenance and safety for building systems.',
    topics: ['Chillers & HVAC', 'Lifts & Escalators', 'Electrical & Power', 'Plumbing & Water'],
  },
  {
    domain: 'Energy Optimisation',
    icon: Zap,
    gradient: 'from-amber-400 to-orange-500',
    dot: 'bg-amber-500',
    description: 'Reducing consumption and demand charges without hurting comfort.',
    topics: ['Peak Demand', 'Chiller Plant Efficiency', 'Solar & Renewables'],
  },
  {
    domain: 'Asset Operations',
    icon: Building2,
    gradient: 'from-slate-400 to-slate-600',
    dot: 'bg-slate-400',
    description: 'Running the asset day to day — budgets, vendors and procedures.',
    topics: ['Budgeting & CAPEX', 'Vendor Management', 'Operating Procedures'],
  },
  {
    domain: 'Tenant Experience',
    icon: HeartHandshake,
    gradient: 'from-pink-400 to-rose-500',
    dot: 'bg-pink-500',
    description: 'How we respond to, inform and look after tenants.',
    topics: ['Complaints & Feedback', 'Communications', 'Amenities'],
  },
  {
    domain: 'Leasing',
    icon: KeyRound,
    gradient: 'from-violet-400 to-purple-600',
    dot: 'bg-violet-500',
    description: 'Retention, renewals and commercial negotiation.',
    topics: ['Renewals & Retention', 'Rent Reviews', 'New Leasing'],
  },
  {
    domain: 'Sustainability',
    icon: Leaf,
    gradient: 'from-emerald-400 to-green-600',
    dot: 'bg-emerald-500',
    description: 'Carbon, certification and resource reporting.',
    topics: ['Carbon Reporting', 'Green Mark', 'Waste & Water'],
  },
]

export const ASSET_TYPES = ['Office', 'Data Centre', 'Logistics', 'Retail']

export const UNCATEGORISED = 'General'

export const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
export const domainMeta = (d) => TAXONOMY.find((t) => t.domain === d) || TAXONOMY[0]
export const domainBySlug = (slug) => TAXONOMY.find((t) => slugify(t.domain) === slug)
export const domainGradient = (d) => domainMeta(d).gradient

/** Builds the nav tree from a list of Expertise, keeping taxonomy order. */
export function buildTree(list) {
  return TAXONOMY.map((t) => {
    const inDomain = list.filter((e) => e.domain === t.domain)
    const topicNames = [...t.topics, ...new Set(inDomain.map((e) => e.topic || UNCATEGORISED).filter((x) => !t.topics.includes(x)))]
    const topics = topicNames
      .map((name) => ({ name, items: inDomain.filter((e) => (e.topic || UNCATEGORISED) === name).sort((a, b) => a.name.localeCompare(b.name)) }))
    return { ...t, topics, count: inDomain.length }
  })
}

/** Flat reading order (for Previous / Next links). */
export const flatOrder = (list) => buildTree(list).flatMap((d) => d.topics.flatMap((t) => t.items))
