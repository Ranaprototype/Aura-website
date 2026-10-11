import { createClient } from "@supabase/supabase-js";

// Browser client only. Never pass the Supabase service-role key to this module.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey
  ? createClient(url, anonKey)
  : null;

export function requireSupabaseBrowser() {
  if (!supabase) {
    throw new Error("Supabase browser client is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  return supabase;
}
