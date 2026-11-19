# PostgreSQL boundaries

## As checked in

`supabase/migrations/0001_hello.sql` is unchanged. Only `public.hello` is defined: generated UUID PK, non-null message, and non-null timezone-aware creation time. RLS is enabled; SELECT `using (true)` and INSERT `with check (true)` are **not tenant isolation**. No grant/owner inventory or migration ledger for any deployed target is available. No SQL has been run on one. A published PostgREST endpoint with permissive grants may be directly accessible regardless of the Express operator gate. Do not use this table for customer or sensitive data.

Readiness selects only `id` with GET and a one-row limit. An actual upstream 200/206 JSON response containing zero or one UUID row is required; an empty HTTP body is not an empty relation. The adapter rejects non-success wire statuses before SDK normalization and checks row shapes after parsing. Operator reads are capped at 50; writes are trimmed and bounded at the API, not by a database check constraint. An anon/publishable key is not an administrative credential and its effective privileges still depend on the target. The old type placeholder in `server/lib/supabase-types.ts` is not a generated authoritative schema. `tests/migration.test.ts` replays the actual SQL on a disposable embedded PostgreSQL engine and demonstrates allow/deny behavior with deliberately chosen grants. It does not certify Supabase default grants or target-side security.

## Required before a shared database (not provisioned)

| Role | Intended permissions |
|---|---|
| Migration | Own versioned DDL; controlled job, explicit schema and transaction boundaries. No web traffic. |
| Application | Non-owner, no BYPASSRLS, only required DML/EXECUTE, subject and tenant constraints. No schema creation, grants or service key. |
| Monitoring | Read-only approved probes/metrics, no payload access. Separate from application and admin. |
| Administration | Restricted break-glass role; approval, expiry, access logging and review. Never loaded in web process. |

Obtain owner-approved **metadata-only** migration status, effective grants (including PUBLIC/default grants), exposed schemas, policies and owners before a forward migration. Deny public diagnostic writes on shared targets; verify a negative direct-database access test as well as API checks. Design readiness to use a narrowly granted probe rather than granting access to customer records. Do not edit deployed history. Review backward compatibility, backup, restore and rollback before applying changes. Retention and purge policy require data-owner review; no historical data cleanup is authorized.

## Later data ownership (no speculative tables)

Identity owns principals/memberships; customer, seller and manufacturer domains own scoped profiles. Catalog owns categories/variants; inventory owns reservations; orders own quote snapshots and commitments; payments/refunds own provider identifiers and idempotent state; shipping owns fulfillment. Design/3D own revisions and object references, community owns visibility/consent, Product Lab owns demand signals, manufacturing owns quotes and production commitments. Operations owns approval records, notifications and sanitized security events. Use foreign keys, tenant-scoped uniqueness, query-backed indexes, UTC-aware timestamps, currency plus integer minor units or explicit decimal scale. Commit stock/commitment changes transactionally; test contention before accepting orders. Redis or browser state must never be the source of record.
