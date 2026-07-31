-- Exact-checkpoint bootstrap contract for the server-only reconciler.
--
-- The reconciler intentionally receives no general table privileges.  One
-- narrow reader exposes only the exact current checkpoint, its six route
-- bindings, the immutable projection fold manifest and the current entity
-- identities needed to prepare an independent comparison.  One writer
-- appends the reconciliation, all route parity rows, exact checkpoint
-- bindings and the terminal outcome in a single transaction.

reset role;
set role programmable_migrator;

create function programmable_private.get_reconciler_preparity_contract_v1(
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
  chain_id bigint,
  release_id text,
  model_id text,
  source_group text,
  projector_version text,
  epoch_id uuid,
  pointer_generation bigint,
  checkpoint_id uuid,
  checkpoint_generation bigint,
  reorg_generation bigint,
  checkpoint_block_number bigint,
  checkpoint_block_hash bytea,
  route_keys text[],
  route_contract jsonb,
  projection_contract jsonb,
  current_entities jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  expected_route_keys constant text[] := array[
    'explore-list',
    'explore-token',
    'explore-chart',
    'creator-profile',
    'classic-v3-profile',
    'launch-lookup'
  ]::text[];
  checkpoint programmable_private.projector_checkpoints%rowtype;
  manifest programmable_private.projection_fold_manifests%rowtype;
  resolved_route_keys text[];
  resolved_route_contract jsonb;
  resolved_entities jsonb;
  entity_count bigint;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_chain_id is null
     or p_chain_id <= 0
     or p_release_id is null
     or p_model_id is null
     or p_source_group is null
     or p_epoch_id is null
     or p_pointer_generation is null
     or p_pointer_generation <= 0
     or p_checkpoint_id is null
     or p_checkpoint_block_number is null
     or p_checkpoint_block_number <> pg_catalog.trunc(
       p_checkpoint_block_number
     )
     or p_checkpoint_block_number < 0
     or p_checkpoint_block_number > 9223372036854775807
     or p_checkpoint_block_hash is null
     or pg_catalog.octet_length(p_checkpoint_block_hash) <> 32
     or p_maximum_entity_count is null
     or p_maximum_entity_count < 1
     or p_maximum_entity_count > 10000
  then
    raise exception using
      errcode = '22023',
      message = 'invalid reconciler pre-parity checkpoint request';
  end if;

  select checkpoint_row.* into checkpoint
  from programmable_private.projector_checkpoints as checkpoint_row
  join programmable_private.projector_checkpoint_current as current_checkpoint
    on current_checkpoint.chain_id = checkpoint_row.chain_id
   and current_checkpoint.release_id = checkpoint_row.release_id
   and current_checkpoint.model_id = checkpoint_row.model_id
   and current_checkpoint.source_group = checkpoint_row.source_group
   and current_checkpoint.projector_version =
     checkpoint_row.projector_version
   and current_checkpoint.checkpoint_id = checkpoint_row.checkpoint_id
   and current_checkpoint.checkpoint_generation =
     checkpoint_row.checkpoint_generation
   and current_checkpoint.reorg_generation = checkpoint_row.reorg_generation
  join programmable_private.release_epoch_current as current_epoch
    on current_epoch.chain_id = checkpoint_row.chain_id
   and current_epoch.release_id = checkpoint_row.release_id
   and current_epoch.model_id = checkpoint_row.model_id
   and current_epoch.source_group = checkpoint_row.source_group
   and current_epoch.epoch_id = checkpoint_row.epoch_id
   and current_epoch.generation = checkpoint_row.pointer_generation
  where checkpoint_row.chain_id = p_chain_id
    and checkpoint_row.release_id = p_release_id
    and checkpoint_row.model_id = p_model_id
    and checkpoint_row.source_group = p_source_group
    and checkpoint_row.epoch_id = p_epoch_id
    and checkpoint_row.pointer_generation = p_pointer_generation
    and checkpoint_row.checkpoint_id = p_checkpoint_id
    and checkpoint_row.block_number = p_checkpoint_block_number::bigint
    and checkpoint_row.block_hash = p_checkpoint_block_hash;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'requested checkpoint is not exact and current';
  end if;

  select
    pg_catalog.array_agg(
      route.route_key::text order by expected.ordinal
    ),
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'routeKey', route.route_key::text,
        'status', route.status::text,
        'routeMode', route.route_mode::text,
        'checkpointId', route.checkpoint_id,
        'checkpointGeneration', route.checkpoint_generation::text,
        'reorgGeneration', route.reorg_generation::text,
        'checkpointBlockNumber', route.checkpoint_block_number::text,
        'checkpointBlockHash', '0x' || pg_catalog.encode(
          route.checkpoint_block_hash, 'hex'
        ),
        'changedAt', pg_catalog.to_char(
          route.changed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ) order by expected.ordinal
    )
  into resolved_route_keys, resolved_route_contract
  from pg_catalog.unnest(expected_route_keys) with ordinality
    as expected(route_key, ordinal)
  join programmable_private.route_eligibility_current_exact_v1 as route
    on route.route_key = expected.route_key
   and route.chain_id = checkpoint.chain_id
   and route.release_id = checkpoint.release_id
   and route.model_id = checkpoint.model_id
   and route.source_group = checkpoint.source_group
   and route.epoch_id = checkpoint.epoch_id
   and route.pointer_generation = checkpoint.pointer_generation
   and route.checkpoint_id = checkpoint.checkpoint_id
   and route.projector_version = checkpoint.projector_version
   and route.checkpoint_generation = checkpoint.checkpoint_generation
   and route.reorg_generation = checkpoint.reorg_generation
   and route.checkpoint_block_number = checkpoint.block_number
   and route.checkpoint_block_hash = checkpoint.block_hash
   and route.status = 'eligible'
   and route.route_mode = 'indexed';
  if resolved_route_keys is distinct from expected_route_keys then
    raise exception using
      errcode = '55000',
      message = 'exact checkpoint does not cover every reconciler route';
  end if;

  select manifest_row.* into manifest
  from programmable_private.projection_fold_manifests as manifest_row
  where manifest_row.run_id = checkpoint.run_id
    and manifest_row.epoch_id = checkpoint.epoch_id
    and manifest_row.pointer_generation = checkpoint.pointer_generation
    and manifest_row.target_block_number = checkpoint.block_number
    and manifest_row.target_block_hash = checkpoint.block_hash;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'exact checkpoint projection manifest is unavailable';
  end if;

  select pg_catalog.count(*) into entity_count
  from programmable_private.projection_entity_current as entity
  where entity.chain_id = checkpoint.chain_id
    and entity.release_id = checkpoint.release_id
    and entity.model_id = checkpoint.model_id
    and entity.source_group = checkpoint.source_group;
  if entity_count > p_maximum_entity_count then
    raise exception using
      errcode = '54000',
      message = 'reconciler pre-parity entity limit exceeded';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'entityKind', entity.entity_kind::text,
        'entityKey', entity.entity_key,
        'projectionRowId', entity.projection_row_id,
        'projectionRunId', entity.projection_run_id,
        'publicationId', entity.publication_id,
        'checkpointId', entity.checkpoint_id,
        'promotedBlockNumber', entity.promoted_block_number::text,
        'promotedBlockHash', '0x' || pg_catalog.encode(
          entity.promoted_block_hash, 'hex'
        )
      ) order by entity.entity_kind, entity.entity_key
    ),
    '[]'::jsonb
  ) into resolved_entities
  from programmable_private.projection_entity_current as entity
  where entity.chain_id = checkpoint.chain_id
    and entity.release_id = checkpoint.release_id
    and entity.model_id = checkpoint.model_id
    and entity.source_group = checkpoint.source_group;

  return query select
    checkpoint.chain_id::bigint,
    checkpoint.release_id::text,
    checkpoint.model_id::text,
    checkpoint.source_group::text,
    checkpoint.projector_version::text,
    checkpoint.epoch_id,
    checkpoint.pointer_generation,
    checkpoint.checkpoint_id,
    checkpoint.checkpoint_generation,
    checkpoint.reorg_generation,
    checkpoint.block_number::bigint,
    checkpoint.block_hash::bytea,
    resolved_route_keys,
    resolved_route_contract,
    pg_catalog.jsonb_build_object(
      'runId', manifest.run_id,
      'targetBlockNumber', manifest.target_block_number::text,
      'targetBlockHash', '0x' || pg_catalog.encode(
        manifest.target_block_hash, 'hex'
      ),
      'orderedOccurrenceIds', manifest.ordered_occurrence_ids,
      'orderedAllocationFactIds', manifest.ordered_allocation_fact_ids,
      'orderedAllocationEvidenceIds',
        manifest.ordered_allocation_evidence_ids,
      'orderedCandidateDispositionIds',
        manifest.ordered_candidate_disposition_ids,
      'orderedRouteKeys', manifest.ordered_route_keys,
      'orderedProjectionRows', manifest.ordered_projection_rows,
      'projectionRowCount', manifest.projection_row_count::text,
      'resultCommitment', '0x' || pg_catalog.encode(
        manifest.result_commitment, 'hex'
      )
    ),
    resolved_entities;
