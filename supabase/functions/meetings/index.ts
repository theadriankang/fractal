import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Deployed to Supabase project "fractal-meetings" as the `meetings` Edge Function.
// Actions:
//  POST { action: "insights", transcript, files: [{ name, kind: "text"|"pdf"|"image", mediaType?, data }],
//         expertise?: [{ id, name, domain, topic, summary, whenToUse, keywords }], taxonomy?: [{ domain, topics }] }
//       -> { insights } (structured, from Claude). Nothing is stored; files are discarded after the call.
//       Two-stage pipeline: (1) extract summary / takeaways / actions, then (2) a "category selector" pass
//       that routes each reusable takeaway to the Expertise it belongs to (or proposes a new one).
//  POST { action: "save", record } -> { meeting } (inserted with status 'approved'; records who saved it:
//       the Supabase session user when there is one, else record.recorded_by / recorded_by_id from the demo sign-in)
//  POST { action: "list", limit? } -> { meetings } (recent approved meetings, read-only)
// Secrets: ANTHROPIC_API_KEY (required), CLAUDE_MODEL (optional override).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5-5";
// The category selector is a smaller classification task; it can run on a cheaper model if desired.
const CATEGORY_MODEL = Deno.env.get("CLAUDE_CATEGORY_MODEL") ?? MODEL;
const MAX_TRANSCRIPT = 200_000;
const MAX_CATALOG = 200;
const FIELDS = ["knowledge", "decisionLogic", "guardrails", "escalation"] as const;

