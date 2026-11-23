-- Phase 2 notification infrastructure. Durable delivery records make retries,
-- idempotency and duplicate suppression verifiable, and keep the audit trail
-- server-side. Message bodies and tokens are never stored here.

create table if not exists aura.email_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  template text not null check (template in (
    'welcome', 'verify-email', 'password-reset', 'invitation',
    'membership-revoked', 'role-changed', 'security-alert'
  )),
  recipient text not null check (recipient = lower(recipient) and char_length(recipient) <= 320),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'suppressed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  last_error text check (last_error is null or char_length(last_error) <= 200),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint email_events_idempotency_key_key unique (idempotency_key),
  constraint email_events_sent_state_check
    check ((status = 'sent') = (sent_at is not null))
);

create index if not exists email_events_recipient_idx
  on aura.email_events (recipient, created_at desc);

create index if not exists email_events_pending_idx
  on aura.email_events (created_at) where status in ('pending', 'failed');

-- Fixed-window counters. A single atomic upsert per attempt keeps the limit
-- correct under concurrency without a table scan.
create table if not exists aura.email_rate_limits (
  bucket text not null check (char_length(bucket) between 1 and 240),
  window_start timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (bucket, window_start)
);

-- Authentication throttling is separate from mail throttling: an attacker may
-- attempt many passwords without ever causing an email to be sent.
create table if not exists aura.auth_rate_limits (
  bucket text not null check (char_length(bucket) between 1 and 240),
  window_start timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (bucket, window_start)
);

drop trigger if exists email_events_touch on aura.email_events;
create trigger email_events_touch before update on aura.email_events
  for each row execute function aura.touch_updated_at();

-- Keep the tables small: neither table needs unbounded history.
create or replace function aura.prune_rate_limits(p_before timestamptz)
  returns integer
  language sql security definer
  set search_path = pg_catalog, aura
  as $$
    with removed as (
      delete from aura.email_rate_limits where window_start < p_before returning 1
    )
    select count(*)::integer from removed
  $$;
