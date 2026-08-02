-- Distributed replay protection for privileged public-route release probes.
--
-- The application connects as programmable_release_probe_nonce_login, verifies
-- that exact session_user, then uses SET LOCAL ROLE
-- programmable_release_probe_nonce and verifies that exact current_role before
-- calling the function below. The function is SECURITY DEFINER, so current_role
-- changes to the owner inside its body; current_setting('role', true) preserves
-- the explicitly selected capability and is the in-function role assertion.

do $bootstrap$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'programmable_release_probe_nonce'
  ) then
    create role programmable_release_probe_nonce
      nologin nosuperuser nocreatedb nocreaterole noinherit
      noreplication nobypassrls;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'programmable_release_probe_nonce_login'
  ) then
    create role programmable_release_probe_nonce_login
      login password null nosuperuser nocreatedb nocreaterole noinherit
      noreplication nobypassrls;
  end if;
end
$bootstrap$;

alter role programmable_release_probe_nonce
  nologin nocreatedb nocreaterole noinherit;
alter role programmable_release_probe_nonce_login
  login password null nocreatedb nocreaterole noinherit;

do $posture$
begin
  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = any (array[
      'programmable_release_probe_nonce',
      'programmable_release_probe_nonce_login'
    ]::name[])
      and (rolsuper or rolreplication or rolbypassrls)
  ) then
    raise exception 'programmable release-probe role posture is privileged';
  end if;
end
$posture$;

grant programmable_release_probe_nonce
  to programmable_release_probe_nonce_login
  with inherit false, set true;

create schema if not exists programmable_release_probe_private
  authorization programmable_migrator;
alter schema programmable_release_probe_private owner to programmable_migrator;
revoke all on schema programmable_release_probe_private
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login,
  programmable_release_probe_nonce_login;

set role programmable_migrator;

alter default privileges for role programmable_migrator
in schema programmable_release_probe_private
  revoke all on tables from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler,
    programmable_api_reader, programmable_profile_binder,
    programmable_profile_recovery, programmable_profile_writer,
    programmable_maintenance, programmable_api_reader_login,
    programmable_projector_login, programmable_reconciler_login,
    programmable_release_probe_nonce,
    programmable_release_probe_nonce_login;
alter default privileges for role programmable_migrator
in schema programmable_release_probe_private
  revoke all on sequences from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler,
    programmable_api_reader, programmable_profile_binder,
    programmable_profile_recovery, programmable_profile_writer,
    programmable_maintenance, programmable_api_reader_login,
    programmable_projector_login, programmable_reconciler_login,
    programmable_release_probe_nonce,
    programmable_release_probe_nonce_login;
alter default privileges for role programmable_migrator
in schema programmable_release_probe_private
  revoke execute on functions from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler,
    programmable_api_reader, programmable_profile_binder,
    programmable_profile_recovery, programmable_profile_writer,
    programmable_maintenance, programmable_api_reader_login,
    programmable_projector_login, programmable_reconciler_login,
    programmable_release_probe_nonce,
    programmable_release_probe_nonce_login;
alter default privileges for role programmable_migrator
in schema programmable_release_probe_private
  revoke usage on types from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler,
    programmable_api_reader, programmable_profile_binder,
    programmable_profile_recovery, programmable_profile_writer,
    programmable_maintenance, programmable_api_reader_login,
    programmable_projector_login, programmable_reconciler_login,
    programmable_release_probe_nonce,
    programmable_release_probe_nonce_login;

create type programmable_release_probe_private.release_probe_route_key_v1
as enum (
  'explore-list',
  'explore-token',
  'explore-chart',
  'creator-profile',
  'classic-v3-profile',
  'launch-lookup'
);

create table programmable_release_probe_private.release_probe_nonce_consumptions_v1 (
  route_key
    programmable_release_probe_private.release_probe_route_key_v1 not null,
  nonce_digest bytea not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null,
  constraint release_probe_nonce_consumptions_v1_pkey
    primary key (route_key, nonce_digest),
  constraint release_probe_nonce_digest_check check (
    pg_catalog.octet_length(nonce_digest) = 32
  ),
  constraint release_probe_nonce_finite_time_check check (
    pg_catalog.isfinite(issued_at)
    and pg_catalog.isfinite(expires_at)
    and pg_catalog.isfinite(consumed_at)
  ),
  constraint release_probe_nonce_ttl_check check (
    expires_at >= issued_at + interval '1 second'
    and expires_at <= issued_at + interval '5 minutes'
  ),
  constraint release_probe_nonce_consumed_window_check check (
    issued_at <= consumed_at + interval '30 seconds'
    and consumed_at < expires_at
  )
);

comment on table
  programmable_release_probe_private.release_probe_nonce_consumptions_v1
is
  'Consumed release-probe SHA-256 nonces. Rows expire within five minutes, pruning removes at most 256 expired rows per call, and each route retains at most 4096 rows.';

alter table programmable_release_probe_private.release_probe_nonce_consumptions_v1
  enable row level security;
alter table programmable_release_probe_private.release_probe_nonce_consumptions_v1
  force row level security;

create policy release_probe_nonce_consumptions_v1_migrator_all
on programmable_release_probe_private.release_probe_nonce_consumptions_v1
for all
to programmable_migrator
using (true)
with check (true);

