begin;

select plan(44);

select ok(
  exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'programmable_projector_runtime'
      and not rolcanlogin
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolinherit
      and not rolreplication
      and not rolbypassrls
  )
  and exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'programmable_projector_runtime_login'
      and rolcanlogin
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolinherit
      and not rolreplication
      and not rolbypassrls
  ),
  'runtime capability and login identities are independently hardened'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as capability
      on capability.oid = membership.roleid
    join pg_catalog.pg_roles as login_role
      on login_role.oid = membership.member
    where capability.rolname = 'programmable_projector_runtime'
      and login_role.rolname = 'programmable_projector_runtime_login'
      and not membership.inherit_option
      and membership.set_option
  ),
  'runtime login must explicitly SET ROLE into its capability'
);

select ok(
  to_regprocedure(
    'programmable_private.try_acquire_projector_runtime_lease_v1(text,bytea,timestamp with time zone,timestamp with time zone,bytea)'
  ) is not null
  and to_regprocedure(
    'programmable_private.assert_projector_runtime_lease_v1(text,bigint,bytea)'
  ) is not null
  and to_regprocedure(
    'programmable_private.release_projector_runtime_lease_v1(text,bigint,bytea,timestamp with time zone,bytea)'
  ) is not null,
  'all three frozen singleton lease signatures exist'
);

select is(
  (
    select pg_catalog.array_to_string(procedure.proargnames, ',')
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname =
        'try_acquire_projector_runtime_lease_v1'
  ),
  'p_holder_id,p_lease_token_hash,p_acquired_at,p_expires_at,p_input_commitment,acquired,lease_generation,acquired_at,expires_at',
  'acquire returns the frozen result column names'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname in (
        'try_acquire_projector_runtime_lease_v1',
        'assert_projector_runtime_lease_v1',
        'release_projector_runtime_lease_v1'
      )
      and (
        not procedure.prosecdef
        or not ('search_path=""' = any(procedure.proconfig))
      )
  ),
  'lease functions are SECURITY DEFINER with an empty search path'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(
        'programmable_private.assert_projector_runtime_lease_v1(text,bigint,bytea)'::regprocedure
      )
    ),
    'for update'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.lower(
      pg_catalog.obj_description(
        'programmable_private.assert_projector_runtime_lease_v1(text,bigint,bytea)'::regprocedure,
        'pg_proc'
      )
    ),
    'same connection and inside the same transaction'
  ) > 0,
  'assertion holds the singleton row lock through the writer transaction commit'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'programmable_private.projector_runtime_lease_current'::regclass
  )
  and (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'programmable_private.projector_runtime_lease_history'::regclass
  ),
  'current and history tables enforce RLS even for their owner'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid =
      'programmable_private.projector_runtime_lease_history'::regclass
      and tgname = 'reject_immutable_mutation'
      and not tgisinternal
  ),
  'lease history rejects update and delete mutations'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_private.try_acquire_projector_runtime_lease_v1(text,bytea,timestamp with time zone,timestamp with time zone,bytea)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_private.assert_projector_runtime_lease_v1(text,bigint,bytea)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_private.release_projector_runtime_lease_v1(text,bigint,bytea,timestamp with time zone,bytea)',
    'EXECUTE'
  ),
  'dedicated runtime capability owns acquire, assert, and release'
);

