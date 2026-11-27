-- Phase 3 seller management and product catalogue foundation.
--
-- Additive only: 0001-0004 are untouched. Every table lives in the private
-- `aura` schema, is tenant scoped, and is protected by row level security. The
-- browser never has a SQL path, so the transaction-local identity helpers in
-- 0002 remain the only way to bind a principal.
--
-- Invariants enforced here, not only in the route layer:
--   * a seller profile belongs to exactly one organization;
--   * catalogue rows can only reference a parent in the same organization
--     (composite, tenant-scoped foreign keys);
--   * only an approved seller can create or submit products;
--   * only a platform administrator can approve or reject;
--   * a product is purchasable only when its approved revision is current;
--   * revisions and audit events are append-only.

-- ---------------------------------------------------------------------------
-- Sellers. One profile per organization; business information is reviewed by a
-- platform administrator before the organization can use the catalogue.
-- ---------------------------------------------------------------------------
create table if not exists aura.seller_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references aura.organizations(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  legal_name text not null check (char_length(trim(legal_name)) between 1 and 200),
  business_email text not null
    check (business_email = lower(business_email) and char_length(business_email) <= 320),
  country text not null check (country ~ '^[A-Z]{2}$'),
  website text check (website is null or (website ~ '^https://' and char_length(website) <= 300)),
  description text check (description is null or char_length(description) <= 2000),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references aura.principals(id),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  created_by uuid not null references aura.principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_profiles_org_key unique (org_id),
  -- Target for tenant-scoped composite foreign keys below.
  constraint seller_profiles_org_id_key unique (org_id, id),
  constraint seller_profiles_review_state_check
    check ((status in ('approved', 'rejected')) = (reviewed_at is not null and reviewed_by is not null)),
  constraint seller_profiles_rejection_note_check
    check (status <> 'rejected' or (review_note is not null and char_length(trim(review_note)) > 0))
);

-- ---------------------------------------------------------------------------
-- Catalogue reference data. Categories and their attribute definitions are
-- platform owned: the runtime role may read them and may never write them.
-- ---------------------------------------------------------------------------
create table if not exists aura.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  position integer not null default 0 check (position >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists aura.category_attributes (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references aura.categories(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9-]{1,40}$'),
  label text not null check (char_length(trim(label)) between 1 and 80),
  data_type text not null check (data_type in ('text', 'number', 'boolean', 'select')),
  options text[] check (options is null or cardinality(options) between 1 and 40),
  is_required boolean not null default false,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  constraint category_attributes_key_key unique (category_id, key),
  constraint category_attributes_select_options_check
    check ((data_type = 'select') = (options is not null))
);

-- ---------------------------------------------------------------------------
-- Products. `status` is the lifecycle; `pending_changes` means the working copy
-- has moved on from the approved revision, which is what stops an edited
-- product from being silently treated as approved.
-- ---------------------------------------------------------------------------
create table if not exists aura.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references aura.organizations(id) on delete cascade,
  seller_profile_id uuid not null,
  category_id uuid not null references aura.categories(id),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  title text not null check (char_length(trim(title)) between 3 and 140),
  summary text check (summary is null or char_length(summary) <= 300),
  description text check (description is null or char_length(description) <= 5000),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'archived')),
  pending_changes boolean not null default false,
  approved_revision_id uuid,
  submitted_at timestamptz,
  approved_at timestamptz,
  archived_at timestamptz,
  created_by uuid not null references aura.principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_org_slug_key unique (org_id, slug),
  constraint products_org_id_key unique (org_id, id),
  constraint products_seller_fk foreign key (org_id, seller_profile_id)
    references aura.seller_profiles (org_id, id),
  constraint products_pending_changes_check
    check (not pending_changes or status = 'approved'),
  constraint products_archived_check
    check (status <> 'archived' or archived_at is not null),
  constraint products_approval_check
    check (status <> 'approved' or approved_revision_id is not null)
);

create index if not exists products_org_status_idx
  on aura.products (org_id, status, created_at desc, id);

create index if not exists products_status_idx
  on aura.products (status, created_at desc, id);

