begin;

create function public.chainlink_latest_round_data_fixture()
returns bytea
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.decode(
    '000000000000000000000000000000000000000000000000000000000000002a'
    || '00000000000000000000000000000000000000000000000000000045d964b800'
    || '0000000000000000000000000000000000000000000000000000000069570a80'
    || '0000000000000000000000000000000000000000000000000000000069570bac'
    || '000000000000000000000000000000000000000000000000000000000000002a',
    'hex'
  )
$function$;

set local role programmable_projector;

select programmable_private.create_release_epoch(
  'a6000000-0000-0000-0000-000000000001',
  1, 'classic-v3', 'classic-v3', 'core', 1,
  decode(repeat('10', 32), 'hex'),
  decode(repeat('11', 32), 'hex'),
  decode(repeat('12', 32), 'hex'),
  '2026-01-01T00:00:00Z'
);
select programmable_private.activate_release_epoch(
  1, 'classic-v3', 'classic-v3', 'core',
  'a6000000-0000-0000-0000-000000000001',
  0, 1, decode(repeat('13', 32), 'hex'),
  '2026-01-01T00:00:01Z'
);
select programmable_private.register_rpc_provider_deployment(
  'b6000000-0000-0000-0000-000000000001',
  1, 'alchemy', 'rpc-provider-v1',
  decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('a3', 32), 'hex'),
  decode(repeat('21', 32), 'hex'), decode(repeat('22', 32), 'hex'),
  decode(repeat('23', 32), 'hex'), '2026-01-01T00:00:02Z'
);
select programmable_private.register_rpc_provider_deployment(
  'b6000000-0000-0000-0000-000000000002',
  1, 'quicknode', 'rpc-provider-v1',
  decode(repeat('b1', 32), 'hex'), decode(repeat('b2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('b3', 32), 'hex'),
  decode(repeat('24', 32), 'hex'), decode(repeat('25', 32), 'hex'),
  decode(repeat('26', 32), 'hex'), '2026-01-01T00:00:03Z'
);
select programmable_private.register_provider_deployment(
  'b6000000-0000-0000-0000-000000000003',
  'uniswap_subgraph', 'market-subgraph',
  decode(repeat('27', 32), 'hex'), decode(repeat('28', 32), 'hex'),
  decode(repeat('29', 32), 'hex'), '2026-01-01T00:00:04Z'
);
select programmable_private.open_run(
  'c6000000-0000-0000-0000-000000000001',
  'ingestion', 1, 'classic-v3', 'classic-v3', 'core',
  'a6000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('31', 32), 'hex'),
  '2026-01-01T00:01:00Z'
);

select plan(62);

select throws_ok(
  $sql$
    select programmable_private.register_provider_deployment(
      'b6000000-0000-0000-0000-0000000000ff',
      'rpc_provider', 'generic-rpc-bypass',
      decode(repeat('f1', 32), 'hex'), decode(repeat('f2', 32), 'hex'),
      decode(repeat('f3', 32), 'hex'), '2026-01-01T00:00:05Z'
    )
  $sql$,
  '42501',
  'generic provider registration cannot bypass RPC deployment metadata'
);

select throws_ok(
  $sql$
    select programmable_private.register_rpc_provider_deployment(
      'b6000000-0000-0000-0000-0000000000fe',
      10, 'alchemy', 'rpc-provider-v1',
      decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
      'rpc-endpoint-commitments-v1', decode(repeat('d3', 32), 'hex'),
      decode(repeat('d4', 32), 'hex'), decode(repeat('d5', 32), 'hex'),
      decode(repeat('d6', 32), 'hex'), '2026-01-01T00:00:06Z'
    )
  $sql$,
  '22023',
  'specialized RPC registration is Ethereum mainnet only'
);

select throws_ok(
  $sql$
    select programmable_private.register_rpc_provider_deployment(
      'b6000000-0000-0000-0000-0000000000fd',
      1, 'alchemy', 'rpc-provider-v1',
      decode(repeat('00', 32), 'hex'), decode(repeat('e2', 32), 'hex'),
      'rpc-endpoint-commitments-v1', decode(repeat('e3', 32), 'hex'),
      decode(repeat('e4', 32), 'hex'), decode(repeat('e5', 32), 'hex'),
      decode(repeat('e6', 32), 'hex'), '2026-01-01T00:00:07Z'
    )
  $sql$,
  '22023',
  'zero RPC endpoint commitments are rejected'
);

reset role;

select ok(
  exists (
    select 1
    from programmable_private.rpc_provider_deployment_metadata as alchemy
    join programmable_private.rpc_provider_deployment_metadata as quicknode
      on quicknode.provider_deployment_id =
        'b6000000-0000-0000-0000-000000000002'::uuid
    where alchemy.provider_deployment_id =
        'b6000000-0000-0000-0000-000000000001'::uuid
      and alchemy.chain_id = 1
      and alchemy.vendor = 'alchemy'
      and alchemy.vendor_order = 1
      and quicknode.chain_id = 1
      and quicknode.vendor = 'quicknode'
      and quicknode.vendor_order = 2
      and alchemy.constructor_version = 'rpc-provider-v1'
      and quicknode.constructor_version = 'rpc-provider-v1'
      and alchemy.endpoint_url_commitment = decode(repeat('a1', 32), 'hex')
      and alchemy.endpoint_origin_commitment = decode(repeat('a2', 32), 'hex')
      and alchemy.endpoint_evidence_domain = 'rpc-endpoint-commitments-v1'
      and alchemy.endpoint_evidence_commitment = decode(repeat('a3', 32), 'hex')
  ),
  'RPC deployment metadata stores ordered vendors and commitment-only endpoint evidence'
);

set local role programmable_projector;

select is(
  (
    select state.pointer_generation
    from programmable_private.get_projector_runtime_state_v1(
      1, 'classic-v3', 'classic-v3', 'core', 'projector-v1',
      array['rpc_provider', 'rpc_provider', 'uniswap_subgraph']::text[],
      array['rpc:1:alchemy', 'rpc:1:quicknode', 'market-subgraph']::text[],
      array[
        decode(repeat('21', 32), 'hex'),
        decode(repeat('24', 32), 'hex'),
        decode(repeat('27', 32), 'hex')
      ],
      array[
        decode(repeat('22', 32), 'hex'),
        decode(repeat('25', 32), 'hex'),
        decode(repeat('28', 32), 'hex')
      ]
    ) as state
  ),
  1::bigint,
  'stateless projector reads the exact current epoch generation'
);
select ok(
  (
    select state.lease_generation = 0
       and state.checkpoint_generation = 0
       and state.reorg_generation = 0
       and state.checkpoint_id is null
       and state.provider_redacted_identities =
         array['rpc:1:alchemy', 'rpc:1:quicknode', 'market-subgraph']::text[]
    from programmable_private.get_projector_runtime_state_v1(
      1, 'classic-v3', 'classic-v3', 'core', 'projector-v1',
      array['rpc_provider', 'rpc_provider', 'uniswap_subgraph']::text[],
      array['rpc:1:alchemy', 'rpc:1:quicknode', 'market-subgraph']::text[],
      array[
        decode(repeat('21', 32), 'hex'),
        decode(repeat('24', 32), 'hex'),
        decode(repeat('27', 32), 'hex')
      ],
      array[
        decode(repeat('22', 32), 'hex'),
        decode(repeat('25', 32), 'hex'),
        decode(repeat('28', 32), 'hex')
      ]
    ) as state
  ),
  'runtime state returns deterministic zero CAS inputs before lease/checkpoint creation'
);
select throws_ok(
  $sql$
    select *
    from programmable_private.get_projector_runtime_state_v1(
      1, 'classic-v3', 'classic-v3', 'core', 'projector-v1',
      array['rpc_provider']::text[], array['rpc:1:alchemy']::text[],
      array[decode(repeat('ff', 32), 'hex')],
      array[decode(repeat('22', 32), 'hex')]
    )
  $sql$,
  '23503',
  'runtime state rejects a drifted provider deployment commitment'
);

select throws_ok(
  $sql$
    select programmable_private.register_rpc_provider_deployment(
      'b6000000-0000-0000-0000-000000000004',
      1, 'alchemy', 'rpc-provider-v1',
      decode(repeat('c1', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
      'rpc-endpoint-commitments-v1', decode(repeat('c3', 32), 'hex'),
      decode(repeat('2a', 32), 'hex'), decode(repeat('2b', 32), 'hex'),
      decode(repeat('2c', 32), 'hex'), '2026-01-01T00:01:01Z'
    )
  $sql$,
  '23505',
  'duplicate chain and RPC vendor registration fails closed'
);
select throws_ok(
  $sql$
    select programmable_private.append_safe_head_observation(
      'd6000000-0000-0000-0000-000000000001',
      'c6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000001',
      1, 1, 100, 100, 12, 88,
      decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000101', 'hex'),
      decode(repeat('41', 32), 'hex'), '2026-01-01T00:01:02Z'
    )
  $sql$,
  '22023',
  'the two RPC deployments must differ'
);
select throws_ok(
  $sql$
    select programmable_private.append_safe_head_observation(
      'd6000000-0000-0000-0000-0000000000ff',
      'c6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000002',
      'b6000000-0000-0000-0000-000000000001',
      1, 1, 100, 100, 12, 88,
      decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320001ff', 'hex'),
      decode(repeat('40', 32), 'hex'), '2026-01-01T00:01:02.500Z'
    )
  $sql$,
  '22023',
  'safe-head evidence enforces Alchemy first and QuickNode second'
);
select throws_ok(
  $sql$
    select programmable_private.append_safe_head_observation(
      'd6000000-0000-0000-0000-000000000002',
      'c6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000002',
      1, 10, 100, 100, 12, 88,
      decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000102', 'hex'),
      decode(repeat('42', 32), 'hex'), '2026-01-01T00:01:03Z'
    )
  $sql$,
  '22023',
  'either wrong reported chain ID is rejected'
);
select throws_ok(
  $sql$
    select programmable_private.append_safe_head_observation(
      'd6000000-0000-0000-0000-000000000003',
      'c6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000002',
      1, 1, 11, 100, 12, 0,
      decode(repeat('00', 32), 'hex'), decode(repeat('00', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000103', 'hex'),
      decode(repeat('43', 32), 'hex'), '2026-01-01T00:01:04Z'
    )
  $sql$,
  '22023',
  'a provider head below finality depth is rejected'
);
select throws_ok(
  $sql$
    select programmable_private.append_safe_head_observation(
      'd6000000-0000-0000-0000-000000000004',
      'c6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000002',
      1, 1, 100, 100, 12, 89,
      decode(repeat('89', 32), 'hex'), decode(repeat('89', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000104', 'hex'),
      decode(repeat('44', 32), 'hex'), '2026-01-01T00:01:05Z'
    )
  $sql$,
  '22023',
  'safe block must equal least heads minus twelve exactly'
);
select throws_ok(
  $sql$
    select programmable_private.append_safe_head_observation(
      'd6000000-0000-0000-0000-000000000005',
      'c6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000002',
      1, 1, 100, 100, 12, 88,
      decode(repeat('88', 32), 'hex'), decode(repeat('89', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000105', 'hex'),
      decode(repeat('45', 32), 'hex'), '2026-01-01T00:01:06Z'
    )
  $sql$,
  '22023',
  'unequal safe-block hashes are rejected'
);
select throws_ok(
  $sql$
    select programmable_private.append_safe_head_observation(
      'd6000000-0000-0000-0000-000000000006',
      'c6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000002',
      1, 1, 100.1, 100, 12, 88,
      decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000106', 'hex'),
      decode(repeat('46', 32), 'hex'), '2026-01-01T00:01:07Z'
    )
  $sql$,
  '22023',
  'fractional RPC heads are rejected before assignment'
);
select is(
  programmable_private.append_safe_head_observation(
    'd6000000-0000-0000-0000-000000000007',
    'c6000000-0000-0000-0000-000000000001',
    'b6000000-0000-0000-0000-000000000001',
    'b6000000-0000-0000-0000-000000000002',
    1, 1, 100, 100, 12, 88,
    decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
    2::smallint,
    decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000107', 'hex'),
    decode(repeat('47', 32), 'hex'), '2026-01-01T00:01:08Z'
  ),
  'd6000000-0000-0000-0000-000000000007'::uuid,
  'a valid dual-RPC safe head is accepted'
);
select throws_ok(
  $sql$
    select programmable_private.append_dual_rpc_block_evidence(
      'e6000000-0000-0000-0000-000000000001',
      'd6000000-0000-0000-0000-000000000007',
      'c6000000-0000-0000-0000-000000000001',
      89, decode(repeat('89', 32), 'hex'), decode(repeat('89', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000208', 'hex'),
      decode(repeat('48', 32), 'hex'), '2026-01-01T00:01:09Z'
    )
  $sql$,
  '22023',
  'per-block evidence above the accepted safe head is rejected'
);
select throws_ok(
  $sql$
    select programmable_private.append_dual_rpc_block_evidence(
      'e6000000-0000-0000-0000-000000000002',
      'd6000000-0000-0000-0000-000000000007',
      'c6000000-0000-0000-0000-000000000001',
      88, decode(repeat('88', 32), 'hex'), decode(repeat('87', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000209', 'hex'),
      decode(repeat('49', 32), 'hex'), '2026-01-01T00:01:10Z'
    )
  $sql$,
  '22023',
  'per-block provider hashes must agree'
);
select is(
  programmable_private.append_dual_rpc_block_evidence(
    'e6000000-0000-0000-0000-000000000003',
    'd6000000-0000-0000-0000-000000000007',
    'c6000000-0000-0000-0000-000000000001',
    88, decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
    2::smallint,
    decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200020a', 'hex'),
    decode(repeat('4a', 32), 'hex'), '2026-01-01T00:01:11Z'
  ),
  'e6000000-0000-0000-0000-000000000003'::uuid,
  'target-at-safe block evidence is accepted'
);
select programmable_private.append_dual_rpc_block_evidence(
  'e6000000-0000-0000-0000-000000000004',
  'd6000000-0000-0000-0000-000000000007',
  'c6000000-0000-0000-0000-000000000001',
  80, decode(repeat('62', 32), 'hex'), decode(repeat('62', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200020b', 'hex'),
  decode(repeat('4c', 32), 'hex'), '2026-01-01T00:01:12Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'e6000000-0000-0000-0000-000000000005',
  'd6000000-0000-0000-0000-000000000007',
  'c6000000-0000-0000-0000-000000000001',
  81, decode(repeat('64', 32), 'hex'), decode(repeat('64', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200020c', 'hex'),
  decode(repeat('4d', 32), 'hex'), '2026-01-01T00:01:13Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'e6000000-0000-0000-0000-000000000006',
  'd6000000-0000-0000-0000-000000000007',
  'c6000000-0000-0000-0000-000000000001',
  82, decode(repeat('69', 32), 'hex'), decode(repeat('69', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200020d', 'hex'),
  decode(repeat('4e', 32), 'hex'), '2026-01-01T00:01:14Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'e6000000-0000-0000-0000-000000000007',
  'd6000000-0000-0000-0000-000000000007',
  'c6000000-0000-0000-0000-000000000001',
  83, decode(repeat('6b', 32), 'hex'), decode(repeat('6b', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200020e', 'hex'),
  decode(repeat('4f', 32), 'hex'), '2026-01-01T00:01:15Z'
);

select programmable_private.append_run_telemetry(
  'f6000000-0000-0000-0000-000000000001',
  'c6000000-0000-0000-0000-000000000001',
  'success-old', '2026-06-01T00:00:00Z',
  10, 1, '{"sample":"success"}'::jsonb, false
);
select programmable_private.append_run_telemetry(
  'f6000000-0000-0000-0000-000000000002',
  'c6000000-0000-0000-0000-000000000001',
  'failed-old', '2026-01-01T00:02:00Z',
  20, 2, '{"sample":"failed-old"}'::jsonb, true
);
select programmable_private.append_run_telemetry(
  'f6000000-0000-0000-0000-000000000003',
  'c6000000-0000-0000-0000-000000000001',
  'failed-recent', '2026-07-01T00:00:00Z',
  30, 3, '{"sample":"failed-recent"}'::jsonb, true
);
select programmable_private.append_run_outcome(
  'f6100000-0000-0000-0000-000000000001',
  'c6000000-0000-0000-0000-000000000001',
  'succeeded', decode(repeat('4b', 32), 'hex'),
  '2026-07-30T00:00:00Z'
);
select throws_ok(
  $sql$
    select programmable_private.append_run_telemetry(
      'f6000000-0000-0000-0000-000000000004',
      'c6000000-0000-0000-0000-000000000001',
      'after-terminal', '2026-07-30T00:01:00Z',
      1, 1, '{}'::jsonb, false
    )
  $sql$,
  '55000',
  'terminal runs reject later telemetry'
);

reset role;

select throws_ok(
  $$update programmable_private.fingerprint_encoding_versions
    set write_enabled = false
    where fingerprint_domain = 'occurrence' and encoding_version = 1$$,
  '55000',
  'fingerprint encoding definitions cannot be rewritten'
);
select throws_ok(
  $$delete from programmable_private.fingerprint_encoding_versions
    where fingerprint_domain = 'occurrence' and encoding_version = 1$$,
  '55000',
  'old fingerprint encoding versions cannot be deleted'
);
select throws_ok(
  $$update programmable_private.release_epochs set epoch_number = 2
    where epoch_id = 'a6000000-0000-0000-0000-000000000001'$$,
  '55000',
  'release epochs cannot be updated'
);
select throws_ok(
  $$delete from programmable_private.release_epochs
    where epoch_id = 'a6000000-0000-0000-0000-000000000001'$$,
  '55000',
  'release epochs cannot be deleted'
);
select throws_ok(
  $$update programmable_private.run_headers set worker_version = 'changed'
    where run_id = 'c6000000-0000-0000-0000-000000000001'$$,
  '55000',
  'run headers are immutable'
);
select throws_ok(
  $$delete from programmable_private.run_lifecycle_outcomes
    where run_id = 'c6000000-0000-0000-0000-000000000001'$$,
  '55000',
  'terminal outcomes are retained immutably'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as table_row
      on table_row.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'programmable_private'
      and constraint_row.contype = 'f'
      and constraint_row.confdeltype not in ('a', 'r')
  ),
  'private provenance foreign keys never cascade or set null'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as function_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'programmable_private'
      and function_row.proname ~* '(digest|keccak|sha3|canonicalize)'
  ),
  'Postgres does not recompute codec preimages or cryptographic digests'
);

set local role programmable_reconciler;

select programmable_private.open_run(
  'c6000000-0000-0000-0000-000000000002',
  'reconciliation', 1, 'classic-v3', 'classic-v3', 'core',
  'a6000000-0000-0000-0000-000000000001', 1,
  'reconciler-v1', decode(repeat('51', 32), 'hex'),
  '2026-01-02T00:00:00Z'
);
select programmable_private.append_reconciliation_record(
  'aa000000-0000-0000-0000-000000000001',
  'c6000000-0000-0000-0000-000000000002',
  'route-match', 'info', 0, 88, 10, 0,
  decode(repeat('52', 32), 'hex'), array[]::bytea[],
  null, '2026-01-02T00:01:00Z'
);
select programmable_private.append_reconciliation_record(
  'aa000000-0000-0000-0000-000000000002',
  'c6000000-0000-0000-0000-000000000002',
  'route-mismatch', 'warning', 0, 88, 10, 1,
  decode(repeat('53', 32), 'hex'),
  array[decode(repeat('54', 32), 'hex')],
  '2026-01-03T00:00:00Z', '2026-01-02T00:02:00Z'
);
select throws_ok(
  $sql$
    select programmable_private.append_global_eth_usd_snapshot_v1(
      'aa100000-0000-0000-0000-000000000001',
      'aa000000-0000-0000-0000-000000000001',
      'e6000000-0000-0000-0000-000000000003',
      'b6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000002',
      43, 300000000000, 8::smallint, '2026-01-02T00:05:00Z',
      public.chainlink_latest_round_data_fixture(),
      public.chainlink_latest_round_data_fixture(),
      decode(repeat('91', 32), 'hex'), decode(repeat('92', 32), 'hex'),
      '2026-01-02T00:35:00Z'
    )
  $sql$,
  '23514',
  'ETH/USD writer rejects a caller-supplied round that differs from raw latestRoundData'
);
select throws_ok(
  $sql$
    select programmable_private.append_global_eth_usd_snapshot_v1(
      'aa100000-0000-0000-0000-000000000002',
      'aa000000-0000-0000-0000-000000000001',
      'e6000000-0000-0000-0000-000000000003',
      'b6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000002',
      42, 300000000001, 8::smallint, '2026-01-02T00:05:00Z',
      public.chainlink_latest_round_data_fixture(),
      public.chainlink_latest_round_data_fixture(),
      decode(repeat('93', 32), 'hex'), decode(repeat('94', 32), 'hex'),
      '2026-01-02T00:35:00Z'
    )
  $sql$,
  '23514',
  'ETH/USD writer rejects an arbitrary denormalized answer'
);
select throws_ok(
  $sql$
    select programmable_private.append_global_eth_usd_snapshot_v1(
      'aa100000-0000-0000-0000-000000000003',
      'aa000000-0000-0000-0000-000000000001',
      'e6000000-0000-0000-0000-000000000003',
      'b6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000002',
      42, 300000000000, 18::smallint, '2026-01-02T00:05:00Z',
      public.chainlink_latest_round_data_fixture(),
      public.chainlink_latest_round_data_fixture(),
      decode(repeat('95', 32), 'hex'), decode(repeat('96', 32), 'hex'),
      '2026-01-02T00:35:00Z'
    )
  $sql$,
  '23514',
  'ETH/USD writer fixes mainnet feed decimals at eight'
);
select throws_ok(
  $sql$
    select programmable_private.append_global_eth_usd_snapshot_v1(
      'aa100000-0000-0000-0000-000000000004',
      'aa000000-0000-0000-0000-000000000001',
      'e6000000-0000-0000-0000-000000000003',
      'b6000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000002',
      42, 300000000000, 8::smallint, '2026-01-02T00:05:00Z',
      public.chainlink_latest_round_data_fixture(),
      public.chainlink_latest_round_data_fixture(),
      decode(repeat('97', 32), 'hex'), decode(repeat('98', 32), 'hex'),
      '2026-01-02T01:05:01Z'
    )
  $sql$,
  '23514',
  'ETH/USD writer rejects latestRoundData older than the one-hour ceiling'
);
select is(
  programmable_private.append_global_eth_usd_snapshot_v1(
    'aa100000-0000-0000-0000-000000000005',
    'aa000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000003',
    'b6000000-0000-0000-0000-000000000001',
    'b6000000-0000-0000-0000-000000000002',
    42, 300000000000, 8::smallint, '2026-01-02T00:05:00Z',
    public.chainlink_latest_round_data_fixture(),
    public.chainlink_latest_round_data_fixture(),
    decode(repeat('99', 32), 'hex'), decode(repeat('9a', 32), 'hex'),
    '2026-01-02T00:35:00Z'
  ),
  'aa100000-0000-0000-0000-000000000005'::uuid,
  'exact raw latestRoundData persists after full ABI and freshness validation'
);
reset role;
select ok(
  exists (
    select 1
    from programmable_private.global_eth_usd_snapshots
    where global_market_snapshot_id =
      'aa100000-0000-0000-0000-000000000005'
      and feed_round_id = 42 and answer = 300000000000
      and decimals = 8 and rpc_decoding_version = 1
      and feed_started_at = '2026-01-02T00:00:00Z'
      and feed_updated_at = '2026-01-02T00:05:00Z'
      and feed_answered_in_round = 42
  ),
  'decoded Chainlink round fields are retained exactly for later audit replay'
);
set local role programmable_reconciler;
select programmable_private.append_parity_record(
  'ab000000-0000-0000-0000-000000000001',
  'aa000000-0000-0000-0000-000000000001',
  'explore-list', decode(repeat('55', 32), 'hex'),
  decode(repeat('55', 32), 'hex'),
  '2026-01-02T00:03:00Z', null
);
select programmable_private.append_parity_record(
  'ab000000-0000-0000-0000-000000000002',
  'aa000000-0000-0000-0000-000000000002',
  'launch-detail', decode(repeat('56', 32), 'hex'),
  decode(repeat('57', 32), 'hex'),
  '2026-01-02T00:04:00Z', '2026-01-03T00:00:00Z'
);
select throws_ok(
  $sql$
    select programmable_private.append_parity_record(
      'ab000000-0000-0000-0000-000000000003',
      'aa000000-0000-0000-0000-000000000001',
      'invalid-match', decode(repeat('58', 32), 'hex'),
      decode(repeat('58', 32), 'hex'),
      '2026-01-02T00:05:00Z', '2026-01-03T00:00:00Z'
    )
  $sql$,
  '22023',
  'matching parity evidence cannot claim a resolution timestamp'
);
select throws_ok(
  $sql$
    select programmable_private.append_reconciliation_record(
      'aa000000-0000-0000-0000-000000000003',
      'c6000000-0000-0000-0000-000000000002',
      'fractional-range', 'warning', 0.1, 88, 1, 0,
      decode(repeat('59', 32), 'hex'), array[]::bytea[],
      null, '2026-01-02T00:06:00Z'
    )
  $sql$,
  '22023',
  'fractional reconciliation block boundaries are rejected'
);
select programmable_private.append_market_snapshot(
  'ac000000-0000-0000-0000-000000000001',
  'aa000000-0000-0000-0000-000000000001',
  'b6000000-0000-0000-0000-000000000003',
  'e6000000-0000-0000-0000-000000000004',
  decode(repeat('61', 32), 'hex'), 80, decode(repeat('62', 32), 'hex'),
  1000, 2000, 1.25, 2.5, 3.75, null,
  '2026-07-20T00:00:00Z', decode(repeat('63', 32), 'hex')
);
select programmable_private.append_market_snapshot(
  'ac000000-0000-0000-0000-000000000002',
  'aa000000-0000-0000-0000-000000000001',
  'b6000000-0000-0000-0000-000000000003',
  'e6000000-0000-0000-0000-000000000005',
  decode(repeat('61', 32), 'hex'), 81, decode(repeat('64', 32), 'hex'),
  1001, 2001, 2.25, 3.5, 4.75, 100,
  '2026-07-30T00:00:00Z', decode(repeat('65', 32), 'hex')
);
select is(
  programmable_private.append_market_snapshot(
    'ac000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000001',
    'b6000000-0000-0000-0000-000000000003',
    'e6000000-0000-0000-0000-000000000004',
    decode(repeat('61', 32), 'hex'), 80, decode(repeat('62', 32), 'hex'),
    1000, 2000, 1.25, 2.5, 3.75, null,
    '2026-07-20T00:00:00Z', decode(repeat('63', 32), 'hex')
  ),
  'ac000000-0000-0000-0000-000000000001'::uuid,
  'exact market snapshot replay is idempotent'
);
select throws_ok(
  $sql$
    select programmable_private.append_market_snapshot(
      'ac000000-0000-0000-0000-000000000001',
      'aa000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000003',
      'e6000000-0000-0000-0000-000000000004',
      decode(repeat('61', 32), 'hex'), 80, decode(repeat('62', 32), 'hex'),
      1000, 2000, 1.25, 2.5, 3.75, null,
      '2026-07-20T00:00:00Z', decode(repeat('66', 32), 'hex')
    )
  $sql$,
  '23505',
  'market replay with a changed audit commitment is rejected'
);
select throws_ok(
  $sql$
    select programmable_private.append_market_snapshot(
      'ac000000-0000-0000-0000-000000000003',
      'aa000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000003',
      'e6000000-0000-0000-0000-000000000005',
      decode(repeat('61', 32), 'hex'), 82, decode(repeat('67', 32), 'hex'),
      1000, 2000, 1, 2, 3, 0.1,
      '2026-07-30T00:01:00Z', decode(repeat('68', 32), 'hex')
    )
  $sql$,
  '22003',
  'fractional hook volume is rejected as uint256'
);
select throws_ok(
  $sql$
    select programmable_private.append_market_snapshot(
      'ac000000-0000-0000-0000-000000000004',
      'aa000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000003',
      'e6000000-0000-0000-0000-000000000004',
      decode(repeat('61', 32), 'hex'), 81, decode(repeat('64', 32), 'hex'),
      1000, 2000, 1, 2, 3, 4,
      '2026-07-30T00:02:00Z', decode(repeat('6f', 32), 'hex')
    )
  $sql$,
  '23514',
  'market snapshot block number and hash must match the exact dual-RPC evidence'
);
select programmable_private.append_market_candle(
  'ad000000-0000-0000-0000-000000000001',
  'aa000000-0000-0000-0000-000000000001',
  'b6000000-0000-0000-0000-000000000003',
  'e6000000-0000-0000-0000-000000000006',
  decode(repeat('61', 32), 'hex'), 'hour',
  '2026-01-10T00:00:00Z', '2026-01-10T01:00:00Z',
  10, 12, 9, 11, 100, 200, 300,
  decode(repeat('69', 32), 'hex'), decode(repeat('6a', 32), 'hex')
);
select programmable_private.append_market_candle(
  'ad000000-0000-0000-0000-000000000002',
  'aa000000-0000-0000-0000-000000000001',
  'b6000000-0000-0000-0000-000000000003',
  'e6000000-0000-0000-0000-000000000007',
  decode(repeat('61', 32), 'hex'), 'day',
  '2026-01-10T00:00:00Z', '2026-01-11T00:00:00Z',
  10, 12, 9, 11, 100, 200, 300,
  decode(repeat('6b', 32), 'hex'), decode(repeat('6c', 32), 'hex')
);
select throws_ok(
  $sql$
    select programmable_private.append_market_candle(
      'ad000000-0000-0000-0000-000000000003',
      'aa000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000003',
      'e6000000-0000-0000-0000-000000000006',
      decode(repeat('61', 32), 'hex'), 'hour',
      '2026-07-30T00:00:00Z', '2026-07-30T01:00:00Z',
      10, 'NaN'::numeric, 9, 11, 100, 200, 300,
      decode(repeat('69', 32), 'hex'), decode(repeat('6e', 32), 'hex')
    )
  $sql$,
  '22023',
  'non-finite market values are rejected'
);
select throws_ok(
  $sql$
    select programmable_private.append_market_candle(
      'ad000000-0000-0000-0000-000000000004',
      'aa000000-0000-0000-0000-000000000001',
      'b6000000-0000-0000-0000-000000000001',
      'e6000000-0000-0000-0000-000000000006',
      decode(repeat('61', 32), 'hex'), 'hour',
      '2026-07-30T00:00:00Z', '2026-07-30T01:00:00Z',
      10, 12, 9, 11, 100, 200, 300,
      decode(repeat('69', 32), 'hex'), decode(repeat('70', 32), 'hex')
    )
  $sql$,
  '23503',
  'market candles reject an RPC deployment in place of the immutable subgraph source'
);
select programmable_private.append_dependency_health(
  'ae000000-0000-0000-0000-000000000001',
  'c6000000-0000-0000-0000-000000000002',
  'rpc-a', 'frozen', 3, '2026-07-30T00:09:00Z', null,
  decode(repeat('6d', 32), 'hex')
);
select programmable_private.append_run_outcome(
  'f6100000-0000-0000-0000-000000000002',
  'c6000000-0000-0000-0000-000000000002',
  'succeeded', decode(repeat('6f', 32), 'hex'),
  '2026-07-30T00:10:00Z'
);
select throws_ok(
  $sql$
    select programmable_private.append_parity_record(
      'ab000000-0000-0000-0000-000000000004',
      'aa000000-0000-0000-0000-000000000001',
      'after-terminal', decode(repeat('70', 32), 'hex'),
      decode(repeat('71', 32), 'hex'),
      '2026-07-30T00:11:00Z', null
    )
  $sql$,
  '55000',
  'terminal reconciliation runs reject new parity evidence'
);
select throws_ok(
  $sql$
    select programmable_private.append_dependency_health(
      'ae000000-0000-0000-0000-000000000001',
      'c6000000-0000-0000-0000-000000000002',
      'rpc-a', 'frozen', 3, '2026-07-30T00:09:00Z', null,
      decode(repeat('6d', 32), 'hex')
    )
  $sql$,
  '55000',
  'terminal reconciliation runs reject dependency-health evidence replays'
);

reset role;

select throws_ok(
  $$update programmable_private.market_snapshots
    set market_volume_token0 = 99
    where market_snapshot_id = 'ac000000-0000-0000-0000-000000000001'$$,
  '55000',
  'prunable market facts remain update-immutable'
);
select ok(
  has_function_privilege(
    'programmable_reconciler',
    'programmable_private.append_market_snapshot(uuid,uuid,uuid,uuid,bytea,numeric,bytea,numeric,numeric,numeric,numeric,numeric,numeric,timestamp with time zone,bytea)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'programmable_api_reader',
    'programmable_private.append_market_snapshot(uuid,uuid,uuid,uuid,bytea,numeric,bytea,numeric,numeric,numeric,numeric,numeric,numeric,timestamp with time zone,bytea)',
    'EXECUTE'
  ),
  'market ingestion is an exact reconciler-only function capability'
);

set local role programmable_maintenance;

select throws_ok(
  $sql$
    select programmable_private.prune_run_telemetry(
      '2026-07-31T06:00:00Z', 10001, decode(repeat('81', 32), 'hex')
    )
  $sql$,
  '22023',
  'retention calls are hard-capped at ten thousand rows'
);
select is(
  programmable_private.prune_run_telemetry(
    '2026-07-31T06:00:00Z', 1, decode(repeat('82', 32), 'hex')
  ),
  1,
  'telemetry retention honors the caller row limit'
);
select is(
  programmable_private.prune_run_telemetry(
    '2026-07-31T06:00:00Z', 100, decode(repeat('83', 32), 'hex')
  ),
  1,
  'success and failed telemetry use separate age windows'
);
select is(
  programmable_private.prune_market_data(
    '2026-07-31T06:00:00Z', 1, decode(repeat('84', 32), 'hex')
  ),
  1,
  'first bounded market prune removes one expired raw snapshot'
);
select is(
  programmable_private.prune_market_data(
    '2026-07-31T06:00:00Z', 1, decode(repeat('85', 32), 'hex')
  ),
  1,
  'second bounded market prune removes one expired hourly candle'
);
select is(
  programmable_private.prune_parity_records(
    '2026-07-31T06:00:00Z', 1, decode(repeat('86', 32), 'hex')
  ),
  1,
  'matching parity retention is bounded'
);
select is(
  programmable_private.prune_parity_records(
    '2026-07-31T06:00:00Z', 100, decode(repeat('87', 32), 'hex')
  ),
  1,
  'resolved mismatches expire only after their longer window'
);

reset role;

select is(
  (select count(*) from programmable_private.run_telemetry),
  1::bigint,
  'recent failed telemetry survives the 180-day window'
);
select is(
  (select count(*) from programmable_private.run_headers),
  2::bigint,
  'retention never deletes immutable run headers'
);
select is(
  (select count(*) from programmable_private.run_lifecycle_outcomes),
  2::bigint,
  'retention never deletes terminal outcomes'
);
select is(
  (
    select count(*)
    from programmable_private.market_snapshots
    where observed_at = '2026-07-30T00:00:00Z'
  ),
  1::bigint,
  'recent raw market snapshot survives the seven-day window'
);
select is(
  (
    select count(*)
    from programmable_private.market_candles
    where interval = 'hour'
  ),
  0::bigint,
  'expired hourly candles are pruned'
);
select is(
  (
    select count(*)
    from programmable_private.market_candles
    where interval = 'day'
  ),
  1::bigint,
  'daily candles are retained indefinitely'
);
select is(
  (select count(*) from programmable_private.parity_records),
  0::bigint,
  'eligible parity rows are pruned without deleting reconciliation evidence'
);
select is(
  (select count(*) from programmable_private.reconciliation_records),
  2::bigint,
  'reconciliation provenance survives parity and market retention'
);
select ok(
  not exists (
    select 1
    from programmable_private.market_snapshots
    where reconciliation_id is null or audit_id is null
  )
  and not exists (
    select 1
    from programmable_private.market_candles
    where reconciliation_id is null or audit_id is null
  ),
  'retained market rows keep non-null reconciliation and audit provenance'
);

select * from finish();
rollback;
