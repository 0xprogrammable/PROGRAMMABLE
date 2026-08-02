-- A relevant block is the projector atomicity boundary. Keep one exact page
-- intact through the already-reviewed 4,096-candidate atomic-group ceiling so
-- blocks above the former UI-sized page limit cannot wedge ingestion.

set role programmable_migrator;

alter table programmable_private.dual_rpc_log_coverage_evidence
  drop constraint dual_rpc_log_coverage_exact_page_shape_check,
  add constraint dual_rpc_log_coverage_exact_page_shape_check check (
    pg_catalog.cardinality(ordered_log_commitments_a) between 0 and 4096
    and programmable_private.valid_topics(ordered_log_commitments_a)
    and ordered_log_commitments_a = ordered_log_commitments_b
    and ordered_log_commitments_a = ordered_inbox_commitments
    and (
      (
        pg_catalog.cardinality(ordered_log_commitments_a) = 0
        and final_block_global_log_index = 4294967295
        and final_candidate_id = 'empty-page'
      )
      or
      (
        pg_catalog.cardinality(ordered_log_commitments_a) between 1 and 4096
        and final_candidate_id <> 'empty-page'
      )
    )
  );

do $migration$
declare
  commitments_constraint name;
  candidates_constraint name;
begin
  select constraint_row.conname into strict commitments_constraint
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid =
      'programmable_private.provisional_dynamic_parent_pages'::regclass
    and constraint_row.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
      '%cardinality(provider_a_parent_commitments)%';

  select constraint_row.conname into strict candidates_constraint
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid =
      'programmable_private.provisional_dynamic_parent_pages'::regclass
    and constraint_row.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
      '%cardinality(parent_candidate_ids)%';

  execute pg_catalog.format(
    'alter table programmable_private.provisional_dynamic_parent_pages drop constraint %I',
    commitments_constraint
  );
  execute pg_catalog.format(
    'alter table programmable_private.provisional_dynamic_parent_pages drop constraint %I',
    candidates_constraint
  );
exception
  when no_data_found or too_many_rows then
    raise exception using
      errcode = '55000',
      message = 'unexpected provisional dynamic-parent constraint shape';
end
$migration$;

alter table programmable_private.provisional_dynamic_parent_pages
  add constraint provisional_dynamic_parent_commitments_count_check check (
    provider_a_parent_commitments = provider_b_parent_commitments
    and provider_a_parent_commitments = parent_candidate_commitments
    and pg_catalog.cardinality(provider_a_parent_commitments)
      between 1 and 4096
    and programmable_private.valid_topics(provider_a_parent_commitments)
  ),
  add constraint provisional_dynamic_parent_candidates_count_check check (
    pg_catalog.cardinality(parent_candidate_ids) between 1 and 4096
    and pg_catalog.cardinality(parent_candidate_ids) =
      pg_catalog.cardinality(parent_candidate_commitments)
    and pg_catalog.cardinality(parent_candidate_ids) =
      pg_catalog.jsonb_array_length(parent_candidates)
  );

do $migration$
declare
  function_name text;
  function_definition text;
  old_fragment text;
  new_fragment text;
  expected_replacements integer;
  actual_replacements integer;
begin
  for function_name, old_fragment, new_fragment, expected_replacements in
    values
      (
        'append_dual_rpc_log_coverage_evidence',
        'between 0 and 2000',
        'between 0 and 4096',
        1
      ),
      (
        'commit_envio_ingestion_page_v1',
        'not between 0 and 2000',
        'not between 0 and 4096',
        1
      )
  loop
    select pg_catalog.pg_get_functiondef(procedure_row.oid)
      into strict function_definition
    from pg_catalog.pg_proc as procedure_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'programmable_private'
      and procedure_row.proname = function_name;

    actual_replacements :=
      (pg_catalog.length(function_definition) - pg_catalog.length(
        pg_catalog.replace(function_definition, old_fragment, '')
      )) / pg_catalog.length(old_fragment);
    if actual_replacements <> expected_replacements then
      raise exception using
        errcode = '55000',
        message = 'unexpected ingestion function shape for ' || function_name;
    end if;
    execute pg_catalog.replace(
      function_definition,
      old_fragment,
      new_fragment
    );
  end loop;
exception
  when no_data_found or too_many_rows then
    raise exception using
      errcode = '55000',
      message = 'unexpected ingestion function overload set';
end
$migration$;

do $migration$
declare
  function_definition text;
  replacement_count integer;
begin
  select pg_catalog.pg_get_functiondef(procedure_row.oid)
    into strict function_definition
  from pg_catalog.pg_proc as procedure_row
  join pg_catalog.pg_namespace as namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'programmable_private'
    and procedure_row.proname = 'stage_verified_dynamic_parents_v2';

  replacement_count :=
    (pg_catalog.length(function_definition) - pg_catalog.length(
      pg_catalog.replace(function_definition, 'not between 1 and 32', '')
    )) / pg_catalog.length('not between 1 and 32');
  if replacement_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'unexpected provisional staging cardinality shape';
  end if;
  function_definition := pg_catalog.replace(
    function_definition,
    'not between 1 and 32',
    'not between 1 and 4096'
  );

  replacement_count :=
    (pg_catalog.length(function_definition) - pg_catalog.length(
      pg_catalog.replace(function_definition, '> 262144', '')
    )) / pg_catalog.length('> 262144');
  if replacement_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'unexpected provisional parent payload shape';
  end if;
  function_definition := pg_catalog.replace(
    function_definition,
    '> 262144',
    '> 33554432'
  );

  replacement_count :=
    (pg_catalog.length(function_definition) - pg_catalog.length(
      pg_catalog.replace(function_definition, '> 65536', '')
    )) / pg_catalog.length('> 65536');
  if replacement_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'unexpected provisional source payload shape';
  end if;
  function_definition := pg_catalog.replace(
    function_definition,
    '> 65536',
    '> 8388608'
  );

  execute function_definition;
