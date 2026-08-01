begin;

select plan(31);

select ok(
  to_regprocedure(
    'programmable_private.build_classic_v3_reconciler_reward_v1(bytea,bytea,bytea,text,text,bytea,integer,integer,integer,bytea,bytea,bigint,numeric,numeric,numeric,jsonb,jsonb,jsonb)'
  ) is not null,
  'the exact Classic V3 reward DTO builder exists'
);

select ok(
  (
    select owner_role.rolname = 'programmable_migrator'
      and not procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = procedure.proowner
    where namespace.nspname = 'programmable_private'
      and procedure.proname = 'build_classic_v3_reconciler_reward_v1'
  ),
  'the reward DTO builder is migrator-owned SECURITY INVOKER with an empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.build_classic_v3_reconciler_reward_v1(bytea,bytea,bytea,text,text,bytea,integer,integer,integer,bytea,bytea,bigint,numeric,numeric,numeric,jsonb,jsonb,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'the reconciler capability can execute the reward DTO builder'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_projector', 'programmable_api_reader',
      'programmable_profile_binder', 'programmable_profile_recovery',
      'programmable_profile_writer', 'programmable_maintenance'
    ]) as denied(role_name)
    where pg_catalog.has_function_privilege(
      denied.role_name,
      'programmable_private.build_classic_v3_reconciler_reward_v1(bytea,bytea,bytea,text,text,bytea,integer,integer,integer,bytea,bytea,bigint,numeric,numeric,numeric,jsonb,jsonb,jsonb)'::regprocedure,
      'EXECUTE'
    )
  ),
  'unrelated capabilities cannot execute the reward DTO builder'
);

select ok(
  to_regprocedure(
    'programmable_private.assemble_reconciler_routes_v1(jsonb,jsonb,jsonb,jsonb,jsonb)'
  ) is not null,
  'the pure applicable-route assembler exists'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'launch_count > 256'
  ) = 0,
  'the indexed corpus has no legacy 256-launch ceiling'
);

select ok(
  (
    select owner_role.rolname = 'programmable_migrator'
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = procedure.proowner
    where namespace.nspname = 'programmable_private'
      and procedure.proname = 'assemble_reconciler_routes_v1'
  ),
  'the migration role owns the assembler'
);

select ok(
  (
    select not procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname = 'assemble_reconciler_routes_v1'
  ),
  'the pure assembler is SECURITY INVOKER with an empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.assemble_reconciler_routes_v1(jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'the reconciler capability can execute the assembler'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_projector', 'programmable_api_reader',
      'programmable_profile_binder', 'programmable_profile_recovery',
      'programmable_profile_writer', 'programmable_maintenance'
    ]) as denied(role_name)
    where pg_catalog.has_function_privilege(
      denied.role_name,
      'programmable_private.assemble_reconciler_routes_v1(jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
      'EXECUTE'
    )
  ),
  'unrelated capabilities cannot execute the assembler'
);

set local role programmable_reconciler;

select is(
  programmable_private.build_classic_v3_reconciler_reward_v1(
    decode(repeat('11', 20), 'hex'),
    decode(repeat('22', 32), 'hex'),
    decode(repeat('33', 20), 'hex'),
    'Reward Fixture',
    'RWD',
    decode(repeat('44', 32), 'hex'),
    100,
    200,
    10,
    decode(repeat('55', 32), 'hex'),
    decode(repeat('66', 32), 'hex'),
    2,
    90,
    10,
    20,
    '[{"allocationIndex":0,"payoutAddress":"0x7777777777777777777777777777777777777777","shareBps":10000,"claimableWei":"stale","claimedWei":"stale"}]'::jsonb,
    '[{"account":"0x8888888888888888888888888888888888888888","claimableWei":"80","claimedWei":"10","legacy":true}]'::jsonb,
    '[{"kind":"checkpoint"}]'::jsonb
  ),
  pg_catalog.jsonb_build_object(
    'releaseVersion', 'classic-v3',
    'modelId', 'classic',
    'vaultAddress', '0x' || repeat('11', 20),
    'poolId', '0x' || repeat('22', 32),
    'tokenAddress', '0x' || repeat('33', 20),
    'tokenName', 'Reward Fixture',
    'tokenSymbol', 'RWD',
    'launchTransactionHash', '0x' || repeat('44', 32),
    'buySwapFeeBps', 100,
    'sellSwapFeeBps', 200,
    'launcherFeeBps', 10,
    'configurationHash', '0x' || repeat('55', 32),
    'activeConfigurationHash', '0x' || repeat('66', 32),
    'configurationEpoch', '2',
    'totalCreatorFeesReceivedWei', '90',
    'totalCreatorFeesClaimedWei', '10',
    'pendingCreatorFeesWei', '20',
    'allocations', '[{"allocationIndex":0,"payoutAddress":"0x7777777777777777777777777777777777777777","shareBps":10000}]'::jsonb,
    'entitlements', '[{"account":"0x8888888888888888888888888888888888888888","claimableWei":"80","claimedWei":"10"}]'::jsonb,
    'events', '[{"kind":"checkpoint"}]'::jsonb
  ),
  'the SQL reward DTO exactly matches the runtime schema and strips stale nested fields'
);

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.assemble_reconciler_routes_v1(
      '[{"releaseVersion":"classic-v3","modelId":"classic","id":1}]'::jsonb,
      '[{"releaseVersion":"classic-v3","modelId":"classic","id":1}]'::jsonb,
      '[{"tokens":[{"id":1}]}]'::jsonb,
      '[{"id":1}]'::jsonb,
      '[{"id":1}]'::jsonb
    ) as route
    where route.compared_count = 1
      and route.dto ->> 'contractVersion' =
        'programmable-route-corpus-v1'
  ),
  6::bigint,
  'the assembler returns all six versioned routes with one shared count'
);