-- Immutable submission snapshots: a review decision is always attached to the
-- exact content that was submitted.
create table if not exists aura.product_revisions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  org_id uuid not null,
  revision_number integer not null check (revision_number >= 1),
  snapshot jsonb not null,
  submitted_by uuid not null references aura.principals(id),
  submitted_at timestamptz not null default now(),
  decision text not null default 'pending'
    check (decision in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references aura.principals(id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  constraint product_revisions_org_id_key unique (org_id, id),
  constraint product_revisions_number_key unique (product_id, revision_number),
  constraint product_revisions_product_fk foreign key (org_id, product_id)
    references aura.products (org_id, id) on delete cascade,
  constraint product_revisions_reviewed_state_check
    check ((decision = 'pending') = (reviewed_at is null)),
  constraint product_revisions_reviewer_check
    check ((decision = 'pending') = (reviewed_by is null)),
  constraint product_revisions_rejection_note_check
    check (decision <> 'rejected' or (review_note is not null and char_length(trim(review_note)) > 0))
);

create index if not exists product_revisions_product_idx
  on aura.product_revisions (product_id, revision_number desc);

create index if not exists product_revisions_pending_idx
  on aura.product_revisions (submitted_at, id) where decision = 'pending';

-- The product points at the revision it was approved on. Added after the
-- revision table exists, tenant scoped and guarded by the lifecycle trigger.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_approved_revision_fk'
  ) then
    alter table aura.products
      add constraint products_approved_revision_fk
      foreign key (org_id, approved_revision_id)
      references aura.product_revisions (org_id, id);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Variants, media references and typed attribute values. No price, stock or
-- manufacturing fields exist in this phase by design.
-- ---------------------------------------------------------------------------
create table if not exists aura.product_variants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  product_id uuid not null,
  sku text not null check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'),
  title text not null check (char_length(trim(title)) between 1 and 140),
  size text check (size is null or char_length(size) between 1 and 60),
  colour text check (colour is null or char_length(colour) between 1 and 60),
  material text check (material is null or char_length(material) between 1 and 60),
  position integer not null default 0 check (position >= 0),
  created_by uuid not null references aura.principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_org_sku_key unique (org_id, sku),
  constraint product_variants_product_sku_key unique (product_id, sku),
  constraint product_variants_product_fk foreign key (org_id, product_id)
    references aura.products (org_id, id) on delete cascade
);

create index if not exists product_variants_product_idx
  on aura.product_variants (product_id, position, id);

create table if not exists aura.product_media (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  product_id uuid not null,
  kind text not null default 'image' check (kind in ('image', 'reference')),
  url text not null
    check (url like 'https://%' and url !~ '[[:space:]]' and char_length(url) between 12 and 1000),
  alt_text text check (alt_text is null or char_length(alt_text) <= 200),
  position integer not null default 0 check (position >= 0),
  created_by uuid not null references aura.principals(id),
  created_at timestamptz not null default now(),
  constraint product_media_product_fk foreign key (org_id, product_id)
    references aura.products (org_id, id) on delete cascade
);

create index if not exists product_media_product_idx
  on aura.product_media (product_id, position, id);

create table if not exists aura.product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  product_id uuid not null,
  attribute_id uuid not null references aura.category_attributes(id),
  value text not null check (char_length(value) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint product_attribute_values_key unique (product_id, attribute_id),
  constraint product_attribute_values_product_fk foreign key (org_id, product_id)
    references aura.products (org_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Append-only audit trail for seller and catalogue decisions.
-- ---------------------------------------------------------------------------
create table if not exists aura.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references aura.organizations(id) on delete cascade,
  actor_principal_id uuid not null references aura.principals(id),
  entity_type text not null
    check (entity_type in ('seller_profile', 'product', 'product_revision')),
  entity_id uuid not null,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,60}$'),
  from_state text check (from_state is null or char_length(from_state) <= 40),
  to_state text check (to_state is null or char_length(to_state) <= 40),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_org_idx
  on aura.audit_events (org_id, created_at desc, id);

create index if not exists audit_events_entity_idx
  on aura.audit_events (entity_type, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Identity helpers.
-- ---------------------------------------------------------------------------

-- Security definer so policies and triggers can resolve the platform grant
-- without granting the runtime role a broader read path.
create or replace function aura.is_platform_admin()
  returns boolean
  language sql stable security definer
  set search_path = pg_catalog, aura
  as $$
    select exists (
      select 1 from aura.platform_admins
      where principal_id = aura.current_principal()
    )
  $$;

-- Authoritative snapshot of the content a reviewer is being asked to approve.
create or replace function aura.build_product_snapshot(p_product uuid)
  returns jsonb
  language sql stable security definer
  set search_path = pg_catalog, aura
  as $$
    select jsonb_build_object(
      'product', jsonb_build_object(
        'id', p.id,
        'slug', p.slug,
        'title', p.title,
        'summary', p.summary,
        'description', p.description,
        'categoryId', p.category_id,
        'categorySlug', c.slug
      ),
      'variants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', v.id, 'sku', v.sku, 'title', v.title,
          'size', v.size, 'colour', v.colour, 'material', v.material,
          'position', v.position
        ) order by v.position, v.id)
        from aura.product_variants v where v.product_id = p.id
      ), '[]'::jsonb),
      'media', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'kind', m.kind, 'url', m.url,
          'altText', m.alt_text, 'position', m.position
        ) order by m.position, m.id)
        from aura.product_media m where m.product_id = p.id
      ), '[]'::jsonb),
      'attributes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'attributeId', av.attribute_id, 'key', a.key, 'value', av.value
        ) order by a.key)
        from aura.product_attribute_values av
        join aura.category_attributes a on a.id = av.attribute_id
        where av.product_id = p.id
      ), '[]'::jsonb)
    )
    from aura.products p
    join aura.categories c on c.id = p.category_id
    where p.id = p_product
  $$;

