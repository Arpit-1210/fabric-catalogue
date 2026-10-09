import { createClient } from '@supabase/supabase-js';

export const HAS_KEYS = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

// Only the public (anon) key is ever used here. All real protection is in the database rules.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://missing.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'missing',
  { auth: { persistSession: true, autoRefreshToken: true } }
);
