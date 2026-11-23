import type { Response } from "express";

export const SESSION_COOKIE = "aura_session";
export const CSRF_COOKIE = "aura_csrf";

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!/^[\w-]{1,64}$/.test(name) || value.length > 512) continue;
    if (!(name in out)) out[name] = value;
  }
  return out;
}

export function setCookie(
  res: Response,
  name: string,
  value: string,
  {
    maxAge,
    httpOnly,
    secure,
    sameSite = "Lax",
    path = "/",
  }: {
    maxAge: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: "Lax" | "Strict";
    path?: string;
  }
) {
  const attributes = [
    `${name}=${value}`,
    `Path=${path}`,
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) attributes.push("HttpOnly");
  if (secure) attributes.push("Secure");
  const previous = res.getHeader("Set-Cookie");
  const list = Array.isArray(previous)
    ? previous
    : typeof previous === "string"
      ? [previous]
      : [];
  res.setHeader("Set-Cookie", [...list, attributes.join("; ")]);
}

export function clearCookie(
  res: Response,
  name: string,
  { secure, httpOnly }: { secure: boolean; httpOnly: boolean }
) {
  setCookie(res, name, "", { maxAge: 0, httpOnly, secure });
}
