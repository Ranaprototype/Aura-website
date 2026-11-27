# AURA Agent Operating Rules

**Status:** permanent operating procedure for every agent working on AURA.
**Baseline:** `master` = `b12a5596bf3b454b844c5d3b5bc83784247e300f` (2026-11-27).
**Companions:** [AURA-MASTER-SPECIFICATION.md](AURA-MASTER-SPECIFICATION.md) (product + decision register) · [AURA-COMPLETE-ROADMAP.md](AURA-COMPLETE-ROADMAP.md) (phase scope) · [AURA-PHASE-4-PLAN.md](AURA-PHASE-4-PLAN.md) (current phase design).

## 1. Permanent AURA Owner Authority Rule

The owner is the **sole product owner and decision-maker**. Agents are responsible for technical planning, engineering, implementation, testing and technical problem-solving **within the owner's approved requirements**.

- A recommendation is **never** approval. Silence is **never** approval.
- Do not reopen settled decisions. Previously approved requirements are preserved; never ask the owner to approve them again.
- Do not silently decide any unresolved product, business-rule, permission, exposure or privacy question. Consolidate questions in the master specification's decision register (§19) — one register, not scattered questions.
- Do not begin a phase's implementation before the phase is authorized and its Group-A decisions are answered.

## 2. Decision authority

### Agents MAY decide independently (routine engineering within approved requirements)

Internal function names; file/folder organisation; helper functions; internal implementation patterns; test organisation; safe refactoring; query optimisation; error-handling implementation; technical solutions that preserve approved behaviour; additional regression tests; documentation improvements that do not change approved policy.

Record these in the master specification register **Class II** (technical decisions already covered by approved requirements) so they are not reconsidered.

### Agents MUST obtain owner approval BEFORE changing

Product behaviour; business rules; public data exposure; privacy/disclosure policies; user permissions; security boundaries; approved architecture; phase scope; existing user-facing workflows; external paid services or infrastructure; deployment or production configuration.

If a technical choice would change any of the above, stop and register the decision (**Class I** — owner decision requiring explicit approval; if it can wait, **Class III** with its gate).

## 3. Mandatory development workflow (GitHub and phase control)

1. Verify current `master` (fetch; record the exact SHA; confirm ancestry).
2. Create an isolated phase branch and working directory. **Arena constraint:** the session works on the single current branch named in the branch note; never switch, create, rename or push another branch; the branch name is fixed. Open any PR from that branch only.
3. Implement only the approved phase scope.
4. Run tests and security reviews (focused tests during development; full regression before completion).
5. Correct defects before reporting completion.
6. Perform a final review (diff read, secret sweep, scope check, doc consistency).
7. **Obtain owner authorization before commit, push and PR creation.**
8. Verify hosted CI on the PR.
9. **Wait for explicit owner merge approval.** Merge only with `gh pr merge <number> --merge|--squash|--rebase` as the final command (no `--auto`, no output masking).
10. Verify the actual merge into `master`.
11. Only then begin the next phase.

Never force-push, rewrite master history, deploy or merge without authorization. Never commit secrets, generated artifacts or large datasets; follow `.gitignore`. Planning/validation artifacts that are not part of the application (e.g. `validation/phase-4/`) are labelled disposable and are never wired into the app, the migration ledger or CI without approval.

## 4. Development efficiency rules

1. Inspect before implementing — read the actual code, migrations and tests; do not trust old reports over repository evidence.
2. Reuse existing architecture and components (HOLO design system, `authorized()`, the shared pool/transaction contract, error envelope, audit table, test harnesses).
3. Avoid unnecessary rewrites, duplicate modules, unnecessary migrations and unnecessary abstractions.
4. Add no dependency without a technical reason recorded in the phase plan.
5. Run focused tests during development; run the **complete** regression suite (Vitest + browser) before completion.
6. Fix defects before reporting completion; never knowingly leave failing or skipped mandatory tests; never weaken an assertion to obtain a pass.
7. Do not claim production readiness from local tests. State the engine and the limits of evidence.
8. Do not repeatedly ask questions already answered in approved documents.
9. Record technical decisions (register Class II) so they are not reconsidered.
10. Prefer completing a phase properly over splitting it into unnecessary subphases; combine closely related work when technically safe, never combine unrelated high-risk changes to shrink the count.

## 5. Evidence standards

- Every significant claim cites repository paths, migration names, commit SHAs or executed test output.
- Distinguish **executed** from **proposed** tests explicitly. Disposable-engine results name the engine (e.g. "PGlite 0.5.16 / PostgreSQL 18.6, single-process WASM") and what they do **not** prove (multi-backend contention, deployed grants, PostgREST exposure).
- "Implemented" requires code at the stated commit; "tested" requires a command, count and exit status; "blocked" states the reason honestly.
- Contention-sensitive work (inventory, payments, campaigns) requires real disposable PostgreSQL concurrency tests before acceptance; PGlite alone is insufficient.
- Deployed-target verification (migration ledger, effective grants, exposed schemas, direct PostgREST denial) is an owner gate, never assumed.

## 6. Security non-negotiables

- No PAN/expiry/CVC in app input, state, persistence, logs, tests or contracts. Hosted checkout only; redirects never confirm payment.
- No secret in Git, browser bundles, `VITE_*` variables, images, error strings or logs. No service-role key in the runtime. Server-only credentials.
- The browser presents a session credential, never an authoritative identity/tenant/role. Identity is bound transaction-locally by trusted backend code only; no session-persistent identity, no statement pooling.
- Default deny: least-privilege roles, RLS on tenant tables, column allowlists for public exposure, no `BYPASSRLS`/superuser for request processing, security-definer functions pin `search_path` and revoke PUBLIC EXECUTE; security-definer **views** are owned by a non-superuser NOBYPASSRLS role that owns the base tables they read (ownership, not privilege escalation, is how they reach base rows), with catalog-level assertions for owner, owner attributes, security mode and effective grants.
- Four-eyes separation of duties for platform decisions; append-only audit; products archived, never deleted.
- Fail closed: missing config → unavailable, never a fabricated success or a fallback to a more privileged path.
- Historical checkout/credential incidents are a separate owner-led track: do not inspect, migrate or delete historical browser records; do not claim remediation beyond current source.
- AI/agents propose; humans authorize money, commitments, refunds, production release, capability verification and privilege escalation.

## 7. Document control

- Source-of-truth hierarchy: master specification §1. Product requirements → master specification; phase scope → roadmap; technical design → the approved phase plan; process → this file; technical contracts → the architecture set; ground truth for existence → code/migrations/tests.
- Do not create duplicate or contradictory specifications. Update the controlling document; record corrections to outdated statements in the master specification (§18) rather than rewriting historical reports.
- Keep all four controlling documents consistent in the same change; cross-reference decision IDs, never restate questions.
- Phase reports are evidence, not requirements; they are not edited after merge except to append clearly-marked corrections.

## 8. Phase completion checklist

- [ ] Baseline SHA recorded; scope matches the approved phase; Group-A decisions answered.
- [ ] Focused tests run during development; full Vitest suite + browser suite green locally where possible and in hosted CI.
- [ ] Security review against the phase threat list; negative tests for every new boundary.
- [ ] No skipped/weakened mandatory tests; defects fixed.
- [ ] Diff read; secret sweep; no unrelated changes; lockfile justified; `git diff --check` clean.
- [ ] Docs updated consistently; decisions recorded; executed vs proposed evidence separated.
- [ ] Owner authorization obtained for commit/push/PR; hosted CI verified.
- [ ] Explicit owner merge approval; merge verified on master; next phase not started before that.
