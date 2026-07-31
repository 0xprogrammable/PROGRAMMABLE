-- Persist exact empty dual-RPC coverage pages without fabricating an Envio
-- candidate. Existing non-empty provider-evidence-v2 frames remain unchanged.
-- An empty tag-5 frame uses an empty ordered commitment array plus the unique
-- end-of-block marker (u32::max, "empty-page"). The durable cursor stores the
-- covered block/hash with a NULL log/candidate pair, so continuation starts at
-- the following block while rewinds can still restore the exact boundary.

set role programmable_migrator;

-- One verification run is one canonical dual-RPC snapshot. It cannot attest
-- two different hashes for the same block and later choose whichever matches
-- a retained inbox fork.
alter table programmable_private.dual_rpc_block_evidence
  add constraint dual_rpc_block_evidence_run_block_key
  unique (verification_run_id, block_number);

alter table programmable_private.dual_rpc_log_coverage_evidence
  drop constraint dual_rpc_log_coverage_evidence_check3,
  add constraint dual_rpc_log_coverage_exact_page_shape_check check (
    pg_catalog.cardinality(ordered_log_commitments_a) between 0 and 2000
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
        pg_catalog.cardinality(ordered_log_commitments_a) between 1 and 2000
        and final_candidate_id <> 'empty-page'
      )
    )
  );

alter table programmable_private.envio_ingestion_cursor_history
  drop constraint envio_cursor_history_point_shape_check,
  add constraint envio_cursor_history_point_shape_check check (
    (
      is_genesis and genesis_point_id is not null
      and block_global_log_index is null and candidate_id is null
      and log_coverage_evidence_id is null
    )
    or
    (
      not is_genesis and genesis_point_id is null
      and (
        (block_global_log_index is null and candidate_id is null)
        or
        (block_global_log_index is not null and candidate_id is not null)
      )
      and (
        (is_rewind and log_coverage_evidence_id is null)
        or
        (not is_rewind and log_coverage_evidence_id is not null)
      )
    )
  );

alter table programmable_private.envio_ingestion_cursor_current
  drop constraint envio_cursor_current_point_shape_check,
  add constraint envio_cursor_current_point_shape_check check (
    (
      is_genesis and genesis_point_id is not null
      and block_global_log_index is null and candidate_id is null
      and log_coverage_evidence_id is null
    )
    or
    (
      not is_genesis and genesis_point_id is null
      and (
        (block_global_log_index is null and candidate_id is null)
        or
        (block_global_log_index is not null and candidate_id is not null)
      )
      and (
        (is_rewind and log_coverage_evidence_id is null)
        or
        (not is_rewind and log_coverage_evidence_id is not null)
      )
    )
  );

