-- The stream wake path needs one bounded head projection. Historical cursor
-- repair and candle coverage remain owned by the scheduled market projector.

set role programmable_migrator;

create index market_block_closes_fast_occurrence_idx
  on programmable_private.market_block_closes (
    chain_id, release_id, model_id, source_group, epoch_id,
    pointer_generation, pool_id, last_source_occurrence_id
  );

create function programmable_private.try_lock_market_projector_pool_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_pool_id bytea
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_chain_id is null
     or p_chain_id <= 0
     or p_release_id is null
     or p_model_id is null
     or p_source_group is null
     or pg_catalog.octet_length(p_pool_id) <> 32
  then
    raise exception using
      errcode = '22023', message = 'invalid market projector pool lock';
  end if;
  return pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_chain_id::text || ':' || p_release_id || ':' || p_model_id || ':' ||
      p_source_group || ':' || pg_catalog.encode(p_pool_id, 'hex'),
      20260802
    )
  );
end
$function$;

create function programmable_private.list_market_projector_fast_lane_v1(
  p_chain_id bigint,
  p_source_projector_version text,
  p_market_projector_version text,
  p_limit integer
)
returns table (
  release_id text,
  model_id text,
  source_group text,
  epoch_id uuid,
  pointer_generation bigint,
  source_checkpoint_id uuid,
  source_checkpoint_generation bigint,
  source_reorg_generation bigint,
  source_checkpoint_block_number bigint,
  source_checkpoint_block_hash bytea,
  source_checkpoint_block_evidence_id uuid,
  token bytea,
  pool_id bytea,
  currency0 bytea,
  currency1 bytea,
  hook bytea,
  pool_key_fee bigint,
  tick_spacing integer,
  token0_decimals smallint,
  token1_decimals smallint,
  total_supply numeric,
  launch_block_number bigint,
  launch_block_timestamp timestamptz,
  market_cursor_id uuid,
  cursor_epoch_id uuid,
  cursor_pointer_generation bigint,
  cursor_generation bigint,
  cursor_reorg_generation bigint,
  cursor_source_checkpoint_id uuid,
  cursor_source_checkpoint_generation bigint,
  cursor_source_reorg_generation bigint,
  cursor_block_evidence_id uuid,
  cursor_block_number bigint,
  cursor_block_hash bytea,
  provider_cursor text,
  hour_coverage_end timestamptz,
  day_coverage_end timestamptz,
  page_commitment bytea,
  advanced_at timestamptz,
  anchor_occurrence_id uuid,
  anchor_logical_event_id uuid,
  anchor_block_evidence_id uuid,
  anchor_block_number bigint,
  anchor_block_hash bytea,
  anchor_block_timestamp timestamptz,
  anchor_transaction_hash bytea,
  anchor_transaction_index bigint,
  anchor_block_global_log_index bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_chain_id is null
     or p_chain_id <= 0
     or p_limit is null
     or p_limit not between 1 and 4
     or p_source_projector_version is null
     or pg_catalog.octet_length(p_source_projector_version) not between 1 and 128
     or p_source_projector_version !~ '^[A-Za-z0-9][A-Za-z0-9._+:/-]*$'
     or p_market_projector_version is null
     or pg_catalog.octet_length(p_market_projector_version) not between 1 and 128
     or p_market_projector_version !~ '^[A-Za-z0-9][A-Za-z0-9._+:/-]*$'
  then
    raise exception using
      errcode = '22023', message = 'invalid market projector fast lane page';
  end if;

  return query
  with supported_scope(release_id, model_id, source_group) as (
    values
      ('classic-v2'::text, 'classic'::text, 'core'::text),
      ('classic-v3', 'classic', 'core'),
      ('stock-paired-v1', 'stock-paired', 'core'),
      ('stock-paired-v2', 'stock-paired', 'core'),
      ('stock-paired-v3', 'stock-paired', 'core')
  ), source_context as (
    select checkpoint.*
    from supported_scope as supported
    join programmable_private.projector_checkpoint_current as current_pointer
      on current_pointer.chain_id = p_chain_id
     and current_pointer.release_id = supported.release_id
     and current_pointer.model_id = supported.model_id
     and current_pointer.source_group = supported.source_group
     and current_pointer.projector_version = p_source_projector_version
    join programmable_private.projector_checkpoints as checkpoint
      on checkpoint.checkpoint_id = current_pointer.checkpoint_id
     and checkpoint.cursor_block_global_log_index = 4294967295
     and checkpoint.cursor_candidate_id = 'empty-page'
    join programmable_private.release_epoch_current as current_epoch
      on current_epoch.chain_id = checkpoint.chain_id
     and current_epoch.release_id = checkpoint.release_id
     and current_epoch.model_id = checkpoint.model_id
     and current_epoch.source_group = checkpoint.source_group
     and current_epoch.epoch_id = checkpoint.epoch_id
     and current_epoch.generation = checkpoint.pointer_generation
  ), candidates as (
    select
      checkpoint.release_id,
      checkpoint.model_id,
      checkpoint.source_group,
      checkpoint.epoch_id,
      checkpoint.pointer_generation,
      checkpoint.checkpoint_id as source_checkpoint_id,
      checkpoint.checkpoint_generation as source_checkpoint_generation,
      checkpoint.reorg_generation as source_reorg_generation,
      checkpoint.block_number::bigint as source_checkpoint_block_number,
      checkpoint.block_hash::bytea as source_checkpoint_block_hash,
      checkpoint.target_block_evidence_id as source_checkpoint_block_evidence_id,
      launch.token::bytea,
      launch.pool_id::bytea,
      launch.currency0::bytea,
      launch.currency1::bytea,
      launch.hook::bytea,
      launch.pool_key_fee::bigint,
      launch.tick_spacing::integer,
      18::smallint as token0_decimals,
      18::smallint as token1_decimals,
      launch.total_supply::numeric,
      launch.promoted_block_number::bigint as launch_block_number,
      launch.launch_block_timestamp,
      cursor_history.market_cursor_id,
      cursor_history.epoch_id as cursor_epoch_id,
      cursor_history.pointer_generation as cursor_pointer_generation,
      cursor_history.cursor_generation,
      cursor_history.reorg_generation as cursor_reorg_generation,
      cursor_history.source_checkpoint_id as cursor_source_checkpoint_id,
      cursor_history.source_checkpoint_generation as cursor_source_checkpoint_generation,
      cursor_history.source_reorg_generation as cursor_source_reorg_generation,
      cursor_history.block_evidence_id as cursor_block_evidence_id,
      cursor_history.block_number::bigint as cursor_block_number,
      cursor_history.block_hash::bytea as cursor_block_hash,
      cursor_history.provider_cursor,
      cursor_history.hour_coverage_end,
      cursor_history.day_coverage_end,
      cursor_history.page_commitment::bytea,
      cursor_history.advanced_at,
      occurrence.occurrence_id as anchor_occurrence_id,
      occurrence.logical_event_id as anchor_logical_event_id,
      materialization.block_evidence_id as anchor_block_evidence_id,
      occurrence.block_number::bigint as anchor_block_number,
      occurrence.block_hash::bytea as anchor_block_hash,
      occurrence.block_timestamp as anchor_block_timestamp,
      occurrence.transaction_hash::bytea as anchor_transaction_hash,
      occurrence.transaction_index::bigint as anchor_transaction_index,
      occurrence.block_global_log_index::bigint as anchor_block_global_log_index,
      pg_catalog.row_number() over (
        partition by checkpoint.release_id, checkpoint.model_id,
          checkpoint.source_group, launch.pool_id
        order by occurrence.block_number desc,
          occurrence.transaction_index desc,
          occurrence.block_global_log_index desc,
          occurrence.occurrence_id desc
      ) as pool_rank
    from source_context as checkpoint
    join programmable_private.launch_by_token_v2 as launch
      on launch.chain_id = checkpoint.chain_id
     and launch.release_id = checkpoint.release_id
     and launch.model_id = checkpoint.model_id
     and launch.source_group = checkpoint.source_group
     and launch.epoch_id = checkpoint.epoch_id
     and launch.pointer_generation = checkpoint.pointer_generation
    join programmable_private.market_projector_cursor_current as current_cursor
      on current_cursor.chain_id = checkpoint.chain_id
     and current_cursor.release_id = checkpoint.release_id
     and current_cursor.model_id = checkpoint.model_id
     and current_cursor.source_group = checkpoint.source_group
     and current_cursor.projector_version = p_market_projector_version
     and current_cursor.pool_id = launch.pool_id
    join programmable_private.market_projector_cursor_history as cursor_history
      on cursor_history.market_cursor_id = current_cursor.market_cursor_id
     and cursor_history.epoch_id = checkpoint.epoch_id
     and cursor_history.pointer_generation = checkpoint.pointer_generation
     and cursor_history.source_reorg_generation = checkpoint.reorg_generation
    join programmable_private.chain_event_occurrence_materializations as materialization
      on materialization.chain_id = checkpoint.chain_id
     and materialization.release_id = checkpoint.release_id
     and materialization.model_id = checkpoint.model_id
     and materialization.source_group = checkpoint.source_group
     and materialization.epoch_id = checkpoint.epoch_id
     and materialization.pointer_generation = checkpoint.pointer_generation
     and programmable_private.is_market_fee_event_v1(
       checkpoint.model_id, materialization.event_type
     )
     and pg_catalog.lower(materialization.decoded_payload ->> 'poolId') =
       '0x' || pg_catalog.encode(launch.pool_id, 'hex')
    join programmable_private.chain_event_occurrences as occurrence
      on occurrence.occurrence_id = materialization.occurrence_id
     and occurrence.chain_id = checkpoint.chain_id
     and occurrence.block_number >= cursor_history.block_number
     and occurrence.block_number <= checkpoint.block_number
    join programmable_private.chain_event_current_canonical as canonical
      on canonical.occurrence_id = occurrence.occurrence_id
     and canonical.logical_event_id = occurrence.logical_event_id
     and canonical.block_hash = occurrence.block_hash
  )
  select
    candidate.release_id, candidate.model_id, candidate.source_group,
    candidate.epoch_id, candidate.pointer_generation,
    candidate.source_checkpoint_id, candidate.source_checkpoint_generation,
    candidate.source_reorg_generation,
    candidate.source_checkpoint_block_number,
    candidate.source_checkpoint_block_hash,
    candidate.source_checkpoint_block_evidence_id,
    candidate.token, candidate.pool_id, candidate.currency0,
    candidate.currency1, candidate.hook, candidate.pool_key_fee,
    candidate.tick_spacing, candidate.token0_decimals,
    candidate.token1_decimals, candidate.total_supply,
    candidate.launch_block_number, candidate.launch_block_timestamp,
    candidate.market_cursor_id, candidate.cursor_epoch_id,
    candidate.cursor_pointer_generation, candidate.cursor_generation,
    candidate.cursor_reorg_generation, candidate.cursor_source_checkpoint_id,
    candidate.cursor_source_checkpoint_generation,
    candidate.cursor_source_reorg_generation,
    candidate.cursor_block_evidence_id, candidate.cursor_block_number,
    candidate.cursor_block_hash, candidate.provider_cursor,
    candidate.hour_coverage_end, candidate.day_coverage_end,
    candidate.page_commitment, candidate.advanced_at,
    candidate.anchor_occurrence_id, candidate.anchor_logical_event_id,
    candidate.anchor_block_evidence_id, candidate.anchor_block_number,
    candidate.anchor_block_hash, candidate.anchor_block_timestamp,
    candidate.anchor_transaction_hash, candidate.anchor_transaction_index,
    candidate.anchor_block_global_log_index
  from candidates as candidate
  where candidate.pool_rank = 1
    and not exists (
      select 1
      from programmable_private.market_block_closes as projected_close
      where projected_close.chain_id = p_chain_id
        and projected_close.release_id = candidate.release_id
        and projected_close.model_id = candidate.model_id
        and projected_close.source_group = candidate.source_group
        and projected_close.epoch_id = candidate.epoch_id
        and projected_close.pointer_generation = candidate.pointer_generation
        and projected_close.pool_id = candidate.pool_id
        and projected_close.last_source_occurrence_id =
          candidate.anchor_occurrence_id
    )
  order by candidate.anchor_block_number desc,
    candidate.anchor_transaction_index desc,
    candidate.anchor_block_global_log_index desc,
    candidate.release_id,
    candidate.pool_id
  limit p_limit;
end
$function$;

create function programmable_private.assert_market_projector_fast_lane_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_source_projector_version text,
  p_market_projector_version text,
  p_pool_id bytea,
  p_epoch_id uuid,
  p_pointer_generation bigint,
  p_source_checkpoint_id uuid,
  p_source_checkpoint_generation bigint,
  p_source_reorg_generation bigint,
  p_source_checkpoint_block_number numeric,
  p_source_checkpoint_block_hash bytea,
  p_source_checkpoint_block_evidence_id uuid,
  p_market_cursor_id uuid,
  p_cursor_generation bigint,
  p_cursor_reorg_generation bigint,
  p_anchor_occurrence_id uuid,
  p_anchor_block_evidence_id uuid,
  p_anchor_block_number numeric,
  p_anchor_block_hash bytea
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_checkpoint_block bigint;
  normalized_anchor_block bigint;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_chain_id is null
     or p_chain_id <= 0
     or pg_catalog.octet_length(p_pool_id) <> 32
     or p_pointer_generation <= 0
     or p_source_checkpoint_generation <= 0
     or p_source_reorg_generation < 0
     or p_cursor_generation <= 0
     or p_cursor_reorg_generation < 0
     or p_source_checkpoint_block_number <> pg_catalog.trunc(p_source_checkpoint_block_number)
     or p_source_checkpoint_block_number < 0
     or p_source_checkpoint_block_number > 9223372036854775807
     or p_anchor_block_number <> pg_catalog.trunc(p_anchor_block_number)
     or p_anchor_block_number < 0
     or p_anchor_block_number > p_source_checkpoint_block_number
     or pg_catalog.octet_length(p_source_checkpoint_block_hash) <> 32
     or pg_catalog.octet_length(p_anchor_block_hash) <> 32
  then
    raise exception using
      errcode = '22023', message = 'invalid market projector fast lane assertion';
  end if;
  normalized_checkpoint_block := p_source_checkpoint_block_number::bigint;
  normalized_anchor_block := p_anchor_block_number::bigint;

  if not exists (
    select 1
    from programmable_private.projector_checkpoint_current as current_pointer
    join programmable_private.projector_checkpoints as checkpoint
      on checkpoint.checkpoint_id = current_pointer.checkpoint_id
    join programmable_private.release_epoch_current as current_epoch
      on current_epoch.chain_id = checkpoint.chain_id
     and current_epoch.release_id = checkpoint.release_id
     and current_epoch.model_id = checkpoint.model_id
     and current_epoch.source_group = checkpoint.source_group
     and current_epoch.epoch_id = checkpoint.epoch_id
     and current_epoch.generation = checkpoint.pointer_generation
    join programmable_private.market_projector_cursor_current as current_cursor
      on current_cursor.chain_id = checkpoint.chain_id
     and current_cursor.release_id = checkpoint.release_id
     and current_cursor.model_id = checkpoint.model_id
     and current_cursor.source_group = checkpoint.source_group
     and current_cursor.projector_version = p_market_projector_version
     and current_cursor.pool_id = p_pool_id
     and current_cursor.market_cursor_id = p_market_cursor_id
     and current_cursor.cursor_generation = p_cursor_generation
     and current_cursor.reorg_generation = p_cursor_reorg_generation
    join programmable_private.market_projector_cursor_history as cursor_history
      on cursor_history.market_cursor_id = current_cursor.market_cursor_id
     and cursor_history.epoch_id = checkpoint.epoch_id
     and cursor_history.pointer_generation = checkpoint.pointer_generation
     and cursor_history.source_reorg_generation = checkpoint.reorg_generation
    where current_pointer.chain_id = p_chain_id
      and current_pointer.release_id = p_release_id
      and current_pointer.model_id = p_model_id
      and current_pointer.source_group = p_source_group
      and current_pointer.projector_version = p_source_projector_version
      and checkpoint.checkpoint_id = p_source_checkpoint_id
      and checkpoint.checkpoint_generation = p_source_checkpoint_generation
      and checkpoint.reorg_generation = p_source_reorg_generation
      and checkpoint.epoch_id = p_epoch_id
      and checkpoint.pointer_generation = p_pointer_generation
      and checkpoint.block_number = normalized_checkpoint_block
      and checkpoint.block_hash = p_source_checkpoint_block_hash
      and checkpoint.target_block_evidence_id = p_source_checkpoint_block_evidence_id
      and checkpoint.cursor_block_global_log_index = 4294967295
      and checkpoint.cursor_candidate_id = 'empty-page'
  ) then
    raise exception using
      errcode = '23514', message = 'market projector fast lane source changed';
  end if;

  if not exists (
    select 1
    from programmable_private.chain_event_occurrence_materializations as materialization
    join programmable_private.chain_event_occurrences as occurrence
      on occurrence.occurrence_id = materialization.occurrence_id
     and occurrence.chain_id = p_chain_id
     and occurrence.block_number = normalized_anchor_block
     and occurrence.block_hash = p_anchor_block_hash
    join programmable_private.chain_event_current_canonical as canonical
      on canonical.occurrence_id = occurrence.occurrence_id
     and canonical.logical_event_id = occurrence.logical_event_id
     and canonical.block_hash = occurrence.block_hash
    where materialization.occurrence_id = p_anchor_occurrence_id
      and materialization.chain_id = p_chain_id
      and materialization.release_id = p_release_id
      and materialization.model_id = p_model_id
      and materialization.source_group = p_source_group
      and materialization.epoch_id = p_epoch_id
      and materialization.pointer_generation = p_pointer_generation
      and materialization.block_evidence_id = p_anchor_block_evidence_id
      and programmable_private.is_market_fee_event_v1(
        p_model_id, materialization.event_type
      )
      and pg_catalog.lower(materialization.decoded_payload ->> 'poolId') =
        '0x' || pg_catalog.encode(p_pool_id, 'hex')
      and not exists (
        select 1
        from programmable_private.market_block_closes as projected_close
        where projected_close.chain_id = p_chain_id
          and projected_close.release_id = p_release_id
          and projected_close.model_id = p_model_id
          and projected_close.source_group = p_source_group
          and projected_close.epoch_id = p_epoch_id
          and projected_close.pointer_generation = p_pointer_generation
          and projected_close.pool_id = p_pool_id
          and projected_close.last_source_occurrence_id =
            p_anchor_occurrence_id
      )
  ) then
    raise exception using
      errcode = '23514', message = 'market projector fast lane anchor changed';
  end if;
  return true;
end
$function$;

revoke all on function
  programmable_private.try_lock_market_projector_pool_v1(
    bigint,text,text,text,bytea
  ),
  programmable_private.list_market_projector_fast_lane_v1(
    bigint,text,text,integer
  ),
  programmable_private.assert_market_projector_fast_lane_v1(
    bigint,text,text,text,text,text,bytea,uuid,bigint,uuid,bigint,bigint,
    numeric,bytea,uuid,uuid,bigint,bigint,uuid,uuid,numeric,bytea
  )
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_projector_runtime;

grant execute on function
  programmable_private.try_lock_market_projector_pool_v1(
    bigint,text,text,text,bytea
  ),
  programmable_private.list_market_projector_fast_lane_v1(
    bigint,text,text,integer
  ),
  programmable_private.assert_market_projector_fast_lane_v1(
    bigint,text,text,text,text,text,bytea,uuid,bigint,uuid,bigint,bigint,
    numeric,bytea,uuid,uuid,bigint,bigint,uuid,uuid,numeric,bytea
  )
to programmable_reconciler;

alter function programmable_private.try_lock_market_projector_pool_v1(
  bigint,text,text,text,bytea
) owner to programmable_migrator;
alter function programmable_private.list_market_projector_fast_lane_v1(
  bigint,text,text,integer
) owner to programmable_migrator;
alter function programmable_private.assert_market_projector_fast_lane_v1(
  bigint,text,text,text,text,text,bytea,uuid,bigint,uuid,bigint,bigint,
  numeric,bytea,uuid,uuid,bigint,bigint,uuid,uuid,numeric,bytea
) owner to programmable_migrator;

reset role;
