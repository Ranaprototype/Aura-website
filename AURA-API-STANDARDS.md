# Phase 0 HTTP contract

All browser API URLs are relative to `/api`. Unknown API paths return JSON 404, never the SPA or a fabricated success. API responses are `no-store`; generic failures are `{"error":"stable_code"}`. No SQL/provider details or sensitive request bodies in responses. HTML deep links render UI only. No checkout, order, payment, session, admin or seller operations exist.

| Endpoint | Contract |
|---|---|
| `GET /api/health/live` | 200 `{"status":"alive"}`; no DB access. |
| `GET /api/health/ready` | 200 `{"status":"ready"}` after bounded DB check; 503 `not_ready` if unconfigured or failed. |
| `GET /api/health` | Compatibility path for readiness; **new payload**, no diagnostic detail. Update external consumers before use. |
| `GET /api/hello` | Explicit local operator only: up to 50 newest diagnostic rows under `data`. |
| `POST /api/hello` | Same operator. JSON object containing **only** `message`: trimmed string, 1–200 chars, body limit 4 KiB. 201 with inserted row under `data` only after the store responds. |

Message diagnostics are off by default (404 `not_found`). Enabling requires a literal loopback Supabase URL, a configured publishable/anon key, a private operator token of at least 32 characters and a non-production environment. Use an isolated database and synthetic messages only. CLI sends `Authorization: Bearer <operator secret>`; requests with Origin or bad credentials return 403 `forbidden`. The browser diagnostic page only requests readiness. No browser token prompt. Disabled endpoints do not parse bodies. Malformed JSON → 400 `invalid_json`; schema failure → 400 `invalid_message`; oversize → 413 `payload_too_large`; wrong media type → 415 `unsupported_media_type`; store failure → 503 `database_unavailable`. Unexpected errors receive a generic 500.

Retired `/__manus__` and `/manus-storage` paths return 410. Only recognized storefront document paths fall back to the SPA; missing static assets return 404. A successful diagnostic insert requires upstream HTTP 201 and a returned object with a UUID, timestamp and the submitted message. Malformed or absent representations are not successes. A timeout does not prove that a write was rolled back; do not automatically replay it.

Future sensitive APIs require independent identity, authorization checks for the specific resource, rate limits, structured validation and audited, idempotent mutations. A DB row, UI flag or localhost address alone is never proof of authorization.