create or replace function programmable_private.append_dual_rpc_log_coverage_evidence(
  p_log_coverage_evidence_id uuid,
  p_run_id uuid,
  p_provider_deployment_id uuid,
  p_stream_id text,
  p_expected_cursor_generation bigint,
  p_next_cursor_generation bigint,
  p_from_block_number numeric,
  p_to_block_number numeric,
  p_final_block_hash bytea,
  p_final_block_global_log_index numeric,
  p_final_candidate_id text,
  p_safe_head_observation_id uuid,
  p_final_block_evidence_id uuid,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_filter_commitment bytea,
  p_ordered_log_commitments_a bytea[],
  p_ordered_log_commitments_b bytea[],
  p_page_commitment bytea,
  p_encoding_version smallint,
  p_canonical_preimage bytea,
  p_content_fingerprint bytea,
  p_evidence_commitment bytea,
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
  current_cursor programmable_private.envio_ingestion_cursor_current%rowtype;
  genesis programmable_private.envio_ingestion_cursor_genesis_points%rowtype;
  evidence programmable_private.dual_rpc_block_evidence%rowtype;
  observation programmable_private.safe_head_observations%rowtype;
  final_candidate programmable_private.envio_candidate_inbox%rowtype;
  existing programmable_private.dual_rpc_log_coverage_evidence%rowtype;
  normalized_from bigint;
  normalized_to bigint;
  normalized_final_log bigint;
  previous_block bigint;
  previous_log bigint;
  previous_candidate text;
  inbox_commitments bytea[];
  is_empty_page boolean;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_provider_evidence_encoding(
    'log_coverage', p_encoding_version, p_canonical_preimage,
    p_content_fingerprint
  );
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'ingestion'
    and chain_id = 1 and release_id = 'envio-control'
    and model_id = 'envio-control' and source_group = 'canonical-events'
    and epoch_id = '70000000-0000-0000-0000-000000000002'
    and captured_pointer_generation = 1;
  if not found or exists (
    select 1 from programmable_private.run_lifecycle_outcomes
    where run_id = p_run_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'log coverage requires an open neutral ingestion run';
  end if;
  if p_ordered_log_commitments_a is null
     or p_ordered_log_commitments_b is null
     or p_final_block_global_log_index is null
     or p_final_candidate_id is null
     or p_from_block_number is null
     or p_to_block_number is null
     or p_expected_cursor_generation < 0
     or p_next_cursor_generation <> p_expected_cursor_generation + 1
     or p_from_block_number <> pg_catalog.trunc(p_from_block_number)
     or p_to_block_number <> pg_catalog.trunc(p_to_block_number)
     or p_from_block_number < 0
     or p_to_block_number < p_from_block_number
     or p_to_block_number - p_from_block_number > 1999
     or p_final_block_global_log_index
       <> pg_catalog.trunc(p_final_block_global_log_index)
     or p_final_block_global_log_index < 0
     or p_final_block_global_log_index > 4294967295
     or pg_catalog.octet_length(p_final_block_hash) <> 32
     or pg_catalog.octet_length(p_filter_commitment) <> 32
     or pg_catalog.octet_length(p_page_commitment) <> 32
     or pg_catalog.octet_length(p_evidence_commitment) <> 32
     or pg_catalog.cardinality(p_ordered_log_commitments_a)
       not between 0 and 2000
     or not programmable_private.valid_topics(p_ordered_log_commitments_a)
     or p_ordered_log_commitments_a <> p_ordered_log_commitments_b
     or (
       pg_catalog.cardinality(p_ordered_log_commitments_a) = 0
       and (
         p_final_block_global_log_index <> 4294967295
         or p_final_candidate_id <> 'empty-page'
       )
     )
     or (
       pg_catalog.cardinality(p_ordered_log_commitments_a) > 0
       and p_final_candidate_id = 'empty-page'
     )
     or not exists (
       select 1 from programmable_private.provider_deployments
       where provider_deployment_id = p_provider_deployment_id
         and provider_type = 'envio_deployment'
     )
  then
    raise exception using
      errcode = '22023', message = 'invalid bounded dual-RPC log coverage';
  end if;
  normalized_from := p_from_block_number::bigint;
  normalized_to := p_to_block_number::bigint;
  normalized_final_log := p_final_block_global_log_index::bigint;
  is_empty_page :=
    pg_catalog.cardinality(p_ordered_log_commitments_a) = 0;

  select * into current_cursor
  from programmable_private.envio_ingestion_cursor_current
  where chain_id = 1
    and provider_deployment_id = p_provider_deployment_id
    and stream_id = p_stream_id
  for share;
  if current_cursor.generation is null then
    if p_expected_cursor_generation <> 0 then
      raise exception using
        errcode = '40001', message = 'log-coverage cursor CAS lost';
    end if;
    select * into genesis
    from programmable_private.envio_ingestion_cursor_genesis_points
    where chain_id = 1
      and provider_deployment_id = p_provider_deployment_id
      and stream_id = p_stream_id;
    if not found or normalized_from <> genesis.anchor_block_number + 1 then
      raise exception using
        errcode = '23514',
        message = 'log coverage does not start after registered genesis';
    end if;
    previous_block := genesis.anchor_block_number;
    previous_log := null;
    previous_candidate := null;
  else
    if current_cursor.generation <> p_expected_cursor_generation then
      raise exception using
        errcode = '40001', message = 'log-coverage cursor CAS lost';
    end if;
    previous_block := current_cursor.block_number;
    previous_log := current_cursor.block_global_log_index;
    previous_candidate := current_cursor.candidate_id;
    if (
         previous_log is null and previous_candidate is null
         and normalized_from <> previous_block + 1
       )
       or (
         previous_log is not null and previous_candidate is not null
         and normalized_from <> previous_block
       )
       or (previous_log is null) <> (previous_candidate is null)
    then
      raise exception using
        errcode = '23514',
        message = 'log coverage does not continue the current cursor';
    end if;
  end if;

  if not is_empty_page then
    select * into final_candidate
    from programmable_private.envio_candidate_inbox
    where candidate_id = p_final_candidate_id
      and chain_id = 1
      and provider_deployment_id = p_provider_deployment_id
      and stream_id = p_stream_id
      and block_number = normalized_to
      and block_hash = p_final_block_hash
      and block_global_log_index = normalized_final_log;
    if not found then
      raise exception using
        errcode = '23514',
        message = 'log coverage final candidate is not durable';
    end if;
  end if;

  select * into evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_final_block_evidence_id
    and observation_id = p_safe_head_observation_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation
    and chain_id = 1
    and block_number = normalized_to
    and agreed_block_hash = p_final_block_hash;
  select * into observation
  from programmable_private.safe_head_observations
  where observation_id = p_safe_head_observation_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation
    and chain_id = 1
    and provider_a_id = p_provider_a_id
    and provider_b_id = p_provider_b_id
    and safe_block_number >= normalized_to;
  if evidence.block_evidence_id is null
     or observation.observation_id is null
  then
    raise exception using
      errcode = '23514',
      message = 'log coverage lacks exact dual-RPC range evidence';
  end if;

  select pg_catalog.array_agg(
    candidate.content_commitment::bytea
    order by candidate.block_number, candidate.block_global_log_index,
             candidate.candidate_id
  ) into inbox_commitments
  from programmable_private.envio_candidate_inbox as candidate
  join programmable_private.dual_rpc_block_evidence as canonical_block
    on canonical_block.verification_run_id = p_run_id
   and canonical_block.observation_id = p_safe_head_observation_id
   and canonical_block.epoch_id = header.epoch_id
   and canonical_block.pointer_generation =
       header.captured_pointer_generation
   and canonical_block.chain_id = 1
   and canonical_block.block_number = candidate.block_number
   and canonical_block.agreed_block_hash = candidate.block_hash
  where candidate.chain_id = 1
    and candidate.provider_deployment_id = p_provider_deployment_id
    and candidate.stream_id = p_stream_id
    and candidate.block_number between normalized_from and normalized_to
    and (
      previous_candidate is null
      or (
        candidate.block_number::bigint,
        candidate.block_global_log_index::bigint,
        candidate.candidate_id::text
      ) > (previous_block, previous_log, previous_candidate)
    )
    and (
      is_empty_page
      or (
        candidate.block_number::bigint,
        candidate.block_global_log_index::bigint,
        candidate.candidate_id::text
      ) <= (normalized_to, normalized_final_log, p_final_candidate_id)
    );
  inbox_commitments := coalesce(
    inbox_commitments, array[]::bytea[]
  );
  if inbox_commitments is distinct from p_ordered_log_commitments_a then
    raise exception using
      errcode = '23514',
      message = 'Envio inbox omits or changes a dual-RPC-covered log';
  end if;

  select * into existing
  from programmable_private.dual_rpc_log_coverage_evidence
  where chain_id = 1
    and provider_deployment_id = p_provider_deployment_id
    and stream_id = p_stream_id
    and next_cursor_generation = p_next_cursor_generation;
  if found then
    if existing.log_coverage_evidence_id <> p_log_coverage_evidence_id
       or existing.verification_run_id <> p_run_id
       or existing.expected_cursor_generation
         <> p_expected_cursor_generation
       or existing.previous_block_number <> previous_block
       or existing.previous_block_global_log_index
         is distinct from previous_log
       or existing.previous_candidate_id is distinct from previous_candidate
       or existing.from_block_number <> normalized_from
       or existing.to_block_number <> normalized_to
       or existing.final_block_hash <> p_final_block_hash
       or existing.final_block_global_log_index <> normalized_final_log
       or existing.final_candidate_id <> p_final_candidate_id
       or existing.safe_head_observation_id <> p_safe_head_observation_id
       or existing.final_block_evidence_id <> p_final_block_evidence_id
       or existing.provider_a_id <> p_provider_a_id
       or existing.provider_b_id <> p_provider_b_id
       or existing.filter_commitment <> p_filter_commitment
       or existing.ordered_log_commitments_a
         <> p_ordered_log_commitments_a
       or existing.ordered_log_commitments_b
         <> p_ordered_log_commitments_b
       or existing.ordered_inbox_commitments <> inbox_commitments
       or existing.page_commitment <> p_page_commitment
       or existing.encoding_version <> p_encoding_version
       or existing.canonical_preimage <> p_canonical_preimage
       or existing.content_fingerprint <> p_content_fingerprint
       or existing.evidence_commitment <> p_evidence_commitment
       or existing.verified_at <> p_verified_at
    then
      raise exception using
        errcode = '23505', message = 'log coverage evidence replay conflict';
    end if;
    return existing.log_coverage_evidence_id;
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'dual_rpc_log_coverage.append', p_evidence_commitment,
    p_run_id, p_verified_at
  );
  insert into programmable_private.dual_rpc_log_coverage_evidence (
    log_coverage_evidence_id, chain_id, epoch_id, pointer_generation,
    provider_deployment_id, stream_id,
    expected_cursor_generation, next_cursor_generation,
    previous_block_number, previous_block_global_log_index,
    previous_candidate_id, from_block_number, to_block_number,
    final_block_hash, final_block_global_log_index, final_candidate_id,
    safe_head_observation_id, final_block_evidence_id,
    provider_a_id, provider_b_id, filter_commitment,
    ordered_log_commitments_a, ordered_log_commitments_b,
    ordered_inbox_commitments, page_commitment,
    encoding_version, canonical_preimage, content_fingerprint,
    evidence_commitment, verification_run_id, verified_at,
    created_by_audit_id
  ) values (
    p_log_coverage_evidence_id, 1, header.epoch_id,
    header.captured_pointer_generation, p_provider_deployment_id,
    p_stream_id::programmable_private.source_identifier,
    p_expected_cursor_generation, p_next_cursor_generation,
    previous_block::programmable_private.block_number_value,
    previous_log,
    previous_candidate::programmable_private.envio_candidate_identifier,
    normalized_from::programmable_private.block_number_value,
    normalized_to::programmable_private.block_number_value,
    p_final_block_hash::programmable_private.bytes32_value,
    normalized_final_log::programmable_private.block_log_index_value,
    p_final_candidate_id::programmable_private.envio_candidate_identifier,
    p_safe_head_observation_id, p_final_block_evidence_id,
    p_provider_a_id, p_provider_b_id,
    p_filter_commitment::programmable_private.bytes32_value,
    p_ordered_log_commitments_a, p_ordered_log_commitments_b,
    inbox_commitments,
    p_page_commitment::programmable_private.bytes32_value,
    p_encoding_version, p_canonical_preimage,
    p_content_fingerprint::programmable_private.bytes32_value,
    p_evidence_commitment::programmable_private.bytes32_value,
    p_run_id, p_verified_at, created_audit_id
  );
  return p_log_coverage_evidence_id;
end
$function$;

create or replace function programmable_private.advance_envio_ingestion_cursor_v1(
  p_run_id uuid,
  p_provider_deployment_id uuid,
  p_stream_id text,
  p_expected_generation bigint,
  p_next_generation bigint,
  p_block_number numeric,
  p_block_hash bytea,
  p_block_global_log_index numeric,
  p_candidate_id text,
  p_page_commitment bytea,
  p_changed_at timestamptz default pg_catalog.clock_timestamp()
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  candidate programmable_private.envio_candidate_inbox%rowtype;
  coverage programmable_private.dual_rpc_log_coverage_evidence%rowtype;
  current_cursor programmable_private.envio_ingestion_cursor_current%rowtype;
  normalized_block bigint;
  normalized_log_index bigint;
  is_empty_page boolean;
  history_id uuid := pg_catalog.gen_random_uuid();
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'ingestion'
    and chain_id = 1 and release_id = 'envio-control'
    and model_id = 'envio-control' and source_group = 'canonical-events'
    and epoch_id = '70000000-0000-0000-0000-000000000002'
    and captured_pointer_generation = 1;
  if not found or not exists (
    select 1 from programmable_private.run_lifecycle_outcomes
    where run_id = p_run_id and status = 'succeeded'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Envio cursor advance requires a succeeded neutral ingestion run';
  end if;
  if p_block_number is null
     or p_block_global_log_index is null
     or p_candidate_id is null
     or p_expected_generation < 0
     or p_next_generation <> p_expected_generation + 1
     or p_block_number <> pg_catalog.trunc(p_block_number)
     or p_block_number < 0 or p_block_number > 9223372036854775807
     or p_block_global_log_index <> pg_catalog.trunc(p_block_global_log_index)
     or p_block_global_log_index < 0
     or p_block_global_log_index > 4294967295
     or pg_catalog.octet_length(p_block_hash) <> 32
     or pg_catalog.octet_length(p_page_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid Envio cursor CAS';
  end if;
  normalized_block := p_block_number::bigint;
  normalized_log_index := p_block_global_log_index::bigint;
  select * into coverage
  from programmable_private.dual_rpc_log_coverage_evidence
  where verification_run_id = p_run_id
    and chain_id = 1
    and provider_deployment_id = p_provider_deployment_id
    and stream_id = p_stream_id
    and expected_cursor_generation = p_expected_generation
    and next_cursor_generation = p_next_generation
    and to_block_number = normalized_block
    and final_block_hash = p_block_hash
    and final_block_global_log_index = normalized_log_index
    and final_candidate_id = p_candidate_id
    and page_commitment = p_page_commitment;
  if coverage.log_coverage_evidence_id is null then
    raise exception using
      errcode = '23514',
      message = 'Envio cursor lacks exact dual-RPC log coverage';
  end if;
  is_empty_page :=
    pg_catalog.cardinality(coverage.ordered_log_commitments_a) = 0;
  if not is_empty_page then
    select * into candidate
    from programmable_private.envio_candidate_inbox
    where candidate_id = p_candidate_id
      and chain_id = 1
      and provider_deployment_id = p_provider_deployment_id
      and stream_id = p_stream_id
      and block_number = normalized_block
      and block_hash = p_block_hash
      and block_global_log_index = normalized_log_index;
    if candidate.candidate_id is null then
      raise exception using
        errcode = '23514',
        message = 'Envio cursor lacks durable final inbox candidate';
    end if;
  end if;
  select * into current_cursor
  from programmable_private.envio_ingestion_cursor_current
  where chain_id = 1
    and provider_deployment_id = p_provider_deployment_id
    and stream_id = p_stream_id
  for update;
  if (found and current_cursor.generation <> p_expected_generation)
     or (not found and p_expected_generation <> 0)
     or (
       current_cursor.generation is not null
       and (
         (
           current_cursor.block_global_log_index is null
           and normalized_block <= current_cursor.block_number
         )
         or
         (
           current_cursor.block_global_log_index is not null
           and is_empty_page
           and normalized_block < current_cursor.block_number
         )
         or
         (
           current_cursor.block_global_log_index is not null
           and not is_empty_page
           and (normalized_block, normalized_log_index, p_candidate_id)
             <= (
               current_cursor.block_number::bigint,
               current_cursor.block_global_log_index::bigint,
               current_cursor.candidate_id::text
             )
         )
       )
     )
  then
    raise exception using
      errcode = '40001', message = 'Envio cursor CAS lost or did not advance';
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'envio_cursor.advance', p_page_commitment, p_run_id, p_changed_at
  );
  insert into programmable_private.envio_ingestion_cursor_history (
    cursor_history_id, chain_id, provider_deployment_id, stream_id,
    generation, block_number, block_hash, block_global_log_index,
    candidate_id, content_commitment, changed_by_run_id, changed_at,
    audit_id, is_rewind, rewound_from_generation, is_genesis,
    genesis_point_id, log_coverage_evidence_id
  ) values (
    history_id, 1, p_provider_deployment_id,
    p_stream_id::programmable_private.source_identifier, p_next_generation,
    normalized_block::programmable_private.block_number_value,
    p_block_hash::programmable_private.bytes32_value,
    case when is_empty_page then null
      else normalized_log_index::programmable_private.block_log_index_value
    end,
    case when is_empty_page then null
      else p_candidate_id::programmable_private.envio_candidate_identifier
    end,
    p_page_commitment::programmable_private.bytes32_value,
    p_run_id, p_changed_at, created_audit_id, false, null, false, null,
    coverage.log_coverage_evidence_id
  );
  if p_expected_generation = 0 then
    insert into programmable_private.envio_ingestion_cursor_current (
      chain_id, provider_deployment_id, stream_id, generation, block_number,
      block_hash, block_global_log_index, candidate_id, content_commitment,
      changed_by_run_id, changed_at, audit_id, cursor_history_id,
      is_genesis, is_rewind, genesis_point_id, log_coverage_evidence_id
    ) values (
      1, p_provider_deployment_id,
      p_stream_id::programmable_private.source_identifier, p_next_generation,
      normalized_block::programmable_private.block_number_value,
      p_block_hash::programmable_private.bytes32_value,
      case when is_empty_page then null
        else normalized_log_index::programmable_private.block_log_index_value
      end,
      case when is_empty_page then null
        else p_candidate_id::programmable_private.envio_candidate_identifier
      end,
      p_page_commitment::programmable_private.bytes32_value,
      p_run_id, p_changed_at, created_audit_id, history_id,
      false, false, null, coverage.log_coverage_evidence_id
    ) on conflict (chain_id, provider_deployment_id, stream_id) do nothing;
  else
    update programmable_private.envio_ingestion_cursor_current
    set generation = p_next_generation,
        block_number = normalized_block,
        block_hash = p_block_hash,
        block_global_log_index = case when is_empty_page then null
          else normalized_log_index
        end,
        candidate_id = case when is_empty_page then null
          else p_candidate_id::programmable_private.envio_candidate_identifier
        end,
        content_commitment = p_page_commitment,
        changed_by_run_id = p_run_id,
        changed_at = p_changed_at,
        audit_id = created_audit_id,
        cursor_history_id = history_id,
        is_genesis = false,
        is_rewind = false,
        genesis_point_id = null,
        log_coverage_evidence_id = coverage.log_coverage_evidence_id
    where chain_id = 1
      and provider_deployment_id = p_provider_deployment_id
      and stream_id = p_stream_id
      and generation = p_expected_generation;
  end if;
  if not found then
    raise exception using errcode = '40001', message = 'Envio cursor CAS lost';
  end if;
  return p_next_generation;
end
$function$;

create or replace function programmable_private.commit_envio_ingestion_page_v1(
  p_outcome_id uuid,
  p_log_coverage_evidence_id uuid,
  p_run_id uuid,
  p_provider_deployment_id uuid,
  p_stream_id text,
  p_expected_generation bigint,
  p_next_generation bigint,
  p_from_block_number numeric,
  p_candidates programmable_private.envio_candidate_page_item_v1[],
  p_safe_head_observation_id uuid,
  p_final_block_evidence_id uuid,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_filter_commitment bytea,
  p_ordered_log_commitments_a bytea[],
  p_ordered_log_commitments_b bytea[],
  p_page_commitment bytea,
  p_result_commitment bytea,
  p_coverage_encoding_version smallint,
  p_coverage_canonical_preimage bytea,
  p_coverage_content_fingerprint bytea,
  p_coverage_evidence_commitment bytea,
  p_finished_at timestamptz default pg_catalog.clock_timestamp()
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  item programmable_private.envio_candidate_page_item_v1;
  previous_item programmable_private.envio_candidate_page_item_v1;
  final_item programmable_private.envio_candidate_page_item_v1;
  existing_outcome programmable_private.run_lifecycle_outcomes%rowtype;
  existing_coverage programmable_private.dual_rpc_log_coverage_evidence%rowtype;
  existing_history programmable_private.envio_ingestion_cursor_history%rowtype;
  final_evidence programmable_private.dual_rpc_block_evidence%rowtype;
  item_count integer;
  is_empty_page boolean;
  final_block_number bigint;
  final_block_hash bytea;
  final_log_index bigint;
  final_candidate_id text;
  input_commitments bytea[] := array[]::bytea[];
  locked_genesis_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  item_count := pg_catalog.cardinality(p_candidates);
  if p_candidates is null
     or item_count not between 0 and 2000
     or p_ordered_log_commitments_a is null
     or p_ordered_log_commitments_b is null
     or p_outcome_id is null
     or p_log_coverage_evidence_id is null
     or p_finished_at is null
     or pg_catalog.octet_length(p_result_commitment) <> 32
  then
    raise exception using
      errcode = '22023', message = 'invalid atomic Envio page commit';
  end if;
  is_empty_page := item_count = 0;
  if is_empty_page
     and (
       pg_catalog.cardinality(p_ordered_log_commitments_a) <> 0
       or pg_catalog.cardinality(p_ordered_log_commitments_b) <> 0
     )
  then
    raise exception using
      errcode = '22023',
      message = 'empty Envio page reported one or more RPC logs';
  end if;
  foreach item in array p_candidates loop
    if previous_item.candidate_id is not null and (
      item.block_number, item.block_global_log_index, item.candidate_id
    ) <= (
      previous_item.block_number,
      previous_item.block_global_log_index,
      previous_item.candidate_id
    ) then
      raise exception using
        errcode = '22023',
        message = 'Envio page candidates are not strictly ordered';
    end if;
    input_commitments := pg_catalog.array_append(
      input_commitments, item.content_commitment
    );
    previous_item := item;
    final_item := item;
  end loop;

  select genesis.genesis_point_id into locked_genesis_id
  from programmable_private.envio_ingestion_cursor_genesis_points as genesis
  where genesis.chain_id = 1
    and genesis.provider_deployment_id = p_provider_deployment_id
    and genesis.stream_id = p_stream_id
  for update;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'atomic Envio page requires registered genesis';
  end if;

  if is_empty_page then
    select * into final_evidence
    from programmable_private.dual_rpc_block_evidence
    where block_evidence_id = p_final_block_evidence_id
      and observation_id = p_safe_head_observation_id
      and verification_run_id = p_run_id
      and chain_id = 1;
    if not found then
      raise exception using
        errcode = '23514',
        message = 'empty Envio page lacks same-run final block evidence';
    end if;
    final_block_number := final_evidence.block_number;
    final_block_hash := final_evidence.agreed_block_hash;
    final_log_index := 4294967295;
    final_candidate_id := 'empty-page';
  else
    final_block_number := final_item.block_number::bigint;
    final_block_hash := final_item.block_hash;
    final_log_index := final_item.block_global_log_index::bigint;
    final_candidate_id := final_item.candidate_id;
  end if;

  select * into existing_outcome
  from programmable_private.run_lifecycle_outcomes
  where run_id = p_run_id;
  if found then
    select * into existing_coverage
    from programmable_private.dual_rpc_log_coverage_evidence
    where chain_id = 1
      and provider_deployment_id = p_provider_deployment_id
      and stream_id = p_stream_id
      and next_cursor_generation = p_next_generation;
    select * into existing_history
    from programmable_private.envio_ingestion_cursor_history
    where chain_id = 1
      and provider_deployment_id = p_provider_deployment_id
      and stream_id = p_stream_id
      and generation = p_next_generation;
    if existing_outcome.outcome_id <> p_outcome_id
       or existing_outcome.status <> 'succeeded'
       or existing_outcome.result_commitment <> p_result_commitment
       or existing_outcome.finished_at <> p_finished_at
       or existing_coverage.log_coverage_evidence_id is null
       or existing_coverage.log_coverage_evidence_id
         <> p_log_coverage_evidence_id
       or existing_coverage.verification_run_id <> p_run_id
       or existing_coverage.expected_cursor_generation
         <> p_expected_generation
       or existing_coverage.next_cursor_generation <> p_next_generation
       or existing_coverage.from_block_number <> p_from_block_number
       or existing_coverage.to_block_number <> final_block_number
       or existing_coverage.final_block_hash <> final_block_hash
       or existing_coverage.final_block_global_log_index <> final_log_index
       or existing_coverage.final_candidate_id <> final_candidate_id
       or existing_coverage.safe_head_observation_id
         <> p_safe_head_observation_id
       or existing_coverage.final_block_evidence_id
         <> p_final_block_evidence_id
       or existing_coverage.provider_a_id <> p_provider_a_id
       or existing_coverage.provider_b_id <> p_provider_b_id
       or existing_coverage.filter_commitment <> p_filter_commitment
       or existing_coverage.ordered_log_commitments_a
         <> p_ordered_log_commitments_a
       or existing_coverage.ordered_log_commitments_b
         <> p_ordered_log_commitments_b
       or existing_coverage.ordered_inbox_commitments <> input_commitments
       or existing_coverage.page_commitment <> p_page_commitment
       or existing_coverage.encoding_version
         <> p_coverage_encoding_version
       or existing_coverage.canonical_preimage
         <> p_coverage_canonical_preimage
       or existing_coverage.content_fingerprint
         <> p_coverage_content_fingerprint
       or existing_coverage.evidence_commitment
         <> p_coverage_evidence_commitment
       or existing_coverage.verified_at <> p_finished_at
       or existing_history.cursor_history_id is null
       or existing_history.block_number <> final_block_number
       or existing_history.block_hash <> final_block_hash
       or existing_history.content_commitment <> p_page_commitment
       or existing_history.changed_by_run_id <> p_run_id
       or existing_history.changed_at <> p_finished_at
       or existing_history.is_rewind
       or existing_history.is_genesis
       or existing_history.log_coverage_evidence_id
         <> p_log_coverage_evidence_id
       or (
         is_empty_page and (
           existing_history.block_global_log_index is not null
           or existing_history.candidate_id is not null
         )
       )
       or (
         not is_empty_page and (
           existing_history.block_global_log_index <> final_log_index
           or existing_history.candidate_id <> final_candidate_id
         )
       )
    then
      raise exception using
        errcode = '23505', message = 'atomic Envio page replay conflict';
    end if;
    foreach item in array p_candidates loop
      if not exists (
        select 1 from programmable_private.envio_candidate_inbox as candidate
        where candidate.candidate_id = item.candidate_id
          and candidate.chain_id = 1
          and candidate.provider_deployment_id = p_provider_deployment_id
          and candidate.stream_id = p_stream_id
          and candidate.content_commitment = item.content_commitment
      ) then
        raise exception using
          errcode = '23505', message = 'atomic Envio page replay conflict';
      end if;
    end loop;
    return p_next_generation;
  end if;

  foreach item in array p_candidates loop
    perform programmable_private.append_release_neutral_envio_candidate(
      item.candidate_id, p_run_id, item.block_number, item.block_hash,
      item.transaction_hash, item.transaction_index,
      item.block_global_log_index, item.source_address,
      item.event_signature, item.event_type, item.ordered_topics,
      item.raw_data, item.decoded_payload, item.payload_hash,
      item.provider_cursor, p_provider_deployment_id,
      item.content_commitment, item.first_seen_at,
      p_stream_id, item.contract_name
    );
  end loop;
  perform programmable_private.append_dual_rpc_log_coverage_evidence(
    p_log_coverage_evidence_id, p_run_id, p_provider_deployment_id,
    p_stream_id, p_expected_generation, p_next_generation,
    p_from_block_number, final_block_number, final_block_hash,
    final_log_index, final_candidate_id,
    p_safe_head_observation_id, p_final_block_evidence_id,
    p_provider_a_id, p_provider_b_id, p_filter_commitment,
    p_ordered_log_commitments_a, p_ordered_log_commitments_b,
    p_page_commitment, p_coverage_encoding_version,
    p_coverage_canonical_preimage, p_coverage_content_fingerprint,
    p_coverage_evidence_commitment, p_finished_at
  );
  perform programmable_private.append_run_outcome(
    p_outcome_id, p_run_id, 'succeeded', p_result_commitment, p_finished_at
  );
  return programmable_private.advance_envio_ingestion_cursor_v1(
    p_run_id, p_provider_deployment_id, p_stream_id,
    p_expected_generation, p_next_generation,
    final_block_number, final_block_hash,
    final_log_index, final_candidate_id,
    p_page_commitment, p_finished_at
  );
end
$function$;

-- Missing materializations previously left a record variable full of NULLs;
-- ordinary `<>` predicates then evaluated to NULL and could let the composite
-- IF fall through. Reject every missing row/role first and use null-safe
-- comparisons for decoded payload fields.
create or replace function programmable_private.bind_dynamic_source_release_asset_v1(
  p_dynamic_source_release_asset_binding_id uuid,
  p_run_id uuid,
  p_dynamic_source_attestation_id uuid,
  p_launch_occurrence_id uuid,
  p_pool_occurrence_id uuid,
  p_pool_id bytea,
  p_token bytea,
  p_hook bytea,
  p_quote_asset bytea,
  p_binding_commitment bytea,
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
  attestation programmable_private.dynamic_source_attestations%rowtype;
  template programmable_private.release_dynamic_source_templates%rowtype;
  runtime programmable_private.dual_rpc_runtime_code_evidence%rowtype;
  parent_materialization
    programmable_private.chain_event_occurrence_materializations%rowtype;
  launch_materialization
    programmable_private.chain_event_occurrence_materializations%rowtype;
  pool_materialization
    programmable_private.chain_event_occurrence_materializations%rowtype;
  parent_occurrence programmable_private.chain_event_occurrences%rowtype;
  launch_occurrence programmable_private.chain_event_occurrences%rowtype;
  pool_occurrence programmable_private.chain_event_occurrences%rowtype;
  launch_role text;
  pool_role text;
  existing programmable_private.dynamic_source_release_asset_bindings%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind in ('ingestion', 'projection');
  if not found or exists (
    select 1 from programmable_private.run_lifecycle_outcomes
    where run_id = p_run_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'dynamic asset binding requires an open verification run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if p_dynamic_source_release_asset_binding_id is null
     or pg_catalog.octet_length(p_pool_id) <> 32
     or pg_catalog.octet_length(p_token) <> 20
     or pg_catalog.octet_length(p_hook) <> 20
     or pg_catalog.octet_length(p_quote_asset) <> 20
     or p_token = p_quote_asset
     or pg_catalog.octet_length(p_binding_commitment) <> 32
  then
    raise exception using
      errcode = '22023', message = 'invalid dynamic release asset binding';
  end if;
  select * into attestation
  from programmable_private.dynamic_source_attestations
  where dynamic_source_attestation_id = p_dynamic_source_attestation_id
    and chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  select * into template
  from programmable_private.release_dynamic_source_templates
  where dynamic_source_template_id = attestation.dynamic_source_template_id
    and epoch_id = header.epoch_id;
  select * into runtime
  from programmable_private.dual_rpc_runtime_code_evidence
  where runtime_code_evidence_id = attestation.runtime_code_evidence_id
    and chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation
    and source_address = attestation.deployed_source_address;
  if attestation.dynamic_source_attestation_id is null
     or template.dynamic_source_template_id is null
     or runtime.runtime_code_evidence_id is null
     or runtime.runtime_code_a is distinct from runtime.runtime_code_b
     or runtime.runtime_code_a
       is distinct from runtime.reconstructed_runtime_code
     or runtime.agreed_runtime_code_hash
       is distinct from attestation.runtime_code_hash
     or runtime.agreed_normalized_runtime_code_hash
       is distinct from template.normalized_runtime_code_hash
     or runtime.immutable_references_commitment
       is distinct from template.immutable_references_commitment
     or runtime.immutable_values_commitment
       is distinct from attestation.expected_immutable_values_commitment
     or (
       template.expected_instance_runtime_code_hash is not null
       and template.expected_instance_runtime_code_hash
         is distinct from runtime.agreed_runtime_code_hash
     )
  then
    raise exception using
      errcode = '23514',
      message = 'dynamic source lacks exact bytecode, template or immutable evidence';
  end if;

  select * into parent_occurrence
  from programmable_private.chain_event_occurrences
  where occurrence_id = attestation.parent_factory_occurrence_id;
  select * into parent_materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = attestation.parent_factory_occurrence_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  select * into launch_occurrence
  from programmable_private.chain_event_occurrences
  where occurrence_id = p_launch_occurrence_id;
  select * into launch_materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = p_launch_occurrence_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  select * into pool_occurrence
  from programmable_private.chain_event_occurrences
  where occurrence_id = p_pool_occurrence_id;
  select * into pool_materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = p_pool_occurrence_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  select binding.source_role into launch_role
  from programmable_private.release_source_bindings as binding
  where binding.binding_id = launch_materialization.release_binding_id;
  select binding.source_role into pool_role
  from programmable_private.release_source_bindings as binding
  where binding.binding_id = pool_materialization.release_binding_id;

  if parent_occurrence.occurrence_id is null
     or launch_occurrence.occurrence_id is null
     or pool_occurrence.occurrence_id is null
     or parent_materialization.materialization_id is null
     or launch_materialization.materialization_id is null
     or pool_materialization.materialization_id is null
     or launch_role is null
     or pool_role is null
  then
    raise exception using
      errcode = '23514',
      message = 'dynamic source parent, launch or pool materialization is missing';
  end if;
  if parent_materialization.release_binding_id
       is distinct from attestation.parent_factory_release_binding_id
     or parent_materialization.event_type
       is distinct from template.factory_event_type
     or launch_role not in ('launcher', 'coordinator')
     or pool_role <> 'hook'
     or parent_occurrence.block_number
       is distinct from attestation.deployment_block_number
     or launch_occurrence.block_number > parent_occurrence.block_number
     or pool_occurrence.block_number > parent_occurrence.block_number
     or (
       select pg_catalog.count(*)
       from programmable_private.chain_event_current_canonical
       where occurrence_id = any(array[
         parent_occurrence.occurrence_id,
         launch_occurrence.occurrence_id,
         pool_occurrence.occurrence_id
       ]::uuid[])
     ) <> 3
     or programmable_private.json_hex_bytes_v1(
       parent_materialization.decoded_payload,
       template.deployed_address_field, 20
     ) is distinct from attestation.deployed_source_address
     or programmable_private.json_hex_bytes_v1(
       launch_materialization.decoded_payload, 'token', 20
     ) is distinct from p_token
     or programmable_private.json_hex_bytes_v1(
       launch_materialization.decoded_payload, 'poolId', 32
     ) is distinct from p_pool_id
     or programmable_private.json_hex_bytes_v1(
       launch_materialization.decoded_payload, 'hook', 20
     ) is distinct from p_hook
     or programmable_private.json_hex_bytes_v1(
       launch_materialization.decoded_payload, 'quoteAsset', 20
     ) is distinct from p_quote_asset
     or programmable_private.json_hex_bytes_v1(
       pool_materialization.decoded_payload, 'poolId', 32
     ) is distinct from p_pool_id
     or programmable_private.json_hex_bytes_v1(
       pool_materialization.decoded_payload, 'hook', 20
     ) is distinct from p_hook
     or not (
       programmable_private.json_hex_bytes_v1(
         pool_materialization.decoded_payload, 'currency0', 20
       ) is not distinct from p_token
       and programmable_private.json_hex_bytes_v1(
         pool_materialization.decoded_payload, 'currency1', 20
       ) is not distinct from p_quote_asset
       or programmable_private.json_hex_bytes_v1(
         pool_materialization.decoded_payload, 'currency1', 20
       ) is not distinct from p_token
       and programmable_private.json_hex_bytes_v1(
         pool_materialization.decoded_payload, 'currency0', 20
       ) is not distinct from p_quote_asset
     )
  then
    raise exception using
      errcode = '23514',
      message = 'factory, launch and pool payloads do not bind the exact dynamic source assets';
  end if;

  select * into existing
  from programmable_private.dynamic_source_release_asset_bindings
  where dynamic_source_attestation_id = p_dynamic_source_attestation_id;
  if found then
    if existing.dynamic_source_release_asset_binding_id
         <> p_dynamic_source_release_asset_binding_id
       or existing.launch_occurrence_id <> p_launch_occurrence_id
       or existing.pool_occurrence_id <> p_pool_occurrence_id
       or existing.pool_id <> p_pool_id
       or existing.token <> p_token
       or existing.hook <> p_hook
       or existing.quote_asset <> p_quote_asset
       or existing.binding_commitment <> p_binding_commitment
       or existing.verification_run_id <> p_run_id
       or existing.verified_at <> p_verified_at
    then
      raise exception using
        errcode = '23505', message = 'dynamic asset binding replay conflict';
    end if;
    return existing.dynamic_source_release_asset_binding_id;
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'dynamic_source_asset_binding.append', p_binding_commitment,
    p_run_id, p_verified_at
  );
  insert into programmable_private.dynamic_source_release_asset_bindings (
    dynamic_source_release_asset_binding_id, dynamic_source_attestation_id,
    chain_id, release_id, model_id, source_group, epoch_id,
    pointer_generation, parent_factory_occurrence_id, launch_occurrence_id,
    pool_occurrence_id, deployed_source_address, pool_id, token, hook,
    quote_asset, runtime_code_evidence_id, template_commitment,
    binding_commitment, verification_run_id, verified_at,
    created_by_audit_id
  ) values (
    p_dynamic_source_release_asset_binding_id,
    attestation.dynamic_source_attestation_id,
    attestation.chain_id, attestation.release_id, attestation.model_id,
    attestation.source_group, attestation.epoch_id,
    attestation.pointer_generation, attestation.parent_factory_occurrence_id,
    p_launch_occurrence_id, p_pool_occurrence_id,
    attestation.deployed_source_address,
    p_pool_id::programmable_private.bytes32_value,
    p_token::programmable_private.eth_address,
    p_hook::programmable_private.eth_address,
    p_quote_asset::programmable_private.eth_address,
    runtime.runtime_code_evidence_id, template.template_commitment,
    p_binding_commitment::programmable_private.bytes32_value,
    p_run_id, p_verified_at, created_audit_id
  );
  return p_dynamic_source_release_asset_binding_id;
end
$function$;

-- Classic V2/V3 manifests place the one-sided launch position exactly at the
-- upper tick boundary. Other models retain the strict-interior invariant; a
-- lower-boundary relaxation is intentionally not allowlisted.
alter table programmable_private.launch_position_liquidity_facts
  drop constraint launch_position_liquidity_facts_check,
  add constraint launch_position_liquidity_exact_tick_policy_check check (
    (
      tick_lower < initial_tick and initial_tick < tick_upper
    )
    or
    (
      release_id in ('classic-v2', 'classic-v3')
      and model_id = release_id
      and tick_lower < initial_tick
      and initial_tick = tick_upper
    )
  );

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
      errcode = '55000', message = 'launch liquidity requires an open projection run';
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
      and header.model_id = header.release_id
      and p_tick_lower < p_initial_tick
      and p_initial_tick = p_tick_upper
    );
  if launch.launch_projection_id is null
     or occurrence.occurrence_id is null
     or materialization.materialization_id is null
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
       materialization.decoded_payload, 'poolId', 32
     ) is distinct from launch.pool_id
     or programmable_private.json_hex_bytes_v1(
       materialization.decoded_payload, 'token', 20
     ) is distinct from launch.token
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

-- Decode the exact 5-word AggregatorV3Interface.latestRoundData() return.
-- PostgreSQL numeric preserves all 256 bits; no float or JavaScript-number
-- coercion participates in the persisted price fields.
create or replace function programmable_private.market_reconciliation_context_v1(
  p_reconciliation_id uuid,
  p_block_evidence_id uuid,
  p_block_hash bytea
)
returns table (
  run_id uuid,
  chain_id bigint,
  release_id text,
  model_id text,
  source_group text,
  epoch_id uuid,
  pointer_generation bigint,
  block_number bigint,
  safe_head_observation_id uuid
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  reconciliation programmable_private.reconciliation_records%rowtype;
  header programmable_private.run_headers%rowtype;
  evidence programmable_private.dual_rpc_block_evidence%rowtype;
begin
  select reconciliation_row.* into reconciliation
  from programmable_private.reconciliation_records as reconciliation_row
  where reconciliation_row.reconciliation_id = p_reconciliation_id
    and reconciliation_row.mismatch_count = 0;
  select header_row.* into header
  from programmable_private.run_headers as header_row
  where header_row.run_id = reconciliation.run_id
    and header_row.run_kind = 'reconciliation';
  select evidence_row.* into evidence
  from programmable_private.dual_rpc_block_evidence as evidence_row
  where evidence_row.block_evidence_id = p_block_evidence_id
    and evidence_row.agreed_block_hash = p_block_hash;
  if reconciliation.reconciliation_id is null
     or header.run_id is null
     or evidence.block_evidence_id is null
     or exists (
       select 1
       from programmable_private.run_lifecycle_outcomes as outcome
       where outcome.run_id = header.run_id
     )
     or evidence.chain_id <> header.chain_id
     or evidence.epoch_id <> header.epoch_id
     or evidence.pointer_generation <> header.captured_pointer_generation
     or evidence.block_number not between
       reconciliation.source_from_block and reconciliation.source_to_block
  then
    raise exception using
      errcode = '23514',
      message = 'market fact lacks open exact reconciliation and block evidence';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  return query select
    header.run_id, header.chain_id::bigint, header.release_id::text,
    header.model_id::text, header.source_group::text, header.epoch_id,
    header.captured_pointer_generation, evidence.block_number::bigint,
    evidence.observation_id;
end
$function$;

create function programmable_private.abi_uint256_word_v1(
  p_result bytea,
  p_word_index integer
)
returns numeric
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  decoded numeric := 0;
  byte_offset integer;
begin
  if pg_catalog.octet_length(p_result) <> 160
     or p_word_index not between 0 and 4
  then
    raise exception using
      errcode = '22023', message = 'invalid latestRoundData ABI payload';
  end if;
  for byte_offset in 0..31 loop
    decoded := decoded * 256 + pg_catalog.get_byte(
      p_result, p_word_index * 32 + byte_offset
    );
  end loop;
  return decoded;
end
$function$;

create function programmable_private.abi_int256_word_v1(
  p_result bytea,
  p_word_index integer
)
returns numeric
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select case
    when decoded >=
      57896044618658097711785492504343953926634992332820282019728792003956564819968::numeric
    then decoded -
      115792089237316195423570985008687907853269984665640564039457584007913129639936::numeric
    else decoded
  end
  from (
    select programmable_private.abi_uint256_word_v1(
      p_result, p_word_index
    ) as decoded
  ) as word
$function$;

alter table programmable_private.global_eth_usd_snapshots
  add column feed_started_at timestamptz,
  add column feed_answered_in_round numeric,
  add column rpc_decoding_version smallint,
  add constraint global_eth_usd_decoded_round_shape_check check (
    (
      rpc_decoding_version is null
      and feed_started_at is null
      and feed_answered_in_round is null
    )
    or
    (
      rpc_decoding_version = 1
      and feed_started_at is not null
      and feed_answered_in_round is not null
      and feed_answered_in_round >= feed_round_id
      and feed_started_at <= feed_updated_at
      and observed_at >= feed_updated_at
      and observed_at - feed_updated_at <= interval '1 hour'
      and decimals = 8
      and pg_catalog.octet_length(rpc_result_a) = 160
    )
  );

create or replace function programmable_private.append_global_eth_usd_snapshot_v1(
  p_global_market_snapshot_id uuid,
  p_reconciliation_id uuid,
  p_block_evidence_id uuid,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_feed_round_id numeric,
  p_answer numeric,
  p_decimals smallint,
  p_feed_updated_at timestamptz,
  p_rpc_result_a bytea,
  p_rpc_result_b bytea,
  p_source_query_commitment bytea,
  p_result_commitment bytea,
  p_observed_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  context record;
  observation programmable_private.safe_head_observations%rowtype;
  normalized_round numeric;
  decoded_round numeric;
  decoded_answer numeric;
  decoded_started_at numeric;
  decoded_updated_at numeric;
  decoded_answered_in_round numeric;
  decoded_started_timestamp timestamptz;
  decoded_updated_timestamp timestamptz;
  existing programmable_private.global_eth_usd_snapshots%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into context
  from programmable_private.market_reconciliation_context_v1(
    p_reconciliation_id, p_block_evidence_id,
    (
      select agreed_block_hash
      from programmable_private.dual_rpc_block_evidence
      where block_evidence_id = p_block_evidence_id
    )
  );
  select * into observation
  from programmable_private.safe_head_observations
  where observation_id = context.safe_head_observation_id
    and provider_a_id = p_provider_a_id
    and provider_b_id = p_provider_b_id;
  normalized_round := programmable_private.validate_uint256(p_feed_round_id);
  if p_rpc_result_a is null
     or p_rpc_result_b is null
     or pg_catalog.octet_length(p_rpc_result_a) <> 160
     or p_rpc_result_a <> p_rpc_result_b
  then
    raise exception using
      errcode = '23514', message = 'invalid exact ETH/USD RPC result';
  end if;
  decoded_round :=
    programmable_private.abi_uint256_word_v1(p_rpc_result_a, 0);
  decoded_answer :=
    programmable_private.abi_int256_word_v1(p_rpc_result_a, 1);
  decoded_started_at :=
    programmable_private.abi_uint256_word_v1(p_rpc_result_a, 2);
  decoded_updated_at :=
    programmable_private.abi_uint256_word_v1(p_rpc_result_a, 3);
  decoded_answered_in_round :=
    programmable_private.abi_uint256_word_v1(p_rpc_result_a, 4);
  if decoded_started_at > 253402300799
     or decoded_updated_at > 253402300799
  then
    raise exception using
      errcode = '22008', message = 'Chainlink timestamp is out of range';
  end if;
  decoded_started_timestamp := pg_catalog.to_timestamp(
    decoded_started_at::double precision
  );
  decoded_updated_timestamp := pg_catalog.to_timestamp(
    decoded_updated_at::double precision
  );
  if context.run_id is null
     or observation.observation_id is null
     or p_provider_a_id = p_provider_b_id
     or normalized_round is null
     or decoded_round <> normalized_round
     or decoded_round <= 0
     or decoded_round > 1208925819614629174706175::numeric
     or decoded_answer is distinct from p_answer
     or decoded_answer <= 0
     or p_answer::text in ('NaN', 'Infinity', '-Infinity')
     or p_decimals <> 8
     or decoded_started_at <= 0
     or decoded_updated_at < decoded_started_at
     or decoded_answered_in_round < decoded_round
     or decoded_answered_in_round > 1208925819614629174706175::numeric
     or p_feed_updated_at is distinct from decoded_updated_timestamp
     or p_observed_at < decoded_updated_timestamp
     or p_observed_at - decoded_updated_timestamp > interval '1 hour'
     or pg_catalog.octet_length(p_source_query_commitment) <> 32
     or pg_catalog.octet_length(p_result_commitment) <> 32
  then
    raise exception using
      errcode = '23514', message = 'invalid exact ETH/USD snapshot';
  end if;
  select * into existing
  from programmable_private.global_eth_usd_snapshots
  where global_market_snapshot_id = p_global_market_snapshot_id;
  if found then
    if existing.reconciliation_id <> p_reconciliation_id
       or existing.block_evidence_id <> p_block_evidence_id
       or existing.provider_a_id <> p_provider_a_id
       or existing.provider_b_id <> p_provider_b_id
       or existing.feed_round_id <> normalized_round
       or existing.answer <> decoded_answer
       or existing.decimals <> p_decimals
       or existing.feed_started_at is distinct from decoded_started_timestamp
       or existing.feed_updated_at <> decoded_updated_timestamp
       or existing.feed_answered_in_round <> decoded_answered_in_round
       or existing.rpc_result_a <> p_rpc_result_a
       or existing.rpc_result_b <> p_rpc_result_b
       or existing.source_query_commitment <> p_source_query_commitment
       or existing.result_commitment <> p_result_commitment
       or existing.rpc_decoding_version <> 1
       or existing.observed_at <> p_observed_at
    then
      raise exception using
        errcode = '23505', message = 'ETH/USD snapshot replay conflict';
    end if;
    return existing.global_market_snapshot_id;
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'global_eth_usd_snapshot.append', p_result_commitment,
    context.run_id, p_observed_at
  );
  insert into programmable_private.global_eth_usd_snapshots (
    global_market_snapshot_id, chain_id, release_id, model_id,
    source_group, epoch_id, pointer_generation, feed_address,
    feed_round_id, answer, decimals, feed_started_at, feed_updated_at,
    feed_answered_in_round, rpc_decoding_version,
    block_evidence_id, block_number, block_hash,
    safe_head_observation_id, provider_a_id, provider_b_id,
    rpc_result_a, rpc_result_b, source_query_commitment,
    result_commitment, reconciliation_id, observed_at, audit_id
  ) values (
    p_global_market_snapshot_id, context.chain_id,
    context.release_id::programmable_private.release_identifier,
    context.model_id::programmable_private.model_identifier,
    context.source_group::programmable_private.source_identifier,
    context.epoch_id, context.pointer_generation,
    pg_catalog.decode('5f4ec3df9cbd43714fe2740f5e3616155c5b8419', 'hex'),
    decoded_round::programmable_private.uint256_value,
    decoded_answer, p_decimals, decoded_started_timestamp,
    decoded_updated_timestamp, decoded_answered_in_round,
    1, p_block_evidence_id,
    context.block_number::programmable_private.block_number_value,
    (
      select agreed_block_hash
      from programmable_private.dual_rpc_block_evidence
      where block_evidence_id = p_block_evidence_id
    ),
    context.safe_head_observation_id, p_provider_a_id, p_provider_b_id,
    p_rpc_result_a, p_rpc_result_b,
    p_source_query_commitment::programmable_private.bytes32_value,
    p_result_commitment::programmable_private.bytes32_value,
    p_reconciliation_id, p_observed_at, created_audit_id
  );
  return p_global_market_snapshot_id;
end
$function$;

create or replace view programmable_private.global_eth_usd_snapshots_v1
with (security_invoker = false, security_barrier = true)
as
select snapshot.*
from programmable_private.global_eth_usd_snapshots as snapshot
join programmable_private.reconciliation_records as reconciliation
  on reconciliation.reconciliation_id = snapshot.reconciliation_id
 and reconciliation.mismatch_count = 0
join programmable_private.run_headers as run
  on run.run_id = reconciliation.run_id
 and run.run_kind = 'reconciliation'
 and run.chain_id = snapshot.chain_id
 and run.release_id = snapshot.release_id
 and run.model_id = snapshot.model_id
 and run.source_group = snapshot.source_group
 and run.epoch_id = snapshot.epoch_id
 and run.captured_pointer_generation = snapshot.pointer_generation
join programmable_private.run_lifecycle_outcomes as outcome
  on outcome.run_id = run.run_id and outcome.status = 'succeeded'
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = snapshot.chain_id
 and current_epoch.release_id = snapshot.release_id
 and current_epoch.model_id = snapshot.model_id
 and current_epoch.source_group = snapshot.source_group
 and current_epoch.epoch_id = snapshot.epoch_id
 and current_epoch.generation = snapshot.pointer_generation
where snapshot.rpc_decoding_version = 1;

create function programmable_private.enforce_decoded_eth_usd_snapshot_v1()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from programmable_private.global_eth_usd_snapshots
    where global_market_snapshot_id = new.global_market_snapshot_id
      and rpc_decoding_version = 1
      and observed_at >= feed_updated_at
      and observed_at - feed_updated_at <= interval '1 hour'
  ) then
    raise exception using
      errcode = '23514',
      message = 'market USD fact lacks decoded fresh Chainlink evidence';
  end if;
  return new;
end
$function$;

create trigger require_decoded_eth_usd_snapshot
before insert or update of global_market_snapshot_id
on programmable_private.market_snapshot_details
for each row execute function
  programmable_private.enforce_decoded_eth_usd_snapshot_v1();

create trigger require_decoded_eth_usd_snapshot
before insert or update of global_market_snapshot_id
on programmable_private.market_block_closes
for each row execute function
  programmable_private.enforce_decoded_eth_usd_snapshot_v1();

create trigger require_decoded_eth_usd_snapshot
before insert or update of global_market_snapshot_id
on programmable_private.market_candle_details
for each row execute function
  programmable_private.enforce_decoded_eth_usd_snapshot_v1();

-- Fee-only batches start from a pool identity rather than a token identity.
-- Resolve that pool only through the current launch entity in the exact open
-- projection scope; duplicate current materializations are corruption and
-- therefore fail closed rather than selecting an arbitrary row.
create function programmable_private.get_projector_pool_baseline_by_id_v1(
  p_projection_run_id uuid,
  p_pool_id bytea
)
returns table (
  pool_projection_id uuid,
  launch_projection_id uuid,
  token bytea,
  creator bytea,
  reward_vault bytea,
  currency0 bytea,
  currency1 bytea,
  pool_key_fee bigint,
  tick_spacing integer,
  hook bytea,
  pool_fee_configuration_id uuid,
  buy_swap_fee_bps integer,
  sell_swap_fee_bps integer,
  buy_creator_fee_bps integer,
  sell_creator_fee_bps integer,
  creator_fee_bps integer,
  launcher_fee_bps integer,
  transfer_tax_bps integer,
  lp_fee_pips bigint,
  source_projection_run_id uuid,
  promoted_block_number bigint,
  promoted_block_hash bytea,
  last_source_occurrence_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  candidate_count bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_open_projection_run_v1(
    p_projection_run_id
  );
  select * into header
  from programmable_private.run_headers
  where run_id = p_projection_run_id and run_kind = 'projection';
  if p_pool_id is null or pg_catalog.octet_length(p_pool_id) <> 32 then
    raise exception using
      errcode = '22023', message = 'invalid projector pool baseline key';
  end if;
  select pg_catalog.count(*) into candidate_count
  from programmable_private.current_launch_projections_v1 as launch
  join programmable_private.run_headers as source_run
    on source_run.run_id = launch.projection_run_id
   and source_run.chain_id = header.chain_id
   and source_run.release_id = header.release_id
   and source_run.model_id = header.model_id
   and source_run.source_group = header.source_group
   and source_run.epoch_id = header.epoch_id
   and source_run.captured_pointer_generation =
     header.captured_pointer_generation
  join programmable_private.pool_projections as pool
    on pool.launch_projection_id = launch.launch_projection_id
   and pool.projection_run_id = launch.projection_run_id
   and pool.chain_id = header.chain_id
   and pool.release_id = header.release_id
   and pool.model_id = header.model_id
   and pool.epoch_id = header.epoch_id
   and pool.pointer_generation = header.captured_pointer_generation
   and pool.pool_id = p_pool_id;
  if candidate_count > 1 then
    raise exception using
      errcode = '23514', message = 'projector pool baseline is ambiguous';
  end if;
  if candidate_count = 0 then
    return;
  end if;
  return query
  select
    pool.pool_projection_id,
    launch.launch_projection_id,
    launch.token::bytea,
    launch.creator::bytea,
    launch.reward_vault::bytea,
    pool.currency0::bytea,
    pool.currency1::bytea,
    pool.pool_key_fee,
    pool.tick_spacing,
    pool.hook::bytea,
    fee.pool_fee_configuration_id,
    fee.buy_swap_fee_bps::integer,
    fee.sell_swap_fee_bps::integer,
    fee.buy_creator_fee_bps::integer,
    fee.sell_creator_fee_bps::integer,
    fee.creator_fee_bps::integer,
    fee.launcher_fee_bps::integer,
    fee.transfer_tax_bps::integer,
    fee.lp_fee_pips,
    launch.projection_run_id,
    launch.promoted_block_number::bigint,
    launch.promoted_block_hash::bytea,
    pool.last_source_occurrence_id
  from programmable_private.current_launch_projections_v1 as launch
  join programmable_private.run_headers as source_run
    on source_run.run_id = launch.projection_run_id
   and source_run.chain_id = header.chain_id
   and source_run.release_id = header.release_id
   and source_run.model_id = header.model_id
   and source_run.source_group = header.source_group
   and source_run.epoch_id = header.epoch_id
   and source_run.captured_pointer_generation =
     header.captured_pointer_generation
  join programmable_private.pool_projections as pool
    on pool.launch_projection_id = launch.launch_projection_id
   and pool.projection_run_id = launch.projection_run_id
   and pool.chain_id = header.chain_id
   and pool.release_id = header.release_id
   and pool.model_id = header.model_id
   and pool.epoch_id = header.epoch_id
   and pool.pointer_generation = header.captured_pointer_generation
   and pool.pool_id = p_pool_id
  left join programmable_private.pool_fee_configurations as fee
    on fee.pool_projection_id = pool.pool_projection_id
   and fee.projection_run_id = pool.projection_run_id
   and fee.chain_id = pool.chain_id
   and fee.release_id = pool.release_id
   and fee.model_id = pool.model_id
   and fee.epoch_id = pool.epoch_id
   and fee.pointer_generation = pool.pointer_generation;
end
$function$;

-- Capability reader for staging a newly discovered reward vault.  It exposes
-- only the one allocation/evidence pair that would pass the promotion gate in
-- the exact open projection scope.  Zero rows means not ready; more than one
-- eligible pair is ambiguous and therefore fails closed.
create function programmable_private.get_projector_verified_reward_seed_v1(
  p_projection_run_id uuid,
  p_vault bytea
)
returns table (
  allocation_fact_id uuid,
  allocation_evidence_id uuid,
  factory_occurrence_id uuid,
  vault bytea,
  ordered_beneficiaries bytea[],
  ordered_shares_bps integer[],
  allocation_hash bytea,
  configuration_hash bytea,
  active_configuration_hash bytea,
  fact_content_fingerprint bytea,
  evidence_content_fingerprint bytea,
  evidence_version text,
  recovery_method text,
  evidence_verified_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  eligible_count bigint;
  selected_fact_id uuid;
  selected_evidence_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_open_projection_run_v1(
    p_projection_run_id
  );
  select * into header
  from programmable_private.run_headers
  where run_id = p_projection_run_id and run_kind = 'projection';
  if p_vault is null or pg_catalog.octet_length(p_vault) <> 20 then
    raise exception using
      errcode = '22023', message = 'invalid reward-seed vault';
  end if;

  select pg_catalog.count(*),
         pg_catalog.min(candidate.allocation_fact_id::text)::uuid,
         pg_catalog.min(candidate.allocation_evidence_id::text)::uuid
  into eligible_count, selected_fact_id, selected_evidence_id
  from (
    select distinct on (fact.allocation_fact_id)
      fact.allocation_fact_id, evidence.allocation_evidence_id
    from programmable_private.reward_allocation_facts as fact
    join programmable_private.run_headers as fact_run
      on fact_run.run_id = fact.verification_run_id
     and fact_run.chain_id = header.chain_id
     and fact_run.release_id = header.release_id
     and fact_run.model_id = header.model_id
     and fact_run.source_group = header.source_group
     and fact_run.epoch_id = header.epoch_id
     and fact_run.captured_pointer_generation =
       header.captured_pointer_generation
    join programmable_private.release_source_bindings as factory_binding
      on factory_binding.binding_id = fact.factory_release_binding_id
     and factory_binding.epoch_id = header.epoch_id
     and factory_binding.source_role = 'vault_factory'
     and factory_binding.binding_commitment =
       fact.factory_release_binding_commitment
    join programmable_private.reward_allocation_evidence as evidence
      on evidence.allocation_fact_id = fact.allocation_fact_id
     and evidence.is_recomputation_attested
     and evidence.recomputed_allocation_hash = fact.allocation_hash
     and evidence.recomputed_configuration_hash = fact.configuration_hash
     and evidence.recomputed_active_configuration_hash
       is not distinct from fact.active_configuration_hash
    join programmable_private.run_headers as evidence_run
      on evidence_run.run_id = evidence.verification_run_id
     and evidence_run.chain_id = header.chain_id
     and evidence_run.release_id = header.release_id
     and evidence_run.model_id = header.model_id
     and evidence_run.source_group = header.source_group
     and evidence_run.epoch_id = header.epoch_id
     and evidence_run.captured_pointer_generation =
       header.captured_pointer_generation
    join programmable_private.release_source_bindings as recovery_binding
      on recovery_binding.binding_id = evidence.recovery_release_binding_id
     and recovery_binding.epoch_id = header.epoch_id
     and recovery_binding.binding_commitment =
       evidence.recovery_release_binding_commitment
     and recovery_binding.source_role = case evidence.recovery_method
       when 'launcher_calldata' then 'launcher'
       when 'coordinator_calldata' then 'coordinator'
       when 'factory_calldata' then 'factory'
       else 'vault_factory'
     end
    left join programmable_private.chain_event_current_canonical as canonical
      on canonical.logical_event_id = fact.factory_logical_event_id
    join programmable_private.chain_event_materialized_occurrences_v1
      as factory_occurrence
      on factory_occurrence.occurrence_id = fact.factory_occurrence_id
     and factory_occurrence.logical_event_id = fact.factory_logical_event_id
     and factory_occurrence.block_hash = fact.factory_occurrence_block_hash
     and factory_occurrence.chain_id = header.chain_id
     and factory_occurrence.release_id = header.release_id
     and factory_occurrence.model_id = header.model_id
     and factory_occurrence.source_group = header.source_group
     and factory_occurrence.epoch_id = header.epoch_id
     and factory_occurrence.pointer_generation =
       header.captured_pointer_generation
    where fact.chain_id = header.chain_id
      and fact.release_id = header.release_id
      and fact.model_id = header.model_id
      and fact.epoch_id = header.epoch_id
      and fact.pointer_generation = header.captured_pointer_generation
      and fact.vault = p_vault
      -- First promotion has no canonical pointer yet.  The verified fact and
      -- exact epoch materialization are sufficient for staging; promotion
      -- still binds this occurrence to the target safe-head evidence before
      -- selecting it as canonical.  An existing competing canonical fork is
      -- never accepted here.
      and (
        canonical.logical_event_id is null
        or (
          canonical.occurrence_id = fact.factory_occurrence_id
          and canonical.block_hash = fact.factory_occurrence_block_hash
        )
      )
      and not exists (
        select 1
        from programmable_private.reward_allocation_status_history
          as rejected
        where rejected.allocation_fact_id = fact.allocation_fact_id
          and rejected.status in (
            'quarantined', 'orphaned', 'conflicted', 'revoked'
          )
      )
      and not exists (
        select 1
        from programmable_private.reward_allocation_current_verified
          as conflicting
        where conflicting.factory_occurrence_id = fact.factory_occurrence_id
          and conflicting.vault = fact.vault
          and conflicting.allocation_fact_id <> fact.allocation_fact_id
      )
      and not exists (
        select 1
        from programmable_private.reward_allocation_required_occurrences
          as required
        where required.allocation_fact_id = fact.allocation_fact_id
          and not exists (
            select 1
            from programmable_private.chain_event_materialized_occurrences_v1
              as required_occurrence
            left join programmable_private.chain_event_current_canonical
              as required_canonical
              on required_canonical.logical_event_id =
                required_occurrence.logical_event_id
            join programmable_private.release_source_bindings
              as required_binding
              on required_binding.binding_id = required.release_binding_id
             and required_binding.epoch_id = header.epoch_id
             and required_binding.source_role = required.occurrence_role
             and required_binding.binding_commitment =
                required.release_binding_commitment
            where required_occurrence.occurrence_id = required.occurrence_id
              and required_occurrence.chain_id = header.chain_id
             and required_occurrence.release_id = header.release_id
             and required_occurrence.model_id = header.model_id
             and required_occurrence.source_group = header.source_group
             and required_occurrence.epoch_id = header.epoch_id
             and required_occurrence.pointer_generation =
                header.captured_pointer_generation
              and required_occurrence.release_binding_id =
                required.release_binding_id
              and (
                required_canonical.logical_event_id is null
                or (
                  required_canonical.occurrence_id =
                    required_occurrence.occurrence_id
                  and required_canonical.block_hash =
                    required_occurrence.block_hash
                )
              )
          )
      )
    order by
      fact.allocation_fact_id,
      exists (
        select 1
        from programmable_private.reward_allocation_current_verified
          as selected
        where selected.allocation_fact_id = fact.allocation_fact_id
          and selected.allocation_evidence_id =
            evidence.allocation_evidence_id
      ) desc,
      (evidence.historical_enrichment_status = 'matched') desc,
      case evidence.recovery_method
        when 'historical_getters' then 0
        when 'launcher_calldata' then 1
        when 'coordinator_calldata' then 2
        when 'factory_calldata' then 3
        else 4
      end,
      evidence.evidence_version desc,
      evidence.verified_at desc,
      evidence.allocation_evidence_id
  ) as candidate;

  if eligible_count > 1 then
    raise exception using
      errcode = '23514',
      message = 'reward-seed selection is ambiguous';
  end if;
  if eligible_count = 0 then
    return;
  end if;
  return query
  select
    fact.allocation_fact_id,
    evidence.allocation_evidence_id,
    fact.factory_occurrence_id,
    fact.vault::bytea,
    fact.ordered_beneficiaries,
    fact.ordered_shares_bps,
    fact.allocation_hash::bytea,
    fact.configuration_hash::bytea,
    fact.active_configuration_hash::bytea,
    fact.content_fingerprint::bytea,
    evidence.content_fingerprint::bytea,
    evidence.evidence_version::text,
    evidence.recovery_method::text,
    evidence.verified_at
  from programmable_private.reward_allocation_facts as fact
  join programmable_private.reward_allocation_evidence as evidence
    on evidence.allocation_evidence_id = selected_evidence_id
   and evidence.allocation_fact_id = fact.allocation_fact_id
  where fact.allocation_fact_id = selected_fact_id;
end
$function$;

-- A route row is readable only while its checkpoint is still the exact
-- current checkpoint for the same scope, projector, epoch and pointer.  The
-- route table itself deliberately remains mutable through the fenced route
-- writers; this view is the single fail-closed read boundary.
create view programmable_private.route_eligibility_current_exact_v1
with (security_invoker = false, security_barrier = true)
as
select
  route.route_key,
  route.chain_id,
  route.release_id,
  route.model_id,
  route.source_group,
  route.epoch_id,
  route.pointer_generation,
  route.status,
  route.route_mode,
  route.checkpoint_id,
  route.history_id,
  route.changed_at,
  checkpoint.projector_version,
  checkpoint.checkpoint_generation,
  checkpoint.reorg_generation,
  checkpoint.block_number as checkpoint_block_number,
  checkpoint.block_hash as checkpoint_block_hash,
  checkpoint.created_at as checkpoint_created_at,
  observation.safe_block_number,
  observation.safe_block_number - checkpoint.block_number
    as checkpoint_confirmations
from programmable_private.route_eligibility_current as route
join programmable_private.projector_checkpoints as checkpoint
  on checkpoint.checkpoint_id = route.checkpoint_id
 and checkpoint.chain_id = route.chain_id
 and checkpoint.release_id = route.release_id
 and checkpoint.model_id = route.model_id
 and checkpoint.source_group = route.source_group
 and checkpoint.epoch_id = route.epoch_id
 and checkpoint.pointer_generation = route.pointer_generation
join programmable_private.projector_checkpoint_current as current_checkpoint
  on current_checkpoint.chain_id = checkpoint.chain_id
 and current_checkpoint.release_id = checkpoint.release_id
 and current_checkpoint.model_id = checkpoint.model_id
 and current_checkpoint.source_group = checkpoint.source_group
 and current_checkpoint.projector_version = checkpoint.projector_version
 and current_checkpoint.checkpoint_id = checkpoint.checkpoint_id
 and current_checkpoint.checkpoint_generation =
   checkpoint.checkpoint_generation
 and current_checkpoint.reorg_generation = checkpoint.reorg_generation
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = route.chain_id
 and current_epoch.release_id = route.release_id
 and current_epoch.model_id = route.model_id
 and current_epoch.source_group = route.source_group
 and current_epoch.epoch_id = route.epoch_id
 and current_epoch.generation = route.pointer_generation
join programmable_private.safe_head_observations as observation
  on observation.observation_id = checkpoint.safe_head_observation_id
 and observation.chain_id = checkpoint.chain_id
 and observation.release_id = checkpoint.release_id
 and observation.model_id = checkpoint.model_id
 and observation.source_group = checkpoint.source_group
 and observation.epoch_id = checkpoint.epoch_id
 and observation.pointer_generation = checkpoint.pointer_generation
where observation.safe_block_number >= checkpoint.block_number;

-- Recreate every existing direct route-gated view against the exact boundary.
-- The catalog-driven rewrite keeps the published DTO column lists stable and
-- fails the migration if a direct dependency is left behind.
do $exact_route_views$
declare
  route_view record;
  route_view_definition text;
  rewritten_count integer := 0;
begin
  for route_view in
    select c.relname
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'programmable_private'
      and c.relkind = 'v'
      and c.relname <> 'route_eligibility_current_exact_v1'
      and pg_catalog.pg_get_viewdef(c.oid, true)
        ~ 'programmable_private\.route_eligibility_current([^_A-Za-z0-9]|$)'
  loop
    select pg_catalog.pg_get_viewdef(
      pg_catalog.format('programmable_private.%I', route_view.relname)::regclass,
      true
    ) into route_view_definition;
    route_view_definition := pg_catalog.replace(
      route_view_definition,
      'programmable_private.route_eligibility_current',
      'programmable_private.route_eligibility_current_exact_v1'
    );
    execute pg_catalog.format(
      'create or replace view programmable_private.%I '
      || 'with (security_invoker = false, security_barrier = true) as %s',
      route_view.relname,
      route_view_definition
    );
    rewritten_count := rewritten_count + 1;
  end loop;
  if rewritten_count <> 8 then
    raise exception using
      errcode = '55000',
      message = 'unexpected direct route-gated view inventory',
      detail = pg_catalog.format('rewritten=%s expected=8', rewritten_count);
  end if;
  if exists (
    select 1
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'programmable_private'
      and c.relkind = 'v'
      and c.relname <> 'route_eligibility_current_exact_v1'
      and pg_catalog.pg_get_viewdef(c.oid, true)
        ~ 'programmable_private\.route_eligibility_current([^_A-Za-z0-9]|$)'
  ) then
    raise exception using
      errcode = '55000', message = 'non-exact route-gated view remains';
  end if;
end
$exact_route_views$;

-- parity_records proves DTO equality, but historically did not identify the
-- checkpoint whose DTO was compared.  This immutable binding makes that
-- checkpoint identity explicit and replayable.
create table programmable_private.route_checkpoint_parity_bindings (
  parity_binding_id uuid primary key,
  parity_record_id uuid not null unique
    references programmable_private.parity_records(parity_record_id)
    on delete restrict,
  reconciliation_id uuid not null
    references programmable_private.reconciliation_records(reconciliation_id)
    on delete restrict,
  route_key programmable_private.source_identifier not null,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  checkpoint_id uuid not null
    references programmable_private.projector_checkpoints(checkpoint_id)
    on delete restrict,
  projector_version programmable_private.projector_identifier not null,
  checkpoint_generation bigint not null check (checkpoint_generation > 0),
  reorg_generation bigint not null check (reorg_generation >= 0),
  checkpoint_block_number programmable_private.block_number_value not null,
  checkpoint_block_hash programmable_private.bytes32_value not null,
  binding_commitment programmable_private.bytes32_value not null,
  bound_by_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  bound_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (
    route_key, chain_id, release_id, model_id, source_group,
    epoch_id, pointer_generation, checkpoint_id, parity_record_id
  )
);

alter table programmable_private.route_checkpoint_parity_bindings
  enable row level security;
alter table programmable_private.route_checkpoint_parity_bindings
  force row level security;
create policy migrator_owner_all
  on programmable_private.route_checkpoint_parity_bindings
  for all to programmable_migrator using (true) with check (true);

create trigger reject_immutable_update
before update on programmable_private.route_checkpoint_parity_bindings
for each row execute function
  programmable_private.reject_immutable_mutation();

create function programmable_private.bind_route_checkpoint_parity_v1(
  p_parity_binding_id uuid,
  p_parity_record_id uuid,
  p_checkpoint_id uuid,
  p_binding_commitment bytea,
  p_bound_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  parity programmable_private.parity_records%rowtype;
  reconciliation programmable_private.reconciliation_records%rowtype;
  header programmable_private.run_headers%rowtype;
  route programmable_private.route_eligibility_current_exact_v1%rowtype;
  existing programmable_private.route_checkpoint_parity_bindings%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into parity
  from programmable_private.parity_records
  where parity_record_id = p_parity_record_id;
  select * into reconciliation
  from programmable_private.reconciliation_records
  where reconciliation_id = parity.reconciliation_id;
  select * into header
  from programmable_private.run_headers
  where run_id = reconciliation.run_id
    and run_kind = 'reconciliation';
  select * into route
  from programmable_private.route_eligibility_current_exact_v1
  where route_key = parity.route_key
    and chain_id = reconciliation.chain_id
    and release_id = reconciliation.release_id
    and model_id = reconciliation.model_id
    and source_group = header.source_group
    and epoch_id = reconciliation.epoch_id
    and pointer_generation = reconciliation.pointer_generation
    and checkpoint_id = p_checkpoint_id;
  if parity.parity_record_id is null
     or reconciliation.reconciliation_id is null
     or header.run_id is null
     or route.route_key is null
     or exists (
       select 1 from programmable_private.run_lifecycle_outcomes
       where run_id = header.run_id
     )
     or reconciliation.source_to_block <> route.checkpoint_block_number
     or reconciliation.source_from_block > route.checkpoint_block_number
     or pg_catalog.octet_length(p_binding_commitment) <> 32
     or p_bound_at < parity.compared_at
  then
    raise exception using
      errcode = '23514',
      message = 'parity lacks exact current checkpoint provenance';
  end if;
  select * into existing
  from programmable_private.route_checkpoint_parity_bindings
  where parity_binding_id = p_parity_binding_id
     or parity_record_id = p_parity_record_id;
  if found then
    if existing.parity_binding_id <> p_parity_binding_id
       or existing.parity_record_id <> p_parity_record_id
       or existing.reconciliation_id <> parity.reconciliation_id
       or existing.route_key <> parity.route_key
       or existing.chain_id <> route.chain_id
       or existing.release_id <> route.release_id
       or existing.model_id <> route.model_id
       or existing.source_group <> route.source_group
       or existing.epoch_id <> route.epoch_id
       or existing.pointer_generation <> route.pointer_generation
       or existing.checkpoint_id <> route.checkpoint_id
       or existing.projector_version <> route.projector_version
       or existing.checkpoint_generation <> route.checkpoint_generation
       or existing.reorg_generation <> route.reorg_generation
       or existing.checkpoint_block_number <>
          route.checkpoint_block_number
       or existing.checkpoint_block_hash <> route.checkpoint_block_hash
       or existing.binding_commitment <> p_binding_commitment
       or existing.bound_by_run_id <> header.run_id
       or existing.bound_at <> p_bound_at
    then
      raise exception using
        errcode = '23505', message = 'parity binding replay conflict';
    end if;
    return existing.parity_binding_id;
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'route_checkpoint_parity.bind', p_binding_commitment,
    header.run_id, p_bound_at
  );
  insert into programmable_private.route_checkpoint_parity_bindings (
    parity_binding_id, parity_record_id, reconciliation_id, route_key,
    chain_id, release_id, model_id, source_group, epoch_id,
    pointer_generation, checkpoint_id, projector_version,
    checkpoint_generation, reorg_generation, checkpoint_block_number,
    checkpoint_block_hash, binding_commitment, bound_by_run_id,
    bound_at, audit_id
  ) values (
    p_parity_binding_id, p_parity_record_id, parity.reconciliation_id,
    parity.route_key, route.chain_id, route.release_id, route.model_id,
    route.source_group, route.epoch_id, route.pointer_generation,
    route.checkpoint_id, route.projector_version,
    route.checkpoint_generation, route.reorg_generation,
    route.checkpoint_block_number, route.checkpoint_block_hash,
    p_binding_commitment::programmable_private.bytes32_value,
    header.run_id, p_bound_at, created_audit_id
  );
  return p_parity_binding_id;
end
$function$;

create view programmable_private.route_snapshot_readiness_v1
with (security_invoker = false, security_barrier = true)
as
select
  route.route_key,
  route.chain_id,
  route.release_id,
  route.model_id,
  route.source_group,
  route.status as route_status,
  route.status as eligibility_status,
  route.route_mode,
  route.history_id as route_history_id,
  route.changed_at as route_changed_at,
  route.projector_version,
  route.epoch_id,
  route.pointer_generation,
  route.checkpoint_id,
  route.checkpoint_generation,
  route.reorg_generation,
  route.checkpoint_block_number,
  route.checkpoint_block_hash,
  route.checkpoint_created_at,
  route.safe_block_number,
  route.checkpoint_confirmations,
  case
    when parity.parity_record_id is null then 'missing'
    when not parity.is_match or parity.mismatch_count > 0 then 'mismatch'
    when parity.parity_binding_id is null then 'stale'
    when parity.checkpoint_id <> route.checkpoint_id
      or parity.projector_version <> route.projector_version
      or parity.checkpoint_generation <> route.checkpoint_generation
      or parity.reorg_generation <> route.reorg_generation
      or parity.checkpoint_block_number <> route.checkpoint_block_number
      or parity.checkpoint_block_hash <> route.checkpoint_block_hash
      then 'stale'
    when parity.run_status is null then 'pending'
    when parity.run_status <> 'succeeded' then 'stale'
    else 'current'
  end::text as parity_status,
  parity.parity_record_id,
  parity.reconciliation_id,
  parity.is_match as parity_is_match,
  parity.legacy_dto_hash,
  parity.indexed_dto_hash,
  parity.compared_at as parity_compared_at,
  parity.resolved_at as parity_resolved_at,
  parity.source_from_block as parity_source_from_block,
  parity.source_to_block as parity_source_to_block,
  parity.evidence_commitment as parity_evidence_commitment,
  parity.mismatch_count as reconciliation_mismatch_count,
  parity.recorded_at as reconciliation_recorded_at,
  parity.reconciliation_resolved_at,
  parity.checkpoint_id as parity_checkpoint_id,
  parity.checkpoint_generation as parity_checkpoint_generation,
  parity.reorg_generation as parity_reorg_generation,
  parity.checkpoint_block_number as parity_block_number,
  parity.checkpoint_block_hash as parity_block_hash,
  parity.parity_binding_id,
  parity.binding_commitment as parity_binding_commitment,
  parity.bound_at as parity_bound_at
from programmable_private.route_eligibility_current_exact_v1 as route
left join lateral (
  select
    record.parity_record_id,
    record.reconciliation_id,
    record.is_match,
    record.legacy_dto_hash,
    record.indexed_dto_hash,
    record.compared_at,
    record.resolved_at,
    reconciliation.source_from_block,
    reconciliation.source_to_block,
    reconciliation.evidence_commitment,
    reconciliation.mismatch_count,
    reconciliation.recorded_at,
    reconciliation.resolved_at as reconciliation_resolved_at,
    binding.parity_binding_id,
    binding.checkpoint_id,
    binding.projector_version,
    binding.checkpoint_generation,
    binding.reorg_generation,
    binding.checkpoint_block_number,
    binding.checkpoint_block_hash,
    binding.binding_commitment,
    binding.bound_at,
    outcome.status as run_status
  from programmable_private.parity_records as record
  join programmable_private.reconciliation_records as reconciliation
    on reconciliation.reconciliation_id = record.reconciliation_id
   and reconciliation.chain_id = route.chain_id
   and reconciliation.release_id = route.release_id
   and reconciliation.model_id = route.model_id
   and reconciliation.epoch_id = route.epoch_id
   and reconciliation.pointer_generation = route.pointer_generation
  join programmable_private.run_headers as run
    on run.run_id = reconciliation.run_id
   and run.run_kind = 'reconciliation'
   and run.source_group = route.source_group
  left join programmable_private.route_checkpoint_parity_bindings as binding
    on binding.parity_record_id = record.parity_record_id
   and binding.reconciliation_id = reconciliation.reconciliation_id
   and binding.route_key = record.route_key
  left join programmable_private.run_lifecycle_outcomes as outcome
    on outcome.run_id = run.run_id
  where record.route_key = route.route_key
  order by record.compared_at desc, record.parity_record_id desc
  limit 1
) as parity on true;

-- Consolidated token DTO evidence.  Unsupported or not-yet-materialized
-- values remain NULL and payload_complete remains false; API adapters must not
-- substitute estimates.  This lets readiness and payload completeness fail
-- independently while keeping every exposed value tied to the exact route,
-- projection publication and source occurrence.
create view programmable_private.route_token_projections_v1
with (security_invoker = false, security_barrier = true)
as
select
  readiness.route_key,
  readiness.chain_id,
  readiness.release_id,
  readiness.model_id,
  readiness.source_group,
  readiness.route_status,
  readiness.route_mode,
  readiness.parity_status,
  readiness.parity_record_id,
  readiness.reconciliation_id,
  readiness.parity_evidence_commitment,
  readiness.parity_binding_id,
  readiness.parity_binding_commitment,
  readiness.projector_version,
  readiness.epoch_id,
  readiness.pointer_generation,
  readiness.checkpoint_id,
  readiness.checkpoint_generation,
  readiness.reorg_generation,
  readiness.checkpoint_block_number,
  readiness.checkpoint_block_hash,
  readiness.checkpoint_created_at,
  readiness.safe_block_number,
  readiness.checkpoint_confirmations,
  launch.projection_run_id,
  publication_audit.input_commitment as publication_commitment,
  launch.promoted_block_number,
  launch.promoted_block_hash,
  source_occurrence.block_number as launch_source_block_number,
  source_occurrence.block_hash as launch_source_block_hash,
  source_occurrence.block_global_log_index::bigint
    as launch_source_block_global_log_index,
  launch.launch_block_timestamp,
  launch.launch_transaction_index,
  launch.launch_receipt_log_ordinal,
  launch.token,
  launch.creator,
  launch.launch_transaction_hash,
  launch.pool_id,
  launch.reward_vault,
  launch.launch_hash,
  launch.token_name,
  launch.token_symbol,
  launch.total_supply,
  launch.currency0,
  launch.currency1,
  launch.hook,
  launch.quote_asset,
  launch.pool_key_fee,
  launch.tick_spacing,
  launch.buy_swap_fee_bps,
  launch.sell_swap_fee_bps,
  launch.buy_creator_fee_bps,
  launch.sell_creator_fee_bps,
  launch.creator_fee_bps,
  launch.launcher_fee_bps,
  launch.transfer_tax_bps,
  launch.lp_fee_pips,
  launch.project_name,
  launch.project_description,
  launch.project_logo_reference,
  launch.project_metadata_revision,
  launch.project_metadata_created_at,
  launch.project_links,
  launch.position_recipient,
  launch.position_token_id,
  launch.token_liquidity_amount,
  launch.locked_token_dust,
  launch.initial_sqrt_price_x96,
  launch.initial_tick,
  launch.tick_lower,
  launch.tick_upper,
  case
    when source_occurrence.decoded_payload ->> 'protocolFeePips'
      ~ '^(0|[1-9][0-9]{0,6})$'
    then (source_occurrence.decoded_payload ->> 'protocolFeePips')::bigint
    else null
  end as protocol_fee_pips,
  source_occurrence.decoded_payload -> 'extraData' as metadata_extra_data,
  market.market_snapshot_id,
  market.block_number as market_block_number,
  market.block_hash as market_block_hash,
  market.sqrt_price_x96 as market_sqrt_price_x96,
  market.liquidity as market_liquidity,
  market.tick as market_tick,
  market.token0_price as market_token0_price,
  market.token1_price as market_token1_price,
  market.tvl_token0 as market_tvl_token0,
  market.tvl_token1 as market_tvl_token1,
  market.tvl_usd as market_tvl_usd,
  market.market_volume_token0,
  market.market_volume_token1,
  market.market_volume_usd,
  case
    when launch.currency0 = pg_catalog.decode(pg_catalog.repeat('00', 20), 'hex')
      then market.market_volume_token0
    when launch.currency1 = pg_catalog.decode(pg_catalog.repeat('00', 20), 'hex')
      then market.market_volume_token1
    else null
  end as market_volume_native,
  market.transaction_count as market_swap_count,
  fee_total.gross_total as accrued_gross_total,
  fee_total.creator_fee_total as accrued_creator_total,
  fee_total.launcher_fee_total as accrued_launcher_total,
  creator_balance.claimable_accrued as creator_claimable_accrued,
  launch.quote_asset as stock_quote_address,
  source_occurrence.decoded_payload ->> 'quoteSymbol'
    as stock_quote_symbol,
  source_occurrence.decoded_payload ->> 'quoteName' as stock_quote_name,
  case
    when source_occurrence.decoded_payload ->> 'quoteDecimals'
      ~ '^(0|[1-9][0-9]?)$'
      and (source_occurrence.decoded_payload ->> 'quoteDecimals')::integer
        between 0 and 36
    then (source_occurrence.decoded_payload ->> 'quoteDecimals')::integer
    else null
  end as stock_quote_decimals,
  source_occurrence.decoded_payload ->> 'quoteCurrency'
    as stock_quote_currency,
  case
    when launch.quote_asset = launch.currency0 then 'currency0'
    when launch.quote_asset = launch.currency1 then 'currency1'
    else null
  end as stock_quote_currency_side,
  case
    when launch.quote_asset = launch.currency0
      then market.market_volume_token0
    when launch.quote_asset = launch.currency1
      then market.market_volume_token1
    else null
  end as stock_quote_volume_total,
  fee_total.gross_total as stock_quote_accrued_total,
  initial_buy.custody_projection_id as initial_buy_custody_projection_id,
  initial_buy.custody_address as initial_buy_custody_address,
  initial_buy.custody_mode as initial_buy_custody_mode,
  initial_buy.duration_days as initial_buy_duration_days,
  initial_buy.cliff_days as initial_buy_cliff_days,
  initial_buy.initial_buy_amount,
  case
    when source_occurrence.decoded_payload ->> 'initialBuyNativeWei'
      ~ '^(0|[1-9][0-9]{0,77})$'
    then source_occurrence.decoded_payload ->> 'initialBuyNativeWei'
  end as initial_buy_native_wei,
  case
    when source_occurrence.decoded_payload ->> 'initialBuyQuoteRaw'
      ~ '^(0|[1-9][0-9]{0,77})$'
    then source_occurrence.decoded_payload ->> 'initialBuyQuoteRaw'
  end as initial_buy_quote_raw,
  (
    readiness.route_status = 'eligible'
    and readiness.route_mode = 'indexed'
    and readiness.parity_status = 'current'
    and publication_audit.audit_id is not null
    and source_occurrence.occurrence_id is not null
    and launch.position_token_id is not null
    and market.market_snapshot_id is not null
    and market.market_volume_usd is not null
    and market.transaction_count between 0 and 9007199254740991
    and source_occurrence.decoded_payload ->> 'protocolFeePips'
      ~ '^(0|[1-9][0-9]{0,6})$'
    and launch.buy_swap_fee_bps is not null
    and launch.sell_swap_fee_bps is not null
    and launch.buy_creator_fee_bps is not null
    and launch.sell_creator_fee_bps is not null
    and launch.launcher_fee_bps is not null
    and launch.transfer_tax_bps is not null
    and launch.lp_fee_pips is not null
    and (
      readiness.model_id not like 'stock-paired%'
      or (
        launch.quote_asset is not null
        and source_occurrence.decoded_payload ->> 'quoteSymbol' is not null
        and source_occurrence.decoded_payload ->> 'quoteName' is not null
        and source_occurrence.decoded_payload ->> 'quoteDecimals'
          ~ '^(0|[1-9][0-9]?)$'
        and source_occurrence.decoded_payload ->> 'quoteCurrency' is not null
      )
    )
  ) as payload_complete
from programmable_private.launch_by_token_v2 as launch
join programmable_private.route_snapshot_readiness_v1 as readiness
  on readiness.route_key = 'explore-token'
 and readiness.chain_id = launch.chain_id
 and readiness.release_id = launch.release_id
 and readiness.model_id = launch.model_id
 and readiness.source_group = launch.source_group
 and readiness.epoch_id = launch.epoch_id
 and readiness.pointer_generation = launch.pointer_generation
join programmable_private.projection_publications as publication
  on publication.run_id = launch.projection_run_id
 and publication.epoch_id = launch.epoch_id
 and publication.pointer_generation = launch.pointer_generation
 and publication.target_block_number = launch.promoted_block_number
 and publication.target_block_hash = launch.promoted_block_hash
join programmable_private.mutation_audits as publication_audit
  on publication_audit.audit_id = publication.audit_id
join programmable_private.current_launch_projections_v1 as launch_projection
  on launch_projection.projection_run_id = launch.projection_run_id
 and launch_projection.chain_id = launch.chain_id
 and launch_projection.release_id = launch.release_id
 and launch_projection.model_id = launch.model_id
 and launch_projection.epoch_id = launch.epoch_id
 and launch_projection.pointer_generation = launch.pointer_generation
 and launch_projection.token = launch.token
join programmable_private.chain_event_materialized_occurrences_v1
  as source_occurrence
  on source_occurrence.occurrence_id =
    launch_projection.last_source_occurrence_id
 and source_occurrence.logical_event_id =
    launch_projection.last_source_logical_event_id
 and source_occurrence.block_hash =
    launch_projection.last_source_occurrence_block_hash
 and source_occurrence.chain_id = launch.chain_id
 and source_occurrence.release_id = launch.release_id
 and source_occurrence.model_id = launch.model_id
 and source_occurrence.source_group = launch.source_group
 and source_occurrence.epoch_id = launch.epoch_id
 and source_occurrence.pointer_generation = launch.pointer_generation
left join lateral (
  select snapshot.*
  from programmable_private.market_snapshots_v2 as snapshot
  where snapshot.chain_id = launch.chain_id
    and snapshot.release_id = launch.release_id
    and snapshot.model_id = launch.model_id
    and snapshot.token = launch.token
    and snapshot.pool_id = launch.pool_id
    and snapshot.block_number <= readiness.checkpoint_block_number
  order by snapshot.block_number desc, snapshot.market_snapshot_id desc
  limit 1
) as market on true
left join programmable_private.current_pool_fee_totals_v1 as fee_total
  on fee_total.chain_id = launch.chain_id
 and fee_total.release_id = launch.release_id
 and fee_total.model_id = launch.model_id
 and fee_total.epoch_id = launch.epoch_id
 and fee_total.pointer_generation = launch.pointer_generation
 and fee_total.pool_id = launch.pool_id
 and fee_total.quote_asset is not distinct from launch.quote_asset
left join programmable_private.current_account_reward_balances_v1
  as creator_balance
  on creator_balance.chain_id = launch.chain_id
 and creator_balance.release_id = launch.release_id
 and creator_balance.model_id = launch.model_id
 and creator_balance.epoch_id = launch.epoch_id
 and creator_balance.pointer_generation = launch.pointer_generation
 and creator_balance.account = launch.creator
 and creator_balance.vault = launch.reward_vault
left join lateral (
  select
    custody.custody_projection_id,
    custody.custody_address,
    custody.custody_mode,
    custody.duration_days,
    custody.cliff_days,
    pg_catalog.sum(vesting.amount) as initial_buy_amount
  from programmable_private.initial_buy_custody_projections as custody
  left join programmable_private.initial_buy_vesting_projections as vesting
    on vesting.custody_projection_id = custody.custody_projection_id
   and vesting.projection_run_id = custody.projection_run_id
   and vesting.chain_id = custody.chain_id
   and vesting.release_id = custody.release_id
   and vesting.model_id = custody.model_id
   and vesting.epoch_id = custody.epoch_id
   and vesting.pointer_generation = custody.pointer_generation
  where custody.launch_projection_id = launch_projection.launch_projection_id
    and custody.projection_run_id = launch_projection.projection_run_id
  group by custody.custody_projection_id, custody.custody_address,
    custody.custody_mode, custody.duration_days, custody.cliff_days
) as initial_buy on true;

-- Public DTO construction is centralized so list, detail, creator and feed
-- readers cannot drift in address formatting, fee semantics or omission
-- rules.  Optional legacy keys are absent unless their normalized evidence is
-- present; json nulls are never used to make an incomplete projection appear
-- complete.
create function programmable_private.build_public_launcher_token_v1(
  p_row jsonb
)
returns jsonb
language sql
stable
strict
security definer
set search_path = ''
as $function$
  with normalized as (
    select
      p_row as row_value,
      case
        when p_row ->> 'quote_asset' =
          '\\x0000000000000000000000000000000000000000'
          and p_row ->> 'token' = p_row ->> 'currency0'
          then (p_row ->> 'market_token0_price')::numeric
        when p_row ->> 'quote_asset' =
          '\\x0000000000000000000000000000000000000000'
          and p_row ->> 'token' = p_row ->> 'currency1'
          then (p_row ->> 'market_token1_price')::numeric
        else null
      end as token_price_native,
      case
        when p_row ->> 'quote_asset' is not null
          and p_row ->> 'quote_asset' <>
            '\\x0000000000000000000000000000000000000000'
          and p_row ->> 'token' = p_row ->> 'currency0'
          then (p_row ->> 'market_token0_price')::numeric
        when p_row ->> 'quote_asset' is not null
          and p_row ->> 'quote_asset' <>
            '\\x0000000000000000000000000000000000000000'
          and p_row ->> 'token' = p_row ->> 'currency1'
          then (p_row ->> 'market_token1_price')::numeric
        else null
      end as token_price_quote,
      case
        when p_row ->> 'currency0' =
          '\\x0000000000000000000000000000000000000000'
          then (p_row ->> 'market_volume_token0')::numeric
        when p_row ->> 'currency1' =
          '\\x0000000000000000000000000000000000000000'
          then (p_row ->> 'market_volume_token1')::numeric
        else null
      end as gross_volume_native,
      case
        when p_row ->> 'quote_asset' = p_row ->> 'currency0'
          then (p_row ->> 'market_volume_token0')::numeric
        when p_row ->> 'quote_asset' = p_row ->> 'currency1'
          then (p_row ->> 'market_volume_token1')::numeric
        else null
      end as gross_volume_quote
  ), derived as (
    select normalized.*,
      case when token_price_native is not null then
        pg_catalog.trunc(token_price_native * 1000000000000000000)::numeric
      end as token_price_native_wei,
      case when token_price_quote is not null then
        pg_catalog.trunc(token_price_quote * 1000000000000000000)::numeric
      end as token_price_quote_wad,
      case when token_price_native is not null then
        pg_catalog.trunc(
          (p_row ->> 'total_supply')::numeric * token_price_native
        )::numeric
      end as market_cap_native_wei,
      case when token_price_quote is not null then
        pg_catalog.trunc(
          (p_row ->> 'total_supply')::numeric * token_price_quote
        )::numeric
      end as market_cap_quote_wad
    from normalized
  ), enriched as (
    select derived.*,
      case
        when market_cap_native_wei is not null
          and p_row ->> 'global_answer' is not null
          and p_row ->> 'global_decimals' is not null
        then pg_catalog.trunc(
          market_cap_native_wei * (p_row ->> 'global_answer')::numeric
          / pg_catalog.power(10::numeric,
              (p_row ->> 'global_decimals')::integer)
        )::numeric
      end as market_cap_usd_wad
    from derived
  )
  select pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'id', (p_row ->> 'chain_id') || ':0x'
        || pg_catalog.substr(p_row ->> 'token', 3),
      'name', p_row ->> 'token_name',
      'symbol', p_row ->> 'token_symbol',
      'tokenAddress', '0x' || pg_catalog.substr(p_row ->> 'token', 3),
      'hookAddress', '0x' || pg_catalog.substr(p_row ->> 'hook', 3),
      'poolId', '0x' || pg_catalog.substr(p_row ->> 'pool_id', 3),
      'totalSwapFeeBps', greatest(
        (p_row ->> 'buy_swap_fee_bps')::integer,
        (p_row ->> 'sell_swap_fee_bps')::integer
      ),
      'launchedAt', pg_catalog.to_char(
        (p_row ->> 'launch_block_timestamp')::timestamptz
          at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'liquidityPath', 'meme',
      'description', p_row ->> 'project_description',
      'imageUrl', p_row ->> 'project_logo_reference',
      'links', case
        when pg_catalog.jsonb_typeof(p_row -> 'project_links') = 'array'
          and pg_catalog.jsonb_array_length(p_row -> 'project_links') > 0
        then (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'kind', link ->> 'kind', 'url', link ->> 'url'
            ) order by (link ->> 'displayOrder')::integer, link ->> 'kind'
          )
          from pg_catalog.jsonb_array_elements(
            p_row -> 'project_links'
          ) as link
          where link ->> 'kind' in ('website', 'x', 'telegram')
        )
      end,
      'creatorAddress', '0x' || pg_catalog.substr(
        p_row ->> 'creator', 3
      ),
      'positionRecipient', case
        when p_row ->> 'position_recipient' is not null
        then '0x' || pg_catalog.substr(p_row ->> 'position_recipient', 3)
      end,
      'positionTokenId', p_row ->> 'position_token_id',
      'launchHash', '0x' || pg_catalog.substr(p_row ->> 'launch_hash', 3),
      'launchBlockNumber', p_row ->> 'launch_source_block_number',
      'launchTransactionHash', '0x' || pg_catalog.substr(
        p_row ->> 'launch_transaction_hash', 3
      ),
      'launchTransactionIndex',
        (p_row ->> 'launch_transaction_index')::integer,
      'launchLogIndex',
        (p_row ->> 'launch_source_block_global_log_index')::bigint,
      'totalSupply', (
        (p_row ->> 'total_supply')::numeric / 1000000000000000000
      )::text,
      'totalSupplyRaw', p_row ->> 'total_supply',
      'tokenDecimals', 18,
      'tokenLiquidityAmountRaw', p_row ->> 'token_liquidity_amount',
      'lockedTokenDustRaw', p_row ->> 'locked_token_dust'
    ) || pg_catalog.jsonb_build_object(
      'tokenPriceEth', token_price_native::text,
      'tokenPriceEthWei', token_price_native_wei::text,
      'marketCapEth',
        (market_cap_native_wei / 1000000000000000000)::text,
      'marketCapEthWei', market_cap_native_wei::text,
      'indexedMarketCapEth',
        (market_cap_native_wei / 1000000000000000000)::text,
      'indexedMarketCapEthWei', market_cap_native_wei::text,
      'indexedMarketCapUsdWad', market_cap_usd_wad::text,
      'indexedValuationBlockNumber', p_row ->> 'market_block_number',
      'grossVolumeEth', gross_volume_native::text,
      'grossVolumeWei', pg_catalog.trunc(
        gross_volume_native * 1000000000000000000
      )::text,
      'creatorFeesGeneratedEth', (
        (p_row ->> 'accrued_creator_total')::numeric
          / 1000000000000000000
      )::text,
      'creatorFeesGeneratedWei', p_row ->> 'accrued_creator_total',
      'launcherFeesGeneratedEth', (
        (p_row ->> 'accrued_launcher_total')::numeric
          / 1000000000000000000
      )::text,
      'launcherFeesGeneratedWei', p_row ->> 'accrued_launcher_total',
      'creatorFeesAccruedEth', (
        (p_row ->> 'accrued_creator_total')::numeric
          / 1000000000000000000
      )::text,
      'creatorFeesAccruedWei', p_row ->> 'accrued_creator_total',
      'swapCount', (p_row ->> 'market_swap_count')::bigint,
      'currentTick', (p_row ->> 'market_tick')::integer,
      'initialTick', (p_row ->> 'initial_tick')::integer,
      'tickLower', (p_row ->> 'tick_lower')::integer,
      'tickUpper', (p_row ->> 'tick_upper')::integer,
      'activeLiquidity', p_row ->> 'market_liquidity',
      'protocolFeePips', (p_row ->> 'protocol_fee_pips')::bigint,
      'lpFeePips', p_row ->> 'lp_fee_pips',
      'buyHookFeeBps', (p_row ->> 'buy_swap_fee_bps')::integer,
      'sellHookFeeBps', (p_row ->> 'sell_swap_fee_bps')::integer,
      'creatorFeeBps', (p_row ->> 'creator_fee_bps')::integer,
      'buyCreatorFeeBps', (p_row ->> 'buy_creator_fee_bps')::integer,
      'sellCreatorFeeBps', (p_row ->> 'sell_creator_fee_bps')::integer,
      'programmableFeeBps', (p_row ->> 'launcher_fee_bps')::integer,
      'launcherFeeBps', (p_row ->> 'launcher_fee_bps')::integer,
      'transferTaxBps', (p_row ->> 'transfer_tax_bps')::integer,
      'launchModel', case
        when p_row ->> 'model_id' like 'stock-paired%' then 'stock-paired'
        else 'classic'
      end,
      'launchModelVersion', p_row ->> 'release_id',
      'rewardVaultAddress', case
        when p_row ->> 'reward_vault' is not null
        then '0x' || pg_catalog.substr(p_row ->> 'reward_vault', 3)
      end,
      'metadataExtraData', p_row -> 'metadata_extra_data'
    ) || pg_catalog.jsonb_build_object(
      'quoteAssetAddress', case
        when p_row ->> 'stock_quote_address' is not null
        then '0x' || pg_catalog.substr(p_row ->> 'stock_quote_address', 3)
      end,
      'quoteAssetSymbol', p_row ->> 'stock_quote_symbol',
      'quoteAssetName', p_row ->> 'stock_quote_name',
      'quoteIsCurrency0', case
        when p_row ->> 'stock_quote_currency_side' = 'currency0' then true
        when p_row ->> 'stock_quote_currency_side' = 'currency1' then false
      end,
      'tokenPriceQuote', token_price_quote::text,
      'tokenPriceQuoteWad', token_price_quote_wad::text,
      'marketCapQuote',
        (market_cap_quote_wad / 1000000000000000000)::text,
      'marketCapQuoteWad', market_cap_quote_wad::text,
      'grossVolumeQuote', gross_volume_quote::text,
      'grossVolumeQuoteRaw', pg_catalog.trunc(
        gross_volume_quote * 1000000000000000000
      )::text,
      'creatorFeesGeneratedQuote', (
        (p_row ->> 'stock_quote_accrued_total')::numeric
          / pg_catalog.power(
            10::numeric, (p_row ->> 'stock_quote_decimals')::integer
          )
      )::text,
      'creatorFeesGeneratedQuoteRaw', p_row ->> 'stock_quote_accrued_total',
      'programmableFeesGeneratedQuote', (
        (p_row ->> 'accrued_launcher_total')::numeric
          / pg_catalog.power(
            10::numeric, (p_row ->> 'stock_quote_decimals')::integer
          )
      )::text,
      'programmableFeesGeneratedQuoteRaw', p_row ->> 'accrued_launcher_total',
      'creatorFeesAccruedQuote', (
        (p_row ->> 'stock_quote_accrued_total')::numeric
          / pg_catalog.power(
            10::numeric, (p_row ->> 'stock_quote_decimals')::integer
          )
      )::text,
      'creatorFeesAccruedQuoteRaw', p_row ->> 'stock_quote_accrued_total',
      'fdvUsdWad', market_cap_usd_wad::text
    )
  )
  from enriched
$function$;

-- The detail payload is the strictest token materialization.  It returns no
-- row until the exact explore-token checkpoint has current matching parity,
-- the projection publication is bound, the launch/pool/liquidity sources are
-- canonical, market data is covered by the checkpoint and Stock-Paired rows
-- also carry their dynamic asset and initial-buy bindings.
create view programmable_private.public_explore_token_v1
with (security_invoker = false, security_barrier = true)
as
select
  token.route_key,
  token.chain_id,
  token.release_id,
  token.model_id,
  token.source_group,
  token.projector_version,
  token.epoch_id,
  token.pointer_generation,
  token.checkpoint_id,
  token.checkpoint_generation,
  token.reorg_generation,
  token.checkpoint_block_number,
  token.checkpoint_block_hash,
  token.safe_block_number,
  token.checkpoint_confirmations,
  token.parity_status,
  token.parity_record_id,
  token.reconciliation_id,
  token.parity_evidence_commitment,
  token.parity_binding_id,
  token.parity_binding_commitment,
  token.projection_run_id,
  token.publication_commitment,
  200::integer as http_status,
  pg_catalog.jsonb_build_object(
    'status', 'ready',
    'token', programmable_private.build_public_launcher_token_v1(
      pg_catalog.to_jsonb(token.*)
      || pg_catalog.jsonb_build_object(
        'global_answer', global_snapshot.answer,
        'global_decimals', global_snapshot.decimals
      )
    ),
    'snapshot', pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'chainId', token.chain_id,
        'blockNumber', token.checkpoint_block_number::text,
        'blockHash', '0x' || pg_catalog.encode(
          token.checkpoint_block_hash, 'hex'
        ),
        'confirmations', token.checkpoint_confirmations,
        'ethUsdQuote', case
          when global_snapshot.global_market_snapshot_id is not null then
            pg_catalog.jsonb_build_object(
              'feedAddress', '0x' || pg_catalog.encode(
                global_snapshot.feed_address, 'hex'
              ),
              'roundId', global_snapshot.feed_round_id::text,
              'answer', global_snapshot.answer::text,
              'decimals', global_snapshot.decimals,
              'updatedAt', pg_catalog.to_char(
                global_snapshot.feed_updated_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              )
            )
        end
      )
    )
  ) as payload,
  true as payload_complete
