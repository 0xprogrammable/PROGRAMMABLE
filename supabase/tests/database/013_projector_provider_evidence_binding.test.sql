begin;
select plan(45);

create function public.projection_trace_fixture_v1(
  p_candidate_batch_size integer default 1,
  p_duration_ms integer default 2
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'startedAtMs', 1775000000000,
    'completedAtMs', 1775000000005,
    'candidateBatchSize', p_candidate_batch_size,
    'hardDeadlineMs', 75000,
    'maxCallsPerProvider', 128,
    'elapsedMs', 5,
    'providerCallCounts', pg_catalog.jsonb_build_array(1, 0),
    'calls', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'providerIdentity',
          'alchemy-mainnet-11111111111111111111111111111111',
        'providerVendorGroup', 'alchemy',
        'providerEndpointCommitment', '0x' || pg_catalog.repeat('33', 32),
        'providerOriginCommitment', '0x' || pg_catalog.repeat('44', 32),
        'operation', 'getTransactionReceipt',
        'attempt', 1,
        'startedOffsetMs', 3,
        'durationMs', p_duration_ms,
        'outcome', 'success'
      )
    )
  )
$function$;

create function public.reward_trace_fixture_v1()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'startedAtMs', 1775000000000,
    'completedAtMs', 1775000000005,
    'candidateBatchSize', 0,
    'hardDeadlineMs', 75000,
    'maxCallsPerProvider', 128,
    'elapsedMs', 5,
    'providerCallCounts', pg_catalog.jsonb_build_array(14, 14),
    'calls', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'providerIdentity',
          'alchemy-mainnet-11111111111111111111111111111111',
        'providerVendorGroup', 'alchemy',
        'providerEndpointCommitment', '0x' || pg_catalog.repeat('33', 32),
        'providerOriginCommitment', '0x' || pg_catalog.repeat('44', 32),
        'operation', 'readRewardSnapshot',
        'attempt', 1,
        'startedOffsetMs', 0,
        'durationMs', 5,
        'outcome', 'success'
      ),
      pg_catalog.jsonb_build_object(
        'providerIdentity',
          'quicknode-mainnet-55555555555555555555555555555555',
        'providerVendorGroup', 'quicknode',
        'providerEndpointCommitment', '0x' || pg_catalog.repeat('55', 32),
        'providerOriginCommitment', '0x' || pg_catalog.repeat('66', 32),
        'operation', 'readRewardSnapshot',
        'attempt', 1,
        'startedOffsetMs', 0,
        'durationMs', 5,
        'outcome', 'success'
      )
    )
  )
$function$;

create function public.reward_trace_fixture_multi_v1(
  p_chunk_count integer,
  p_aggregate_call_count integer
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'startedAtMs', 1775000000000,
    'completedAtMs', 1775000000010,
    'candidateBatchSize', 0,
    'hardDeadlineMs', 75000,
    'maxCallsPerProvider', 128,
    'elapsedMs', 10,
    'providerCallCounts', pg_catalog.jsonb_build_array(
      p_aggregate_call_count, p_aggregate_call_count
    ),
    'calls', (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'providerIdentity', case provider_ordinal
            when 1 then
              'alchemy-mainnet-11111111111111111111111111111111'
            else
              'quicknode-mainnet-55555555555555555555555555555555'
          end,
          'providerVendorGroup', case provider_ordinal
            when 1 then 'alchemy' else 'quicknode'
          end,
          'providerEndpointCommitment', '0x' || case provider_ordinal
            when 1 then pg_catalog.repeat('33', 32)
            else pg_catalog.repeat('55', 32)
          end,
          'providerOriginCommitment', '0x' || case provider_ordinal
            when 1 then pg_catalog.repeat('44', 32)
            else pg_catalog.repeat('66', 32)
          end,
          'operation', 'readRewardSnapshot',
          'attempt', 1,
          'startedOffsetMs', chunk_ordinal - 1,
          'durationMs', 1,
          'outcome', 'success'
        )
        order by provider_ordinal, chunk_ordinal
      )
      from pg_catalog.generate_series(1, 2) as providers(provider_ordinal)
      cross join pg_catalog.generate_series(
        1, p_chunk_count
      ) as chunks(chunk_ordinal)
    )
  )
$function$;

set local role programmable_projector;

