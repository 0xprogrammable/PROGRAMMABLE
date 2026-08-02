begin;

select plan(19);

select ok(
  to_regprocedure(
    'programmable_private.verify_candidate_database_promoted_v2(uuid,bytea,bytea,bytea,timestamp with time zone,text,text)'
  ) is not null,
  'product-bound candidate verifier exists at the frozen signature'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'programmable_private.verify_candidate_database_promoted_v2(uuid,bytea,bytea,bytea,timestamp with time zone,text,text)'::regprocedure
  ),
  'product-bound verifier is stable, SECURITY DEFINER, and has an empty search path'
);

select ok(
  (
    select candidate_constraint.convalidated
    from pg_catalog.pg_constraint as candidate_constraint
    where candidate_constraint.conname = 'candidate_database_control_product_binding'
      and candidate_constraint.conrelid =
        'programmable_private.candidate_database_control'::regclass
  ),
  'candidate product binding constraint is validated'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.verify_candidate_database_promoted_v2(uuid,bytea,bytea,bytea,timestamp with time zone,text,text)',
    'EXECUTE'
  ),
  'only the projector capability receives the product-bound verifier'
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
      'programmable_private.verify_candidate_database_promoted_v2(uuid,bytea,bytea,bytea,timestamp with time zone,text,text)',
      'EXECUTE'
    )
  ),
  'browser, runtime, reader, reconciler, profile, maintenance, and operator roles are denied the verifier'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_operator',
    'programmable_private.attest_candidate_database_promotion(uuid,bytea,bytea,bytea,bytea,text,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'operator receives only the product-bound promotion capability'
);

select ok(
  not pg_catalog.has_function_privilege(
    'programmable_operator',
    'programmable_private.attest_candidate_database_promotion(uuid,bytea,bytea,bytea,bytea,timestamp with time zone)',
    'EXECUTE'
  ),
  'legacy promotion signature is retired'
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

select is(
  programmable_private.initialize_candidate_database(
    'd08b62a6-74fb-5e0a-a698-dc6877150db4',
    pg_catalog.decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
    pg_catalog.decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
    pg_catalog.decode('e3218e30a2a95927427fe5e523a8f721fa0d7826dffaecb7140a126a56d17a44', 'hex'),
    '2026-07-31T00:00:00Z'
  ),
  true,
  'candidate control state initializes exactly once'
);

reset role;
set local role programmable_operator;

select throws_ok(
  $sql$
    select programmable_private.attest_candidate_database_promotion(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
      decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex'),
      repeat('0', 40), 'dpl_12345678901234567890',
      '2026-07-31T00:05:00Z'
    )
  $sql$,
  '23514',
  'candidate product-bound promotion evidence is incomplete',
  'zero product commit fails closed'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.candidate_database_control
    where singleton
      and promoted_at is null
      and product_commit is null
      and staged_deployment_id is null
  ),
  1::bigint,
  'failed promotion leaves the candidate fence unchanged'
);

set local role programmable_operator;

select is(
  programmable_private.attest_candidate_database_promotion(
    'd08b62a6-74fb-5e0a-a698-dc6877150db4',
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
    pg_catalog.repeat('a', 40),
    'dpl_12345678901234567890',
    '2026-07-31T00:05:00Z'
  ),
  true,
  'exact product-bound promotion is recorded'
);

select is(
  programmable_private.attest_candidate_database_promotion(
    'd08b62a6-74fb-5e0a-a698-dc6877150db4',
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
    pg_catalog.repeat('a', 40),
    'dpl_12345678901234567890',
    '2026-07-31T00:05:00Z'
  ),
  false,
  'exact product-bound promotion replay is idempotent'
);

select throws_ok(
  $sql$
    select programmable_private.attest_candidate_database_promotion(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
      decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex'),
      repeat('b', 40), 'dpl_12345678901234567890',
      '2026-07-31T00:05:00Z'
    )
  $sql$,
  '23505',
  'candidate product-bound promotion replay conflict',
  'conflicting product replay fails closed'
);

reset role;
set local role programmable_projector;

select is(
  programmable_private.verify_candidate_database_promoted_v2(
    'd08b62a6-74fb-5e0a-a698-dc6877150db4',
    pg_catalog.decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
    pg_catalog.decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
    pg_catalog.decode('e3218e30a2a95927427fe5e523a8f721fa0d7826dffaecb7140a126a56d17a44', 'hex'),
    '2026-07-31T00:00:00Z',
    pg_catalog.repeat('a', 40),
    'dpl_12345678901234567890'
  ),
  true,
  'the exact executing product passes the promoted database gate'
);

select throws_ok(
  $sql$
    select programmable_private.verify_candidate_database_promoted_v2(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
      decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
      decode('e3218e30a2a95927427fe5e523a8f721fa0d7826dffaecb7140a126a56d17a44', 'hex'),
      '2026-07-31T00:00:00Z', repeat('b', 40),
      'dpl_12345678901234567890'
    )
  $sql$,
  '55000',
  'candidate database is not bound to this promoted product',
  'a different Git commit fails closed'
);

select throws_ok(
  $sql$
    select programmable_private.verify_candidate_database_promoted_v2(
      'd08b62a6-74fb-5e0a-a698-dc6877150db4',
      decode('a4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259', 'hex'),
      decode('5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1', 'hex'),
      decode('e3218e30a2a95927427fe5e523a8f721fa0d7826dffaecb7140a126a56d17a44', 'hex'),
      '2026-07-31T00:00:00Z', repeat('a', 40),
      'dpl_09876543210987654321'
    )
  $sql$,
  '55000',
  'candidate database is not bound to this promoted product',
  'a different Vercel deployment fails closed'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from programmable_private.candidate_database_control
    where singleton
      and promoted_at = '2026-07-31T00:05:00Z'
      and product_commit = pg_catalog.repeat('a', 40)
      and staged_deployment_id = 'dpl_12345678901234567890'
      and pg_catalog.octet_length(promotion_baseline_commitment) = 32
      and pg_catalog.octet_length(promotion_parity_commitment) = 32
      and pg_catalog.octet_length(promotion_attestation_commitment) = 32
      and pg_catalog.octet_length(promotion_input_commitment) = 32
  ),
  1::bigint,
  'promoted state remains complete and bound after verifier failures'
);

select * from finish();
rollback;
