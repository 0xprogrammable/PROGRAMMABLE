-- Expanded P0 closure: byte-complete provider evidence, atomic neutral
-- ingestion commits, an evidence-backed genesis rewind target, and the
-- remaining route-parity read-model facts.

set role programmable_migrator;

-- Runtime evidence must retain the exact bytes obtained independently from
-- both providers as well as the immutable-reconstructed bytecode. Hashes and
-- commitments alone are insufficient for later replay or codec verification.
alter table programmable_private.dual_rpc_runtime_code_evidence
  add column runtime_code_a bytea,
  add column runtime_code_b bytea,
  add column reconstructed_runtime_code bytea;

alter table programmable_private.dual_rpc_runtime_code_evidence
  alter column runtime_code_a set not null,
  alter column runtime_code_b set not null,
  alter column reconstructed_runtime_code set not null,
  add constraint dual_rpc_runtime_code_exact_bytes_check check (
    runtime_code_a = runtime_code_b
    and runtime_code_a = reconstructed_runtime_code
    and pg_catalog.octet_length(runtime_code_a) = runtime_code_length_a
    and pg_catalog.octet_length(runtime_code_b) = runtime_code_length_b
    and pg_catalog.octet_length(reconstructed_runtime_code)
      = agreed_runtime_code_length
  );

drop function programmable_private.append_dual_rpc_runtime_code_evidence(
  uuid, uuid, bytea, uuid, uuid, uuid, bytea, bytea, numeric, numeric,
  bytea, bytea, bytea, bytea[], bytea, bytea, smallint, bytea, bytea, bytea,
  timestamptz
);

create function programmable_private.append_dual_rpc_runtime_code_evidence(
  p_runtime_code_evidence_id uuid,
  p_run_id uuid,
  p_source_address bytea,
  p_deployment_block_evidence_id uuid,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_runtime_code_hash_a bytea,
  p_runtime_code_hash_b bytea,
  p_runtime_code_a bytea,
  p_runtime_code_b bytea,
  p_runtime_code_length_a numeric,
  p_runtime_code_length_b numeric,
  p_normalized_runtime_code_hash_a bytea,
  p_normalized_runtime_code_hash_b bytea,
  p_immutable_references_commitment bytea,
  p_immutable_values bytea[],
  p_immutable_values_commitment bytea,
  p_reconstructed_runtime_code bytea,
  p_reconstructed_runtime_code_hash bytea,
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
  block_evidence programmable_private.dual_rpc_block_evidence%rowtype;
  existing programmable_private.dual_rpc_runtime_code_evidence%rowtype;
  normalized_runtime_code_length bigint;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_provider_evidence_encoding(
    'runtime_code', p_encoding_version, p_canonical_preimage,
    p_content_fingerprint
  );
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind in ('ingestion', 'projection');
  if not found then
    raise exception using
      errcode = '23503', message = 'invalid runtime-code verification run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if exists (
    select 1 from programmable_private.run_lifecycle_outcomes
    where run_id = p_run_id
  ) then
    raise exception using errcode = '55000', message = 'run is terminal';
  end if;
  select * into block_evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_deployment_block_evidence_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  if not found
     or p_provider_a_id = p_provider_b_id
     or not exists (
       select 1 from programmable_private.provider_deployments
       where provider_deployment_id = p_provider_a_id
         and provider_type = 'rpc_provider'
     )
     or not exists (
       select 1 from programmable_private.provider_deployments
       where provider_deployment_id = p_provider_b_id
         and provider_type = 'rpc_provider'
     )
     or not exists (
       select 1
       from programmable_private.safe_head_observations as observation
       where observation.observation_id = block_evidence.observation_id
         and observation.epoch_id = block_evidence.epoch_id
         and observation.pointer_generation = block_evidence.pointer_generation
         and observation.provider_a_id = p_provider_a_id
         and observation.provider_b_id = p_provider_b_id
     )
     or pg_catalog.octet_length(p_source_address) <> 20
     or pg_catalog.octet_length(p_runtime_code_hash_a) <> 32
     or p_runtime_code_hash_a <> p_runtime_code_hash_b
     or p_runtime_code_a is null
     or p_runtime_code_b is null
     or p_runtime_code_a <> p_runtime_code_b
     or p_runtime_code_length_a is null
     or p_runtime_code_length_b is null
     or p_runtime_code_length_a <> pg_catalog.trunc(p_runtime_code_length_a)
     or p_runtime_code_length_b <> pg_catalog.trunc(p_runtime_code_length_b)
     or p_runtime_code_length_a <> p_runtime_code_length_b
     or p_runtime_code_length_a <= 0
     or p_runtime_code_length_a > 16777216
     or pg_catalog.octet_length(p_runtime_code_a) <> p_runtime_code_length_a
     or pg_catalog.octet_length(p_runtime_code_b) <> p_runtime_code_length_b
     or pg_catalog.octet_length(p_normalized_runtime_code_hash_a) <> 32
     or p_normalized_runtime_code_hash_a <> p_normalized_runtime_code_hash_b
     or pg_catalog.octet_length(p_immutable_references_commitment) <> 32
     or not programmable_private.valid_immutable_values(p_immutable_values)
     or pg_catalog.octet_length(p_immutable_values_commitment) <> 32
     or p_reconstructed_runtime_code is null
     or p_reconstructed_runtime_code <> p_runtime_code_a
     or pg_catalog.octet_length(p_reconstructed_runtime_code)
       <> p_runtime_code_length_a
     or pg_catalog.octet_length(p_reconstructed_runtime_code_hash) <> 32
     or p_reconstructed_runtime_code_hash <> p_runtime_code_hash_a
     or pg_catalog.octet_length(p_evidence_commitment) <> 32
  then
    raise exception using
      errcode = '23514',
      message = 'runtime code lacks byte-complete dual-RPC deployment-block evidence';
  end if;
  normalized_runtime_code_length := p_runtime_code_length_a::bigint;
  select * into existing
  from programmable_private.dual_rpc_runtime_code_evidence
  where epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation
    and source_address = p_source_address
    and deployment_block_number = block_evidence.block_number;
  if found then
    if existing.runtime_code_evidence_id <> p_runtime_code_evidence_id
       or existing.deployment_block_evidence_id
         <> p_deployment_block_evidence_id
       or existing.provider_a_id <> p_provider_a_id
       or existing.provider_b_id <> p_provider_b_id
       or existing.agreed_runtime_code_hash <> p_runtime_code_hash_a
       or existing.runtime_code_a <> p_runtime_code_a
       or existing.runtime_code_b <> p_runtime_code_b
       or existing.agreed_runtime_code_length
         <> normalized_runtime_code_length
       or existing.agreed_normalized_runtime_code_hash
         <> p_normalized_runtime_code_hash_a
       or existing.immutable_references_commitment
         <> p_immutable_references_commitment
       or existing.immutable_values <> p_immutable_values
       or existing.immutable_values_commitment
         <> p_immutable_values_commitment
       or existing.reconstructed_runtime_code
         <> p_reconstructed_runtime_code
       or existing.reconstructed_runtime_code_hash
         <> p_reconstructed_runtime_code_hash
       or existing.encoding_version <> p_encoding_version
       or existing.canonical_preimage <> p_canonical_preimage
       or existing.content_fingerprint <> p_content_fingerprint
       or existing.evidence_commitment <> p_evidence_commitment
    then
      raise exception using
        errcode = '23505', message = 'runtime code evidence replay conflict';
    end if;
    return existing.runtime_code_evidence_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'runtime_code_evidence.append', p_evidence_commitment,
    p_run_id, p_verified_at
  );
  insert into programmable_private.dual_rpc_runtime_code_evidence (
    runtime_code_evidence_id, chain_id, release_id, model_id, source_group,
    epoch_id, pointer_generation, source_address,
    deployment_block_evidence_id, deployment_block_number,
    deployment_block_hash, provider_a_id, provider_b_id,
    runtime_code_hash_a, runtime_code_hash_b, agreed_runtime_code_hash,
    runtime_code_a, runtime_code_b,
    runtime_code_length_a, runtime_code_length_b,
    agreed_runtime_code_length, normalized_runtime_code_hash_a,
    normalized_runtime_code_hash_b, agreed_normalized_runtime_code_hash,
    immutable_references_commitment, immutable_values,
    immutable_values_commitment, reconstructed_runtime_code,
    reconstructed_runtime_code_hash, encoding_version, canonical_preimage,
    content_fingerprint, evidence_commitment, verification_run_id,
    verified_at, created_by_audit_id
  ) values (
    p_runtime_code_evidence_id, header.chain_id, header.release_id,
    header.model_id, header.source_group, header.epoch_id,
    header.captured_pointer_generation,
    p_source_address::programmable_private.eth_address,
    block_evidence.block_evidence_id, block_evidence.block_number,
    block_evidence.agreed_block_hash, p_provider_a_id, p_provider_b_id,
    p_runtime_code_hash_a::programmable_private.bytes32_value,
    p_runtime_code_hash_b::programmable_private.bytes32_value,
    p_runtime_code_hash_a::programmable_private.bytes32_value,
    p_runtime_code_a, p_runtime_code_b,
    normalized_runtime_code_length, normalized_runtime_code_length,
    normalized_runtime_code_length,
    p_normalized_runtime_code_hash_a::programmable_private.bytes32_value,
    p_normalized_runtime_code_hash_b::programmable_private.bytes32_value,
    p_normalized_runtime_code_hash_a::programmable_private.bytes32_value,
    p_immutable_references_commitment::programmable_private.bytes32_value,
    p_immutable_values,
    p_immutable_values_commitment::programmable_private.bytes32_value,
    p_reconstructed_runtime_code,
    p_reconstructed_runtime_code_hash::programmable_private.bytes32_value,
    p_encoding_version, p_canonical_preimage,
    p_content_fingerprint::programmable_private.bytes32_value,
    p_evidence_commitment::programmable_private.bytes32_value,
    p_run_id, p_verified_at, audit_id
  );
  return p_runtime_code_evidence_id;
end
$function$;

-- A cursor is never allowed to infer completeness from Envio alone. Each
-- advancing page carries a bounded, independently queried dual-RPC log set;
-- both provider sets and the durable inbox set must match exactly and in
-- canonical order.
insert into programmable_private.provider_evidence_encoding_subtypes (
  evidence_subtype, encoding_version, subtype_tag, frame_prefix,
  definition_commitment
) values (
  'log_coverage', 2, 5,
  pg_catalog.decode(
    '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320005',
    'hex'
  ),
  pg_catalog.decode(
    '4ab7460cb321503613935191917c46872c9e3c9a681b2d4b349b6187f4dc0aec',
    'hex'
  )
);

