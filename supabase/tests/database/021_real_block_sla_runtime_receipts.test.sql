begin;

select plan(47);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_class as class
    where class.oid = any (array[
      'programmable_wake_private.quicknode_wake_delivery_receipts_v2'::regclass,
      'programmable_wake_private.real_block_sla_provider_retry_arms_v1'::regclass,
      'programmable_wake_private.real_block_sla_provider_retry_consumptions_v1'::regclass,
      'programmable_wake_private.optimistic_sla_bundle_receipts_v1'::regclass,
      'programmable_wake_private.optimistic_sla_market_receipts_v1'::regclass,
      'programmable_wake_private.real_block_sla_api_observations_v1'::regclass,
      'programmable_wake_private.real_block_sla_exports_v1'::regclass
    ]) and class.relrowsecurity and class.relforcerowsecurity
  ),
  7::bigint,
  'all SLA receipt tables force RLS'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_policy as policy
    where policy.polrelid = any (array[
      'programmable_wake_private.quicknode_wake_delivery_receipts_v2'::regclass,
      'programmable_wake_private.real_block_sla_provider_retry_arms_v1'::regclass,
      'programmable_wake_private.real_block_sla_provider_retry_consumptions_v1'::regclass,
      'programmable_wake_private.optimistic_sla_bundle_receipts_v1'::regclass,
      'programmable_wake_private.optimistic_sla_market_receipts_v1'::regclass,
      'programmable_wake_private.real_block_sla_api_observations_v1'::regclass,
      'programmable_wake_private.real_block_sla_exports_v1'::regclass
    ]) and policy.polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'programmable_migrator')]::oid[]
  ),
  7::bigint,
  'only the migrator owns table policies'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_projector_runtime', 'programmable_projector',
      'programmable_api_reader', 'programmable_projector_runtime_login'
    ]) as denied(role_name)
    cross join pg_catalog.unnest(array[
      'programmable_wake_private.quicknode_wake_delivery_receipts_v2',
      'programmable_wake_private.real_block_sla_provider_retry_arms_v1',
      'programmable_wake_private.real_block_sla_provider_retry_consumptions_v1',
      'programmable_wake_private.optimistic_sla_bundle_receipts_v1',
      'programmable_wake_private.optimistic_sla_market_receipts_v1',
      'programmable_wake_private.real_block_sla_api_observations_v1',
      'programmable_wake_private.real_block_sla_exports_v1'
    ]) as relation(table_name)
    where pg_catalog.has_table_privilege(
      denied.role_name, relation.table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
    )
  ),
  'no runtime, browser, reader, service or login role has raw receipt-table access'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner_role on owner_role.oid = procedure.proowner
    where namespace.nspname = 'programmable_wake_private'
      and procedure.proname in (
        'enqueue_quicknode_wake_v2', 'acknowledge_quicknode_wake_v2',
        'real_block_sla_promoted_product_is_bound_v1',
        'arm_real_block_sla_provider_retry_once_v1',
        'consume_real_block_sla_provider_retry_once_v1',
        'record_optimistic_sla_bundle_v1', 'record_optimistic_sla_market_v1',
        'record_optimistic_sla_receipt_group_v1',
        'record_real_block_sla_api_observation_v1',
        'record_real_block_sla_api_observation_pair_v1',
        'get_real_block_sla_capture_target_v1',
        'get_real_block_sla_capture_target_for_arm_v1',
        'get_real_block_sla_capture_stage_v1',
        'get_real_block_sla_retry_schedule_v1', 'create_real_block_sla_export_v1'
      )
      and (not procedure.prosecdef or 'search_path=""' <> all(procedure.proconfig)
        or owner_role.rolname <> 'programmable_migrator')
  ),
  'every SLA API is an empty-search-path migrator SECURITY DEFINER'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.enqueue_quicknode_wake_v2(bytea,bigint,text,timestamp with time zone,text,bytea,timestamp with time zone,text,text,text,text,text)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.arm_real_block_sla_provider_retry_once_v1(text,text,text,text,text)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.consume_real_block_sla_provider_retry_once_v1(bigint,bigint)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_wake_private.consume_real_block_sla_provider_retry_once_v1(bigint,bigint)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'programmable_projector_runtime_login',
    'programmable_wake_private.enqueue_quicknode_wake_v2(bytea,bigint,text,timestamp with time zone,text,bytea,timestamp with time zone,text,text,text,text,text)',
    'EXECUTE'
  ),
  'queue receipt append belongs only to the selected runtime capability'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_wake_private.record_optimistic_sla_receipt_group_v1(bigint,uuid,bytea,text,text,bigint,bytea,timestamp with time zone,bigint,bytea,timestamp with time zone,smallint,smallint,smallint,smallint,jsonb)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_wake_private.record_optimistic_sla_bundle_v1(bigint,uuid,bytea,text,text,bigint,bytea,timestamp with time zone,bigint,bytea,timestamp with time zone,smallint,smallint,smallint,smallint)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_wake_private.record_optimistic_sla_market_v1(bigint,uuid,bigint,bytea,timestamp with time zone,bigint,bytea,timestamp with time zone,smallint,smallint,smallint,smallint)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.record_optimistic_sla_receipt_group_v1(bigint,uuid,bytea,text,text,bigint,bytea,timestamp with time zone,bigint,bytea,timestamp with time zone,smallint,smallint,smallint,smallint,jsonb)',
    'EXECUTE'
  ),
  'the atomic receipt group is the sole projector-executable SLA receipt writer'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.record_real_block_sla_api_observation_pair_v1(bigint,uuid,smallint,text,bytea,smallint,text,bytea)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'public',
    'programmable_wake_private.record_real_block_sla_api_observation_pair_v1(bigint,uuid,smallint,text,bytea,smallint,text,bytea)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.record_real_block_sla_api_observation_v1(bigint,uuid,text,smallint,text,bytea)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.get_real_block_sla_capture_stage_v1(bigint)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.get_real_block_sla_capture_target_for_arm_v1(uuid)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'public',
    'programmable_wake_private.get_real_block_sla_capture_target_for_arm_v1(uuid)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.get_real_block_sla_retry_schedule_v1(bigint)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'public',
    'programmable_wake_private.get_real_block_sla_retry_schedule_v1(bigint)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'programmable_projector_runtime',
    'programmable_wake_private.create_real_block_sla_export_v1(bigint,bytea)',
    'EXECUTE'
  ),
  'narrow runtime capability alone records API bytes and challenge export'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.enqueue_quicknode_wake_v2(bytea,bigint,text,timestamp with time zone,text,bytea,timestamp with time zone,text,text,text,text,text)'::regprocedure
    ),
    'database_now' || E',\n    database_now'
  ) > 0,
  'delivery receipt uses the DB clock for handler and database receipt time'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.record_real_block_sla_api_observation_v1(bigint,uuid,text,smallint,text,bytea)'::regprocedure
    ),
    'pg_catalog.sha256(p_response_body)'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.record_real_block_sla_api_observation_v1(bigint,uuid,text,smallint,text,bytea)'::regprocedure
    ),
    'optimisticMarketStateId'
  ) > 0,
  'API capture hashes exact bytes and verifies the persisted market binder in DB'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.create_real_block_sla_export_v1(bigint,bytea)'::regprocedure
    ),
    'challenge_sha256'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.create_real_block_sla_export_v1(bigint,bytea)'::regprocedure
    ),
    'jsonb_array_length'
  ) > 0,
  'export is one-time-challenge bound and requires both matching API receipts'
);

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
      and owner_role.rolname = 'programmable_migrator'
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = procedure.proowner
    where namespace.nspname = 'programmable_private'
      and procedure.proname = 'append_optimistic_market_state_v2'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.append_optimistic_market_state_v2(uuid,uuid,bytea,bytea,bytea,bytea,numeric,integer,numeric,integer,integer,bytea,bytea,bytea,bytea,jsonb,bytea,uuid,uuid,text,text,bytea,bytea,bytea,bytea,bigint,bigint,smallint,smallint,smallint,smallint,smallint,smallint,smallint,bytea,timestamp with time zone)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.append_optimistic_market_state_v2(uuid,uuid,bytea,bytea,bytea,bytea,numeric,integer,numeric,integer,integer,bytea,bytea,bytea,bytea,jsonb,bytea,uuid,uuid,text,text,bytea,bytea,bytea,bytea,bigint,bigint,smallint,smallint,smallint,smallint,smallint,smallint,smallint,bytea,timestamp with time zone)',
    'EXECUTE'
  ),
  'dynamic market append is a projector-only empty-path SECURITY DEFINER'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
      'programmable_private.optimistic_market_state_rows_v1'::regclass
      and constraint_row.conname in (
        'optimistic_market_state_block_calls_a_v2_check',
        'optimistic_market_state_block_calls_b_v2_check',
        'optimistic_market_state_market_calls_a_v2_check',
        'optimistic_market_state_market_calls_b_v2_check',
        'optimistic_market_state_total_calls_a_v2_check',
        'optimistic_market_state_total_calls_b_v2_check'
      )
      and (
        pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%BETWEEN 4 AND 5%'
        or pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%BETWEEN 7 AND 8%'
        or pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%>=%'
      )
  ),
  6::bigint,
  'persisted market rows accept measured target/head counts and bounded aggregate totals'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.record_optimistic_sla_bundle_v1(bigint,uuid,bytea,text,text,bigint,bytea,timestamp with time zone,bigint,bytea,timestamp with time zone,smallint,smallint,smallint,smallint)'::regprocedure
    ),
    'p_block_provider_a_head = p_block_provider_b_head'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_wake_private.record_optimistic_sla_market_v1(bigint,uuid,bigint,bytea,timestamp with time zone,bigint,bytea,timestamp with time zone,smallint,smallint,smallint,smallint)'::regprocedure
    ),
    'p_market_provider_a_head = bundle.block_provider_a_head'
  ) > 0,
  'same-height A/B and cross-phase provider head hashes are fail-closed'
);

