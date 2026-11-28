-- ============================================================================
-- Phase 4 migration 0008 — public storefront read path + seller suspension.
-- Design/security reference: phase-4-review-materials/AURA-PHASE-4-PLAN.md and
-- AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md (owner-approved D-01..D-04, D-22).
-- Additive: 0001-0007 are not edited. Requires PostgreSQL >= 15
-- (security_invoker views). Runs as a migration role with CREATEROLE that is
-- superuser OR a member of the catalog table owner (never a request-processing
-- login). The public discovery views are SECURITY DEFINER and are explicitly
-- (re)assigned in §8 to the catalog table owner, which MUST be NON-superuser and
-- NOBYPASSRLS; the views read base tables via that ownership (owner RLS
-- exemption), and aura_public has zero base-table grants.
--
-- §0 below embeds the ownership prerequisite (procedure §§2-3) idempotently so
-- the migration is self-contained and replay-safe: it creates aura_catalog_owner
-- and transfers schema + catalog base-table ownership BEFORE the definer views
-- are created and reassigned in §8. An operator may instead run those steps
-- manually per the procedure; the end state is identical. The executor
-- membership / helper-EXECUTE requirements (procedure §4) apply to non-superuser
-- executors; a superuser migration role satisfies them implicitly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Ownership prerequisite (AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md §§2-3).
--    The catalog owner is a NON-superuser, NOBYPASSRLS, NOLOGIN group role that
--    owns the schema + catalog base tables. The public SECURITY DEFINER views
--    (§4) are reassigned to it (§8) and read base rows via table ownership.
--    Idempotent: safe to replay and safe if the operator pre-created the role.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aura_catalog_owner') then
    create role aura_catalog_owner
      nologin nosuperuser nobypassrls nocreaterole nocreatedb;
  end if;
end
$$;

comment on role aura_catalog_owner is
  'AURA Phase 4: non-superuser NOBYPASSRLS owner of the catalog base tables and the public SECURITY DEFINER discovery views. NOLOGIN; never a request role.';

alter schema aura owner to aura_catalog_owner;
alter table aura.products                 owner to aura_catalog_owner;
alter table aura.seller_profiles          owner to aura_catalog_owner;
alter table aura.product_variants         owner to aura_catalog_owner;
alter table aura.product_media            owner to aura_catalog_owner;
alter table aura.product_attribute_values owner to aura_catalog_owner;
alter table aura.categories               owner to aura_catalog_owner;
alter table aura.category_attributes      owner to aura_catalog_owner;

-- ---------------------------------------------------------------------------
-- 1. Seller suspension. Suspension is an overlay, NOT a lifecycle status:
--    `status`, `approved_revision_id` and every product row are preserved, so
--    restoration returns the exact pre-suspension publication state.
-- ---------------------------------------------------------------------------
alter table aura.seller_profiles
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references aura.principals(id),
  add column if not exists suspension_note text
    check (suspension_note is null or char_length(suspension_note) <= 1000);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'seller_profiles_suspension_check'
  ) then
    alter table aura.seller_profiles
      add constraint seller_profiles_suspension_check
      check ((suspended_at is null) = (suspended_by is null and suspension_note is null));
  end if;
end
$$;

-- D-03 (owner correction, 2026-11-27): the suspension NOTE is confidential to
-- explicitly authorized seller owners/admins and platform administrators — NOT
-- every organization member. Column privileges are role-wide (all members share
-- aura_app), so they cannot express "owner/admin only"; instead we hide the note
-- column from aura_app entirely and expose it through a SECURITY DEFINER accessor
-- that checks the caller's membership role. The overlay columns suspended_at /
-- suspended_by stay member-visible (operational status); only the note text is
-- restricted. Existing app queries (loadSeller / SELLER_COLUMNS / review list)
-- select explicit columns that never include suspension_note, and count(*) still
-- works under column-only grants, so no approved Phase 3 query changes.
revoke select on aura.seller_profiles from aura_app;
grant select (id, org_id, display_name, legal_name, business_email, country, website,
              description, status, submitted_at, reviewed_at, reviewed_by, review_note,
              created_by, created_at, updated_at, suspended_at, suspended_by)
  on aura.seller_profiles to aura_app;

