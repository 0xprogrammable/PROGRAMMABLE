-- Provider commitments, immutable run provenance, dual-RPC gates, release
-- epochs, lease generations and atomic checkpoint identities.

set role programmable_migrator;

create table programmable_private.fingerprint_encoding_versions (
  fingerprint_domain text not null
    check (fingerprint_domain in ('occurrence', 'allocation', 'evidence')),
  encoding_version smallint not null check (encoding_version > 0),
  domain_prefix bytea not null,
  write_enabled boolean not null,
  definition_commitment programmable_private.bytes32_value not null,
  allowlisted_at timestamptz not null,
  primary key (fingerprint_domain, encoding_version),
  unique (domain_prefix),
  check (
    pg_catalog.octet_length(domain_prefix) >= 25
    and pg_catalog.get_byte(
      domain_prefix,
      pg_catalog.octet_length(domain_prefix) - 1
    ) = 0
  )
);

insert into programmable_private.fingerprint_encoding_versions (
  fingerprint_domain, encoding_version, domain_prefix, write_enabled,
  definition_commitment, allowlisted_at
)
values
  (
    'occurrence', 1,
    pg_catalog.decode(
      '70726f6772616d6d61626c653a6f6363757272656e63653a763100',
      'hex'
    ),
    true, pg_catalog.decode(pg_catalog.repeat('01', 32), 'hex'),
    '2026-07-31T00:00:00Z'
  ),
  (
    'allocation', 1,
    pg_catalog.decode(
      '70726f6772616d6d61626c653a616c6c6f636174696f6e3a763100',
      'hex'
    ),
    true, pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
    '2026-07-31T00:00:00Z'
  ),
  (
    'evidence', 1,
    pg_catalog.decode(
      '70726f6772616d6d61626c653a65766964656e63653a763100',
      'hex'
    ),
    true, pg_catalog.decode(pg_catalog.repeat('03', 32), 'hex'),
    '2026-07-31T00:00:00Z'
  ),
  (
    'evidence', 2,
    pg_catalog.decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200',
      'hex'
    ),
    true,
    pg_catalog.decode(
      '45b8e9d1bf3ffc2e70b7fd612ec2346aef5e74ae08348b699eb68ce0afbc9483',
      'hex'
    ),
    '2026-07-31T00:00:00Z'
  );

create table programmable_private.provider_evidence_encoding_subtypes (
  evidence_subtype programmable_private.source_identifier primary key,
  fingerprint_domain text not null default 'evidence'
    check (fingerprint_domain = 'evidence'),
  encoding_version smallint not null,
  subtype_tag smallint not null check (subtype_tag between 1 and 255),
  frame_prefix bytea not null unique,
  definition_commitment programmable_private.bytes32_value not null,
  foreign key (fingerprint_domain, encoding_version)
    references programmable_private.fingerprint_encoding_versions(
      fingerprint_domain, encoding_version
    ) on delete restrict,
  unique (encoding_version, subtype_tag),
  check (pg_catalog.octet_length(frame_prefix) = 35)
);

insert into programmable_private.provider_evidence_encoding_subtypes (
  evidence_subtype, encoding_version, subtype_tag, frame_prefix,
  definition_commitment
) values
  (
    'safe_head', 2, 1,
    pg_catalog.decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320001',
      'hex'
    ),
    pg_catalog.decode(
      '3a26ae9c9220347568e33b5850ac6f605d120e6443f64e9e8b8742ea8a016f52',
      'hex'
    )
  ),
  (
    'block', 2, 2,
    pg_catalog.decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320002',
      'hex'
    ),
    pg_catalog.decode(
      '83948b75a3c05b9d257749f754f09a1b02e658496ba562f36e07bc15be3d7bec',
      'hex'
    )
  ),
  (
    'runtime_code', 2, 3,
    pg_catalog.decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320003',
      'hex'
    ),
    pg_catalog.decode(
      '4c191e91130097832a91025e85c2ff3be2705af0e3ea9abc396f09e7cd9dbbc5',
      'hex'
    )
  ),
  (
    'dynamic_attestation', 2, 4,
    pg_catalog.decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320004',
      'hex'
    ),
    pg_catalog.decode(
      '206e1f89ad459e55e0591de13eb40856dd94ff62923d76034eba5776706e6de9',
      'hex'
    )
  );

