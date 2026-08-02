-- Supabase's project postgres role is intentionally not a superuser. Give the
-- reviewed bootstrap operator only the SET capability required to execute the
-- projector-owned bootstrap functions. Runtime logins remain separate.

grant programmable_projector to postgres with inherit false, set true;

do $bootstrap_projector_membership$
begin
  if not pg_catalog.pg_has_role(
    'postgres',
    'programmable_projector',
    'set'
  ) then
    raise exception 'bootstrap connection cannot set programmable_projector';
  end if;
end
$bootstrap_projector_membership$;