select programmable_private.register_rpc_provider_deployment(
  '10000000-0000-4000-8000-000000000002', 1,
  'alchemy', 'provider-evidence-test-v1',
  pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
  'rpc-endpoint-commitments-v1',
  pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
  '2026-08-01T00:00:00Z'
);

select programmable_private.register_rpc_provider_deployment(
  '10000000-0000-4000-8000-000000000003', 1,
  'quicknode', 'provider-evidence-test-v1',
  pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('66', 32), 'hex'),
  'rpc-endpoint-commitments-v1',
  pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('54', 32), 'hex'),
  '2026-08-01T00:00:01Z'
);

reset role;

select is(
  pg_catalog.encode(version.definition_commitment, 'hex'),
  '3234e87ac53489e1cfefafa865b053e9723945930d060265c0e8084669a1e955',
  'provider evidence v3 has the frozen TypeScript contract commitment'
)
from programmable_private.fingerprint_encoding_versions as version
where version.fingerprint_domain = 'evidence'
  and version.encoding_version = 3;

select is(
  pg_catalog.encode(subtype.frame_prefix, 'hex'),
  '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76330006',
  'projection execution evidence uses the frozen v3 subtype frame'
)
from programmable_private.provider_evidence_encoding_subtypes as subtype
where subtype.evidence_subtype = 'projection_execution'
  and subtype.encoding_version = 3;

select is(
  pg_catalog.encode(subtype.frame_prefix, 'hex'),
  '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76330007',
  'reward snapshot evidence uses the frozen v3 subtype frame'
)
from programmable_private.provider_evidence_encoding_subtypes as subtype
where subtype.evidence_subtype = 'reward_snapshot'
  and subtype.encoding_version = 3;

select is(
  pg_catalog.encode(
    programmable_private.projection_execution_trace_commitment_v1(
      public.projection_trace_fixture_v1()
    ), 'hex'
  ),
  '466d9059a360712fd7d40fc9a4fd326cf58ed7d8f4a7f93a31da4edd9bbdc620',
  'SQL and TypeScript freeze the same structural projection trace'
);

select is(
  pg_catalog.encode(
    programmable_private.projection_execution_trace_commitment_v1(
      public.reward_trace_fixture_v1()
    ), 'hex'
  ),
  '387a035634613b9c1fcf9369aeea587e325815bef91d3d3945e56136d0472043',
  'reward trace binds two logical reads and their raw provider call counts'
);

select ok(
  pg_catalog.encode(
    programmable_private.projection_execution_trace_commitment_v1(
      public.projection_trace_fixture_v1(1, 1)
    ), 'hex'
  ) <> '466d9059a360712fd7d40fc9a4fd326cf58ed7d8f4a7f93a31da4edd9bbdc620',
  'changing a trace duration changes its commitment'
);

select throws_ok(
  $sql$
    select programmable_private.projection_execution_trace_preimage_v1(
      public.projection_trace_fixture_v1() || '{"extra":true}'::jsonb
    )
  $sql$,
  '22023',
  'unknown trace fields are rejected'
);

select ok(
  pg_catalog.octet_length(
    programmable_private.projection_execution_trace_preimage_v1(
      public.projection_trace_fixture_v1(4096, 2)
    )
  ) > 0,
  'the structural trace codec accepts the frozen 4096 candidate boundary'
);

select throws_ok(
  $sql$
    select programmable_private.projection_execution_trace_preimage_v1(
      public.projection_trace_fixture_v1(4097, 2)
    )
  $sql$,
  '22023',
  'the structural trace codec rejects candidate batches above 4096'
);

select is(
  pg_catalog.encode(
    programmable_private.projection_execution_evidence_preimage_v1(
      1, 'classic-v3', 'classic', 'core',
      '70000000-0000-4000-8000-000000000020', 1,
      '80000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      'alchemy-mainnet-11111111111111111111111111111111',
      'quicknode-mainnet-55555555555555555555555555555555',
      'alchemy', 'quicknode',
      pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('66', 32), 'hex'),
      6, 6, 40, 75000, 128, 2,
      pg_catalog.decode(pg_catalog.repeat('77', 32), 'hex')
    ), 'hex'
  ),
  '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7633000600000000000000010000000a636c61737369632d763300000007636c617373696300000004636f726570000000000040008000000000000020000000000000000180000000000040008000000000000001100000000000400080000000000000021000000000004000800000000000000300000030616c6368656d792d6d61696e6e65742d313131313131313131313131313131313131313131313131313131313131313100000032717569636b6e6f64652d6d61696e6e65742d353535353535353535353535353535353535353535353535353535353535353500000007616c6368656d7900000009717569636b6e6f64653333333333333333333333333333333333333333333333333333333333333333555555555555555555555555555555555555555555555555555555555555555544444444444444444444444444444444444444444444444444444444444444446666666666666666666666666666666666666666666666666666666666666666000000060000000600000028000124f800000080000000027777777777777777777777777777777777777777777777777777777777777777',
  'projection evidence SQL preimage exactly matches the TypeScript fixture'
);