-- ---------------------------------------------------------------------------
-- Lifecycle guards. These are the authoritative transition rules; the API is a
-- second check, not the only one.
-- ---------------------------------------------------------------------------
create or replace function aura.seller_profiles_guard() returns trigger
  language plpgsql
  as $$
  declare
    v_actor uuid := aura.current_principal();
    v_content boolean := false;
    v_reset boolean := false;
  begin
    if v_actor is null then
      raise exception 'identity_required' using errcode = '28000';
    end if;

    if tg_op = 'INSERT' then
      if new.status <> 'draft' then
        raise exception 'invalid_status_transition' using errcode = '23514';
      end if;
      if new.created_by <> v_actor then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if not aura.is_active_member(new.org_id, array['owner', 'admin']) then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      new.submitted_at := null;
      new.reviewed_at := null;
      new.reviewed_by := null;
      new.review_note := null;
      return new;
    end if;

    if new.id <> old.id or new.org_id <> old.org_id or new.created_by <> old.created_by then
      raise exception 'immutable_field' using errcode = '42501';
    end if;

    if new.display_name is distinct from old.display_name
       or new.legal_name is distinct from old.legal_name
       or new.business_email is distinct from old.business_email
       or new.country is distinct from old.country
       or new.website is distinct from old.website
       or new.description is distinct from old.description then
      v_content := true;
    end if;

    -- Business information is managed by the organization's owner or admin,
    -- regardless of the review state; the API enforces the same rule.
    if v_content
       and not aura.is_active_member(new.org_id, array['owner', 'admin']) then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    if new.status is distinct from old.status then
      if not (
        (old.status = 'draft' and new.status = 'submitted')
        or (old.status = 'rejected' and new.status = 'submitted')
        or (old.status = 'approved' and new.status = 'submitted')
        or (old.status = 'submitted' and new.status = 'approved')
        or (old.status = 'submitted' and new.status = 'rejected')
      ) then
        raise exception 'invalid_status_transition' using errcode = '23514';
      end if;

      if new.status in ('approved', 'rejected') then
        if not aura.is_platform_admin() then
          raise exception 'forbidden' using errcode = '42501';
        end if;
        if new.status = 'rejected'
           and (new.review_note is null or char_length(trim(new.review_note)) = 0) then
          raise exception 'review_note_required' using errcode = '22023';
        end if;
        new.reviewed_at := now();
        new.reviewed_by := v_actor;
        if new.status = 'approved' then
          new.review_note := null;
        end if;
      else
        -- Submission is a seller action: an active owner or admin only.
        if not aura.is_active_member(new.org_id, array['owner', 'admin']) then
          raise exception 'forbidden' using errcode = '42501';
        end if;
        new.submitted_at := now();
        new.reviewed_at := null;
        new.reviewed_by := null;
        new.review_note := null;
      end if;
      return new;
    end if;

    if new.status = 'submitted' and v_content then
      raise exception 'seller_locked' using errcode = '23514';
    end if;

    -- A material business-information change on an approved seller requires a
    -- fresh review: the profile returns to draft instead of staying approved.
    if new.status = 'approved' and v_content then
      if not aura.is_active_member(new.org_id, array['owner', 'admin']) then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      new.status := 'draft';
      new.submitted_at := null;
      new.reviewed_at := null;
      new.reviewed_by := null;
      new.review_note := null;
      v_reset := true;
    end if;

    if not v_reset
       and (new.reviewed_at is distinct from old.reviewed_at
            or new.reviewed_by is distinct from old.reviewed_by)
       and not aura.is_platform_admin() then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    return new;
  end
  $$;

