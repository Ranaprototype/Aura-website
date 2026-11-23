import { z } from "zod";

/** A server-verified external identity. Never constructed from a request body. */
export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
}

export interface IdentityProvider {
  /** Verifies an upstream access token. Throws on any doubt. */
  verify(accessToken: string): Promise<VerifiedIdentity>;
}

const userShape = z.object({
  id: z.string().min(1).max(200),
  email: z.string().max(320).optional(),
  email_confirmed_at: z.string().max(64).nullish(),
  confirmed_at: z.string().max(64).nullish(),
});

const checkedJson: typeof fetch = async (input, init) => {
  const response = await fetch(input, { ...init, redirect: "error" });
  const mime = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (response.status !== 200 || mime !== "application/json") {
    await response.body?.cancel();
    throw new Error("Identity verification failed");
  }
  return response;
};

/**
 * Verifies a Supabase access token against the issuer's `/auth/v1/user`
 * endpoint. The subject comes from the provider response, never from the
 * browser: a token that the provider rejects cannot become a principal.
 */
export function createSupabaseIdentityProvider({
  url,
  anonKey,
  timeoutMs = 3_000,
}: {
  url: string;
  anonKey: string;
  timeoutMs?: number;
}): IdentityProvider {
  const base = new URL(url);
  const target = new URL("/auth/v1/user", base);
  return {
    async verify(accessToken) {
      if (
        typeof accessToken !== "string" ||
        accessToken.length < 20 ||
        accessToken.length > 4096
      )
        throw new Error("Identity verification failed");
      const response = await checkedJson(target, {
        method: "GET",
        headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const parsed = userShape.safeParse(await response.json());
      if (!parsed.success || !parsed.data.email)
        throw new Error("Identity verification failed");
      const email = parsed.data.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
        throw new Error("Identity verification failed");
      return {
        issuer: "supabase",
        subject: parsed.data.id,
        email,
        emailVerified: Boolean(
          parsed.data.email_confirmed_at ?? parsed.data.confirmed_at
        ),
      };
    },
  };
}
