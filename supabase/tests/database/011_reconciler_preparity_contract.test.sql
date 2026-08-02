begin;

select plan(21);

select ok(
  to_regprocedure(
    'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'
  ) is not null
  and to_regprocedure(
    'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'
  ) is not null,
  'the narrow read and atomic append signatures exist'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = procedure.proowner
    where namespace.nspname = 'programmable_private'
      and procedure.proname in (
        'get_reconciler_preparity_contract_v1',
        'commit_reconciler_preparity_result_v1'
      )
      and owner_role.rolname <> 'programmable_migrator'
  ),
  'both contracts are owned by the migration role'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname in (
        'get_reconciler_preparity_contract_v1',
        'commit_reconciler_preparity_result_v1'
      )
      and (
        not procedure.prosecdef
        or not ('search_path=""' = any(procedure.proconfig))
      )
  ),
  'both contracts are SECURITY DEFINER with an empty search path'
);

select ok(
  pg_catalog.obj_description(
    'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure,
    'pg_proc'
  ) like '%does not require or manufacture prior parity%'
  and pg_catalog.obj_description(
    'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure,
    'pg_proc'
  ) like '%Atomically appends%terminal outcome%'
  ,
  'catalog comments state the bootstrap and atomicity boundaries'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure,
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'the reconciler capability can execute both contracts'
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
    cross join pg_catalog.unnest(array[
      'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure,
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ]) as protected(function_oid)
    where pg_catalog.has_function_privilege(
      denied.role_name, protected.function_oid, 'EXECUTE'
    )
  ),
  'browser, service, projector, reader, profile and maintenance roles are denied'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'programmable_private.projector_checkpoints'::regclass,
      'programmable_private.projection_fold_manifests'::regclass,
      'programmable_private.projection_entity_current'::regclass,
      'programmable_private.route_eligibility_current'::regclass,
      'programmable_private.reconciliation_records'::regclass,
      'programmable_private.parity_records'::regclass,
      'programmable_private.route_checkpoint_parity_bindings'::regclass
    ]) as protected(table_oid)
    where pg_catalog.has_table_privilege(
      'programmable_reconciler', protected.table_oid,
      'SELECT,INSERT,UPDATE,DELETE'
    )
  ),
  'the new contract grants no general table access'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'assert_caller(''programmable_reconciler'')'
  ) > 0,
  'the read contract verifies the active reconciler capability'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'projector_checkpoint_current'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'release_epoch_current'
  ) > 0,
  'the read contract requires the exact current checkpoint and epoch'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'route_eligibility_current_exact_v1'
  ) > 0,
  'route coverage is selected through the exact checkpoint boundary'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'parity_records'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'route_snapshot_readiness_v1'
  ) = 0,
  'pre-parity reads have no dependency on an earlier parity record'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'p_maximum_entity_count > 10000'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_reconciler_preparity_contract_v1(bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,integer)'::regprocedure
    ),
    'reconciler pre-parity entity limit exceeded'
  ) > 0,
  'the only pre-parity data window is explicitly bounded'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'open_run('
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'append_reconciliation_record('
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'append_parity_record('
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'bind_route_checkpoint_parity_v1('
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'append_run_outcome('
  ) > 0,
  'the writer contains the complete append and binding sequence'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    )),
    'for share of current_checkpoint, checkpoint'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'reconciler epoch changed before commit'
  ) > 0,
  'the writer fences concurrent epoch and checkpoint changes'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'p_route_keys is distinct from expected_route_keys'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'for route_index in 1..expected_route_count'
  ) > 0,
  'route coverage and order are closed over the exact release route matrix'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'when mismatch_count = 0 then ''succeeded'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.commit_reconciler_preparity_result_v1(uuid,uuid,uuid[],uuid[],uuid,bigint,text,text,text,uuid,bigint,uuid,numeric,bytea,text,text[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'else ''failed'''
  ) > 0,
  'a mismatch can never produce a successful terminal outcome'
);

set local role programmable_reconciler;

select throws_ok(
  $sql$
    select *
    from programmable_private.get_reconciler_preparity_contract_v1(
      1, 'classic-v3', 'classic', 'core',
      '11000000-0000-0000-0000-000000000001', 1,
      '11000000-0000-0000-0000-000000000002', 1.5,
      decode(repeat('11', 32), 'hex'), 100
    )
  $sql$,
  '22023',
  'fractional checkpoint input is rejected before any private read'
);

select throws_ok(
  $sql$
    select *
    from programmable_private.get_reconciler_preparity_contract_v1(
      1, 'classic-v3', 'classic', 'core',
      '11000000-0000-0000-0000-000000000001', 1,
      '11000000-0000-0000-0000-000000000002', 100,
      null::bytea, 100
    )
  $sql$,
  '22023',
  'null checkpoint evidence is rejected before any private read'
);

select throws_ok(
  $sql$
    select programmable_private.commit_reconciler_preparity_result_v1(
      '12000000-0000-0000-0000-000000000001',
      '12000000-0000-0000-0000-000000000002',
      array[]::uuid[], array[]::uuid[],
      '12000000-0000-0000-0000-000000000003',
      1, 'classic-v3', 'classic', 'core',
      '12000000-0000-0000-0000-000000000004', 1,
      '12000000-0000-0000-0000-000000000005', 100,
      decode(repeat('12', 32), 'hex'), 'reconciler-v1',
      array['explore-list']::text[],
      array[]::bytea[], array[]::bytea[], array[]::bytea[], array[]::bytea[],
      decode(repeat('13', 32), 'hex'),
      decode(repeat('14', 32), 'hex'),
      decode(repeat('15', 32), 'hex'),
      '2026-08-01T00:00:00Z', '2026-08-01T00:00:01Z',
      '2026-08-01T00:00:02Z'
    )
  $sql$,
  '22023',
  'partial route coverage is rejected before a run is opened'
);

reset role;
set local role programmable_api_reader;

select throws_ok(
  $sql$
    select *
    from programmable_private.get_reconciler_preparity_contract_v1(
      1, 'classic-v3', 'classic', 'core',
      '13000000-0000-0000-0000-000000000001', 1,
      '13000000-0000-0000-0000-000000000002', 100,
      decode(repeat('13', 32), 'hex'), 100
    )
  $sql$,
  '42501',
  'the API reader cannot execute the pre-parity reader'
);

select throws_ok(
  $sql$
    select * from programmable_private.projection_entity_current
  $sql$,
  '42501',
  'the API reader remains unable to read projection state directly'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.run_headers
    where run_id = '12000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'a rejected atomic call leaves no partial run header'
);

select * from finish();
rollback;
