begin;

select plan(6);

select ok(
  has_schema_privilege(
    'programmable_operator', 'programmable_private', 'USAGE'
  )
  and not has_schema_privilege(
    'programmable_operator', 'programmable_private', 'CREATE'
  ),
  'promotion operator can resolve the private schema but cannot create objects'
);

select ok(
  (
    select pg_catalog.count(*) = 1
      and pg_catalog.bool_and(
        function.proname = 'attest_candidate_database_promotion'
      )
    from pg_catalog.pg_proc as function
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = function.pronamespace
    where namespace.nspname = 'programmable_private'
      and has_function_privilege(
        'programmable_operator', function.oid, 'EXECUTE'
      )
  ),
  'promotion operator can execute exactly the promotion attestation function'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'programmable_private'
      and class.relkind in ('r', 'p', 'v')
      and (
        has_table_privilege(
          'programmable_operator', class.oid, 'SELECT'
        )
        or has_table_privilege(
          'programmable_operator', class.oid, 'INSERT'
        )
        or has_table_privilege(
          'programmable_operator', class.oid, 'UPDATE'
        )
        or has_table_privilege(
          'programmable_operator', class.oid, 'DELETE'
        )
      )
  ),
  'promotion operator has no direct private table or view privileges'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'programmable_private'
      and class.relkind = 'S'
      and (
        has_sequence_privilege(
          'programmable_operator', class.oid, 'USAGE'
        )
        or has_sequence_privilege(
          'programmable_operator', class.oid, 'SELECT'
        )
        or has_sequence_privilege(
          'programmable_operator', class.oid, 'UPDATE'
        )
      )
  ),
  'promotion operator has no private sequence privileges'
);

set local role programmable_projector;

select programmable_private.register_provider_deployment(
  '91000000-0000-4000-8000-000000000001',
  'envio_deployment',
  'envio:production-7f24e63',
  decode(repeat('11', 32), 'hex'),
  decode(repeat('12', 32), 'hex'),
  decode(repeat('13', 32), 'hex'),
  '2026-07-31T00:00:00Z'
);

select programmable_private.initialize_candidate_database(
  '91000000-0000-4000-8000-000000000001',
  decode(repeat('11', 32), 'hex'),
  decode(repeat('12', 32), 'hex'),
  decode(repeat('14', 32), 'hex'),
  '2026-07-31T00:00:00Z'
);

reset role;
set local role programmable_operator;

select lives_ok(
  $$
    select programmable_private.attest_candidate_database_promotion(
      '91000000-0000-4000-8000-000000000001',
      decode(repeat('21', 32), 'hex'),
      decode(repeat('22', 32), 'hex'),
      decode(repeat('23', 32), 'hex'),
      decode(repeat('24', 32), 'hex'),
      repeat('a', 40),
      'dpl_12345678901234567890',
      '2026-07-31T00:05:00Z'
    )
  $$,
  'promotion operator can execute the evidence-bound promotion'
);

select throws_ok(
  $$
    select pg_catalog.count(*)
    from programmable_private.candidate_database_control
  $$,
  '42501',
  'promotion operator cannot read the candidate control table directly'
);

reset role;

select * from finish();
rollback;
