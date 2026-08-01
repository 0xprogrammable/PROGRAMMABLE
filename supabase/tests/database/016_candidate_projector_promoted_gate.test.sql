begin;

select plan(16);

select ok(
  to_regprocedure(
    'programmable_private.verify_candidate_database_promoted_v1(uuid,bytea,bytea,bytea,timestamp with time zone,bytea,bytea,bytea,bytea,timestamp with time zone)'
  ) is not null,
  'candidate promoted verifier exists at the frozen signature'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'programmable_private.verify_candidate_database_promoted_v1(uuid,bytea,bytea,bytea,timestamp with time zone,bytea,bytea,bytea,bytea,timestamp with time zone)'::regprocedure
  ),
  'candidate promoted verifier is stable, SECURITY DEFINER, and has an empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.verify_candidate_database_promoted_v1(uuid,bytea,bytea,bytea,timestamp with time zone,bytea,bytea,bytea,bytea,timestamp with time zone)',
    'EXECUTE'
  ),
  'only the projector capability receives the promoted verifier'
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
      'programmable_private.verify_candidate_database_promoted_v1(uuid,bytea,bytea,bytea,timestamp with time zone,bytea,bytea,bytea,bytea,timestamp with time zone)',
      'EXECUTE'
    )
  ),
  'browser, runtime, reader, reconciler, profile, maintenance, and operator roles are denied'
);

select ok(
  not pg_catalog.has_table_privilege(
    'programmable_projector',
    'programmable_private.candidate_database_control',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'projector still has no direct candidate control table privilege'
);

set local role programmable_projector;

select is(
  programmable_private.register_provider_deployment(
    'd08b62a6-74fb-5e0a-a698-dc6877150db4',
    'envio_deployment', 'envio:production-7f24e63',
    pg_catalog.decode(
      'a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259',
      'hex'
    ),
    pg_catalog.decode(
      '5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1',
      'hex'
    ),
    pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
    '2026-07-31T00:00:00Z'
  ),
  'd08b62a6-74fb-5e0a-a698-dc6877150db4'::uuid,
  'reviewed promoted candidate provider is registered'
);

select throws_ok(
  $sql$
    select programmable_private.verify_candidate_database_promoted_v1(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
      decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
      decode('8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9', 'hex'),
      '2026-07-31T00:00:00Z',
      decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
      decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex'),
      '2026-07-31T00:05:00Z'
    )
  $sql$,
  '55000',
  'candidate database is not in the exact promoted state',
  'missing candidate control state fails closed'
);

select is(
  programmable_private.initialize_candidate_database(
    'd08b62a6-74fb-5e0a-a698-dc6877150db4',
    pg_catalog.decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
    pg_catalog.decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
    pg_catalog.decode('8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9', 'hex'),
    '2026-07-31T00:00:00Z'
  ),
  true,
  'candidate control state initializes exactly once'
);

select throws_ok(
  $sql$
    select programmable_private.verify_candidate_database_promoted_v1(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
      decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
      decode('8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9', 'hex'),
      '2026-07-31T00:00:00Z',
      decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
      decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex'),
      '2026-07-31T00:05:00Z'
    )
  $sql$,
  '55000',
  'candidate database is not in the exact promoted state',
  'unpromoted candidate control state fails closed'
);

reset role;
set local role programmable_operator;

select is(
  programmable_private.attest_candidate_database_promotion(
    'd08b62a6-74fb-5e0a-a698-dc6877150db4',
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
    '2026-07-31T00:05:00Z'
  ),
  true,
  'exact promotion evidence is recorded'
);

reset role;
set local role programmable_projector;

select is(
  programmable_private.verify_candidate_database_promoted_v1(
    'd08b62a6-74fb-5e0a-a698-dc6877150db4',
    pg_catalog.decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
    pg_catalog.decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
    pg_catalog.decode('8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9', 'hex'),
    '2026-07-31T00:00:00Z',
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
    '2026-07-31T00:05:00Z'
  ),
  true,
  'exact promoted candidate state passes'
);

select throws_ok(
  $sql$
    select programmable_private.verify_candidate_database_promoted_v1(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
      decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
      decode('8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9', 'hex'),
      '2026-07-31T00:00:00Z',
      decode(repeat('41', 32), 'hex'), decode(repeat('32', 32), 'hex'),
      decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex'),
      '2026-07-31T00:05:00Z'
    )
  $sql$,
  '55000',
  'candidate database is not in the exact promoted state',
  'baseline commitment mismatch fails closed'
);

select throws_ok(
  $sql$
    select programmable_private.verify_candidate_database_promoted_v1(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
      decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
      decode('8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9', 'hex'),
      '2026-07-31T00:00:00Z',
      decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
      decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex'),
      '2026-07-31T00:05:01Z'
    )
  $sql$,
  '55000',
  'candidate database is not in the exact promoted state',
  'promotion timestamp mismatch fails closed'
);

select throws_ok(
  $sql$
    select programmable_private.verify_candidate_database_promoted_v1(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
      decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
      decode('8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9', 'hex'),
      '2026-07-31T00:00:00Z',
      decode(repeat('00', 32), 'hex'), decode(repeat('32', 32), 'hex'),
      decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex'),
      '2026-07-31T00:05:00Z'
    )
  $sql$,
  '55000',
  'candidate database is not in the exact promoted state',
  'zero promotion commitment fails closed'
);

savepoint mixed_envio_provider;

select programmable_private.register_provider_deployment(
  'd08b62a6-74fb-5e0a-a698-dc6877150db5',
  'envio_deployment', 'envio:production-legacy',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
  '2026-07-31T00:00:00Z'
);

select throws_ok(
  $sql$
    select programmable_private.verify_candidate_database_promoted_v1(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
      decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
      decode('8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9', 'hex'),
      '2026-07-31T00:00:00Z',
      decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
      decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex'),
      '2026-07-31T00:05:00Z'
    )
  $sql$,
  '55000',
  'candidate database is not in the exact promoted state',
  'a second Envio deployment makes promoted release state mixed and invalid'
);

rollback to savepoint mixed_envio_provider;

select is(
  programmable_private.verify_candidate_database_promoted_v1(
    'd08b62a6-74fb-5e0a-a698-dc6877150db4',
    pg_catalog.decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
    pg_catalog.decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
    pg_catalog.decode('8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9', 'hex'),
    '2026-07-31T00:00:00Z',
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
    '2026-07-31T00:05:00Z'
  ),
  true,
  'exact promoted state remains valid after mixed-state rollback'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.candidate_database_control
    where singleton
      and promoted_at = '2026-07-31T00:05:00Z'
      and promotion_baseline_commitment = pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex')
      and promotion_parity_commitment = pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex')
      and promotion_attestation_commitment = pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex')
      and promotion_input_commitment = pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex')
  ),
  1::bigint,
  'promoted state remains complete and immutable after verifier failures'
);

select * from finish();
rollback;
