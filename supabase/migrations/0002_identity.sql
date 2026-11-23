-- Phase 2 identity and tenancy. Additive only: 0001_hello.sql is untouched.
-- Every table lives in the private `aura` schema. Nothing here is exposed to
-- PostgREST; the browser never receives SQL credentials.

create schema if not exists aura;

revoke all on schema aura from public;

-- ---------------------------------------------------------------------------
-- Principals: the server-side subject mapping. A browser session is never the
-- source of a principal id; the backend derives it from a stored session row.
-- ---------------------------------------------------------------------------
create table if not exists aura.principals (
  id uuid primary key default gen_random_uuid(),
  issuer text not null check (char_length(issuer) between 1 and 40),
  subject text not null check (char_length(subject) between 1 and 200),
  email text not null check (email = lower(email) and char_length(email) <= 320),
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  email_verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint principals_issuer_subject_key unique (issuer, subject),
  constraint principals_email_key unique (email)
);

-- ---------------------------------------------------------------------------
-- Local password credentials. Only the scrypt envelope is stored; the plain
-- text password never reaches a log, an email or a database column.
-- ---------------------------------------------------------------------------
create table if not exists aura.credentials (
  principal_id uuid primary key references aura.principals(id) on delete cascade,
  password_hash text not null check (password_hash like 'scrypt$%'),
  password_updated_at timestamptz not null default now(),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz
);

-- ---------------------------------------------------------------------------
-- Opaque server-side sessions. The cookie carries a random token; only its
-- SHA-256 digest is stored, so a database leak does not yield usable sessions.
-- ---------------------------------------------------------------------------
create table if not exists aura.sessions (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references aura.principals(id) on delete cascade,
  token_hash bytea not null unique,
  csrf_hash bytea not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 60),
  user_agent_hash bytea,
  constraint sessions_expiry_check check (expires_at > created_at)
);

create index if not exists sessions_principal_active_idx
  on aura.sessions (principal_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Single-use email verification and password reset tokens.
-- ---------------------------------------------------------------------------
create table if not exists aura.auth_tokens (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references aura.principals(id) on delete cascade,
  kind text not null check (kind in ('email_verification', 'password_reset')),
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint auth_tokens_expiry_check check (expires_at > created_at)
);

create unique index if not exists auth_tokens_active_key
  on aura.auth_tokens (principal_id, kind) where consumed_at is null;

-- ---------------------------------------------------------------------------
-- Tenanted data.
-- ---------------------------------------------------------------------------
create table if not exists aura.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_by uuid references aura.principals(id),
  created_at timestamptz not null default now(),
  constraint organizations_slug_key unique (slug)
);

create table if not exists aura.memberships (
  org_id uuid not null references aura.organizations(id) on delete cascade,
  principal_id uuid not null references aura.principals(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references aura.principals(id),
  primary key (org_id, principal_id),
  constraint memberships_revocation_check
    check ((status = 'revoked') = (revoked_at is not null))
);

create index if not exists memberships_principal_active_idx
  on aura.memberships (principal_id) where status = 'active';

create table if not exists aura.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references aura.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 320),
  role text not null check (role in ('admin', 'member', 'viewer')),
  token_hash bytea not null unique,
  invited_by uuid not null references aura.principals(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references aura.principals(id),
  revoked_at timestamptz,
  constraint invitations_expiry_check check (expires_at > created_at)
);

create unique index if not exists invitations_pending_key
  on aura.invitations (org_id, email)
  where accepted_at is null and revoked_at is null;

-- Tenant-scoped business table used to prove row-level isolation end to end.
create table if not exists aura.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references aura.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null references aura.principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_org_created_idx
  on aura.projects (org_id, created_at desc, id);

