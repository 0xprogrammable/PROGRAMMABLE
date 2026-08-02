begin;

select plan(10);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = procedure.proowner
    where procedure.oid =
      'programmable_private.list_optimistic_live_chain_segment_v1(bigint)'::regprocedure
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
      and owner_role.rolname = 'programmable_migrator'
  ),
  'the ancestry RPC is a stable migrator-owned definer with empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.list_optimistic_live_chain_segment_v1(bigint)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.list_optimistic_live_chain_segment_v1(bigint)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'programmable_private.list_optimistic_live_chain_segment_v1(bigint)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'programmable_private.list_optimistic_live_chain_segment_v1(bigint)',
    'EXECUTE'
  ),
  'only the API-reader capability can execute the ancestry RPC'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.list_optimistic_live_chain_segment_v1(bigint)'::regprocedure
    ),
    'head.block_number - 11'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.list_optimistic_live_chain_segment_v1(bigint)'::regprocedure
    ),
    'parent_block.block_hash = live_chain.parent_hash'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.list_optimistic_live_chain_segment_v1(bigint)'::regprocedure
    ),
    'returned_row_count <> expected_row_count'
  ) > 0,
  'the RPC bounds, links, and completeness-checks the recursive ancestry'
);

set local role programmable_api_reader;

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.list_optimistic_live_chain_segment_v1(1)
  ),
  0::bigint,
  'an absent live head has no ancestry segment'
);

reset role;
set local role programmable_projector;