create function pg_temp.expire_sla_retry_arm_v1(p_arm_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  expired_at timestamptz := pg_catalog.clock_timestamp() - interval '10 minutes';
begin
  update programmable_wake_private.real_block_sla_provider_retry_arms_v1
  set armed_at = expired_at,
      expires_at = expired_at + interval '5 minutes'
  where arm_id = p_arm_id and state = 'armed';
end
$function$;

create function pg_temp.prune_sla_wake_and_keep_tombstone_v1(p_wake_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  delete from programmable_wake_private.quicknode_wake_jobs_v1
  where wake_id = p_wake_id;
  return exists (
    select 1
    from programmable_wake_private.real_block_sla_provider_retry_arms_v1 as arm
    where arm.state = 'consumed'
      and arm.consumed_wake_id = p_wake_id
      and arm.consumed_delivery_receipt_id is not null
      and pg_catalog.octet_length(arm.consumed_payload_digest) = 32
  ) and exists (
    select 1
    from programmable_wake_private.real_block_sla_provider_retry_consumptions_v1 as consumption
    where consumption.wake_id = p_wake_id
      and consumption.delivery_receipt_id is not null
      and consumption.block_number_hint = 901
      and pg_catalog.octet_length(consumption.payload_digest) = 32
  );
end
$function$;

create function pg_temp.delay_quicknode_job_persistence_v1()
returns trigger
language plpgsql
as $function$
begin
  perform pg_catalog.pg_sleep(0.01);
  new.received_at := pg_catalog.clock_timestamp();
  new.available_at := new.received_at;
  new.expires_at := new.received_at + interval '2 hours';
  return new;
end
$function$;

create trigger test_delay_quicknode_job_persistence_v1
before insert on programmable_wake_private.quicknode_wake_jobs_v1
for each row execute function pg_temp.delay_quicknode_job_persistence_v1();

create function pg_temp.set_sla_duplicate_delay_v1(
  p_wake_id bigint,
  p_delay interval
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  initial programmable_wake_private.quicknode_wake_delivery_receipts_v2%rowtype;
  shifted_at timestamptz;
begin
  select * into initial
  from programmable_wake_private.quicknode_wake_delivery_receipts_v2
  where wake_id = p_wake_id and enqueued
  order by delivery_receipt_id
  limit 1;
  shifted_at := initial.database_received_at + p_delay;
  update programmable_wake_private.quicknode_wake_delivery_receipts_v2
  set handler_received_at = shifted_at,
      database_received_at = shifted_at,
      acknowledged_at = shifted_at,
      expires_at = shifted_at + interval '2 hours'
  where wake_id = p_wake_id and not enqueued;
end
$function$;

create function pg_temp.sla_market_receipts_v1(
  p_bad_second_hash boolean default false
)
returns jsonb
language sql
volatile
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'optimisticMarketStateId', '74000000-0000-4000-8000-000000000004',
      'marketProviderAHead', '902',
      'marketProviderAHeadHash', '0x' || pg_catalog.repeat('61', 32),
      'marketProviderAObservedAt', pg_catalog.clock_timestamp()::text,
      'marketProviderBHead', '902',
      'marketProviderBHeadHash', '0x' || pg_catalog.repeat('61', 32),
      'marketProviderBObservedAt', pg_catalog.clock_timestamp()::text,
      'marketProviderCallCountA', 8,
      'marketProviderCallCountB', 8,
      'totalProviderCallCountA', 23,
      'totalProviderCallCountB', 23
    ),
    pg_catalog.jsonb_build_object(
      'optimisticMarketStateId', '74000000-0000-4000-8000-000000000014',
      'marketProviderAHead', '902',
      'marketProviderAHeadHash', '0x' || pg_catalog.repeat('61', 32),
      'marketProviderAObservedAt', pg_catalog.clock_timestamp()::text,
      'marketProviderBHead', '902',
      'marketProviderBHeadHash', '0x' || pg_catalog.repeat(
        case when p_bad_second_hash then '62' else '61' end,
        32
      ),
      'marketProviderBObservedAt', pg_catalog.clock_timestamp()::text,
      'marketProviderCallCountA', 8,
      'marketProviderCallCountB', 8,
      'totalProviderCallCountA', 23,
      'totalProviderCallCountB', 23
    )
  )
$function$;

create function pg_temp.sla_receipt_row_count_v1()
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select pg_catalog.count(*) from programmable_wake_private.optimistic_sla_bundle_receipts_v1)
    +
    (select pg_catalog.count(*) from programmable_wake_private.optimistic_sla_market_receipts_v1)
