-- Process-independent singleton fencing for the canonical projector runtime.
-- The caller never supplies a scope key: this migration owns the one production
-- scope, and every acquisition advances a monotonic fencing generation.

reset role;

do $bootstrap_projector_runtime_roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'programmable_projector_runtime'
  ) then
    create role programmable_projector_runtime
      nologin nosuperuser nocreatedb nocreaterole noinherit
      noreplication nobypassrls;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'programmable_projector_runtime_login'
  ) then
    create role programmable_projector_runtime_login
      login password null nosuperuser nocreatedb nocreaterole noinherit
      noreplication nobypassrls;
  end if;
end
$bootstrap_projector_runtime_roles$;

alter role programmable_projector_runtime
  nologin nosuperuser nocreatedb nocreaterole noinherit
  noreplication nobypassrls;
alter role programmable_projector_runtime_login
  login password null nosuperuser nocreatedb nocreaterole noinherit
  noreplication nobypassrls;

grant programmable_projector_runtime to programmable_projector_runtime_login
  with inherit false, set true;

set role programmable_migrator;

create table programmable_private.projector_runtime_lease_current (
  singleton_key text primary key
    check (singleton_key = 'canonical-projector-runtime-v1'),
  lease_generation bigint not null default 0
    check (lease_generation >= 0),
  -- The bootstrap generation has no holder. The shared source_identifier
  -- domain intentionally rejects NULL, so the current row uses text and
  -- repeats the exact domain grammar in the active-generation constraint.
  holder_id text,
  lease_token_hash programmable_private.bytes32_value,
  acquired_at timestamptz,
  expires_at timestamptz,
  released_at timestamptz,
  acquisition_commitment programmable_private.bytes32_value,
  release_commitment programmable_private.bytes32_value,
  changed_by_audit_id uuid
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (
    (
      lease_generation = 0
      and holder_id is null
      and lease_token_hash is null
      and acquired_at is null
      and expires_at is null
      and released_at is null
      and acquisition_commitment is null
      and release_commitment is null
      and changed_by_audit_id is null
    )
    or
    (
      lease_generation > 0
      and holder_id is not null
      and pg_catalog.octet_length(holder_id) between 1 and 128
      and holder_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
      and lease_token_hash is not null
      and acquired_at is not null
      and expires_at is not null
      and acquisition_commitment is not null
      and changed_by_audit_id is not null
      and expires_at > acquired_at
      and expires_at <= acquired_at + interval '90 seconds'
      and lease_token_hash <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
      and acquisition_commitment
        <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
      and (
        (released_at is null and release_commitment is null)
        or (
          released_at is not null
          and release_commitment is not null
          and released_at >= acquired_at
          and release_commitment
            <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
        )
      )
    )
  )
);

