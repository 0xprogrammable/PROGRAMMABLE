-- Liquidity configuration events deliberately omit poolId. The pool is bound
-- by the launch occurrence; the liquidity occurrence binds token + launchHash
-- and has a release-specific event type.

set role programmable_migrator;

create or replace function programmable_private.stage_launch_position_liquidity_v1(
  p_launch_position_liquidity_fact_id uuid,
  p_launch_projection_id uuid,
  p_run_id uuid,
  p_position_recipient bytea,
  p_position_token_id numeric,
  p_token_liquidity_amount numeric,
  p_locked_token_dust numeric, -- gitleaks:allow
  p_initial_sqrt_price_x96 numeric,
  p_initial_tick integer,
  p_tick_lower integer,
  p_tick_upper integer,
  p_source_occurrence_id uuid,
  p_fact_commitment bytea,
  p_verified_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  launch programmable_private.launch_projections%rowtype;
  occurrence programmable_private.chain_event_occurrences%rowtype;
  materialization
    programmable_private.chain_event_occurrence_materializations%rowtype;
  position_id numeric;
  liquidity_amount numeric;
  locked_dust numeric;
  sqrt_price numeric;
  tick_policy_ok boolean;
  liquidity_event_ok boolean;
  existing programmable_private.launch_position_liquidity_facts%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'projection';
  if not found or exists (
    select 1 from programmable_private.run_lifecycle_outcomes
    where run_id = p_run_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'launch liquidity requires an open projection run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  select * into launch from programmable_private.launch_projections
  where launch_projection_id = p_launch_projection_id
    and projection_run_id = p_run_id
    and chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  select * into occurrence
  from programmable_private.chain_event_occurrences
  where occurrence_id = p_source_occurrence_id;
  select * into materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = p_source_occurrence_id
    and chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  position_id := programmable_private.validate_uint256(p_position_token_id);
  liquidity_amount :=
    programmable_private.validate_uint256(p_token_liquidity_amount);
  locked_dust := programmable_private.validate_uint256(p_locked_token_dust);
  sqrt_price := programmable_private.validate_uint256(p_initial_sqrt_price_x96);
  tick_policy_ok :=
    p_tick_lower < p_initial_tick and p_initial_tick < p_tick_upper
    or (
      header.release_id in ('classic-v2', 'classic-v3')
      and header.model_id in ('classic', header.release_id)
      and p_tick_lower < p_initial_tick
      and p_initial_tick = p_tick_upper
    );
  liquidity_event_ok :=
    header.release_id = 'classic-v2'
      and occurrence.event_type = 'MemeLiquidityConfigured'
    or header.release_id = 'classic-v3'
      and occurrence.event_type = 'MemeLiquidityConfiguredV2'
    or header.release_id in (
      'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
    ) and occurrence.event_type = 'StockPairedLiquidityConfigured';
  if launch.launch_projection_id is null
     or occurrence.occurrence_id is null
     or materialization.materialization_id is null
     or materialization.event_type is distinct from occurrence.event_type
     or not coalesce(liquidity_event_ok, false)
     or occurrence.block_number > launch.promoted_block_number
     or pg_catalog.octet_length(p_position_recipient) <> 20
     or p_initial_tick not between -887272 and 887272
     or p_tick_lower not between -887272 and 887272
     or p_tick_upper not between -887272 and 887272
     or not coalesce(tick_policy_ok, false)
     or liquidity_amount is null
     or locked_dust is null
     or liquidity_amount + locked_dust > launch.total_supply
     or pg_catalog.octet_length(p_fact_commitment) <> 32
     or programmable_private.json_hex_bytes_v1(
       materialization.decoded_payload, 'token', 20
     ) is distinct from launch.token
     or programmable_private.json_hex_bytes_v1(
       materialization.decoded_payload, 'launchHash', 32
     ) is distinct from launch.launch_hash
  then
    raise exception using
      errcode = '23514',
      message = 'launch position/liquidity lacks exact canonical source';
  end if;
  select * into existing
  from programmable_private.launch_position_liquidity_facts
  where launch_projection_id = p_launch_projection_id;
  if found then
    if existing.launch_position_liquidity_fact_id
         <> p_launch_position_liquidity_fact_id
       or existing.position_recipient <> p_position_recipient
       or existing.position_token_id <> position_id
       or existing.token_liquidity_amount <> liquidity_amount
       or existing.locked_token_dust <> locked_dust
       or existing.initial_sqrt_price_x96 <> sqrt_price
       or existing.initial_tick <> p_initial_tick
       or existing.tick_lower <> p_tick_lower
       or existing.tick_upper <> p_tick_upper
       or existing.source_occurrence_id <> p_source_occurrence_id
       or existing.fact_commitment <> p_fact_commitment
    then
      raise exception using
        errcode = '23505', message = 'launch liquidity replay conflict';
    end if;
    return existing.launch_position_liquidity_fact_id;
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'launch_position_liquidity.stage', p_fact_commitment,
    p_run_id, p_verified_at
  );
  insert into programmable_private.launch_position_liquidity_facts (
    launch_position_liquidity_fact_id, launch_projection_id,
    chain_id, release_id, model_id, source_group, epoch_id,
    pointer_generation, token, pool_id, position_recipient,
    position_token_id, token_liquidity_amount, locked_token_dust,
    initial_sqrt_price_x96, initial_tick, tick_lower, tick_upper,
    source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash, projection_run_id,
    fact_commitment, verified_at, audit_id
  ) values (
    p_launch_position_liquidity_fact_id, launch.launch_projection_id,
    launch.chain_id, launch.release_id, launch.model_id, header.source_group,
    launch.epoch_id, launch.pointer_generation, launch.token, launch.pool_id,
    p_position_recipient::programmable_private.eth_address,
    position_id::programmable_private.uint256_value,
    liquidity_amount::programmable_private.uint256_value,
    locked_dust::programmable_private.uint256_value,
    sqrt_price::programmable_private.uint256_value,
    p_initial_tick, p_tick_lower, p_tick_upper,
    occurrence.occurrence_id, occurrence.logical_event_id,
    occurrence.block_hash, p_run_id,
    p_fact_commitment::programmable_private.bytes32_value,
    p_verified_at, created_audit_id
  );
  return p_launch_position_liquidity_fact_id;
end
$function$;

reset role;
