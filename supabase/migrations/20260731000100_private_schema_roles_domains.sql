-- Programmable private read model: roles, private schema, domains and shared validators.
-- Transaction/log ordinals use an explicit unsigned 32-bit ceiling. Ethereum JSON-RPC
-- quantities are still stored in bigint, so no signed int4 truncation can occur.

do $bootstrap$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'programmable_migrator') then
    create role programmable_migrator
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'programmable_projector') then
    create role programmable_projector
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'programmable_reconciler') then
    create role programmable_reconciler
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'programmable_api_reader') then
    create role programmable_api_reader
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'programmable_profile_binder') then
    create role programmable_profile_binder
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'programmable_profile_recovery') then
    create role programmable_profile_recovery
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'programmable_profile_writer') then
    create role programmable_profile_writer
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'programmable_maintenance') then
    create role programmable_maintenance
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  -- Login identities are deliberately separate from capability roles.  They
  -- start with a null password and cannot inherit capability privileges; the
  -- deployment operator supplies credentials out of band after migration and
  -- the service must explicitly SET ROLE for each session/transaction.
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'programmable_api_reader_login') then
    create role programmable_api_reader_login
      login password null nosuperuser nocreatedb nocreaterole noinherit
      noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'programmable_projector_login') then
    create role programmable_projector_login
      login password null nosuperuser nocreatedb nocreaterole noinherit
      noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'programmable_reconciler_login') then
    create role programmable_reconciler_login
      login password null nosuperuser nocreatedb nocreaterole noinherit
      noreplication nobypassrls;
  end if;
end
$bootstrap$;

alter role programmable_migrator
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role programmable_projector
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role programmable_reconciler
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role programmable_api_reader
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role programmable_profile_binder
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role programmable_profile_recovery
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role programmable_profile_writer
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role programmable_maintenance
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role programmable_api_reader_login
  login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role programmable_projector_login
  login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role programmable_reconciler_login
  login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

grant programmable_api_reader to programmable_api_reader_login
  with inherit false, set true;
grant programmable_projector to programmable_projector_login
  with inherit false, set true;
grant programmable_reconciler to programmable_reconciler_login
  with inherit false, set true;

-- The local/hosted migration connection must be able to SET ROLE for all later DDL.
grant programmable_migrator to postgres with admin option;

create schema if not exists programmable_private authorization programmable_migrator;
alter schema programmable_private owner to programmable_migrator;

revoke all on schema programmable_private
  from public, anon, authenticated, service_role,
       programmable_projector, programmable_reconciler,
       programmable_api_reader, programmable_profile_binder,
       programmable_profile_recovery, programmable_profile_writer,
       programmable_maintenance;

set role programmable_migrator;

create domain programmable_private.eth_address as bytea
  check (value is null or pg_catalog.octet_length(value) = 20);

create domain programmable_private.bytes32_value as bytea
  check (value is null or pg_catalog.octet_length(value) = 32);

create domain programmable_private.hex_selector as bytea
  check (value is null or pg_catalog.octet_length(value) = 4);

-- Deliberately based on unconstrained numeric. A numeric(78,0) typmod would
-- round fractional input before this check and is therefore forbidden.
create domain programmable_private.uint256_value as numeric
  check (
    value is null
    or (
      value = pg_catalog.trunc(value)
      and value >= 0
      and value <=
        115792089237316195423570985008687907853269984665640564039457584007913129639935
    )
  );

create domain programmable_private.basis_points as integer
  check (value is not null and value between 0 and 10000);

create domain programmable_private.chain_id_value as bigint
  check (value is not null and value > 0);

create domain programmable_private.block_number_value as bigint
  check (value is not null and value between 0 and 9223372036854775807);

create domain programmable_private.transaction_index_value as bigint
  check (value is not null and value between 0 and 4294967295);

create domain programmable_private.block_log_index_value as bigint
  check (value is not null and value between 0 and 4294967295);

create domain programmable_private.receipt_log_ordinal_value as bigint
  check (value is not null and value between 0 and 4294967295);

