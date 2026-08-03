begin;

set local timezone = 'UTC';

select plan(9);

select ok(
  to_regclass('programmable_private.market_projector_health_v1') is not null
  and (
    select relation.relkind = 'v'
      and relation.reloptions @> array[
        'security_barrier=true', 'security_invoker=false'
      ]::text[]
    from pg_catalog.pg_class as relation
    where relation.oid =
      'programmable_private.market_projector_health_v1'::regclass
  ),
  'market health is a security-definer security-barrier view'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_viewdef(
      'programmable_private.market_projector_health_v1'::regclass, true
    ),
    'NativeSwapFeesAccrued'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_viewdef(
      'programmable_private.market_projector_health_v1'::regclass, true
    ),
    'market_block_closes'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_viewdef(
      'programmable_private.market_projector_health_v1'::regclass, true
    ),
    'cursor_history.source_reorg_generation'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_viewdef(
      'programmable_private.market_projector_health_v1'::regclass, true
    ),
    'DISTINCT ON (occurrence.block_number, occurrence.block_hash)'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_viewdef(
      'programmable_private.market_projector_health_v1'::regclass, true
    ),
    'occurrence.block_global_log_index DESC'
  ) > 0,
  'health checks only the canonical last fee event in each covered block'
);

select is(
  (
    select pg_catalog.array_agg(attribute.attname::text order by attribute.attnum)
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.market_projector_health_v1'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  array[
    'chain_id', 'release_id', 'model_id', 'source_group',
    'market_projector_version', 'pool_id',
    'market_cursor_id', 'cursor_epoch_id', 'cursor_pointer_generation',
    'cursor_generation', 'cursor_reorg_generation',
    'cursor_source_checkpoint_id', 'cursor_source_checkpoint_generation',
    'cursor_source_reorg_generation', 'cursor_block_number',
    'cursor_block_hash', 'cursor_advanced_at', 'hour_coverage_end',
    'day_coverage_end', 'source_projector_version', 'source_checkpoint_id',
    'source_checkpoint_epoch_id', 'source_checkpoint_pointer_generation',
    'source_checkpoint_generation', 'source_checkpoint_reorg_generation',
    'source_checkpoint_block_number', 'source_checkpoint_block_hash',
    'source_checkpoint_cursor_block_global_log_index',
    'source_checkpoint_cursor_candidate_id', 'source_checkpoint_created_at',
    'latest_snapshot_block_number', 'latest_snapshot_observed_at',
    'latest_snapshot_attached_at', 'latest_snapshot_reconciled_at'
  ]::text[],
  'the view exposes only scoped lineage and latest reconciled snapshot health'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'programmable_private'
      and indexname = 'market_snapshot_lineage_health_latest_idx'
      and indexdef like '%attached_at DESC%'
  ),
  'latest snapshot health has a bounded index-backed lookup'
);

select ok(
  pg_catalog.has_table_privilege(
    'programmable_api_reader',
    'programmable_private.market_projector_health_v1', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'anon', 'programmable_private.market_projector_health_v1', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'programmable_private.market_projector_health_v1', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role',
    'programmable_private.market_projector_health_v1', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'programmable_projector',
    'programmable_private.market_projector_health_v1', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'programmable_reconciler',
    'programmable_private.market_projector_health_v1', 'SELECT'
  ),
  'only the API reader receives the health capability'
);

select ok(
  not pg_catalog.has_table_privilege(
    'programmable_api_reader',
    'programmable_private.market_projector_cursor_current', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'programmable_api_reader',
    'programmable_private.market_projector_cursor_history', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'programmable_api_reader',
    'programmable_private.market_snapshot_lineage_memberships', 'SELECT'
  ),
  'the health grant does not broaden access to base relations'
);

set local session_replication_role = replica;

insert into programmable_private.release_epoch_current (
  chain_id, release_id, model_id, source_group, epoch_id, generation,
  changed_at, changed_by_audit_id
) values (
  1, 'classic-v3', 'classic', 'core',
  '22000000-0000-4000-8000-000000000001', 1,
  '2026-08-03T04:00:00Z',
  '22000000-0000-4000-8000-000000000002'
);

