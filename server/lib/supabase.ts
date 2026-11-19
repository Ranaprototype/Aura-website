import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { loadConfig } from "../config";

const idRow = z.object({ id: z.uuid() });
const messageRow = idRow.extend({
  message: z.string(),
  created_at: z.iso.datetime({ offset: true }),
});
type MessageRow = z.infer<typeof messageRow>;
export interface DiagnosticsStore {
  ready(): Promise<void>;
  recent(): Promise<MessageRow[]>;
  add(message: string): Promise<MessageRow>;
}

// Check the wire response BEFORE PostgREST JS can normalize an empty 404 to 204.
// This client is private to the diagnostics adapter and performs only reads and inserts.
const checkedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, { ...init, redirect: "error" });
  const method = init?.method?.toUpperCase();
  const validStatus =
    method === "POST"
      ? response.status === 201
      : method === "GET" && [200, 206].includes(response.status);
  const mime = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (
    !validStatus ||
    (mime !== "application/json" &&
      mime !== "application/vnd.pgrst.object+json")
  ) {
    await response.body?.cancel();
    throw new Error("Invalid database response");
  }
  return response;
};

export function createStore(
  database: ReturnType<typeof loadConfig>["database"]
): DiagnosticsStore | undefined {
  if (!database) return;
  const client = createClient(database.url, database.key, {
    global: { fetch: checkedFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const fields = "id,message,created_at";
  return {
    async ready() {
      const { data } = await client
        .from("hello")
        .select("id")
        .limit(1)
        .retry(false)
        .abortSignal(AbortSignal.timeout(2500))
        .throwOnError();
      z.array(idRow).max(1).parse(data);
    },
    async recent() {
      const { data } = await client
        .from("hello")
        .select(fields)
        .order("created_at", { ascending: false })
        .limit(50)
        .retry(false)
        .abortSignal(AbortSignal.timeout(2500))
        .throwOnError();
      return z.array(messageRow).max(50).parse(data);
    },
    async add(message) {
      const { data } = await client
        .from("hello")
        .insert({ message })
        .select(fields)
        .abortSignal(AbortSignal.timeout(2500))
        .single()
        .throwOnError();
      const row = messageRow.parse(data);
      if (row.message !== message)
        throw new Error("Unexpected inserted message");
      return row;
    },
  };
}
