-- Classic V3 dynamic activation and first reward seed staging.
--
-- Runtime/model proofs are persisted by a non-cursor-advancing ingestion run.
-- The first allocation seed is materialized only inside the normal projection
-- transaction, after its exact occurrences exist. Canonical selection remains
-- exclusively owned by promote_projection_run_v3.

set role programmable_migrator;

create table programmable_private.provisional_dynamic_parent_receipt_ordinals (
  provisional_page_id uuid not null
    references programmable_private.provisional_dynamic_parent_pages(
      provisional_page_id
    ) on delete restrict,
  parent_candidate_id
    programmable_private.envio_candidate_identifier not null,
  receipt_log_ordinal
    programmable_private.receipt_log_ordinal_value not null,
  staging_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  staged_at timestamptz not null,
  primary key (provisional_page_id, parent_candidate_id),
  unique (provisional_page_id, receipt_log_ordinal)
);

create table programmable_private.dynamic_source_activation_staging (
  activation_id uuid primary key,
  staging_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null check (chain_id = 1),
  release_id programmable_private.release_identifier not null
    check (release_id = 'classic-v3'),
  model_id programmable_private.model_identifier not null
    check (model_id = 'classic'),
  source_group programmable_private.source_identifier not null
    check (source_group = 'core'),
  projector_version programmable_private.projector_identifier not null,
  release_epoch_id uuid not null,
  release_pointer_generation bigint not null
    check (release_pointer_generation > 0),
  reorg_generation bigint not null check (reorg_generation >= 0),
  expected_cursor_generation bigint not null
    check (expected_cursor_generation >= 0),
  expected_cursor_block_hash
    programmable_private.bytes32_value not null,
  envio_provider_deployment_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_a_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_b_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_a_identity programmable_private.source_identifier not null,
  provider_b_identity programmable_private.source_identifier not null,
  provider_a_vendor programmable_private.source_identifier not null,
  provider_b_vendor programmable_private.source_identifier not null,
  provider_a_endpoint_url_commitment
    programmable_private.bytes32_value not null,
  provider_b_endpoint_url_commitment
    programmable_private.bytes32_value not null,
  provider_a_endpoint_origin_commitment
    programmable_private.bytes32_value not null,
  provider_b_endpoint_origin_commitment
    programmable_private.bytes32_value not null,
  safe_head_observation_id uuid not null
    references programmable_private.safe_head_observations(observation_id)
    on delete restrict,
  activation_block_evidence_id uuid not null
    references programmable_private.dual_rpc_block_evidence(block_evidence_id)
    on delete restrict,
  provisional_page_id uuid not null
    references programmable_private.provisional_dynamic_parent_pages(
      provisional_page_id
    ) on delete restrict,
  provisional_lineage_id uuid not null
    references programmable_private.provisional_dynamic_source_lineages(
      provisional_lineage_id
    ) on delete restrict,
  dynamic_source_attestation_id uuid not null,
  runtime_code_evidence_id uuid not null
    references programmable_private.dual_rpc_runtime_code_evidence(
      runtime_code_evidence_id
    ) on delete restrict,
  dynamic_source_template_id uuid not null
    references programmable_private.release_dynamic_source_templates(
      dynamic_source_template_id
    ) on delete restrict,
  parent_candidate_id
    programmable_private.envio_candidate_identifier not null,
  parent_occurrence_id uuid not null,
  parent_block_number programmable_private.block_number_value not null,
  parent_block_hash programmable_private.bytes32_value not null,
  parent_block_global_log_index
    programmable_private.block_log_index_value not null,
  parent_receipt_log_ordinal
    programmable_private.receipt_log_ordinal_value not null,
  parent_transaction_hash programmable_private.bytes32_value not null,
  parent_transaction_index
    programmable_private.transaction_index_value not null,
  parent_source_address programmable_private.eth_address not null,
  parent_payload_hash programmable_private.bytes32_value not null,
  parent_raw_log_commitment programmable_private.bytes32_value not null,
  launch_candidate_id
    programmable_private.envio_candidate_identifier not null,
  launch_occurrence_id uuid not null,
  launch_block_number programmable_private.block_number_value not null,
  launch_block_hash programmable_private.bytes32_value not null,
  launch_block_global_log_index
    programmable_private.block_log_index_value not null,
  launch_receipt_log_ordinal
    programmable_private.receipt_log_ordinal_value not null,
  launch_transaction_hash programmable_private.bytes32_value not null,
  hook_candidate_id
    programmable_private.envio_candidate_identifier not null,
  hook_occurrence_id uuid not null,
  hook_receipt_log_ordinal
    programmable_private.receipt_log_ordinal_value not null,
  source_address programmable_private.eth_address not null,
  pool_id programmable_private.bytes32_value not null,
  cto_authority programmable_private.eth_address not null,
  ordered_beneficiaries bytea[] not null,
  ordered_shares_bps integer[] not null,
  allocation_hash programmable_private.bytes32_value not null,
  configuration_hash programmable_private.bytes32_value not null,
  active_configuration_hash programmable_private.bytes32_value not null,
  artifact_creation_code_commitment
    programmable_private.bytes32_value not null,
  deployed_artifact_creation_code_commitment
    programmable_private.bytes32_value not null,
  constructor_arguments_commitment
    programmable_private.bytes32_value not null,
  local_init_code_hash programmable_private.bytes32_value not null,
  create2_salt programmable_private.bytes32_value not null,
  predict_result_hash programmable_private.bytes32_value not null,
  activation_payload jsonb not null,
  activation_commitment programmable_private.bytes32_value not null,
  staged_at timestamptz not null,
  foreign key (
    release_epoch_id, chain_id, release_id, model_id, source_group
  ) references programmable_private.release_epochs(
    epoch_id, chain_id, release_id, model_id, source_group
  ) on delete restrict,
  check (provider_a_id <> provider_b_id),
  check (provider_a_vendor = 'alchemy'),
  check (provider_b_vendor = 'quicknode'),
  check (
    launch_block_number = parent_block_number
    and launch_block_hash = parent_block_hash
    and launch_transaction_hash = parent_transaction_hash
    and launch_block_global_log_index > parent_block_global_log_index
  ),
  check (
    programmable_private.valid_beneficiary_set(
      ordered_beneficiaries, ordered_shares_bps, 5
    )
  ),
  check (pg_catalog.octet_length(activation_payload::text) <= 262144),
  unique (
    release_epoch_id, release_pointer_generation,
    source_address, launch_candidate_id
  ),
  unique (release_epoch_id, activation_commitment)
);

create table programmable_private.dynamic_source_activation_model_evidence (
  activation_id uuid not null
    references programmable_private.dynamic_source_activation_staging(
      activation_id
    ) on delete restrict,
  evidence_ordinal smallint not null check (evidence_ordinal between 1 and 3),
  evidence_kind programmable_private.source_identifier not null,
  payload jsonb not null,
  evidence_commitment programmable_private.bytes32_value not null,
  primary key (activation_id, evidence_ordinal),
  unique (activation_id, evidence_kind),
  unique (activation_id, evidence_commitment),
  check (evidence_kind in (
    'classic-v3-runtime-activation-v1',
    'classic-v3-initial-reward-configuration-v1',
    'classic-v3-launch-reward-conservation-v1'
  )),
  check (pg_catalog.octet_length(payload::text) <= 262144)
);

create table programmable_private.dynamic_source_activation_consumptions (
  activation_id uuid primary key
    references programmable_private.dynamic_source_activation_staging(
      activation_id
    ) on delete restrict,
  final_run_id uuid not null,
  publication_id uuid not null
    references programmable_private.projection_publications(publication_id)
    on delete restrict,
  final_execution_evidence_id uuid not null,
  allocation_fact_id uuid not null
    references programmable_private.reward_allocation_facts(allocation_fact_id)
    on delete restrict,
  allocation_evidence_id uuid not null
    references programmable_private.reward_allocation_evidence(
      allocation_evidence_id
    ) on delete restrict,
  consumed_at timestamptz not null,
  unique (final_run_id, activation_id),
  foreign key (final_execution_evidence_id, final_run_id)
    references programmable_private.projection_provider_execution_evidence(
      execution_evidence_id, run_id
    ) on delete restrict
);

alter table programmable_private.provisional_dynamic_parent_receipt_ordinals
  enable row level security;
alter table programmable_private.provisional_dynamic_parent_receipt_ordinals
  force row level security;
alter table programmable_private.dynamic_source_activation_staging
  enable row level security;
alter table programmable_private.dynamic_source_activation_staging
  force row level security;
alter table programmable_private.dynamic_source_activation_model_evidence
  enable row level security;
alter table programmable_private.dynamic_source_activation_model_evidence
  force row level security;
alter table programmable_private.dynamic_source_activation_consumptions
  enable row level security;
alter table programmable_private.dynamic_source_activation_consumptions
  force row level security;

create policy provisional_dynamic_parent_receipt_ordinals_migrator_all
on programmable_private.provisional_dynamic_parent_receipt_ordinals
for all to programmable_migrator using (true) with check (true);
create policy dynamic_source_activation_staging_migrator_all
on programmable_private.dynamic_source_activation_staging
for all to programmable_migrator using (true) with check (true);
create policy dynamic_source_activation_model_evidence_migrator_all
on programmable_private.dynamic_source_activation_model_evidence
for all to programmable_migrator using (true) with check (true);
create policy dynamic_source_activation_consumptions_migrator_all
on programmable_private.dynamic_source_activation_consumptions
for all to programmable_migrator using (true) with check (true);

