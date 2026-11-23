/**
 * Minimal same-origin client for the Phase 2 API. The CSRF token is read from
 * the readable double-submit cookie; the session cookie stays HttpOnly and is
 * never touched by JavaScript.
 */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
  error?: string;
}

export const csrfToken = () => {
  const match = document.cookie.match(/(?:^|;\s*)aura_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
};

export async function api<T = unknown>(
  path: string,
  {
    method = "GET",
    body,
    org,
  }: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; org?: string } = {}
): Promise<ApiResult<T>> {
  const token = csrfToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["x-csrf-token"] = token;
  if (org) headers["x-aura-org"] = org;
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = undefined;
  try {
    data = await response.json();
  } catch {
    data = undefined;
  }
  return {
    ok: response.ok,
    status: response.status,
    data: data as T,
    error:
      !response.ok && data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : undefined,
  };
}

export interface SessionInfo {
  authenticated: boolean;
  principal?: {
    id: string;
    email: string;
    displayName: string | null;
    emailVerified: boolean;
  };
  organizations?: Array<{ id: string; name: string; slug: string; role: string }>;
}

/** Establishes the double-submit cookie on a fresh browser before any POST. */
export async function loadSession(): Promise<SessionInfo> {
  const result = await api<SessionInfo>("/auth/session");
  return result.ok ? result.data : { authenticated: false };
}
