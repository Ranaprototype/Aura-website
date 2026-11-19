import { z } from "zod";

import { apiPort } from "./environment";

function safeKey(key: string) {
  if (/^sb_publishable_[\w-]+$/.test(key)) return true;
  try {
    const parts = key.split(".");
    return (
      parts.length === 3 &&
      JSON.parse(Buffer.from(parts[1], "base64url").toString()).role === "anon"
    );
  } catch {
    return false;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv) {
  const config = z
    .object({
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
      SUPABASE_URL: z.string().url().optional(),
      SUPABASE_ANON_KEY: z.string().refine(safeKey).optional(),
      LOCAL_DIAGNOSTIC_TOKEN: z.string().min(32).optional(),
    })
    .safeParse(env);
  if (!config.success) throw new Error("Invalid server configuration");
  const { NODE_ENV, SUPABASE_URL, SUPABASE_ANON_KEY, LOCAL_DIAGNOSTIC_TOKEN } =
    config.data;
  if (Boolean(SUPABASE_URL) !== Boolean(SUPABASE_ANON_KEY))
    throw new Error("Database settings must be supplied together");
  const url = SUPABASE_URL ? new URL(SUPABASE_URL) : undefined;
  const local = url && ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url &&
    (url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(url.protocol === "https:" || (local && url.protocol === "http:")))
  )
    throw new Error("Invalid database URL");
  if (LOCAL_DIAGNOSTIC_TOKEN && (!local || NODE_ENV === "production"))
    throw new Error(
      "Diagnostics require a local test database outside production"
    );
  return {
    port: apiPort(env.PORT),
    database:
      SUPABASE_URL && SUPABASE_ANON_KEY
        ? { url: SUPABASE_URL, key: SUPABASE_ANON_KEY }
        : undefined,
    diagnosticToken: LOCAL_DIAGNOSTIC_TOKEN,
  };
}