create trigger provisional_dynamic_parent_receipt_ordinals_immutable
before update or delete
on programmable_private.provisional_dynamic_parent_receipt_ordinals
for each row execute function programmable_private.reject_immutable_mutation();
create trigger dynamic_source_activation_staging_immutable
before update or delete
on programmable_private.dynamic_source_activation_staging
for each row execute function programmable_private.reject_immutable_mutation();
create trigger dynamic_source_activation_model_evidence_immutable
before update or delete
on programmable_private.dynamic_source_activation_model_evidence
for each row execute function programmable_private.reject_immutable_mutation();
create trigger dynamic_source_activation_consumptions_immutable
before update or delete
on programmable_private.dynamic_source_activation_consumptions
for each row execute function programmable_private.reject_immutable_mutation();

create function programmable_private.stage_provisional_parent_receipt_ordinals_v1(
  p_provisional_page_id uuid,
  p_run_id uuid,
  p_candidate_ids text[],
  p_receipt_log_ordinals numeric[],
  p_staged_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  page programmable_private.provisional_dynamic_parent_pages%rowtype;
  item record;
  normalized_ordinal bigint;
  existing programmable_private.provisional_dynamic_parent_receipt_ordinals%rowtype;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into page
  from programmable_private.provisional_dynamic_parent_pages
  where provisional_page_id = p_provisional_page_id
    and staging_run_id = p_run_id;
  if not found
     or exists (
       select 1 from programmable_private.run_lifecycle_outcomes
       where run_id = p_run_id
     )
     or p_staged_at is null
     or coalesce(pg_catalog.cardinality(p_candidate_ids), 0) < 1
     or pg_catalog.cardinality(p_candidate_ids)
       <> pg_catalog.cardinality(p_receipt_log_ordinals)
     or p_candidate_ids is distinct from page.parent_candidate_ids::text[]
  then
    raise exception using
      errcode = '23514', message = 'invalid provisional receipt ordinals';
  end if;
  for item in
    select candidate_id, receipt_ordinal
    from pg_catalog.unnest(p_candidate_ids, p_receipt_log_ordinals)
      as requested(candidate_id, receipt_ordinal)
  loop
    if item.receipt_ordinal <> pg_catalog.trunc(item.receipt_ordinal)
       or item.receipt_ordinal < 0
       or item.receipt_ordinal > 4294967295
    then
      raise exception using
        errcode = '22023', message = 'invalid provisional receipt ordinal';
    end if;
    normalized_ordinal := item.receipt_ordinal::bigint;
    select * into existing
    from programmable_private.provisional_dynamic_parent_receipt_ordinals
    where provisional_page_id = p_provisional_page_id
      and parent_candidate_id = item.candidate_id;
    if found then
      if existing.receipt_log_ordinal <> normalized_ordinal
         or existing.staging_run_id <> p_run_id
      then
        raise exception using
          errcode = '23505', message = 'provisional receipt replay changed';
      end if;
    else
      insert into programmable_private.provisional_dynamic_parent_receipt_ordinals (
        provisional_page_id, parent_candidate_id, receipt_log_ordinal,
        staging_run_id, staged_at
      ) values (
        p_provisional_page_id,
        item.candidate_id::programmable_private.envio_candidate_identifier,
        normalized_ordinal, p_run_id, p_staged_at
      );
    end if;
  end loop;
  return p_provisional_page_id;
end
$function$;

create function programmable_private.resolve_pending_dynamic_source_activations_v1(
  p_projector_version text,
  p_expected_cursor_generation bigint,
  p_expected_cursor_block_hash bytea,
  p_expected_reorg_generation bigint
)
returns table (
  provisional_page_id uuid,
  provisional_lineage_id uuid,
  dynamic_source_attestation_id uuid,
  runtime_code_evidence_id uuid,
  dynamic_source_template_id uuid,
  parent_candidate_id text,
  parent_receipt_log_ordinal bigint,
  parent_candidate_commitment bytea,
  safe_head_observation_id uuid,
  target_block_evidence_id uuid,
  source_address bytea,
  release_epoch_id uuid,
  release_pointer_generation bigint,
  reorg_generation bigint,
  envio_provider_deployment_id uuid,
  provider_a_id uuid,
  provider_b_id uuid,
  provider_a_identity text,
  provider_b_identity text,
  provider_a_vendor text,
  provider_b_vendor text,
  provider_a_endpoint_url_commitment bytea,
  provider_b_endpoint_url_commitment bytea,
  provider_a_endpoint_origin_commitment bytea,
  provider_b_endpoint_origin_commitment bytea,
  manifest_artifact_creation_code_commitment bytea,
  deployed_artifact_creation_code_commitment bytea
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_reorg bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_projector_version is null
     or p_expected_cursor_generation < 0
     or pg_catalog.octet_length(p_expected_cursor_block_hash) <> 32
     or p_expected_reorg_generation < 0
  then
    raise exception using
      errcode = '22023', message = 'invalid activation resolution fence';
  end if;
  select programmable_private.get_projector_reorg_generation_v1()
    into current_reorg;
  if current_reorg <> p_expected_reorg_generation then
    raise exception using
      errcode = '40001', message = 'activation reorg generation changed';
  end if;

  return query
  select source.provisional_page_id,
    source.provisional_lineage_id,
    source.dynamic_source_attestation_id,
    source.runtime_code_evidence_id,
    source.dynamic_source_template_id,
    source.factory_candidate_id,
    receipt.receipt_log_ordinal::bigint,
    source.parent_candidate_commitment,
    page.safe_head_observation_id,
    page.target_block_evidence_id,
    source.deployed_source_address,
    source.release_epoch_id,
    source.release_pointer_generation,
    source.reorg_generation,
    source.envio_provider_deployment_id,
    source.rpc_provider_a_id,
    source.rpc_provider_b_id,
    provider_a.redacted_identity::text,
    provider_b.redacted_identity::text,
    metadata_a.vendor::text,
    metadata_b.vendor::text,
    metadata_a.endpoint_url_commitment::bytea,
    metadata_b.endpoint_url_commitment::bytea,
    metadata_a.endpoint_origin_commitment::bytea,
    metadata_b.endpoint_origin_commitment::bytea,
    factory_binding.artifact_creation_code_commitment::bytea,
    template.deployed_artifact_creation_code_commitment::bytea
  from programmable_private.get_current_provisional_dynamic_sources_v1(
    p_projector_version
  ) as source
  join programmable_private.provisional_dynamic_parent_pages as page
    on page.provisional_page_id = source.provisional_page_id
   and page.expected_cursor_generation = p_expected_cursor_generation
   and page.expected_cursor_block_hash = p_expected_cursor_block_hash
   and page.reorg_generation = p_expected_reorg_generation
  join programmable_private.provisional_dynamic_parent_receipt_ordinals
    as receipt
    on receipt.provisional_page_id = source.provisional_page_id
   and receipt.parent_candidate_id = source.factory_candidate_id
  join programmable_private.provider_deployments as provider_a
    on provider_a.provider_deployment_id = source.rpc_provider_a_id
   and provider_a.provider_type = 'rpc_provider'
  join programmable_private.provider_deployments as provider_b
    on provider_b.provider_deployment_id = source.rpc_provider_b_id
   and provider_b.provider_type = 'rpc_provider'
   and provider_b.provider_deployment_id <> provider_a.provider_deployment_id
  join programmable_private.rpc_provider_deployment_metadata as metadata_a
    on metadata_a.provider_deployment_id = provider_a.provider_deployment_id
   and metadata_a.chain_id = 1
   and metadata_a.vendor = 'alchemy'
   and metadata_a.vendor_order = 1
  join programmable_private.rpc_provider_deployment_metadata as metadata_b
    on metadata_b.provider_deployment_id = provider_b.provider_deployment_id
   and metadata_b.chain_id = 1
   and metadata_b.vendor = 'quicknode'
   and metadata_b.vendor_order = 2
  join programmable_private.release_dynamic_source_templates as template
    on template.dynamic_source_template_id =
      source.dynamic_source_template_id
   and template.epoch_id = source.release_epoch_id
  join programmable_private.release_source_bindings as factory_binding
    on factory_binding.binding_id =
      template.parent_factory_release_binding_id
   and factory_binding.epoch_id = source.release_epoch_id
   and factory_binding.source_role = 'vault_factory'
  where source.release_epoch_id = (
      select current_epoch.epoch_id
      from programmable_private.release_epoch_current as current_epoch
      where current_epoch.chain_id = 1
        and current_epoch.release_id = 'classic-v3'
        and current_epoch.model_id = 'classic'
        and current_epoch.source_group = 'core'
    )
    and source.deployed_source_address is not null
    and not exists (
      select 1
      from programmable_private.dynamic_source_activation_staging as staged
      where staged.release_epoch_id = source.release_epoch_id
        and staged.release_pointer_generation =
          source.release_pointer_generation
        and staged.source_address = source.deployed_source_address
        and staged.reorg_generation = p_expected_reorg_generation
        and staged.parent_candidate_id = source.factory_candidate_id
        and staged.parent_block_hash = source.factory_block_hash
    )
  order by source.factory_block_number,
    source.factory_block_global_log_index,
    source.provisional_lineage_id;
end
$function$;

create function programmable_private.stage_verified_dynamic_source_activations_v1(
  p_run_id uuid,
  p_projector_version text,
  p_release_epoch_id uuid,
  p_release_pointer_generation bigint,
  p_reorg_generation bigint,
  p_expected_cursor_generation bigint,
  p_expected_cursor_block_hash bytea,
  p_envio_provider_deployment_id uuid,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_safe_head_observation_id uuid,
  p_activation_block_evidence_id uuid,
  p_activations jsonb,
  p_model_evidence jsonb,
  p_staged_at timestamptz
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  cursor programmable_private.envio_ingestion_cursor_current%rowtype;
  provider_a record;
  provider_b record;
  block_evidence programmable_private.dual_rpc_block_evidence%rowtype;
  item jsonb;
  evidence_item jsonb;
  evidence_count integer;
  evidence_kinds text[];
  allocation_accounts bytea[];
  allocation_shares integer[];
  existing programmable_private.dynamic_source_activation_staging%rowtype;
  inserted_count integer := 0;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_run_id is null
     or p_projector_version is null
     or p_release_epoch_id is null
     or p_release_pointer_generation < 1
     or p_reorg_generation < 0
     or p_expected_cursor_generation < 0
     or pg_catalog.octet_length(p_expected_cursor_block_hash) <> 32
     or p_envio_provider_deployment_id is null
     or p_provider_a_id is null
     or p_provider_b_id is null
     or p_provider_a_id = p_provider_b_id
     or p_safe_head_observation_id is null
     or p_activation_block_evidence_id is null
     or p_activations is null
     or pg_catalog.jsonb_typeof(p_activations) <> 'array'
     or pg_catalog.jsonb_array_length(p_activations) not between 1 and 32
     or pg_catalog.octet_length(p_activations::text) > 1048576
     or p_model_evidence is null
     or pg_catalog.jsonb_typeof(p_model_evidence) <> 'array'
     or pg_catalog.jsonb_array_length(p_model_evidence)
       <> pg_catalog.jsonb_array_length(p_activations) * 3
     or pg_catalog.octet_length(p_model_evidence::text) > 2097152
     or p_staged_at is null
  then
    raise exception using
      errcode = '22023', message = 'invalid dynamic activation stage';
  end if;

  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'ingestion'
  for share;
  if not found
     or header.chain_id <> 1
     or header.release_id <> 'envio-control'
     or header.model_id <> 'envio-control'
     or header.source_group <> 'canonical-events'
     or exists (
       select 1 from programmable_private.run_lifecycle_outcomes
       where run_id = p_run_id
     )
  then
    raise exception using
      errcode = '55000', message = 'dynamic activation run is not open';
  end if;
  perform programmable_private.assert_current_epoch(
    1, 'classic-v3', 'classic', 'core',
    p_release_epoch_id, p_release_pointer_generation
  );
  if programmable_private.get_projector_reorg_generation_v1()
       <> p_reorg_generation
  then
    raise exception using
      errcode = '40001', message = 'dynamic activation reorg changed';
  end if;
  select * into cursor
  from programmable_private.envio_ingestion_cursor_current
  where chain_id = 1
    and provider_deployment_id = p_envio_provider_deployment_id
    and stream_id = 'canonical-events';
  if not found
     or cursor.generation <> p_expected_cursor_generation
     or cursor.block_hash <> p_expected_cursor_block_hash
  then
    raise exception using
      errcode = '40001', message = 'dynamic activation cursor changed';
  end if;

  select deployment.redacted_identity::text as identity,
    metadata.vendor::text as vendor,
    metadata.endpoint_url_commitment,
    metadata.endpoint_origin_commitment
  into provider_a
  from programmable_private.provider_deployments as deployment
  join programmable_private.rpc_provider_deployment_metadata as metadata
    on metadata.provider_deployment_id = deployment.provider_deployment_id
   and metadata.chain_id = 1
   and metadata.vendor = 'alchemy'
   and metadata.vendor_order = 1
  where deployment.provider_deployment_id = p_provider_a_id
    and deployment.provider_type = 'rpc_provider';
  select deployment.redacted_identity::text as identity,
    metadata.vendor::text as vendor,
    metadata.endpoint_url_commitment,
    metadata.endpoint_origin_commitment
  into provider_b
  from programmable_private.provider_deployments as deployment
  join programmable_private.rpc_provider_deployment_metadata as metadata
    on metadata.provider_deployment_id = deployment.provider_deployment_id
   and metadata.chain_id = 1
   and metadata.vendor = 'quicknode'
   and metadata.vendor_order = 2
  where deployment.provider_deployment_id = p_provider_b_id
    and deployment.provider_type = 'rpc_provider';
  if provider_a.identity is null
     or provider_b.identity is null
     or provider_a.identity = provider_b.identity
     or provider_a.endpoint_url_commitment =
       provider_b.endpoint_url_commitment
     or provider_a.endpoint_origin_commitment =
       provider_b.endpoint_origin_commitment
  then
    raise exception using
      errcode = '23514', message = 'dynamic activation providers are not independent';
  end if;
  select block.* into block_evidence
  from programmable_private.dual_rpc_block_evidence as block
  join programmable_private.safe_head_observations as observation
    on observation.observation_id = block.observation_id
   and observation.epoch_id = block.epoch_id
   and observation.chain_id = block.chain_id
   and observation.pointer_generation = block.pointer_generation
  where block.block_evidence_id = p_activation_block_evidence_id
    and block.observation_id = p_safe_head_observation_id
    and block.verification_run_id = p_run_id
    and block.epoch_id = header.epoch_id
    and block.pointer_generation = header.captured_pointer_generation
    and block.chain_id = 1
    and block.provider_a_block_hash = block.provider_b_block_hash
    and observation.verification_run_id = p_run_id
    and observation.provider_a_id = p_provider_a_id
    and observation.provider_b_id = p_provider_b_id
    and observation.reported_chain_id_a = 1
    and observation.reported_chain_id_b = 1;
  if not found then
    raise exception using
      errcode = '23514', message = 'dynamic activation block evidence changed';
  end if;

  for item in
    select value from pg_catalog.jsonb_array_elements(p_activations)
  loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
       or (item ->> 'activationId') is null
       or (item ->> 'provisionalPageId') is null
       or (item ->> 'provisionalLineageId') is null
       or (item ->> 'sourceAddress') is null
       or (item ->> 'activationCommitment') is null
       or pg_catalog.lower(item ->> 'launchBlockHash') <>
         '0x' || pg_catalog.encode(block_evidence.agreed_block_hash, 'hex')
       or (item ->> 'launchBlockNumber')::bigint <>
         block_evidence.block_number
    then
      raise exception using
        errcode = '23514', message = 'invalid dynamic activation payload';
    end if;
    if not exists (
      select 1
      from programmable_private.provisional_dynamic_parent_pages as page
      join programmable_private.provisional_dynamic_source_lineages as lineage
        on lineage.provisional_page_id = page.provisional_page_id
      join programmable_private.release_dynamic_source_templates as template
        on template.dynamic_source_template_id =
          lineage.dynamic_source_template_id
       and template.epoch_id = page.release_epoch_id
      join programmable_private.release_source_bindings as factory_binding
        on factory_binding.binding_id =
          template.parent_factory_release_binding_id
       and factory_binding.epoch_id = page.release_epoch_id
       and factory_binding.source_role = 'vault_factory'
      join programmable_private.provisional_dynamic_parent_receipt_ordinals
        as receipt
        on receipt.provisional_page_id = page.provisional_page_id
       and receipt.parent_candidate_id = lineage.parent_candidate_id
      where page.provisional_page_id =
          (item ->> 'provisionalPageId')::uuid
        and lineage.provisional_lineage_id =
          (item ->> 'provisionalLineageId')::uuid
        and lineage.dynamic_source_attestation_id =
          (item ->> 'dynamicSourceAttestationId')::uuid
        and lineage.runtime_code_evidence_id =
          (item ->> 'runtimeCodeEvidenceId')::uuid
        and lineage.dynamic_source_template_id =
          (item ->> 'dynamicSourceTemplateId')::uuid
        and lineage.parent_candidate_id::text =
          item ->> 'parentCandidateId'
        and receipt.receipt_log_ordinal =
          (item ->> 'parentReceiptLogOrdinal')::bigint
        and lineage.deployed_source_address = pg_catalog.decode(
          pg_catalog.substring(item ->> 'sourceAddress', 3), 'hex'
        )
        and page.release_epoch_id = p_release_epoch_id
        and page.release_pointer_generation = p_release_pointer_generation
        and page.reorg_generation = p_reorg_generation
        and page.expected_cursor_generation = p_expected_cursor_generation
        and page.expected_cursor_block_hash = p_expected_cursor_block_hash
        and page.envio_provider_deployment_id =
          p_envio_provider_deployment_id
        and page.provider_a_id = p_provider_a_id
        and page.provider_b_id = p_provider_b_id
        and factory_binding.artifact_creation_code_commitment =
          pg_catalog.decode(
            pg_catalog.substring(
              item ->> 'artifactCreationCodeCommitment', 3
            ), 'hex'
          )
        and template.deployed_artifact_creation_code_commitment =
          pg_catalog.decode(
            pg_catalog.substring(
              item ->> 'deployedArtifactCreationCodeCommitment', 3
            ), 'hex'
          )
        and page.snapshot_block_number =
          (item ->> 'parentBlockNumber')::bigint
        and page.snapshot_block_hash = pg_catalog.decode(
          pg_catalog.substring(item ->> 'parentBlockHash', 3), 'hex'
        )
    ) then
      raise exception using
        errcode = '23514', message = 'dynamic activation parent changed';
    end if;

    select pg_catalog.count(*),
      pg_catalog.array_agg(
        evidence.value ->> 'evidenceKind'
        order by evidence.value ->> 'evidenceKind'
      )
    into evidence_count, evidence_kinds
    from pg_catalog.jsonb_array_elements(p_model_evidence) as evidence(value)
    where evidence.value ->> 'activationId' = item ->> 'activationId';
    if evidence_count <> 3
       or evidence_kinds is distinct from array[
         'classic-v3-initial-reward-configuration-v1',
         'classic-v3-launch-reward-conservation-v1',
         'classic-v3-runtime-activation-v1'
       ]::text[]
    then
      raise exception using
        errcode = '23514', message = 'activation requires exactly three evidences';
    end if;

    -- Every persisted proof must retain the exact ordered provider tuple. A
    -- length check is not provenance: provider B must be independently bound
    -- through identity, vendor, endpoint and origin commitments.
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_model_evidence) as evidence(value)
      where evidence.value ->> 'activationId' = item ->> 'activationId'
        and evidence.value ->> 'evidenceKind' =
          'classic-v3-runtime-activation-v1'
        and evidence.value -> 'payload' -> 'canonicalDeployment'
          -> 'providerIdentities' = pg_catalog.jsonb_build_array(
            provider_a.identity, provider_b.identity
          )
        and evidence.value -> 'payload' -> 'canonicalDeployment'
          -> 'providerVendorGroups' = pg_catalog.jsonb_build_array(
            provider_a.vendor, provider_b.vendor
          )
        and evidence.value -> 'payload' -> 'canonicalDeployment'
          -> 'providerEndpointCommitments' = pg_catalog.jsonb_build_array(
            '0x' || pg_catalog.encode(
              provider_a.endpoint_url_commitment, 'hex'
            ),
            '0x' || pg_catalog.encode(
              provider_b.endpoint_url_commitment, 'hex'
            )
          )
        and evidence.value -> 'payload' -> 'canonicalDeployment'
          -> 'providerOriginCommitments' = pg_catalog.jsonb_build_array(
            '0x' || pg_catalog.encode(
              provider_a.endpoint_origin_commitment, 'hex'
            ),
            '0x' || pg_catalog.encode(
              provider_b.endpoint_origin_commitment, 'hex'
            )
          )
        and evidence.value -> 'payload' -> 'runtimeObservation'
          -> 'providerIdentities' = pg_catalog.jsonb_build_array(
            provider_a.identity, provider_b.identity
          )
        and evidence.value -> 'payload' -> 'runtimeObservation'
          -> 'providerVendorGroups' = pg_catalog.jsonb_build_array(
            provider_a.vendor, provider_b.vendor
          )
        and evidence.value -> 'payload' -> 'runtimeObservation'
          -> 'providerEndpointCommitments' = pg_catalog.jsonb_build_array(
            '0x' || pg_catalog.encode(
              provider_a.endpoint_url_commitment, 'hex'
            ),
            '0x' || pg_catalog.encode(
              provider_b.endpoint_url_commitment, 'hex'
            )
          )
        and evidence.value -> 'payload' -> 'runtimeObservation'
          -> 'providerOriginCommitments' = pg_catalog.jsonb_build_array(
            '0x' || pg_catalog.encode(
              provider_a.endpoint_origin_commitment, 'hex'
            ),
            '0x' || pg_catalog.encode(
              provider_b.endpoint_origin_commitment, 'hex'
            )
          )
        and evidence.value -> 'payload' -> 'runtimeObservation'
          -> 'providerCallCounts' = '[1,1]'::jsonb
    ) then
      raise exception using
        errcode = '23514', message = 'activation runtime provider tuple changed';
    end if;

    -- Bind both provider branches and the full exact-block factory proof.
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_model_evidence) as evidence(value)
      where evidence.value ->> 'activationId' = item ->> 'activationId'
        and evidence.value ->> 'evidenceKind' =
          'classic-v3-initial-reward-configuration-v1'
        and evidence.value -> 'payload' ->> 'constructorArgumentsCommitment' =
          item ->> 'constructorArgumentsCommitment'
        and evidence.value -> 'payload' ->> 'factoryConfigurationHash' =
          item ->> 'configurationHash'
        and evidence.value -> 'payload' ->> 'initialActiveConfigurationHash' =
          item ->> 'activeConfigurationHash'
        and evidence.value -> 'payload' ->> 'salt' = item ->> 'create2Salt'
        and evidence.value -> 'payload' ->> 'locallyPredictedVault' =
          item ->> 'sourceAddress'
        and evidence.value -> 'payload' ->> 'ctoAuthority' =
          item ->> 'ctoAuthority'
        and evidence.value -> 'payload' -> 'providerCtoAuthorities' =
          pg_catalog.jsonb_build_array(
            item ->> 'ctoAuthority', item ->> 'ctoAuthority'
          )
        and evidence.value -> 'payload' -> 'factoryProviderCallCounts'
          = '[4,4]'::jsonb
        and pg_catalog.jsonb_array_length(
          evidence.value -> 'payload' -> 'providerFactoryConfigurationHashes'
        ) = 2
        and pg_catalog.jsonb_array_length(
          evidence.value -> 'payload' -> 'providerInitCodeHashes'
        ) = 2
        and pg_catalog.jsonb_array_length(
          evidence.value -> 'payload' -> 'providerPredictedVaults'
        ) = 2
        and pg_catalog.jsonb_array_length(
          evidence.value -> 'payload' -> 'factoryProviderSnapshotCommitments'
        ) = 2
        and evidence.value -> 'payload' -> 'providerFactoryConfigurationHashes'
          ->> 0 = item ->> 'configurationHash'
        and evidence.value -> 'payload' -> 'providerFactoryConfigurationHashes'
          ->> 1 = item ->> 'configurationHash'
        and evidence.value -> 'payload' -> 'providerInitCodeHashes'
          ->> 0 = item ->> 'localInitCodeHash'
        and evidence.value -> 'payload' -> 'providerInitCodeHashes'
          ->> 1 = item ->> 'localInitCodeHash'
        and evidence.value -> 'payload' -> 'providerPredictedVaults'
          ->> 0 = item ->> 'sourceAddress'
        and evidence.value -> 'payload' -> 'providerPredictedVaults'
          ->> 1 = item ->> 'sourceAddress'
        and evidence.value -> 'payload' -> 'endConfigurationSnapshot'
          -> 'providerIdentities' = pg_catalog.jsonb_build_array(
            provider_a.identity, provider_b.identity
          )
        and evidence.value -> 'payload' -> 'endConfigurationSnapshot'
          -> 'providerVendorGroups' = pg_catalog.jsonb_build_array(
            provider_a.vendor, provider_b.vendor
          )
        and evidence.value -> 'payload' -> 'endConfigurationSnapshot'
          -> 'providerEndpointCommitments' = pg_catalog.jsonb_build_array(
            '0x' || pg_catalog.encode(
              provider_a.endpoint_url_commitment, 'hex'
            ),
            '0x' || pg_catalog.encode(
              provider_b.endpoint_url_commitment, 'hex'
            )
          )
        and evidence.value -> 'payload' -> 'endConfigurationSnapshot'
          -> 'providerOriginCommitments' = pg_catalog.jsonb_build_array(
            '0x' || pg_catalog.encode(
              provider_a.endpoint_origin_commitment, 'hex'
            ),
            '0x' || pg_catalog.encode(
              provider_b.endpoint_origin_commitment, 'hex'
            )
          )
    ) then
      raise exception using
        errcode = '23514', message = 'activation factory evidence changed';
    end if;

    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_model_evidence) as evidence(value)
      where evidence.value ->> 'activationId' = item ->> 'activationId'
        and evidence.value ->> 'evidenceKind' =
          'classic-v3-launch-reward-conservation-v1'
        and evidence.value -> 'payload' -> 'rewardEvidence'
          -> 'providerIdentities' = pg_catalog.jsonb_build_array(
            provider_a.identity, provider_b.identity
          )
        and evidence.value -> 'payload' -> 'rewardEvidence'
          -> 'providerVendorGroups' = pg_catalog.jsonb_build_array(
            provider_a.vendor, provider_b.vendor
          )
        and evidence.value -> 'payload' -> 'rewardEvidence'
          -> 'providerEndpointCommitments' = pg_catalog.jsonb_build_array(
            '0x' || pg_catalog.encode(
              provider_a.endpoint_url_commitment, 'hex'
            ),
            '0x' || pg_catalog.encode(
              provider_b.endpoint_url_commitment, 'hex'
            )
          )
        and evidence.value -> 'payload' -> 'rewardEvidence'
          -> 'providerOriginCommitments' = pg_catalog.jsonb_build_array(
            '0x' || pg_catalog.encode(
              provider_a.endpoint_origin_commitment, 'hex'
            ),
            '0x' || pg_catalog.encode(
              provider_b.endpoint_origin_commitment, 'hex'
            )
          )
    ) then
      raise exception using
        errcode = '23514', message = 'activation conservation provider tuple changed';
    end if;

    select pg_catalog.array_agg(
      pg_catalog.decode(
        pg_catalog.substring(allocation.value ->> 'beneficiary', 3), 'hex'
      ) order by (allocation.value ->> 'allocationIndex')::integer
    ), pg_catalog.array_agg(
      (allocation.value ->> 'shareBps')::integer
      order by (allocation.value ->> 'allocationIndex')::integer
    )
    into allocation_accounts, allocation_shares
    from pg_catalog.jsonb_array_elements(item -> 'allocations')
      as allocation(value);
    if not programmable_private.valid_beneficiary_set(
      allocation_accounts, allocation_shares, 5
    ) then
      raise exception using
        errcode = '23514', message = 'invalid activation allocation';
    end if;

    select * into existing
    from programmable_private.dynamic_source_activation_staging
    where activation_id = (item ->> 'activationId')::uuid;
    if found then
      if existing.activation_commitment <> pg_catalog.decode(
           pg_catalog.substring(item ->> 'activationCommitment', 3), 'hex'
         )
         or existing.activation_payload <> item
      then
        raise exception using
          errcode = '23505', message = 'activation replay changed immutable content';
      end if;
      inserted_count := inserted_count + 1;
      continue;
    end if;

    insert into programmable_private.dynamic_source_activation_staging (
      activation_id, staging_run_id, chain_id, release_id, model_id,
      source_group, projector_version, release_epoch_id,
      release_pointer_generation, reorg_generation,
      expected_cursor_generation, expected_cursor_block_hash,
      envio_provider_deployment_id, provider_a_id, provider_b_id,
      provider_a_identity, provider_b_identity,
      provider_a_vendor, provider_b_vendor,
      provider_a_endpoint_url_commitment,
      provider_b_endpoint_url_commitment,
      provider_a_endpoint_origin_commitment,
      provider_b_endpoint_origin_commitment,
      safe_head_observation_id, activation_block_evidence_id,
      provisional_page_id, provisional_lineage_id,
      dynamic_source_attestation_id, runtime_code_evidence_id,
      dynamic_source_template_id, parent_candidate_id,
      parent_occurrence_id, parent_block_number, parent_block_hash,
      parent_block_global_log_index, parent_receipt_log_ordinal,
      parent_transaction_hash, parent_transaction_index,
      parent_source_address, parent_payload_hash,
      parent_raw_log_commitment, launch_candidate_id,
      launch_occurrence_id, launch_block_number, launch_block_hash,
      launch_block_global_log_index, launch_receipt_log_ordinal,
      launch_transaction_hash, hook_candidate_id, hook_occurrence_id,
      hook_receipt_log_ordinal, source_address, pool_id, cto_authority,
      ordered_beneficiaries, ordered_shares_bps,
      allocation_hash, configuration_hash, active_configuration_hash,
      artifact_creation_code_commitment,
      deployed_artifact_creation_code_commitment,
      constructor_arguments_commitment, local_init_code_hash,
      create2_salt, predict_result_hash, activation_payload,
      activation_commitment, staged_at
    ) values (
      (item ->> 'activationId')::uuid, p_run_id, 1, 'classic-v3',
      'classic', 'core', p_projector_version, p_release_epoch_id,
      p_release_pointer_generation, p_reorg_generation,
      p_expected_cursor_generation, p_expected_cursor_block_hash,
      p_envio_provider_deployment_id, p_provider_a_id, p_provider_b_id,
      provider_a.identity, provider_b.identity,
      provider_a.vendor, provider_b.vendor,
      provider_a.endpoint_url_commitment,
      provider_b.endpoint_url_commitment,
      provider_a.endpoint_origin_commitment,
      provider_b.endpoint_origin_commitment,
      p_safe_head_observation_id, p_activation_block_evidence_id,
      (item ->> 'provisionalPageId')::uuid,
      (item ->> 'provisionalLineageId')::uuid,
      (item ->> 'dynamicSourceAttestationId')::uuid,
      (item ->> 'runtimeCodeEvidenceId')::uuid,
      (item ->> 'dynamicSourceTemplateId')::uuid,
      (item ->> 'parentCandidateId')::programmable_private.envio_candidate_identifier,
      (item ->> 'parentOccurrenceId')::uuid,
      (item ->> 'parentBlockNumber')::bigint,
      pg_catalog.decode(pg_catalog.substring(item ->> 'parentBlockHash', 3), 'hex'),
      (item ->> 'parentBlockGlobalLogIndex')::bigint,
      (item ->> 'parentReceiptLogOrdinal')::bigint,
      pg_catalog.decode(pg_catalog.substring(item ->> 'parentTransactionHash', 3), 'hex'),
      (item ->> 'parentTransactionIndex')::bigint,
      pg_catalog.decode(pg_catalog.substring(item ->> 'parentSourceAddress', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'parentPayloadHash', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'parentRawLogCommitment', 3), 'hex'),
      (item ->> 'launchCandidateId')::programmable_private.envio_candidate_identifier,
      (item ->> 'launchOccurrenceId')::uuid,
      (item ->> 'launchBlockNumber')::bigint,
      pg_catalog.decode(pg_catalog.substring(item ->> 'launchBlockHash', 3), 'hex'),
      (item ->> 'launchBlockGlobalLogIndex')::bigint,
      (item ->> 'launchReceiptLogOrdinal')::bigint,
      pg_catalog.decode(pg_catalog.substring(item ->> 'launchTransactionHash', 3), 'hex'),
      (item ->> 'hookCandidateId')::programmable_private.envio_candidate_identifier,
      (item ->> 'hookOccurrenceId')::uuid,
      (item ->> 'hookReceiptLogOrdinal')::bigint,
      pg_catalog.decode(pg_catalog.substring(item ->> 'sourceAddress', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'poolId', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'ctoAuthority', 3), 'hex'),
      allocation_accounts, allocation_shares,
      pg_catalog.decode(pg_catalog.substring(item ->> 'allocationHash', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'configurationHash', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'activeConfigurationHash', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'artifactCreationCodeCommitment', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'deployedArtifactCreationCodeCommitment', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'constructorArgumentsCommitment', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'localInitCodeHash', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'create2Salt', 3), 'hex'),
      pg_catalog.decode(pg_catalog.substring(item ->> 'predictResultHash', 3), 'hex'),
      item,
      pg_catalog.decode(pg_catalog.substring(item ->> 'activationCommitment', 3), 'hex'),
      p_staged_at
    );

    for evidence_item in
      select value
      from pg_catalog.jsonb_array_elements(p_model_evidence)
      where value ->> 'activationId' = item ->> 'activationId'
      order by value ->> 'evidenceKind'
    loop
      insert into programmable_private.dynamic_source_activation_model_evidence (
        activation_id, evidence_ordinal, evidence_kind,
        payload, evidence_commitment
      ) values (
        (item ->> 'activationId')::uuid,
        case evidence_item ->> 'evidenceKind'
          when 'classic-v3-initial-reward-configuration-v1' then 1
          when 'classic-v3-launch-reward-conservation-v1' then 2
          else 3
        end,
        (evidence_item ->> 'evidenceKind')::programmable_private.source_identifier,
        evidence_item -> 'payload',
        pg_catalog.decode(
          pg_catalog.substring(evidence_item ->> 'evidenceCommitment', 3),
          'hex'
        )
      );
    end loop;
    inserted_count := inserted_count + 1;
  end loop;
  return inserted_count;
