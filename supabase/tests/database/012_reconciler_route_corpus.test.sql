begin;

select plan(22);

select ok(
  to_regprocedure(
    'programmable_private.assemble_reconciler_routes_v1(jsonb,jsonb,jsonb,jsonb,jsonb)'
  ) is not null,
  'the pure applicable-route assembler exists'
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
select * from finish();
rollback;