create function programmable_private.assert_fingerprint_encoding(
  p_fingerprint_domain text,
  p_encoding_version smallint,
  p_canonical_preimage bytea,
  p_content_fingerprint bytea
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  expected_prefix bytea;
begin
  select version_row.domain_prefix into expected_prefix
  from programmable_private.fingerprint_encoding_versions as version_row
  where version_row.fingerprint_domain = p_fingerprint_domain
    and version_row.encoding_version = p_encoding_version
    and version_row.write_enabled;
  if not found
     or pg_catalog.octet_length(p_content_fingerprint) <> 32
     or pg_catalog.octet_length(p_canonical_preimage)
       < pg_catalog.octet_length(expected_prefix)
     or pg_catalog.substring(
       p_canonical_preimage,
       1,
       pg_catalog.octet_length(expected_prefix)
     ) <> expected_prefix
  then
    raise exception using
      errcode = '22023',
      message = 'fingerprint encoding version or domain prefix is not allowlisted';
  end if;
end
$function$;

create function programmable_private.assert_provider_evidence_encoding(
  p_evidence_subtype text,
  p_encoding_version smallint,
  p_canonical_preimage bytea,
  p_content_fingerprint bytea
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  expected_prefix bytea;
begin
  perform programmable_private.assert_fingerprint_encoding(
    'evidence', p_encoding_version, p_canonical_preimage,
    p_content_fingerprint
  );
  select subtype.frame_prefix into expected_prefix
  from programmable_private.provider_evidence_encoding_subtypes as subtype
  where subtype.evidence_subtype = p_evidence_subtype
    and subtype.encoding_version = p_encoding_version;
  if not found
     or pg_catalog.octet_length(p_canonical_preimage)
       < pg_catalog.octet_length(expected_prefix)
     or pg_catalog.substring(
       p_canonical_preimage, 1, pg_catalog.octet_length(expected_prefix)
     ) <> expected_prefix
  then
    raise exception using
      errcode = '22023',
      message = 'provider evidence subtype or frame tag is not allowlisted';
  end if;
end
$function$;

create table programmable_private.mutation_audits (
  audit_id uuid primary key,
  action programmable_private.source_identifier not null,
  caller_role name not null,
  input_commitment programmable_private.bytes32_value not null,
  run_id uuid,
  occurred_at timestamptz not null,
  check (occurred_at <= pg_catalog.clock_timestamp() + interval '5 minutes')
);

create table programmable_private.release_epochs (
  epoch_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_number bigint not null check (epoch_number > 0),
  epoch_commitment programmable_private.bytes32_value not null,
  artifact_creation_code_commitment programmable_private.bytes32_value not null,
  created_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (chain_id, release_id, model_id, source_group, epoch_number),
  unique (epoch_id, chain_id, release_id, model_id, source_group)
);

create table programmable_private.release_source_bindings (
  binding_id uuid primary key,
  epoch_id uuid not null
    references programmable_private.release_epochs(epoch_id)
    on delete restrict,
  source_name programmable_private.source_identifier not null,
  source_role programmable_private.source_identifier not null,
  source_type programmable_private.source_type not null,
  source_address programmable_private.eth_address,
  recovery_selector programmable_private.hex_selector,
  inclusive_start_block programmable_private.block_number_value not null,
  abi_event_set_commitment programmable_private.bytes32_value not null,
  artifact_creation_code_commitment programmable_private.bytes32_value not null,
  binding_commitment programmable_private.bytes32_value not null,
  created_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (
    (source_type = 'ethereum_contract' and source_address is not null)
    or (source_type <> 'ethereum_contract' and source_address is null)
  ),
  check (recovery_selector is null or source_type = 'ethereum_contract'),
  unique (epoch_id, source_name),
  unique (epoch_id, source_role, source_address),
  unique (epoch_id, source_address, abi_event_set_commitment),
  unique (epoch_id, binding_commitment)
);

create table programmable_private.provider_deployments (
  provider_deployment_id uuid primary key,
  provider_type programmable_private.source_type not null,
  redacted_identity programmable_private.source_identifier not null,
  deployment_commitment programmable_private.bytes32_value not null,
  schema_commitment programmable_private.bytes32_value not null,
  created_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (provider_type in ('rpc_provider', 'envio_deployment', 'uniswap_subgraph')),
  unique (redacted_identity),
  unique (provider_type, deployment_commitment, schema_commitment)
);

-- RPC endpoints are production secrets. Only domain-separated commitments are
-- retained, and the two independent mainnet vendors have one canonical order.
create table programmable_private.rpc_endpoint_evidence_domains (
  evidence_domain programmable_private.source_identifier primary key,
  definition_commitment programmable_private.bytes32_value not null,
  enabled boolean not null,
  allowlisted_at timestamptz not null,
  check (
    definition_commitment <>
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  )
);

insert into programmable_private.rpc_endpoint_evidence_domains (
  evidence_domain, definition_commitment, enabled, allowlisted_at
)
values (
  'rpc-endpoint-commitments-v1',
  pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
  true,
  '2026-07-31T00:00:00Z'
);

create table programmable_private.rpc_provider_deployment_metadata (
  provider_deployment_id uuid primary key
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  vendor programmable_private.source_identifier not null,
  vendor_order smallint not null,
  constructor_version programmable_private.projector_identifier not null,
  endpoint_url_commitment programmable_private.bytes32_value not null,
  endpoint_origin_commitment programmable_private.bytes32_value not null,
  endpoint_evidence_domain programmable_private.source_identifier not null
    references programmable_private.rpc_endpoint_evidence_domains(evidence_domain)
    on delete restrict,
  endpoint_evidence_commitment programmable_private.bytes32_value not null,
  check (chain_id = 1),
  check (
    (vendor = 'alchemy' and vendor_order = 1)
    or (vendor = 'quicknode' and vendor_order = 2)
  ),
  check (
    endpoint_url_commitment <>
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and endpoint_origin_commitment <>
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and endpoint_evidence_commitment <>
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  ),
  unique (chain_id, vendor),
  unique (chain_id, vendor_order)
);

create table programmable_private.release_epoch_current (
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  generation bigint not null check (generation > 0),
  changed_at timestamptz not null,
  changed_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  primary key (chain_id, release_id, model_id, source_group),
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    )
    on delete restrict
);

create table programmable_private.release_epoch_pointer_history (
  history_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  previous_epoch_id uuid,
  next_epoch_id uuid not null,
  previous_generation bigint not null check (previous_generation >= 0),
  next_generation bigint not null check (next_generation = previous_generation + 1),
  changed_at timestamptz not null,
  changed_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (next_epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    )
    on delete restrict,
  check (previous_epoch_id is not null or previous_generation = 0),
  unique (chain_id, release_id, model_id, source_group, next_generation)
);

-- Release-neutral Envio ingestion uses one migration-owned control scope.
-- Product release epochs never own the global stream cursor or raw inbox.
insert into programmable_private.mutation_audits (
  audit_id, action, caller_role, input_commitment, run_id, occurred_at
) values (
  '70000000-0000-0000-0000-000000000001',
  'envio_control.bootstrap', 'programmable_migrator'::name,
  pg_catalog.decode(pg_catalog.repeat('e0', 32), 'hex'), null,
  '2026-07-31T00:00:00Z'
);

insert into programmable_private.release_epochs (
  epoch_id, chain_id, release_id, model_id, source_group, epoch_number,
  epoch_commitment, artifact_creation_code_commitment, created_at,
  created_by_audit_id
) values (
  '70000000-0000-0000-0000-000000000002', 1,
  'envio-control', 'envio-control', 'canonical-events', 1,
  pg_catalog.decode(pg_catalog.repeat('e1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e2', 32), 'hex'),
  '2026-07-31T00:00:00Z',
  '70000000-0000-0000-0000-000000000001'
);

insert into programmable_private.release_epoch_current (
  chain_id, release_id, model_id, source_group, epoch_id, generation,
  changed_at, changed_by_audit_id
) values (
  1, 'envio-control', 'envio-control', 'canonical-events',
  '70000000-0000-0000-0000-000000000002', 1,
  '2026-07-31T00:00:00Z',
  '70000000-0000-0000-0000-000000000001'
);

insert into programmable_private.release_epoch_pointer_history (
  history_id, chain_id, release_id, model_id, source_group,
  previous_epoch_id, next_epoch_id, previous_generation, next_generation,
  changed_at, changed_by_audit_id
) values (
  '70000000-0000-0000-0000-000000000003', 1,
  'envio-control', 'envio-control', 'canonical-events', null,
  '70000000-0000-0000-0000-000000000002', 0, 1,
  '2026-07-31T00:00:00Z',
  '70000000-0000-0000-0000-000000000001'
);

create table programmable_private.run_headers (
  run_id uuid primary key,
  run_kind programmable_private.run_kind not null,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  captured_pointer_generation bigint not null check (captured_pointer_generation > 0),
  worker_version programmable_private.projector_identifier not null,
  request_commitment programmable_private.bytes32_value not null,
  caller_role name not null,
  started_at timestamptz not null,
  opened_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    )
    on delete restrict,
  unique (run_id, epoch_id, captured_pointer_generation)
);

alter table programmable_private.mutation_audits
  add constraint mutation_audits_run_id_fkey
  foreign key (run_id)
  references programmable_private.run_headers(run_id)
  on delete restrict;

create table programmable_private.run_lifecycle_outcomes (
  outcome_id uuid primary key,
  run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  status programmable_private.run_status not null,
  result_commitment programmable_private.bytes32_value not null,
  caller_role name not null,
  finished_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (run_id),
  unique (outcome_id, run_id)
);

