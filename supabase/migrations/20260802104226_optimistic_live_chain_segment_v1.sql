-- Expose the exact bounded canonical ancestry behind an optimistic head.
--
-- Event readers cannot prove empty blocks. This RPC walks the canonical block
-- pointers themselves, validates that no height or parent hash is missing, and
-- returns at most head - 11 through head. The oldest row's parent_hash also
-- anchors a canonical checkpoint at oldest.block_number - 1.

set role programmable_migrator;

create function programmable_private.list_optimistic_live_chain_segment_v1(
  p_chain_id bigint
)
returns table (
  optimistic_block_id uuid,
  chain_id bigint,
  block_number bigint,
  block_hash bytea,
  parent_hash bytea,
  reorg_generation bigint,
  segment_start_block_number bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  live_head programmable_private.optimistic_chain_head_current_v1%rowtype;
  window_start_block_number bigint;
  returned_row_count bigint;
  expected_row_count bigint;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id is null or p_chain_id <= 0 then
    raise exception using errcode = '22023', message = 'invalid chain id';
  end if;

  select * into live_head
  from programmable_private.optimistic_chain_head_current_v1 as head
  where head.chain_id = p_chain_id;
  if not found then
    return;
  end if;

  window_start_block_number := greatest(
    live_head.segment_start_block_number,
    live_head.block_number - 11
  );
  expected_row_count :=
    live_head.block_number - window_start_block_number + 1;

  return query
  with recursive live_chain as (
    select
      head.chain_id,
      block_row.optimistic_block_id,
      block_row.block_number,
      block_row.block_hash,
      block_row.parent_hash,
      head.reorg_generation
    from programmable_private.optimistic_chain_head_current_v1 as head
    join programmable_private.optimistic_block_observations_v1 as block_row
      on block_row.optimistic_block_id = head.optimistic_block_id
     and block_row.chain_id = head.chain_id
     and block_row.block_number = head.block_number
     and block_row.block_hash = head.block_hash
    where head.chain_id = p_chain_id

    union all

    select
      parent_pointer.chain_id,
      parent_block.optimistic_block_id,
      parent_block.block_number,
      parent_block.block_hash,
      parent_block.parent_hash,
      live_chain.reorg_generation
    from live_chain
    join programmable_private.optimistic_block_current_canonical_v1
      as parent_pointer
      on parent_pointer.chain_id = live_chain.chain_id
     and parent_pointer.block_number = live_chain.block_number - 1
    join programmable_private.optimistic_block_observations_v1 as parent_block
      on parent_block.optimistic_block_id = parent_pointer.optimistic_block_id
     and parent_block.chain_id = parent_pointer.chain_id
     and parent_block.block_number = parent_pointer.block_number
     and parent_block.block_hash = parent_pointer.block_hash
     and parent_block.block_hash = live_chain.parent_hash
    where live_chain.block_number > window_start_block_number
  )
  select
    live_chain.optimistic_block_id,
    live_chain.chain_id::bigint,
    live_chain.block_number::bigint,
    live_chain.block_hash::bytea,
    live_chain.parent_hash::bytea,
    live_chain.reorg_generation::bigint,
    live_head.segment_start_block_number::bigint
  from live_chain
  order by live_chain.block_number;

  get diagnostics returned_row_count = row_count;
  if returned_row_count <> expected_row_count then
    raise exception using
      errcode = '40001',
      message = 'optimistic live chain segment is incomplete';
  end if;
end
$function$;

comment on function
  programmable_private.list_optimistic_live_chain_segment_v1(bigint)
is
  'Returns the complete contiguous current canonical chain segment from max(segment start, head - 11) through head, including empty blocks. The oldest parent hash anchors the immediately preceding checkpoint.';

revoke execute on function
  programmable_private.list_optimistic_live_chain_segment_v1(bigint)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login;

grant execute on function
  programmable_private.list_optimistic_live_chain_segment_v1(bigint)
to programmable_api_reader;

reset role;
