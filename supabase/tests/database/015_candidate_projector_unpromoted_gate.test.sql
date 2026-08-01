begin;

select plan(14);

select ok(
  to_regprocedure(
    'programmable_private.verify_candidate_database_unpromoted_v1(uuid,bytea,bytea,bytea,timestamp with time zone)'
  ) is not null,
  'candidate unpromoted verifier exists at the frozen signature'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'programmable_private.verify_candidate_database_unpromoted_v1(uuid,bytea,bytea,bytea,timestamp with time zone)'::regprocedure
  ),
  'candidate verifier is stable, SECURITY DEFINER, and has an empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.verify_candidate_database_unpromoted_v1(uuid,bytea,bytea,bytea,timestamp with time zone)',
    'EXECUTE'
  ),
  'only the projector capability receives the verifier'
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
      'programmable_private.verify_candidate_database_unpromoted_v1(uuid,bytea,bytea,bytea,timestamp with time zone)',
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
  'projector has no direct candidate control table privilege'
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
  'reviewed candidate provider is registered'
);

select throws_ok(
  $sql$
    select programmable_private.verify_candidate_database_unpromoted_v1(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode(
        'a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259',
        'hex'
      ),
      decode(
        '5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1',
        'hex'
      ),
      decode(
        '8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9',
        'hex'
      ),
      '2026-07-31T00:00:00Z'
    )
  $sql$,
  '55000',
  'candidate database is not in the exact unpromoted state',
  'missing candidate control state fails closed'
);

reset role;

select is(
  (select pg_catalog.count(*) from programmable_private.candidate_database_control),
  0::bigint,
  'missing-state verification never inserts candidate control state'
);

set local role programmable_projector;

select is(
  programmable_private.initialize_candidate_database(
    'd08b62a6-74fb-5e0a-a698-dc6877150db4',
    pg_catalog.decode(
      'a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259',
      'hex'
    ),
    pg_catalog.decode(
      '5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1',
      'hex'
    ),
    pg_catalog.decode(
      '8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9',
      'hex'
    ),
    '2026-07-31T00:00:00Z'
  ),
  true,
  'reviewed candidate control state initializes exactly once'
);

select is(
  programmable_private.verify_candidate_database_unpromoted_v1(
    'd08b62a6-74fb-5e0a-a698-dc6877150db4',
    pg_catalog.decode(
      'a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259',
      'hex'
    ),
    pg_catalog.decode(
      '5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1',
      'hex'
    ),
    pg_catalog.decode(
      '8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9',
      'hex'
    ),
    '2026-07-31T00:00:00Z'
  ),
  true,
  'exact isolated unpromoted candidate state passes'
);

savepoint mixed_envio_provider;

select programmable_private.register_provider_deployment(
  'd08b62a6-74fb-5e0a-a698-dc6877150db5',
  'envio_deployment', 'envio:production-legacy',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
  pg_catalog.clock_timestamp()
);

select throws_ok(
  $sql$
    select programmable_private.verify_candidate_database_unpromoted_v1(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode(
        'a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259',
        'hex'
      ),
      decode(
        '5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1',
        'hex'
      ),
      decode(
        '8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9',
        'hex'
      ),
      '2026-07-31T00:00:00Z'
    )
  $sql$,
  '55000',
  'candidate database is not in the exact unpromoted state',
  'a second Envio deployment makes the candidate database mixed and invalid'
);

rollback to savepoint mixed_envio_provider;
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
  'promotion attestation is recorded for the exact candidate'
);

reset role;
set local role programmable_projector;

select throws_ok(
  $sql$
    select programmable_private.verify_candidate_database_unpromoted_v1(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode(
        'a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259',
        'hex'
      ),
      decode(
        '5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1',
        'hex'
      ),
      decode(
        '8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9',
        'hex'
      ),
      '2026-07-31T00:00:00Z'
    )
  $sql$,
  '55000',
  'candidate database is not in the exact unpromoted state',
  'an exactly promoted candidate is rejected by backfill mode'
);

reset role;

select ok(
  exists (
    select 1
    from programmable_private.candidate_database_control
    where singleton and promoted_at = '2026-07-31T00:05:00Z'
      and promotion_attestation_commitment is not null
  ),
  'promoted state remains explicit and complete after rejection'
);

select * from finish();
rollback;