select is(
  pg_catalog.encode(
    programmable_private.reward_snapshot_evidence_preimage_v1(
      1, 'classic-v3', 'classic', 'core',
      '70000000-0000-4000-8000-000000000020', 1,
      '80000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      pg_catalog.decode(pg_catalog.repeat('88', 20), 'hex'),
      'classic-v3', 25639601,
      pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'),
      14, 14,
      array[
        pg_catalog.decode(pg_catalog.repeat('11', 20), 'hex'),
        pg_catalog.decode(pg_catalog.repeat('22', 20), 'hex')
      ],
      array[2],
      array[pg_catalog.decode(pg_catalog.repeat('dd', 32), 'hex')],
      array[pg_catalog.decode(pg_catalog.repeat('dd', 32), 'hex')],
      array[14],
      array[14],
      pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('cc', 32), 'hex')
    ), 'hex'
  ),
  '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7633000700000000000000010000000a636c61737369632d763300000007636c617373696300000004636f726570000000000040008000000000000020000000000000000180000000000040008000000000000001810000000000400080000000000000018200000000004000800000000000000188888888888888888888888888888888888888880000000a636c61737369632d76330000000001873ab199999999999999999999999999999999999999999999999999999999999999991000000000004000800000000000000210000000000040008000000000000003aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000e0000000e0000000211111111111111111111111111111111111111112222222222222222222222222222222222222222000000010000000200000001dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd00000001dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd000000010000000e000000010000000ebbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'reward evidence SQL preimage exactly matches the TypeScript fixture'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'programmable_private'
      and relation.relname in (
        'projection_provider_execution_evidence',
        'reward_snapshot_provider_evidence',
        'projection_publication_provider_bindings',
        'projection_publication_reward_evidence'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  4,
  'all four immutable provider-evidence tables force RLS'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'programmable_private'
      and policy.tablename in (
        'projection_provider_execution_evidence',
        'reward_snapshot_provider_evidence',
        'projection_publication_provider_bindings',
        'projection_publication_reward_evidence'
      )
      and policy.roles = array['programmable_migrator'::name]
      and policy.cmd = 'ALL'
  ),
  4,
  'only the migrator receives explicit all-row RLS policies'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'programmable_private'
      and relation.relname in (
        'projection_provider_execution_evidence',
        'reward_snapshot_provider_evidence',
        'projection_publication_provider_bindings',
        'projection_publication_reward_evidence'
      )
      and not trigger.tgisinternal
      and trigger.tgname like '%_immutable'
  ),
  4,
  'each provider-evidence table rejects update and delete mutations'
);