create or replace function aura.products_guard() returns trigger
  language plpgsql
  as $$
  declare
    v_actor uuid := aura.current_principal();
    v_content boolean := false;
    v_seller_status text;
    v_revision aura.product_revisions;
    v_missing integer;
    v_variant integer;
  begin
    if v_actor is null then
      raise exception 'identity_required' using errcode = '28000';
    end if;

    if tg_op = 'INSERT' then
      if new.status <> 'draft' then
        raise exception 'invalid_status_transition' using errcode = '23514';
      end if;
      if new.created_by <> v_actor then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if not aura.is_active_member(new.org_id, array['owner', 'admin', 'member']) then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      select status into v_seller_status
        from aura.seller_profiles where id = new.seller_profile_id;
      if v_seller_status is distinct from 'approved' then
        raise exception 'seller_not_approved' using errcode = '23514';
      end if;
      new.pending_changes := false;
      new.approved_revision_id := null;
      new.submitted_at := null;
      new.approved_at := null;
      new.archived_at := null;
      return new;
    end if;

    if new.id <> old.id
       or new.org_id <> old.org_id
       or new.seller_profile_id <> old.seller_profile_id
       or new.category_id <> old.category_id
       or new.created_by <> old.created_by then
      raise exception 'immutable_field' using errcode = '42501';
    end if;

    if new.slug is distinct from old.slug
       or new.title is distinct from old.title
       or new.summary is distinct from old.summary
       or new.description is distinct from old.description then
      v_content := true;
    end if;

    if new.status is distinct from old.status then
      if new.status = 'archived' then
        if not (aura.is_active_member(new.org_id, array['owner', 'admin'])
                or aura.is_platform_admin()) then
          raise exception 'forbidden' using errcode = '42501';
        end if;
        new.archived_at := now();
        new.pending_changes := false;
        return new;
      end if;

      if new.status = 'submitted' then
        if not aura.is_active_member(new.org_id, array['owner', 'admin', 'member']) then
          raise exception 'forbidden' using errcode = '42501';
        end if;
        if not (
          (old.status = 'draft')
          or (old.status = 'rejected')
          or (old.status = 'approved' and old.pending_changes)
        ) then
          raise exception 'invalid_status_transition' using errcode = '23514';
        end if;
        select status into v_seller_status
          from aura.seller_profiles where org_id = new.org_id;
        if v_seller_status is distinct from 'approved' then
          raise exception 'seller_not_approved' using errcode = '23514';
        end if;

        select count(*) into v_variant
          from aura.product_variants where product_id = new.id;
        if v_variant = 0 then
          raise exception 'product_incomplete' using errcode = '23514';
        end if;
        select count(*) into v_missing
          from aura.category_attributes a
          where a.category_id = new.category_id
            and a.is_required
            and not exists (
              select 1 from aura.product_attribute_values v
              where v.product_id = new.id and v.attribute_id = a.id
            );
        if v_missing > 0 then
          raise exception 'product_incomplete' using errcode = '23514';
        end if;

        new.pending_changes := false;
        new.submitted_at := now();
        return new;
      end if;

      if old.status = 'submitted' and new.status in ('approved', 'rejected') then
        if not aura.is_platform_admin() then
          raise exception 'forbidden' using errcode = '42501';
        end if;
        if new.status = 'approved' then
          if new.approved_revision_id is null then
            raise exception 'revision_required' using errcode = '23514';
          end if;
          select * into v_revision
            from aura.product_revisions
            where id = new.approved_revision_id
              and org_id = new.org_id
              and product_id = new.id;
          if not found or v_revision.decision <> 'approved' then
            raise exception 'revision_not_approved' using errcode = '23514';
          end if;
          new.pending_changes := false;
          new.approved_at := now();
        else
          new.pending_changes := false;
        end if;
        return new;
      end if;

      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;

    -- Same-state updates: content, or a new approved-revision pointer.
    if new.status = 'archived' and v_content then
      raise exception 'product_locked' using errcode = '23514';
    end if;
    if new.status = 'submitted' and v_content then
      raise exception 'product_locked' using errcode = '23514';
    end if;
    if new.pending_changes and new.status <> 'approved' then
      raise exception 'invalid_pending_changes' using errcode = '23514';
    end if;

    -- Review metadata is written by the platform path only, never by a seller.
    if new.submitted_at is distinct from old.submitted_at
       or new.archived_at is distinct from old.archived_at then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    if new.approved_revision_id is distinct from old.approved_revision_id
       or new.approved_at is distinct from old.approved_at then
      if not aura.is_platform_admin() then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if new.approved_revision_id is not null then
        select * into v_revision
          from aura.product_revisions
          where id = new.approved_revision_id
            and org_id = new.org_id
            and product_id = new.id;
        if not found or v_revision.decision <> 'approved' then
          raise exception 'revision_not_approved' using errcode = '23514';
        end if;
      end if;
    end if;

    if new.status = 'approved' and v_content then
      if not aura.is_active_member(new.org_id, array['owner', 'admin', 'member']) then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      -- Editing approved content makes the working copy unapproved; the stored
      -- approved revision stays as the last reviewable publication.
      new.pending_changes := true;
    end if;

    return new;
  end
  $$;