$function$;

create function pg_temp.sla_api_observation_row_count_v1()
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.count(*)
  from programmable_wake_private.real_block_sla_api_observations_v1
$function$;

create function pg_temp.record_sla_group_v1(
  p_metadata_count_a smallint default 2,
  p_metadata_count_b smallint default 2,
  p_block_count_a smallint default 5,
  p_block_hash_b text default '61',
  p_bad_second_hash boolean default false
)
returns bigint
language sql
volatile
set search_path = ''
as $function$
  select programmable_wake_private.record_optimistic_sla_receipt_group_v1(
    1,
    '73000000-0000-4000-8000-000000000003',
    pg_catalog.decode(pg_catalog.repeat('59', 32), 'hex'),
    'lb.drpc.live',
    'late-bold-field.ethereum-mainnet.quiknode.pro',
    902,
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
    pg_catalog.clock_timestamp(),
    902,
    pg_catalog.decode(pg_catalog.repeat(p_block_hash_b, 32), 'hex'),
    pg_catalog.clock_timestamp(),
    p_block_count_a,
    5::smallint,
    p_metadata_count_a,
    p_metadata_count_b,
    pg_temp.sla_market_receipts_v1(p_bad_second_hash)
  )
$function$;

create function pg_temp.sla_projection_execution_evidence_v1()
returns table (
  execution_trace jsonb,
  trace_commitment bytea,
  canonical_preimage bytea,
  content_fingerprint bytea
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  trace jsonb := pg_catalog.jsonb_build_object(
    'startedAtMs', 1775000000000,
    'completedAtMs', 1775000000005,
    'candidateBatchSize', 1,
    'hardDeadlineMs', 75000,
    'maxCallsPerProvider', 128,
    'elapsedMs', 5,
    'providerCallCounts', pg_catalog.jsonb_build_array(1, 1),
    'calls', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'providerIdentity', 'drpc-mainnet-' || pg_catalog.repeat('31', 16),
        'providerVendorGroup', 'drpc',
        'providerEndpointCommitment', '0x' || pg_catalog.repeat('33', 32),
        'providerOriginCommitment', '0x' || pg_catalog.repeat('34', 32),
        'operation', 'getBlock', 'attempt', 1,
        'startedOffsetMs', 0, 'durationMs', 1, 'outcome', 'success'
      ),
      pg_catalog.jsonb_build_object(
        'providerIdentity', 'quicknode-mainnet-' || pg_catalog.repeat('41', 16),
        'providerVendorGroup', 'quicknode',
        'providerEndpointCommitment', '0x' || pg_catalog.repeat('43', 32),
        'providerOriginCommitment', '0x' || pg_catalog.repeat('44', 32),
        'operation', 'getBlock', 'attempt', 1,
        'startedOffsetMs', 1, 'durationMs', 1, 'outcome', 'success'
      )
    )
  );
  trace_hash bytea;
  evidence_preimage bytea;
begin
  trace_hash := programmable_private.projection_execution_trace_commitment_v1(trace);
  evidence_preimage := programmable_private.projection_execution_evidence_preimage_v1(
    1, 'classic-v2', 'classic', 'core',
    '78000000-0000-4000-8000-000000000008', 1,
    '7b000000-0000-4000-8000-00000000000b',
    '78900000-0000-4000-8000-000000000001',
    '78900000-0000-4000-8000-000000000002',
    'drpc-mainnet-' || pg_catalog.repeat('31', 16),
    'quicknode-mainnet-' || pg_catalog.repeat('41', 16),
    'drpc', 'quicknode',
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
    1, 1, 1, 75000, 128, 5, trace_hash
  );
  return query select trace, trace_hash, evidence_preimage,
    pg_catalog.sha256(evidence_preimage);
end
$function$;

create function pg_temp.sla_provider_binding_commitment_v1()
returns bytea
language sql
stable
security definer
set search_path = ''
as $function$
  select programmable_private.projection_provider_binding_commitment_v1(
    '7c000000-0000-4000-8000-00000000000c',
    '7b000000-0000-4000-8000-00000000000b',
    'exact_incremental',
    '7f000000-0000-4000-8000-00000000000f',
    array[]::uuid[],
    '2026-08-02T12:00:03.300Z'
  )
$function$;

set role programmable_projector;

select programmable_private.register_provider_deployment(
  'd08b62a6-74fb-5e0a-a698-dc6877150db4',
  'envio_deployment',
  'envio:production-7f24e63',
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
);

select programmable_private.initialize_candidate_database(
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
    'e3218e30a2a95927427fe5e523a8f721fa0d7826dffaecb7140a126a56d17a44',
    'hex'
  ),
  '2026-07-31T00:00:00Z'
);

reset role;
set session authorization programmable_projector_runtime_login;
set role programmable_projector_runtime;

select throws_ok(
  $sql$
    select programmable_wake_private.arm_real_block_sla_provider_retry_once_v1(
      repeat('a', 40), 'dpl_12345678901234567890',
      'https://programmable-main.vercel.app', 'prj_programmable_main',
      'stream-before-database-promotion'
    )
  $sql$,
  '55000',
  'SLA provider retry requires its promoted staged product and a published Classic launch',
  'retry arming is rejected before product-bound database promotion and publication'
);