select is(
  (
    select pg_catalog.array_agg(route.route_key order by route.route_key)
    from programmable_private.assemble_reconciler_routes_v1(
      '[{"releaseVersion":"classic-v2","modelId":"classic","id":1}]'::jsonb,
      '[{"releaseVersion":"classic-v2","modelId":"classic","id":1}]'::jsonb,
      '[{"tokens":[{"id":1}]}]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    ) as route
  ),
  array[
    'creator-profile', 'explore-chart', 'explore-list', 'explore-token'
  ]::text[],
  'Classic V2 exposes only its four applicable routes'
);

select is(
  (
    select pg_catalog.array_agg(route.route_key order by route.route_key)
    from programmable_private.assemble_reconciler_routes_v1(
      '[{"releaseVersion":"stock-paired-v3","modelId":"stock-paired","id":1}]'::jsonb,
      '[{"releaseVersion":"stock-paired-v3","modelId":"stock-paired","id":1}]'::jsonb,
      '[{"tokens":[{"id":1}]}]'::jsonb,
      '[]'::jsonb,
      '[{"id":1}]'::jsonb
    ) as route
  ),
  array[
    'creator-profile', 'explore-chart', 'explore-list', 'explore-token',
    'launch-lookup'
  ]::text[],
  'Stock releases expose five applicable routes without Classic rewards'
);

select throws_ok(
  $sql$
    select *
    from programmable_private.assemble_reconciler_routes_v1(
      '[{"id":1}]'::jsonb,
      '[]'::jsonb,
      '[{"tokens":[{"id":1}]}]'::jsonb,
      '[{"id":1}]'::jsonb,
      '[{"id":1}]'::jsonb
    )
  $sql$,
  '22023',
  'the assembler rejects cross-route cardinality mismatches'
);

reset role;

select ok(
  to_regprocedure(
    'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'
  ) is not null,
  'the exact route corpus reader exists'
);

select ok(
  (
    select owner_role.rolname = 'programmable_migrator'
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = procedure.proowner
    where namespace.nspname = 'programmable_private'
      and procedure.proname = 'get_reconciler_route_corpus_v1'
  ),
  'the migration role owns the reader'
);

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname = 'get_reconciler_route_corpus_v1'
  ),
  'the reader is SECURITY DEFINER with an empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure,
    'EXECUTE'
  ),
  'the reconciler capability can execute the reader'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_projector', 'programmable_api_reader',
      'programmable_profile_binder', 'programmable_profile_recovery',
      'programmable_profile_writer', 'programmable_maintenance'
    ]) as denied(role_name)
    where pg_catalog.has_function_privilege(
      denied.role_name,
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure,
      'EXECUTE'
    )
  ),
  'browser, service, projector, reader, profile and maintenance roles are denied'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'assert_caller(''programmable_reconciler'')'
  ) > 0,
  'the reader verifies the active capability role'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'get_reconciler_preparity_contract_v1'
  ) > 0,
    'the reader reuses the exact checkpoint, manifest and applicable-route contract'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    )),
    'public_explore'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    )),
    'route_snapshot_readiness'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    )),
    'parity_records'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    )),
    'route_checkpoint_parity_bindings'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    )),
    'launch_by_token_v1'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    )),
    'launch_by_token_v2'
  ) = 0,
  'the corpus never self-compares through public, parity or route-gated launch views'
);

select ok(
  (
    select
      pg_catalog.strpos(definition, 'projection_entity_current as current_launch') > 0
      and pg_catalog.strpos(definition, 'launch_projections as launch') > 0
      and pg_catalog.strpos(definition, 'run_headers as run') > 0
      and pg_catalog.strpos(definition, 'projection_publications as publication') > 0
      and pg_catalog.strpos(definition, 'release_epoch_current as current_epoch') > 0
      and pg_catalog.strpos(definition, 'as launch_canonical') > 0
      and pg_catalog.strpos(definition, 'as pool_canonical') > 0
      and pg_catalog.strpos(definition, 'as fee_canonical') > 0
      and pg_catalog.strpos(definition, 'as liquidity_canonical') > 0
      and pg_catalog.strpos(definition, 'as market_canonical') > 0
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
      )) as definition
    ) as corpus
  ),
  'launch DTOs bind direct current projections to run, publication, epoch and canonical source provenance'
);

