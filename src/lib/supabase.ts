import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    /* Sign-in issues a real JWT now, so the session has to survive a reload —
       otherwise a refresh drops the user out of the console mid-task. */
    persistSession: true,
    autoRefreshToken: true,
  },
})