reset role;
reset session authorization;
set session authorization postgres;
set role programmable_operator;

select programmable_private.attest_candidate_database_promotion(
  'd08b62a6-74fb-5e0a-a698-dc6877150db4',
  pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
  pg_catalog.repeat('a', 40),
  'dpl_12345678901234567890',
  '2026-08-02T12:00:00Z'
);

reset role;
reset session authorization;

-- Build one reachable Classic publication through the same epoch, occurrence,
-- staging and publication APIs used by a real promoted Candidate. This is
-- deliberately longer than the former impossible replication-trigger bypass.
set role programmable_projector;

select programmable_private.create_release_epoch(
  '78000000-0000-4000-8000-000000000008',
  1, 'classic-v2', 'classic', 'core', 1,
  decode(repeat('18', 32), 'hex'), decode(repeat('19', 32), 'hex'),
  decode(repeat('1a', 32), 'hex'), '2026-08-02T12:00:01Z'
);
select programmable_private.append_release_source_binding(
  '78100000-0000-4000-8000-000000000001',
  '78000000-0000-4000-8000-000000000008',
  'ClassicV2Launcher', 'launcher', 'ethereum_contract',
  decode(repeat('11', 20), 'hex'), decode('19b3284b', 'hex'), 1,
  decode(repeat('1b', 32), 'hex'), decode(repeat('19', 32), 'hex'),
  decode(repeat('1c', 32), 'hex'), decode(repeat('1d', 32), 'hex'),
  '2026-08-02T12:00:01.100Z'
);
select programmable_private.append_release_projection_event_rule(
  rule_id, '78000000-0000-4000-8000-000000000008', projection_kind,
  'launcher', 'MemeTokenLaunched', commitment,
  '2026-08-02T12:00:01.200Z'
)
from (values
  ('78200000-0000-4000-8000-000000000001'::uuid, 'launch', decode(repeat('21', 32), 'hex')),
  ('78200000-0000-4000-8000-000000000002'::uuid, 'pool', decode(repeat('22', 32), 'hex')),
  ('78200000-0000-4000-8000-000000000003'::uuid, 'pool_fee_configuration', decode(repeat('23', 32), 'hex')),
  ('78200000-0000-4000-8000-000000000004'::uuid, 'launch_requirement', decode(repeat('24', 32), 'hex'))
) as rule(rule_id, projection_kind, commitment);
select programmable_private.append_release_launch_requirement(
  '78300000-0000-4000-8000-000000000001',
  '78000000-0000-4000-8000-000000000008', 0,
  'launcher', 'MemeTokenLaunched', 'always',
  decode(repeat('25', 32), 'hex'), '2026-08-02T12:00:01.300Z'
);
select programmable_private.activate_release_epoch(
  1, 'classic-v2', 'classic', 'core',
  '78000000-0000-4000-8000-000000000008', 0, 1,
  decode(repeat('26', 32), 'hex'), '2026-08-02T12:00:01.400Z'
);
select programmable_private.register_rpc_provider_deployment(
  '78900000-0000-4000-8000-000000000001', 1,
  'drpc', 'sla-publication-v1',
  decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('35', 32), 'hex'),
  decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
  decode(repeat('36', 32), 'hex'), '2026-08-02T12:00:01.500Z'
);
select programmable_private.register_rpc_provider_deployment(
  '78900000-0000-4000-8000-000000000002', 1,
  'quicknode', 'sla-publication-v1',
  decode(repeat('43', 32), 'hex'), decode(repeat('44', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('45', 32), 'hex'),
  decode(repeat('41', 32), 'hex'), decode(repeat('42', 32), 'hex'),
  decode(repeat('46', 32), 'hex'), '2026-08-02T12:00:01.600Z'
);
select programmable_private.open_run(
  '78400000-0000-4000-8000-000000000001',
  'ingestion', 1, 'envio-control', 'envio-control', 'canonical-events',
  '70000000-0000-0000-0000-000000000002', 1,
  'envio-adapter-v1', decode(repeat('47', 32), 'hex'),
  '2026-08-02T12:00:01.700Z'
);
select programmable_private.open_run(
  '78400000-0000-4000-8000-000000000002',
  'ingestion', 1, 'classic-v2', 'classic', 'core',
  '78000000-0000-4000-8000-000000000008', 1,
  'projector-v1', decode(repeat('48', 32), 'hex'),
  '2026-08-02T12:00:01.800Z'
);
select programmable_private.append_safe_head_observation(
  '78500000-0000-4000-8000-000000000001',
  '78400000-0000-4000-8000-000000000002',
  '78900000-0000-4000-8000-000000000001',
  '78900000-0000-4000-8000-000000000002',
  1, 1, 913, 913, 12, 901,
  decode(repeat('61', 32), 'hex'), decode(repeat('61', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000121', 'hex'),
  decode(repeat('49', 32), 'hex'), '2026-08-02T12:00:02Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  '78600000-0000-4000-8000-000000000001',
  '78500000-0000-4000-8000-000000000001',
  '78400000-0000-4000-8000-000000000002',
  901, decode(repeat('aa', 32), 'hex'), decode(repeat('aa', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000221', 'hex'),
  decode(repeat('4a', 32), 'hex'), '2026-08-02T12:00:02.100Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('aa', 32), 'hex'), decode(repeat('74', 32), 'hex'), 0
  ),
  '78400000-0000-4000-8000-000000000002',
  901, decode(repeat('aa', 32), 'hex'), decode(repeat('74', 32), 'hex'),
  0, 0, decode(repeat('11', 20), 'hex'), decode(repeat('72', 32), 'hex'),
  'MemeTokenLaunched', array[decode(repeat('72', 32), 'hex')],
  decode('01', 'hex'), '{"token":"0x1111111111111111111111111111111111111111"}'::jsonb,
  decode(repeat('73', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('aa', 32), 'hex'), decode(repeat('74', 32), 'hex'), 0
  ),
  'd08b62a6-74fb-5e0a-a698-dc6877150db4',
  decode(repeat('75', 32), 'hex'), '2026-08-02T12:00:02.200Z'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('aa', 32), 'hex'), decode(repeat('74', 32), 'hex'), 0
  ),
  '78400000-0000-4000-8000-000000000001',
  901, decode(repeat('aa', 32), 'hex'), decode(repeat('74', 32), 'hex'),
  0, 0, decode(repeat('11', 20), 'hex'), decode(repeat('72', 32), 'hex'),
  'MemeTokenLaunched', array[decode(repeat('72', 32), 'hex')],
  decode('01', 'hex'), '{"token":"0x1111111111111111111111111111111111111111"}'::jsonb,
  decode(repeat('73', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('aa', 32), 'hex'), decode(repeat('74', 32), 'hex'), 0
  ),
  'd08b62a6-74fb-5e0a-a698-dc6877150db4',
  decode(repeat('75', 32), 'hex'), '2026-08-02T12:00:02.300Z',
  'canonical-events', 'ClassicV2Launcher'
);
select programmable_private.resolve_envio_candidate(
  '78700000-0000-4000-8000-000000000001',
  '78400000-0000-4000-8000-000000000002',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('aa', 32), 'hex'), decode(repeat('74', 32), 'hex'), 0
  ),
  '78100000-0000-4000-8000-000000000001', null,
  decode(repeat('1b', 32), 'hex'), decode(repeat('76', 32), 'hex'),
  '2026-08-02T12:00:02.400Z'
);
select programmable_private.append_chain_event_occurrence(
  '79000000-0000-4000-8000-000000000009',
  '7a000000-0000-4000-8000-00000000000a',
  '78400000-0000-4000-8000-000000000002',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('aa', 32), 'hex'), decode(repeat('74', 32), 'hex'), 0
  ),
  0, '2026-08-02T11:59:00Z', 'decoder-v1',
  decode(repeat('1b', 32), 'hex'),
  '78600000-0000-4000-8000-000000000001', 1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310021', 'hex'),
  decode(repeat('77', 32), 'hex'), '2026-08-02T12:00:02.500Z'
);
select programmable_private.acquire_projector_lease(
  1, 'classic-v2', 'classic', 'core', 'projector-v1',
  '78000000-0000-4000-8000-000000000008', 1,
  0, 1, decode(repeat('78', 32), 'hex'), 'sla-worker',
  '2026-08-02T12:00:02.600Z', '2026-08-02T12:10:02.600Z',
  decode(repeat('79', 32), 'hex')
);
select programmable_private.open_run(
  '7b000000-0000-4000-8000-00000000000b',
  'projection', 1, 'classic-v2', 'classic', 'core',
  '78000000-0000-4000-8000-000000000008', 1,
  'projector-v1', decode(repeat('7a', 32), 'hex'),
  '2026-08-02T12:00:02.700Z'
);
select programmable_private.stage_launch_projection(
  '77000000-0000-4000-8000-000000000007',
  '7b000000-0000-4000-8000-00000000000b',
  decode(repeat('11', 20), 'hex'), decode(repeat('13', 20), 'hex'),
  decode(repeat('74', 32), 'hex'), decode(repeat('55', 32), 'hex'),
  null, decode(repeat('75', 32), 'hex'), 'SLA Token', 'SLA', 1,
  '7a000000-0000-4000-8000-00000000000a',
  901, decode(repeat('aa', 32), 'hex'), '2026-08-02T12:00:02.800Z'
);
select programmable_private.stage_pool_projection(
  '77100000-0000-4000-8000-000000000001',
  '77000000-0000-4000-8000-000000000007',
  '7b000000-0000-4000-8000-00000000000b',
  decode(repeat('00', 20), 'hex'), decode(repeat('11', 20), 'hex'),
  3000, 60, decode(repeat('14', 20), 'hex'),
  '7a000000-0000-4000-8000-00000000000a',
  901, decode(repeat('aa', 32), 'hex'), '2026-08-02T12:00:02.900Z'
);
select programmable_private.stage_pool_fee_configuration(
  '77200000-0000-4000-8000-000000000001',
  '77100000-0000-4000-8000-000000000001',
  '7b000000-0000-4000-8000-00000000000b',
  100, 100, 90, 10, 0, 0,
  '7a000000-0000-4000-8000-00000000000a',
  901, decode(repeat('aa', 32), 'hex'), '2026-08-02T12:00:03Z'
);
select programmable_private.stage_launch_occurrence_role(
  '77000000-0000-4000-8000-000000000007', 'launcher',
  '7a000000-0000-4000-8000-00000000000a', '2026-08-02T12:00:03.100Z'
);
select programmable_private.stage_launch_projection_conditions(
  '77000000-0000-4000-8000-000000000007', false,
  '2026-08-02T12:00:03.200Z'
);
select programmable_private.append_projection_provider_execution_evidence_v1(
  '7f000000-0000-4000-8000-00000000000f',
  '7b000000-0000-4000-8000-00000000000b',
  '78500000-0000-4000-8000-000000000001',
  array[
    'd08b62a6-74fb-5e0a-a698-dc6877150db4'::uuid,
    '78900000-0000-4000-8000-000000000001'::uuid,
    '78900000-0000-4000-8000-000000000002'::uuid
  ],
  evidence.execution_trace,
  evidence.trace_commitment,
  3::smallint,
  evidence.canonical_preimage,
  evidence.content_fingerprint,
  '2026-08-02T12:00:03.250Z'
)
from pg_temp.sla_projection_execution_evidence_v1() as evidence;
select programmable_private.promote_projection_run_v3(
  'exact_incremental',
  '7c000000-0000-4000-8000-00000000000c',
  '7d000000-0000-4000-8000-00000000000d',
  '7e000000-0000-4000-8000-00000000000e',
  '7b000000-0000-4000-8000-00000000000b',
  'projector-v1', 1, decode(repeat('78', 32), 'hex'),
  0, 1, 0,
  '78500000-0000-4000-8000-000000000001',
  '78600000-0000-4000-8000-000000000001',
  901, decode(repeat('aa', 32), 'hex'), 0,
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('aa', 32), 'hex'), decode(repeat('74', 32), 'hex'), 0
  ),
  array['7a000000-0000-4000-8000-00000000000a'::uuid],
  array[]::uuid[], array[]::uuid[],
  array['78700000-0000-4000-8000-000000000001'::uuid],
  array['explore-list']::text[],
  decode(repeat('7b', 32), 'hex'),
  '7f000000-0000-4000-8000-00000000000f',
  array[]::uuid[],
  '7f100000-0000-4000-8000-000000000001',
  pg_temp.sla_provider_binding_commitment_v1(),
  '2026-08-02T12:00:03.300Z'
);

