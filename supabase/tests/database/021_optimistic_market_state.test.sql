begin;

select plan(26);

select ok(
  (
    select class.relrowsecurity
      and class.relforcerowsecurity
      and owner_role.rolname = 'programmable_migrator'
    from pg_catalog.pg_class as class
    join pg_catalog.pg_roles as owner_role on owner_role.oid = class.relowner
    where class.oid =
      'programmable_private.optimistic_market_state_rows_v1'::regclass
  ),
  'the immutable optimistic market-state table is migrator-owned with forced RLS'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_projector', 'programmable_reconciler',
      'programmable_api_reader', 'programmable_api_reader_login',
      'programmable_projector_login', 'programmable_reconciler_login'
    ]) as checked_role(role_name)
    where pg_catalog.has_table_privilege(
      checked_role.role_name,
      'programmable_private.optimistic_market_state_rows_v1',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
    )
  ),
  'no runtime, browser, service, or login role can access market-state rows'
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
        'append_optimistic_market_state_v1',
        'list_optimistic_canonical_market_states_v1'
      )
      and (
        not procedure.prosecdef
        or 'search_path=""' <> all(procedure.proconfig)
        or owner_role.rolname <> 'programmable_migrator'
        or (
          procedure.proname = 'append_optimistic_market_state_v1'
          and procedure.provolatile <> 'v'
        )
        or (
          procedure.proname = 'list_optimistic_canonical_market_states_v1'
          and procedure.provolatile <> 's'
        )
      )
  ),
  'market-state RPCs are empty-search-path migrator definers with exact volatility'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.append_optimistic_market_state_v1(uuid,uuid,bytea,bytea,bytea,bytea,numeric,integer,numeric,integer,integer,bytea,bytea,bytea,bytea,jsonb,bytea,uuid,uuid,text,text,bytea,bytea,bytea,bytea,bigint,bigint,smallint,smallint,smallint,smallint,smallint,smallint,smallint,bytea,timestamp with time zone)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.append_optimistic_market_state_v1(uuid,uuid,bytea,bytea,bytea,bytea,numeric,integer,numeric,integer,integer,bytea,bytea,bytea,bytea,jsonb,bytea,uuid,uuid,text,text,bytea,bytea,bytea,bytea,bigint,bigint,smallint,smallint,smallint,smallint,smallint,smallint,smallint,bytea,timestamp with time zone)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'programmable_private.append_optimistic_market_state_v1(uuid,uuid,bytea,bytea,bytea,bytea,numeric,integer,numeric,integer,integer,bytea,bytea,bytea,bytea,jsonb,bytea,uuid,uuid,text,text,bytea,bytea,bytea,bytea,bigint,bigint,smallint,smallint,smallint,smallint,smallint,smallint,smallint,bytea,timestamp with time zone)',
    'EXECUTE'
  ),
  'only the projector capability can append optimistic market evidence'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.list_optimistic_canonical_market_states_v1(bigint,bigint,bytea,uuid,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.list_optimistic_canonical_market_states_v1(bigint,bigint,bytea,uuid,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'programmable_private.list_optimistic_canonical_market_states_v1(bigint,bigint,bytea,uuid,integer)',
    'EXECUTE'
  ),
  'only the API-reader capability can list optimistic market evidence'
);

select ok(
  not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.valid_optimistic_market_json_v1(jsonb,bigint,integer,numeric)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.valid_optimistic_market_json_v1(jsonb,bigint,integer,numeric)',
    'EXECUTE'
  ),
  'the table-only JSON validator is not a runtime RPC'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.append_optimistic_market_state_v1(uuid,uuid,bytea,bytea,bytea,bytea,numeric,integer,numeric,integer,integer,bytea,bytea,bytea,bytea,jsonb,bytea,uuid,uuid,text,text,bytea,bytea,bytea,bytea,bigint,bigint,smallint,smallint,smallint,smallint,smallint,smallint,smallint,bytea,timestamp with time zone)'::regprocedure
    ),
    ') >= 100'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.list_optimistic_canonical_market_states_v1(bigint,bigint,bytea,uuid,integer)'::regprocedure
    ),
    'head.block_number - 11'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.list_optimistic_canonical_market_states_v1(bigint,bigint,bytea,uuid,integer)'::regprocedure
    ),
    'p_limit > 100'
  ) > 0,
  'the writer and recursive reader structurally cap one block and one live page'
);

