-- Separate projection-writer authorization from launch-completeness evidence,
-- and permit runtime-observed immutable values whose meaning is authenticated
-- later by the reward-allocation evidence path. Deferred values never make a
-- launch publishable by themselves.

do $bootstrap_operator$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'programmable_operator'
  ) then
    create role programmable_operator
      nologin nosuperuser nocreatedb nocreaterole noinherit
      noreplication nobypassrls;
  end if;
end
$bootstrap_operator$;

alter role programmable_operator
  nologin nosuperuser nocreatedb nocreaterole noinherit
  noreplication nobypassrls;

grant programmable_operator to postgres with inherit false, set true;

set role programmable_migrator;

create table programmable_private.candidate_database_control (
  singleton boolean primary key default true check (singleton),
  database_mode programmable_private.source_identifier not null
    check (database_mode = 'candidate-only'),
  envio_provider_deployment_id uuid not null unique
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  envio_deployment_commitment programmable_private.bytes32_value not null,
  envio_schema_commitment programmable_private.bytes32_value not null,
  initialization_input_commitment programmable_private.bytes32_value not null,
  initialized_at timestamptz not null,
  promotion_attestation_commitment programmable_private.bytes32_value,
  promotion_baseline_commitment programmable_private.bytes32_value,
  promotion_parity_commitment programmable_private.bytes32_value,
  promotion_input_commitment programmable_private.bytes32_value,
  promoted_at timestamptz,
  check (
    (
      promoted_at is null
      and promotion_attestation_commitment is null
      and promotion_baseline_commitment is null
      and promotion_parity_commitment is null
      and promotion_input_commitment is null
    )
    or (
      promoted_at is not null
      and promotion_attestation_commitment is not null
      and promotion_baseline_commitment is not null
      and promotion_parity_commitment is not null
      and promotion_input_commitment is not null
    )
  )
);

alter table programmable_private.candidate_database_control
  enable row level security;
alter table programmable_private.candidate_database_control
  force row level security;
create policy candidate_database_control_migrator_all
  on programmable_private.candidate_database_control
  for all to programmable_migrator using (true) with check (true);

