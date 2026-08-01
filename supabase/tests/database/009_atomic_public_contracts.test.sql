begin;
select plan(29);

create function public.large_atomic_projection_fixture_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select programmable_private.build_indexed_token_projection_v2(
    pg_catalog.jsonb_build_object(
      'route_key', 'explore-token',
      'chain_id', 1,
      'release_id', 'stock-paired-v3',
      'model_id', 'stock-paired',
      'source_group', 'core',
      'projector_version', 'fixture-v1',
      'epoch_id', '10000000-0000-0000-0000-000000000001',
      'pointer_generation', '1',
      'checkpoint_id', '10000000-0000-0000-0000-000000000002',
      'checkpoint_generation', '2',
      'reorg_generation', '0',
      'checkpoint_block_number', '123',
      'checkpoint_block_hash_hex', '0x' || pg_catalog.repeat('11', 32),
      'snapshot_commitment_hex', '0x' || pg_catalog.repeat('22', 32),
      'projection_run_id', '10000000-0000-0000-0000-000000000003',
      'publication_commitment_hex', '0x' || pg_catalog.repeat('33', 32),
      'promoted_block_number', '123',
      'promoted_block_hash_hex', '0x' || pg_catalog.repeat('44', 32),
      'token_hex', '0x' || pg_catalog.repeat('55', 20),
      'hook_hex', '0x' || pg_catalog.repeat('66', 20),
      'pool_id_hex', '0x' || pg_catalog.repeat('77', 32),
      'creator_hex', '0x' || pg_catalog.repeat('88', 20),
      'position_recipient_hex', '0x' || pg_catalog.repeat('99', 20),
      'position_token_id', '9007199254740993',
      'reward_vault_hex', '0x' || pg_catalog.repeat('aa', 20),
      'launch_hash_hex', '0x' || pg_catalog.repeat('bb', 32),
      'launch_source_block_number', '123',
      'launch_transaction_hash_hex', '0x' || pg_catalog.repeat('cc', 32),
      'launch_transaction_index', '4294967295',
      'launch_receipt_log_ordinal', '4294967295',
      'launch_timestamp_iso', '2026-07-31T12:00:00.000Z',
      'token_name', 'Large Atomic Fixture',
      'token_symbol', 'LARGE',
      'total_supply', '1000000000000000000000000000'
    ) || pg_catalog.jsonb_build_object(
      'token_liquidity_amount', '90071992547409931234567890',
      'locked_token_dust', '90071992547409931234567891',
      'market_liquidity', '90071992547409931234567892',
      'market_tick', 1,
      'initial_tick', 2,
      'tick_lower', -10,
      'tick_upper', 10,
      'buy_swap_fee_bps', 100,
      'sell_swap_fee_bps', 100,
      'buy_creator_fee_bps', 90,
      'sell_creator_fee_bps', 90,
      'launcher_fee_bps', 10,
      'transfer_tax_bps', 0,
      'lp_fee_pips', 10000,
      'protocol_fee_pips', 0,
      'token', 'token1',
      'currency0', 'quote0',
      'currency1', 'token1',
      'quote_asset', 'quote0',
      'market_token0_price', '0.5',
      'market_token1_price', '2',
      'market_volume_token0', '9007199254740993.123456789012345678',
      'market_volume_token1', '1',
      'market_volume_native', null,
      'market_swap_count', 100,
      'stock_quote_address_hex', '0x' || pg_catalog.repeat('dd', 20),
      'stock_quote_symbol', 'QUOTE',
      'stock_quote_name', 'Quote Asset',
      'stock_quote_decimals', 18,
      'stock_quote_currency_side', 'currency0',
      'accrued_creator_total', '90071992547409931234567893',
      'accrued_launcher_total', '90071992547409931234567894',
      'creator_claimable_accrued', '90071992547409931234567895',
      'initial_buy_native_wei', '90071992547409931234567896',
      'initial_buy_quote_raw', '90071992547409931234567897',
      'initial_buy_amount', '90071992547409931234567898'
    )
  )
$function$;

select ok(
  to_regprocedure(
    'programmable_private.get_public_explore_page_v1(bigint,text,text,integer,integer)'
  ) is not null
  and to_regprocedure(
    'programmable_private.get_public_explore_token_v1(bigint,text)'
  ) is not null
  and to_regprocedure(
    'programmable_private.get_public_token_chart_v1(bigint,text,text)'
  ) is not null
  and to_regprocedure(
    'programmable_private.get_public_creator_profile_v1(bigint,text)'
  ) is not null
  and to_regprocedure(
    'programmable_private.get_public_classic_v3_profile_v1(bigint,text)'
  ) is not null
  and to_regprocedure(
    'programmable_private.get_public_stock_paired_profile_v1(bigint,text)'
  ) is not null
  and to_regprocedure(
    'programmable_private.get_public_launch_lookup_v1(bigint,text,text,text)'
  ) is not null,
  'all seven frozen public raw-envelope RPC signatures exist'
);

