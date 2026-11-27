# AURA Phase 4 — Owner Decision Register (quick reference)

Review-only. **No decisions are approved by this document.** The authoritative consolidated register is **§19 of [AURA-MASTER-SPECIFICATION.md](AURA-MASTER-SPECIFICATION.md)** (Classes I/II/III), which now includes a **"Pending owner confirmations — proposed defaults, NOT approved"** summary table.

## Open decisions — awaiting explicit owner action

| ID | Decision | Proposed default (awaiting confirmation) | Status |
| --- | --- | --- | --- |
| D-22 | Phase 4 implementation go-ahead | — | **OPEN — not authorized** |
| D-23 | Search fields + semantics | Word search over title + summary (`websearch_to_tsquery('simple')`), 1–100 chars | **OPEN — awaiting owner confirmation, NOT approved** |
| D-24 | Sort options + default | `newest` (default) + `title` A–Z | **OPEN — awaiting owner confirmation, NOT approved** |
| D-25 | Filter facets | category chips + attribute `key:value`; which attributes become chips TBD | **OPEN — awaiting owner confirmation, NOT approved** |

A recommendation executed in validation is **not** a decision. The owner makes one go/no-go decision after reviewing the package.

## Approved constraints retained (unchanged)

- D-01–D-04 remain owner-directed and unchanged.
- No public seller storefronts in Phase 4 (D-01/D-21).
- Anonymous access limited to minimum slug-keyed discovery fields; zero base-table grants (D-02).
- Reversible suspension, four-eyes for suspend **and** restore, confidential note (D-03).
- Global slug uniqueness, deterministic collision migration, drift-aborting rollback (D-04).
