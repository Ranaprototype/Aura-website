-- Phase 2 role and privilege boundary.
--
-- The runtime connects with a non-owner role that has no BYPASSRLS, no schema
-- creation, no grant option and no table ownership, so every policy in 0002 is
-- actually enforced. In production the operator creates the *login* role and
-- grants it membership in aura_app; the migration only owns the group role.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aura_app') then
    create role aura_app nologin noinherit nosuperuser nocreatedb nocreaterole
      noreplication nobypassrls;
  end if;
end
$$;

revoke all on schema aura from public;
grant usage on schema aura to aura_app;

-- Identity and notification infrastructure: reachable only by the backend role
-- and only through parameterized statements (token digest, or exact email).
revoke all on aura.principals, aura.credentials, aura.sessions, aura.auth_tokens,
  aura.email_events, aura.email_rate_limits, aura.auth_rate_limits,
  aura.platform_admins from public;

grant select, insert, update on aura.principals to aura_app;
grant select, insert, update on aura.credentials to aura_app;
grant select, insert, update, delete on aura.sessions to aura_app;
grant select, insert, update, delete on aura.auth_tokens to aura_app;
grant select, insert, update on aura.email_events to aura_app;
grant select, insert, update, delete on aura.email_rate_limits to aura_app;
grant select, insert, update, delete on aura.auth_rate_limits to aura_app;
grant select on aura.platform_admins to aura_app;

-- Tenanted tables: RLS decides the rows; these grants only permit the attempt.
revoke all on aura.organizations, aura.memberships, aura.invitations, aura.projects
  from public;

grant select on aura.organizations to aura_app;
grant select on aura.memberships to aura_app;
grant select, insert, update on aura.invitations to aura_app;
grant select, insert, update, delete on aura.projects to aura_app;

-- No INSERT/UPDATE/DELETE grant on organizations or memberships: those changes
-- must go through the provisioning functions, which re-check the actor role.
revoke insert, update, delete on aura.organizations from aura_app;
revoke insert, update, delete on aura.memberships from aura_app;

-- Security definer functions: strip the implicit PUBLIC EXECUTE before granting
-- the runtime role, otherwise anon/authenticated keys could call them.
revoke all on function
  aura.current_principal(),
  aura.current_org(),
  aura.is_active_member(uuid, text[]),
  aura.create_organization(text, text),
  aura.set_member_role(uuid, uuid, text),
  aura.revoke_membership(uuid, uuid),
  aura.accept_invitation(bytea),
  aura.org_members(uuid),
  aura.prune_rate_limits(timestamptz)
  from public;

grant execute on function
  aura.current_principal(),
  aura.current_org(),
  aura.is_active_member(uuid, text[])
  to aura_app;

grant execute on function
  aura.create_organization(text, text),
  aura.set_member_role(uuid, uuid, text),
  aura.revoke_membership(uuid, uuid),
  aura.accept_invitation(bytea),
  aura.org_members(uuid),
  aura.prune_rate_limits(timestamptz)
  to aura_app;
