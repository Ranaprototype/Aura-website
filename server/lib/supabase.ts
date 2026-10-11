import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// supabaseAdmin bypasses RLS. Never expose this client to the browser.
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function getSupabaseAnon(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "Supabase server anon client is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY."
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