create table programmable_private.dual_rpc_log_coverage_evidence (
  log_coverage_evidence_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  provider_deployment_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  stream_id programmable_private.source_identifier not null,
  expected_cursor_generation bigint not null
    check (expected_cursor_generation >= 0),
  next_cursor_generation bigint not null
    check (next_cursor_generation = expected_cursor_generation + 1),
  previous_block_number programmable_private.block_number_value,
  -- The shared block_log_index_value domain deliberately rejects NULL. A
  -- genesis predecessor has no log ordinal, so this nullable field uses the
  -- base type plus the same unsigned-32-bit bound instead.
  previous_block_global_log_index bigint
    check (
      previous_block_global_log_index is null
      or previous_block_global_log_index between 0 and 4294967295
    ),
  previous_candidate_id programmable_private.envio_candidate_identifier,
  from_block_number programmable_private.block_number_value not null,
  to_block_number programmable_private.block_number_value not null,
  final_block_hash programmable_private.bytes32_value not null,
  final_block_global_log_index programmable_private.block_log_index_value not null,
  final_candidate_id programmable_private.envio_candidate_identifier not null,
  safe_head_observation_id uuid not null
    references programmable_private.safe_head_observations(observation_id)
    on delete restrict,
  final_block_evidence_id uuid not null,
  provider_a_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_b_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  filter_commitment programmable_private.bytes32_value not null,
  ordered_log_commitments_a bytea[] not null,
  ordered_log_commitments_b bytea[] not null,
  ordered_inbox_commitments bytea[] not null,
  page_commitment programmable_private.bytes32_value not null,
  encoding_version smallint not null check (encoding_version = 2),
  canonical_preimage bytea not null,
  content_fingerprint programmable_private.bytes32_value not null,
  evidence_commitment programmable_private.bytes32_value not null,
  verification_run_id uuid not null,
  verified_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (
    final_block_evidence_id, safe_head_observation_id, epoch_id, chain_id,
    pointer_generation
  ) references programmable_private.dual_rpc_block_evidence(
    block_evidence_id, observation_id, epoch_id, chain_id, pointer_generation
  ) on delete restrict,
  foreign key (final_block_evidence_id, final_block_hash)
    references programmable_private.dual_rpc_block_evidence(
      block_evidence_id, agreed_block_hash
    ) on delete restrict,
  foreign key (verification_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  check (provider_a_id <> provider_b_id),
  check (
    from_block_number <= to_block_number
    and to_block_number - from_block_number <= 1999
  ),
  check (
    pg_catalog.cardinality(ordered_log_commitments_a) between 1 and 2000
    and programmable_private.valid_topics(ordered_log_commitments_a)
    and ordered_log_commitments_a = ordered_log_commitments_b
    and ordered_log_commitments_a = ordered_inbox_commitments
  ),
  check (
    (expected_cursor_generation = 0
      and previous_block_number is not null
      and previous_block_global_log_index is null
      and previous_candidate_id is null)
    or
    (expected_cursor_generation > 0
      and previous_block_number is not null
      and (
        (previous_block_global_log_index is null
          and previous_candidate_id is null)
        or
        (previous_block_global_log_index is not null
          and previous_candidate_id is not null)
      ))
  ),
  unique (
    chain_id, provider_deployment_id, stream_id, next_cursor_generation
  ),
  unique (verification_run_id, evidence_commitment)
);

create table programmable_private.envio_ingestion_cursor_genesis_points (
  genesis_point_id uuid primary key,
  chain_id programmable_private.chain_id_value not null check (chain_id = 1),
  provider_deployment_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  stream_id programmable_private.source_identifier not null,
  anchor_block_evidence_id uuid not null,
  anchor_block_number programmable_private.block_number_value not null,
  anchor_block_hash programmable_private.bytes32_value not null,
  content_commitment programmable_private.bytes32_value not null,
  registered_by_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  registered_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (anchor_block_evidence_id, anchor_block_hash)
    references programmable_private.dual_rpc_block_evidence(
      block_evidence_id, agreed_block_hash
    ) on delete restrict,
  unique (chain_id, provider_deployment_id, stream_id)
);

alter table programmable_private.envio_ingestion_cursor_history
  alter column block_global_log_index type bigint
    using block_global_log_index::bigint,
  alter column block_global_log_index drop not null,
  alter column candidate_id drop not null,
  add column is_genesis boolean not null default false,
  add column genesis_point_id uuid
    references programmable_private.envio_ingestion_cursor_genesis_points(
      genesis_point_id
    ) on delete restrict,
  add column log_coverage_evidence_id uuid
    references programmable_private.dual_rpc_log_coverage_evidence(
      log_coverage_evidence_id
    ) on delete restrict;

alter table programmable_private.envio_ingestion_cursor_history
  add constraint envio_cursor_history_log_index_check check (
    block_global_log_index is null
    or block_global_log_index between 0 and 4294967295
  ),
  add constraint envio_cursor_history_point_shape_check check (
    (is_genesis and genesis_point_id is not null
      and block_global_log_index is null and candidate_id is null
      and log_coverage_evidence_id is null)
    or
    (not is_genesis and genesis_point_id is null
      and block_global_log_index is not null and candidate_id is not null
      and ((is_rewind and log_coverage_evidence_id is null)
        or (not is_rewind and log_coverage_evidence_id is not null)))
  );

alter table programmable_private.envio_ingestion_cursor_current
  alter column block_global_log_index type bigint
    using block_global_log_index::bigint,
  alter column block_global_log_index drop not null,
  alter column candidate_id drop not null,
  add column is_genesis boolean not null default false,
  add column is_rewind boolean not null default false,
  add column genesis_point_id uuid
    references programmable_private.envio_ingestion_cursor_genesis_points(
      genesis_point_id
    ) on delete restrict,
  add column log_coverage_evidence_id uuid
    references programmable_private.dual_rpc_log_coverage_evidence(
      log_coverage_evidence_id
    ) on delete restrict;

alter table programmable_private.envio_ingestion_cursor_current
  add constraint envio_cursor_current_log_index_check check (
    block_global_log_index is null
    or block_global_log_index between 0 and 4294967295
  ),
  add constraint envio_cursor_current_point_shape_check check (
    (is_genesis and genesis_point_id is not null
      and block_global_log_index is null and candidate_id is null
      and log_coverage_evidence_id is null)
    or
    (not is_genesis and genesis_point_id is null
      and block_global_log_index is not null and candidate_id is not null
      and ((is_rewind and log_coverage_evidence_id is null)
        or (not is_rewind and log_coverage_evidence_id is not null)))
  );

create type programmable_private.envio_candidate_page_item_v1 as (
  candidate_id text,
  block_number numeric,
  block_hash bytea,
  transaction_hash bytea,
  transaction_index numeric,
  block_global_log_index numeric,
  source_address bytea,
  event_signature bytea,
  event_type text,
  ordered_topics bytea[],
  raw_data bytea,
  decoded_payload jsonb,
  payload_hash bytea,
  provider_cursor text,
  content_commitment bytea,
  first_seen_at timestamptz,
  contract_name text
);

create function programmable_private.register_envio_ingestion_genesis_v1(
  p_genesis_point_id uuid,
  p_run_id uuid,
  p_provider_deployment_id uuid,
  p_stream_id text,
  p_anchor_block_evidence_id uuid,
  p_content_commitment bytea,
  p_registered_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  evidence programmable_private.dual_rpc_block_evidence%rowtype;
  existing programmable_private.envio_ingestion_cursor_genesis_points%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind in ('ingestion', 'rewind')
    and chain_id = 1
    and release_id = 'envio-control'
    and model_id = 'envio-control'
    and source_group = 'canonical-events'
    and epoch_id = '70000000-0000-0000-0000-000000000002'
    and captured_pointer_generation = 1;
  if not found
     or not exists (
       select 1 from programmable_private.run_lifecycle_outcomes
       where run_id = p_run_id and status = 'succeeded'
     )
     or p_genesis_point_id is null
     or pg_catalog.octet_length(p_content_commitment) <> 32
     or p_stream_id is null
     or pg_catalog.octet_length(p_stream_id) not between 1 and 128
     or p_stream_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or not exists (
       select 1 from programmable_private.provider_deployments
       where provider_deployment_id = p_provider_deployment_id
         and provider_type = 'envio_deployment'
     )
  then
    raise exception using
      errcode = '23514', message = 'invalid succeeded neutral genesis run';
  end if;
  select * into evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_anchor_block_evidence_id
    and chain_id = 1
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation
    and verification_run_id = p_run_id;
  if not found then
    raise exception using
      errcode = '23514', message = 'genesis anchor lacks same-run dual-RPC evidence';
  end if;
  select * into existing
  from programmable_private.envio_ingestion_cursor_genesis_points
  where chain_id = 1
    and provider_deployment_id = p_provider_deployment_id
    and stream_id = p_stream_id;
  if found then
    if existing.genesis_point_id <> p_genesis_point_id
       or existing.anchor_block_evidence_id <> p_anchor_block_evidence_id
       or existing.anchor_block_number <> evidence.block_number
       or existing.anchor_block_hash <> evidence.agreed_block_hash
       or existing.content_commitment <> p_content_commitment
       or existing.registered_by_run_id <> p_run_id
       or existing.registered_at <> p_registered_at
    then
      raise exception using
        errcode = '23505', message = 'Envio genesis point replay conflict';
    end if;
    return existing.genesis_point_id;
  end if;
  if exists (
    select 1 from programmable_private.envio_ingestion_cursor_current
    where chain_id = 1
      and provider_deployment_id = p_provider_deployment_id
      and stream_id = p_stream_id
  ) then
    raise exception using
      errcode = '55000', message = 'Envio genesis must precede cursor history';
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'envio_cursor.genesis.register', p_content_commitment,
    p_run_id, p_registered_at
  );
  insert into programmable_private.envio_ingestion_cursor_genesis_points (
    genesis_point_id, chain_id, provider_deployment_id, stream_id,
    anchor_block_evidence_id, anchor_block_number, anchor_block_hash,
    content_commitment, registered_by_run_id, registered_at, audit_id
  ) values (
    p_genesis_point_id, 1, p_provider_deployment_id,
    p_stream_id::programmable_private.source_identifier,
    evidence.block_evidence_id, evidence.block_number,
    evidence.agreed_block_hash,
    p_content_commitment::programmable_private.bytes32_value,
    p_run_id, p_registered_at, created_audit_id
  );
  return p_genesis_point_id;
end
$function$;

create function programmable_private.append_dual_rpc_log_coverage_evidence(
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
      errcode = '55000', message = 'log coverage requires an open neutral ingestion run';
  end if;
  if p_expected_cursor_generation < 0
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
       not between 1 and 2000
     or not programmable_private.valid_topics(p_ordered_log_commitments_a)
     or p_ordered_log_commitments_a <> p_ordered_log_commitments_b
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

  select * into current_cursor
  from programmable_private.envio_ingestion_cursor_current
  where chain_id = 1
    and provider_deployment_id = p_provider_deployment_id
    and stream_id = p_stream_id
  for share;
  if current_cursor.generation is null then
    if p_expected_cursor_generation <> 0 then
      raise exception using errcode = '40001', message = 'log-coverage cursor CAS lost';
    end if;
    select * into genesis
    from programmable_private.envio_ingestion_cursor_genesis_points
    where chain_id = 1
      and provider_deployment_id = p_provider_deployment_id
      and stream_id = p_stream_id;
    if not found or normalized_from <> genesis.anchor_block_number + 1 then
      raise exception using
        errcode = '23514', message = 'log coverage does not start after registered genesis';
    end if;
    previous_block := genesis.anchor_block_number;
    previous_log := null;
    previous_candidate := null;
  else
    if current_cursor.generation <> p_expected_cursor_generation then
      raise exception using errcode = '40001', message = 'log-coverage cursor CAS lost';
    end if;
    previous_block := current_cursor.block_number;
    previous_log := current_cursor.block_global_log_index;
    previous_candidate := current_cursor.candidate_id;
    if (current_cursor.is_genesis and normalized_from <> previous_block + 1)
       or (not current_cursor.is_genesis and normalized_from <> previous_block)
    then
      raise exception using
        errcode = '23514', message = 'log coverage does not continue the current cursor';
    end if;
  end if;

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
      errcode = '23514', message = 'log coverage final candidate is not durable';
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
  if evidence.block_evidence_id is null or observation.observation_id is null then
    raise exception using
      errcode = '23514', message = 'log coverage lacks exact dual-RPC range evidence';
  end if;

  select pg_catalog.array_agg(
    candidate.content_commitment::bytea
    order by candidate.block_number, candidate.block_global_log_index,
             candidate.candidate_id
  ) into inbox_commitments
  from programmable_private.envio_candidate_inbox as candidate
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
      candidate.block_number::bigint,
      candidate.block_global_log_index::bigint,
      candidate.candidate_id::text
    ) <= (normalized_to, normalized_final_log, p_final_candidate_id);
  if coalesce(inbox_commitments, array[]::bytea[])
       is distinct from p_ordered_log_commitments_a
  then
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
       or existing.expected_cursor_generation <> p_expected_cursor_generation
       or existing.previous_block_number <> previous_block
       or existing.previous_block_global_log_index is distinct from previous_log
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
       or existing.ordered_log_commitments_a <> p_ordered_log_commitments_a
       or existing.page_commitment <> p_page_commitment
       or existing.encoding_version <> p_encoding_version
       or existing.canonical_preimage <> p_canonical_preimage
       or existing.content_fingerprint <> p_content_fingerprint
       or existing.evidence_commitment <> p_evidence_commitment
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
  if p_expected_generation < 0
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
  select * into candidate
  from programmable_private.envio_candidate_inbox
  where candidate_id = p_candidate_id
    and chain_id = 1
    and provider_deployment_id = p_provider_deployment_id
    and stream_id = p_stream_id
    and block_number = normalized_block
    and block_hash = p_block_hash
    and block_global_log_index = normalized_log_index;
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
  if candidate.candidate_id is null or coverage.log_coverage_evidence_id is null then
    raise exception using
      errcode = '23514',
      message = 'Envio cursor lacks durable inbox or exact dual-RPC log coverage';
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
         (current_cursor.is_genesis
           and normalized_block <= current_cursor.block_number)
         or
         (not current_cursor.is_genesis
           and (normalized_block, normalized_log_index, p_candidate_id)
             <= (
               current_cursor.block_number::bigint,
               current_cursor.block_global_log_index::bigint,
               current_cursor.candidate_id::text
             ))
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
    normalized_log_index::programmable_private.block_log_index_value,
    p_candidate_id::programmable_private.envio_candidate_identifier,
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
      normalized_log_index::programmable_private.block_log_index_value,
      p_candidate_id::programmable_private.envio_candidate_identifier,
      p_page_commitment::programmable_private.bytes32_value,
      p_run_id, p_changed_at, created_audit_id, history_id,
      false, false, null, coverage.log_coverage_evidence_id
    ) on conflict (chain_id, provider_deployment_id, stream_id) do nothing;
  else
    update programmable_private.envio_ingestion_cursor_current
    set generation = p_next_generation,
        block_number = normalized_block,
        block_hash = p_block_hash,
        block_global_log_index = normalized_log_index,
        candidate_id = p_candidate_id,
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

