import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// The Meeting Recorder requires Supabase (insights + saving run in an Edge Function).
// Sign-in (src/data/users.js::signIn) also uses this client to get a real session whose
// access token the backend verifies (backend/app/auth.py) — see docs/BUILD_PROMPTS.md Prompt 8.
// persistSession/autoRefreshToken are off because the store manages multiple concurrent
// accounts itself (src/store.js session.tokens); supabase-js only ever holds "whichever
// account is active right now", set explicitly via setSession when switching accounts.
export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null
export const hasSupabase = !!supabase