from programmable_private.route_token_projections_v1 as token
join programmable_private.market_snapshots_v2 as market
  on market.market_snapshot_id = token.market_snapshot_id
 and market.block_number <= token.checkpoint_block_number
join programmable_private.reconciliation_records as market_reconciliation
  on market_reconciliation.reconciliation_id = market.reconciliation_id
 and market_reconciliation.source_to_block = token.checkpoint_block_number
 and market_reconciliation.mismatch_count = 0
join programmable_private.global_eth_usd_snapshots_v1 as global_snapshot
  on global_snapshot.global_market_snapshot_id =
    market.global_market_snapshot_id
left join programmable_private.dynamic_source_release_asset_bindings
  as stock_binding
  on stock_binding.launch_occurrence_id = (
    select launch_projection.last_source_occurrence_id
    from programmable_private.current_launch_projections_v1
      as launch_projection
    where launch_projection.projection_run_id = token.projection_run_id
      and launch_projection.token = token.token
  )
 and stock_binding.chain_id = token.chain_id
 and stock_binding.release_id = token.release_id
 and stock_binding.model_id = token.model_id
 and stock_binding.source_group = token.source_group
 and stock_binding.epoch_id = token.epoch_id
 and stock_binding.pointer_generation = token.pointer_generation
 and stock_binding.token = token.token
 and stock_binding.pool_id = token.pool_id
 and stock_binding.hook = token.hook
 and stock_binding.quote_asset = token.quote_asset