select ok(
  not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.try_acquire_projector_runtime_lease_v1(text,bytea,timestamp with time zone,timestamp with time zone,bytea)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.assert_projector_runtime_lease_v1(text,bigint,bytea)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.release_projector_runtime_lease_v1(text,bigint,bytea,timestamp with time zone,bytea)',
    'EXECUTE'
  ),
  'projector writer receives only the transaction fencing assertion'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_api_reader', 'programmable_reconciler',
      'programmable_profile_binder', 'programmable_profile_recovery',
      'programmable_profile_writer', 'programmable_maintenance'
    ]) as denied(role_name)
    cross join pg_catalog.unnest(array[
      'programmable_private.try_acquire_projector_runtime_lease_v1(text,bytea,timestamp with time zone,timestamp with time zone,bytea)'::regprocedure,
      'programmable_private.assert_projector_runtime_lease_v1(text,bigint,bytea)'::regprocedure,
      'programmable_private.release_projector_runtime_lease_v1(text,bigint,bytea,timestamp with time zone,bytea)'::regprocedure
    ]) as protected(function_oid)
    where pg_catalog.has_function_privilege(
      denied.role_name, protected.function_oid, 'EXECUTE'
    )
  ),
  'browser, service, reader, reconciler, and profile roles are denied'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_projector_runtime', 'programmable_projector',
      'programmable_api_reader', 'programmable_reconciler'
    ]) as denied(role_name)
    cross join pg_catalog.unnest(array[
      'programmable_private.projector_runtime_lease_current'::regclass,
      'programmable_private.projector_runtime_lease_history'::regclass
    ]) as protected(table_oid)
    where pg_catalog.has_table_privilege(
      denied.role_name, protected.table_oid, 'SELECT,INSERT,UPDATE,DELETE'
    )
  ),
  'lease roles have no direct table privileges'
);

select ok(
  exists (
    select 1
    from programmable_private.projector_runtime_lease_current
    where singleton_key = 'canonical-projector-runtime-v1'
      and lease_generation = 0
      and holder_id is null
      and lease_token_hash is null
  )
  and (
    select count(*) = 1
    from programmable_private.projector_runtime_lease_current
  ),
  'migration creates exactly one fixed empty singleton row'
);

set local role programmable_projector_runtime;