select ok(
  programmable_private.valid_optimistic_market_json_v1(
    jsonb_build_object(
      'indexedValuationBlockNumber', '22000000',
      'currentTick', 0,
      'activeLiquidity', '1000',
      'tokenPriceEth', '0.01',
      'tokenPriceEthWei', '10000000000000000',
      'marketCapEth', '10',
      'marketCapEthWei', '10000000000000000000',
      'indexedMarketCapEth', '9.5',
      'indexedMarketCapEthWei', '9500000000000000000'
    ),
    22000000, 0, 1000
  ),
  'the exact classic optimistic market JSON shape is accepted'
);

select ok(
  not programmable_private.valid_optimistic_market_json_v1(
    '{"indexedValuationBlockNumber":"22000000","currentTick":0,"activeLiquidity":null}'::jsonb,
    22000000, 0, 1000
  ),
  'null market values are rejected before durable append'
);

set local role programmable_projector;

select programmable_private.register_rpc_provider_deployment(
  '51000000-0000-4000-8000-000000000001', 1,
  'drpc', 'optimistic-market-state-test-v1',
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
  '52000000-0000-4000-8000-000000000002', 1,
  'quicknode', 'optimistic-market-state-test-v1',
  pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('24', 32), 'hex'),
  'rpc-endpoint-commitments-v1',
  pg_catalog.decode(pg_catalog.repeat('25', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('26', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

do $fixture$
declare
  offset_value integer;
  height_value bigint;
  block_id uuid;
  prior_block_id uuid;
  state_id uuid;
  block_hash bytea;
  parent_hash bytea;
  pool_id bytea;
begin
  for offset_value in 0..13 loop
    height_value := 22000000 + offset_value;
    block_id := (
      '31000000-0000-4000-8000-' ||
      pg_catalog.lpad(offset_value::text, 12, '0')
    )::uuid;
    state_id := (
      '32000000-0000-4000-8000-' ||
      pg_catalog.lpad(offset_value::text, 12, '0')
    )::uuid;
    block_hash := pg_catalog.decode(
      pg_catalog.lpad(pg_catalog.to_hex(offset_value + 1), 64, '0'), 'hex'
    );
    parent_hash := case
      when offset_value = 0 then
        pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex')
      else pg_catalog.decode(
        pg_catalog.lpad(pg_catalog.to_hex(offset_value), 64, '0'), 'hex'
      )
    end;
    pool_id := pg_catalog.decode(
      pg_catalog.lpad(pg_catalog.to_hex(1000 + offset_value), 64, '0'),
      'hex'
    );

    perform programmable_private.append_optimistic_block_observation_v1(
      block_id, 1, height_value,
      block_hash, block_hash, parent_hash, parent_hash,
      pg_catalog.transaction_timestamp() - interval '1 minute',
      pg_catalog.transaction_timestamp() - interval '1 minute',
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000002',
      height_value + 1, height_value + 2,
      pg_catalog.decode(
        pg_catalog.repeat(
          pg_catalog.lpad(pg_catalog.to_hex(100 + offset_value), 2, '0'),
          32
        ),
        'hex'
      ),
      pg_catalog.transaction_timestamp()
    );

    perform programmable_private.append_optimistic_market_state_v1(
      state_id, block_id, pool_id,
      pg_catalog.decode(pg_catalog.repeat('11', 20), 'hex'),
      pg_catalog.decode(
        '7ffe42c4a5deea5b0fec41c94c136cf115597227', 'hex'
      ),
      pg_catalog.decode(
        'd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878',
        'hex'
      ),
      1, 0, 1000, 0, 3000,
      pg_catalog.decode(pg_catalog.repeat('01', 128), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('01', 128), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
      pg_catalog.jsonb_build_object(
        'indexedValuationBlockNumber', height_value::text,
        'currentTick', 0,
        'activeLiquidity', '1000'
      ),
      pg_catalog.decode(
        pg_catalog.repeat(
          pg_catalog.lpad(pg_catalog.to_hex(150 + offset_value), 2, '0'),
          32
        ),
        'hex'
      ),
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000002',
      'drpc-mainnet-11111111111111111111111111111111',
      'quicknode-mainnet-21212121212121212121212121212121',
      pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('14', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('24', 32), 'hex'),
      height_value + 5, height_value + 5,
      4::smallint, 4::smallint, 7::smallint, 7::smallint,
      11::smallint, 11::smallint, 5::smallint,
      pg_catalog.decode(
        pg_catalog.repeat(
          pg_catalog.lpad(pg_catalog.to_hex(180 + offset_value), 2, '0'),
          32
        ),
        'hex'
      ),
      pg_catalog.transaction_timestamp()
    );

    prior_block_id := case
      when offset_value = 0 then null
      else (
        '31000000-0000-4000-8000-' ||
        pg_catalog.lpad((offset_value - 1)::text, 12, '0')
      )::uuid
    end;
    perform programmable_private.promote_optimistic_block_canonical_v1(
      block_id,
      prior_block_id,
      (
        '33000000-0000-4000-8000-' ||
        pg_catalog.lpad(offset_value::text, 12, '0')
      )::uuid,
      null,
      pg_catalog.decode(
        pg_catalog.repeat(
          pg_catalog.lpad(pg_catalog.to_hex(210 + offset_value), 2, '0'),
          32
        ),
        'hex'
      ),
      pg_catalog.transaction_timestamp()
    );
  end loop;
end
$fixture$;

reset role;

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.optimistic_market_state_rows_v1
  ),
  14::bigint,
  'fourteen immutable market-state rows are durably captured'
);

set local role programmable_projector;

select is(
  programmable_private.append_optimistic_market_state_v1(
    '32000000-0000-4000-8000-000000000000',
    '31000000-0000-4000-8000-000000000000',
    pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(1000), 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('11', 20), 'hex'),
    pg_catalog.decode('7ffe42c4a5deea5b0fec41c94c136cf115597227', 'hex'),
    pg_catalog.decode('d7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878', 'hex'),
    1, 0, 1000, 0, 3000,
    pg_catalog.decode(pg_catalog.repeat('01', 128), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('01', 128), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
    '{"indexedValuationBlockNumber":"22000000","currentTick":0,"activeLiquidity":"1000"}'::jsonb,
    pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex'),
    '51000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000002',
    'drpc-mainnet-11111111111111111111111111111111',
    'quicknode-mainnet-21212121212121212121212121212121',
    pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('14', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('24', 32), 'hex'),
    22000005, 22000005,
    4::smallint, 4::smallint, 7::smallint, 7::smallint,
    11::smallint, 11::smallint, 5::smallint,
    pg_catalog.decode(pg_catalog.repeat('b4', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '1 second'
  ),
  '32000000-0000-4000-8000-000000000000'::uuid,
  'an exact market-state replay ignores only observed_at'
);

select throws_ok(
  $sql$
    select programmable_private.append_optimistic_market_state_v1(
      '32000000-0000-4000-8000-000000000000',
      '31000000-0000-4000-8000-000000000000',
      decode(lpad(to_hex(1000), 64, '0'), 'hex'),
      decode(repeat('11', 20), 'hex'),
      decode('7ffe42c4a5deea5b0fec41c94c136cf115597227', 'hex'),
      decode('d7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878', 'hex'),
      1, 0, 1000, 0, 3000,
      decode(repeat('01', 128), 'hex'), decode(repeat('01', 128), 'hex'),
      decode(repeat('02', 32), 'hex'), decode(repeat('02', 32), 'hex'),
      '{"indexedValuationBlockNumber":"22000000","currentTick":0,"activeLiquidity":"1000"}'::jsonb,
      decode(repeat('ff', 32), 'hex'),
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000002',
      'drpc-mainnet-11111111111111111111111111111111',
      'quicknode-mainnet-21212121212121212121212121212121',
      decode(repeat('13', 32), 'hex'), decode(repeat('23', 32), 'hex'),
      decode(repeat('14', 32), 'hex'), decode(repeat('24', 32), 'hex'),
      22000005, 22000005,
      4::smallint, 4::smallint, 7::smallint, 7::smallint,
      11::smallint, 11::smallint, 5::smallint,
      decode(repeat('b4', 32), 'hex'), transaction_timestamp()
    )
  $sql$,
  '23505',
  'optimistic market-state id or physical identity mismatch',
  'same physical identity with a changed market commitment is rejected'
);

select throws_ok(
  $sql$
    select programmable_private.append_optimistic_market_state_v1(
      '62000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000000',
      decode(repeat('fa', 32), 'hex'), decode(repeat('11', 20), 'hex'),
      decode('7ffe42c4a5deea5b0fec41c94c136cf115597227', 'hex'),
      decode('d7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878', 'hex'),
      1, 0, 1000, 0, 3000,
      decode(repeat('01', 128), 'hex'), decode(repeat('01', 128), 'hex'),
      decode(repeat('02', 32), 'hex'), decode(repeat('02', 32), 'hex'),
      '{"indexedValuationBlockNumber":"22000000","currentTick":0,"activeLiquidity":"1000"}'::jsonb,
      decode(repeat('a1', 32), 'hex'),
      '52000000-0000-4000-8000-000000000002',
      '51000000-0000-4000-8000-000000000001',
      'quicknode-mainnet-21212121212121212121212121212121',
      'drpc-mainnet-11111111111111111111111111111111',
      decode(repeat('23', 32), 'hex'), decode(repeat('13', 32), 'hex'),
      decode(repeat('24', 32), 'hex'), decode(repeat('14', 32), 'hex'),
      22000005, 22000005,
      4::smallint, 4::smallint, 7::smallint, 7::smallint,
      11::smallint, 11::smallint, 5::smallint,
      decode(repeat('a2', 32), 'hex'), transaction_timestamp()
    )
  $sql$,
  '22023',
  'market RPC evidence violates block deployment binding',
  'provider order cannot diverge from the block evidence deployment binding'
);

select throws_ok(
  $sql$
    select programmable_private.append_optimistic_market_state_v1(
      '62000000-0000-4000-8000-000000000002',
      '31000000-0000-4000-8000-000000000000',
      decode(repeat('fb', 32), 'hex'), decode(repeat('11', 20), 'hex'),
      decode('7ffe42c4a5deea5b0fec41c94c136cf115597227', 'hex'),
      decode('d7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878', 'hex'),
      1, 0, 1000, 0, 3000,
      decode(repeat('01', 128), 'hex'), decode(repeat('01', 128), 'hex'),
      decode(repeat('02', 32), 'hex'), decode(repeat('02', 32), 'hex'),
      '{"indexedValuationBlockNumber":"22000000","currentTick":0,"activeLiquidity":"1000","extra":"no"}'::jsonb,
      decode(repeat('a3', 32), 'hex'),
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000002',
      'drpc-mainnet-11111111111111111111111111111111',
      'quicknode-mainnet-21212121212121212121212121212121',
      decode(repeat('13', 32), 'hex'), decode(repeat('23', 32), 'hex'),
      decode(repeat('14', 32), 'hex'), decode(repeat('24', 32), 'hex'),
      22000005, 22000005,
      4::smallint, 4::smallint, 7::smallint, 7::smallint,
      11::smallint, 11::smallint, 5::smallint,
      decode(repeat('a4', 32), 'hex'), transaction_timestamp()
    )
  $sql$,
  '22023',
  'invalid optimistic market-state envelope',
  'market JSON extras are rejected before persistence'
);

select throws_ok(
  $sql$
    select programmable_private.append_optimistic_market_state_v1(
      '62000000-0000-4000-8000-000000000003',
      '31000000-0000-4000-8000-000000000000',
      decode(repeat('fc', 32), 'hex'), decode(repeat('11', 20), 'hex'),
      decode('7ffe42c4a5deea5b0fec41c94c136cf115597227', 'hex'),
      decode('d7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878', 'hex'),
      1, 0, 1000, 4100096, 3000,
      decode(repeat('01', 128), 'hex'), decode(repeat('01', 128), 'hex'),
      decode(repeat('02', 32), 'hex'), decode(repeat('02', 32), 'hex'),
      '{"indexedValuationBlockNumber":"22000000","currentTick":0,"activeLiquidity":"1000"}'::jsonb,
      decode(repeat('a5', 32), 'hex'),
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000002',
      'drpc-mainnet-11111111111111111111111111111111',
      'quicknode-mainnet-21212121212121212121212121212121',
      decode(repeat('13', 32), 'hex'), decode(repeat('23', 32), 'hex'),
      decode(repeat('14', 32), 'hex'), decode(repeat('24', 32), 'hex'),
      22000005, 22000005,
      4::smallint, 4::smallint, 7::smallint, 7::smallint,
      11::smallint, 11::smallint, 5::smallint,
      decode(repeat('a6', 32), 'hex'), transaction_timestamp()
    )
  $sql$,
  '22023',
  'invalid optimistic market-state envelope',
  'a packed v4 protocol fee with a directional component above 1000 is rejected'
);

reset role;
set local role programmable_migrator;

select throws_ok(
  $sql$
    update programmable_private.optimistic_market_state_rows_v1
    set confirmations = confirmations
    where optimistic_market_state_id =
      '32000000-0000-4000-8000-000000000000'
  $sql$,
  '55000',
  'programmable_private.optimistic_market_state_rows_v1 is immutable; append a new fact/history row instead',
  'persisted optimistic market evidence cannot be updated'
);

reset role;
set local role programmable_api_reader;

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.list_optimistic_canonical_market_states_v1(
      1, null, null, null, 100
    )
  ),
  12::bigint,
  'the current canonical reader returns at most the last twelve block heights'
);

select is(
  (
    select pg_catalog.min(state_row.block_number)
    from programmable_private.list_optimistic_canonical_market_states_v1(
      1, null, null, null, 100
    ) as state_row
  ),
  22000002::bigint,
  'the live reader starts exactly at head minus eleven'
);

select is(
  (
    select pg_catalog.max(state_row.block_number)
    from programmable_private.list_optimistic_canonical_market_states_v1(
      1, null, null, null, 100
    ) as state_row
  ),
  22000013::bigint,
  'the live reader includes the current optimistic head'
);

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.list_optimistic_canonical_market_states_v1(
      1,
      22000012,
      pg_catalog.decode(
        pg_catalog.lpad(pg_catalog.to_hex(1012), 64, '0'), 'hex'
      ),
      '32000000-0000-4000-8000-000000000012',
      100
    )
  ),
  1::bigint,
  'the market-state reader keyset cursor advances deterministically'
);

