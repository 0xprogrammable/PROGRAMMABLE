-- Bounded, exact-checkpoint route corpus for independent pre-parity reads.
--
-- This function deliberately reads projection state before route parity exists.
-- It exposes only fields which can be reconstructed from the supported
-- release contracts and their canonical logs at the supplied checkpoint. Public
-- route views are not used because they are themselves parity-gated.

reset role;
set role programmable_migrator;

create function programmable_private.assemble_reconciler_routes_v1(
  p_tokens jsonb,
  p_charts jsonb,
  p_profiles jsonb,
  p_rewards jsonb,
  p_launches jsonb
)
returns table (
  route_key text,
  compared_count bigint,
  dto jsonb
)
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  route_contract_version constant text := 'programmable-route-corpus-v1';
  launch_count bigint;
  profile_token_count bigint;
  reward_count bigint;
  lookup_count bigint;
  release_id text;
  model_id text;
  expected_route_keys text[];
begin
  if p_tokens is null
     or pg_catalog.jsonb_typeof(p_tokens) <> 'array'
     or p_charts is null
     or pg_catalog.jsonb_typeof(p_charts) <> 'array'
     or p_profiles is null
     or pg_catalog.jsonb_typeof(p_profiles) <> 'array'
     or p_rewards is null
     or pg_catalog.jsonb_typeof(p_rewards) <> 'array'
     or p_launches is null
     or pg_catalog.jsonb_typeof(p_launches) <> 'array'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid reconciler route parts';
  end if;

  launch_count := pg_catalog.jsonb_array_length(p_tokens);
  reward_count := pg_catalog.jsonb_array_length(p_rewards);
  lookup_count := pg_catalog.jsonb_array_length(p_launches);
  if launch_count > 0 then
    release_id := p_tokens -> 0 ->> 'releaseVersion';
    model_id := p_tokens -> 0 ->> 'modelId';
  end if;
  expected_route_keys := case
    when release_id = 'classic-v2' and model_id = 'classic' then
      array[
        'explore-list', 'explore-token', 'explore-chart', 'creator-profile'
      ]::text[]
    when release_id = 'classic-v3' and model_id = 'classic' then
      array[
        'explore-list', 'explore-token', 'explore-chart', 'creator-profile',
        'classic-v3-profile', 'launch-lookup'
      ]::text[]
    when release_id in (
      'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
    ) and model_id = 'stock-paired' then
      array[
        'explore-list', 'explore-token', 'explore-chart', 'creator-profile',
        'launch-lookup'
      ]::text[]
    else null
  end;
  select coalesce(pg_catalog.sum(pg_catalog.jsonb_array_length(profile -> 'tokens')), 0)
  into profile_token_count
  from pg_catalog.jsonb_array_elements(p_profiles) as profile
  where pg_catalog.jsonb_typeof(profile -> 'tokens') = 'array';

  if launch_count < 1
     or launch_count <> pg_catalog.jsonb_array_length(p_charts)
     or launch_count <> profile_token_count
     or expected_route_keys is null
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_tokens) as token
       where token ->> 'releaseVersion' is distinct from release_id
          or token ->> 'modelId' is distinct from model_id
     )
     or (release_id = 'classic-v3' and reward_count <> launch_count)
     or (release_id <> 'classic-v3' and reward_count <> 0)
     or (release_id = 'classic-v2' and lookup_count <> 0)
     or (release_id <> 'classic-v2' and lookup_count <> launch_count)
  then
    raise exception using
      errcode = '22023',
      message = 'reconciler route cardinality mismatch';
  end if;

  return query
  select route.route_key, route.compared_count, route.dto
  from (values
    ('explore-list'::text, launch_count, pg_catalog.jsonb_build_object(
      'contractVersion', route_contract_version, 'tokens', p_tokens
    )),
    ('explore-token'::text, launch_count, pg_catalog.jsonb_build_object(
      'contractVersion', route_contract_version, 'tokens', p_tokens
    )),
    ('explore-chart'::text, launch_count, pg_catalog.jsonb_build_object(
      'contractVersion', route_contract_version, 'charts', p_charts
    )),
    ('creator-profile'::text, launch_count, pg_catalog.jsonb_build_object(
      'contractVersion', route_contract_version, 'profiles', p_profiles
    )),
    ('classic-v3-profile'::text, reward_count, pg_catalog.jsonb_build_object(
      'contractVersion', route_contract_version, 'rewards', p_rewards
    )),
    ('launch-lookup'::text, lookup_count, pg_catalog.jsonb_build_object(
      'contractVersion', route_contract_version, 'launches', p_launches
    ))
  ) as route(route_key, compared_count, dto)
  where route.route_key = any(expected_route_keys)
  order by pg_catalog.array_position(expected_route_keys, route.route_key);