select throws_ok(
  $sql$
    select * from programmable_private.try_acquire_projector_runtime_lease_v1(
      'invalid holder', decode(repeat('11', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '75 seconds',
      decode(repeat('21', 32), 'hex')
    )
  $sql$,
  '22023',
  'invalid projector runtime lease acquisition',
  'holder identifiers use the bounded canonical grammar'
);

select throws_ok(
  $sql$
    select * from programmable_private.try_acquire_projector_runtime_lease_v1(
      'worker-a', decode(repeat('00', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '75 seconds',
      decode(repeat('22', 32), 'hex')
    )
  $sql$,
  '22023',
  'invalid projector runtime lease acquisition',
  'zero lease tokens are rejected'
);

select throws_ok(
  $sql$
    select * from programmable_private.try_acquire_projector_runtime_lease_v1(
      'worker-a', decode(repeat('11', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '75 seconds',
      decode(repeat('00', 32), 'hex')
    )
  $sql$,
  '22023',
  'invalid projector runtime lease acquisition',
  'zero acquisition commitments are rejected'
);

select throws_ok(
  $sql$
    select * from programmable_private.try_acquire_projector_runtime_lease_v1(
      'worker-a', decode(repeat('11', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '91 seconds',
      decode(repeat('23', 32), 'hex')
    )
  $sql$,
  '22023',
  'invalid projector runtime lease acquisition',
  'lease TTL cannot exceed ninety seconds'
);

select is(
  (
    select acquired
    from programmable_private.try_acquire_projector_runtime_lease_v1(
      'worker-a', decode(repeat('11', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '75 seconds',
      decode(repeat('24', 32), 'hex')
    )
  ),
  true,
  'the first worker atomically acquires generation one'
);

reset role;

select ok(
  exists (
    select 1
    from programmable_private.projector_runtime_lease_current
    where singleton_key = 'canonical-projector-runtime-v1'
      and lease_generation = 1
      and holder_id = 'worker-a'
      and lease_token_hash = decode(repeat('11', 32), 'hex')
      and released_at is null
      and expires_at > acquired_at
      and expires_at <= acquired_at + interval '90 seconds'
  ),
  'generation one stores only the fenced server-time lease state'
);

select ok(
  exists (
    select 1
    from programmable_private.projector_runtime_lease_history as history
    join programmable_private.mutation_audits as audit
      on audit.audit_id = history.audit_id
    where history.event_kind = 'acquired'
      and history.lease_generation = 1
      and history.input_commitment = decode(repeat('24', 32), 'hex')
      and audit.action = 'projector_runtime_lease.acquire'
      and audit.caller_role = 'programmable_projector_runtime'
  ),
  'successful acquisition appends immutable role-attributed evidence'
);

set local role programmable_projector_runtime;

select ok(
  (
    select not acquired and lease_generation = 1
    from programmable_private.try_acquire_projector_runtime_lease_v1(
      'worker-b', decode(repeat('12', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '75 seconds',
      decode(repeat('25', 32), 'hex')
    )
  ),
  'an unexpired holder makes a competing acquisition return busy'
);

reset role;

select ok(
  (
    select count(*) = 1
    from programmable_private.projector_runtime_lease_history
  )
  and (
    select count(*) = 1
    from programmable_private.mutation_audits
    where action like 'projector_runtime_lease.%'
  ),
  'a busy result leaves current state and audit history unchanged'
);

set local role programmable_projector;

select is(
  programmable_private.assert_projector_runtime_lease_v1(
    'worker-a', 1, decode(repeat('11', 32), 'hex')
  ),
  true,
  'the projector writer can fence a commit with the exact live token'
);

select is(
  programmable_private.assert_projector_runtime_lease_v1(
    'worker-a', 1, decode(repeat('12', 32), 'hex')
  ),
  false,
  'a mismatched token cannot fence a projector commit'
);

reset role;
set local role programmable_projector_runtime;

select is(
  programmable_private.release_projector_runtime_lease_v1(
    'worker-a', 1, decode(repeat('12', 32), 'hex'),
    clock_timestamp(), decode(repeat('26', 32), 'hex')
  ),
  false,
  'a mismatched token cannot release the current lease'
);

select is(
  programmable_private.release_projector_runtime_lease_v1(
    'worker-a', 1, decode(repeat('11', 32), 'hex'),
    clock_timestamp(), decode(repeat('27', 32), 'hex')
  ),
  true,
  'the exact holder can release its own generation'
);

reset role;

select ok(
  exists (
    select 1
    from programmable_private.projector_runtime_lease_current
    where lease_generation = 1
      and released_at is not null
      and release_commitment = decode(repeat('27', 32), 'hex')
  )
  and exists (
    select 1
    from programmable_private.projector_runtime_lease_history
    where lease_generation = 1
      and event_kind = 'released'
      and input_commitment = decode(repeat('27', 32), 'hex')
  ),
  'release marks current state and appends immutable release evidence'
);

set local role programmable_projector_runtime;

select is(
  programmable_private.release_projector_runtime_lease_v1(
    'worker-a', 1, decode(repeat('11', 32), 'hex'),
    clock_timestamp(), decode(repeat('28', 32), 'hex')
  ),
  false,
  'a repeated release cannot append a second release event'
);

select ok(
  (
    select acquired and lease_generation = 2
    from programmable_private.try_acquire_projector_runtime_lease_v1(
      'worker-b', decode(repeat('12', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '100 milliseconds',
      decode(repeat('29', 32), 'hex')
    )
  ),
  'a released lease can be taken over at the next generation'
);

select is(
  programmable_private.release_projector_runtime_lease_v1(
    'worker-a', 1, decode(repeat('11', 32), 'hex'),
    clock_timestamp(), decode(repeat('2a', 32), 'hex')
  ),
  false,
  'generation one cannot release its generation-two successor'
);

reset role;

select ok(
  exists (
    select 1
    from programmable_private.projector_runtime_lease_current
    where lease_generation = 2
      and holder_id = 'worker-b'
      and lease_token_hash = decode(repeat('12', 32), 'hex')
      and released_at is null
  ),
  'released takeover replaces current state without resetting generation'
);

set local role programmable_projector;

select is(
  programmable_private.assert_projector_runtime_lease_v1(
    'worker-a', 1, decode(repeat('11', 32), 'hex')
  ),
  false,
  'generation one remains fenced after its successor acquires'
);

select is(
  programmable_private.assert_projector_runtime_lease_v1(
    'worker-b', 2, decode(repeat('12', 32), 'hex')
  ),
  true,
  'generation two can fence work while its short lease is live'
);

reset role;
select pg_catalog.pg_sleep(0.2);
set local role programmable_projector;

select is(
  programmable_private.assert_projector_runtime_lease_v1(
    'worker-b', 2, decode(repeat('12', 32), 'hex')
  ),
  false,
  'an expired lease cannot fence a delayed commit'
);

reset role;
set local role programmable_projector_runtime;

select ok(
  (
    select acquired and lease_generation = 3
    from programmable_private.try_acquire_projector_runtime_lease_v1(
      'worker-c', decode(repeat('13', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '75 seconds',
      decode(repeat('2b', 32), 'hex')
    )
  ),
  'an expired crashed holder is recoverable at generation three'
);

select is(
  programmable_private.release_projector_runtime_lease_v1(
    'worker-b', 2, decode(repeat('12', 32), 'hex'),
    clock_timestamp(), decode(repeat('2c', 32), 'hex')
  ),
  false,
  'an expired predecessor cannot release its successor'
);

select throws_ok(
  $sql$
    select programmable_private.release_projector_runtime_lease_v1(
      'worker-c', 3, decode(repeat('13', 32), 'hex'),
      clock_timestamp() + interval '31 seconds',
      decode(repeat('2d', 32), 'hex')
    )
  $sql$,
  '22023',
  'invalid projector runtime lease release',
  'release timestamps cannot be moved outside the server clock window'
);

reset role;

select ok(
  (
    select count(*) = 3
    from programmable_private.projector_runtime_lease_history
    where event_kind = 'acquired'
  )
  and (
    select count(*) = 1
    from programmable_private.projector_runtime_lease_history
    where event_kind = 'released'
  )
  and (
    select pg_catalog.array_agg(lease_generation order by lease_generation)
      = array[1::bigint, 2::bigint, 3::bigint]
    from programmable_private.projector_runtime_lease_history
    where event_kind = 'acquired'
  ),
  'history records monotonic acquisition generations without stale events'
);

select throws_ok(
  $sql$
    update programmable_private.projector_runtime_lease_history
    set event_kind = 'released'
    where lease_generation = 2 and event_kind = 'acquired'
  $sql$,
  '55000',
  'lease history updates are rejected'
);

select throws_ok(
  $sql$
    delete from programmable_private.projector_runtime_lease_history
    where lease_generation = 2 and event_kind = 'acquired'
  $sql$,
  '55000',
  'lease history deletes are rejected'
);

set local role programmable_projector_runtime;

select throws_ok(
  $sql$
    update programmable_private.projector_runtime_lease_current
    set lease_generation = 99
  $sql$,
  '42501',
  'runtime capability cannot mutate lease tables directly'
);

reset role;
set local role programmable_projector_runtime_login;

select throws_ok(
  $sql$
    select * from programmable_private.try_acquire_projector_runtime_lease_v1(
      'worker-d', decode(repeat('14', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '75 seconds',
      decode(repeat('2e', 32), 'hex')
    )
  $sql$,
  '42501',
  'the NOINHERIT login cannot acquire before explicit SET ROLE'
);

reset role;
set local role programmable_projector_runtime;

select is(
  programmable_private.assert_projector_runtime_lease_v1(
    'worker-c', 3, decode(repeat('13', 32), 'hex')
  ),
  true,
  'the dedicated runtime capability can assert its current fence'
);

reset role;

select ok(
  not exists (
    select 1
    from programmable_private.projector_runtime_lease_history
    where lease_token_hash = decode(repeat('00', 32), 'hex')
      or input_commitment = decode(repeat('00', 32), 'hex')
  )
  and not exists (
    select 1
    from programmable_private.mutation_audits
    where action like 'projector_runtime_lease.%'
      and input_commitment = decode(repeat('00', 32), 'hex')
  ),
  'lease evidence contains no zero token or input commitments'
);

select * from finish();
rollback;