end
$function$;

create function programmable_private.get_dynamic_activation_seed_requests_v1(
  p_projection_run_id uuid,
  p_target_block_number numeric,
  p_target_block_hash bytea
)
returns table (
  activation_id uuid,
  vault bytea,
  ordered_beneficiaries bytea[],
  ordered_shares_bps integer[],
  allocation_hash bytea,
  configuration_hash bytea,
  active_configuration_hash bytea,
  artifact_creation_code_commitment bytea,
  constructor_arguments_commitment bytea,
  local_init_code_hash bytea,
  create2_salt bytea,
  predict_result_hash bytea,
  factory_occurrence_id uuid,
  factory_transaction_hash bytea,
  factory_receipt_log_ordinal bigint,
  factory_block_hash bytea,
  creation_block_number bigint,
  creation_transaction_index bigint,
  required_occurrences jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_open_projection_run_v1(
    p_projection_run_id
  );
  select * into header
  from programmable_private.run_headers
  where run_id = p_projection_run_id and run_kind = 'projection';
  if header.run_id is null
     or header.chain_id <> 1
     or header.release_id <> 'classic-v3'
     or header.model_id <> 'classic'
     or header.source_group <> 'core'
     or p_target_block_number <> pg_catalog.trunc(p_target_block_number)
     or p_target_block_number < 0
     or pg_catalog.octet_length(p_target_block_hash) <> 32
  then
    raise exception using
      errcode = '22023', message = 'invalid activation seed request';
  end if;

  return query
  select staged.activation_id,
    staged.source_address::bytea,
    staged.ordered_beneficiaries,
    staged.ordered_shares_bps,
    staged.allocation_hash::bytea,
    staged.configuration_hash::bytea,
    staged.active_configuration_hash::bytea,
    staged.artifact_creation_code_commitment::bytea,
    staged.constructor_arguments_commitment::bytea,
    staged.local_init_code_hash::bytea,
    staged.create2_salt::bytea,
    staged.predict_result_hash::bytea,
    factory.occurrence_id,
    factory.transaction_hash::bytea,
    factory.receipt_log_ordinal::bigint,
    factory.block_hash::bytea,
    factory.block_number::bigint,
    factory.transaction_index::bigint,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'role', 'launcher',
        'occurrenceId', launcher.occurrence_id,
        'transactionHash', '0x' || pg_catalog.encode(
          launcher.transaction_hash, 'hex'
        ),
        'receiptLogOrdinal', launcher.receipt_log_ordinal::text,
        'blockHash', '0x' || pg_catalog.encode(launcher.block_hash, 'hex'),
        'contentFingerprint', '0x' || pg_catalog.encode(
          launcher.content_fingerprint, 'hex'
        ),
        'releaseBindingId', launcher.release_binding_id,
        'releaseBindingCommitment', '0x' || pg_catalog.encode(
          launcher_binding.binding_commitment, 'hex'
        )
      ),
      pg_catalog.jsonb_build_object(
        'role', 'vault_factory',
        'occurrenceId', factory.occurrence_id,
        'transactionHash', '0x' || pg_catalog.encode(
          factory.transaction_hash, 'hex'
        ),
        'receiptLogOrdinal', factory.receipt_log_ordinal::text,
        'blockHash', '0x' || pg_catalog.encode(factory.block_hash, 'hex'),
        'contentFingerprint', '0x' || pg_catalog.encode(
          factory.content_fingerprint, 'hex'
        ),
        'releaseBindingId', factory.release_binding_id,
        'releaseBindingCommitment', '0x' || pg_catalog.encode(
          factory_binding.binding_commitment, 'hex'
        )
      ),
      pg_catalog.jsonb_build_object(
        'role', 'hook',
        'occurrenceId', hook.occurrence_id,
        'transactionHash', '0x' || pg_catalog.encode(
          hook.transaction_hash, 'hex'
        ),
        'receiptLogOrdinal', hook.receipt_log_ordinal::text,
        'blockHash', '0x' || pg_catalog.encode(hook.block_hash, 'hex'),
        'contentFingerprint', '0x' || pg_catalog.encode(
          hook.content_fingerprint, 'hex'
        ),
        'releaseBindingId', hook.release_binding_id,
        'releaseBindingCommitment', '0x' || pg_catalog.encode(
          hook_binding.binding_commitment, 'hex'
        )
      )
    )
  from programmable_private.dynamic_source_activation_staging as staged
  join programmable_private.chain_event_materialized_occurrences_v1
    as launcher
    on launcher.occurrence_id = staged.launch_occurrence_id
   and coalesce(
     launcher.first_seen_neutral_candidate_id::text,
     launcher.first_seen_envio_candidate_id::text
   ) = staged.launch_candidate_id::text
   and launcher.verification_run_id = p_projection_run_id
   and launcher.epoch_id = header.epoch_id
   and launcher.pointer_generation = header.captured_pointer_generation
   and launcher.block_number = staged.launch_block_number
   and launcher.block_hash = staged.launch_block_hash
  join programmable_private.release_source_bindings as launcher_binding
    on launcher_binding.binding_id = launcher.release_binding_id
   and launcher_binding.epoch_id = header.epoch_id
   and launcher_binding.source_role = 'launcher'
  join programmable_private.chain_event_materialized_occurrences_v1
    as factory
    on factory.occurrence_id = staged.parent_occurrence_id
   and coalesce(
     factory.first_seen_neutral_candidate_id::text,
     factory.first_seen_envio_candidate_id::text
   ) = staged.parent_candidate_id::text
   and factory.verification_run_id = p_projection_run_id
   and factory.epoch_id = header.epoch_id
   and factory.pointer_generation = header.captured_pointer_generation
   and factory.block_number = staged.parent_block_number
   and factory.block_hash = staged.parent_block_hash
  join programmable_private.release_source_bindings as factory_binding
    on factory_binding.binding_id = factory.release_binding_id
   and factory_binding.epoch_id = header.epoch_id
   and factory_binding.source_role = 'vault_factory'
   and factory_binding.artifact_creation_code_commitment =
     staged.artifact_creation_code_commitment
  join programmable_private.chain_event_materialized_occurrences_v1
    as hook
    on hook.occurrence_id = staged.hook_occurrence_id
   and coalesce(
     hook.first_seen_neutral_candidate_id::text,
     hook.first_seen_envio_candidate_id::text
   ) = staged.hook_candidate_id::text
   and hook.verification_run_id = p_projection_run_id
   and hook.epoch_id = header.epoch_id
   and hook.pointer_generation = header.captured_pointer_generation
   and hook.block_number = staged.launch_block_number
   and hook.block_hash = staged.launch_block_hash
  join programmable_private.release_source_bindings as hook_binding
    on hook_binding.binding_id = hook.release_binding_id
   and hook_binding.epoch_id = header.epoch_id
   and hook_binding.source_role = 'hook'
  where staged.release_epoch_id = header.epoch_id
    and staged.release_pointer_generation =
      header.captured_pointer_generation
    and staged.reorg_generation =
      programmable_private.get_projector_reorg_generation_v1()
    and staged.launch_block_number = p_target_block_number::bigint
    and staged.launch_block_hash = p_target_block_hash
    and staged.parent_block_hash = p_target_block_hash
    and launcher.transaction_hash = staged.launch_transaction_hash
    and launcher.receipt_log_ordinal = staged.launch_receipt_log_ordinal
    and factory.transaction_hash = staged.parent_transaction_hash
    and factory.receipt_log_ordinal = staged.parent_receipt_log_ordinal
    and hook.receipt_log_ordinal = staged.hook_receipt_log_ordinal
    and not exists (
      select 1
      from programmable_private.dynamic_source_activation_consumptions
        as consumed
      where consumed.activation_id = staged.activation_id
    )
  order by staged.activation_id;
