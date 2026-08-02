-- P0 hardening for stateless projector resume, shared/dynamic source
-- provenance, delta-safe publications and release-specific event manifests.

set role programmable_migrator;

create table programmable_private.release_dynamic_source_templates (
  dynamic_source_template_id uuid primary key,
  epoch_id uuid not null
    references programmable_private.release_epochs(epoch_id)
    on delete restrict,
  parent_factory_release_binding_id uuid not null
    references programmable_private.release_source_bindings(binding_id)
    on delete restrict,
  parent_factory_binding_commitment programmable_private.bytes32_value not null,
  parent_source_role programmable_private.source_identifier not null,
  factory_event_type programmable_private.source_identifier not null,
  deployed_address_field programmable_private.source_identifier not null,
  deployed_source_role programmable_private.source_identifier not null,
  deployed_artifact_creation_code_commitment
    programmable_private.bytes32_value not null,
  normalized_runtime_code_hash programmable_private.bytes32_value not null,
  immutable_references_commitment programmable_private.bytes32_value not null,
  immutable_binding_spec jsonb not null,
  immutable_binding_commitment programmable_private.bytes32_value not null,
  runtime_code_length bigint not null
    check (runtime_code_length > 0 and runtime_code_length <= 16777216),
  abi_event_set_commitment programmable_private.bytes32_value not null,
  template_commitment programmable_private.bytes32_value not null,
  created_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (deployed_source_role in ('reward_vault', 'vesting_wallet')),
  check (
    programmable_private.valid_immutable_binding_spec(immutable_binding_spec)
  ),
  check (deployed_address_field in ('vault', 'wallet')),
  check (
    (deployed_source_role = 'reward_vault' and deployed_address_field = 'vault')
    or (
      deployed_source_role = 'vesting_wallet'
      and deployed_address_field = 'wallet'
    )
  ),
  unique (epoch_id, parent_source_role, factory_event_type, deployed_source_role),
  unique (epoch_id, template_commitment)
);

create table programmable_private.dual_rpc_runtime_code_evidence (
  runtime_code_evidence_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  source_address programmable_private.eth_address not null,
  deployment_block_evidence_id uuid not null
    references programmable_private.dual_rpc_block_evidence(block_evidence_id)
    on delete restrict,
  deployment_block_number programmable_private.block_number_value not null,
  deployment_block_hash programmable_private.bytes32_value not null,
  provider_a_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_b_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  runtime_code_hash_a programmable_private.bytes32_value not null,
  runtime_code_hash_b programmable_private.bytes32_value not null,
  agreed_runtime_code_hash programmable_private.bytes32_value not null,
  runtime_code_length_a bigint not null
    check (runtime_code_length_a > 0 and runtime_code_length_a <= 16777216),
  runtime_code_length_b bigint not null
    check (runtime_code_length_b > 0 and runtime_code_length_b <= 16777216),
  agreed_runtime_code_length bigint not null
    check (agreed_runtime_code_length > 0 and agreed_runtime_code_length <= 16777216),
  normalized_runtime_code_hash_a programmable_private.bytes32_value not null,
  normalized_runtime_code_hash_b programmable_private.bytes32_value not null,
  agreed_normalized_runtime_code_hash programmable_private.bytes32_value not null,
  immutable_references_commitment programmable_private.bytes32_value not null,
  immutable_values bytea[] not null check (cardinality(immutable_values) > 0),
  immutable_values_commitment programmable_private.bytes32_value not null,
  reconstructed_runtime_code_hash programmable_private.bytes32_value not null,
  encoding_version smallint not null check (encoding_version = 2),
  canonical_preimage bytea not null,
  content_fingerprint programmable_private.bytes32_value not null,
  evidence_commitment programmable_private.bytes32_value not null,
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
  foreign key (deployment_block_evidence_id, deployment_block_hash)
    references programmable_private.dual_rpc_block_evidence(
      block_evidence_id, agreed_block_hash
    ) on delete restrict,
  check (provider_a_id <> provider_b_id),
  check (
    runtime_code_hash_a = runtime_code_hash_b
    and runtime_code_hash_a = agreed_runtime_code_hash
  ),
  check (
    runtime_code_length_a = runtime_code_length_b
    and runtime_code_length_a = agreed_runtime_code_length
  ),
  check (
    normalized_runtime_code_hash_a = normalized_runtime_code_hash_b
    and normalized_runtime_code_hash_a = agreed_normalized_runtime_code_hash
  ),
  check (
    reconstructed_runtime_code_hash = agreed_runtime_code_hash
    and programmable_private.valid_immutable_values(immutable_values)
  ),
  unique (epoch_id, pointer_generation, source_address, deployment_block_number),
  unique (epoch_id, evidence_commitment)
);

create table programmable_private.dynamic_source_attestations (
  dynamic_source_attestation_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  runtime_code_evidence_id uuid not null
    references programmable_private.dual_rpc_runtime_code_evidence(
      runtime_code_evidence_id
    ) on delete restrict,
  dynamic_source_template_id uuid not null
    references programmable_private.release_dynamic_source_templates(
      dynamic_source_template_id
    ) on delete restrict,
  parent_factory_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  parent_factory_release_binding_id uuid not null
    references programmable_private.release_source_bindings(binding_id)
    on delete restrict,
  parent_factory_binding_commitment programmable_private.bytes32_value not null,
  deployed_source_address programmable_private.eth_address not null,
  deployed_source_role programmable_private.source_identifier not null,
  deployment_block_number programmable_private.block_number_value not null,
  deployed_artifact_creation_code_commitment
    programmable_private.bytes32_value not null,
  expected_immutable_values_commitment
    programmable_private.bytes32_value not null,
  factory_configuration_commitment
    programmable_private.bytes32_value not null,
  constructor_arguments_commitment programmable_private.bytes32_value not null,
  local_init_code_hash programmable_private.bytes32_value not null,
  runtime_code_hash programmable_private.bytes32_value not null,
  abi_event_set_commitment programmable_private.bytes32_value not null,
  encoding_version smallint not null check (encoding_version = 2),
  canonical_preimage bytea not null,
  content_fingerprint programmable_private.bytes32_value not null,
  attestation_commitment programmable_private.bytes32_value not null,
  verification_run_id uuid not null,
  created_at timestamptz not null,
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
  check (deployed_source_role in ('reward_vault', 'vesting_wallet')),
  unique (
    epoch_id, pointer_generation, deployed_source_address,
    deployed_source_role
  ),
  unique (epoch_id, attestation_commitment)
);

create table programmable_private.envio_candidate_inbox (
  candidate_id programmable_private.envio_candidate_identifier primary key,
  chain_id programmable_private.chain_id_value not null,
  stream_id programmable_private.source_identifier not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  transaction_hash programmable_private.bytes32_value not null,
  transaction_index programmable_private.transaction_index_value not null,
  block_global_log_index programmable_private.block_log_index_value not null,
  source_address programmable_private.eth_address not null,
  contract_name programmable_private.source_identifier not null,
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
  first_seen_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  first_seen_at timestamptz not null,
  content_commitment programmable_private.bytes32_value not null,
  check (programmable_private.valid_topics(ordered_topics)),
  check (pg_catalog.octet_length(decoded_payload::text) <= 65536),
  check (
    candidate_id = programmable_private.derive_envio_candidate_id(
      chain_id, block_hash, transaction_hash, block_global_log_index
    )
  ),
  check (provider_cursor = candidate_id),
  unique (
    candidate_id, chain_id, provider_deployment_id, stream_id, block_number,
    block_hash, block_global_log_index
  ),
  unique (chain_id, block_hash, transaction_hash, block_global_log_index)
);

create table programmable_private.envio_ingestion_cursor_history (
  cursor_history_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  provider_deployment_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  stream_id programmable_private.source_identifier not null,
  generation bigint not null check (generation > 0),
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  block_global_log_index
    programmable_private.block_log_index_value not null,
  candidate_id programmable_private.envio_candidate_identifier not null
    references programmable_private.envio_candidate_inbox(candidate_id)
    on delete restrict,
  content_commitment programmable_private.bytes32_value not null,
  changed_by_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  changed_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  is_rewind boolean not null,
  rewound_from_generation bigint,
  check (
    (not is_rewind and rewound_from_generation is null)
    or (is_rewind and rewound_from_generation is not null
      and rewound_from_generation = generation - 1)
  ),
  unique (chain_id, provider_deployment_id, stream_id, generation)
);

create table programmable_private.envio_ingestion_cursor_current (
  chain_id programmable_private.chain_id_value not null,
  provider_deployment_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  stream_id programmable_private.source_identifier not null,
  generation bigint not null check (generation > 0),
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  block_global_log_index
    programmable_private.block_log_index_value not null,
  candidate_id programmable_private.envio_candidate_identifier not null
    references programmable_private.envio_candidate_inbox(candidate_id)
    on delete restrict,
  content_commitment programmable_private.bytes32_value not null,
  changed_by_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  changed_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  cursor_history_id uuid not null unique
    references programmable_private.envio_ingestion_cursor_history(
      cursor_history_id
    ) on delete restrict,
  primary key (chain_id, provider_deployment_id, stream_id)
);

alter table programmable_private.projector_checkpoints
  add constraint projector_checkpoints_cursor_candidate_fkey
  foreign key (cursor_candidate_id)
  references programmable_private.envio_candidate_inbox(candidate_id)
  on delete restrict;

create table programmable_private.envio_candidate_resolutions (
  candidate_resolution_id uuid primary key,
  candidate_id programmable_private.envio_candidate_identifier not null
    references programmable_private.envio_candidate_inbox(candidate_id)
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
  dynamic_source_attestation_id uuid
    references programmable_private.dynamic_source_attestations(
      dynamic_source_attestation_id
    ) on delete restrict,
  abi_event_set_commitment programmable_private.bytes32_value not null,
  resolution_commitment programmable_private.bytes32_value not null,
  resolved_by_run_id uuid not null,
  resolved_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    ) on delete restrict,
  foreign key (resolved_by_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  check ((release_binding_id is null) <> (dynamic_source_attestation_id is null)),
  unique (candidate_id, epoch_id, pointer_generation),
  unique (epoch_id, resolution_commitment)
);