select ok(
  (
    select
      pg_catalog.strpos(
        definition,
        'build_classic_v3_reconciler_reward_v1'
      ) > 0
      and pg_catalog.strpos(
        definition,
        'current_account_reward_balances_v1'
      ) > 0
      and pg_catalog.strpos(
        definition,
        'chain_event_materialized_occurrences_v1'
      ) > 0
      and pg_catalog.strpos(
        definition,
        'chain_event_current_canonical'
      ) > 0
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
      )) as definition
    ) as corpus
  ),
  'Classic V3 rewards use the exact DTO builder, current balances and canonical lifecycle events'
);

select ok(
  (
    select
      pg_catalog.strpos(definition, 'contract_row.current_entities') > 0
      and pg_catalog.strpos(definition, 'entity ->> ''entityKind'' = ''launch''') > 0
      and pg_catalog.strpos(
        definition,
        'launch_count <> projected_launch_count'
      ) > 0
    from (
      select pg_catalog.pg_get_functiondef(
        'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
      ) as definition
    ) as corpus
  ),
  'the exact pre-parity entity manifest closes launch coverage without a parity binding'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'launch_count > p_maximum_entity_count'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_route_corpus_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'vault_count <> launch_count'
  ) > 0,
  'launch and reward coverage are bounded and complete'
);

set local role programmable_reconciler;

select throws_ok(
  $sql$
    select * from programmable_private.get_reconciler_route_corpus_v1(
      1, 'deep-v3', 'deep', 'core',
      '12000000-0000-0000-0000-000000000001', 1,
      '12000000-0000-0000-0000-000000000002', 100,
      decode(repeat('11', 32), 'hex'), 100
    )
  $sql$,
  '0A000',
  'unsupported releases fail before any partial corpus is returned'
);

reset role;
set local role programmable_api_reader;

select throws_ok(
  $sql$
    select * from programmable_private.get_reconciler_route_corpus_v1(
      1, 'classic-v3', 'classic', 'core',
      '13000000-0000-0000-0000-000000000001', 1,
      '13000000-0000-0000-0000-000000000002', 100,
      decode(repeat('13', 32), 'hex'), 100
    )
  $sql$,
  '42501',
  'the API reader cannot execute the corpus capability'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.route_checkpoint_parity_bindings
  ) + (
    select pg_catalog.count(*)
    from programmable_private.parity_records
  ),
  0::bigint,
  'the bootstrap execution fixture has no prior route or parity binding'
);

-- Exercise the corpus body without manufacturing the otherwise extensive
-- checkpoint fixture.  The replacement is transaction-local and preserves the
-- production signature: it returns one exact empty contract, allowing the
-- reader to reach and plan every direct projection join before it fails closed
-- on the expected zero-launch cardinality guard.
create or replace function programmable_private.get_reconciler_preparity_contract_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_id uuid,
  p_pointer_generation bigint,
  p_checkpoint_id uuid,
  p_checkpoint_block_number numeric,
  p_checkpoint_block_hash bytea,
  p_maximum_entity_count integer default 10000
)
returns table (
  chain_id bigint,
  release_id text,
  model_id text,
  source_group text,
  projector_version text,
  epoch_id uuid,
  pointer_generation bigint,
  checkpoint_id uuid,
  checkpoint_generation bigint,
  reorg_generation bigint,
  checkpoint_block_number bigint,
  checkpoint_block_hash bytea,
  route_keys text[],
  route_contract jsonb,
  projection_contract jsonb,
  current_entities jsonb
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p_chain_id,
    p_release_id,
    p_model_id,
    p_source_group,
    'projector-v1'::text,
    p_epoch_id,
    p_pointer_generation,
    p_checkpoint_id,
    1::bigint,
    0::bigint,
    p_checkpoint_block_number::bigint,
    p_checkpoint_block_hash,
    array[
      'explore-list', 'explore-token', 'explore-chart', 'creator-profile'
    ]::text[],
    '{}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb
$function$;

set local role programmable_reconciler;

select throws_ok(
  $sql$
    select * from programmable_private.get_reconciler_route_corpus_v1(
      1, 'classic-v2', 'classic', 'core',
      '14000000-0000-0000-0000-000000000001', 1,
      '14000000-0000-0000-0000-000000000002', 100,
      decode(repeat('14', 32), 'hex'), 100
    )
  $sql$,
  '54000',
  'the direct corpus executes without prior parity and then fails closed on an empty launch manifest'
);

reset role;
select * from finish();
rollback;
