import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SEED_CHATS } from './data/chats'
import { SEED_EXPERTISE, SEED_PROPOSALS, CONTENT_FIELDS } from './data/expertise'
import { PORTFOLIO_EXPERTISE, PORTFOLIO_PROPOSALS } from './data/expertisePortfolio'
import { migrateDemoState } from './data/demoMigration'
import { PROVIDERS, routeAuto } from './data/models'
import { matchExpertise, buildReply, streamText, detectExpertise, suggestTitle } from './lib/mockApi'
import { isLive, streamChat, extractKnowhow, setActiveEmail } from './lib/api'
import { DEMO_USERS, authenticate, userById } from './data/users'
import { canContribute, contributeBlock, isContributor, reviewBlock, canGovern, seesQueue, canEdit } from './lib/permissions'
import { buildExtractRequest, fromKeywordDetector, CAPTURE_MIN_WORDS } from './lib/capture'
import { readiness } from './lib/readiness'

const uid = (p = 'id') => `${p}-${Math.random().toString(36).slice(2, 9)}`
const now = () => new Date().toISOString()
const snapshot = (e) => Object.fromEntries(CONTENT_FIELDS.map((f) => [f, structuredClone(e[f])]))

const bumpVersion = (v) => {
  const n = parseFloat(v || '0')
  if (n < 1) return '1.0'
  const [maj, min] = String(v).split('.').map(Number)
  return `${maj}.${(min || 0) + 1}`
}

// Give seed versions believable snapshots so diff + rollback work in the demo.
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

const streams = new Map() // msgId -> [cancelFns]

const HISTORY_TURNS = 20

// Conversation before `msgId` as {role, content} turns. For assistant turns in
// compare mode, prefer the answer from the same model.
function historyBefore(chat, msgId, modelId) {
  const end = chat.messages.findIndex((m) => m.id === msgId)
  return chat.messages
    .slice(0, end)
    .map((m) => {
      // Attachments travel as ids; the backend re-reads them for every turn.
      if (m.role === 'user') return { role: 'user', content: m.content, files: (m.files || []).filter((f) => f.id).map((f) => f.id) }
      const r = m.responses.find((x) => x.modelId === modelId && x.content) || m.responses.find((x) => x.content)
      return { role: 'assistant', content: r?.content || '' }
    })
    .filter((t) => t.content)
    .slice(-HISTORY_TURNS)
}

// Streams response `idx` of assistant message `msgId` into the store: from the
// backend for live models, otherwise from the mock. Returns a cancel function.
function streamResponse(get, chatId, msgId, idx, { prompt, matched, onFinish }) {
  const patch = (fn) =>
    get().patchMessage(chatId, msgId, (m) => ({ ...m, responses: m.responses.map((x, i) => (i === idx ? fn(x) : x)) }))
  const chat = get().chats.find((c) => c.id === chatId)
  const response = chat.messages.find((m) => m.id === msgId).responses[idx]
  const { modelId, auto } = response

  // Routing metadata so the backend can tell the model why it was chosen.
  const routing = auto
    ? { selectedBy: 'auto', category: auto.category, reason: auto.reason }
    : { selectedBy: 'user' }

  if (!isLive(modelId)) {
    return streamText(
      buildReply(prompt, modelId, matched),
      (partial) => patch((x) => ({ ...x, content: partial })),
      (final) => {
        patch((x) => ({ ...x, content: final, streaming: false }))
        onFinish?.()
      },
      get().settings.streamSpeed,
    )
  }

  // Deltas arrive faster than the UI needs; flush them to the store every 50 ms.
  let text = ''
  let timer = null
  let ended = false
  const flush = () => {
    timer = null
    patch((x) => ({ ...x, content: text }))
  }
  const finish = (extra = {}) => {
    if (ended) return
    ended = true
    clearTimeout(timer)
    patch((x) => ({ ...x, content: text, streaming: false, ...extra }))
    onFinish?.()
  }
  const abort = streamChat(
    { model: modelId, messages: historyBefore(chat, msgId, modelId), expertise: matched, routing },
    {
      // The backend reports the Expertise it actually applied (approved only).
      onMeta: ({ expertise }) => patch((x) => ({ ...x, expertise })),
      onDelta: (t) => {
        text += t
        timer ??= setTimeout(flush, 50)
      },
      onDone: () => finish(),
      // With no answer text, no Expertise was applied either.
      onError: (message) => finish({ error: message, ...(text ? {} : { expertise: [] }) }),
    },
  )
  return () => {
    abort()
    finish()
  }
}

