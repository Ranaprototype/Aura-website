-- ============================================================================
-- Reviewed rollback for 0009 (global product slugs). Operational script; run
-- only by the table OWNER migration role after a reviewed forward-fix decision.
-- Restores the pre-migration per-organization slug state and removes ONLY the
-- migration-created collision redirects. Any later, non-migration redirect
-- rows (future seller rename feature) are untouched.
--
-- Safety: aborts if a renamed product's slug has changed since the migration
-- (replacement_slug no longer matches). In that case a reviewed forward fix
-- is required; this script must never guess. Restoring duplicates is legal
-- because the per-organization unique constraint (products_org_slug_key) was
-- the original invariant and is still present.
-- ============================================================================

do $$
begin
  if exists (
    select 1
      from aura.slug_redirects r
      join aura.products p on p.id = r.product_id and p.org_id = r.org_id
     where r.reason = 'global_collision'
       and p.slug is distinct from r.replacement_slug
  ) then
    raise exception 'slug_redirect_rollback_conflict' using errcode = '23505';
  end if;
end
$$;

drop index if exists aura.products_slug_global_key;

alter table aura.products disable trigger products_guard;
alter table aura.products disable trigger products_touch;
alter table aura.products disable trigger products_catalogue_suspension;

update aura.products p
   set slug = r.slug
  from aura.slug_redirects r
 where r.product_id = p.id
   and r.org_id = p.org_id
   and r.reason = 'global_collision';

delete from aura.slug_redirects where reason = 'global_collision';

alter table aura.products enable trigger products_guard;
alter table aura.products enable trigger products_touch;
alter table aura.products enable trigger products_catalogue_suspension;