select ok(
  not pg_catalog.has_table_privilege(
    'public',
    'programmable_private.projection_provider_execution_evidence',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not pg_catalog.has_table_privilege(
    'anon',
    'programmable_private.reward_snapshot_provider_evidence',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'programmable_private.projection_publication_provider_bindings',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not pg_catalog.has_table_privilege(
    'service_role',
    'programmable_private.projection_publication_reward_evidence',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'browser and Supabase roles have no direct provider-evidence table access'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.append_projection_provider_execution_evidence_v1(uuid,uuid,uuid,uuid[],jsonb,bytea,smallint,bytea,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.append_reward_snapshot_provider_evidence_v1(uuid,uuid,uuid,uuid,bytea,text,text,numeric,bytea,bytea,bytea,integer,integer,bytea[],integer[],bytea[],bytea[],integer[],integer[],bytea,jsonb,bytea,smallint,bytea,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'the projector can append both immutable provider-evidence kinds'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.get_staged_reward_folded_commitment_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.stage_current_reward_snapshot_v2(uuid,bytea,bytea,uuid,bigint,bytea,numeric,integer[],bytea[],bytea[],numeric[],bytea[],bytea[],numeric[],numeric[],uuid,uuid[],numeric,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.promote_projection_run_v3(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,uuid,uuid[],uuid,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.stage_verified_dynamic_parents_v2(uuid,uuid,text,text,text,text,uuid,bigint,bigint,bigint,bytea,uuid,text,uuid,uuid,uuid,uuid,numeric,bytea,bytea,bytea[],bytea[],jsonb,bytea,jsonb,jsonb,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.get_current_provisional_dynamic_sources_v1(text)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.consume_matching_provisional_sources_v1(uuid,uuid,uuid,uuid,uuid[],timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'the projector can stage and read private parents but cannot consume them outside v3 promotion'
);

select ok(
  not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.reward_snapshot_folded_preimage_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.reward_snapshot_folded_commitment_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.projection_provider_binding_commitment_v1(uuid,uuid,text,uuid,uuid[],timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'internal folded-state and publication-binding helpers are not runtime capabilities'
);

select ok(
  not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.promote_projection_run(uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.promote_projection_run_v2(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'legacy promotion functions cannot bypass provider-evidence binding'
);

select ok(
  not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.get_staged_reward_folded_commitment_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'programmable_private.get_staged_reward_folded_commitment_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'programmable_private.get_staged_reward_folded_commitment_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'programmable_private.get_staged_reward_folded_commitment_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  ),
  'the folded commitment getter is unavailable to browser and service roles'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.append_reward_snapshot_provider_evidence_v1(uuid,uuid,uuid,uuid,bytea,text,text,numeric,bytea,bytea,bytea,integer,integer,bytea[],integer[],bytea[],bytea[],integer[],integer[],bytea,jsonb,bytea,smallint,bytea,bytea,timestamp with time zone)'::regprocedure
    ),
    'reward verification account coverage changed'
  ) > 0,
  'reward evidence binds the exact active and changed account read set'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.bind_projection_publication_provider_evidence_v1(uuid,uuid,uuid,text,uuid,uuid[],bytea,timestamp with time zone)'::regprocedure
    ),
    'projection_provider_binding_commitment_v1'
  ) > 0,
  'publication binding commitments are recomputed from stored evidence'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_classic_reward_block_fold_v1(uuid,bytea,uuid[])'::regprocedure
    ),
    'order by requested.ordinal'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_stock_reward_block_fold_v1(uuid,bytea,uuid[])'::regprocedure
    ),
    'order by requested.ordinal'
  ) > 0,
  'Classic and Stock reward folds consume events in caller-bound chain order'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_current_reward_snapshot_v2(uuid,bytea,bytea,uuid,bigint,bytea,numeric,integer[],bytea[],bytea[],numeric[],bytea[],bytea[],numeric[],numeric[],uuid,uuid[],numeric,bytea,timestamp with time zone)'::regprocedure
    ),
    'cardinality(p_occurrence_ids), 0) <= 1'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_current_reward_snapshot_v2(uuid,bytea,bytea,uuid,bigint,bytea,numeric,integer[],bytea[],bytea[],numeric[],bytea[],bytea[],numeric[],numeric[],uuid,uuid[],numeric,bytea,timestamp with time zone)'::regprocedure
    ),
    'assert_stock_reward_block_fold_v1'
  ) > 0,
  'stage-v2 preserves only the single-occurrence path and handles grouped Classic and Stock transitions'
);

select ok(
  to_regprocedure(
    'programmable_private.projection_execution_trace_preimage_v1(jsonb)'
  ) is not null
  and to_regprocedure(
    'programmable_private.reward_snapshot_folded_preimage_v1(uuid,bytea)'
  ) is not null
  and to_regprocedure(
    'programmable_private.projection_provider_binding_preimage_v1(uuid,uuid,text,uuid,uuid[],timestamp with time zone)'
  ) is not null,
  'all three structural commitment domains have explicit SQL codecs'
);

select lives_ok(
  $sql$
    select programmable_private.validate_reward_snapshot_execution_trace_v1(
      public.reward_trace_fixture_multi_v1(2, 129),
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      129, 129
    )
  $sql$,
  'reward traces support ordered multi-chunk reads above one execution-call window'
);

select throws_ok(
  $sql$
    select programmable_private.validate_reward_snapshot_execution_trace_v1(
      pg_catalog.jsonb_set(
        public.reward_trace_fixture_multi_v1(2, 129),
        '{calls,1}',
        public.reward_trace_fixture_multi_v1(2, 129) #> '{calls,2}'
      ),
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      129, 129
    )
  $sql$,
  '23514',
  'reward traces reject provider interleaving across chunk boundaries'
);

select lives_ok(
  $sql$
    select programmable_private.assert_reward_verification_chunk_manifest_v1(
      array(
        select pg_catalog.decode(
          pg_catalog.lpad(pg_catalog.to_hex(account_number), 40, '0'),
          'hex'
        )
        from pg_catalog.generate_series(1, 49) as accounts(account_number)
      ),
      array[48, 49],
      array[
        pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
        pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex')
      ],
      array[
        pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
        pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex')
      ],
      array[128, 1], array[128, 1], 129, 129
    )
  $sql$,
  'a 49-account reward read persists as two exact ordered chunks'
);

select throws_ok(
  $sql$
    select programmable_private.assert_reward_verification_chunk_manifest_v1(
      array(
        select pg_catalog.decode(
          pg_catalog.lpad(pg_catalog.to_hex(account_number), 40, '0'),
          'hex'
        )
        from pg_catalog.generate_series(49, 1, -1)
          as accounts(account_number)
      ),
      array[48, 49],
      array[
        pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
        pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex')
      ],
      array[
        pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
        pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex')
      ],
      array[128, 1], array[128, 1], 129, 129
    )
  $sql$,
  '22023',
  'reward account order is canonical across chunk boundaries'
);

select lives_ok(
  $sql$
    select programmable_private.assert_reward_verification_chunk_manifest_v1(
      array(
        select pg_catalog.decode(
          pg_catalog.lpad(pg_catalog.to_hex(account_number), 40, '0'),
          'hex'
        )
        from pg_catalog.generate_series(1, 4096)
          as accounts(account_number)
      ),
      array(
        select least(chunk_number * 48, 4096)
        from pg_catalog.generate_series(1, 86) as chunks(chunk_number)
      ),
      array(
        select pg_catalog.decode(pg_catalog.repeat('ab', 32), 'hex')
        from pg_catalog.generate_series(1, 86)
      ),
      array(
        select pg_catalog.decode(pg_catalog.repeat('ab', 32), 'hex')
        from pg_catalog.generate_series(1, 86)
      ),
      array(
        select 128 from pg_catalog.generate_series(1, 86)
      ),
      array(
        select 128 from pg_catalog.generate_series(1, 86)
      ),
      11008, 11008
    )
  $sql$,
  'reward evidence accepts the full 4096-account and 11008-call boundary'
);

select ok(
  (
    select pg_catalog.string_agg(
      pg_catalog.pg_get_constraintdef(constraint_row.oid), ' '
    )
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
      'programmable_private.projection_provider_execution_evidence'::regclass
  ) like '%128%'
  and (
    select pg_catalog.string_agg(
      pg_catalog.pg_get_constraintdef(constraint_row.oid), ' '
    )
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
      'programmable_private.projection_provider_execution_evidence'::regclass
  ) not like '%11008%'
  and (
    select pg_catalog.string_agg(
      pg_catalog.pg_get_constraintdef(constraint_row.oid), ' '
    )
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
      'programmable_private.reward_snapshot_provider_evidence'::regclass
  ) like '%11008%',
  'projection calls remain capped at 128 while reward aggregates reach 11008'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run_v3(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,uuid,uuid[],uuid,bytea,timestamp with time zone)'::regprocedure
    ),
    'p_promotion_mode <> ''exact_incremental'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run_v3(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,uuid,uuid[],uuid,bytea,timestamp with time zone)'::regprocedure
    ),
    'reward-bearing promotion events are not in chain order'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run_v3(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,uuid,uuid[],uuid,bytea,timestamp with time zone)'::regprocedure
    ),
    '''full_launch'''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run_v3(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,uuid,uuid[],uuid,bytea,timestamp with time zone)'::regprocedure
    ),
    'promotion cursor is not the exact configured-provider block terminal'
  ) > 0,
  'v3 exposes exact incremental promotion with mixed-event ordering and an exact terminal watermark'
);

