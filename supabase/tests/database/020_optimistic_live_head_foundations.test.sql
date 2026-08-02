begin;

select plan(37);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'programmable_private'
      and indexname = 'envio_candidate_inbox_projector_keyset_idx'
      and indexdef like
        '%(chain_id, block_number, block_global_log_index, candidate_id)%'
  ),
  'the existing candidate inbox has its projector keyset access path'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_class as class
    where class.oid = any (array[
      'programmable_private.optimistic_block_observations_v1'::regclass,
      'programmable_private.optimistic_event_rows_v1'::regclass,
      'programmable_private.optimistic_block_status_history_v1'::regclass,
      'programmable_private.optimistic_block_current_canonical_v1'::regclass,
      'programmable_private.optimistic_chain_head_current_v1'::regclass
    ])
      and class.relrowsecurity
      and class.relforcerowsecurity
      and class.relowner = (
        select oid from pg_catalog.pg_roles
        where rolname = 'programmable_migrator'
      )
  ),
  5::bigint,
  'all optimistic control-plane tables are migrator-owned with forced RLS'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_policy as policy
    where policy.polrelid = any (array[
      'programmable_private.optimistic_block_observations_v1'::regclass,
      'programmable_private.optimistic_event_rows_v1'::regclass,
      'programmable_private.optimistic_block_status_history_v1'::regclass,
      'programmable_private.optimistic_block_current_canonical_v1'::regclass,
      'programmable_private.optimistic_chain_head_current_v1'::regclass
    ])
      and policy.polcmd = '*'
      and policy.polroles = array[
        (
          select oid from pg_catalog.pg_roles
          where rolname = 'programmable_migrator'
        )
      ]::oid[]
  ),
  5::bigint,
  'every optimistic table has exactly the migrator capability policy'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_projector', 'programmable_reconciler',
      'programmable_api_reader', 'programmable_profile_binder',
      'programmable_profile_recovery', 'programmable_profile_writer',
      'programmable_maintenance', 'programmable_api_reader_login',
      'programmable_projector_login', 'programmable_reconciler_login'
    ]) as checked_role(role_name)
    cross join pg_catalog.unnest(array[
      'programmable_private.optimistic_block_observations_v1',
      'programmable_private.optimistic_event_rows_v1',
      'programmable_private.optimistic_block_status_history_v1',
      'programmable_private.optimistic_block_current_canonical_v1',
      'programmable_private.optimistic_chain_head_current_v1'
    ]) as checked_table(table_name)
    where pg_catalog.has_table_privilege(
      checked_role.role_name,
      checked_table.table_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
    )
  ),
  'no runtime, browser, service or login role can access base tables'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = procedure.proowner
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname in (
        'append_optimistic_block_observation_v1',
        'append_optimistic_event_row_v1',
        'get_optimistic_promotion_plan_v1',
        'promote_optimistic_block_canonical_v1',
        'get_optimistic_live_head_v1',
        'list_optimistic_canonical_events_v1'
      )
      and (
        not procedure.prosecdef
        or 'search_path=""' <> all(procedure.proconfig)
        or owner_role.rolname <> 'programmable_migrator'
        or (
          procedure.proname in (
            'get_optimistic_promotion_plan_v1',
            'get_optimistic_live_head_v1',
            'list_optimistic_canonical_events_v1'
          )
          and procedure.provolatile <> 's'
        )
        or (
          procedure.proname not in (
            'get_optimistic_promotion_plan_v1',
            'get_optimistic_live_head_v1',
            'list_optimistic_canonical_events_v1'
          )
          and procedure.provolatile <> 'v'
        )
      )
  ),
  'all optimistic APIs are empty-search-path migrator definers with exact volatility'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.get_optimistic_promotion_plan_v1(uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.append_optimistic_block_observation_v1(uuid,bigint,bigint,bytea,bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,uuid,uuid,bigint,bigint,bytea,timestamp with time zone)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.append_optimistic_event_row_v1(uuid,uuid,bytea,bigint,bigint,bytea,bytea,bytea[],bytea,jsonb,bytea,timestamp with time zone)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.promote_optimistic_block_canonical_v1(uuid,uuid,uuid,uuid,bytea,timestamp with time zone)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.get_optimistic_promotion_plan_v1(uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'programmable_private.get_optimistic_promotion_plan_v1(uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.append_optimistic_block_observation_v1(uuid,bigint,bigint,bytea,bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,uuid,uuid,bigint,bigint,bytea,timestamp with time zone)',
    'EXECUTE'
  ),
  'only the existing projector capability has optimistic writer execution'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.get_optimistic_live_head_v1(bigint)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.list_optimistic_canonical_events_v1(bigint,bigint,bigint,uuid,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.get_optimistic_live_head_v1(bigint)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'programmable_private.get_optimistic_live_head_v1(bigint)',
    'EXECUTE'
  ),
  'only the existing API-reader capability has optimistic read execution'
);

