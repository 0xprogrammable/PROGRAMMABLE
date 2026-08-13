-- Retire Alchemy from the production RPC quorum without rewriting any applied
-- migration or reinterpreting immutable historical evidence. Existing Alchemy
-- metadata is moved out of the canonical vendor order. The replacement CHECK
-- constraints are intentionally NOT VALID: PostgreSQL still enforces them for
-- every new or updated row while retaining historical Alchemy-bound rows.

do $migration$
declare
  target record;
  constraint_row record;
  matching_constraints integer;
begin
  for target in
    select *
    from (
      values
        ('programmable_private', 'rpc_provider_deployment_metadata'),
        ('programmable_private', 'projection_provider_execution_evidence'),
        ('programmable_private', 'dynamic_source_activation_staging'),
        ('programmable_private', 'optimistic_market_state_rows_v1'),
        ('programmable_wake_private', 'optimistic_sla_bundle_receipts_v1')
    ) as targets(schema_name, table_name)
  loop
    select pg_catalog.count(*)::integer
      into matching_constraints
    from pg_catalog.pg_constraint as constraint_definition
    join pg_catalog.pg_class as relation
      on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = target.schema_name
      and relation.relname = target.table_name
      and constraint_definition.contype = 'c'
      and pg_catalog.strpos(
        pg_catalog.lower(
          pg_catalog.pg_get_constraintdef(constraint_definition.oid, true)
        ),
        'alchemy'
      ) > 0;

    if matching_constraints <> 1 then
      raise exception using
        errcode = '23514',
        message = pg_catalog.format(
          'expected one legacy Alchemy constraint on %I.%I, found %s',
          target.schema_name, target.table_name, matching_constraints
        );
    end if;

    select constraint_definition.conname
      into constraint_row
    from pg_catalog.pg_constraint as constraint_definition
    join pg_catalog.pg_class as relation
      on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = target.schema_name
      and relation.relname = target.table_name
      and constraint_definition.contype = 'c'
      and pg_catalog.strpos(
        pg_catalog.lower(
          pg_catalog.pg_get_constraintdef(constraint_definition.oid, true)
        ),
        'alchemy'
      ) > 0;

    execute pg_catalog.format(
      'alter table %I.%I drop constraint %I',
      target.schema_name, target.table_name, constraint_row.conname
    );
  end loop;
end
$migration$;

-- Preserve historical provider identity and evidence while freeing canonical
-- vendor_order=1 for the commitment-bound dRPC deployment.
update programmable_private.rpc_provider_deployment_metadata
set vendor_order = 0
where vendor = 'alchemy'
  and vendor_order = 1;

alter table programmable_private.rpc_provider_deployment_metadata
  add constraint rpc_provider_deployment_metadata_production_vendor_v2_check
  check (
    (vendor = 'drpc' and vendor_order = 1)
    or (vendor = 'quicknode' and vendor_order = 2)
  ) not valid;

alter table programmable_private.projection_provider_execution_evidence
  add constraint projection_provider_execution_evidence_production_vendor_v2_check
  check (
    provider_a_vendor = 'drpc'
    and provider_b_vendor = 'quicknode'
  ) not valid;

alter table programmable_private.dynamic_source_activation_staging
  add constraint dynamic_source_activation_staging_production_vendor_v2_check
  check (provider_a_vendor = 'drpc') not valid;

alter table programmable_private.optimistic_market_state_rows_v1
  add constraint optimistic_market_state_rows_v1_production_vendor_v2_check
  check (
    provider_a_vendor = 'drpc'
    and provider_b_vendor = 'quicknode'
  ) not valid;

alter table programmable_wake_private.optimistic_sla_bundle_receipts_v1
  add constraint optimistic_sla_bundle_receipts_v1_production_provider_v2_check
  check (
    provider_a_endpoint_host = 'lb.drpc.live'
    and provider_b_endpoint_host ~
      '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.]ethereum-mainnet[.]quiknode[.]pro$'
    and provider_a_endpoint_host <> provider_b_endpoint_host
    and provider_a_endpoint_url_commitment <>
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and provider_b_endpoint_url_commitment <>
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and provider_a_endpoint_url_commitment <>
      provider_b_endpoint_url_commitment
  ) not valid;

-- Recompile only the ten exact provider-bound routines. Each precondition
-- asserts the expected legacy token count so source drift fails the migration
-- instead of silently rewriting a different function body.
do $migration$
declare
  target record;
  function_oid oid;
  matching_functions integer;
  definition text;
  legacy_token_count integer;