create domain programmable_private.release_identifier as text
  check (
    value is not null
    and pg_catalog.octet_length(value) between 1 and 64
    and value operator(pg_catalog.~) '^[a-z0-9][a-z0-9._-]*$'
  );

create domain programmable_private.model_identifier as text
  check (
    value is not null
    and pg_catalog.octet_length(value) between 1 and 64
    and value operator(pg_catalog.~) '^[a-z0-9][a-z0-9._-]*$'
  );

create domain programmable_private.source_identifier as text
  check (
    value is not null
    and pg_catalog.octet_length(value) between 1 and 128
    and value operator(pg_catalog.~) '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
  );

-- Envio's stable event identifier is materially longer than a human-facing
-- source name. Keep it in a dedicated 192-byte envelope so widening a stream
-- identity cannot silently widen roles, release names, audit actions, or other
-- bounded identifiers. Ingestion writers separately enforce the exact
-- provider grammar and its unsigned-32-bit suffix against the row fields.
create domain programmable_private.envio_candidate_identifier as text
  check (
    value is null
    or (
      pg_catalog.octet_length(value) between 1 and 192
      and value operator(pg_catalog.~) '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    )
  );

create domain programmable_private.projector_identifier as text
  check (
    value is not null
    and pg_catalog.octet_length(value) between 1 and 128
    and value operator(pg_catalog.~) '^[A-Za-z0-9][A-Za-z0-9._+:/-]*$'
  );

create type programmable_private.source_type as enum (
  'ethereum_contract',
  'envio_deployment',
  'rpc_provider',
  'uniswap_subgraph'
);

create type programmable_private.run_kind as enum (
  'ingestion',
  'projection',
  'reconciliation',
  'rewind',
  'profile_recovery',
  'maintenance'
);

create type programmable_private.run_status as enum (
  'succeeded',
  'failed',
  'cancelled'
);

create type programmable_private.occurrence_status as enum (
  'observed',
  'canonical',
  'orphaned',
  'superseded',
  'conflicted'
);

create type programmable_private.envio_candidate_status as enum (
  'pending',
  'deferred',
  'resolved',
  'ignored',
  'quarantined'
);

create type programmable_private.reward_seed_status as enum (
  'observed',
  'verified',
  'quarantined',
  'orphaned',
  'conflicted',
  'revoked'
);

create type programmable_private.reconciliation_severity as enum (
  'info',
  'warning',
  'high',
  'critical'
);

create type programmable_private.recovery_method as enum (
  'historical_getters',
  'launcher_calldata',
  'coordinator_calldata',
  'factory_calldata'
);

create type programmable_private.route_mode as enum (
  'indexed',
  'blob',
  'rpc',
  'disabled'
);

create type programmable_private.route_eligibility_status as enum (
  'eligible',
  'ineligible',
  'quarantined'
);

create type programmable_private.historical_enrichment_status as enum (
  'matched',
  'unavailable'
);

create type programmable_private.dependency_health_status as enum (
  'closed',
  'open',
  'half_open',
  'frozen'
);

create type programmable_private.profile_hash_version_state as enum (
  'current',
  'verify_only',
  'retired'
);

create type programmable_private.profile_alias_state as enum (
  'current',
  'verify_only',
  'tombstoned'
);

create type programmable_private.profile_binding_state as enum (
  'active',
  'recovered',
  'tombstoned'
);

create type programmable_private.profile_recovery_method as enum (
  'linked_wallet',
  'wallet_signature',
  'verified_subject_recovery'
);

create type programmable_private.market_interval as enum (
  'snapshot',
  'hour',
  'day'
);

create function programmable_private.derive_envio_candidate_id(
  p_chain_id bigint,
  p_block_hash bytea,
  p_transaction_hash bytea,
  p_block_global_log_index numeric
)
returns programmable_private.envio_candidate_identifier
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
begin
  if p_chain_id <> 1
     or pg_catalog.octet_length(p_block_hash) <> 32
     or pg_catalog.octet_length(p_transaction_hash) <> 32
     or p_block_global_log_index <> pg_catalog.trunc(p_block_global_log_index)
     or p_block_global_log_index < 0
     or p_block_global_log_index > 4294967295
  then
    raise exception using
      errcode = '22023',
      message = 'invalid canonical Envio candidate identity components';
  end if;
  return pg_catalog.format(
    '1:0x%s:0x%s:%s',
    pg_catalog.encode(p_block_hash, 'hex'),
    pg_catalog.encode(p_transaction_hash, 'hex'),
    p_block_global_log_index::bigint
  )::programmable_private.envio_candidate_identifier;
end
$function$;

create function programmable_private.validate_uint256(p_value numeric)
returns programmable_private.uint256_value
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
begin
  if p_value <> pg_catalog.trunc(p_value)
     or p_value < 0
     or p_value >
       115792089237316195423570985008687907853269984665640564039457584007913129639935
  then
    raise exception using
      errcode = '22003',
      message = 'uint256 value must be an integer in [0, 2^256-1]';
  end if;
  return p_value::programmable_private.uint256_value;
end
$function$;

create function programmable_private.parse_uint256_decimal(p_value text)
returns programmable_private.uint256_value
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  parsed numeric;
begin
  if p_value !~ '^(0|[1-9][0-9]*)$' then
    raise exception using
      errcode = '22P02',
      message = 'uint256 decimal must use canonical unsigned integer grammar';
  end if;
  parsed := p_value::numeric;
  return programmable_private.validate_uint256(parsed);
end
$function$;

create function programmable_private.valid_topics(p_topics bytea[])
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.bool_and(pg_catalog.octet_length(topic) = 32),
    true
  )
  from pg_catalog.unnest(p_topics) as topic