end
$function$;

create function programmable_private.materialize_dynamic_activation_seed_v1(
  p_projection_run_id uuid,
  p_activation_id uuid,
  p_allocation_fact_id uuid,
  p_allocation_evidence_id uuid,
  p_required_occurrence_ids uuid[],
  p_required_occurrence_roles text[],
  p_allocation_canonical_preimage bytea,
  p_allocation_content_fingerprint bytea,
  p_evidence_canonical_preimage bytea,
  p_evidence_content_fingerprint bytea,
  p_verified_at timestamptz
)
returns table (
  allocation_fact_id uuid,
  allocation_evidence_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  staged programmable_private.dynamic_source_activation_staging%rowtype;
  factory programmable_private.chain_event_materialized_occurrences_v1%rowtype;
  factory_binding programmable_private.release_source_bindings%rowtype;
  required_id uuid;
  required_role text;
  required_ordinal integer := 0;
  required_materialization programmable_private.chain_event_materialized_occurrences_v1%rowtype;
  required_binding programmable_private.release_source_bindings%rowtype;
  existing_fact programmable_private.reward_allocation_facts%rowtype;
  existing_evidence programmable_private.reward_allocation_evidence%rowtype;
  evidence_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_open_projection_run_v1(
    p_projection_run_id
  );
  perform programmable_private.assert_fingerprint_encoding(
    'allocation', 1, p_allocation_canonical_preimage,
    p_allocation_content_fingerprint
  );
  perform programmable_private.assert_fingerprint_encoding(
    'evidence', 1, p_evidence_canonical_preimage,
    p_evidence_content_fingerprint
  );
  select * into header
  from programmable_private.run_headers
  where run_id = p_projection_run_id and run_kind = 'projection';
  select * into staged
  from programmable_private.dynamic_source_activation_staging
  where activation_id = p_activation_id;
  if header.run_id is null
     or staged.activation_id is null
     or header.chain_id <> staged.chain_id
     or header.release_id <> staged.release_id
     or header.model_id <> staged.model_id
     or header.source_group <> staged.source_group
     or header.epoch_id <> staged.release_epoch_id
     or header.captured_pointer_generation <>
       staged.release_pointer_generation
     or staged.reorg_generation <>
       programmable_private.get_projector_reorg_generation_v1()
     or p_required_occurrence_roles is distinct from
       array['launcher', 'vault_factory', 'hook']::text[]
     or pg_catalog.cardinality(p_required_occurrence_ids) <> 3
     or p_verified_at is null
  then
    raise exception using
      errcode = '23514', message = 'activation seed context changed';
  end if;

  select occurrence.* into factory
  from programmable_private.chain_event_materialized_occurrences_v1
    as occurrence
  where occurrence.occurrence_id = staged.parent_occurrence_id
    and occurrence.verification_run_id = p_projection_run_id
    and occurrence.epoch_id = header.epoch_id
    and occurrence.pointer_generation = header.captured_pointer_generation
    and occurrence.block_number = staged.parent_block_number
    and occurrence.block_hash = staged.parent_block_hash
    and occurrence.transaction_hash = staged.parent_transaction_hash
    and occurrence.receipt_log_ordinal = staged.parent_receipt_log_ordinal;
  select binding.* into factory_binding
  from programmable_private.release_source_bindings as binding
  where binding.binding_id = factory.release_binding_id
    and binding.epoch_id = header.epoch_id
    and binding.source_role = 'vault_factory'
    and binding.artifact_creation_code_commitment =
      staged.artifact_creation_code_commitment;
  if factory.occurrence_id is null or factory_binding.binding_id is null then
    raise exception using
      errcode = '23514', message = 'activation factory materialization changed';
  end if;

  select * into existing_fact
  from programmable_private.reward_allocation_facts
  where allocation_fact_id = p_allocation_fact_id;
  if found then
    if existing_fact.verification_run_id <> p_projection_run_id
       or existing_fact.factory_occurrence_id <> factory.occurrence_id
       or existing_fact.vault <> staged.source_address
       or existing_fact.content_fingerprint <>
         p_allocation_content_fingerprint
       or existing_fact.canonical_preimage <>
         p_allocation_canonical_preimage
    then
      raise exception using
        errcode = '23505', message = 'activation seed fact replay changed';
    end if;
  else
    insert into programmable_private.reward_allocation_facts (
      allocation_fact_id, chain_id, release_id, model_id, epoch_id,
      pointer_generation, vault, factory_occurrence_id,
      factory_release_binding_id, factory_release_binding_commitment,
      factory_logical_event_id, factory_occurrence_block_hash,
      creation_block_number, creation_transaction_index,
      ordered_beneficiaries, ordered_shares_bps, allocation_hash,
      configuration_hash, active_configuration_hash,
      manifest_artifact_creation_code_commitment, encoding_version,
      canonical_preimage, content_fingerprint, verification_run_id,
      created_at
    ) values (
      p_allocation_fact_id, header.chain_id, header.release_id,
      header.model_id, header.epoch_id,
      header.captured_pointer_generation, staged.source_address,
      factory.occurrence_id, factory_binding.binding_id,
      factory_binding.binding_commitment, factory.logical_event_id,
      factory.block_hash, factory.block_number, factory.transaction_index,
      staged.ordered_beneficiaries, staged.ordered_shares_bps,
      staged.allocation_hash, staged.configuration_hash,
      staged.active_configuration_hash,
      staged.artifact_creation_code_commitment, 1,
      p_allocation_canonical_preimage, p_allocation_content_fingerprint,
      p_projection_run_id, p_verified_at
    );
    perform programmable_private.append_mutation_audit(
      'dynamic_activation.reward_allocation_fact.append',
      p_allocation_content_fingerprint,
      p_projection_run_id, p_verified_at
    );

    for required_id, required_role in
      select ids.id, roles.role
      from pg_catalog.unnest(p_required_occurrence_ids)
        with ordinality as ids(id, ordinal)
      join pg_catalog.unnest(p_required_occurrence_roles)
        with ordinality as roles(role, ordinal) using (ordinal)
      order by ids.ordinal
    loop
      select occurrence.* into required_materialization
      from programmable_private.chain_event_materialized_occurrences_v1
        as occurrence
      where occurrence.occurrence_id = required_id
        and occurrence.verification_run_id = p_projection_run_id
        and occurrence.epoch_id = header.epoch_id
        and occurrence.pointer_generation =
          header.captured_pointer_generation
        and occurrence.block_hash = staged.launch_block_hash;
      select binding.* into required_binding
      from programmable_private.release_source_bindings as binding
      where binding.binding_id = required_materialization.release_binding_id
        and binding.epoch_id = header.epoch_id
        and binding.source_role = required_role;
      if required_materialization.occurrence_id is null
         or required_binding.binding_id is null
         or required_id is distinct from (case required_role
           when 'launcher' then staged.launch_occurrence_id
           when 'vault_factory' then staged.parent_occurrence_id
           else staged.hook_occurrence_id
         end)
      then
        raise exception using
          errcode = '23514', message = 'activation required occurrence changed';
      end if;
      insert into programmable_private.reward_allocation_required_occurrences (
        allocation_fact_id, occurrence_ordinal, occurrence_role,
        occurrence_id, release_binding_id, release_binding_commitment
      ) values (
        p_allocation_fact_id, required_ordinal,
        required_role::programmable_private.source_identifier,
        required_id, required_binding.binding_id,
        required_binding.binding_commitment
      );
      required_ordinal := required_ordinal + 1;
    end loop;
  end if;

  select * into existing_evidence
  from programmable_private.reward_allocation_evidence
  where allocation_evidence_id = p_allocation_evidence_id;
  if found then
    if existing_evidence.allocation_fact_id <> p_allocation_fact_id
       or existing_evidence.verification_run_id <> p_projection_run_id
       or existing_evidence.content_fingerprint <>
         p_evidence_content_fingerprint
       or existing_evidence.canonical_preimage <>
         p_evidence_canonical_preimage
    then
      raise exception using
        errcode = '23505', message = 'activation seed evidence replay changed';
    end if;
  else
    evidence_audit_id := programmable_private.append_mutation_audit(
      'dynamic_activation.reward_allocation_evidence.append',
      p_evidence_content_fingerprint,
      p_projection_run_id, p_verified_at
    );
    insert into programmable_private.reward_allocation_evidence (
      allocation_evidence_id, allocation_fact_id, factory_occurrence_id,
      vault, recovery_method, evidence_version,
      recovery_release_binding_id,
      recovery_release_binding_commitment, top_level_destination,
      method_selector, transaction_input_hash,
      recomputed_allocation_hash, recomputed_configuration_hash,
      recomputed_active_configuration_hash, is_recomputation_attested,
      constructor_arguments_commitment, local_init_code_hash,
      create2_salt, local_create2_address,
      historical_enrichment_status, getter_block_hash,
      getter_result_hash_a, getter_result_hash_b,
      predict_result_hash_a, predict_result_hash_b,
      predicted_vault_a, predicted_vault_b,
      selected_rpc_result_hash_a, selected_rpc_result_hash_b,
      selected_rpc_transaction_receipt_hash_a,
      selected_rpc_transaction_receipt_hash_b,
      encoding_version, canonical_preimage, content_fingerprint,
      verification_run_id, verified_at, audit_id
    ) values (
      p_allocation_evidence_id, p_allocation_fact_id,
      factory.occurrence_id, staged.source_address,
      'historical_getters', 'classic-v3-activation-v1',
      factory_binding.binding_id, factory_binding.binding_commitment,
      null, null, null, staged.allocation_hash,
      staged.configuration_hash, staged.active_configuration_hash, true,
      staged.constructor_arguments_commitment,
      staged.local_init_code_hash, staged.create2_salt,
      staged.source_address, 'matched', factory.block_hash,
      staged.active_configuration_hash,
      staged.active_configuration_hash,
      staged.predict_result_hash, staged.predict_result_hash,
      staged.source_address, staged.source_address,
      staged.configuration_hash, staged.configuration_hash,
      null, null, 1, p_evidence_canonical_preimage,
      p_evidence_content_fingerprint, p_projection_run_id,
      p_verified_at, evidence_audit_id
    );
  end if;
  return query select p_allocation_fact_id, p_allocation_evidence_id;
end
$function$;

create function programmable_private.consume_matching_dynamic_activations_v1(
  p_final_run_id uuid,
  p_publication_id uuid,
  p_final_execution_evidence_id uuid,
  p_consumed_at timestamptz
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  publication programmable_private.projection_publications%rowtype;
  execution
    programmable_private.projection_provider_execution_evidence%rowtype;
  staged programmable_private.dynamic_source_activation_staging%rowtype;
  fact programmable_private.reward_allocation_facts%rowtype;
  selected_evidence_id uuid;
  consumed_count integer := 0;
  expected_count integer := 0;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header
  from programmable_private.run_headers
  where run_id = p_final_run_id and run_kind = 'projection';
  select * into publication
  from programmable_private.projection_publications
  where publication_id = p_publication_id
    and run_id = p_final_run_id
    and published_at = p_consumed_at;
  select * into execution
  from programmable_private.projection_provider_execution_evidence
  where execution_evidence_id = p_final_execution_evidence_id
    and run_id = p_final_run_id;
  if header.run_id is null
     or publication.publication_id is null
     or execution.execution_evidence_id is null
  then
    raise exception using
      errcode = '23514', message = 'activation final evidence changed';
  end if;

  -- Count every immutable activation that targets this exact publication.
  -- Starting from staged activations, rather than materialized reward facts,
  -- makes a missing seed a hard promotion failure instead of an accidental
  -- expected_count = 0 success.
  select pg_catalog.count(*)::integer into expected_count
  from programmable_private.dynamic_source_activation_staging as activation
  where activation.release_epoch_id = header.epoch_id
    and activation.release_pointer_generation =
      header.captured_pointer_generation
    and activation.reorg_generation =
      programmable_private.get_projector_reorg_generation_v1()
    and activation.launch_block_number = publication.target_block_number
    and activation.launch_block_hash = publication.target_block_hash
    and activation.parent_block_number = publication.target_block_number
    and activation.parent_block_hash = publication.target_block_hash;

  for staged in
    select activation.*
    from programmable_private.dynamic_source_activation_staging
      as activation
    left join programmable_private.dynamic_source_activation_consumptions
      as consumed
      on consumed.activation_id = activation.activation_id
    where activation.release_epoch_id = header.epoch_id
      and activation.release_pointer_generation =
        header.captured_pointer_generation
      and activation.reorg_generation =
        programmable_private.get_projector_reorg_generation_v1()
      and activation.launch_block_number = publication.target_block_number
      and activation.launch_block_hash = publication.target_block_hash
      and activation.parent_block_number = publication.target_block_number
      and activation.parent_block_hash = publication.target_block_hash
      and consumed.activation_id is null
    order by activation.activation_id
  loop
    select * into fact
    from programmable_private.reward_allocation_facts
    where verification_run_id = p_final_run_id
      and factory_occurrence_id = staged.parent_occurrence_id
      and vault = staged.source_address
      and allocation_hash = staged.allocation_hash
      and configuration_hash = staged.configuration_hash;
    select current_seed.allocation_evidence_id into selected_evidence_id
    from programmable_private.reward_allocation_current_verified
      as current_seed
    where current_seed.allocation_fact_id = fact.allocation_fact_id;
    if staged.reorg_generation <>
         programmable_private.get_projector_reorg_generation_v1()
       or staged.envio_provider_deployment_id <>
         execution.envio_provider_deployment_id
       or staged.provider_a_id <> execution.provider_a_id
       or staged.provider_b_id <> execution.provider_b_id
       or staged.provider_a_identity <> execution.provider_a_identity
       or staged.provider_b_identity <> execution.provider_b_identity
       or staged.provider_a_vendor <> execution.provider_a_vendor
       or staged.provider_b_vendor <> execution.provider_b_vendor
       or staged.provider_a_endpoint_url_commitment <>
         execution.provider_a_endpoint_url_commitment
       or staged.provider_b_endpoint_url_commitment <>
         execution.provider_b_endpoint_url_commitment
       or staged.provider_a_endpoint_origin_commitment <>
         execution.provider_a_endpoint_origin_commitment
       or staged.provider_b_endpoint_origin_commitment <>
         execution.provider_b_endpoint_origin_commitment
       or fact.allocation_fact_id is null
       or selected_evidence_id is null
       or not exists (
         select 1
         from programmable_private.reward_allocation_evidence as evidence
         where evidence.verification_run_id = p_final_run_id
           and evidence.allocation_fact_id = fact.allocation_fact_id
           and evidence.allocation_evidence_id = selected_evidence_id
           and evidence.is_recomputation_attested
       )
       or exists (
         select 1
         from programmable_private.reward_allocation_required_occurrences
           as required
         join programmable_private.chain_event_occurrences as occurrence
           on occurrence.occurrence_id = required.occurrence_id
         left join programmable_private.chain_event_current_canonical
           as canonical
           on canonical.occurrence_id = occurrence.occurrence_id
          and canonical.logical_event_id = occurrence.logical_event_id
          and canonical.block_hash = occurrence.block_hash
         where required.allocation_fact_id = fact.allocation_fact_id
           and (
             canonical.occurrence_id is null
             or occurrence.block_hash <> staged.launch_block_hash
           )
       )
       or (
         select pg_catalog.count(*)
         from programmable_private.dynamic_source_activation_model_evidence
           as model_evidence
         where model_evidence.activation_id = staged.activation_id
       ) <> 3
    then
      raise exception using
        errcode = '23514', message = 'dynamic activation is not promotion eligible';
    end if;
    insert into programmable_private.dynamic_source_activation_consumptions (
      activation_id, final_run_id, publication_id,
      final_execution_evidence_id, allocation_fact_id,
      allocation_evidence_id, consumed_at
    ) values (
      staged.activation_id, p_final_run_id, p_publication_id,
      p_final_execution_evidence_id, fact.allocation_fact_id,
      selected_evidence_id, p_consumed_at
    );
    consumed_count := consumed_count + 1;
  end loop;

  select pg_catalog.count(*)::integer into consumed_count
  from programmable_private.dynamic_source_activation_consumptions
    as consumed
  join programmable_private.dynamic_source_activation_staging as activation
    on activation.activation_id = consumed.activation_id
  join programmable_private.reward_allocation_facts as selected_fact
    on selected_fact.allocation_fact_id = consumed.allocation_fact_id
   and selected_fact.verification_run_id = p_final_run_id
   and selected_fact.factory_occurrence_id = activation.parent_occurrence_id
   and selected_fact.vault = activation.source_address
   and selected_fact.allocation_hash = activation.allocation_hash
   and selected_fact.configuration_hash = activation.configuration_hash
  join programmable_private.reward_allocation_current_verified as current_seed
    on current_seed.allocation_fact_id = selected_fact.allocation_fact_id
  where consumed.final_run_id = p_final_run_id
    and consumed.publication_id = p_publication_id
    and consumed.final_execution_evidence_id =
      p_final_execution_evidence_id
    and activation.release_epoch_id = header.epoch_id
    and activation.release_pointer_generation =
      header.captured_pointer_generation
    and activation.reorg_generation =
      programmable_private.get_projector_reorg_generation_v1()
    and activation.launch_block_number = publication.target_block_number
    and activation.launch_block_hash = publication.target_block_hash
    and activation.parent_block_number = publication.target_block_number
    and activation.parent_block_hash = publication.target_block_hash;
  if consumed_count <> expected_count then
    raise exception using
      errcode = '23514',
      message = 'dynamic activation consumption is incomplete';
  end if;
  return consumed_count;
end
$function$;

-- A noncanonical seed is eligible only in the exact projection run that
-- materialized its occurrences. Canonical seeds remain reusable. This closes
-- the same-height replacement-fork gap for aborted pre-promotion runs.
do $seed_selector_hardening$
declare
  function_definition text;
  hardened_definition text;
  factory_needle text :=
    E'canonical.logical_event_id is null\n        or (';
  factory_replacement text :=
    E'(\n          canonical.logical_event_id is null\n'
    || E'          and factory_occurrence.verification_run_id = header.run_id\n'
    || E'        )\n        or (';
  required_needle text :=
    E'required_canonical.logical_event_id is null\n                or (';
  required_replacement text :=
    E'(\n                  required_canonical.logical_event_id is null\n'
    || E'                  and required_occurrence.verification_run_id = header.run_id\n'
    || E'                )\n                or (';
begin
  select pg_catalog.pg_get_functiondef(procedure.oid)
    into function_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'programmable_private'
    and procedure.proname = 'get_projector_verified_reward_seed_v1'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      = 'p_projection_run_id uuid, p_vault bytea';
  if function_definition is null then
    raise exception 'reward seed selector is unavailable';
  end if;
  if pg_catalog.length(function_definition)
       - pg_catalog.length(pg_catalog.replace(
           function_definition, factory_needle, ''
         )) <> pg_catalog.length(factory_needle)
     or pg_catalog.length(function_definition)
       - pg_catalog.length(pg_catalog.replace(
           function_definition, required_needle, ''
         )) <> pg_catalog.length(required_needle)
  then
    raise exception 'reward seed selector hardening is not exact';
  end if;
  hardened_definition := pg_catalog.replace(
    function_definition, factory_needle, factory_replacement
  );
  hardened_definition := pg_catalog.replace(
    hardened_definition, required_needle, required_replacement
  );
  if hardened_definition = function_definition
     or pg_catalog.length(hardened_definition)
       - pg_catalog.length(pg_catalog.replace(
           hardened_definition, factory_replacement, ''
         )) <> pg_catalog.length(factory_replacement)
     or pg_catalog.length(hardened_definition)
       - pg_catalog.length(pg_catalog.replace(
           hardened_definition, required_replacement, ''
         )) <> pg_catalog.length(required_replacement)
     or pg_catalog.strpos(hardened_definition, factory_needle) <> 0
     or pg_catalog.strpos(hardened_definition, required_needle) <> 0
  then
    raise exception 'reward seed selector hardening did not match';
  end if;
  execute hardened_definition;
end
$seed_selector_hardening$;

-- Preserve the existing promotion implementation and append consumption only
-- after promote_projection_run_v2 has selected every required occurrence and
-- reward seed as canonical.
do $promotion_extension$
declare
  function_definition text;
  extended_definition text;
  needle text :=
    E'  perform programmable_private.consume_matching_provisional_sources_v1(\n'
    || E'    p_run_id, publication_id, p_execution_evidence_id,\n'
    || E'    p_target_block_evidence_id, p_occurrence_ids, p_published_at\n'
    || E'  );\n'
    || '  return publication_id;';
  replacement text :=
    E'  perform programmable_private.consume_matching_provisional_sources_v1(\n'
    || E'    p_run_id, publication_id, p_execution_evidence_id,\n'
    || E'    p_target_block_evidence_id, p_occurrence_ids, p_published_at\n'
    || E'  );\n'
    || E'  perform programmable_private.consume_matching_dynamic_activations_v1(\n'
    || E'    p_run_id, publication_id, p_execution_evidence_id, p_published_at\n'
    || E'  );\n'
    || '  return publication_id;';
begin
  select pg_catalog.pg_get_functiondef(procedure.oid)
    into function_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'programmable_private'
    and procedure.proname = 'promote_projection_run_v3'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
      'p_promotion_mode text, p_publication_id uuid, p_checkpoint_id uuid, p_outcome_id uuid, p_run_id uuid, p_projector_version text, p_lease_generation bigint, p_lease_token_hash bytea, p_expected_checkpoint_generation bigint, p_next_checkpoint_generation bigint, p_reorg_generation bigint, p_safe_head_observation_id uuid, p_target_block_evidence_id uuid, p_target_block_number numeric, p_target_block_hash bytea, p_cursor_block_global_log_index numeric, p_cursor_candidate_id text, p_occurrence_ids uuid[], p_allocation_fact_ids uuid[], p_allocation_evidence_ids uuid[], p_candidate_disposition_ids uuid[], p_route_keys text[], p_result_commitment bytea, p_execution_evidence_id uuid, p_reward_snapshot_evidence_ids uuid[], p_provider_binding_id uuid, p_provider_binding_commitment bytea, p_published_at timestamp with time zone';
  if function_definition is null then
    raise exception 'projection promotion v3 is unavailable';
  end if;
  if pg_catalog.length(function_definition)
       - pg_catalog.length(pg_catalog.replace(
           function_definition, needle, ''
         )) <> pg_catalog.length(needle)
  then
    raise exception 'projection promotion extension is not exact';
  end if;
  extended_definition := pg_catalog.replace(
    function_definition, needle, replacement
  );
  if extended_definition = function_definition
     or pg_catalog.length(extended_definition)
       - pg_catalog.length(pg_catalog.replace(
           extended_definition, replacement, ''
         )) <> pg_catalog.length(replacement)
     or pg_catalog.strpos(extended_definition, needle) <> 0
  then
    raise exception 'projection promotion extension did not match';
  end if;
  execute extended_definition;
end
$promotion_extension$;

revoke all on table
  programmable_private.provisional_dynamic_parent_receipt_ordinals,
  programmable_private.dynamic_source_activation_staging,
  programmable_private.dynamic_source_activation_model_evidence,
  programmable_private.dynamic_source_activation_consumptions
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler,
  programmable_api_reader, programmable_profile_binder,
  programmable_profile_recovery, programmable_profile_writer,
  programmable_maintenance;

revoke all on function
  programmable_private.stage_provisional_parent_receipt_ordinals_v1(
    uuid, uuid, text[], numeric[], timestamptz
  ),
  programmable_private.resolve_pending_dynamic_source_activations_v1(
    text, bigint, bytea, bigint
  ),
  programmable_private.stage_verified_dynamic_source_activations_v1(
    uuid, text, uuid, bigint, bigint, bigint, bytea, uuid, uuid, uuid,
    uuid, uuid, jsonb, jsonb, timestamptz
  ),
  programmable_private.get_dynamic_activation_seed_requests_v1(
    uuid, numeric, bytea
  ),
  programmable_private.materialize_dynamic_activation_seed_v1(
    uuid, uuid, uuid, uuid, uuid[], text[], bytea, bytea, bytea, bytea,
    timestamptz
  ),
  programmable_private.consume_matching_dynamic_activations_v1(
    uuid, uuid, uuid, timestamptz
  )
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler,
  programmable_api_reader, programmable_profile_binder,
  programmable_profile_recovery, programmable_profile_writer,
  programmable_maintenance;

grant execute on function
  programmable_private.stage_provisional_parent_receipt_ordinals_v1(
    uuid, uuid, text[], numeric[], timestamptz
  ),
  programmable_private.resolve_pending_dynamic_source_activations_v1(
    text, bigint, bytea, bigint
  ),
  programmable_private.stage_verified_dynamic_source_activations_v1(
    uuid, text, uuid, bigint, bigint, bigint, bytea, uuid, uuid, uuid,
    uuid, uuid, jsonb, jsonb, timestamptz
  ),
  programmable_private.get_dynamic_activation_seed_requests_v1(
    uuid, numeric, bytea
  ),
  programmable_private.materialize_dynamic_activation_seed_v1(
    uuid, uuid, uuid, uuid, uuid[], text[], bytea, bytea, bytea, bytea,
    timestamptz
  )
to programmable_projector;

reset role;
