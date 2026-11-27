-- Phase 3 review separation of duties (four eyes).
--
-- A platform administrator reviews other organizations. If the same principal
-- also holds an active membership of the seller organization, the decision is
-- refused in the database itself, so direct SQL cannot bypass the rule that the
-- API enforces. Decisions on unrelated organizations are unchanged: the grant
-- alone still authorizes them.
--
-- The guard is a separate trigger rather than an edit to the lifecycle guards so
-- the rule has one definition and one place to audit. Trigger execution order
-- only affects which error a caller sees first; both paths refuse the change.

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

revoke all on function aura.review_separation_guard() from public;
grant execute on function aura.review_separation_guard() to aura_app;

drop trigger if exists seller_profiles_review_separation on aura.seller_profiles;
create trigger seller_profiles_review_separation
  before update on aura.seller_profiles
  for each row execute function aura.review_separation_guard();

drop trigger if exists products_review_separation on aura.products;
create trigger products_review_separation
  before update on aura.products
  for each row execute function aura.review_separation_guard();

drop trigger if exists product_revisions_review_separation on aura.product_revisions;
create trigger product_revisions_review_separation
  before update on aura.product_revisions
  for each row execute function aura.review_separation_guard();