create or replace function aura.product_revisions_guard() returns trigger
  language plpgsql
  as $$
  declare
    v_actor uuid := aura.current_principal();
    v_product aura.products;
  begin
    if v_actor is null then
      raise exception 'identity_required' using errcode = '28000';
    end if;

    if tg_op = 'INSERT' then
      select * into v_product
        from aura.products where id = new.product_id for update;
      if not found then
        raise exception 'product_not_found' using errcode = 'P0002';
      end if;
      if v_product.org_id <> new.org_id or v_product.status = 'archived' then
        raise exception 'invalid_status_transition' using errcode = '23514';
      end if;
      if not aura.is_active_member(new.org_id, array['owner', 'admin', 'member']) then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if not (
        v_product.status in ('draft', 'rejected')
        or (v_product.status = 'approved' and v_product.pending_changes)
      ) then
        raise exception 'product_locked' using errcode = '23514';
      end if;
      if new.submitted_by <> v_actor then
        raise exception 'forbidden' using errcode = '42501';
      end if;

      new.id := coalesce(new.id, gen_random_uuid());
      new.decision := 'pending';
      new.reviewed_at := null;
      new.reviewed_by := null;
      new.review_note := null;
      new.submitted_at := now();
      new.revision_number := coalesce((
        select max(revision_number) from aura.product_revisions
        where product_id = new.product_id
      ), 0) + 1;
      -- The snapshot is derived from authoritative rows, never from input.
      new.snapshot := aura.build_product_snapshot(new.product_id);
      return new;
    end if;

    if tg_op = 'DELETE' then
      raise exception 'append_only' using errcode = '42501';
    end if;

    if new.id <> old.id
       or new.org_id <> old.org_id
       or new.product_id <> old.product_id
       or new.revision_number <> old.revision_number
       or new.snapshot is distinct from old.snapshot
       or new.submitted_by <> old.submitted_by
       or new.submitted_at <> old.submitted_at then
      raise exception 'immutable_field' using errcode = '42501';
    end if;
    if old.decision <> 'pending' then
      raise exception 'append_only' using errcode = '42501';
    end if;
    if new.decision is distinct from old.decision then
      if not aura.is_platform_admin() then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if new.decision not in ('approved', 'rejected') then
        raise exception 'invalid_status_transition' using errcode = '23514';
      end if;
      select * into v_product
        from aura.products where id = new.product_id and org_id = old.org_id;
      if not found or v_product.status <> 'submitted' then
        raise exception 'invalid_status_transition' using errcode = '23514';
      end if;
      if new.decision = 'rejected'
         and (new.review_note is null or char_length(trim(new.review_note)) = 0) then
        raise exception 'review_note_required' using errcode = '22023';
      end if;
      new.reviewed_by := v_actor;
      new.reviewed_at := now();
    else
      if new.review_note is distinct from old.review_note
         or new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at then
        raise exception 'immutable_field' using errcode = '42501';
      end if;
    end if;

    return new;
  end
  $$;

create or replace function aura.product_attribute_values_guard() returns trigger
  language plpgsql
  as $$
  declare
    v_category uuid;
    v_attribute aura.category_attributes;
  begin
    select category_id into v_category from aura.products where id = new.product_id;
    select * into v_attribute from aura.category_attributes where id = new.attribute_id;
    if not found or v_category is distinct from v_attribute.category_id then
      raise exception 'attribute_not_in_category' using errcode = '23503';
    end if;
    if v_attribute.data_type = 'select' and not (new.value = any (v_attribute.options)) then
      raise exception 'invalid_attribute_value' using errcode = '23514';
    elsif v_attribute.data_type = 'number' and new.value !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' then
      raise exception 'invalid_attribute_value' using errcode = '23514';
    elsif v_attribute.data_type = 'boolean' and new.value not in ('true', 'false') then
      raise exception 'invalid_attribute_value' using errcode = '23514';
    end if;
    return new;
  end
  $$;