exception
  when no_data_found or too_many_rows then
    raise exception using
      errcode = '55000',
      message = 'unexpected provisional staging overload set';
end
$migration$;

-- Reorg recovery is one process-fenced database transition. A release may
-- have no candidate-backed checkpoint below the common ancestor (including
-- its first published block). Such a release receives an explicit neutral
-- checkpoint at the proven ancestor and replays from the beginning; it never
-- invents an Envio candidate for the genesis boundary.
alter table programmable_private.projector_checkpoints
  alter column cursor_block_global_log_index drop not null,
  alter column cursor_candidate_id drop not null,
  alter column safe_head_observation_id drop not null,
  alter column target_block_evidence_id drop not null,
  add column is_neutral boolean not null default false,
  add constraint projector_checkpoint_recovery_shape_check check (
    (
      not is_neutral
      and cursor_block_global_log_index is not null
      and cursor_candidate_id is not null
      and safe_head_observation_id is not null
      and target_block_evidence_id is not null
    )
    or
    (
      is_neutral
      and cursor_block_global_log_index is null
      and cursor_candidate_id is null
      and safe_head_observation_id is null
      and target_block_evidence_id is null
    )
  );

create table programmable_private.projector_reorg_recovery_history (
  recovery_id uuid primary key,
  expected_reorg_generation bigint not null check (
    expected_reorg_generation >= 0
  ),
  next_reorg_generation bigint not null check (
    next_reorg_generation = expected_reorg_generation + 1
  ),
  expected_cursor_generation bigint not null check (
    expected_cursor_generation > 0
  ),
  next_cursor_generation bigint not null check (
    next_cursor_generation = expected_cursor_generation + 1
  ),
  target_history_generation bigint not null check (
    target_history_generation >= 0
    and target_history_generation < expected_cursor_generation
  ),
  target_block_number programmable_private.block_number_value not null,
  target_block_hash programmable_private.bytes32_value not null,
  target_block_global_log_index bigint,
  target_candidate_id text,
  genesis_point_id uuid references
    programmable_private.envio_ingestion_cursor_genesis_points(
      genesis_point_id
    ) on delete restrict,
  verification_run_id uuid not null
    references programmable_private.run_headers(run_id) on delete restrict,
  safe_head_observation_id uuid not null
    references programmable_private.safe_head_observations(observation_id)
    on delete restrict,
  target_block_evidence_id uuid not null
    references programmable_private.dual_rpc_block_evidence(block_evidence_id)
    on delete restrict,
  runtime_lease_generation bigint not null check (
    runtime_lease_generation > 0
  ),
  reason_commitment programmable_private.bytes32_value not null,
  recovered_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (
    (
      target_history_generation = 0
      and genesis_point_id is not null
      and target_block_global_log_index is null
      and target_candidate_id is null
    )
    or
    (
      target_history_generation > 0
      and genesis_point_id is null
      and (
        (
          target_block_global_log_index is null
          and target_candidate_id is null
        )
        or
        (
          target_block_global_log_index between 0 and 4294967295
          and target_candidate_id is not null
        )
      )
    )
  ),
  unique (next_reorg_generation),
  unique (verification_run_id)
);

create table programmable_private.projector_reorg_current (
  singleton_key text primary key check (
    singleton_key = 'canonical-projector-reorg-v1'
  ),
  reorg_generation bigint not null check (reorg_generation >= 0),
  recovery_id uuid unique references
    programmable_private.projector_reorg_recovery_history(recovery_id)
    on delete restrict,
  changed_at timestamptz,
  check (
    (reorg_generation = 0 and recovery_id is null and changed_at is null)
    or
    (reorg_generation > 0 and recovery_id is not null and changed_at is not null)
  )
);

insert into programmable_private.projector_reorg_current (
  singleton_key, reorg_generation
) values ('canonical-projector-reorg-v1', 0);

alter table programmable_private.projector_reorg_recovery_history
  enable row level security;
alter table programmable_private.projector_reorg_recovery_history
  force row level security;
create policy projector_reorg_recovery_history_migrator_all
  on programmable_private.projector_reorg_recovery_history
  for all to programmable_migrator using (true) with check (true);
alter table programmable_private.projector_reorg_current
  enable row level security;
alter table programmable_private.projector_reorg_current
  force row level security;
create policy projector_reorg_current_migrator_all
  on programmable_private.projector_reorg_current
  for all to programmable_migrator using (true) with check (true);

create trigger projector_reorg_recovery_history_immutable
before update or delete
on programmable_private.projector_reorg_recovery_history
for each row execute function programmable_private.reject_immutable_mutation();