select ok(
  to_regprocedure(
    'programmable_private.get_public_explore_page_v1(bigint,text,text,integer,integer,jsonb)'
  ) is null,
  'the cursor-taking Explore draft is absent from the final schema'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'programmable_private.get_public_explore_page_v1(bigint,text,text,integer,integer)'::regprocedure,
      'programmable_private.get_public_explore_token_v1(bigint,text)'::regprocedure,
      'programmable_private.get_public_token_chart_v1(bigint,text,text)'::regprocedure,
      'programmable_private.get_public_creator_profile_v1(bigint,text)'::regprocedure,
      'programmable_private.get_public_classic_v3_profile_v1(bigint,text)'::regprocedure,
      'programmable_private.get_public_stock_paired_profile_v1(bigint,text)'::regprocedure,
      'programmable_private.get_public_launch_lookup_v1(bigint,text,text,text)'::regprocedure,
      'programmable_private.get_public_indexer_feed_v1(bigint)'::regprocedure
    ]) as function(oid)
    where not pg_catalog.has_function_privilege(
      'programmable_api_reader', function.oid, 'EXECUTE'
    )
  ),
  'API reader can execute only the frozen public RPC layer'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'programmable_private.get_public_explore_page_v1(bigint,text,text,integer,integer)'::regprocedure,
      'programmable_private.get_public_indexer_feed_v1(bigint)'::regprocedure
    ]) as function(oid)
    where pg_catalog.has_function_privilege('public', function.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', function.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege(
         'authenticated', function.oid, 'EXECUTE'
       )
       or pg_catalog.has_function_privilege(
         'service_role', function.oid, 'EXECUTE'
       )
  ),
  'browser and Supabase runtime roles cannot execute public route definers'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.get_read_model_performance_dataset_v1(bigint)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.get_read_model_performance_dataset_v1(bigint)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.get_read_model_performance_dataset_v1(bigint)'::regprocedure,
    'EXECUTE'
  ),
  'performance dataset remains projector-only'
);

select ok(
  to_regprocedure(
    'programmable_private.get_projector_reward_state_by_vault_v1(uuid,bytea)'
  ) is not null,
  'the exact-current reward-state baseline reader exists'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.get_projector_reward_state_by_vault_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.get_projector_reward_state_by_vault_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.get_projector_reward_state_by_vault_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  ),
  'reward-state baseline reader remains projector-only'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_projector_reward_state_by_vault_v1(uuid,bytea)'::regprocedure
    ), 'projector_checkpoint_current'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_projector_reward_state_by_vault_v1(uuid,bytea)'::regprocedure
    ), 'chain_event_materialized_occurrences_v1'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_projector_reward_state_by_vault_v1(uuid,bytea)'::regprocedure
    ), 'current_account_reward_balances_v1'
  ) > 0,
  'reward-state baseline binds current checkpoint, provenance, and balances'
);

select ok(
  to_regprocedure(
    'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'
  ) is not null,
  'the all-current reward-balance reader exists'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'::regprocedure,
    'EXECUTE'
  ),
  'all-current reward balances remain projector-only'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'::regprocedure
    ), 'current_account_reward_balances_v1'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'::regprocedure
    ), 'balance_entity.checkpoint_id = baseline.checkpoint_id'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'::regprocedure
    ), 'current_checkpoint.reorg_generation ='
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'::regprocedure
    ), 'balance.epoch_id = header.epoch_id'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'::regprocedure
    ), 'payout_change_projections'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'::regprocedure
    ), 'allocation.effective_to_block is null'
  ) = 0,
  'balance channel is checkpoint, reorg and epoch bound with historical payout resolution'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'programmable_private.get_projector_reward_state_by_vault_v1(uuid,bytea)'::regprocedure
    ), 'allocation_evidence_id uuid'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'programmable_private.get_projector_reward_balances_by_vault_v1(uuid,bytea)'::regprocedure
    ), 'allocation_evidence_id uuid'
  ) > 0,
  'both reward readers expose the exact current allocation evidence identifier'
);

select ok(
  to_regprocedure(
    'programmable_private.stage_current_reward_snapshot_v1(uuid,bytea,bytea,uuid,bigint,bytea,numeric,integer[],bytea[],bytea[],numeric[],bytea[],bytea[],numeric[],numeric[],uuid,numeric,bytea,timestamp with time zone)'
  ) is not null
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.stage_current_reward_snapshot_v1(uuid,bytea,bytea,uuid,bigint,bytea,numeric,integer[],bytea[],bytea[],numeric[],bytea[],bytea[],numeric[],numeric[],uuid,numeric,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.stage_current_reward_snapshot_v1(uuid,bytea,bytea,uuid,bigint,bytea,numeric,integer[],bytea[],bytea[],numeric[],bytea[],bytea[],numeric[],numeric[],uuid,numeric,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'the exact-current snapshot writer exists and remains projector-only'
);

select ok(
  to_regprocedure(
    'programmable_private.promote_projection_run_v3(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,uuid,uuid[],uuid,bytea,timestamp with time zone)'
  ) is not null
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.promote_projection_run_v2(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.promote_projection_run_v3(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,uuid,uuid[],uuid,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'programmable_private.promote_projection_run_v3(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,uuid,uuid[],uuid,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'provider-bound promotion replaces the retired v2 capability and remains projector-only'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run_v2(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,timestamp with time zone)'::regprocedure
    ), 'complete_group_occurrence_ids is distinct from p_occurrence_ids'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run_v2(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,timestamp with time zone)'::regprocedure
    ), 'source.transaction_hash <> group_transaction_hash'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run_v2(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,timestamp with time zone)'::regprocedure
    ), 'reward claim rows do not reconcile to the transaction'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run_v2(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,timestamp with time zone)'::regprocedure
    ), 'allocation_evidence_id = p_allocation_evidence_ids[1]'
  ) > 0,
  'reward deltas bind the complete transaction, claims, and exact verified seed evidence'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_viewdef(
      'programmable_private.classic_v3_vault_history_v1'::regclass, true
    ), 'launch.projection_run_id = vault.projection_run_id'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_viewdef(
      'programmable_private.classic_v3_vault_history_v1'::regclass, true
    ), 'current_launch_projections_v1'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_viewdef(
      'programmable_private.stock_paired_vault_history_v1'::regclass, true
    ), 'stock-paired-v1'
  ) > 0,
  'reward history follows the immutable launch across later exact snapshot runs'
);