$function$;

create function programmable_private.valid_immutable_values(p_values bytea[])
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select pg_catalog.cardinality(p_values) between 1 and 64
    and coalesce(
      (
        select pg_catalog.bool_and(
          value is not null
          and pg_catalog.octet_length(value) between 1 and 32
        )
        from pg_catalog.unnest(p_values) as value
      ),
      false
    )
$function$;

create function programmable_private.valid_immutable_binding_spec(p_spec jsonb)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  binding jsonb;
  binding_count integer;
  ordinal integer := 0;
  binding_offset integer;
  binding_length integer;
  previous_end integer := 0;
  source_kind text;
  encoding_kind text;
  field_name text;
  constant_value text;
begin
  if pg_catalog.jsonb_typeof(p_spec) <> 'object'
     or pg_catalog.octet_length(p_spec::text) > 65536
     or pg_catalog.jsonb_typeof(p_spec -> 'bindings') <> 'array'
     or pg_catalog.jsonb_typeof(p_spec -> 'factoryConfigurationField')
       <> 'string'
     or (p_spec ->> 'factoryConfigurationField') !~
       '^[A-Za-z][A-Za-z0-9_]{0,63}$'
  then
    return false;
  end if;
  binding_count := pg_catalog.jsonb_array_length(p_spec -> 'bindings');
  if binding_count < 1 or binding_count > 64 then
    return false;
  end if;
  for binding in
    select value from pg_catalog.jsonb_array_elements(p_spec -> 'bindings')
  loop
    if pg_catalog.jsonb_typeof(binding) <> 'object'
       or coalesce(binding ->> 'ordinal', '') !~ '^(0|[1-9][0-9]*)$'
       or coalesce(binding ->> 'offset', '') !~ '^(0|[1-9][0-9]*)$'
       or coalesce(binding ->> 'length', '') !~ '^[1-9][0-9]*$'
    then
      return false;
    end if;
    if (binding ->> 'ordinal')::integer <> ordinal then
      return false;
    end if;
    binding_offset := (binding ->> 'offset')::integer;
    binding_length := (binding ->> 'length')::integer;
    source_kind := binding ->> 'source';
    encoding_kind := binding ->> 'encoding';
    field_name := binding ->> 'field';
    constant_value := binding ->> 'value';
    if binding_length > 32
       or binding_offset < previous_end
       or source_kind not in ('factory_event', 'constant', 'deployed_address')
       or encoding_kind not in ('address', 'bytes')
       or (encoding_kind = 'address' and binding_length not in (20, 32))
       or (
         source_kind = 'factory_event'
         and (
           field_name is null
           or field_name !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
           or constant_value is not null
         )
       )
       or (
         source_kind = 'constant'
         and (
           field_name is not null
           or constant_value is null
           or constant_value !~ '^0x([0-9a-f][0-9a-f])+$'
           or pg_catalog.length(constant_value) <> 2 + (2 * binding_length)
         )
       )
       or (
         source_kind = 'deployed_address'
         and (field_name is not null or constant_value is not null
           or encoding_kind <> 'address')
       )
    then
      return false;
    end if;
    previous_end := binding_offset + binding_length;
    ordinal := ordinal + 1;
  end loop;
  return true;
