begin;

select plan(20);

create function pg_temp.test_enqueue_quicknode_wake(
  p_nonce_digest bytea,
  p_block_number bigint,
  p_payload text default '{"data":[{"number":"0x123"}]}'::text,
  p_payload_digest bytea default decode(repeat('41', 32), 'hex'),
  p_reorged_blocks text default '[]'::text
)
returns table (
  accepted boolean,
  wake_id bigint,
  enqueued boolean,
  block_number_hint bigint,
  job_state text
)
language sql
as $helper$
  select *
  from programmable_wake_private.enqueue_quicknode_wake_v1(
    p_nonce_digest,
    p_block_number,
    pg_catalog.format(
      '{"chainId":1,"blockNumber":"%s","streamId":"stream-mainnet","reorgedBlockNumbers":%s}',
      p_block_number,
      p_reorged_blocks
    ),
    pg_catalog.clock_timestamp(),
    p_payload,
    p_payload_digest
  )
$helper$;

select ok(
  exists (
    select 1
    from pg_catalog.pg_namespace as namespace
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = namespace.nspowner
    where namespace.nspname = 'programmable_wake_private'
      and owner_role.rolname = 'programmable_migrator'
  )
  and pg_catalog.has_schema_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private',
    'USAGE'
  )
  and not pg_catalog.has_schema_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private',
    'CREATE'
  ),
  'wake schema is private, migrator-owned and runtime-usable only'
);

select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
    from pg_catalog.pg_class as class
    where class.oid =
      'programmable_wake_private.quicknode_wake_jobs_v1'::regclass
  )
  and exists (
    select 1
    from pg_catalog.pg_policy as policy
    where policy.polrelid =
      'programmable_wake_private.quicknode_wake_jobs_v1'::regclass
      and policy.polroles = array[
        (
          select oid from pg_catalog.pg_roles
          where rolname = 'programmable_migrator'
        )
      ]::oid[]
  ),
  'wake jobs force owner-only RLS'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_projector_runtime',
      'programmable_projector_runtime_login',
      'programmable_projector', 'programmable_reconciler',
      'programmable_api_reader'
    ]) as denied(role_name)
    where pg_catalog.has_table_privilege(
      denied.role_name,
      'programmable_wake_private.quicknode_wake_jobs_v1',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
    )
  ),
  'no runtime, browser, service or read-model role has base-table rights'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'enqueue_quicknode_wake_v1',
      'claim_quicknode_wake_v1',
      'complete_quicknode_wake_v1',
      'retry_quicknode_wake_v1'
    ]) as expected(function_name)
    left join pg_catalog.pg_proc as procedure
      on procedure.proname = expected.function_name
    left join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname is distinct from 'programmable_wake_private'
      or not procedure.prosecdef
      or not ('search_path=""' = any(procedure.proconfig))
  ),
  'all queue APIs are SECURITY DEFINER with an empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.enqueue_quicknode_wake_v1(bytea,bigint,text,timestamp with time zone,text,bytea)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.claim_quicknode_wake_v1(text,bytea)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector_runtime_login',
    'programmable_wake_private.enqueue_quicknode_wake_v1(bytea,bigint,text,timestamp with time zone,text,bytea)',
    'EXECUTE'
  ),
  'only the explicitly selected runtime capability can execute the queue API'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.enqueue_quicknode_wake_v1(bytea,bigint,text,timestamp with time zone,text,bytea)'::regprocedure
    ),
    'pg_advisory_xact_lock(1347571539, 1)'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.enqueue_quicknode_wake_v1(bytea,bigint,text,timestamp with time zone,text,bytea)'::regprocedure
    ),
    'limit 256'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.enqueue_quicknode_wake_v1(bytea,bigint,text,timestamp with time zone,text,bytea)'::regprocedure
    ),
    'limit 4096'
  ) > 0,
  'enqueue serializes duplicate/capacity decisions and bounds prune and capacity'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(
        'programmable_wake_private.claim_quicknode_wake_v1(text,bytea)'::regprocedure
      )
    ),
    'for update skip locked'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.claim_quicknode_wake_v1(text,bytea)'::regprocedure
    ),
    '210 seconds'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.claim_quicknode_wake_v1(text,bytea)'::regprocedure
    ),
    'job.lease_expires_at <= database_now'
  ) > 0,
  'claim is non-blocking and uses a bounded crash-recovery lease'
);