select ok(
  pg_catalog.has_table_privilege(
    'programmable_api_reader',
    'programmable_private.public_route_snapshots_v2', 'SELECT'
  )
  and pg_catalog.has_table_privilege(
    'programmable_api_reader',
    'programmable_private.public_explore_chart_v1', 'SELECT'
  )
  and pg_catalog.has_table_privilege(
    'programmable_api_reader',
    'programmable_private.public_launch_lookup_v1', 'SELECT'
  ),
  'API reader can select the raw public evidence views'
);

select ok(
  not pg_catalog.has_table_privilege(
    'anon', 'programmable_private.public_route_snapshots_v2', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'programmable_private.public_explore_token_v1', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role',
    'programmable_private.public_explore_list_v1', 'SELECT'
  ),
  'browser and Supabase runtime roles cannot select raw public evidence views'
);

select ok(
  not pg_catalog.has_function_privilege(
    'programmable_api_reader',
    'programmable_private.build_indexed_token_projection_v2(jsonb)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.retarget_indexed_token_projection_v2(jsonb,jsonb,text)'::regprocedure,
    'EXECUTE'
  ),
  'raw builders remain private implementation details'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_viewdef(
      'programmable_private.public_route_snapshots_v2'::regclass, true
    ), 'all-supported'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_viewdef(
      'programmable_private.public_route_snapshots_v2'::regclass, true
    ), 'classic-v3'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_viewdef(
      'programmable_private.public_route_snapshots_v2'::regclass, true
    ), 'stock-paired'
  ) > 0,
  'public snapshots encode exact all, Classic-v3 and Stock-only scopes'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_read_model_performance_dataset_v1(bigint)'::regprocedure
    ), 'release_counts.total_count >= 200'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.get_read_model_performance_dataset_v1(bigint)'::regprocedure
    ), 'candidate_sample.distinct_blocks = 8'
  ) > 0,
  'performance corpus is real, complete, and candidate-diverse without padding'
);

select is(
  pg_catalog.jsonb_typeof(
    public.large_atomic_projection_fixture_v1()
      #> '{liquidity,tokenLiquidityAmountRaw}'
  ),
  'string',
  'large token liquidity is emitted as a JSON string'
);

select is(
  public.large_atomic_projection_fixture_v1()
    #>> '{liquidity,tokenLiquidityAmountRaw}',
  '90071992547409931234567890',
  'large token liquidity survives beyond Number.MAX_SAFE_INTEGER exactly'
);

select is(
  public.large_atomic_projection_fixture_v1()
    #>> '{liquidity,lockedTokenDustRaw}',
  '90071992547409931234567891',
  'large locked dust survives JSON serialization exactly'
);

select is(
  public.large_atomic_projection_fixture_v1()
    #>> '{liquidity,activeLiquidity}',
  '90071992547409931234567892',
  'large active liquidity survives JSON serialization exactly'
);

select is(
  public.large_atomic_projection_fixture_v1()
    #>> '{initialBuy,quoteRaw}',
  '90071992547409931234567897',
  'large initial-buy quote amount is an exact JSON string'
);

select is(
  pg_catalog.jsonb_typeof(
    public.large_atomic_projection_fixture_v1()
      #> '{quote,grossVolumeQuoteRaw}'
  ),
  'string',
  'large quote volume is never emitted as a JSON number'
);

select is(
  pg_catalog.jsonb_typeof(
    public.large_atomic_projection_fixture_v1()
      #> '{source,checkpointBlockNumber}'
  ),
  'string',
  'block quantities use the frozen string boundary'
);

select is(
  pg_catalog.jsonb_typeof(
    public.large_atomic_projection_fixture_v1()
      #> '{launchTransactionIndex}'
  ),
  'number',
  'bounded uint32 transaction ordinals remain JSON numbers'
);

select is(
  public.large_atomic_projection_fixture_v1()
    #>> '{launchLogIndex}',
  '4294967295',
  'receipt log ordinal preserves the full uint32 range'
);

select * from finish();
rollback;