-- Variants, media references and attribute values follow their product's
-- lifecycle. They cannot change while the product is under review or archived,
-- and changing them on an approved product clears the approval, so a fresh
-- review is required before it can be sold again.
create or replace function aura.catalogue_child_guard() returns trigger
  language plpgsql
  as $$
  declare
    v_actor uuid := aura.current_principal();
    v_product aura.products;
    v_id uuid;
  begin
    if v_actor is null then
      raise exception 'identity_required' using errcode = '28000';
    end if;

    if tg_op = 'DELETE' then
      v_id := old.product_id;
    else
      v_id := new.product_id;
    end if;

    -- Lock the parent: a concurrent submit or approval must not interleave
    -- with a content change.
    select * into v_product from aura.products where id = v_id for update;
    if not found then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;

    if tg_op = 'DELETE' then
      if old.org_id <> v_product.org_id then
        raise exception 'forbidden' using errcode = '42501';
      end if;
    else
      if new.org_id <> v_product.org_id then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if tg_op = 'UPDATE'
         and (new.product_id <> old.product_id or new.org_id <> old.org_id) then
        raise exception 'immutable_field' using errcode = '42501';
      end if;
    end if;

    if v_product.status in ('submitted', 'archived') then
      raise exception 'product_locked' using errcode = '23514';
    end if;

    if v_product.status = 'approved' and not v_product.pending_changes then
      update aura.products set pending_changes = true where id = v_product.id;
    end if;

    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end
  $$;

create or replace function aura.audit_events_guard() returns trigger
  language plpgsql
  as $$
  begin
    raise exception 'append_only' using errcode = '42501';
  end
  $$;

-- ---------------------------------------------------------------------------
-- Audit writers. They run with the caller's identity, which is bound by the
-- backend transaction, so the actor recorded is the actor that was verified.
-- ---------------------------------------------------------------------------
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
          and e.key not in ('updated_at', 'submitted_at', 'reviewed_at', 'reviewed_by', 'review_note');
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

create or replace function aura.audit_product() returns trigger
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
         'product', new.id, 'product.created', null, new.status,
         jsonb_build_object('title', new.title, 'categoryId', new.category_id));
      return null;
    end if;

    if new.status is distinct from old.status then
      insert into aura.audit_events
        (org_id, actor_principal_id, entity_type, entity_id, action, from_state, to_state, detail)
      values
        (new.org_id, coalesce(aura.current_principal(), new.created_by),
         'product', new.id,
         case
           when new.status = 'submitted' then 'product.submitted'
           when new.status = 'approved' then 'product.approved'
           when new.status = 'rejected' then 'product.rejected'
           when new.status = 'archived' then 'product.archived'
           else 'product.updated'
         end,
         old.status, new.status,
         jsonb_build_object('approvedRevisionId', new.approved_revision_id));
    end if;

    -- Content changes made through the child tables flip this flag; record the
  -- decision that an approved listing now needs a fresh review.
    if new.pending_changes and not old.pending_changes then
      insert into aura.audit_events
        (org_id, actor_principal_id, entity_type, entity_id, action, from_state, to_state, detail)
      values
        (new.org_id, coalesce(aura.current_principal(), new.created_by),
         'product', new.id, 'product.revised', old.status, new.status,
         jsonb_build_object('pendingChanges', true));
    end if;

    select coalesce(jsonb_agg(e.key order by e.key), '[]'::jsonb) into v_fields
      from jsonb_each(to_jsonb(new)) e
      where to_jsonb(old) -> e.key is distinct from e.value
        and e.key not in ('updated_at', 'submitted_at', 'approved_at', 'archived_at',
                          'status', 'pending_changes', 'approved_revision_id');
    if jsonb_array_length(v_fields) > 0 then
      insert into aura.audit_events
        (org_id, actor_principal_id, entity_type, entity_id, action, from_state, to_state, detail)
      values
        (new.org_id, coalesce(aura.current_principal(), new.created_by),
         'product', new.id,
         case when new.status = old.status then 'product.updated' else 'product.revised' end,
         old.status, new.status,
         jsonb_build_object('fields', v_fields, 'pendingChanges', new.pending_changes));
    end if;
    return null;
  end
  $$;

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------
drop trigger if exists seller_profiles_guard on aura.seller_profiles;
create trigger seller_profiles_guard before insert or update on aura.seller_profiles
  for each row execute function aura.seller_profiles_guard();

drop trigger if exists seller_profiles_touch on aura.seller_profiles;
create trigger seller_profiles_touch before update on aura.seller_profiles
  for each row execute function aura.touch_updated_at();