reset role;
set session authorization programmable_projector_runtime_login;
set role programmable_projector_runtime;

select ok(
  pg_catalog.set_config(
    'programmable.test_main_arm_id',
    programmable_wake_private.arm_real_block_sla_provider_retry_once_v1(
      pg_catalog.repeat('a', 40), 'dpl_12345678901234567890',
      'https://programmable-main.vercel.app', 'prj_programmable_main',
      'stream-mainnet'
    )::text,
    true
  ) <> '',
  'the exact product-bound promoted Candidate and published stream can be armed once'
);

select pg_catalog.set_config(
  'programmable.test_expired_arm_id',
  programmable_wake_private.arm_real_block_sla_provider_retry_once_v1(
    pg_catalog.repeat('a', 40), 'dpl_12345678901234567890',
    'https://programmable-main.vercel.app', 'prj_programmable_main',
    'stream-expired'
  )::text,
  true
);
select pg_temp.expire_sla_retry_arm_v1(
  pg_catalog.current_setting('programmable.test_expired_arm_id')::uuid
);
select ok(
  programmable_wake_private.arm_real_block_sla_provider_retry_once_v1(
    pg_catalog.repeat('a', 40), 'dpl_12345678901234567890',
    'https://programmable-main.vercel.app', 'prj_programmable_main',
    'stream-expired'
  ) <> pg_catalog.current_setting('programmable.test_expired_arm_id')::uuid,
  'an expired unconsumed arm is pruned and atomically rearmed'
);