begin
  for target in
    select *
    from (
      values
        ('programmable_private', 'register_rpc_provider_deployment', 2),
        ('programmable_private', 'append_safe_head_observation', 1),
        ('programmable_private', 'get_market_block_evidence_context_v1', 1),
        ('programmable_private', 'append_projection_provider_execution_evidence_v1', 1),
        ('programmable_private', 'resolve_pending_dynamic_source_activations_v1', 1),
        ('programmable_private', 'stage_verified_dynamic_source_activations_v1', 1),
        ('programmable_private', 'append_optimistic_block_observation_v1', 1),
        ('programmable_private', 'append_optimistic_market_state_v1', 1),
        ('programmable_private', 'append_optimistic_market_state_v2', 1),
        ('programmable_wake_private', 'record_optimistic_sla_bundle_v1', 2)
    ) as targets(schema_name, function_name, expected_legacy_tokens)
  loop
    select pg_catalog.count(*)::integer,
      pg_catalog.min(procedure.oid::bigint)::oid
      into matching_functions, function_oid
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = target.schema_name
      and procedure.proname = target.function_name;

    if matching_functions <> 1 then
      raise exception using
        errcode = '23514',
        message = pg_catalog.format(
          'expected one provider routine %I.%I, found %s',
          target.schema_name, target.function_name, matching_functions
        );
    end if;

    definition := pg_catalog.pg_get_functiondef(function_oid);
    legacy_token_count := (
      pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, 'alchemy', ''))
    ) / pg_catalog.length('alchemy');

    if legacy_token_count <> target.expected_legacy_tokens then
      raise exception using
        errcode = '23514',
        message = pg_catalog.format(
          'provider routine %I.%I has %s legacy tokens, expected %s',
          target.schema_name,
          target.function_name,
          legacy_token_count,
          target.expected_legacy_tokens
        );
    end if;

    if target.schema_name = 'programmable_wake_private'
       and target.function_name = 'record_optimistic_sla_bundle_v1'
    then
      definition := pg_catalog.replace(
        definition,
        $$p_provider_a_endpoint_host !~ '(^|[.])alchemy[.]com$'$$,
        $$p_provider_a_endpoint_host <> 'lb.drpc.live'$$
      );
    end if;

    definition := pg_catalog.replace(definition, 'alchemy', 'drpc');
    execute definition;
  end loop;
end
$migration$;

-- Fail closed if any new production constraint or rewritten routine retained
-- an Alchemy dependency.
do $migration$
declare
  residual_count integer;
begin
  select pg_catalog.count(*)::integer
    into residual_count
  from pg_catalog.pg_constraint as constraint_definition
  join pg_catalog.pg_class as relation
    on relation.oid = constraint_definition.conrelid
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where constraint_definition.conname in (
      'rpc_provider_deployment_metadata_production_vendor_v2_check',
      'projection_provider_execution_evidence_production_vendor_v2_check',
      'dynamic_source_activation_staging_production_vendor_v2_check',
      'optimistic_market_state_rows_v1_production_vendor_v2_check',
      'optimistic_sla_bundle_receipts_v1_production_provider_v2_check'
    )
    and pg_catalog.strpos(
      pg_catalog.lower(
        pg_catalog.pg_get_constraintdef(constraint_definition.oid, true)
      ),
      'alchemy'
    ) > 0;

  if residual_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'production provider constraints retain an Alchemy dependency';
  end if;

  select pg_catalog.count(*)::integer
    into residual_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where (namespace.nspname, procedure.proname) in (
      ('programmable_private', 'register_rpc_provider_deployment'),
      ('programmable_private', 'append_safe_head_observation'),
      ('programmable_private', 'get_market_block_evidence_context_v1'),
      ('programmable_private', 'append_projection_provider_execution_evidence_v1'),
      ('programmable_private', 'resolve_pending_dynamic_source_activations_v1'),
      ('programmable_private', 'stage_verified_dynamic_source_activations_v1'),
      ('programmable_private', 'append_optimistic_block_observation_v1'),
      ('programmable_private', 'append_optimistic_market_state_v1'),
      ('programmable_private', 'append_optimistic_market_state_v2'),
      ('programmable_wake_private', 'record_optimistic_sla_bundle_v1')
    )
    and pg_catalog.strpos(
      pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)),
      'alchemy'
    ) > 0;

  if residual_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'production provider routines retain an Alchemy dependency';
  end if;
end
$migration$;
