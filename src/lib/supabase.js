import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// null when env vars are missing → services fall back to localStorage
export const supabase = url && key ? createClient(url, key, { auth: { persistSession: true } }) : null
export const hasSupabase = !!supabase