create function programmable_private.initialize_candidate_database(
  p_envio_provider_deployment_id uuid,
  p_envio_deployment_commitment bytea,
  p_envio_schema_commitment bytea,
  p_input_commitment bytea,
  p_initialized_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  provider programmable_private.provider_deployments%rowtype;
  existing programmable_private.candidate_database_control%rowtype;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into provider
  from programmable_private.provider_deployments
  where provider_deployment_id = p_envio_provider_deployment_id;
  if provider.provider_deployment_id is null
     or provider.provider_type <> 'envio_deployment'
     or provider.redacted_identity <> 'envio:production-7f24e63'
     or provider.deployment_commitment <> p_envio_deployment_commitment
     or provider.schema_commitment <> p_envio_schema_commitment
     or pg_catalog.octet_length(p_input_commitment) <> 32
  then
    raise exception using errcode = '23514', message = 'candidate database provider evidence mismatch';
  end if;
  select * into existing
  from programmable_private.candidate_database_control
  where singleton;
  if found then
    if existing.envio_provider_deployment_id <> p_envio_provider_deployment_id
       or existing.envio_deployment_commitment <> p_envio_deployment_commitment
       or existing.envio_schema_commitment <> p_envio_schema_commitment
       or existing.initialization_input_commitment <> p_input_commitment
       or existing.initialized_at <> p_initialized_at
    then
      raise exception using errcode = '23505', message = 'candidate database initialization replay conflict';
    end if;
    return false;
  end if;
  insert into programmable_private.candidate_database_control (
    singleton, database_mode, envio_provider_deployment_id,
    envio_deployment_commitment, envio_schema_commitment,
    initialization_input_commitment, initialized_at
  ) values (
    true, 'candidate-only', p_envio_provider_deployment_id,
    p_envio_deployment_commitment, p_envio_schema_commitment,
    p_input_commitment, p_initialized_at
  );
  return true;
end
$function$;

create function programmable_private.attest_candidate_database_promotion(
  p_expected_envio_provider_deployment_id uuid,
  p_baseline_commitment bytea,
  p_parity_commitment bytea,
  p_promotion_attestation_commitment bytea,
  p_input_commitment bytea,
  p_promoted_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  existing programmable_private.candidate_database_control%rowtype;
  zero_bytes bytea := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
begin
  perform programmable_private.assert_caller('programmable_operator');
  select * into existing
  from programmable_private.candidate_database_control
  where singleton
  for update;
  if not found
     or existing.envio_provider_deployment_id <>
       p_expected_envio_provider_deployment_id
     or pg_catalog.octet_length(p_baseline_commitment) <> 32
     or pg_catalog.octet_length(p_parity_commitment) <> 32
     or pg_catalog.octet_length(p_promotion_attestation_commitment) <> 32
     or pg_catalog.octet_length(p_input_commitment) <> 32
     or p_baseline_commitment = zero_bytes
     or p_parity_commitment = zero_bytes
     or p_promotion_attestation_commitment = zero_bytes
     or p_input_commitment = zero_bytes
  then
    raise exception using errcode = '23514', message = 'candidate promotion evidence is incomplete';
  end if;
  if existing.promoted_at is not null then
    if existing.promotion_baseline_commitment <> p_baseline_commitment
       or existing.promotion_parity_commitment <> p_parity_commitment
       or existing.promotion_attestation_commitment <>
         p_promotion_attestation_commitment
       or existing.promotion_input_commitment <> p_input_commitment
       or existing.promoted_at <> p_promoted_at
    then
      raise exception using errcode = '23505', message = 'candidate promotion replay conflict';
    end if;
    return false;
  end if;
  update programmable_private.candidate_database_control
  set promotion_baseline_commitment = p_baseline_commitment,
      promotion_parity_commitment = p_parity_commitment,
      promotion_attestation_commitment = p_promotion_attestation_commitment,
      promotion_input_commitment = p_input_commitment,
      promoted_at = p_promoted_at
  where singleton and promoted_at is null;
  return true;
end
$function$;

create function programmable_private.enforce_candidate_database_promotion()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from programmable_private.candidate_database_control
    where singleton
  ) and not exists (
    select 1
    from programmable_private.candidate_database_control
    where singleton and promoted_at is not null
  ) then
    raise exception using errcode = '55000', message = 'candidate database has not been promoted';
  end if;
  return new;
end
$function$;

create trigger projection_publication_candidate_promotion_gate
before insert on programmable_private.projection_publications
for each row execute function
  programmable_private.enforce_candidate_database_promotion();

create or replace function programmable_private.valid_immutable_binding_spec(
  p_spec jsonb
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
  binding_count integer;
  ordinal integer := 0;
  binding_offset integer;
  binding_length integer;
  previous_end integer := 0;
  source_kind text;
  encoding_kind text;
  field_name text;
  constant_value text;
  evidence_role text;
  configuration_field text;
  deferred_configuration_count integer := 0;
  deferred_beneficiary_count integer := 0;
begin
  if pg_catalog.jsonb_typeof(p_spec) <> 'object'
     or pg_catalog.octet_length(p_spec::text) > 65536
     or pg_catalog.jsonb_typeof(p_spec -> 'bindings') <> 'array'
     or not (p_spec ? 'factoryConfigurationField')
     or pg_catalog.jsonb_typeof(p_spec -> 'factoryConfigurationField')
       not in ('string', 'null')
  then
    return false;
  end if;
  configuration_field := p_spec ->> 'factoryConfigurationField';
  if configuration_field is not null
     and configuration_field !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
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
    evidence_role := binding ->> 'evidenceRole';
    if binding_length > 32
       or binding_offset < previous_end
       or source_kind not in (
         'factory_event', 'constant', 'deployed_address',
         'deferred_allocation_evidence'
       )
       or encoding_kind not in ('address', 'bytes')
       or (encoding_kind = 'address' and binding_length not in (20, 32))
       or (
         source_kind = 'factory_event'
         and (
           field_name is null
           or field_name !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
           or constant_value is not null
           or evidence_role is not null
         )
       )
       or (
         source_kind = 'constant'
         and (
           field_name is not null
           or constant_value is null
           or constant_value !~ '^0x([0-9a-f][0-9a-f])+$'
           or pg_catalog.length(constant_value) <> 2 + (2 * binding_length)
           or evidence_role is not null
         )
       )
       or (
         source_kind = 'deployed_address'
         and (
           field_name is not null or constant_value is not null
           or evidence_role is not null or encoding_kind <> 'address'
         )
       )
       or (
         source_kind = 'deferred_allocation_evidence'
         and (
           field_name is not null
           or constant_value is not null
           or encoding_kind <> 'bytes'
           or binding_length <> 32
           or evidence_role not in ('configuration_hash', 'beneficiary_count')
         )
       )
    then
      return false;
    end if;
    if source_kind = 'deferred_allocation_evidence'
       and evidence_role = 'configuration_hash'
    then
      deferred_configuration_count := deferred_configuration_count + 1;
    elsif source_kind = 'deferred_allocation_evidence'
       and evidence_role = 'beneficiary_count'
    then
      deferred_beneficiary_count := deferred_beneficiary_count + 1;
    end if;
    previous_end := binding_offset + binding_length;
    ordinal := ordinal + 1;
  end loop;
  if configuration_field is null then
    return deferred_configuration_count = 1
      and deferred_beneficiary_count >= 1;
  end if;
  return deferred_configuration_count = 0;
exception when others then
  return false;
end
$function$;

create or replace function programmable_private.immutable_values_match_binding_spec(
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
    if source_kind = 'deferred_allocation_evidence' then
      -- The immutable is observed and committed during runtime attestation.
      -- Its semantic meaning is authenticated by the separate verified
      -- reward-allocation path before publication.
      expected_value := p_values[ordinal];
    elsif source_kind = 'constant' then
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
        if source_value is null or source_value !~ '^0x[0-9a-f]{40}$' then
          return false;
        end if;
        expected_value := case
          when binding_length = 20 then pg_catalog.decode(
            pg_catalog.substring(source_value, 3), 'hex'
          )
          else pg_catalog.decode(pg_catalog.repeat('00', 12), 'hex')
            || pg_catalog.decode(pg_catalog.substring(source_value, 3), 'hex')
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

create or replace function programmable_private.stage_launch_occurrence_role(
  p_launch_projection_id uuid,
  p_occurrence_role text,
  p_occurrence_id uuid,
  p_staged_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  launch programmable_private.launch_projections%rowtype;
  materialization programmable_private.chain_event_occurrence_materializations%rowtype;
  actual_role text;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into launch from programmable_private.launch_projections
  where launch_projection_id = p_launch_projection_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown staged launch';
  end if;
  select * into materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = p_occurrence_id
    and chain_id = launch.chain_id
    and release_id = launch.release_id
    and model_id = launch.model_id
    and epoch_id = launch.epoch_id
    and pointer_generation = launch.pointer_generation;
  if materialization.materialization_id is null then
    raise exception using errcode = '23503', message = 'launch requirement materialization is outside the launch scope';
  end if;
  perform programmable_private.projection_stage_context(
    launch.projection_run_id, p_occurrence_id,
    launch.promoted_block_number, launch.promoted_block_hash
  );
  select coalesce(binding.source_role, dynamic_source.deployed_source_role)
    into actual_role
  from programmable_private.chain_event_occurrence_materializations as selected
  left join programmable_private.release_source_bindings as binding
    on binding.binding_id = selected.release_binding_id
  left join programmable_private.dynamic_source_attestations as dynamic_source
    on dynamic_source.dynamic_source_attestation_id =
      selected.dynamic_source_attestation_id
  where selected.materialization_id = materialization.materialization_id;
  if actual_role <> p_occurrence_role
     or not exists (
       select 1
       from programmable_private.release_launch_completeness_requirements
       where epoch_id = launch.epoch_id
         and occurrence_role = p_occurrence_role
         and event_type = materialization.event_type
     )
  then
    raise exception using errcode = '23514', message = 'occurrence does not satisfy a launch requirement';
  end if;
  insert into programmable_private.launch_projection_occurrence_roles (
    launch_projection_id, occurrence_role, occurrence_id,
    projection_run_id, staged_at
  ) values (
    p_launch_projection_id,
    p_occurrence_role::programmable_private.source_identifier,
    p_occurrence_id, launch.projection_run_id, p_staged_at
  ) on conflict (launch_projection_id, occurrence_role) do update
    set occurrence_id = excluded.occurrence_id,
        staged_at = excluded.staged_at
    where programmable_private.launch_projection_occurrence_roles.occurrence_id
      = excluded.occurrence_id;
  if not found then
    raise exception using errcode = '23505', message = 'launch occurrence role replay conflict';
  end if;
  return p_launch_projection_id;
end
$function$;

revoke all on function programmable_private.stage_launch_occurrence_role(
  uuid, text, uuid, timestamptz
) from public;
revoke all on function programmable_private.enforce_candidate_database_promotion()
  from public, anon, authenticated, service_role;
grant execute on function programmable_private.stage_launch_occurrence_role(
  uuid, text, uuid, timestamptz
) to programmable_projector;

revoke all on function programmable_private.initialize_candidate_database(
  uuid, bytea, bytea, bytea, timestamptz
) from public;
grant execute on function programmable_private.initialize_candidate_database(
  uuid, bytea, bytea, bytea, timestamptz
) to programmable_projector;
revoke all on function programmable_private.attest_candidate_database_promotion(
  uuid, bytea, bytea, bytea, bytea, timestamptz
) from public;
grant execute on function programmable_private.attest_candidate_database_promotion(
  uuid, bytea, bytea, bytea, bytea, timestamptz
) to programmable_operator;

reset role;
