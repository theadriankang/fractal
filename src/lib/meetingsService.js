import { supabase } from './supabase'

/**
 * Meetings persistence. Uses Supabase when configured, otherwise localStorage
 * so the demo still works offline. All functions return the saved row.
 *
 * Row shape: { id, user_id, title, transcript_text, duration, created_at }
 */

const LS_KEY = 'fractal-meetings'
const lsAll = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || [] } catch { return [] } }
const lsSave = (rows) => { try { localStorage.setItem(LS_KEY, JSON.stringify(rows)) } catch { /* quota / private mode */ } }

// The app has no login screen yet, so fall back to an anonymous Supabase session
// (enable "Anonymous sign-ins" in Supabase → Authentication → Providers).
async function ensureUser() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user) return session.user
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return data.user
}

export async function createMeeting({ title }) {
  if (!supabase) {
    const row = { id: crypto.randomUUID(), user_id: 'local', title, transcript_text: '', duration: 0, created_at: new Date().toISOString() }
    lsSave([row, ...lsAll()])
    return row
  }
  const user = await ensureUser()
  const { data, error } = await supabase
    .from('meetings')
    .insert({ user_id: user.id, title, transcript_text: '', duration: 0 })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMeeting(id, patch) {
  if (!supabase) {
    const rows = lsAll().map((r) => (r.id === id ? { ...r, ...patch } : r))
    lsSave(rows)
    return rows.find((r) => r.id === id)
  }
  const { data, error } = await supabase.from('meetings').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function listMeetings(limit = 20) {
  if (!supabase) return lsAll().slice(0, limit)
  await ensureUser()
  const { data, error } = await supabase
    .from('meetings')
    .select('id, title, transcript_text, duration, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

export async function deleteMeeting(id) {
  if (!supabase) return lsSave(lsAll().filter((r) => r.id !== id))
  const { error } = await supabase.from('meetings').delete().eq('id', id)
  if (error) throw error
}