insert into programmable_private.projector_checkpoints (
  checkpoint_id, chain_id, release_id, model_id, source_group,
  projector_version, epoch_id, pointer_generation, lease_generation,
  checkpoint_generation, reorg_generation, block_number, block_hash,
  cursor_block_global_log_index, cursor_candidate_id,
  safe_head_observation_id, target_block_evidence_id, run_id,
  terminal_outcome_id, created_at
) values
  (
    '22000000-0000-4000-8000-000000000010',
    1, 'classic-v3', 'classic', 'core', 'source-projector-v1',
    '22000000-0000-4000-8000-000000000001', 1, 1, 1, 2, 1200,
    pg_catalog.decode(pg_catalog.repeat('10', 32), 'hex'),
    4294967295, 'empty-page',
    '22000000-0000-4000-8000-000000000011',
    '22000000-0000-4000-8000-000000000012',
    '22000000-0000-4000-8000-000000000013',
    '22000000-0000-4000-8000-000000000014',
    '2026-08-03T03:59:00Z'
  ),
  (
    '22000000-0000-4000-8000-000000000020',
    1, 'classic-v3', 'classic', 'core', 'source-projector-v1',
    '22000000-0000-4000-8000-000000000001', 1, 1, 2, 2, 1250,
    pg_catalog.decode(pg_catalog.repeat('20', 32), 'hex'),
    4294967295, 'empty-page',
    '22000000-0000-4000-8000-000000000021',
    '22000000-0000-4000-8000-000000000022',
    '22000000-0000-4000-8000-000000000023',
    '22000000-0000-4000-8000-000000000024',
    '2026-08-03T04:01:00Z'
  );

insert into programmable_private.projector_checkpoint_current (
  chain_id, release_id, model_id, source_group, projector_version,
  checkpoint_id, checkpoint_generation, reorg_generation, changed_at
) values (
  1, 'classic-v3', 'classic', 'core', 'source-projector-v1',
  '22000000-0000-4000-8000-000000000010', 1, 2,
  '2026-08-03T03:59:00Z'
);

insert into programmable_private.run_headers (
  run_id, run_kind, chain_id, release_id, model_id, source_group,
  epoch_id, captured_pointer_generation, worker_version,
  request_commitment, caller_role, started_at, opened_by_audit_id
) values (
  '22000000-0000-4000-8000-000000000050', 'reconciliation',
  1, 'classic-v3', 'classic', 'core',
  '22000000-0000-4000-8000-000000000001', 1,
  'market-reconciler-v1',
  pg_catalog.decode(pg_catalog.repeat('50', 32), 'hex'),
  'programmable_reconciler', '2026-08-03T03:59:30Z',
  '22000000-0000-4000-8000-000000000051'
);

insert into programmable_private.reconciliation_records (
  reconciliation_id, run_id, chain_id, release_id, model_id,
  epoch_id, pointer_generation, comparison_kind, severity,
  source_from_block, source_to_block, compared_count, mismatch_count,
  evidence_commitment, mismatch_identity_commitments,
  resolved_at, recorded_at, audit_id
) values (
  '22000000-0000-4000-8000-000000000032',
  '22000000-0000-4000-8000-000000000050',
  1, 'classic-v3', 'classic',
  '22000000-0000-4000-8000-000000000001', 1,
  'market-health', 'info', 1100, 1200, 1, 0,
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  array[]::bytea[], null, '2026-08-03T04:00:00Z',
  '22000000-0000-4000-8000-000000000052'
);

insert into programmable_private.run_lifecycle_outcomes (
  outcome_id, run_id, status, result_commitment,
  caller_role, finished_at, audit_id
) values (
  '22000000-0000-4000-8000-000000000053',
  '22000000-0000-4000-8000-000000000050', 'succeeded',
  pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
  'programmable_reconciler', '2026-08-03T04:00:05Z',
  '22000000-0000-4000-8000-000000000054'
);

insert into programmable_private.market_snapshots (
  market_snapshot_id, chain_id, pool_id, source_deployment_id,
  block_evidence_id, block_number, block_hash, sqrt_price_x96, liquidity,
  market_volume_token0, market_volume_token1, market_volume_usd,
  hook_gross_volume, observed_at, reconciliation_id, audit_id
) values (
  '22000000-0000-4000-8000-000000000101', 1,
  pg_catalog.decode(pg_catalog.repeat('30', 32), 'hex'),
  '22000000-0000-4000-8000-000000000110',
  '22000000-0000-4000-8000-000000000111', 1200,
  pg_catalog.decode(pg_catalog.repeat('10', 32), 'hex'),
  100, 1000, 1, 2, 3, 4, '2026-08-03T04:00:00Z',
  '22000000-0000-4000-8000-000000000032',
  '22000000-0000-4000-8000-000000000112'
);