set role programmable_projector_runtime;
select throws_ok(
  $sql$
    select * from pg_temp.test_enqueue_quicknode_wake(
      decode(repeat('11', 32), 'hex'), 291
    )
  $sql$,
  '42501',
  'QuickNode wake queue requires its runtime identity',
  'capability impersonation without the runtime login is rejected'
);
reset role;

set session authorization programmable_projector_runtime_login;
set role programmable_projector_runtime;

select is(
  (
    select accepted and enqueued
    from pg_temp.test_enqueue_quicknode_wake(
      decode(repeat('11', 32), 'hex'), 291
    )
  ),
  true,
  'a fresh signed nonce and block marker is durably enqueued'
);

select is(
  (
    select accepted and not enqueued and wake_id = 1
    from pg_temp.test_enqueue_quicknode_wake(
      decode(repeat('11', 32), 'hex'), 291
    )
  ),
  true,
  'an exact duplicate nonce coalesces to the durable marker'
);

select is(
  (
    select accepted and not enqueued and wake_id = 1
    from pg_temp.test_enqueue_quicknode_wake(
      decode(repeat('12', 32), 'hex'), 291
    )
  ),
  true,
  'a second delivery for the same block coalesces even with a new nonce'
);

select throws_ok(
  $sql$
    select * from pg_temp.test_enqueue_quicknode_wake(
      decode(repeat('11', 32), 'hex'), 292
    )
  $sql$,
  '22023',
  'invalid QuickNode wake envelope',
  'nonce reuse for a different block is rejected'
);

select is(
  (
    select wake_id = 1
      and lease_generation = 1
      and attempt_count = 1
      and block_hint =
        '{"chainId":1,"blockNumber":"291","streamId":"stream-mainnet","reorgedBlockNumbers":[]}'
      and payload = '{"data":[{"number":"0x123"}]}'
    from programmable_wake_private.claim_quicknode_wake_v1(
      'worker-a', decode(repeat('21', 32), 'hex')
    )
  ),
  true,
  'the first worker atomically claims generation one'
);

select is(
  (
    select pg_catalog.count(*)
    from programmable_wake_private.claim_quicknode_wake_v1(
      'worker-b', decode(repeat('22', 32), 'hex')
    )
  ),
  0::bigint,
  'an active lease prevents duplicate concurrent work'
);

select is(
  programmable_wake_private.retry_quicknode_wake_v1(
    1, 1, 'worker-a', decode(repeat('21', 32), 'hex'), 0
  ),
  true,
  'a fenced worker can explicitly return failed work to pending'
);

select is(
  (
    select wake_id = 1 and lease_generation = 2 and attempt_count = 2
    from programmable_wake_private.claim_quicknode_wake_v1(
      'worker-b', decode(repeat('22', 32), 'hex')
    )
  ),
  true,
  'explicit retry resumes with a new fencing generation'
);

select is(
  programmable_wake_private.complete_quicknode_wake_v1(
    1, 2, 'worker-b', decode(repeat('22', 32), 'hex')
  ),
  true,
  'the matching worker fence completes the marker'
);

select is(
  (
    select accepted and not enqueued and job_state = 'completed'
    from pg_temp.test_enqueue_quicknode_wake(
      decode(repeat('11', 32), 'hex'), 291
    )
  ),
  true,
  'provider retries after completion remain idempotent'
);

select is(
  (
    select accepted and enqueued
    from pg_temp.test_enqueue_quicknode_wake(
      decode(repeat('31', 32), 'hex'),
      291,
      '{"data":[{"number":"0x123","hash":"reorg"}]}'::text,
      decode(repeat('42', 32), 'hex'),
      '["291"]'::text
    )
  ),
  true,
  'a same-height reorg with a different payload receives a new durable marker'
);

select is(
  (
    select wake_id = 2
      and lease_generation = 1
      and block_hint =
        '{"chainId":1,"blockNumber":"291","streamId":"stream-mainnet","reorgedBlockNumbers":["291"]}'
      and payload = '{"data":[{"number":"0x123","hash":"reorg"}]}'
    from programmable_wake_private.claim_quicknode_wake_v1(
      'worker-crashed', decode(repeat('32', 32), 'hex')
    )
  ),
  true,
  'a worker can claim the later marker before crashing'
);

reset role;
reset session authorization;

select * from finish();
rollback;
