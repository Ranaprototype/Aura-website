# AURA Phase 4 — Final Implementation Plan (review-only overview)

This is a review-only planning overview. It does not implement Phase 4, modify migrations, or approve implementation. The authoritative technical design is **[AURA-PHASE-4-PLAN.md](AURA-PHASE-4-PLAN.md)**; the deployment ownership runbook is **[AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md)**.

## Status
- D-22 (explicit Phase 4 implementation approval): **OPEN**.
- D-23/D-24/D-25: **proposed defaults awaiting explicit owner confirmation — not approved decisions**.
- No implementation code is included.

## Scope retained
Phase 4 remains discovery/catalogue storefront work with anonymous, slug-keyed, minimum-field product discovery, including search/filter/sort (menus gated by D-23/D-24/D-25). HOLO storefront/configurator routes are preserved. No public seller storefronts are introduced.

## Implementation sequence (when authorized)
1. Database ownership prerequisite per the [ownership procedure](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md) §§2–4 (catalog owner, base-table ownership, executor privileges/membership), verified at gate G1.
2. Apply additive migrations `0008` and `0009` through the approved migration process (plan §6.1).
3. Add server-side discovery endpoints matching the API contracts (plan §3.1).
4. Add frontend discovery/search/filter/sort UI within the confirmed UX decisions.
5. Add rate limiting, cache-control, cursor pagination, and security controls.
6. Run full validation in a real PostgreSQL/Supabase environment (target gate G1).

## Explicit non-goals
- No changes to owner-directed D-01–D-04.
- No expansion of public data disclosure.
- No production deployment in this review package.