drop trigger if exists seller_profiles_audit on aura.seller_profiles;
create trigger seller_profiles_audit after insert or update on aura.seller_profiles
  for each row execute function aura.audit_seller_profile();

drop trigger if exists products_guard on aura.products;
create trigger products_guard before insert or update on aura.products
  for each row execute function aura.products_guard();

drop trigger if exists products_touch on aura.products;
create trigger products_touch before update on aura.products
  for each row execute function aura.touch_updated_at();

drop trigger if exists products_audit on aura.products;
create trigger products_audit after insert or update on aura.products
  for each row execute function aura.audit_product();

drop trigger if exists product_revisions_guard on aura.product_revisions;
create trigger product_revisions_guard before insert or update or delete on aura.product_revisions
  for each row execute function aura.product_revisions_guard();

drop trigger if exists product_attribute_values_guard on aura.product_attribute_values;
create trigger product_attribute_values_guard
  before insert or update on aura.product_attribute_values
  for each row execute function aura.product_attribute_values_guard();

drop trigger if exists product_variants_lifecycle on aura.product_variants;
create trigger product_variants_lifecycle
  before insert or update or delete on aura.product_variants
  for each row execute function aura.catalogue_child_guard();

drop trigger if exists product_media_lifecycle on aura.product_media;
create trigger product_media_lifecycle
  before insert or update or delete on aura.product_media
  for each row execute function aura.catalogue_child_guard();

drop trigger if exists product_attribute_values_lifecycle on aura.product_attribute_values;
create trigger product_attribute_values_lifecycle
  before insert or update or delete on aura.product_attribute_values
  for each row execute function aura.catalogue_child_guard();

drop trigger if exists audit_events_guard on aura.audit_events;
create trigger audit_events_guard before update or delete on aura.audit_events
  for each row execute function aura.audit_events_guard();

-- ---------------------------------------------------------------------------
-- Row level security. Default deny on every tenant table.
-- ---------------------------------------------------------------------------
-- Platform administrators reviewing a seller need the organization name. The
-- policy is additive: membership visibility defined in 0002 is unchanged.
drop policy if exists organizations_platform_admin_select on aura.organizations;
create policy organizations_platform_admin_select on aura.organizations
  for select using (aura.is_platform_admin());

alter table aura.seller_profiles enable row level security;
alter table aura.products enable row level security;
alter table aura.product_revisions enable row level security;
alter table aura.product_variants enable row level security;
alter table aura.product_media enable row level security;
alter table aura.product_attribute_values enable row level security;
alter table aura.audit_events enable row level security;
alter table aura.categories enable row level security;
alter table aura.category_attributes enable row level security;

-- Global reference data: readable by the runtime role, never writable.
drop policy if exists categories_read on aura.categories;
create policy categories_read on aura.categories for select using (true);
drop policy if exists category_attributes_read on aura.category_attributes;
create policy category_attributes_read on aura.category_attributes for select using (true);

drop policy if exists seller_profiles_member_select on aura.seller_profiles;
create policy seller_profiles_member_select on aura.seller_profiles
  for select using (aura.is_active_member(org_id) or aura.is_platform_admin());

drop policy if exists seller_profiles_staff_insert on aura.seller_profiles;
create policy seller_profiles_staff_insert on aura.seller_profiles
  for insert with check (
    created_by = aura.current_principal()
    and aura.is_active_member(org_id, array['owner', 'admin'])
  );

drop policy if exists seller_profiles_staff_update on aura.seller_profiles;
create policy seller_profiles_staff_update on aura.seller_profiles
  for update using (aura.is_active_member(org_id, array['owner', 'admin']))
  with check (aura.is_active_member(org_id, array['owner', 'admin']));

drop policy if exists seller_profiles_admin_update on aura.seller_profiles;
create policy seller_profiles_admin_update on aura.seller_profiles
  for update using (aura.is_platform_admin())
  with check (aura.is_platform_admin());

drop policy if exists products_member_select on aura.products;
create policy products_member_select on aura.products
  for select using (aura.is_active_member(org_id) or aura.is_platform_admin());

drop policy if exists products_writer_insert on aura.products;
create policy products_writer_insert on aura.products
  for insert with check (
    created_by = aura.current_principal()
    and aura.is_active_member(org_id, array['owner', 'admin', 'member'])
  );

drop policy if exists products_writer_update on aura.products;
create policy products_writer_update on aura.products
  for update using (aura.is_active_member(org_id, array['owner', 'admin', 'member']))
  with check (aura.is_active_member(org_id, array['owner', 'admin', 'member']));