create or replace function programmable_private.rewind_envio_ingestion_cursor_v1(
  p_run_id uuid,
  p_provider_deployment_id uuid,
  p_stream_id text,
  p_expected_generation bigint,
  p_next_generation bigint,
  p_target_history_generation bigint,
  p_reason_commitment bytea,
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
  current_cursor programmable_private.envio_ingestion_cursor_current%rowtype;
  target_cursor programmable_private.envio_ingestion_cursor_history%rowtype;
  genesis programmable_private.envio_ingestion_cursor_genesis_points%rowtype;
  target_block bigint;
  target_hash bytea;
  target_log bigint;
  target_candidate text;
  target_is_genesis boolean;
  target_genesis_point_id uuid;
  history_id uuid := pg_catalog.gen_random_uuid();
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'rewind'
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
      message = 'Envio cursor rewind requires a succeeded neutral rewind run';
  end if;
  if p_expected_generation < 1
     or p_next_generation <> p_expected_generation + 1
     or p_target_history_generation < 0
     or p_target_history_generation >= p_expected_generation
     or pg_catalog.octet_length(p_reason_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid Envio rewind CAS';
  end if;
  select * into current_cursor
  from programmable_private.envio_ingestion_cursor_current
  where chain_id = 1
    and provider_deployment_id = p_provider_deployment_id
    and stream_id = p_stream_id
  for update;
  if current_cursor.generation is null
     or current_cursor.generation <> p_expected_generation
  then
    raise exception using errcode = '40001', message = 'Envio rewind cursor CAS lost';
  end if;

  if p_target_history_generation = 0 then
    select * into genesis
    from programmable_private.envio_ingestion_cursor_genesis_points
    where chain_id = 1
      and provider_deployment_id = p_provider_deployment_id
      and stream_id = p_stream_id;
    if not found then
      raise exception using
        errcode = '23514', message = 'Envio rewind has no registered genesis target';
    end if;
    target_block := genesis.anchor_block_number;
    target_hash := genesis.anchor_block_hash;
    target_log := null;
    target_candidate := null;
    target_is_genesis := true;
    target_genesis_point_id := genesis.genesis_point_id;
  else
    select * into target_cursor
    from programmable_private.envio_ingestion_cursor_history
    where chain_id = 1
      and provider_deployment_id = p_provider_deployment_id
      and stream_id = p_stream_id
      and generation = p_target_history_generation;
    if not found then
      raise exception using
        errcode = '40001', message = 'Envio rewind history target is stale';
    end if;
    target_block := target_cursor.block_number;
    target_hash := target_cursor.block_hash;
    target_log := target_cursor.block_global_log_index;
    target_candidate := target_cursor.candidate_id;
    target_is_genesis := target_cursor.is_genesis;
    target_genesis_point_id := target_cursor.genesis_point_id;
  end if;

  if not exists (
    select 1 from programmable_private.dual_rpc_block_evidence
    where verification_run_id = p_run_id
      and epoch_id = header.epoch_id
      and pointer_generation = header.captured_pointer_generation
      and block_number = target_block
      and agreed_block_hash = target_hash
  ) then
    raise exception using
      errcode = '40001',
      message = 'Envio rewind target lacks fresh dual-RPC evidence';
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'envio_cursor.rewind', p_reason_commitment, p_run_id, p_changed_at
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
    target_block::programmable_private.block_number_value,
    target_hash::programmable_private.bytes32_value,
    target_log,
    target_candidate::programmable_private.envio_candidate_identifier,
    p_reason_commitment::programmable_private.bytes32_value,
    p_run_id, p_changed_at, created_audit_id, true,
    p_expected_generation, target_is_genesis, target_genesis_point_id, null
  );
  update programmable_private.envio_ingestion_cursor_current
  set generation = p_next_generation,
      block_number = target_block,
      block_hash = target_hash,
      block_global_log_index = target_log,
      candidate_id = target_candidate,
      content_commitment = p_reason_commitment,
      changed_by_run_id = p_run_id,
      changed_at = p_changed_at,
      audit_id = created_audit_id,
      cursor_history_id = history_id,
      is_genesis = target_is_genesis,
      is_rewind = true,
      genesis_point_id = target_genesis_point_id,
      log_coverage_evidence_id = null
  where chain_id = 1
    and provider_deployment_id = p_provider_deployment_id
    and stream_id = p_stream_id
    and generation = p_expected_generation;
  if not found then
    raise exception using errcode = '40001', message = 'Envio rewind cursor CAS lost';
  end if;
  return p_next_generation;
end
$function$;

create function programmable_private.commit_envio_ingestion_page_v1(
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
  item_count integer;
begin
  perform programmable_private.assert_caller('programmable_projector');
  item_count := pg_catalog.cardinality(p_candidates);
  if item_count not between 1 and 2000
     or p_outcome_id is null
     or p_log_coverage_evidence_id is null
     or pg_catalog.octet_length(p_result_commitment) <> 32
  then
    raise exception using
      errcode = '22023', message = 'invalid atomic Envio page commit';
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
        errcode = '22023', message = 'Envio page candidates are not strictly ordered';
    end if;
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
    previous_item := item;
    final_item := item;
  end loop;
  perform programmable_private.append_dual_rpc_log_coverage_evidence(
    p_log_coverage_evidence_id, p_run_id, p_provider_deployment_id,
    p_stream_id, p_expected_generation, p_next_generation,
    p_from_block_number, final_item.block_number, final_item.block_hash,
    final_item.block_global_log_index, final_item.candidate_id,
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
    final_item.block_number, final_item.block_hash,
    final_item.block_global_log_index, final_item.candidate_id,
    p_page_commitment, p_finished_at
  );
end
$function$;

-- A normalized template hash intentionally ignores linked immutable slots. A
-- release may additionally pin the exact instance hash, but a NULL exact hash
-- is never an authorization shortcut: the instance must be bound to the
-- factory deployment, launch, pool and assets below before any event from it
-- can be materialized.
alter table programmable_private.release_dynamic_source_templates
  add column expected_instance_runtime_code_hash bytea,
  add constraint dynamic_template_expected_instance_hash_check check (
    expected_instance_runtime_code_hash is null
    or pg_catalog.octet_length(expected_instance_runtime_code_hash) = 32
  );

create function programmable_private.json_hex_bytes_v1(
  p_payload jsonb,
  p_field text,
  p_octet_length integer
)
returns bytea
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select case
    when p_octet_length between 1 and 4096
      and p_payload ? p_field
      and p_payload ->> p_field
        ~ ('^0x[0-9a-f]{' || (p_octet_length * 2)::text || '}$')
    then pg_catalog.decode(pg_catalog.substr(p_payload ->> p_field, 3), 'hex')
    else null::bytea
  end
$function$;

create table programmable_private.dynamic_source_release_asset_bindings (
  dynamic_source_release_asset_binding_id uuid primary key,
  dynamic_source_attestation_id uuid not null unique
    references programmable_private.dynamic_source_attestations(
      dynamic_source_attestation_id
    ) on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  parent_factory_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  launch_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  pool_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  deployed_source_address programmable_private.eth_address not null,
  pool_id programmable_private.bytes32_value not null,
  token programmable_private.eth_address not null,
  hook programmable_private.eth_address not null,
  quote_asset programmable_private.eth_address not null,
  runtime_code_evidence_id uuid not null
    references programmable_private.dual_rpc_runtime_code_evidence(
      runtime_code_evidence_id
    ) on delete restrict,
  template_commitment programmable_private.bytes32_value not null,
  binding_commitment programmable_private.bytes32_value not null,
  verification_run_id uuid not null,
  verified_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    ) on delete restrict,
  foreign key (verification_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  check (token <> quote_asset),
  unique (epoch_id, pointer_generation, deployed_source_address),
  unique (epoch_id, binding_commitment)
);

create function programmable_private.bind_dynamic_source_release_asset_v1(
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
      errcode = '55000', message = 'dynamic asset binding requires an open verification run';
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
    raise exception using errcode = '22023', message = 'invalid dynamic release asset binding';
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
     or runtime.runtime_code_a <> runtime.runtime_code_b
     or runtime.runtime_code_a <> runtime.reconstructed_runtime_code
     or runtime.agreed_runtime_code_hash <> attestation.runtime_code_hash
     or runtime.agreed_normalized_runtime_code_hash
       <> template.normalized_runtime_code_hash
     or runtime.immutable_references_commitment
       <> template.immutable_references_commitment
     or runtime.immutable_values_commitment
       <> attestation.expected_immutable_values_commitment
     or (
       template.expected_instance_runtime_code_hash is not null
       and template.expected_instance_runtime_code_hash
         <> runtime.agreed_runtime_code_hash
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
     or parent_materialization.release_binding_id
       <> attestation.parent_factory_release_binding_id
     or parent_materialization.event_type <> template.factory_event_type
     or launch_role not in ('launcher', 'coordinator')
     or pool_role <> 'hook'
     or parent_occurrence.block_number <> attestation.deployment_block_number
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
     ) <> attestation.deployed_source_address
     or programmable_private.json_hex_bytes_v1(
       launch_materialization.decoded_payload, 'token', 20
     ) <> p_token
     or programmable_private.json_hex_bytes_v1(
       launch_materialization.decoded_payload, 'poolId', 32
     ) <> p_pool_id
     or programmable_private.json_hex_bytes_v1(
       launch_materialization.decoded_payload, 'hook', 20
     ) <> p_hook
     or programmable_private.json_hex_bytes_v1(
       launch_materialization.decoded_payload, 'quoteAsset', 20
     ) <> p_quote_asset
     or programmable_private.json_hex_bytes_v1(
       pool_materialization.decoded_payload, 'poolId', 32
     ) <> p_pool_id
     or programmable_private.json_hex_bytes_v1(
       pool_materialization.decoded_payload, 'hook', 20
     ) <> p_hook
     or not (
       programmable_private.json_hex_bytes_v1(
         pool_materialization.decoded_payload, 'currency0', 20
       ) = p_token
       and programmable_private.json_hex_bytes_v1(
         pool_materialization.decoded_payload, 'currency1', 20
       ) = p_quote_asset
       or programmable_private.json_hex_bytes_v1(
         pool_materialization.decoded_payload, 'currency1', 20
       ) = p_token
       and programmable_private.json_hex_bytes_v1(
         pool_materialization.decoded_payload, 'currency0', 20
       ) = p_quote_asset
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

create function programmable_private.enforce_dynamic_source_asset_binding_v1()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if new.dynamic_source_attestation_id is not null and not exists (
    select 1
    from programmable_private.dynamic_source_release_asset_bindings as binding
    where binding.dynamic_source_attestation_id =
      new.dynamic_source_attestation_id
      and binding.chain_id = new.chain_id
      and binding.release_id = new.release_id
      and binding.model_id = new.model_id
      and binding.source_group = new.source_group
      and binding.epoch_id = new.epoch_id
      and binding.pointer_generation = new.pointer_generation
      and exists (
        select 1 from programmable_private.chain_event_current_canonical
        where occurrence_id = binding.parent_factory_occurrence_id
      )
      and exists (
        select 1 from programmable_private.chain_event_current_canonical
        where occurrence_id = binding.launch_occurrence_id
      )
      and exists (
        select 1 from programmable_private.chain_event_current_canonical
        where occurrence_id = binding.pool_occurrence_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'dynamic occurrence lacks current exact release/factory/pool/asset binding';
  end if;
  return new;
end
$function$;

create trigger require_dynamic_source_asset_binding
before insert on programmable_private.chain_event_occurrence_materializations
for each row execute function
  programmable_private.enforce_dynamic_source_asset_binding_v1();

-- Launch position and liquidity are projection facts with their own canonical
-- source occurrence. Keeping them separate preserves the v1 DTO while making
-- the richer token-detail route evidence-complete.
create table programmable_private.launch_position_liquidity_facts (
  launch_position_liquidity_fact_id uuid primary key,
  launch_projection_id uuid not null unique
    references programmable_private.launch_projections(launch_projection_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  token programmable_private.eth_address not null,
  pool_id programmable_private.bytes32_value not null,
  position_recipient programmable_private.eth_address not null,
  position_token_id programmable_private.uint256_value not null,
  token_liquidity_amount programmable_private.uint256_value not null,
  locked_token_dust programmable_private.uint256_value not null,
  initial_sqrt_price_x96 programmable_private.uint256_value not null,
  initial_tick integer not null check (initial_tick between -887272 and 887272),
  tick_lower integer not null check (tick_lower between -887272 and 887272),
  tick_upper integer not null check (tick_upper between -887272 and 887272),
  source_occurrence_id uuid not null,
  source_logical_event_id uuid not null,
  source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null,
  fact_commitment programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash)
    references programmable_private.chain_event_occurrences(
      occurrence_id, logical_event_id, block_hash
    ) on delete restrict,
  foreign key (projection_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  check (tick_lower < initial_tick and initial_tick < tick_upper),
  unique (epoch_id, pointer_generation, token),
  unique (epoch_id, fact_commitment)
);

create function programmable_private.stage_launch_position_liquidity_v1(
  p_launch_position_liquidity_fact_id uuid,
  p_launch_projection_id uuid,
  p_run_id uuid,
  p_position_recipient bytea,
  p_position_token_id numeric,
  p_token_liquidity_amount numeric,
  p_locked_token_dust numeric, -- gitleaks:allow (next identifier is a price field, not a credential)
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
  if launch.launch_projection_id is null
     or occurrence.occurrence_id is null
     or occurrence.block_number > launch.promoted_block_number
     or pg_catalog.octet_length(p_position_recipient) <> 20
     or p_initial_tick not between -887272 and 887272
     or p_tick_lower not between -887272 and 887272
     or p_tick_upper not between -887272 and 887272
     or not (p_tick_lower < p_initial_tick and p_initial_tick < p_tick_upper)
     or liquidity_amount + locked_dust > launch.total_supply
     or pg_catalog.octet_length(p_fact_commitment) <> 32
     or programmable_private.json_hex_bytes_v1(
       materialization.decoded_payload, 'poolId', 32
     ) <> launch.pool_id
     or programmable_private.json_hex_bytes_v1(
       materialization.decoded_payload, 'token', 20
     ) <> launch.token
  then
    raise exception using
      errcode = '23514',
      message = 'launch position/liquidity lacks exact canonical source',
      detail = pg_catalog.format(
        'launch=%s occurrence=%s materialization=%s source_block=%s promoted=%s recipient_length=%s ticks=%s amount_ok=%s pool_match=%s token_match=%s',
        launch.launch_projection_id is not null,
        occurrence.occurrence_id is not null,
        materialization.materialization_id is not null,
        occurrence.block_number, launch.promoted_block_number,
        pg_catalog.octet_length(p_position_recipient),
        p_tick_lower < p_initial_tick and p_initial_tick < p_tick_upper,
        liquidity_amount + locked_dust <= launch.total_supply,
        programmable_private.json_hex_bytes_v1(materialization.decoded_payload, 'poolId', 32) = launch.pool_id,
        programmable_private.json_hex_bytes_v1(materialization.decoded_payload, 'token', 20) = launch.token
      );
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

create view programmable_private.launch_by_token_v2
with (security_invoker = false, security_barrier = true)
as
select
  launch.*,
  liquidity.position_recipient,
  liquidity.position_token_id,
  liquidity.token_liquidity_amount,
  liquidity.locked_token_dust,
  liquidity.initial_sqrt_price_x96,
  liquidity.initial_tick,
  liquidity.tick_lower,
  liquidity.tick_upper,
  liquidity.source_occurrence_id as liquidity_source_occurrence_id,
  liquidity.source_occurrence_block_hash as liquidity_source_block_hash,
  liquidity.fact_commitment as liquidity_fact_commitment
from programmable_private.launch_by_token_v1 as launch
join programmable_private.launch_position_liquidity_facts as liquidity
  on liquidity.chain_id = launch.chain_id
 and liquidity.release_id = launch.release_id
 and liquidity.model_id = launch.model_id
 and liquidity.source_group = launch.source_group
 and liquidity.epoch_id = launch.epoch_id
 and liquidity.pointer_generation = launch.pointer_generation
 and liquidity.projection_run_id = launch.projection_run_id
 and liquidity.token = launch.token
 and liquidity.pool_id = launch.pool_id
join programmable_private.chain_event_current_canonical as canonical
  on canonical.occurrence_id = liquidity.source_occurrence_id
 and canonical.logical_event_id = liquidity.source_logical_event_id
 and canonical.block_hash = liquidity.source_occurrence_block_hash;

create view programmable_private.launches_by_creator_v2
with (security_invoker = false, security_barrier = true)
as
select
  launch.*,
  liquidity.position_recipient,
  liquidity.position_token_id,
  liquidity.token_liquidity_amount,
  liquidity.locked_token_dust,
  liquidity.initial_sqrt_price_x96,
  liquidity.initial_tick,
  liquidity.tick_lower,
  liquidity.tick_upper,
  liquidity.source_occurrence_id as liquidity_source_occurrence_id,
  liquidity.source_occurrence_block_hash as liquidity_source_block_hash,
  liquidity.fact_commitment as liquidity_fact_commitment
from programmable_private.launches_by_creator_v1 as launch
join programmable_private.launch_position_liquidity_facts as liquidity
  on liquidity.chain_id = launch.chain_id
 and liquidity.release_id = launch.release_id
 and liquidity.model_id = launch.model_id
 and liquidity.source_group = launch.source_group
 and liquidity.epoch_id = launch.epoch_id
 and liquidity.pointer_generation = launch.pointer_generation
 and liquidity.projection_run_id = launch.projection_run_id
 and liquidity.token = launch.token
 and liquidity.pool_id = launch.pool_id
join programmable_private.chain_event_current_canonical as canonical
  on canonical.occurrence_id = liquidity.source_occurrence_id
 and canonical.logical_event_id = liquidity.source_logical_event_id
 and canonical.block_hash = liquidity.source_occurrence_block_hash;

-- USD values are only publishable with an exact, dual-RPC Chainlink ETH/USD
-- observation. Raw eth_call return bytes are retained so a later audit can
-- replay the ABI decoding rather than trusting denormalized price fields.
create table programmable_private.global_eth_usd_snapshots (
  global_market_snapshot_id uuid primary key,
  chain_id programmable_private.chain_id_value not null check (chain_id = 1),
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  feed_address programmable_private.eth_address not null check (
    feed_address = pg_catalog.decode(
      '5f4ec3df9cbd43714fe2740f5e3616155c5b8419', 'hex'
    )
  ),
  feed_round_id programmable_private.uint256_value not null,
  answer numeric not null check (answer > 0),
  decimals smallint not null check (decimals between 0 and 36),
  feed_updated_at timestamptz not null,
  block_evidence_id uuid not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  safe_head_observation_id uuid not null,
  provider_a_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_b_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  rpc_result_a bytea not null,
  rpc_result_b bytea not null,
  source_query_commitment programmable_private.bytes32_value not null,
  result_commitment programmable_private.bytes32_value not null,
  reconciliation_id uuid not null
    references programmable_private.reconciliation_records(reconciliation_id)
    on delete restrict,
  observed_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (
    block_evidence_id, safe_head_observation_id, epoch_id, chain_id,
    pointer_generation
  ) references programmable_private.dual_rpc_block_evidence(
    block_evidence_id, observation_id, epoch_id, chain_id, pointer_generation
  ) on delete restrict,
  foreign key (block_evidence_id, block_hash)
    references programmable_private.dual_rpc_block_evidence(
      block_evidence_id, agreed_block_hash
    ) on delete restrict,
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    ) on delete restrict,
  check (provider_a_id <> provider_b_id),
  check (rpc_result_a = rpc_result_b and pg_catalog.octet_length(rpc_result_a) > 0),
  unique (epoch_id, pointer_generation, block_hash),
  unique (epoch_id, result_commitment)
);

create table programmable_private.market_snapshot_details (
  market_snapshot_id uuid primary key
    references programmable_private.market_snapshots(market_snapshot_id)
    on delete restrict,
  tick integer not null check (tick between -887272 and 887272),
  token0_price numeric not null check (token0_price >= 0),
  token1_price numeric not null check (token1_price >= 0),
  tvl_token0 numeric not null check (tvl_token0 >= 0),
  tvl_token1 numeric not null check (tvl_token1 >= 0),
  tvl_usd numeric not null check (tvl_usd >= 0),
  transaction_count bigint not null check (transaction_count >= 0),
  global_market_snapshot_id uuid not null
    references programmable_private.global_eth_usd_snapshots(
      global_market_snapshot_id
    ) on delete restrict,
  detail_commitment programmable_private.bytes32_value not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (detail_commitment)
);

create table programmable_private.market_block_closes (
  market_block_close_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  pool_id programmable_private.bytes32_value not null,
  source_deployment_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  block_evidence_id uuid not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  block_timestamp timestamptz not null,
  last_transaction_hash programmable_private.bytes32_value not null,
  last_transaction_index programmable_private.transaction_index_value not null,
  last_block_global_log_index
    programmable_private.block_log_index_value not null,
  last_source_occurrence_id uuid not null,
  last_source_logical_event_id uuid not null,
  last_source_occurrence_block_hash
    programmable_private.bytes32_value not null,
  sqrt_price_x96 programmable_private.uint256_value not null,
  liquidity programmable_private.uint256_value not null,
  tick integer not null check (tick between -887272 and 887272),
  token0_price numeric not null check (token0_price >= 0),
  token1_price numeric not null check (token1_price >= 0),
  volume_token0 numeric not null check (volume_token0 >= 0),
  volume_token1 numeric not null check (volume_token1 >= 0),
  volume_usd numeric not null check (volume_usd >= 0),
  fees_usd numeric not null check (fees_usd >= 0),
  tvl_usd numeric not null check (tvl_usd >= 0),
  transaction_count bigint not null check (transaction_count >= 0),
  global_market_snapshot_id uuid not null
    references programmable_private.global_eth_usd_snapshots(
      global_market_snapshot_id
    ) on delete restrict,
  reconciliation_id uuid not null
    references programmable_private.reconciliation_records(reconciliation_id)
    on delete restrict,
  source_query_commitment programmable_private.bytes32_value not null,
  close_commitment programmable_private.bytes32_value not null,
  observed_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (last_source_occurrence_id, last_source_logical_event_id,
    last_source_occurrence_block_hash)
    references programmable_private.chain_event_occurrences(
      occurrence_id, logical_event_id, block_hash
    ) on delete restrict,
  foreign key (block_evidence_id, block_hash)
    references programmable_private.dual_rpc_block_evidence(
      block_evidence_id, agreed_block_hash
    ) on delete restrict,
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    ) on delete restrict,
  unique (chain_id, pool_id, block_hash),
  unique (epoch_id, close_commitment)
);

create index market_block_close_chart_idx
  on programmable_private.market_block_closes(
    chain_id, pool_id, block_number, last_block_global_log_index
  );

create table programmable_private.market_candle_details (
  market_candle_id uuid primary key
    references programmable_private.market_candles(market_candle_id)
    on delete restrict,
  closing_market_block_close_id uuid not null
    references programmable_private.market_block_closes(market_block_close_id)
    on delete restrict,
  close_sqrt_price_x96 programmable_private.uint256_value not null,
  close_liquidity programmable_private.uint256_value not null,
  close_tick integer not null check (close_tick between -887272 and 887272),
  close_token0_price numeric not null check (close_token0_price >= 0),
  close_token1_price numeric not null check (close_token1_price >= 0),
  close_tvl_usd numeric not null check (close_tvl_usd >= 0),
  fees_usd numeric not null check (fees_usd >= 0),
  transaction_count bigint not null check (transaction_count >= 0),
  global_market_snapshot_id uuid not null
    references programmable_private.global_eth_usd_snapshots(
      global_market_snapshot_id
    ) on delete restrict,
  detail_commitment programmable_private.bytes32_value not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (detail_commitment)
);

create function programmable_private.market_reconciliation_context_v1(
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
  select * into reconciliation
  from programmable_private.reconciliation_records
  where reconciliation_id = p_reconciliation_id and mismatch_count = 0;
  select * into header from programmable_private.run_headers
  where run_id = reconciliation.run_id and run_kind = 'reconciliation';
  select * into evidence from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_block_evidence_id
    and agreed_block_hash = p_block_hash;
  if reconciliation.reconciliation_id is null
     or header.run_id is null
     or evidence.block_evidence_id is null
     or exists (
       select 1 from programmable_private.run_lifecycle_outcomes
       where run_id = header.run_id
     )
     or evidence.chain_id <> header.chain_id
     or evidence.epoch_id <> header.epoch_id
     or evidence.pointer_generation <> header.captured_pointer_generation
     or evidence.block_number not between
       reconciliation.source_from_block and reconciliation.source_to_block
  then
    raise exception using
      errcode = '23514', message = 'market fact lacks open exact reconciliation and block evidence';
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

create function programmable_private.append_global_eth_usd_snapshot_v1(
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
  existing programmable_private.global_eth_usd_snapshots%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into context
  from programmable_private.market_reconciliation_context_v1(
    p_reconciliation_id, p_block_evidence_id,
    (select agreed_block_hash from programmable_private.dual_rpc_block_evidence
      where block_evidence_id = p_block_evidence_id)
  );
  select * into observation from programmable_private.safe_head_observations
  where observation_id = context.safe_head_observation_id
    and provider_a_id = p_provider_a_id
    and provider_b_id = p_provider_b_id;
  normalized_round := programmable_private.validate_uint256(p_feed_round_id);
  if context.run_id is null
     or observation.observation_id is null
     or p_provider_a_id = p_provider_b_id
     or p_answer <= 0
     or p_answer::text in ('NaN', 'Infinity', '-Infinity')
     or p_decimals not between 0 and 36
     or p_feed_updated_at > p_observed_at
     or p_rpc_result_a is null or pg_catalog.octet_length(p_rpc_result_a) = 0
     or p_rpc_result_a <> p_rpc_result_b
     or pg_catalog.octet_length(p_source_query_commitment) <> 32
     or pg_catalog.octet_length(p_result_commitment) <> 32
  then
    raise exception using errcode = '23514', message = 'invalid exact ETH/USD snapshot';
  end if;
  select * into existing from programmable_private.global_eth_usd_snapshots
  where global_market_snapshot_id = p_global_market_snapshot_id;
  if found then
    if existing.reconciliation_id <> p_reconciliation_id
       or existing.block_evidence_id <> p_block_evidence_id
       or existing.provider_a_id <> p_provider_a_id
       or existing.provider_b_id <> p_provider_b_id
       or existing.feed_round_id <> normalized_round
       or existing.answer <> p_answer
       or existing.decimals <> p_decimals
       or existing.feed_updated_at <> p_feed_updated_at
       or existing.rpc_result_a <> p_rpc_result_a
       or existing.source_query_commitment <> p_source_query_commitment
       or existing.result_commitment <> p_result_commitment
    then
      raise exception using errcode = '23505', message = 'ETH/USD snapshot replay conflict';
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
    feed_round_id, answer, decimals, feed_updated_at, block_evidence_id,
    block_number, block_hash, safe_head_observation_id,
    provider_a_id, provider_b_id, rpc_result_a, rpc_result_b,
    source_query_commitment, result_commitment, reconciliation_id,
    observed_at, audit_id
  ) values (
    p_global_market_snapshot_id, context.chain_id,
    context.release_id::programmable_private.release_identifier,
    context.model_id::programmable_private.model_identifier,
    context.source_group::programmable_private.source_identifier,
    context.epoch_id, context.pointer_generation,
    pg_catalog.decode('5f4ec3df9cbd43714fe2740f5e3616155c5b8419', 'hex'),
    normalized_round::programmable_private.uint256_value,
    p_answer, p_decimals, p_feed_updated_at, p_block_evidence_id,
    context.block_number::programmable_private.block_number_value,
    (select agreed_block_hash from programmable_private.dual_rpc_block_evidence
      where block_evidence_id = p_block_evidence_id),
    context.safe_head_observation_id, p_provider_a_id, p_provider_b_id,
    p_rpc_result_a, p_rpc_result_b,
    p_source_query_commitment::programmable_private.bytes32_value,
    p_result_commitment::programmable_private.bytes32_value,
    p_reconciliation_id, p_observed_at, created_audit_id
  );
  return p_global_market_snapshot_id;
end
$function$;

create function programmable_private.append_market_snapshot_details_v1(
  p_market_snapshot_id uuid,
  p_global_market_snapshot_id uuid,
  p_tick integer,
  p_token0_price numeric,
  p_token1_price numeric,
  p_tvl_token0 numeric,
  p_tvl_token1 numeric,
  p_tvl_usd numeric,
  p_transaction_count bigint,
  p_detail_commitment bytea,
  p_recorded_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  snapshot programmable_private.market_snapshots%rowtype;
  global_snapshot programmable_private.global_eth_usd_snapshots%rowtype;
  context record;
  existing programmable_private.market_snapshot_details%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into snapshot from programmable_private.market_snapshots
  where market_snapshot_id = p_market_snapshot_id;
  select * into context from programmable_private.market_reconciliation_context_v1(
    snapshot.reconciliation_id, snapshot.block_evidence_id, snapshot.block_hash
  );
  select * into global_snapshot
  from programmable_private.global_eth_usd_snapshots
  where global_market_snapshot_id = p_global_market_snapshot_id
    and chain_id = snapshot.chain_id
    and release_id = context.release_id
    and model_id = context.model_id
    and source_group = context.source_group
    and epoch_id = context.epoch_id
    and pointer_generation = context.pointer_generation
    and block_number <= snapshot.block_number;
  if snapshot.market_snapshot_id is null or context.run_id is null
     or global_snapshot.global_market_snapshot_id is null
     or p_tick not between -887272 and 887272
     or least(p_token0_price, p_token1_price, p_tvl_token0, p_tvl_token1,
       p_tvl_usd) < 0
     or p_token0_price::text in ('NaN', 'Infinity', '-Infinity')
     or p_token1_price::text in ('NaN', 'Infinity', '-Infinity')
     or p_tvl_token0::text in ('NaN', 'Infinity', '-Infinity')
     or p_tvl_token1::text in ('NaN', 'Infinity', '-Infinity')
     or p_tvl_usd::text in ('NaN', 'Infinity', '-Infinity')
     or p_transaction_count < 0
     or pg_catalog.octet_length(p_detail_commitment) <> 32
  then
    raise exception using errcode = '23514', message = 'invalid market snapshot detail';
  end if;
  select * into existing from programmable_private.market_snapshot_details
  where market_snapshot_id = p_market_snapshot_id;
  if found then
    if existing.global_market_snapshot_id <> p_global_market_snapshot_id
       or existing.tick <> p_tick
       or existing.token0_price <> p_token0_price
       or existing.token1_price <> p_token1_price
       or existing.tvl_token0 <> p_tvl_token0
       or existing.tvl_token1 <> p_tvl_token1
       or existing.tvl_usd <> p_tvl_usd
       or existing.transaction_count <> p_transaction_count
       or existing.detail_commitment <> p_detail_commitment
    then
      raise exception using errcode = '23505', message = 'market snapshot detail replay conflict';
    end if;
    return p_market_snapshot_id;
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'market_snapshot_detail.append', p_detail_commitment,
    context.run_id, p_recorded_at
  );
  insert into programmable_private.market_snapshot_details (
    market_snapshot_id, tick, token0_price, token1_price,
    tvl_token0, tvl_token1, tvl_usd, transaction_count,
    global_market_snapshot_id, detail_commitment, audit_id
  ) values (
    p_market_snapshot_id, p_tick, p_token0_price, p_token1_price,
    p_tvl_token0, p_tvl_token1, p_tvl_usd, p_transaction_count,
    p_global_market_snapshot_id,
    p_detail_commitment::programmable_private.bytes32_value,
    created_audit_id
  );
  return p_market_snapshot_id;
end
$function$;

create function programmable_private.append_market_block_close_v1(
  p_market_block_close_id uuid,
  p_reconciliation_id uuid,
  p_source_deployment_id uuid,
  p_block_evidence_id uuid,
  p_pool_id bytea,
  p_last_source_occurrence_id uuid,
  p_sqrt_price_x96 numeric,
  p_liquidity numeric,
  p_tick integer,
  p_token0_price numeric,
  p_token1_price numeric,
  p_volume_token0 numeric,
  p_volume_token1 numeric,
  p_volume_usd numeric,
  p_fees_usd numeric,
  p_tvl_usd numeric,
  p_transaction_count bigint,
  p_global_market_snapshot_id uuid,
  p_source_query_commitment bytea,
  p_close_commitment bytea,
  p_observed_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  evidence programmable_private.dual_rpc_block_evidence%rowtype;
  context record;
  occurrence programmable_private.chain_event_occurrences%rowtype;
  materialization
    programmable_private.chain_event_occurrence_materializations%rowtype;
  global_snapshot programmable_private.global_eth_usd_snapshots%rowtype;
  normalized_sqrt numeric;
  normalized_liquidity numeric;
  existing programmable_private.market_block_closes%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into evidence from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_block_evidence_id;
  select * into context from programmable_private.market_reconciliation_context_v1(
    p_reconciliation_id, p_block_evidence_id, evidence.agreed_block_hash
  );
  select * into occurrence from programmable_private.chain_event_occurrences
  where occurrence_id = p_last_source_occurrence_id
    and block_number = evidence.block_number
    and block_hash = evidence.agreed_block_hash;
  select * into materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = p_last_source_occurrence_id
    and chain_id = context.chain_id
    and release_id = context.release_id
    and model_id = context.model_id
    and source_group = context.source_group
    and epoch_id = context.epoch_id
    and pointer_generation = context.pointer_generation;
  select * into global_snapshot
  from programmable_private.global_eth_usd_snapshots
  where global_market_snapshot_id = p_global_market_snapshot_id
    and chain_id = context.chain_id
    and release_id = context.release_id
    and model_id = context.model_id
    and source_group = context.source_group
    and epoch_id = context.epoch_id
    and pointer_generation = context.pointer_generation
    and block_number <= context.block_number;
  normalized_sqrt := programmable_private.validate_uint256(p_sqrt_price_x96);
  normalized_liquidity := programmable_private.validate_uint256(p_liquidity);
  if context.run_id is null or occurrence.occurrence_id is null
     or materialization.materialization_id is null
     or global_snapshot.global_market_snapshot_id is null
     or not exists (
       select 1 from programmable_private.chain_event_current_canonical
       where occurrence_id = p_last_source_occurrence_id
     )
     or not exists (
       select 1 from programmable_private.provider_deployments
       where provider_deployment_id = p_source_deployment_id
         and provider_type = 'uniswap_subgraph'
     )
     or pg_catalog.octet_length(p_pool_id) <> 32
     or p_tick not between -887272 and 887272
     or least(p_token0_price, p_token1_price, p_volume_token0,
       p_volume_token1, p_volume_usd, p_fees_usd, p_tvl_usd) < 0
     or p_token0_price::text in ('NaN', 'Infinity', '-Infinity')
     or p_token1_price::text in ('NaN', 'Infinity', '-Infinity')
     or p_volume_token0::text in ('NaN', 'Infinity', '-Infinity')
     or p_volume_token1::text in ('NaN', 'Infinity', '-Infinity')
     or p_volume_usd::text in ('NaN', 'Infinity', '-Infinity')
     or p_fees_usd::text in ('NaN', 'Infinity', '-Infinity')
     or p_tvl_usd::text in ('NaN', 'Infinity', '-Infinity')
     or p_transaction_count < 0
     or pg_catalog.octet_length(p_source_query_commitment) <> 32
     or pg_catalog.octet_length(p_close_commitment) <> 32
  then
    raise exception using errcode = '23514', message = 'invalid exact per-block market close';
  end if;
  select * into existing from programmable_private.market_block_closes
  where market_block_close_id = p_market_block_close_id;
  if found then
    if existing.reconciliation_id <> p_reconciliation_id
       or existing.source_deployment_id <> p_source_deployment_id
       or existing.block_evidence_id <> p_block_evidence_id
       or existing.pool_id <> p_pool_id
       or existing.last_source_occurrence_id <> p_last_source_occurrence_id
       or existing.sqrt_price_x96 <> normalized_sqrt
       or existing.liquidity <> normalized_liquidity
       or existing.tick <> p_tick
       or existing.close_commitment <> p_close_commitment
    then
      raise exception using errcode = '23505', message = 'market block close replay conflict';
    end if;
    return existing.market_block_close_id;
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'market_block_close.append', p_close_commitment,
    context.run_id, p_observed_at
  );
  insert into programmable_private.market_block_closes (
    market_block_close_id, chain_id, release_id, model_id, source_group,
    epoch_id, pointer_generation, pool_id, source_deployment_id,
    block_evidence_id, block_number, block_hash, block_timestamp,
    last_transaction_hash, last_transaction_index,
    last_block_global_log_index, last_source_occurrence_id,
    last_source_logical_event_id, last_source_occurrence_block_hash,
    sqrt_price_x96, liquidity, tick, token0_price, token1_price,
    volume_token0, volume_token1, volume_usd, fees_usd, tvl_usd,
    transaction_count, global_market_snapshot_id, reconciliation_id,
    source_query_commitment, close_commitment, observed_at, audit_id
  ) values (
    p_market_block_close_id, context.chain_id,
    context.release_id::programmable_private.release_identifier,
    context.model_id::programmable_private.model_identifier,
    context.source_group::programmable_private.source_identifier,
    context.epoch_id, context.pointer_generation,
    p_pool_id::programmable_private.bytes32_value, p_source_deployment_id,
    p_block_evidence_id, context.block_number,
    evidence.agreed_block_hash, occurrence.block_timestamp,
    occurrence.transaction_hash, occurrence.transaction_index,
    occurrence.block_global_log_index, occurrence.occurrence_id,
    occurrence.logical_event_id, occurrence.block_hash,
    normalized_sqrt::programmable_private.uint256_value,
    normalized_liquidity::programmable_private.uint256_value,
    p_tick, p_token0_price, p_token1_price, p_volume_token0,
    p_volume_token1, p_volume_usd, p_fees_usd, p_tvl_usd,
    p_transaction_count, p_global_market_snapshot_id,
    p_reconciliation_id,
    p_source_query_commitment::programmable_private.bytes32_value,
    p_close_commitment::programmable_private.bytes32_value,
    p_observed_at, created_audit_id
  );
  return p_market_block_close_id;
end
$function$;

create function programmable_private.append_market_candle_details_v1(
  p_market_candle_id uuid,
  p_closing_market_block_close_id uuid,
  p_detail_commitment bytea,
  p_recorded_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  candle programmable_private.market_candles%rowtype;
  close_fact programmable_private.market_block_closes%rowtype;
  context record;
  existing programmable_private.market_candle_details%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into candle from programmable_private.market_candles
  where market_candle_id = p_market_candle_id;
  select * into context from programmable_private.market_reconciliation_context_v1(
    candle.reconciliation_id, candle.source_block_evidence_id,
    candle.source_block_hash
  );
  select * into close_fact from programmable_private.market_block_closes
  where market_block_close_id = p_closing_market_block_close_id
    and chain_id = candle.chain_id
    and pool_id = candle.pool_id
    and reconciliation_id = candle.reconciliation_id
    and block_number <= candle.source_block_number
    and block_timestamp < candle.period_end;
  if candle.market_candle_id is null or context.run_id is null
     or close_fact.market_block_close_id is null
     or pg_catalog.octet_length(p_detail_commitment) <> 32
  then
    raise exception using errcode = '23514', message = 'invalid candle close detail';
  end if;
  select * into existing from programmable_private.market_candle_details
  where market_candle_id = p_market_candle_id;
  if found then
    if existing.closing_market_block_close_id
         <> p_closing_market_block_close_id
       or existing.detail_commitment <> p_detail_commitment
    then
      raise exception using errcode = '23505', message = 'market candle detail replay conflict';
    end if;
    return p_market_candle_id;
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'market_candle_detail.append', p_detail_commitment,
    context.run_id, p_recorded_at
  );
  insert into programmable_private.market_candle_details (
    market_candle_id, closing_market_block_close_id,
    close_sqrt_price_x96, close_liquidity, close_tick,
    close_token0_price, close_token1_price, close_tvl_usd,
    fees_usd, transaction_count, global_market_snapshot_id,
    detail_commitment, audit_id
  ) values (
    p_market_candle_id, close_fact.market_block_close_id,
    close_fact.sqrt_price_x96, close_fact.liquidity, close_fact.tick,
    close_fact.token0_price, close_fact.token1_price, close_fact.tvl_usd,
    close_fact.fees_usd, close_fact.transaction_count,
    close_fact.global_market_snapshot_id,
    p_detail_commitment::programmable_private.bytes32_value,
    created_audit_id
  );
  return p_market_candle_id;
end
$function$;

create view programmable_private.global_eth_usd_snapshots_v1
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
 and current_epoch.generation = snapshot.pointer_generation;

create view programmable_private.market_snapshots_v2
with (security_invoker = false, security_barrier = true)
as
select snapshot.*, detail.tick, detail.token0_price, detail.token1_price,
  detail.tvl_token0, detail.tvl_token1, detail.tvl_usd,
  detail.transaction_count, detail.global_market_snapshot_id,
  detail.detail_commitment
from programmable_private.market_snapshots_v1 as snapshot
join programmable_private.market_snapshot_details as detail
  on detail.market_snapshot_id = snapshot.market_snapshot_id
join programmable_private.global_eth_usd_snapshots_v1 as global_snapshot
  on global_snapshot.global_market_snapshot_id =
    detail.global_market_snapshot_id;

create view programmable_private.market_block_closes_v1
with (security_invoker = false, security_barrier = true)
as
select launch.token, close_fact.*
from programmable_private.market_block_closes as close_fact
join programmable_private.reconciliation_records as reconciliation
  on reconciliation.reconciliation_id = close_fact.reconciliation_id
 and reconciliation.mismatch_count = 0
join programmable_private.run_headers as run
  on run.run_id = reconciliation.run_id
 and run.run_kind = 'reconciliation'
join programmable_private.run_lifecycle_outcomes as outcome
  on outcome.run_id = run.run_id and outcome.status = 'succeeded'
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = close_fact.chain_id
 and current_epoch.release_id = close_fact.release_id
 and current_epoch.model_id = close_fact.model_id
 and current_epoch.source_group = close_fact.source_group
 and current_epoch.epoch_id = close_fact.epoch_id
 and current_epoch.generation = close_fact.pointer_generation
join programmable_private.chain_event_current_canonical as canonical
  on canonical.occurrence_id = close_fact.last_source_occurrence_id
 and canonical.logical_event_id = close_fact.last_source_logical_event_id
 and canonical.block_hash = close_fact.last_source_occurrence_block_hash
join programmable_private.global_eth_usd_snapshots_v1 as global_snapshot
  on global_snapshot.global_market_snapshot_id =
    close_fact.global_market_snapshot_id
join programmable_private.launch_by_token_v1 as launch
  on launch.chain_id = close_fact.chain_id
 and launch.release_id = close_fact.release_id
 and launch.model_id = close_fact.model_id
 and launch.source_group = close_fact.source_group
 and launch.epoch_id = close_fact.epoch_id
 and launch.pointer_generation = close_fact.pointer_generation
 and launch.pool_id = close_fact.pool_id;

create view programmable_private.market_candles_v2
with (security_invoker = false, security_barrier = true)
as
select candle.*, detail.closing_market_block_close_id,
  detail.close_sqrt_price_x96, detail.close_liquidity,
  detail.close_tick, detail.close_token0_price,
  detail.close_token1_price, detail.close_tvl_usd,
  detail.fees_usd, detail.transaction_count,
  detail.global_market_snapshot_id, detail.detail_commitment
from programmable_private.market_candles_v1 as candle
join programmable_private.market_candle_details as detail
  on detail.market_candle_id = candle.market_candle_id
join programmable_private.market_block_closes_v1 as close_fact
  on close_fact.market_block_close_id =
    detail.closing_market_block_close_id;

create index claim_projection_recipient_history_idx
  on programmable_private.claim_projections(
    chain_id, recipient, promoted_block_number desc, claim_projection_id
  );

-- Claims are append-only published facts, not merely the latest balance. The
-- launch join intentionally follows the current vault identity across delta
-- projection runs; requiring the claim and launch to share a run would erase
-- valid history whenever only rewards changed.
create view programmable_private.claim_history_v1
with (security_invoker = false, security_barrier = true)
as
select
  claim.claim_projection_id,
  claim.chain_id,
  claim.release_id,
  claim.model_id,
  run.source_group,
  claim.epoch_id,
  claim.pointer_generation,
  launch.token,
  launch.token_name,
  launch.token_symbol,
  launch.creator,
  launch.pool_id,
  launch.hook,
  launch.quote_asset,
  claim.vault,
  claim.claimant_kind,
  claim.beneficiary,
  claim.recipient,
  claim.amount,
  claim.beneficiary_total_claimed,
  claim.vault_total_received,
  occurrence.transaction_hash,
  occurrence.block_number,
  occurrence.block_hash,
  occurrence.block_timestamp,
  occurrence.transaction_index::bigint as transaction_index,
  occurrence.block_global_log_index::bigint as block_global_log_index,
  occurrence.receipt_log_ordinal::bigint as receipt_log_ordinal,
  claim.source_occurrence_id,
  claim.source_logical_event_id,
  claim.projection_run_id,
  claim.promoted_block_number,
  claim.promoted_block_hash,
  claim.verified_at
from programmable_private.claim_projections as claim
join programmable_private.run_headers as run
  on run.run_id = claim.projection_run_id
 and run.run_kind = 'projection'
 and run.chain_id = claim.chain_id
 and run.release_id = claim.release_id
 and run.model_id = claim.model_id
 and run.epoch_id = claim.epoch_id
 and run.captured_pointer_generation = claim.pointer_generation
join programmable_private.run_lifecycle_outcomes as outcome
  on outcome.run_id = run.run_id and outcome.status = 'succeeded'
join programmable_private.projection_publications as publication
  on publication.run_id = run.run_id
 and publication.epoch_id = run.epoch_id
 and publication.pointer_generation = run.captured_pointer_generation
 and publication.target_block_number = claim.promoted_block_number
 and publication.target_block_hash = claim.promoted_block_hash
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = run.chain_id
 and current_epoch.release_id = run.release_id
 and current_epoch.model_id = run.model_id
 and current_epoch.source_group = run.source_group
 and current_epoch.epoch_id = run.epoch_id
 and current_epoch.generation = run.captured_pointer_generation
join programmable_private.route_eligibility_current as route
  on route.route_key = 'creator-profile'
 and route.chain_id = run.chain_id
 and route.release_id = run.release_id
 and route.model_id = run.model_id
 and route.source_group = run.source_group
 and route.epoch_id = run.epoch_id
 and route.pointer_generation = run.captured_pointer_generation
 and route.checkpoint_id is not null
 and route.status = 'eligible'
 and route.route_mode = 'indexed'
join programmable_private.chain_event_current_canonical as canonical
  on canonical.occurrence_id = claim.source_occurrence_id
 and canonical.logical_event_id = claim.source_logical_event_id
 and canonical.block_hash = claim.source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as occurrence
  on occurrence.occurrence_id = claim.source_occurrence_id
 and occurrence.logical_event_id = claim.source_logical_event_id
 and occurrence.block_hash = claim.source_occurrence_block_hash
 and occurrence.chain_id = run.chain_id
 and occurrence.release_id = run.release_id
 and occurrence.model_id = run.model_id
 and occurrence.source_group = run.source_group
 and occurrence.epoch_id = run.epoch_id
 and occurrence.pointer_generation = run.captured_pointer_generation
join programmable_private.launches_by_creator_v1 as launch
  on launch.chain_id = claim.chain_id
 and launch.release_id = claim.release_id
 and launch.model_id = claim.model_id
 and launch.source_group = run.source_group
 and launch.epoch_id = claim.epoch_id
 and launch.pointer_generation = claim.pointer_generation
 and launch.reward_vault = claim.vault;

create function programmable_private.get_claim_history_v1(
  p_chain_id numeric,
  p_account bytea,
  p_limit integer default 50,
  p_before_block numeric default null,
  p_before_log_index numeric default null
)
returns setof programmable_private.claim_history_v1
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_chain bigint;
  normalized_before_block bigint;
  normalized_before_log bigint;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id <> pg_catalog.trunc(p_chain_id)
     or p_chain_id < 1 or p_chain_id > 9223372036854775807
     or pg_catalog.octet_length(p_account) <> 20
     or p_limit not between 1 and 100
     or (p_before_block is null) <> (p_before_log_index is null)
     or (p_before_block is not null and (
       p_before_block <> pg_catalog.trunc(p_before_block)
       or p_before_block < 0 or p_before_block > 9223372036854775807
       or p_before_log_index <> pg_catalog.trunc(p_before_log_index)
       or p_before_log_index < 0 or p_before_log_index > 4294967295
     ))
  then
    raise exception using errcode = '22023', message = 'invalid claim-history query';
  end if;
  normalized_chain := p_chain_id::bigint;
  normalized_before_block := p_before_block::bigint;
  normalized_before_log := p_before_log_index::bigint;
  return query
  select history.*
  from programmable_private.claim_history_v1 as history
  where history.chain_id = normalized_chain
    and (history.beneficiary = p_account or history.recipient = p_account)
    and (
      normalized_before_block is null
      or (history.block_number::bigint, history.block_global_log_index)
        < (normalized_before_block, normalized_before_log)
    )
  order by history.block_number desc,
           history.block_global_log_index desc,
           history.claim_projection_id desc
  limit p_limit;
end
$function$;

-- Readiness is bound to the exact canonical checkpoint identity. Epoch,
-- generation and block tuples are not substitutes because two projector
-- versions can materialize different rows at the same chain position.
create or replace view programmable_private.checkpoint_summary_v1
with (security_invoker = false, security_barrier = true)
as
select
  checkpoint.chain_id,
  checkpoint.release_id,
  checkpoint.model_id,
  checkpoint.source_group,
  checkpoint.projector_version,
  checkpoint.epoch_id,
  checkpoint.pointer_generation,
  checkpoint.lease_generation,
  checkpoint.checkpoint_generation,
  checkpoint.reorg_generation,
  checkpoint.block_number,
  checkpoint.block_hash,
  checkpoint.cursor_block_global_log_index,
  checkpoint.cursor_candidate_id,
  checkpoint.created_at,
  checkpoint.checkpoint_id
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
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = checkpoint.chain_id
 and current_epoch.release_id = checkpoint.release_id
 and current_epoch.model_id = checkpoint.model_id
 and current_epoch.source_group = checkpoint.source_group
 and current_epoch.epoch_id = checkpoint.epoch_id
 and current_epoch.generation = checkpoint.pointer_generation;

-- Stateless workers must reconstruct their exact release contract without
-- base-table access. This reader returns one exact current epoch plus four
-- deterministically ordered JSON arrays. Numeric EVM ordinals are rendered as
-- decimal strings and bytes as 0x-prefixed lowercase hex so no JavaScript
-- number coercion or driver-specific bytea rendering can change the manifest.
create function programmable_private.get_projector_release_manifest_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_id uuid,
  p_pointer_generation bigint
)
returns table (
  epoch_id uuid,
  pointer_generation bigint,
  epoch_commitment bytea,
  artifact_creation_code_commitment bytea,
  source_bindings jsonb,
  dynamic_source_templates jsonb,
  projection_event_rules jsonb,
  launch_completeness_requirements jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_current_epoch(
    p_chain_id, p_release_id, p_model_id, p_source_group,
    p_epoch_id, p_pointer_generation
  );
  return query
  select
    epoch.epoch_id,
    p_pointer_generation,
    epoch.epoch_commitment::bytea,
    epoch.artifact_creation_code_commitment::bytea,
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'binding_id', binding.binding_id::text,
          'source_name', binding.source_name::text,
          'source_role', binding.source_role::text,
          'source_type', binding.source_type::text,
          'source_address', case when binding.source_address is null then null
            else '0x' || pg_catalog.encode(binding.source_address, 'hex') end,
          'recovery_selector', case when binding.recovery_selector is null then null
            else '0x' || pg_catalog.encode(binding.recovery_selector, 'hex') end,
          'inclusive_start_block', binding.inclusive_start_block::text,
          'abi_event_set_commitment',
            '0x' || pg_catalog.encode(binding.abi_event_set_commitment, 'hex'),
          'artifact_creation_code_commitment',
            '0x' || pg_catalog.encode(
              binding.artifact_creation_code_commitment, 'hex'
            ),
          'binding_commitment',
            '0x' || pg_catalog.encode(binding.binding_commitment, 'hex')
        ) order by binding.source_role, binding.source_name, binding.binding_id
      )
      from programmable_private.release_source_bindings as binding
      where binding.epoch_id = epoch.epoch_id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'dynamic_source_template_id', template.dynamic_source_template_id::text,
          'parent_factory_release_binding_id',
            template.parent_factory_release_binding_id::text,
          'parent_factory_binding_commitment',
            '0x' || pg_catalog.encode(
              template.parent_factory_binding_commitment, 'hex'
            ),
          'parent_source_role', template.parent_source_role::text,
          'factory_event_type', template.factory_event_type::text,
          'deployed_address_field', template.deployed_address_field::text,
          'deployed_source_role', template.deployed_source_role::text,
          'deployed_artifact_creation_code_commitment',
            '0x' || pg_catalog.encode(
              template.deployed_artifact_creation_code_commitment, 'hex'
            ),
          'normalized_runtime_code_hash',
            '0x' || pg_catalog.encode(
              template.normalized_runtime_code_hash, 'hex'
            ),
          'expected_instance_runtime_code_hash',
            case when template.expected_instance_runtime_code_hash is null
              then null else '0x' || pg_catalog.encode(
                template.expected_instance_runtime_code_hash, 'hex'
              ) end,
          'immutable_references_commitment',
            '0x' || pg_catalog.encode(
              template.immutable_references_commitment, 'hex'
            ),
          'immutable_binding_spec', template.immutable_binding_spec,
          'immutable_binding_commitment',
            '0x' || pg_catalog.encode(
              template.immutable_binding_commitment, 'hex'
            ),
          'runtime_code_length', template.runtime_code_length::text,
          'abi_event_set_commitment',
            '0x' || pg_catalog.encode(template.abi_event_set_commitment, 'hex'),
          'template_commitment',
            '0x' || pg_catalog.encode(template.template_commitment, 'hex')
        ) order by template.parent_source_role,
                   template.factory_event_type,
                   template.deployed_source_role,
                   template.dynamic_source_template_id
      )
      from programmable_private.release_dynamic_source_templates as template
      where template.epoch_id = epoch.epoch_id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'projection_event_rule_id', rule.projection_event_rule_id::text,
          'projection_kind', rule.projection_kind::text,
          'source_role', rule.source_role::text,
          'event_type', rule.event_type::text,
          'rule_commitment',
            '0x' || pg_catalog.encode(rule.rule_commitment, 'hex')
        ) order by rule.projection_kind, rule.source_role,
                   rule.event_type, rule.projection_event_rule_id
      )
      from programmable_private.release_projection_event_rules as rule
      where rule.epoch_id = epoch.epoch_id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'launch_requirement_id', requirement.launch_requirement_id::text,
          'requirement_ordinal', requirement.requirement_ordinal,
          'occurrence_role', requirement.occurrence_role::text,
          'event_type', requirement.event_type::text,
          'required_when', requirement.required_when::text,
          'requirement_commitment',
            '0x' || pg_catalog.encode(
              requirement.requirement_commitment, 'hex'
            )
        ) order by requirement.requirement_ordinal,
                   requirement.launch_requirement_id
      )
      from programmable_private.release_launch_completeness_requirements
        as requirement
      where requirement.epoch_id = epoch.epoch_id
    ), '[]'::jsonb)
  from programmable_private.release_epochs as epoch
  where epoch.epoch_id = p_epoch_id
    and epoch.chain_id = p_chain_id
    and epoch.release_id = p_release_id
    and epoch.model_id = p_model_id
    and epoch.source_group = p_source_group;