where token.route_status = 'eligible'
  and token.route_mode = 'indexed'
  and token.parity_status = 'current'
  and token.payload_complete
  and (
    token.model_id not like 'stock-paired%'
    or (
      stock_binding.dynamic_source_release_asset_binding_id is not null
      and token.initial_buy_custody_projection_id is not null
      and token.initial_buy_amount is not null
    )
  );

-- The application adapter owns all presentation formatting and
-- release-specific Legacy DTO shape.  Replace the transient serializer above
-- with the frozen raw IndexedRouteEnvelopeV2 contract; SQL supplies only
-- atomic values and immutable evidence.
drop view programmable_private.public_explore_token_v1;
drop function programmable_private.build_public_launcher_token_v1(jsonb);

create function programmable_private.build_indexed_token_projection_v2(
  p_row jsonb
)
returns jsonb
language sql
stable
strict
security definer
set search_path = ''
as $function$
  with values as (
    select
      case
        when p_row ->> 'token' = p_row ->> 'currency0'
          then (p_row ->> 'market_token0_price')::numeric
        when p_row ->> 'token' = p_row ->> 'currency1'
          then (p_row ->> 'market_token1_price')::numeric
      end as token_price_quote,
      case
        when p_row ->> 'quote_asset' = p_row ->> 'currency0'
          then (p_row ->> 'market_volume_token0')::numeric
        when p_row ->> 'quote_asset' = p_row ->> 'currency1'
          then (p_row ->> 'market_volume_token1')::numeric
      end as volume_quote,
      case
        when p_row ->> 'stock_quote_decimals'
          ~ '^(0|[1-9][0-9]?)$'
        then (p_row ->> 'stock_quote_decimals')::integer
      end as quote_decimals,
      p_row ->> 'stock_quote_address_hex' =
        '0x0000000000000000000000000000000000000000'
        as is_native_quote
  ), atomic as (
    select values.*,
      case when token_price_quote is not null then
        pg_catalog.trunc(
          token_price_quote * 1000000000000000000
        )::numeric
      end as token_price_quote_wad,
      case when token_price_quote is not null then
        pg_catalog.trunc(
          (p_row ->> 'total_supply')::numeric * token_price_quote
        )::numeric
      end as market_cap_quote_wad,
      case when volume_quote is not null and quote_decimals is not null then
        pg_catalog.trunc(
          volume_quote * pg_catalog.power(10::numeric, quote_decimals)
        )::numeric
      end as volume_quote_raw,
      case when is_native_quote and token_price_quote is not null then
        pg_catalog.trunc(
          token_price_quote * 1000000000000000000
        )::numeric
      end as token_price_native_wei,
      case when is_native_quote and token_price_quote is not null then
        pg_catalog.trunc(
          (p_row ->> 'total_supply')::numeric * token_price_quote
        )::numeric
      end as market_cap_native_wei,
      case when is_native_quote
        and p_row ->> 'market_volume_native' is not null
      then pg_catalog.trunc(
        (p_row ->> 'market_volume_native')::numeric
          * 1000000000000000000
      )::numeric end as volume_native_wei
    from values
  )
  select pg_catalog.jsonb_build_object(
    'source', pg_catalog.jsonb_build_object(
      'routeKey', p_row ->> 'route_key',
      'chainId', (p_row ->> 'chain_id')::bigint,
      'releaseVersion', p_row ->> 'release_id',
      'modelVersion', p_row ->> 'model_id',
      'sourceGroup', p_row ->> 'source_group',
      'projectorVersion', p_row ->> 'projector_version',
      'epochId', p_row ->> 'epoch_id',
      'pointerGeneration', p_row ->> 'pointer_generation',
      'checkpointId', p_row ->> 'checkpoint_id',
      'checkpointGeneration', p_row ->> 'checkpoint_generation',
      'reorgGeneration', p_row ->> 'reorg_generation',
      'checkpointBlockNumber', p_row ->> 'checkpoint_block_number',
      'checkpointBlockHash', p_row ->> 'checkpoint_block_hash_hex',
      'snapshotCommitment', p_row ->> 'snapshot_commitment_hex',
      'projectionRunId', p_row ->> 'projection_run_id',
      'publicationCommitment', p_row ->> 'publication_commitment_hex',
      'promotedBlockNumber', p_row ->> 'promoted_block_number',
      'promotedBlockHash', p_row ->> 'promoted_block_hash_hex'
    ),
    'tokenAddress', p_row ->> 'token_hex',
    'hookAddress', p_row ->> 'hook_hex',
    'poolId', p_row ->> 'pool_id_hex',
    'creatorAddress', p_row ->> 'creator_hex',
    'positionRecipient', p_row ->> 'position_recipient_hex',
    'positionTokenId', p_row ->> 'position_token_id',
    'rewardVaultAddress', p_row ->> 'reward_vault_hex',
    'launchHash', p_row ->> 'launch_hash_hex',
    'launchBlockNumber', p_row ->> 'launch_source_block_number',
    'launchTransactionHash', p_row ->> 'launch_transaction_hash_hex',
    'launchTransactionIndex',
      (p_row ->> 'launch_transaction_index')::bigint,
    'launchLogIndex',
      (p_row ->> 'launch_receipt_log_ordinal')::bigint,
    'launchedAt', p_row ->> 'launch_timestamp_iso',
    'name', p_row ->> 'token_name',
    'symbol', p_row ->> 'token_symbol',
    -- All five allowlisted public releases bind UERC20's immutable 18-decimal
    -- token standard. Unsupported release/model pairs never reach a public
    -- envelope.
    'decimals', 18,
    'totalSupplyRaw', p_row ->> 'total_supply',
    'metadata', case
      when p_row ->> 'project_metadata_revision' is not null
        and p_row ->> 'project_metadata_created_at' is not null
        and p_row ->> 'metadata_extra_data_hex'
          ~ '^0x([0-9a-f][0-9a-f])*$'
      then pg_catalog.jsonb_build_object(
        'revision', p_row ->> 'project_metadata_revision',
        'createdAt', p_row ->> 'project_metadata_created_at_iso',
        'description', p_row -> 'project_description',
        'imageUrl', p_row -> 'project_logo_reference',
        'links', coalesce(p_row -> 'project_links', '[]'::jsonb),
        'extraData', p_row ->> 'metadata_extra_data_hex'
      )
      else null
    end,
    'liquidity', pg_catalog.jsonb_build_object(
      'tokenLiquidityAmountRaw', p_row ->> 'token_liquidity_amount',
      'lockedTokenDustRaw', p_row ->> 'locked_token_dust',
      'currentTick', p_row -> 'market_tick',
      'initialTick', p_row -> 'initial_tick',
      'tickLower', p_row -> 'tick_lower',
      'tickUpper', p_row -> 'tick_upper',
      'activeLiquidity', p_row ->> 'market_liquidity'
    ),
    'fees', pg_catalog.jsonb_build_object(
      'totalSwapFeeBps', greatest(
        (p_row ->> 'buy_swap_fee_bps')::integer,
        (p_row ->> 'sell_swap_fee_bps')::integer
      ),
      'buySwapFeeBps', (p_row ->> 'buy_swap_fee_bps')::integer,
      'sellSwapFeeBps', (p_row ->> 'sell_swap_fee_bps')::integer,
      'buyCreatorFeeBps', (p_row ->> 'buy_creator_fee_bps')::integer,
      'sellCreatorFeeBps', (p_row ->> 'sell_creator_fee_bps')::integer,
      'launcherFeeBps', (p_row ->> 'launcher_fee_bps')::integer,
      'transferTaxBps', (p_row ->> 'transfer_tax_bps')::integer,
      'lpFeePips', (p_row ->> 'lp_fee_pips')::integer,
      'protocolFeePips', (p_row ->> 'protocol_fee_pips')::integer
    ),
    'market', pg_catalog.jsonb_build_object(
      'tokenPriceNativeWei', token_price_native_wei::text,
      'marketCapNativeWei', market_cap_native_wei::text,
      'indexedMarketCapNativeWei', market_cap_native_wei::text,
      'indexedMarketCapUsdWad', null,
      'indexedValuationBlockNumber', p_row ->> 'market_block_number',
      'fdvUsdWad', null,
      'grossVolumeNativeWei', volume_native_wei::text,
      'creatorFeesGeneratedNativeWei', case
        when is_native_quote then p_row ->> 'accrued_creator_total'
        else null
      end,
      'launcherFeesGeneratedNativeWei', case
        when is_native_quote then p_row ->> 'accrued_launcher_total'
        else null
      end,
      'creatorFeesAccruedNativeWei', case
        when is_native_quote then p_row ->> 'creator_claimable_accrued'
        else null
      end,
      'swapCount', p_row -> 'market_swap_count'
    ),
    'quote', case
      when p_row ->> 'model_id' = 'stock-paired'
        and quote_decimals is not null
        and p_row ->> 'stock_quote_symbol' is not null
        and p_row ->> 'stock_quote_name' is not null
        and token_price_quote_wad is not null
        and market_cap_quote_wad is not null
        and volume_quote_raw is not null
        and p_row ->> 'creator_claimable_accrued' is not null
      then pg_catalog.jsonb_build_object(
        'address', p_row ->> 'stock_quote_address_hex',
        'symbol', p_row ->> 'stock_quote_symbol',
        'name', p_row ->> 'stock_quote_name',
        'decimals', quote_decimals,
        'isCurrency0',
          (p_row ->> 'stock_quote_currency_side') = 'currency0',
        'tokenPriceQuoteWad', token_price_quote_wad::text,
        'marketCapQuoteWad', market_cap_quote_wad::text,
        'grossVolumeQuoteRaw', volume_quote_raw::text,
        'creatorFeesGeneratedQuoteRaw',
          p_row ->> 'accrued_creator_total',
        'programmableFeesGeneratedQuoteRaw',
          p_row ->> 'accrued_launcher_total',
        'creatorFeesAccruedQuoteRaw',
          p_row ->> 'creator_claimable_accrued'
      )
      else null
    end,
    'initialBuy', case
      when p_row ->> 'initial_buy_native_wei' is not null
        and p_row ->> 'initial_buy_amount' is not null
      then pg_catalog.jsonb_build_object(
        'nativeWei', p_row ->> 'initial_buy_native_wei',
        'quoteRaw', p_row ->> 'initial_buy_quote_raw',
        'tokenRaw', p_row ->> 'initial_buy_amount'
      )
      else null
    end,
    'uniswapV4Pool', case
      when p_row ->> 'market_snapshot_id' is not null then
        pg_catalog.jsonb_build_object(
          'source', 'official-uniswap-v4-subgraph',
          'indexedBlockNumber', p_row ->> 'market_block_number',
          'indexedBlockHash', p_row ->> 'market_block_hash_hex',
          'volumeUsdWad', pg_catalog.trunc(
            (p_row ->> 'market_volume_usd')::numeric
              * 1000000000000000000
          )::text,
          'tvlUsdWad', pg_catalog.trunc(
            (p_row ->> 'market_tvl_usd')::numeric
              * 1000000000000000000
          )::text,
          'transactionCount', p_row ->> 'market_swap_count',
          'liquidity', p_row ->> 'market_liquidity',
          'sqrtPriceX96', p_row ->> 'market_sqrt_price_x96',
          'tick', (p_row ->> 'market_tick')::integer,
          'feeTierPips', p_row ->> 'pool_key_fee'
        )
      else null
    end
  )
  from atomic
$function$;

-- Route snapshots are materialized for the exact release sets accepted by the
-- frozen V2 adapters.  A route may have more than one public scope (for
-- example creator-profile all-releases and Stock-only, or launch-lookup
-- Classic-v3 and Stock-only), so snapshot_scope is part of the key.  Each row
-- exists only when every release in that exact scope is current at one
-- immutable checkpoint.
create view programmable_private.public_route_snapshots_v2
with (security_invoker = false, security_barrier = true)
as
with scopes(route_key, snapshot_scope, release_ids, expected_count) as (
  values
    (
      'explore-list'::text, 'all-supported'::text,
      array[
        'classic-v2', 'classic-v3', 'stock-paired-v1',
        'stock-paired-v2', 'stock-paired-v3'
      ]::text[], 5::bigint
    ),
    (
      'explore-token', 'all-supported',
      array[
        'classic-v2', 'classic-v3', 'stock-paired-v1',
        'stock-paired-v2', 'stock-paired-v3'
      ]::text[], 5
    ),
    (
      'explore-chart', 'all-supported',
      array[
        'classic-v2', 'classic-v3', 'stock-paired-v1',
        'stock-paired-v2', 'stock-paired-v3'
      ]::text[], 5
    ),
    (
      'creator-profile', 'all-supported',
      array[
        'classic-v2', 'classic-v3', 'stock-paired-v1',
        'stock-paired-v2', 'stock-paired-v3'
      ]::text[], 5
    ),
    (
      'creator-profile', 'stock-paired',
      array[
        'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
      ]::text[], 3
    ),
    (
      'classic-v3-profile', 'classic-v3',
      array['classic-v3']::text[], 1
    ),
    (
      'launch-lookup', 'classic-v3',
      array['classic-v3']::text[], 1
    ),
    (
      'launch-lookup', 'stock-paired',
      array[
        'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
      ]::text[], 3
    )
)
select
  readiness.route_key,
  scopes.snapshot_scope,
  readiness.chain_id,
  readiness.checkpoint_block_number,
  readiness.checkpoint_block_hash,
  pg_catalog.min(readiness.safe_block_number)
    as safe_block_number,
  pg_catalog.min(readiness.checkpoint_confirmations)
    as checkpoint_confirmations,
  pg_catalog.max(readiness.checkpoint_created_at)
    as snapshot_captured_at,
  pg_catalog.min(readiness.parity_bound_at) as reconciled_at,
  '0x' || pg_catalog.encode(
    readiness.checkpoint_block_hash, 'hex'
  ) as snapshot_commitment_hex,
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'routeKey', readiness.route_key,
      'chainId', readiness.chain_id,
      'releaseVersion', readiness.release_id,
      'modelVersion', readiness.model_id,
      'sourceGroup', readiness.source_group,
      'projectorVersion', readiness.projector_version,
      'epochId', readiness.epoch_id,
      'pointerGeneration', readiness.pointer_generation::text,
      'checkpointId', readiness.checkpoint_id,
      'checkpointGeneration', readiness.checkpoint_generation::text,
      'reorgGeneration', readiness.reorg_generation::text,
      'checkpointBlockNumber',
        readiness.checkpoint_block_number::text,
      'checkpointBlockHash', '0x' || pg_catalog.encode(
        readiness.checkpoint_block_hash, 'hex'
      )
    ) order by readiness.release_id, readiness.model_id
  ) as release_pointers,
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'model', readiness.model_id,
      'releaseVersion', readiness.release_id
    ) order by readiness.release_id, readiness.model_id
  ) as record_scopes,
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'releaseVersion', readiness.release_id,
      'modelVersion', readiness.model_id,
      'parityRecordId', readiness.parity_record_id,
      'reconciliationId', readiness.reconciliation_id,
      'parityEvidenceCommitment', '0x' || pg_catalog.encode(
        readiness.parity_evidence_commitment, 'hex'
      ),
      'parityBindingId', readiness.parity_binding_id,
      'parityBindingCommitment', '0x' || pg_catalog.encode(
        readiness.parity_binding_commitment, 'hex'
      ),
      'parityBoundAt', pg_catalog.to_char(
        readiness.parity_bound_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ) order by readiness.release_id, readiness.model_id
  ) as route_evidence
from scopes
join programmable_private.route_snapshot_readiness_v1 as readiness
  on readiness.route_key = scopes.route_key
 and readiness.release_id = any(scopes.release_ids)
where readiness.route_status = 'eligible'
  and readiness.eligibility_status = 'eligible'
  and readiness.route_mode = 'indexed'
  and readiness.parity_status = 'current'
  and (
    readiness.release_id = 'classic-v2'
      and readiness.model_id = 'classic'
    or readiness.release_id = 'classic-v3'
      and readiness.model_id = 'classic'
    or readiness.release_id = 'stock-paired-v1'
      and readiness.model_id = 'stock-paired'
    or readiness.release_id = 'stock-paired-v2'
      and readiness.model_id = 'stock-paired'
    or readiness.release_id = 'stock-paired-v3'
      and readiness.model_id = 'stock-paired'
  )
group by readiness.route_key, scopes.snapshot_scope,
  scopes.expected_count, readiness.chain_id,
  readiness.checkpoint_block_number, readiness.checkpoint_block_hash
having pg_catalog.count(*) = scopes.expected_count
  and pg_catalog.count(distinct (
    readiness.release_id, readiness.model_id
  )) = scopes.expected_count;