exception when others then
  return false;
end
$function$;

create function programmable_private.immutable_values_match_binding_spec(
  p_spec jsonb,
  p_factory_payload jsonb,
  p_deployed_address bytea,
  p_values bytea[]
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  binding jsonb;
  ordinal integer := 1;
  binding_length integer;
  source_kind text;
  encoding_kind text;
  source_value text;
  expected_value bytea;
begin
  if not programmable_private.valid_immutable_binding_spec(p_spec)
     or pg_catalog.octet_length(p_deployed_address) <> 20
     or pg_catalog.cardinality(p_values)
       <> pg_catalog.jsonb_array_length(p_spec -> 'bindings')
     or exists (
       select 1 from pg_catalog.unnest(p_values) as value
       where value is null
     )
  then
    return false;
  end if;
  for binding in
    select value from pg_catalog.jsonb_array_elements(p_spec -> 'bindings')
  loop
    binding_length := (binding ->> 'length')::integer;
    source_kind := binding ->> 'source';
    encoding_kind := binding ->> 'encoding';
    if pg_catalog.octet_length(p_values[ordinal]) <> binding_length then
      return false;
    end if;
    if source_kind = 'constant' then
      expected_value := pg_catalog.decode(
        pg_catalog.substring(binding ->> 'value', 3), 'hex'
      );
    elsif source_kind = 'deployed_address' then
      expected_value := case
        when binding_length = 20 then p_deployed_address
        else pg_catalog.decode(pg_catalog.repeat('00', 12), 'hex')
          || p_deployed_address
      end;
    else
      source_value := p_factory_payload ->> (binding ->> 'field');
      if encoding_kind = 'address' then
        if source_value is null
           or source_value !~ '^0x[0-9a-f]{40}$'
        then
          return false;
        end if;
        expected_value := case
          when binding_length = 20 then pg_catalog.decode(
            pg_catalog.substring(source_value, 3), 'hex'
          )
          else pg_catalog.decode(pg_catalog.repeat('00', 12), 'hex')
            || pg_catalog.decode(
              pg_catalog.substring(source_value, 3), 'hex'
            )
        end;
      else
        if source_value is null
           or source_value !~ '^0x([0-9a-f][0-9a-f])+$'
           or pg_catalog.length(source_value) <> 2 + (2 * binding_length)
        then
          return false;
        end if;
        expected_value := pg_catalog.decode(
          pg_catalog.substring(source_value, 3), 'hex'
        );
      end if;
    end if;
    if p_values[ordinal] <> expected_value then
      return false;
    end if;
    ordinal := ordinal + 1;
  end loop;
  return true;
exception when others then
  return false;
end
$function$;

create function programmable_private.immutable_binding_spec_fits_runtime(
  p_spec jsonb,
  p_runtime_code_length bigint
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select programmable_private.valid_immutable_binding_spec(p_spec)
    and p_runtime_code_length > 0
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_spec -> 'bindings') as binding
      where (binding ->> 'offset')::bigint
        + (binding ->> 'length')::bigint > p_runtime_code_length
    )
$function$;