select programmable_private.register_rpc_provider_deployment(
  '31000000-0000-4000-8000-000000000001', 1,
  'alchemy', 'optimistic-chain-segment-test-v1',
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
  '32000000-0000-4000-8000-000000000002', 1,
  'quicknode', 'optimistic-chain-segment-test-v1',
  pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('24', 32), 'hex'),
  'rpc-endpoint-commitments-v1',
  pg_catalog.decode(pg_catalog.repeat('25', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('26', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

reset role;
set local role programmable_migrator;

do $seed_complete_segment$
declare
  height bigint;
  block_id uuid;
  status_id uuid;
  block_hash bytea;
  parent_hash bytea;
begin
  for height in 1000..1012 loop
    block_id := (
      pg_catalog.lpad(pg_catalog.to_hex(height), 8, '0') ||
      '-0000-4000-8000-' || pg_catalog.lpad(height::text, 12, '0')
    )::uuid;
    status_id := (
      '4' || pg_catalog.lpad(pg_catalog.to_hex(height), 7, '0') ||
      '-0000-4000-8000-' || pg_catalog.lpad(height::text, 12, '0')
    )::uuid;
    block_hash := pg_catalog.decode(
      pg_catalog.lpad(pg_catalog.to_hex(height), 64, '0'),
      'hex'
    );
    parent_hash := pg_catalog.decode(
      pg_catalog.lpad(pg_catalog.to_hex(height - 1), 64, '0'),
      'hex'
    );

    insert into programmable_private.optimistic_block_observations_v1 (
      optimistic_block_id, chain_id, block_number, block_hash, parent_hash,
      block_timestamp, provider_a_id, provider_b_id,
      provider_a_head, provider_b_head,
      provider_a_block_hash, provider_b_block_hash,
      provider_a_parent_hash, provider_b_parent_hash,
      provider_a_block_timestamp, provider_b_block_timestamp,
      evidence_commitment, observed_at
    ) values (
      block_id, 1, height, block_hash, parent_hash,
      pg_catalog.transaction_timestamp() - interval '1 second',
      '31000000-0000-4000-8000-000000000001',
      '32000000-0000-4000-8000-000000000002',
      1012, 1012, block_hash, block_hash, parent_hash, parent_hash,
      pg_catalog.transaction_timestamp() - interval '1 second',
      pg_catalog.transaction_timestamp() - interval '1 second',
      pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
      pg_catalog.transaction_timestamp()
    );
    insert into programmable_private.optimistic_block_status_history_v1 (
      status_id, optimistic_block_id, chain_id, block_number, block_hash,
      status, reorg_generation, replaced_by_block_id,
      decision_commitment, decided_at
    ) values (
      status_id, block_id, 1, height, block_hash,
      'canonical', 7, null,
      pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
      pg_catalog.transaction_timestamp()
    );
    insert into programmable_private.optimistic_block_current_canonical_v1 (
      chain_id, block_number, optimistic_block_id, block_hash,
      reorg_generation, status_id, updated_at
    ) values (
      1, height, block_id, block_hash, 7, status_id,
      pg_catalog.transaction_timestamp()
    );
  end loop;

  insert into programmable_private.optimistic_chain_head_current_v1 (
    chain_id, segment_start_block_number, optimistic_block_id,
    block_number, block_hash, parent_hash, reorg_generation,
    status_id, updated_at
  )
  select
    1, 1000, pointer.optimistic_block_id, 1012,
    observation.block_hash, observation.parent_hash, 7,
    pointer.status_id, pg_catalog.transaction_timestamp()
  from programmable_private.optimistic_block_current_canonical_v1 as pointer
  join programmable_private.optimistic_block_observations_v1 as observation
    on observation.optimistic_block_id = pointer.optimistic_block_id
  where pointer.chain_id = 1 and pointer.block_number = 1012;
end
$seed_complete_segment$;

reset role;
set local role programmable_api_reader;

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.list_optimistic_live_chain_segment_v1(1)
  ),
  12::bigint,
  'the read is bounded to exactly head minus eleven through head'
);

select is(
  (
    select pg_catalog.array_agg(block.block_number order by block.block_number)
    from programmable_private.list_optimistic_live_chain_segment_v1(1) as block
  ),
  array[1001,1002,1003,1004,1005,1006,1007,1008,1009,1010,1011,1012]::bigint[],
  'every height is present even though every block is event-empty'
);

select is(
  (
    select pg_catalog.encode(block.parent_hash, 'hex')
    from programmable_private.list_optimistic_live_chain_segment_v1(1) as block
    order by block.block_number
    limit 1
  ),
  pg_catalog.lpad(pg_catalog.to_hex(1000), 64, '0'),
  'the oldest parent hash exactly anchors the checkpoint at head minus twelve'
);

select is(
  (
    select pg_catalog.array_agg(distinct block.reorg_generation)
    from programmable_private.list_optimistic_live_chain_segment_v1(1) as block
  ),
  array[7]::bigint[],
  'the whole ancestry is bound to the current head reorg generation'
);

select throws_ok(
  $$
    select *
    from programmable_private.list_optimistic_live_chain_segment_v1(0)
  $$,
  '22023',
  'invalid chain id',
  'invalid chain identifiers fail closed'
);

reset role;
set local role programmable_migrator;

do $seed_incomplete_segment$
declare
  height bigint;
  block_id uuid;
  status_id uuid;
  block_hash bytea;
  parent_hash bytea;
begin
  foreach height in array array[2000::bigint, 2002::bigint] loop
    block_id := (
      '5' || pg_catalog.lpad(pg_catalog.to_hex(height), 7, '0') ||
      '-0000-4000-8000-' || pg_catalog.lpad(height::text, 12, '0')
    )::uuid;
    status_id := (
      '6' || pg_catalog.lpad(pg_catalog.to_hex(height), 7, '0') ||
      '-0000-4000-8000-' || pg_catalog.lpad(height::text, 12, '0')
    )::uuid;
    block_hash := pg_catalog.decode(
      pg_catalog.lpad(pg_catalog.to_hex(height), 64, '0'),
      'hex'
    );
    parent_hash := pg_catalog.decode(
      pg_catalog.lpad(pg_catalog.to_hex(height - 1), 64, '0'),
      'hex'
    );

    insert into programmable_private.optimistic_block_observations_v1 (
      optimistic_block_id, chain_id, block_number, block_hash, parent_hash,
      block_timestamp, provider_a_id, provider_b_id,
      provider_a_head, provider_b_head,
      provider_a_block_hash, provider_b_block_hash,
      provider_a_parent_hash, provider_b_parent_hash,
      provider_a_block_timestamp, provider_b_block_timestamp,
      evidence_commitment, observed_at
    ) values (
      block_id, 2, height, block_hash, parent_hash,
      pg_catalog.transaction_timestamp() - interval '1 second',
      '31000000-0000-4000-8000-000000000001',
      '32000000-0000-4000-8000-000000000002',
      2002, 2002, block_hash, block_hash, parent_hash, parent_hash,
      pg_catalog.transaction_timestamp() - interval '1 second',
      pg_catalog.transaction_timestamp() - interval '1 second',
      pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
      pg_catalog.transaction_timestamp()
    );
    insert into programmable_private.optimistic_block_status_history_v1 (
      status_id, optimistic_block_id, chain_id, block_number, block_hash,
      status, reorg_generation, replaced_by_block_id,
      decision_commitment, decided_at
    ) values (
      status_id, block_id, 2, height, block_hash,
      'canonical', 0, null,
      pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
      pg_catalog.transaction_timestamp()
    );
    insert into programmable_private.optimistic_block_current_canonical_v1 (
      chain_id, block_number, optimistic_block_id, block_hash,
      reorg_generation, status_id, updated_at
    ) values (
      2, height, block_id, block_hash, 0, status_id,
      pg_catalog.transaction_timestamp()
    );
  end loop;

  insert into programmable_private.optimistic_chain_head_current_v1 (
    chain_id, segment_start_block_number, optimistic_block_id,
    block_number, block_hash, parent_hash, reorg_generation,
    status_id, updated_at
  )
  select
    2, 2000, pointer.optimistic_block_id, 2002,
    observation.block_hash, observation.parent_hash, 0,
    pointer.status_id, pg_catalog.transaction_timestamp()
  from programmable_private.optimistic_block_current_canonical_v1 as pointer
  join programmable_private.optimistic_block_observations_v1 as observation
    on observation.optimistic_block_id = pointer.optimistic_block_id
  where pointer.chain_id = 2 and pointer.block_number = 2002;
end
$seed_incomplete_segment$;

reset role;
set local role programmable_api_reader;

select throws_ok(
  $$
    select *
    from programmable_private.list_optimistic_live_chain_segment_v1(2)
  $$,
  '40001',
  'optimistic live chain segment is incomplete',
  'a missing empty height fails the ancestry RPC closed'
);

reset role;

select * from finish();

rollback;