-- Equality by route plus the expiry range is the complete pruning access path.
create index release_probe_nonce_consumptions_v1_expiry_idx
on programmable_release_probe_private.release_probe_nonce_consumptions_v1 (
  route_key,
  expires_at,
  nonce_digest
);

create function programmable_release_probe_private.consume_release_probe_nonce_v1(
  p_route_key text,
  p_nonce_digest bytea,
  p_issued_at timestamptz,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  database_now timestamptz := pg_catalog.clock_timestamp();
  route_lock_slot integer;
  validated_route
    programmable_release_probe_private.release_probe_route_key_v1;
  inserted boolean;
begin
  -- A privileged role that can SET ROLE is still not the runtime identity.
  -- Both the dedicated login and its explicitly selected SET-only capability
  -- are required, including for superuser-originated test or admin sessions.
  if session_user::text <> 'programmable_release_probe_nonce_login'
     or active_role is distinct from 'programmable_release_probe_nonce'
  then
    raise exception using
      errcode = '42501',
      message = 'release probe nonce requires its dedicated runtime identity';
  end if;

  route_lock_slot := case p_route_key
    when 'explore-list' then 1
    when 'explore-token' then 2
    when 'explore-chart' then 3
    when 'creator-profile' then 4
    when 'classic-v3-profile' then 5
    when 'launch-lookup' then 6
    else null
  end;

  if route_lock_slot is null
     or p_nonce_digest is null
     or pg_catalog.octet_length(p_nonce_digest) <> 32
     or p_issued_at is null
     or p_expires_at is null
     or not pg_catalog.isfinite(p_issued_at)
     or not pg_catalog.isfinite(p_expires_at)
     or p_expires_at < p_issued_at + interval '1 second'
     or p_expires_at > p_issued_at + interval '5 minutes'
     or p_issued_at > database_now + interval '30 seconds'
     or p_expires_at <= database_now
  then
    raise exception using
      errcode = '22023',
      message = 'invalid release probe nonce envelope';
  end if;

  validated_route :=
    p_route_key::programmable_release_probe_private.release_probe_route_key_v1;

  -- One transaction-scoped lock per route makes the bounded capacity check
  -- exact under concurrency. Different routes never block one another.
  perform pg_catalog.pg_advisory_xact_lock(1347571538, route_lock_slot);

  -- A queued caller must still be fresh when it owns the route lock. Never
  -- authorize or stamp a row using the pre-lock clock sample.
  database_now := pg_catalog.clock_timestamp();
  if p_issued_at > database_now + interval '30 seconds'
     or p_expires_at <= database_now
  then
    raise exception using
      errcode = '22023',
      message = 'invalid release probe nonce envelope';
  end if;

  -- Pruning is deliberately bounded. The repeated expiry predicate in the
  -- DELETE prevents a selected row from being removed if its value changes,
  -- while the hard per-route ceiling below prevents unbounded retained state.
  with expired as materialized (
    select nonce.route_key, nonce.nonce_digest
    from programmable_release_probe_private.release_probe_nonce_consumptions_v1 as nonce
    where nonce.route_key = validated_route
      and nonce.expires_at <= database_now
    order by nonce.expires_at, nonce.nonce_digest
    limit 256
    for update skip locked
  )
  delete from programmable_release_probe_private.release_probe_nonce_consumptions_v1 as nonce
  using expired
  where nonce.route_key = expired.route_key
    and nonce.nonce_digest = expired.nonce_digest
    and nonce.expires_at <= database_now;

  if (
    select pg_catalog.count(*) = 4096
    from (
      select 1
      from programmable_release_probe_private.release_probe_nonce_consumptions_v1 as nonce
      where nonce.route_key = validated_route
      limit 4096
    ) as bounded_route_rows
  ) then
    return false;
  end if;

  insert into programmable_release_probe_private.release_probe_nonce_consumptions_v1 (
    route_key,
    nonce_digest,
    issued_at,
    expires_at,
    consumed_at
  ) values (
    validated_route,
    p_nonce_digest,
    p_issued_at,
    p_expires_at,
    database_now
  )
  on conflict (route_key, nonce_digest) do nothing
  returning true into inserted;

  return coalesce(inserted, false);
end
$function$;

comment on function programmable_release_probe_private.consume_release_probe_nonce_v1(
  text, bytea, timestamptz, timestamptz
) is
  'Connect with session_user programmable_release_probe_nonce_login; in one transaction SET LOCAL ROLE programmable_release_probe_nonce and verify current_role before calling. Returns true once and false on replay or bounded capacity.';

revoke all on table
  programmable_release_probe_private.release_probe_nonce_consumptions_v1
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login,
  programmable_release_probe_nonce,
  programmable_release_probe_nonce_login;

revoke all on type
  programmable_release_probe_private.release_probe_route_key_v1
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login,
  programmable_release_probe_nonce,
  programmable_release_probe_nonce_login;

revoke all on function
  programmable_release_probe_private.consume_release_probe_nonce_v1(
    text, bytea, timestamptz, timestamptz
  )
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login,
  programmable_release_probe_nonce,
  programmable_release_probe_nonce_login;

grant usage on schema programmable_release_probe_private
  to programmable_release_probe_nonce;
grant execute on function
  programmable_release_probe_private.consume_release_probe_nonce_v1(
    text, bytea, timestamptz, timestamptz
  )
  to programmable_release_probe_nonce;

reset role;