create table programmable_private.run_telemetry (
  telemetry_id uuid primary key,
  run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  sample_kind programmable_private.source_identifier not null,
  sampled_at timestamptz not null,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  item_count bigint check (item_count is null or item_count >= 0),
  diagnostic_sample jsonb,
  failed_or_reorg boolean not null default false
);

create index run_telemetry_retention_idx
  on programmable_private.run_telemetry (failed_or_reorg, sampled_at, telemetry_id);

create table programmable_private.safe_head_observations (
  observation_id uuid primary key,
  epoch_id uuid not null,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  provider_a_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_b_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  reported_chain_id_a programmable_private.chain_id_value not null,
  reported_chain_id_b programmable_private.chain_id_value not null,
  head_a programmable_private.block_number_value not null,
  head_b programmable_private.block_number_value not null,
  finality_depth bigint not null check (finality_depth = 12),
  safe_block_number programmable_private.block_number_value not null,
  safe_block_hash_a programmable_private.bytes32_value not null,
  safe_block_hash_b programmable_private.bytes32_value not null,
  agreed_safe_block_hash programmable_private.bytes32_value not null,
  encoding_version smallint not null check (encoding_version = 2),
  canonical_preimage bytea not null,
  content_fingerprint programmable_private.bytes32_value not null,
  verification_run_id uuid not null,
  observed_at timestamptz not null,
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    )
    on delete restrict,
  foreign key (verification_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    )
    on delete restrict,
  check (provider_a_id <> provider_b_id),
  check (reported_chain_id_a = chain_id and reported_chain_id_b = chain_id),
  check (head_a >= 12 and head_b >= 12),
  check (safe_block_number = least(head_a, head_b) - 12),
  check (
    safe_block_hash_a = safe_block_hash_b
    and safe_block_hash_a = agreed_safe_block_hash
  ),
  check (
    pg_catalog.octet_length(canonical_preimage) >= 35
    and pg_catalog.substring(canonical_preimage, 1, 35)
      = pg_catalog.decode(
        '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320001',
        'hex'
      )
  ),
  unique (epoch_id, content_fingerprint),
  unique (observation_id, epoch_id, chain_id, pointer_generation),
  unique (observation_id, agreed_safe_block_hash)
);

create table programmable_private.dual_rpc_block_evidence (
  block_evidence_id uuid primary key,
  observation_id uuid not null,
  epoch_id uuid not null,
  chain_id programmable_private.chain_id_value not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  block_number programmable_private.block_number_value not null,
  provider_a_block_hash programmable_private.bytes32_value not null,
  provider_b_block_hash programmable_private.bytes32_value not null,
  agreed_block_hash programmable_private.bytes32_value not null,
  encoding_version smallint not null check (encoding_version = 2),
  canonical_preimage bytea not null,
  content_fingerprint programmable_private.bytes32_value not null,
  verification_run_id uuid not null,
  verified_at timestamptz not null,
  foreign key (observation_id, epoch_id, chain_id, pointer_generation)
    references programmable_private.safe_head_observations(
      observation_id, epoch_id, chain_id, pointer_generation
    )
    on delete restrict,
  foreign key (verification_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    )
    on delete restrict,
  check (
    provider_a_block_hash = provider_b_block_hash
    and provider_a_block_hash = agreed_block_hash
  ),
  check (
    pg_catalog.octet_length(canonical_preimage) >= 35
    and pg_catalog.substring(canonical_preimage, 1, 35)
      = pg_catalog.decode(
        '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76320002',
        'hex'
      )
  ),
  unique (observation_id, block_number),
  unique (epoch_id, content_fingerprint),
  unique (block_evidence_id, epoch_id, chain_id, pointer_generation),
  unique (block_evidence_id, observation_id, epoch_id, chain_id, pointer_generation),
  unique (block_evidence_id, agreed_block_hash)
);

create table programmable_private.projector_lease_current (
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  projector_version programmable_private.projector_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  lease_generation bigint not null check (lease_generation > 0),
  lease_token_hash programmable_private.bytes32_value not null,
  holder_id programmable_private.source_identifier not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  changed_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  primary key (
    chain_id, release_id, model_id, source_group, projector_version
  ),
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    )
    on delete restrict,
  check (expires_at > acquired_at and expires_at <= acquired_at + interval '10 minutes')
);

create table programmable_private.projector_lease_history (
  lease_history_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  projector_version programmable_private.projector_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  previous_generation bigint not null check (previous_generation >= 0),
  lease_generation bigint not null check (lease_generation = previous_generation + 1),
  lease_token_hash programmable_private.bytes32_value not null,
  holder_id programmable_private.source_identifier not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (
    chain_id, release_id, model_id, source_group,
    projector_version, lease_generation
  )
);

create table programmable_private.projector_checkpoints (
  checkpoint_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  projector_version programmable_private.projector_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  lease_generation bigint not null check (lease_generation > 0),
  checkpoint_generation bigint not null check (checkpoint_generation > 0),
  reorg_generation bigint not null check (reorg_generation >= 0),
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  cursor_block_global_log_index
    programmable_private.block_log_index_value not null,
  cursor_candidate_id
    programmable_private.envio_candidate_identifier not null,
  safe_head_observation_id uuid not null,
  target_block_evidence_id uuid not null,
  run_id uuid not null,
  terminal_outcome_id uuid not null,
  created_at timestamptz not null,
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    )
    on delete restrict,
  foreign key (
    target_block_evidence_id, safe_head_observation_id, epoch_id,
    chain_id, pointer_generation
  )
    references programmable_private.dual_rpc_block_evidence(
      block_evidence_id, observation_id, epoch_id, chain_id, pointer_generation
    )
    on delete restrict,
  foreign key (target_block_evidence_id, block_hash)
    references programmable_private.dual_rpc_block_evidence(
      block_evidence_id, agreed_block_hash
    )
    on delete restrict,
  foreign key (terminal_outcome_id, run_id)
    references programmable_private.run_lifecycle_outcomes(outcome_id, run_id)
    on delete restrict,
  unique (
    chain_id, release_id, model_id, source_group,
    projector_version, checkpoint_generation
  ),
  unique (checkpoint_id, epoch_id, pointer_generation)
);

create table programmable_private.projector_checkpoint_current (
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  projector_version programmable_private.projector_identifier not null,
  checkpoint_id uuid not null
    references programmable_private.projector_checkpoints(checkpoint_id)
    on delete restrict,
  checkpoint_generation bigint not null check (checkpoint_generation > 0),
  reorg_generation bigint not null check (reorg_generation >= 0),
  changed_at timestamptz not null,
  primary key (
    chain_id, release_id, model_id, source_group, projector_version
  )
);