create table programmable_private.projector_runtime_lease_history (
  lease_history_id uuid primary key,
  singleton_key text not null
    check (singleton_key = 'canonical-projector-runtime-v1'),
  event_kind text not null check (event_kind in ('acquired', 'released')),
  lease_generation bigint not null check (lease_generation > 0),
  holder_id programmable_private.source_identifier not null,
  lease_token_hash programmable_private.bytes32_value not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  event_at timestamptz not null,
  input_commitment programmable_private.bytes32_value not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (expires_at > acquired_at),
  check (expires_at <= acquired_at + interval '90 seconds'),
  check (event_at >= acquired_at),
  check (lease_token_hash <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')),
  check (input_commitment <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')),
  unique (singleton_key, lease_generation, event_kind),
  unique (audit_id)
);

insert into programmable_private.projector_runtime_lease_current (
  singleton_key
) values (
  'canonical-projector-runtime-v1'
);

alter table programmable_private.projector_runtime_lease_current
  enable row level security;
alter table programmable_private.projector_runtime_lease_current
  force row level security;
create policy projector_runtime_lease_current_migrator_all
  on programmable_private.projector_runtime_lease_current
  for all to programmable_migrator using (true) with check (true);

alter table programmable_private.projector_runtime_lease_history
  enable row level security;
alter table programmable_private.projector_runtime_lease_history
  force row level security;
create policy projector_runtime_lease_history_migrator_all
  on programmable_private.projector_runtime_lease_history
  for all to programmable_migrator using (true) with check (true);

create trigger reject_immutable_mutation
before update or delete
on programmable_private.projector_runtime_lease_history
for each row execute function programmable_private.reject_immutable_mutation();

create function programmable_private.try_acquire_projector_runtime_lease_v1(
  p_holder_id text,
  p_lease_token_hash bytea,
  p_acquired_at timestamptz,
  p_expires_at timestamptz,
  p_input_commitment bytea
)
returns table (
  acquired boolean,
  lease_generation bigint,
  acquired_at timestamptz,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  current_lease programmable_private.projector_runtime_lease_current%rowtype;
  server_now timestamptz := pg_catalog.clock_timestamp();
  requested_ttl interval;
  next_generation bigint;
  server_acquired_at timestamptz;
  server_expires_at timestamptz;
  acquisition_audit_id uuid;
begin
  perform programmable_private.assert_caller(
    'programmable_projector_runtime'
  );

  requested_ttl := p_expires_at - p_acquired_at;
  if p_holder_id is null
     or pg_catalog.octet_length(p_holder_id) not between 1 and 128
     or p_holder_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or p_lease_token_hash is null
     or pg_catalog.octet_length(p_lease_token_hash) <> 32
     or p_lease_token_hash = pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_input_commitment is null
     or pg_catalog.octet_length(p_input_commitment) <> 32
     or p_input_commitment = pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_acquired_at is null
     or p_expires_at is null
     or requested_ttl <= interval '0 seconds'
     or requested_ttl > interval '90 seconds'
     or p_acquired_at < server_now - interval '30 seconds'
     or p_acquired_at > server_now + interval '30 seconds'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid projector runtime lease acquisition';
  end if;

  select lease.* into strict current_lease
  from programmable_private.projector_runtime_lease_current as lease
  where lease.singleton_key = 'canonical-projector-runtime-v1'
  for update;

  if current_lease.lease_generation > 0
     and current_lease.released_at is null
     and current_lease.expires_at > server_now
  then
    acquired := false;
    lease_generation := current_lease.lease_generation;
    acquired_at := current_lease.acquired_at;
    expires_at := current_lease.expires_at;
    return next;
    return;
  end if;

  next_generation := current_lease.lease_generation + 1;
  server_acquired_at := server_now;
  server_expires_at := server_now + requested_ttl;
  acquisition_audit_id := programmable_private.append_mutation_audit(
    'projector_runtime_lease.acquire',
    p_input_commitment,
    null,
    server_now
  );

  update programmable_private.projector_runtime_lease_current as lease
  set lease_generation = next_generation,
      holder_id = p_holder_id::programmable_private.source_identifier,
      lease_token_hash =
        p_lease_token_hash::programmable_private.bytes32_value,
      acquired_at = server_acquired_at,
      expires_at = server_expires_at,
      released_at = null,
      acquisition_commitment =
        p_input_commitment::programmable_private.bytes32_value,
      release_commitment = null,
      changed_by_audit_id = acquisition_audit_id
  where lease.singleton_key = 'canonical-projector-runtime-v1';

  insert into programmable_private.projector_runtime_lease_history (
    lease_history_id, singleton_key, event_kind, lease_generation,
    holder_id, lease_token_hash, acquired_at, expires_at, event_at,
    input_commitment, audit_id
  ) values (
    pg_catalog.gen_random_uuid(), 'canonical-projector-runtime-v1',
    'acquired', next_generation,
    p_holder_id::programmable_private.source_identifier,
    p_lease_token_hash::programmable_private.bytes32_value,
    server_acquired_at, server_expires_at, server_now,
    p_input_commitment::programmable_private.bytes32_value,
    acquisition_audit_id
  );

  acquired := true;
  lease_generation := next_generation;
  acquired_at := server_acquired_at;
  expires_at := server_expires_at;
  return next;
end
$function$;

create function programmable_private.assert_projector_runtime_lease_v1(
  p_holder_id text,
  p_lease_generation bigint,
  p_lease_token_hash bytea
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_caller name := programmable_private.caller_role_name();
  current_lease programmable_private.projector_runtime_lease_current%rowtype;
begin
  if active_caller not in (
    'programmable_projector_runtime'::name,
    'programmable_projector'::name
  ) then
    raise exception using
      errcode = '42501',
      message = 'function requires projector lease assertion capability';
  end if;

  if p_holder_id is null
     or pg_catalog.octet_length(p_holder_id) not between 1 and 128
     or p_holder_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or p_lease_generation is null
     or p_lease_generation <= 0
     or p_lease_token_hash is null
     or pg_catalog.octet_length(p_lease_token_hash) <> 32
     or p_lease_token_hash = pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  then
    raise exception using
      errcode = '22023',
      message = 'invalid projector runtime lease assertion';
  end if;

  select lease.* into strict current_lease
  from programmable_private.projector_runtime_lease_current as lease
  where lease.singleton_key = 'canonical-projector-runtime-v1'
  for update;

  return current_lease.lease_generation = p_lease_generation
    and current_lease.holder_id = p_holder_id
    and current_lease.lease_token_hash = p_lease_token_hash
    and current_lease.released_at is null
    and current_lease.expires_at > pg_catalog.clock_timestamp();
end
$function$;

comment on function
  programmable_private.assert_projector_runtime_lease_v1(
    text, bigint, bytea
  ) is
  'Must execute on the same connection and inside the same transaction as projector stage and promote writes; its FOR UPDATE lock fences takeover until commit.';

create function programmable_private.release_projector_runtime_lease_v1(
  p_holder_id text,
  p_lease_generation bigint,
  p_lease_token_hash bytea,
  p_released_at timestamptz,
  p_input_commitment bytea
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  current_lease programmable_private.projector_runtime_lease_current%rowtype;
  server_now timestamptz := pg_catalog.clock_timestamp();
  release_audit_id uuid;
begin
  perform programmable_private.assert_caller(
    'programmable_projector_runtime'
  );

  if p_holder_id is null
     or pg_catalog.octet_length(p_holder_id) not between 1 and 128
     or p_holder_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or p_lease_generation is null
     or p_lease_generation <= 0
     or p_lease_token_hash is null
     or pg_catalog.octet_length(p_lease_token_hash) <> 32
     or p_lease_token_hash = pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_released_at is null
     or p_released_at < server_now - interval '30 seconds'
     or p_released_at > server_now + interval '30 seconds'
     or p_input_commitment is null
     or pg_catalog.octet_length(p_input_commitment) <> 32
     or p_input_commitment = pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  then
    raise exception using
      errcode = '22023',
      message = 'invalid projector runtime lease release';
  end if;

  select lease.* into strict current_lease
  from programmable_private.projector_runtime_lease_current as lease
  where lease.singleton_key = 'canonical-projector-runtime-v1'
  for update;

  if current_lease.lease_generation <> p_lease_generation
     or current_lease.holder_id <> p_holder_id
     or current_lease.lease_token_hash <> p_lease_token_hash
     or current_lease.released_at is not null
  then
    return false;
  end if;

  release_audit_id := programmable_private.append_mutation_audit(
    'projector_runtime_lease.release',
    p_input_commitment,
    null,
    server_now
  );

  update programmable_private.projector_runtime_lease_current as lease
  set released_at = server_now,
      release_commitment =
        p_input_commitment::programmable_private.bytes32_value,
      changed_by_audit_id = release_audit_id
  where lease.singleton_key = 'canonical-projector-runtime-v1'
    and lease.lease_generation = p_lease_generation
    and lease.holder_id = p_holder_id
    and lease.lease_token_hash = p_lease_token_hash
    and lease.released_at is null;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'projector runtime lease release CAS lost';
  end if;

  insert into programmable_private.projector_runtime_lease_history (
    lease_history_id, singleton_key, event_kind, lease_generation,
    holder_id, lease_token_hash, acquired_at, expires_at, event_at,
    input_commitment, audit_id
  ) values (
    pg_catalog.gen_random_uuid(), 'canonical-projector-runtime-v1',
    'released', current_lease.lease_generation,
    current_lease.holder_id, current_lease.lease_token_hash,
    current_lease.acquired_at, current_lease.expires_at, server_now,
    p_input_commitment::programmable_private.bytes32_value,
    release_audit_id
  );

  return true;
end
$function$;

revoke all on table
  programmable_private.projector_runtime_lease_current,
  programmable_private.projector_runtime_lease_history
from public, anon, authenticated, service_role,
  programmable_projector_runtime, programmable_projector,
  programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

revoke all on function
  programmable_private.try_acquire_projector_runtime_lease_v1(
    text, bytea, timestamptz, timestamptz, bytea
  ),
  programmable_private.assert_projector_runtime_lease_v1(
    text, bigint, bytea
  ),
  programmable_private.release_projector_runtime_lease_v1(
    text, bigint, bytea, timestamptz, bytea
  )
from public, anon, authenticated, service_role,
  programmable_projector_runtime, programmable_projector,
  programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

grant usage on schema programmable_private
  to programmable_projector_runtime;

grant execute on function
  programmable_private.try_acquire_projector_runtime_lease_v1(
    text, bytea, timestamptz, timestamptz, bytea
  ),
  programmable_private.release_projector_runtime_lease_v1(
    text, bigint, bytea, timestamptz, bytea
  )
to programmable_projector_runtime;

grant execute on function
  programmable_private.assert_projector_runtime_lease_v1(
    text, bigint, bytea
  )
to programmable_projector_runtime, programmable_projector;

reset role;
