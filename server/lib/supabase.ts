import { createClient } from "@supabase/supabase-js";
import type { loadConfig } from "../config";

export interface DiagnosticsStore {
  ready(): Promise<void>;
  recent(): Promise<unknown[]>;
  add(message: string): Promise<unknown>;
}

export function createStore(
  database: ReturnType<typeof loadConfig>["database"]
): DiagnosticsStore | undefined {
  if (!database) return;
  const client = createClient(database.url, database.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const fields = "id,message,created_at";
  return {
    async ready() {
      await client
        .from("hello")
        .select("id", { head: true })
        .limit(1)
        .abortSignal(AbortSignal.timeout(2500))
        .throwOnError();
    },
    async recent() {
      const { data } = await client
        .from("hello")
        .select(fields)
        .order("created_at", { ascending: false })
        .limit(50)
        .abortSignal(AbortSignal.timeout(2500))
        .throwOnError();
      return data ?? [];
    },
    async add(message) {
      const { data } = await client
        .from("hello")
        .insert({ message })
        .select(fields)
        .abortSignal(AbortSignal.timeout(2500))
        .single()
        .throwOnError();
      return data;
    },
  };
}