create table programmable_private.dependency_health_history (
  health_event_id uuid primary key,
  dependency programmable_private.source_identifier not null,
  circuit_status programmable_private.dependency_health_status not null,
  failure_count integer not null check (failure_count >= 0),
  observed_at timestamptz not null,
  retry_after timestamptz,
  detail_commitment programmable_private.bytes32_value not null,
  run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (
    (circuit_status in ('open', 'half_open') and retry_after is not null)
    or (circuit_status in ('closed', 'frozen'))
  )
);

create table programmable_private.dependency_health_current (
  dependency programmable_private.source_identifier primary key,
  health_event_id uuid not null
    references programmable_private.dependency_health_history(health_event_id)
    on delete restrict,
  circuit_status programmable_private.dependency_health_status not null,
  observed_at timestamptz not null
);

create function programmable_private.append_mutation_audit(
  p_action text,
  p_input_commitment bytea,
  p_run_id uuid default null,
  p_occurred_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  audit_id uuid := pg_catalog.gen_random_uuid();
begin
  if p_action is null
     or pg_catalog.octet_length(p_action) not between 1 and 128
     or p_action !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or pg_catalog.octet_length(p_input_commitment) <> 32
     or p_occurred_at is null
  then
    raise exception using errcode = '22023', message = 'invalid audit input';
  end if;

  insert into programmable_private.mutation_audits (
    audit_id, action, caller_role, input_commitment, run_id, occurred_at
  )
  values (
    audit_id,
    p_action::programmable_private.source_identifier,
    programmable_private.caller_role_name(),
    p_input_commitment::programmable_private.bytes32_value,
    p_run_id,
    p_occurred_at
  );
  return audit_id;
end
$function$;

create function programmable_private.assert_current_epoch(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_id uuid,
  p_generation bigint
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from programmable_private.release_epoch_current as current_epoch
    where current_epoch.chain_id = p_chain_id
      and current_epoch.release_id = p_release_id
      and current_epoch.model_id = p_model_id
      and current_epoch.source_group = p_source_group
      and current_epoch.epoch_id = p_epoch_id
      and current_epoch.generation = p_generation
  ) then
    raise exception using
      errcode = '40001',
      message = 'stale release epoch or pointer generation';
  end if;
end
$function$;

create function programmable_private.create_release_epoch(
  p_epoch_id uuid,
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_number bigint,
  p_epoch_commitment bytea,
  p_artifact_creation_code_commitment bytea,
  p_input_commitment bytea,
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
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_epoch_id is null
     or p_chain_id <= 0
     or p_epoch_number <= 0
     or pg_catalog.octet_length(p_epoch_commitment) <> 32
     or pg_catalog.octet_length(p_artifact_creation_code_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid release epoch input';
  end if;

  audit_id := programmable_private.append_mutation_audit(
    'release_epoch.create', p_input_commitment, null, p_created_at
  );
  insert into programmable_private.release_epochs (
    epoch_id, chain_id, release_id, model_id, source_group, epoch_number,
    epoch_commitment, artifact_creation_code_commitment, created_at,
    created_by_audit_id
  )
  values (
    p_epoch_id,
    p_chain_id::programmable_private.chain_id_value,
    p_release_id::programmable_private.release_identifier,
    p_model_id::programmable_private.model_identifier,
    p_source_group::programmable_private.source_identifier,
    p_epoch_number,
    p_epoch_commitment::programmable_private.bytes32_value,
    p_artifact_creation_code_commitment::programmable_private.bytes32_value,
    p_created_at,
    audit_id
  );
  return p_epoch_id;
end
$function$;

create function programmable_private.append_release_source_binding(
  p_binding_id uuid,
  p_epoch_id uuid,
  p_source_name text,
  p_source_role text,
  p_source_type text,
  p_source_address bytea,
  p_recovery_selector bytea,
  p_inclusive_start_block numeric,
  p_abi_event_set_commitment bytea,
  p_artifact_creation_code_commitment bytea,
  p_binding_commitment bytea,
  p_input_commitment bytea,
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
  normalized_block bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_binding_id is null
     or p_inclusive_start_block <> pg_catalog.trunc(p_inclusive_start_block)
     or p_inclusive_start_block < 0
     or p_inclusive_start_block > 9223372036854775807
     or pg_catalog.octet_length(p_abi_event_set_commitment) <> 32
     or pg_catalog.octet_length(p_artifact_creation_code_commitment) <> 32
     or pg_catalog.octet_length(p_binding_commitment) <> 32
     or (p_recovery_selector is not null
       and pg_catalog.octet_length(p_recovery_selector) <> 4)
  then
    raise exception using errcode = '22023', message = 'invalid release binding input';
  end if;
  if not exists (
    select 1
    from programmable_private.release_epochs as epoch
    where epoch.epoch_id = p_epoch_id
      and epoch.artifact_creation_code_commitment
        = p_artifact_creation_code_commitment
  ) then
    raise exception using
      errcode = '23514',
      message = 'release binding artifact commitment mismatch';
  end if;
  if exists (
    select 1
    from programmable_private.release_epoch_current as current_epoch
    where current_epoch.epoch_id = p_epoch_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'active release epoch bindings are immutable';
  end if;
  normalized_block := p_inclusive_start_block::bigint;
  audit_id := programmable_private.append_mutation_audit(
    'release_binding.append', p_input_commitment, null, p_created_at
  );
  insert into programmable_private.release_source_bindings (
    binding_id, epoch_id, source_name, source_role, source_type, source_address,
    recovery_selector,
    inclusive_start_block, abi_event_set_commitment,
    artifact_creation_code_commitment, binding_commitment, created_at,
    created_by_audit_id
  )
  values (
    p_binding_id,
    p_epoch_id,
    p_source_name::programmable_private.source_identifier,
    p_source_role::programmable_private.source_identifier,
    p_source_type::programmable_private.source_type,
    case when p_source_address is null then null
      else p_source_address::programmable_private.eth_address end,
    case when p_recovery_selector is null then null
      else p_recovery_selector::programmable_private.hex_selector end,
    normalized_block::programmable_private.block_number_value,
    p_abi_event_set_commitment::programmable_private.bytes32_value,
    p_artifact_creation_code_commitment::programmable_private.bytes32_value,
    p_binding_commitment::programmable_private.bytes32_value,
    p_created_at,
    audit_id
  );
  return p_binding_id;
end
$function$;

create function programmable_private.activate_release_epoch(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_id uuid,
  p_expected_generation bigint,
  p_next_generation bigint,
  p_input_commitment bytea,
  p_changed_at timestamptz default pg_catalog.clock_timestamp()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  audit_id uuid;
  old_epoch_id uuid;
  actual_generation bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_chain_id <= 0
     or p_expected_generation < 0
     or p_next_generation <> p_expected_generation + 1
     or pg_catalog.octet_length(p_input_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid release pointer CAS';
  end if;
  if not exists (
    select 1
    from programmable_private.release_epochs as epoch
    where epoch.epoch_id = p_epoch_id
      and epoch.chain_id = p_chain_id
      and epoch.release_id = p_release_id
      and epoch.model_id = p_model_id
      and epoch.source_group = p_source_group
  ) then
    raise exception using errcode = '23503', message = 'epoch does not match release scope';
  end if;

  if p_expected_generation = 0 then
    audit_id := programmable_private.append_mutation_audit(
      'release_epoch.activate', p_input_commitment, null, p_changed_at
    );
    insert into programmable_private.release_epoch_current (
      chain_id, release_id, model_id, source_group, epoch_id, generation,
      changed_at, changed_by_audit_id
    )
    values (
      p_chain_id::programmable_private.chain_id_value,
      p_release_id::programmable_private.release_identifier,
      p_model_id::programmable_private.model_identifier,
      p_source_group::programmable_private.source_identifier,
      p_epoch_id, p_next_generation, p_changed_at, audit_id
    )
    on conflict (chain_id, release_id, model_id, source_group) do nothing;
    if not found then
      raise exception using errcode = '40001', message = 'release pointer CAS lost';
    end if;
    old_epoch_id := null;
  else
    select current_epoch.epoch_id, current_epoch.generation
      into old_epoch_id, actual_generation
    from programmable_private.release_epoch_current as current_epoch
    where current_epoch.chain_id = p_chain_id
      and current_epoch.release_id = p_release_id
      and current_epoch.model_id = p_model_id
      and current_epoch.source_group = p_source_group
    for update;
    if not found or actual_generation <> p_expected_generation then
      raise exception using errcode = '40001', message = 'release pointer CAS lost';
    end if;
    audit_id := programmable_private.append_mutation_audit(
      'release_epoch.activate', p_input_commitment, null, p_changed_at
    );
    update programmable_private.release_epoch_current
    set epoch_id = p_epoch_id,
        generation = p_next_generation,
        changed_at = p_changed_at,
        changed_by_audit_id = audit_id
    where chain_id = p_chain_id
      and release_id = p_release_id
      and model_id = p_model_id
      and source_group = p_source_group
      and generation = p_expected_generation;
    if not found then
      raise exception using errcode = '40001', message = 'release pointer CAS lost';
    end if;
  end if;

  insert into programmable_private.release_epoch_pointer_history (
    history_id, chain_id, release_id, model_id, source_group,
    previous_epoch_id, next_epoch_id, previous_generation, next_generation,
    changed_at, changed_by_audit_id
  )
  values (
    pg_catalog.gen_random_uuid(),
    p_chain_id::programmable_private.chain_id_value,
    p_release_id::programmable_private.release_identifier,
    p_model_id::programmable_private.model_identifier,
    p_source_group::programmable_private.source_identifier,
    old_epoch_id, p_epoch_id, p_expected_generation, p_next_generation,
    p_changed_at, audit_id
  );
  return true;
end
$function$;

create function programmable_private.register_provider_deployment(
  p_provider_deployment_id uuid,
  p_provider_type text,
  p_redacted_identity text,
  p_deployment_commitment bytea,
  p_schema_commitment bytea,
  p_input_commitment bytea,
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
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_provider_type = 'rpc_provider' then
    raise exception using
      errcode = '42501',
      message = 'RPC providers require specialized deployment registration';
  end if;
  if p_provider_deployment_id is null
     or p_redacted_identity is null
     or pg_catalog.octet_length(p_deployment_commitment) <> 32
     or pg_catalog.octet_length(p_schema_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid provider commitment';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'provider_deployment.register', p_input_commitment, null, p_created_at
  );
  insert into programmable_private.provider_deployments (
    provider_deployment_id, provider_type, redacted_identity,
    deployment_commitment, schema_commitment, created_at, created_by_audit_id
  )
  values (
    p_provider_deployment_id,
    p_provider_type::programmable_private.source_type,
    p_redacted_identity::programmable_private.source_identifier,
    p_deployment_commitment::programmable_private.bytes32_value,
    p_schema_commitment::programmable_private.bytes32_value,
    p_created_at,
    audit_id
  );
  return p_provider_deployment_id;
end
$function$;

create function programmable_private.register_rpc_provider_deployment(
  p_provider_deployment_id uuid,
  p_chain_id bigint,
  p_vendor text,
  p_constructor_version text,
  p_endpoint_url_commitment bytea,
  p_endpoint_origin_commitment bytea,
  p_endpoint_evidence_domain text,
  p_endpoint_evidence_commitment bytea,
  p_deployment_commitment bytea,
  p_schema_commitment bytea,
  p_input_commitment bytea,
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
  resolved_vendor_order smallint;
  resolved_identity text;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_provider_deployment_id is null
     or p_chain_id <> 1
     or p_vendor not in ('alchemy', 'quicknode')
     or p_constructor_version is null
     or p_endpoint_evidence_domain <> 'rpc-endpoint-commitments-v1'
     or pg_catalog.octet_length(p_endpoint_url_commitment) <> 32
     or pg_catalog.octet_length(p_endpoint_origin_commitment) <> 32
     or pg_catalog.octet_length(p_endpoint_evidence_commitment) <> 32
     or pg_catalog.octet_length(p_deployment_commitment) <> 32
     or pg_catalog.octet_length(p_schema_commitment) <> 32
     or pg_catalog.octet_length(p_input_commitment) <> 32
     or p_endpoint_url_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_endpoint_origin_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_endpoint_evidence_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_deployment_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_schema_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_input_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  then
    raise exception using
      errcode = '22023',
      message = 'invalid RPC provider deployment metadata';
  end if;
  if not exists (
    select 1
    from programmable_private.rpc_endpoint_evidence_domains as domain_row
    where domain_row.evidence_domain = p_endpoint_evidence_domain
      and domain_row.enabled
  ) then
    raise exception using
      errcode = '22023',
      message = 'RPC endpoint evidence domain is not enabled';
  end if;

  resolved_vendor_order := case p_vendor
    when 'alchemy' then 1::smallint
    else 2::smallint
  end;
  resolved_identity := 'rpc:1:' || p_vendor;
  audit_id := programmable_private.append_mutation_audit(
    'rpc_provider_deployment.register', p_input_commitment, null, p_created_at
  );
  insert into programmable_private.provider_deployments (
    provider_deployment_id, provider_type, redacted_identity,
    deployment_commitment, schema_commitment, created_at, created_by_audit_id
  ) values (
    p_provider_deployment_id, 'rpc_provider',
    resolved_identity::programmable_private.source_identifier,
    p_deployment_commitment::programmable_private.bytes32_value,
    p_schema_commitment::programmable_private.bytes32_value,
    p_created_at, audit_id
  );
  insert into programmable_private.rpc_provider_deployment_metadata (
    provider_deployment_id, chain_id, vendor, vendor_order,
    constructor_version, endpoint_url_commitment,
    endpoint_origin_commitment, endpoint_evidence_domain,
    endpoint_evidence_commitment
  ) values (
    p_provider_deployment_id,
    p_chain_id::programmable_private.chain_id_value,
    p_vendor::programmable_private.source_identifier,
    resolved_vendor_order,
    p_constructor_version::programmable_private.projector_identifier,
    p_endpoint_url_commitment::programmable_private.bytes32_value,
    p_endpoint_origin_commitment::programmable_private.bytes32_value,
    p_endpoint_evidence_domain::programmable_private.source_identifier,
    p_endpoint_evidence_commitment::programmable_private.bytes32_value
  );
  return p_provider_deployment_id;
end
$function$;

create function programmable_private.open_run(
  p_run_id uuid,
  p_run_kind text,
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_id uuid,
  p_pointer_generation bigint,
  p_worker_version text,
  p_request_commitment bytea,
  p_started_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  kind programmable_private.run_kind;
  expected_role name;
  audit_id uuid;
begin
  kind := p_run_kind::programmable_private.run_kind;
  expected_role := case
    when kind in ('ingestion', 'projection', 'rewind') then 'programmable_projector'::name
    when kind = 'reconciliation' then 'programmable_reconciler'::name
    when kind = 'maintenance' then 'programmable_maintenance'::name
    else 'programmable_profile_recovery'::name
  end;
  perform programmable_private.assert_caller(expected_role);
  perform programmable_private.assert_current_epoch(
    p_chain_id, p_release_id, p_model_id, p_source_group,
    p_epoch_id, p_pointer_generation
  );
  if p_run_id is null or pg_catalog.octet_length(p_request_commitment) <> 32 then
    raise exception using errcode = '22023', message = 'invalid run header';
  end if;

  audit_id := programmable_private.append_mutation_audit(
    'run.open', p_request_commitment, null, p_started_at
  );
  insert into programmable_private.run_headers (
    run_id, run_kind, chain_id, release_id, model_id, source_group, epoch_id,
    captured_pointer_generation, worker_version, request_commitment,
    caller_role, started_at, opened_by_audit_id
  )
  values (
    p_run_id, kind,
    p_chain_id::programmable_private.chain_id_value,
    p_release_id::programmable_private.release_identifier,
    p_model_id::programmable_private.model_identifier,
    p_source_group::programmable_private.source_identifier,
    p_epoch_id, p_pointer_generation,
    p_worker_version::programmable_private.projector_identifier,
    p_request_commitment::programmable_private.bytes32_value,
    programmable_private.caller_role_name(),
    p_started_at,
    audit_id
  );
  return p_run_id;
end
$function$;

create function programmable_private.append_run_outcome(
  p_outcome_id uuid,
  p_run_id uuid,
  p_status text,
  p_result_commitment bytea,
  p_finished_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  audit_id uuid;
begin
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'unknown run';
  end if;
  perform programmable_private.assert_caller(header.caller_role);
  if p_status = 'succeeded' then
    perform programmable_private.assert_current_epoch(
      header.chain_id, header.release_id, header.model_id, header.source_group,
      header.epoch_id, header.captured_pointer_generation
    );
  end if;
  if exists (
    select 1 from programmable_private.run_lifecycle_outcomes
    where run_id = p_run_id
  ) then
    raise exception using errcode = '23505', message = 'run is already terminal';
  end if;
  if p_outcome_id is null or pg_catalog.octet_length(p_result_commitment) <> 32 then
    raise exception using errcode = '22023', message = 'invalid run outcome';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'run.outcome.append', p_result_commitment, p_run_id, p_finished_at
  );
  insert into programmable_private.run_lifecycle_outcomes (
    outcome_id, run_id, status, result_commitment, caller_role,
    finished_at, audit_id
  )
  values (
    p_outcome_id, p_run_id, p_status::programmable_private.run_status,
    p_result_commitment::programmable_private.bytes32_value,
    programmable_private.caller_role_name(), p_finished_at, audit_id
  );
  return p_outcome_id;
end
$function$;

create function programmable_private.append_run_telemetry(
  p_telemetry_id uuid,
  p_run_id uuid,
  p_sample_kind text,
  p_sampled_at timestamptz,
  p_duration_ms bigint,
  p_item_count bigint,
  p_diagnostic_sample jsonb,
  p_failed_or_reorg boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
begin
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown run';
  end if;
  perform programmable_private.assert_caller(header.caller_role);
  if exists (
    select 1 from programmable_private.run_lifecycle_outcomes
    where run_id = p_run_id
  ) then
    raise exception using errcode = '55000', message = 'run is terminal';
  end if;
  if p_duration_ms < 0 or p_item_count < 0
     or pg_catalog.octet_length(p_diagnostic_sample::text) > 8192
  then
    raise exception using errcode = '22023', message = 'invalid telemetry sample';
  end if;
  insert into programmable_private.run_telemetry (
    telemetry_id, run_id, sample_kind, sampled_at, duration_ms, item_count,
    diagnostic_sample, failed_or_reorg
  )
  values (
    p_telemetry_id, p_run_id,
    p_sample_kind::programmable_private.source_identifier,
    p_sampled_at, p_duration_ms, p_item_count, p_diagnostic_sample,
    p_failed_or_reorg
  );
  return p_telemetry_id;
end
$function$;

create function programmable_private.append_safe_head_observation(
  p_observation_id uuid,
  p_run_id uuid,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_reported_chain_id_a bigint,
  p_reported_chain_id_b bigint,
  p_head_a numeric,
  p_head_b numeric,
  p_finality_depth bigint,
  p_safe_block_number numeric,
  p_safe_block_hash_a bytea,
  p_safe_block_hash_b bytea,
  p_encoding_version smallint,
  p_canonical_preimage bytea,
  p_content_fingerprint bytea,
  p_observed_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  identity_a text;
  identity_b text;
  rpc_chain_id_a bigint;
  rpc_chain_id_b bigint;
  vendor_a text;
  vendor_b text;
  vendor_order_a smallint;
  vendor_order_b smallint;
  normalized_head_a bigint;
  normalized_head_b bigint;
  normalized_safe bigint;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_provider_evidence_encoding(
    'safe_head', p_encoding_version, p_canonical_preimage,
    p_content_fingerprint
  );
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind in ('ingestion', 'projection', 'rewind')
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'invalid projector run';
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
  if p_provider_a_id = p_provider_b_id then
    raise exception using errcode = '22023', message = 'RPC providers must differ';
  end if;
  select deployment.redacted_identity, metadata.chain_id,
         metadata.vendor, metadata.vendor_order
  into identity_a, rpc_chain_id_a, vendor_a, vendor_order_a
  from programmable_private.provider_deployments as deployment
  join programmable_private.rpc_provider_deployment_metadata as metadata
    on metadata.provider_deployment_id = deployment.provider_deployment_id
  where deployment.provider_deployment_id = p_provider_a_id
    and deployment.provider_type = 'rpc_provider';
  if not found then
    raise exception using errcode = '22023', message = 'invalid first RPC deployment';
  end if;
  select deployment.redacted_identity, metadata.chain_id,
         metadata.vendor, metadata.vendor_order
  into identity_b, rpc_chain_id_b, vendor_b, vendor_order_b
  from programmable_private.provider_deployments as deployment
  join programmable_private.rpc_provider_deployment_metadata as metadata
    on metadata.provider_deployment_id = deployment.provider_deployment_id
  where deployment.provider_deployment_id = p_provider_b_id
    and deployment.provider_type = 'rpc_provider';
  if not found then
    raise exception using errcode = '22023', message = 'invalid second RPC deployment';
  end if;
  if identity_a = identity_b
     or rpc_chain_id_a <> header.chain_id
     or rpc_chain_id_b <> header.chain_id
     or vendor_a <> 'alchemy'
     or vendor_order_a <> 1
     or vendor_b <> 'quicknode'
     or vendor_order_b <> 2
  then
    raise exception using
      errcode = '22023',
      message = 'RPC deployments violate the canonical mainnet vendor order';
  end if;
  if p_reported_chain_id_a <> header.chain_id
     or p_reported_chain_id_b <> header.chain_id
     or p_head_a <> pg_catalog.trunc(p_head_a)
     or p_head_b <> pg_catalog.trunc(p_head_b)
     or p_safe_block_number <> pg_catalog.trunc(p_safe_block_number)
     or p_head_a < 12 or p_head_b < 12
     or p_head_a > 9223372036854775807
     or p_head_b > 9223372036854775807
     or p_safe_block_number < 0
     or p_safe_block_number > 9223372036854775807
  then
    raise exception using errcode = '22023', message = 'invalid RPC chain/head observation';
  end if;
  normalized_head_a := p_head_a::bigint;
  normalized_head_b := p_head_b::bigint;
  normalized_safe := p_safe_block_number::bigint;
  if p_finality_depth <> 12
     or normalized_safe <> least(normalized_head_a, normalized_head_b) - 12
     or pg_catalog.octet_length(p_safe_block_hash_a) <> 32
     or p_safe_block_hash_a <> p_safe_block_hash_b
  then
    raise exception using errcode = '22023', message = 'dual-RPC safe-head gate failed';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'safe_head.append', p_content_fingerprint, p_run_id, p_observed_at
  );
  insert into programmable_private.safe_head_observations (
    observation_id, epoch_id, chain_id, release_id, model_id, source_group,
    pointer_generation, provider_a_id, provider_b_id, reported_chain_id_a,
    reported_chain_id_b, head_a, head_b, finality_depth, safe_block_number,
    safe_block_hash_a, safe_block_hash_b, agreed_safe_block_hash,
    encoding_version, canonical_preimage, content_fingerprint,
    verification_run_id, observed_at
  )
  values (
    p_observation_id, header.epoch_id, header.chain_id, header.release_id,
    header.model_id, header.source_group, header.captured_pointer_generation,
    p_provider_a_id, p_provider_b_id,
    p_reported_chain_id_a::programmable_private.chain_id_value,
    p_reported_chain_id_b::programmable_private.chain_id_value,
    normalized_head_a::programmable_private.block_number_value,
    normalized_head_b::programmable_private.block_number_value,
    p_finality_depth,
    normalized_safe::programmable_private.block_number_value,
    p_safe_block_hash_a::programmable_private.bytes32_value,
    p_safe_block_hash_b::programmable_private.bytes32_value,
    p_safe_block_hash_a::programmable_private.bytes32_value,
    p_encoding_version, p_canonical_preimage,
    p_content_fingerprint::programmable_private.bytes32_value,
    p_run_id, p_observed_at
  );
  perform audit_id;
  return p_observation_id;
end
$function$;

create function programmable_private.append_dual_rpc_block_evidence(
  p_block_evidence_id uuid,
  p_observation_id uuid,
  p_run_id uuid,
  p_block_number numeric,
  p_provider_a_block_hash bytea,
  p_provider_b_block_hash bytea,
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
  observation programmable_private.safe_head_observations%rowtype;
  header programmable_private.run_headers%rowtype;
  normalized_block bigint;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_provider_evidence_encoding(
    'block', p_encoding_version, p_canonical_preimage,
    p_content_fingerprint
  );
  select * into observation
  from programmable_private.safe_head_observations
  where observation_id = p_observation_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown safe-head observation';
  end if;
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind in ('ingestion', 'projection', 'rewind')
  for share;
  if not found
     or header.epoch_id <> observation.epoch_id
     or header.captured_pointer_generation <> observation.pointer_generation
  then
    raise exception using errcode = '23503', message = 'run and observation scope differ';
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
  if p_block_number <> pg_catalog.trunc(p_block_number)
     or p_block_number < 0
     or p_block_number > observation.safe_block_number
     or p_block_number > 9223372036854775807
  then
    raise exception using errcode = '22023', message = 'block exceeds accepted safe head';
  end if;
  normalized_block := p_block_number::bigint;
  if pg_catalog.octet_length(p_provider_a_block_hash) <> 32
     or p_provider_a_block_hash <> p_provider_b_block_hash
  then
    raise exception using errcode = '22023', message = 'per-block RPC evidence disagrees';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'block_evidence.append', p_content_fingerprint, p_run_id, p_verified_at
  );
  insert into programmable_private.dual_rpc_block_evidence (
    block_evidence_id, observation_id, epoch_id, chain_id,
    pointer_generation, block_number, provider_a_block_hash,
    provider_b_block_hash, agreed_block_hash, encoding_version,
    canonical_preimage, content_fingerprint, verification_run_id, verified_at
  )
  values (
    p_block_evidence_id, p_observation_id, observation.epoch_id,
    observation.chain_id, observation.pointer_generation,
    normalized_block::programmable_private.block_number_value,
    p_provider_a_block_hash::programmable_private.bytes32_value,
    p_provider_b_block_hash::programmable_private.bytes32_value,
    p_provider_a_block_hash::programmable_private.bytes32_value,
    p_encoding_version, p_canonical_preimage,
    p_content_fingerprint::programmable_private.bytes32_value,
    p_run_id, p_verified_at
  );
  perform audit_id;
  return p_block_evidence_id;
end
$function$;

create function programmable_private.acquire_projector_lease(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_projector_version text,
  p_epoch_id uuid,
  p_pointer_generation bigint,
  p_expected_lease_generation bigint,
  p_next_lease_generation bigint,
  p_lease_token_hash bytea,
  p_holder_id text,
  p_acquired_at timestamptz,
  p_expires_at timestamptz,
  p_input_commitment bytea
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  current_generation bigint;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_current_epoch(
    p_chain_id, p_release_id, p_model_id, p_source_group,
    p_epoch_id, p_pointer_generation
  );
  if p_expected_lease_generation < 0
     or p_next_lease_generation <> p_expected_lease_generation + 1
     or pg_catalog.octet_length(p_lease_token_hash) <> 32
     or p_expires_at <= p_acquired_at
     or p_expires_at > p_acquired_at + interval '10 minutes'
  then
    raise exception using errcode = '22023', message = 'invalid projector lease CAS';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'projector_lease.acquire', p_input_commitment, null, p_acquired_at
  );
  if p_expected_lease_generation = 0 then
    insert into programmable_private.projector_lease_current (
      chain_id, release_id, model_id, source_group, projector_version,
      epoch_id, pointer_generation, lease_generation, lease_token_hash,
      holder_id, acquired_at, expires_at, changed_by_audit_id
    )
    values (
      p_chain_id::programmable_private.chain_id_value,
      p_release_id::programmable_private.release_identifier,
      p_model_id::programmable_private.model_identifier,
      p_source_group::programmable_private.source_identifier,
      p_projector_version::programmable_private.projector_identifier,
      p_epoch_id, p_pointer_generation, p_next_lease_generation,
      p_lease_token_hash::programmable_private.bytes32_value,
      p_holder_id::programmable_private.source_identifier,
      p_acquired_at, p_expires_at, audit_id
    )
    on conflict (
      chain_id, release_id, model_id, source_group, projector_version
    ) do nothing;
    if not found then
      raise exception using errcode = '40001', message = 'projector lease CAS lost';
    end if;
  else
    select lease_generation into current_generation
    from programmable_private.projector_lease_current
    where chain_id = p_chain_id
      and release_id = p_release_id
      and model_id = p_model_id
      and source_group = p_source_group
      and projector_version = p_projector_version
    for update;
    if not found or current_generation <> p_expected_lease_generation then
      raise exception using errcode = '40001', message = 'projector lease CAS lost';
    end if;
    update programmable_private.projector_lease_current
    set epoch_id = p_epoch_id,
        pointer_generation = p_pointer_generation,
        lease_generation = p_next_lease_generation,
        lease_token_hash = p_lease_token_hash::programmable_private.bytes32_value,
        holder_id = p_holder_id::programmable_private.source_identifier,
        acquired_at = p_acquired_at,
        expires_at = p_expires_at,
        changed_by_audit_id = audit_id
    where chain_id = p_chain_id
      and release_id = p_release_id
      and model_id = p_model_id
      and source_group = p_source_group
      and projector_version = p_projector_version
      and lease_generation = p_expected_lease_generation;
    if not found then
      raise exception using errcode = '40001', message = 'projector lease CAS lost';
    end if;
  end if;
  insert into programmable_private.projector_lease_history (
    lease_history_id, chain_id, release_id, model_id, source_group,
    projector_version, epoch_id, pointer_generation, previous_generation,
    lease_generation, lease_token_hash, holder_id, acquired_at, expires_at,
    audit_id
  )
  values (
    pg_catalog.gen_random_uuid(),
    p_chain_id::programmable_private.chain_id_value,
    p_release_id::programmable_private.release_identifier,
    p_model_id::programmable_private.model_identifier,
    p_source_group::programmable_private.source_identifier,
    p_projector_version::programmable_private.projector_identifier,
    p_epoch_id, p_pointer_generation, p_expected_lease_generation,
    p_next_lease_generation,
    p_lease_token_hash::programmable_private.bytes32_value,
    p_holder_id::programmable_private.source_identifier,
    p_acquired_at, p_expires_at, audit_id
  );
  return true;
end
$function$;

create function programmable_private.append_dependency_health(
  p_health_event_id uuid,
  p_run_id uuid,
  p_dependency text,
  p_circuit_status text,
  p_failure_count integer,
  p_observed_at timestamptz,
  p_retry_after timestamptz,
  p_detail_commitment bytea
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if not exists (
    select 1 from programmable_private.run_headers
    where run_id = p_run_id and run_kind = 'reconciliation'
  ) then
    raise exception using errcode = '23503', message = 'invalid reconciliation run';
  end if;
  if exists (
    select 1 from programmable_private.run_lifecycle_outcomes
    where run_id = p_run_id
  ) then
    raise exception using errcode = '55000', message = 'run is terminal';
  end if;
  if p_failure_count < 0 or pg_catalog.octet_length(p_detail_commitment) <> 32 then
    raise exception using errcode = '22023', message = 'invalid health evidence';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'dependency_health.append', p_detail_commitment, p_run_id, p_observed_at
  );
  insert into programmable_private.dependency_health_history (
    health_event_id, dependency, circuit_status, failure_count, observed_at,
    retry_after, detail_commitment, run_id, audit_id
  )
  values (
    p_health_event_id,
    p_dependency::programmable_private.source_identifier,
    p_circuit_status::programmable_private.dependency_health_status,
    p_failure_count, p_observed_at, p_retry_after,
    p_detail_commitment::programmable_private.bytes32_value,
    p_run_id, audit_id
  );
  insert into programmable_private.dependency_health_current (
    dependency, health_event_id, circuit_status, observed_at
  )
  values (
    p_dependency::programmable_private.source_identifier,
    p_health_event_id,
    p_circuit_status::programmable_private.dependency_health_status,
    p_observed_at
  )
  on conflict (dependency) do update
    set health_event_id = excluded.health_event_id,
        circuit_status = excluded.circuit_status,
        observed_at = excluded.observed_at
    where programmable_private.dependency_health_current.observed_at
      < excluded.observed_at;
  return p_health_event_id;
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

grant usage on schema programmable_private
  to programmable_projector, programmable_reconciler;

grant execute on function programmable_private.create_release_epoch(
  uuid, bigint, text, text, text, bigint, bytea, bytea, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.append_release_source_binding(
  uuid, uuid, text, text, text, bytea, bytea, numeric,
  bytea, bytea, bytea, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.activate_release_epoch(
  bigint, text, text, text, uuid, bigint, bigint, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.register_provider_deployment(
  uuid, text, text, bytea, bytea, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.register_rpc_provider_deployment(
  uuid, bigint, text, text, bytea, bytea, text, bytea,
  bytea, bytea, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.open_run(
  uuid, text, bigint, text, text, text, uuid, bigint, text, bytea, timestamptz
) to programmable_projector, programmable_reconciler;
grant execute on function programmable_private.append_run_outcome(
  uuid, uuid, text, bytea, timestamptz
) to programmable_projector, programmable_reconciler;
grant execute on function programmable_private.append_run_telemetry(
  uuid, uuid, text, timestamptz, bigint, bigint, jsonb, boolean
) to programmable_projector, programmable_reconciler;
grant execute on function programmable_private.append_safe_head_observation(
  uuid, uuid, uuid, uuid, bigint, bigint, numeric, numeric, bigint, numeric,
  bytea, bytea, smallint, bytea, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.append_dual_rpc_block_evidence(
  uuid, uuid, uuid, numeric, bytea, bytea, smallint, bytea, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.acquire_projector_lease(
  bigint, text, text, text, text, uuid, bigint, bigint, bigint, bytea,
  text, timestamptz, timestamptz, bytea
) to programmable_projector;
grant execute on function programmable_private.append_dependency_health(
  uuid, uuid, text, text, integer, timestamptz, timestamptz, bytea
) to programmable_reconciler;

reset role;