reset role;
reset session authorization;
set session authorization programmable_projector_runtime_login;
set role programmable_projector_runtime;

select ok(
  (
    with initial_enqueue as materialized (
      select *
      from programmable_wake_private.enqueue_quicknode_wake_v2(
        pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
        901,
        '{"chainId":1,"blockNumber":"901","streamId":"stream-mainnet","reorgedBlockNumbers":[]}',
        pg_catalog.clock_timestamp(),
        '{"data":[{"number":"0x385"}]}',
        pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
        pg_catalog.clock_timestamp(),
        'stream-mainnet',
        pg_catalog.repeat('a', 40),
        'dpl_12345678901234567890',
        'https://programmable-main.vercel.app',
        'prj_programmable_main'
      )
    ),
    initial_ack as materialized (
      select acknowledgement.*
      from initial_enqueue
      cross join lateral programmable_wake_private.acknowledge_quicknode_wake_v2(
        initial_enqueue.delivery_receipt_id,
        initial_enqueue.wake_id
      ) as acknowledgement
    ),
    duplicate_enqueue as materialized (
      select duplicate_receipt.*
      from initial_ack
      cross join lateral programmable_wake_private.enqueue_quicknode_wake_v2(
        pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex'),
        901 + (initial_ack.response_status - 202),
        '{"chainId":1,"blockNumber":"901","streamId":"stream-mainnet","reorgedBlockNumbers":[]}',
        pg_catalog.clock_timestamp(),
        '{"data":[{"number":"0x385"}]}',
        pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
        pg_catalog.clock_timestamp(),
        'stream-mainnet',
        pg_catalog.repeat('a', 40),
        'dpl_12345678901234567890',
        'https://programmable-main.vercel.app',
        'prj_programmable_main'
      ) as duplicate_receipt
      where initial_ack.response_status = 202
    ),
    duplicate_ack as materialized (
      select acknowledgement.*
      from duplicate_enqueue
      cross join lateral programmable_wake_private.acknowledge_quicknode_wake_v2(
        duplicate_enqueue.delivery_receipt_id,
        duplicate_enqueue.wake_id
      ) as acknowledgement
    )
    select initial_enqueue.enqueued
      and initial_enqueue.database_received_at < initial_enqueue.job_persisted_at
      and initial_enqueue.job_persisted_at - initial_enqueue.database_received_at >
        interval '1 millisecond'
      and initial_enqueue.job_persisted_at <= initial_ack.acknowledged_at
      and not duplicate_enqueue.enqueued
      and duplicate_enqueue.wake_id = initial_enqueue.wake_id
      and duplicate_enqueue.delivery_receipt_id <>
        initial_enqueue.delivery_receipt_id
      and duplicate_enqueue.job_persisted_at = initial_enqueue.job_persisted_at
      and duplicate_enqueue.job_persisted_at <= duplicate_enqueue.database_received_at
      and duplicate_enqueue.database_received_at <= duplicate_ack.acknowledged_at
    from initial_enqueue, initial_ack, duplicate_enqueue, duplicate_ack
  ),
  'DB-first receive precedes durable insert by >1ms; initial and duplicate ACK orderings hold'
);

select is(
  programmable_wake_private.get_real_block_sla_delivery_receipt_v1(1),
  null::bigint,
  'a normal initial 202 is not SLA-capture eligible before arm consumption'
);

select ok(
  not exists (
    select 1
    from programmable_wake_private.get_real_block_sla_capture_target_for_arm_v1(
      pg_catalog.current_setting('programmable.test_main_arm_id')::uuid
    )
  )
  and not exists (
    select 1
    from programmable_wake_private.get_real_block_sla_capture_target_for_arm_v1(
      '00000000-0000-4000-8000-000000000099'
    )
  ),
  'an unconsumed or unknown arm cannot disclose a delivery receipt'
);

select is(
  programmable_wake_private.consume_real_block_sla_provider_retry_once_v1(1, 1),
  true,
  'the acknowledged initial delivery atomically consumes the staged provider retry'
);

select is(
  programmable_wake_private.consume_real_block_sla_provider_retry_once_v1(1, 1),
  false,
  'the same initial delivery cannot consume the staged provider retry twice'
);

select is(
  programmable_wake_private.consume_real_block_sla_provider_retry_once_v1(2, 1),
  false,
  'a duplicate delivery receipt cannot arm the staged provider retry'
);

select throws_ok(
  $sql$
    select programmable_wake_private.consume_real_block_sla_provider_retry_once_v1(1, 2)
  $sql$,
  '22023',
  'invalid SLA provider retry receipt binding',
  'a mismatched wake and delivery receipt binding is rejected'
);

select ok(
  (
    select schedule.deadline_at > schedule.available_at
      and schedule.deadline_at <= schedule.available_at + interval '10 seconds'
    from programmable_wake_private.get_real_block_sla_retry_schedule_v1(1) as schedule
  )
  and not exists (
    select 1
    from programmable_wake_private.get_real_block_sla_retry_schedule_v1(999) as missing
  ),
  'the DB exposes only the pending consumed-arm retry inside its ten-second deadline'
);

select is(
  (
    select stage.stage_state
    from programmable_wake_private.get_real_block_sla_capture_stage_v1(1) as stage
  ),
  'needs-ingest',
  'an eligible forced retry remains needs-ingest until its atomic receipt group exists'
);

reset role;
reset session authorization;

set session authorization programmable_projector_login;
set role programmable_projector;

