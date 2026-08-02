-- A release page may contain only typed event facts or ignored candidates. It
-- still owns verified occurrences that must be canonicalized atomically with
-- the checkpoint. Route those pages through the evidence-bearing projection
-- promotion and include typed facts plus dispositions in the fold manifest.

set role programmable_migrator;

do $migration$
declare
  function_definition text;
  patched_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'programmable_private.promote_projection_run(uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,timestamp with time zone)'::regprocedure
  ) into function_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $before$  if not exists (
    select 1
    from programmable_private.launch_projections
    where projection_run_id = p_run_id
      and epoch_id = header.epoch_id$before$,
    $after$  if exists (
    select 1
    from programmable_private.launch_projections
    where projection_run_id = p_run_id
  ) and not exists (
    select 1
    from programmable_private.launch_projections
    where projection_run_id = p_run_id
      and epoch_id = header.epoch_id$after$
  );
  if patched_definition = function_definition then
    raise exception 'complete-launch promotion guard definition drifted';
  end if;
  function_definition := patched_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $before$      union select source_occurrence_id from programmable_private.initial_buy_vesting_projections
        where projection_run_id = p_run_id$before$,
    $after$      union select source_occurrence_id from programmable_private.initial_buy_vesting_projections
        where projection_run_id = p_run_id
      union select source_occurrence_id from programmable_private.creator_hook_claim_facts
        where verification_run_id = p_run_id
      union select source_occurrence_id from programmable_private.launcher_hook_claim_facts
        where verification_run_id = p_run_id
      union select source_occurrence_id from programmable_private.creator_fee_checkpoint_facts
        where verification_run_id = p_run_id
      union select source_occurrence_id from programmable_private.reward_configuration_activation_facts
        where verification_run_id = p_run_id$after$
  );
  if patched_definition = function_definition then
    raise exception 'typed-fact source manifest definition drifted';
  end if;
  function_definition := patched_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $before$    union all select 'initial_buy_vesting', vesting_projection_id
      from programmable_private.initial_buy_vesting_projections
      where projection_run_id = p_run_id$before$,
    $after$    union all select 'initial_buy_vesting', vesting_projection_id
      from programmable_private.initial_buy_vesting_projections
      where projection_run_id = p_run_id
    union all select 'creator_hook_claim', creator_hook_claim_fact_id
      from programmable_private.creator_hook_claim_facts
      where verification_run_id = p_run_id
    union all select 'launcher_hook_claim', launcher_hook_claim_fact_id
      from programmable_private.launcher_hook_claim_facts
      where verification_run_id = p_run_id
    union all select 'creator_fee_checkpoint', creator_fee_checkpoint_fact_id
      from programmable_private.creator_fee_checkpoint_facts
      where verification_run_id = p_run_id
    union all select 'reward_configuration_activation', reward_configuration_activation_fact_id
      from programmable_private.reward_configuration_activation_facts
      where verification_run_id = p_run_id
    union all select 'candidate_disposition', disposition_id
      from pg_catalog.unnest(p_candidate_disposition_ids) as disposition(disposition_id)$after$
  );
  if patched_definition = function_definition then
    raise exception 'typed-fact projection manifest definition drifted';
  end if;
  execute patched_definition;

  select pg_catalog.pg_get_functiondef(
    'programmable_private.promote_projection_run_v3(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,uuid,uuid[],uuid,bytea,timestamp with time zone)'::regprocedure
  ) into function_definition;
  patched_definition := pg_catalog.replace(
    function_definition,
    $before$  if not has_launch_rows then
    return programmable_private.promote_projection_cursor_only_v1($before$,
    $after$  if not has_launch_rows
     and coalesce(pg_catalog.cardinality(p_occurrence_ids), 0) = 0
  then
    return programmable_private.promote_projection_cursor_only_v1($after$
  );
  if patched_definition = function_definition then
    raise exception 'occurrence-only promotion dispatch definition drifted';
  end if;
  execute patched_definition;
end
$migration$;

reset role;