select throws_ok(
  $sql$
    select *
    from programmable_private.list_optimistic_canonical_market_states_v1(
      1, 22000000, decode(lpad(to_hex(1000), 64, '0'), 'hex'),
      '32000000-0000-4000-8000-000000000000', 100
    )
  $sql$,
  '40001',
  'optimistic market-state cursor is outside the live window',
  'a cursor below the current twelve-height window fails closed'
);

reset role;
set local role programmable_projector;

select programmable_private.append_optimistic_block_observation_v1(
  '41000000-0000-4000-8000-000000000012', 1, 22000012,
  pg_catalog.decode(pg_catalog.repeat('ee', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('ee', 32), 'hex'),
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(12), 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(12), 64, '0'), 'hex'),
  pg_catalog.transaction_timestamp() - interval '30 seconds',
  pg_catalog.transaction_timestamp() - interval '30 seconds',
  '51000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000002',
  22000013, 22000014,
  pg_catalog.decode(pg_catalog.repeat('e1', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select programmable_private.append_optimistic_market_state_v1(
  '42000000-0000-4000-8000-000000000012',
  '41000000-0000-4000-8000-000000000012',
  pg_catalog.decode(pg_catalog.repeat('fe', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('11', 20), 'hex'),
  pg_catalog.decode('7ffe42c4a5deea5b0fec41c94c136cf115597227', 'hex'),
  pg_catalog.decode('d7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878', 'hex'),
  1, 0, 1000, 4097000, 3000,
  pg_catalog.decode(pg_catalog.repeat('01', 128), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('01', 128), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  '{"indexedValuationBlockNumber":"22000012","currentTick":0,"activeLiquidity":"1000"}'::jsonb,
  pg_catalog.decode(pg_catalog.repeat('e2', 32), 'hex'),
  '51000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000002',
  'drpc-mainnet-11111111111111111111111111111111',
  'quicknode-mainnet-21212121212121212121212121212121',
  pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('14', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('24', 32), 'hex'),
  22000017, 22000017,
  4::smallint, 4::smallint, 7::smallint, 7::smallint,
  11::smallint, 11::smallint, 5::smallint,
  pg_catalog.decode(pg_catalog.repeat('e3', 32), 'hex'),
  pg_catalog.transaction_timestamp()
);

select is(
  programmable_private.promote_optimistic_block_canonical_v1(
    '41000000-0000-4000-8000-000000000012',
    '31000000-0000-4000-8000-000000000012',
    '43000000-0000-4000-8000-000000000012',
    '44000000-0000-4000-8000-000000000012',
    pg_catalog.decode(pg_catalog.repeat('e4', 32), 'hex'),
    pg_catalog.transaction_timestamp()
  ),
  '41000000-0000-4000-8000-000000000012'::uuid,
  'an ancestor replacement resets the live optimistic tip'
);

reset role;
set local role programmable_api_reader;

select ok(
  exists (
    select 1
    from programmable_private.list_optimistic_canonical_market_states_v1(
      1, null, null, null, 100
    ) as state_row
    where state_row.optimistic_market_state_id =
      '42000000-0000-4000-8000-000000000012'
      and state_row.protocol_fee_pips = 4097000
      and state_row.market_provider_a_head = 22000017
      and state_row.market_provider_b_head = 22000017
      and state_row.provider_a_identity =
        'drpc-mainnet-11111111111111111111111111111111'
      and state_row.provider_b_identity =
        'quicknode-mainnet-21212121212121212121212121212121'
  ),
  'the reader exposes the replacement evidence and separate market provider heads'
);

select ok(
  not exists (
    select 1
    from programmable_private.list_optimistic_canonical_market_states_v1(
      1, null, null, null, 100
    ) as state_row
    where state_row.optimistic_market_state_id in (
      '32000000-0000-4000-8000-000000000012',
      '32000000-0000-4000-8000-000000000013'
    )
  ),
  'the recursive current-chain join hides both the orphan and stale descendant'
);

select is(
  (
    select pg_catalog.max(state_row.block_number)
    from programmable_private.list_optimistic_canonical_market_states_v1(
      1, null, null, null, 100
    ) as state_row
  ),
  22000012::bigint,
  'the bounded market reader cannot leak a stale height above the reset head'
);

select * from finish();
rollback;
