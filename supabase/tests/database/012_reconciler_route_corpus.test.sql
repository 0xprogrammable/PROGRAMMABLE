begin;

select plan(11);

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
  'the reader reuses the exact checkpoint, manifest and six-route contract'
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
  ) = 0,
  'the corpus never self-compares through public or parity-gated views'
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
      1, 'stock-paired-v3', 'stock-paired', 'core',
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