async function callClaude(key: string, model: string, system: string, tool: any, content: any[], maxTokens: number) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      tools: [tool],
      // Newer Claude models reject forced tool_choice ("tool"/"any"); "auto" + the system rule still yields a tool call.
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Claude API error (${res.status})`);
  return data.content?.find((c: any) => c.type === "tool_use")?.input ?? null;
}

const INSIGHTS_TOOL = {
  name: "record_meeting_insights",
  description: "Record the structured insights derived from the meeting transcript and attached context files.",
  input_schema: {
    type: "object",
    properties: {
      cleaned_transcript: { type: "string", description: "The transcript verbatim in meaning and order, with filler words (um, uh, like, you know), false starts and stutters removed. Do not summarise or add content." },
      summary: { type: "string", description: "2-3 concise paragraphs (separated by a blank line) giving an overview of the meeting, using the attached files for background where relevant." },
      key_takeaways: { type: "array", items: { type: "string" }, description: "Key takeaways and decisions, each grounded in the transcript or attached files." },
      action_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            task: { type: "string" },
            owner: { type: "string", description: "Person responsible, or 'Unassigned' if not stated." },
            due_date: { type: "string", description: "Deadline as stated (ISO date if a specific date is given), or 'Not specified'." },
          },
          required: ["task", "owner", "due_date"],
        },
      },
    },
    required: ["cleaned_transcript", "summary", "key_takeaways", "action_items"],
  },
};

const SYSTEM = `You are a meticulous meeting analyst for a real-estate asset & facilities management team.
You receive a meeting transcript produced by speech recognition (then corrected by the user) and optional context files.
Rules:
- Ground every takeaway and action item in the transcript or the files. Never invent people, numbers, dates or decisions.
- Use the files only as background context; the transcript is the record of what was said.
- If something is ambiguous, say so rather than guessing.
- Always respond by calling the record_meeting_insights tool.`;

// ---------------------------------------------------------------- stage 2: category selector
const CATEGORY_TOOL = {
  name: "assign_expertise_categories",
  description: "Route each reusable key takeaway to the Expertise (knowledge module) it should update.",
  input_schema: {
    type: "object",
    properties: {
      assignments: {
        type: "array",
        description: "One entry per (takeaway, expertise) pair. Omit takeaways that carry no reusable know-how.",
        items: {
          type: "object",
          properties: {
            takeaway_index: { type: "integer", description: "0-based index into the numbered takeaways." },
            expertise_id: { type: "string", description: "id of an existing Expertise from the catalog, or \"NEW\" if none fits." },
            field: { type: "string", enum: [...FIELDS], description: "knowledge = facts/heuristics/thresholds; decisionLogic = an ordered procedure step; guardrails = something that must never be done/recommended; escalation = when a human or specialist must take over." },
            entry: { type: "string", description: "The line to add to that Expertise: a standalone, reusable statement written for a future engineer, with no meeting-specific chatter. Keep every number, unit and condition exactly as stated; add nothing new." },
            confidence: { type: "number", description: "0-1: how sure you are this takeaway belongs in this Expertise and field." },
            rationale: { type: "string", description: "One short sentence on why this Expertise and field." },
            new_expertise: {
              type: "object",
              description: "Required only when expertise_id is \"NEW\".",
              properties: {
                name: { type: "string" },
                domain: { type: "string", description: "Must be one of the taxonomy domains." },
                topic: { type: "string", description: "Prefer an existing topic of that domain." },
              },
              required: ["name", "domain", "topic"],
            },
          },
          required: ["takeaway_index", "expertise_id", "field", "entry", "confidence", "rationale"],
        },
      },
    },
    required: ["assignments"],
  },
};

const CATEGORY_SYSTEM = `You are the category selector for Fractal, a governed library of reusable expert know-how ("Expertise") for real-estate asset & facilities management.
You receive numbered key takeaways from a meeting, the Expertise catalog and the domain taxonomy. Decide which takeaways should update which Expertise.
Rules:
- Only route takeaways that contain REUSABLE know-how: heuristics, thresholds, root causes, procedures, rules, lessons learned, escalation criteria. Skip one-off logistics, greetings, status updates, scheduling and decisions that only matter for this meeting.
- Prefer an existing Expertise whose scope (name, summary, when-to-use) clearly covers the takeaway. A takeaway may go to at most 2 Expertise.
- Use "NEW" only when the know-how is clearly reusable and nothing in the catalog fits; then give a concise name and a domain/topic from the taxonomy.
- Rewrite the takeaway as an entry that reads well inside that Expertise. Never invent numbers, people, equipment or rules that are not in the takeaway.
- If no takeaway is reusable, return an empty assignments array.
- Always respond by calling the assign_expertise_categories tool.`;

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");

function cleanCatalog(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_CATALOG).map((e: any) => ({
    id: str(e?.id, 80), name: str(e?.name, 200), domain: str(e?.domain, 80), topic: str(e?.topic, 80),
    summary: str(e?.summary, 400), whenToUse: str(e?.whenToUse, 300),
    keywords: Array.isArray(e?.keywords) ? e.keywords.slice(0, 15).map((k: unknown) => str(k, 40)) : [],
  })).filter((e) => e.id && e.name);
}

async function selectCategories(key: string, takeaways: string[], summary: string, catalog: any[], taxonomy: any[]) {
  const ids = new Set(catalog.map((e) => e.id));
  const domains = new Map<string, string[]>(
    taxonomy.map((t: any) => [str(t?.domain, 80), Array.isArray(t?.topics) ? t.topics.map((x: unknown) => str(x, 80)) : []]),
  );
  const catalogText = catalog.map((e) =>
    `- id: ${e.id} | ${e.name} | ${e.domain} › ${e.topic}\n  summary: ${e.summary}\n  when to use: ${e.whenToUse}\n  keywords: ${e.keywords.join(", ")}`).join("\n");
  const taxonomyText = [...domains].map(([d, ts]) => `- ${d}: ${ts.join(", ")}`).join("\n");
  const content = [{
    type: "text",
    text: `<taxonomy>\n${taxonomyText}\n</taxonomy>\n\n<expertise_catalog>\n${catalogText || "(empty)"}\n</expertise_catalog>\n\n<meeting_summary>\n${summary}\n</meeting_summary>\n\n<takeaways>\n${takeaways.map((t, i) => `[${i}] ${t}`).join("\n")}\n</takeaways>\n\nAssign the takeaways by calling the assign_expertise_categories tool.`,
  }];
  const out = await callClaude(key, CATEGORY_MODEL, CATEGORY_SYSTEM, CATEGORY_TOOL, content, 4000);
  if (!out || !Array.isArray(out.assignments)) throw new Error("Category selector returned an unexpected format.");

  // Validate against the catalog/taxonomy so the client never receives a dangling id or unknown domain.
  const seen = new Set<string>();
  return out.assignments.flatMap((a: any) => {
    const i = Number(a?.takeaway_index);
    if (!Number.isInteger(i) || i < 0 || i >= takeaways.length) return [];
    const field = FIELDS.includes(a?.field) ? a.field : "knowledge";
    const entry = str(a?.entry, 600).trim();
    if (!entry) return [];
    const confidence = Math.min(1, Math.max(0, Number(a?.confidence) || 0));
    let expertise_id: string | null = ids.has(a?.expertise_id) ? a.expertise_id : null;
    let new_expertise = null;
    if (!expertise_id) {
      const ne = a?.new_expertise ?? {};
      const validDomain = domains.has(ne.domain);
      const domain = validDomain ? ne.domain : [...domains.keys()][0] ?? "Asset Operations";
      // keep a new topic name only if the domain itself was valid; otherwise fall back to that domain's first topic
      const topic = (validDomain && str(ne.topic, 80).trim()) || (domains.get(domain)?.[0] ?? "General");
      new_expertise = { name: str(ne.name, 120).trim() || entry.slice(0, 60), domain, topic };
    }
    const dedupe = `${i}|${expertise_id ?? new_expertise!.name}|${field}`;
    if (seen.has(dedupe)) return [];
    seen.add(dedupe);
    return [{ takeaway_index: i, expertise_id, new_expertise, field, entry, confidence, rationale: str(a?.rationale, 300) }];
  });
}

async function insights(body: any) {
  const transcript = String(body.transcript ?? "").trim();
  if (!transcript) return json({ error: "Transcript is empty." }, 400);
  if (transcript.length > MAX_TRANSCRIPT) return json({ error: "Transcript is too long." }, 413);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY is not set on the server." }, 500);

  const files = Array.isArray(body.files) ? body.files.slice(0, 5) : [];
  const content: any[] = [];
  for (const f of files) {
    const name = String(f.name ?? "file");
    if (f.kind === "pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: name });
    } else if (f.kind === "image") {
      content.push({ type: "text", text: `Attached image: ${name}` });
      content.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } });
    } else {
      content.push({ type: "text", text: `<context_file name="${name}">\n${String(f.data).slice(0, 100_000)}\n</context_file>` });
    }
  }
  content.push({ type: "text", text: `<transcript>\n${transcript}\n</transcript>\n\nDerive the meeting insights by calling the record_meeting_insights tool.` });

  // Stage 1: extraction
  let out: any;
  try {
    out = await callClaude(key, MODEL, SYSTEM, INSIGHTS_TOOL, content, 8000);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
  if (!out) return json({ error: "Claude answered without using the insights tool. Please try again." }, 502);
  const ok = typeof out.cleaned_transcript === "string" && typeof out.summary === "string" &&
    Array.isArray(out.key_takeaways) && Array.isArray(out.action_items);
  if (!ok) return json({ error: "Claude returned an unexpected format. Please try again." }, 502);

  // Stage 2: category selector. Failure here never blocks the meeting insights.
  out.expertise_links = [];
  const catalog = cleanCatalog(body.expertise);
  const taxonomy = Array.isArray(body.taxonomy) ? body.taxonomy.slice(0, 20) : [];
  if (out.key_takeaways.length && (catalog.length || taxonomy.length)) {
    try {
      out.expertise_links = await selectCategories(key, out.key_takeaways.map(String), out.summary, catalog, taxonomy);
    } catch (e) {
      out.category_error = (e as Error).message;
    }
  }
  return json({ insights: out });
}

// The signed-in Supabase user behind this request, if any (the anon key alone is not a user).
async function sessionUser(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await db.auth.getUser(token);
    return data?.user ?? null;
  } catch {
    return null;
  }
}

async function save(body: any, req: Request) {
  const r = body.record ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const row = {
    title: str(r.title).slice(0, 200) || "Meeting",
    raw_transcript: str(r.raw_transcript),
    cleaned_transcript: str(r.cleaned_transcript),
    attached_files: Array.isArray(r.attached_files) ? r.attached_files.map((f: any) => ({ filename: str(f?.filename) })) : [],
    summary: str(r.summary),
    key_takeaways: Array.isArray(r.key_takeaways) ? r.key_takeaways.map(str) : [],
    action_items: Array.isArray(r.action_items)
      ? r.action_items.map((a: any) => ({ task: str(a?.task), owner: str(a?.owner), due_date: str(a?.due_date) }))
      : [],
    // Takeaway → Expertise routing the user accepted (audit trail for the proposals it created).
    expertise_links: Array.isArray(r.expertise_links)
      ? r.expertise_links.slice(0, 100).map((l: any) => ({
        takeaway_index: Number.isInteger(l?.takeaway_index) ? l.takeaway_index : null,
        expertise_id: l?.expertise_id ? str(l.expertise_id) : null,
        expertise_name: str(l?.expertise_name),
        field: str(l?.field),
        entry: str(l?.entry),
        confidence: Number.isFinite(l?.confidence) ? l.confidence : null,
      }))
      : [],
    duration: Number.isFinite(r.duration) ? Math.max(0, Math.round(r.duration)) : 0,
    status: "approved",
    // Who recorded it. A real Supabase session wins over the name the browser sends (demo sign-in).
    recorded_by: str(r.recorded_by).slice(0, 120),
    recorded_by_id: str(r.recorded_by_id).slice(0, 80),
    user_id: null as string | null,
  };
  const user = await sessionUser(req);
  if (user) {
    row.user_id = user.id;
    row.recorded_by_id = user.id;
    row.recorded_by ||= str(user.user_metadata?.name) || str(user.email);
  }
  if (!row.raw_transcript.trim()) return json({ error: "Transcript is empty." }, 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db.from("meetings").insert(row).select().single();
  if (error) return json({ error: error.message }, 500);
  return json({ meeting: data });
}

async function list(body: any) {
  const limit = Math.min(50, Math.max(1, Number(body.limit) || 10));
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db.from("meetings")
    .select("id, title, raw_transcript, cleaned_transcript, attached_files, summary, key_takeaways, action_items, expertise_links, duration, recorded_by, recorded_by_id, created_at")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) return json({ error: error.message }, 500);
  return json({ meetings: data });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    if (body.action === "insights") return await insights(body);
    if (body.action === "save") return await save(body, req);
    if (body.action === "list") return await list(body);
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