create view programmable_private.public_explore_token_v1
with (security_invoker = false, security_barrier = true)
as
with materialized as (
  select token.*,
    '0x' || pg_catalog.encode(token.checkpoint_block_hash, 'hex')
      as checkpoint_block_hash_hex,
    snapshot.snapshot_commitment_hex
      as snapshot_commitment_hex,
    '0x' || pg_catalog.encode(token.publication_commitment, 'hex')
      as publication_commitment_hex,
    '0x' || pg_catalog.encode(token.promoted_block_hash, 'hex')
      as promoted_block_hash_hex,
    '0x' || pg_catalog.encode(token.token, 'hex') as token_hex,
    '0x' || pg_catalog.encode(token.hook, 'hex') as hook_hex,
    '0x' || pg_catalog.encode(token.pool_id, 'hex') as pool_id_hex,
    '0x' || pg_catalog.encode(token.creator, 'hex') as creator_hex,
    case when token.position_recipient is not null then
      '0x' || pg_catalog.encode(token.position_recipient, 'hex')
    end as position_recipient_hex,
    case when token.reward_vault is not null then
      '0x' || pg_catalog.encode(token.reward_vault, 'hex')
    end as reward_vault_hex,
    '0x' || pg_catalog.encode(token.launch_hash, 'hex') as launch_hash_hex,
    '0x' || pg_catalog.encode(token.launch_transaction_hash, 'hex')
      as launch_transaction_hash_hex,
    '0x' || pg_catalog.encode(token.market_block_hash, 'hex')
      as market_block_hash_hex,
    '0x' || pg_catalog.encode(token.stock_quote_address, 'hex')
      as stock_quote_address_hex,
    case
      when pg_catalog.jsonb_typeof(token.metadata_extra_data) = 'string'
        and token.metadata_extra_data #>> '{}'
          ~ '^0x([0-9a-fA-F][0-9a-fA-F])*$'
      then pg_catalog.lower(token.metadata_extra_data #>> '{}')
    end as metadata_extra_data_hex,
    pg_catalog.to_char(
      token.launch_block_timestamp at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) as launch_timestamp_iso,
    pg_catalog.to_char(
      token.project_metadata_created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) as project_metadata_created_at_iso,
    pg_catalog.to_char(
      snapshot.snapshot_captured_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) as checkpoint_created_at_iso,
    snapshot.release_pointers,
    snapshot.route_evidence,
    snapshot.record_scopes as snapshot_record_scopes,
    pg_catalog.to_jsonb(token) as base_json
  from programmable_private.route_token_projections_v1 as token
  join programmable_private.public_route_snapshots_v2 as snapshot
    on snapshot.route_key = 'explore-token'
   and snapshot.snapshot_scope = 'all-supported'
   and snapshot.chain_id = token.chain_id
   and snapshot.checkpoint_block_number = token.checkpoint_block_number
   and snapshot.checkpoint_block_hash = token.checkpoint_block_hash
  where token.route_status = 'eligible'
    and token.route_mode = 'indexed'
    and token.parity_status = 'current'
    and token.payload_complete
    and token.release_id in (
      'classic-v2', 'classic-v3', 'stock-paired-v1',
      'stock-paired-v2', 'stock-paired-v3'
    )
    and (
      token.release_id like 'classic-%' and token.model_id = 'classic'
      or token.release_id like 'stock-paired-%'
        and token.model_id = 'stock-paired'
    )
), raw as (
  select materialized.*,
    base_json || pg_catalog.to_jsonb(materialized)
      as projection_json
  from materialized
)
select
  raw.route_key,
  raw.chain_id,
  raw.release_id,
  raw.model_id,
  raw.source_group,
  raw.projector_version,
  raw.epoch_id,
  raw.pointer_generation,
  raw.checkpoint_id,
  raw.checkpoint_generation,
  raw.reorg_generation,
  raw.checkpoint_block_number,
  raw.checkpoint_block_hash,
  raw.safe_block_number,
  raw.checkpoint_confirmations,
  raw.parity_status,
  raw.parity_record_id,
  raw.reconciliation_id,
  raw.parity_evidence_commitment,
  raw.parity_binding_id,
  raw.parity_binding_commitment,
  raw.projection_run_id,
  raw.publication_commitment,
  raw.checkpoint_block_number as comparison_checkpoint_block_number,
  raw.checkpoint_block_hash as comparison_checkpoint_block_hash,
  1::bigint as record_count,
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'model', raw.model_id, 'releaseVersion', raw.release_id
    )
  ) as record_scopes,
  200::integer as http_status,
  pg_catalog.jsonb_build_object(
    'status', 'ready',
    'snapshot', pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'adapterVersion', 'indexed-route-adapters-v2',
        'snapshotCommitment', raw.snapshot_commitment_hex,
        'chainId', raw.chain_id,
        'blockNumber', raw.checkpoint_block_number::text,
        'blockHash', raw.checkpoint_block_hash_hex,
        'confirmations', raw.checkpoint_confirmations,
        'capturedAt', raw.checkpoint_created_at_iso,
        'releasePointers', raw.release_pointers
      )
    ),
    'data', pg_catalog.jsonb_build_object(
      'address', raw.token_hex,
      'token', programmable_private.build_indexed_token_projection_v2(
        raw.projection_json
      )
    )
  ) as payload,
  true as payload_complete
from raw;

create function programmable_private.retarget_indexed_token_projection_v2(
  p_projection jsonb,
  p_pointer jsonb,
  p_snapshot_commitment text
)
returns jsonb
language sql
immutable
strict
security definer
set search_path = ''
as $function$
  select p_projection || pg_catalog.jsonb_build_object(
    'source', (p_projection -> 'source') || p_pointer
      || pg_catalog.jsonb_build_object(
        'snapshotCommitment', p_snapshot_commitment,
        'projectionRunId', p_projection #>> '{source,projectionRunId}',
        'publicationCommitment',
          p_projection #>> '{source,publicationCommitment}',
        'promotedBlockNumber',
          p_projection #>> '{source,promotedBlockNumber}',
        'promotedBlockHash',
          p_projection #>> '{source,promotedBlockHash}'
      )
  )
$function$;

-- One row per exact Explore-list token.  The projection body is reused only
-- when both list and detail routes share the same immutable checkpoint; its
-- row source is replaced with the list route pointer and commitment.
create view programmable_private.public_explore_list_v1
with (security_invoker = false, security_barrier = true)
as
select
  readiness.route_key,
  detail.chain_id,
  detail.release_id,
  detail.model_id,
  detail.source_group,
  readiness.projector_version,
  readiness.epoch_id,
  readiness.pointer_generation,
  readiness.checkpoint_id,
  readiness.checkpoint_generation,
  readiness.reorg_generation,
  readiness.checkpoint_block_number,
  readiness.checkpoint_block_hash,
  readiness.safe_block_number,
  readiness.checkpoint_confirmations,
  readiness.parity_status,
  readiness.parity_record_id,
  readiness.reconciliation_id,
  readiness.parity_evidence_commitment,
  readiness.parity_binding_id,
  readiness.parity_binding_commitment,
  detail.projection_run_id,
  detail.publication_commitment,
  detail.payload #>> '{data,token,tokenAddress}' as token_address,
  detail.payload #>> '{data,token,name}' as token_name,
  detail.payload #>> '{data,token,symbol}' as token_symbol,
  (detail.payload #>> '{data,token,launchBlockNumber}')::bigint
    as launch_block_number,
  (detail.payload #>> '{data,token,launchTransactionIndex}')::integer
    as launch_transaction_index,
  (detail.payload #>> '{data,token,launchLogIndex}')::integer
    as launch_log_index,
  detail.payload #>> '{data,token,launchTransactionHash}'
    as launch_transaction_hash,
  coalesce(
    detail.payload #>> '{data,token,market,indexedMarketCapUsdWad}',
    detail.payload #>> '{data,token,market,fdvUsdWad}'
  ) as market_cap_usd_wad,
  coalesce(
    detail.payload #>> '{data,token,market,indexedMarketCapNativeWei}',
    detail.payload #>> '{data,token,market,marketCapNativeWei}'
  ) as market_cap_native_wei,
  programmable_private.retarget_indexed_token_projection_v2(
    detail.payload #> '{data,token}', pointer.value,
    snapshot.snapshot_commitment_hex
  ) as token_projection,
  detail.payload #>> '{data,token,market,launcherFeesGeneratedNativeWei}'
    as launcher_fees_accrued_wei,
  snapshot.release_pointers,
  snapshot.record_scopes as snapshot_record_scopes,
  snapshot.route_evidence,
  snapshot.snapshot_commitment_hex,
  snapshot.snapshot_captured_at,
  snapshot.checkpoint_confirmations as snapshot_confirmations,
  readiness.checkpoint_block_number as comparison_checkpoint_block_number,
  readiness.checkpoint_block_hash as comparison_checkpoint_block_hash,
  200::integer as http_status,
  true as payload_complete
from programmable_private.public_explore_token_v1 as detail
join programmable_private.public_route_snapshots_v2 as snapshot
  on snapshot.route_key = 'explore-list'
 and snapshot.snapshot_scope = 'all-supported'
 and snapshot.chain_id = detail.chain_id
 and snapshot.checkpoint_block_number = detail.checkpoint_block_number
 and snapshot.checkpoint_block_hash = detail.checkpoint_block_hash
join programmable_private.route_snapshot_readiness_v1 as readiness
  on readiness.route_key = 'explore-list'
 and readiness.chain_id = detail.chain_id
 and readiness.release_id = detail.release_id
 and readiness.model_id = detail.model_id
 and readiness.source_group = detail.source_group
 and readiness.checkpoint_block_number = detail.checkpoint_block_number
 and readiness.checkpoint_block_hash = detail.checkpoint_block_hash
 and readiness.route_status = 'eligible'
 and readiness.route_mode = 'indexed'
 and readiness.parity_status = 'current'
join lateral pg_catalog.jsonb_array_elements(
  snapshot.release_pointers
) as pointer(value)
  on pointer.value ->> 'releaseVersion' = detail.release_id
 and pointer.value ->> 'modelVersion' = detail.model_id
 and pointer.value ->> 'sourceGroup' = detail.source_group;

create function programmable_private.get_public_explore_page_v1(
  p_chain_id bigint,
  p_query text,
  p_sort text,
  p_requested_page integer,
  p_page_size integer,
  p_start_after jsonb default null
)
returns table (
  http_status integer,
  payload jsonb,
  payload_complete boolean,
  record_count bigint,
  record_scopes jsonb,
  comparison_checkpoint_block_number bigint,
  comparison_checkpoint_block_hash bytea,
  route_evidence jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  snapshot programmable_private.public_route_snapshots_v2%rowtype;
  normalized_query text;
  valuation_unit text;
  filtered_count bigint;
  current_count bigint;
  total_pages bigint;
  resolved_page bigint;
  selected_count bigint;
  selected_tokens jsonb;
  selected_scopes jsonb;
  selected_launcher_fees numeric;
  end_cursor jsonb;
  cursor_cap numeric;
  cursor_block bigint;
  cursor_transaction_index integer;
  cursor_log_index integer;
  cursor_transaction_hash text;
  cursor_token_address text;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id not in (1, 11155111)
     or p_sort not in (
       'newest', 'oldest', 'market-cap', 'market-cap-asc'
     )
     or p_requested_page < 1
     or p_page_size not between 1 and 100
     or p_query is null
     or pg_catalog.octet_length(p_query) > 256
  then
    raise exception using
      errcode = '22023', message = 'invalid Explore page request';
  end if;
  normalized_query := pg_catalog.lower(
    pg_catalog.regexp_replace(pg_catalog.btrim(p_query), '^\$', '')
  );
  select * into snapshot
  from programmable_private.public_route_snapshots_v2
  where route_key = 'explore-list'
    and snapshot_scope = 'all-supported'
    and chain_id = p_chain_id;
  if not found then return; end if;

  select pg_catalog.count(*) into current_count
  from programmable_private.current_launch_projections_v1 as launch
  join programmable_private.run_headers as run
    on run.run_id = launch.projection_run_id
   and run.run_kind = 'projection'
  where launch.chain_id = p_chain_id
    and launch.release_id in (
      'classic-v2', 'classic-v3', 'stock-paired-v1',
      'stock-paired-v2', 'stock-paired-v3'
    )
    and (
      launch.release_id like 'classic-%' and launch.model_id = 'classic'
      or launch.release_id like 'stock-paired-%'
        and launch.model_id = 'stock-paired'
    )
    and launch.epoch_id in (
      select (pointer ->> 'epochId')::uuid
      from pg_catalog.jsonb_array_elements(
        snapshot.release_pointers
      ) as pointer
    );
  if current_count <> (
    select pg_catalog.count(*)
    from programmable_private.public_explore_list_v1
    where chain_id = p_chain_id
      and checkpoint_block_number = snapshot.checkpoint_block_number
      and checkpoint_block_hash = snapshot.checkpoint_block_hash
  ) then
    return;
  end if;

  select case
    when p_sort in ('market-cap', 'market-cap-asc')
      and pg_catalog.bool_and(market_cap_usd_wad is not null)
      then 'usd-wad'
    when p_sort in ('market-cap', 'market-cap-asc')
      and pg_catalog.bool_and(market_cap_native_wei is not null)
      then 'native-wei'
    when p_sort in ('market-cap', 'market-cap-asc') then null
    else null
  end into valuation_unit
  from programmable_private.public_explore_list_v1
  where chain_id = p_chain_id
    and checkpoint_block_number = snapshot.checkpoint_block_number
    and checkpoint_block_hash = snapshot.checkpoint_block_hash;
  if p_sort in ('market-cap', 'market-cap-asc')
     and valuation_unit is null
  then return; end if;

  if p_requested_page = 1 and p_start_after is not null
     or p_requested_page > 1 and p_start_after is null
  then
    raise exception using
      errcode = '22023', message = 'Explore page cursor is inconsistent';
  end if;
  if p_start_after is not null then
    if p_start_after ->> 'adapterVersion' <>
         'indexed-route-adapters-v2'
       or p_start_after ->> 'snapshotCommitment' <>
         snapshot.snapshot_commitment_hex
       or p_start_after ->> 'normalizedQuery' <> normalized_query
       or p_start_after ->> 'sort' <> p_sort
       or (p_start_after ->> 'pageSize')::integer <> p_page_size
       or p_start_after ->> 'valuationUnit' is distinct from valuation_unit
    then
      raise exception using
        errcode = '22023', message = 'Explore page cursor scope mismatch';
    end if;
    cursor_cap := (p_start_after #>> '{position,marketCapAtomic}')::numeric;
    cursor_block :=
      (p_start_after #>> '{position,launchBlockNumber}')::bigint;
    cursor_transaction_index :=
      (p_start_after #>> '{position,launchTransactionIndex}')::integer;
    cursor_log_index :=
      (p_start_after #>> '{position,launchLogIndex}')::integer;
    cursor_transaction_hash :=
      p_start_after #>> '{position,launchTransactionHash}';
    cursor_token_address :=
      p_start_after #>> '{position,tokenAddress}';
  end if;

  select pg_catalog.count(*) into filtered_count
  from programmable_private.public_explore_list_v1 as item
  where item.chain_id = p_chain_id
    and item.checkpoint_block_number = snapshot.checkpoint_block_number
    and item.checkpoint_block_hash = snapshot.checkpoint_block_hash
    and (
      normalized_query = ''
      or pg_catalog.lower(item.token_name) like '%' || normalized_query || '%'
      or pg_catalog.lower(item.token_symbol) like '%' || normalized_query || '%'
      or pg_catalog.lower(item.token_address) like '%' || normalized_query || '%'
    );
  total_pages := pg_catalog.ceil(
    filtered_count::numeric / p_page_size
  )::bigint;
  resolved_page := case
    when total_pages = 0 then 1
    else least(p_requested_page::bigint, total_pages)
  end;
  if resolved_page <> p_requested_page then return; end if;

  with candidates as (
    select item.*,
      case when valuation_unit = 'usd-wad'
        then item.market_cap_usd_wad::numeric
        when valuation_unit = 'native-wei'
        then item.market_cap_native_wei::numeric
      end as market_cap_atomic
    from programmable_private.public_explore_list_v1 as item
    where item.chain_id = p_chain_id
      and item.checkpoint_block_number = snapshot.checkpoint_block_number
      and item.checkpoint_block_hash = snapshot.checkpoint_block_hash
      and (
        normalized_query = ''
        or pg_catalog.lower(item.token_name)
          like '%' || normalized_query || '%'
        or pg_catalog.lower(item.token_symbol)
          like '%' || normalized_query || '%'
        or pg_catalog.lower(item.token_address)
          like '%' || normalized_query || '%'
      )
  ), after_cursor as (
    select * from candidates
    where p_start_after is null
      or p_sort = 'newest' and (
        launch_block_number, launch_transaction_index, launch_log_index,
        launch_transaction_hash, token_address
      ) < (
        cursor_block, cursor_transaction_index, cursor_log_index,
        cursor_transaction_hash, cursor_token_address
      )
      or p_sort = 'oldest' and (
        launch_block_number, launch_transaction_index, launch_log_index,
        launch_transaction_hash, token_address
      ) > (
        cursor_block, cursor_transaction_index, cursor_log_index,
        cursor_transaction_hash, cursor_token_address
      )
      or p_sort = 'market-cap' and (
        market_cap_atomic < cursor_cap
        or market_cap_atomic = cursor_cap and (
          launch_block_number, launch_transaction_index, launch_log_index,
          launch_transaction_hash, token_address
        ) < (
          cursor_block, cursor_transaction_index, cursor_log_index,
          cursor_transaction_hash, cursor_token_address
        )
      )
      or p_sort = 'market-cap-asc' and (
        market_cap_atomic > cursor_cap
        or market_cap_atomic = cursor_cap and (
          launch_block_number, launch_transaction_index, launch_log_index,
          launch_transaction_hash, token_address
        ) < (
          cursor_block, cursor_transaction_index, cursor_log_index,
          cursor_transaction_hash, cursor_token_address
        )
      )
  ), page_rows as (
    select * from after_cursor
    order by
      case when p_sort = 'market-cap' then market_cap_atomic end desc,
      case when p_sort = 'market-cap-asc' then market_cap_atomic end asc,
      case when p_sort = 'oldest' then launch_block_number end asc,
      case when p_sort <> 'oldest' then launch_block_number end desc,
      case when p_sort = 'oldest' then launch_transaction_index end asc,
      case when p_sort <> 'oldest' then launch_transaction_index end desc,
      case when p_sort = 'oldest' then launch_log_index end asc,
      case when p_sort <> 'oldest' then launch_log_index end desc,
      case when p_sort = 'oldest' then launch_transaction_hash end asc,
      case when p_sort <> 'oldest' then launch_transaction_hash end desc,
      case when p_sort = 'oldest' then token_address end asc,
      case when p_sort <> 'oldest' then token_address end desc
    limit p_page_size
  ), aggregate_page as (
    select pg_catalog.count(*) as page_count,
      coalesce(
        pg_catalog.jsonb_agg(token_projection order by
          case when p_sort = 'market-cap' then market_cap_atomic end desc,
          case when p_sort = 'market-cap-asc' then market_cap_atomic end asc,
          case when p_sort = 'oldest' then launch_block_number end asc,
          case when p_sort <> 'oldest' then launch_block_number end desc,
          case when p_sort = 'oldest' then launch_transaction_index end asc,
          case when p_sort <> 'oldest' then launch_transaction_index end desc,
          case when p_sort = 'oldest' then launch_log_index end asc,
          case when p_sort <> 'oldest' then launch_log_index end desc,
          case when p_sort = 'oldest' then token_address end asc,
          case when p_sort <> 'oldest' then token_address end desc
        ), '[]'::jsonb
      ) as tokens,
      coalesce(pg_catalog.sum(
        coalesce(launcher_fees_accrued_wei, '0')::numeric
      ), 0) as launcher_fees,
      coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'model', model_id, 'releaseVersion', release_id
        ) order by release_id
      ), '[]'::jsonb) as scopes,
      (
        select pg_catalog.jsonb_build_object(
          'adapterVersion', 'indexed-route-adapters-v2',
          'snapshotCommitment', snapshot.snapshot_commitment_hex,
          'normalizedQuery', normalized_query,
          'sort', p_sort,
          'pageSize', p_page_size,
          'valuationUnit', valuation_unit,
          'position', pg_catalog.jsonb_build_object(
            'marketCapAtomic', market_cap_atomic::text,
            'launchBlockNumber', launch_block_number::text,
            'launchTransactionIndex', launch_transaction_index,
            'launchLogIndex', launch_log_index,
            'launchTransactionHash', launch_transaction_hash,
            'tokenAddress', token_address
          )
        )
        from page_rows
        order by
          case when p_sort = 'market-cap' then market_cap_atomic end asc,
          case when p_sort = 'market-cap-asc' then market_cap_atomic end desc,
          case when p_sort = 'oldest' then launch_block_number end desc,
          case when p_sort <> 'oldest' then launch_block_number end asc
        limit 1
      ) as final_cursor
    from page_rows
  )
  select page_count, tokens, scopes, launcher_fees, final_cursor
  into selected_count, selected_tokens, selected_scopes,
    selected_launcher_fees, end_cursor
  from aggregate_page;
  if selected_count <> least(
    p_page_size::bigint,
    filtered_count - ((resolved_page - 1) * p_page_size)
  ) then return; end if;

  http_status := 200;
  payload := pg_catalog.jsonb_build_object(
    'status', 'ready',
    'snapshot', pg_catalog.jsonb_build_object(
      'adapterVersion', 'indexed-route-adapters-v2',
      'snapshotCommitment', snapshot.snapshot_commitment_hex,
      'chainId', snapshot.chain_id,
      'blockNumber', snapshot.checkpoint_block_number::text,
      'blockHash', '0x' || pg_catalog.encode(
        snapshot.checkpoint_block_hash, 'hex'
      ),
      'confirmations', snapshot.checkpoint_confirmations,
      'capturedAt', pg_catalog.to_char(
        snapshot.snapshot_captured_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'releasePointers', snapshot.release_pointers
    ),
    'data', pg_catalog.jsonb_build_object(
      'request', pg_catalog.jsonb_build_object(
        'query', pg_catalog.btrim(p_query),
        'sort', p_sort,
        'requestedPage', p_requested_page,
        'pageSize', p_page_size
      ),
      'page', pg_catalog.jsonb_build_object(
        'resolvedPage', resolved_page,
        'totalCount', filtered_count::text,
        'valuationUnit', valuation_unit,
        'startAfter', p_start_after,
        'endAt', end_cursor
      ),
      'launcherFeesAccruedWei', selected_launcher_fees::text,
      'tokens', selected_tokens
    )
  );
  payload_complete := true;
  record_count := selected_count;
  record_scopes := selected_scopes;
  comparison_checkpoint_block_number := snapshot.checkpoint_block_number;
  comparison_checkpoint_block_hash := snapshot.checkpoint_block_hash;
  route_evidence := snapshot.route_evidence;
  return next;
end
$function$;

-- Replace the internal cursor-taking draft with the frozen page-number API.
-- The database derives the prior-page boundary atomically from the exact
-- ordering and publishes it as startAfter; callers never supply a cursor.
drop function programmable_private.get_public_explore_page_v1(
  bigint, text, text, integer, integer, jsonb
);

create function programmable_private.build_public_snapshot_identity_v2(
  p_snapshot_commitment text,
  p_chain_id bigint,
  p_block_number bigint,
  p_block_hash bytea,
  p_confirmations bigint,
  p_captured_at timestamptz,
  p_release_pointers jsonb
)
returns jsonb
language sql
stable
strict
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'adapterVersion', 'indexed-route-adapters-v2',
    'snapshotCommitment', p_snapshot_commitment,
    'chainId', p_chain_id,
    'blockNumber', p_block_number::text,
    'blockHash', '0x' || pg_catalog.encode(p_block_hash, 'hex'),
    'confirmations', p_confirmations,
    'capturedAt', pg_catalog.to_char(
      p_captured_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'releasePointers', p_release_pointers
  )
$function$;

create function programmable_private.build_public_explore_cursor_v1(
  p_snapshot_commitment text,
  p_normalized_query text,
  p_sort text,
  p_page_size integer,
  p_valuation_unit text,
  p_market_cap_atomic numeric,
  p_launch_block_number bigint,
  p_launch_transaction_index bigint,
  p_launch_log_index bigint,
  p_launch_transaction_hash text,
  p_token_address text
)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $function$
  select case when p_launch_block_number is null then null else
    pg_catalog.jsonb_build_object(
      'adapterVersion', 'indexed-route-adapters-v2',
      'snapshotCommitment', p_snapshot_commitment,
      'normalizedQuery', p_normalized_query,
      'sort', p_sort,
      'pageSize', p_page_size,
      'valuationUnit', p_valuation_unit,
      'position', pg_catalog.jsonb_build_object(
        'marketCapAtomic', p_market_cap_atomic::text,
        'launchBlockNumber', p_launch_block_number::text,
        'launchTransactionIndex', p_launch_transaction_index,
        'launchLogIndex', p_launch_log_index,
        'launchTransactionHash', p_launch_transaction_hash,
        'tokenAddress', p_token_address
      )
    )
  end
$function$;

create function programmable_private.get_public_explore_page_v1(
  p_chain_id bigint,
  p_query text,
  p_sort text,
  p_requested_page integer,
  p_page_size integer
)
returns table (
  http_status integer,
  payload jsonb,
  payload_complete boolean,
  record_count bigint,
  record_scopes jsonb,
  comparison_checkpoint_block_number bigint,
  comparison_checkpoint_block_hash bytea,
  route_evidence jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  route_snapshot programmable_private.public_route_snapshots_v2%rowtype;
  normalized_query text;
  valuation_unit text;
  filtered_count bigint;
  current_count bigint;
  total_pages bigint;
  resolved_page bigint;
  selected_count bigint;
  selected_tokens jsonb;
  selected_scopes jsonb;
  launcher_fees numeric;
  start_cursor jsonb;
  end_cursor jsonb;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id not in (1, 11155111)
     or p_sort not in (
       'newest', 'oldest', 'market-cap', 'market-cap-asc'
     )
     or p_requested_page < 1
     or p_page_size not between 1 and 100
     or p_query is null
     or pg_catalog.octet_length(p_query) > 256
  then
    raise exception using
      errcode = '22023', message = 'invalid Explore page request';
  end if;
  normalized_query := pg_catalog.lower(
    pg_catalog.regexp_replace(pg_catalog.btrim(p_query), '^\$', '')
  );

  select * into route_snapshot
  from programmable_private.public_route_snapshots_v2
  where route_key = 'explore-list'
    and snapshot_scope = 'all-supported'
    and chain_id = p_chain_id;
  if not found then return; end if;

  select pg_catalog.count(*) into current_count
  from programmable_private.current_launch_projections_v1 as launch
  join programmable_private.run_headers as run
    on run.run_id = launch.projection_run_id
   and run.run_kind = 'projection'
  join lateral pg_catalog.jsonb_array_elements(
    route_snapshot.release_pointers
  ) as pointer(value)
    on pointer.value ->> 'releaseVersion' = launch.release_id
   and pointer.value ->> 'modelVersion' = launch.model_id
   and pointer.value ->> 'sourceGroup' = run.source_group
   and (pointer.value ->> 'epochId')::uuid = launch.epoch_id
   and (pointer.value ->> 'pointerGeneration')::bigint =
      launch.pointer_generation
  where launch.chain_id = p_chain_id;
  if current_count <> (
    select pg_catalog.count(*)
    from programmable_private.public_explore_list_v1
    where chain_id = p_chain_id
      and checkpoint_block_number =
        route_snapshot.checkpoint_block_number
      and checkpoint_block_hash = route_snapshot.checkpoint_block_hash
  ) then
    return;
  end if;

  select pg_catalog.count(*) into filtered_count
  from programmable_private.public_explore_list_v1 as item
  where item.chain_id = p_chain_id
    and item.checkpoint_block_number =
      route_snapshot.checkpoint_block_number
    and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash
    and (
      normalized_query = ''
      or pg_catalog.lower(item.token_name)
        like '%' || normalized_query || '%'
      or pg_catalog.lower(item.token_symbol)
        like '%' || normalized_query || '%'
      or pg_catalog.lower(item.token_address)
        like '%' || normalized_query || '%'
    );

  if p_sort in ('market-cap', 'market-cap-asc') then
    if filtered_count = 0 then
      valuation_unit := 'native-wei';
    else
      select case
        when pg_catalog.bool_and(market_cap_usd_wad is not null)
          then 'usd-wad'
        when pg_catalog.bool_and(market_cap_native_wei is not null)
          then 'native-wei'
      end into valuation_unit
      from programmable_private.public_explore_list_v1 as item
      where item.chain_id = p_chain_id
        and item.checkpoint_block_number =
          route_snapshot.checkpoint_block_number
        and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash
        and (
          normalized_query = ''
          or pg_catalog.lower(item.token_name)
            like '%' || normalized_query || '%'
          or pg_catalog.lower(item.token_symbol)
            like '%' || normalized_query || '%'
          or pg_catalog.lower(item.token_address)
            like '%' || normalized_query || '%'
        );
      if valuation_unit is null then return; end if;
    end if;
  end if;

  total_pages := pg_catalog.ceil(
    filtered_count::numeric / p_page_size
  )::bigint;
  resolved_page := case
    when total_pages = 0 then 1
    else least(p_requested_page::bigint, total_pages)
  end;

  with candidates as (
    select item.*,
      case
        when valuation_unit = 'usd-wad'
          then item.market_cap_usd_wad::numeric
        when valuation_unit = 'native-wei'
          then item.market_cap_native_wei::numeric
      end as market_cap_atomic
    from programmable_private.public_explore_list_v1 as item
    where item.chain_id = p_chain_id
      and item.checkpoint_block_number =
        route_snapshot.checkpoint_block_number
      and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash
      and (
        normalized_query = ''
        or pg_catalog.lower(item.token_name)
          like '%' || normalized_query || '%'
        or pg_catalog.lower(item.token_symbol)
          like '%' || normalized_query || '%'
        or pg_catalog.lower(item.token_address)
          like '%' || normalized_query || '%'
      )
  ), ordered as (
    select candidates.*,
      pg_catalog.row_number() over (order by
        case when p_sort = 'market-cap'
          then market_cap_atomic end desc,
        case when p_sort = 'market-cap-asc'
          then market_cap_atomic end asc,
        case when p_sort = 'oldest'
          then launch_block_number end asc,
        case when p_sort <> 'oldest'
          then launch_block_number end desc,
        case when p_sort = 'oldest'
          then launch_transaction_index end asc,
        case when p_sort <> 'oldest'
          then launch_transaction_index end desc,
        case when p_sort = 'oldest'
          then launch_log_index end asc,
        case when p_sort <> 'oldest'
          then launch_log_index end desc,
        case when p_sort = 'oldest'
          then launch_transaction_hash end asc,
        case when p_sort <> 'oldest'
          then launch_transaction_hash end desc,
        case when p_sort = 'oldest'
          then token_address end asc,
        case when p_sort <> 'oldest'
          then token_address end desc
      ) as row_ordinal
    from candidates
  ), selected as (
    select * from ordered
    where row_ordinal > (resolved_page - 1) * p_page_size
      and row_ordinal <= resolved_page * p_page_size
  ), selected_aggregate as (
    select
      pg_catalog.count(*) as selected_count,
      coalesce(
        pg_catalog.jsonb_agg(token_projection order by row_ordinal),
        '[]'::jsonb
      ) as selected_tokens
    from selected
  ), selected_scope as (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'model', scope.model_id,
          'releaseVersion', scope.release_id
        ) order by scope.release_id, scope.model_id
      ), '[]'::jsonb
    ) as scopes
    from (
      select distinct release_id, model_id from selected
    ) as scope
  ), cursor_rows as (
    select
      programmable_private.build_public_explore_cursor_v1(
        route_snapshot.snapshot_commitment_hex,
        normalized_query, p_sort, p_page_size, valuation_unit,
        start_row.market_cap_atomic,
        start_row.launch_block_number,
        start_row.launch_transaction_index,
        start_row.launch_log_index,
        start_row.launch_transaction_hash,
        start_row.token_address
      ) as start_cursor,
      programmable_private.build_public_explore_cursor_v1(
        route_snapshot.snapshot_commitment_hex,
        normalized_query, p_sort, p_page_size, valuation_unit,
        end_row.market_cap_atomic,
        end_row.launch_block_number,
        end_row.launch_transaction_index,
        end_row.launch_log_index,
        end_row.launch_transaction_hash,
        end_row.token_address
      ) as end_cursor
    from (values (true)) as singleton(value)
    left join ordered as start_row
      on start_row.row_ordinal = (resolved_page - 1) * p_page_size
     and resolved_page > 1
    left join ordered as end_row
      on end_row.row_ordinal = least(
        resolved_page * p_page_size, filtered_count
      )
  )
  select aggregate.selected_count, aggregate.selected_tokens,
    scope.scopes, cursors.start_cursor, cursors.end_cursor
  into selected_count, selected_tokens, selected_scopes,
    start_cursor, end_cursor
  from selected_aggregate as aggregate
  cross join selected_scope as scope
  cross join cursor_rows as cursors;

  if selected_count <> least(
    p_page_size::bigint,
    pg_catalog.greatest(
      0::bigint,
      filtered_count - ((resolved_page - 1) * p_page_size)
    )
  ) then return; end if;
  if (resolved_page = 1) <> (start_cursor is null)
     or (selected_count = 0) <> (end_cursor is null)
  then return; end if;

  select coalesce(pg_catalog.sum(
    coalesce(item.launcher_fees_accrued_wei, '0')::numeric
  ), 0) into launcher_fees
  from programmable_private.public_explore_list_v1 as item
  where item.chain_id = p_chain_id
    and item.checkpoint_block_number =
      route_snapshot.checkpoint_block_number
    and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash;

  http_status := 200;
  payload := pg_catalog.jsonb_build_object(
    'status', 'ready',
    'snapshot', programmable_private.build_public_snapshot_identity_v2(
      route_snapshot.snapshot_commitment_hex,
      route_snapshot.chain_id,
      route_snapshot.checkpoint_block_number,
      route_snapshot.checkpoint_block_hash,
      route_snapshot.checkpoint_confirmations,
      route_snapshot.snapshot_captured_at,
      route_snapshot.release_pointers
    ),
    'data', pg_catalog.jsonb_build_object(
      'request', pg_catalog.jsonb_build_object(
        'query', pg_catalog.btrim(p_query),
        'sort', p_sort,
        'requestedPage', p_requested_page,
        'pageSize', p_page_size
      ),
      'page', pg_catalog.jsonb_build_object(
        'resolvedPage', resolved_page,
        'totalCount', filtered_count::text,
        'valuationUnit', valuation_unit,
        'startAfter', start_cursor,
        'endAt', end_cursor
      ),
      'launcherFeesAccruedWei', launcher_fees::text,
      'tokens', selected_tokens
    )
  );
  payload_complete := true;
  record_count := selected_count;
  record_scopes := selected_scopes;
  comparison_checkpoint_block_number :=
    route_snapshot.checkpoint_block_number;
  comparison_checkpoint_block_hash := route_snapshot.checkpoint_block_hash;
  route_evidence := route_snapshot.route_evidence;
  return next;
end
$function$;

-- Complete, uncapped feed for the indexer cutover comparator.  It emits one
-- row only when all five public releases share one current checkpoint, every
-- current launch has a complete raw token projection, and per-record source,
-- publication and parity commitments are present.
create function programmable_private.get_public_indexer_feed_v1(
  p_chain_id bigint
)
returns table (
  http_status integer,
  payload jsonb,
  payload_complete boolean,
  record_count bigint,
  record_scopes jsonb,
  comparison_checkpoint_block_number bigint,
  comparison_checkpoint_block_hash bytea,
  route_evidence jsonb,
  snapshot jsonb,
  tokens jsonb,
  record_sources jsonb,
  captured_at timestamptz,
  reconciled_at timestamptz,
  snapshot_commitment bytea
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  route_snapshot programmable_private.public_route_snapshots_v2%rowtype;
  current_count bigint;
  feed_count bigint;
  feed_tokens jsonb;
  feed_sources jsonb;
  feed_scopes jsonb;
  feed_snapshot jsonb;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id not in (1, 11155111) then
    raise exception using
      errcode = '22023', message = 'invalid public indexer feed chain';
  end if;

  select * into route_snapshot
  from programmable_private.public_route_snapshots_v2
  where route_key = 'explore-list'
    and snapshot_scope = 'all-supported'
    and chain_id = p_chain_id;
  if not found then return; end if;

  select pg_catalog.count(*) into current_count
  from programmable_private.current_launch_projections_v1 as launch
  join programmable_private.run_headers as run
    on run.run_id = launch.projection_run_id
   and run.run_kind = 'projection'
  join lateral pg_catalog.jsonb_array_elements(
    route_snapshot.release_pointers
  ) as pointer(value)
    on pointer.value ->> 'releaseVersion' = launch.release_id
   and pointer.value ->> 'modelVersion' = launch.model_id
   and pointer.value ->> 'sourceGroup' = run.source_group
   and (pointer.value ->> 'epochId')::uuid = launch.epoch_id
   and (pointer.value ->> 'pointerGeneration')::bigint =
      launch.pointer_generation
  where launch.chain_id = p_chain_id;

  with feed_rows as (
    select item.*,
      (
        select evidence.value
        from pg_catalog.jsonb_array_elements(
          item.route_evidence
        ) as evidence(value)
        where evidence.value ->> 'releaseVersion' = item.release_id
          and evidence.value ->> 'modelVersion' = item.model_id
        limit 1
      ) as parity_evidence
    from programmable_private.public_explore_list_v1 as item
    where item.chain_id = p_chain_id
      and item.checkpoint_block_number =
        route_snapshot.checkpoint_block_number
      and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash
  ), aggregate_rows as (
    select
      pg_catalog.count(*) as feed_count,
      coalesce(
        pg_catalog.jsonb_agg(token_projection order by
          launch_block_number,
          launch_transaction_index,
          launch_log_index,
          launch_transaction_hash,
          token_address
        ), '[]'::jsonb
      ) as feed_tokens,
      coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'tokenAddress', token_address,
            'source', token_projection -> 'source',
            'parity', parity_evidence
          ) order by
            launch_block_number,
            launch_transaction_index,
            launch_log_index,
            launch_transaction_hash,
            token_address
        ), '[]'::jsonb
      ) as feed_sources,
      pg_catalog.bool_and(
        payload_complete
        and token_projection #>> '{source,publicationCommitment}' is not null
        and parity_evidence ->> 'parityEvidenceCommitment' is not null
        and parity_evidence ->> 'parityBindingCommitment' is not null
      ) as all_complete
    from feed_rows
  ), scope_rows as (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'model', scope.model_id,
          'releaseVersion', scope.release_id
        ) order by scope.release_id, scope.model_id
      ), '[]'::jsonb
    ) as scopes
    from (
      select distinct release_id, model_id from feed_rows
    ) as scope
  )
  select rows.feed_count, rows.feed_tokens, rows.feed_sources,
    scopes.scopes
  into feed_count, feed_tokens, feed_sources, feed_scopes
  from aggregate_rows as rows
  cross join scope_rows as scopes
  where coalesce(rows.all_complete, true);
  if not found or feed_count <> current_count then return; end if;

  feed_snapshot :=
    programmable_private.build_public_snapshot_identity_v2(
      route_snapshot.snapshot_commitment_hex,
      route_snapshot.chain_id,
      route_snapshot.checkpoint_block_number,
      route_snapshot.checkpoint_block_hash,
      route_snapshot.checkpoint_confirmations,
      route_snapshot.snapshot_captured_at,
      route_snapshot.release_pointers
    ) || pg_catalog.jsonb_build_object(
      'safeBlockNumber', route_snapshot.safe_block_number::text,
      'reconciledAt', pg_catalog.to_char(
        route_snapshot.reconciled_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    );

  http_status := 200;
  snapshot := feed_snapshot;
  tokens := feed_tokens;
  record_sources := feed_sources;
  captured_at := route_snapshot.snapshot_captured_at;
  reconciled_at := route_snapshot.reconciled_at;
  snapshot_commitment := route_snapshot.checkpoint_block_hash;
  payload := pg_catalog.jsonb_build_object(
    'status', 'ready',
    'snapshot', feed_snapshot,
    'data', pg_catalog.jsonb_build_object(
      'tokens', feed_tokens,
      'recordSources', feed_sources
    )
  );
  payload_complete := true;
  record_count := feed_count;
  record_scopes := feed_scopes;
  comparison_checkpoint_block_number :=
    route_snapshot.checkpoint_block_number;
  comparison_checkpoint_block_hash := route_snapshot.checkpoint_block_hash;
  route_evidence := route_snapshot.route_evidence;
  return next;
end
$function$;

create function programmable_private.decode_public_address_v1(p_value text)
returns bytea
language plpgsql
immutable
strict
security definer
set search_path = ''
as $function$
begin
  if p_value !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception using
      errcode = '22023', message = 'invalid public address';
  end if;
  return pg_catalog.decode(
    pg_catalog.substr(pg_catalog.lower(p_value), 3), 'hex'
  );
end
$function$;

create function programmable_private.decode_public_bytes32_v1(p_value text)
returns bytea
language plpgsql
immutable
strict
security definer
set search_path = ''
as $function$
begin
  if p_value !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception using
      errcode = '22023', message = 'invalid public bytes32';
  end if;
  return pg_catalog.decode(
    pg_catalog.substr(pg_catalog.lower(p_value), 3), 'hex'
  );
end
$function$;

create function programmable_private.get_public_explore_token_v1(
  p_chain_id bigint,
  p_address text
)
returns table (
  http_status integer,
  payload jsonb,
  payload_complete boolean,
  record_count bigint,
  record_scopes jsonb,
  comparison_checkpoint_block_number bigint,
  comparison_checkpoint_block_hash bytea,
  route_evidence jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  route_snapshot programmable_private.public_route_snapshots_v2%rowtype;
  token_address bytea;
  canonical_address text;
  current_count bigint;
  selected programmable_private.public_explore_token_v1%rowtype;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id not in (1, 11155111) then
    raise exception using
      errcode = '22023', message = 'invalid token-detail chain';
  end if;
  token_address := programmable_private.decode_public_address_v1(p_address);
  canonical_address := '0x' || pg_catalog.encode(token_address, 'hex');

  select * into route_snapshot
  from programmable_private.public_route_snapshots_v2
  where route_key = 'explore-token'
    and snapshot_scope = 'all-supported'
    and chain_id = p_chain_id;
  if not found then return; end if;

  select pg_catalog.count(*) into current_count
  from programmable_private.current_launch_projections_v1 as launch
  join programmable_private.run_headers as run
    on run.run_id = launch.projection_run_id
   and run.run_kind = 'projection'
  join lateral pg_catalog.jsonb_array_elements(
    route_snapshot.release_pointers
  ) as pointer(value)
    on pointer.value ->> 'releaseVersion' = launch.release_id
   and pointer.value ->> 'modelVersion' = launch.model_id
   and pointer.value ->> 'sourceGroup' = run.source_group
   and (pointer.value ->> 'epochId')::uuid = launch.epoch_id
   and (pointer.value ->> 'pointerGeneration')::bigint =
      launch.pointer_generation
  where launch.chain_id = p_chain_id
    and launch.token = token_address;
  if current_count > 1 then
    raise exception using
      errcode = '23514', message = 'token-detail projection is ambiguous';
  end if;

  select * into selected
  from programmable_private.public_explore_token_v1 as detail
  where detail.chain_id = p_chain_id
    and detail.checkpoint_block_number =
      route_snapshot.checkpoint_block_number
    and detail.checkpoint_block_hash = route_snapshot.checkpoint_block_hash
    and detail.payload #>> '{data,address}' = canonical_address;

  if current_count = 1 and not found then return; end if;
  if current_count = 0 then
    http_status := 404;
    payload := pg_catalog.jsonb_build_object(
      'status', 'ready',
      'snapshot', programmable_private.build_public_snapshot_identity_v2(
        route_snapshot.snapshot_commitment_hex,
        route_snapshot.chain_id,
        route_snapshot.checkpoint_block_number,
        route_snapshot.checkpoint_block_hash,
        route_snapshot.checkpoint_confirmations,
        route_snapshot.snapshot_captured_at,
        route_snapshot.release_pointers
      ),
      'data', pg_catalog.jsonb_build_object(
        'address', canonical_address,
        'token', null
      )
    );
    payload_complete := true;
    record_count := 0;
    record_scopes := '[]'::jsonb;
    comparison_checkpoint_block_number :=
      route_snapshot.checkpoint_block_number;
    comparison_checkpoint_block_hash :=
      route_snapshot.checkpoint_block_hash;
    route_evidence := route_snapshot.route_evidence;
    return next;
    return;
  end if;

  http_status := selected.http_status;
  payload := selected.payload;
  payload_complete := selected.payload_complete;
  record_count := selected.record_count;
  record_scopes := selected.record_scopes;
  comparison_checkpoint_block_number :=
    selected.comparison_checkpoint_block_number;
  comparison_checkpoint_block_hash :=
    selected.comparison_checkpoint_block_hash;
  route_evidence := route_snapshot.route_evidence;
  return next;
end
$function$;

create view programmable_private.public_explore_chart_v1
with (security_invoker = false, security_barrier = true)
as
select
  chart_readiness.chain_id,
  token.release_id,
  token.model_id,
  token.source_group,
  token.token,
  token.pool_id,
  token.currency0,
  token.currency1,
  chart_snapshot.checkpoint_block_number,
  chart_snapshot.checkpoint_block_hash,
  chart_snapshot.snapshot_commitment_hex,
  chart_snapshot.release_pointers,
  chart_snapshot.record_scopes as snapshot_record_scopes,
  chart_snapshot.route_evidence,
  chart_snapshot.snapshot_captured_at,
  chart_snapshot.safe_block_number,
  chart_snapshot.checkpoint_confirmations,
  programmable_private.retarget_indexed_token_projection_v2(
    detail.payload #> '{data,token}', pointer.value,
    chart_snapshot.snapshot_commitment_hex
  ) -> 'source' as row_source,
  close_fact.market_block_close_id,
  close_fact.block_number,
  close_fact.block_hash,
  close_fact.block_timestamp,
  close_fact.transaction_count,
  case
    when token.token = token.currency0
      and token.currency1 =
        pg_catalog.decode(pg_catalog.repeat('00', 20), 'hex')
      then close_fact.token0_price
    when token.token = token.currency1
      and token.currency0 =
        pg_catalog.decode(pg_catalog.repeat('00', 20), 'hex')
      then close_fact.token1_price
  end as token_price_native,
  case
    when token.currency0 =
      pg_catalog.decode(pg_catalog.repeat('00', 20), 'hex')
      then close_fact.volume_token0
    when token.currency1 =
      pg_catalog.decode(pg_catalog.repeat('00', 20), 'hex')
      then close_fact.volume_token1
  end as volume_native,
  close_fact.volume_usd,
  global_snapshot.answer as eth_usd_answer,
  global_snapshot.decimals as eth_usd_decimals
from programmable_private.route_token_projections_v1 as token
join programmable_private.public_explore_token_v1 as detail
  on detail.chain_id = token.chain_id
 and detail.release_id = token.release_id
 and detail.model_id = token.model_id
 and detail.source_group = token.source_group
 and detail.epoch_id = token.epoch_id
 and detail.pointer_generation = token.pointer_generation
 and detail.payload #>> '{data,token,tokenAddress}' =
   '0x' || pg_catalog.encode(token.token, 'hex')
join programmable_private.public_route_snapshots_v2 as chart_snapshot
  on chart_snapshot.route_key = 'explore-chart'
 and chart_snapshot.snapshot_scope = 'all-supported'
 and chart_snapshot.chain_id = token.chain_id
 and chart_snapshot.checkpoint_block_number = token.checkpoint_block_number
 and chart_snapshot.checkpoint_block_hash = token.checkpoint_block_hash
join programmable_private.route_snapshot_readiness_v1 as chart_readiness
  on chart_readiness.route_key = 'explore-chart'
 and chart_readiness.chain_id = token.chain_id
 and chart_readiness.release_id = token.release_id
 and chart_readiness.model_id = token.model_id
 and chart_readiness.source_group = token.source_group
 and chart_readiness.epoch_id = token.epoch_id
 and chart_readiness.pointer_generation = token.pointer_generation
 and chart_readiness.checkpoint_block_number =
   chart_snapshot.checkpoint_block_number
 and chart_readiness.checkpoint_block_hash =
   chart_snapshot.checkpoint_block_hash
 and chart_readiness.route_status = 'eligible'
 and chart_readiness.route_mode = 'indexed'
 and chart_readiness.parity_status = 'current'
join lateral pg_catalog.jsonb_array_elements(
  chart_snapshot.release_pointers
) as pointer(value)
  on pointer.value ->> 'releaseVersion' = token.release_id
 and pointer.value ->> 'modelVersion' = token.model_id
 and pointer.value ->> 'sourceGroup' = token.source_group
left join programmable_private.market_block_closes_v1 as close_fact
  on token.model_id = 'classic'
 and close_fact.chain_id = token.chain_id
 and close_fact.release_id = token.release_id
 and close_fact.model_id = token.model_id
 and close_fact.epoch_id = token.epoch_id
 and close_fact.pointer_generation = token.pointer_generation
 and close_fact.token = token.token
 and close_fact.pool_id = token.pool_id
 and close_fact.block_number <= chart_snapshot.checkpoint_block_number
left join programmable_private.global_eth_usd_snapshots_v1
  as global_snapshot
  on global_snapshot.global_market_snapshot_id =
    close_fact.global_market_snapshot_id
where token.route_key = 'explore-token'
  and token.route_status = 'eligible'
  and token.route_mode = 'indexed'
  and token.parity_status = 'current'
  and token.payload_complete;

create function programmable_private.get_public_token_chart_v1(
  p_chain_id bigint,
  p_address text,
  p_range text
)
returns table (
  http_status integer,
  payload jsonb,
  payload_complete boolean,
  record_count bigint,
  record_scopes jsonb,
  comparison_checkpoint_block_number bigint,
  comparison_checkpoint_block_hash bytea,
  route_evidence jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  route_snapshot programmable_private.public_route_snapshots_v2%rowtype;
  token_address bytea;
  canonical_address text;
  target record;
  points jsonb;
  point_count bigint;
  swap_count numeric;
  volume_native_wei numeric;
  volume_usd_wad numeric;
  range_start timestamptz;
  baseline_transactions numeric;
  baseline_volume_native numeric;
  baseline_volume_usd numeric;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id not in (1, 11155111)
     or p_range not in ('1h', '1d', '1w', 'all')
  then
    raise exception using
      errcode = '22023', message = 'invalid token-chart request';
  end if;
  token_address := programmable_private.decode_public_address_v1(p_address);
  canonical_address := '0x' || pg_catalog.encode(token_address, 'hex');
  select * into route_snapshot
  from programmable_private.public_route_snapshots_v2
  where route_key = 'explore-chart'
    and snapshot_scope = 'all-supported'
    and chain_id = p_chain_id;
  if not found then return; end if;

  select chart.* into target
  from programmable_private.public_explore_chart_v1 as chart
  where chart.chain_id = p_chain_id
    and chart.token = token_address
    and chart.checkpoint_block_number =
      route_snapshot.checkpoint_block_number
    and chart.checkpoint_block_hash = route_snapshot.checkpoint_block_hash
  order by chart.block_number nulls last
  limit 1;
  if not found then return; end if;

  if target.model_id = 'stock-paired' then
    points := '[]'::jsonb;
    point_count := 0;
    swap_count := 0;
    volume_native_wei := 0;
    volume_usd_wad := null;
  else
    range_start := case p_range
      when '1h' then route_snapshot.snapshot_captured_at - interval '1 hour'
      when '1d' then route_snapshot.snapshot_captured_at - interval '1 day'
      when '1w' then route_snapshot.snapshot_captured_at - interval '7 days'
      else null
    end;
    if range_start is not null then
      select
        coalesce(close_row.transaction_count, 0),
        coalesce(close_row.volume_native, 0),
        coalesce(close_row.volume_usd, 0)
      into baseline_transactions, baseline_volume_native,
        baseline_volume_usd
      from programmable_private.public_explore_chart_v1 as close_row
      where close_row.chain_id = p_chain_id
        and close_row.token = token_address
        and close_row.block_timestamp < range_start
      order by close_row.block_number desc
      limit 1;
      if not found then
        baseline_transactions := 0;
        baseline_volume_native := 0;
        baseline_volume_usd := 0;
      end if;
    else
      baseline_transactions := 0;
      baseline_volume_native := 0;
      baseline_volume_usd := 0;
    end if;

    with ranged as (
      select chart.*,
        pg_catalog.trunc(
          chart.token_price_native * 1000000000000000000
        )::numeric as price_native_wei,
        pg_catalog.trunc(
          chart.token_price_native * 1000000000000000000
            * chart.eth_usd_answer
            / pg_catalog.power(10::numeric, chart.eth_usd_decimals)
        )::numeric as price_usd_wad
      from programmable_private.public_explore_chart_v1 as chart
      where chart.chain_id = p_chain_id
        and chart.token = token_address
        and chart.market_block_close_id is not null
        and chart.block_number <= route_snapshot.checkpoint_block_number
        and (range_start is null or chart.block_timestamp >= range_start)
    ), exact_points as (
      select * from ranged
      where price_native_wei > 0
        and price_usd_wad >= 0
    )
    select
      coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'blockNumber', point.block_number::text,
          'priceNativeWei', point.price_native_wei::text,
          'priceUsdWad', point.price_usd_wad::text
        ) order by point.block_number
      ), '[]'::jsonb),
      pg_catalog.count(*),
      pg_catalog.greatest(
        coalesce(pg_catalog.max(point.transaction_count), 0)
          - baseline_transactions,
        0
      ),
      pg_catalog.trunc(pg_catalog.greatest(
        coalesce(pg_catalog.max(point.volume_native), 0)
          - baseline_volume_native,
        0
      ) * 1000000000000000000),
      pg_catalog.trunc(pg_catalog.greatest(
        coalesce(pg_catalog.max(point.volume_usd), 0)
          - baseline_volume_usd,
        0
      ) * 1000000000000000000)
    into points, point_count, swap_count,
      volume_native_wei, volume_usd_wad
    from exact_points as point;
  end if;

  http_status := 200;
  payload := pg_catalog.jsonb_build_object(
    'status', 'ready',
    'snapshot', programmable_private.build_public_snapshot_identity_v2(
      route_snapshot.snapshot_commitment_hex,
      route_snapshot.chain_id,
      route_snapshot.checkpoint_block_number,
      route_snapshot.checkpoint_block_hash,
      route_snapshot.checkpoint_confirmations,
      route_snapshot.snapshot_captured_at,
      route_snapshot.release_pointers
    ),
    'data', pg_catalog.jsonb_build_object(
      'address', canonical_address,
      'range', p_range,
      'source', target.row_source,
      'poolId', '0x' || pg_catalog.encode(target.pool_id, 'hex'),
      'points', points,
      'swapCount', swap_count::text,
      'volumeNativeWei', volume_native_wei::text,
      'volumeUsdWad', volume_usd_wad::text
    )
  );
  payload_complete := true;
  record_count := point_count;
  record_scopes := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'model', target.model_id,
      'releaseVersion', target.release_id
    )
  );
  comparison_checkpoint_block_number :=
    route_snapshot.checkpoint_block_number;
  comparison_checkpoint_block_hash := route_snapshot.checkpoint_block_hash;
  route_evidence := route_snapshot.route_evidence;
  return next;