select ok(
  (
    select pg_catalog.string_agg(
      pg_catalog.pg_get_constraintdef(constraint_row.oid), ' '
    )
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
      'programmable_private.projection_publication_provider_bindings'::regclass
  ) like '%exact_incremental%'
  and (
    select pg_catalog.string_agg(
      pg_catalog.pg_get_constraintdef(constraint_row.oid), ' '
    )
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
      'programmable_private.projection_publication_provider_bindings'::regclass
  ) not like '%reward_snapshot_delta%',
  'public provider bindings cannot expose legacy reward or launch modes'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'programmable_private'
      and relation.relname in (
        'provisional_dynamic_parent_pages',
        'provisional_dynamic_source_lineages',
        'provisional_dynamic_parent_consumptions'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity
      and exists (
        select 1
        from pg_catalog.pg_policies as policy
        where policy.schemaname = namespace.nspname
          and policy.tablename = relation.relname
          and policy.roles = array['programmable_migrator'::name]
          and policy.cmd = 'ALL'
      )
  ),
  3,
  'all provisional lineage tables force RLS with migrator-only policies'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'programmable_private'
      and relation.relname in (
        'provisional_dynamic_parent_pages',
        'provisional_dynamic_source_lineages',
        'provisional_dynamic_parent_consumptions'
      )
      and not trigger.tgisinternal
      and trigger.tgname like '%_immutable'
  ),
  3,
  'provisional page, lineage and consumption records are immutable'
);