select programmable_private.append_optimistic_block_observation_v1(
  '73000000-0000-4000-8000-000000000003',
  1,
  901,
  pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp() - interval '1 minute',
  '78900000-0000-4000-8000-000000000001',
  '78900000-0000-4000-8000-000000000002',
  902,
  902,
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  pg_catalog.clock_timestamp()
);

select programmable_private.append_optimistic_event_row_v1(
  '76000000-0000-4000-8000-000000000006',
  '73000000-0000-4000-8000-000000000003',
  pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex'),
  0,
  0,
  pg_catalog.decode(pg_catalog.repeat('11', 20), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex'),
  array[pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex')],
  pg_catalog.decode('01', 'hex'),
  '{"kind":"metadata","tokenMetadata":{"symbol":"SLA"}}'::jsonb,
  pg_catalog.decode(pg_catalog.repeat('73', 32), 'hex'),
  pg_catalog.clock_timestamp()
);

select programmable_private.append_optimistic_market_state_v2(
  '74000000-0000-4000-8000-000000000004',
  '73000000-0000-4000-8000-000000000003',
  pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('11', 20), 'hex'),
  pg_catalog.decode('7ffe42c4a5deea5b0fec41c94c136cf115597227', 'hex'),
  pg_catalog.decode(
    'd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878',
    'hex'
  ),
  1,
  0,
  1000,
  0,
  3000,
  pg_catalog.decode(pg_catalog.repeat('01', 128), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('01', 128), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  '{"indexedValuationBlockNumber":"901","currentTick":0,"activeLiquidity":"1000"}'::jsonb,
  pg_catalog.decode(pg_catalog.repeat('56', 32), 'hex'),
  '78900000-0000-4000-8000-000000000001',
  '78900000-0000-4000-8000-000000000002',
  'drpc-mainnet-31313131313131313131313131313131',
  'quicknode-mainnet-41414141414141414141414141414141',
  pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
  902,
  902,
  5::smallint,
  5::smallint,
  8::smallint,
  8::smallint,
  23::smallint,
  23::smallint,
  1::smallint,
  pg_catalog.decode(pg_catalog.repeat('57', 32), 'hex'),
  pg_catalog.clock_timestamp()
);

select programmable_private.append_optimistic_market_state_v2(
  '74000000-0000-4000-8000-000000000014',
  '73000000-0000-4000-8000-000000000003',
  pg_catalog.decode(pg_catalog.repeat('66', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('12', 20), 'hex'),
  pg_catalog.decode('7ffe42c4a5deea5b0fec41c94c136cf115597227', 'hex'),
  pg_catalog.decode(
    'd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878',
    'hex'
  ),
  1,
  0,
  1000,
  0,
  3000,
  pg_catalog.decode(pg_catalog.repeat('01', 128), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('01', 128), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  '{"indexedValuationBlockNumber":"901","currentTick":0,"activeLiquidity":"1000"}'::jsonb,
  pg_catalog.decode(pg_catalog.repeat('67', 32), 'hex'),
  '78900000-0000-4000-8000-000000000001',
  '78900000-0000-4000-8000-000000000002',
  'drpc-mainnet-31313131313131313131313131313131',
  'quicknode-mainnet-41414141414141414141414141414141',
  pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
  902,
  902,
  5::smallint,
  5::smallint,
  8::smallint,
  8::smallint,
  23::smallint,
  23::smallint,
  1::smallint,
  pg_catalog.decode(pg_catalog.repeat('68', 32), 'hex'),
  pg_catalog.clock_timestamp()
);

select programmable_private.promote_optimistic_block_canonical_v1(
  '73000000-0000-4000-8000-000000000003',
  null,
  '75000000-0000-4000-8000-000000000005',
  null,
  pg_catalog.decode(pg_catalog.repeat('58', 32), 'hex'),
  pg_catalog.clock_timestamp()
);

select throws_ok(
  $sql$
    select pg_temp.record_sla_group_v1(2::smallint, 2::smallint, 5::smallint, '62')
  $sql$,
  '22023',
  'invalid optimistic SLA provider evidence',
  'bundle receipt rejects divergent A/B hashes observed at the same later head'
);

select throws_ok(
  $sql$
    select pg_temp.record_sla_group_v1(2::smallint, 2::smallint, 4::smallint)
  $sql$,
  '22023',
  'invalid optimistic SLA provider evidence',
  'bundle receipt rejects a target-only count for an observed later head'
);

select throws_ok(
  $sql$
    select pg_temp.record_sla_group_v1(0::smallint, 2::smallint)
  $sql$,
  '22023',
  'invalid optimistic SLA metadata evidence',
  'metadata receipt rejects an under-budget provider count'
);

select throws_ok(
  $sql$
    select pg_temp.record_sla_group_v1(3::smallint, 2::smallint)
  $sql$,
  '22023',
  'invalid optimistic SLA provider evidence',
  'metadata receipt rejects an odd provider count'
);

select throws_ok(
  $sql$
    select pg_temp.record_sla_group_v1(8::smallint, 2::smallint)
  $sql$,
  '22023',
  'invalid optimistic SLA metadata evidence',
  'metadata receipt rejects a provider count above three attempts per token'
);

select throws_ok(
  $sql$
    select pg_temp.record_sla_group_v1(
      2::smallint, 2::smallint, 5::smallint, '61', true
    )
  $sql$,
  '22023',
  'invalid optimistic SLA market evidence',
  'a malformed second market aborts the atomic receipt group'
);

select is(
  pg_temp.sla_receipt_row_count_v1(),
  0::bigint,
  'a later market failure rolls back the bundle and the preceding market receipt'
);

select ok(
  pg_temp.record_sla_group_v1() is not null,
  'the exact two-market receipt group succeeds after the rollback'
);

reset role;
reset session authorization;

set session authorization programmable_projector_runtime_login;
set role programmable_projector_runtime;

select is(
  (
    select stage.stage_state
    from programmable_wake_private.get_real_block_sla_capture_stage_v1(1) as stage
  ),
  'needs-capture',
  'the complete atomic receipt group advances the DB stage to needs-capture'
);

select is(
  (
    select target.delivery_receipt_id
    from programmable_wake_private.get_real_block_sla_capture_target_for_arm_v1(
      pg_catalog.current_setting('programmable.test_main_arm_id')::uuid
    ) as target
  ),
  1::bigint,
  'the consumed arm resolves only its product-bound capture-ready initial receipt'
);

select throws_ok(
  $sql$
    select programmable_wake_private.record_real_block_sla_api_observation_pair_v1(
      1,
      '74000000-0000-4000-8000-000000000004',
      200::smallint,
      'no-store',
      pg_catalog.convert_to(
        '{"optimisticOverlay":{"applied":[{"kind":"market","optimisticMarketStateId":"74000000-0000-4000-8000-000000000004","poolId":"0x5555555555555555555555555555555555555555555555555555555555555555","tokenAddress":"0x1111111111111111111111111111111111111111","blockNumber":"901","evidenceCommitment":"0x5757575757575757575757575757575757575757575757575757575757575757","reorgGeneration":"0","releaseVersion":"classic-v3"}]}}',
        'UTF8'
      ),
      200::smallint,
      'no-store',
      pg_catalog.convert_to(
        '{"optimisticOverlay":{"applied":[{"kind":"market","optimisticMarketStateId":"74000000-0000-4000-8000-000000000004","poolId":"0x5555555555555555555555555555555555555555555555555555555555555555","tokenAddress":"0x1111111111111111111111111111111111111111","blockNumber":"901","evidenceCommitment":"0x5757575757575757575757575757575757575757575757575757575757575757","reorgGeneration":"0","releaseVersion":"classic-v3"}]}}',
        'UTF8'
      )
    )
  $sql$,
  '22023',
  'SLA API response is not bound to persisted market state',
  'a Classic v3 body cannot attest the current canonical Classic v2 launch'
);

select is(
  pg_temp.sla_api_observation_row_count_v1(),
  0::bigint,
  'a stale-release pair rejection leaves no partial API observation'
);

select is(
  programmable_wake_private.create_real_block_sla_export_v1(
    1,
    pg_catalog.decode(pg_catalog.repeat('ac', 32), 'hex')
  ),
  null::jsonb,
  'export remains fail-closed until the current canonical Classic release is captured'
);

select throws_ok(
  $sql$
    select programmable_wake_private.record_real_block_sla_api_observation_pair_v1(
      1,
      '74000000-0000-4000-8000-000000000004',
      200::smallint,
      'no-store',
      convert_to(
        '{"probeAttempt":1,"optimisticOverlay":{"applied":[{"kind":"market","optimisticMarketStateId":"74000000-0000-4000-8000-000000000004","poolId":"0x5555555555555555555555555555555555555555555555555555555555555555","tokenAddress":"0x1111111111111111111111111111111111111111","blockNumber":"901","evidenceCommitment":"0x5757575757575757575757575757575757575757575757575757575757575757","reorgGeneration":"0","releaseVersion":"classic-v2"}]}}',
        'UTF8'
      ),
      200::smallint,
      'no-store',
      convert_to('{}', 'UTF8')
    )
  $sql$,
  '22023',
  'missing SLA API optimistic disclosure',
  'a rejected chart observation rolls back the preceding token insert'
);

select is(
  programmable_wake_private.record_real_block_sla_api_observation_pair_v1(
    1,
    '74000000-0000-4000-8000-000000000004',
    200::smallint,
    'no-store',
    pg_catalog.convert_to(
      '{"probeAttempt":2,"optimisticOverlay":{"applied":[{"kind":"market","optimisticMarketStateId":"74000000-0000-4000-8000-000000000004","poolId":"0x5555555555555555555555555555555555555555555555555555555555555555","tokenAddress":"0x1111111111111111111111111111111111111111","blockNumber":"901","evidenceCommitment":"0x5757575757575757575757575757575757575757575757575757575757575757","reorgGeneration":"0","releaseVersion":"classic-v2"}]}}',
      'UTF8'
    ),
    200::smallint,
    'no-store',
    pg_catalog.convert_to(
      '{"optimisticOverlay":{"applied":[{"kind":"market","optimisticMarketStateId":"74000000-0000-4000-8000-000000000004","poolId":"0x5555555555555555555555555555555555555555555555555555555555555555","tokenAddress":"0x1111111111111111111111111111111111111111","blockNumber":"901","evidenceCommitment":"0x5757575757575757575757575757575757575757575757575757575757575757","reorgGeneration":"0","releaseVersion":"classic-v2"}]}}',
      'UTF8'
    )
  ),
  true,
  'a valid Token and Chart pair is inserted atomically after rollback'
);

select is(
  (
    select stage.stage_state
    from programmable_wake_private.get_real_block_sla_capture_stage_v1(1) as stage
  ),
  'complete',
  'both exact API surfaces advance the DB-authored capture stage to complete'
);

select is(
  programmable_wake_private.create_real_block_sla_export_v1(
    1,
    pg_catalog.decode(pg_catalog.repeat('ab', 32), 'hex')
  ) ->> 'kind',
  'programmable-real-block-sla-db-attestation',
  'a complete captured receipt produces the challenge-bound DB export before retention'
);

reset role;
reset session authorization;

set session authorization programmable_api_reader_login;
set role programmable_api_reader;

select is(
  programmable_wake_private.get_real_block_sla_runtime_evidence_v1(1)
    ->> 'initialResponseStatus',
  '503',
  'runtime evidence accepts the DB-bound probe and proves the first HTTP was 503'
);

select is(
  programmable_wake_private.get_real_block_sla_runtime_evidence_v1(1)
    ->> 'duplicateResponseStatus',
  '202',
  'runtime evidence proves the required exact duplicate HTTP was 202'
);

reset role;
reset session authorization;

select pg_temp.set_sla_duplicate_delay_v1(1, interval '4 minutes');

set session authorization programmable_api_reader_login;
set role programmable_api_reader;

select is(
  programmable_wake_private.get_real_block_sla_runtime_evidence_v1(1),
  null::jsonb,
  'a duplicate received outside the initial ten-second window cannot satisfy SLA evidence'
);

reset role;
reset session authorization;

select pg_temp.set_sla_duplicate_delay_v1(1, interval '1 second');

select is(
  pg_temp.prune_sla_wake_and_keep_tombstone_v1(1),
  true,
  'captured and exported wake evidence prunes while the detached consumed arm tombstone survives'
);

set session authorization programmable_projector_runtime_login;
set role programmable_projector_runtime;

select throws_ok(
  $sql$
    select programmable_wake_private.arm_real_block_sla_provider_retry_once_v1(
      repeat('d', 40), 'dpl_42345678901234567890',
      'https://programmable-promoted.vercel.app', 'prj_programmable_promoted',
      'stream-promoted'
    )
  $sql$,
  '55000',
  'SLA provider retry requires its promoted staged product and a published Classic launch',
  'retry arming rejects a commit and deployment other than the promoted staged product'
);

reset role;
reset session authorization;

select * from finish();
rollback;