end
$function$;

create view programmable_private.public_creator_profile_v1
with (security_invoker = false, security_barrier = true)
as
with token_rows as (
  select
    token.chain_id,
    token.creator as account,
    token.release_id,
    token.model_id,
    token.source_group,
    token.checkpoint_block_number,
    token.checkpoint_block_hash,
    'token'::text as record_kind,
    programmable_private.retarget_indexed_token_projection_v2(
      detail.payload #> '{data,token}', pointer.value,
      snapshot.snapshot_commitment_hex
    ) as record_payload,
    snapshot.release_pointers,
    snapshot.record_scopes as snapshot_record_scopes,
    snapshot.route_evidence,
    snapshot.snapshot_commitment_hex,
    snapshot.snapshot_captured_at,
    snapshot.safe_block_number,
    snapshot.checkpoint_confirmations
  from programmable_private.route_token_projections_v1 as token
  join programmable_private.public_explore_token_v1 as detail
    on detail.chain_id = token.chain_id
   and detail.release_id = token.release_id
   and detail.model_id = token.model_id
   and detail.source_group = token.source_group
   and detail.epoch_id = token.epoch_id
   and detail.pointer_generation = token.pointer_generation
   and detail.payload #>> '{data,token,tokenAddress}' =
     '0x' || pg_catalog.encode(token.token, 'hex')
  join programmable_private.public_route_snapshots_v2 as snapshot
    on snapshot.route_key = 'creator-profile'
   and snapshot.snapshot_scope = 'all-supported'
   and snapshot.chain_id = token.chain_id
   and snapshot.checkpoint_block_number = token.checkpoint_block_number
   and snapshot.checkpoint_block_hash = token.checkpoint_block_hash
  join programmable_private.route_snapshot_readiness_v1 as readiness
    on readiness.route_key = 'creator-profile'
   and readiness.chain_id = token.chain_id
   and readiness.release_id = token.release_id
   and readiness.model_id = token.model_id
   and readiness.source_group = token.source_group
   and readiness.epoch_id = token.epoch_id
   and readiness.pointer_generation = token.pointer_generation
   and readiness.checkpoint_block_number = token.checkpoint_block_number
   and readiness.checkpoint_block_hash = token.checkpoint_block_hash
   and readiness.route_status = 'eligible'
   and readiness.route_mode = 'indexed'
   and readiness.parity_status = 'current'
  join lateral pg_catalog.jsonb_array_elements(
    snapshot.release_pointers
  ) as pointer(value)
    on pointer.value ->> 'releaseVersion' = token.release_id
   and pointer.value ->> 'modelVersion' = token.model_id
   and pointer.value ->> 'sourceGroup' = token.source_group
  where token.route_key = 'explore-token'
    and token.route_status = 'eligible'
    and token.route_mode = 'indexed'
    and token.parity_status = 'current'
    and token.payload_complete
), claim_rows as (
  select
    claim.chain_id,
    claim.creator as account,
    claim.release_id,
    claim.model_id,
    claim.source_group,
    snapshot.checkpoint_block_number,
    snapshot.checkpoint_block_hash,
    'claim'::text as record_kind,
    pg_catalog.jsonb_build_object(
      'source', pointer.value || pg_catalog.jsonb_build_object(
        'snapshotCommitment', snapshot.snapshot_commitment_hex,
        'projectionRunId', claim.projection_run_id,
        'publicationCommitment', '0x' || pg_catalog.encode(
          publication_audit.input_commitment, 'hex'
        ),
        'promotedBlockNumber', claim.promoted_block_number::text,
        'promotedBlockHash', '0x' || pg_catalog.encode(
          claim.promoted_block_hash, 'hex'
        )
      ),
      'poolId', '0x' || pg_catalog.encode(claim.pool_id, 'hex'),
      'tokenAddress', '0x' || pg_catalog.encode(claim.token, 'hex'),
      'creatorAddress', '0x' || pg_catalog.encode(claim.creator, 'hex'),
      'recipientAddress', '0x' || pg_catalog.encode(claim.recipient, 'hex'),
      'callerAddress', '0x' || pg_catalog.encode(fact.caller, 'hex'),
      'amountWei', claim.amount::text,
      'blockNumber', claim.block_number::text,
      'transactionHash', '0x' || pg_catalog.encode(
        claim.transaction_hash, 'hex'
      ),
      'transactionIndex', claim.transaction_index,
      'logIndex', claim.receipt_log_ordinal,
      'claimedAt', pg_catalog.to_char(
        claim.block_timestamp at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ) as record_payload,
    snapshot.release_pointers,
    snapshot.record_scopes as snapshot_record_scopes,
    snapshot.route_evidence,
    snapshot.snapshot_commitment_hex,
    snapshot.snapshot_captured_at,
    snapshot.safe_block_number,
    snapshot.checkpoint_confirmations
  from programmable_private.claim_history_v1 as claim
  join programmable_private.creator_hook_claim_facts as fact
    on fact.chain_id = claim.chain_id
   and fact.release_id = claim.release_id
   and fact.model_id = claim.model_id
   and fact.epoch_id = claim.epoch_id
   and fact.pointer_generation = claim.pointer_generation
   and fact.source_occurrence_id = claim.source_occurrence_id
   and fact.source_logical_event_id = claim.source_logical_event_id
   and fact.source_occurrence_block_hash = claim.block_hash
   and fact.pool_id = claim.pool_id
   and fact.creator = claim.creator
   and fact.recipient = claim.recipient
   and fact.amount = claim.amount
  join programmable_private.projection_publications as publication
    on publication.run_id = claim.projection_run_id
   and publication.epoch_id = claim.epoch_id
   and publication.pointer_generation = claim.pointer_generation
   and publication.target_block_number = claim.promoted_block_number
   and publication.target_block_hash = claim.promoted_block_hash
  join programmable_private.mutation_audits as publication_audit
    on publication_audit.audit_id = publication.audit_id
  join programmable_private.public_route_snapshots_v2 as snapshot
    on snapshot.route_key = 'creator-profile'
   and snapshot.snapshot_scope = 'all-supported'
   and snapshot.chain_id = claim.chain_id
  join programmable_private.route_snapshot_readiness_v1 as readiness
    on readiness.route_key = 'creator-profile'
   and readiness.chain_id = claim.chain_id
   and readiness.release_id = claim.release_id
   and readiness.model_id = claim.model_id
   and readiness.source_group = claim.source_group
   and readiness.epoch_id = claim.epoch_id
   and readiness.pointer_generation = claim.pointer_generation
   and readiness.checkpoint_block_number = snapshot.checkpoint_block_number
   and readiness.checkpoint_block_hash = snapshot.checkpoint_block_hash
   and readiness.route_status = 'eligible'
   and readiness.route_mode = 'indexed'
   and readiness.parity_status = 'current'
  join lateral pg_catalog.jsonb_array_elements(
    snapshot.release_pointers
  ) as pointer(value)
    on pointer.value ->> 'releaseVersion' = claim.release_id
   and pointer.value ->> 'modelVersion' = claim.model_id
   and pointer.value ->> 'sourceGroup' = claim.source_group
  where claim.release_id = 'classic-v2'
    and claim.model_id = 'classic'
    and claim.claimant_kind = 'creator'
)
select * from token_rows
union all
select * from claim_rows;

create function programmable_private.get_public_creator_profile_v1(
  p_chain_id bigint,
  p_account text
)
returns table (
  http_status integer,
  payload jsonb,
  payload_complete boolean,
  record_count bigint,
  record_scopes jsonb,
  comparison_checkpoint_block_number bigint,
  comparison_checkpoint_block_hash bytea,
  route_evidence jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  route_snapshot programmable_private.public_route_snapshots_v2%rowtype;
  account_address bytea;
  canonical_account text;
  current_token_count bigint;
  current_claim_count bigint;
  public_token_count bigint;
  public_claim_count bigint;
  profile_tokens jsonb;
  profile_claims jsonb;
  profile_scopes jsonb;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id not in (1, 11155111) then
    raise exception using
      errcode = '22023', message = 'invalid creator-profile chain';
  end if;
  account_address := programmable_private.decode_public_address_v1(p_account);
  canonical_account := '0x' || pg_catalog.encode(account_address, 'hex');
  select * into route_snapshot
  from programmable_private.public_route_snapshots_v2
  where route_key = 'creator-profile'
    and snapshot_scope = 'all-supported'
    and chain_id = p_chain_id;
  if not found then return; end if;

  select pg_catalog.count(*) into current_token_count
  from programmable_private.current_launch_projections_v1 as launch
  join programmable_private.run_headers as run
    on run.run_id = launch.projection_run_id
   and run.run_kind = 'projection'
  join lateral pg_catalog.jsonb_array_elements(
    route_snapshot.release_pointers
  ) as pointer(value)
    on pointer.value ->> 'releaseVersion' = launch.release_id
   and pointer.value ->> 'modelVersion' = launch.model_id
   and pointer.value ->> 'sourceGroup' = run.source_group
   and (pointer.value ->> 'epochId')::uuid = launch.epoch_id
   and (pointer.value ->> 'pointerGeneration')::bigint =
      launch.pointer_generation
  where launch.chain_id = p_chain_id
    and launch.creator = account_address;

  select pg_catalog.count(*) into current_claim_count
  from programmable_private.claim_history_v1 as claim
  join lateral pg_catalog.jsonb_array_elements(
    route_snapshot.release_pointers
  ) as pointer(value)
    on pointer.value ->> 'releaseVersion' = claim.release_id
   and pointer.value ->> 'modelVersion' = claim.model_id
   and pointer.value ->> 'sourceGroup' = claim.source_group
   and (pointer.value ->> 'epochId')::uuid = claim.epoch_id
   and (pointer.value ->> 'pointerGeneration')::bigint =
      claim.pointer_generation
  where claim.chain_id = p_chain_id
    and claim.release_id = 'classic-v2'
    and claim.model_id = 'classic'
    and claim.claimant_kind = 'creator'
    and claim.creator = account_address;

  with records as (
    select *
    from programmable_private.public_creator_profile_v1 as item
    where item.chain_id = p_chain_id
      and item.account = account_address
      and item.checkpoint_block_number =
        route_snapshot.checkpoint_block_number
      and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash
  ), aggregates as (
    select
      pg_catalog.count(*) filter (
        where record_kind = 'token'
      ) as token_count,
      pg_catalog.count(*) filter (
        where record_kind = 'claim'
      ) as claim_count,
      coalesce(pg_catalog.jsonb_agg(record_payload order by
        record_payload #>> '{source,promotedBlockNumber}',
        record_payload #>> '{tokenAddress}'
      ) filter (where record_kind = 'token'), '[]'::jsonb) as tokens,
      coalesce(pg_catalog.jsonb_agg(record_payload order by
        (record_payload ->> 'blockNumber')::bigint desc,
        (record_payload ->> 'transactionIndex')::bigint desc,
        (record_payload ->> 'logIndex')::bigint desc,
        record_payload ->> 'transactionHash' desc
      ) filter (where record_kind = 'claim'), '[]'::jsonb) as claims
    from records
  ), scopes as (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'model', scope.model_id,
        'releaseVersion', scope.release_id
      ) order by scope.release_id, scope.model_id
    ), '[]'::jsonb) as value
    from (
      select distinct release_id, model_id from records
    ) as scope
  )
  select aggregate.token_count, aggregate.claim_count,
    aggregate.tokens, aggregate.claims, scopes.value
  into public_token_count, public_claim_count,
    profile_tokens, profile_claims, profile_scopes
  from aggregates as aggregate cross join scopes;
  if public_token_count <> current_token_count
     or public_claim_count <> current_claim_count
  then return; end if;

  http_status := 200;
  payload := pg_catalog.jsonb_build_object(
    'status', 'ready',
    'snapshot', programmable_private.build_public_snapshot_identity_v2(
      route_snapshot.snapshot_commitment_hex,
      route_snapshot.chain_id,
      route_snapshot.checkpoint_block_number,
      route_snapshot.checkpoint_block_hash,
      route_snapshot.checkpoint_confirmations,
      route_snapshot.snapshot_captured_at,
      route_snapshot.release_pointers
    ),
    'data', pg_catalog.jsonb_build_object(
      'account', canonical_account,
      'tokens', profile_tokens,
      'claims', profile_claims
    )
  );
  payload_complete := true;
  record_count := public_token_count + public_claim_count;
  record_scopes := profile_scopes;
  comparison_checkpoint_block_number :=
    route_snapshot.checkpoint_block_number;
  comparison_checkpoint_block_hash := route_snapshot.checkpoint_block_hash;
  route_evidence := route_snapshot.route_evidence;
  return next;
