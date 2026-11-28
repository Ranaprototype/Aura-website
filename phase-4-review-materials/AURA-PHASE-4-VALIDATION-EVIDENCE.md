# AURA Phase 4 — Validation Evidence (quick reference)

Review-only. Local **disposable-engine** validation only; not production verification. Executed logs live in [`validation/phase-4/results/`](validation/phase-4/results/); the harness is documented in [`validation/phase-4/README.md`](validation/phase-4/README.md).

## Results (current)

| Suite | Result | Log |
| --- | --- | --- |
| SQL validation (real `0001`–`0007` + proposed `0008`/`0009`/rollback on PGlite) | **97 passed / 0 failed** | `sql-validation.log` |
| Cursor contract + pagination | **16 passed / 0 failed** | `cursor-tests.log` |
| Application probes (real Express harness) | **9 passed / 0 failed** | `app-probe.log` |
| Browser baseline | **3 pass / 0 fail / 0 skipped — preserved unchanged** | `browser-baseline.log` |

The SQL suite includes definer-ownership catalogs (1.16–1.19), **ownership-procedure proofs (1.20–1.24)** — member executor can reassign ownership / non-member denied / member-of-owner bypasses catalog RLS / note-accessor helper EXECUTE necessary+sufficient / public login view-only — search/filter/sort (2.16–2.20), and defense-in-depth simulated-grant negatives (2.21–2.29). Cursor results are reported separately per the owner's request.

## PGlite limitations
- Single-process WASM engine; proves SQL/RLS/trigger/policy/ownership semantics.
- Does **not** prove multi-backend contention, deployed grants, PostgREST exposure, or production role behavior.
- Real PostgreSQL/Supabase verification remains required (owner gate G1; see the [ownership procedure](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md) §7).