const defaultConnections = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, { enabled: true, apiKey: '', baseUrl: '' }]),
)

export const useStore = create(
  persist(
    (set, get) => ({
      // ---------------- data ----------------
      chats: SEED_CHATS,
      expertise: withSnapshots(SEED_EXPERTISE),
      proposals: SEED_PROPOSALS,

      // ---------------- settings ----------------
      settings: {
        theme: 'dark',
        autoApply: true,
        autoDetect: true,
        streamSpeed: 1,
        connections: defaultConnections,
      },
      // Signed-in account (src/data/users.js); null on the sign-in page. Role + domains drive src/lib/permissions.js.
      user: null,
      // Like Claude: several accounts can be signed in on this device; one is active.
      session: { activeId: null, signedIn: [] },
      selectedModels: ['auto'],

      // ---------------- ui (not persisted) ----------------
      sidebarOpen: true,
      settingsOpen: false,
      settingsTab: 'general',
      toast: null,

      // ---------------- ui actions ----------------
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      openSettings: (tab = 'general') => set({ settingsOpen: true, settingsTab: tab }),
      closeSettings: () => set({ settingsOpen: false }),
      setSettingsTab: (t) => set({ settingsTab: t }),
      showToast: (msg) => {
        set({ toast: { msg, id: uid() } })
        setTimeout(() => set((s) => (s.toast?.msg === msg ? { toast: null } : s)), 2600)
      },
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      updateConnection: (pid, patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            connections: { ...s.settings.connections, [pid]: { ...s.settings.connections[pid], ...patch } },
          },
        })),
      // ---------------- accounts (simulated auth) ----------------
      login: (email, password) => {
        const u = authenticate(email, password)
        if (!u) return { error: 'Incorrect email or password.' }
        set((s) => ({ user: u, session: { activeId: u.id, signedIn: [...new Set([...(s.session?.signedIn || []), u.id])] } }))
        setActiveEmail(u.email)
        return { user: u }
      },
      switchAccount: (id) => {
        const u = userById(id)
        if (!u || !get().session.signedIn.includes(id)) return
        set((s) => ({ user: u, session: { ...s.session, activeId: id } }))
        setActiveEmail(u.email)
        get().showToast(`Switched to ${u.name}`)
      },
      // Signs out the active account; falls back to another signed-in account, else the sign-in page.
      logout: () => {
        const { session } = get()
        const signedIn = session.signedIn.filter((id) => id !== session.activeId)
        const next = userById(signedIn[0])
        set({ user: next, session: { activeId: next?.id || null, signedIn } })
        setActiveEmail(next?.email || null)
        return next
      },
      logoutAll: () => {
        set({ user: null, session: { activeId: null, signedIn: [] } })
        setActiveEmail(null)
      },

      setSelectedModels: (ids) => set({ selectedModels: ids.length ? ids : ['auto'] }),

      // ---------------- chats ----------------
      newChat: () => {
        const id = uid('chat')
        set((s) => ({ chats: [{ id, ownerId: get().user?.id, title: 'New Chat', folder: null, updatedAt: now(), messages: [] }, ...s.chats] }))
        return id
      },
      renameChat: (id, title) => set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, title } : c)) })),
      togglePin: (id) => set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)) })),
      deleteChat: (id) => set((s) => ({ chats: s.chats.filter((c) => c.id !== id) })),

      patchChat: (chatId, fn) =>
        set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? fn(c) : c)) })),
      patchMessage: (chatId, msgId, fn) =>
        get().patchChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId ? fn(m) : m)) })),

      sendMessage: (chatId, text, { attachedExpertise = [], files = [], webSearch = false } = {}) => {
        const { settings, expertise, selectedModels } = get()
        const enabledModels = selectedModels
        const userMsg = { id: uid('m'), role: 'user', content: text, files, attachedExpertise, webSearch, createdAt: now() }
        const matched = matchExpertise(text, expertise, attachedExpertise, settings.autoApply)

        const responses = enabledModels.map((mid) => {
          const auto = mid === 'auto' ? routeAuto(text) : null
          return {
            modelId: auto ? auto.modelId : mid,
            auto: auto ? { category: auto.category, reason: auto.reason } : null,
            expertise: matched.map((e) => ({ id: e.id, version: e.version })),
            content: '',
            streaming: true,
            rating: null,
          }
        })
        const asstMsg = { id: uid('m'), role: 'assistant', createdAt: now(), responses }

        get().patchChat(chatId, (c) => ({
          ...c,
          title: c.messages.length === 0 ? suggestTitle(text) : c.title,
          updatedAt: now(),
          messages: [...c.messages, userMsg, asstMsg],
        }))

        // bump usage counts
        if (matched.length)
          set((s) => ({
            expertise: s.expertise.map((e) => (matched.some((m) => m.id === e.id) ? { ...e, usageCount: e.usageCount + 1 } : e)),
          }))

        let remaining = responses.length
        const onFinish = () => {
          remaining -= 1
          if (remaining > 0) return
          streams.delete(asstMsg.id)
          if (get().settings.autoDetect) get().runCapture(chatId, asstMsg.id, text, matched)
        }
        const cancels = responses.map((_, idx) => streamResponse(get, chatId, asstMsg.id, idx, { prompt: text, matched, onFinish }))
        streams.set(asstMsg.id, cancels)
      },

      stopGeneration: (chatId) => {
        const chat = get().chats.find((c) => c.id === chatId)
        chat?.messages.forEach((m) => streams.get(m.id)?.forEach((cancel) => cancel()))
      },

      regenerate: (chatId, msgId, idx) => {
        const chat = get().chats.find((c) => c.id === chatId)
        const i = chat.messages.findIndex((m) => m.id === msgId)
        const prompt = chat.messages[i - 1]?.content || ''
        const r = chat.messages[i].responses[idx]
        const matched = get().expertise.filter((e) => r.expertise.some((x) => x.id === e.id))
        get().patchMessage(chatId, msgId, (m) => ({
          ...m,
          responses: m.responses.map((x, k) => (k === idx ? { ...x, content: '', streaming: true, rating: null, error: undefined } : x)),
        }))
        const cancel = streamResponse(get, chatId, msgId, idx, { prompt, matched })
        streams.set(msgId, [...(streams.get(msgId) || []), cancel])
      },

      // Rating feeds the Expertise feedback loop.
      rateResponse: (chatId, msgId, idx, rating, comment = '') => {
        const chat = get().chats.find((c) => c.id === chatId)
        const r = chat.messages.find((m) => m.id === msgId).responses[idx]
        get().patchMessage(chatId, msgId, (m) => ({
          ...m,
          responses: m.responses.map((x, k) => (k === idx ? { ...x, rating } : x)),
        }))
        if (!r.expertise.length) return
        const user = get().user.name
        set((s) => ({
          expertise: s.expertise.map((e) =>
            r.expertise.some((x) => x.id === e.id)
              ? { ...e, feedback: [{ user, rating, comment, date: now(), chatId }, ...e.feedback] }
              : e,
          ),
        }))
        if (rating === 'down' && comment.trim()) {
          const target = r.expertise[0].id
          const te = get().expertise.find((e) => e.id === target)
          const block = te && contributeBlock(get().user, te.domain)
          if (block) {
            get().showToast(`Feedback saved. ${block}`)
            return
          }
          set((s) => ({
            proposals: [
              {
                id: uid('prop'),
                expertiseId: target,
                type: 'revision',
                createdAt: now(),
                author: `${user} (via 👎 feedback)`,
                authorId: get().user.id,
                reason: comment,
                changes: { knowledge: { add: [comment], remove: [] } },
                chatId,
              },
              ...s.proposals,
            ],
          }))
          get().showToast('Correction sent to the Review Queue')
        }
      },

      // ---------------- detection → expertise ----------------
      dismissDetection: (chatId, msgId) => get().patchMessage(chatId, msgId, (m) => ({ ...m, detectionState: 'dismissed' })),

      // After an answer finishes: ask the extractor whether the user shared reusable know-how.
      // Contributors only (reviewers approve, they don't author). Live (backend) answers use the
      // Claude extractor; mock answers or an offline backend fall back to the keyword detector.
      runCapture: async (chatId, msgId, text, matched = []) => {
        const user = get().user
        if (!isContributor(user)) return
        const chat = get().chats.find((c) => c.id === chatId)
        const msg = chat?.messages.find((m) => m.id === msgId)
        if (!msg) return
        // No capture after a failed answer: the backend is likely down and a keyword guess would be noise.
        if (!msg.responses.some((r) => r.content && !r.error)) {
          get().patchMessage(chatId, msgId, (m) => ({ ...m, detection: null, detectionState: null }))
          return
        }
        const keyword = () => fromKeywordDetector(detectExpertise(text, chat, matched), user, get().expertise)
        const live = msg.responses.some((r) => isLive(r.modelId) && r.content && !r.error)
        let det = null
        if (!live) det = keyword()
        else if (text.trim().split(/\s+/).length >= CAPTURE_MIN_WORDS) {
          get().patchMessage(chatId, msgId, (m) => ({ ...m, detectionState: 'checking' }))
          try {
            const req = buildExtractRequest({ user, chat: get().chats.find((c) => c.id === chatId), asstMsgId: msgId, used: matched, expertise: get().expertise })
            det = await extractKnowhow(req)
            if (det.kind === 'none') det = null
          } catch {
            det = keyword()
          }
        }
        get().patchMessage(chatId, msgId, (m) =>
          det ? { ...m, detection: { ...det, capturedBy: user.id }, detectionState: 'pending' } : { ...m, detection: null, detectionState: null })
      },

      // Saves a detection the user confirmed (optionally edited in the card):
      //   edits = { items: [{field, text, quote, include}], extras: [{field, text}], draft: {name, domain, topic} }
      // 'new' → auto-detected draft Expertise; 'revision' → proposal in the Review Queue.
      // Only a contributor who is an expert in the target domain may do this.
      acceptDetection: (chatId, msgId, edits = {}) => {
        const user = get().user
        const chat = get().chats.find((c) => c.id === chatId)
        const i = chat.messages.findIndex((m) => m.id === msgId)
        const msg = chat.messages[i]
        const det = msg.detection
        const draftMeta = { ...(det.draft || {}), ...(edits.draft || {}) }
        const target = det.kind === 'revision' ? get().expertise.find((e) => e.id === det.target.expertiseId) : null
        const domain = det.kind === 'new' ? draftMeta.domain : target?.domain
        const block = contributeBlock(user, domain)
        if (block) { get().showToast(block); return null }

        const items = (edits.items || det.items).filter((x) => x.include !== false && x.text.trim())
        const all = [...items, ...(edits.extras || []).filter((x) => x.text.trim()).map((x) => ({ ...x, quote: null }))]
        if (!all.length) { get().showToast('Tick at least one line to save'); return null }
        const pick = (f) => all.filter((x) => x.field === f).map((x) => x.text.trim())
        const quotes = items.map((x) => x.quote).filter(Boolean)
        const capture = { confidence: det.confidence, reason: det.reason, detector: det.source || 'keyword', capturedBy: user.name }
        const source = {
          type: 'conversation', chatId, title: chat.title, date: now(), capturedBy: user.name,
          excerpt: (quotes.length ? quotes.map((q) => `"${q}"`).join(' … ') : chat.messages[i - 1]?.content || '').slice(0, 280),
        }

        let result
        if (det.kind === 'new') {
          const id = get().createExpertise({
            name: draftMeta.name, domain: draftMeta.domain, topic: draftMeta.topic,
            assetTypes: draftMeta.assetTypes?.length ? draftMeta.assetTypes : ['Office'],
            summary: draftMeta.summary || '', whenToUse: draftMeta.whenToUse || '', keywords: draftMeta.keywords || [],
            knowledge: pick('knowledge'), decisionLogic: pick('decisionLogic'), guardrails: pick('guardrails'), escalation: pick('escalation'),
            origin: 'auto-detected', capture, sources: [source],
          })
          result = { kind: 'new', id, missing: readiness(get().expertise.find((e) => e.id === id)).missing.map((m) => m.label) }
        } else {
          const changes = {}
          for (const x of all) {
            if ((target[x.field] || []).includes(x.text.trim())) continue
            changes[x.field] ??= { add: [], remove: [] }
            changes[x.field].add.push(x.text.trim())
          }
          if (!Object.keys(changes).length) { get().showToast(`${target.name} already contains these lines`); return null }
          const id = uid('prop')
          set((s) => ({
            proposals: [
              { id, expertiseId: target.id, type: 'revision', createdAt: now(), author: `${user.name} (captured from chat)`, authorId: user.id,
                reason: det.reason || 'New know-how shared during a conversation.', changes, chatId, capture, sources: [source] },
              ...s.proposals,
            ],
          }))
          result = { kind: 'revision', id, missing: [] }
        }
        get().patchMessage(chatId, msgId, (m) => ({ ...m, detectionState: 'saved', detectionResult: result.id, detectionMissing: result.missing }))
        return result
      },

      // ---------------- expertise CRUD + governance ----------------
      createExpertise: (partial = {}) => {
        const id = uid('exp')
        const e = {
          id,
          name: 'Untitled Expertise',
          domain: 'Asset Operations',
          topic: 'Operating Procedures',
          assetTypes: ['Office'],
          related: [],
          status: 'draft',
          version: '0.1',
          owner: get().user.name,
          ownerRole: get().user.title || '',
          authorId: get().user.id,
          reviewer: null,
          keywords: [],
          usageCount: 0,
          successRate: null,
          createdAt: now(),
          updatedAt: now(),
          summary: '',
          whenToUse: '',
          knowledge: [],
          decisionLogic: [],
          guardrails: [],
          escalation: [],
          sources: [],
          versions: [],
          feedback: [],
          ...partial,
        }
        if (!e.keywords.length) e.keywords = e.name.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
        set((s) => ({ expertise: [e, ...s.expertise] }))
        return id
      },

      updateExpertise: (id, patch) =>
        set((s) => ({ expertise: s.expertise.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: now() } : e)) })),

      deleteExpertise: (id) => {
        const e = get().expertise.find((x) => x.id === id)
        if (!canGovern(get().user) && !(e?.status === 'draft' && canEdit(get().user, e))) {
          get().showToast('Only the Reviewer, or a domain expert for a draft, can delete Expertise.')
          return false
        }
        set((s) => ({ expertise: s.expertise.filter((x) => x.id !== id) }))
        return true
      },

      submitForReview: (id) => {
        const e = get().expertise.find((x) => x.id === id)
        const block = contributeBlock(get().user, e?.domain)
        if (block) { get().showToast(block); return }
        const r = readiness(e)
        if (!r.ready) { get().showToast(`Not ready for review — still needs: ${r.missing.map((m) => m.label.toLowerCase()).join('; ')}`); return }
        get().updateExpertise(id, { status: 'in_review' })
        get().showToast('Submitted for review')
      },

      approveExpertise: (id, note = 'Approved') => {
        const e = get().expertise.find((x) => x.id === id)
        const block = reviewBlock(get().user, e?.domain, e)
        if (block) { get().showToast(block); return }
        const version = bumpVersion(e.version)
        get().updateExpertise(id, {
          status: 'approved',
          version,
          reviewer: get().user.name,
          versions: [...e.versions, { version, date: now(), author: e.owner, approvedBy: get().user.name, note, snapshot: snapshot(e) }],
        })
        get().showToast(`Approved — v${version} is live`)
      },

      rejectExpertise: (id) => {
        const e = get().expertise.find((x) => x.id === id)
        const block = reviewBlock(get().user, e?.domain, e)
        if (block) { get().showToast(block); return }
        get().updateExpertise(id, { status: 'draft' })
        get().showToast('Sent back to draft')
      },

      deprecateExpertise: (id) => {
        if (!canGovern(get().user)) { get().showToast('Only the Reviewer can deprecate Expertise.'); return }
        get().updateExpertise(id, { status: 'deprecated' })
        get().showToast('Expertise deprecated')
      },

      restoreExpertise: (id) => {
        if (!canGovern(get().user)) { get().showToast('Only the Reviewer can restore Expertise.'); return }
        get().updateExpertise(id, { status: 'approved' })
        get().showToast('Expertise restored')
      },

      rollbackExpertise: (id, toVersion) => {
        if (!canGovern(get().user)) { get().showToast('Only the Reviewer can roll back Expertise.'); return }
        const e = get().expertise.find((x) => x.id === id)
        const target = e.versions.find((v) => v.version === toVersion)
        if (!target?.snapshot) return
        const version = bumpVersion(e.version)
        get().updateExpertise(id, {
          ...structuredClone(target.snapshot),
          version,
          versions: [
            ...e.versions,
            { version, date: now(), author: get().user.name, approvedBy: get().user.name, note: `Rolled back to v${toVersion}`, snapshot: structuredClone(target.snapshot) },
          ],
        })
        get().showToast(`Rolled back — now v${version}`)
      },

      approveProposal: (pid) => {
        const p = get().proposals.find((x) => x.id === pid)
        const e = get().expertise.find((x) => x.id === p.expertiseId)
        const block = reviewBlock(get().user, e?.domain, p)
        if (block) { get().showToast(block); return }
        const patch = {}
        for (const [field, { add = [], remove = [] }] of Object.entries(p.changes)) {
          patch[field] = [...e[field].filter((x) => !remove.includes(x)), ...add]
        }
        const merged = { ...e, ...patch }
        const version = bumpVersion(e.version)
        get().updateExpertise(e.id, {
          ...patch,
          version,
          // provenance (e.g. the meeting a revision came from) follows the change into the Expertise
          ...(p.sources?.length ? { sources: [...p.sources, ...e.sources] } : {}),
          versions: [...e.versions, { version, date: now(), author: p.author, approvedBy: get().user.name, note: p.reason, snapshot: snapshot(merged) }],
        })
        set((s) => ({ proposals: s.proposals.filter((x) => x.id !== pid) }))
        get().showToast(`Revision merged — ${e.name} v${version}`)
      },

      proposeRevision: (expertiseId, changes, reason) => {
        const e = get().expertise.find((x) => x.id === expertiseId)
        const block = contributeBlock(get().user, e?.domain)
        if (block) { get().showToast(block); return }
        set((s) => ({
          proposals: [
            { id: uid('prop'), expertiseId, type: 'revision', createdAt: now(), author: get().user.name, authorId: get().user.id, reason, changes },
            ...s.proposals,
          ],
        }))
        get().showToast('Changes sent to the Review Queue')
      },

      // Meeting Recorder → category selector → Review Queue.
      // links: [{ takeawayIndex, takeaway, expertiseId|null, newExpertise?{name,domain,topic}, field, entry, confidence }]
      // Existing Expertise get one revision proposal each; unmatched know-how becomes an auto-detected draft.
      // Nothing touches live Expertise until a Reviewer approves it.
      captureMeetingInsights: ({ meetingId, title, links }) => {
        const user = get().user.name
        const source = (excerpt) => ({ type: 'meeting', meetingId, title, excerpt: excerpt.slice(0, 200), date: now() })
        // Same rule as chat capture: only links into the user's own expert domains are kept.
        const domainOf = (l) => (l.expertiseId ? get().expertise.find((x) => x.id === l.expertiseId)?.domain : l.newExpertise?.domain)
        const skipped = links.filter((l) => !canContribute(get().user, domainOf(l))).length
        links = links.filter((l) => canContribute(get().user, domainOf(l)))
        const proposals = []
        const byExisting = new Map()
        const byNew = new Map()
        for (const l of links) {
          if (l.expertiseId) {
            const e = get().expertise.find((x) => x.id === l.expertiseId)
            if (!e || (e[l.field] || []).includes(l.entry)) continue
            if (!byExisting.has(e.id)) byExisting.set(e.id, [])
            byExisting.get(e.id).push(l)
          } else if (l.newExpertise?.name) {
            const k = l.newExpertise.name.trim().toLowerCase()
            if (!byNew.has(k)) byNew.set(k, [])
            byNew.get(k).push(l)
          }
        }
        for (const [expertiseId, ls] of byExisting) {
          const changes = {}
          for (const l of ls) {
            changes[l.field] ??= { add: [], remove: [] }
            if (!changes[l.field].add.includes(l.entry)) changes[l.field].add.push(l.entry)
          }
          proposals.push({
            id: uid('prop'),
            expertiseId,
            type: 'revision',
            createdAt: now(),
            author: `${user} (captured from meeting)`,
            authorId: get().user.id,
            reason: `Know-how from meeting "${title}" — routed by the category selector.`,
            changes,
            meetingId,
            meetingTitle: title,
            sources: ls.map((l) => source(l.takeaway || l.entry)),
          })
        }
        const drafts = []
        for (const ls of byNew.values()) {
          const { name, domain, topic } = ls[0].newExpertise
          const pick = (f) => ls.filter((l) => l.field === f).map((l) => l.entry)
          drafts.push(get().createExpertise({
            name, domain, topic,
            origin: 'auto-detected',
            summary: ls[0].takeaway || ls[0].entry,
            knowledge: pick('knowledge'),
            decisionLogic: pick('decisionLogic'),
            guardrails: pick('guardrails'),
            escalation: pick('escalation'),
            sources: ls.map((l) => source(l.takeaway || l.entry)),
          }))
        }
        if (proposals.length) set((s) => ({ proposals: [...proposals, ...s.proposals] }))
        return { proposals: proposals.length, drafts: drafts.length, skipped }
      },

      rejectProposal: (pid) => {
        const p = get().proposals.find((x) => x.id === pid)
        const e = get().expertise.find((x) => x.id === p?.expertiseId)
        const block = reviewBlock(get().user, e?.domain, p)
        if (block) { get().showToast(block); return }
        set((s) => ({ proposals: s.proposals.filter((x) => x.id !== pid) }))
        get().showToast('Proposal rejected')
      },

      resetDemo: () => {
        set({ chats: SEED_CHATS, expertise: withSnapshots(SEED_EXPERTISE), proposals: SEED_PROPOSALS, selectedModels: ['auto'] })
        get().showToast('Demo data reset')
      },
    }),
    {
      name: 'fractal-store',
      version: 3,
      // v3 adds portfolio fixtures once without overwriting existing work.
      migrate: (state, version) => migrateDemoState(state, version, withSnapshots(PORTFOLIO_EXPERTISE), PORTFOLIO_PROPOSALS),
      partialize: (s) => ({
        chats: s.chats,
        expertise: s.expertise,
        proposals: s.proposals,
        settings: s.settings,
        session: s.session,
        selectedModels: s.selectedModels,
      }),
      // Any stream interrupted by a reload is marked finished.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // The active account comes from the session only; no session → sign-in page.
        const session = state.session?.signedIn ? state.session : { activeId: null, signedIn: [] }
        state.session = { ...session, signedIn: session.signedIn.filter((id) => userById(id)) }
        state.user = userById(state.session.activeId)
        setActiveEmail(state.user?.email || null)
        state.chats = state.chats.map((c) => ({
          ...c,
          messages: c.messages.map((m) => {
            if (!m.responses) return m
            const out = { ...m, responses: m.responses.map((r) => ({ ...r, streaming: false })) }
            // a capture check interrupted by a reload is simply dropped
            return out.detectionState === 'checking' ? { ...out, detectionState: null } : out
          }),
        }))
      },
    },
  ),
)

// Chats belong to the account that started them; older/seed chats belong to the Reviewer demo account.
export const chatOwner = (c) => c.ownerId || 'u-adrian'

// Queue items the signed-in account can see: everything for the Reviewer, own domains for experts.
export const queueFor = (s) => {
  const u = s.user
  const domainOf = (id) => s.expertise.find((e) => e.id === id)?.domain
  return {
    inReview: s.expertise.filter((e) => e.status === 'in_review' && seesQueue(u, e.domain)),
    drafts: s.expertise.filter((e) => e.status === 'draft' && seesQueue(u, e.domain)),
    proposals: s.proposals.filter((p) => seesQueue(u, domainOf(p.expertiseId))),
  }
}

export const reviewCount = (s) => {
  if (!s.user) return 0
  const q = queueFor(s)
  return q.inReview.length + q.drafts.filter((e) => e.origin === 'auto-detected').length + q.proposals.length
}
