-- A projection transaction writes verified occurrences and their typed facts
-- before the final promotion step marks those occurrences current-canonical.
-- Authorize that exact same-run staging path while retaining the canonical
-- requirement for every occurrence originating outside the open run.

set role programmable_migrator;

create or replace function programmable_private.event_fact_context(
  p_run_id uuid,
  p_source_occurrence_id uuid,
  p_projection_kind text
)
returns table (
  chain_id bigint,
  release_id text,
  model_id text,
  epoch_id uuid,
  pointer_generation bigint,
  logical_event_id uuid,
  occurrence_block_hash bytea,
  source_address bytea
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_projection_event_allowed(
    p_run_id, p_source_occurrence_id, p_projection_kind
  );
  if not exists (
    select 1 from programmable_private.chain_event_current_canonical
    where occurrence_id = p_source_occurrence_id
  ) and not exists (
    select 1 from programmable_private.chain_event_occurrences
    where occurrence_id = p_source_occurrence_id
      and verification_run_id = p_run_id
  ) then
    raise exception using
      errcode = '23514', message = 'event fact source is not current canonical or verified by the open run';
  end if;
  return query
  select materialization.chain_id::bigint, materialization.release_id::text,
         materialization.model_id::text, materialization.epoch_id,
         materialization.pointer_generation, occurrence.logical_event_id,
         occurrence.block_hash::bytea, occurrence.source_address::bytea
  from programmable_private.run_headers as header
  join programmable_private.chain_event_occurrence_materializations
    as materialization
    on materialization.epoch_id = header.epoch_id
   and materialization.pointer_generation = header.captured_pointer_generation
   and materialization.occurrence_id = p_source_occurrence_id
  join programmable_private.chain_event_occurrences as occurrence
    on occurrence.occurrence_id = materialization.occurrence_id
  where header.run_id = p_run_id;
end
$function$;

reset role;