end
$function$;

create view programmable_private.public_classic_v3_profile_v1
with (security_invoker = false, security_barrier = true)
as
select
  reward.chain_id,
  reward.account,
  reward.release_id,
  reward.model_id,
  reward.vault,
  snapshot.checkpoint_block_number,
  snapshot.checkpoint_block_hash,
  pg_catalog.jsonb_build_object(
    'source', programmable_private.retarget_indexed_token_projection_v2(
      detail.payload #> '{data,token}', pointer.value,
      snapshot.snapshot_commitment_hex
    ) -> 'source',
    'tokenAddress', detail.payload #>> '{data,token,tokenAddress}',
    'tokenName', detail.payload #>> '{data,token,name}',
    'tokenSymbol', detail.payload #>> '{data,token,symbol}',
    'poolId', detail.payload #>> '{data,token,poolId}',
    'vaultAddress', '0x' || pg_catalog.encode(reward.vault, 'hex'),
    'claimableWei', reward.claimable_accrued::text,
    'claimedWei', reward.claimed_total::text,
    'buySwapFeeBps',
      (detail.payload #>> '{data,token,fees,buySwapFeeBps}')::integer,
    'sellSwapFeeBps',
      (detail.payload #>> '{data,token,fees,sellSwapFeeBps}')::integer,
    'platformFeeBps',
      (detail.payload #>> '{data,token,fees,launcherFeeBps}')::integer,
    'allocations', pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'allocationIndex', allocation.allocation_index,
        'beneficiary', '0x' || pg_catalog.encode(
          allocation.beneficiary, 'hex'
        ),
        'payoutAddress', '0x' || pg_catalog.encode(
          allocation.payout_address, 'hex'
        ),
        'shareBps', allocation.share_bps
      ) order by allocation.allocation_index
    ),
    'launchTransactionHash',
      detail.payload #>> '{data,token,launchTransactionHash}'
  ) as reward_payload,
  snapshot.release_pointers,
  snapshot.record_scopes as snapshot_record_scopes,
  snapshot.route_evidence,
  snapshot.snapshot_commitment_hex,
  snapshot.snapshot_captured_at,
  snapshot.safe_block_number,
  snapshot.checkpoint_confirmations
from programmable_private.account_reward_summaries_v1 as reward
join programmable_private.route_token_projections_v1 as token
  on token.route_key = 'explore-token'
 and token.chain_id = reward.chain_id
 and token.release_id = reward.release_id
 and token.model_id = reward.model_id
 and token.token = reward.token
 and token.pool_id = reward.pool_id
 and token.reward_vault = reward.vault
 and token.route_status = 'eligible'
 and token.route_mode = 'indexed'
 and token.parity_status = 'current'
 and token.payload_complete
join programmable_private.public_explore_token_v1 as detail
  on detail.chain_id = token.chain_id
 and detail.release_id = token.release_id
 and detail.model_id = token.model_id
 and detail.source_group = token.source_group
 and detail.epoch_id = token.epoch_id
 and detail.pointer_generation = token.pointer_generation
 and detail.payload #>> '{data,token,tokenAddress}' =
   '0x' || pg_catalog.encode(token.token, 'hex')
join programmable_private.public_route_snapshots_v2 as snapshot
  on snapshot.route_key = 'classic-v3-profile'
 and snapshot.snapshot_scope = 'classic-v3'
 and snapshot.chain_id = reward.chain_id
 and snapshot.checkpoint_block_number = token.checkpoint_block_number
 and snapshot.checkpoint_block_hash = token.checkpoint_block_hash
join programmable_private.route_snapshot_readiness_v1 as readiness
  on readiness.route_key = 'classic-v3-profile'
 and readiness.chain_id = token.chain_id
 and readiness.release_id = token.release_id
 and readiness.model_id = token.model_id
 and readiness.source_group = token.source_group
 and readiness.epoch_id = token.epoch_id
 and readiness.pointer_generation = token.pointer_generation
 and readiness.checkpoint_block_number = snapshot.checkpoint_block_number
 and readiness.checkpoint_block_hash = snapshot.checkpoint_block_hash
 and readiness.route_status = 'eligible'
 and readiness.route_mode = 'indexed'
 and readiness.parity_status = 'current'
join lateral pg_catalog.jsonb_array_elements(
  snapshot.release_pointers
) as pointer(value)
  on pointer.value ->> 'releaseVersion' = token.release_id
 and pointer.value ->> 'modelVersion' = token.model_id
 and pointer.value ->> 'sourceGroup' = token.source_group
join programmable_private.classic_v3_vault_history_v1 as allocation
  on allocation.chain_id = reward.chain_id
 and allocation.release_id = reward.release_id
 and allocation.model_id = reward.model_id
 and allocation.vault = reward.vault
 and allocation.pool_id = reward.pool_id
 and allocation.effective_to_block is null
where reward.release_id = 'classic-v3'
  and reward.model_id = 'classic'
  and exists (
    select 1
    from programmable_private.classic_v3_vault_history_v1 as owned
    where owned.chain_id = reward.chain_id
      and owned.release_id = reward.release_id
      and owned.model_id = reward.model_id
      and owned.vault = reward.vault
      and owned.pool_id = reward.pool_id
      and owned.effective_to_block is null
      and owned.beneficiary = reward.account
  )
group by
  reward.chain_id, reward.account, reward.release_id, reward.model_id,
  reward.vault, reward.claimable_accrued, reward.claimed_total,
  detail.payload, pointer.value, snapshot.checkpoint_block_number,
  snapshot.checkpoint_block_hash, snapshot.release_pointers,
  snapshot.record_scopes, snapshot.route_evidence,
  snapshot.snapshot_commitment_hex, snapshot.snapshot_captured_at,
  snapshot.safe_block_number, snapshot.checkpoint_confirmations
having pg_catalog.count(*) between 1 and 5
  and pg_catalog.count(distinct allocation.allocation_index) =
    pg_catalog.count(*)
  and pg_catalog.sum(allocation.share_bps) = 10000
  and pg_catalog.bool_and(
    allocation.beneficiary = allocation.payout_address
  );

create function programmable_private.get_public_classic_v3_profile_v1(
  p_chain_id bigint,
  p_account text
)
returns table (
  http_status integer,
  payload jsonb,
  payload_complete boolean,
  record_count bigint,
  record_scopes jsonb,
  comparison_checkpoint_block_number bigint,
  comparison_checkpoint_block_hash bytea,
  route_evidence jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  route_snapshot programmable_private.public_route_snapshots_v2%rowtype;
  account_address bytea;
  canonical_account text;
  current_count bigint;
  public_count bigint;
  rewards jsonb;
  scopes jsonb;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id not in (1, 11155111) then
    raise exception using
      errcode = '22023', message = 'invalid Classic-v3 profile chain';
  end if;
  account_address := programmable_private.decode_public_address_v1(p_account);
  canonical_account := '0x' || pg_catalog.encode(account_address, 'hex');
  select * into route_snapshot
  from programmable_private.public_route_snapshots_v2
  where route_key = 'classic-v3-profile'
    and snapshot_scope = 'classic-v3'
    and chain_id = p_chain_id;
  if not found then return; end if;

  select pg_catalog.count(*) into current_count
  from programmable_private.account_reward_summaries_v1 as reward
  join lateral pg_catalog.jsonb_array_elements(
    route_snapshot.release_pointers
  ) as pointer(value)
    on pointer.value ->> 'releaseVersion' = reward.release_id
   and pointer.value ->> 'modelVersion' = reward.model_id
  where reward.chain_id = p_chain_id
    and reward.release_id = 'classic-v3'
    and reward.model_id = 'classic'
    and reward.account = account_address
    and exists (
      select 1
      from programmable_private.classic_v3_vault_history_v1 as owned
      where owned.chain_id = reward.chain_id
        and owned.release_id = reward.release_id
        and owned.model_id = reward.model_id
        and owned.vault = reward.vault
        and owned.pool_id = reward.pool_id
        and owned.effective_to_block is null
        and owned.beneficiary = reward.account
    );

  select pg_catalog.count(*),
    coalesce(pg_catalog.jsonb_agg(reward.reward_payload order by
      reward.reward_payload ->> 'vaultAddress'
    ), '[]'::jsonb),
    coalesce(pg_catalog.jsonb_agg(distinct pg_catalog.jsonb_build_object(
      'model', reward.model_id,
      'releaseVersion', reward.release_id
    )), '[]'::jsonb)
  into public_count, rewards, scopes
  from programmable_private.public_classic_v3_profile_v1 as reward
  where reward.chain_id = p_chain_id
    and reward.account = account_address
    and reward.checkpoint_block_number =
      route_snapshot.checkpoint_block_number
    and reward.checkpoint_block_hash = route_snapshot.checkpoint_block_hash;
  if public_count <> current_count then return; end if;

  http_status := 200;
  payload := pg_catalog.jsonb_build_object(
    'status', 'ready',
    'snapshot', programmable_private.build_public_snapshot_identity_v2(
      route_snapshot.snapshot_commitment_hex,
      route_snapshot.chain_id,
      route_snapshot.checkpoint_block_number,
      route_snapshot.checkpoint_block_hash,
      route_snapshot.checkpoint_confirmations,
      route_snapshot.snapshot_captured_at,
      route_snapshot.release_pointers
    ),
    'data', pg_catalog.jsonb_build_object(
      'account', canonical_account,
      'chainId', p_chain_id,
      'rewards', rewards
    )
  );
  payload_complete := true;
  record_count := public_count;
  record_scopes := scopes;
  comparison_checkpoint_block_number :=
    route_snapshot.checkpoint_block_number;
  comparison_checkpoint_block_hash := route_snapshot.checkpoint_block_hash;
  route_evidence := route_snapshot.route_evidence;
  return next;
end
$function$;

create view programmable_private.public_stock_paired_profile_v1
with (security_invoker = false, security_barrier = true)
as
select
  reward.chain_id,
  reward.account,
  reward.release_id,
  reward.model_id,
  reward.vault,
  snapshot.checkpoint_block_number,
  snapshot.checkpoint_block_hash,
  pg_catalog.jsonb_build_object(
    'source', programmable_private.retarget_indexed_token_projection_v2(
      detail.payload #> '{data,token}', pointer.value,
      snapshot.snapshot_commitment_hex
    ) -> 'source',
    'tokenAddress', detail.payload #>> '{data,token,tokenAddress}',
    'tokenName', detail.payload #>> '{data,token,name}',
    'tokenSymbol', detail.payload #>> '{data,token,symbol}',
    'imageUrl', detail.payload #>> '{data,token,metadata,imageUrl}',
    'hookAddress', detail.payload #>> '{data,token,hookAddress}',
    'poolId', detail.payload #>> '{data,token,poolId}',
    'vaultAddress', '0x' || pg_catalog.encode(reward.vault, 'hex'),
    'quoteAsset', detail.payload #>> '{data,token,quote,address}',
    'quoteAssetSymbol', detail.payload #>> '{data,token,quote,symbol}',
    'beneficiary', '0x' || pg_catalog.encode(
      owned.beneficiary, 'hex'
    ),
    'payoutAddress', '0x' || pg_catalog.encode(
      owned.payout_address, 'hex'
    ),
    'shareBps', owned.share_bps,
    'claimableRaw', reward.claimable_accrued::text,
    'claimedRaw', reward.claimed_total::text,
    'generatedRaw', reward.entitled::text,
    'creatorFeesPendingRaw', reward.claimable_accrued::text,
    'beneficiaries', allocation.allocations,
    'buySwapFeeBps',
      (detail.payload #>> '{data,token,fees,buySwapFeeBps}')::integer,
    'sellSwapFeeBps',
      (detail.payload #>> '{data,token,fees,sellSwapFeeBps}')::integer,
    'programmableFeeBps',
      (detail.payload #>> '{data,token,fees,launcherFeeBps}')::integer,
    'launchTransactionHash',
      detail.payload #>> '{data,token,launchTransactionHash}',
    'estimate', null
  ) as reward_payload,
  snapshot.release_pointers,
  snapshot.record_scopes as snapshot_record_scopes,
  snapshot.route_evidence,
  snapshot.snapshot_commitment_hex,
  snapshot.snapshot_captured_at,
  snapshot.safe_block_number,
  snapshot.checkpoint_confirmations
from programmable_private.account_reward_summaries_v1 as reward
join programmable_private.route_token_projections_v1 as token
  on token.route_key = 'explore-token'
 and token.chain_id = reward.chain_id
 and token.release_id = reward.release_id
 and token.model_id = reward.model_id
 and token.token = reward.token
 and token.pool_id = reward.pool_id
 and token.reward_vault = reward.vault
 and token.route_status = 'eligible'
 and token.route_mode = 'indexed'
 and token.parity_status = 'current'
 and token.payload_complete
join programmable_private.public_explore_token_v1 as detail
  on detail.chain_id = token.chain_id
 and detail.release_id = token.release_id
 and detail.model_id = token.model_id
 and detail.source_group = token.source_group
 and detail.epoch_id = token.epoch_id
 and detail.pointer_generation = token.pointer_generation
 and detail.payload #>> '{data,token,tokenAddress}' =
   '0x' || pg_catalog.encode(token.token, 'hex')
join programmable_private.public_route_snapshots_v2 as snapshot
  on snapshot.route_key = 'creator-profile'
 and snapshot.snapshot_scope = 'stock-paired'
 and snapshot.chain_id = reward.chain_id
 and snapshot.checkpoint_block_number = token.checkpoint_block_number
 and snapshot.checkpoint_block_hash = token.checkpoint_block_hash
join programmable_private.route_snapshot_readiness_v1 as readiness
  on readiness.route_key = 'creator-profile'
 and readiness.chain_id = token.chain_id
 and readiness.release_id = token.release_id
 and readiness.model_id = token.model_id
 and readiness.source_group = token.source_group
 and readiness.epoch_id = token.epoch_id
 and readiness.pointer_generation = token.pointer_generation
 and readiness.checkpoint_block_number = snapshot.checkpoint_block_number
 and readiness.checkpoint_block_hash = snapshot.checkpoint_block_hash
 and readiness.route_status = 'eligible'
 and readiness.route_mode = 'indexed'
 and readiness.parity_status = 'current'
join lateral pg_catalog.jsonb_array_elements(
  snapshot.release_pointers
) as pointer(value)
  on pointer.value ->> 'releaseVersion' = token.release_id
 and pointer.value ->> 'modelVersion' = token.model_id
 and pointer.value ->> 'sourceGroup' = token.source_group
join programmable_private.stock_paired_vault_history_v1 as owned
  on owned.chain_id = reward.chain_id
 and owned.release_id = reward.release_id
 and owned.model_id = reward.model_id
 and owned.vault = reward.vault
 and owned.pool_id = reward.pool_id
 and owned.effective_to_block is null
 and owned.beneficiary = reward.account
join lateral (
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'beneficiary', '0x' || pg_catalog.encode(
        item.beneficiary, 'hex'
      ),
      'payoutAddress', '0x' || pg_catalog.encode(
        item.payout_address, 'hex'
      ),
      'shareBps', item.share_bps
    ) order by item.allocation_index
  ) as allocations,
  pg_catalog.count(*) as allocation_count,
  pg_catalog.sum(item.share_bps) as total_share_bps
  from programmable_private.stock_paired_vault_history_v1 as item
  where item.chain_id = reward.chain_id
    and item.release_id = reward.release_id
    and item.model_id = reward.model_id
    and item.vault = reward.vault
    and item.pool_id = reward.pool_id
    and item.effective_to_block is null
) as allocation on allocation.allocation_count between 1 and 8
  and allocation.total_share_bps = 10000
where reward.release_id in (
    'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
  )
  and reward.model_id = 'stock-paired'
  and detail.payload #>> '{data,token,quote,address}' is not null
  and detail.payload #>> '{data,token,quote,symbol}' is not null;

create function programmable_private.get_public_stock_paired_profile_v1(
  p_chain_id bigint,
  p_account text
)
returns table (
  http_status integer,
  payload jsonb,
  payload_complete boolean,
  record_count bigint,
  record_scopes jsonb,
  comparison_checkpoint_block_number bigint,
  comparison_checkpoint_block_hash bytea,
  route_evidence jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  route_snapshot programmable_private.public_route_snapshots_v2%rowtype;
  account_address bytea;
  canonical_account text;
  current_count bigint;
  public_count bigint;
  rewards jsonb;
  scopes jsonb;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id <> 1 then
    raise exception using
      errcode = '22023', message = 'invalid Stock-paired profile chain';
  end if;
  account_address := programmable_private.decode_public_address_v1(p_account);
  canonical_account := '0x' || pg_catalog.encode(account_address, 'hex');
  select * into route_snapshot
  from programmable_private.public_route_snapshots_v2
  where route_key = 'creator-profile'
    and snapshot_scope = 'stock-paired'
    and chain_id = p_chain_id;
  if not found then return; end if;

  select pg_catalog.count(*) into current_count
  from programmable_private.account_reward_summaries_v1 as reward
  join lateral pg_catalog.jsonb_array_elements(
    route_snapshot.release_pointers
  ) as pointer(value)
    on pointer.value ->> 'releaseVersion' = reward.release_id
   and pointer.value ->> 'modelVersion' = reward.model_id
  where reward.chain_id = p_chain_id
    and reward.model_id = 'stock-paired'
    and reward.account = account_address
    and exists (
      select 1
      from programmable_private.stock_paired_vault_history_v1 as owned
      where owned.chain_id = reward.chain_id
        and owned.release_id = reward.release_id
        and owned.model_id = reward.model_id
        and owned.vault = reward.vault
        and owned.pool_id = reward.pool_id
        and owned.effective_to_block is null
        and owned.beneficiary = reward.account
    );

  select pg_catalog.count(*),
    coalesce(pg_catalog.jsonb_agg(reward.reward_payload order by
      reward.reward_payload ->> 'vaultAddress'
    ), '[]'::jsonb),
    coalesce(pg_catalog.jsonb_agg(distinct pg_catalog.jsonb_build_object(
      'model', reward.model_id,
      'releaseVersion', reward.release_id
    )), '[]'::jsonb)
  into public_count, rewards, scopes
  from programmable_private.public_stock_paired_profile_v1 as reward
  where reward.chain_id = p_chain_id
    and reward.account = account_address
    and reward.checkpoint_block_number =
      route_snapshot.checkpoint_block_number
    and reward.checkpoint_block_hash = route_snapshot.checkpoint_block_hash;
  if public_count <> current_count then return; end if;

  http_status := 200;
  payload := pg_catalog.jsonb_build_object(
    'status', 'ready',
    'snapshot', programmable_private.build_public_snapshot_identity_v2(
      route_snapshot.snapshot_commitment_hex,
      route_snapshot.chain_id,
      route_snapshot.checkpoint_block_number,
      route_snapshot.checkpoint_block_hash,
      route_snapshot.checkpoint_confirmations,
      route_snapshot.snapshot_captured_at,
      route_snapshot.release_pointers
    ),
    'data', pg_catalog.jsonb_build_object(
      'account', canonical_account,
      'chainId', p_chain_id,
      'rewards', rewards
    )
  );
  payload_complete := true;
  record_count := public_count;
  record_scopes := scopes;
  comparison_checkpoint_block_number :=
    route_snapshot.checkpoint_block_number;
  comparison_checkpoint_block_hash := route_snapshot.checkpoint_block_hash;
  route_evidence := route_snapshot.route_evidence;
  return next;
end
$function$;

create view programmable_private.public_launch_lookup_v1
with (security_invoker = false, security_barrier = true)
as
select
  token.chain_id,
  case
    when token.release_id = 'classic-v3' then 'classic-v3'
    else 'stock-paired'
  end::text as surface,
  token.creator as account,
  token.launch_transaction_hash,
  token.release_id,
  token.model_id,
  token.source_group,
  snapshot.checkpoint_block_number,
  snapshot.checkpoint_block_hash,
  programmable_private.retarget_indexed_token_projection_v2(
    detail.payload #> '{data,token}', pointer.value,
    snapshot.snapshot_commitment_hex
  ) as token_payload,
  snapshot.release_pointers,
  snapshot.record_scopes as snapshot_record_scopes,
  snapshot.route_evidence,
  snapshot.snapshot_commitment_hex,
  snapshot.snapshot_captured_at,
  snapshot.safe_block_number,
  snapshot.checkpoint_confirmations
from programmable_private.route_token_projections_v1 as token
join programmable_private.public_explore_token_v1 as detail
  on detail.chain_id = token.chain_id
 and detail.release_id = token.release_id
 and detail.model_id = token.model_id
 and detail.source_group = token.source_group
 and detail.epoch_id = token.epoch_id
 and detail.pointer_generation = token.pointer_generation
 and detail.payload #>> '{data,token,tokenAddress}' =
   '0x' || pg_catalog.encode(token.token, 'hex')
join programmable_private.public_route_snapshots_v2 as snapshot
  on snapshot.route_key = 'launch-lookup'
 and snapshot.snapshot_scope = case
   when token.release_id = 'classic-v3' then 'classic-v3'
   else 'stock-paired'
 end
 and snapshot.chain_id = token.chain_id
 and snapshot.checkpoint_block_number = token.checkpoint_block_number
 and snapshot.checkpoint_block_hash = token.checkpoint_block_hash
join programmable_private.route_snapshot_readiness_v1 as readiness
  on readiness.route_key = 'launch-lookup'
 and readiness.chain_id = token.chain_id
 and readiness.release_id = token.release_id
 and readiness.model_id = token.model_id
 and readiness.source_group = token.source_group
 and readiness.epoch_id = token.epoch_id
 and readiness.pointer_generation = token.pointer_generation
 and readiness.checkpoint_block_number = snapshot.checkpoint_block_number
 and readiness.checkpoint_block_hash = snapshot.checkpoint_block_hash
 and readiness.route_status = 'eligible'
 and readiness.route_mode = 'indexed'
 and readiness.parity_status = 'current'
join lateral pg_catalog.jsonb_array_elements(
  snapshot.release_pointers
) as pointer(value)
  on pointer.value ->> 'releaseVersion' = token.release_id
 and pointer.value ->> 'modelVersion' = token.model_id
 and pointer.value ->> 'sourceGroup' = token.source_group
where token.route_key = 'explore-token'
  and token.route_status = 'eligible'
  and token.route_mode = 'indexed'
  and token.parity_status = 'current'
  and token.payload_complete
  and (
    token.release_id = 'classic-v3' and token.model_id = 'classic'
    or token.release_id in (
      'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
    ) and token.model_id = 'stock-paired'
  );

create function programmable_private.get_public_launch_lookup_v1(
  p_chain_id bigint,
  p_surface text,
  p_account text,
  p_transaction_hash text
)
returns table (
  http_status integer,
  payload jsonb,
  payload_complete boolean,
  record_count bigint,
  record_scopes jsonb,
  comparison_checkpoint_block_number bigint,
  comparison_checkpoint_block_hash bytea,
  route_evidence jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  route_snapshot programmable_private.public_route_snapshots_v2%rowtype;
  account_address bytea;
  transaction_hash bytea;
  canonical_account text;
  canonical_transaction_hash text;
  current_count bigint;
  public_count bigint;
  selected programmable_private.public_launch_lookup_v1%rowtype;
  resolution text;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id not in (1, 11155111)
     or p_surface not in ('classic-v3', 'stock-paired')
  then
    raise exception using
      errcode = '22023', message = 'invalid launch-lookup request';
  end if;
  account_address := programmable_private.decode_public_address_v1(p_account);
  transaction_hash := programmable_private.decode_public_bytes32_v1(
    p_transaction_hash
  );
  canonical_account := '0x' || pg_catalog.encode(account_address, 'hex');
  canonical_transaction_hash :=
    '0x' || pg_catalog.encode(transaction_hash, 'hex');

  select * into route_snapshot
  from programmable_private.public_route_snapshots_v2
  where route_key = 'launch-lookup'
    and snapshot_scope = p_surface
    and chain_id = p_chain_id;
  if not found then return; end if;

  select pg_catalog.count(*) into current_count
  from programmable_private.current_launch_projections_v1 as launch
  join programmable_private.run_headers as run
    on run.run_id = launch.projection_run_id
   and run.run_kind = 'projection'
  join lateral pg_catalog.jsonb_array_elements(
    route_snapshot.release_pointers
  ) as pointer(value)
    on pointer.value ->> 'releaseVersion' = launch.release_id
   and pointer.value ->> 'modelVersion' = launch.model_id
   and pointer.value ->> 'sourceGroup' = run.source_group
   and (pointer.value ->> 'epochId')::uuid = launch.epoch_id
   and (pointer.value ->> 'pointerGeneration')::bigint =
      launch.pointer_generation
  where launch.chain_id = p_chain_id
    and launch.creator = account_address
    and launch.launch_transaction_hash = transaction_hash;
  if current_count > 1 then
    raise exception using
      errcode = '23514', message = 'launch lookup is ambiguous';
  end if;

  select pg_catalog.count(*) into public_count
  from programmable_private.public_launch_lookup_v1 as item
  where item.chain_id = p_chain_id
    and item.surface = p_surface
    and item.account = account_address
    and item.launch_transaction_hash = transaction_hash
    and item.checkpoint_block_number =
      route_snapshot.checkpoint_block_number
    and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash;
  if public_count > 1 then
    raise exception using
      errcode = '23514', message = 'public launch lookup is ambiguous';
  end if;
  if current_count = 1 and public_count = 0 then return; end if;

  if public_count = 1 then
    select * into selected
    from programmable_private.public_launch_lookup_v1 as item
    where item.chain_id = p_chain_id
      and item.surface = p_surface
      and item.account = account_address
      and item.launch_transaction_hash = transaction_hash
      and item.checkpoint_block_number =
        route_snapshot.checkpoint_block_number
      and item.checkpoint_block_hash = route_snapshot.checkpoint_block_hash;
    resolution := 'found';
    http_status := 200;
    record_count := 1;
    record_scopes := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'model', selected.model_id,
        'releaseVersion', selected.release_id
      )
    );
  else
    resolution := case
      when p_surface = 'classic-v3' then 'not-found'
      else 'pending'
    end;
    http_status := case
      when p_surface = 'classic-v3' then 200
      else 202
    end;
    record_count := 0;
    record_scopes := '[]'::jsonb;
  end if;

  payload := pg_catalog.jsonb_build_object(
    'status', 'ready',
    'snapshot', programmable_private.build_public_snapshot_identity_v2(
      route_snapshot.snapshot_commitment_hex,
      route_snapshot.chain_id,
      route_snapshot.checkpoint_block_number,
      route_snapshot.checkpoint_block_hash,
      route_snapshot.checkpoint_confirmations,
      route_snapshot.snapshot_captured_at,
      route_snapshot.release_pointers
    ),
    'data', pg_catalog.jsonb_build_object(
      'surface', p_surface,
      'account', canonical_account,
      'transactionHash', canonical_transaction_hash,
      'resolution', resolution,
      'token', case when public_count = 1
        then selected.token_payload else null end
    )
  );
  payload_complete := true;
  comparison_checkpoint_block_number :=
    route_snapshot.checkpoint_block_number;
  comparison_checkpoint_block_hash := route_snapshot.checkpoint_block_hash;
  route_evidence := route_snapshot.route_evidence;
  return next;
end
$function$;

create view programmable_private.read_model_performance_eligible_launches_v1
with (security_invoker = false, security_barrier = true)
as
select
  launch.chain_id,
  launch.release_id,
  launch.model_id,
  run.source_group,
  launch.creator as account,
  launch.launch_transaction_hash as transaction_hash,
  launch.token as token_address,
  launch.projection_run_id,
  launch.promoted_block_number,
  launch.promoted_block_hash
from programmable_private.current_launch_projections_v1 as launch
join programmable_private.run_headers as run
  on run.run_id = launch.projection_run_id
 and run.run_kind = 'projection'
 and run.chain_id = launch.chain_id
 and run.release_id = launch.release_id
 and run.model_id = launch.model_id
 and run.epoch_id = launch.epoch_id
 and run.captured_pointer_generation = launch.pointer_generation
join programmable_private.route_eligibility_current_exact_v1 as route
  on route.route_key = 'explore-token'
 and route.chain_id = launch.chain_id
 and route.release_id = launch.release_id
 and route.model_id = launch.model_id
 and route.source_group = run.source_group
 and route.epoch_id = launch.epoch_id
 and route.pointer_generation = launch.pointer_generation
 and route.status = 'eligible'
 and route.route_mode = 'indexed'
where launch.is_complete
  and (
    launch.release_id in ('classic-v2', 'classic-v3')
      and launch.model_id = 'classic'
    or launch.release_id in (
      'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
    ) and launch.model_id = 'stock-paired'
  );

create function programmable_private.get_read_model_performance_dataset_v1(
  p_chain_id bigint
)
returns table (
  generated_at timestamptz,
  launch_count bigint,
  eligible_launch_count bigint,
  chain_event_count bigint,
  market_snapshot_count bigint,
  market_candle_count bigint,
  account_count bigint,
  reward_row_count bigint,
  candidate_count bigint,
  release_coverage jsonb,
  eligible_launches jsonb,
  token_addresses jsonb,
  account_addresses jsonb,
  account_evidence jsonb,
  classic_launches jsonb,
  stock_launches jsonb,
  candidate_ids jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_chain_id not in (1, 11155111) then
    raise exception using
      errcode = '22023', message = 'invalid performance dataset chain';
  end if;

  return query
  with eligible as materialized (
    select launch.*
    from programmable_private.read_model_performance_eligible_launches_v1
      as launch
    where launch.chain_id = p_chain_id
  ), release_counts as (
    select
      pg_catalog.count(*) as total_count,
      pg_catalog.count(*) filter (
        where release_id = 'classic-v2'
      ) as classic_v2_count,
      pg_catalog.count(*) filter (
        where release_id = 'classic-v3'
      ) as classic_v3_count,
      pg_catalog.count(*) filter (
        where release_id = 'stock-paired-v1'
      ) as stock_v1_count,
      pg_catalog.count(*) filter (
        where release_id = 'stock-paired-v2'
      ) as stock_v2_count,
      pg_catalog.count(*) filter (
        where release_id = 'stock-paired-v3'
      ) as stock_v3_count,
      pg_catalog.count(distinct token_address) as unique_tokens,
      pg_catalog.count(distinct transaction_hash) as unique_transactions
    from eligible
  ), eligible_payload as (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'account', '0x' || pg_catalog.encode(account, 'hex'),
        'transactionHash', '0x' || pg_catalog.encode(
          transaction_hash, 'hex'
        ),
        'tokenAddress', '0x' || pg_catalog.encode(
          token_address, 'hex'
        ),
        'releaseVersion', release_id
      ) order by release_id, token_address, transaction_hash, account
    ), '[]'::jsonb) as value
    from eligible
  ), token_sample as (
    select coalesce(pg_catalog.jsonb_agg(sample.address order by sample.address),
      '[]'::jsonb) as value,
      pg_catalog.count(*) as sample_count
    from (
      select distinct
        '0x' || pg_catalog.encode(token_address, 'hex') as address
      from eligible
      order by address
      limit 100
    ) as sample
  ), live_accounts as materialized (
    select account,
      pg_catalog.sum(profile_rows)::bigint as profile_rows,
      pg_catalog.sum(reward_rows)::bigint as reward_rows
    from (
      select account, pg_catalog.count(*)::bigint as profile_rows,
        0::bigint as reward_rows
      from eligible
      group by account
      union all
      select balance.account, 0::bigint,
        pg_catalog.count(*)::bigint
      from programmable_private.current_account_reward_balances_v1 as balance
      where balance.chain_id = p_chain_id
        and (
          balance.release_id in ('classic-v2', 'classic-v3')
            and balance.model_id = 'classic'
          or balance.release_id in (
            'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
          ) and balance.model_id = 'stock-paired'
        )
      group by balance.account
    ) as evidence
    group by account
  ), account_sample as (
    select coalesce(pg_catalog.jsonb_agg(sample.address order by sample.address),
      '[]'::jsonb) as value,
      coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'account', sample.address,
          'profileRows', sample.profile_rows,
          'rewardRows', sample.reward_rows
        ) order by sample.address
      ), '[]'::jsonb) as evidence,
      pg_catalog.count(*) as sample_count,
      coalesce(pg_catalog.sum(sample.profile_rows), 0) as profile_rows,
      coalesce(pg_catalog.sum(sample.reward_rows), 0) as reward_rows,
      pg_catalog.bool_and(
        sample.profile_rows >= 0
        and sample.reward_rows >= 0
        and sample.profile_rows + sample.reward_rows > 0
      ) as all_backed
    from (
      select '0x' || pg_catalog.encode(account, 'hex') as address,
        profile_rows, reward_rows
      from live_accounts
      order by account
      limit 100
    ) as sample
  ), classic_sample as (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'account', '0x' || pg_catalog.encode(sample.account, 'hex'),
        'transactionHash', '0x' || pg_catalog.encode(
          sample.transaction_hash, 'hex'
        )
      ) order by sample.account, sample.transaction_hash
    ), '[]'::jsonb) as value,
    pg_catalog.count(*) as sample_count
    from (
      select distinct account, transaction_hash
      from eligible
      where release_id = 'classic-v3' and model_id = 'classic'
      order by account, transaction_hash
      limit 32
    ) as sample
  ), stock_sample as (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'account', '0x' || pg_catalog.encode(sample.account, 'hex'),
        'transactionHash', '0x' || pg_catalog.encode(
          sample.transaction_hash, 'hex'
        )
      ) order by sample.account, sample.transaction_hash
    ), '[]'::jsonb) as value,
    pg_catalog.count(*) as sample_count
    from (
      select distinct account, transaction_hash
      from eligible
      where model_id = 'stock-paired'
      order by account, transaction_hash
      limit 32
    ) as sample
  ), canonical_candidates as materialized (
    select
      occurrence.first_seen_envio_candidate_id as candidate_id,
      occurrence.block_number,
      occurrence.transaction_hash,
      occurrence.transaction_index,
      occurrence.block_global_log_index,
      occurrence.source_address,
      pg_catalog.row_number() over (
        partition by occurrence.block_number
        order by occurrence.transaction_index,
          occurrence.block_global_log_index,
          occurrence.transaction_hash,
          occurrence.first_seen_envio_candidate_id
      ) as block_rank
    from programmable_private.chain_event_current_canonical as canonical
    join programmable_private.chain_event_materialized_occurrences_v1
      as occurrence
      on occurrence.occurrence_id = canonical.occurrence_id
     and occurrence.logical_event_id = canonical.logical_event_id
     and occurrence.block_hash = canonical.block_hash
    join programmable_private.release_epoch_current as current_epoch
      on current_epoch.chain_id = occurrence.chain_id
     and current_epoch.release_id = occurrence.release_id
     and current_epoch.model_id = occurrence.model_id
     and current_epoch.source_group = occurrence.source_group
     and current_epoch.epoch_id = occurrence.epoch_id
     and current_epoch.generation = occurrence.pointer_generation
    where occurrence.chain_id = p_chain_id
      and occurrence.first_seen_envio_candidate_id is not null
      and (
        occurrence.release_id in ('classic-v2', 'classic-v3')
          and occurrence.model_id = 'classic'
        or occurrence.release_id in (
          'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
        ) and occurrence.model_id = 'stock-paired'
      )
  ), selected_candidates as materialized (
    select *
    from canonical_candidates
    where block_rank = 1
    order by block_number, transaction_index, block_global_log_index,
      transaction_hash, candidate_id
    limit 8
  ), candidate_sample as (
    select coalesce(pg_catalog.jsonb_agg(candidate_id order by
      block_number, transaction_index, block_global_log_index,
      transaction_hash, candidate_id
    ), '[]'::jsonb) as value,
    pg_catalog.count(*) as sample_count,
    pg_catalog.count(distinct block_number) as distinct_blocks,
    pg_catalog.count(distinct transaction_hash) as distinct_transactions,
    pg_catalog.count(distinct (block_number, source_address))
      as distinct_block_sources
    from selected_candidates
  ), evidence_counts as (
    select
      (
        select pg_catalog.count(distinct canonical.occurrence_id)
        from programmable_private.chain_event_current_canonical as canonical
        join programmable_private.chain_event_materialized_occurrences_v1
          as occurrence
          on occurrence.occurrence_id = canonical.occurrence_id
         and occurrence.logical_event_id = canonical.logical_event_id
         and occurrence.block_hash = canonical.block_hash
        join programmable_private.release_epoch_current as current_epoch
          on current_epoch.chain_id = occurrence.chain_id
         and current_epoch.release_id = occurrence.release_id
         and current_epoch.model_id = occurrence.model_id
         and current_epoch.source_group = occurrence.source_group
         and current_epoch.epoch_id = occurrence.epoch_id
         and current_epoch.generation = occurrence.pointer_generation
        where occurrence.chain_id = p_chain_id
          and (
            occurrence.release_id in ('classic-v2', 'classic-v3')
              and occurrence.model_id = 'classic'
            or occurrence.release_id in (
              'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
            ) and occurrence.model_id = 'stock-paired'
          )
      ) as chain_events,
      (
        select pg_catalog.count(*)
        from programmable_private.market_snapshots_v2 as snapshot
        where snapshot.chain_id = p_chain_id
          and (
            snapshot.release_id in ('classic-v2', 'classic-v3')
              and snapshot.model_id = 'classic'
            or snapshot.release_id in (
              'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
            ) and snapshot.model_id = 'stock-paired'
          )
      ) as market_snapshots,
      (
        select pg_catalog.count(*)
        from programmable_private.market_candles_v2 as candle
        where candle.chain_id = p_chain_id
          and (
            candle.release_id in ('classic-v2', 'classic-v3')
              and candle.model_id = 'classic'
            or candle.release_id in (
              'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
            ) and candle.model_id = 'stock-paired'
          )
      ) as market_candles,
      (select pg_catalog.count(*) from live_accounts) as accounts,
      (
        select pg_catalog.count(*)
        from programmable_private.current_account_reward_balances_v1
          as reward
        where reward.chain_id = p_chain_id
          and (
            reward.release_id in ('classic-v2', 'classic-v3')
              and reward.model_id = 'classic'
            or reward.release_id in (
              'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
            ) and reward.model_id = 'stock-paired'
          )
      ) as reward_rows,
      (select pg_catalog.count(*) from canonical_candidates)
        as candidates
  )
  select
    pg_catalog.transaction_timestamp(),
    release_counts.total_count,
    release_counts.total_count,
    evidence_counts.chain_events,
    evidence_counts.market_snapshots,
    evidence_counts.market_candles,
    evidence_counts.accounts,
    evidence_counts.reward_rows,
    evidence_counts.candidates,
    pg_catalog.jsonb_build_object(
      'classic-v2', release_counts.classic_v2_count,
      'classic-v3', release_counts.classic_v3_count,
      'stock-paired-v1', release_counts.stock_v1_count,
      'stock-paired-v2', release_counts.stock_v2_count,
      'stock-paired-v3', release_counts.stock_v3_count
    ),
    eligible_payload.value,
    token_sample.value,
    account_sample.value,
    account_sample.evidence,
    classic_sample.value,
    stock_sample.value,
    candidate_sample.value
  from release_counts
  cross join eligible_payload
  cross join token_sample
  cross join account_sample
  cross join classic_sample
  cross join stock_sample
  cross join candidate_sample
  cross join evidence_counts
  where release_counts.total_count >= 200
    and release_counts.classic_v2_count > 0
    and release_counts.classic_v3_count > 0
    and release_counts.stock_v1_count > 0
    and release_counts.stock_v2_count > 0
    and release_counts.stock_v3_count > 0
    and release_counts.total_count =
      release_counts.classic_v2_count
      + release_counts.classic_v3_count
      + release_counts.stock_v1_count
      + release_counts.stock_v2_count
      + release_counts.stock_v3_count
    and release_counts.unique_tokens = release_counts.total_count
    and release_counts.unique_transactions = release_counts.total_count
    and token_sample.sample_count = 100
    and account_sample.sample_count = 100
    and account_sample.all_backed
    and account_sample.profile_rows <= release_counts.total_count
    and account_sample.reward_rows <= evidence_counts.reward_rows
    and classic_sample.sample_count = 32
    and stock_sample.sample_count = 32
    and candidate_sample.sample_count = 8
    and candidate_sample.distinct_blocks = 8
    and candidate_sample.distinct_transactions = 8
    and candidate_sample.distinct_block_sources = 8;