set local role programmable_projector;

select programmable_private.register_rpc_provider_deployment(
  '21000000-0000-4000-8000-000000000001', 1,
  'alchemy', 'optimistic-live-head-test-v1',
  pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('14', 32), 'hex'),
  'rpc-endpoint-commitments-v1',
  pg_catalog.decode(pg_catalog.repeat('15', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('16', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select programmable_private.register_rpc_provider_deployment(
  '22000000-0000-4000-8000-000000000002', 1,
  'quicknode', 'optimistic-live-head-test-v1',
  pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('24', 32), 'hex'),
  'rpc-endpoint-commitments-v1',
  pg_catalog.decode(pg_catalog.repeat('25', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('26', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select is(
  programmable_private.append_optimistic_block_observation_v1(
    'a0000000-0000-4000-8000-000000000001',
    1,
    21000000,
    pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
    pg_catalog.transaction_timestamp() - interval '12 seconds',
    pg_catalog.transaction_timestamp() - interval '12 seconds',
    '21000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000002',
    21000001,
    21000002,
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    pg_catalog.transaction_timestamp()
  ),
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'the first dual-RPC optimistic block observation is appended'
);

select is(
  programmable_private.append_optimistic_block_observation_v1(
    'a0000000-0000-4000-8000-000000000001',
    1,
    21000000,
    pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
    pg_catalog.transaction_timestamp() - interval '12 seconds',
    pg_catalog.transaction_timestamp() - interval '12 seconds',
    '21000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000002',
    21000001,
    21000002,
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '1 second'
  ),
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'an exact block replay ignores only the repeated receipt timestamp'
);

select throws_ok(
  $sql$
    select programmable_private.append_optimistic_block_observation_v1(
      'a0000000-0000-4000-8000-000000000001', 1, 21000000,
      decode(repeat('aa', 32), 'hex'), decode(repeat('aa', 32), 'hex'),
      decode(repeat('99', 32), 'hex'), decode(repeat('99', 32), 'hex'),
      transaction_timestamp() - interval '12 seconds',
      transaction_timestamp() - interval '12 seconds',
      '21000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000002',
      21000001, 21000002,
      decode(repeat('a2', 32), 'hex'), transaction_timestamp()
    )
  $sql$,
  '23505',
  'optimistic block id or physical identity mismatch',
  'a block replay with different evidence is rejected'
);

select is(
  programmable_private.append_optimistic_event_row_v1(
    'e0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    pg_catalog.decode(pg_catalog.repeat('01', 32), 'hex'),
    1,
    7,
    pg_catalog.decode(pg_catalog.repeat('11', 20), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    array[pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex')],
    pg_catalog.decode('0102', 'hex'),
    '{"kind":"alpha"}'::jsonb,
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
    pg_catalog.transaction_timestamp()
  ),
  'e0000000-0000-4000-8000-000000000001'::uuid,
  'a normalized optimistic event row is appended'
);

select is(
  programmable_private.append_optimistic_event_row_v1(
    'e0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    pg_catalog.decode(pg_catalog.repeat('01', 32), 'hex'),
    1,
    7,
    pg_catalog.decode(pg_catalog.repeat('11', 20), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    array[pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex')],
    pg_catalog.decode('0102', 'hex'),
    '{"kind":"alpha"}'::jsonb,
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '1 second'
  ),
  'e0000000-0000-4000-8000-000000000001'::uuid,
  'an exact event replay ignores only the repeated receipt timestamp'
);

select throws_ok(
  $sql$
    select programmable_private.append_optimistic_event_row_v1(
      'e0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      decode(repeat('01', 32), 'hex'), 1, 7,
      decode(repeat('11', 20), 'hex'),
      decode(repeat('41', 32), 'hex'),
      array[decode(repeat('51', 32), 'hex')],
      decode('0102', 'hex'), '{"kind":"mismatch"}'::jsonb,
      decode(repeat('62', 32), 'hex'), transaction_timestamp()
    )
  $sql$,
  '23505',
  'optimistic event id or physical identity mismatch',
  'the physical event key cannot be rebound to different normalized content'
);

select is(
  programmable_private.promote_optimistic_block_canonical_v1(
    'a0000000-0000-4000-8000-000000000001',
    null,
    'c0000000-0000-4000-8000-000000000001',
    null,
    pg_catalog.decode(pg_catalog.repeat('c1', 32), 'hex'),
    pg_catalog.transaction_timestamp()
  ),
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'the first agreed block becomes canonical'
);

reset role;
set local role programmable_api_reader;

select is(
  (
    select pg_catalog.encode(head.block_hash, 'hex')
    from programmable_private.get_optimistic_live_head_v1(1) as head
  ),
  pg_catalog.repeat('aa', 32),
  'the API reader sees the first canonical optimistic head'
);

reset role;
set local role programmable_projector;

select programmable_private.append_optimistic_block_observation_v1(
  'b0000000-0000-4000-8000-000000000002',
  1,
  21000000,
  pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
  pg_catalog.transaction_timestamp() - interval '10 seconds',
  pg_catalog.transaction_timestamp() - interval '10 seconds',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000002',
  21000003,
  21000003,
  pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select programmable_private.append_optimistic_event_row_v1(
  'f0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  2,
  8,
  pg_catalog.decode(pg_catalog.repeat('22', 20), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  array[pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex')],
  pg_catalog.decode('0304', 'hex'),
  '{"kind":"beta"}'::jsonb,
  pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select is(
  programmable_private.promote_optimistic_block_canonical_v1(
    'b0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.decode(pg_catalog.repeat('d1', 32), 'hex'),
    pg_catalog.transaction_timestamp()
  ),
  'b0000000-0000-4000-8000-000000000002'::uuid,
  'a same-height replacement atomically becomes canonical'
);

select is(
  programmable_private.promote_optimistic_block_canonical_v1(
    'b0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.decode(pg_catalog.repeat('d1', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '1 second'
  ),
  'b0000000-0000-4000-8000-000000000002'::uuid,
  'an exact reorg replay preserves the first decision timestamp'
);

reset role;

select ok(
  exists (
    select 1
    from programmable_private.optimistic_block_status_history_v1
    where optimistic_block_id =
        'a0000000-0000-4000-8000-000000000001'
      and status = 'orphaned'
      and reorg_generation = 1
      and replaced_by_block_id =
        'b0000000-0000-4000-8000-000000000002'
  )
  and exists (
    select 1
    from programmable_private.optimistic_block_status_history_v1
    where optimistic_block_id =
        'b0000000-0000-4000-8000-000000000002'
      and status = 'canonical'
      and reorg_generation = 1
  ),
  'reorg history preserves the old orphan and new canonical decision'
);

set local role programmable_api_reader;

select ok(
  exists (
    select 1
    from programmable_private.get_optimistic_live_head_v1(1) as head
    where head.optimistic_block_id =
        'b0000000-0000-4000-8000-000000000002'
      and head.reorg_generation = 1
      and pg_catalog.encode(head.block_hash, 'hex') = pg_catalog.repeat('bb', 32)
  ),
  'the live-head reader follows the replacement at generation one'
);

select is(
  (
    select pg_catalog.array_agg(events.optimistic_event_id)
    from programmable_private.list_optimistic_canonical_events_v1(
      1, null, null, null, 100
    ) as events
  ),
  array['f0000000-0000-4000-8000-000000000002'::uuid],
  'canonical event reads exclude orphaned block rows after a reorg'
);

reset role;

set local role programmable_projector;

select programmable_private.append_optimistic_block_observation_v1(
  'b1000000-0000-4000-8000-000000000003',
  1,
  21000001,
  pg_catalog.decode(pg_catalog.repeat('bc', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('bc', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'),
  pg_catalog.transaction_timestamp() - interval '9 seconds',
  pg_catalog.transaction_timestamp() - interval '9 seconds',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000002',
  21000004,
  21000004,
  pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select programmable_private.append_optimistic_event_row_v1(
  'f1000000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000003',
  pg_catalog.decode(pg_catalog.repeat('03', 32), 'hex'),
  1,
  1,
  pg_catalog.decode(pg_catalog.repeat('23', 20), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
  array[pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex')],
  pg_catalog.decode('0506', 'hex'),
  '{"kind":"stale-child"}'::jsonb,
  pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select ok(
  exists (
    select 1
    from programmable_private.get_optimistic_promotion_plan_v1(
      'b1000000-0000-4000-8000-000000000003'
    ) as promotion_plan
    where promotion_plan.mode = 'extend'
      and promotion_plan.can_promote
      and promotion_plan.expected_current_block_id =
        'b0000000-0000-4000-8000-000000000002'
      and not promotion_plan.orphan_required
      and promotion_plan.chain_tip_block_number = 21000000
  ),
  'the projector-only plan exposes the exact N+1 expected tip'
);

select is(
  programmable_private.promote_optimistic_block_canonical_v1(
    'b1000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000003',
    null,
    pg_catalog.decode(pg_catalog.repeat('e1', 32), 'hex'),
    pg_catalog.transaction_timestamp()
  ),
  'b1000000-0000-4000-8000-000000000003'::uuid,
  'an N+1 block with the exact persisted parent extends the live tip'
);

reset role;
set local role programmable_api_reader;

select ok(
  exists (
    select 1
    from programmable_private.get_optimistic_live_head_v1(1) as head
    where head.optimistic_block_id =
        'b1000000-0000-4000-8000-000000000003'
      and head.block_number = 21000001
      and pg_catalog.encode(head.parent_hash, 'hex') =
        pg_catalog.repeat('bb', 32)
      and head.block_timestamp =
        pg_catalog.transaction_timestamp() - interval '9 seconds'
  ),
  'the chain head exposes persisted parent hash and dual-RPC block timestamp'
);

reset role;
set local role programmable_projector;

select programmable_private.append_optimistic_block_observation_v1(
  'a1000000-0000-4000-8000-000000000004',
  1,
  21000000,
  pg_catalog.decode(pg_catalog.repeat('cc', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('cc', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
  pg_catalog.transaction_timestamp() - interval '8 seconds',
  pg_catalog.transaction_timestamp() - interval '8 seconds',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000002',
  21000005,
  21000005,
  pg_catalog.decode(pg_catalog.repeat('c2', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select programmable_private.append_optimistic_event_row_v1(
  'e1000000-0000-4000-8000-000000000004',
  'a1000000-0000-4000-8000-000000000004',
  pg_catalog.decode(pg_catalog.repeat('04', 32), 'hex'),
  1,
  2,
  pg_catalog.decode(pg_catalog.repeat('24', 20), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
  array[pg_catalog.decode(pg_catalog.repeat('54', 32), 'hex')],
  pg_catalog.decode('0708', 'hex'),
  '{"kind":"replacement-ancestor"}'::jsonb,
  pg_catalog.decode(pg_catalog.repeat('64', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select ok(
  exists (
    select 1
    from programmable_private.get_optimistic_promotion_plan_v1(
      'a1000000-0000-4000-8000-000000000004'
    ) as promotion_plan
    where promotion_plan.mode = 'replace'
      and promotion_plan.can_promote
      and promotion_plan.expected_current_block_id =
        'b0000000-0000-4000-8000-000000000002'
      and promotion_plan.target_height_current_block_id =
        'b0000000-0000-4000-8000-000000000002'
      and promotion_plan.orphan_required
  ),
  'the plan resolves the exact target-height pointer for an ancestor reorg'
);

select is(
  programmable_private.promote_optimistic_block_canonical_v1(
    'a1000000-0000-4000-8000-000000000004',
    'b0000000-0000-4000-8000-000000000002',
    'c2000000-0000-4000-8000-000000000004',
    'd2000000-0000-4000-8000-000000000004',
    pg_catalog.decode(pg_catalog.repeat('e2', 32), 'hex'),
    pg_catalog.transaction_timestamp()
  ),
  'a1000000-0000-4000-8000-000000000004'::uuid,
  'replacing an ancestor resets the single live tip to that height'
);

select ok(
  exists (
    select 1
    from programmable_private.get_optimistic_promotion_plan_v1(
      'a1000000-0000-4000-8000-000000000004'
    ) as promotion_plan
    where promotion_plan.mode = 'replay'
      and promotion_plan.can_promote
      and promotion_plan.expected_current_block_id =
        'b0000000-0000-4000-8000-000000000002'
      and promotion_plan.orphan_required
      and promotion_plan.canonical_status_id =
        'c2000000-0000-4000-8000-000000000004'
      and promotion_plan.orphan_status_id =
        'd2000000-0000-4000-8000-000000000004'
      and promotion_plan.stored_decision_commitment =
        pg_catalog.decode(pg_catalog.repeat('e2', 32), 'hex')
      and promotion_plan.stored_decided_at =
        pg_catalog.transaction_timestamp()
  ),
  'a replay plan returns the stored IDs and decision needed for exact retry'
);

reset role;
set local role programmable_api_reader;

select ok(
  exists (
    select 1
    from programmable_private.get_optimistic_live_head_v1(1) as head
    where head.optimistic_block_id =
        'a1000000-0000-4000-8000-000000000004'
      and head.block_number = 21000000
      and head.reorg_generation = 2
  ),
  'the head reader cannot return the stale higher descendant after reset'
);

select is(
  (
    select pg_catalog.array_agg(events.optimistic_event_id)
    from programmable_private.list_optimistic_canonical_events_v1(
      1, null, null, null, 100
    ) as events
  ),
  array['e1000000-0000-4000-8000-000000000004'::uuid],
  'the recursive live-chain reader hides the stale descendant event'
);

reset role;
set local role programmable_projector;

select programmable_private.append_optimistic_block_observation_v1(
  'a2000000-0000-4000-8000-000000000005',
  1,
  21000001,
  pg_catalog.decode(pg_catalog.repeat('dd', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('dd', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('cc', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('cc', 32), 'hex'),
  pg_catalog.transaction_timestamp() - interval '7 seconds',
  pg_catalog.transaction_timestamp() - interval '7 seconds',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000002',
  21000006,
  21000006,
  pg_catalog.decode(pg_catalog.repeat('c3', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select programmable_private.append_optimistic_event_row_v1(
  'e2000000-0000-4000-8000-000000000005',
  'a2000000-0000-4000-8000-000000000005',
  pg_catalog.decode(pg_catalog.repeat('05', 32), 'hex'),
  1,
  3,
  pg_catalog.decode(pg_catalog.repeat('25', 20), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('45', 32), 'hex'),
  array[pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex')],
  pg_catalog.decode('090a', 'hex'),
  '{"kind":"replacement-child"}'::jsonb,
  pg_catalog.decode(pg_catalog.repeat('65', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select ok(
  exists (
    select 1
    from programmable_private.get_optimistic_promotion_plan_v1(
      'a2000000-0000-4000-8000-000000000005'
    ) as promotion_plan
    where promotion_plan.mode = 'replace-stale-child'
      and promotion_plan.can_promote
      and promotion_plan.expected_current_block_id =
        'b1000000-0000-4000-8000-000000000003'
      and promotion_plan.orphan_required
      and promotion_plan.chain_tip_block_id =
        'a1000000-0000-4000-8000-000000000004'
  ),
  'the plan resolves the stale child replacement after a tip reset'
);

select is(
  programmable_private.promote_optimistic_block_canonical_v1(
    'a2000000-0000-4000-8000-000000000005',
    'b1000000-0000-4000-8000-000000000003',
    'c3000000-0000-4000-8000-000000000005',
    'd3000000-0000-4000-8000-000000000005',
    pg_catalog.decode(pg_catalog.repeat('e3', 32), 'hex'),
    pg_catalog.transaction_timestamp()
  ),
  'a2000000-0000-4000-8000-000000000005'::uuid,
  'a replacement child with the new parent restores the next-height tip'
);

select is(
  programmable_private.promote_optimistic_block_canonical_v1(
    'a2000000-0000-4000-8000-000000000005',
    'b1000000-0000-4000-8000-000000000003',
    'c3000000-0000-4000-8000-000000000005',
    'd3000000-0000-4000-8000-000000000005',
    pg_catalog.decode(pg_catalog.repeat('e3', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '1 second'
  ),
  'a2000000-0000-4000-8000-000000000005'::uuid,
  'the exact replacement-child replay preserves its first decision timestamp'
);

select programmable_private.append_optimistic_block_observation_v1(
  'a3000000-0000-4000-8000-000000000006',
  1,
  21000002,
  pg_catalog.decode(pg_catalog.repeat('ee', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('ee', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'),
  pg_catalog.transaction_timestamp() - interval '6 seconds',
  pg_catalog.transaction_timestamp() - interval '6 seconds',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000002',
  21000007,
  21000007,
  pg_catalog.decode(pg_catalog.repeat('c4', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select ok(
  exists (
    select 1
    from programmable_private.get_optimistic_promotion_plan_v1(
      'a3000000-0000-4000-8000-000000000006'
    ) as promotion_plan
    where promotion_plan.mode = 'parent-mismatch'
      and not promotion_plan.can_promote
      and not promotion_plan.requires_rebootstrap
  ),
  'the plan hard-fails an N+1 parent mismatch before promotion'
);

select throws_ok(
  $$
    select programmable_private.promote_optimistic_block_canonical_v1(
      'a3000000-0000-4000-8000-000000000006',
      'a2000000-0000-4000-8000-000000000005',
      'c4000000-0000-4000-8000-000000000006',
      null,
      decode(repeat('e4', 32), 'hex'),
      transaction_timestamp()
    )
  $$,
  '40001',
  'optimistic block does not extend the current chain tip',
  'N+1 promotion rejects a dual-RPC block with the wrong parent hash'
);

reset role;
set local role programmable_projector;

select programmable_private.append_optimistic_block_observation_v1(
  'a4000000-0000-4000-8000-000000000007',
  1,
  20999999,
  pg_catalog.decode(pg_catalog.repeat('fa', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('fa', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('98', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('98', 32), 'hex'),
  pg_catalog.transaction_timestamp() - interval '5 seconds',
  pg_catalog.transaction_timestamp() - interval '5 seconds',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000002',
  21000007,
  21000007,
  pg_catalog.decode(pg_catalog.repeat('c5', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select ok(
  exists (
    select 1
    from programmable_private.get_optimistic_promotion_plan_v1(
      'a4000000-0000-4000-8000-000000000007'
    ) as promotion_plan
    where promotion_plan.mode = 'outside-segment'
      and not promotion_plan.can_promote
      and promotion_plan.requires_rebootstrap
      and promotion_plan.segment_start_block_number = 21000000
  ),
  'a deep reorg below the persisted bootstrap segment fails closed'
);

reset role;
set local role programmable_api_reader;

select ok(
  exists (
    select 1
    from programmable_private.get_optimistic_live_head_v1(1) as head
    where head.optimistic_block_id =
        'a2000000-0000-4000-8000-000000000005'
      and head.block_number = 21000001
      and head.reorg_generation = 2
  ),
  'the replacement child is the restored live head'
);

select is(
  (
    select pg_catalog.array_agg(
      events.optimistic_event_id order by events.block_number
    )
    from programmable_private.list_optimistic_canonical_events_v1(
      1, null, null, null, 100
    ) as events
  ),
  array[
    'e1000000-0000-4000-8000-000000000004'::uuid,
    'e2000000-0000-4000-8000-000000000005'::uuid
  ],
  'restored live-chain events include only the replacement ancestor and child'
);

reset role;

select throws_ok(
  $$
    update programmable_private.optimistic_block_observations_v1
    set observed_at = observed_at
    where optimistic_block_id =
      'a0000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'programmable_private.optimistic_block_observations_v1 is immutable; append a new fact/history row instead',
  'dual-RPC block evidence cannot be mutated'
);

select * from finish();
rollback;