drop policy if exists products_admin_update on aura.products;
create policy products_admin_update on aura.products
  for update using (aura.is_platform_admin())
  with check (aura.is_platform_admin());

drop policy if exists product_revisions_member_select on aura.product_revisions;
create policy product_revisions_member_select on aura.product_revisions
  for select using (aura.is_active_member(org_id) or aura.is_platform_admin());

drop policy if exists product_revisions_writer_insert on aura.product_revisions;
create policy product_revisions_writer_insert on aura.product_revisions
  for insert with check (
    submitted_by = aura.current_principal()
    and aura.is_active_member(org_id, array['owner', 'admin', 'member'])
  );

drop policy if exists product_revisions_admin_update on aura.product_revisions;
create policy product_revisions_admin_update on aura.product_revisions
  for update using (aura.is_platform_admin())
  with check (aura.is_platform_admin());

drop policy if exists product_variants_member_select on aura.product_variants;
create policy product_variants_member_select on aura.product_variants
  for select using (aura.is_active_member(org_id) or aura.is_platform_admin());

drop policy if exists product_variants_writer_insert on aura.product_variants;
create policy product_variants_writer_insert on aura.product_variants
  for insert with check (
    created_by = aura.current_principal()
    and aura.is_active_member(org_id, array['owner', 'admin', 'member'])
  );

drop policy if exists product_variants_writer_update on aura.product_variants;
create policy product_variants_writer_update on aura.product_variants
  for update using (aura.is_active_member(org_id, array['owner', 'admin', 'member']))
  with check (aura.is_active_member(org_id, array['owner', 'admin', 'member']));

drop policy if exists product_variants_writer_delete on aura.product_variants;
create policy product_variants_writer_delete on aura.product_variants
  for delete using (aura.is_active_member(org_id, array['owner', 'admin', 'member']));

drop policy if exists product_media_member_select on aura.product_media;
create policy product_media_member_select on aura.product_media
  for select using (aura.is_active_member(org_id) or aura.is_platform_admin());

drop policy if exists product_media_writer_insert on aura.product_media;
create policy product_media_writer_insert on aura.product_media
  for insert with check (
    created_by = aura.current_principal()
    and aura.is_active_member(org_id, array['owner', 'admin', 'member'])
  );

drop policy if exists product_media_writer_update on aura.product_media;
create policy product_media_writer_update on aura.product_media
  for update using (aura.is_active_member(org_id, array['owner', 'admin', 'member']))
  with check (aura.is_active_member(org_id, array['owner', 'admin', 'member']));

drop policy if exists product_media_writer_delete on aura.product_media;
create policy product_media_writer_delete on aura.product_media
  for delete using (aura.is_active_member(org_id, array['owner', 'admin', 'member']));

drop policy if exists product_attribute_values_member_select on aura.product_attribute_values;
create policy product_attribute_values_member_select on aura.product_attribute_values
  for select using (aura.is_active_member(org_id) or aura.is_platform_admin());

drop policy if exists product_attribute_values_writer_insert on aura.product_attribute_values;
create policy product_attribute_values_writer_insert on aura.product_attribute_values
  for insert with check (
    aura.is_active_member(org_id, array['owner', 'admin', 'member'])
  );

drop policy if exists product_attribute_values_writer_update on aura.product_attribute_values;
create policy product_attribute_values_writer_update on aura.product_attribute_values
  for update using (aura.is_active_member(org_id, array['owner', 'admin', 'member']))
  with check (aura.is_active_member(org_id, array['owner', 'admin', 'member']));

drop policy if exists product_attribute_values_writer_delete on aura.product_attribute_values;
create policy product_attribute_values_writer_delete on aura.product_attribute_values
  for delete using (aura.is_active_member(org_id, array['owner', 'admin', 'member']));

drop policy if exists audit_events_member_select on aura.audit_events;
create policy audit_events_member_select on aura.audit_events
  for select using (aura.is_active_member(org_id) or aura.is_platform_admin());

drop policy if exists audit_events_actor_insert on aura.audit_events;
create policy audit_events_actor_insert on aura.audit_events
  for insert with check (
    actor_principal_id = aura.current_principal()
    and (aura.is_active_member(org_id) or aura.is_platform_admin())
  );

-- ---------------------------------------------------------------------------
-- Publication projection. Row visibility is still decided by the caller's RLS,
-- so this view is not a public read path; it only fixes the purchasability
-- predicate in one authoritative place for later commerce phases.
-- ---------------------------------------------------------------------------
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
     and s.status = 'approved';
