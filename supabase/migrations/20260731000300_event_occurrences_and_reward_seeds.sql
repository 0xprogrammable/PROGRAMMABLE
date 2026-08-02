-- Fork-aware logical events, immutable occurrences and reward-allocation seeds.

set role programmable_migrator;

create table programmable_private.envio_candidates (
  candidate_id programmable_private.envio_candidate_identifier primary key,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  transaction_hash programmable_private.bytes32_value not null,
  transaction_index programmable_private.transaction_index_value not null,
  block_global_log_index programmable_private.block_log_index_value not null,
  source_address programmable_private.eth_address not null,
  event_signature programmable_private.bytes32_value not null,
  event_type programmable_private.source_identifier not null,
  ordered_topics bytea[] not null,
  raw_data bytea not null,
  decoded_payload jsonb not null,
  payload_hash programmable_private.bytes32_value not null,
  provider_cursor programmable_private.envio_candidate_identifier not null,
  provider_deployment_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  first_seen_run_id uuid not null,
  first_seen_at timestamptz not null,
  content_commitment programmable_private.bytes32_value not null,
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    )
    on delete restrict,
  foreign key (first_seen_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    )
    on delete restrict,
  check (programmable_private.valid_topics(ordered_topics)),
  check (pg_catalog.octet_length(decoded_payload::text) <= 65536),
  check (
    candidate_id = programmable_private.derive_envio_candidate_id(
      chain_id, block_hash, transaction_hash, block_global_log_index
    )
  ),
  check (provider_cursor = candidate_id),
  unique (chain_id, block_hash, transaction_hash, block_global_log_index)
);

create table programmable_private.chain_event_identities (
  logical_event_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  transaction_hash programmable_private.bytes32_value not null,
  receipt_log_ordinal programmable_private.receipt_log_ordinal_value not null,
  first_verification_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  created_at timestamptz not null,
  unique (chain_id, transaction_hash, receipt_log_ordinal),
  unique (logical_event_id, chain_id)
);

create table programmable_private.chain_event_occurrences (
  occurrence_id uuid primary key,
  logical_event_id uuid not null,
  chain_id programmable_private.chain_id_value not null,
  transaction_hash programmable_private.bytes32_value not null,
  receipt_log_ordinal programmable_private.receipt_log_ordinal_value not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  block_timestamp timestamptz not null,
  transaction_index programmable_private.transaction_index_value not null,
  source_address programmable_private.eth_address not null,
  block_global_log_index programmable_private.block_log_index_value not null,
  event_signature programmable_private.bytes32_value not null,
  event_type programmable_private.source_identifier not null,
  ordered_topics bytea[] not null,
  raw_data bytea not null,
  decoded_payload jsonb not null,
  payload_hash programmable_private.bytes32_value not null,
  decoder_version programmable_private.projector_identifier not null,
  abi_event_set_commitment programmable_private.bytes32_value not null,
  release_binding_id uuid not null
    references programmable_private.release_source_bindings(binding_id)
    on delete restrict,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  first_seen_envio_candidate_id
    programmable_private.envio_candidate_identifier not null
    references programmable_private.envio_candidates(candidate_id)
    on delete restrict,
  first_seen_provider_cursor
    programmable_private.envio_candidate_identifier not null,
  verification_run_id uuid not null,
  block_evidence_id uuid not null,
  encoding_version smallint not null check (encoding_version > 0),
  canonical_preimage bytea not null,
  content_fingerprint programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    logical_event_id, chain_id
  ) references programmable_private.chain_event_identities(
    logical_event_id, chain_id
  ) on delete restrict,
  foreign key (
    block_evidence_id, block_hash
  ) references programmable_private.dual_rpc_block_evidence(
    block_evidence_id, agreed_block_hash
  ) on delete restrict,
  foreign key (verification_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    )
    on delete restrict,
  check (programmable_private.valid_topics(ordered_topics)),
  check (pg_catalog.octet_length(decoded_payload::text) <= 65536),
  check (
    pg_catalog.octet_length(canonical_preimage) >= 24
    and pg_catalog.substring(canonical_preimage, 1, 24)
      = pg_catalog.decode(
        '70726f6772616d6d61626c653a6f6363757272656e63653a',
        'hex'
      )
  ),
  unique (chain_id, transaction_hash, receipt_log_ordinal, block_hash),
  unique (occurrence_id, logical_event_id, block_hash),
  unique (occurrence_id, epoch_id, pointer_generation),
  unique (epoch_id, content_fingerprint)
);

create index chain_event_occurrences_order_idx
  on programmable_private.chain_event_occurrences (
    chain_id, release_id, model_id, block_number,
    transaction_index, receipt_log_ordinal
  );
create index chain_event_occurrences_source_idx
  on programmable_private.chain_event_occurrences (
    epoch_id, source_address, event_signature, block_number
  );

-- Chain placement and logical identity are global. Decoding, release binding,
-- ABI selection and verification evidence are exact release-epoch
-- materializations. This ledger is the authorization boundary for every
-- scoped projection writer; the release columns retained on the occurrence
-- row are only the immutable first-materialization snapshot.
create table programmable_private.chain_event_occurrence_materializations (
  materialization_id uuid primary key,
  occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  release_binding_id uuid
    references programmable_private.release_source_bindings(binding_id)
    on delete restrict,
  dynamic_source_attestation_id uuid,
  first_seen_envio_candidate_id programmable_private.envio_candidate_identifier,
  first_seen_neutral_candidate_id
    programmable_private.envio_candidate_identifier,
  candidate_resolution_id uuid,
  decoder_version programmable_private.projector_identifier not null,
  event_type programmable_private.source_identifier not null,
  abi_event_set_commitment programmable_private.bytes32_value not null,
  decoded_payload jsonb not null,
  payload_hash programmable_private.bytes32_value not null,
  first_seen_provider_cursor
    programmable_private.envio_candidate_identifier not null,
  verification_run_id uuid not null,
  block_evidence_id uuid not null,
  encoding_version smallint not null check (encoding_version > 0),
  canonical_preimage bytea not null,
  content_fingerprint programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    ) on delete restrict,
  foreign key (verification_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  foreign key (
    block_evidence_id, epoch_id, chain_id, pointer_generation
  )
    references programmable_private.dual_rpc_block_evidence(
      block_evidence_id, epoch_id, chain_id, pointer_generation
    ) on delete restrict,
  check (pg_catalog.octet_length(decoded_payload::text) <= 65536),
  check (
    (release_binding_id is null) <> (dynamic_source_attestation_id is null)
  ),
  check (
    (
      first_seen_envio_candidate_id is not null
      and first_seen_neutral_candidate_id is null
      and candidate_resolution_id is null
      and dynamic_source_attestation_id is null
    )
    or (
      first_seen_envio_candidate_id is null
      and first_seen_neutral_candidate_id is not null
      and candidate_resolution_id is not null
    )
  ),
  unique (occurrence_id, epoch_id, pointer_generation),
  unique (materialization_id, occurrence_id, epoch_id, pointer_generation),
  unique (candidate_resolution_id),
  unique (epoch_id, content_fingerprint)
);

create index chain_event_materializations_scope_idx
  on programmable_private.chain_event_occurrence_materializations (
    epoch_id, pointer_generation, occurrence_id
  );

create table programmable_private.chain_event_occurrence_status_history (
  status_history_id uuid primary key,
  occurrence_id uuid not null,
  logical_event_id uuid not null,
  block_hash programmable_private.bytes32_value not null,
  status programmable_private.occurrence_status not null,
  safe_head_observation_id uuid not null
    references programmable_private.safe_head_observations(observation_id)
    on delete restrict,
  block_evidence_id uuid not null
    references programmable_private.dual_rpc_block_evidence(block_evidence_id)
    on delete restrict,
  decision_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  decision_commitment programmable_private.bytes32_value not null,
  decided_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (occurrence_id, logical_event_id, block_hash)
    references programmable_private.chain_event_occurrences(
      occurrence_id, logical_event_id, block_hash
    )
    on delete restrict,
  unique (occurrence_id, status, decision_commitment)
);

create table programmable_private.chain_event_current_canonical (
  logical_event_id uuid primary key
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  occurrence_id uuid not null unique,
  block_hash programmable_private.bytes32_value not null,
  status_history_id uuid not null unique
    references programmable_private.chain_event_occurrence_status_history(status_history_id)
    on delete restrict,
  selected_by_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  selected_at timestamptz not null,
  foreign key (occurrence_id, logical_event_id, block_hash)
    references programmable_private.chain_event_occurrences(
      occurrence_id, logical_event_id, block_hash
    )
    on delete restrict
);

