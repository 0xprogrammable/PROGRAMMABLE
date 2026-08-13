begin;

select plan(6);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_constraint as constraint_definition
    where constraint_definition.conname in (
      'rpc_provider_deployment_metadata_production_vendor_v2_check',
      'projection_provider_execution_evidence_production_vendor_v2_check',
      'dynamic_source_activation_staging_production_vendor_v2_check',
      'optimistic_market_state_rows_v1_production_vendor_v2_check',
      'optimistic_sla_bundle_receipts_v1_production_provider_v2_check'
    )
  ),
  5,
  'all forward-only production provider constraints exist'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_constraint as constraint_definition
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
      ) > 0
  ),
  0,
  'new production provider constraints have no Alchemy dependency'
);

select is(
  (
    select pg_catalog.count(*)::integer
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
      ) > 0
  ),
  0,
  'all production provider routines have no Alchemy dependency'
);

select is(
  (
    select pg_catalog.count(*)::integer
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
        'drpc'
      ) > 0
  ),
  10,
  'all production provider routines are explicitly dRPC-bound'
);

select ok(
  pg_catalog.pg_get_constraintdef(
    (
      select constraint_definition.oid
      from pg_catalog.pg_constraint as constraint_definition
      where constraint_definition.conname =
        'optimistic_sla_bundle_receipts_v1_production_provider_v2_check'
    ),
    true
  ) like '%lb.drpc.live%',
  'the SLA receipt constraint binds the paid dRPC host'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_constraintdef(
      (
        select constraint_definition.oid
        from pg_catalog.pg_constraint as constraint_definition
        where constraint_definition.conname =
          'optimistic_sla_bundle_receipts_v1_production_provider_v2_check'
      ),
      true
    ),
    'ethereum-mainnet'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_constraintdef(
      (
        select constraint_definition.oid
        from pg_catalog.pg_constraint as constraint_definition
        where constraint_definition.conname =
          'optimistic_sla_bundle_receipts_v1_production_provider_v2_check'
      ),
      true
    ),
    'quiknode'
  ) > 0,
  'the SLA receipt constraint binds the Ethereum Mainnet QuickNode namespace'
);

select * from finish();

rollback;
