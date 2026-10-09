import { supabase } from './supabase'

async function call(body) {
  if (!supabase) throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.')
  const { data, error } = await supabase.functions.invoke('meetings', { body })
  if (error) {
    // surface the function's own error message when there is one
    let msg = error.message
    try { msg = (await error.context?.json())?.error || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

/**
 * Step 2: send amended transcript + parsed files to Claude (via Edge Function). Nothing is stored.
 * `expertise` (catalog) and `taxonomy` feed the category selector, which returns `insights.expertise_links`.
 */
export async function generateInsights({ transcript, files, expertise = [], taxonomy = [] }) {
  const { insights } = await call({ action: 'insights', transcript, files, expertise, taxonomy })
  return insights
}

/** Step 3: persist the approved record. Only called on "Approve & Save". */
export async function saveMeeting(record) {
  const { meeting } = await call({ action: 'save', record })
  return meeting
}

/** Recent approved meetings (read-only). */
export async function listMeetings(limit = 10) {
  const { meetings } = await call({ action: 'list', limit })
  return meetings
}