create table programmable_private.reward_allocation_facts (
  allocation_fact_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  vault programmable_private.eth_address not null,
  factory_occurrence_id uuid not null,
  factory_release_binding_id uuid not null
    references programmable_private.release_source_bindings(binding_id)
    on delete restrict,
  factory_release_binding_commitment programmable_private.bytes32_value not null,
  factory_logical_event_id uuid not null,
  factory_occurrence_block_hash programmable_private.bytes32_value not null,
  creation_block_number programmable_private.block_number_value not null,
  creation_transaction_index programmable_private.transaction_index_value not null,
  ordered_beneficiaries bytea[] not null,
  ordered_shares_bps integer[] not null,
  allocation_hash programmable_private.bytes32_value not null,
  configuration_hash programmable_private.bytes32_value not null,
  active_configuration_hash programmable_private.bytes32_value,
  manifest_artifact_creation_code_commitment programmable_private.bytes32_value not null,
  encoding_version smallint not null check (encoding_version > 0),
  canonical_preimage bytea not null,
  content_fingerprint programmable_private.bytes32_value not null,
  verification_run_id uuid not null,
  created_at timestamptz not null,
  foreign key (
    factory_occurrence_id, factory_logical_event_id, factory_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  foreign key (verification_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    )
    on delete restrict,
  check (
    programmable_private.valid_beneficiary_set(
      ordered_beneficiaries,
      ordered_shares_bps,
      case when model_id like 'classic%' then 5 else 8 end
    )
  ),
  check (
    (model_id like 'classic%' and active_configuration_hash is not null)
    or (model_id not like 'classic%' and active_configuration_hash is null)
  ),
  check (
    pg_catalog.octet_length(canonical_preimage) >= 24
    and pg_catalog.substring(canonical_preimage, 1, 24)
      = pg_catalog.decode(
        '70726f6772616d6d61626c653a616c6c6f636174696f6e3a',
        'hex'
      )
  ),
  unique (
    chain_id, release_id, vault, factory_occurrence_id,
    allocation_hash, configuration_hash
  ),
  unique (epoch_id, content_fingerprint),
  unique (allocation_fact_id, factory_occurrence_id, vault)
);

create table programmable_private.reward_allocation_required_occurrences (
  allocation_fact_id uuid not null
    references programmable_private.reward_allocation_facts(allocation_fact_id)
    on delete restrict,
  occurrence_ordinal integer not null check (occurrence_ordinal >= 0),
  occurrence_role programmable_private.source_identifier not null,
  occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  release_binding_id uuid not null
    references programmable_private.release_source_bindings(binding_id)
    on delete restrict,
  release_binding_commitment programmable_private.bytes32_value not null,
  primary key (allocation_fact_id, occurrence_ordinal),
  unique (allocation_fact_id, occurrence_id)
);

create table programmable_private.reward_allocation_evidence (
  allocation_evidence_id uuid primary key,
  allocation_fact_id uuid not null,
  factory_occurrence_id uuid not null,
  vault programmable_private.eth_address not null,
  recovery_method programmable_private.recovery_method not null,
  evidence_version programmable_private.projector_identifier not null,
  recovery_release_binding_id uuid not null
    references programmable_private.release_source_bindings(binding_id)
    on delete restrict,
  recovery_release_binding_commitment programmable_private.bytes32_value not null,
  top_level_destination programmable_private.eth_address,
  method_selector programmable_private.hex_selector,
  transaction_input_hash programmable_private.bytes32_value,
  recomputed_allocation_hash programmable_private.bytes32_value not null,
  recomputed_configuration_hash programmable_private.bytes32_value not null,
  recomputed_active_configuration_hash programmable_private.bytes32_value,
  is_recomputation_attested boolean not null,
  constructor_arguments_commitment programmable_private.bytes32_value not null,
  local_init_code_hash programmable_private.bytes32_value not null,
  create2_salt programmable_private.bytes32_value not null,
  local_create2_address programmable_private.eth_address not null,
  historical_enrichment_status programmable_private.historical_enrichment_status not null,
  getter_block_hash programmable_private.bytes32_value,
  getter_result_hash_a programmable_private.bytes32_value,
  getter_result_hash_b programmable_private.bytes32_value,
  predict_result_hash_a programmable_private.bytes32_value,
  predict_result_hash_b programmable_private.bytes32_value,
  predicted_vault_a programmable_private.eth_address,
  predicted_vault_b programmable_private.eth_address,
  selected_rpc_result_hash_a programmable_private.bytes32_value not null,
  selected_rpc_result_hash_b programmable_private.bytes32_value not null,
  selected_rpc_transaction_receipt_hash_a programmable_private.bytes32_value,
  selected_rpc_transaction_receipt_hash_b programmable_private.bytes32_value,
  encoding_version smallint not null check (encoding_version > 0),
  canonical_preimage bytea not null,
  content_fingerprint programmable_private.bytes32_value not null,
  verification_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  verified_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (allocation_fact_id, factory_occurrence_id, vault)
    references programmable_private.reward_allocation_facts(
      allocation_fact_id, factory_occurrence_id, vault
    )
    on delete restrict,
  check (local_create2_address = vault),
  check (selected_rpc_result_hash_a = selected_rpc_result_hash_b),
  check (
    (
      recovery_method = 'historical_getters'
      and top_level_destination is null
      and method_selector is null
      and transaction_input_hash is null
      and historical_enrichment_status = 'matched'
      and getter_block_hash is not null
      and getter_result_hash_a is not null
      and getter_result_hash_a = getter_result_hash_b
      and predict_result_hash_a is not null
      and predict_result_hash_a = predict_result_hash_b
      and predicted_vault_a is not null
      and predicted_vault_b is not null
      and predicted_vault_a = vault
      and predicted_vault_b = vault
      and selected_rpc_transaction_receipt_hash_a is null
      and selected_rpc_transaction_receipt_hash_b is null
    )
    or (
      recovery_method <> 'historical_getters'
      and top_level_destination is not null
      and method_selector is not null
      and transaction_input_hash is not null
      and selected_rpc_transaction_receipt_hash_a is not null
      and selected_rpc_transaction_receipt_hash_a
        = selected_rpc_transaction_receipt_hash_b
      and (
        (
          historical_enrichment_status = 'matched'
          and getter_block_hash is not null
          and getter_result_hash_a is not null
          and getter_result_hash_a = getter_result_hash_b
          and predict_result_hash_a is not null
          and predict_result_hash_a = predict_result_hash_b
          and predicted_vault_a is not null
          and predicted_vault_b is not null
          and predicted_vault_a = vault
          and predicted_vault_b = vault
        )
        or (
          historical_enrichment_status = 'unavailable'
          and getter_block_hash is null
          and getter_result_hash_a is null
          and getter_result_hash_b is null
          and predict_result_hash_a is null
          and predict_result_hash_b is null
          and predicted_vault_a is null
          and predicted_vault_b is null
        )
      )
    )
  ),
  check (
    pg_catalog.octet_length(canonical_preimage) >= 22
    and pg_catalog.substring(canonical_preimage, 1, 22)
      = pg_catalog.decode(
        '70726f6772616d6d61626c653a65766964656e63653a',
        'hex'
      )
  ),
  unique (allocation_fact_id, recovery_method, evidence_version, content_fingerprint),
  unique (allocation_evidence_id, allocation_fact_id)
);

create table programmable_private.reward_allocation_status_history (
  seed_status_history_id uuid primary key,
  allocation_fact_id uuid not null
    references programmable_private.reward_allocation_facts(allocation_fact_id)
    on delete restrict,
  allocation_evidence_id uuid,
  status programmable_private.reward_seed_status not null,
  reason_commitment programmable_private.bytes32_value not null,
  decision_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  decided_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (allocation_evidence_id, allocation_fact_id)
    references programmable_private.reward_allocation_evidence(
      allocation_evidence_id, allocation_fact_id
    )
    on delete restrict,
  unique (allocation_evidence_id, status, reason_commitment)
);

create table programmable_private.reward_allocation_mismatch_evidence (
  mismatch_evidence_id uuid primary key,
  allocation_fact_id uuid not null
    references programmable_private.reward_allocation_facts(allocation_fact_id)
    on delete restrict,
  recovery_method text not null,
  observed_destination bytea,
  observed_selector bytea,
  observed_transaction_input_hash bytea,
  observed_constructor_arguments_commitment bytea,
  observed_local_init_code_hash bytea,
  observed_create2_salt bytea,
  observed_local_create2_address bytea,
  observed_allocation_hash bytea,
  observed_configuration_hash bytea,
  observed_active_configuration_hash bytea,
  mismatch_commitment programmable_private.bytes32_value not null,
  verification_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  recorded_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (allocation_fact_id, mismatch_commitment)
);

create table programmable_private.reward_allocation_current_verified (
  factory_occurrence_id uuid not null,
  vault programmable_private.eth_address not null,
  allocation_fact_id uuid not null,
  allocation_evidence_id uuid not null,
  seed_status_history_id uuid not null unique
    references programmable_private.reward_allocation_status_history(seed_status_history_id)
    on delete restrict,
  selected_by_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  selected_at timestamptz not null,
  primary key (factory_occurrence_id, vault),
  unique (allocation_fact_id),
  foreign key (allocation_fact_id, factory_occurrence_id, vault)
    references programmable_private.reward_allocation_facts(
      allocation_fact_id, factory_occurrence_id, vault
    )
    on delete restrict,
  foreign key (allocation_evidence_id, allocation_fact_id)
    references programmable_private.reward_allocation_evidence(
      allocation_evidence_id, allocation_fact_id
    )
    on delete restrict
);

create index reward_allocation_facts_vault_idx
  on programmable_private.reward_allocation_facts (
    chain_id, release_id, vault, creation_block_number
  );

create function programmable_private.append_envio_candidate(
  p_candidate_id text,
  p_run_id uuid,
  p_block_number numeric,
  p_block_hash bytea,
  p_transaction_hash bytea,
  p_transaction_index numeric,
  p_block_global_log_index numeric,
  p_source_address bytea,
  p_event_signature bytea,
  p_event_type text,
  p_ordered_topics bytea[],
  p_raw_data bytea,
  p_decoded_payload jsonb,
  p_payload_hash bytea,
  p_provider_cursor text,
  p_provider_deployment_id uuid,
  p_content_commitment bytea,
  p_first_seen_at timestamptz default pg_catalog.clock_timestamp()
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  existing programmable_private.envio_candidates%rowtype;
  normalized_block bigint;
  normalized_tx_index bigint;
  normalized_log_index bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'ingestion'
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'invalid ingestion run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if exists (
    select 1 from programmable_private.run_lifecycle_outcomes where run_id = p_run_id
  ) then
    raise exception using errcode = '55000', message = 'run is terminal';
  end if;
  if p_block_number <> pg_catalog.trunc(p_block_number)
     or p_transaction_index <> pg_catalog.trunc(p_transaction_index)
     or p_block_global_log_index <> pg_catalog.trunc(p_block_global_log_index)
     or p_block_number < 0 or p_block_number > 9223372036854775807
     or p_transaction_index < 0 or p_transaction_index > 4294967295
     or p_block_global_log_index < 0 or p_block_global_log_index > 4294967295
     or pg_catalog.octet_length(p_block_hash) <> 32
     or pg_catalog.octet_length(p_transaction_hash) <> 32
     or pg_catalog.octet_length(p_source_address) <> 20
     or pg_catalog.octet_length(p_event_signature) <> 32
     or not programmable_private.valid_topics(p_ordered_topics)
     or p_raw_data is null
     or pg_catalog.octet_length(p_payload_hash) <> 32
     or pg_catalog.octet_length(p_content_commitment) <> 32
     or pg_catalog.octet_length(p_decoded_payload::text) > 65536
     or p_candidate_id is distinct from
       programmable_private.derive_envio_candidate_id(
         header.chain_id, p_block_hash, p_transaction_hash,
         p_block_global_log_index
       )::text
     or p_provider_cursor is distinct from p_candidate_id
  then
    raise exception using errcode = '22023', message = 'invalid Envio candidate';
  end if;
  normalized_block := p_block_number::bigint;
  normalized_tx_index := p_transaction_index::bigint;
  normalized_log_index := p_block_global_log_index::bigint;
  select * into existing
  from programmable_private.envio_candidates
  where candidate_id = p_candidate_id;
  if found then
    if existing.epoch_id <> header.epoch_id
       or existing.pointer_generation <> header.captured_pointer_generation
       or existing.block_number <> normalized_block
       or existing.block_hash <> p_block_hash
       or existing.transaction_hash <> p_transaction_hash
       or existing.transaction_index <> normalized_tx_index
       or existing.block_global_log_index <> normalized_log_index
       or existing.source_address <> p_source_address
       or existing.event_signature <> p_event_signature
       or existing.event_type <> p_event_type
       or existing.ordered_topics <> p_ordered_topics
       or existing.raw_data <> p_raw_data
       or existing.decoded_payload <> p_decoded_payload
       or existing.payload_hash <> p_payload_hash
       or existing.provider_cursor <> p_provider_cursor
       or existing.provider_deployment_id <> p_provider_deployment_id
       or existing.content_commitment <> p_content_commitment
    then
      raise exception using errcode = '23505', message = 'candidate replay changed immutable content';
    end if;
    return existing.candidate_id;
  end if;
  insert into programmable_private.envio_candidates (
    candidate_id, epoch_id, pointer_generation, chain_id, release_id, model_id,
    source_group, block_number, block_hash, transaction_hash,
    transaction_index, block_global_log_index, source_address,
    event_signature, event_type, ordered_topics, raw_data, decoded_payload,
    payload_hash, provider_cursor, provider_deployment_id, first_seen_run_id,
    first_seen_at, content_commitment
  )
  values (
    p_candidate_id::programmable_private.envio_candidate_identifier,
    header.epoch_id, header.captured_pointer_generation, header.chain_id,
    header.release_id, header.model_id, header.source_group,
    normalized_block::programmable_private.block_number_value,
    p_block_hash::programmable_private.bytes32_value,
    p_transaction_hash::programmable_private.bytes32_value,
    normalized_tx_index::programmable_private.transaction_index_value,
    normalized_log_index::programmable_private.block_log_index_value,
    p_source_address::programmable_private.eth_address,
    p_event_signature::programmable_private.bytes32_value,
    p_event_type::programmable_private.source_identifier,
    p_ordered_topics, p_raw_data, p_decoded_payload,
    p_payload_hash::programmable_private.bytes32_value,
    p_provider_cursor::programmable_private.envio_candidate_identifier,
    p_provider_deployment_id, p_run_id, p_first_seen_at,
    p_content_commitment::programmable_private.bytes32_value
  );
  perform programmable_private.append_mutation_audit(
    'candidate.append', p_content_commitment, p_run_id, p_first_seen_at
  );
  return p_candidate_id;
end
$function$;

create function programmable_private.append_chain_event_occurrence(
  p_logical_event_id uuid,
  p_occurrence_id uuid,
  p_run_id uuid,
  p_candidate_id text,
  p_receipt_log_ordinal numeric,
  p_block_timestamp timestamptz,
  p_decoder_version text,
  p_abi_event_set_commitment bytea,
  p_block_evidence_id uuid,
  p_encoding_version smallint,
  p_canonical_preimage bytea,
  p_content_fingerprint bytea,
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
  candidate programmable_private.envio_candidates%rowtype;
  evidence programmable_private.dual_rpc_block_evidence%rowtype;
  identity programmable_private.chain_event_identities%rowtype;
  existing programmable_private.chain_event_occurrences%rowtype;
  materialization programmable_private.chain_event_occurrence_materializations%rowtype;
  source_binding programmable_private.release_source_bindings%rowtype;
  ordinal bigint;
  audit_id uuid;
  status_id uuid;
  occurrence_inserted boolean := false;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_fingerprint_encoding(
    'occurrence', p_encoding_version, p_canonical_preimage,
    p_content_fingerprint
  );
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind in ('ingestion', 'projection')
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'invalid verification run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if exists (
    select 1 from programmable_private.run_lifecycle_outcomes where run_id = p_run_id
  ) then
    raise exception using errcode = '55000', message = 'run is terminal';
  end if;
  select * into candidate
  from programmable_private.envio_candidates
  where candidate_id = p_candidate_id;
  if not found
     or candidate.epoch_id <> header.epoch_id
     or candidate.pointer_generation <> header.captured_pointer_generation
  then
    raise exception using errcode = '23503', message = 'candidate scope mismatch';
  end if;
  select * into evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_block_evidence_id;
  if not found
     or evidence.epoch_id <> header.epoch_id
     or evidence.pointer_generation <> header.captured_pointer_generation
     or evidence.block_number <> candidate.block_number
     or evidence.agreed_block_hash <> candidate.block_hash
  then
    raise exception using errcode = '23503', message = 'candidate lacks matching dual-RPC block evidence';
  end if;
  select * into source_binding
    from programmable_private.release_source_bindings as binding
    join programmable_private.release_epochs as epoch
      on epoch.epoch_id = binding.epoch_id
    where binding.epoch_id = header.epoch_id
      and binding.source_type = 'ethereum_contract'
      and binding.source_address = candidate.source_address
      and binding.inclusive_start_block <= candidate.block_number
      and binding.abi_event_set_commitment = p_abi_event_set_commitment
      and binding.artifact_creation_code_commitment
        = epoch.artifact_creation_code_commitment;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'candidate is not covered by the active release source manifest';
  end if;
  if p_receipt_log_ordinal <> pg_catalog.trunc(p_receipt_log_ordinal)
     or p_receipt_log_ordinal < 0
     or p_receipt_log_ordinal > 4294967295
     or pg_catalog.octet_length(p_abi_event_set_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid occurrence encoding or ordinal';
  end if;
  ordinal := p_receipt_log_ordinal::bigint;
  select * into identity
  from programmable_private.chain_event_identities
  where chain_id = header.chain_id
    and transaction_hash = candidate.transaction_hash
    and receipt_log_ordinal = ordinal
  for share;
  if found and identity.logical_event_id <> p_logical_event_id then
    raise exception using errcode = '23505', message = 'logical identity UUID changed';
  elsif not found then
    insert into programmable_private.chain_event_identities (
      logical_event_id, chain_id, transaction_hash, receipt_log_ordinal,
      first_verification_run_id, created_at
    )
    values (
      p_logical_event_id, header.chain_id, candidate.transaction_hash,
      ordinal::programmable_private.receipt_log_ordinal_value,
      p_run_id, p_verified_at
    );
  end if;
  select * into existing
  from programmable_private.chain_event_occurrences
  where chain_id = header.chain_id
    and transaction_hash = candidate.transaction_hash
    and receipt_log_ordinal = ordinal
    and block_hash = candidate.block_hash;
  if found then
    if existing.occurrence_id <> p_occurrence_id
       or existing.logical_event_id <> p_logical_event_id
       or existing.block_number <> candidate.block_number
       or existing.block_timestamp <> p_block_timestamp
       or existing.transaction_index <> candidate.transaction_index
       or existing.source_address <> candidate.source_address
       or existing.block_global_log_index <> candidate.block_global_log_index
       or existing.event_signature <> candidate.event_signature
       or existing.ordered_topics <> candidate.ordered_topics
       or existing.raw_data <> candidate.raw_data
    then
      raise exception using errcode = '23505', message = 'raw occurrence replay changed immutable chain data';
    end if;
  else
    insert into programmable_private.chain_event_occurrences (
      occurrence_id, logical_event_id, chain_id, transaction_hash,
      receipt_log_ordinal, block_number, block_hash, block_timestamp,
      transaction_index, source_address, block_global_log_index,
      event_signature, event_type, ordered_topics, raw_data, decoded_payload,
      payload_hash, decoder_version, abi_event_set_commitment,
      release_binding_id, release_id,
      model_id, epoch_id, pointer_generation, first_seen_envio_candidate_id,
      first_seen_provider_cursor, verification_run_id, block_evidence_id,
      encoding_version, canonical_preimage, content_fingerprint, verified_at
    )
    values (
      p_occurrence_id, p_logical_event_id, header.chain_id,
      candidate.transaction_hash,
      ordinal::programmable_private.receipt_log_ordinal_value,
      candidate.block_number, candidate.block_hash, p_block_timestamp,
      candidate.transaction_index, candidate.source_address,
      candidate.block_global_log_index, candidate.event_signature,
      candidate.event_type, candidate.ordered_topics, candidate.raw_data,
      candidate.decoded_payload, candidate.payload_hash,
      p_decoder_version::programmable_private.projector_identifier,
      p_abi_event_set_commitment::programmable_private.bytes32_value,
      source_binding.binding_id,
      header.release_id, header.model_id, header.epoch_id,
      header.captured_pointer_generation, candidate.candidate_id,
      candidate.provider_cursor, p_run_id, p_block_evidence_id,
      p_encoding_version, p_canonical_preimage,
      p_content_fingerprint::programmable_private.bytes32_value, p_verified_at
    );
    occurrence_inserted := true;
  end if;

  select * into materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = p_occurrence_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  if found then
    if materialization.chain_id <> header.chain_id
       or materialization.release_id <> header.release_id
       or materialization.model_id <> header.model_id
       or materialization.source_group <> header.source_group
       or materialization.release_binding_id <> source_binding.binding_id
       or materialization.dynamic_source_attestation_id is not null
       or materialization.first_seen_envio_candidate_id <> p_candidate_id
       or materialization.first_seen_neutral_candidate_id is not null
       or materialization.candidate_resolution_id is not null
       or materialization.decoder_version <> p_decoder_version
       or materialization.event_type <> candidate.event_type
       or materialization.abi_event_set_commitment <> p_abi_event_set_commitment
       or materialization.decoded_payload <> candidate.decoded_payload
       or materialization.payload_hash <> candidate.payload_hash
       or materialization.first_seen_provider_cursor <> candidate.provider_cursor
       or materialization.verification_run_id <> p_run_id
       or materialization.block_evidence_id <> p_block_evidence_id
       or materialization.encoding_version <> p_encoding_version
       or materialization.canonical_preimage <> p_canonical_preimage
       or materialization.content_fingerprint <> p_content_fingerprint
    then
      raise exception using errcode = '23505', message = 'occurrence materialization replay changed exact scope';
    end if;
    return p_occurrence_id;
  end if;
  insert into programmable_private.chain_event_occurrence_materializations (
    materialization_id, occurrence_id, chain_id, release_id, model_id,
    source_group, epoch_id, pointer_generation, release_binding_id,
    dynamic_source_attestation_id, first_seen_envio_candidate_id,
    first_seen_neutral_candidate_id, candidate_resolution_id,
    decoder_version, event_type, abi_event_set_commitment,
    decoded_payload, payload_hash,
    first_seen_provider_cursor, verification_run_id, block_evidence_id,
    encoding_version, canonical_preimage, content_fingerprint, verified_at
  ) values (
    case when occurrence_inserted then p_occurrence_id
      else pg_catalog.gen_random_uuid() end,
    p_occurrence_id, header.chain_id, header.release_id, header.model_id,
    header.source_group, header.epoch_id, header.captured_pointer_generation,
    source_binding.binding_id, null, candidate.candidate_id, null, null,
    p_decoder_version::programmable_private.projector_identifier,
    candidate.event_type,
    p_abi_event_set_commitment::programmable_private.bytes32_value,
    candidate.decoded_payload, candidate.payload_hash, candidate.provider_cursor,
    p_run_id, p_block_evidence_id, p_encoding_version, p_canonical_preimage,
    p_content_fingerprint::programmable_private.bytes32_value, p_verified_at
  );
  audit_id := programmable_private.append_mutation_audit(
    case when occurrence_inserted then 'occurrence.append'
      else 'occurrence.materialize' end,
    p_content_fingerprint, p_run_id, p_verified_at
  );
  if not occurrence_inserted then
    return p_occurrence_id;
  end if;
  status_id := pg_catalog.gen_random_uuid();
  insert into programmable_private.chain_event_occurrence_status_history (
    status_history_id, occurrence_id, logical_event_id, block_hash, status,
    safe_head_observation_id, block_evidence_id, decision_run_id,
    decision_commitment, decided_at, audit_id
  )
  values (
    status_id, p_occurrence_id, p_logical_event_id, candidate.block_hash,
    'observed', evidence.observation_id, p_block_evidence_id, p_run_id,
    p_content_fingerprint::programmable_private.bytes32_value,
    p_verified_at, audit_id
  );
  return p_occurrence_id;
end
$function$;

create function programmable_private.append_reward_allocation_fact(
  p_allocation_fact_id uuid,
  p_run_id uuid,
  p_vault bytea,
  p_factory_occurrence_id uuid,
  p_ordered_beneficiaries bytea[],
  p_ordered_shares_bps numeric[],
  p_allocation_hash bytea,
  p_configuration_hash bytea,
  p_active_configuration_hash bytea,
  p_manifest_artifact_creation_code_commitment bytea,
  p_required_occurrence_ids uuid[],
  p_required_occurrence_roles text[],
  p_encoding_version smallint,
  p_canonical_preimage bytea,
  p_content_fingerprint bytea,
  p_created_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  factory_occurrence programmable_private.chain_event_occurrences%rowtype;
  factory_materialization programmable_private.chain_event_occurrence_materializations%rowtype;
  factory_binding programmable_private.release_source_bindings%rowtype;
  existing programmable_private.reward_allocation_facts%rowtype;
  shares integer[];
  required_id uuid;
  required_role text;
  ordinal integer := 0;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_fingerprint_encoding(
    'allocation', p_encoding_version, p_canonical_preimage,
    p_content_fingerprint
  );
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind in ('ingestion', 'projection')
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'invalid allocation run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if exists (
    select 1 from programmable_private.run_lifecycle_outcomes where run_id = p_run_id
  ) then
    raise exception using errcode = '55000', message = 'run is terminal';
  end if;
  select * into factory_occurrence
  from programmable_private.chain_event_occurrences
  where occurrence_id = p_factory_occurrence_id;
  select * into factory_materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = p_factory_occurrence_id
    and chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  if not found
     or factory_occurrence.occurrence_id is null
     or factory_occurrence.chain_id <> header.chain_id
     or not exists (
       select 1
       from programmable_private.chain_event_current_canonical as selected
       where selected.occurrence_id = p_factory_occurrence_id
     )
  then
    raise exception using errcode = '23503', message = 'factory occurrence is not current canonical';
  end if;
  select * into factory_binding
  from programmable_private.release_source_bindings
  where binding_id = factory_materialization.release_binding_id;
  if not found
     or factory_binding.epoch_id <> header.epoch_id
     or factory_binding.source_role <> 'vault_factory'
     or factory_binding.source_address <> factory_occurrence.source_address
     or factory_binding.abi_event_set_commitment
       <> factory_materialization.abi_event_set_commitment
     or factory_binding.inclusive_start_block > factory_occurrence.block_number
  then
    raise exception using
      errcode = '23514',
      message = 'vault factory occurrence lacks its exact release binding';
  end if;
  if coalesce(pg_catalog.array_length(p_ordered_shares_bps, 1), 0)
       <> coalesce(pg_catalog.array_length(p_ordered_beneficiaries, 1), 0)
     or exists (
       select 1 from pg_catalog.unnest(p_ordered_shares_bps) as share
       where share <> pg_catalog.trunc(share)
     )
     or coalesce(pg_catalog.array_length(p_required_occurrence_ids, 1), 0) = 0
     or pg_catalog.array_length(p_required_occurrence_ids, 1)
       <> pg_catalog.array_length(p_required_occurrence_roles, 1)
     or pg_catalog.octet_length(p_vault) <> 20
     or pg_catalog.octet_length(p_allocation_hash) <> 32
     or pg_catalog.octet_length(p_configuration_hash) <> 32
     or pg_catalog.octet_length(p_manifest_artifact_creation_code_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid allocation fact';
  end if;
  select pg_catalog.array_agg(share::integer order by ord)
    into shares
  from pg_catalog.unnest(p_ordered_shares_bps) with ordinality as item(share, ord);
  if not programmable_private.valid_beneficiary_set(
    p_ordered_beneficiaries, shares,
    case when header.model_id like 'classic%' then 5 else 8 end
  ) then
    raise exception using errcode = '22023', message = 'invalid beneficiary allocation';
  end if;
  if (
       header.model_id like 'classic%'
       and (
         p_active_configuration_hash is null
         or pg_catalog.octet_length(p_active_configuration_hash) <> 32
       )
     )
     or (header.model_id not like 'classic%' and p_active_configuration_hash is not null)
  then
    raise exception using errcode = '22023', message = 'invalid active configuration commitment';
  end if;
  if not exists (
    select 1
    from programmable_private.release_epochs
    where epoch_id = header.epoch_id
      and artifact_creation_code_commitment = p_manifest_artifact_creation_code_commitment
  ) then
    raise exception using errcode = '23514', message = 'manifest artifact/init-code commitment mismatch';
  end if;
  if p_required_occurrence_roles
       is distinct from array['launcher', 'vault_factory', 'hook']::text[]
  then
    raise exception using
      errcode = '23514',
      message = 'complete ordered launcher/vault-factory/hook occurrences are required';
  end if;
  select * into existing
  from programmable_private.reward_allocation_facts
  where chain_id = header.chain_id
    and release_id = header.release_id
    and vault = p_vault
    and factory_occurrence_id = p_factory_occurrence_id
    and allocation_hash = p_allocation_hash
    and configuration_hash = p_configuration_hash;
  if found then
    if existing.allocation_fact_id <> p_allocation_fact_id
       or existing.ordered_beneficiaries <> p_ordered_beneficiaries
       or existing.ordered_shares_bps <> shares
       or existing.active_configuration_hash is distinct from p_active_configuration_hash
       or existing.manifest_artifact_creation_code_commitment
         <> p_manifest_artifact_creation_code_commitment
       or existing.factory_release_binding_id <> factory_binding.binding_id
       or existing.factory_release_binding_commitment
         <> factory_binding.binding_commitment
       or existing.encoding_version <> p_encoding_version
       or existing.canonical_preimage <> p_canonical_preimage
       or existing.content_fingerprint <> p_content_fingerprint
       or (
         select pg_catalog.array_agg(
           required.occurrence_id order by required.occurrence_ordinal
         )
         from programmable_private.reward_allocation_required_occurrences
           as required
         where required.allocation_fact_id = existing.allocation_fact_id
       ) is distinct from p_required_occurrence_ids
       or (
         select pg_catalog.array_agg(
           required.occurrence_role::text order by required.occurrence_ordinal
         )
         from programmable_private.reward_allocation_required_occurrences
           as required
         where required.allocation_fact_id = existing.allocation_fact_id
       ) is distinct from p_required_occurrence_roles
    then
      raise exception using errcode = '23505', message = 'allocation replay changed immutable content';
    end if;
    return existing.allocation_fact_id;
  end if;
  insert into programmable_private.reward_allocation_facts (
    allocation_fact_id, chain_id, release_id, model_id, epoch_id,
    pointer_generation, vault, factory_occurrence_id,
    factory_release_binding_id, factory_release_binding_commitment,
    factory_logical_event_id, factory_occurrence_block_hash,
    creation_block_number, creation_transaction_index, ordered_beneficiaries,
    ordered_shares_bps, allocation_hash, configuration_hash,
    active_configuration_hash, manifest_artifact_creation_code_commitment,
    encoding_version, canonical_preimage, content_fingerprint,
    verification_run_id, created_at
  )
  values (
    p_allocation_fact_id, header.chain_id, header.release_id, header.model_id,
    header.epoch_id, header.captured_pointer_generation,
    p_vault::programmable_private.eth_address, p_factory_occurrence_id,
    factory_binding.binding_id, factory_binding.binding_commitment,
    factory_occurrence.logical_event_id, factory_occurrence.block_hash,
    factory_occurrence.block_number, factory_occurrence.transaction_index,
    p_ordered_beneficiaries, shares,
    p_allocation_hash::programmable_private.bytes32_value,
    p_configuration_hash::programmable_private.bytes32_value,
    case when p_active_configuration_hash is null then null
      else p_active_configuration_hash::programmable_private.bytes32_value end,
    p_manifest_artifact_creation_code_commitment::programmable_private.bytes32_value,
    p_encoding_version, p_canonical_preimage,
    p_content_fingerprint::programmable_private.bytes32_value,
    p_run_id, p_created_at
  );
  for required_id, required_role in
    select ids.id, roles.role
    from pg_catalog.unnest(p_required_occurrence_ids) with ordinality as ids(id, ord)
    join pg_catalog.unnest(p_required_occurrence_roles) with ordinality as roles(role, ord)
      using (ord)
    order by ids.ord
  loop
    if not exists (
      select 1
      from programmable_private.chain_event_occurrences as required_occurrence
      join programmable_private.chain_event_occurrence_materializations
        as required_materialization
        on required_materialization.occurrence_id =
          required_occurrence.occurrence_id
      join programmable_private.chain_event_current_canonical as selected
        on selected.occurrence_id = required_occurrence.occurrence_id
      join programmable_private.release_source_bindings as required_binding
        on required_binding.binding_id =
          required_materialization.release_binding_id
      where required_occurrence.occurrence_id = required_id
        and required_occurrence.chain_id = header.chain_id
        and required_materialization.chain_id = header.chain_id
        and required_materialization.release_id = header.release_id
        and required_materialization.model_id = header.model_id
        and required_materialization.source_group = header.source_group
        and required_materialization.epoch_id = header.epoch_id
        and required_materialization.pointer_generation
          = header.captured_pointer_generation
        and required_binding.epoch_id = header.epoch_id
        and required_binding.source_role = required_role
        and required_binding.source_address = required_occurrence.source_address
        and required_binding.abi_event_set_commitment
          = required_materialization.abi_event_set_commitment
        and required_binding.inclusive_start_block
          <= required_occurrence.block_number
    ) then
      raise exception using
        errcode = '23514',
        message = 'required occurrence is not current canonical in the release epoch';
    end if;
    insert into programmable_private.reward_allocation_required_occurrences (
      allocation_fact_id, occurrence_ordinal, occurrence_role, occurrence_id,
      release_binding_id, release_binding_commitment
    )
    values (
      p_allocation_fact_id, ordinal,
      required_role::programmable_private.source_identifier, required_id,
      (select release_binding_id
       from programmable_private.chain_event_occurrence_materializations
       where occurrence_id = required_id
         and epoch_id = header.epoch_id
         and pointer_generation = header.captured_pointer_generation),
      (select binding.binding_commitment
       from programmable_private.chain_event_occurrence_materializations
         as materialization
       join programmable_private.release_source_bindings as binding
         on binding.binding_id = materialization.release_binding_id
       where materialization.occurrence_id = required_id
         and materialization.epoch_id = header.epoch_id
         and materialization.pointer_generation =
           header.captured_pointer_generation)
    );
    ordinal := ordinal + 1;
  end loop;
  perform programmable_private.append_mutation_audit(
    'reward_allocation_fact.append', p_content_fingerprint, p_run_id, p_created_at
  );
  return p_allocation_fact_id;
end
$function$;

create function programmable_private.append_reward_allocation_evidence(
  p_allocation_evidence_id uuid,
  p_allocation_fact_id uuid,
  p_run_id uuid,
  p_recovery_method text,
  p_evidence_version text,
  p_top_level_destination bytea,
  p_method_selector bytea,
  p_transaction_input_hash bytea,
  p_constructor_arguments_commitment bytea,
  p_local_init_code_hash bytea,
  p_create2_salt bytea,
  p_local_create2_address bytea,
  p_historical_enrichment_status text,
  p_getter_block_hash bytea,
  p_getter_result_hash_a bytea,
  p_getter_result_hash_b bytea,
  p_predict_result_hash_a bytea,
  p_predict_result_hash_b bytea,
  p_predicted_vault_a bytea,
  p_predicted_vault_b bytea,
  p_selected_rpc_result_hash_a bytea,
  p_selected_rpc_result_hash_b bytea,
  p_selected_rpc_transaction_receipt_hash_a bytea,
  p_selected_rpc_transaction_receipt_hash_b bytea,
  p_encoding_version smallint,
  p_canonical_preimage bytea,
  p_content_fingerprint bytea,
  p_verified_at timestamptz default pg_catalog.clock_timestamp(),
  p_recomputed_allocation_hash bytea default null,
  p_recomputed_configuration_hash bytea default null,
  p_recomputed_active_configuration_hash bytea default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  fact programmable_private.reward_allocation_facts%rowtype;
  existing programmable_private.reward_allocation_evidence%rowtype;
  header programmable_private.run_headers%rowtype;
  factory_occurrence programmable_private.chain_event_occurrences%rowtype;
  factory_materialization programmable_private.chain_event_occurrence_materializations%rowtype;
  recovery_binding programmable_private.release_source_bindings%rowtype;
  recovery_role text;
  mismatch boolean;
  recomputation_supplied boolean;
  recomputation_attested boolean;
  audit_id uuid;
  status_id uuid;
  route_status_id uuid;
  route_record record;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_fingerprint_encoding(
    'evidence', p_encoding_version, p_canonical_preimage,
    p_content_fingerprint
  );
  select * into fact
  from programmable_private.reward_allocation_facts
  where allocation_fact_id = p_allocation_fact_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown allocation fact';
  end if;
  recomputation_supplied := p_recomputed_allocation_hash is not null
    or p_recomputed_configuration_hash is not null
    or p_recomputed_active_configuration_hash is not null;
  recomputation_attested := p_recomputed_allocation_hash is not null
    and p_recomputed_configuration_hash is not null
    and p_recomputed_active_configuration_hash
      is not distinct from fact.active_configuration_hash;
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind in ('ingestion', 'projection')
    and chain_id = fact.chain_id
    and release_id = fact.release_id
    and model_id = fact.model_id
    and epoch_id = fact.epoch_id
    and captured_pointer_generation = fact.pointer_generation;
  if not found then
    raise exception using errcode = '23503', message = 'allocation evidence run scope mismatch';
  end if;
  if exists (
    select 1 from programmable_private.run_lifecycle_outcomes where run_id = p_run_id
  ) then
    raise exception using errcode = '55000', message = 'run is terminal';
  end if;
  select * into factory_occurrence
  from programmable_private.chain_event_occurrences
  where occurrence_id = fact.factory_occurrence_id;
  select * into factory_materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = fact.factory_occurrence_id
    and chain_id = fact.chain_id
    and release_id = fact.release_id
    and model_id = fact.model_id
    and source_group = header.source_group
    and epoch_id = fact.epoch_id
    and pointer_generation = fact.pointer_generation;
  perform programmable_private.assert_current_epoch(
    fact.chain_id, fact.release_id, fact.model_id,
    (select source_group from programmable_private.run_headers where run_id = p_run_id),
    fact.epoch_id, fact.pointer_generation
  );
  if pg_catalog.octet_length(p_constructor_arguments_commitment) <> 32
     or pg_catalog.octet_length(p_local_init_code_hash) <> 32
     or pg_catalog.octet_length(p_create2_salt) <> 32
     or pg_catalog.octet_length(p_local_create2_address) <> 20
     or pg_catalog.octet_length(p_selected_rpc_result_hash_a) <> 32
     or pg_catalog.octet_length(p_selected_rpc_result_hash_b) <> 32
  then
    raise exception using
      errcode = '22023',
      message = 'invalid per-instance CREATE2 or selected-RPC evidence shape';
  end if;
  if p_historical_enrichment_status not in ('matched', 'unavailable')
     or (
       p_recovery_method = 'historical_getters'
       and (
         p_top_level_destination is not null
         or p_method_selector is not null
         or p_transaction_input_hash is not null
         or p_historical_enrichment_status <> 'matched'
         or p_getter_block_hash is null
         or p_getter_result_hash_a is null
         or p_getter_result_hash_b is null
         or p_predict_result_hash_a is null
         or p_predict_result_hash_b is null
         or p_predicted_vault_a is null
         or p_predicted_vault_b is null
         or p_selected_rpc_transaction_receipt_hash_a is not null
         or p_selected_rpc_transaction_receipt_hash_b is not null
       )
     )
     or (
       p_recovery_method <> 'historical_getters'
       and (
         p_top_level_destination is null
         or p_method_selector is null
         or p_transaction_input_hash is null
         or p_selected_rpc_transaction_receipt_hash_a is null
         or p_selected_rpc_transaction_receipt_hash_b is null
         or (
           p_historical_enrichment_status = 'matched'
           and (
             p_getter_block_hash is null
             or p_getter_result_hash_a is null
             or p_getter_result_hash_b is null
             or p_predict_result_hash_a is null
             or p_predict_result_hash_b is null
             or p_predicted_vault_a is null
             or p_predicted_vault_b is null
           )
         )
         or (
           p_historical_enrichment_status = 'unavailable'
           and (
             p_getter_block_hash is not null
             or p_getter_result_hash_a is not null
             or p_getter_result_hash_b is not null
             or p_predict_result_hash_a is not null
             or p_predict_result_hash_b is not null
             or p_predicted_vault_a is not null
             or p_predicted_vault_b is not null
           )
         )
       )
     )
  then
    raise exception using
      errcode = '23514',
      message = 'historical enrichment evidence shape is incomplete';
  end if;
  select * into existing
  from programmable_private.reward_allocation_evidence
  where allocation_evidence_id = p_allocation_evidence_id;
  if found and (
    existing.allocation_fact_id <> p_allocation_fact_id
    or existing.canonical_preimage <> p_canonical_preimage
    or existing.content_fingerprint <> p_content_fingerprint
  ) then
    raise exception using
      errcode = '23505',
      message = 'allocation evidence replay changed immutable content';
  end if;
  recovery_role := case p_recovery_method
    when 'launcher_calldata' then 'launcher'
    when 'coordinator_calldata' then 'coordinator'
    when 'factory_calldata' then 'factory'
    else 'vault_factory'
  end;
  if recovery_role = 'vault_factory' then
    select * into recovery_binding
    from programmable_private.release_source_bindings
    where binding_id = fact.factory_release_binding_id;
  elsif recovery_role = 'coordinator' then
    select * into recovery_binding
    from programmable_private.release_source_bindings
    where epoch_id = fact.epoch_id
      and source_role = 'coordinator'
      and source_address = p_top_level_destination
      and recovery_selector = p_method_selector;
  else
    select binding.* into recovery_binding
    from programmable_private.reward_allocation_required_occurrences as required
    join programmable_private.release_source_bindings as binding
      on binding.binding_id = required.release_binding_id
    where required.allocation_fact_id = p_allocation_fact_id
      and required.occurrence_role = recovery_role;
  end if;
  mismatch := recovery_binding.binding_id is null
    or factory_occurrence.occurrence_id is null
    or factory_materialization.materialization_id is null
    or factory_materialization.release_binding_id
      is distinct from fact.factory_release_binding_id
    or recovery_binding.epoch_id <> fact.epoch_id
    or recovery_binding.source_role <> recovery_role
    or recovery_binding.binding_commitment is distinct from (
      case when recovery_role = 'vault_factory'
        then fact.factory_release_binding_commitment
        when recovery_role = 'coordinator'
          then recovery_binding.binding_commitment
        else (
          select required.release_binding_commitment
          from programmable_private.reward_allocation_required_occurrences as required
          where required.allocation_fact_id = p_allocation_fact_id
            and required.occurrence_role = recovery_role
        )
      end
    )
    or fact.manifest_artifact_creation_code_commitment
      is distinct from recovery_binding.artifact_creation_code_commitment
    or pg_catalog.octet_length(p_constructor_arguments_commitment) <> 32
    or pg_catalog.octet_length(p_local_init_code_hash) <> 32
    or p_local_init_code_hash
      = fact.manifest_artifact_creation_code_commitment
    or pg_catalog.octet_length(p_create2_salt) <> 32
    or p_local_create2_address is distinct from fact.vault
    or (
      recomputation_supplied
      and (
        not recomputation_attested
        or p_recomputed_allocation_hash is distinct from fact.allocation_hash
        or p_recomputed_configuration_hash
          is distinct from fact.configuration_hash
        or p_recomputed_active_configuration_hash
          is distinct from fact.active_configuration_hash
      )
    )
    or pg_catalog.octet_length(p_selected_rpc_result_hash_a) <> 32
    or p_selected_rpc_result_hash_a is distinct from p_selected_rpc_result_hash_b
    or p_selected_rpc_result_hash_a is distinct from fact.configuration_hash
    or exists (
      select 1
      from programmable_private.reward_allocation_required_occurrences as required
      join programmable_private.chain_event_occurrences as required_occurrence
        on required_occurrence.occurrence_id = required.occurrence_id
      left join programmable_private.chain_event_occurrence_materializations
        as required_materialization
        on required_materialization.occurrence_id = required.occurrence_id
       and required_materialization.epoch_id = fact.epoch_id
       and required_materialization.pointer_generation = fact.pointer_generation
      join programmable_private.release_source_bindings as required_binding
        on required_binding.binding_id = required.release_binding_id
      left join programmable_private.chain_event_current_canonical as canonical
        on canonical.occurrence_id = required.occurrence_id
       and canonical.logical_event_id = required_occurrence.logical_event_id
       and canonical.block_hash = required_occurrence.block_hash
      where required.allocation_fact_id = p_allocation_fact_id
        and (
          canonical.occurrence_id is null
          or required_materialization.materialization_id is null
          or required.release_binding_commitment <> required_binding.binding_commitment
          or required_binding.source_role <> required.occurrence_role
          or required_materialization.release_binding_id
            <> required.release_binding_id
        )
    )
    or (
      p_recovery_method = 'historical_getters'
      and (
        p_top_level_destination is not null
        or p_method_selector is not null
        or p_transaction_input_hash is not null
        or p_historical_enrichment_status <> 'matched'
      )
    )
    or (
      p_recovery_method <> 'historical_getters'
      and (
        p_top_level_destination is distinct from recovery_binding.source_address
        or p_method_selector is distinct from recovery_binding.recovery_selector
        or p_transaction_input_hash is null
        or p_selected_rpc_transaction_receipt_hash_a
          is distinct from factory_occurrence.transaction_hash
        or p_selected_rpc_transaction_receipt_hash_b
          is distinct from factory_occurrence.transaction_hash
      )
    )
    or (
      p_historical_enrichment_status = 'matched'
      and (
        p_getter_block_hash is distinct from fact.factory_occurrence_block_hash
        or p_getter_result_hash_a is distinct from p_getter_result_hash_b
        or (
          fact.active_configuration_hash is not null
          and p_getter_result_hash_a is distinct from fact.active_configuration_hash
        )
        or p_predict_result_hash_a is distinct from p_predict_result_hash_b
        or p_predicted_vault_a is distinct from fact.vault
        or p_predicted_vault_b is distinct from fact.vault
      )
    );
  if mismatch then
    audit_id := programmable_private.append_mutation_audit(
      'reward_allocation_evidence.quarantine',
      p_content_fingerprint, p_run_id, p_verified_at
    );
    insert into programmable_private.reward_allocation_mismatch_evidence (
      mismatch_evidence_id, allocation_fact_id, recovery_method,
      observed_destination, observed_selector,
      observed_transaction_input_hash,
      observed_constructor_arguments_commitment, observed_local_init_code_hash,
      observed_create2_salt, observed_local_create2_address,
      observed_allocation_hash,
      observed_configuration_hash, observed_active_configuration_hash,
      mismatch_commitment, verification_run_id, recorded_at, audit_id
    ) values (
      p_allocation_evidence_id, p_allocation_fact_id, p_recovery_method,
      p_top_level_destination, p_method_selector, p_transaction_input_hash,
      p_constructor_arguments_commitment, p_local_init_code_hash,
      p_create2_salt, p_local_create2_address,
      p_recomputed_allocation_hash, p_recomputed_configuration_hash,
      p_recomputed_active_configuration_hash,
      p_content_fingerprint::programmable_private.bytes32_value,
      p_run_id, p_verified_at, audit_id
    ) on conflict (mismatch_evidence_id) do nothing;
    status_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.reward_allocation_status_history (
      seed_status_history_id, allocation_fact_id, allocation_evidence_id,
      status, reason_commitment, decision_run_id, decided_at, audit_id
    ) values (
      status_id, p_allocation_fact_id, null, 'quarantined',
      p_content_fingerprint::programmable_private.bytes32_value,
      p_run_id, p_verified_at, audit_id
    );
    delete from programmable_private.reward_allocation_current_verified
    where allocation_fact_id = p_allocation_fact_id;
    for route_record in
      select * from programmable_private.route_eligibility_current
      where chain_id = fact.chain_id and release_id = fact.release_id
        and model_id = fact.model_id and source_group = header.source_group
        and epoch_id = fact.epoch_id
        and pointer_generation = fact.pointer_generation
      for update
    loop
      route_status_id := pg_catalog.gen_random_uuid();
      insert into programmable_private.route_eligibility_history (
        route_eligibility_history_id, route_key, chain_id, release_id,
        model_id, source_group, epoch_id, pointer_generation, status,
        route_mode, checkpoint_id, reason_commitment, changed_by_run_id,
        changed_at, audit_id
      ) values (
        route_status_id, route_record.route_key, fact.chain_id,
        fact.release_id, fact.model_id, header.source_group, fact.epoch_id,
        fact.pointer_generation, 'quarantined', 'rpc',
        route_record.checkpoint_id,
        p_content_fingerprint::programmable_private.bytes32_value,
        p_run_id, p_verified_at, audit_id
      );
      update programmable_private.route_eligibility_current
      set status = 'quarantined', route_mode = 'rpc',
          history_id = route_status_id, changed_at = p_verified_at
      where route_key = route_record.route_key
        and chain_id = fact.chain_id and release_id = fact.release_id
        and model_id = fact.model_id and source_group = header.source_group
        and epoch_id = fact.epoch_id
        and pointer_generation = fact.pointer_generation;
    end loop;
    return p_allocation_evidence_id;
  end if;
  select * into existing
  from programmable_private.reward_allocation_evidence
  where allocation_evidence_id = p_allocation_evidence_id;
  if found then
    if existing.allocation_fact_id <> p_allocation_fact_id
       or existing.recovery_method::text <> p_recovery_method
       or existing.evidence_version <> p_evidence_version
       or existing.top_level_destination is distinct from p_top_level_destination
       or existing.method_selector is distinct from p_method_selector
       or existing.transaction_input_hash is distinct from p_transaction_input_hash
       or existing.recomputed_allocation_hash
         <> coalesce(p_recomputed_allocation_hash, fact.allocation_hash)
       or existing.recomputed_configuration_hash
         <> coalesce(p_recomputed_configuration_hash, fact.configuration_hash)
       or existing.recomputed_active_configuration_hash
         is distinct from (case
           when p_recomputed_active_configuration_hash is not null
             then p_recomputed_active_configuration_hash
           else fact.active_configuration_hash
         end)
       or existing.is_recomputation_attested <> recomputation_attested
       or existing.recovery_release_binding_id <> recovery_binding.binding_id
       or existing.recovery_release_binding_commitment
         <> recovery_binding.binding_commitment
       or existing.constructor_arguments_commitment
         <> p_constructor_arguments_commitment
       or existing.local_init_code_hash <> p_local_init_code_hash
       or existing.create2_salt <> p_create2_salt
       or existing.local_create2_address <> p_local_create2_address
       or existing.historical_enrichment_status::text
         <> p_historical_enrichment_status
       or existing.getter_block_hash is distinct from p_getter_block_hash
       or existing.getter_result_hash_a is distinct from p_getter_result_hash_a
       or existing.getter_result_hash_b is distinct from p_getter_result_hash_b
       or existing.predict_result_hash_a is distinct from p_predict_result_hash_a
       or existing.predict_result_hash_b is distinct from p_predict_result_hash_b
       or existing.predicted_vault_a is distinct from p_predicted_vault_a
       or existing.predicted_vault_b is distinct from p_predicted_vault_b
       or existing.selected_rpc_result_hash_a <> p_selected_rpc_result_hash_a
       or existing.selected_rpc_result_hash_b <> p_selected_rpc_result_hash_b
       or existing.selected_rpc_transaction_receipt_hash_a
         is distinct from p_selected_rpc_transaction_receipt_hash_a
       or existing.selected_rpc_transaction_receipt_hash_b
         is distinct from p_selected_rpc_transaction_receipt_hash_b
       or existing.encoding_version <> p_encoding_version
       or existing.canonical_preimage <> p_canonical_preimage
       or existing.content_fingerprint <> p_content_fingerprint
       or existing.verification_run_id <> p_run_id
    then
      raise exception using
        errcode = '23505',
        message = 'allocation evidence replay changed immutable content';
    end if;
    return existing.allocation_evidence_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'reward_allocation_evidence.append',
    p_content_fingerprint, p_run_id, p_verified_at
  );
  insert into programmable_private.reward_allocation_evidence (
    allocation_evidence_id, allocation_fact_id, factory_occurrence_id,
    vault, recovery_method, evidence_version, recovery_release_binding_id,
    recovery_release_binding_commitment, top_level_destination,
    method_selector, transaction_input_hash, recomputed_allocation_hash,
    recomputed_configuration_hash, recomputed_active_configuration_hash,
    is_recomputation_attested,
    constructor_arguments_commitment, local_init_code_hash, create2_salt,
    local_create2_address, historical_enrichment_status, getter_block_hash,
    getter_result_hash_a, getter_result_hash_b, predict_result_hash_a,
    predict_result_hash_b, predicted_vault_a, predicted_vault_b,
    selected_rpc_result_hash_a,
    selected_rpc_result_hash_b, selected_rpc_transaction_receipt_hash_a,
    selected_rpc_transaction_receipt_hash_b, encoding_version,
    canonical_preimage, content_fingerprint, verification_run_id,
    verified_at, audit_id
  )
  values (
    p_allocation_evidence_id, p_allocation_fact_id,
    fact.factory_occurrence_id, fact.vault,
    p_recovery_method::programmable_private.recovery_method,
    p_evidence_version::programmable_private.projector_identifier,
    recovery_binding.binding_id, recovery_binding.binding_commitment,
    case when p_top_level_destination is null then null
      else p_top_level_destination::programmable_private.eth_address end,
    case when p_method_selector is null then null
      else p_method_selector::programmable_private.hex_selector end,
    case when p_transaction_input_hash is null then null
      else p_transaction_input_hash::programmable_private.bytes32_value end,
    coalesce(
      p_recomputed_allocation_hash,
      fact.allocation_hash
    )::programmable_private.bytes32_value,
    coalesce(
      p_recomputed_configuration_hash,
      fact.configuration_hash
    )::programmable_private.bytes32_value,
    case
      when p_recomputed_active_configuration_hash is not null
        then p_recomputed_active_configuration_hash::programmable_private.bytes32_value
      else fact.active_configuration_hash
    end,
    recomputation_attested,
    p_constructor_arguments_commitment::programmable_private.bytes32_value,
    p_local_init_code_hash::programmable_private.bytes32_value,
    p_create2_salt::programmable_private.bytes32_value,
    p_local_create2_address::programmable_private.eth_address,
    p_historical_enrichment_status::programmable_private.historical_enrichment_status,
    case when p_getter_block_hash is null then null
      else p_getter_block_hash::programmable_private.bytes32_value end,
    case when p_getter_result_hash_a is null then null
      else p_getter_result_hash_a::programmable_private.bytes32_value end,
    case when p_getter_result_hash_b is null then null
      else p_getter_result_hash_b::programmable_private.bytes32_value end,
    case when p_predict_result_hash_a is null then null
      else p_predict_result_hash_a::programmable_private.bytes32_value end,
    case when p_predict_result_hash_b is null then null
      else p_predict_result_hash_b::programmable_private.bytes32_value end,
    case when p_predicted_vault_a is null then null
      else p_predicted_vault_a::programmable_private.eth_address end,
    case when p_predicted_vault_b is null then null
      else p_predicted_vault_b::programmable_private.eth_address end,
    p_selected_rpc_result_hash_a::programmable_private.bytes32_value,
    p_selected_rpc_result_hash_b::programmable_private.bytes32_value,
    case when p_selected_rpc_transaction_receipt_hash_a is null then null
      else p_selected_rpc_transaction_receipt_hash_a::programmable_private.bytes32_value end,
    case when p_selected_rpc_transaction_receipt_hash_b is null then null
      else p_selected_rpc_transaction_receipt_hash_b::programmable_private.bytes32_value end,
    p_encoding_version, p_canonical_preimage,
    p_content_fingerprint::programmable_private.bytes32_value,
    p_run_id, p_verified_at, audit_id
  );
  return p_allocation_evidence_id;
end
$function$;

create function programmable_private.append_reward_seed_status(
  p_seed_status_history_id uuid,
  p_allocation_fact_id uuid,
  p_allocation_evidence_id uuid,
  p_status text,
  p_reason_commitment bytea,
  p_run_id uuid,
  p_decided_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  fact programmable_private.reward_allocation_facts%rowtype;
  header programmable_private.run_headers%rowtype;
  requested_status programmable_private.reward_seed_status;
  audit_id uuid;
  route_status_id uuid;
  route_record record;
begin
  perform programmable_private.assert_caller('programmable_projector');
  requested_status := p_status::programmable_private.reward_seed_status;
  if requested_status = 'verified' then
    raise exception using
      errcode = '42501',
      message = 'verified seed selection is promotion-only';
  end if;
  select * into fact
  from programmable_private.reward_allocation_facts
  where allocation_fact_id = p_allocation_fact_id
  for share;
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind in ('ingestion', 'projection')
  for share;
  if fact.allocation_fact_id is null
     or header.run_id is null
     or header.epoch_id <> fact.epoch_id
     or header.captured_pointer_generation <> fact.pointer_generation
     or header.chain_id <> fact.chain_id
     or header.release_id <> fact.release_id
     or header.model_id <> fact.model_id
     or exists (
       select 1
       from programmable_private.run_lifecycle_outcomes
       where run_id = p_run_id
     )
     or not exists (
       select 1
       from programmable_private.reward_allocation_evidence
       where allocation_evidence_id = p_allocation_evidence_id
         and allocation_fact_id = p_allocation_fact_id
     )
     or pg_catalog.octet_length(p_reason_commitment) <> 32
  then
    raise exception using errcode = '23503', message = 'invalid seed status evidence';
  end if;
  perform programmable_private.assert_current_epoch(
    fact.chain_id, fact.release_id, fact.model_id, header.source_group,
    fact.epoch_id, fact.pointer_generation
  );
  audit_id := programmable_private.append_mutation_audit(
    'reward_seed_status.append', p_reason_commitment, p_run_id, p_decided_at
  );
  insert into programmable_private.reward_allocation_status_history (
    seed_status_history_id, allocation_fact_id, allocation_evidence_id,
    status, reason_commitment, decision_run_id, decided_at, audit_id
  )
  values (
    p_seed_status_history_id, p_allocation_fact_id, p_allocation_evidence_id,
    requested_status,
    p_reason_commitment::programmable_private.bytes32_value,
    p_run_id, p_decided_at, audit_id
  );
  if requested_status in ('quarantined', 'orphaned', 'conflicted', 'revoked') then
    delete from programmable_private.reward_allocation_current_verified
    where allocation_fact_id = p_allocation_fact_id;
    for route_record in
      select *
      from programmable_private.route_eligibility_current
      where chain_id = fact.chain_id
        and release_id = fact.release_id
        and model_id = fact.model_id
        and source_group = header.source_group
        and epoch_id = fact.epoch_id
        and pointer_generation = fact.pointer_generation
      for update
    loop
      route_status_id := pg_catalog.gen_random_uuid();
      insert into programmable_private.route_eligibility_history (
        route_eligibility_history_id, route_key, chain_id, release_id,
        model_id, source_group, epoch_id, pointer_generation, status,
        route_mode, checkpoint_id, reason_commitment, changed_by_run_id,
        changed_at, audit_id
      )
      values (
        route_status_id, route_record.route_key, fact.chain_id,
        fact.release_id, fact.model_id, header.source_group,
        header.epoch_id, header.captured_pointer_generation,
        'quarantined', 'rpc', route_record.checkpoint_id,
        p_reason_commitment::programmable_private.bytes32_value,
        p_run_id, p_decided_at, audit_id
      );
      update programmable_private.route_eligibility_current
      set status = 'quarantined',
          route_mode = 'rpc',
          history_id = route_status_id,
          changed_at = p_decided_at
      where route_key = route_record.route_key
        and chain_id = fact.chain_id
        and release_id = fact.release_id
        and model_id = fact.model_id
        and source_group = header.source_group
        and epoch_id = fact.epoch_id
        and pointer_generation = fact.pointer_generation;
    end loop;
  end if;
  return p_seed_status_history_id;
end
$function$;

create function programmable_private.quarantine_conflicting_reward_allocations(
  p_seed_status_history_id_a uuid,
  p_seed_status_history_id_b uuid,
  p_allocation_fact_id_a uuid,
  p_allocation_evidence_id_a uuid,
  p_allocation_fact_id_b uuid,
  p_allocation_evidence_id_b uuid,
  p_run_id uuid,
  p_reason_commitment bytea,
  p_decided_at timestamptz default pg_catalog.clock_timestamp()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  fact_a programmable_private.reward_allocation_facts%rowtype;
  fact_b programmable_private.reward_allocation_facts%rowtype;
  header programmable_private.run_headers%rowtype;
  audit_id uuid;
  route_status_id uuid;
  route_record record;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into fact_a
  from programmable_private.reward_allocation_facts
  where allocation_fact_id = p_allocation_fact_id_a
  for share;
  select * into fact_b
  from programmable_private.reward_allocation_facts
  where allocation_fact_id = p_allocation_fact_id_b
  for share;
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind in ('ingestion', 'projection')
  for share;
  if p_seed_status_history_id_a is null
     or p_seed_status_history_id_b is null
     or p_seed_status_history_id_a = p_seed_status_history_id_b
     or p_allocation_fact_id_a = p_allocation_fact_id_b
     or p_allocation_evidence_id_a = p_allocation_evidence_id_b
     or fact_a.allocation_fact_id is null
     or fact_b.allocation_fact_id is null
     or header.run_id is null
     or pg_catalog.octet_length(p_reason_commitment) <> 32
     or exists (
       select 1
       from programmable_private.run_lifecycle_outcomes
       where run_id = p_run_id
     )
  then
    raise exception using
      errcode = '23503',
      message = 'invalid conflicting allocation decision';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if fact_a.chain_id <> header.chain_id
     or fact_a.release_id <> header.release_id
     or fact_a.model_id <> header.model_id
     or fact_a.epoch_id <> header.epoch_id
     or fact_a.pointer_generation <> header.captured_pointer_generation
     or fact_b.chain_id <> fact_a.chain_id
     or fact_b.release_id <> fact_a.release_id
     or fact_b.model_id <> fact_a.model_id
     or fact_b.epoch_id <> fact_a.epoch_id
     or fact_b.pointer_generation <> fact_a.pointer_generation
     or fact_b.factory_occurrence_id <> fact_a.factory_occurrence_id
     or fact_b.vault <> fact_a.vault
     or not (
       fact_b.ordered_beneficiaries is distinct from fact_a.ordered_beneficiaries
       or fact_b.ordered_shares_bps is distinct from fact_a.ordered_shares_bps
       or fact_b.allocation_hash <> fact_a.allocation_hash
       or fact_b.configuration_hash <> fact_a.configuration_hash
       or fact_b.active_configuration_hash
         is distinct from fact_a.active_configuration_hash
     )
     or not exists (
       select 1
       from programmable_private.chain_event_current_canonical
       where occurrence_id = fact_a.factory_occurrence_id
     )
     or exists (
       select 1
       from programmable_private.reward_allocation_required_occurrences
         as required
       where required.allocation_fact_id in (
         p_allocation_fact_id_a, p_allocation_fact_id_b
       )
         and not exists (
           select 1
           from programmable_private.chain_event_current_canonical as selected
           join programmable_private.reward_allocation_facts as scoped_fact
             on scoped_fact.allocation_fact_id = required.allocation_fact_id
           join programmable_private.chain_event_occurrence_materializations
             as materialization
             on materialization.occurrence_id = selected.occurrence_id
            and materialization.epoch_id = scoped_fact.epoch_id
            and materialization.pointer_generation =
              scoped_fact.pointer_generation
           where selected.occurrence_id = required.occurrence_id
         )
     )
     or not exists (
       select 1
       from programmable_private.reward_allocation_evidence
       where allocation_evidence_id = p_allocation_evidence_id_a
         and allocation_fact_id = p_allocation_fact_id_a
         and is_recomputation_attested
     )
     or not exists (
       select 1
       from programmable_private.reward_allocation_evidence
       where allocation_evidence_id = p_allocation_evidence_id_b
         and allocation_fact_id = p_allocation_fact_id_b
         and is_recomputation_attested
     )
  then
    raise exception using
      errcode = '23514',
      message = 'allocations are not independently valid conflicting evidence';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'reward_seed_conflict.quarantine',
    p_reason_commitment, p_run_id, p_decided_at
  );
  insert into programmable_private.reward_allocation_status_history (
    seed_status_history_id, allocation_fact_id, allocation_evidence_id,
    status, reason_commitment, decision_run_id, decided_at, audit_id
  )
  values
    (
      p_seed_status_history_id_a, p_allocation_fact_id_a,
      p_allocation_evidence_id_a, 'conflicted',
      p_reason_commitment::programmable_private.bytes32_value,
      p_run_id, p_decided_at, audit_id
    ),
    (
      p_seed_status_history_id_b, p_allocation_fact_id_b,
      p_allocation_evidence_id_b, 'conflicted',
      p_reason_commitment::programmable_private.bytes32_value,
      p_run_id, p_decided_at, audit_id
    );
  delete from programmable_private.reward_allocation_current_verified
  where factory_occurrence_id = fact_a.factory_occurrence_id
    and vault = fact_a.vault;
  for route_record in
    select *
    from programmable_private.route_eligibility_current
    where chain_id = fact_a.chain_id
      and release_id = fact_a.release_id
      and model_id = fact_a.model_id
      and source_group = header.source_group
      and epoch_id = fact_a.epoch_id
      and pointer_generation = fact_a.pointer_generation
    for update
  loop
    route_status_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.route_eligibility_history (
      route_eligibility_history_id, route_key, chain_id, release_id,
      model_id, source_group, epoch_id, pointer_generation, status,
      route_mode, checkpoint_id, reason_commitment, changed_by_run_id,
      changed_at, audit_id
    )
    values (
      route_status_id, route_record.route_key, fact_a.chain_id,
      fact_a.release_id, fact_a.model_id, header.source_group,
      header.epoch_id, header.captured_pointer_generation,
      'quarantined', 'rpc', route_record.checkpoint_id,
      p_reason_commitment::programmable_private.bytes32_value,
      p_run_id, p_decided_at, audit_id
    );
    update programmable_private.route_eligibility_current
    set status = 'quarantined',
        route_mode = 'rpc',
        history_id = route_status_id,
        changed_at = p_decided_at
    where route_key = route_record.route_key
      and chain_id = fact_a.chain_id
      and release_id = fact_a.release_id
      and model_id = fact_a.model_id
      and source_group = header.source_group
      and epoch_id = fact_a.epoch_id
      and pointer_generation = fact_a.pointer_generation;
  end loop;
  return true;
end
$function$;

do $lockdown$
declare
  table_record record;
begin
  for table_record in
    select c.relname
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'programmable_private'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  loop
    execute pg_catalog.format(
      'alter table programmable_private.%I enable row level security',
      table_record.relname
    );
    execute pg_catalog.format(
      'alter table programmable_private.%I force row level security',
      table_record.relname
    );
    execute pg_catalog.format(
      'create policy migrator_owner_all on programmable_private.%I ' ||
      'for all to programmable_migrator using (true) with check (true)',
      table_record.relname
    );
  end loop;
end
$lockdown$;

revoke all on all tables in schema programmable_private
  from public, anon, authenticated, service_role,
       programmable_projector, programmable_reconciler,
       programmable_api_reader, programmable_profile_binder,
       programmable_profile_recovery, programmable_profile_writer,
       programmable_maintenance;
revoke all on all sequences in schema programmable_private
  from public, anon, authenticated, service_role,
       programmable_projector, programmable_reconciler,
       programmable_api_reader, programmable_profile_binder,
       programmable_profile_recovery, programmable_profile_writer,
       programmable_maintenance;
revoke all on all functions in schema programmable_private
  from public, anon, authenticated, service_role,
       programmable_projector, programmable_reconciler,
       programmable_api_reader, programmable_profile_binder,
       programmable_profile_recovery, programmable_profile_writer,
       programmable_maintenance;

grant execute on function programmable_private.append_envio_candidate(
  text, uuid, numeric, bytea, bytea, numeric, numeric, bytea, bytea, text,
  bytea[], bytea, jsonb, bytea, text, uuid, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.append_chain_event_occurrence(
  uuid, uuid, uuid, text, numeric, timestamptz, text, bytea, uuid,
  smallint, bytea, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.append_reward_allocation_fact(
  uuid, uuid, bytea, uuid, bytea[], numeric[], bytea, bytea, bytea, bytea,
  uuid[], text[], smallint, bytea, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.append_reward_allocation_evidence(
  uuid, uuid, uuid, text, text,
  bytea, bytea, bytea, bytea, bytea, bytea, bytea, text,
  bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea,
  bytea,
  smallint, bytea, bytea, timestamptz, bytea, bytea, bytea
) to programmable_projector;
grant execute on function programmable_private.append_reward_seed_status(
  uuid, uuid, uuid, text, bytea, uuid, timestamptz
) to programmable_projector;
grant execute on function
  programmable_private.quarantine_conflicting_reward_allocations(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, bytea, timestamptz
  ) to programmable_projector;

reset role;