end
$function$;

comment on function programmable_private.assemble_reconciler_routes_v1(
  jsonb, jsonb, jsonb, jsonb, jsonb
) is
  'Assembles the immutable applicable-route corpus contract from validated canonical release parts.';

revoke all on function programmable_private.assemble_reconciler_routes_v1(
  jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role, programmable_projector,
  programmable_api_reader, programmable_profile_binder,
  programmable_profile_recovery, programmable_profile_writer,
  programmable_maintenance;
grant execute on function programmable_private.assemble_reconciler_routes_v1(
  jsonb, jsonb, jsonb, jsonb, jsonb
) to programmable_reconciler;

create function programmable_private.get_reconciler_route_corpus_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_id uuid,
  p_pointer_generation bigint,
  p_checkpoint_id uuid,
  p_checkpoint_block_number numeric,
  p_checkpoint_block_hash bytea,
  p_maximum_entity_count integer default 10000
)
returns table (
  route_key text,
  compared_count bigint,
  dto jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  contract_row record;
  launch_count bigint;
  projected_launch_count bigint;
  vault_count bigint;
  launch_rows jsonb;
  chart_rows jsonb;
  creator_rows jsonb;
  reward_rows jsonb;
  lookup_rows jsonb;
begin
  perform programmable_private.assert_caller('programmable_reconciler');

  if not (
    p_release_id = 'classic-v2' and p_model_id = 'classic'
    or p_release_id = 'classic-v3' and p_model_id = 'classic'
    or p_release_id in (
      'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
    ) and p_model_id = 'stock-paired'
  ) then
    raise exception using
      errcode = '0A000',
      message = 'reconciler route corpus release is not supported';
  end if;

  -- Reuse the already-reviewed exact checkpoint, manifest, route coverage and
  -- entity-bound validation.  This call neither reads nor manufactures parity.
  select * into strict contract_row
  from programmable_private.get_reconciler_preparity_contract_v1(
    p_chain_id, p_release_id, p_model_id, p_source_group,
    p_epoch_id, p_pointer_generation, p_checkpoint_id,
    p_checkpoint_block_number, p_checkpoint_block_hash,
    p_maximum_entity_count
  );

  with launches as materialized (
    select
      launch.chain_id,
      launch.release_id,
      launch.model_id,
      launch.token,
      launch.creator,
      launch.launch_transaction_hash,
      launch.pool_id,
      launch.reward_vault,
      launch.launch_hash,
      launch.token_name,
      launch.token_symbol,
      launch.total_supply,
      run.source_group,
      launch.epoch_id,
      launch.pointer_generation,
      launch.projection_run_id,
      source_occurrence.block_timestamp as launch_block_timestamp,
      source_occurrence.transaction_index::bigint
        as launch_transaction_index,
      source_occurrence.receipt_log_ordinal::bigint
        as launch_receipt_log_ordinal,
      pool.currency0,
      pool.currency1,
      pool.hook,
      pool.pool_key_fee,
      pool.tick_spacing,
      case
        when pool.currency0 = launch.token then pool.currency1
        when pool.currency1 = launch.token then pool.currency0
        else null
      end as quote_asset,
      fee.buy_swap_fee_bps,
      fee.sell_swap_fee_bps,
      fee.buy_creator_fee_bps,
      fee.sell_creator_fee_bps,
      fee.creator_fee_bps,
      fee.launcher_fee_bps,
      fee.transfer_tax_bps,
      fee.lp_fee_pips,
      launch.promoted_block_number,
      launch.promoted_block_hash,
      liquidity.position_recipient,
      liquidity.position_token_id,
      liquidity.token_liquidity_amount,
      liquidity.locked_token_dust,
      liquidity.initial_sqrt_price_x96,
      liquidity.initial_tick,
      liquidity.tick_lower,
      liquidity.tick_upper,
      coalesce(
        case
          when pool.currency0 = launch.token then pool.currency1
          when pool.currency1 = launch.token then pool.currency0
          else null
        end,
        pg_catalog.decode(pg_catalog.repeat('00', 20), 'hex')
      ) as normalized_quote_asset,
      source_occurrence.block_number as launch_source_block_number,
      source_occurrence.block_global_log_index::bigint
        as launch_source_block_global_log_index,
      market.block_number as market_block_number,
      market.block_hash as market_block_hash,
      market.last_transaction_hash as market_last_transaction_hash,
      market.last_transaction_index as market_last_transaction_index,
      market.last_block_global_log_index as market_last_log_index,
      market.sqrt_price_x96 as market_sqrt_price_x96,
      market.liquidity as market_liquidity,
      market.tick as market_tick,
      fee_total.gross_total as gross_total,
      fee_total.creator_fee_total as creator_fee_total,
      fee_total.launcher_fee_total as launcher_fee_total
    from programmable_private.projection_entity_current as current_launch
    join programmable_private.launch_projections as launch
      on launch.launch_projection_id = current_launch.projection_row_id
     and launch.projection_run_id = current_launch.projection_run_id
     and launch.chain_id = current_launch.chain_id
     and launch.release_id = current_launch.release_id
     and launch.model_id = current_launch.model_id
     and launch.promoted_block_number = current_launch.promoted_block_number
     and launch.promoted_block_hash = current_launch.promoted_block_hash
    join programmable_private.run_headers as run
      on run.run_id = launch.projection_run_id
     and run.run_kind = 'projection'
     and run.chain_id = launch.chain_id
     and run.release_id = launch.release_id
     and run.model_id = launch.model_id
     and run.source_group = current_launch.source_group
     and run.epoch_id = launch.epoch_id
     and run.captured_pointer_generation = launch.pointer_generation
    join programmable_private.projection_publications as publication
      on publication.publication_id = current_launch.publication_id
     and publication.run_id = launch.projection_run_id
     and publication.epoch_id = launch.epoch_id
     and publication.pointer_generation = launch.pointer_generation
     and publication.checkpoint_id = current_launch.checkpoint_id
     and publication.target_block_number = launch.promoted_block_number
     and publication.target_block_hash = launch.promoted_block_hash
    join programmable_private.release_epoch_current as current_epoch
      on current_epoch.chain_id = launch.chain_id
     and current_epoch.release_id = launch.release_id
     and current_epoch.model_id = launch.model_id
     and current_epoch.source_group = run.source_group
     and current_epoch.epoch_id = launch.epoch_id
     and current_epoch.generation = launch.pointer_generation
    join programmable_private.chain_event_current_canonical
      as launch_canonical
      on launch_canonical.logical_event_id =
        launch.last_source_logical_event_id
     and launch_canonical.occurrence_id = launch.last_source_occurrence_id
     and launch_canonical.block_hash =
        launch.last_source_occurrence_block_hash
    join programmable_private.chain_event_materialized_occurrences_v1
      as source_occurrence
      on source_occurrence.occurrence_id =
        launch.last_source_occurrence_id
     and source_occurrence.logical_event_id =
        launch.last_source_logical_event_id
     and source_occurrence.block_hash =
        launch.last_source_occurrence_block_hash
     and source_occurrence.chain_id = launch.chain_id
     and source_occurrence.release_id = launch.release_id
     and source_occurrence.model_id = launch.model_id
     and source_occurrence.source_group = run.source_group
     and source_occurrence.epoch_id = launch.epoch_id
     and source_occurrence.pointer_generation = launch.pointer_generation
    join programmable_private.pool_projections as pool
      on pool.launch_projection_id = launch.launch_projection_id
     and pool.projection_run_id = launch.projection_run_id
     and pool.chain_id = launch.chain_id
     and pool.release_id = launch.release_id
     and pool.model_id = launch.model_id
     and pool.epoch_id = launch.epoch_id
     and pool.pointer_generation = launch.pointer_generation
     and pool.pool_id = launch.pool_id
     and pool.promoted_block_number = launch.promoted_block_number
     and pool.promoted_block_hash = launch.promoted_block_hash
     and (pool.currency0 = launch.token or pool.currency1 = launch.token)
    join programmable_private.chain_event_current_canonical
      as pool_canonical
      on pool_canonical.logical_event_id = pool.last_source_logical_event_id
     and pool_canonical.occurrence_id = pool.last_source_occurrence_id
     and pool_canonical.block_hash = pool.last_source_occurrence_block_hash
    join programmable_private.chain_event_materialized_occurrences_v1
      as pool_source_occurrence
      on pool_source_occurrence.occurrence_id = pool.last_source_occurrence_id
     and pool_source_occurrence.logical_event_id =
        pool.last_source_logical_event_id
     and pool_source_occurrence.block_hash =
        pool.last_source_occurrence_block_hash
     and pool_source_occurrence.chain_id = launch.chain_id
     and pool_source_occurrence.release_id = launch.release_id
     and pool_source_occurrence.model_id = launch.model_id
     and pool_source_occurrence.source_group = run.source_group
     and pool_source_occurrence.epoch_id = launch.epoch_id
     and pool_source_occurrence.pointer_generation =
        launch.pointer_generation
    join programmable_private.pool_fee_configurations as fee
      on fee.pool_projection_id = pool.pool_projection_id
     and fee.projection_run_id = pool.projection_run_id
     and fee.chain_id = pool.chain_id
     and fee.release_id = pool.release_id
     and fee.model_id = pool.model_id
     and fee.epoch_id = pool.epoch_id
     and fee.pointer_generation = pool.pointer_generation
     and fee.promoted_block_number = pool.promoted_block_number
     and fee.promoted_block_hash = pool.promoted_block_hash
    join programmable_private.chain_event_current_canonical as fee_canonical
      on fee_canonical.logical_event_id =
        fee.disclosure_source_logical_event_id
     and fee_canonical.occurrence_id = fee.disclosure_source_occurrence_id
     and fee_canonical.block_hash =
        fee.disclosure_source_occurrence_block_hash
    join programmable_private.chain_event_materialized_occurrences_v1
      as fee_source_occurrence
      on fee_source_occurrence.occurrence_id =
        fee.disclosure_source_occurrence_id
     and fee_source_occurrence.logical_event_id =
        fee.disclosure_source_logical_event_id
     and fee_source_occurrence.block_hash =
        fee.disclosure_source_occurrence_block_hash
     and fee_source_occurrence.chain_id = launch.chain_id
     and fee_source_occurrence.release_id = launch.release_id
     and fee_source_occurrence.model_id = launch.model_id
     and fee_source_occurrence.source_group = run.source_group
     and fee_source_occurrence.epoch_id = launch.epoch_id
     and fee_source_occurrence.pointer_generation = launch.pointer_generation
    join programmable_private.launch_position_liquidity_facts as liquidity
      on liquidity.launch_projection_id = launch.launch_projection_id
     and liquidity.projection_run_id = launch.projection_run_id
     and liquidity.chain_id = launch.chain_id
     and liquidity.release_id = launch.release_id
     and liquidity.model_id = launch.model_id
     and liquidity.source_group = run.source_group
     and liquidity.epoch_id = launch.epoch_id
     and liquidity.pointer_generation = launch.pointer_generation
     and liquidity.token = launch.token
     and liquidity.pool_id = launch.pool_id
    join programmable_private.chain_event_current_canonical
      as liquidity_canonical
      on liquidity_canonical.logical_event_id =
        liquidity.source_logical_event_id
     and liquidity_canonical.occurrence_id = liquidity.source_occurrence_id
     and liquidity_canonical.block_hash =
        liquidity.source_occurrence_block_hash
    join programmable_private.chain_event_materialized_occurrences_v1
      as liquidity_source_occurrence
      on liquidity_source_occurrence.occurrence_id =
        liquidity.source_occurrence_id
     and liquidity_source_occurrence.logical_event_id =
        liquidity.source_logical_event_id
     and liquidity_source_occurrence.block_hash =
        liquidity.source_occurrence_block_hash
     and liquidity_source_occurrence.chain_id = launch.chain_id
     and liquidity_source_occurrence.release_id = launch.release_id
     and liquidity_source_occurrence.model_id = launch.model_id
     and liquidity_source_occurrence.source_group = run.source_group
     and liquidity_source_occurrence.epoch_id = launch.epoch_id
     and liquidity_source_occurrence.pointer_generation =
        launch.pointer_generation
    -- Market closes are prior independently reconciled evidence.  Read the
    -- private base fact rather than the parity-gated public view, but bind the
    -- complete release/epoch/pointer scope so another release sharing a pool
    -- id can never satisfy this corpus.
    join lateral (
      select close_fact.*
      from programmable_private.market_block_closes as close_fact
      join programmable_private.reconciliation_records as reconciliation
        on reconciliation.reconciliation_id = close_fact.reconciliation_id
       and reconciliation.mismatch_count = 0
      join programmable_private.run_headers as reconciliation_run
        on reconciliation_run.run_id = reconciliation.run_id
       and reconciliation_run.run_kind = 'reconciliation'
       and reconciliation_run.chain_id = close_fact.chain_id
       and reconciliation_run.release_id = close_fact.release_id
       and reconciliation_run.model_id = close_fact.model_id
       and reconciliation_run.source_group = close_fact.source_group
       and reconciliation_run.epoch_id = close_fact.epoch_id
       and reconciliation_run.captured_pointer_generation =
          close_fact.pointer_generation
      join programmable_private.run_lifecycle_outcomes
        as reconciliation_outcome
        on reconciliation_outcome.run_id = reconciliation_run.run_id
       and reconciliation_outcome.status = 'succeeded'
      join programmable_private.release_epoch_current as market_epoch
        on market_epoch.chain_id = close_fact.chain_id
       and market_epoch.release_id = close_fact.release_id
       and market_epoch.model_id = close_fact.model_id
       and market_epoch.source_group = close_fact.source_group
       and market_epoch.epoch_id = close_fact.epoch_id
       and market_epoch.generation = close_fact.pointer_generation
      join programmable_private.chain_event_current_canonical
        as market_canonical
        on market_canonical.occurrence_id =
          close_fact.last_source_occurrence_id
       and market_canonical.logical_event_id =
          close_fact.last_source_logical_event_id
       and market_canonical.block_hash =
          close_fact.last_source_occurrence_block_hash
      join programmable_private.chain_event_materialized_occurrences_v1
        as market_source_occurrence
        on market_source_occurrence.occurrence_id =
          close_fact.last_source_occurrence_id
       and market_source_occurrence.logical_event_id =
          close_fact.last_source_logical_event_id
       and market_source_occurrence.block_hash =
          close_fact.last_source_occurrence_block_hash
       and market_source_occurrence.chain_id = close_fact.chain_id
       and market_source_occurrence.release_id = close_fact.release_id
       and market_source_occurrence.model_id = close_fact.model_id
       and market_source_occurrence.source_group = close_fact.source_group
       and market_source_occurrence.epoch_id = close_fact.epoch_id
       and market_source_occurrence.pointer_generation =
          close_fact.pointer_generation
      where close_fact.chain_id = launch.chain_id
        and close_fact.release_id = launch.release_id
        and close_fact.model_id = launch.model_id
        and close_fact.source_group = run.source_group
        and close_fact.epoch_id = launch.epoch_id
        and close_fact.pointer_generation = launch.pointer_generation
        and close_fact.pool_id = launch.pool_id
        and close_fact.block_number <= p_checkpoint_block_number::bigint
      order by close_fact.block_number desc,
        close_fact.last_block_global_log_index desc,
        close_fact.market_block_close_id
      limit 1
    ) as market on true
    join programmable_private.current_pool_fee_totals_v1 as fee_total
      on fee_total.chain_id = launch.chain_id
     and fee_total.release_id = launch.release_id
     and fee_total.model_id = launch.model_id
     and fee_total.epoch_id = launch.epoch_id
     and fee_total.pointer_generation = launch.pointer_generation
     and fee_total.pool_id = launch.pool_id
     and (
       fee_total.quote_asset is not distinct from case
         when pool.currency0 = launch.token then pool.currency1
         when pool.currency1 = launch.token then pool.currency0
         else null
       end
       or (
         fee_total.quote_asset is null
         and case
           when pool.currency0 = launch.token then pool.currency1
           when pool.currency1 = launch.token then pool.currency0
           else null
         end = pg_catalog.decode(pg_catalog.repeat('00', 20), 'hex')
       )
     )
    where current_launch.entity_kind = 'launch'
      and current_launch.chain_id = p_chain_id
      and current_launch.release_id = p_release_id
      and current_launch.model_id = p_model_id
      and current_launch.source_group = p_source_group
      and launch.chain_id = p_chain_id
      and launch.release_id = p_release_id
      and launch.model_id = p_model_id
      and run.source_group = p_source_group
      and launch.epoch_id = p_epoch_id
      and launch.pointer_generation = p_pointer_generation
      and launch.promoted_block_number <= p_checkpoint_block_number::bigint
      and launch.is_complete
      and (
        launch.reward_vault is null
        or programmable_private.has_current_verified_reward_seed(
          run.run_id,
          launch.reward_vault
        )
      )
  ), normalized as materialized (
    select
      launch.*,
      pg_catalog.jsonb_build_object(
        'releaseVersion', launch.release_id,
        'modelId', launch.model_id,
        'tokenAddress', '0x' || pg_catalog.encode(launch.token, 'hex'),
        'creatorAddress', '0x' || pg_catalog.encode(launch.creator, 'hex'),
        'launchTransactionHash', '0x' || pg_catalog.encode(
          launch.launch_transaction_hash, 'hex'
        ),
        'launchBlockNumber', launch.launch_source_block_number::text,
        'launchTransactionIndex', launch.launch_transaction_index,
        'launchLogIndex', launch.launch_receipt_log_ordinal,
        'launchedAt', pg_catalog.to_char(
          launch.launch_block_timestamp at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'poolId', '0x' || pg_catalog.encode(launch.pool_id, 'hex'),
        'hookAddress', '0x' || pg_catalog.encode(launch.hook, 'hex'),
        'rewardVaultAddress', case when launch.reward_vault is null then null
          else '0x' || pg_catalog.encode(launch.reward_vault, 'hex') end,
        'positionRecipient', '0x' || pg_catalog.encode(
          launch.position_recipient, 'hex'
        ),
        'positionTokenId', launch.position_token_id::text,
        'launchHash', '0x' || pg_catalog.encode(launch.launch_hash, 'hex'),
        'name', launch.token_name,
        'symbol', launch.token_symbol,
        'decimals', 18,
        'totalSupplyRaw', launch.total_supply::text,
        'quoteAssetAddress', '0x' || pg_catalog.encode(
          launch.normalized_quote_asset, 'hex'
        ),
        'fees', pg_catalog.jsonb_build_object(
          'buySwapFeeBps', launch.buy_swap_fee_bps,
          'sellSwapFeeBps', launch.sell_swap_fee_bps,
          'buyCreatorFeeBps', launch.buy_creator_fee_bps,
          'sellCreatorFeeBps', launch.sell_creator_fee_bps,
          'launcherFeeBps', launch.launcher_fee_bps,
          'transferTaxBps', launch.transfer_tax_bps,
          'lpFeePips', launch.lp_fee_pips
        ),
        'liquidity', pg_catalog.jsonb_build_object(
          'tokenLiquidityAmountRaw', launch.token_liquidity_amount::text,
          'lockedTokenDustRaw', launch.locked_token_dust::text,
          'initialTick', launch.initial_tick,
          'tickLower', launch.tick_lower,
          'tickUpper', launch.tick_upper
        )
      ) as token_json,
      pg_catalog.jsonb_build_object(
        'releaseVersion', launch.release_id,
        'modelId', launch.model_id,
        'tokenAddress', '0x' || pg_catalog.encode(launch.token, 'hex'),
        'poolId', '0x' || pg_catalog.encode(launch.pool_id, 'hex'),
        'quoteAssetAddress', '0x' || pg_catalog.encode(
          launch.normalized_quote_asset, 'hex'
        ),
        'state', pg_catalog.jsonb_build_object(
          'blockNumber', launch.market_block_number::text,
          'blockHash', '0x' || pg_catalog.encode(
            launch.market_block_hash, 'hex'
          ),
          'transactionHash', '0x' || pg_catalog.encode(
            launch.market_last_transaction_hash, 'hex'
          ),
          'transactionIndex', launch.market_last_transaction_index,
          'logIndex', launch.market_last_log_index,
          'sqrtPriceX96', launch.market_sqrt_price_x96::text,
          'liquidity', launch.market_liquidity::text,
          'tick', launch.market_tick,
          'lpFeePips', launch.lp_fee_pips
        ),
        'volume', pg_catalog.jsonb_build_object(
          'quoteAssetAddress', '0x' || pg_catalog.encode(
            launch.normalized_quote_asset, 'hex'
          ),
          'grossQuoteRaw', launch.gross_total::text,
          'creatorFeeQuoteRaw', launch.creator_fee_total::text,
          'launcherFeeQuoteRaw', launch.launcher_fee_total::text
        )
      ) as chart_json
    from launches as launch
  ), ordered_tokens as (
    select * from normalized
    order by launch_source_block_number, launch_transaction_index,
      launch_receipt_log_ordinal, launch_transaction_hash, token
  )
  select
    pg_catalog.count(*),
    coalesce(pg_catalog.jsonb_agg(token_json), '[]'::jsonb),
    coalesce(pg_catalog.jsonb_agg(chart_json), '[]'::jsonb)
  into launch_count, launch_rows, chart_rows
  from ordered_tokens;

  -- The pre-parity contract already captured the immutable current-entity
  -- manifest for this exact checkpoint.  Count launch pointers from that
  -- contract so any missing canonical/publication/base-fact join fails closed
  -- instead of silently shrinking every DTO route together.
  select pg_catalog.count(*) into projected_launch_count
  from pg_catalog.jsonb_array_elements(
    contract_row.current_entities
  ) as entity
  where entity ->> 'entityKind' = 'launch';

  if launch_count = 0
     or launch_count <> projected_launch_count
     or launch_count > p_maximum_entity_count
  then
    raise exception using
      errcode = '54000',
      message = 'reconciler route corpus launch cardinality is invalid';
  end if;

  with token_rows as (
    select token, ordinal
    from pg_catalog.jsonb_array_elements(launch_rows) with ordinality
      as launch_token(token, ordinal)
  ), creators as (
    select
      token ->> 'creatorAddress' as account,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'releaseVersion', token ->> 'releaseVersion',
          'modelId', token ->> 'modelId',
          'tokenAddress', token ->> 'tokenAddress',
          'launchTransactionHash', token ->> 'launchTransactionHash'
        ) order by ordinal
      ) as tokens
    from token_rows
    group by token ->> 'creatorAddress'
  )
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'account', account,
      'tokens', tokens
    ) order by account
  ), '[]'::jsonb)
  into creator_rows
  from creators;

  with vaults as (
    select
      vault.reward_vault_projection_id,
      vault.vault,
      vault.pool_id,
      launch.token,
      launch.token_name,
      launch.token_symbol,
      launch.launch_transaction_hash,
      fee.buy_swap_fee_bps,
      fee.sell_swap_fee_bps,
      fee.launcher_fee_bps,
      coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'allocationIndex', allocation.allocation_index,
            'payoutAddress', '0x' || pg_catalog.encode(
              allocation.payout_address, 'hex'
            ),
            'shareBps', allocation.share_bps,
            'claimableWei', coalesce(balance.claimable_accrued, 0)::text,
            'claimedWei', coalesce(balance.claimed_total, 0)::text
          ) order by allocation.allocation_index
        )
        from programmable_private.reward_allocation_projections as allocation
        left join programmable_private.current_account_reward_balances_v1
          as balance
          on balance.chain_id = allocation.chain_id
         and balance.release_id = allocation.release_id
         and balance.model_id = allocation.model_id
         and balance.epoch_id = allocation.epoch_id
         and balance.pointer_generation = allocation.pointer_generation
         and balance.account = allocation.payout_address
         and balance.vault = vault.vault
        where allocation.reward_vault_projection_id =
          vault.reward_vault_projection_id
          and allocation.allocation_fact_id = vault.current_allocation_fact_id
          and allocation.projection_run_id = vault.projection_run_id
          and allocation.effective_from_block <=
            p_checkpoint_block_number::bigint
          and (
            allocation.effective_to_block is null
            or allocation.effective_to_block >=
              p_checkpoint_block_number::bigint
          )
      ), '[]'::jsonb) as allocations
    from programmable_private.current_reward_vault_projections_v1 as vault
    join programmable_private.current_launch_projections_v1 as launch
      on launch.launch_projection_id = vault.launch_projection_id
    join programmable_private.pool_projections as pool
      on pool.launch_projection_id = launch.launch_projection_id
     and pool.projection_run_id = launch.projection_run_id
    join programmable_private.pool_fee_configurations as fee
      on fee.pool_projection_id = pool.pool_projection_id
     and fee.projection_run_id = pool.projection_run_id
    where vault.chain_id = p_chain_id
      and p_release_id = 'classic-v3'
      and vault.release_id = p_release_id
      and vault.model_id = p_model_id
      and vault.epoch_id = p_epoch_id
      and vault.pointer_generation = p_pointer_generation
      and vault.promoted_block_number <= p_checkpoint_block_number::bigint
  ), ordered_vaults as (
    select *, pg_catalog.jsonb_array_length(allocations) as allocation_count
    from vaults
    order by vault
  )
  select
    pg_catalog.count(*),
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'releaseVersion', 'classic-v3',
      'modelId', 'classic',
      'vaultAddress', '0x' || pg_catalog.encode(vault, 'hex'),
      'poolId', '0x' || pg_catalog.encode(pool_id, 'hex'),
      'tokenAddress', '0x' || pg_catalog.encode(token, 'hex'),
      'tokenName', token_name,
      'tokenSymbol', token_symbol,
      'launchTransactionHash', '0x' || pg_catalog.encode(
        launch_transaction_hash, 'hex'
      ),
      'buySwapFeeBps', buy_swap_fee_bps,
      'sellSwapFeeBps', sell_swap_fee_bps,
      'launcherFeeBps', launcher_fee_bps,
      'allocations', allocations
    ) order by vault), '[]'::jsonb)
  into vault_count, reward_rows
  from ordered_vaults;

  if (p_release_id = 'classic-v3' and vault_count <> launch_count)
    or (p_release_id <> 'classic-v3' and vault_count <> 0)
    or exists (
    select 1 from pg_catalog.jsonb_array_elements(reward_rows) as reward
    where pg_catalog.jsonb_array_length(reward -> 'allocations') = 0
  ) then
    raise exception using
      errcode = '55000',
      message = 'reconciler route corpus reward coverage is incomplete';
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'releaseVersion', launch.token ->> 'releaseVersion',
      'modelId', launch.token ->> 'modelId',
      'account', launch.token ->> 'creatorAddress',
      'launchTransactionHash', launch.token ->> 'launchTransactionHash',
      'tokenAddress', launch.token ->> 'tokenAddress'
    ) order by launch.token ->> 'creatorAddress',
      launch.token ->> 'launchTransactionHash',
      launch.token ->> 'tokenAddress'
  ), '[]'::jsonb)
  into lookup_rows
  from pg_catalog.jsonb_array_elements(launch_rows) as launch(token)
  where p_release_id <> 'classic-v2';

  return query
  select route.route_key, route.compared_count, route.dto
  from programmable_private.assemble_reconciler_routes_v1(
    launch_rows, chart_rows, creator_rows, reward_rows, lookup_rows
  ) as route;
end
$function$;

comment on function programmable_private.get_reconciler_route_corpus_v1(
  bigint, text, text, text, uuid, bigint, uuid, numeric, bytea, integer
) is
  'Returns the bounded deterministic applicable-route corpus for one supported release at one exact current checkpoint without reading public or parity-gated route views.';

revoke all on function programmable_private.get_reconciler_route_corpus_v1(
  bigint, text, text, text, uuid, bigint, uuid, numeric, bytea, integer
) from public;
revoke all on function programmable_private.get_reconciler_route_corpus_v1(
  bigint, text, text, text, uuid, bigint, uuid, numeric, bytea, integer
) from anon, authenticated, service_role, programmable_projector,
  programmable_api_reader, programmable_profile_binder,
  programmable_profile_recovery, programmable_profile_writer,
  programmable_maintenance;
grant execute on function programmable_private.get_reconciler_route_corpus_v1(
  bigint, text, text, text, uuid, bigint, uuid, numeric, bytea, integer
) to programmable_reconciler;

reset role;
