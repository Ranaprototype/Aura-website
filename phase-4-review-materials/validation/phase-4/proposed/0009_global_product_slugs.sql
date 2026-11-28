-- ============================================================================
-- PROPOSED Phase 4 migration 0009 — globally unique product slugs.
-- VALIDATION ARTIFACT ONLY (see 0008 header). Additive; runs as the table
-- OWNER migration role inside one transaction.
--
-- Why triggers are disabled for the backfill: aura.products_guard requires a
-- bound principal and organization membership for content edits, and
-- aura.catalogue_suspension_guard refuses writes for suspended sellers. A
-- migration operator is neither a member nor exempt, so the rename backfill
-- would fail with identity_required / seller_suspended. Disabling ONLY the
-- two user triggers (owner privilege, no superuser needed, no
-- session_replication_role) keeps the audit trigger active: every rename is
-- still recorded in aura.audit_events with actor = created_by fallback.
-- products_touch is disabled so historical updated_at ordering is preserved.
-- ============================================================================

-- 1. Rename cross-organization duplicates deterministically. The earliest
--    product (created_at, id) keeps its slug; later ones gain a stable
--    id-derived suffix. The original slug is recorded as a redirect.
alter table aura.products disable trigger products_guard;
alter table aura.products disable trigger products_touch;
alter table aura.products disable trigger products_catalogue_suspension;

do $$
declare
  r record;
  v_new text;
  v_base text;
  n integer;
begin
  for r in
    select id, org_id, slug,
           row_number() over (partition by slug order by created_at, id) as rn
      from aura.products
  loop
    if r.rn = 1 then
      continue;
    end if;
    -- Slug check constraint allows at most 81 characters; reserve 9 for the
    -- '-' + 8 hex suffix and keep the result deterministic per product id.
    v_base := substr(r.slug, 1, 72);
    v_new := v_base || '-' || substr(r.id::text, 1, 8);
    n := 0;
    while exists (select 1 from aura.products where slug = v_new) loop
      n := n + 1;
      v_new := substr(v_base, 1, 72 - char_length(n::text) - 1) || '-' || n || '-' || substr(r.id::text, 1, 8);
    end loop;

    update aura.products set slug = v_new where id = r.id;
    insert into aura.slug_redirects (org_id, product_id, slug, replacement_slug, reason)
    values (r.org_id, r.id, r.slug, v_new, 'global_collision');
  end loop;
end
$$;

-- 2. Global uniqueness from now on. Plain CREATE UNIQUE INDEX inside the
--    migration transaction is acceptable at the current catalogue scale
--    (single-digit thousands of rows); a large-table deployment must schedule
--    CREATE UNIQUE INDEX CONCURRENTLY outside the transaction instead.
create unique index if not exists products_slug_global_key on aura.products (slug);

alter table aura.products enable trigger products_guard;
alter table aura.products enable trigger products_touch;
alter table aura.products enable trigger products_catalogue_suspension;