create or replace function aura.seller_suspension_note(p_org uuid)
  returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, aura
  as $$
  declare
    v_note text;
  begin
    if not (aura.is_active_member(p_org, array['owner', 'admin']) or aura.is_platform_admin()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    select suspension_note into v_note from aura.seller_profiles where org_id = p_org;
    return v_note;
  end
  $$;

revoke all on function aura.seller_suspension_note(uuid) from public;
grant execute on function aura.seller_suspension_note(uuid) to aura_app;

-- Suspension decisions are platform-administrator-only, four-eyes separated,
-- atomic (no status/content change in the same statement), and noted.
create or replace function aura.seller_suspension_guard() returns trigger
  language plpgsql
  as $$
  declare
    v_actor uuid := aura.current_principal();
    v_suspension_change boolean;
    v_content_change boolean;
  begin
    if v_actor is null then
      raise exception 'identity_required' using errcode = '28000';
    end if;

    if tg_op = 'INSERT' then
      if new.suspended_at is not null then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      return new;
    end if;

    v_suspension_change :=
      new.suspended_at is distinct from old.suspended_at
      or new.suspended_by is distinct from old.suspended_by
      or new.suspension_note is distinct from old.suspension_note;

    if v_suspension_change then
      if not aura.is_platform_admin() then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      -- One decision per statement: the lifecycle guard and the audit trail
      -- must never see a suspension mixed with a status or content edit.
      if new.status is distinct from old.status
         or new.display_name is distinct from old.display_name
         or new.legal_name is distinct from old.legal_name
         or new.business_email is distinct from old.business_email
         or new.country is distinct from old.country
         or new.website is distinct from old.website
         or new.description is distinct from old.description then
        raise exception 'suspension_must_be_atomic' using errcode = '23514';
      end if;
      if new.suspended_at is not null then
        -- Suspend: note mandatory, actor recorded by the database.
        if new.suspension_note is null or char_length(trim(new.suspension_note)) = 0 then
          raise exception 'suspension_note_required' using errcode = '22023';
        end if;
        new.suspended_at := now();
        new.suspended_by := v_actor;
      else
        -- Restore: clear the whole overlay; prior status/approval untouched.
        new.suspended_at := null;
        new.suspended_by := null;
        new.suspension_note := null;
      end if;
      return new;
    end if;

    -- While suspended, seller-side writes are frozen. Platform administrators
    -- keep their review/restore paths (handled above or by lifecycle guards).
    if old.suspended_at is not null and not aura.is_platform_admin() then
      raise exception 'seller_suspended' using errcode = '23514';
    end if;
    return new;
  end
  $$;

-- The "0_" prefix makes this BEFORE trigger fire first (PostgreSQL fires
-- same-timing row triggers in name order), so a mixed suspension+content edit
-- is refused as suspension_must_be_atomic before the lifecycle guard's
-- content rules run. Four-eyes refusal for dual-role admins still comes from
-- review_separation_guard, which fires afterwards and also refuses.
drop trigger if exists seller_profiles_0_suspension_guard on aura.seller_profiles;
create trigger seller_profiles_0_suspension_guard
  before insert or update on aura.seller_profiles
  for each row execute function aura.seller_suspension_guard();

-- Four eyes stays defined in ONE place: extend the Phase 3 guard so a
-- suspension or restoration is a "decision" exactly like approve/reject.
create or replace function aura.review_separation_guard() returns trigger
  language plpgsql
  as $$
  declare
    v_org uuid;
    v_decides boolean := false;
  begin
    if tg_table_name = 'seller_profiles' then
      v_org := new.org_id;
      v_decides := old.status = 'submitted'
        and new.status in ('approved', 'rejected');
      -- Phase 4: suspension and restoration are separation-of-duties decisions.
      v_decides := v_decides or (new.suspended_at is distinct from old.suspended_at);
    elsif tg_table_name = 'products' then
      v_org := new.org_id;
      v_decides := old.status = 'submitted'
        and new.status in ('approved', 'rejected');
    elsif tg_table_name = 'product_revisions' then
      v_org := new.org_id;
      v_decides := old.decision = 'pending'
        and new.decision in ('approved', 'rejected');
    end if;

    if v_decides and aura.is_active_member(v_org) then
      raise exception 'review_separation_required' using errcode = '42501';
    end if;
    return new;
  end
  $$;

-- Catalogue writes freeze while the seller is suspended. Platform review
-- decisions (approve/reject of an already submitted product) and admin
-- archival remain possible so operators can clean up a suspended catalogue.
create or replace function aura.catalogue_suspension_guard() returns trigger
  language plpgsql
  as $$
  declare
    v_org uuid;
    v_suspended boolean;
  begin
    if tg_op = 'DELETE' then
      v_org := old.org_id;
    else
      v_org := new.org_id;
    end if;
    select (suspended_at is not null) into v_suspended
      from aura.seller_profiles where org_id = v_org;
    if not found or not v_suspended then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;

    -- Nested IFs, not one AND expression: child-table records have no
    -- "status" field, and SQL does not guarantee AND short-circuit order.
    if tg_table_name = 'products' and tg_op = 'UPDATE' then
      if aura.is_platform_admin()
         and ((old.status = 'submitted' and new.status in ('approved', 'rejected'))
              or new.status = 'archived') then
        return new;
      end if;
    end if;
    raise exception 'seller_suspended' using errcode = '23514';
  end
  $$;

-- Trigger names sort BEFORE the Phase 3 guards so a suspended seller fails
-- fast with seller_suspended rather than a lifecycle error.
drop trigger if exists products_catalogue_suspension on aura.products;
create trigger products_catalogue_suspension
  before insert or update on aura.products
  for each row execute function aura.catalogue_suspension_guard();

drop trigger if exists product_variants_catalogue_suspension on aura.product_variants;
create trigger product_variants_catalogue_suspension
  before insert or update or delete on aura.product_variants
  for each row execute function aura.catalogue_suspension_guard();

drop trigger if exists product_media_catalogue_suspension on aura.product_media;
create trigger product_media_catalogue_suspension
  before insert or update or delete on aura.product_media
  for each row execute function aura.catalogue_suspension_guard();

drop trigger if exists product_attribute_values_catalogue_suspension on aura.product_attribute_values;
create trigger product_attribute_values_catalogue_suspension
  before insert or update or delete on aura.product_attribute_values
  for each row execute function aura.catalogue_suspension_guard();

-- Dedicated suspension audit events; the generic seller field-diff audit
-- excludes the overlay columns so one decision produces one clear event.
create or replace function aura.audit_seller_profile() returns trigger
  language plpgsql
  as $$
  declare
    v_fields jsonb;
  begin
    if tg_op = 'INSERT' then
      insert into aura.audit_events
        (org_id, actor_principal_id, entity_type, entity_id, action, from_state, to_state, detail)
      values
        (new.org_id, coalesce(aura.current_principal(), new.created_by),
         'seller_profile', new.id, 'seller.created', null, new.status,
         jsonb_build_object('displayName', new.display_name));
      return null;
    end if;

    if new.status is distinct from old.status then
      insert into aura.audit_events
        (org_id, actor_principal_id, entity_type, entity_id, action, from_state, to_state, detail)
      values
        (new.org_id, coalesce(aura.current_principal(), new.created_by),
         'seller_profile', new.id,
         case
           when new.status = 'submitted' then 'seller.submitted'
           when new.status = 'approved' then 'seller.approved'
           when new.status = 'rejected' then 'seller.rejected'
           else 'seller.updated'
         end,
         old.status, new.status,
         jsonb_build_object('reviewNote', new.review_note));
    else
      select coalesce(jsonb_agg(e.key order by e.key), '[]'::jsonb) into v_fields
        from jsonb_each(to_jsonb(new)) e
        where to_jsonb(old) -> e.key is distinct from e.value
          and e.key not in ('updated_at', 'submitted_at', 'reviewed_at', 'reviewed_by', 'review_note',
                            'suspended_at', 'suspended_by', 'suspension_note');
      if jsonb_array_length(v_fields) > 0 then
        insert into aura.audit_events
          (org_id, actor_principal_id, entity_type, entity_id, action, from_state, to_state, detail)
        values
          (new.org_id, coalesce(aura.current_principal(), new.created_by),
           'seller_profile', new.id, 'seller.updated', new.status, new.status,
           jsonb_build_object('fields', v_fields));
      end if;
    end if;
    return null;
  end
  $$;

create or replace function aura.audit_seller_suspension() returns trigger
  language plpgsql
  as $$
  begin
    if new.suspended_at is distinct from old.suspended_at then
      insert into aura.audit_events
        (org_id, actor_principal_id, entity_type, entity_id, action, from_state, to_state, detail)
      values
        (new.org_id, coalesce(aura.current_principal(), new.created_by),
         'seller_profile', new.id,
         case when new.suspended_at is not null then 'seller.suspended' else 'seller.restored' end,
         new.status, new.status,
         -- D-03: audit_events is member-readable, so the confidential note text
         -- must NOT be copied here. Record only that a note was recorded; the
         -- text itself lives in the restricted column, read via the accessor.
         jsonb_build_object('noteRecorded', new.suspension_note is not null));
    end if;
    return null;
  end
  $$;

drop trigger if exists seller_profiles_suspension_audit on aura.seller_profiles;
create trigger seller_profiles_suspension_audit
  after update on aura.seller_profiles
  for each row execute function aura.audit_seller_suspension();

-- ---------------------------------------------------------------------------
-- 2. Anonymous public-read role. NOLOGIN group, exactly like aura_app (0004).
--    Production: the operator creates a LOGIN role and grants aura_public to
--    it (the login keeps default INHERIT, so it inherits aura_public's grants;
--    NOINHERIT on the group only stops the GROUP inheriting other roles).
--    The public pool never binds aura.principal_id and never reaches identity
--    tables: no grant, no policy, no function has been added for it there.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aura_public') then
    create role aura_public nologin noinherit nosuperuser nocreatedb nocreaterole
      noreplication nobypassrls;
  end if;
end
$$;

grant usage on schema aura to aura_public;

-- CRITICAL (proven by executed validation): the Phase 2/3 member/admin
-- policies were created WITHOUT a TO clause, so they target PUBLIC (every
-- role) and their expressions call aura.is_active_member()/is_platform_admin().
-- A restricted public role cannot EXECUTE those helpers, so ANY read of a
-- table carrying such a policy fails with "permission denied for function
-- is_active_member" — even through a security_invoker view that has its own
-- public policy. Granting EXECUTE to the public role is NOT acceptable: the
-- helpers plus a caller-set aura.principal_id would become a membership
-- oracle. Instead, scope every helper-calling policy to the runtime role that
-- actually uses it. Behaviour for aura_app (and any login inheriting it) is
-- unchanged; the migration owner bypasses RLS as before. Pure `using (true)`
-- reference-data policies (categories_read, category_attributes_read) stay
-- PUBLIC so the public role can read reference data.
alter policy organizations_member_select on aura.organizations to aura_app;
alter policy organizations_platform_admin_select on aura.organizations to aura_app;
alter policy memberships_self_select on aura.memberships to aura_app;
alter policy invitations_staff_select on aura.invitations to aura_app;
alter policy invitations_staff_insert on aura.invitations to aura_app;
alter policy invitations_staff_update on aura.invitations to aura_app;
alter policy projects_member_select on aura.projects to aura_app;
alter policy projects_writer_insert on aura.projects to aura_app;
alter policy projects_writer_update on aura.projects to aura_app;
alter policy projects_admin_delete on aura.projects to aura_app;
alter policy seller_profiles_member_select on aura.seller_profiles to aura_app;
alter policy seller_profiles_staff_insert on aura.seller_profiles to aura_app;
alter policy seller_profiles_staff_update on aura.seller_profiles to aura_app;
alter policy seller_profiles_admin_update on aura.seller_profiles to aura_app;
alter policy products_member_select on aura.products to aura_app;
alter policy products_writer_insert on aura.products to aura_app;
alter policy products_writer_update on aura.products to aura_app;
alter policy products_admin_update on aura.products to aura_app;
alter policy product_revisions_member_select on aura.product_revisions to aura_app;
alter policy product_revisions_writer_insert on aura.product_revisions to aura_app;
alter policy product_revisions_admin_update on aura.product_revisions to aura_app;
alter policy product_variants_member_select on aura.product_variants to aura_app;
alter policy product_variants_writer_insert on aura.product_variants to aura_app;
alter policy product_variants_writer_update on aura.product_variants to aura_app;
alter policy product_variants_writer_delete on aura.product_variants to aura_app;
alter policy product_media_member_select on aura.product_media to aura_app;
alter policy product_media_writer_insert on aura.product_media to aura_app;
alter policy product_media_writer_update on aura.product_media to aura_app;
alter policy product_media_writer_delete on aura.product_media to aura_app;
alter policy product_attribute_values_member_select on aura.product_attribute_values to aura_app;
alter policy product_attribute_values_writer_insert on aura.product_attribute_values to aura_app;
alter policy product_attribute_values_writer_update on aura.product_attribute_values to aura_app;
alter policy product_attribute_values_writer_delete on aura.product_attribute_values to aura_app;
alter policy audit_events_member_select on aura.audit_events to aura_app;
alter policy audit_events_actor_insert on aura.audit_events to aura_app;

-- D-02 (owner correction, 2026-11-27): the anonymous role gets ZERO base-table
-- privileges. Internal identifiers (org_id, product id, revision id,
-- seller_profile_id) and seller identity/disclosure fields must never be
-- reachable, even by a direct base query. security_invoker views + column
-- grants cannot achieve this: every join/predicate column would have to be
-- granted and would then be directly queryable. Instead the public projections
-- below are SECURITY DEFINER VIEWS (security_invoker = false, the default)
-- owned by the migration/table owner. Base access uses the owner's privileges,
-- the view WHERE encodes the full publication predicate, and the view selects
-- ONLY product-discovery columns. aura_public receives SELECT on these views
-- only: no base table, no column, no function EXECUTE. The views call no
-- functions and are fully schema-qualified (no search_path execution hazard);
-- the production owner should be a non-superuser role that owns the aura tables.
revoke all on aura.seller_profiles, aura.products, aura.product_variants,
  aura.product_media, aura.product_attribute_values, aura.categories,
  aura.category_attributes
  from aura_public;

-- ---------------------------------------------------------------------------
-- 3. Defense-in-depth public RLS policies (TO aura_public). With zero base
--    grants these are never evaluated for the public role today, but they keep
--    the path safe if a base grant is ever added by mistake. They contain no
--    identity-helper calls and reference no internal identifier beyond the
--    publication state. Member/admin policies stay scoped TO aura_app.
--    status = 'approved' implies a valid approved revision (products_approval_check
--    + products_guard), so the revision pointer need not be referenced.
-- ---------------------------------------------------------------------------
drop policy if exists seller_profiles_public_select on aura.seller_profiles;
create policy seller_profiles_public_select on aura.seller_profiles
  for select to aura_public
  using (status = 'approved' and suspended_at is null);

-- D-04 correction (owner, 2026-11-27 review): these defense-in-depth policies
-- must enforce the FULL publication predicate — approved product + not pending
-- + approved seller + not suspended — so that if a base-table SELECT grant to
-- aura_public is ever added by mistake, the rows still cannot leak. They mirror
-- the definer-view WHERE exactly. (aura_public has zero base grants today, so
-- these are never evaluated on the live public path; they are a safety net.)
drop policy if exists products_public_select on aura.products;
create policy products_public_select on aura.products
  for select to aura_public
  using (
    status = 'approved' and pending_changes = false
    and exists (
      select 1 from aura.seller_profiles s
      where s.id = products.seller_profile_id
        and s.status = 'approved' and s.suspended_at is null));

drop policy if exists product_variants_public_select on aura.product_variants;
create policy product_variants_public_select on aura.product_variants
  for select to aura_public
  using (exists (
    select 1 from aura.products p
    join aura.seller_profiles s on s.id = p.seller_profile_id
    where p.id = product_variants.product_id
      and p.status = 'approved' and p.pending_changes = false
      and s.status = 'approved' and s.suspended_at is null));

drop policy if exists product_media_public_select on aura.product_media;
create policy product_media_public_select on aura.product_media
  for select to aura_public
  using (exists (
    select 1 from aura.products p
    join aura.seller_profiles s on s.id = p.seller_profile_id
    where p.id = product_media.product_id
      and p.status = 'approved' and p.pending_changes = false
      and s.status = 'approved' and s.suspended_at is null));

drop policy if exists product_attribute_values_public_select on aura.product_attribute_values;
create policy product_attribute_values_public_select on aura.product_attribute_values
  for select to aura_public
  using (exists (
    select 1 from aura.products p
    join aura.seller_profiles s on s.id = p.seller_profile_id
    where p.id = product_attribute_values.product_id
      and p.status = 'approved' and p.pending_changes = false
      and s.status = 'approved' and s.suspended_at is null));

-- ---------------------------------------------------------------------------
-- 4. Public projections — SECURITY DEFINER VIEWS, minimal discovery columns.
--    Publication predicate: product approved + not pending + seller approved +
--    not suspended. The seller join uses seller_profile_id only; the composite
--    FK products_seller_fk guarantees the seller is in the same organization,
--    so no org_id is referenced or exposed. Children are keyed by the public
--    product slug, never by an internal id. While the predicate holds, working-
--    copy child rows equal the approved revision (any edit flips pending_changes
--    in the same transaction), so reading live children is reading approved
--    content. Seller identity/disclosure is NOT exposed (D-01/D-02: public
--    seller storefronts and seller fields require separate owner approval).
-- ---------------------------------------------------------------------------

-- Phase 3 aura_app projection: keep security_invoker, add the suspension filter
-- (same column list, CREATE OR REPLACE legal). NOT granted to aura_public.
create or replace view aura.storefront_products
  with (security_invoker = true)
  as
  select p.id, p.org_id, p.slug, p.title, p.summary, p.description,
         p.category_id, p.approved_revision_id, p.approved_at
    from aura.products p
    join aura.seller_profiles s
      on s.id = p.seller_profile_id and s.org_id = p.org_id
   where p.status = 'approved'
     and p.pending_changes = false
     and p.approved_revision_id is not null
     and s.status = 'approved'
     and s.suspended_at is null;

-- Public product projection (definer). No internal ids, no seller fields.
create or replace view aura.public_products as
  select p.slug, p.title, p.summary, p.description, p.approved_at,
         c.slug as category_slug, c.name as category_name
    from aura.products p
    join aura.categories c on c.id = p.category_id
    join aura.seller_profiles s on s.id = p.seller_profile_id
   where p.status = 'approved' and p.pending_changes = false
     and s.status = 'approved' and s.suspended_at is null;

create or replace view aura.public_product_variants as
  select p.slug as product_slug, v.title, v.size, v.colour, v.material, v.position
    from aura.product_variants v
    join aura.products p on p.id = v.product_id
    join aura.seller_profiles s on s.id = p.seller_profile_id
   where p.status = 'approved' and p.pending_changes = false
     and s.status = 'approved' and s.suspended_at is null;

create or replace view aura.public_product_media as
  select p.slug as product_slug, m.kind, m.url, m.alt_text, m.position
    from aura.product_media m
    join aura.products p on p.id = m.product_id
    join aura.seller_profiles s on s.id = p.seller_profile_id
   where m.kind = 'image'
     and p.status = 'approved' and p.pending_changes = false
     and s.status = 'approved' and s.suspended_at is null;

create or replace view aura.public_product_attributes as
  select p.slug as product_slug, a.key, a.label, av.value, a.position
    from aura.product_attribute_values av
    join aura.category_attributes a on a.id = av.attribute_id
    join aura.products p on p.id = av.product_id
    join aura.seller_profiles s on s.id = p.seller_profile_id
   where p.status = 'approved' and p.pending_changes = false
     and s.status = 'approved' and s.suspended_at is null;

grant select on aura.public_products, aura.public_product_variants,
  aura.public_product_media, aura.public_product_attributes to aura_public;

-- ---------------------------------------------------------------------------
-- 5. Public rate-limit storage, ISOLATED from aura.auth_rate_limits. Anonymous
--    traffic can only ever touch this table; it cannot inflate login,
--    registration or recovery counters, and auth pruning never deletes it.
--    Only the server holds the public credentials; browsers have no SQL path.
-- ---------------------------------------------------------------------------
create table if not exists aura.public_rate_limits (
  bucket text not null check (char_length(bucket) between 1 and 120),
  window_start timestamptz not null,
  hits integer not null default 1 check (hits > 0),
  primary key (bucket, window_start)
);

alter table aura.public_rate_limits enable row level security;

drop policy if exists public_rate_limits_public_all on aura.public_rate_limits;
create policy public_rate_limits_public_all on aura.public_rate_limits
  for all to aura_public using (true) with check (true);

revoke all on aura.public_rate_limits from public;
grant select, insert, update, delete on aura.public_rate_limits to aura_public;

-- ---------------------------------------------------------------------------
-- 6. Function EXECUTE hygiene. PostgreSQL grants EXECUTE to PUBLIC by default
--    on every new function; strip it, then grant only to the runtime role
--    that actually fires the triggers (matching the 0006 pattern). The public
--    role receives NO function EXECUTE anywhere. Trigger firing itself does
--    not re-check EXECUTE, so revoking PUBLIC on touch_updated_at is safe.
-- ---------------------------------------------------------------------------
revoke all on function
  aura.seller_suspension_guard(),
  aura.catalogue_suspension_guard(),
  aura.audit_seller_suspension(),
  aura.review_separation_guard(),
  aura.audit_seller_profile(),
  aura.touch_updated_at()
  from public;

grant execute on function
  aura.seller_suspension_guard(),
  aura.catalogue_suspension_guard(),
  aura.audit_seller_suspension()
  to aura_app;

-- ---------------------------------------------------------------------------
-- 7. Slug redirect storage (table created here; the global-slug backfill and
--    unique index live in 0009 so they can be rolled back independently).
--    Runtime roles read; only the migration role writes (no runtime grant).
-- ---------------------------------------------------------------------------
create table if not exists aura.slug_redirects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  product_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  replacement_slug text check (replacement_slug is null or replacement_slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  reason text not null check (reason in ('global_collision')),
  created_at timestamptz not null default now(),
  constraint slug_redirects_slug_key unique (slug),
  constraint slug_redirects_product_fk foreign key (org_id, product_id)
    references aura.products (org_id, id) on delete cascade
);

create index if not exists slug_redirects_product_idx
  on aura.slug_redirects (product_id);

alter table aura.slug_redirects enable row level security;

drop policy if exists slug_redirects_member_select on aura.slug_redirects;
create policy slug_redirects_member_select on aura.slug_redirects
  for select to aura_app
  using (aura.is_active_member(org_id) or aura.is_platform_admin());

drop policy if exists slug_redirects_public_select on aura.slug_redirects;
create policy slug_redirects_public_select on aura.slug_redirects
  for select to aura_public
  using (exists (
    select 1 from aura.products p
    join aura.seller_profiles s on s.id = p.seller_profile_id
    where p.id = slug_redirects.product_id
      and p.status = 'approved' and p.pending_changes = false
      and s.status = 'approved' and s.suspended_at is null));

revoke all on aura.slug_redirects from public;
grant select on aura.slug_redirects to aura_app;
-- aura_public gets NO base grant on slug_redirects; it reads the definer view below.

-- Redirects resolve ONLY when no live product holds the slug (the API checks
-- public_products first). A collision redirect whose original slug is still
-- held by the kept product is therefore inert and can never hijack it. Definer
-- view; exposes only slug -> canonical_slug, no internal identifiers.
create or replace view aura.public_slug_redirects as
  select r.slug, p.slug as canonical_slug
    from aura.slug_redirects r
    join aura.products p on p.id = r.product_id
    join aura.seller_profiles s on s.id = p.seller_profile_id
   where p.status = 'approved' and p.pending_changes = false
     and s.status = 'approved' and s.suspended_at is null;

grant select on aura.public_slug_redirects to aura_public;

-- ---------------------------------------------------------------------------
-- 8. Explicit SECURITY DEFINER ownership (owner correction, 2026-11-27 review).
--    A definer view reads base tables with the privileges of its OWNER. That
--    owner MUST be the catalog table owner — a NON-superuser, NOBYPASSRLS role.
--    PostgreSQL exempts a table's owner from that table's RLS unless FORCE ROW
--    LEVEL SECURITY is set (the aura tables use ENABLE, not FORCE), so the views
--    read base rows via OWNERSHIP — not via superuser/BYPASSRLS, and not via any
--    grant to aura_public. The view WHERE clause is the publication boundary;
--    aura_public holds SELECT on the views only (zero base-table grants).
--    Here we (re)assign the five definer views and slug_redirects to whoever
--    owns aura.products, so view ownership always tracks catalog ownership and
--    is never left with an implicit/privileged migration role. Requirements
--    (asserted in validation and at the deployment gate):
--      * the catalog owner is NON-superuser, NOBYPASSRLS, and (recommended)
--        NOLOGIN; it owns every base table the views read;
--      * the migration role running 0008 is superuser OR a member of the catalog
--        owner (needed to reassign ownership); it is never a request-processing
--        login;
--      * storefront_products stays security_invoker (caller privileges) and is
--        NOT reassigned — it is the aura_app projection, not a public boundary.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner text;
begin
  select r.rolname into v_owner
    from pg_class c join pg_roles r on r.oid = c.relowner
   where c.oid = 'aura.products'::regclass;

  execute format('alter table aura.slug_redirects owner to %I', v_owner);
  execute format('alter view aura.public_products owner to %I', v_owner);
  execute format('alter view aura.public_product_variants owner to %I', v_owner);
  execute format('alter view aura.public_product_media owner to %I', v_owner);
  execute format('alter view aura.public_product_attributes owner to %I', v_owner);
  execute format('alter view aura.public_slug_redirects owner to %I', v_owner);
end
$$;
