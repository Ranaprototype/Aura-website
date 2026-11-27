-- Phase 3 privileges and platform-owned reference data.
--
-- The runtime role `aura_app` (created in 0004) receives only the privileges the
-- API needs. Row level security still decides which rows exist for it. Sellers
-- and catalogue rows can never be deleted: archiving is a state change, and
-- revisions and audit events are append-only by trigger.

-- ---------------------------------------------------------------------------
-- Catalogue reference data. Platform owned: seeded here, read-only to the app.
-- ---------------------------------------------------------------------------
insert into aura.categories (slug, name, description, position)
values
  ('sneakers', 'Sneakers', 'Footwear silhouettes.', 10),
  ('apparel', 'Apparel', 'Garment silhouettes.', 20),
  ('accessories', 'Accessories', 'Carry and wear accessories.', 30)
on conflict (slug) do nothing;

insert into aura.category_attributes (category_id, key, label, data_type, options, is_required, position)
select c.id, v.key, v.label, v.data_type, v.options, v.is_required, v.position
  from aura.categories c
  join (values
    ('sneakers', 'upper-material', 'Upper material', 'select',
      array['knit', 'leather', 'mesh', 'recycled-textile'], true, 10),
    ('sneakers', 'sole-type', 'Sole type', 'select',
      array['foam', 'carbon-plate', 'rubber'], false, 20),
    ('sneakers', 'fit', 'Fit', 'select',
      array['true-to-size', 'runs-small', 'runs-large'], false, 30),
    ('apparel', 'fabric', 'Fabric', 'select',
      array['organic-cotton', 'technical-knit', 'recycled-polyester'], true, 10),
    ('apparel', 'fit', 'Fit', 'select',
      array['relaxed', 'regular', 'slim'], false, 20),
    ('accessories', 'material', 'Material', 'select',
      array['recycled-nylon', 'leather-alternative', 'aluminium'], true, 10),
    ('accessories', 'length', 'Length (mm)', 'number', null, false, 20)
  ) as v(category_slug, key, label, data_type, options, is_required, position)
    on v.category_slug = c.slug
where not exists (
  select 1 from aura.category_attributes a
  where a.category_id = c.id and a.key = v.key
);

-- ---------------------------------------------------------------------------
-- Table privileges.
-- ---------------------------------------------------------------------------
revoke all on aura.seller_profiles, aura.categories, aura.category_attributes,
  aura.products, aura.product_revisions, aura.product_variants,
  aura.product_media, aura.product_attribute_values, aura.audit_events
  from public;

grant select on aura.categories, aura.category_attributes to aura_app;

grant select, insert, update on aura.seller_profiles to aura_app;

grant select, insert, update on aura.products to aura_app;
grant select, insert, update, delete on aura.product_variants to aura_app;
grant select, insert, update, delete on aura.product_media to aura_app;
grant select, insert, update, delete on aura.product_attribute_values to aura_app;
grant select, insert, update on aura.product_revisions to aura_app;

grant select, insert on aura.audit_events to aura_app;

-- Deletion is not a catalogue operation: archive instead, and keep the history.
revoke delete on aura.seller_profiles, aura.products, aura.product_revisions,
  aura.audit_events from aura_app;

grant select on aura.storefront_products to aura_app;

-- ---------------------------------------------------------------------------
-- Function privileges. The implicit PUBLIC grant is stripped first.
-- ---------------------------------------------------------------------------
revoke all on function
  aura.is_platform_admin(),
  aura.build_product_snapshot(uuid),
  aura.seller_profiles_guard(),
  aura.products_guard(),
  aura.product_revisions_guard(),
  aura.product_attribute_values_guard(),
  aura.catalogue_child_guard(),
  aura.audit_events_guard(),
  aura.audit_seller_profile(),
  aura.audit_product()
  from public;

grant execute on function
  aura.is_platform_admin(),
  aura.build_product_snapshot(uuid),
  aura.seller_profiles_guard(),
  aura.products_guard(),
  aura.product_revisions_guard(),
  aura.product_attribute_values_guard(),
  aura.catalogue_child_guard(),
  aura.audit_events_guard(),
  aura.audit_seller_profile(),
  aura.audit_product()
  to aura_app;