end
$function$;

create function programmable_private.commit_reconciler_preparity_result_v1(
  p_run_id uuid,
  p_reconciliation_id uuid,
  p_parity_record_ids uuid[],
  p_parity_binding_ids uuid[],
  p_outcome_id uuid,
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_id uuid,
  p_pointer_generation bigint,
  p_checkpoint_id uuid,
  p_checkpoint_block_number numeric,
  p_checkpoint_block_hash bytea,
  p_worker_version text,
  p_route_keys text[],
  p_legacy_dto_hashes bytea[],
  p_indexed_dto_hashes bytea[],
  p_route_evidence_commitments bytea[],
  p_parity_binding_commitments bytea[],
  p_request_commitment bytea,
  p_reconciliation_evidence_commitment bytea,
  p_result_commitment bytea,
  p_started_at timestamptz,
  p_compared_at timestamptz,
  p_finished_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  expected_route_keys constant text[] := array[
    'explore-list',
    'explore-token',
    'explore-chart',
    'creator-profile',
    'classic-v3-profile',
    'launch-lookup'
  ]::text[];
  route_index integer;
  mismatch_count bigint := 0;
  mismatch_commitments bytea[] := array[]::bytea[];
  terminal_status text;
  locked_route_count bigint;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_run_id is null
     or p_reconciliation_id is null
     or p_outcome_id is null
     or p_chain_id is null
     or p_chain_id <= 0
     or p_release_id is null
     or p_model_id is null
     or p_source_group is null
     or p_epoch_id is null
     or p_pointer_generation is null
     or p_pointer_generation <= 0
     or p_checkpoint_id is null
     or p_checkpoint_block_number is null
     or p_checkpoint_block_number <> pg_catalog.trunc(
       p_checkpoint_block_number
     )
     or p_checkpoint_block_number < 0
     or p_checkpoint_block_number > 9223372036854775807
     or p_checkpoint_block_hash is null
     or pg_catalog.octet_length(p_checkpoint_block_hash) <> 32
     or p_worker_version is null
     or p_request_commitment is null
     or pg_catalog.octet_length(p_request_commitment) <> 32
     or p_reconciliation_evidence_commitment is null
     or pg_catalog.octet_length(
       p_reconciliation_evidence_commitment
     ) <> 32
     or p_result_commitment is null
     or pg_catalog.octet_length(p_result_commitment) <> 32
     or p_started_at is null
     or p_compared_at is null
     or p_finished_at is null
     or p_started_at > p_compared_at
     or p_compared_at > p_finished_at
     or p_route_keys is distinct from expected_route_keys
     or pg_catalog.cardinality(p_parity_record_ids) is distinct from 6
     or pg_catalog.cardinality(p_parity_binding_ids) is distinct from 6
     or pg_catalog.cardinality(p_legacy_dto_hashes) is distinct from 6
     or pg_catalog.cardinality(p_indexed_dto_hashes) is distinct from 6
     or pg_catalog.cardinality(p_route_evidence_commitments)
       is distinct from 6
     or pg_catalog.cardinality(p_parity_binding_commitments)
       is distinct from 6
     or exists (
       select 1
       from pg_catalog.unnest(
         array[p_run_id, p_reconciliation_id, p_outcome_id]
           || p_parity_record_ids || p_parity_binding_ids
       ) as supplied_id(value)
       where supplied_id.value is null
     )
     or (
       select pg_catalog.count(distinct supplied_id.value)
       from pg_catalog.unnest(
         array[p_run_id, p_reconciliation_id, p_outcome_id]
           || p_parity_record_ids || p_parity_binding_ids
       ) as supplied_id(value)
     ) <> 15
     or exists (
       select 1
       from pg_catalog.unnest(
         p_legacy_dto_hashes || p_indexed_dto_hashes
           || p_route_evidence_commitments
           || p_parity_binding_commitments
       ) as supplied_hash(value)
       where supplied_hash.value is null
          or pg_catalog.octet_length(supplied_hash.value) <> 32
     )
  then
    raise exception using
      errcode = '22023',
      message = 'invalid atomic reconciler pre-parity result';
  end if;

  -- Hold the mutable current pointers until the complete append commits.
  perform 1
  from programmable_private.release_epoch_current as current_epoch
  where current_epoch.chain_id = p_chain_id
    and current_epoch.release_id = p_release_id
    and current_epoch.model_id = p_model_id
    and current_epoch.source_group = p_source_group
    and current_epoch.epoch_id = p_epoch_id
    and current_epoch.generation = p_pointer_generation
  for share;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'reconciler epoch changed before commit';
  end if;

  perform 1
  from programmable_private.projector_checkpoint_current as current_checkpoint
  join programmable_private.projector_checkpoints as checkpoint
    on checkpoint.checkpoint_id = current_checkpoint.checkpoint_id
   and checkpoint.chain_id = current_checkpoint.chain_id
   and checkpoint.release_id = current_checkpoint.release_id
   and checkpoint.model_id = current_checkpoint.model_id
   and checkpoint.source_group = current_checkpoint.source_group
   and checkpoint.projector_version = current_checkpoint.projector_version
   and checkpoint.checkpoint_generation =
     current_checkpoint.checkpoint_generation
   and checkpoint.reorg_generation = current_checkpoint.reorg_generation
  where checkpoint.chain_id = p_chain_id
    and checkpoint.release_id = p_release_id
    and checkpoint.model_id = p_model_id
    and checkpoint.source_group = p_source_group
    and checkpoint.epoch_id = p_epoch_id
    and checkpoint.pointer_generation = p_pointer_generation
    and checkpoint.checkpoint_id = p_checkpoint_id
    and checkpoint.block_number = p_checkpoint_block_number::bigint
    and checkpoint.block_hash = p_checkpoint_block_hash
  for share of current_checkpoint, checkpoint;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'reconciler checkpoint changed before commit';
  end if;

  select pg_catalog.count(*) into locked_route_count
  from programmable_private.route_eligibility_current as route
  join pg_catalog.unnest(expected_route_keys) as expected(route_key)
    on expected.route_key = route.route_key
  where route.chain_id = p_chain_id
    and route.release_id = p_release_id
    and route.model_id = p_model_id
    and route.source_group = p_source_group
    and route.epoch_id = p_epoch_id
    and route.pointer_generation = p_pointer_generation
    and route.checkpoint_id = p_checkpoint_id
    and route.status = 'eligible'
    and route.route_mode = 'indexed';
  if locked_route_count <> 6 then
    raise exception using
      errcode = '40001',
      message = 'reconciler route coverage changed before commit';
  end if;

  for route_index in 1..6 loop
    if p_legacy_dto_hashes[route_index]
       <> p_indexed_dto_hashes[route_index]
    then
      mismatch_count := mismatch_count + 1;
      mismatch_commitments := pg_catalog.array_append(
        mismatch_commitments,
        p_route_evidence_commitments[route_index]
      );
    end if;
  end loop;
  terminal_status := case
    when mismatch_count = 0 then 'succeeded'
    else 'failed'
  end;

  perform programmable_private.open_run(
    p_run_id,
    'reconciliation',
    p_chain_id,
    p_release_id,
    p_model_id,
    p_source_group,
    p_epoch_id,
    p_pointer_generation,
    p_worker_version,
    p_request_commitment,
    p_started_at
  );
  perform programmable_private.append_reconciliation_record(
    p_reconciliation_id,
    p_run_id,
    'exact-checkpoint-route-parity-v1',
    case when mismatch_count = 0 then 'info' else 'warning' end,
    p_checkpoint_block_number,
    p_checkpoint_block_number,
    6,
    mismatch_count,
    p_reconciliation_evidence_commitment,
    mismatch_commitments,
    null,
    p_compared_at
  );

  for route_index in 1..6 loop
    perform programmable_private.append_parity_record(
      p_parity_record_ids[route_index],
      p_reconciliation_id,
      p_route_keys[route_index],
      p_legacy_dto_hashes[route_index],
      p_indexed_dto_hashes[route_index],
      p_compared_at,
      null
    );
    perform programmable_private.bind_route_checkpoint_parity_v1(
      p_parity_binding_ids[route_index],
      p_parity_record_ids[route_index],
      p_checkpoint_id,
      p_parity_binding_commitments[route_index],
      p_finished_at
    );
  end loop;

  perform programmable_private.append_run_outcome(
    p_outcome_id,
    p_run_id,
    terminal_status,
    p_result_commitment,
    p_finished_at
  );

  return pg_catalog.jsonb_build_object(
    'runId', p_run_id,
    'reconciliationId', p_reconciliation_id,
    'checkpointId', p_checkpoint_id,
    'checkpointBlockNumber', p_checkpoint_block_number::bigint::text,
    'checkpointBlockHash', '0x' || pg_catalog.encode(
      p_checkpoint_block_hash, 'hex'
    ),
    'routeCount', 6,
    'mismatchCount', mismatch_count,
    'status', terminal_status
  );
end
$function$;

comment on function programmable_private.get_reconciler_preparity_contract_v1(
  bigint, text, text, text, uuid, bigint, uuid, numeric, bytea, integer
) is
  'Returns only the exact current checkpoint contract required for independent pre-parity comparison. It does not require or manufacture prior parity.';

comment on function programmable_private.commit_reconciler_preparity_result_v1(
  uuid, uuid, uuid[], uuid[], uuid, bigint, text, text, text, uuid, bigint,
  uuid, numeric, bytea, text, text[], bytea[], bytea[], bytea[], bytea[],
  bytea, bytea, bytea, timestamptz, timestamptz, timestamptz
) is
  'Atomically appends exact-checkpoint reconciliation, six route parity rows, their checkpoint bindings and one terminal outcome.';

revoke all on function
  programmable_private.get_reconciler_preparity_contract_v1(
    bigint, text, text, text, uuid, bigint, uuid, numeric, bytea, integer
  ) from public, anon, authenticated, service_role,
    programmable_projector, programmable_api_reader,
    programmable_profile_binder, programmable_profile_recovery,
    programmable_profile_writer, programmable_maintenance;
revoke all on function
  programmable_private.commit_reconciler_preparity_result_v1(
    uuid, uuid, uuid[], uuid[], uuid, bigint, text, text, text, uuid, bigint,
    uuid, numeric, bytea, text, text[], bytea[], bytea[], bytea[], bytea[],
    bytea, bytea, bytea, timestamptz, timestamptz, timestamptz
  ) from public, anon, authenticated, service_role,
    programmable_projector, programmable_api_reader,
    programmable_profile_binder, programmable_profile_recovery,
    programmable_profile_writer, programmable_maintenance;

grant execute on function
  programmable_private.get_reconciler_preparity_contract_v1(
    bigint, text, text, text, uuid, bigint, uuid, numeric, bytea, integer
  ) to programmable_reconciler;

grant execute on function
  programmable_private.commit_reconciler_preparity_result_v1(
    uuid, uuid, uuid[], uuid[], uuid, bigint, text, text, text, uuid, bigint,
    uuid, numeric, bytea, text, text[], bytea[], bytea[], bytea[], bytea[],
    bytea, bytea, bytea, timestamptz, timestamptz, timestamptz
  ) to programmable_reconciler;

reset role;
