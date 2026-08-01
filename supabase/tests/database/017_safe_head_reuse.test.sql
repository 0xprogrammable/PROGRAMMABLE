begin;

set local role programmable_projector;

select programmable_private.create_release_epoch(
  'a7000000-0000-4000-8000-000000000001',
  1, 'classic-v3', 'classic-v3', 'core', 1,
  decode(repeat('10', 32), 'hex'),
  decode(repeat('11', 32), 'hex'),
  decode(repeat('12', 32), 'hex'),
  '2026-08-01T12:00:00Z'
);
select programmable_private.activate_release_epoch(
  1, 'classic-v3', 'classic-v3', 'core',
  'a7000000-0000-4000-8000-000000000001',
  0, 1, decode(repeat('13', 32), 'hex'),
  '2026-08-01T12:00:01Z'
);
select programmable_private.register_rpc_provider_deployment(
  'b7000000-0000-4000-8000-000000000001',
  1, 'alchemy', 'rpc-provider-v1',
  decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('a3', 32), 'hex'),
  decode(repeat('21', 32), 'hex'), decode(repeat('22', 32), 'hex'),
  decode(repeat('23', 32), 'hex'), '2026-08-01T12:00:02Z'
);
select programmable_private.register_rpc_provider_deployment(
  'b7000000-0000-4000-8000-000000000002',
  1, 'quicknode', 'rpc-provider-v1',
  decode(repeat('b1', 32), 'hex'), decode(repeat('b2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('b3', 32), 'hex'),
  decode(repeat('24', 32), 'hex'), decode(repeat('25', 32), 'hex'),
  decode(repeat('26', 32), 'hex'), '2026-08-01T12:00:03Z'
);
select programmable_private.open_run(
  'c7000000-0000-4000-8000-000000000001',
  'ingestion', 1, 'classic-v3', 'classic-v3', 'core',
  'a7000000-0000-4000-8000-000000000001', 1,
  'projector-v1', decode(repeat('31', 32), 'hex'),
  '2026-08-01T12:01:00Z'
);
select programmable_private.open_run(
  'c7000000-0000-4000-8000-000000000002',
  'ingestion', 1, 'classic-v3', 'classic-v3', 'core',
  'a7000000-0000-4000-8000-000000000001', 1,
  'projector-v1', decode(repeat('32', 32), 'hex'),
  '2026-08-01T12:01:01Z'
);

reset role;

select plan(16);

select ok(
  to_regprocedure(
    'programmable_private.append_or_reuse_safe_head_observation_v1(uuid,uuid,uuid,uuid,bigint,bigint,numeric,numeric,bigint,numeric,bytea,bytea,smallint,bytea,bytea,timestamp with time zone)'
  ) is not null,
  'safe-head reuse function exists at the frozen signature'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 'v'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'programmable_private.append_or_reuse_safe_head_observation_v1(uuid,uuid,uuid,uuid,bigint,bigint,numeric,numeric,bigint,numeric,bytea,bytea,smallint,bytea,bytea,timestamp with time zone)'::regprocedure
  ),
  'safe-head reuse is volatile, SECURITY DEFINER, and has an empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.append_or_reuse_safe_head_observation_v1(uuid,uuid,uuid,uuid,bigint,bigint,numeric,numeric,bigint,numeric,bytea,bytea,smallint,bytea,bytea,timestamp with time zone)',
    'EXECUTE'
  ),
  'projector receives the safe-head reuse capability'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_projector_runtime', 'programmable_reconciler',
      'programmable_api_reader', 'programmable_profile_binder',
      'programmable_profile_recovery', 'programmable_profile_writer',
      'programmable_maintenance', 'programmable_operator'
    ]) as denied(role_name)
    where pg_catalog.has_function_privilege(
      denied.role_name,
      'programmable_private.append_or_reuse_safe_head_observation_v1(uuid,uuid,uuid,uuid,bigint,bigint,numeric,numeric,bigint,numeric,bytea,bytea,smallint,bytea,bytea,timestamp with time zone)',
      'EXECUTE'
    )
  ),
  'browser, runtime, reader, reconciler, profile, maintenance, and operator roles are denied safe-head reuse'
);

