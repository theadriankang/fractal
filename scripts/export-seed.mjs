#!/usr/bin/env node
/**
 * Export seed data from the front-end mock sources into backend/seed_data.json.
 * Run from the repo root:  node scripts/export-seed.mjs
 *
 * Produces backend/seed_data.json with:
 *   { users: [...], expertise: [...], proposals: [...], chats: [...] }
 * Each chat includes its nested messages + responses, using the same
 * camelCase shapes the API returns.
 *
 * Note: src/data/expertise.js uses extensionless relative imports
 * (`./taxonomy`, `./expertisePortfolio`) that Vite resolves but Node ESM can't.
 * We load it via a data URL with those specifiers rewritten to absolute file URLs.
 */

import { writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Load expertise.js — strip the extensionless re-export, load via data URL
// ---------------------------------------------------------------------------
const expertisePath = resolve(__dirname, '..', 'src', 'data', 'expertise.js')
const expSrc = readFileSync(expertisePath, 'utf-8')
  .replace(/from '\.\/(\w+)'/g, (_, name) => `from '${pathToFileURL(resolve(dirname(expertisePath), `${name}.js`)).href}'`)
const expertiseB64 = Buffer.from(expSrc).toString('base64')
const expertiseModule = await import(`data:text/javascript;base64,${expertiseB64}`)
const { SEED_EXPERTISE, SEED_PROPOSALS, CONTENT_FIELDS } = expertiseModule

// chats.js has no imports — safe to load directly via file URL.
const chatsPath = resolve(__dirname, '..', 'src', 'data', 'chats.js')
const { SEED_CHATS } = await import(pathToFileURL(chatsPath).href)

// users.js has no imports either: the demo accounts seed.py creates in Supabase Auth + profiles.
const usersPath = resolve(__dirname, '..', 'src', 'data', 'users.js')
const { DEMO_USERS, DEMO_PASSWORD } = await import(pathToFileURL(usersPath).href)

// ---------------------------------------------------------------------------
// Build snapshots for versions (mirrors src/store.js withSnapshots)
// ---------------------------------------------------------------------------
const snapshot = (e) =>
  Object.fromEntries(CONTENT_FIELDS.map((f) => [f, structuredClone(e[f])]))

function withSnapshots(list) {
  return list.map((e) => {
    const vs = e.versions
    if (!vs.length) return e
    const versions = vs.map((v, i) => {
      const back = vs.length - 1 - i
      const s = snapshot(e)
      const lists = ['decisionLogic', 'knowledge', 'guardrails', 'escalation']
      for (let k = 0; k < back; k++) {
        const f = lists[k % lists.length]
        if (s[f].length > 1) s[f] = s[f].slice(0, -1)
      }
      return { ...v, snapshot: s }
    })
    return { ...e, versions }
  })
}

// ---------------------------------------------------------------------------
// Expertise
// ---------------------------------------------------------------------------
const expertise = withSnapshots(SEED_EXPERTISE).map((e) => ({
  id: e.id,
  name: e.name,
  domain: e.domain,
  topic: e.topic,
  assetTypes: e.assetTypes || [],
  related: e.related || [],
  status: e.status,
  version: e.version,
  owner: e.owner,
  ownerRole: e.ownerRole,
  reviewer: e.reviewer ?? null,
  keywords: e.keywords || [],
  usageCount: e.usageCount ?? 0,
  successRate: e.successRate ?? null,
  summary: e.summary || '',
  whenToUse: e.whenToUse || '',
  knowledge: e.knowledge || [],
  decisionLogic: e.decisionLogic || [],
  guardrails: e.guardrails || [],
  escalation: e.escalation || [],
  sources: e.sources || [],
  feedback: e.feedback || [],
  origin: e.origin ?? null,
  capture: e.capture ?? null,
  authorId: e.authorId ?? null,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
  versions: (e.versions || []).map((v) => ({
    expertiseId: e.id,
    version: v.version,
    date: v.date,
    author: v.author,
    approvedBy: v.approvedBy ?? null,
    note: v.note || '',
    snapshot: v.snapshot || {},
  })),
}))

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------
const proposals = SEED_PROPOSALS.map((p) => ({
  id: p.id,
  expertiseId: p.expertiseId,
  type: p.type,
  createdAt: p.createdAt,
  author: p.author,
  reason: p.reason,
  changes: p.changes,
  chatId: p.chatId ?? null,
  authorId: p.authorId ?? null,
  capture: p.capture ?? null,
  sources: p.sources || [],
  meetingId: p.meetingId ?? null,
  meetingTitle: p.meetingTitle ?? null,
  status: 'open',
}))

// ---------------------------------------------------------------------------
// Chats (with nested messages + responses)
// ---------------------------------------------------------------------------
const chats = SEED_CHATS.map((c) => ({
  id: c.id,
  title: c.title,
  folder: c.folder ?? null,
  pinned: c.pinned ?? false,
  updatedAt: c.updatedAt,
  messages: (c.messages || []).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    files: m.files || [],
    attachedExpertise: m.attachedExpertise || [],
    webSearch: m.webSearch ?? false,
    detection: m.detection ?? null,
    detectionState: m.detectionState ?? null,
    createdAt: m.createdAt,
    responses: (m.responses || []).map((r) => ({
      modelId: r.modelId,
      auto: r.auto ?? null,
      expertiseUsed: r.expertise || [],
      content: r.content || '',
      rating: r.rating ?? null,
    })),
  })),
}))

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
const users = DEMO_USERS.map(({ name, email, role, domains }) => ({ name, email, role, domains, password: DEMO_PASSWORD }))
const out = { users, expertise, proposals, chats }
const dest = resolve(__dirname, '..', 'backend', 'seed_data.json')
writeFileSync(dest, JSON.stringify(out, null, 2), 'utf-8')
console.log(`Wrote ${dest}`)
console.log(`  users:     ${users.length}`)
console.log(`  expertise: ${expertise.length}`)
console.log(`  proposals: ${proposals.length}`)
console.log(`  chats:     ${chats.length}`)