insert into programmable_private.market_projector_cursor_history (
  market_cursor_id, chain_id, release_id, model_id, source_group,
  projector_version, pool_id, epoch_id, pointer_generation,
  cursor_generation, reorg_generation, source_checkpoint_id,
  source_checkpoint_generation, source_reorg_generation,
  block_evidence_id, block_number, block_hash, provider_cursor,
  hour_coverage_end, day_coverage_end, page_commitment,
  reconciliation_id, advanced_at, audit_id
) values (
  '22000000-0000-4000-8000-000000000030',
  1, 'classic-v3', 'classic', 'core', 'market-projector-v1',
  pg_catalog.decode(pg_catalog.repeat('30', 32), 'hex'),
  '22000000-0000-4000-8000-000000000001', 1, 3, 2,
  '22000000-0000-4000-8000-000000000010', 1, 2,
  '22000000-0000-4000-8000-000000000031', 1200,
  pg_catalog.decode(pg_catalog.repeat('10', 32), 'hex'),
  'block:1200:1010101010101010', null, null,
  pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
  '22000000-0000-4000-8000-000000000032',
  '2026-08-03T04:00:00Z',
  '22000000-0000-4000-8000-000000000033'
);

insert into programmable_private.market_projector_cursor_current (
  chain_id, release_id, model_id, source_group, projector_version, pool_id,
  market_cursor_id, cursor_generation, reorg_generation, changed_at,
  changed_by_audit_id
) values (
  1, 'classic-v3', 'classic', 'core', 'market-projector-v1',
  pg_catalog.decode(pg_catalog.repeat('30', 32), 'hex'),
  '22000000-0000-4000-8000-000000000030', 3, 2,
  '2026-08-03T04:00:00Z',
  '22000000-0000-4000-8000-000000000034'
);

insert into programmable_private.market_snapshot_lineage_memberships (
  chain_id, release_id, model_id, source_group, projector_version, pool_id,
  reorg_generation, market_snapshot_id, attached_reconciliation_id,
  attached_at, audit_id
) values (
  1, 'classic-v3', 'classic', 'core', 'market-projector-v1',
  pg_catalog.decode(pg_catalog.repeat('30', 32), 'hex'), 2,
  '22000000-0000-4000-8000-000000000101',
  '22000000-0000-4000-8000-000000000032',
  '2026-08-03T04:00:04Z',
  '22000000-0000-4000-8000-000000000141'
);

set local session_replication_role = origin;
set local role programmable_api_reader;

select is(
  (select pg_catalog.count(*)
   from programmable_private.market_projector_health_v1),
  1::bigint,
  'a current launch with a caught-up reconciled cursor is healthy'
);

reset role;
set local session_replication_role = replica;

update programmable_private.projector_checkpoint_current
set checkpoint_id = '22000000-0000-4000-8000-000000000020',
    checkpoint_generation = 2,
    changed_at = '2026-08-03T04:01:00Z'
where chain_id = 1
  and release_id = 'classic-v3'
  and model_id = 'classic'
  and source_group = 'core'
  and projector_version = 'source-projector-v1';

set local session_replication_role = origin;
set local role programmable_api_reader;

select is(
  (select pg_catalog.concat_ws('|',
     cursor_block_number::text, source_checkpoint_block_number::text,
     source_checkpoint_generation::text)
   from programmable_private.market_projector_health_v1),
  '1200|1250|2'::text,
  'an inactive cursor remains healthy across a newer empty source checkpoint'
);

reset role;
set local session_replication_role = replica;

update programmable_private.projector_checkpoints
set reorg_generation = 3
where checkpoint_id = '22000000-0000-4000-8000-000000000020';
update programmable_private.projector_checkpoint_current
set reorg_generation = 3
where checkpoint_id = '22000000-0000-4000-8000-000000000020';

set local session_replication_role = origin;
set local role programmable_api_reader;

select is(
  (select pg_catalog.count(*)
   from programmable_private.market_projector_health_v1),
  0::bigint,
  'a source reorg beyond the cursor generation disappears fail-closed'
);

reset role;

select * from finish();

rollback;