select ok(
  to_regprocedure(
    'programmable_private.append_or_reuse_dual_rpc_block_evidence_v1(uuid,uuid,uuid,numeric,bytea,bytea,smallint,bytea,bytea,timestamp with time zone)'
  ) is not null,
  'block-evidence reuse function exists at the frozen signature'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 'v'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'programmable_private.append_or_reuse_dual_rpc_block_evidence_v1(uuid,uuid,uuid,numeric,bytea,bytea,smallint,bytea,bytea,timestamp with time zone)'::regprocedure
  ),
  'block-evidence reuse is volatile, SECURITY DEFINER, and has an empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.append_or_reuse_dual_rpc_block_evidence_v1(uuid,uuid,uuid,numeric,bytea,bytea,smallint,bytea,bytea,timestamp with time zone)',
    'EXECUTE'
  ),
  'projector receives the block-evidence reuse capability'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_projector_runtime', 'programmable_reconciler',
      'programmable_api_reader', 'programmable_profile_binder',
      'programmable_profile_recovery', 'programmable_profile_writer',
      'programmable_maintenance', 'programmable_operator'
    ]) as denied(role_name)
    where pg_catalog.has_function_privilege(
      denied.role_name,
      'programmable_private.append_or_reuse_dual_rpc_block_evidence_v1(uuid,uuid,uuid,numeric,bytea,bytea,smallint,bytea,bytea,timestamp with time zone)',
      'EXECUTE'
    )
  ),
  'browser, runtime, reader, reconciler, profile, maintenance, and operator roles are denied block-evidence reuse'
);

set local role programmable_projector;

select is(
  programmable_private.append_or_reuse_safe_head_observation_v1(
    'd7000000-0000-4000-8000-000000000001',
    'c7000000-0000-4000-8000-000000000001',
    'b7000000-0000-4000-8000-000000000001',
    'b7000000-0000-4000-8000-000000000002',
    1, 1, 100, 100, 12, 88,
    decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
    2::smallint,
    decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000100', 'hex'),
    decode(repeat('41', 32), 'hex'), '2026-08-01T12:01:02Z'
  ),
  'd7000000-0000-4000-8000-000000000001'::uuid,
  'first safe-head observation is appended'
);

select is(
  programmable_private.append_or_reuse_safe_head_observation_v1(
    'd7000000-0000-4000-8000-000000000002',
    'c7000000-0000-4000-8000-000000000002',
    'b7000000-0000-4000-8000-000000000001',
    'b7000000-0000-4000-8000-000000000002',
    1, 1, 100, 100, 12, 88,
    decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
    2::smallint,
    decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000100', 'hex'),
    decode(repeat('41', 32), 'hex'), '2026-08-01T12:01:03Z'
  ),
  'd7000000-0000-4000-8000-000000000001'::uuid,
  'an exact replay returns the immutable existing observation'
);

reset role;
set local role programmable_migrator;

select is(
  (select pg_catalog.count(*) from programmable_private.safe_head_observations),
  1::bigint,
  'an exact replay does not duplicate safe-head evidence'
);

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.mutation_audits
    where action = 'safe_head.append'
  ),
  1::bigint,
  'an exact replay does not append a false mutation audit'
);

set local role programmable_projector;

select is(
  programmable_private.append_dual_rpc_block_evidence(
    'e7000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000001',
    'c7000000-0000-4000-8000-000000000002',
    88,
    decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
    2::smallint,
    decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000200', 'hex'),
    decode(repeat('51', 32), 'hex'), '2026-08-01T12:01:04Z'
  ),
  'e7000000-0000-4000-8000-000000000001'::uuid,
  'a later run can bind block evidence to the reused safe head'
);

select is(
  programmable_private.append_or_reuse_dual_rpc_block_evidence_v1(
    'e7000000-0000-4000-8000-000000000002',
    'd7000000-0000-4000-8000-000000000001',
    'c7000000-0000-4000-8000-000000000002',
    88,
    decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
    2::smallint,
    decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000200', 'hex'),
    decode(repeat('51', 32), 'hex'), '2026-08-01T12:01:04Z'
  ),
  'e7000000-0000-4000-8000-000000000001'::uuid,
  'an exact block-evidence replay returns the immutable existing row'
);

reset role;
set local role programmable_migrator;

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.mutation_audits
    where action = 'block_evidence.append'
  ),
  1::bigint,
  'an exact block-evidence replay does not append a false mutation audit'
);

set local role programmable_projector;

select throws_ok(
  $sql$
    select programmable_private.append_or_reuse_safe_head_observation_v1(
      'd7000000-0000-4000-8000-000000000003',
      'c7000000-0000-4000-8000-000000000002',
      'b7000000-0000-4000-8000-000000000001',
      'b7000000-0000-4000-8000-000000000002',
      1, 1, 101, 101, 12, 89,
      decode(repeat('89', 32), 'hex'), decode(repeat('89', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000100', 'hex'),
      decode(repeat('41', 32), 'hex'), '2026-08-01T12:01:05Z'
    )
  $sql$,
  '23505',
  'safe-head fingerprint replay conflicts with stored evidence',
  'a mismatched replay with the same fingerprint fails closed'
);

select * from finish();
rollback;
