import { createBrowserClient } from '@supabase/ssr'

const supabaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createBrowserClient(supabaseURL, supabaseAnonKey)