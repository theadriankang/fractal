import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Deployed to Supabase project "fractal-meetings" as the `meetings` Edge Function.
// Two actions:
//  POST { action: "insights", transcript, files: [{ name, kind: "text"|"pdf"|"image", mediaType?, data }] }
//       -> { insights } (structured, from Claude). Nothing is stored; files are discarded after the call.
//  POST { action: "save", record } -> { meeting } (inserted with status 'approved')
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
const MAX_TRANSCRIPT = 200_000;

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
  content.push({ type: "text", text: `<transcript>\n${transcript}\n</transcript>\n\nDerive the meeting insights.` });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: [INSIGHTS_TOOL],
      tool_choice: { type: "tool", name: INSIGHTS_TOOL.name },
      messages: [{ role: "user", content }],
    }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: data?.error?.message ?? `Claude API error (${res.status})` }, 502);
  const call = data.content?.find((c: any) => c.type === "tool_use");
  const out = call?.input;
  const ok = out && typeof out.cleaned_transcript === "string" && typeof out.summary === "string" &&
    Array.isArray(out.key_takeaways) && Array.isArray(out.action_items);
  if (!ok) return json({ error: "Claude returned an unexpected format. Please try again." }, 502);
  return json({ insights: out });
}

async function save(body: any) {
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
    duration: Number.isFinite(r.duration) ? Math.max(0, Math.round(r.duration)) : 0,
    status: "approved",
  };
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
    .select("id, title, raw_transcript, cleaned_transcript, attached_files, summary, key_takeaways, action_items, duration, created_at")
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
    if (body.action === "save") return await save(body);
    if (body.action === "list") return await list(body);
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