select ok(
  not pg_catalog.has_table_privilege(
    'public',
    'programmable_private.provisional_dynamic_parent_pages',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'programmable_private.provisional_dynamic_source_lineages',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not pg_catalog.has_table_privilege(
    'service_role',
    'programmable_private.provisional_dynamic_parent_consumptions',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'provisional dynamic parents never become a browser or service capability'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_verified_dynamic_parents_v2(uuid,uuid,text,text,text,text,uuid,bigint,bigint,bigint,bytea,uuid,text,uuid,uuid,uuid,uuid,numeric,bytea,bytea,bytea[],bytea[],jsonb,bytea,jsonb,jsonb,timestamp with time zone)'::regprocedure
    ),
    'provisional child runtime is not template-attested'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_verified_dynamic_parents_v2(uuid,uuid,text,text,text,text,uuid,bigint,bigint,bigint,bytea,uuid,text,uuid,uuid,uuid,uuid,numeric,bytea,bytea,bytea[],bytea[],jsonb,bytea,jsonb,jsonb,timestamp with time zone)'::regprocedure
    ),
    '[1-58][0-9a-f]{3}'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_verified_dynamic_parents_v2(uuid,uuid,text,text,text,text,uuid,bigint,bigint,bigint,bytea,uuid,text,uuid,uuid,uuid,uuid,numeric,bytea,bytea,bytea[],bytea[],jsonb,bytea,jsonb,jsonb,timestamp with time zone)'::regprocedure
    ),
    'insert into programmable_private.projector_checkpoints'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_verified_dynamic_parents_v2(uuid,uuid,text,text,text,text,uuid,bigint,bigint,bigint,bytea,uuid,text,uuid,uuid,uuid,uuid,numeric,bytea,bytea,bytea[],bytea[],jsonb,bytea,jsonb,jsonb,timestamp with time zone)'::regprocedure
    ),
    'insert into programmable_private.projection_publications'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_verified_dynamic_parents_v2(uuid,uuid,text,text,text,text,uuid,bigint,bigint,bigint,bytea,uuid,text,uuid,uuid,uuid,uuid,numeric,bytea,bytea,bytea[],bytea[],jsonb,bytea,jsonb,jsonb,timestamp with time zone)'::regprocedure
    ),
    'dual_rpc_log_coverage_evidence'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_verified_dynamic_parents_v2(uuid,uuid,text,text,text,text,uuid,bigint,bigint,bigint,bytea,uuid,text,uuid,uuid,uuid,uuid,numeric,bytea,bytea,bytea[],bytea[],jsonb,bytea,jsonb,jsonb,timestamp with time zone)'::regprocedure
    ),
    'envio_candidate_inbox'
  ) = 0,
  'provisional staging proves child runtime without reserving canonical coverage or moving public state'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_provisional_parent_receipt_ordinals_v1(uuid,uuid,text[],numeric[],timestamp with time zone)'::regprocedure
    ),
    'unnest(p_candidate_ids, p_receipt_log_ordinals)'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_provisional_parent_receipt_ordinals_v1(uuid,uuid,text[],numeric[],timestamp with time zone)'::regprocedure
    ),
    'pg_catalog.unnest(p_candidate_ids, p_receipt_log_ordinals)'
  ) = 0,
  'provisional receipt ordinals use PostgreSQL multi-array unnest syntax'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_current_provisional_dynamic_sources_v1(text)'::regprocedure
    ),
    'release_epoch_current'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_current_provisional_dynamic_sources_v1(text)'::regprocedure
    ),
    'envio_ingestion_cursor_current'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_current_provisional_dynamic_sources_v1(text)'::regprocedure
    ),
    'provisional_dynamic_parent_consumptions'
  ) > 0,
  'provisional reads are scoped to the current epoch, cursor and unconsumed lineage'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_current_provisional_dynamic_sources_v1(text)'::regprocedure
    ),
    'dynamic_source_activation_staging'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_current_provisional_dynamic_sources_v1(text)'::regprocedure
    ),
    'cursor.generation > page.expected_cursor_generation'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_current_provisional_dynamic_sources_v1(text)'::regprocedure
    ),
    'cursor.block_number < page.snapshot_block_number'
  ) > 0,
  'activated provisional lineages remain readable after an exact cursor advance'
);

