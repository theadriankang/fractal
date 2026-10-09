import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// The Meeting Recorder requires Supabase (insights + saving run in an Edge Function).
export const supabase = url && key ? createClient(url, key) : null
export const hasSupabase = !!supabase