end
$function$;

-- Only fully asset-bound attestations whose factory, launch and pool
-- occurrences remain current canonical can authorize dynamic log filters.
create function programmable_private.get_projector_dynamic_source_attestations_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_id uuid,
  p_pointer_generation bigint
)
returns table (
  dynamic_source_attestation_id uuid,
  dynamic_source_template_id uuid,
  runtime_code_evidence_id uuid,
  deployed_source_address bytea,
  deployed_source_role text,
  deployment_block_number bigint,
  runtime_code_hash bytea,
  normalized_runtime_code_hash bytea,
  expected_instance_runtime_code_hash bytea,
  runtime_code_length bigint,
  immutable_references_commitment bytea,
  immutable_binding_spec jsonb,
  immutable_binding_commitment bytea,
  abi_event_set_commitment bytea,
  template_commitment bytea,
  attestation_commitment bytea,
  parent_factory_occurrence_id uuid,
  parent_factory_release_binding_id uuid,
  parent_factory_binding_commitment bytea,
  dynamic_source_release_asset_binding_id uuid,
  launch_occurrence_id uuid,
  pool_occurrence_id uuid,
  token bytea,
  pool_id bytea,
  hook bytea,
  quote_asset bytea,
  asset_binding_commitment bytea
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_current_epoch(
    p_chain_id, p_release_id, p_model_id, p_source_group,
    p_epoch_id, p_pointer_generation
  );
  return query
  select
    attestation.dynamic_source_attestation_id,
    attestation.dynamic_source_template_id,
    attestation.runtime_code_evidence_id,
    attestation.deployed_source_address::bytea,
    attestation.deployed_source_role::text,
    attestation.deployment_block_number::bigint,
    attestation.runtime_code_hash::bytea,
    template.normalized_runtime_code_hash::bytea,
    template.expected_instance_runtime_code_hash::bytea,
    template.runtime_code_length::bigint,
    template.immutable_references_commitment::bytea,
    template.immutable_binding_spec,
    template.immutable_binding_commitment::bytea,
    attestation.abi_event_set_commitment::bytea,
    template.template_commitment::bytea,
    attestation.attestation_commitment::bytea,
    attestation.parent_factory_occurrence_id,
    attestation.parent_factory_release_binding_id,
    attestation.parent_factory_binding_commitment::bytea,
    binding.dynamic_source_release_asset_binding_id,
    binding.launch_occurrence_id,
    binding.pool_occurrence_id,
    binding.token::bytea,
    binding.pool_id::bytea,
    binding.hook::bytea,
    binding.quote_asset::bytea,
    binding.binding_commitment::bytea
  from programmable_private.dynamic_source_attestations as attestation
  join programmable_private.release_dynamic_source_templates as template
    on template.dynamic_source_template_id =
       attestation.dynamic_source_template_id
   and template.epoch_id = attestation.epoch_id
  join programmable_private.dynamic_source_release_asset_bindings as binding
    on binding.dynamic_source_attestation_id =
       attestation.dynamic_source_attestation_id
   and binding.chain_id = attestation.chain_id
   and binding.release_id = attestation.release_id
   and binding.model_id = attestation.model_id
   and binding.source_group = attestation.source_group
   and binding.epoch_id = attestation.epoch_id
   and binding.pointer_generation = attestation.pointer_generation
  join programmable_private.chain_event_current_canonical as parent_current
    on parent_current.occurrence_id = attestation.parent_factory_occurrence_id
  join programmable_private.chain_event_current_canonical as launch_current
    on launch_current.occurrence_id = binding.launch_occurrence_id
  join programmable_private.chain_event_current_canonical as pool_current
    on pool_current.occurrence_id = binding.pool_occurrence_id
  where attestation.chain_id = p_chain_id
    and attestation.release_id = p_release_id
    and attestation.model_id = p_model_id
    and attestation.source_group = p_source_group
    and attestation.epoch_id = p_epoch_id
    and attestation.pointer_generation = p_pointer_generation
  order by attestation.deployed_source_address,
           attestation.deployed_source_role,
           attestation.dynamic_source_attestation_id;
end
$function$;

-- Terminal decisions are omitted from the ordinary work page, so a restarted
-- worker needs a separately paged, lease-fenced recovery stream to reproduce
-- the exact ordered decision IDs required by promotion folds.
create function programmable_private.list_projector_candidate_dispositions_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_id uuid,
  p_pointer_generation bigint,
  p_projector_version text,
  p_lease_generation bigint,
  p_lease_token_hash bytea,
  p_after_block_number numeric,
  p_after_block_global_log_index numeric,
  p_after_candidate_id text,
  p_limit integer,
  p_now timestamptz
)
returns table (
  candidate_id text,
  block_number bigint,
  block_hash bytea,
  transaction_hash bytea,
  transaction_index bigint,
  block_global_log_index bigint,
  status text,
  attempt_count bigint,
  decision_id uuid,
  reason_code text,
  reason_commitment bytea,
  changed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_after_block bigint;
  normalized_after_log_index bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_current_epoch(
    p_chain_id, p_release_id, p_model_id, p_source_group,
    p_epoch_id, p_pointer_generation
  );
  if p_limit < 1 or p_limit > 500 or p_now is null
     or pg_catalog.octet_length(p_lease_token_hash) <> 32
     or ((p_after_block_number is null)
       <> (p_after_block_global_log_index is null))
     or ((p_after_block_number is null) <> (p_after_candidate_id is null))
     or not exists (
       select 1 from programmable_private.projector_lease_current as lease
       where lease.chain_id = p_chain_id
         and lease.release_id = p_release_id
         and lease.model_id = p_model_id
         and lease.source_group = p_source_group
         and lease.projector_version = p_projector_version
         and lease.epoch_id = p_epoch_id
         and lease.pointer_generation = p_pointer_generation
         and lease.lease_generation = p_lease_generation
         and lease.lease_token_hash = p_lease_token_hash
         and lease.expires_at >= p_now
     )
  then
    raise exception using
      errcode = '40001', message = 'invalid or stale disposition-page lease';
  end if;
  if p_after_block_number is not null then
    if p_after_block_number <> pg_catalog.trunc(p_after_block_number)
       or p_after_block_number < 0
       or p_after_block_number > 9223372036854775807
       or p_after_block_global_log_index
         <> pg_catalog.trunc(p_after_block_global_log_index)
       or p_after_block_global_log_index < 0
       or p_after_block_global_log_index > 4294967295
       or pg_catalog.octet_length(
         p_after_candidate_id::programmable_private.envio_candidate_identifier
       ) > 192
    then
      raise exception using
        errcode = '22023', message = 'invalid disposition-page cursor';
    end if;
    normalized_after_block := p_after_block_number::bigint;
    normalized_after_log_index := p_after_block_global_log_index::bigint;
  end if;
  return query
  select
    candidate.candidate_id::text,
    candidate.block_number::bigint,
    candidate.block_hash::bytea,
    candidate.transaction_hash::bytea,
    candidate.transaction_index::bigint,
    candidate.block_global_log_index::bigint,
    disposition.status::text,
    disposition.attempt_count::bigint,
    disposition.decision_id,
    disposition.reason_code::text,
    disposition.reason_commitment::bytea,
    disposition.changed_at
  from programmable_private.envio_candidate_status_current as disposition
  join programmable_private.envio_candidate_inbox as candidate
    on candidate.candidate_id = disposition.candidate_id
   and candidate.chain_id = disposition.chain_id
  where disposition.chain_id = p_chain_id
    and disposition.release_id = p_release_id
    and disposition.model_id = p_model_id
    and disposition.source_group = p_source_group
    and disposition.epoch_id = p_epoch_id
    and disposition.pointer_generation = p_pointer_generation
    and disposition.status in ('resolved', 'ignored', 'quarantined')
    and (
      p_after_block_number is null
      or (
        candidate.block_number::bigint,
        candidate.block_global_log_index::bigint,
        candidate.candidate_id::text
      ) > (
        normalized_after_block, normalized_after_log_index,
        p_after_candidate_id
      )
    )
  order by candidate.block_number, candidate.block_global_log_index,
           candidate.candidate_id
  limit p_limit;
end
$function$;

-- Close the migration under the same deny-by-default role model as the prior
-- schema. Base tables are never granted to runtime roles; only named definer
-- functions and stable barrier views form the service API.
do $expanded_p0_rls$
declare
  table_name text;
begin
  foreach table_name in array array[
    'dual_rpc_log_coverage_evidence',
    'envio_ingestion_cursor_genesis_points',
    'dynamic_source_release_asset_bindings',
    'launch_position_liquidity_facts',
    'global_eth_usd_snapshots',
    'market_snapshot_details',
    'market_block_closes',
    'market_candle_details'
  ] loop
    execute pg_catalog.format(
      'alter table programmable_private.%I enable row level security',
      table_name
    );
    execute pg_catalog.format(
      'alter table programmable_private.%I force row level security',
      table_name
    );
    execute pg_catalog.format(
      'create policy %I on programmable_private.%I for all ' ||
      'to programmable_migrator using (true) with check (true)',
      table_name || '_migrator_all', table_name
    );
  end loop;
end
$expanded_p0_rls$;

do $expanded_p0_immutable$
declare
  table_name text;
begin
  foreach table_name in array array[
    'dual_rpc_log_coverage_evidence',
    'envio_ingestion_cursor_genesis_points',
    'dynamic_source_release_asset_bindings',
    'global_eth_usd_snapshots',
    'market_block_closes'
  ] loop
    execute pg_catalog.format(
      'create trigger reject_immutable_mutation before update or delete ' ||
      'on programmable_private.%I for each row execute function ' ||
      'programmable_private.reject_immutable_mutation()',
      table_name
    );
  end loop;
  foreach table_name in array array[
    'market_snapshot_details', 'market_candle_details'
  ] loop
    execute pg_catalog.format(
      'create trigger reject_immutable_update before update ' ||
      'on programmable_private.%I for each row execute function ' ||
      'programmable_private.reject_immutable_mutation()',
      table_name
    );
  end loop;
end
$expanded_p0_immutable$;

revoke all on function programmable_private.append_dual_rpc_runtime_code_evidence(
  uuid, uuid, bytea, uuid, uuid, uuid, bytea, bytea, bytea, bytea,
  numeric, numeric, bytea, bytea, bytea, bytea[], bytea, bytea, bytea,
  smallint, bytea, bytea, bytea, timestamptz
) from public;
grant execute on function programmable_private.append_dual_rpc_runtime_code_evidence(
  uuid, uuid, bytea, uuid, uuid, uuid, bytea, bytea, bytea, bytea,
  numeric, numeric, bytea, bytea, bytea, bytea[], bytea, bytea, bytea,
  smallint, bytea, bytea, bytea, timestamptz
) to programmable_projector;

revoke all on function programmable_private.advance_envio_ingestion_cursor_v1(
  uuid, uuid, text, bigint, bigint, numeric, bytea, numeric, text, bytea,
  timestamptz
) from programmable_projector;
grant usage on type programmable_private.envio_candidate_page_item_v1
  to programmable_projector;
grant execute on function programmable_private.register_envio_ingestion_genesis_v1(
  uuid, uuid, uuid, text, uuid, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.commit_envio_ingestion_page_v1(
  uuid, uuid, uuid, uuid, text, bigint, bigint, numeric,
  programmable_private.envio_candidate_page_item_v1[], uuid, uuid,
  uuid, uuid, bytea, bytea[], bytea[], bytea, bytea, smallint,
  bytea, bytea, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.bind_dynamic_source_release_asset_v1(
  uuid, uuid, uuid, uuid, uuid, bytea, bytea, bytea, bytea, bytea,
  timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_launch_position_liquidity_v1(
  uuid, uuid, uuid, bytea, numeric, numeric, numeric, numeric,
  integer, integer, integer, uuid, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.get_projector_release_manifest_v1(
  bigint, text, text, text, uuid, bigint
) to programmable_projector;
grant execute on function programmable_private.get_projector_dynamic_source_attestations_v1(
  bigint, text, text, text, uuid, bigint
) to programmable_projector;
grant execute on function programmable_private.list_projector_candidate_dispositions_v1(
  bigint, text, text, text, uuid, bigint, text, bigint, bytea,
  numeric, numeric, text, integer, timestamptz
) to programmable_projector;

grant execute on function programmable_private.append_global_eth_usd_snapshot_v1(
  uuid, uuid, uuid, uuid, uuid, numeric, numeric, smallint,
  timestamptz, bytea, bytea, bytea, bytea, timestamptz
) to programmable_reconciler;
grant execute on function programmable_private.append_market_snapshot_details_v1(
  uuid, uuid, integer, numeric, numeric, numeric, numeric, numeric,
  bigint, bytea, timestamptz
) to programmable_reconciler;
grant execute on function programmable_private.append_market_block_close_v1(
  uuid, uuid, uuid, uuid, bytea, uuid, numeric, numeric, integer,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, bigint,
  uuid, bytea, bytea, timestamptz
) to programmable_reconciler;
grant execute on function programmable_private.append_market_candle_details_v1(
  uuid, uuid, bytea, timestamptz
) to programmable_reconciler;

grant select on
  programmable_private.launch_by_token_v2,
  programmable_private.launches_by_creator_v2,
  programmable_private.global_eth_usd_snapshots_v1,
  programmable_private.market_snapshots_v2,
  programmable_private.market_block_closes_v1,
  programmable_private.market_candles_v2,
  programmable_private.claim_history_v1
to programmable_api_reader;
grant execute on function programmable_private.get_claim_history_v1(
  numeric, bytea, integer, numeric, numeric
) to programmable_api_reader;

revoke all on all functions in schema programmable_private from public;

reset role;
