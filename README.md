# Fractal

**One workspace for every frontier model — and a governed memory of how your experts actually work.**

Fractal is a multi-model AI chat platform (Claude, GPT, Gemini, Grok, Tencent Hunyuan, DeepSeek) with a built-in **Expertise** layer: reusable, versioned, human-approved know-how that is captured from everyday conversations and applied automatically to future answers — on any model.

Built for the **Tencent Cloud AI CAN DO IT Hackathon 2026 — Real Estate Track (Keppel): "AI HARVEST"**, where Expertise = Keppel's *Intelligence Pills*.

> Status: **live, deployed**. Frontend on Vercel, backend on Cloud Run — real model calls (Claude, GPT, Gemini, Grok, Hunyuan, DeepSeek), real retrieval-backed Expertise matching, and a Postgres-backed (Supabase) store. See [Architecture](#architecture) for the real API.
>
> - Frontend: https://fractal-delta.vercel.app
> - Backend: https://fractal-backend-422044745328.asia-southeast1.run.app (health check at `/api/health`)

---

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build → dist/
```

Requires Node 18+. By default the frontend talks to the live backend (set `VITE_API_BASE` in `.env` to point at a local or deployed instance; `VITE_USE_MOCK=true` switches to an on-stage, localStorage-only fallback with no backend required). Data lives in Postgres (Supabase) via the backend. **User menu → Reset demo data** restores the seed data.

The demo includes **55 fictional Expertise records** across all 6 domains, 19 topics
and 4 asset types, plus **5 revision proposals**. Reloading an existing v2 demo adds
the 38 new portfolio records without overwriting saved edits, chats or settings.
Reset demo data restores the complete fixture set, including the review queue.
The added playbooks and source documents are testing fixtures, not verified site procedures.

Try these scenarios to exercise the expanded library:

- Search `condensate`, `loading dock`, `recycling`, or `fit-out`; combine with asset-type filters.
- Compare `UPS Battery Health Trend Review` (in review) with `UPS Maintenance Window Planning` (draft).
- Turn off **Live only** to find retired escalator, rent and carbon guidance and their replacement links.
- Open an approved portfolio record to compare three versions, inspect sources and feedback, or test rollback.
- In Review Queue, approve/reject a proposal; the waste proposal tests removal and replacement of a decision step.
- In chat, try “Review the after-hours baseload” or “Prepare a new tenant handover checklist” for keyword retrieval.

Run `npm run validate:demo` to check fixture coverage, links, governance data,
retrieval and preservation of saved state during the demo upgrade.

---

## Features

### Chat (Open WebUI-style)
- **Model picker** — choose a specific model per provider, or **Auto** (recommended): Fractal classifies the prompt and routes it to the best model (coding → Claude Sonnet, live news → Grok, long docs → Gemini Pro, Chinese → Hunyuan…). The composer previews the route live as you type; each answer shows a badge for the chosen model and the reason.
- **Compare** — the **+** next to the model picker adds up to 3 models side by side.
- **Experts weighed together** — appears under an answer on its own, only when needed: the question names two areas or a trade-off ("…without upsetting tenants", "even though…"), or the experts behind it actually conflict. It shows each expert's view, where they agree, where one expert's idea runs into another's rule (quoting that rule, with the deciding factor), and suggestions that still show what every expert thinks of them. Backend: `POST /api/expertise/weigh` with `auto: true` (`backend/app/weigh/`).
- **Expertise applied** chips under every answer show which Expertise (and which version) grounded it — click through to the source.
- **`#` in the composer** attaches a specific approved Expertise manually.
- Attach files, copy, regenerate, 👍/👎.
- **👎 + correction** → becomes a *proposed revision* in the Review Queue.
- **"Fractal noticed reusable know-how"** card — when someone *shares* know-how in a chat ("we always…", "in my experience…"), Fractal offers to save it as a draft Expertise (or a revision to an existing one), with the conversation linked as a source.

### Expertise (docs-style knowledge base)
Organised as **Domain → Topic → Expertise** (taxonomy in `src/data/taxonomy.js`), with **asset type** (Office, Data Centre, Logistics, Retail) as a cross-cutting filter.
- **Left nav tree** — collapsible domains and topics, counts, status dots, search, asset-type filter, "Live only" toggle.
- **Overview** — stats, domain cards, recently updated, most applied.
- **Domain pages** — every topic in the domain with its Expertise listed; "+ Add" creates Expertise pre-filed in that topic.
- **Expertise page** (one scrolling doc) — breadcrumb, summary, metadata strip, When to use, Boundaries, Knowledge, Decision logic, Guardrails, Escalation, **Related Expertise** (cross-domain links), Sources, Feedback, Version history (diff + **roll back**), Previous/Next, and an **"On this page"** table of contents with scroll-spy.
- **Copy page** → copy/download as Markdown (SKILL.md-style) or JSON — portable and vendor-independent.
- **Edit** — domain/topic/asset types/owner/keywords + content. Editing a *live* Expertise creates a proposed revision instead.
- **Auto-placement** — Expertise detected in chat is pre-filed into a suggested domain › topic.

### Review Queue
- Submitted Expertise awaiting approval, proposed revisions (with diff), and drafts.
- **Roles** (switch in the user menu): *Contributor* can capture/edit/submit; *Reviewer* approves, rejects, deprecates, rolls back.

### Writing Assistant
- Open **Writing Assistant** in the sidebar, or **Summarize / draft email** on an approved Expertise page to preselect that reference.
- Select up to 10 approved Expertise pages. Search by name or content and filter by domain.
- **Summary** condenses the selected guidance; an optional instruction sets the focus.
- **Email draft** takes an employee's goal, recipient/audience and tone, then produces an editable subject and message. **Open in Gmail** opens a Gmail compose window with the subject, message and (if it is an email address) recipient filled in, so you review and send it yourself; messages too long for a link are copied for pasting. **Copy** works with any email app.
- Supporting references show the exact Expertise versions, owners and quoted passages. Missing details appear separately; dates and other unknowns use placeholders.
- Live generation uses Claude Sonnet via `POST /api/writing/generate`; start the backend with `ANTHROPIC_API_KEY` configured. Restart the backend after adding this endpoint.
- With `VITE_USE_MOCK=true`, a clearly labelled demo preview assembles source excerpts rather than claiming to generate tailored writing.
- Results stay in the current page session. This feature drafts text; it does not send email or change Expertise.

Check the frontend service with `npm run test:writing`. Run backend checks from
`backend/` with `.venv/bin/python -m unittest discover -s tests -v`.

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
7. Back in chat, 👎 an answer with a correction (e.g. *"Step 2 is out of date — we check the VSD fault log first"*) → the Review Queue shows a diagnosed **proposed revision** that rewrites that step in place → **Test change** compares old vs new answers on saved questions → approve → *learns through governed feedback* (see `docs/FEEDBACK_LOOP.md`).
8. **Compare** Claude vs GPT vs Hunyuan on the same prompt — same Expertise, any model → *portable*.
9. Ask *"Should we pre-cool Tower A from 7:00 on Mondays to cut the peak demand charge, even though the Level 23 tenant keeps complaining it's too warm?"* → under the answer, **Experts weighed together** shows Energy, Tenant Experience and Technical Services, the conflict, how to reconcile it, and who to loop in → *coordinates across domains, humans decide*. A plain question ("How do I triage a chiller alarm?") gets no weighing.

---

## Project structure

```
src/
  App.jsx                  routes + theme + toast
  store.js                 Zustand store: chats, expertise, proposals, settings, all actions
  data/
    models.js              providers, models, Auto router
    expertise.js           seed Expertise (Keppel domains), statuses
    chats.js               seed chats + suggestion prompts
  lib/
    api.js                 live backend client (streaming chat, Expertise match/detect, Weigh, insights, file uploads)
    mockApi.js              on-stage fallback only (VITE_USE_MOCK=true) — no backend required
  components/
    Sidebar.jsx  TopBar.jsx  ModelSelector.jsx  Composer.jsx  Message.jsx  SettingsModal.jsx  ui.jsx
  pages/
    ChatPage.jsx  ExpertiseLibrary.jsx  ExpertiseDetail.jsx  ReviewQueue.jsx  Insights.jsx

backend/
  app/
    main.py                 FastAPI app, CORS, router registration
    db.py  models.py         SQLAlchemy models, Postgres (Supabase) session
    seed.py  seed_data.json  demo fixture loader (seed_data.json is local-only, gitignored)
    llm/                     provider gateway (Claude, GPT, Gemini, Grok, Hunyuan, DeepSeek)
    retrieval/               Expertise matching (vector + keyword retrieval over approved records)
    capture/                 LLM extraction pass → draft Expertise / revision proposals
    loop/                    feedback loop: 👎 correction → diagnosed revision; before/after test (correct, replay, schemas)
    weigh/                   cross-domain / same-domain Expertise weighing (engine, schemas, select)
    insights/                adaptive CSV/XLSX analysis (long / wide / snapshot shape detection) + report rendering
    routers/                 chat, chats, expertise, proposals, loop, weigh, insights, capture, files, audit, writing, health
  scripts/                   one-off DB migration/patch scripts (run manually against the live DB)
```

## Architecture

The frontend (`src/lib/api.js`) talks to the deployed FastAPI backend over `VITE_API_BASE`:

| Area | Endpoint(s) | Purpose |
|---|---|---|
| Chat | `POST /api/chat/completions` (SSE) | Streams tokens from the chosen provider (Claude, GPT, Gemini, Grok, Hunyuan, DeepSeek), with matched Expertise injected into the system prompt |
| Expertise matching | `POST /api/expertise/match` | Retrieves relevant **approved** Expertise for a prompt (vector + keyword retrieval) |
| Expertise capture | `POST /api/expertise/detect` | LLM extraction pass over a chat → draft Expertise or revision proposal |
| Expertise CRUD | `/api/expertise`, `/api/proposals` | Persists Expertise, versions (snapshots), proposals, feedback; roles enforced server-side |
| Feedback loop | `POST /api/loop/correction`, `POST /api/loop/test` | Turns a 👎 correction into a minimal, diagnosed revision; tests the current vs proposed version on saved questions, graded blind |
| Cross-domain weighing | `POST /api/expertise/weigh` | When a question spans domains or experts conflict, surfaces each domain's view, the conflict, deciding factor, and suggestions |
| Data Insights | `/api/insights/...` | Upload a CSV/XLSX (any shape — long, wide, or point-in-time snapshot), auto-detect metric/category/period columns, flag outliers, render a chart + narrative |
| File uploads (chat) | `/api/files/...` | Accepts PDF, DOCX, XLSX, TXT, MD, CSV, and images as chat attachments |
| Health | `GET /api/health` | Liveness check |

The Expertise object shape is defined in `src/data/expertise.js`; the live schema is in `backend/app/models.py`.

Deployed infrastructure: frontend on **Vercel**, backend on **Google Cloud Run** (`asia-southeast1`), database on **Supabase** (Postgres).

## Hackathon notes
- The project must be built with **CodeBuddy or WorkBuddy**, with at least 3 chat-log screenshots (or API logs / a written description) as proof of usage — required for scoring regardless of how complete the project is.
- Submission deadline: **16 Oct 2026**.
