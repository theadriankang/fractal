# Fractal

**One workspace for every frontier model — and a governed memory of how your experts actually work.**

Fractal is a multi-model AI chat platform (Claude, GPT, Gemini, Grok, Tencent Hunyuan, DeepSeek) with a built-in **Expertise** layer: reusable, versioned, human-approved know-how that is captured from everyday conversations and applied automatically to future answers — on any model.

Built for the **Tencent Cloud AI CAN DO IT Hackathon 2026 — Real Estate Track (Keppel): "AI HARVEST"**, where Expertise = Keppel's *Intelligence Pills*.

> Status: **front-end prototype**. All model calls are mocked (placeholder streaming responses). See [Backend contract](#backend-contract) for what the API needs to provide.

---

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build → dist/
```

Requires Node 18+. Data persists in your browser (localStorage). **User menu → Reset demo data** restores the seed data.

---

## Features

### Chat (Open WebUI-style)
- **Model picker** — choose a specific model per provider, or **Auto** (recommended): Fractal classifies the prompt and routes it to the best model (coding → Claude Sonnet, live news → Grok, long docs → Gemini Pro, Chinese → Hunyuan…). The composer previews the route live as you type; each answer shows a badge for the chosen model and the reason.
- **Compare** — the **+** next to the model picker adds up to 3 models side by side.
- **Expertise applied** chips under every answer show which Expertise (and which version) grounded it — click through to the source.
- **`#` in the composer** attaches a specific approved Expertise manually.
- Attach files, toggle web search (UI only), copy, regenerate, 👍/👎.
- **👎 + correction** → becomes a *proposed revision* in the Review Queue.
- **"Fractal noticed reusable know-how"** card — when someone *shares* know-how in a chat ("we always…", "in my experience…"), Fractal offers to save it as a draft Expertise (or a revision to an existing one), with the conversation linked as a source.

### Expertise (left sidebar)
- **Library** — cards/list, filters by domain (Asset Ops, Energy, Leasing, Technical Services, Sustainability, Tenant Experience) and status (Draft → In Review → Approved → Deprecated), with usage stats.
- **Detail page** — Purpose, Knowledge & heuristics, Decision logic, Guardrails, Escalation rules; Governance (owner, reviewer, approval), Boundaries (may recommend / needs a human / must escalate), Usage, trigger keywords.
- **Versions** — full history, diff against current, **roll back** (Reviewer only).
- **Sources** — the conversations, expert interviews and documents it was learned from.
- **Feedback** — every 👍/👎 on answers that used it.
- **Export** to Markdown (SKILL.md-style) or JSON — knowledge stays portable and vendor-independent.
- **Edit** — editing a *live* Expertise creates a proposed revision instead of changing it directly.

### Review Queue
- Submitted Expertise awaiting approval, proposed revisions (with diff), and drafts.
- **Roles** (switch in the user menu): *Contributor* can capture/edit/submit; *Reviewer* approves, rejects, deprecates, rolls back.

### Settings
- Theme (light/dark/system), per-provider API keys + enable toggles, Auto routing table, Expertise behaviour (auto-apply, auto-detect; human approval always on).

---

## Demo script (≈3 min, maps to Keppel's judging points)

1. **Home → "Triage a chiller alarm"**. Auto routes to Claude Opus; the answer is grounded in *Chiller Plant Fault Triage v1.3* → *transparent, reusable*.
2. Click the **Expertise chip** → show owner, guardrails, escalation, boundaries → *accountable, clearly bounded*.
3. **Versions tab → Compare / Roll back** → *version-controlled*.
4. **New chat**: "When the lift at Tower B keeps stopping between floors, we always check the door lock contacts first. In my experience it's usually dust on the contacts, not the controller." → **Save as draft** → *captures undocumented know-how*.
5. Open the draft → **Edit** (add decision logic + guardrails) → **Submit for review**.
6. **Review Queue** → switch role to Contributor (approve is blocked) → switch to Reviewer → **Approve** → v1.0 is live → *human-supervised, governed*.
7. Back in chat, 👎 an answer with a correction → it appears as a **proposed revision** → *learns through governed feedback*.
8. **Compare** Claude vs GPT vs Hunyuan on the same prompt — same Expertise, any model → *portable*.

---

## Project structure

```
src/
  App.jsx                  routes + theme + toast
  store.js                 Zustand store: chats, expertise, proposals, settings, all actions
  data/
    models.js              providers, models, Auto router (mock)
    expertise.js           seed Expertise (Keppel domains), statuses
    chats.js               seed chats + suggestion prompts
  lib/
    mockApi.js             ← the ONLY place to swap for real API calls
  components/
    Sidebar.jsx  TopBar.jsx  ModelSelector.jsx  Composer.jsx  Message.jsx  SettingsModal.jsx  ui.jsx
  pages/
    ChatPage.jsx  ExpertiseLibrary.jsx  ExpertiseDetail.jsx  ReviewQueue.jsx
```

## Backend contract

`src/lib/mockApi.js` mocks these. Replace each with a `fetch` to the backend (suggested: FastAPI + LlamaIndex + a provider gateway such as LiteLLM, hosted on Tencent Cloud):

| Function | Suggested endpoint | Purpose |
|---|---|---|
| `routeAuto(prompt)` | `POST /api/route` | Classify prompt → `{ modelId, category, reason }` |
| `matchExpertise(prompt, …)` | `POST /api/expertise/match` | Retrieve relevant **approved** Expertise (LlamaIndex vector + keyword retrieval) |
| `buildReply` + `streamText` | `POST /api/chat/completions` (SSE) | Stream tokens from the chosen provider, with Expertise injected into the system prompt |
| `detectExpertise(prompt, chat, matched)` | `POST /api/expertise/detect` | LLM extraction pass → draft Expertise or revision proposal |
| store CRUD actions | `/api/expertise`, `/api/proposals` | Persist Expertise, versions (snapshots), proposals, feedback; enforce roles server-side |

The Expertise object shape is defined in `src/data/expertise.js`.

## Hackathon notes
- The project must be built with **CodeBuddy or WorkBuddy**, with at least 3 chat-log screenshots as proof — do the backend work in CodeBuddy and capture those screenshots as you go.
- Submission deadline: **16 Oct 2026**.