create table programmable_private.envio_candidate_status_history (
  decision_id uuid primary key,
  candidate_id programmable_private.envio_candidate_identifier not null
    references programmable_private.envio_candidate_inbox(candidate_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  status programmable_private.envio_candidate_status not null,
  attempt_count bigint not null check (attempt_count >= 0),
  next_attempt_at timestamptz,
  reason_code programmable_private.source_identifier,
  reason_commitment programmable_private.bytes32_value not null,
  changed_by_run_id uuid not null,
  changed_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    ) on delete restrict,
  foreign key (changed_by_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  check (
    (status = 'pending' and next_attempt_at is null and reason_code is null)
    or (status = 'deferred' and next_attempt_at is not null
      and reason_code is not null)
    or (status in ('resolved', 'ignored', 'quarantined')
      and next_attempt_at is null
      and reason_code is not null)
  ),
  unique (
    candidate_id, epoch_id, pointer_generation, status, attempt_count
  )
);

create table programmable_private.envio_candidate_status_current (
  candidate_id programmable_private.envio_candidate_identifier not null
    references programmable_private.envio_candidate_inbox(candidate_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  status programmable_private.envio_candidate_status not null,
  attempt_count bigint not null check (attempt_count >= 0),
  next_attempt_at timestamptz,
  reason_code programmable_private.source_identifier,
  reason_commitment programmable_private.bytes32_value not null,
  changed_by_run_id uuid not null,
  changed_at timestamptz not null,
  decision_id uuid not null unique
    references programmable_private.envio_candidate_status_history(decision_id)
    on delete restrict,
  primary key (candidate_id, epoch_id, pointer_generation),
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    ) on delete restrict,
  foreign key (changed_by_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  check (
    (status = 'pending' and next_attempt_at is null and reason_code is null)
    or (status = 'deferred' and next_attempt_at is not null
      and reason_code is not null)
    or (status in ('resolved', 'ignored', 'quarantined')
      and next_attempt_at is null
      and reason_code is not null)
  )
);

alter table programmable_private.chain_event_occurrence_materializations
  add constraint materialization_dynamic_source_attestation_fkey
    foreign key (dynamic_source_attestation_id)
    references programmable_private.dynamic_source_attestations(
      dynamic_source_attestation_id
    ) on delete restrict,
  add constraint materialization_legacy_candidate_fkey
    foreign key (first_seen_envio_candidate_id)
    references programmable_private.envio_candidates(candidate_id)
    on delete restrict,
  add constraint materialization_neutral_candidate_fkey
    foreign key (first_seen_neutral_candidate_id)
    references programmable_private.envio_candidate_inbox(candidate_id)
    on delete restrict,
  add constraint materialization_candidate_resolution_fkey
    foreign key (candidate_resolution_id)
    references programmable_private.envio_candidate_resolutions(
      candidate_resolution_id
    ) on delete restrict;

alter table programmable_private.chain_event_occurrences
  drop constraint chain_event_occurrences_first_seen_envio_candidate_id_fkey,
  alter column release_binding_id drop not null,
  alter column first_seen_envio_candidate_id drop not null,
  alter column first_seen_envio_candidate_id type
    programmable_private.envio_candidate_identifier
    using first_seen_envio_candidate_id::text,
  add column dynamic_source_attestation_id uuid
    references programmable_private.dynamic_source_attestations(
      dynamic_source_attestation_id
    ) on delete restrict,
  add column first_seen_neutral_candidate_id
    programmable_private.envio_candidate_identifier
    references programmable_private.envio_candidate_inbox(candidate_id)
    on delete restrict,
  add column candidate_resolution_id uuid
    references programmable_private.envio_candidate_resolutions(
      candidate_resolution_id
    ) on delete restrict,
  add constraint occurrence_exact_source_provenance check (
    (release_binding_id is null) <> (dynamic_source_attestation_id is null)
  ),
  add constraint occurrence_exact_candidate_provenance check (
    (
      first_seen_envio_candidate_id is not null
      and first_seen_neutral_candidate_id is null
      and candidate_resolution_id is null
    )
    or (
      first_seen_envio_candidate_id is null
      and first_seen_neutral_candidate_id is not null
      and candidate_resolution_id is not null
    )
  );

alter table programmable_private.chain_event_occurrences
  add constraint chain_event_occurrences_first_seen_envio_candidate_id_fkey
  foreign key (first_seen_envio_candidate_id)
  references programmable_private.envio_candidates(candidate_id)
  on delete restrict;

create table programmable_private.release_projection_event_rules (
  projection_event_rule_id uuid primary key,
  epoch_id uuid not null
    references programmable_private.release_epochs(epoch_id)
    on delete restrict,
  projection_kind programmable_private.source_identifier not null,
  source_role programmable_private.source_identifier not null,
  event_type programmable_private.source_identifier not null,
  rule_commitment programmable_private.bytes32_value not null,
  created_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (epoch_id, projection_kind, source_role, event_type),
  unique (epoch_id, rule_commitment)
);

create table programmable_private.release_launch_completeness_requirements (
  launch_requirement_id uuid primary key,
  epoch_id uuid not null
    references programmable_private.release_epochs(epoch_id)
    on delete restrict,
  requirement_ordinal integer not null check (requirement_ordinal >= 0),
  occurrence_role programmable_private.source_identifier not null,
  event_type programmable_private.source_identifier not null,
  required_when programmable_private.source_identifier not null
    check (required_when in ('always', 'reward_vault', 'locked_custody', 'eth_funded')),
  requirement_commitment programmable_private.bytes32_value not null,
  created_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (epoch_id, requirement_ordinal),
  unique (epoch_id, occurrence_role, event_type, required_when),
  unique (epoch_id, requirement_commitment)
);

create table programmable_private.launch_projection_occurrence_roles (
  launch_projection_id uuid not null
    references programmable_private.launch_projections(launch_projection_id)
    on delete restrict,
  occurrence_role programmable_private.source_identifier not null,
  occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  staged_at timestamptz not null,
  primary key (launch_projection_id, occurrence_role),
  unique (launch_projection_id, occurrence_id)
);

create table programmable_private.launch_projection_conditions (
  launch_projection_id uuid primary key
    references programmable_private.launch_projections(launch_projection_id)
    on delete restrict,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  eth_funded boolean not null,
  staged_at timestamptz not null
);

create table programmable_private.creator_hook_claim_facts (
  creator_hook_claim_fact_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  pool_id programmable_private.bytes32_value not null,
  reward_vault programmable_private.eth_address,
  creator programmable_private.eth_address,
  recipient programmable_private.eth_address,
  quote_asset programmable_private.eth_address,
  caller programmable_private.eth_address not null,
  amount programmable_private.uint256_value not null,
  source_occurrence_id uuid not null,
  source_logical_event_id uuid not null,
  source_occurrence_block_hash programmable_private.bytes32_value not null,
  verification_run_id uuid not null,
  verified_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (
    source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  foreign key (verification_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  check (
    (reward_vault is not null and creator is null and recipient is null)
    or (reward_vault is null and creator is not null and recipient is not null
      and quote_asset is null)
  ),
  unique (source_occurrence_id)
);

create table programmable_private.launcher_hook_claim_facts (
  launcher_hook_claim_fact_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  treasury programmable_private.eth_address not null,
  recipient programmable_private.eth_address not null,
  quote_asset programmable_private.eth_address,
  caller programmable_private.eth_address not null,
  amount programmable_private.uint256_value not null,
  source_occurrence_id uuid not null,
  source_logical_event_id uuid not null,
  source_occurrence_block_hash programmable_private.bytes32_value not null,
  verification_run_id uuid not null,
  verified_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (
    source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  foreign key (verification_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  unique (source_occurrence_id)
);

create table programmable_private.creator_fee_checkpoint_facts (
  creator_fee_checkpoint_fact_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  vault programmable_private.eth_address not null,
  pool_id programmable_private.bytes32_value not null,
  configuration_epoch bigint not null check (configuration_epoch >= 0),
  amount programmable_private.uint256_value not null,
  total_creator_fees_received programmable_private.uint256_value not null,
  source_occurrence_id uuid not null,
  source_logical_event_id uuid not null,
  source_occurrence_block_hash programmable_private.bytes32_value not null,
  verification_run_id uuid not null,
  verified_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (
    source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  foreign key (verification_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  check (amount <= total_creator_fees_received),
  unique (source_occurrence_id)
);

create table programmable_private.reward_configuration_activation_facts (
  reward_configuration_activation_fact_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  vault programmable_private.eth_address not null,
  pool_id programmable_private.bytes32_value not null,
  approval_reference programmable_private.bytes32_value not null,
  configuration_epoch bigint not null check (configuration_epoch >= 0),
  previous_configuration_hash programmable_private.bytes32_value not null,
  new_configuration_hash programmable_private.bytes32_value not null,
  ordered_beneficiaries bytea[] not null,
  ordered_shares_bps integer[] not null,
  effective_total_creator_fees_received programmable_private.uint256_value not null,
  source_occurrence_id uuid not null,
  source_logical_event_id uuid not null,
  source_occurrence_block_hash programmable_private.bytes32_value not null,
  verification_run_id uuid not null,
  verified_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (
    source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  foreign key (verification_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  check (
    programmable_private.valid_beneficiary_set(
      ordered_beneficiaries, ordered_shares_bps, 5
    )
  ),
  unique (source_occurrence_id),
  unique (vault, configuration_epoch, new_configuration_hash)
);

do $rls$
declare
  table_name text;
begin
  foreach table_name in array array[
    'release_dynamic_source_templates',
    'dual_rpc_runtime_code_evidence',
    'dynamic_source_attestations',
    'envio_candidate_inbox',
    'envio_ingestion_cursor_history',
    'envio_ingestion_cursor_current',
    'envio_candidate_resolutions',
    'envio_candidate_status_history',
    'envio_candidate_status_current',
    'release_projection_event_rules',
    'release_launch_completeness_requirements',
    'launch_projection_occurrence_roles',
    'launch_projection_conditions',
    'creator_hook_claim_facts',
    'launcher_hook_claim_facts',
    'creator_fee_checkpoint_facts',
    'reward_configuration_activation_facts'
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
      'create policy %I on programmable_private.%I for all to programmable_migrator using (true) with check (true)',
      table_name || '_migrator_all', table_name
    );
  end loop;
end
$rls$;

create function programmable_private.append_release_projection_event_rule(
  p_projection_event_rule_id uuid,
  p_epoch_id uuid,
  p_projection_kind text,
  p_source_role text,
  p_event_type text,
  p_rule_commitment bytea,
  p_created_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  existing programmable_private.release_projection_event_rules%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_projection_event_rule_id is null
     or pg_catalog.octet_length(p_rule_commitment) <> 32
     or exists (
       select 1 from programmable_private.release_epoch_current
       where epoch_id = p_epoch_id
     )
  then
    raise exception using errcode = '55000', message = 'invalid or active projection event rule';
  end if;
  select * into existing
  from programmable_private.release_projection_event_rules
  where projection_event_rule_id = p_projection_event_rule_id;
  if found then
    if existing.epoch_id <> p_epoch_id
       or existing.projection_kind <> p_projection_kind
       or existing.source_role <> p_source_role
       or existing.event_type <> p_event_type
       or existing.rule_commitment <> p_rule_commitment
    then
      raise exception using errcode = '23505', message = 'projection event rule replay conflict';
    end if;
    return existing.projection_event_rule_id;
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'projection_event_rule.append', p_rule_commitment, null, p_created_at
  );
  insert into programmable_private.release_projection_event_rules (
    projection_event_rule_id, epoch_id, projection_kind, source_role,
    event_type, rule_commitment, created_at, created_by_audit_id
  ) values (
    p_projection_event_rule_id, p_epoch_id,
    p_projection_kind::programmable_private.source_identifier,
    p_source_role::programmable_private.source_identifier,
    p_event_type::programmable_private.source_identifier,
    p_rule_commitment::programmable_private.bytes32_value,
    p_created_at, created_audit_id
  );
  return p_projection_event_rule_id;
end
$function$;

create function programmable_private.append_release_launch_requirement(
  p_launch_requirement_id uuid,
  p_epoch_id uuid,
  p_requirement_ordinal integer,
  p_occurrence_role text,
  p_event_type text,
  p_required_when text,
  p_requirement_commitment bytea,
  p_created_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  existing programmable_private.release_launch_completeness_requirements%rowtype;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_launch_requirement_id is null
     or p_requirement_ordinal < 0
     or p_required_when not in ('always', 'reward_vault', 'locked_custody', 'eth_funded')
     or pg_catalog.octet_length(p_requirement_commitment) <> 32
     or exists (
       select 1 from programmable_private.release_epoch_current
       where epoch_id = p_epoch_id
     )
  then
    raise exception using errcode = '55000', message = 'invalid or active launch requirement';
  end if;
  select * into existing
  from programmable_private.release_launch_completeness_requirements
  where launch_requirement_id = p_launch_requirement_id;
  if found then
    if existing.epoch_id <> p_epoch_id
       or existing.requirement_ordinal <> p_requirement_ordinal
       or existing.occurrence_role <> p_occurrence_role
       or existing.event_type <> p_event_type
       or existing.required_when <> p_required_when
       or existing.requirement_commitment <> p_requirement_commitment
    then
      raise exception using errcode = '23505', message = 'launch requirement replay conflict';
    end if;
    return existing.launch_requirement_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'launch_requirement.append', p_requirement_commitment, null, p_created_at
  );
  insert into programmable_private.release_launch_completeness_requirements (
    launch_requirement_id, epoch_id, requirement_ordinal, occurrence_role,
    event_type, required_when, requirement_commitment, created_at,
    created_by_audit_id
  ) values (
    p_launch_requirement_id, p_epoch_id, p_requirement_ordinal,
    p_occurrence_role::programmable_private.source_identifier,
    p_event_type::programmable_private.source_identifier,
    p_required_when::programmable_private.source_identifier,
    p_requirement_commitment::programmable_private.bytes32_value,
    p_created_at, audit_id
  );
  return p_launch_requirement_id;
end
$function$;

create function programmable_private.assert_projection_event_allowed(
  p_run_id uuid,
  p_occurrence_id uuid,
  p_projection_kind text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  occurrence programmable_private.chain_event_occurrences%rowtype;
  materialization programmable_private.chain_event_occurrence_materializations%rowtype;
  resolved_source_role text;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind in ('ingestion', 'projection');
  if not found then
    raise exception using errcode = '23503', message = 'invalid event-writer run';
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
  select * into occurrence from programmable_private.chain_event_occurrences
  where occurrence_id = p_occurrence_id;
  if not found
     or occurrence.chain_id <> header.chain_id
  then
    raise exception using errcode = '23503', message = 'projection event scope mismatch';
  end if;
  select * into materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = p_occurrence_id
    and chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  if not found then
    raise exception using errcode = '23503', message = 'projection event scope mismatch';
  end if;
  select coalesce(binding.source_role, dynamic_source.deployed_source_role)
    into resolved_source_role
  from programmable_private.chain_event_occurrence_materializations as selected
  left join programmable_private.release_source_bindings as binding
    on binding.binding_id = selected.release_binding_id
  left join programmable_private.dynamic_source_attestations as dynamic_source
    on dynamic_source.dynamic_source_attestation_id =
      selected.dynamic_source_attestation_id
  where selected.materialization_id = materialization.materialization_id;
  if resolved_source_role is null or not exists (
    select 1 from programmable_private.release_projection_event_rules as rule
    where rule.epoch_id = header.epoch_id
      and rule.projection_kind = p_projection_kind
      and rule.source_role = resolved_source_role
      and rule.event_type = materialization.event_type
  ) then
    raise exception using errcode = '23514', message = 'event/source role is outside the release writer allowlist';
  end if;
end
$function$;

create function programmable_private.stage_launch_occurrence_role(
  p_launch_projection_id uuid,
  p_occurrence_role text,
  p_occurrence_id uuid,
  p_staged_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  launch programmable_private.launch_projections%rowtype;
  materialization programmable_private.chain_event_occurrence_materializations%rowtype;
  actual_role text;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into launch from programmable_private.launch_projections
  where launch_projection_id = p_launch_projection_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown staged launch';
  end if;
  perform programmable_private.assert_projection_event_allowed(
    launch.projection_run_id, p_occurrence_id, 'launch_requirement'
  );
  select * into materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = p_occurrence_id
    and epoch_id = launch.epoch_id
    and pointer_generation = launch.pointer_generation;
  select coalesce(binding.source_role, dynamic_source.deployed_source_role)
    into actual_role
  from programmable_private.chain_event_occurrence_materializations as selected
  left join programmable_private.release_source_bindings as binding
    on binding.binding_id = selected.release_binding_id
  left join programmable_private.dynamic_source_attestations as dynamic_source
    on dynamic_source.dynamic_source_attestation_id =
      selected.dynamic_source_attestation_id
  where selected.materialization_id = materialization.materialization_id;
  if actual_role <> p_occurrence_role
     or not exists (
       select 1
       from programmable_private.release_launch_completeness_requirements
       where epoch_id = launch.epoch_id
         and occurrence_role = p_occurrence_role
         and event_type = materialization.event_type
     )
  then
    raise exception using errcode = '23514', message = 'occurrence does not satisfy a launch requirement';
  end if;
  insert into programmable_private.launch_projection_occurrence_roles (
    launch_projection_id, occurrence_role, occurrence_id,
    projection_run_id, staged_at
  ) values (
    p_launch_projection_id,
    p_occurrence_role::programmable_private.source_identifier,
    p_occurrence_id, launch.projection_run_id, p_staged_at
  ) on conflict (launch_projection_id, occurrence_role) do update
    set occurrence_id = excluded.occurrence_id,
        staged_at = excluded.staged_at
    where programmable_private.launch_projection_occurrence_roles.occurrence_id
      = excluded.occurrence_id;
  if not found then
    raise exception using errcode = '23505', message = 'launch occurrence role replay conflict';
  end if;
  return p_launch_projection_id;
end
$function$;

create function programmable_private.stage_launch_projection_conditions(
  p_launch_projection_id uuid,
  p_eth_funded boolean,
  p_staged_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  launch programmable_private.launch_projections%rowtype;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into launch from programmable_private.launch_projections
  where launch_projection_id = p_launch_projection_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown staged launch';
  end if;
  perform programmable_private.projection_stage_context(
    launch.projection_run_id, launch.last_source_occurrence_id,
    launch.promoted_block_number, launch.promoted_block_hash
  );
  insert into programmable_private.launch_projection_conditions (
    launch_projection_id, projection_run_id, eth_funded, staged_at
  ) values (
    p_launch_projection_id, launch.projection_run_id, p_eth_funded, p_staged_at
  ) on conflict (launch_projection_id) do update
    set staged_at = excluded.staged_at
    where programmable_private.launch_projection_conditions.projection_run_id
        = excluded.projection_run_id
      and programmable_private.launch_projection_conditions.eth_funded
        = excluded.eth_funded;
  if not found then
    raise exception using errcode = '23505', message = 'launch condition replay conflict';
  end if;
  return p_launch_projection_id;
end
$function$;

create function programmable_private.stage_pool_fee_configuration_v2(
  p_pool_fee_configuration_id uuid,
  p_pool_projection_id uuid,
  p_run_id uuid,
  p_buy_swap_fee_bps numeric,
  p_sell_swap_fee_bps numeric,
  p_buy_creator_fee_bps numeric,
  p_sell_creator_fee_bps numeric,
  p_launcher_fee_bps numeric,
  p_transfer_tax_bps numeric,
  p_lp_fee_pips numeric,
  p_disclosure_source_occurrence_id uuid,
  p_promoted_block_number numeric,
  p_promoted_block_hash bytea,
  p_verified_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  scope record;
  pool programmable_private.pool_projections%rowtype;
  returned_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_disclosure_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  select * into pool from programmable_private.pool_projections
  where pool_projection_id = p_pool_projection_id
    and projection_run_id = p_run_id;
  if pool.pool_projection_id is null
     or pool.chain_id <> scope.chain_id
     or pool.release_id <> scope.release_id
     or pool.model_id <> scope.model_id
     or pool.epoch_id <> scope.epoch_id
     or pool.pointer_generation <> scope.pointer_generation
     or pool.promoted_block_number <> scope.promoted_block_number
     or pool.promoted_block_hash <> scope.promoted_block_hash
     or exists (
       select 1 from pg_catalog.unnest(array[
         p_buy_swap_fee_bps, p_sell_swap_fee_bps,
         p_buy_creator_fee_bps, p_sell_creator_fee_bps,
         p_launcher_fee_bps, p_transfer_tax_bps
       ]) as value
       where value is null or value <> pg_catalog.trunc(value)
         or value < 0 or value > 10000
     )
     or p_lp_fee_pips is null
     or p_lp_fee_pips <> pg_catalog.trunc(p_lp_fee_pips)
     or p_lp_fee_pips < 0 or p_lp_fee_pips > 1000000
     or p_buy_creator_fee_bps + p_launcher_fee_bps <> p_buy_swap_fee_bps
     or p_sell_creator_fee_bps + p_launcher_fee_bps <> p_sell_swap_fee_bps
  then
    raise exception using errcode = '23514', message = 'directional pool fee scope or values mismatch';
  end if;
  insert into programmable_private.pool_fee_configurations as target (
    pool_fee_configuration_id, pool_projection_id, chain_id, release_id,
    model_id, epoch_id, pointer_generation, buy_swap_fee_bps,
    sell_swap_fee_bps, buy_creator_fee_bps, sell_creator_fee_bps,
    creator_fee_bps, launcher_fee_bps, transfer_tax_bps, lp_fee_pips,
    disclosure_source_occurrence_id, disclosure_source_logical_event_id,
    disclosure_source_occurrence_block_hash, projection_run_id,
    promoted_block_number, promoted_block_hash, verified_at
  ) values (
    p_pool_fee_configuration_id, p_pool_projection_id, scope.chain_id,
    scope.release_id, scope.model_id, scope.epoch_id,
    scope.pointer_generation, p_buy_swap_fee_bps, p_sell_swap_fee_bps,
    p_buy_creator_fee_bps, p_sell_creator_fee_bps,
    case when p_buy_creator_fee_bps = p_sell_creator_fee_bps
      then p_buy_creator_fee_bps else null end,
    p_launcher_fee_bps, p_transfer_tax_bps, p_lp_fee_pips::bigint,
    p_disclosure_source_occurrence_id, scope.source_logical_event_id,
    scope.source_occurrence_block_hash, p_run_id,
    scope.promoted_block_number, scope.promoted_block_hash, p_verified_at
  ) on conflict (pool_fee_configuration_id) do update
    set pool_fee_configuration_id = excluded.pool_fee_configuration_id
    where target is not distinct from excluded
  returning pool_fee_configuration_id into returned_id;
  if returned_id is null then
    raise exception using errcode = '23505', message = 'directional fee replay changed immutable content';
  end if;
  perform programmable_private.append_mutation_audit(
    'pool_fee_configuration_v2.stage', p_promoted_block_hash,
    p_run_id, p_verified_at
  );
  return returned_id;
end
$function$;

create function programmable_private.event_fact_context(
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
  ) then
    raise exception using errcode = '23514', message = 'event fact source is not current canonical';
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

create function programmable_private.append_creator_hook_claim_fact(
  p_creator_hook_claim_fact_id uuid,
  p_run_id uuid,
  p_source_occurrence_id uuid,
  p_pool_id bytea,
  p_reward_vault bytea,
  p_creator bytea,
  p_recipient bytea,
  p_quote_asset bytea,
  p_caller bytea,
  p_amount numeric,
  p_verified_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  scope record;
  existing programmable_private.creator_hook_claim_facts%rowtype;
  amount numeric;
  returned_id uuid;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.event_fact_context(
    p_run_id, p_source_occurrence_id, 'creator_hook_claim'
  );
  amount := programmable_private.validate_uint256(p_amount);
  if pg_catalog.octet_length(p_pool_id) <> 32
     or pg_catalog.octet_length(p_caller) <> 20
     or (p_reward_vault is not null and pg_catalog.octet_length(p_reward_vault) <> 20)
     or (p_creator is not null and pg_catalog.octet_length(p_creator) <> 20)
     or (p_recipient is not null and pg_catalog.octet_length(p_recipient) <> 20)
     or (p_quote_asset is not null and pg_catalog.octet_length(p_quote_asset) <> 20)
     or not (
       (p_reward_vault is not null and p_creator is null and p_recipient is null)
       or (p_reward_vault is null and p_creator is not null
         and p_recipient is not null and p_quote_asset is null)
     )
  then
    raise exception using errcode = '22023', message = 'creator claim does not match an allowlisted hook event shape';
  end if;
  select * into existing
  from programmable_private.creator_hook_claim_facts
  where creator_hook_claim_fact_id = p_creator_hook_claim_fact_id;
  if found then
    if existing.chain_id <> scope.chain_id
       or existing.release_id <> scope.release_id
       or existing.model_id <> scope.model_id
       or existing.epoch_id <> scope.epoch_id
       or existing.pointer_generation <> scope.pointer_generation
       or existing.pool_id <> p_pool_id
       or existing.reward_vault is distinct from p_reward_vault
       or existing.creator is distinct from p_creator
       or existing.recipient is distinct from p_recipient
       or existing.quote_asset is distinct from p_quote_asset
       or existing.caller <> p_caller
       or existing.amount <> amount
       or existing.source_occurrence_id <> p_source_occurrence_id
       or existing.source_logical_event_id <> scope.logical_event_id
       or existing.source_occurrence_block_hash <> scope.occurrence_block_hash
       or existing.verification_run_id <> p_run_id
       or existing.verified_at <> p_verified_at
    then
      raise exception using errcode = '23505', message = 'creator hook claim replay conflict';
    end if;
    return existing.creator_hook_claim_fact_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'creator_hook_claim.append', scope.occurrence_block_hash,
    p_run_id, p_verified_at
  );
  insert into programmable_private.creator_hook_claim_facts as target (
    creator_hook_claim_fact_id, chain_id, release_id, model_id, epoch_id,
    pointer_generation, pool_id, reward_vault, creator, recipient,
    quote_asset, caller, amount, source_occurrence_id,
    source_logical_event_id, source_occurrence_block_hash,
    verification_run_id, verified_at, created_by_audit_id
  ) values (
    p_creator_hook_claim_fact_id, scope.chain_id, scope.release_id,
    scope.model_id, scope.epoch_id, scope.pointer_generation, p_pool_id,
    p_reward_vault, p_creator, p_recipient, p_quote_asset, p_caller, amount,
    p_source_occurrence_id, scope.logical_event_id,
    scope.occurrence_block_hash, p_run_id, p_verified_at, audit_id
  )
  returning creator_hook_claim_fact_id into returned_id;
  return returned_id;
end
$function$;

create function programmable_private.append_launcher_hook_claim_fact(
  p_launcher_hook_claim_fact_id uuid,
  p_run_id uuid,
  p_source_occurrence_id uuid,
  p_treasury bytea,
  p_recipient bytea,
  p_quote_asset bytea,
  p_caller bytea,
  p_amount numeric,
  p_verified_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  scope record;
  existing programmable_private.launcher_hook_claim_facts%rowtype;
  amount numeric;
  returned_id uuid;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.event_fact_context(
    p_run_id, p_source_occurrence_id, 'launcher_hook_claim'
  );
  amount := programmable_private.validate_uint256(p_amount);
  if pg_catalog.octet_length(p_treasury) <> 20
     or pg_catalog.octet_length(p_recipient) <> 20
     or pg_catalog.octet_length(p_caller) <> 20
     or (p_quote_asset is not null and pg_catalog.octet_length(p_quote_asset) <> 20)
  then
    raise exception using errcode = '22023', message = 'launcher claim does not match an allowlisted hook event shape';
  end if;
  select * into existing
  from programmable_private.launcher_hook_claim_facts
  where launcher_hook_claim_fact_id = p_launcher_hook_claim_fact_id;
  if found then
    if existing.chain_id <> scope.chain_id
       or existing.release_id <> scope.release_id
       or existing.model_id <> scope.model_id
       or existing.epoch_id <> scope.epoch_id
       or existing.pointer_generation <> scope.pointer_generation
       or existing.treasury <> p_treasury
       or existing.recipient <> p_recipient
       or existing.quote_asset is distinct from p_quote_asset
       or existing.caller <> p_caller
       or existing.amount <> amount
       or existing.source_occurrence_id <> p_source_occurrence_id
       or existing.source_logical_event_id <> scope.logical_event_id
       or existing.source_occurrence_block_hash <> scope.occurrence_block_hash
       or existing.verification_run_id <> p_run_id
       or existing.verified_at <> p_verified_at
    then
      raise exception using errcode = '23505', message = 'launcher hook claim replay conflict';
    end if;
    return existing.launcher_hook_claim_fact_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'launcher_hook_claim.append', scope.occurrence_block_hash,
    p_run_id, p_verified_at
  );
  insert into programmable_private.launcher_hook_claim_facts as target (
    launcher_hook_claim_fact_id, chain_id, release_id, model_id, epoch_id,
    pointer_generation, treasury, recipient, quote_asset, caller, amount,
    source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash, verification_run_id, verified_at,
    created_by_audit_id
  ) values (
    p_launcher_hook_claim_fact_id, scope.chain_id, scope.release_id,
    scope.model_id, scope.epoch_id, scope.pointer_generation, p_treasury,
    p_recipient, p_quote_asset, p_caller, amount, p_source_occurrence_id,
    scope.logical_event_id, scope.occurrence_block_hash,
    p_run_id, p_verified_at, audit_id
  )
  returning launcher_hook_claim_fact_id into returned_id;
  return returned_id;
end
$function$;

create function programmable_private.append_creator_fee_checkpoint_fact(
  p_creator_fee_checkpoint_fact_id uuid,
  p_run_id uuid,
  p_source_occurrence_id uuid,
  p_pool_id bytea,
  p_configuration_epoch numeric,
  p_amount numeric,
  p_total_creator_fees_received numeric,
  p_verified_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  scope record;
  existing programmable_private.creator_fee_checkpoint_facts%rowtype;
  amount numeric;
  total_received numeric;
  normalized_epoch bigint;
  returned_id uuid;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.event_fact_context(
    p_run_id, p_source_occurrence_id, 'creator_fee_checkpoint'
  );
  amount := programmable_private.validate_uint256(p_amount);
  total_received := programmable_private.validate_uint256(
    p_total_creator_fees_received
  );
  if pg_catalog.octet_length(p_pool_id) <> 32
     or p_configuration_epoch <> pg_catalog.trunc(p_configuration_epoch)
     or p_configuration_epoch < 0
     or p_configuration_epoch > 9223372036854775807
     or amount > total_received
  then
    raise exception using errcode = '22023', message = 'invalid creator fee checkpoint';
  end if;
  normalized_epoch := p_configuration_epoch::bigint;
  select * into existing
  from programmable_private.creator_fee_checkpoint_facts
  where creator_fee_checkpoint_fact_id = p_creator_fee_checkpoint_fact_id;
  if found then
    if existing.chain_id <> scope.chain_id
       or existing.release_id <> scope.release_id
       or existing.model_id <> scope.model_id
       or existing.epoch_id <> scope.epoch_id
       or existing.pointer_generation <> scope.pointer_generation
       or existing.vault <> scope.source_address
       or existing.pool_id <> p_pool_id
       or existing.configuration_epoch <> normalized_epoch
       or existing.amount <> amount
       or existing.total_creator_fees_received <> total_received
       or existing.source_occurrence_id <> p_source_occurrence_id
       or existing.source_logical_event_id <> scope.logical_event_id
       or existing.source_occurrence_block_hash <> scope.occurrence_block_hash
       or existing.verification_run_id <> p_run_id
       or existing.verified_at <> p_verified_at
    then
      raise exception using errcode = '23505', message = 'creator fee checkpoint replay conflict';
    end if;
    return existing.creator_fee_checkpoint_fact_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'creator_fee_checkpoint.append', scope.occurrence_block_hash,
    p_run_id, p_verified_at
  );
  insert into programmable_private.creator_fee_checkpoint_facts as target (
    creator_fee_checkpoint_fact_id, chain_id, release_id, model_id,
    epoch_id, pointer_generation, vault, pool_id, configuration_epoch,
    amount, total_creator_fees_received, source_occurrence_id,
    source_logical_event_id, source_occurrence_block_hash,
    verification_run_id, verified_at, created_by_audit_id
  ) values (
    p_creator_fee_checkpoint_fact_id, scope.chain_id, scope.release_id,
    scope.model_id, scope.epoch_id, scope.pointer_generation,
    scope.source_address, p_pool_id, normalized_epoch, amount,
    total_received, p_source_occurrence_id, scope.logical_event_id,
    scope.occurrence_block_hash, p_run_id, p_verified_at, audit_id
  )
  returning creator_fee_checkpoint_fact_id into returned_id;
  return returned_id;
end
$function$;

create function programmable_private.append_reward_configuration_activation_fact(
  p_reward_configuration_activation_fact_id uuid,
  p_run_id uuid,
  p_source_occurrence_id uuid,
  p_pool_id bytea,
  p_approval_reference bytea,
  p_configuration_epoch numeric,
  p_previous_configuration_hash bytea,
  p_new_configuration_hash bytea,
  p_ordered_beneficiaries bytea[],
  p_ordered_shares_bps numeric[],
  p_effective_total_creator_fees_received numeric,
  p_verified_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  scope record;
  existing programmable_private.reward_configuration_activation_facts%rowtype;
  normalized_epoch bigint;
  shares integer[];
  effective_total numeric;
  returned_id uuid;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.event_fact_context(
    p_run_id, p_source_occurrence_id, 'reward_configuration_activation'
  );
  effective_total := programmable_private.validate_uint256(
    p_effective_total_creator_fees_received
  );
  if pg_catalog.octet_length(p_pool_id) <> 32
     or pg_catalog.octet_length(p_approval_reference) <> 32
     or pg_catalog.octet_length(p_previous_configuration_hash) <> 32
     or pg_catalog.octet_length(p_new_configuration_hash) <> 32
     or p_configuration_epoch <> pg_catalog.trunc(p_configuration_epoch)
     or p_configuration_epoch < 0
     or p_configuration_epoch > 9223372036854775807
     or cardinality(p_ordered_beneficiaries) <> cardinality(p_ordered_shares_bps)
     or exists (
       select 1 from pg_catalog.unnest(p_ordered_shares_bps) as share
       where share <> pg_catalog.trunc(share)
     )
  then
    raise exception using errcode = '22023', message = 'invalid reward configuration activation';
  end if;
  select pg_catalog.array_agg(share::integer order by ordinality)
    into shares
  from pg_catalog.unnest(p_ordered_shares_bps)
    with ordinality as value(share, ordinality);
  if not programmable_private.valid_beneficiary_set(
    p_ordered_beneficiaries, shares, 5
  ) then
    raise exception using errcode = '22023', message = 'invalid activated beneficiary set';
  end if;
  normalized_epoch := p_configuration_epoch::bigint;
  select * into existing
  from programmable_private.reward_configuration_activation_facts
  where reward_configuration_activation_fact_id =
    p_reward_configuration_activation_fact_id;
  if found then
    if existing.chain_id <> scope.chain_id
       or existing.release_id <> scope.release_id
       or existing.model_id <> scope.model_id
       or existing.epoch_id <> scope.epoch_id
       or existing.pointer_generation <> scope.pointer_generation
       or existing.vault <> scope.source_address
       or existing.pool_id <> p_pool_id
       or existing.approval_reference <> p_approval_reference
       or existing.configuration_epoch <> normalized_epoch
       or existing.previous_configuration_hash <>
         p_previous_configuration_hash
       or existing.new_configuration_hash <> p_new_configuration_hash
       or existing.ordered_beneficiaries <> p_ordered_beneficiaries
       or existing.ordered_shares_bps <> shares
       or existing.effective_total_creator_fees_received <> effective_total
       or existing.source_occurrence_id <> p_source_occurrence_id
       or existing.source_logical_event_id <> scope.logical_event_id
       or existing.source_occurrence_block_hash <> scope.occurrence_block_hash
       or existing.verification_run_id <> p_run_id
       or existing.verified_at <> p_verified_at
    then
      raise exception using errcode = '23505', message = 'reward configuration activation replay conflict';
    end if;
    return existing.reward_configuration_activation_fact_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'reward_configuration_activation.append', scope.occurrence_block_hash,
    p_run_id, p_verified_at
  );
  insert into programmable_private.reward_configuration_activation_facts as target (
    reward_configuration_activation_fact_id, chain_id, release_id,
    model_id, epoch_id, pointer_generation, vault, pool_id,
    approval_reference, configuration_epoch, previous_configuration_hash,
    new_configuration_hash, ordered_beneficiaries, ordered_shares_bps,
    effective_total_creator_fees_received, source_occurrence_id,
    source_logical_event_id, source_occurrence_block_hash,
    verification_run_id, verified_at, created_by_audit_id
  ) values (
    p_reward_configuration_activation_fact_id, scope.chain_id,
    scope.release_id, scope.model_id, scope.epoch_id,
    scope.pointer_generation, scope.source_address, p_pool_id,
    p_approval_reference, normalized_epoch, p_previous_configuration_hash,
    p_new_configuration_hash, p_ordered_beneficiaries, shares,
    effective_total, p_source_occurrence_id, scope.logical_event_id,
    scope.occurrence_block_hash, p_run_id, p_verified_at, audit_id
  )
  returning reward_configuration_activation_fact_id into returned_id;
  return returned_id;
end
$function$;

create function programmable_private.enforce_projection_event_rule()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  source_occurrence_id uuid;
  projection_kind text;
begin
  source_occurrence_id := case tg_table_name
    when 'launch_projections' then
      (pg_catalog.to_jsonb(new)->>'last_source_occurrence_id')::uuid
    when 'pool_projections' then
      (pg_catalog.to_jsonb(new)->>'last_source_occurrence_id')::uuid
    when 'pool_fee_configurations' then
      (pg_catalog.to_jsonb(new)->>'disclosure_source_occurrence_id')::uuid
    when 'fee_accrual_facts' then
      (pg_catalog.to_jsonb(new)->>'source_occurrence_id')::uuid
    when 'pool_fee_totals' then
      (pg_catalog.to_jsonb(new)->>'last_source_occurrence_id')::uuid
    when 'reward_vault_projections' then
      (pg_catalog.to_jsonb(new)->>'last_source_occurrence_id')::uuid
    when 'reward_allocation_projections' then
      (pg_catalog.to_jsonb(new)->>'last_source_occurrence_id')::uuid
    when 'claim_projections' then
      (pg_catalog.to_jsonb(new)->>'source_occurrence_id')::uuid
    when 'payout_change_projections' then
      (pg_catalog.to_jsonb(new)->>'source_occurrence_id')::uuid
    when 'account_reward_balances' then
      (pg_catalog.to_jsonb(new)->>'last_source_occurrence_id')::uuid
    when 'initial_buy_custody_projections' then
      (pg_catalog.to_jsonb(new)->>'source_occurrence_id')::uuid
    when 'initial_buy_vesting_projections' then
      (pg_catalog.to_jsonb(new)->>'source_occurrence_id')::uuid
    else null
  end;
  projection_kind := case tg_table_name
    when 'launch_projections' then 'launch'
    when 'pool_projections' then 'pool'
    when 'pool_fee_configurations' then 'pool_fee_configuration'
    when 'fee_accrual_facts' then 'fee_accrual'
    when 'pool_fee_totals' then 'pool_fee_total'
    when 'reward_vault_projections' then 'reward_vault'
    when 'reward_allocation_projections' then 'reward_allocation'
    when 'claim_projections' then 'claim'
    when 'payout_change_projections' then 'payout_change'
    when 'account_reward_balances' then 'account_reward_balance'
    when 'initial_buy_custody_projections' then 'initial_buy_custody'
    when 'initial_buy_vesting_projections' then 'initial_buy_vesting'
    else null
  end;
  perform programmable_private.assert_projection_event_allowed(
    new.projection_run_id, source_occurrence_id, projection_kind
  );
  return new;
end
$function$;

do $projection_event_triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'launch_projections', 'pool_projections', 'pool_fee_configurations',
    'fee_accrual_facts', 'pool_fee_totals', 'reward_vault_projections',
    'reward_allocation_projections', 'claim_projections',
    'payout_change_projections', 'account_reward_balances',
    'initial_buy_custody_projections', 'initial_buy_vesting_projections'
  ] loop
    execute pg_catalog.format(
      'create trigger %I before insert on programmable_private.%I for each row execute function programmable_private.enforce_projection_event_rule()',
      table_name || '_event_rule', table_name
    );
  end loop;
end
$projection_event_triggers$;

create function programmable_private.enforce_launch_publication_completeness()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  launch programmable_private.launch_projections%rowtype;
  requirement programmable_private.release_launch_completeness_requirements%rowtype;
  condition_record programmable_private.launch_projection_conditions%rowtype;
  condition_applies boolean;
begin
  if not exists (
    select 1 from programmable_private.release_launch_completeness_requirements
    where epoch_id = new.epoch_id
  ) then
    raise exception using errcode = '23514', message = 'release has no launch completeness manifest';
  end if;
  for launch in
    select * from programmable_private.launch_projections
    where projection_run_id = new.run_id
  loop
    select * into condition_record
    from programmable_private.launch_projection_conditions
    where launch_projection_id = launch.launch_projection_id
      and projection_run_id = launch.projection_run_id;
    if not found then
      raise exception using errcode = '23514', message = 'launch funding condition was not staged';
    end if;
    for requirement in
      select *
      from programmable_private.release_launch_completeness_requirements
      where epoch_id = launch.epoch_id
      order by requirement_ordinal
    loop
      condition_applies := requirement.required_when = 'always'
        or (requirement.required_when = 'reward_vault'
          and launch.reward_vault is not null)
        or (requirement.required_when = 'locked_custody' and exists (
          select 1 from programmable_private.initial_buy_custody_projections
          where launch_projection_id = launch.launch_projection_id
            and projection_run_id = launch.projection_run_id
            and custody_mode <> 0
        ))
        or (requirement.required_when = 'eth_funded'
          and condition_record.eth_funded);
      if condition_applies and not exists (
        select 1
        from programmable_private.launch_projection_occurrence_roles as role
        join programmable_private.chain_event_occurrences as occurrence
          on occurrence.occurrence_id = role.occurrence_id
        join programmable_private.chain_event_occurrence_materializations
          as materialization
          on materialization.occurrence_id = role.occurrence_id
         and materialization.epoch_id = launch.epoch_id
         and materialization.pointer_generation = launch.pointer_generation
        join programmable_private.chain_event_current_canonical as canonical
          on canonical.occurrence_id = occurrence.occurrence_id
         and canonical.logical_event_id = occurrence.logical_event_id
        where role.launch_projection_id = launch.launch_projection_id
          and role.projection_run_id = launch.projection_run_id
          and role.occurrence_role = requirement.occurrence_role
          and materialization.event_type = requirement.event_type
      ) then
        raise exception using errcode = '23514', message = 'launch completeness occurrence is missing';
      end if;
    end loop;
    if launch.reward_vault is not null and (
      not exists (
        select 1
        from programmable_private.release_launch_completeness_requirements
        where epoch_id = launch.epoch_id and required_when = 'reward_vault'
      )
      or not exists (
        select 1
        from programmable_private.reward_vault_projections as vault
        join programmable_private.reward_allocation_current_verified as seed
          on seed.allocation_fact_id = vault.current_allocation_fact_id
         and seed.vault = vault.vault
        where vault.launch_projection_id = launch.launch_projection_id
          and vault.projection_run_id = launch.projection_run_id
          and vault.vault = launch.reward_vault
      )
    ) then
      raise exception using errcode = '23514', message = 'reward-vault launch lacks verified seed completeness';
    end if;
    if exists (
      select 1 from programmable_private.initial_buy_custody_projections
      where launch_projection_id = launch.launch_projection_id
        and projection_run_id = launch.projection_run_id
        and custody_mode <> 0
    ) and (
      not exists (
        select 1 from programmable_private.release_launch_completeness_requirements
        where epoch_id = launch.epoch_id and required_when = 'locked_custody'
      )
      or not exists (
        select 1
        from programmable_private.initial_buy_custody_projections as custody
        join programmable_private.initial_buy_vesting_projections as vesting
          on vesting.custody_projection_id = custody.custody_projection_id
         and vesting.projection_run_id = custody.projection_run_id
        where custody.launch_projection_id = launch.launch_projection_id
          and custody.projection_run_id = launch.projection_run_id
          and custody.custody_mode <> 0
      )
    ) then
      raise exception using errcode = '23514', message = 'locked custody lacks vesting completeness';
    end if;
    if condition_record.eth_funded and not exists (
      select 1 from programmable_private.release_launch_completeness_requirements
      where epoch_id = launch.epoch_id and required_when = 'eth_funded'
    ) then
      raise exception using errcode = '23514', message = 'ETH-funded launch lacks coordinator requirement';
    end if;
  end loop;
  return new;
end
$function$;

create trigger projection_publication_launch_completeness
before insert on programmable_private.projection_publications
for each row execute function programmable_private.enforce_launch_publication_completeness();

create function programmable_private.append_release_dynamic_source_template(
  p_dynamic_source_template_id uuid,
  p_epoch_id uuid,
  p_parent_factory_release_binding_id uuid,
  p_parent_source_role text,
  p_factory_event_type text,
  p_deployed_address_field text,
  p_deployed_source_role text,
  p_deployed_artifact_creation_code_commitment bytea,
  p_normalized_runtime_code_hash bytea,
  p_immutable_references_commitment bytea,
  p_immutable_binding_spec jsonb,
  p_immutable_binding_commitment bytea,
  p_runtime_code_length numeric,
  p_abi_event_set_commitment bytea,
  p_template_commitment bytea,
  p_created_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  audit_id uuid;
  existing programmable_private.release_dynamic_source_templates%rowtype;
  parent_binding programmable_private.release_source_bindings%rowtype;
  normalized_runtime_code_length bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into parent_binding
  from programmable_private.release_source_bindings
  where binding_id = p_parent_factory_release_binding_id
    and epoch_id = p_epoch_id
    and source_role = p_parent_source_role
    and source_type = 'ethereum_contract'
    and source_address is not null;
  if p_dynamic_source_template_id is null
     or parent_binding.binding_id is null
     or p_deployed_address_field not in ('vault', 'wallet')
     or p_deployed_source_role not in ('reward_vault', 'vesting_wallet')
     or not (
       (p_deployed_source_role = 'reward_vault'
         and p_deployed_address_field = 'vault')
       or (p_deployed_source_role = 'vesting_wallet'
         and p_deployed_address_field = 'wallet')
     )
     or pg_catalog.octet_length(
       p_deployed_artifact_creation_code_commitment
     ) <> 32
     or pg_catalog.octet_length(p_normalized_runtime_code_hash) <> 32
     or pg_catalog.octet_length(p_immutable_references_commitment) <> 32
     or not programmable_private.valid_immutable_binding_spec(
       p_immutable_binding_spec
     )
     or pg_catalog.octet_length(p_immutable_binding_commitment) <> 32
     or p_runtime_code_length <> pg_catalog.trunc(p_runtime_code_length)
     or p_runtime_code_length <= 0
     or p_runtime_code_length > 16777216
     or pg_catalog.octet_length(p_abi_event_set_commitment) <> 32
     or pg_catalog.octet_length(p_template_commitment) <> 32
     or exists (
       select 1 from programmable_private.release_epoch_current
       where epoch_id = p_epoch_id
     )
  then
    raise exception using errcode = '22023', message = 'invalid or active dynamic source template';
  end if;
  normalized_runtime_code_length := p_runtime_code_length::bigint;
  if not programmable_private.immutable_binding_spec_fits_runtime(
    p_immutable_binding_spec, normalized_runtime_code_length
  ) then
    raise exception using
      errcode = '22023',
      message = 'immutable binding offsets exceed normalized runtime';
  end if;
  select * into existing
  from programmable_private.release_dynamic_source_templates
  where dynamic_source_template_id = p_dynamic_source_template_id;
  if found then
    if existing.epoch_id <> p_epoch_id
       or existing.parent_factory_release_binding_id
         <> p_parent_factory_release_binding_id
       or existing.parent_factory_binding_commitment
         <> parent_binding.binding_commitment
       or existing.parent_source_role <> p_parent_source_role
       or existing.factory_event_type <> p_factory_event_type
       or existing.deployed_address_field <> p_deployed_address_field
       or existing.deployed_source_role <> p_deployed_source_role
       or existing.deployed_artifact_creation_code_commitment
         <> p_deployed_artifact_creation_code_commitment
       or existing.normalized_runtime_code_hash
         <> p_normalized_runtime_code_hash
       or existing.immutable_references_commitment
         <> p_immutable_references_commitment
       or existing.immutable_binding_spec <> p_immutable_binding_spec
       or existing.immutable_binding_commitment
         <> p_immutable_binding_commitment
       or existing.runtime_code_length <> normalized_runtime_code_length
       or existing.abi_event_set_commitment <> p_abi_event_set_commitment
       or existing.template_commitment <> p_template_commitment
    then
      raise exception using errcode = '23505', message = 'dynamic source template replay conflict';
    end if;
    return existing.dynamic_source_template_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'dynamic_source_template.append', p_template_commitment, null, p_created_at
  );
  insert into programmable_private.release_dynamic_source_templates (
    dynamic_source_template_id, epoch_id,
    parent_factory_release_binding_id, parent_factory_binding_commitment,
    parent_source_role, factory_event_type, deployed_address_field,
    deployed_source_role, deployed_artifact_creation_code_commitment,
    normalized_runtime_code_hash, immutable_references_commitment,
    immutable_binding_spec, immutable_binding_commitment,
    runtime_code_length,
    abi_event_set_commitment, template_commitment, created_at,
    created_by_audit_id
  ) values (
    p_dynamic_source_template_id, p_epoch_id,
    p_parent_factory_release_binding_id, parent_binding.binding_commitment,
    p_parent_source_role::programmable_private.source_identifier,
    p_factory_event_type::programmable_private.source_identifier,
    p_deployed_address_field::programmable_private.source_identifier,
    p_deployed_source_role::programmable_private.source_identifier,
    p_deployed_artifact_creation_code_commitment::programmable_private.bytes32_value,
    p_normalized_runtime_code_hash::programmable_private.bytes32_value,
    p_immutable_references_commitment::programmable_private.bytes32_value,
    p_immutable_binding_spec,
    p_immutable_binding_commitment::programmable_private.bytes32_value,
    normalized_runtime_code_length,
    p_abi_event_set_commitment::programmable_private.bytes32_value,
    p_template_commitment::programmable_private.bytes32_value,
    p_created_at, audit_id
  );
  return p_dynamic_source_template_id;
end
$function$;

create function programmable_private.append_dual_rpc_runtime_code_evidence(
  p_runtime_code_evidence_id uuid,
  p_run_id uuid,
  p_source_address bytea,
  p_deployment_block_evidence_id uuid,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_runtime_code_hash_a bytea,
  p_runtime_code_hash_b bytea,
  p_runtime_code_length_a numeric,
  p_runtime_code_length_b numeric,
  p_normalized_runtime_code_hash_a bytea,
  p_normalized_runtime_code_hash_b bytea,
  p_immutable_references_commitment bytea,
  p_immutable_values bytea[],
  p_immutable_values_commitment bytea,
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
    raise exception using errcode = '23503', message = 'invalid runtime-code verification run';
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
     or p_runtime_code_length_a is null
     or p_runtime_code_length_b is null
     or p_runtime_code_length_a <> pg_catalog.trunc(p_runtime_code_length_a)
     or p_runtime_code_length_b <> pg_catalog.trunc(p_runtime_code_length_b)
     or p_runtime_code_length_a <> p_runtime_code_length_b
     or p_runtime_code_length_a <= 0
     or p_runtime_code_length_a > 16777216
     or pg_catalog.octet_length(p_normalized_runtime_code_hash_a) <> 32
     or p_normalized_runtime_code_hash_a
       <> p_normalized_runtime_code_hash_b
     or pg_catalog.octet_length(p_immutable_references_commitment) <> 32
     or not programmable_private.valid_immutable_values(p_immutable_values)
     or pg_catalog.octet_length(p_immutable_values_commitment) <> 32
     or pg_catalog.octet_length(p_reconstructed_runtime_code_hash) <> 32
     or p_reconstructed_runtime_code_hash <> p_runtime_code_hash_a
     or pg_catalog.octet_length(p_evidence_commitment) <> 32
  then
    raise exception using errcode = '23514', message = 'runtime code lacks exact dual-RPC deployment-block evidence';
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
       or existing.deployment_block_evidence_id <> p_deployment_block_evidence_id
       or existing.provider_a_id <> p_provider_a_id
       or existing.provider_b_id <> p_provider_b_id
       or existing.agreed_runtime_code_hash <> p_runtime_code_hash_a
       or existing.agreed_runtime_code_length
         <> normalized_runtime_code_length
       or existing.agreed_normalized_runtime_code_hash
         <> p_normalized_runtime_code_hash_a
       or existing.immutable_references_commitment
         <> p_immutable_references_commitment
       or existing.immutable_values <> p_immutable_values
       or existing.immutable_values_commitment
         <> p_immutable_values_commitment
       or existing.reconstructed_runtime_code_hash
         <> p_reconstructed_runtime_code_hash
       or existing.encoding_version <> p_encoding_version
       or existing.canonical_preimage <> p_canonical_preimage
       or existing.content_fingerprint <> p_content_fingerprint
       or existing.evidence_commitment <> p_evidence_commitment
    then
      raise exception using errcode = '23505', message = 'runtime code evidence replay conflict';
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
    runtime_code_length_a, runtime_code_length_b,
    agreed_runtime_code_length, normalized_runtime_code_hash_a,
    normalized_runtime_code_hash_b, agreed_normalized_runtime_code_hash,
    immutable_references_commitment, immutable_values,
    immutable_values_commitment, reconstructed_runtime_code_hash,
    encoding_version, canonical_preimage, content_fingerprint,
    evidence_commitment, verification_run_id, verified_at, created_by_audit_id
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
    normalized_runtime_code_length, normalized_runtime_code_length,
    normalized_runtime_code_length,
    p_normalized_runtime_code_hash_a::programmable_private.bytes32_value,
    p_normalized_runtime_code_hash_b::programmable_private.bytes32_value,
    p_normalized_runtime_code_hash_a::programmable_private.bytes32_value,
    p_immutable_references_commitment::programmable_private.bytes32_value,
    p_immutable_values,
    p_immutable_values_commitment::programmable_private.bytes32_value,
    p_reconstructed_runtime_code_hash::programmable_private.bytes32_value,
    p_encoding_version, p_canonical_preimage,
    p_content_fingerprint::programmable_private.bytes32_value,
    p_evidence_commitment::programmable_private.bytes32_value,
    p_run_id, p_verified_at, audit_id
  );
  return p_runtime_code_evidence_id;
end
$function$;

create function programmable_private.register_dynamic_source_attestation(
  p_dynamic_source_attestation_id uuid,
  p_run_id uuid,
  p_dynamic_source_template_id uuid,
  p_parent_factory_occurrence_id uuid,
  p_deployed_source_address bytea,
  p_deployment_block_number numeric,
  p_runtime_code_evidence_id uuid,
  p_deployed_artifact_creation_code_commitment bytea,
  p_expected_immutable_values_commitment bytea,
  p_factory_configuration_commitment bytea,
  p_constructor_arguments_commitment bytea,
  p_local_init_code_hash bytea,
  p_runtime_code_hash bytea,
  p_abi_event_set_commitment bytea,
  p_encoding_version smallint,
  p_canonical_preimage bytea,
  p_content_fingerprint bytea,
  p_attestation_commitment bytea,
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
  parent programmable_private.chain_event_occurrences%rowtype;
  parent_materialization programmable_private.chain_event_occurrence_materializations%rowtype;
  parent_binding programmable_private.release_source_bindings%rowtype;
  template programmable_private.release_dynamic_source_templates%rowtype;
  code_evidence programmable_private.dual_rpc_runtime_code_evidence%rowtype;
  existing programmable_private.dynamic_source_attestations%rowtype;
  deployment_block bigint;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_provider_evidence_encoding(
    'dynamic_attestation', p_encoding_version, p_canonical_preimage,
    p_content_fingerprint
  );
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind in ('ingestion', 'projection');
  if not found then
    raise exception using errcode = '23503', message = 'invalid dynamic source run';
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
  select * into template
  from programmable_private.release_dynamic_source_templates
  where dynamic_source_template_id = p_dynamic_source_template_id
    and epoch_id = header.epoch_id;
  select * into parent
  from programmable_private.chain_event_occurrences
  where occurrence_id = p_parent_factory_occurrence_id;
  select * into parent_materialization
  from programmable_private.chain_event_occurrence_materializations
  where occurrence_id = p_parent_factory_occurrence_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  if template.dynamic_source_template_id is null
     or parent.occurrence_id is null
     or parent_materialization.materialization_id is null
     or parent.chain_id <> header.chain_id
     or parent_materialization.release_id <> header.release_id
     or parent_materialization.model_id <> header.model_id
     or parent_materialization.source_group <> header.source_group
     or parent_materialization.event_type <> template.factory_event_type
     or not exists (
       select 1
       from programmable_private.chain_event_current_canonical as canonical
       where canonical.occurrence_id = parent.occurrence_id
         and canonical.logical_event_id = parent.logical_event_id
         and canonical.block_hash = parent.block_hash
     )
  then
    raise exception using errcode = '23503', message = 'factory deployment occurrence is not current canonical';
  end if;
  select * into code_evidence
  from programmable_private.dual_rpc_runtime_code_evidence
  where runtime_code_evidence_id = p_runtime_code_evidence_id
    and chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation
    and source_address = p_deployed_source_address
    and deployment_block_number = parent.block_number
    and deployment_block_hash = parent.block_hash
    and agreed_runtime_code_hash = p_runtime_code_hash
    and agreed_runtime_code_length = template.runtime_code_length
    and agreed_normalized_runtime_code_hash
      = template.normalized_runtime_code_hash
    and immutable_references_commitment
      = template.immutable_references_commitment
    and reconstructed_runtime_code_hash = agreed_runtime_code_hash
    and immutable_values_commitment
      = p_expected_immutable_values_commitment;
  if not found then
    raise exception using errcode = '23514', message = 'dynamic source lacks exact dual-RPC runtime code evidence';
  end if;
  select * into parent_binding
  from programmable_private.release_source_bindings
  where binding_id = template.parent_factory_release_binding_id
    and binding_id = parent_materialization.release_binding_id
    and epoch_id = header.epoch_id
    and source_role = template.parent_source_role
    and source_address = parent.source_address
    and binding_commitment = template.parent_factory_binding_commitment
    and abi_event_set_commitment
      = parent_materialization.abi_event_set_commitment
    and inclusive_start_block <= parent.block_number;
  if not found then
    raise exception using errcode = '23514', message = 'factory occurrence lacks exact release binding';
  end if;
  if p_deployment_block_number <> pg_catalog.trunc(p_deployment_block_number)
     or p_deployment_block_number < 0
     or p_deployment_block_number > 9223372036854775807
     or p_deployment_block_number::bigint <> parent.block_number
     or pg_catalog.octet_length(p_deployed_source_address) <> 20
     or pg_catalog.octet_length(
       p_deployed_artifact_creation_code_commitment
     ) <> 32
     or p_deployed_artifact_creation_code_commitment
       <> template.deployed_artifact_creation_code_commitment
     or pg_catalog.octet_length(
       p_expected_immutable_values_commitment
     ) <> 32
     or p_expected_immutable_values_commitment
       <> code_evidence.immutable_values_commitment
     or pg_catalog.octet_length(p_factory_configuration_commitment) <> 32
     or pg_catalog.lower(
       parent_materialization.decoded_payload ->>
         (template.immutable_binding_spec ->> 'factoryConfigurationField')
     ) is distinct from
       '0x' || pg_catalog.encode(p_factory_configuration_commitment, 'hex')
     or not programmable_private.immutable_values_match_binding_spec(
       template.immutable_binding_spec,
       parent_materialization.decoded_payload,
       p_deployed_source_address,
       code_evidence.immutable_values
     )
     or pg_catalog.octet_length(p_constructor_arguments_commitment) <> 32
     or pg_catalog.octet_length(p_local_init_code_hash) <> 32
     or p_local_init_code_hash
       = template.deployed_artifact_creation_code_commitment
     or pg_catalog.lower(
       parent_materialization.decoded_payload ->> template.deployed_address_field
     ) is distinct from
       '0x' || pg_catalog.encode(p_deployed_source_address, 'hex')
     or pg_catalog.octet_length(p_runtime_code_hash) <> 32
     or p_runtime_code_hash <> code_evidence.agreed_runtime_code_hash
     or p_abi_event_set_commitment <> template.abi_event_set_commitment
     or pg_catalog.octet_length(p_attestation_commitment) <> 32
  then
    raise exception using errcode = '23514', message = 'dynamic source attestation does not match factory event and template';
  end if;
  deployment_block := p_deployment_block_number::bigint;
  select * into existing
  from programmable_private.dynamic_source_attestations
  where epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation
    and deployed_source_address = p_deployed_source_address
    and deployed_source_role = template.deployed_source_role;
  if found then
    if existing.dynamic_source_attestation_id <> p_dynamic_source_attestation_id
       or existing.dynamic_source_template_id <> p_dynamic_source_template_id
       or existing.runtime_code_evidence_id <> p_runtime_code_evidence_id
       or existing.parent_factory_occurrence_id <> p_parent_factory_occurrence_id
       or existing.parent_factory_release_binding_id <> parent_binding.binding_id
       or existing.deployed_artifact_creation_code_commitment
         <> p_deployed_artifact_creation_code_commitment
       or existing.expected_immutable_values_commitment
         <> p_expected_immutable_values_commitment
       or existing.factory_configuration_commitment
         <> p_factory_configuration_commitment
       or existing.constructor_arguments_commitment
         <> p_constructor_arguments_commitment
       or existing.local_init_code_hash <> p_local_init_code_hash
       or existing.runtime_code_hash <> p_runtime_code_hash
       or existing.abi_event_set_commitment <> p_abi_event_set_commitment
       or existing.encoding_version <> p_encoding_version
       or existing.canonical_preimage <> p_canonical_preimage
       or existing.content_fingerprint <> p_content_fingerprint
       or existing.attestation_commitment <> p_attestation_commitment
    then
      raise exception using errcode = '23505', message = 'dynamic source replay conflict';
    end if;
    return existing.dynamic_source_attestation_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'dynamic_source_attestation.append', p_attestation_commitment,
    p_run_id, p_created_at
  );
  insert into programmable_private.dynamic_source_attestations (
    dynamic_source_attestation_id, chain_id, release_id, model_id,
    source_group, epoch_id, pointer_generation, dynamic_source_template_id,
    runtime_code_evidence_id,
    parent_factory_occurrence_id, parent_factory_release_binding_id,
    parent_factory_binding_commitment, deployed_source_address,
    deployed_source_role, deployment_block_number,
    deployed_artifact_creation_code_commitment,
    expected_immutable_values_commitment,
    factory_configuration_commitment,
    constructor_arguments_commitment, local_init_code_hash, runtime_code_hash,
    abi_event_set_commitment, encoding_version, canonical_preimage,
    content_fingerprint, attestation_commitment, verification_run_id,
    created_at, created_by_audit_id
  ) values (
    p_dynamic_source_attestation_id, header.chain_id, header.release_id,
    header.model_id, header.source_group, header.epoch_id,
    header.captured_pointer_generation, p_dynamic_source_template_id,
    p_runtime_code_evidence_id,
    parent.occurrence_id, parent_binding.binding_id,
    parent_binding.binding_commitment,
    p_deployed_source_address::programmable_private.eth_address,
    template.deployed_source_role,
    deployment_block::programmable_private.block_number_value,
    p_deployed_artifact_creation_code_commitment::programmable_private.bytes32_value,
    p_expected_immutable_values_commitment::programmable_private.bytes32_value,
    p_factory_configuration_commitment::programmable_private.bytes32_value,
    p_constructor_arguments_commitment::programmable_private.bytes32_value,
    p_local_init_code_hash::programmable_private.bytes32_value,
    p_runtime_code_hash::programmable_private.bytes32_value,
    p_abi_event_set_commitment::programmable_private.bytes32_value,
    p_encoding_version, p_canonical_preimage,
    p_content_fingerprint::programmable_private.bytes32_value,
    p_attestation_commitment::programmable_private.bytes32_value,
    p_run_id, p_created_at, audit_id
  );
  return p_dynamic_source_attestation_id;
end
$function$;

create function programmable_private.append_release_neutral_envio_candidate(
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
  p_first_seen_at timestamptz default pg_catalog.clock_timestamp(),
  p_stream_id text default 'canonical-events',
  p_contract_name text default 'unclassified'
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  existing programmable_private.envio_candidate_inbox%rowtype;
  normalized_block bigint;
  normalized_tx_index bigint;
  normalized_log_index bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'ingestion';
  if not found then
    raise exception using errcode = '23503', message = 'invalid neutral ingestion run';
  end if;
  if header.chain_id <> 1
     or header.release_id <> 'envio-control'
     or header.model_id <> 'envio-control'
     or header.source_group <> 'canonical-events'
     or header.epoch_id <> '70000000-0000-0000-0000-000000000002'
     or header.captured_pointer_generation <> 1
  then
    raise exception using
      errcode = '23514',
      message = 'neutral Envio inbox requires the dedicated control scope';
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
  if not exists (
    select 1 from programmable_private.provider_deployments
    where provider_deployment_id = p_provider_deployment_id
      and provider_type = 'envio_deployment'
  )
     or p_block_number <> pg_catalog.trunc(p_block_number)
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
     or p_stream_id is null
     or pg_catalog.octet_length(p_stream_id) not between 1 and 128
     or p_stream_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or p_contract_name is null
     or pg_catalog.octet_length(p_contract_name) not between 1 and 128
     or p_contract_name !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or p_candidate_id is distinct from
       programmable_private.derive_envio_candidate_id(
         header.chain_id, p_block_hash, p_transaction_hash,
         p_block_global_log_index
       )::text
     or p_provider_cursor is distinct from p_candidate_id
  then
    raise exception using errcode = '22023', message = 'invalid neutral Envio candidate';
  end if;
  normalized_block := p_block_number::bigint;
  normalized_tx_index := p_transaction_index::bigint;
  normalized_log_index := p_block_global_log_index::bigint;
  select * into existing
  from programmable_private.envio_candidate_inbox
  where candidate_id = p_candidate_id;
  if found then
    if existing.chain_id <> header.chain_id
       or existing.stream_id <> p_stream_id
       or existing.block_number <> normalized_block
       or existing.block_hash <> p_block_hash
       or existing.transaction_hash <> p_transaction_hash
       or existing.transaction_index <> normalized_tx_index
       or existing.block_global_log_index <> normalized_log_index
       or existing.source_address <> p_source_address
       or existing.contract_name <> p_contract_name
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
      raise exception using errcode = '23505', message = 'neutral candidate replay changed immutable content';
    end if;
    return existing.candidate_id;
  end if;
  insert into programmable_private.envio_candidate_inbox (
    candidate_id, chain_id, stream_id, block_number, block_hash,
    transaction_hash,
    transaction_index, block_global_log_index, source_address,
    contract_name, event_signature, event_type, ordered_topics, raw_data,
    decoded_payload,
    payload_hash, provider_cursor, provider_deployment_id, first_seen_run_id,
    first_seen_at, content_commitment
  ) values (
    p_candidate_id::programmable_private.envio_candidate_identifier,
    header.chain_id, p_stream_id::programmable_private.source_identifier,
    normalized_block::programmable_private.block_number_value,
    p_block_hash::programmable_private.bytes32_value,
    p_transaction_hash::programmable_private.bytes32_value,
    normalized_tx_index::programmable_private.transaction_index_value,
    normalized_log_index::programmable_private.block_log_index_value,
    p_source_address::programmable_private.eth_address,
    p_contract_name::programmable_private.source_identifier,
    p_event_signature::programmable_private.bytes32_value,
    p_event_type::programmable_private.source_identifier,
    p_ordered_topics, p_raw_data, p_decoded_payload,
    p_payload_hash::programmable_private.bytes32_value,
    p_provider_cursor::programmable_private.envio_candidate_identifier,
    p_provider_deployment_id, p_run_id, p_first_seen_at,
    p_content_commitment::programmable_private.bytes32_value
  );
  perform programmable_private.append_mutation_audit(
    'neutral_candidate.append', p_content_commitment, p_run_id, p_first_seen_at
  );
  return p_candidate_id;
end
$function$;

create function programmable_private.get_envio_ingestion_cursor_v1(
  p_chain_id bigint,
  p_provider_deployment_id uuid,
  p_stream_id text
)
returns table (
  generation bigint,
  block_number bigint,
  block_hash bytea,
  block_global_log_index bigint,
  candidate_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_chain_id <> 1
     or p_stream_id is null
     or pg_catalog.octet_length(p_stream_id) not between 1 and 128
     or p_stream_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or not exists (
       select 1 from programmable_private.provider_deployments
       where provider_deployment_id = p_provider_deployment_id
         and provider_type = 'envio_deployment'
     )
  then
    raise exception using errcode = '22023', message = 'invalid Envio cursor scope';
  end if;
  return query
  select current_cursor.generation,
         current_cursor.block_number::bigint,
         current_cursor.block_hash::bytea,
         current_cursor.block_global_log_index::bigint,
         current_cursor.candidate_id::text
  from programmable_private.envio_ingestion_cursor_current as current_cursor
  where current_cursor.chain_id = p_chain_id
    and current_cursor.provider_deployment_id = p_provider_deployment_id
    and current_cursor.stream_id = p_stream_id;
  if not found then
    return query select 0::bigint, null::bigint, null::bytea,
      null::bigint, null::text;
  end if;
end
$function$;

create function programmable_private.advance_envio_ingestion_cursor_v1(
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
  if not found then
    raise exception using
      errcode = '23514',
      message = 'Envio cursor does not match its durable final inbox row';
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
       and (normalized_block, normalized_log_index, p_candidate_id)
         <= (
           current_cursor.block_number::bigint,
           current_cursor.block_global_log_index::bigint,
           current_cursor.candidate_id::text
         )
     )
  then
    raise exception using errcode = '40001', message = 'Envio cursor CAS lost or did not advance';
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'envio_cursor.advance', p_page_commitment, p_run_id, p_changed_at
  );
  insert into programmable_private.envio_ingestion_cursor_history (
    cursor_history_id, chain_id, provider_deployment_id, stream_id,
    generation, block_number, block_hash, block_global_log_index,
    candidate_id, content_commitment, changed_by_run_id, changed_at,
    audit_id, is_rewind, rewound_from_generation
  ) values (
    history_id, 1, p_provider_deployment_id,
    p_stream_id::programmable_private.source_identifier, p_next_generation,
    normalized_block::programmable_private.block_number_value,
    p_block_hash::programmable_private.bytes32_value,
    normalized_log_index::programmable_private.block_log_index_value,
    p_candidate_id::programmable_private.envio_candidate_identifier,
    p_page_commitment::programmable_private.bytes32_value,
    p_run_id, p_changed_at, created_audit_id, false, null
  );
  if p_expected_generation = 0 then
    insert into programmable_private.envio_ingestion_cursor_current (
      chain_id, provider_deployment_id, stream_id, generation, block_number,
      block_hash, block_global_log_index, candidate_id, content_commitment,
      changed_by_run_id, changed_at, audit_id, cursor_history_id
    ) values (
      1, p_provider_deployment_id,
      p_stream_id::programmable_private.source_identifier, p_next_generation,
      normalized_block::programmable_private.block_number_value,
      p_block_hash::programmable_private.bytes32_value,
      normalized_log_index::programmable_private.block_log_index_value,
      p_candidate_id::programmable_private.envio_candidate_identifier,
      p_page_commitment::programmable_private.bytes32_value,
      p_run_id, p_changed_at, created_audit_id, history_id
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
        cursor_history_id = history_id
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

create function programmable_private.list_envio_ingestion_cursor_ancestors_v1(
  p_chain_id bigint,
  p_provider_deployment_id uuid,
  p_stream_id text,
  p_limit integer
)
returns table (
  generation bigint,
  block_number bigint,
  block_hash bytea,
  block_global_log_index bigint,
  candidate_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_chain_id <> 1 or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'invalid Envio ancestor request';
  end if;
  return query
  select history.generation, history.block_number::bigint,
         history.block_hash::bytea,
         history.block_global_log_index::bigint, history.candidate_id::text
  from programmable_private.envio_ingestion_cursor_history as history
  where history.chain_id = p_chain_id
    and history.provider_deployment_id = p_provider_deployment_id
    and history.stream_id = p_stream_id
  order by history.generation desc
  limit p_limit;
end
$function$;

create function programmable_private.rewind_envio_ingestion_cursor_v1(
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
     or p_target_history_generation < 1
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
  select * into target_cursor
  from programmable_private.envio_ingestion_cursor_history
  where chain_id = 1
    and provider_deployment_id = p_provider_deployment_id
    and stream_id = p_stream_id
    and generation = p_target_history_generation;
  if current_cursor.generation is null
     or current_cursor.generation <> p_expected_generation
     or target_cursor.cursor_history_id is null
     or not exists (
       select 1 from programmable_private.dual_rpc_block_evidence
       where verification_run_id = p_run_id
         and block_number = target_cursor.block_number
         and agreed_block_hash = target_cursor.block_hash
     )
  then
    raise exception using
      errcode = '40001',
      message = 'Envio rewind target is stale or lacks dual-RPC evidence';
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'envio_cursor.rewind', p_reason_commitment, p_run_id, p_changed_at
  );
  insert into programmable_private.envio_ingestion_cursor_history (
    cursor_history_id, chain_id, provider_deployment_id, stream_id,
    generation, block_number, block_hash, block_global_log_index,
    candidate_id, content_commitment, changed_by_run_id, changed_at,
    audit_id, is_rewind, rewound_from_generation
  ) values (
    history_id, 1, p_provider_deployment_id, target_cursor.stream_id,
    p_next_generation, target_cursor.block_number, target_cursor.block_hash,
    target_cursor.block_global_log_index, target_cursor.candidate_id,
    p_reason_commitment::programmable_private.bytes32_value,
    p_run_id, p_changed_at, created_audit_id, true, p_expected_generation
  );
  update programmable_private.envio_ingestion_cursor_current
  set generation = p_next_generation,
      block_number = target_cursor.block_number,
      block_hash = target_cursor.block_hash,
      block_global_log_index = target_cursor.block_global_log_index,
      candidate_id = target_cursor.candidate_id,
      content_commitment = p_reason_commitment,
      changed_by_run_id = p_run_id,
      changed_at = p_changed_at,
      audit_id = created_audit_id,
      cursor_history_id = history_id
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

create function programmable_private.list_projector_candidate_page_v1(
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
  source_address bytea,
  contract_name text,
  event_signature bytea,
  event_type text,
  ordered_topics bytea[],
  raw_data bytea,
  decoded_payload jsonb,
  payload_hash bytea,
  provider_cursor text,
  provider_deployment_id uuid,
  content_commitment bytea,
  status text,
  attempt_count bigint,
  next_attempt_at timestamptz
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
     or (
       (p_after_block_number is null)
       <> (p_after_block_global_log_index is null)
     )
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
    raise exception using errcode = '40001', message = 'invalid or stale candidate-page lease';
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
      raise exception using errcode = '22023', message = 'invalid candidate-page cursor';
    end if;
    normalized_after_block := p_after_block_number::bigint;
    normalized_after_log_index := p_after_block_global_log_index::bigint;
  end if;
  return query
  select candidate.candidate_id::text,
         candidate.block_number::bigint, candidate.block_hash::bytea,
         candidate.transaction_hash::bytea,
         candidate.transaction_index::bigint,
         candidate.block_global_log_index::bigint,
         candidate.source_address::bytea, candidate.contract_name::text,
         candidate.event_signature::bytea, candidate.event_type::text,
         candidate.ordered_topics, candidate.raw_data,
         candidate.decoded_payload, candidate.payload_hash::bytea,
         candidate.provider_cursor::text, candidate.provider_deployment_id,
         candidate.content_commitment::bytea,
         coalesce(current_status.status::text, 'pending'),
         coalesce(current_status.attempt_count, 0::bigint),
         current_status.next_attempt_at
  from programmable_private.envio_candidate_inbox as candidate
  left join programmable_private.envio_candidate_status_current as current_status
    on current_status.candidate_id = candidate.candidate_id
   and current_status.epoch_id = p_epoch_id
   and current_status.pointer_generation = p_pointer_generation
  where candidate.chain_id = p_chain_id
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
    and coalesce(current_status.status::text, 'pending')
      not in ('resolved', 'ignored', 'quarantined')
    and (
      current_status.status is distinct from 'deferred'
      or current_status.next_attempt_at <= p_now
    )
  order by candidate.block_number, candidate.block_global_log_index,
           candidate.candidate_id
  limit p_limit;
end
$function$;

create function programmable_private.defer_envio_candidate_v1(
  p_decision_id uuid,
  p_run_id uuid,
  p_candidate_id text,
  p_expected_attempt bigint,
  p_next_attempt bigint,
  p_next_attempt_at timestamptz,
  p_reason_code text,
  p_reason_commitment bytea,
  p_changed_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  existing programmable_private.envio_candidate_status_history%rowtype;
  current_status programmable_private.envio_candidate_status_current%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind in ('ingestion', 'projection');
  if not found then
    raise exception using errcode = '23503', message = 'invalid candidate deferral run';
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
  select * into existing
  from programmable_private.envio_candidate_status_history
  where decision_id = p_decision_id;
  if found then
    if existing.candidate_id <> p_candidate_id
       or existing.epoch_id <> header.epoch_id
       or existing.pointer_generation <> header.captured_pointer_generation
       or existing.status <> 'deferred'
       or existing.attempt_count <> p_next_attempt
       or existing.next_attempt_at <> p_next_attempt_at
       or existing.reason_code <> p_reason_code
       or existing.reason_commitment <> p_reason_commitment
       or existing.changed_by_run_id <> p_run_id
       or existing.changed_at <> p_changed_at
    then
      raise exception using errcode = '23505', message = 'candidate deferral replay conflict';
    end if;
    return existing.decision_id;
  end if;
  if p_expected_attempt < 0 or p_next_attempt <> p_expected_attempt + 1
     or p_next_attempt_at <= p_changed_at
     or p_reason_code is null
     or pg_catalog.octet_length(p_reason_commitment) <> 32
     or not exists (
       select 1 from programmable_private.envio_candidate_inbox
       where candidate_id = p_candidate_id and chain_id = header.chain_id
     )
  then
    raise exception using errcode = '22023', message = 'invalid candidate deferral';
  end if;
  select * into current_status
  from programmable_private.envio_candidate_status_current
  where candidate_id = p_candidate_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation
  for update;
  if (current_status.candidate_id is null and p_expected_attempt <> 0)
     or (current_status.candidate_id is not null and (
       current_status.attempt_count <> p_expected_attempt
       or current_status.status in ('resolved', 'ignored', 'quarantined')
     ))
  then
    raise exception using errcode = '40001', message = 'candidate attempt CAS lost';
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'neutral_candidate.defer', p_reason_commitment, p_run_id, p_changed_at
  );
  insert into programmable_private.envio_candidate_status_history (
    decision_id, candidate_id, chain_id, release_id, model_id, source_group,
    epoch_id, pointer_generation, status, attempt_count, next_attempt_at,
    reason_code, reason_commitment, changed_by_run_id, changed_at, audit_id
  ) values (
    p_decision_id,
    p_candidate_id::programmable_private.envio_candidate_identifier,
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation, 'deferred',
    p_next_attempt, p_next_attempt_at,
    p_reason_code::programmable_private.source_identifier,
    p_reason_commitment::programmable_private.bytes32_value,
    p_run_id, p_changed_at, created_audit_id
  );
  insert into programmable_private.envio_candidate_status_current (
    candidate_id, chain_id, release_id, model_id, source_group, epoch_id,
    pointer_generation, status, attempt_count, next_attempt_at, reason_code,
    reason_commitment, changed_by_run_id, changed_at, decision_id
  ) values (
    p_candidate_id::programmable_private.envio_candidate_identifier,
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation, 'deferred',
    p_next_attempt, p_next_attempt_at,
    p_reason_code::programmable_private.source_identifier,
    p_reason_commitment::programmable_private.bytes32_value,
    p_run_id, p_changed_at, p_decision_id
  ) on conflict (candidate_id, epoch_id, pointer_generation) do update
    set status = excluded.status,
        attempt_count = excluded.attempt_count,
        next_attempt_at = excluded.next_attempt_at,
        reason_code = excluded.reason_code,
        reason_commitment = excluded.reason_commitment,
        changed_by_run_id = excluded.changed_by_run_id,
        changed_at = excluded.changed_at,
        decision_id = excluded.decision_id
    where programmable_private.envio_candidate_status_current.attempt_count
      = p_expected_attempt
      and programmable_private.envio_candidate_status_current.status
        not in ('resolved', 'ignored', 'quarantined');
  if not found then
    raise exception using errcode = '40001', message = 'candidate deferral CAS lost';
  end if;
  return p_decision_id;
end
$function$;

create function programmable_private.append_envio_terminal_disposition(
  p_decision_id uuid,
  p_run_id uuid,
  p_candidate_id text,
  p_expected_attempt bigint,
  p_status text,
  p_reason_code text,
  p_reason_commitment bytea,
  p_changed_at timestamptz
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  existing programmable_private.envio_candidate_status_history%rowtype;
  current_status programmable_private.envio_candidate_status_current%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind in ('ingestion', 'projection');
  if not found then
    raise exception using errcode = '23503', message = 'invalid candidate disposition run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if p_status not in ('ignored', 'quarantined')
     or p_expected_attempt < 0
     or p_reason_code is null
     or pg_catalog.octet_length(p_reason_commitment) <> 32
     or exists (
       select 1 from programmable_private.run_lifecycle_outcomes
       where run_id = p_run_id
     )
     or not exists (
       select 1 from programmable_private.envio_candidate_inbox
       where candidate_id = p_candidate_id and chain_id = header.chain_id
     )
  then
    raise exception using errcode = '22023', message = 'invalid terminal candidate disposition';
  end if;
  select * into existing
  from programmable_private.envio_candidate_status_history
  where decision_id = p_decision_id;
  if found then
    if existing.candidate_id <> p_candidate_id
       or existing.epoch_id <> header.epoch_id
       or existing.pointer_generation <> header.captured_pointer_generation
       or existing.status::text <> p_status
       or existing.attempt_count <> p_expected_attempt
       or existing.reason_code <> p_reason_code
       or existing.reason_commitment <> p_reason_commitment
       or existing.changed_by_run_id <> p_run_id
       or existing.changed_at <> p_changed_at
    then
      raise exception using errcode = '23505', message = 'terminal disposition replay conflict';
    end if;
    return existing.decision_id;
  end if;
  select * into current_status
  from programmable_private.envio_candidate_status_current
  where candidate_id = p_candidate_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation
  for update;
  if (current_status.candidate_id is null and p_expected_attempt <> 0)
     or (current_status.candidate_id is not null and (
       current_status.attempt_count <> p_expected_attempt
       or current_status.status in ('resolved', 'ignored', 'quarantined')
     ))
  then
    raise exception using errcode = '40001', message = 'terminal disposition CAS lost';
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'neutral_candidate.' || p_status,
    p_reason_commitment, p_run_id, p_changed_at
  );
  insert into programmable_private.envio_candidate_status_history (
    decision_id, candidate_id, chain_id, release_id, model_id, source_group,
    epoch_id, pointer_generation, status, attempt_count, next_attempt_at,
    reason_code, reason_commitment, changed_by_run_id, changed_at, audit_id
  ) values (
    p_decision_id,
    p_candidate_id::programmable_private.envio_candidate_identifier,
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation,
    p_status::programmable_private.envio_candidate_status,
    p_expected_attempt, null,
    p_reason_code::programmable_private.source_identifier,
    p_reason_commitment::programmable_private.bytes32_value,
    p_run_id, p_changed_at, created_audit_id
  );
  insert into programmable_private.envio_candidate_status_current (
    candidate_id, chain_id, release_id, model_id, source_group, epoch_id,
    pointer_generation, status, attempt_count, next_attempt_at, reason_code,
    reason_commitment, changed_by_run_id, changed_at, decision_id
  ) values (
    p_candidate_id::programmable_private.envio_candidate_identifier,
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation,
    p_status::programmable_private.envio_candidate_status,
    p_expected_attempt, null,
    p_reason_code::programmable_private.source_identifier,
    p_reason_commitment::programmable_private.bytes32_value,
    p_run_id, p_changed_at, p_decision_id
  ) on conflict (candidate_id, epoch_id, pointer_generation) do update
    set status = excluded.status,
        next_attempt_at = null,
        reason_code = excluded.reason_code,
        reason_commitment = excluded.reason_commitment,
        changed_by_run_id = excluded.changed_by_run_id,
        changed_at = excluded.changed_at,
        decision_id = excluded.decision_id
    where programmable_private.envio_candidate_status_current.attempt_count
      = p_expected_attempt
      and programmable_private.envio_candidate_status_current.status
        not in ('resolved', 'ignored', 'quarantined');
  if not found then
    raise exception using errcode = '40001', message = 'terminal disposition CAS lost';
  end if;
  return p_decision_id;
end
$function$;

create function programmable_private.ignore_envio_candidate_v1(
  p_decision_id uuid,
  p_run_id uuid,
  p_candidate_id text,
  p_expected_attempt bigint,
  p_reason_code text,
  p_reason_commitment bytea,
  p_changed_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $function$
  select programmable_private.append_envio_terminal_disposition(
    p_decision_id, p_run_id, p_candidate_id, p_expected_attempt,
    'ignored', p_reason_code, p_reason_commitment, p_changed_at
  )
$function$;

create function programmable_private.quarantine_envio_candidate_v1(
  p_decision_id uuid,
  p_run_id uuid,
  p_candidate_id text,
  p_expected_attempt bigint,
  p_reason_code text,
  p_reason_commitment bytea,
  p_changed_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $function$
  select programmable_private.append_envio_terminal_disposition(
    p_decision_id, p_run_id, p_candidate_id, p_expected_attempt,
    'quarantined', p_reason_code, p_reason_commitment, p_changed_at
  )
$function$;

create function programmable_private.resolve_envio_candidate(
  p_candidate_resolution_id uuid,
  p_run_id uuid,
  p_candidate_id text,
  p_release_binding_id uuid,
  p_dynamic_source_attestation_id uuid,
  p_abi_event_set_commitment bytea,
  p_resolution_commitment bytea,
  p_resolved_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  candidate programmable_private.envio_candidate_inbox%rowtype;
  binding programmable_private.release_source_bindings%rowtype;
  dynamic_source programmable_private.dynamic_source_attestations%rowtype;
  existing programmable_private.envio_candidate_resolutions%rowtype;
  current_status programmable_private.envio_candidate_status_current%rowtype;
  resolved_attempt bigint;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind in ('ingestion', 'projection');
  if not found then
    raise exception using errcode = '23503', message = 'invalid candidate resolution run';
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
  select * into candidate from programmable_private.envio_candidate_inbox
  where candidate_id = p_candidate_id;
  if not found or candidate.chain_id <> header.chain_id then
    raise exception using errcode = '23503', message = 'neutral candidate chain mismatch';
  end if;
  if (p_release_binding_id is null) = (p_dynamic_source_attestation_id is null)
     or pg_catalog.octet_length(p_abi_event_set_commitment) <> 32
     or pg_catalog.octet_length(p_resolution_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'resolution requires exactly one source provenance';
  end if;
  if p_release_binding_id is not null then
    select * into binding from programmable_private.release_source_bindings
    where binding_id = p_release_binding_id
      and epoch_id = header.epoch_id
      and source_type = 'ethereum_contract'
      and source_address = candidate.source_address
      and inclusive_start_block <= candidate.block_number
      and abi_event_set_commitment = p_abi_event_set_commitment;
    if not found then
      raise exception using errcode = '23514', message = 'candidate does not match exact release binding';
    end if;
  else
    select * into dynamic_source
    from programmable_private.dynamic_source_attestations as attestation
    where attestation.dynamic_source_attestation_id = p_dynamic_source_attestation_id
      and attestation.chain_id = header.chain_id
      and attestation.release_id = header.release_id
      and attestation.model_id = header.model_id
      and attestation.source_group = header.source_group
      and attestation.epoch_id = header.epoch_id
      and attestation.pointer_generation = header.captured_pointer_generation
      and attestation.deployed_source_address = candidate.source_address
      and attestation.deployment_block_number <= candidate.block_number
      and attestation.abi_event_set_commitment = p_abi_event_set_commitment
      and exists (
        select 1
        from programmable_private.chain_event_current_canonical as canonical
        where canonical.occurrence_id = attestation.parent_factory_occurrence_id
      );
    if not found then
      raise exception using errcode = '23514', message = 'candidate does not match current dynamic source attestation';
    end if;
  end if;
  select * into existing
  from programmable_private.envio_candidate_resolutions
  where candidate_id = p_candidate_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  if found then
    if existing.candidate_resolution_id <> p_candidate_resolution_id
       or existing.release_binding_id is distinct from p_release_binding_id
       or existing.dynamic_source_attestation_id
         is distinct from p_dynamic_source_attestation_id
       or existing.abi_event_set_commitment <> p_abi_event_set_commitment
       or existing.resolution_commitment <> p_resolution_commitment
       or existing.resolved_by_run_id <> p_run_id
       or existing.resolved_at <> p_resolved_at
       or not exists (
         select 1
         from programmable_private.envio_candidate_status_current as status
         where status.candidate_id = p_candidate_id
           and status.epoch_id = header.epoch_id
           and status.pointer_generation = header.captured_pointer_generation
           and status.status = 'resolved'
           and status.decision_id = p_candidate_resolution_id
       )
    then
      raise exception using errcode = '23505', message = 'candidate resolution replay conflict';
    end if;
    return existing.candidate_resolution_id;
  end if;
  select * into current_status
  from programmable_private.envio_candidate_status_current
  where candidate_id = p_candidate_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation
  for update;
  if current_status.status in ('resolved', 'ignored', 'quarantined') then
    raise exception using
      errcode = '40001',
      message = 'terminal candidate disposition cannot be resolved';
  end if;
  resolved_attempt := coalesce(current_status.attempt_count, 0::bigint);
  audit_id := programmable_private.append_mutation_audit(
    'neutral_candidate.resolve', p_resolution_commitment, p_run_id, p_resolved_at
  );
  insert into programmable_private.envio_candidate_resolutions (
    candidate_resolution_id, candidate_id, chain_id, release_id, model_id,
    source_group, epoch_id, pointer_generation, release_binding_id,
    dynamic_source_attestation_id, abi_event_set_commitment,
    resolution_commitment, resolved_by_run_id, resolved_at,
    created_by_audit_id
  ) values (
    p_candidate_resolution_id, p_candidate_id, header.chain_id,
    header.release_id, header.model_id, header.source_group, header.epoch_id,
    header.captured_pointer_generation, p_release_binding_id,
    p_dynamic_source_attestation_id,
    p_abi_event_set_commitment::programmable_private.bytes32_value,
    p_resolution_commitment::programmable_private.bytes32_value,
    p_run_id, p_resolved_at, audit_id
  );
  insert into programmable_private.envio_candidate_status_history (
    decision_id, candidate_id, chain_id, release_id, model_id, source_group,
    epoch_id, pointer_generation, status, attempt_count, next_attempt_at,
    reason_code, reason_commitment, changed_by_run_id, changed_at, audit_id
  ) values (
    p_candidate_resolution_id,
    p_candidate_id::programmable_private.envio_candidate_identifier,
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation, 'resolved',
    resolved_attempt, null, 'resolved',
    p_resolution_commitment::programmable_private.bytes32_value,
    p_run_id, p_resolved_at, audit_id
  );
  insert into programmable_private.envio_candidate_status_current (
    candidate_id, chain_id, release_id, model_id, source_group, epoch_id,
    pointer_generation, status, attempt_count, next_attempt_at, reason_code,
    reason_commitment, changed_by_run_id, changed_at, decision_id
  ) values (
    p_candidate_id::programmable_private.envio_candidate_identifier,
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation, 'resolved',
    resolved_attempt, null, 'resolved',
    p_resolution_commitment::programmable_private.bytes32_value,
    p_run_id, p_resolved_at, p_candidate_resolution_id
  ) on conflict (candidate_id, epoch_id, pointer_generation) do update
    set status = excluded.status,
        next_attempt_at = null,
        reason_code = excluded.reason_code,
        reason_commitment = excluded.reason_commitment,
        changed_by_run_id = excluded.changed_by_run_id,
        changed_at = excluded.changed_at,
        decision_id = excluded.decision_id
    where programmable_private.envio_candidate_status_current.attempt_count
      = resolved_attempt
      and programmable_private.envio_candidate_status_current.status
        not in ('resolved', 'ignored', 'quarantined');
  if not found then
    raise exception using errcode = '40001', message = 'candidate resolve CAS lost';
  end if;
  return p_candidate_resolution_id;
end
$function$;

create function programmable_private.append_chain_event_occurrence(
  p_logical_event_id uuid,
  p_occurrence_id uuid,
  p_run_id uuid,
  p_candidate_id text,
  p_candidate_resolution_id uuid,
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
  candidate programmable_private.envio_candidate_inbox%rowtype;
  resolution programmable_private.envio_candidate_resolutions%rowtype;
  evidence programmable_private.dual_rpc_block_evidence%rowtype;
  identity programmable_private.chain_event_identities%rowtype;
  existing programmable_private.chain_event_occurrences%rowtype;
  materialization programmable_private.chain_event_occurrence_materializations%rowtype;
  dynamic_source programmable_private.dynamic_source_attestations%rowtype;
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
  where run_id = p_run_id and run_kind in ('ingestion', 'projection');
  if not found then
    raise exception using errcode = '23503', message = 'invalid neutral verification run';
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
  from programmable_private.envio_candidate_inbox
  where candidate_id = p_candidate_id;
  select * into resolution
  from programmable_private.envio_candidate_resolutions
  where candidate_resolution_id = p_candidate_resolution_id
    and candidate_id = p_candidate_id
    and chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation
    and abi_event_set_commitment = p_abi_event_set_commitment;
  if candidate.candidate_id is null or resolution.candidate_resolution_id is null then
    raise exception using errcode = '23503', message = 'candidate has no exact current-scope resolution';
  end if;
  if resolution.dynamic_source_attestation_id is not null then
    select * into dynamic_source
    from programmable_private.dynamic_source_attestations
    where dynamic_source_attestation_id = resolution.dynamic_source_attestation_id;
    if not found
       or dynamic_source.deployed_source_address <> candidate.source_address
       or dynamic_source.deployment_block_number > candidate.block_number
       or dynamic_source.abi_event_set_commitment <> p_abi_event_set_commitment
       or not exists (
         select 1 from programmable_private.chain_event_current_canonical
         where occurrence_id = dynamic_source.parent_factory_occurrence_id
       )
    then
      raise exception using errcode = '23514', message = 'dynamic occurrence lost factory provenance';
    end if;
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
    ) values (
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
      raise exception using errcode = '23505', message = 'neutral raw occurrence replay changed immutable chain data';
    end if;
  else
    insert into programmable_private.chain_event_occurrences (
      occurrence_id, logical_event_id, chain_id, transaction_hash,
      receipt_log_ordinal, block_number, block_hash, block_timestamp,
      transaction_index, source_address, block_global_log_index,
      event_signature, event_type, ordered_topics, raw_data, decoded_payload,
      payload_hash, decoder_version, abi_event_set_commitment,
      release_binding_id, dynamic_source_attestation_id, release_id, model_id,
      epoch_id, pointer_generation, first_seen_envio_candidate_id,
      first_seen_neutral_candidate_id, candidate_resolution_id,
      first_seen_provider_cursor, verification_run_id, block_evidence_id,
      encoding_version, canonical_preimage, content_fingerprint, verified_at
    ) values (
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
      resolution.release_binding_id, resolution.dynamic_source_attestation_id,
      header.release_id, header.model_id, header.epoch_id,
      header.captured_pointer_generation, null, p_candidate_id,
      p_candidate_resolution_id, candidate.provider_cursor, p_run_id,
      p_block_evidence_id, p_encoding_version, p_canonical_preimage,
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
       or materialization.release_binding_id
         is distinct from resolution.release_binding_id
       or materialization.dynamic_source_attestation_id
         is distinct from resolution.dynamic_source_attestation_id
       or materialization.first_seen_envio_candidate_id is not null
       or materialization.first_seen_neutral_candidate_id <> p_candidate_id
       or materialization.candidate_resolution_id <> p_candidate_resolution_id
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
      raise exception using errcode = '23505', message = 'neutral occurrence materialization replay changed exact scope';
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
    p_candidate_resolution_id, p_occurrence_id, header.chain_id,
    header.release_id, header.model_id, header.source_group, header.epoch_id,
    header.captured_pointer_generation, resolution.release_binding_id,
    resolution.dynamic_source_attestation_id, null, p_candidate_id,
    p_candidate_resolution_id,
    p_decoder_version::programmable_private.projector_identifier,
    candidate.event_type,
    p_abi_event_set_commitment::programmable_private.bytes32_value,
    candidate.decoded_payload, candidate.payload_hash, candidate.provider_cursor,
    p_run_id, p_block_evidence_id, p_encoding_version, p_canonical_preimage,
    p_content_fingerprint::programmable_private.bytes32_value, p_verified_at
  );
  audit_id := programmable_private.append_mutation_audit(
    case when occurrence_inserted then 'occurrence.append.resolved'
      else 'occurrence.materialize.resolved' end,
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
  ) values (
    status_id, p_occurrence_id, p_logical_event_id, candidate.block_hash,
    'observed', evidence.observation_id, p_block_evidence_id, p_run_id,
    p_content_fingerprint::programmable_private.bytes32_value,
    p_verified_at, audit_id
  );
  return p_occurrence_id;
end
$function$;

create function programmable_private.list_projector_checkpoint_ancestors_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_projector_version text,
  p_limit integer
)
returns table (
  checkpoint_id uuid,
  pointer_generation bigint,
  checkpoint_generation bigint,
  reorg_generation bigint,
  block_number bigint,
  block_hash bytea,
  cursor_global_log_index bigint,
  cursor_candidate_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_chain_id <= 0 or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'invalid checkpoint ancestor request';
  end if;
  return query
  select checkpoint.checkpoint_id, checkpoint.pointer_generation,
         checkpoint.checkpoint_generation, checkpoint.reorg_generation,
         checkpoint.block_number::bigint, checkpoint.block_hash::bytea,
         checkpoint.cursor_block_global_log_index::bigint,
         checkpoint.cursor_candidate_id::text
  from programmable_private.projector_checkpoints as checkpoint
  where checkpoint.chain_id = p_chain_id
    and checkpoint.release_id = p_release_id
    and checkpoint.model_id = p_model_id
    and checkpoint.source_group = p_source_group
    and checkpoint.projector_version = p_projector_version
  order by checkpoint.checkpoint_generation desc
  limit p_limit;
end
$function$;

create function programmable_private.assert_open_projection_run_v1(
  p_run_id uuid
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'projection';
  if not found or exists (
    select 1 from programmable_private.run_lifecycle_outcomes
    where run_id = p_run_id
  ) then
    raise exception using errcode = '55000', message = 'projection run is absent or terminal';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
end
$function$;

create function programmable_private.get_projector_launch_baseline_v1(
  p_run_id uuid,
  p_token bytea
)
returns table (
  launch_projection_id uuid,
  token bytea,
  creator bytea,
  launch_transaction_hash bytea,
  pool_id bytea,
  reward_vault bytea,
  launch_hash bytea,
  token_name text,
  token_symbol text,
  total_supply numeric,
  last_source_occurrence_id uuid,
  pool_projection_id uuid,
  currency0 bytea,
  currency1 bytea,
  pool_key_fee bigint,
  tick_spacing integer,
  hook bytea,
  pool_last_source_occurrence_id uuid,
  pool_fee_configuration_id uuid,
  buy_swap_fee_bps integer,
  sell_swap_fee_bps integer,
  buy_creator_fee_bps integer,
  sell_creator_fee_bps integer,
  launcher_fee_bps integer,
  transfer_tax_bps integer,
  lp_fee_pips bigint,
  disclosure_source_occurrence_id uuid,
  custody_projection_id uuid,
  custody_address bytea,
  custody_mode smallint,
  duration_days integer,
  cliff_days integer,
  custody_configuration_hash bytea,
  custody_source_occurrence_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
begin
  perform programmable_private.assert_open_projection_run_v1(p_run_id);
  if pg_catalog.octet_length(p_token) <> 20 then
    raise exception using errcode = '22023', message = 'invalid baseline token';
  end if;
  select * into header from programmable_private.run_headers
  where run_id = p_run_id;
  return query
  select launch.launch_projection_id, launch.token::bytea,
         launch.creator::bytea, launch.launch_transaction_hash::bytea,
         launch.pool_id::bytea, launch.reward_vault::bytea,
         launch.launch_hash::bytea, launch.token_name, launch.token_symbol,
         launch.total_supply::numeric, launch.last_source_occurrence_id,
         pool.pool_projection_id, pool.currency0::bytea, pool.currency1::bytea,
         pool.pool_key_fee, pool.tick_spacing, pool.hook::bytea,
         pool.last_source_occurrence_id,
         fee.pool_fee_configuration_id, fee.buy_swap_fee_bps::integer,
         fee.sell_swap_fee_bps::integer, fee.buy_creator_fee_bps::integer,
         fee.sell_creator_fee_bps::integer, fee.launcher_fee_bps::integer,
         fee.transfer_tax_bps::integer, fee.lp_fee_pips,
         fee.disclosure_source_occurrence_id,
         custody.custody_projection_id, custody.custody_address::bytea,
         custody.custody_mode, custody.duration_days, custody.cliff_days,
         custody.configuration_hash::bytea, custody.source_occurrence_id
  from programmable_private.current_launch_projections_v1 as launch
  join programmable_private.run_headers as launch_run
    on launch_run.run_id = launch.projection_run_id
  left join programmable_private.pool_projections as pool
    on pool.launch_projection_id = launch.launch_projection_id
   and pool.projection_run_id = launch.projection_run_id
  left join programmable_private.pool_fee_configurations as fee
    on fee.pool_projection_id = pool.pool_projection_id
   and fee.projection_run_id = launch.projection_run_id
  left join programmable_private.initial_buy_custody_projections as custody
    on custody.launch_projection_id = launch.launch_projection_id
   and custody.projection_run_id = launch.projection_run_id
  where launch.chain_id = header.chain_id
    and launch.release_id = header.release_id
    and launch.model_id = header.model_id
    and launch_run.source_group = header.source_group
    and launch.token = p_token;
end
$function$;

create function programmable_private.get_projector_pool_fee_total_v1(
  p_run_id uuid,
  p_pool_id bytea,
  p_quote_asset bytea
)
returns table (
  gross_total numeric,
  creator_fee_total numeric,
  launcher_fee_total numeric,
  last_source_occurrence_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
begin
  perform programmable_private.assert_open_projection_run_v1(p_run_id);
  if pg_catalog.octet_length(p_pool_id) <> 32
     or (p_quote_asset is not null and pg_catalog.octet_length(p_quote_asset) <> 20)
  then
    raise exception using errcode = '22023', message = 'invalid pool fold key';
  end if;
  select * into header from programmable_private.run_headers where run_id = p_run_id;
  return query
  select total.gross_total::numeric, total.creator_fee_total::numeric,
         total.launcher_fee_total::numeric, total.last_source_occurrence_id
  from programmable_private.current_pool_fee_totals_v1 as total
  join programmable_private.run_headers as total_run
    on total_run.run_id = total.projection_run_id
  where total.chain_id = header.chain_id
    and total.release_id = header.release_id
    and total.model_id = header.model_id
    and total_run.source_group = header.source_group
    and total.pool_id = p_pool_id
    and total.quote_asset is not distinct from p_quote_asset;
end
$function$;

create function programmable_private.get_projector_vault_baseline_v1(
  p_run_id uuid,
  p_vault bytea
)
returns table (
  reward_vault_projection_id uuid,
  launch_projection_id uuid,
  vault bytea,
  pool_id bytea,
  quote_asset bytea,
  configuration_hash bytea,
  current_allocation_fact_id uuid,
  last_source_occurrence_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
begin
  perform programmable_private.assert_open_projection_run_v1(p_run_id);
  if pg_catalog.octet_length(p_vault) <> 20 then
    raise exception using errcode = '22023', message = 'invalid vault fold key';
  end if;
  select * into header from programmable_private.run_headers where run_id = p_run_id;
  return query
  select vault.reward_vault_projection_id, vault.launch_projection_id,
         vault.vault::bytea, vault.pool_id::bytea, vault.quote_asset::bytea,
         vault.configuration_hash::bytea,
         vault.current_allocation_fact_id, vault.last_source_occurrence_id
  from programmable_private.current_reward_vault_projections_v1 as vault
  join programmable_private.run_headers as vault_run
    on vault_run.run_id = vault.projection_run_id
  where vault.chain_id = header.chain_id
    and vault.release_id = header.release_id
    and vault.model_id = header.model_id
    and vault_run.source_group = header.source_group
    and vault.vault = p_vault;
end
$function$;

create function programmable_private.list_projector_vault_allocations_v1(
  p_run_id uuid,
  p_vault bytea
)
returns table (
  reward_allocation_projection_id uuid,
  reward_vault_projection_id uuid,
  allocation_fact_id uuid,
  configuration_epoch bigint,
  allocation_index integer,
  beneficiary bytea,
  payout_address bytea,
  share_bps integer,
  effective_from_block bigint,
  effective_to_block bigint,
  last_source_occurrence_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
begin
  perform programmable_private.assert_open_projection_run_v1(p_run_id);
  if pg_catalog.octet_length(p_vault) <> 20 then
    raise exception using errcode = '22023', message = 'invalid vault allocation key';
  end if;
  select * into header from programmable_private.run_headers where run_id = p_run_id;
  return query
  select allocation.reward_allocation_projection_id,
         allocation.reward_vault_projection_id,
         allocation.allocation_fact_id, allocation.configuration_epoch,
         allocation.allocation_index, allocation.beneficiary::bytea,
         allocation.payout_address::bytea, allocation.share_bps::integer,
         allocation.effective_from_block::bigint,
         allocation.effective_to_block,
         allocation.last_source_occurrence_id
  from programmable_private.current_reward_vault_projections_v1 as vault
  join programmable_private.run_headers as vault_run
    on vault_run.run_id = vault.projection_run_id
  join programmable_private.reward_allocation_projections as allocation
    on allocation.reward_vault_projection_id = vault.reward_vault_projection_id
   and allocation.projection_run_id = vault.projection_run_id
  where vault.chain_id = header.chain_id
    and vault.release_id = header.release_id
    and vault.model_id = header.model_id
    and vault_run.source_group = header.source_group
    and vault.vault = p_vault
  order by allocation.configuration_epoch, allocation.allocation_index,
           allocation.beneficiary;
end
$function$;

create function programmable_private.get_projector_account_reward_balance_v1(
  p_run_id uuid,
  p_vault bytea,
  p_account bytea
)
returns table (
  claimable_accrued numeric,
  claimed_total numeric,
  last_source_occurrence_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
begin
  perform programmable_private.assert_open_projection_run_v1(p_run_id);
  if pg_catalog.octet_length(p_vault) <> 20
     or pg_catalog.octet_length(p_account) <> 20
  then
    raise exception using errcode = '22023', message = 'invalid account fold key';
  end if;
  select * into header from programmable_private.run_headers where run_id = p_run_id;
  return query
  select balance.claimable_accrued::numeric, balance.claimed_total::numeric,
         balance.last_source_occurrence_id
  from programmable_private.current_account_reward_balances_v1 as balance
  join programmable_private.run_headers as balance_run
    on balance_run.run_id = balance.projection_run_id
  where balance.chain_id = header.chain_id
    and balance.release_id = header.release_id
    and balance.model_id = header.model_id
    and balance_run.source_group = header.source_group
    and balance.vault = p_vault
    and balance.account = p_account;
end
$function$;

create function programmable_private.get_projector_runtime_state_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_projector_version text,
  p_provider_types text[],
  p_provider_redacted_identities text[],
  p_provider_deployment_commitments bytea[],
  p_provider_schema_commitments bytea[]
)
returns table (
  epoch_id uuid,
  pointer_generation bigint,
  provider_deployment_ids uuid[],
  provider_types text[],
  provider_redacted_identities text[],
  lease_generation bigint,
  lease_holder_id text,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  checkpoint_id uuid,
  checkpoint_generation bigint,
  reorg_generation bigint,
  checkpoint_block_number bigint,
  checkpoint_block_hash bytea,
  checkpoint_cursor_block_global_log_index bigint,
  checkpoint_cursor_candidate_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_epoch programmable_private.release_epoch_current%rowtype;
  current_lease programmable_private.projector_lease_current%rowtype;
  current_pointer programmable_private.projector_checkpoint_current%rowtype;
  checkpoint programmable_private.projector_checkpoints%rowtype;
  resolved_ids uuid[];
  resolved_types text[];
  resolved_identities text[];
  expected_count integer;
begin
  perform programmable_private.assert_caller('programmable_projector');
  expected_count := coalesce(pg_catalog.array_length(p_provider_types, 1), 0);
  if p_chain_id <= 0
     or expected_count < 1 or expected_count > 8
     or expected_count <> coalesce(
       pg_catalog.array_length(p_provider_redacted_identities, 1), 0
     )
     or expected_count <> coalesce(
       pg_catalog.array_length(p_provider_deployment_commitments, 1), 0
     )
     or expected_count <> coalesce(
       pg_catalog.array_length(p_provider_schema_commitments, 1), 0
     )
     or exists (
       select 1
       from pg_catalog.unnest(p_provider_types) as provider_type
       where provider_type not in (
         'rpc_provider', 'envio_deployment', 'uniswap_subgraph'
       )
     )
     or exists (
       select identity
       from pg_catalog.unnest(p_provider_redacted_identities) as identity
       group by identity having pg_catalog.count(*) <> 1
     )
  then
    raise exception using errcode = '22023', message = 'invalid exact provider set';
  end if;

  select * into current_epoch
  from programmable_private.release_epoch_current as pointer
  where pointer.chain_id = p_chain_id
    and pointer.release_id = p_release_id
    and pointer.model_id = p_model_id
    and pointer.source_group = p_source_group;
  if not found then
    raise exception using errcode = '23503', message = 'projector scope has no current epoch';
  end if;

  select
    pg_catalog.array_agg(provider.provider_deployment_id order by requested.ordinality),
    pg_catalog.array_agg(provider.provider_type::text order by requested.ordinality),
    pg_catalog.array_agg(provider.redacted_identity::text order by requested.ordinality)
  into resolved_ids, resolved_types, resolved_identities
  from pg_catalog.generate_series(1, expected_count) as requested(ordinality)
  join programmable_private.provider_deployments as provider
    on provider.provider_type::text = p_provider_types[requested.ordinality]
   and provider.redacted_identity =
     p_provider_redacted_identities[requested.ordinality]
   and provider.deployment_commitment =
     p_provider_deployment_commitments[requested.ordinality]
   and provider.schema_commitment =
     p_provider_schema_commitments[requested.ordinality];
  if coalesce(pg_catalog.array_length(resolved_ids, 1), 0) <> expected_count then
    raise exception using errcode = '23503', message = 'exact provider set is not registered';
  end if;

  select * into current_lease
  from programmable_private.projector_lease_current as lease
  where lease.chain_id = p_chain_id
    and lease.release_id = p_release_id
    and lease.model_id = p_model_id
    and lease.source_group = p_source_group
    and lease.projector_version = p_projector_version;

  select * into current_pointer
  from programmable_private.projector_checkpoint_current as pointer
  where pointer.chain_id = p_chain_id
    and pointer.release_id = p_release_id
    and pointer.model_id = p_model_id
    and pointer.source_group = p_source_group
    and pointer.projector_version = p_projector_version;
  if found then
    select * into checkpoint
    from programmable_private.projector_checkpoints as stored
    where stored.checkpoint_id = current_pointer.checkpoint_id;
    if not found then
      raise exception using errcode = '23503', message = 'current checkpoint identity is missing';
    end if;
  end if;

  return query select
    current_epoch.epoch_id,
    current_epoch.generation,
    resolved_ids,
    resolved_types,
    resolved_identities,
    coalesce(current_lease.lease_generation, 0::bigint),
    current_lease.holder_id::text,
    current_lease.acquired_at,
    current_lease.expires_at,
    current_pointer.checkpoint_id,
    coalesce(current_pointer.checkpoint_generation, 0::bigint),
    coalesce(current_pointer.reorg_generation, 0::bigint),
    checkpoint.block_number::bigint,
    checkpoint.block_hash::bytea,
    checkpoint.cursor_block_global_log_index::bigint,
    checkpoint.cursor_candidate_id::text;
end
$function$;

create function programmable_private.advance_projection_entity_current()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  insert into programmable_private.projection_entity_current as current_entity (
    entity_kind, chain_id, release_id, model_id, source_group, entity_key,
    projection_row_id, projection_run_id, publication_id, checkpoint_id,
    promoted_block_number, promoted_block_hash, selected_at
  )
  select
    'launch', launch.chain_id, launch.release_id, launch.model_id,
    run.source_group, pg_catalog.encode(launch.token, 'hex'),
    launch.launch_projection_id, launch.projection_run_id,
    new.publication_id, new.checkpoint_id, launch.promoted_block_number,
    launch.promoted_block_hash, new.published_at
  from programmable_private.launch_projections as launch
  join programmable_private.run_headers as run
    on run.run_id = launch.projection_run_id
  where launch.projection_run_id = new.run_id
  on conflict (
    entity_kind, chain_id, release_id, model_id, source_group, entity_key
  ) do update set
    projection_row_id = excluded.projection_row_id,
    projection_run_id = excluded.projection_run_id,
    publication_id = excluded.publication_id,
    checkpoint_id = excluded.checkpoint_id,
    promoted_block_number = excluded.promoted_block_number,
    promoted_block_hash = excluded.promoted_block_hash,
    selected_at = excluded.selected_at
  where current_entity.promoted_block_number < excluded.promoted_block_number
     or (
       current_entity.promoted_block_number = excluded.promoted_block_number
       and current_entity.selected_at <= excluded.selected_at
     );

  insert into programmable_private.projection_entity_current as current_entity (
    entity_kind, chain_id, release_id, model_id, source_group, entity_key,
    projection_row_id, projection_run_id, publication_id, checkpoint_id,
    promoted_block_number, promoted_block_hash, selected_at
  )
  select
    'reward_vault', vault.chain_id, vault.release_id, vault.model_id,
    run.source_group, pg_catalog.encode(vault.vault, 'hex'),
    vault.reward_vault_projection_id, vault.projection_run_id,
    new.publication_id, new.checkpoint_id, vault.promoted_block_number,
    vault.promoted_block_hash, new.published_at
  from programmable_private.reward_vault_projections as vault
  join programmable_private.run_headers as run
    on run.run_id = vault.projection_run_id
  where vault.projection_run_id = new.run_id
  on conflict (
    entity_kind, chain_id, release_id, model_id, source_group, entity_key
  ) do update set
    projection_row_id = excluded.projection_row_id,
    projection_run_id = excluded.projection_run_id,
    publication_id = excluded.publication_id,
    checkpoint_id = excluded.checkpoint_id,
    promoted_block_number = excluded.promoted_block_number,
    promoted_block_hash = excluded.promoted_block_hash,
    selected_at = excluded.selected_at
  where current_entity.promoted_block_number < excluded.promoted_block_number
     or (
       current_entity.promoted_block_number = excluded.promoted_block_number
       and current_entity.selected_at <= excluded.selected_at
     );

  insert into programmable_private.projection_entity_current as current_entity (
    entity_kind, chain_id, release_id, model_id, source_group, entity_key,
    projection_row_id, projection_run_id, publication_id, checkpoint_id,
    promoted_block_number, promoted_block_hash, selected_at
  )
  select
    'account_reward_balance', balance.chain_id, balance.release_id,
    balance.model_id, run.source_group,
    pg_catalog.encode(balance.account, 'hex') || ':' ||
      pg_catalog.encode(balance.vault, 'hex'),
    balance.account_reward_balance_id, balance.projection_run_id,
    new.publication_id, new.checkpoint_id, balance.promoted_block_number,
    balance.promoted_block_hash, new.published_at
  from programmable_private.account_reward_balances as balance
  join programmable_private.run_headers as run
    on run.run_id = balance.projection_run_id
  where balance.projection_run_id = new.run_id
  on conflict (
    entity_kind, chain_id, release_id, model_id, source_group, entity_key
  ) do update set
    projection_row_id = excluded.projection_row_id,
    projection_run_id = excluded.projection_run_id,
    publication_id = excluded.publication_id,
    checkpoint_id = excluded.checkpoint_id,
    promoted_block_number = excluded.promoted_block_number,
    promoted_block_hash = excluded.promoted_block_hash,
    selected_at = excluded.selected_at
  where current_entity.promoted_block_number < excluded.promoted_block_number
     or (
       current_entity.promoted_block_number = excluded.promoted_block_number
       and current_entity.selected_at <= excluded.selected_at
     );

  insert into programmable_private.projection_entity_current as current_entity (
    entity_kind, chain_id, release_id, model_id, source_group, entity_key,
    projection_row_id, projection_run_id, publication_id, checkpoint_id,
    promoted_block_number, promoted_block_hash, selected_at
  )
  select
    'pool_fee_total', fee_total.chain_id, fee_total.release_id,
    fee_total.model_id, run.source_group,
    pg_catalog.encode(fee_total.pool_id, 'hex') || ':' ||
      coalesce(pg_catalog.encode(fee_total.quote_asset, 'hex'), 'native'),
    fee_total.pool_fee_total_id, fee_total.projection_run_id,
    new.publication_id, new.checkpoint_id, fee_total.promoted_block_number,
    fee_total.promoted_block_hash, new.published_at
  from programmable_private.pool_fee_totals as fee_total
  join programmable_private.run_headers as run
    on run.run_id = fee_total.projection_run_id
  where fee_total.projection_run_id = new.run_id
  on conflict (
    entity_kind, chain_id, release_id, model_id, source_group, entity_key
  ) do update set
    projection_row_id = excluded.projection_row_id,
    projection_run_id = excluded.projection_run_id,
    publication_id = excluded.publication_id,
    checkpoint_id = excluded.checkpoint_id,
    promoted_block_number = excluded.promoted_block_number,
    promoted_block_hash = excluded.promoted_block_hash,
    selected_at = excluded.selected_at
  where current_entity.promoted_block_number < excluded.promoted_block_number
     or (
       current_entity.promoted_block_number = excluded.promoted_block_number
       and current_entity.selected_at <= excluded.selected_at
     );
  return new;
end
$function$;

create trigger projection_publication_advance_entities
after insert on programmable_private.projection_publications
for each row execute function programmable_private.advance_projection_entity_current();

create function programmable_private.restore_projection_entity_after_delete()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  old_source_group text;
  old_entity_key text;
  old_projection_row_id uuid;
  was_current boolean;
begin
  select source_group::text into old_source_group
  from programmable_private.run_headers where run_id = old.projection_run_id;
  if tg_argv[0] = 'launch' then
    old_entity_key := pg_catalog.encode(old.token, 'hex');
    old_projection_row_id := old.launch_projection_id;
  elsif tg_argv[0] = 'reward_vault' then
    old_entity_key := pg_catalog.encode(old.vault, 'hex');
    old_projection_row_id := old.reward_vault_projection_id;
  elsif tg_argv[0] = 'account_reward_balance' then
    old_entity_key := pg_catalog.encode(old.account, 'hex') || ':' ||
      pg_catalog.encode(old.vault, 'hex');
    old_projection_row_id := old.account_reward_balance_id;
  else
    old_entity_key := pg_catalog.encode(old.pool_id, 'hex') || ':' ||
      coalesce(pg_catalog.encode(old.quote_asset, 'hex'), 'native');
    old_projection_row_id := old.pool_fee_total_id;
  end if;
  delete from programmable_private.projection_entity_current
  where entity_kind = tg_argv[0]
    and chain_id = old.chain_id
    and release_id = old.release_id
    and model_id = old.model_id
    and source_group = old_source_group
    and entity_key = old_entity_key
    and projection_row_id = old_projection_row_id;
  was_current := found;
  if not was_current then
    return old;
  end if;

  if tg_argv[0] = 'launch' then
    insert into programmable_private.projection_entity_current
    select 'launch', launch.chain_id, launch.release_id, launch.model_id,
      run.source_group, old_entity_key, launch.launch_projection_id,
      launch.projection_run_id, publication.publication_id,
      publication.checkpoint_id, launch.promoted_block_number,
      launch.promoted_block_hash, publication.published_at
    from programmable_private.launch_projections as launch
    join programmable_private.run_headers as run
      on run.run_id = launch.projection_run_id
    join programmable_private.projection_publications as publication
      on publication.run_id = launch.projection_run_id
    where launch.chain_id = old.chain_id
      and launch.release_id = old.release_id
      and launch.model_id = old.model_id
      and run.source_group = old_source_group
      and launch.token = old.token
    order by launch.promoted_block_number desc, publication.published_at desc
    limit 1;
  elsif tg_argv[0] = 'reward_vault' then
    insert into programmable_private.projection_entity_current
    select 'reward_vault', vault.chain_id, vault.release_id, vault.model_id,
      run.source_group, old_entity_key, vault.reward_vault_projection_id,
      vault.projection_run_id, publication.publication_id,
      publication.checkpoint_id, vault.promoted_block_number,
      vault.promoted_block_hash, publication.published_at
    from programmable_private.reward_vault_projections as vault
    join programmable_private.run_headers as run
      on run.run_id = vault.projection_run_id
    join programmable_private.projection_publications as publication
      on publication.run_id = vault.projection_run_id
    where vault.chain_id = old.chain_id and vault.release_id = old.release_id
      and vault.model_id = old.model_id and run.source_group = old_source_group
      and vault.vault = old.vault
    order by vault.promoted_block_number desc, publication.published_at desc
    limit 1;
  elsif tg_argv[0] = 'account_reward_balance' then
    insert into programmable_private.projection_entity_current
    select 'account_reward_balance', balance.chain_id, balance.release_id,
      balance.model_id, run.source_group, old_entity_key,
      balance.account_reward_balance_id, balance.projection_run_id,
      publication.publication_id, publication.checkpoint_id,
      balance.promoted_block_number, balance.promoted_block_hash,
      publication.published_at
    from programmable_private.account_reward_balances as balance
    join programmable_private.run_headers as run
      on run.run_id = balance.projection_run_id
    join programmable_private.projection_publications as publication
      on publication.run_id = balance.projection_run_id
    where balance.chain_id = old.chain_id and balance.release_id = old.release_id
      and balance.model_id = old.model_id and run.source_group = old_source_group
      and balance.account = old.account and balance.vault = old.vault
    order by balance.promoted_block_number desc, publication.published_at desc
    limit 1;
  else
    insert into programmable_private.projection_entity_current
    select 'pool_fee_total', fee_total.chain_id, fee_total.release_id,
      fee_total.model_id, run.source_group, old_entity_key,
      fee_total.pool_fee_total_id, fee_total.projection_run_id,
      publication.publication_id, publication.checkpoint_id,
      fee_total.promoted_block_number, fee_total.promoted_block_hash,
      publication.published_at
    from programmable_private.pool_fee_totals as fee_total
    join programmable_private.run_headers as run
      on run.run_id = fee_total.projection_run_id
    join programmable_private.projection_publications as publication
      on publication.run_id = fee_total.projection_run_id
    where fee_total.chain_id = old.chain_id and fee_total.release_id = old.release_id
      and fee_total.model_id = old.model_id and run.source_group = old_source_group
      and fee_total.pool_id = old.pool_id
      and fee_total.quote_asset is not distinct from old.quote_asset
    order by fee_total.promoted_block_number desc, publication.published_at desc
    limit 1;
  end if;
  return old;
end
$function$;

create trigger launch_projection_restore_current
after delete on programmable_private.launch_projections
for each row execute function programmable_private.restore_projection_entity_after_delete('launch');
create trigger reward_vault_projection_restore_current
after delete on programmable_private.reward_vault_projections
for each row execute function programmable_private.restore_projection_entity_after_delete('reward_vault');
create trigger account_reward_balance_restore_current
after delete on programmable_private.account_reward_balances
for each row execute function programmable_private.restore_projection_entity_after_delete('account_reward_balance');
create trigger pool_fee_total_restore_current
after delete on programmable_private.pool_fee_totals
for each row execute function programmable_private.restore_projection_entity_after_delete('pool_fee_total');

revoke all on function programmable_private.get_projector_runtime_state_v1(
  bigint, text, text, text, text, text[], text[], bytea[], bytea[]
) from public;
grant execute on function programmable_private.get_projector_runtime_state_v1(
  bigint, text, text, text, text, text[], text[], bytea[], bytea[]
) to programmable_projector;

grant execute on function programmable_private.derive_envio_candidate_id(
  bigint, bytea, bytea, numeric
) to programmable_projector;

revoke all on function programmable_private.append_release_dynamic_source_template(
  uuid, uuid, uuid, text, text, text, text, bytea, bytea, bytea, jsonb,
  bytea, numeric, bytea, bytea, timestamptz
) from public;
grant execute on function programmable_private.append_release_dynamic_source_template(
  uuid, uuid, uuid, text, text, text, text, bytea, bytea, bytea, jsonb,
  bytea, numeric, bytea, bytea, timestamptz
) to programmable_projector;
revoke all on function programmable_private.append_dual_rpc_runtime_code_evidence(
  uuid, uuid, bytea, uuid, uuid, uuid, bytea, bytea, numeric, numeric,
  bytea, bytea, bytea, bytea[], bytea, bytea, smallint, bytea, bytea, bytea,
  timestamptz
) from public;
grant execute on function programmable_private.append_dual_rpc_runtime_code_evidence(
  uuid, uuid, bytea, uuid, uuid, uuid, bytea, bytea, numeric, numeric,
  bytea, bytea, bytea, bytea[], bytea, bytea, smallint, bytea, bytea, bytea,
  timestamptz
) to programmable_projector;
revoke all on function programmable_private.register_dynamic_source_attestation(
  uuid, uuid, uuid, uuid, bytea, numeric, uuid, bytea, bytea, bytea, bytea,
  bytea, bytea, bytea, smallint, bytea, bytea, bytea, timestamptz
) from public;
grant execute on function programmable_private.register_dynamic_source_attestation(
  uuid, uuid, uuid, uuid, bytea, numeric, uuid, bytea, bytea, bytea, bytea,
  bytea, bytea, bytea, smallint, bytea, bytea, bytea, timestamptz
) to programmable_projector;
revoke all on function programmable_private.append_release_neutral_envio_candidate(
  text, uuid, numeric, bytea, bytea, numeric, numeric, bytea, bytea, text,
  bytea[], bytea, jsonb, bytea, text, uuid, bytea, timestamptz, text, text
) from public;
grant execute on function programmable_private.append_release_neutral_envio_candidate(
  text, uuid, numeric, bytea, bytea, numeric, numeric, bytea, bytea, text,
  bytea[], bytea, jsonb, bytea, text, uuid, bytea, timestamptz, text, text
) to programmable_projector;

revoke all on function programmable_private.get_envio_ingestion_cursor_v1(
  bigint, uuid, text
) from public;
grant execute on function programmable_private.get_envio_ingestion_cursor_v1(
  bigint, uuid, text
) to programmable_projector;
revoke all on function programmable_private.advance_envio_ingestion_cursor_v1(
  uuid, uuid, text, bigint, bigint, numeric, bytea, numeric, text, bytea,
  timestamptz
) from public;
grant execute on function programmable_private.advance_envio_ingestion_cursor_v1(
  uuid, uuid, text, bigint, bigint, numeric, bytea, numeric, text, bytea,
  timestamptz
) to programmable_projector;
revoke all on function programmable_private.list_envio_ingestion_cursor_ancestors_v1(
  bigint, uuid, text, integer
) from public;
grant execute on function programmable_private.list_envio_ingestion_cursor_ancestors_v1(
  bigint, uuid, text, integer
) to programmable_projector;
revoke all on function programmable_private.rewind_envio_ingestion_cursor_v1(
  uuid, uuid, text, bigint, bigint, bigint, bytea, timestamptz
) from public;
grant execute on function programmable_private.rewind_envio_ingestion_cursor_v1(
  uuid, uuid, text, bigint, bigint, bigint, bytea, timestamptz
) to programmable_projector;
revoke all on function programmable_private.list_projector_candidate_page_v1(
  bigint, text, text, text, uuid, bigint, text, bigint, bytea, numeric,
  numeric, text, integer, timestamptz
) from public;
grant execute on function programmable_private.list_projector_candidate_page_v1(
  bigint, text, text, text, uuid, bigint, text, bigint, bytea, numeric,
  numeric, text, integer, timestamptz
) to programmable_projector;
revoke all on function programmable_private.defer_envio_candidate_v1(
  uuid, uuid, text, bigint, bigint, timestamptz, text, bytea, timestamptz
) from public;
grant execute on function programmable_private.defer_envio_candidate_v1(
  uuid, uuid, text, bigint, bigint, timestamptz, text, bytea, timestamptz
) to programmable_projector;
revoke all on function programmable_private.ignore_envio_candidate_v1(
  uuid, uuid, text, bigint, text, bytea, timestamptz
) from public;
grant execute on function programmable_private.ignore_envio_candidate_v1(
  uuid, uuid, text, bigint, text, bytea, timestamptz
) to programmable_projector;
revoke all on function programmable_private.quarantine_envio_candidate_v1(
  uuid, uuid, text, bigint, text, bytea, timestamptz
) from public;
grant execute on function programmable_private.quarantine_envio_candidate_v1(
  uuid, uuid, text, bigint, text, bytea, timestamptz
) to programmable_projector;
revoke all on function programmable_private.resolve_envio_candidate(
  uuid, uuid, text, uuid, uuid, bytea, bytea, timestamptz
) from public;
grant execute on function programmable_private.resolve_envio_candidate(
  uuid, uuid, text, uuid, uuid, bytea, bytea, timestamptz
) to programmable_projector;
revoke all on function programmable_private.append_envio_terminal_disposition(
  uuid, uuid, text, bigint, text, text, bytea, timestamptz
) from public;

revoke all on function programmable_private.list_projector_checkpoint_ancestors_v1(
  bigint, text, text, text, text, integer
) from public;
grant execute on function programmable_private.list_projector_checkpoint_ancestors_v1(
  bigint, text, text, text, text, integer
) to programmable_projector;
revoke all on function programmable_private.get_projector_launch_baseline_v1(
  uuid, bytea
) from public;
grant execute on function programmable_private.get_projector_launch_baseline_v1(
  uuid, bytea
) to programmable_projector;
revoke all on function programmable_private.get_projector_pool_fee_total_v1(
  uuid, bytea, bytea
) from public;
grant execute on function programmable_private.get_projector_pool_fee_total_v1(
  uuid, bytea, bytea
) to programmable_projector;
revoke all on function programmable_private.get_projector_vault_baseline_v1(
  uuid, bytea
) from public;
grant execute on function programmable_private.get_projector_vault_baseline_v1(
  uuid, bytea
) to programmable_projector;
revoke all on function programmable_private.list_projector_vault_allocations_v1(
  uuid, bytea
) from public;
grant execute on function programmable_private.list_projector_vault_allocations_v1(
  uuid, bytea
) to programmable_projector;
revoke all on function programmable_private.get_projector_account_reward_balance_v1(
  uuid, bytea, bytea
) from public;
grant execute on function programmable_private.get_projector_account_reward_balance_v1(
  uuid, bytea, bytea
) to programmable_projector;
revoke all on function programmable_private.assert_open_projection_run_v1(
  uuid
) from public;
revoke all on function programmable_private.append_chain_event_occurrence(
  uuid, uuid, uuid, text, uuid, numeric, timestamptz, text, bytea, uuid,
  smallint, bytea, bytea, timestamptz
) from public;
grant execute on function programmable_private.append_chain_event_occurrence(
  uuid, uuid, uuid, text, uuid, numeric, timestamptz, text, bytea, uuid,
  smallint, bytea, bytea, timestamptz
) to programmable_projector;

revoke all on function programmable_private.append_release_projection_event_rule(
  uuid, uuid, text, text, text, bytea, timestamptz
) from public;
grant execute on function programmable_private.append_release_projection_event_rule(
  uuid, uuid, text, text, text, bytea, timestamptz
) to programmable_projector;
revoke all on function programmable_private.append_release_launch_requirement(
  uuid, uuid, integer, text, text, text, bytea, timestamptz
) from public;
grant execute on function programmable_private.append_release_launch_requirement(
  uuid, uuid, integer, text, text, text, bytea, timestamptz
) to programmable_projector;
revoke all on function programmable_private.assert_projection_event_allowed(
  uuid, uuid, text
) from public;
grant execute on function programmable_private.assert_projection_event_allowed(
  uuid, uuid, text
) to programmable_projector;
revoke all on function programmable_private.stage_launch_occurrence_role(
  uuid, text, uuid, timestamptz
) from public;
grant execute on function programmable_private.stage_launch_occurrence_role(
  uuid, text, uuid, timestamptz
) to programmable_projector;
revoke all on function programmable_private.stage_launch_projection_conditions(
  uuid, boolean, timestamptz
) from public;
grant execute on function programmable_private.stage_launch_projection_conditions(
  uuid, boolean, timestamptz
) to programmable_projector;
revoke all on function programmable_private.stage_pool_fee_configuration_v2(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, uuid, numeric, bytea, timestamptz
) from public;
grant execute on function programmable_private.stage_pool_fee_configuration_v2(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, uuid, numeric, bytea, timestamptz
) to programmable_projector;
revoke all on function programmable_private.append_creator_hook_claim_fact(
  uuid, uuid, uuid, bytea, bytea, bytea, bytea, bytea, bytea, numeric,
  timestamptz
) from public;
grant execute on function programmable_private.append_creator_hook_claim_fact(
  uuid, uuid, uuid, bytea, bytea, bytea, bytea, bytea, bytea, numeric,
  timestamptz
) to programmable_projector;
revoke all on function programmable_private.append_launcher_hook_claim_fact(
  uuid, uuid, uuid, bytea, bytea, bytea, bytea, numeric, timestamptz
) from public;
grant execute on function programmable_private.append_launcher_hook_claim_fact(
  uuid, uuid, uuid, bytea, bytea, bytea, bytea, numeric, timestamptz
) to programmable_projector;
revoke all on function programmable_private.append_creator_fee_checkpoint_fact(
  uuid, uuid, uuid, bytea, numeric, numeric, numeric, timestamptz
) from public;
grant execute on function programmable_private.append_creator_fee_checkpoint_fact(
  uuid, uuid, uuid, bytea, numeric, numeric, numeric, timestamptz
) to programmable_projector;
revoke all on function programmable_private.append_reward_configuration_activation_fact(
  uuid, uuid, uuid, bytea, bytea, numeric, bytea, bytea, bytea[], numeric[],
  numeric, timestamptz
) from public;
grant execute on function programmable_private.append_reward_configuration_activation_fact(
  uuid, uuid, uuid, bytea, bytea, numeric, bytea, bytea, bytea[], numeric[],
  numeric, timestamptz
) to programmable_projector;
revoke all on function programmable_private.event_fact_context(
  uuid, uuid, text
) from public;
revoke all on function programmable_private.enforce_projection_event_rule()
  from public;
revoke all on function programmable_private.enforce_launch_publication_completeness()
  from public;
revoke all on function programmable_private.advance_projection_entity_current()
  from public;
revoke all on function programmable_private.restore_projection_entity_after_delete()
  from public;

reset role;