create function programmable_private.get_projector_reorg_targets_v1(
  p_provider_deployment_id uuid,
  p_stream_id text,
  p_maximum_depth integer default 128
)
returns table (
  target_kind text,
  history_generation bigint,
  genesis_point_id uuid,
  block_number bigint,
  block_hash bytea,
  block_global_log_index bigint,
  candidate_id text,
  current_reorg_generation bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_cursor programmable_private.envio_ingestion_cursor_current%rowtype;
  current_reorg bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_maximum_depth not between 1 and 128 then
    raise exception using errcode = '22023', message = 'invalid reorg depth';
  end if;
  select * into current_cursor
  from programmable_private.envio_ingestion_cursor_current as cursor
  where cursor.chain_id = 1
    and cursor.provider_deployment_id = p_provider_deployment_id
    and cursor.stream_id = p_stream_id;
  if not found or current_cursor.generation < 1 then
    raise exception using errcode = '40001', message = 'reorg cursor is stale';
  end if;
  select pointer.reorg_generation into strict current_reorg
  from programmable_private.projector_reorg_current as pointer
  where pointer.singleton_key = 'canonical-projector-reorg-v1';

  return query
  with history_targets as (
    select 'history'::text as target_kind,
      history.generation as history_generation,
      null::uuid as genesis_point_id,
      history.block_number::bigint as block_number,
      history.block_hash::bytea as block_hash,
      history.block_global_log_index::bigint as block_global_log_index,
      history.candidate_id::text as candidate_id,
      current_reorg as current_reorg_generation,
      0 as target_order,
      history.generation as generation_order
    from programmable_private.envio_ingestion_cursor_history as history
    where history.chain_id = 1
      and history.provider_deployment_id = p_provider_deployment_id
      and history.stream_id = p_stream_id
      and history.generation < current_cursor.generation
    order by history.generation desc
    limit pg_catalog.greatest(p_maximum_depth - 1, 0)
  ), genesis_target as (
    select 'genesis'::text,
      0::bigint,
      genesis.genesis_point_id,
      genesis.anchor_block_number::bigint,
      genesis.anchor_block_hash::bytea,
      null::bigint,
      null::text,
      current_reorg,
      1,
      0::bigint
    from programmable_private.envio_ingestion_cursor_genesis_points as genesis
    where genesis.chain_id = 1
      and genesis.provider_deployment_id = p_provider_deployment_id
      and genesis.stream_id = p_stream_id
  )
  select target.target_kind, target.history_generation,
    target.genesis_point_id, target.block_number, target.block_hash,
    target.block_global_log_index, target.candidate_id,
    target.current_reorg_generation
  from (
    select * from history_targets
    union all
    select * from genesis_target
  ) as target
  order by target.target_order, target.generation_order desc
  limit p_maximum_depth;
end
$function$;

create function programmable_private.get_projector_reorg_generation_v1()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_generation bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select pointer.reorg_generation into strict current_generation
  from programmable_private.projector_reorg_current as pointer
  where pointer.singleton_key = 'canonical-projector-reorg-v1';
  return current_generation;
end
$function$;

-- The normal projector promotion path treats a neutral recovery checkpoint as
-- the beginning of the release stream. This is the only semantic change to
-- the reviewed function and is guarded by an exact replacement count.
do $migration$
declare
  function_definition text;
  replacement_count integer;
begin
  select pg_catalog.pg_get_functiondef(procedure_row.oid)
    into strict function_definition
  from pg_catalog.pg_proc as procedure_row
  join pg_catalog.pg_namespace as namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'programmable_private'
    and procedure_row.proname = 'promote_projection_run';
  replacement_count :=
    (pg_catalog.length(function_definition) - pg_catalog.length(
      pg_catalog.replace(
        function_definition,
        'previous_checkpoint.checkpoint_id is null',
        ''
      )
    )) / pg_catalog.length('previous_checkpoint.checkpoint_id is null');
  if replacement_count <> 2 then
    raise exception using
      errcode = '55000',
      message = 'unexpected projection promotion checkpoint shape';
  end if;
  execute pg_catalog.replace(
    function_definition,
    'previous_checkpoint.checkpoint_id is null',
    'previous_checkpoint.checkpoint_id is null or previous_checkpoint.is_neutral'
  );
end
$migration$;

-- A reorg boundary is an exact chain placement, not only a block height. At
-- the target height, rows from another block hash are always invalid. For a
-- history target on the same block, rows after the target log are invalid too.
-- A genesis target has no log boundary, so only its exact block hash survives.
create function programmable_private.projector_reorg_invalidates_placement_v1(
  p_block_number bigint,
  p_block_hash bytea,
  p_block_global_log_index bigint,
  p_target_block_number bigint,
  p_target_block_hash bytea,
  p_target_block_global_log_index bigint
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select
    p_block_number > p_target_block_number
    or (
      p_block_number = p_target_block_number
      and (
        p_block_hash <> p_target_block_hash
        or (
          p_target_block_global_log_index is not null
          and p_block_global_log_index > p_target_block_global_log_index
        )
      )
    )
$function$;

-- Projection rows inherit their exact replay boundary from the checkpoint that
-- published their run. This preserves legacy mid-block checkpoints: a row
-- published later in the same block is rebuilt even when its promoted block
-- number and hash match the selected ancestor.
create function programmable_private.projector_reorg_invalidates_projection_run_v1(
  p_projection_run_id uuid,
  p_promoted_block_number bigint,
  p_promoted_block_hash bytea,
  p_ancestor_block_number bigint,
  p_ancestor_block_hash bytea,
  p_ancestor_block_global_log_index bigint
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  publication record;
begin
  if p_ancestor_block_number is null
     and p_ancestor_block_hash is null
     and p_ancestor_block_global_log_index is null
  then
    return true;
  end if;
  if p_projection_run_id is null
     or p_promoted_block_number is null
     or p_promoted_block_hash is null
     or p_ancestor_block_number is null
     or p_ancestor_block_hash is null
     or p_ancestor_block_global_log_index is null
  then
    return true;
  end if;

  select
    projection_publication.target_block_number,
    projection_publication.target_block_hash,
    checkpoint.block_number as checkpoint_block_number,
    checkpoint.block_hash as checkpoint_block_hash,
    checkpoint.cursor_block_global_log_index,
    checkpoint.is_neutral
  into publication
  from programmable_private.projection_publications
    as projection_publication
  join programmable_private.projector_checkpoints as checkpoint
    on checkpoint.checkpoint_id = projection_publication.checkpoint_id
  where projection_publication.run_id = p_projection_run_id;

  if not found
     or publication.is_neutral
     or publication.cursor_block_global_log_index is null
     or publication.target_block_number <> p_promoted_block_number
     or publication.target_block_hash <> p_promoted_block_hash
     or publication.checkpoint_block_number <>
       publication.target_block_number
     or publication.checkpoint_block_hash <>
       publication.target_block_hash
  then
    return true;
  end if;

  return programmable_private.projector_reorg_invalidates_placement_v1(
    publication.checkpoint_block_number,
    publication.checkpoint_block_hash,
    publication.cursor_block_global_log_index,
    p_ancestor_block_number,
    p_ancestor_block_hash,
    p_ancestor_block_global_log_index
  );
end
$function$;

-- Rebuildable projection rows are removed in strict foreign-key order. The
-- reward-vault snapshot chain is self-referential, so leaves are removed
-- before their baselines. A surviving child of an invalid baseline fails the
-- recovery closed instead of silently preserving inconsistent state.
create function programmable_private.delete_projector_projection_replay_scope_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_ancestor_block_number bigint,
  p_ancestor_block_hash bytea,
  p_ancestor_block_global_log_index bigint
)
returns bigint
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  affected_rows bigint;
  deleted_rows bigint := 0;
begin
  if p_chain_id is null or p_chain_id <> 1
     or p_release_id is null
     or pg_catalog.octet_length(p_release_id) not between 1 and 128
     or p_model_id is null
     or pg_catalog.octet_length(p_model_id) not between 1 and 128
     or (p_ancestor_block_number is null) <>
       (p_ancestor_block_hash is null)
     or (p_ancestor_block_number is null) <>
       (p_ancestor_block_global_log_index is null)
     or (
       p_ancestor_block_number is not null
       and (
         p_ancestor_block_number < 0
         or pg_catalog.octet_length(p_ancestor_block_hash) <> 32
         or p_ancestor_block_global_log_index < 0
         or p_ancestor_block_global_log_index > 4294967295
       )
     )
  then
    raise exception using
      errcode = '22023', message = 'invalid projection replay scope';
  end if;

  delete from programmable_private.initial_buy_vesting_projections
  where chain_id = p_chain_id and release_id = p_release_id
    and model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      projection_run_id, promoted_block_number, promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.initial_buy_custody_projections
  where chain_id = p_chain_id and release_id = p_release_id
    and model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      projection_run_id, promoted_block_number, promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.account_reward_balances
  where chain_id = p_chain_id and release_id = p_release_id
    and model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      projection_run_id, promoted_block_number, promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.payout_change_projections
  where chain_id = p_chain_id and release_id = p_release_id
    and model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      projection_run_id, promoted_block_number, promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.claim_projections
  where chain_id = p_chain_id and release_id = p_release_id
    and model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      projection_run_id, promoted_block_number, promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.reward_allocation_projections
  where chain_id = p_chain_id and release_id = p_release_id
    and model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      projection_run_id, promoted_block_number, promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  loop
    delete from programmable_private.reward_vault_projections as vault
    where vault.chain_id = p_chain_id
      and vault.release_id = p_release_id
      and vault.model_id = p_model_id
      and programmable_private.projector_reorg_invalidates_projection_run_v1(
        vault.projection_run_id,
        vault.promoted_block_number, vault.promoted_block_hash,
        p_ancestor_block_number, p_ancestor_block_hash,
        p_ancestor_block_global_log_index
      )
      and not exists (
        select 1
        from programmable_private.reward_vault_projections as child
        where child.baseline_reward_vault_projection_id =
          vault.reward_vault_projection_id
      );
    get diagnostics affected_rows = row_count;
    deleted_rows := deleted_rows + affected_rows;
    exit when affected_rows = 0;
  end loop;
  if exists (
    select 1
    from programmable_private.reward_vault_projections as vault
    where vault.chain_id = p_chain_id
      and vault.release_id = p_release_id
      and vault.model_id = p_model_id
      and programmable_private.projector_reorg_invalidates_projection_run_v1(
        vault.projection_run_id,
        vault.promoted_block_number, vault.promoted_block_hash,
        p_ancestor_block_number, p_ancestor_block_hash,
        p_ancestor_block_global_log_index
      )
  ) then
    raise exception using
      errcode = '23503',
      message = 'invalid reward snapshot retains a dependent child';
  end if;

  delete from programmable_private.pool_fee_totals
  where chain_id = p_chain_id and release_id = p_release_id
    and model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      projection_run_id, promoted_block_number, promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.fee_accrual_facts
  where chain_id = p_chain_id and release_id = p_release_id
    and model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      projection_run_id, promoted_block_number, promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.pool_fee_configurations
  where chain_id = p_chain_id and release_id = p_release_id
    and model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      projection_run_id, promoted_block_number, promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.pool_projections
  where chain_id = p_chain_id and release_id = p_release_id
    and model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      projection_run_id, promoted_block_number, promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.launch_position_liquidity_facts as position
  using programmable_private.launch_projections as launch
  where position.launch_projection_id = launch.launch_projection_id
    and launch.chain_id = p_chain_id
    and launch.release_id = p_release_id
    and launch.model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      position.projection_run_id,
      launch.promoted_block_number, launch.promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.launch_projection_occurrence_roles as role
  using programmable_private.launch_projections as launch
  where role.launch_projection_id = launch.launch_projection_id
    and launch.chain_id = p_chain_id
    and launch.release_id = p_release_id
    and launch.model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      role.projection_run_id,
      launch.promoted_block_number, launch.promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.launch_projection_conditions as condition
  using programmable_private.launch_projections as launch
  where condition.launch_projection_id = launch.launch_projection_id
    and launch.chain_id = p_chain_id
    and launch.release_id = p_release_id
    and launch.model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      condition.projection_run_id,
      launch.promoted_block_number, launch.promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  delete from programmable_private.launch_projections
  where chain_id = p_chain_id and release_id = p_release_id
    and model_id = p_model_id
    and programmable_private.projector_reorg_invalidates_projection_run_v1(
      projection_run_id, promoted_block_number, promoted_block_hash,
      p_ancestor_block_number, p_ancestor_block_hash,
      p_ancestor_block_global_log_index
    );
  get diagnostics affected_rows = row_count;
  deleted_rows := deleted_rows + affected_rows;

  return deleted_rows;
end
$function$;

create function programmable_private.recover_projector_reorg_v1(
  p_recovery_id uuid,
  p_run_id uuid,
  p_outcome_id uuid,
  p_safe_head_observation_id uuid,
  p_target_block_evidence_id uuid,
  p_provider_deployment_id uuid,
  p_stream_id text,
  p_expected_cursor_generation bigint,
  p_next_cursor_generation bigint,
  p_target_history_generation bigint,
  p_expected_reorg_generation bigint,
  p_next_reorg_generation bigint,
  p_target_block_number numeric,
  p_target_block_hash bytea,
  p_target_block_global_log_index numeric,
  p_target_candidate_id text,
  p_genesis_point_id uuid,
  p_runtime_holder_id text,
  p_runtime_lease_generation bigint,
  p_runtime_lease_token_hash bytea,
  p_reason_commitment bytea,
  p_recovered_at timestamptz default pg_catalog.clock_timestamp()
)
returns table (
  cursor_generation bigint,
  reorg_generation bigint,
  release_checkpoint_count bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  current_reorg programmable_private.projector_reorg_current%rowtype;
  current_cursor programmable_private.envio_ingestion_cursor_current%rowtype;
  target_evidence programmable_private.dual_rpc_block_evidence%rowtype;
  release_epoch record;
  current_pointer programmable_private.projector_checkpoint_current%rowtype;
  current_checkpoint programmable_private.projector_checkpoints%rowtype;
  ancestor programmable_private.projector_checkpoints%rowtype;
  new_checkpoint_id uuid;
  next_checkpoint_generation bigint;
  next_release_reorg_generation bigint;
  created_audit_id uuid;
  route_record record;
  route_history_id uuid;
  occurrence_record record;
  status_id uuid;
  seed_record record;
  release_count bigint := 0;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if not programmable_private.assert_projector_runtime_lease_v1(
    p_runtime_holder_id,
    p_runtime_lease_generation,
    p_runtime_lease_token_hash
  ) then
    raise exception using errcode = '40001', message = 'stale runtime lease';
  end if;
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'rewind'
    and chain_id = 1 and release_id = 'envio-control'
    and model_id = 'envio-control' and source_group = 'canonical-events'
    and epoch_id = '70000000-0000-0000-0000-000000000002'
    and captured_pointer_generation = 1;
  if not found or not exists (
    select 1 from programmable_private.run_lifecycle_outcomes as outcome
    where outcome.outcome_id = p_outcome_id
      and outcome.run_id = p_run_id
      and outcome.status = 'succeeded'
  ) then
    raise exception using errcode = '55000', message = 'invalid reorg run';
  end if;
  if p_next_cursor_generation <> p_expected_cursor_generation + 1
     or p_target_history_generation < 0
     or p_target_history_generation >= p_expected_cursor_generation
     or p_next_reorg_generation <> p_expected_reorg_generation + 1
     or p_target_block_number <> pg_catalog.trunc(p_target_block_number)
     or p_target_block_number < 0
     or pg_catalog.octet_length(p_target_block_hash) <> 32
     or pg_catalog.octet_length(p_reason_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid reorg recovery';
  end if;
  if (
    p_target_history_generation = 0
    and (
      p_genesis_point_id is null
      or p_target_block_global_log_index is not null
      or p_target_candidate_id is not null
    )
  ) or (
    p_target_history_generation > 0
    and (
      p_genesis_point_id is not null
      or (
        (p_target_block_global_log_index is null)
        <> (p_target_candidate_id is null)
      )
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid reorg target';
  end if;

  select * into current_reorg
  from programmable_private.projector_reorg_current as pointer
  where pointer.singleton_key = 'canonical-projector-reorg-v1'
  for update;
  if current_reorg.reorg_generation <> p_expected_reorg_generation then
    raise exception using errcode = '40001', message = 'reorg generation CAS lost';
  end if;
  select * into current_cursor
  from programmable_private.envio_ingestion_cursor_current as cursor
  where cursor.chain_id = 1
    and cursor.provider_deployment_id = p_provider_deployment_id
    and cursor.stream_id = p_stream_id
  for update;
  if not found
     or current_cursor.generation <> p_expected_cursor_generation
  then
    raise exception using errcode = '40001', message = 'cursor generation CAS lost';
  end if;
  select * into target_evidence
  from programmable_private.dual_rpc_block_evidence as evidence
  where evidence.block_evidence_id = p_target_block_evidence_id
    and evidence.observation_id = p_safe_head_observation_id
    and evidence.verification_run_id = p_run_id
    and evidence.epoch_id = header.epoch_id
    and evidence.pointer_generation = header.captured_pointer_generation;
  if not found
     or target_evidence.block_number <> p_target_block_number::bigint
     or target_evidence.agreed_block_hash <> p_target_block_hash
  then
    raise exception using errcode = '23514', message = 'reorg target lacks evidence';
  end if;

  cursor_generation := programmable_private.rewind_envio_ingestion_cursor_v1(
    p_run_id,
    p_provider_deployment_id,
    p_stream_id,
    p_expected_cursor_generation,
    p_next_cursor_generation,
    p_target_history_generation,
    p_reason_commitment,
    p_recovered_at
  );
  select * into current_cursor
  from programmable_private.envio_ingestion_cursor_current as cursor
  where cursor.chain_id = 1
    and cursor.provider_deployment_id = p_provider_deployment_id
    and cursor.stream_id = p_stream_id;
  if current_cursor.generation <> p_next_cursor_generation
     or current_cursor.block_number <> p_target_block_number::bigint
     or current_cursor.block_hash <> p_target_block_hash
     or current_cursor.block_global_log_index is distinct from
       p_target_block_global_log_index::bigint
     or current_cursor.candidate_id is distinct from p_target_candidate_id
     or current_cursor.genesis_point_id is distinct from p_genesis_point_id
  then
    raise exception using errcode = '40001', message = 'rewind target changed';
  end if;

  created_audit_id := programmable_private.append_mutation_audit(
    'projector_reorg.recover', p_reason_commitment, p_run_id, p_recovered_at
  );

  -- Canonical selections above the common ancestor are invalidated once for
  -- every release. Historical facts remain immutable and replayable.
  for occurrence_record in
    select selected.*, occurrence.block_number,
      materialization.block_evidence_id
    from programmable_private.chain_event_current_canonical as selected
    join programmable_private.chain_event_occurrences as occurrence
      on occurrence.occurrence_id = selected.occurrence_id
    join lateral (
      select scoped.block_evidence_id
      from programmable_private.chain_event_occurrence_materializations as scoped
      where scoped.occurrence_id = occurrence.occurrence_id
      order by scoped.pointer_generation desc, scoped.verified_at desc
      limit 1
    ) as materialization on true
    where occurrence.chain_id = 1
      and programmable_private.projector_reorg_invalidates_placement_v1(
        occurrence.block_number,
        occurrence.block_hash,
        occurrence.block_global_log_index,
        p_target_block_number::bigint,
        p_target_block_hash,
        p_target_block_global_log_index::bigint
      )
    for update of selected
  loop
    status_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.chain_event_occurrence_status_history (
      status_history_id, occurrence_id, logical_event_id, block_hash, status,
      safe_head_observation_id, block_evidence_id, decision_run_id,
      decision_commitment, decided_at, audit_id
    ) values (
      status_id, occurrence_record.occurrence_id,
      occurrence_record.logical_event_id, occurrence_record.block_hash,
      'orphaned', p_safe_head_observation_id,
      occurrence_record.block_evidence_id, p_run_id,
      p_reason_commitment, p_recovered_at, created_audit_id
    );
    delete from programmable_private.chain_event_current_canonical
    where logical_event_id = occurrence_record.logical_event_id
      and occurrence_id = occurrence_record.occurrence_id;
  end loop;

  for seed_record in
    select seed.*, fact.creation_block_number,
      occurrence.block_global_log_index
    from programmable_private.reward_allocation_current_verified as seed
    join programmable_private.reward_allocation_facts as fact
      on fact.allocation_fact_id = seed.allocation_fact_id
    join programmable_private.chain_event_occurrences as occurrence
      on occurrence.occurrence_id = fact.factory_occurrence_id
    where programmable_private.projector_reorg_invalidates_placement_v1(
        fact.creation_block_number,
        occurrence.block_hash,
        occurrence.block_global_log_index,
        p_target_block_number::bigint,
        p_target_block_hash,
        p_target_block_global_log_index::bigint
      )
    for update of seed
  loop
    status_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.reward_allocation_status_history (
      seed_status_history_id, allocation_fact_id, allocation_evidence_id,
      status, reason_commitment, decision_run_id, decided_at, audit_id
    ) values (
      status_id, seed_record.allocation_fact_id,
      seed_record.allocation_evidence_id, 'orphaned',
      p_reason_commitment, p_run_id, p_recovered_at, created_audit_id
    );
    delete from programmable_private.reward_allocation_current_verified
    where allocation_fact_id = seed_record.allocation_fact_id;
  end loop;

  for release_epoch in
    select epoch.*
    from programmable_private.release_epoch_current as epoch
    where epoch.chain_id = 1 and (
      (epoch.release_id = 'classic-v2' and epoch.model_id = 'classic'
        and epoch.source_group = 'core')
      or (epoch.release_id = 'classic-v3' and epoch.model_id = 'classic'
        and epoch.source_group = 'core')
      or (epoch.release_id = 'stock-paired-v1'
        and epoch.model_id = 'stock-paired' and epoch.source_group = 'core')
      or (epoch.release_id = 'stock-paired-v2'
        and epoch.model_id = 'stock-paired' and epoch.source_group = 'core')
      or (epoch.release_id = 'stock-paired-v3'
        and epoch.model_id = 'stock-paired' and epoch.source_group = 'core')
    )
    order by epoch.release_id
    for update
  loop
    current_pointer := null;
    current_checkpoint := null;
    ancestor := null;
    select * into current_pointer
    from programmable_private.projector_checkpoint_current as pointer
    where pointer.chain_id = 1
      and pointer.release_id = release_epoch.release_id
      and pointer.model_id = release_epoch.model_id
      and pointer.source_group = release_epoch.source_group
      and pointer.projector_version = 'projector-v1'
    for update;
    if found then
      select * into strict current_checkpoint
      from programmable_private.projector_checkpoints as checkpoint
      where checkpoint.checkpoint_id = current_pointer.checkpoint_id;
      select * into ancestor
      from programmable_private.projector_checkpoints as checkpoint
      where checkpoint.chain_id = 1
        and checkpoint.release_id = release_epoch.release_id
        and checkpoint.model_id = release_epoch.model_id
        and checkpoint.source_group = release_epoch.source_group
        and checkpoint.projector_version = 'projector-v1'
        and checkpoint.epoch_id = release_epoch.epoch_id
        and checkpoint.pointer_generation = release_epoch.generation
        and not checkpoint.is_neutral
        and (
          checkpoint.block_number < p_target_block_number::bigint
          or (
            checkpoint.block_number = p_target_block_number::bigint
            and checkpoint.block_hash = p_target_block_hash
            and (
              p_target_block_global_log_index is null
              or checkpoint.cursor_block_global_log_index <=
                p_target_block_global_log_index::bigint
            )
          )
        )
      order by checkpoint.block_number desc,
        checkpoint.cursor_block_global_log_index desc,
        checkpoint.checkpoint_generation desc
      limit 1;
      next_checkpoint_generation :=
        current_pointer.checkpoint_generation + 1;
      next_release_reorg_generation := current_pointer.reorg_generation + 1;
    else
      next_checkpoint_generation := 1;
      next_release_reorg_generation := 1;
    end if;

    new_checkpoint_id := pg_catalog.gen_random_uuid();
    if ancestor.checkpoint_id is null then
      insert into programmable_private.projector_checkpoints (
        checkpoint_id, chain_id, release_id, model_id, source_group,
        projector_version, epoch_id, pointer_generation, lease_generation,
        checkpoint_generation, reorg_generation, block_number, block_hash,
        cursor_block_global_log_index, cursor_candidate_id,
        safe_head_observation_id, target_block_evidence_id, run_id,
        terminal_outcome_id, created_at, is_neutral
      ) values (
        new_checkpoint_id, 1, release_epoch.release_id,
        release_epoch.model_id, release_epoch.source_group, 'projector-v1',
        release_epoch.epoch_id, release_epoch.generation,
        pg_catalog.greatest(coalesce(current_checkpoint.lease_generation, 0), 1),
        next_checkpoint_generation, next_release_reorg_generation,
        p_target_block_number::bigint, p_target_block_hash,
        null, null, null, null, p_run_id, p_outcome_id,
        p_recovered_at, true
      );
    else
      insert into programmable_private.projector_checkpoints (
        checkpoint_id, chain_id, release_id, model_id, source_group,
        projector_version, epoch_id, pointer_generation, lease_generation,
        checkpoint_generation, reorg_generation, block_number, block_hash,
        cursor_block_global_log_index, cursor_candidate_id,
        safe_head_observation_id, target_block_evidence_id, run_id,
        terminal_outcome_id, created_at, is_neutral
      ) values (
        new_checkpoint_id, 1, release_epoch.release_id,
        release_epoch.model_id, release_epoch.source_group, 'projector-v1',
        release_epoch.epoch_id, release_epoch.generation,
        pg_catalog.greatest(coalesce(current_checkpoint.lease_generation, 0), 1),
        next_checkpoint_generation, next_release_reorg_generation,
        ancestor.block_number, ancestor.block_hash,
        ancestor.cursor_block_global_log_index, ancestor.cursor_candidate_id,
        ancestor.safe_head_observation_id, ancestor.target_block_evidence_id,
        p_run_id, p_outcome_id, p_recovered_at, false
      );
    end if;

    if current_pointer.checkpoint_id is null then
      insert into programmable_private.projector_checkpoint_current (
        chain_id, release_id, model_id, source_group, projector_version,
        checkpoint_id, checkpoint_generation, reorg_generation, changed_at
      ) values (
        1, release_epoch.release_id, release_epoch.model_id,
        release_epoch.source_group, 'projector-v1', new_checkpoint_id,
        next_checkpoint_generation, next_release_reorg_generation,
        p_recovered_at
      ) on conflict do nothing;
    else
      update programmable_private.projector_checkpoint_current as pointer
      set checkpoint_id = new_checkpoint_id,
        checkpoint_generation = next_checkpoint_generation,
        reorg_generation = next_release_reorg_generation,
        changed_at = p_recovered_at
      where pointer.chain_id = 1
        and pointer.release_id = release_epoch.release_id
        and pointer.model_id = release_epoch.model_id
        and pointer.source_group = release_epoch.source_group
        and pointer.projector_version = 'projector-v1'
        and pointer.checkpoint_id = current_pointer.checkpoint_id
        and pointer.checkpoint_generation = current_pointer.checkpoint_generation
        and pointer.reorg_generation = current_pointer.reorg_generation;
    end if;
    if not found then
      raise exception using errcode = '40001', message = 'release checkpoint CAS lost';
    end if;

    for route_record in
      select * from programmable_private.route_eligibility_current as route
      where route.chain_id = 1
        and route.release_id = release_epoch.release_id
        and route.model_id = release_epoch.model_id
        and route.source_group = release_epoch.source_group
      for update
    loop
      route_history_id := pg_catalog.gen_random_uuid();
      insert into programmable_private.route_eligibility_history (
        route_eligibility_history_id, route_key, chain_id, release_id,
        model_id, source_group, epoch_id, pointer_generation, status,
        route_mode, checkpoint_id, reason_commitment, changed_by_run_id,
        changed_at, audit_id
      ) values (
        route_history_id, route_record.route_key, 1,
        release_epoch.release_id, release_epoch.model_id,
        release_epoch.source_group, release_epoch.epoch_id,
        release_epoch.generation, 'ineligible', 'rpc', new_checkpoint_id,
        p_reason_commitment, p_run_id, p_recovered_at, created_audit_id
      );
      update programmable_private.route_eligibility_current as route
      set epoch_id = release_epoch.epoch_id,
        pointer_generation = release_epoch.generation,
        status = 'ineligible', route_mode = 'rpc',
        checkpoint_id = new_checkpoint_id, history_id = route_history_id,
        changed_at = p_recovered_at
      where route.route_key = route_record.route_key
        and route.chain_id = 1
        and route.release_id = release_epoch.release_id
        and route.model_id = release_epoch.model_id
        and route.source_group = release_epoch.source_group;
    end loop;

    delete from programmable_private.projection_entity_current as entity
    where entity.chain_id = 1
      and entity.release_id = release_epoch.release_id
      and entity.model_id = release_epoch.model_id
      and entity.source_group = release_epoch.source_group
      and (
        ancestor.checkpoint_id is null
        or exists (
          select 1
          from programmable_private.projector_checkpoints as entity_checkpoint
          where entity_checkpoint.checkpoint_id = entity.checkpoint_id
            and (
              entity_checkpoint.block_number > ancestor.block_number
              or (
                entity_checkpoint.block_number = ancestor.block_number
                and (
                  entity_checkpoint.block_hash <> ancestor.block_hash
                  or entity_checkpoint.cursor_block_global_log_index >
                    ancestor.cursor_block_global_log_index
                )
              )
            )
        )
      );
    perform programmable_private.delete_projector_projection_replay_scope_v1(
      1,
      release_epoch.release_id,
      release_epoch.model_id,
      case when ancestor.checkpoint_id is null
        then null else ancestor.block_number end,
      case when ancestor.checkpoint_id is null
        then null else ancestor.block_hash end,
      case when ancestor.checkpoint_id is null
        then null else ancestor.cursor_block_global_log_index end
    );
    release_count := release_count + 1;
  end loop;

  insert into programmable_private.projector_reorg_recovery_history (
    recovery_id, expected_reorg_generation, next_reorg_generation,
    expected_cursor_generation, next_cursor_generation,
    target_history_generation, target_block_number, target_block_hash,
    target_block_global_log_index, target_candidate_id, genesis_point_id,
    verification_run_id, safe_head_observation_id,
    target_block_evidence_id, runtime_lease_generation,
    reason_commitment, recovered_at, audit_id
  ) values (
    p_recovery_id, p_expected_reorg_generation, p_next_reorg_generation,
    p_expected_cursor_generation, p_next_cursor_generation,
    p_target_history_generation, p_target_block_number::bigint,
    p_target_block_hash, p_target_block_global_log_index::bigint,
    p_target_candidate_id, p_genesis_point_id, p_run_id,
    p_safe_head_observation_id, p_target_block_evidence_id,
    p_runtime_lease_generation, p_reason_commitment,
    p_recovered_at, created_audit_id
  );
  update programmable_private.projector_reorg_current as pointer
  set reorg_generation = p_next_reorg_generation,
    recovery_id = p_recovery_id,
    changed_at = p_recovered_at
  where pointer.singleton_key = 'canonical-projector-reorg-v1'
    and pointer.reorg_generation = p_expected_reorg_generation;
  if not found then
    raise exception using errcode = '40001', message = 'reorg generation CAS lost';
  end if;
  reorg_generation := p_next_reorg_generation;
  release_checkpoint_count := release_count;
  return next;
end
$function$;

revoke all on function programmable_private.get_projector_reorg_targets_v1(
  uuid, text, integer
) from public, anon, authenticated, service_role;
grant execute on function programmable_private.get_projector_reorg_targets_v1(
  uuid, text, integer
) to programmable_projector;
revoke all on function programmable_private.get_projector_reorg_generation_v1()
  from public, anon, authenticated, service_role;
grant execute on function programmable_private.get_projector_reorg_generation_v1()
  to programmable_projector;
revoke all on function
  programmable_private.projector_reorg_invalidates_placement_v1(
    bigint, bytea, bigint, bigint, bytea, bigint
  ) from public, anon, authenticated, service_role;
revoke all on function
  programmable_private.projector_reorg_invalidates_projection_run_v1(
    uuid, bigint, bytea, bigint, bytea, bigint
  ) from public, anon, authenticated, service_role;
revoke all on function
  programmable_private.delete_projector_projection_replay_scope_v1(
    bigint, text, text, bigint, bytea, bigint
  ) from public, anon, authenticated, service_role;
revoke all on function programmable_private.recover_projector_reorg_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, bigint,
  bigint, bigint, numeric, bytea, numeric, text, uuid, text, bigint,
  bytea, bytea, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function programmable_private.recover_projector_reorg_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, bigint,
  bigint, bigint, numeric, bytea, numeric, text, uuid, text, bigint,
  bytea, bytea, timestamptz
) to programmable_projector;

reset role;
