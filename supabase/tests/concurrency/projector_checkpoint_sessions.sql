\if :setup
drop schema if exists programmable_concurrency_projector cascade;
create schema programmable_concurrency_projector;

create table programmable_concurrency_projector.ready (
  phase text not null,
  actor text not null,
  primary key (phase, actor)
);

create table programmable_concurrency_projector.results (
  phase text not null,
  actor text not null,
  outcome text not null,
  detail text,
  primary key (phase, actor)
);

create function programmable_concurrency_projector.arrive(
  p_phase text,
  p_actor text
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into programmable_concurrency_projector.ready (phase, actor)
  values (p_phase, p_actor)
  on conflict (phase, actor) do nothing
$function$;

create function programmable_concurrency_projector.wait_for_peers(
  p_phase text,
  p_expected integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  attempt integer;
begin
  for attempt in 1..200 loop
    if (
      select pg_catalog.count(*)
      from programmable_concurrency_projector.ready
      where phase = p_phase
    ) >= p_expected then
      return;
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
  raise exception 'timed out waiting for phase %', p_phase;
end
$function$;

create function programmable_concurrency_projector.record_result(
  p_phase text,
  p_actor text,
  p_outcome text,
  p_detail text
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into programmable_concurrency_projector.results (
    phase, actor, outcome, detail
  )
  values (p_phase, p_actor, p_outcome, pg_catalog.left(p_detail, 512))
  on conflict (phase, actor) do update
    set outcome = excluded.outcome,
        detail = excluded.detail
$function$;

create function programmable_concurrency_projector.current_scope(
  p_release_id text
)
returns table(epoch_id uuid, generation bigint)
language sql
stable
security definer
set search_path = ''
as $function$
  select current_epoch.epoch_id, current_epoch.generation
  from programmable_private.release_epoch_current as current_epoch
  where current_epoch.chain_id = 1
    and current_epoch.release_id = p_release_id
    and current_epoch.model_id = 'classic-v3'
    and current_epoch.source_group = 'core'
$function$;

grant usage on schema programmable_concurrency_projector
  to programmable_projector;
grant execute on all functions in schema programmable_concurrency_projector
  to programmable_projector;

set role programmable_projector;

select programmable_private.create_release_epoch(
  '10000000-1000-0000-0000-000000000001',
  1, 'race', 'classic-v3', 'core', 1,
  decode(repeat('10', 32), 'hex'), decode(repeat('11', 32), 'hex'),
  decode(repeat('12', 32), 'hex'), '2026-01-01T00:00:00Z'
);
select programmable_private.create_release_epoch(
  '10000000-1000-0000-0000-000000000002',
  1, 'race', 'classic-v3', 'core', 2,
  decode(repeat('13', 32), 'hex'), decode(repeat('11', 32), 'hex'),
  decode(repeat('14', 32), 'hex'), '2026-01-01T00:00:01Z'
);
select programmable_private.create_release_epoch(
  '10000000-1000-0000-0000-000000000003',
  1, 'race', 'classic-v3', 'core', 3,
  decode(repeat('15', 32), 'hex'), decode(repeat('11', 32), 'hex'),
  decode(repeat('16', 32), 'hex'), '2026-01-01T00:00:02Z'
);
select programmable_private.create_release_epoch(
  '10000000-1000-0000-0000-000000000004',
  1, 'race', 'classic-v3', 'core', 4,
  decode(repeat('18', 32), 'hex'), decode(repeat('11', 32), 'hex'),
  decode(repeat('19', 32), 'hex'), '2026-01-01T00:00:02Z'
);
select programmable_private.append_release_source_binding(
  '11000000-1000-0000-0000-000000000002',
  '10000000-1000-0000-0000-000000000002',
  'checkpoint-source', 'launcher', 'ethereum_contract',
  decode(repeat('aa', 20), 'hex'), null,
  0, decode(repeat('ab', 32), 'hex'), decode(repeat('11', 32), 'hex'),
  decode(repeat('a2', 32), 'hex'), decode(repeat('b2', 32), 'hex'),
  '2026-01-01T00:00:02Z'
);
select programmable_private.append_release_source_binding(
  '11000000-1000-0000-0000-000000000003',
  '10000000-1000-0000-0000-000000000003',
  'checkpoint-source', 'launcher', 'ethereum_contract',
  decode(repeat('aa', 20), 'hex'), null,
  0, decode(repeat('ab', 32), 'hex'), decode(repeat('11', 32), 'hex'),
  decode(repeat('a3', 32), 'hex'), decode(repeat('b3', 32), 'hex'),
  '2026-01-01T00:00:02Z'
);
select programmable_private.append_release_source_binding(
  '11000000-1000-0000-0000-000000000004',
  '10000000-1000-0000-0000-000000000004',
  'checkpoint-source', 'launcher', 'ethereum_contract',
  decode(repeat('aa', 20), 'hex'), null,
  0, decode(repeat('ab', 32), 'hex'), decode(repeat('11', 32), 'hex'),
  decode(repeat('a4', 32), 'hex'), decode(repeat('b4', 32), 'hex'),
  '2026-01-01T00:00:02Z'
);
select programmable_private.activate_release_epoch(
  1, 'race', 'classic-v3', 'core',
  '10000000-1000-0000-0000-000000000001',
  0, 1, decode(repeat('17', 32), 'hex'), '2026-01-01T00:00:03Z'
);

select programmable_private.create_release_epoch(
  '10000000-2000-0000-0000-000000000001',
  1, 'diff-a', 'classic-v3', 'core', 1,
  decode(repeat('20', 32), 'hex'), decode(repeat('21', 32), 'hex'),
  decode(repeat('22', 32), 'hex'), '2026-01-01T00:00:04Z'
);
select programmable_private.activate_release_epoch(
  1, 'diff-a', 'classic-v3', 'core',
  '10000000-2000-0000-0000-000000000001',
  0, 1, decode(repeat('23', 32), 'hex'), '2026-01-01T00:00:05Z'
);
select programmable_private.create_release_epoch(
  '10000000-3000-0000-0000-000000000001',
  1, 'diff-b', 'classic-v3', 'core', 1,
  decode(repeat('30', 32), 'hex'), decode(repeat('31', 32), 'hex'),
  decode(repeat('32', 32), 'hex'), '2026-01-01T00:00:06Z'
);
select programmable_private.activate_release_epoch(
  1, 'diff-b', 'classic-v3', 'core',
  '10000000-3000-0000-0000-000000000001',
  0, 1, decode(repeat('33', 32), 'hex'), '2026-01-01T00:00:07Z'
);

select programmable_private.register_rpc_provider_deployment(
  '12000000-0000-0000-0000-000000000001',
  1, 'drpc', 'rpc-provider-v1',
  decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('a3', 32), 'hex'),
  decode(repeat('91', 32), 'hex'),
  decode(repeat('92', 32), 'hex'), decode(repeat('93', 32), 'hex'),
  '2026-01-01T00:00:08Z'
);
select programmable_private.register_rpc_provider_deployment(
  '12000000-0000-0000-0000-000000000002',
  1, 'quicknode', 'rpc-provider-v1',
  decode(repeat('b1', 32), 'hex'), decode(repeat('b2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('b3', 32), 'hex'),
  decode(repeat('94', 32), 'hex'),
  decode(repeat('95', 32), 'hex'), decode(repeat('96', 32), 'hex'),
  '2026-01-01T00:00:08Z'
);
select programmable_private.register_provider_deployment(
  '12000000-0000-0000-0000-000000000003', 'envio_deployment',
  'concurrency-envio', decode(repeat('97', 32), 'hex'),
  decode(repeat('98', 32), 'hex'), decode(repeat('99', 32), 'hex'),
  '2026-01-01T00:00:08Z'
);

reset role;
\endif

\if :pointer_a
select programmable_concurrency_projector.arrive('pointer', 'a');
select programmable_concurrency_projector.wait_for_peers('pointer', 2);
set role programmable_projector;
do $session$
begin
  perform programmable_private.activate_release_epoch(
    1, 'race', 'classic-v3', 'core',
    '10000000-1000-0000-0000-000000000002',
    1, 2, decode(repeat('41', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_projector.record_result(
    'pointer', 'a', 'success', 'epoch-2'
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'pointer', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :pointer_b
select programmable_concurrency_projector.arrive('pointer', 'b');
select programmable_concurrency_projector.wait_for_peers('pointer', 2);
set role programmable_projector;
do $session$
begin
  perform programmable_private.activate_release_epoch(
    1, 'race', 'classic-v3', 'core',
    '10000000-1000-0000-0000-000000000003',
    1, 2, decode(repeat('42', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_projector.record_result(
    'pointer', 'b', 'success', 'epoch-3'
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'pointer', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :lease_a
select programmable_concurrency_projector.arrive('lease', 'a');
select programmable_concurrency_projector.wait_for_peers('lease', 2);
set role programmable_projector;
do $session$
declare
  selected_epoch uuid;
  selected_generation bigint;
begin
  select scope.epoch_id, scope.generation
    into selected_epoch, selected_generation
  from programmable_concurrency_projector.current_scope('race') as scope;
  perform programmable_private.acquire_projector_lease(
    1, 'race', 'classic-v3', 'core', 'projector-v1',
    selected_epoch, selected_generation, 0, 1,
    decode(repeat('51', 32), 'hex'), 'lease-a',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '5 minutes',
    decode(repeat('52', 32), 'hex')
  );
  perform programmable_concurrency_projector.record_result(
    'lease', 'a', 'success', selected_epoch::text
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'lease', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :lease_b
select programmable_concurrency_projector.arrive('lease', 'b');
select programmable_concurrency_projector.wait_for_peers('lease', 2);
set role programmable_projector;
do $session$
declare
  selected_epoch uuid;
  selected_generation bigint;
begin
  select scope.epoch_id, scope.generation
    into selected_epoch, selected_generation
  from programmable_concurrency_projector.current_scope('race') as scope;
  perform programmable_private.acquire_projector_lease(
    1, 'race', 'classic-v3', 'core', 'projector-v1',
    selected_epoch, selected_generation, 0, 1,
    decode(repeat('53', 32), 'hex'), 'lease-b',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '5 minutes',
    decode(repeat('54', 32), 'hex')
  );
  perform programmable_concurrency_projector.record_result(
    'lease', 'b', 'success', selected_epoch::text
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'lease', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :different_a
select programmable_concurrency_projector.arrive('different', 'a');
select programmable_concurrency_projector.wait_for_peers('different', 2);
set role programmable_projector;
do $session$
begin
  perform pg_catalog.set_config('lock_timeout', '250ms', true);
  perform programmable_private.acquire_projector_lease(
    1, 'diff-a', 'classic-v3', 'core', 'projector-v1',
    '10000000-2000-0000-0000-000000000001', 1, 0, 1,
    decode(repeat('61', 32), 'hex'), 'different-a',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '5 minutes',
    decode(repeat('62', 32), 'hex')
  );
  perform programmable_concurrency_projector.record_result(
    'different', 'a', 'success', 'diff-a'
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'different', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :different_b
select programmable_concurrency_projector.arrive('different', 'b');
select programmable_concurrency_projector.wait_for_peers('different', 2);
set role programmable_projector;
do $session$
begin
  perform pg_catalog.set_config('lock_timeout', '250ms', true);
  perform programmable_private.acquire_projector_lease(
    1, 'diff-b', 'classic-v3', 'core', 'projector-v1',
    '10000000-3000-0000-0000-000000000001', 1, 0, 1,
    decode(repeat('63', 32), 'hex'), 'different-b',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '5 minutes',
    decode(repeat('64', 32), 'hex')
  );
  perform programmable_concurrency_projector.record_result(
    'different', 'b', 'success', 'diff-b'
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'different', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :stale_a
select programmable_concurrency_projector.arrive('stale', 'a');
select programmable_concurrency_projector.wait_for_peers('stale', 2);
set role programmable_projector;
do $session$
begin
  perform programmable_private.acquire_projector_lease(
    1, 'race', 'classic-v3', 'core', 'stale-a',
    '10000000-1000-0000-0000-000000000001', 1, 0, 1,
    decode(repeat('71', 32), 'hex'), 'stale-a',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '5 minutes',
    decode(repeat('72', 32), 'hex')
  );
  perform programmable_concurrency_projector.record_result(
    'stale', 'a', 'unexpected-success', null
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'stale', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :stale_b
select programmable_concurrency_projector.arrive('stale', 'b');
select programmable_concurrency_projector.wait_for_peers('stale', 2);
set role programmable_projector;
do $session$
begin
  perform programmable_private.acquire_projector_lease(
    1, 'race', 'classic-v3', 'core', 'stale-b',
    '10000000-1000-0000-0000-000000000001', 1, 0, 1,
    decode(repeat('73', 32), 'hex'), 'stale-b',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '5 minutes',
    decode(repeat('74', 32), 'hex')
  );
  perform programmable_concurrency_projector.record_result(
    'stale', 'b', 'unexpected-success', null
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'stale', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :checkpoint_setup
set role programmable_projector;
do $checkpoint_setup$
declare
  selected_epoch uuid;
  selected_generation bigint;
  setup_at timestamptz := pg_catalog.clock_timestamp();
begin
  select scope.epoch_id, scope.generation
    into selected_epoch, selected_generation
  from programmable_concurrency_projector.current_scope('race') as scope;

  perform programmable_private.open_run(
    '13000000-1000-0000-0000-000000000001',
    'ingestion', 1, 'race', 'classic-v3', 'core',
    selected_epoch, selected_generation, 'checkpoint-fixture',
    decode(repeat('c1', 32), 'hex'), setup_at
  );
  perform programmable_private.append_safe_head_observation(
    '13200000-1000-0000-0000-000000000001',
    '13000000-1000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000002',
    1, 1, 112, 112, 12, 100,
    decode(repeat('c0', 32), 'hex'), decode(repeat('c0', 32), 'hex'),
    2::smallint,
    decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320001c1',
      'hex'
    ),
    decode(repeat('c1', 32), 'hex'), setup_at
  );
  perform programmable_private.append_dual_rpc_block_evidence(
    '13200000-1000-0000-0000-000000000002',
    '13200000-1000-0000-0000-000000000001',
    '13000000-1000-0000-0000-000000000001',
    100, decode(repeat('c0', 32), 'hex'), decode(repeat('c0', 32), 'hex'),
    2::smallint,
    decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320002c2',
      'hex'
    ),
    decode(repeat('c2', 32), 'hex'), setup_at
  );
  perform programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('c0', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 0),
  '13000000-1000-0000-0000-000000000001',
  100,
  decode(repeat('c0', 32), 'hex'),
  decode(repeat('c4', 32), 'hex'),
  0,
  0,
  decode(repeat('aa', 20), 'hex'),
  decode(repeat('c5', 32), 'hex'),
  'launch-created',
  array[decode(repeat('c5', 32), 'hex')],
  decode('00', 'hex'),
  '{"kind":"checkpoint-race"}'::jsonb,
  decode(repeat('c6', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('c0', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 0),
  '12000000-0000-0000-0000-000000000003',
  decode(repeat('c7', 32), 'hex'),
  setup_at
);
  perform programmable_private.append_chain_event_occurrence(
    '13100000-1000-0000-0000-000000000001',
    '13100000-1000-0000-0000-000000000002',
    '13000000-1000-0000-0000-000000000001',
    programmable_private.derive_envio_candidate_id(1, decode(repeat('c0', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 0), 0, setup_at, 'checkpoint-decoder-v1',
    decode(repeat('ab', 32), 'hex'),
    '13200000-1000-0000-0000-000000000002', 1::smallint,
    decode(
      '70726f6772616d6d61626c653a6f6363757272656e63653a763100c3',
      'hex'
    ),
    decode(repeat('c3', 32), 'hex'), setup_at
  );

  perform programmable_private.open_run(
    '13000000-1000-0000-0000-000000000002',
    'projection', 1, 'race', 'classic-v3', 'core',
    selected_epoch, selected_generation, 'checkpoint-a',
    decode(repeat('ca', 32), 'hex'), setup_at
  );
  perform programmable_private.open_run(
    '13000000-1000-0000-0000-000000000003',
    'projection', 1, 'race', 'classic-v3', 'core',
    selected_epoch, selected_generation, 'checkpoint-b',
    decode(repeat('cb', 32), 'hex'), setup_at
  );
  perform programmable_private.open_run(
    '13000000-1000-0000-0000-000000000004',
    'projection', 1, 'race', 'classic-v3', 'core',
    selected_epoch, selected_generation, 'checkpoint-baseline',
    decode(repeat('cc', 32), 'hex'), setup_at
  );
  perform programmable_private.stage_launch_projection(
    '13300000-1000-0000-0000-000000000001',
    '13000000-1000-0000-0000-000000000002',
    decode(repeat('a1', 20), 'hex'), decode(repeat('a2', 20), 'hex'),
    decode(repeat('c4', 32), 'hex'), decode(repeat('a3', 32), 'hex'),
    null, decode(repeat('a4', 32), 'hex'), 'Checkpoint A', 'CPA', 1000000,
    '13100000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'), setup_at
  );
  perform programmable_private.stage_pool_projection(
    '13300000-1000-0000-0000-000000000011',
    '13300000-1000-0000-0000-000000000001',
    '13000000-1000-0000-0000-000000000002',
    decode(repeat('00', 20), 'hex'), decode(repeat('a1', 20), 'hex'),
    3000, 60, decode(repeat('aa', 20), 'hex'),
    '13100000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'), setup_at
  );
  perform programmable_private.stage_pool_fee_configuration(
    '13300000-1000-0000-0000-000000000021',
    '13300000-1000-0000-0000-000000000011',
    '13000000-1000-0000-0000-000000000002',
    100, 100, 90, 10, 0, 0,
    '13100000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'), setup_at
  );
  perform programmable_private.stage_launch_projection(
    '13300000-1000-0000-0000-000000000002',
    '13000000-1000-0000-0000-000000000003',
    decode(repeat('b1', 20), 'hex'), decode(repeat('b2', 20), 'hex'),
    decode(repeat('c4', 32), 'hex'), decode(repeat('b3', 32), 'hex'),
    null, decode(repeat('b4', 32), 'hex'), 'Checkpoint B', 'CPB', 1000000,
    '13100000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'), setup_at
  );
  perform programmable_private.stage_pool_projection(
    '13300000-1000-0000-0000-000000000012',
    '13300000-1000-0000-0000-000000000002',
    '13000000-1000-0000-0000-000000000003',
    decode(repeat('00', 20), 'hex'), decode(repeat('b1', 20), 'hex'),
    3000, 60, decode(repeat('aa', 20), 'hex'),
    '13100000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'), setup_at
  );
  perform programmable_private.stage_pool_fee_configuration(
    '13300000-1000-0000-0000-000000000022',
    '13300000-1000-0000-0000-000000000012',
    '13000000-1000-0000-0000-000000000003',
    100, 100, 90, 10, 0, 0,
    '13100000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'), setup_at
  );
  perform programmable_private.stage_launch_projection(
    '13300000-1000-0000-0000-000000000003',
    '13000000-1000-0000-0000-000000000004',
    decode(repeat('c1', 20), 'hex'), decode(repeat('c2', 20), 'hex'),
    decode(repeat('c4', 32), 'hex'), decode(repeat('c3', 32), 'hex'),
    null, decode(repeat('c4', 32), 'hex'),
    'Checkpoint Baseline', 'CP0', 1000000,
    '13100000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'), setup_at
  );
  perform programmable_private.stage_pool_projection(
    '13300000-1000-0000-0000-000000000013',
    '13300000-1000-0000-0000-000000000003',
    '13000000-1000-0000-0000-000000000004',
    decode(repeat('00', 20), 'hex'), decode(repeat('c1', 20), 'hex'),
    3000, 60, decode(repeat('aa', 20), 'hex'),
    '13100000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'), setup_at
  );
  perform programmable_private.stage_pool_fee_configuration(
    '13300000-1000-0000-0000-000000000023',
    '13300000-1000-0000-0000-000000000013',
    '13000000-1000-0000-0000-000000000004',
    100, 100, 90, 10, 0, 0,
    '13100000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'), setup_at
  );
  perform programmable_private.acquire_projector_lease(
    1, 'race', 'classic-v3', 'core', 'checkpoint-v1',
    selected_epoch, selected_generation, 0, 1,
    decode(repeat('c7', 32), 'hex'), 'checkpoint-fixture',
    setup_at, setup_at + interval '9 minutes',
    decode(repeat('c8', 32), 'hex')
  );
  perform programmable_private.promote_projection_run(
    '13400000-1000-0000-0000-000000000021',
    '13400000-1000-0000-0000-000000000022',
    '13400000-1000-0000-0000-000000000023',
    '13000000-1000-0000-0000-000000000004',
    'checkpoint-v1', 1, decode(repeat('c7', 32), 'hex'),
    0, 1, 0,
    '13200000-1000-0000-0000-000000000001',
    '13200000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'),
    array['13100000-1000-0000-0000-000000000002'::uuid],
    array[]::uuid[], array[]::uuid[], array['checkpoint-race'],
    decode(repeat('cc', 32), 'hex'), setup_at
  );
end
$checkpoint_setup$;
reset role;
\endif

\if :checkpoint_a
select programmable_concurrency_projector.arrive('checkpoint', 'a');
select programmable_concurrency_projector.wait_for_peers('checkpoint', 2);
set role programmable_projector;
do $session$
begin
  perform programmable_private.promote_projection_run(
    '13400000-1000-0000-0000-000000000001',
    '13400000-1000-0000-0000-000000000002',
    '13400000-1000-0000-0000-000000000003',
    '13000000-1000-0000-0000-000000000002',
    'checkpoint-v1', 1, decode(repeat('c7', 32), 'hex'),
    1, 2, 0,
    '13200000-1000-0000-0000-000000000001',
    '13200000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'),
    array['13100000-1000-0000-0000-000000000002'::uuid],
    array[]::uuid[], array[]::uuid[], array['checkpoint-race'],
    decode(repeat('c9', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_projector.record_result(
    'checkpoint', 'a', 'success', 'generation-2'
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'checkpoint', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :checkpoint_b
select programmable_concurrency_projector.arrive('checkpoint', 'b');
select programmable_concurrency_projector.wait_for_peers('checkpoint', 2);
set role programmable_projector;
do $session$
begin
  perform programmable_private.promote_projection_run(
    '13400000-1000-0000-0000-000000000011',
    '13400000-1000-0000-0000-000000000012',
    '13400000-1000-0000-0000-000000000013',
    '13000000-1000-0000-0000-000000000003',
    'checkpoint-v1', 1, decode(repeat('c7', 32), 'hex'),
    1, 2, 0,
    '13200000-1000-0000-0000-000000000001',
    '13200000-1000-0000-0000-000000000002',
    100, decode(repeat('c0', 32), 'hex'),
    array['13100000-1000-0000-0000-000000000002'::uuid],
    array[]::uuid[], array[]::uuid[], array['checkpoint-race'],
    decode(repeat('ca', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_projector.record_result(
    'checkpoint', 'b', 'success', 'generation-2'
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'checkpoint', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :reorg_setup
set role programmable_projector;
do $reorg_setup$
declare
  setup_at timestamptz := pg_catalog.clock_timestamp();
begin
  perform programmable_private.activate_release_epoch(
    1, 'race', 'classic-v3', 'core',
    '10000000-1000-0000-0000-000000000004',
    2, 3, decode(repeat('d2', 32), 'hex'), setup_at
  );
  perform programmable_private.open_run(
    '13500000-1000-0000-0000-000000000001',
    'ingestion', 1, 'race', 'classic-v3', 'core',
    '10000000-1000-0000-0000-000000000004', 3,
    'reorg-fixture', decode(repeat('d3', 32), 'hex'), setup_at
  );
  perform programmable_private.append_safe_head_observation(
    '13500000-1000-0000-0000-000000000002',
    '13500000-1000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000002',
    1, 1, 112, 112, 12, 100,
    decode(repeat('d0', 32), 'hex'), decode(repeat('d0', 32), 'hex'),
    2::smallint,
    decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320001d1',
      'hex'
    ),
    decode(repeat('d1', 32), 'hex'), setup_at
  );
  perform programmable_private.append_dual_rpc_block_evidence(
    '13500000-1000-0000-0000-000000000003',
    '13500000-1000-0000-0000-000000000002',
    '13500000-1000-0000-0000-000000000001',
    90, decode(repeat('d9', 32), 'hex'), decode(repeat('d9', 32), 'hex'),
    2::smallint,
    decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320002d2',
      'hex'
    ),
    decode(repeat('d2', 32), 'hex'), setup_at
  );
  perform programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('d9', 32), 'hex'), decode(repeat('d4', 32), 'hex'), 0),
  '13500000-1000-0000-0000-000000000001',
  90,
  decode(repeat('d9', 32), 'hex'),
  decode(repeat('d4', 32), 'hex'),
  0,
  0,
  decode(repeat('aa', 20), 'hex'),
  decode(repeat('d5', 32), 'hex'),
  'launch-created',
  array[decode(repeat('d5', 32), 'hex')],
  decode('00', 'hex'),
  '{"kind":"rollback-probe"}'::jsonb,
  decode(repeat('d6', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('d9', 32), 'hex'), decode(repeat('d4', 32), 'hex'), 0),
  '12000000-0000-0000-0000-000000000003',
  decode(repeat('d7', 32), 'hex'),
  setup_at
);
  perform programmable_private.append_chain_event_occurrence(
    '13600000-1000-0000-0000-000000000001',
    '13600000-1000-0000-0000-000000000002',
    '13500000-1000-0000-0000-000000000001',
    programmable_private.derive_envio_candidate_id(1, decode(repeat('d9', 32), 'hex'), decode(repeat('d4', 32), 'hex'), 0), 0, setup_at, 'rollback-decoder-v1',
    decode(repeat('ab', 32), 'hex'),
    '13500000-1000-0000-0000-000000000003', 1::smallint,
    decode(
      '70726f6772616d6d61626c653a6f6363757272656e63653a763100d3',
      'hex'
    ),
    decode(repeat('d3', 32), 'hex'), setup_at
  );
  perform programmable_private.open_run(
    '13700000-1000-0000-0000-000000000001',
    'rewind', 1, 'race', 'classic-v3', 'core',
    '10000000-1000-0000-0000-000000000004', 3,
    'reorg-a', decode(repeat('da', 32), 'hex'), setup_at
  );
  perform programmable_private.open_run(
    '13700000-1000-0000-0000-000000000002',
    'rewind', 1, 'race', 'classic-v3', 'core',
    '10000000-1000-0000-0000-000000000004', 3,
    'reorg-b', decode(repeat('db', 32), 'hex'), setup_at
  );
  perform programmable_private.acquire_projector_lease(
    1, 'race', 'classic-v3', 'core', 'checkpoint-v1',
    '10000000-1000-0000-0000-000000000004', 3, 1, 2,
    decode(repeat('d7', 32), 'hex'), 'reorg-fixture',
    setup_at, setup_at + interval '9 minutes',
    decode(repeat('d8', 32), 'hex')
  );
  perform programmable_private.acquire_projector_lease(
    1, 'race', 'classic-v3', 'core', 'rollback-a',
    '10000000-1000-0000-0000-000000000004', 3, 0, 1,
    decode(repeat('e1', 32), 'hex'), 'rollback-a',
    setup_at, setup_at + interval '9 minutes',
    decode(repeat('e2', 32), 'hex')
  );
  perform programmable_private.acquire_projector_lease(
    1, 'race', 'classic-v3', 'core', 'rollback-b',
    '10000000-1000-0000-0000-000000000004', 3, 0, 1,
    decode(repeat('e3', 32), 'hex'), 'rollback-b',
    setup_at, setup_at + interval '9 minutes',
    decode(repeat('e4', 32), 'hex')
  );
end
$reorg_setup$;
reset role;
\endif

\if :reorg_a
select programmable_concurrency_projector.arrive('reorg', 'a');
select programmable_concurrency_projector.wait_for_peers('reorg', 2);
set role programmable_projector;
do $session$
begin
  perform programmable_private.rewind_projection_run(
    '13800000-1000-0000-0000-000000000001',
    '13800000-1000-0000-0000-000000000002',
    '13700000-1000-0000-0000-000000000001',
    'checkpoint-v1', 2, decode(repeat('d7', 32), 'hex'),
    2, 3, 1,
    '13500000-1000-0000-0000-000000000002',
    '13500000-1000-0000-0000-000000000003',
    90, decode(repeat('d9', 32), 'hex'),
    decode(repeat('dc', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_projector.record_result(
    'reorg', 'a', 'success', 'pointer-3/lease-2/checkpoint-3/reorg-1'
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'reorg', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :reorg_b
select programmable_concurrency_projector.arrive('reorg', 'b');
select programmable_concurrency_projector.wait_for_peers('reorg', 2);
set role programmable_projector;
do $session$
begin
  perform programmable_private.rewind_projection_run(
    '13800000-1000-0000-0000-000000000011',
    '13800000-1000-0000-0000-000000000012',
    '13700000-1000-0000-0000-000000000002',
    'checkpoint-v1', 2, decode(repeat('d7', 32), 'hex'),
    2, 3, 1,
    '13500000-1000-0000-0000-000000000002',
    '13500000-1000-0000-0000-000000000003',
    90, decode(repeat('d9', 32), 'hex'),
    decode(repeat('dd', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_projector.record_result(
    'reorg', 'b', 'success', 'pointer-3/lease-2/checkpoint-3/reorg-1'
  );
exception when others then
  perform programmable_concurrency_projector.record_result(
    'reorg', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :rollback_a
select programmable_concurrency_projector.arrive('rollback', 'a');
select programmable_concurrency_projector.wait_for_peers('rollback', 2);
set role programmable_projector;
do $session$
declare
  selected_epoch uuid;
  selected_generation bigint;
  failure_at timestamptz;
begin
  select scope.epoch_id, scope.generation
    into selected_epoch, selected_generation
  from programmable_concurrency_projector.current_scope('race') as scope;
  begin
    failure_at := pg_catalog.clock_timestamp();
    perform programmable_private.open_run(
      '18000000-1000-0000-0000-000000000001',
      'projection', 1, 'race', 'classic-v3', 'core',
      selected_epoch, selected_generation, 'rollback-a',
      decode(repeat('81', 32), 'hex'), failure_at
    );
    perform programmable_private.stage_launch_projection(
      '18000000-1000-0000-0000-000000000011',
      '18000000-1000-0000-0000-000000000001',
      decode(repeat('e1', 20), 'hex'), decode(repeat('e2', 20), 'hex'),
      decode(repeat('d4', 32), 'hex'), decode(repeat('e3', 32), 'hex'),
      null, decode(repeat('e4', 32), 'hex'),
      'Rollback A', 'RBA', 1000000,
      '13600000-1000-0000-0000-000000000002',
      90, decode(repeat('d9', 32), 'hex'), failure_at
    );
    perform programmable_private.stage_pool_projection(
      '18000000-1000-0000-0000-000000000012',
      '18000000-1000-0000-0000-000000000011',
      '18000000-1000-0000-0000-000000000001',
      decode(repeat('00', 20), 'hex'), decode(repeat('e1', 20), 'hex'),
      3000, 60, decode(repeat('aa', 20), 'hex'),
      '13600000-1000-0000-0000-000000000002',
      90, decode(repeat('d9', 32), 'hex'), failure_at
    );
    perform programmable_private.stage_pool_fee_configuration(
      '18000000-1000-0000-0000-000000000016',
      '18000000-1000-0000-0000-000000000012',
      '18000000-1000-0000-0000-000000000001',
      100, 100, 90, 10, 0, 0,
      '13600000-1000-0000-0000-000000000002',
      90, decode(repeat('d9', 32), 'hex'), failure_at
    );
    perform programmable_private.promote_projection_run(
      '18000000-1000-0000-0000-000000000013',
      '18000000-1000-0000-0000-000000000014',
      '18000000-1000-0000-0000-000000000015',
      '18000000-1000-0000-0000-000000000001',
      'rollback-a', 1, decode(repeat('e1', 32), 'hex'),
      0, 1, 0,
      '13500000-1000-0000-0000-000000000002',
      '13500000-1000-0000-0000-000000000003',
      90, decode(repeat('d9', 32), 'hex'),
      array['13600000-1000-0000-0000-000000000002'::uuid],
      array[]::uuid[], array[]::uuid[], array['rollback-probe-a'],
      decode(repeat('e5', 32), 'hex'), failure_at
    );
    raise exception using
      errcode = 'PZ001',
      message = 'injected failure after projection and checkpoint writes';
  exception when sqlstate 'PZ001' then
    perform programmable_concurrency_projector.record_result(
      'rollback', 'a', 'rolled-back',
      'injected failure after projection and checkpoint writes'
    );
  end;
end
$session$;
reset role;
\endif

\if :rollback_b
select programmable_concurrency_projector.arrive('rollback', 'b');
select programmable_concurrency_projector.wait_for_peers('rollback', 2);
set role programmable_projector;
do $session$
declare
  selected_epoch uuid;
  selected_generation bigint;
  failure_at timestamptz;
begin
  select scope.epoch_id, scope.generation
    into selected_epoch, selected_generation
  from programmable_concurrency_projector.current_scope('race') as scope;
  begin
    failure_at := pg_catalog.clock_timestamp();
    perform programmable_private.open_run(
      '18000000-1000-0000-0000-000000000002',
      'projection', 1, 'race', 'classic-v3', 'core',
      selected_epoch, selected_generation, 'rollback-b',
      decode(repeat('82', 32), 'hex'), failure_at
    );
    perform programmable_private.stage_launch_projection(
      '18000000-1000-0000-0000-000000000021',
      '18000000-1000-0000-0000-000000000002',
      decode(repeat('f1', 20), 'hex'), decode(repeat('f2', 20), 'hex'),
      decode(repeat('d4', 32), 'hex'), decode(repeat('f3', 32), 'hex'),
      null, decode(repeat('f4', 32), 'hex'),
      'Rollback B', 'RBB', 1000000,
      '13600000-1000-0000-0000-000000000002',
      90, decode(repeat('d9', 32), 'hex'), failure_at
    );
    perform programmable_private.stage_pool_projection(
      '18000000-1000-0000-0000-000000000022',
      '18000000-1000-0000-0000-000000000021',
      '18000000-1000-0000-0000-000000000002',
      decode(repeat('00', 20), 'hex'), decode(repeat('f1', 20), 'hex'),
      3000, 60, decode(repeat('aa', 20), 'hex'),
      '13600000-1000-0000-0000-000000000002',
      90, decode(repeat('d9', 32), 'hex'), failure_at
    );
    perform programmable_private.stage_pool_fee_configuration(
      '18000000-1000-0000-0000-000000000026',
      '18000000-1000-0000-0000-000000000022',
      '18000000-1000-0000-0000-000000000002',
      100, 100, 90, 10, 0, 0,
      '13600000-1000-0000-0000-000000000002',
      90, decode(repeat('d9', 32), 'hex'), failure_at
    );
    perform programmable_private.promote_projection_run(
      '18000000-1000-0000-0000-000000000023',
      '18000000-1000-0000-0000-000000000024',
      '18000000-1000-0000-0000-000000000025',
      '18000000-1000-0000-0000-000000000002',
      'rollback-b', 1, decode(repeat('e3', 32), 'hex'),
      0, 1, 0,
      '13500000-1000-0000-0000-000000000002',
      '13500000-1000-0000-0000-000000000003',
      90, decode(repeat('d9', 32), 'hex'),
      array['13600000-1000-0000-0000-000000000002'::uuid],
      array[]::uuid[], array[]::uuid[], array['rollback-probe-b'],
      decode(repeat('f5', 32), 'hex'), failure_at
    );
    raise exception using
      errcode = 'PZ001',
      message = 'injected failure after projection and checkpoint writes';
  exception when sqlstate 'PZ001' then
    perform programmable_concurrency_projector.record_result(
      'rollback', 'b', 'rolled-back',
      'injected failure after projection and checkpoint writes'
    );
  end;
end
$session$;
reset role;
\endif

\if :verify
set role programmable_projector;
do $runtime_resume$
declare
  state record;
begin
  select * into state
  from programmable_private.get_projector_runtime_state_v1(
    1, 'race', 'classic-v3', 'core', 'checkpoint-v1',
    array['rpc_provider', 'rpc_provider', 'envio_deployment']::text[],
    array['rpc:1:drpc', 'rpc:1:quicknode', 'concurrency-envio']::text[],
    array[
      decode(repeat('91', 32), 'hex'),
      decode(repeat('94', 32), 'hex'),
      decode(repeat('97', 32), 'hex')
    ],
    array[
      decode(repeat('92', 32), 'hex'),
      decode(repeat('95', 32), 'hex'),
      decode(repeat('98', 32), 'hex')
    ]
  );
  if state.epoch_id <>
       '10000000-1000-0000-0000-000000000004'::uuid
     or state.pointer_generation <> 3
     or state.lease_generation <> 2
     or state.checkpoint_generation <> 3
     or state.reorg_generation <> 1
     or state.checkpoint_block_number <> 90
  then
    raise exception 'stateless runtime resume returned stale CAS state';
  end if;
end
$runtime_resume$;
reset role;

do $verify$
begin
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_projector.results
    where phase = 'pointer' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_projector.results
    where phase = 'pointer' and outcome = '40001'
  ) <> 1 then
    raise exception 'same-scope release pointer CAS did not produce one winner';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_private.release_epoch_current
    where chain_id = 1 and release_id = 'race'
      and model_id = 'classic-v3' and source_group = 'core'
      and epoch_id = '10000000-1000-0000-0000-000000000004'
      and generation = 3
  ) <> 1 then
    raise exception 'higher-generation release pointer invariant failed';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_projector.results
    where phase = 'lease' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_projector.results
    where phase = 'lease' and outcome = '40001'
  ) <> 1 then
    raise exception 'same-scope projector lease CAS did not produce one winner';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_private.projector_lease_current
    where chain_id = 1 and release_id = 'race'
      and model_id = 'classic-v3' and source_group = 'core'
      and projector_version = 'projector-v1'
      and epoch_id in (
        '10000000-1000-0000-0000-000000000002',
        '10000000-1000-0000-0000-000000000003'
      )
      and pointer_generation = 2
      and lease_generation = 1
  ) <> 1 then
    raise exception 'lease winner is not fenced to the winning pointer';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_projector.results
    where phase = 'different' and outcome = 'success'
  ) <> 2 then
    raise exception 'independent exact scopes interfered';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_projector.results
    where phase = 'stale' and outcome = '40001'
  ) <> 2 then
    raise exception 'stale pre-generation workers were not fenced';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_projector.results
    where phase = 'checkpoint' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_projector.results
    where phase = 'checkpoint' and outcome = '40001'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.projector_checkpoints
    where chain_id = 1 and release_id = 'race'
      and model_id = 'classic-v3' and source_group = 'core'
      and projector_version = 'checkpoint-v1'
      and pointer_generation = 2 and lease_generation = 1
      and checkpoint_generation = 2 and reorg_generation = 0
      and block_number = 100
  ) <> 1 then
    raise exception 'same-scope checkpoint CAS did not produce one winner';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_projector.results
    where phase = 'reorg' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_projector.results
    where phase = 'reorg' and outcome = '40001'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.projector_checkpoint_current as current_checkpoint
    join programmable_private.projector_checkpoints as checkpoint
      on checkpoint.checkpoint_id = current_checkpoint.checkpoint_id
    where current_checkpoint.chain_id = 1
      and current_checkpoint.release_id = 'race'
      and current_checkpoint.model_id = 'classic-v3'
      and current_checkpoint.source_group = 'core'
      and current_checkpoint.projector_version = 'checkpoint-v1'
      and current_checkpoint.checkpoint_generation = 3
      and current_checkpoint.reorg_generation = 1
      and checkpoint.epoch_id = '10000000-1000-0000-0000-000000000004'
      and checkpoint.pointer_generation = 3
      and checkpoint.lease_generation = 2
      and checkpoint.block_number = 90
  ) <> 1 then
    raise exception 'higher-generation reorg CAS did not produce one fenced winner';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_private.route_eligibility_current
    where route_key = 'checkpoint-race'
      and chain_id = 1 and release_id = 'race'
      and model_id = 'classic-v3' and source_group = 'core'
      and epoch_id = '10000000-1000-0000-0000-000000000004'
      and pointer_generation = 3 and status = 'ineligible'
  ) <> 1 or exists (
    select 1
    from programmable_private.chain_event_current_canonical
    where occurrence_id = '13100000-1000-0000-0000-000000000002'
  ) then
    raise exception 'reorg did not revoke the previous publication state';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_projector.results
    where phase = 'rollback' and outcome = 'rolled-back'
  ) <> 2 then
    raise exception 'failure injection did not execute in both sessions';
  end if;
  if exists (
    select 1
    from programmable_private.run_headers
    where run_id in (
      '18000000-1000-0000-0000-000000000001',
      '18000000-1000-0000-0000-000000000002'
    )
  ) or exists (
    select 1
    from programmable_private.launch_projections
    where launch_projection_id in (
      '18000000-1000-0000-0000-000000000011',
      '18000000-1000-0000-0000-000000000021'
    )
  ) or exists (
    select 1
    from programmable_private.pool_projections
    where pool_projection_id in (
      '18000000-1000-0000-0000-000000000012',
      '18000000-1000-0000-0000-000000000022'
    )
  ) or exists (
    select 1
    from programmable_private.projector_checkpoints
    where checkpoint_id in (
      '18000000-1000-0000-0000-000000000014',
      '18000000-1000-0000-0000-000000000024'
    )
  ) or exists (
    select 1
    from programmable_private.projector_checkpoint_current
    where chain_id = 1 and release_id = 'race'
      and model_id = 'classic-v3' and source_group = 'core'
      and projector_version in ('rollback-a', 'rollback-b')
  ) or exists (
    select 1
    from programmable_private.projection_publications
    where publication_id in (
      '18000000-1000-0000-0000-000000000013',
      '18000000-1000-0000-0000-000000000023'
    )
  ) or exists (
    select 1
    from programmable_private.run_lifecycle_outcomes
    where outcome_id in (
      '18000000-1000-0000-0000-000000000015',
      '18000000-1000-0000-0000-000000000025'
    )
  ) or exists (
    select 1
    from programmable_private.route_eligibility_current
    where chain_id = 1 and release_id = 'race'
      and model_id = 'classic-v3'
      and route_key in ('rollback-probe-a', 'rollback-probe-b')
  ) or exists (
    select 1
    from programmable_private.chain_event_current_canonical
    where occurrence_id = '13600000-1000-0000-0000-000000000002'
  ) or exists (
    select 1
    from programmable_private.mutation_audits
    where run_id in (
      '18000000-1000-0000-0000-000000000001',
      '18000000-1000-0000-0000-000000000002'
    )
  ) then
    raise exception 'rolled-back projection/checkpoint transaction left state';
  end if;
end
$verify$;

drop schema programmable_concurrency_projector cascade;
\endif