select is(
  (
    select pg_catalog.pg_get_userbyid(procedure.proowner)
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'programmable_private.get_current_provisional_activation_boundaries_v1(text)'::regprocedure
  ),
  (
    select pg_catalog.pg_get_userbyid(relation.relowner)
    from pg_catalog.pg_class as relation
    where relation.oid =
      'programmable_private.dynamic_source_activation_staging'::regclass
  ),
  'activation boundary reader is owned by the private staging table owner'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.resolve_pending_dynamic_source_activations_v1(text,bigint,bytea,bigint)'::regprocedure
    ),
    'cursor.generation = p_expected_cursor_generation'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.resolve_pending_dynamic_source_activations_v1(text,bigint,bytea,bigint)'::regprocedure
    ),
    'page.expected_cursor_generation = p_expected_cursor_generation'
  ) = 0,
  'activation resolution fences the current cursor without rejecting a future verified page'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_verified_dynamic_source_activations_v1(uuid,text,uuid,bigint,bigint,bigint,bytea,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure
    ),
    'page.expected_cursor_generation <'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_verified_dynamic_source_activations_v1(uuid,text,uuid,bigint,bigint,bigint,bytea,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure
    ),
    'cursor.block_number < page.snapshot_block_number'
  ) > 0,
  'activation staging independently accepts only an older fence for a future parent block'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_verified_dynamic_source_activations_v1(uuid,text,uuid,bigint,bigint,bigint,bytea,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure
    ),
    'deployment.deployment_commitment'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.stage_verified_dynamic_source_activations_v1(uuid,text,uuid,bigint,bigint,bigint,bytea,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure
    ),
    'deployment.redacted_identity::text as identity'
  ) = 0,
  'activation proofs bind endpoint-derived provider identities rather than static labels'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.consume_matching_provisional_sources_v1(uuid,uuid,uuid,uuid,uuid[],timestamp with time zone)'::regprocedure
    ),
    'final block omitted a provisional child attestation'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.consume_matching_provisional_sources_v1(uuid,uuid,uuid,uuid,uuid[],timestamp with time zone)'::regprocedure
    ),
    'final_runtime.runtime_code_a = staged_runtime.runtime_code_a'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run_v3(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,uuid,uuid[],uuid,bytea,timestamp with time zone)'::regprocedure
    ),
    'consume_matching_provisional_sources_v1'
  ) > 0,
  'only final exact promotion can consume complete provider-matched parent lineage'
);

set local role programmable_projector;
select is(
  (
    select pg_catalog.count(*)
    from programmable_private.get_current_provisional_dynamic_sources_v1(
      'projector-v1'
    )
  ),
  0::bigint,
  'current provisional source reader executes against release generation columns'
);
select is(
  (
    select pg_catalog.count(*)
    from programmable_private.get_current_provisional_activation_boundaries_v1(
      'projector-v1'
    )
  ),
  0::bigint,
  'current activation boundary reader executes through the projector capability'
);
reset role;

select * from finish();
rollback;