end
$function$;

create function programmable_private.get_projector_reward_state_by_vault_v1(
  p_projection_run_id uuid,
  p_vault bytea
)
returns table (
  chain_id bigint,
  release_id text,
  model_id text,
  source_group text,
  epoch_id uuid,
  pointer_generation bigint,
  checkpoint_id uuid,
  projector_version text,
  checkpoint_generation bigint,
  reorg_generation bigint,
  checkpoint_block_number bigint,
  checkpoint_block_hash bytea,
  reward_vault_projection_id uuid,
  allocation_fact_id uuid,
  vault bytea,
  pool_id bytea,
  quote_asset bytea,
  configuration_hash bytea,
  configuration_epoch bigint,
  allocation_index integer,
  beneficiary bytea,
  payout_address bytea,
  share_bps integer,
  claimable_accrued numeric,
  claimed_total numeric,
  baseline_projection_run_id uuid,
  baseline_publication_commitment bytea,
  baseline_promoted_block_number bigint,
  baseline_promoted_block_hash bytea,
  balance_projection_run_id uuid,
  balance_publication_commitment bytea,
  balance_promoted_block_number bigint,
  balance_promoted_block_hash bytea,
  vault_source_occurrence_id uuid,
  vault_source_logical_event_id uuid,
  vault_source_block_hash bytea,
  allocation_source_occurrence_id uuid,
  allocation_source_logical_event_id uuid,
  allocation_source_block_hash bytea,
  balance_source_occurrence_id uuid,
  balance_source_logical_event_id uuid,
  balance_source_block_hash bytea,
  verified_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  baseline record;
  raw_vault_count bigint;
  baseline_count bigint;
  active_allocation_count bigint;
  eligible_row_count bigint;
  unique_allocation_count bigint;
  unique_beneficiary_count bigint;
  configuration_epoch_count bigint;
  total_share_bps bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_open_projection_run_v1(
    p_projection_run_id
  );
  select * into header
  from programmable_private.run_headers
  where run_id = p_projection_run_id and run_kind = 'projection';
  if p_vault is null or pg_catalog.octet_length(p_vault) <> 20 then
    raise exception using
      errcode = '22023', message = 'invalid reward-state vault';
  end if;

  select pg_catalog.count(*) into raw_vault_count
  from programmable_private.current_reward_vault_projections_v1 as current_vault
  join programmable_private.run_headers as current_run
    on current_run.run_id = current_vault.projection_run_id
   and current_run.run_kind = 'projection'
   and current_run.source_group = header.source_group
  where current_vault.chain_id = header.chain_id
    and current_vault.release_id = header.release_id
    and current_vault.model_id = header.model_id
    and current_vault.epoch_id = header.epoch_id
    and current_vault.pointer_generation =
      header.captured_pointer_generation
    and current_vault.vault = p_vault;
  if raw_vault_count > 1 then
    raise exception using
      errcode = '23514', message = 'reward-state vault is ambiguous';
  end if;
  if raw_vault_count = 0 then return; end if;

  select pg_catalog.count(*) into baseline_count
  from programmable_private.current_reward_vault_projections_v1 as current_vault
  join programmable_private.projection_entity_current as entity
    on entity.entity_kind = 'reward_vault'
   and entity.projection_row_id = current_vault.reward_vault_projection_id
   and entity.projection_run_id = current_vault.projection_run_id
   and entity.chain_id = current_vault.chain_id
   and entity.release_id = current_vault.release_id
   and entity.model_id = current_vault.model_id
   and entity.source_group = header.source_group
  join programmable_private.projection_publications as publication
    on publication.publication_id = entity.publication_id
   and publication.run_id = current_vault.projection_run_id
   and publication.checkpoint_id = entity.checkpoint_id
  join programmable_private.projector_checkpoints as checkpoint
    on checkpoint.checkpoint_id = entity.checkpoint_id
   and checkpoint.chain_id = current_vault.chain_id
   and checkpoint.release_id = current_vault.release_id
   and checkpoint.model_id = current_vault.model_id
   and checkpoint.source_group = header.source_group
   and checkpoint.epoch_id = header.epoch_id
   and checkpoint.pointer_generation = header.captured_pointer_generation
  join programmable_private.projector_checkpoint_current as current_checkpoint
    on current_checkpoint.chain_id = checkpoint.chain_id
   and current_checkpoint.release_id = checkpoint.release_id
   and current_checkpoint.model_id = checkpoint.model_id
   and current_checkpoint.source_group = checkpoint.source_group
   and current_checkpoint.projector_version = checkpoint.projector_version
   and current_checkpoint.checkpoint_id = checkpoint.checkpoint_id
   and current_checkpoint.checkpoint_generation =
     checkpoint.checkpoint_generation
   and current_checkpoint.reorg_generation = checkpoint.reorg_generation
  join programmable_private.chain_event_current_canonical as canonical
    on canonical.occurrence_id = current_vault.last_source_occurrence_id
   and canonical.logical_event_id =
     current_vault.last_source_logical_event_id
   and canonical.block_hash =
     current_vault.last_source_occurrence_block_hash
  join programmable_private.chain_event_materialized_occurrences_v1
    as vault_source
    on vault_source.occurrence_id = current_vault.last_source_occurrence_id
   and vault_source.logical_event_id =
     current_vault.last_source_logical_event_id
   and vault_source.block_hash =
     current_vault.last_source_occurrence_block_hash
   and vault_source.chain_id = current_vault.chain_id
   and vault_source.release_id = current_vault.release_id
   and vault_source.model_id = current_vault.model_id
   and vault_source.source_group = header.source_group
   and vault_source.epoch_id = current_vault.epoch_id
   and vault_source.pointer_generation = current_vault.pointer_generation
  where current_vault.chain_id = header.chain_id
    and current_vault.release_id = header.release_id
    and current_vault.model_id = header.model_id
    and current_vault.epoch_id = header.epoch_id
    and current_vault.pointer_generation =
      header.captured_pointer_generation
    and current_vault.vault = p_vault
    and programmable_private.has_current_verified_reward_seed(
      current_vault.projection_run_id, current_vault.vault
    );
  if baseline_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'reward-state baseline is not exact-current';
  end if;

  select
    current_vault.reward_vault_projection_id,
    current_vault.current_allocation_fact_id,
    current_vault.projection_run_id,
    current_vault.promoted_block_number,
    current_vault.promoted_block_hash,
    entity.checkpoint_id,
    checkpoint.projector_version,
    checkpoint.checkpoint_generation,
    checkpoint.reorg_generation,
    checkpoint.block_number,
    checkpoint.block_hash,
    publication_audit.input_commitment
  into baseline
  from programmable_private.current_reward_vault_projections_v1 as current_vault
  join programmable_private.projection_entity_current as entity
    on entity.entity_kind = 'reward_vault'
   and entity.projection_row_id = current_vault.reward_vault_projection_id
   and entity.projection_run_id = current_vault.projection_run_id
   and entity.source_group = header.source_group
  join programmable_private.projection_publications as publication
    on publication.publication_id = entity.publication_id
   and publication.run_id = current_vault.projection_run_id
   and publication.checkpoint_id = entity.checkpoint_id
  join programmable_private.mutation_audits as publication_audit
    on publication_audit.audit_id = publication.audit_id
  join programmable_private.projector_checkpoints as checkpoint
    on checkpoint.checkpoint_id = entity.checkpoint_id
  join programmable_private.projector_checkpoint_current as current_checkpoint
    on current_checkpoint.chain_id = checkpoint.chain_id
   and current_checkpoint.release_id = checkpoint.release_id
   and current_checkpoint.model_id = checkpoint.model_id
   and current_checkpoint.source_group = checkpoint.source_group
   and current_checkpoint.projector_version = checkpoint.projector_version
   and current_checkpoint.checkpoint_id = checkpoint.checkpoint_id
   and current_checkpoint.checkpoint_generation =
     checkpoint.checkpoint_generation
   and current_checkpoint.reorg_generation = checkpoint.reorg_generation
  where current_vault.chain_id = header.chain_id
    and current_vault.release_id = header.release_id
    and current_vault.model_id = header.model_id
    and current_vault.epoch_id = header.epoch_id
    and current_vault.pointer_generation =
      header.captured_pointer_generation
    and current_vault.vault = p_vault;

  select pg_catalog.count(*),
    pg_catalog.count(distinct allocation.allocation_index),
    pg_catalog.count(distinct allocation.beneficiary),
    pg_catalog.count(distinct allocation.configuration_epoch),
    coalesce(pg_catalog.sum(allocation.share_bps), 0)
  into active_allocation_count, unique_allocation_count,
    unique_beneficiary_count, configuration_epoch_count, total_share_bps
  from programmable_private.reward_allocation_projections as allocation
  where allocation.reward_vault_projection_id =
      baseline.reward_vault_projection_id
    and allocation.projection_run_id = baseline.projection_run_id
    and allocation.allocation_fact_id = baseline.current_allocation_fact_id
    and allocation.effective_to_block is null;
  if active_allocation_count not between 1 and 8
     or unique_allocation_count <> active_allocation_count
     or unique_beneficiary_count <> active_allocation_count
     or configuration_epoch_count <> 1
     or total_share_bps <> 10000
  then
    raise exception using
      errcode = '23514',
      message = 'reward-state active allocation set is incomplete';
  end if;

  select pg_catalog.count(*) into eligible_row_count
  from programmable_private.reward_allocation_projections as allocation
  join programmable_private.chain_event_current_canonical
    as allocation_canonical
    on allocation_canonical.occurrence_id =
      allocation.last_source_occurrence_id
   and allocation_canonical.logical_event_id =
      allocation.last_source_logical_event_id
   and allocation_canonical.block_hash =
     allocation.last_source_occurrence_block_hash
  join programmable_private.chain_event_materialized_occurrences_v1
    as allocation_source
    on allocation_source.occurrence_id = allocation.last_source_occurrence_id
   and allocation_source.logical_event_id =
     allocation.last_source_logical_event_id
   and allocation_source.block_hash =
     allocation.last_source_occurrence_block_hash
   and allocation_source.chain_id = allocation.chain_id
   and allocation_source.release_id = allocation.release_id
   and allocation_source.model_id = allocation.model_id
   and allocation_source.source_group = header.source_group
   and allocation_source.epoch_id = allocation.epoch_id
   and allocation_source.pointer_generation = allocation.pointer_generation
  join programmable_private.current_account_reward_balances_v1 as balance
    on balance.chain_id = allocation.chain_id
   and balance.release_id = allocation.release_id
   and balance.model_id = allocation.model_id
   and balance.epoch_id = allocation.epoch_id
   and balance.pointer_generation = allocation.pointer_generation
   and balance.vault = p_vault
   and balance.account = allocation.beneficiary
  join programmable_private.projection_entity_current as balance_entity
    on balance_entity.entity_kind = 'account_reward_balance'
   and balance_entity.projection_row_id = balance.account_reward_balance_id
   and balance_entity.projection_run_id = balance.projection_run_id
   and balance_entity.source_group = header.source_group
  join programmable_private.projection_publications as balance_publication
    on balance_publication.publication_id = balance_entity.publication_id
   and balance_publication.run_id = balance.projection_run_id
  join programmable_private.chain_event_current_canonical as balance_canonical
    on balance_canonical.occurrence_id = balance.last_source_occurrence_id
   and balance_canonical.logical_event_id =
     balance.last_source_logical_event_id
   and balance_canonical.block_hash =
     balance.last_source_occurrence_block_hash
  join programmable_private.chain_event_materialized_occurrences_v1
    as balance_source
    on balance_source.occurrence_id = balance.last_source_occurrence_id
   and balance_source.logical_event_id = balance.last_source_logical_event_id
   and balance_source.block_hash = balance.last_source_occurrence_block_hash
   and balance_source.chain_id = balance.chain_id
   and balance_source.release_id = balance.release_id
   and balance_source.model_id = balance.model_id
   and balance_source.source_group = header.source_group
   and balance_source.epoch_id = balance.epoch_id
   and balance_source.pointer_generation = balance.pointer_generation
  where allocation.reward_vault_projection_id =
      baseline.reward_vault_projection_id
    and allocation.projection_run_id = baseline.projection_run_id
    and allocation.allocation_fact_id = baseline.current_allocation_fact_id
    and allocation.effective_to_block is null;
  if eligible_row_count <> active_allocation_count then
    raise exception using
      errcode = '23514',
      message = 'reward-state balance or canonical provenance is incomplete';
  end if;

  return query
  select
    allocation.chain_id::bigint,
    allocation.release_id::text,
    allocation.model_id::text,
    header.source_group::text,
    allocation.epoch_id,
    allocation.pointer_generation,
    baseline.checkpoint_id::uuid,
    baseline.projector_version::text,
    baseline.checkpoint_generation::bigint,
    baseline.reorg_generation::bigint,
    baseline.block_number::bigint,
    baseline.block_hash::bytea,
    vault_projection.reward_vault_projection_id,
    vault_projection.current_allocation_fact_id,
    vault_projection.vault::bytea,
    vault_projection.pool_id::bytea,
    vault_projection.quote_asset::bytea,
    vault_projection.configuration_hash::bytea,
    allocation.configuration_epoch,
    allocation.allocation_index,
    allocation.beneficiary::bytea,
    allocation.payout_address::bytea,
    allocation.share_bps::integer,
    balance.claimable_accrued::numeric,
    balance.claimed_total::numeric,
    vault_projection.projection_run_id,
    baseline.input_commitment::bytea,
    vault_projection.promoted_block_number::bigint,
    vault_projection.promoted_block_hash::bytea,
    balance.projection_run_id,
    balance_publication_audit.input_commitment::bytea,
    balance.promoted_block_number::bigint,
    balance.promoted_block_hash::bytea,
    vault_projection.last_source_occurrence_id,
    vault_projection.last_source_logical_event_id,
    vault_projection.last_source_occurrence_block_hash::bytea,
    allocation.last_source_occurrence_id,
    allocation.last_source_logical_event_id,
    allocation.last_source_occurrence_block_hash::bytea,
    balance.last_source_occurrence_id,
    balance.last_source_logical_event_id,
    balance.last_source_occurrence_block_hash::bytea,
    pg_catalog.greatest(
      vault_projection.verified_at,
      allocation.verified_at,
      balance.verified_at
    )
  from programmable_private.current_reward_vault_projections_v1
    as vault_projection
  join programmable_private.reward_allocation_projections as allocation
    on allocation.reward_vault_projection_id =
      vault_projection.reward_vault_projection_id
   and allocation.projection_run_id = vault_projection.projection_run_id
   and allocation.allocation_fact_id =
      vault_projection.current_allocation_fact_id
   and allocation.effective_to_block is null
  join programmable_private.chain_event_current_canonical
    as allocation_canonical
    on allocation_canonical.occurrence_id =
      allocation.last_source_occurrence_id
   and allocation_canonical.logical_event_id =
      allocation.last_source_logical_event_id
   and allocation_canonical.block_hash =
     allocation.last_source_occurrence_block_hash
  join programmable_private.chain_event_materialized_occurrences_v1
    as allocation_source
    on allocation_source.occurrence_id = allocation.last_source_occurrence_id
   and allocation_source.logical_event_id =
     allocation.last_source_logical_event_id
   and allocation_source.block_hash =
     allocation.last_source_occurrence_block_hash
   and allocation_source.chain_id = allocation.chain_id
   and allocation_source.release_id = allocation.release_id
   and allocation_source.model_id = allocation.model_id
   and allocation_source.source_group = header.source_group
   and allocation_source.epoch_id = allocation.epoch_id
   and allocation_source.pointer_generation = allocation.pointer_generation
  join programmable_private.current_account_reward_balances_v1 as balance
    on balance.chain_id = allocation.chain_id
   and balance.release_id = allocation.release_id
   and balance.model_id = allocation.model_id
   and balance.epoch_id = allocation.epoch_id
   and balance.pointer_generation = allocation.pointer_generation
   and balance.vault = vault_projection.vault
   and balance.account = allocation.beneficiary
  join programmable_private.projection_entity_current as balance_entity
    on balance_entity.entity_kind = 'account_reward_balance'
   and balance_entity.projection_row_id = balance.account_reward_balance_id
   and balance_entity.projection_run_id = balance.projection_run_id
   and balance_entity.source_group = header.source_group
  join programmable_private.projection_publications as balance_publication
    on balance_publication.publication_id = balance_entity.publication_id
   and balance_publication.run_id = balance.projection_run_id
  join programmable_private.mutation_audits as balance_publication_audit
    on balance_publication_audit.audit_id = balance_publication.audit_id
  join programmable_private.chain_event_current_canonical as balance_canonical
    on balance_canonical.occurrence_id = balance.last_source_occurrence_id
   and balance_canonical.logical_event_id =
     balance.last_source_logical_event_id
   and balance_canonical.block_hash =
     balance.last_source_occurrence_block_hash
  join programmable_private.chain_event_materialized_occurrences_v1
    as balance_source
    on balance_source.occurrence_id = balance.last_source_occurrence_id
   and balance_source.logical_event_id = balance.last_source_logical_event_id
   and balance_source.block_hash = balance.last_source_occurrence_block_hash
   and balance_source.chain_id = balance.chain_id
   and balance_source.release_id = balance.release_id
   and balance_source.model_id = balance.model_id
   and balance_source.source_group = header.source_group
   and balance_source.epoch_id = balance.epoch_id
   and balance_source.pointer_generation = balance.pointer_generation
  where vault_projection.reward_vault_projection_id =
      baseline.reward_vault_projection_id
  order by allocation.allocation_index;
end
$function$;

revoke all on programmable_private.route_eligibility_current_exact_v1,
  programmable_private.route_snapshot_readiness_v1,
  programmable_private.route_token_projections_v1,
  programmable_private.route_checkpoint_parity_bindings,
  programmable_private.public_route_snapshots_v2,
  programmable_private.public_explore_token_v1,
  programmable_private.public_explore_list_v1,
  programmable_private.public_explore_chart_v1,
  programmable_private.public_creator_profile_v1,
  programmable_private.public_classic_v3_profile_v1,
  programmable_private.public_stock_paired_profile_v1,
  programmable_private.public_launch_lookup_v1,
  programmable_private.read_model_performance_eligible_launches_v1
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

grant select on programmable_private.route_eligibility_current_exact_v1,
  programmable_private.route_snapshot_readiness_v1,
  programmable_private.route_token_projections_v1,
  programmable_private.public_route_snapshots_v2,
  programmable_private.public_explore_token_v1,
  programmable_private.public_explore_list_v1,
  programmable_private.public_explore_chart_v1,
  programmable_private.public_creator_profile_v1,
  programmable_private.public_classic_v3_profile_v1,
  programmable_private.public_stock_paired_profile_v1,
  programmable_private.public_launch_lookup_v1
to programmable_api_reader;

revoke all on function
  programmable_private.build_indexed_token_projection_v2(jsonb),
  programmable_private.retarget_indexed_token_projection_v2(jsonb,jsonb,text),
  programmable_private.build_public_snapshot_identity_v2(
    text,bigint,bigint,bytea,bigint,timestamptz,jsonb
  ),
  programmable_private.build_public_explore_cursor_v1(
    text,text,text,integer,text,numeric,bigint,bigint,bigint,text,text
  ),
  programmable_private.decode_public_address_v1(text),
  programmable_private.decode_public_bytes32_v1(text)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

revoke all on function
  programmable_private.get_public_explore_page_v1(
    bigint,text,text,integer,integer
  ),
  programmable_private.get_public_explore_token_v1(bigint,text),
  programmable_private.get_public_token_chart_v1(bigint,text,text),
  programmable_private.get_public_creator_profile_v1(bigint,text),
  programmable_private.get_public_classic_v3_profile_v1(bigint,text),
  programmable_private.get_public_stock_paired_profile_v1(bigint,text),
  programmable_private.get_public_launch_lookup_v1(
    bigint,text,text,text
  ),
  programmable_private.get_public_indexer_feed_v1(bigint)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

grant execute on function
  programmable_private.get_public_explore_page_v1(
    bigint,text,text,integer,integer
  ),
  programmable_private.get_public_explore_token_v1(bigint,text),
  programmable_private.get_public_token_chart_v1(bigint,text,text),
  programmable_private.get_public_creator_profile_v1(bigint,text),
  programmable_private.get_public_classic_v3_profile_v1(bigint,text),
  programmable_private.get_public_stock_paired_profile_v1(bigint,text),
  programmable_private.get_public_launch_lookup_v1(
    bigint,text,text,text
  ),
  programmable_private.get_public_indexer_feed_v1(bigint)
to programmable_api_reader;

revoke all on function
  programmable_private.get_read_model_performance_dataset_v1(bigint)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

grant execute on function
  programmable_private.get_read_model_performance_dataset_v1(bigint)
to programmable_projector;

revoke all on function
  programmable_private.get_projector_reward_state_by_vault_v1(uuid, bytea)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

grant execute on function
  programmable_private.get_projector_reward_state_by_vault_v1(uuid, bytea)
to programmable_projector;

revoke all on function programmable_private.bind_route_checkpoint_parity_v1(
  uuid, uuid, uuid, bytea, timestamptz
) from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

grant execute on function
  programmable_private.bind_route_checkpoint_parity_v1(
    uuid, uuid, uuid, bytea, timestamptz
  ) to programmable_reconciler;

revoke all on function
  programmable_private.get_projector_verified_reward_seed_v1(uuid, bytea)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

grant execute on function
  programmable_private.get_projector_verified_reward_seed_v1(uuid, bytea)
to programmable_projector;

revoke all on function
  programmable_private.get_projector_pool_baseline_by_id_v1(uuid, bytea)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

grant execute on function
  programmable_private.get_projector_pool_baseline_by_id_v1(uuid, bytea)
to programmable_projector;

revoke all on function programmable_private.abi_uint256_word_v1(
  bytea, integer
) from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

revoke all on function programmable_private.abi_int256_word_v1(
  bytea, integer
) from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

revoke all on function
  programmable_private.enforce_decoded_eth_usd_snapshot_v1()
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

revoke all on function programmable_private.append_dual_rpc_log_coverage_evidence(
  uuid, uuid, uuid, text, bigint, bigint, numeric, numeric, bytea,
  numeric, text, uuid, uuid, uuid, uuid, bytea, bytea[], bytea[],
  bytea, smallint, bytea, bytea, bytea, timestamptz
) from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

revoke all on function programmable_private.advance_envio_ingestion_cursor_v1(
  uuid, uuid, text, bigint, bigint, numeric, bytea, numeric, text, bytea,
  timestamptz
) from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

revoke all on function programmable_private.commit_envio_ingestion_page_v1(
  uuid, uuid, uuid, uuid, text, bigint, bigint, numeric,
  programmable_private.envio_candidate_page_item_v1[], uuid, uuid,
  uuid, uuid, bytea, bytea[], bytea[], bytea, bytea, smallint,
  bytea, bytea, bytea, timestamptz
) from public, anon, authenticated, service_role,
  programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance;

grant execute on function programmable_private.commit_envio_ingestion_page_v1(
  uuid, uuid, uuid, uuid, text, bigint, bigint, numeric,
  programmable_private.envio_candidate_page_item_v1[], uuid, uuid,
  uuid, uuid, bytea, bytea[], bytea[], bytea, bytea, smallint,
  bytea, bytea, bytea, timestamptz
) to programmable_projector;

reset role;