create function programmable_private.valid_beneficiary_set(
  p_beneficiaries bytea[],
  p_shares integer[],
  p_max_entries integer
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select
    coalesce(pg_catalog.array_length(p_beneficiaries, 1), 0)
      between 1 and p_max_entries
    and coalesce(pg_catalog.array_length(p_beneficiaries, 1), 0)
      = coalesce(pg_catalog.array_length(p_shares, 1), 0)
    and (
      select pg_catalog.bool_and(
        pg_catalog.octet_length(beneficiary) = 20
        and beneficiary <> pg_catalog.decode('0000000000000000000000000000000000000000', 'hex')
      )
      from pg_catalog.unnest(p_beneficiaries) as beneficiary
    )
    and (
      select pg_catalog.count(*) = pg_catalog.count(distinct beneficiary)
      from pg_catalog.unnest(p_beneficiaries) as beneficiary
    )
    and (
      select pg_catalog.bool_and(share > 0 and share <= 10000)
      from pg_catalog.unnest(p_shares) as share
    )
    and (
      select pg_catalog.sum(share)::bigint = 10000
      from pg_catalog.unnest(p_shares) as share
    )
$function$;

create function programmable_private.valid_avatar_reference(p_value text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select p_value is null or (
    pg_catalog.octet_length(p_value) between 1 and 512
    and p_value !~ '[[:cntrl:]]'
    and (
      p_value ~ '^https://[A-Za-z0-9.-]+(?::[0-9]+)?(?:/[A-Za-z0-9._~:/?#@!$&''()*+,;=%-]*)?$'
      or p_value ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$'
    )
  )
$function$;

create function programmable_private.valid_profile_username(p_value text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select p_value is null or p_value ~ '^[A-Za-z0-9]{3,12}$'
$function$;

create function programmable_private.assert_caller(p_expected name)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
begin
  if session_user::text <> p_expected::text
     and coalesce(active_role, 'none') <> p_expected::text
  then
    raise exception using
      errcode = '42501',
      message = pg_catalog.format('function requires capability role %I', p_expected);
  end if;
end
$function$;

create function programmable_private.caller_role_name()
returns name
language sql
stable
security invoker
set search_path = ''
as $function$
  select case
    when pg_catalog.current_setting('role', true) is null
      or pg_catalog.current_setting('role', true) = 'none'
      then session_user::name
    else pg_catalog.current_setting('role', true)::name
  end
$function$;

revoke all on all functions in schema programmable_private from public;
do $revoke_public_type_usage$
declare
  private_type record;
begin
  for private_type in
    select type_row.typname
    from pg_catalog.pg_type as type_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = type_row.typnamespace
    where namespace_row.nspname = 'programmable_private'
      and type_row.typtype in ('d', 'e')
  loop
    execute pg_catalog.format(
      'revoke all on type programmable_private.%I from public',
      private_type.typname
    );
  end loop;
end
$revoke_public_type_usage$;

alter default privileges for role programmable_migrator in schema programmable_private
  revoke all on tables from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler, programmable_api_reader,
    programmable_profile_binder, programmable_profile_recovery,
    programmable_profile_writer, programmable_maintenance;
alter default privileges for role programmable_migrator in schema programmable_private
  revoke all on sequences from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler, programmable_api_reader,
    programmable_profile_binder, programmable_profile_recovery,
    programmable_profile_writer, programmable_maintenance;
alter default privileges for role programmable_migrator in schema programmable_private
  revoke execute on functions from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler, programmable_api_reader,
    programmable_profile_binder, programmable_profile_recovery,
    programmable_profile_writer, programmable_maintenance;
alter default privileges for role programmable_migrator in schema programmable_private
  revoke usage on types from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler, programmable_api_reader,
    programmable_profile_binder, programmable_profile_recovery,
    programmable_profile_writer, programmable_maintenance;

reset role;

revoke all on all tables in schema programmable_private
  from public, anon, authenticated, service_role;
revoke all on all sequences in schema programmable_private
  from public, anon, authenticated, service_role;
revoke all on all functions in schema programmable_private
  from public, anon, authenticated, service_role;