-- ---------------------------------------------------------------------------
-- Platform administration is granted out of band by an operator, never by an
-- HTTP route. There is no self-service path to this table.
-- ---------------------------------------------------------------------------
create table if not exists aura.platform_admins (
  principal_id uuid primary key references aura.principals(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text
);

-- ---------------------------------------------------------------------------
-- Transaction-local identity helpers. The values are set by the backend with
-- set_config(..., true) inside an explicit transaction; a browser can never
-- set them because it has no SQL path. They are checks, not authentication.
-- ---------------------------------------------------------------------------
create or replace function aura.current_principal() returns uuid
  language sql stable
  as $$ select nullif(current_setting('aura.principal_id', true), '')::uuid $$;

create or replace function aura.current_org() returns uuid
  language sql stable
  as $$ select nullif(current_setting('aura.org_id', true), '')::uuid $$;

-- Security definer so membership resolution cannot recurse through RLS and so
-- the runtime role needs no direct read grant on aura.memberships for checks.
create or replace function aura.is_active_member(p_org uuid, p_roles text[] default null)
  returns boolean
  language sql stable security definer
  set search_path = pg_catalog, aura
  as $$
    select exists (
      select 1
      from aura.memberships m
      where m.org_id = p_org
        and m.principal_id = aura.current_principal()
        and m.status = 'active'
        and (p_roles is null or m.role = any (p_roles))
    )
  $$;

create or replace function aura.touch_updated_at() returns trigger
  language plpgsql
  as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists principals_touch on aura.principals;
create trigger principals_touch before update on aura.principals
  for each row execute function aura.touch_updated_at();

drop trigger if exists memberships_touch on aura.memberships;
create trigger memberships_touch before update on aura.memberships
  for each row execute function aura.touch_updated_at();

drop trigger if exists projects_touch on aura.projects;
create trigger projects_touch before update on aura.projects
  for each row execute function aura.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security. Default deny: no policy means no row for the runtime role.
-- ---------------------------------------------------------------------------
alter table aura.organizations enable row level security;
alter table aura.memberships enable row level security;
alter table aura.invitations enable row level security;
alter table aura.projects enable row level security;

drop policy if exists organizations_member_select on aura.organizations;
create policy organizations_member_select on aura.organizations
  for select using (aura.is_active_member(id));

-- Only a members of the organization may see their own membership rows; the
-- broader admin views are served by the security definer functions below.
drop policy if exists memberships_self_select on aura.memberships;
create policy memberships_self_select on aura.memberships
  for select using (principal_id = aura.current_principal() and aura.is_active_member(org_id));

drop policy if exists invitations_staff_select on aura.invitations;
create policy invitations_staff_select on aura.invitations
  for select using (aura.is_active_member(org_id, array['owner', 'admin']));

drop policy if exists invitations_staff_insert on aura.invitations;
create policy invitations_staff_insert on aura.invitations
  for insert with check (
    invited_by = aura.current_principal()
    and aura.is_active_member(org_id, array['owner', 'admin'])
    -- an admin may invite members and viewers; only an owner may create an
    -- invitation that grants admin
    and (role <> 'admin' or aura.is_active_member(org_id, array['owner']))
  );

drop policy if exists invitations_staff_update on aura.invitations;
create policy invitations_staff_update on aura.invitations
  for update using (aura.is_active_member(org_id, array['owner', 'admin']))
  with check (aura.is_active_member(org_id, array['owner', 'admin']));

drop policy if exists projects_member_select on aura.projects;
create policy projects_member_select on aura.projects
  for select using (aura.is_active_member(org_id));

drop policy if exists projects_writer_insert on aura.projects;
create policy projects_writer_insert on aura.projects
  for insert with check (
    created_by = aura.current_principal()
    and aura.is_active_member(org_id, array['owner', 'admin', 'member'])
  );

drop policy if exists projects_writer_update on aura.projects;
create policy projects_writer_update on aura.projects
  for update using (aura.is_active_member(org_id, array['owner', 'admin', 'member']))
  with check (aura.is_active_member(org_id, array['owner', 'admin', 'member']));

drop policy if exists projects_admin_delete on aura.projects;
create policy projects_admin_delete on aura.projects
  for delete using (aura.is_active_member(org_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- Provisioning functions. These are the only ways to create an organization or
-- to change a membership role, so authorization cannot be bypassed by a direct
-- INSERT and role escalation rules live in one authoritative place.
-- ---------------------------------------------------------------------------
create or replace function aura.create_organization(p_name text, p_slug text)
  returns aura.organizations
  language plpgsql security definer
  set search_path = pg_catalog, aura
  as $$
  declare
    v_principal uuid := aura.current_principal();
    v_org aura.organizations;
  begin
    if v_principal is null then
      raise exception 'identity_required' using errcode = '28000';
    end if;
    if p_name is null or char_length(trim(p_name)) not between 1 and 120 then
      raise exception 'invalid_organization_name' using errcode = '22023';
    end if;
    if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
      raise exception 'invalid_organization_slug' using errcode = '22023';
    end if;

    insert into aura.organizations (name, slug, created_by)
      values (trim(p_name), p_slug, v_principal)
      returning * into v_org;

    insert into aura.memberships (org_id, principal_id, role)
      values (v_org.id, v_principal, 'owner');

    return v_org;
  end
  $$;

create or replace function aura.set_member_role(p_org uuid, p_principal uuid, p_role text)
  returns aura.memberships
  language plpgsql security definer
  set search_path = pg_catalog, aura
  as $$
  declare
    v_actor uuid := aura.current_principal();
    v_actor_role text;
    v_target aura.memberships;
    v_owners integer;
  begin
    if v_actor is null then
      raise exception 'identity_required' using errcode = '28000';
    end if;
    if p_role not in ('owner', 'admin', 'member', 'viewer') then
      raise exception 'invalid_role' using errcode = '22023';
    end if;

    select role into v_actor_role
      from aura.memberships
      where org_id = p_org and principal_id = v_actor and status = 'active';
    -- A member or viewer may never change a role, not even their own.
    if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    select * into v_target
      from aura.memberships
      where org_id = p_org and principal_id = p_principal and status = 'active'
      for update;
    if not found then
      raise exception 'membership_not_found' using errcode = 'P0002';
    end if;

    select count(*) into v_owners
      from aura.memberships
      where org_id = p_org and role = 'owner' and status = 'active';

    -- Only an owner may grant ownership or change an owner.
    if (p_role = 'owner' or v_target.role = 'owner') and v_actor_role <> 'owner' then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    -- An admin may only move people between member and viewer.
    if v_actor_role = 'admin'
       and (p_role = 'admin' or v_target.role = 'admin') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    -- Nobody may leave an organization without an active owner.
    if v_target.role = 'owner' and p_role <> 'owner' and v_owners <= 1 then
      raise exception 'last_owner' using errcode = '23514';
    end if;

    update aura.memberships
      set role = p_role
      where org_id = p_org and principal_id = p_principal
      returning * into v_target;

    return v_target;
  end
  $$;

create or replace function aura.revoke_membership(p_org uuid, p_principal uuid)
  returns aura.memberships
  language plpgsql security definer
  set search_path = pg_catalog, aura
  as $$
  declare
    v_actor uuid := aura.current_principal();
    v_actor_role text;
    v_target aura.memberships;
    v_owners integer;
  begin
    if v_actor is null then
      raise exception 'identity_required' using errcode = '28000';
    end if;

    select role into v_actor_role
      from aura.memberships
      where org_id = p_org and principal_id = v_actor and status = 'active';
    if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    select * into v_target
      from aura.memberships
      where org_id = p_org and principal_id = p_principal and status = 'active'
      for update;
    if not found then
      raise exception 'membership_not_found' using errcode = 'P0002';
    end if;

    if v_actor_role <> 'owner' and v_target.role in ('owner', 'admin') then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    select count(*) into v_owners
      from aura.memberships
      where org_id = p_org and role = 'owner' and status = 'active';
    if v_target.role = 'owner' and v_owners <= 1 then
      raise exception 'last_owner' using errcode = '23514';
    end if;

    update aura.memberships
      set status = 'revoked', revoked_at = now(), revoked_by = v_actor
      where org_id = p_org and principal_id = p_principal
      returning * into v_target;

    return v_target;
  end
  $$;

create or replace function aura.accept_invitation(p_token_hash bytea)
  returns aura.memberships
  language plpgsql security definer
  set search_path = pg_catalog, aura
  as $$
  declare
    v_principal uuid := aura.current_principal();
    v_email text;
    v_invitation aura.invitations;
    v_membership aura.memberships;
  begin
    if v_principal is null then
      raise exception 'identity_required' using errcode = '28000';
    end if;

    select email into v_email from aura.principals where id = v_principal;

    select * into v_invitation
      from aura.invitations
      where token_hash = p_token_hash
      for update;

    if not found then
      raise exception 'invitation_invalid' using errcode = 'P0002';
    end if;
    if v_invitation.accepted_at is not null then
      raise exception 'invitation_already_accepted' using errcode = '23505';
    end if;
    if v_invitation.revoked_at is not null then
      raise exception 'invitation_revoked' using errcode = '42501';
    end if;
    if v_invitation.expires_at <= now() then
      raise exception 'invitation_expired' using errcode = '22023';
    end if;
    if v_email is null or v_email <> v_invitation.email then
      raise exception 'invitation_email_mismatch' using errcode = '42501';
    end if;

    insert into aura.memberships (org_id, principal_id, role)
      values (v_invitation.org_id, v_principal, v_invitation.role)
      on conflict (org_id, principal_id) do update
        set role = excluded.role, status = 'active', revoked_at = null, revoked_by = null
      returning * into v_membership;

    update aura.invitations
      set accepted_at = now(), accepted_by = v_principal
      where id = v_invitation.id;

    return v_membership;
  end
  $$;

-- Membership administration views for owners and admins, resolved inside the
-- security definer function so the caller needs no broad SELECT grant.
create or replace function aura.org_members(p_org uuid)
  returns table (principal_id uuid, email text, display_name text, role text, status text, created_at timestamptz)
  language sql stable security definer
  set search_path = pg_catalog, aura
  as $$
    select m.principal_id, p.email, p.display_name, m.role, m.status, m.created_at
    from aura.memberships m
    join aura.principals p on p.id = m.principal_id
    where m.org_id = p_org
      and aura.is_active_member(p_org, array['owner', 'admin'])
    order by m.created_at, m.principal_id
  $$;
