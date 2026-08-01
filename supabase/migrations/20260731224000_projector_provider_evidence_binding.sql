-- Promotion-bound provider evidence and atomic reward block groups.

set role programmable_migrator;

insert into programmable_private.fingerprint_encoding_versions (
  fingerprint_domain, encoding_version, domain_prefix, write_enabled,
  definition_commitment, allowlisted_at
) values (
  'evidence', 3,
  pg_catalog.decode(
    '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763300',
    'hex'
  ),
  true,
  pg_catalog.decode(
    '3234e87ac53489e1cfefafa865b053e9723945930d060265c0e8084669a1e955',
    'hex'
  ),
  '2026-08-01T00:00:00Z'
);

insert into programmable_private.provider_evidence_encoding_subtypes (
  evidence_subtype, encoding_version, subtype_tag, frame_prefix,
  definition_commitment
) values
  (
    'projection_execution', 3, 6,
    pg_catalog.decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76330006',
      'hex'
    ),
    pg_catalog.decode(
      '4a101e2e339f883474c6d939016a1189ebd0bbfc3bd6df0a2fba37c5bd5ecf3a',
      'hex'
    )
  ),
  (
    'reward_snapshot', 3, 7,
    pg_catalog.decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76330007',
      'hex'
    ),
    pg_catalog.decode(
      '886a97852a33023bb6edd87bfb79e0acf5d5ededf8008d42cd78cd43ea071a95',
      'hex'
    )
  );

create table programmable_private.projection_provider_execution_evidence (
  execution_evidence_id uuid primary key,
  run_id uuid not null unique
    references programmable_private.run_headers(run_id)
    on delete restrict,
  safe_head_observation_id uuid not null,
  epoch_id uuid not null,
  chain_id programmable_private.chain_id_value not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  configured_provider_deployment_ids uuid[] not null,
  envio_provider_deployment_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_a_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_b_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_a_vendor programmable_private.source_identifier not null,
  provider_b_vendor programmable_private.source_identifier not null,
  provider_a_identity programmable_private.source_identifier not null,
  provider_b_identity programmable_private.source_identifier not null,
  provider_a_endpoint_url_commitment
    programmable_private.bytes32_value not null,
  provider_b_endpoint_url_commitment
    programmable_private.bytes32_value not null,
  provider_a_endpoint_origin_commitment
    programmable_private.bytes32_value not null,
  provider_b_endpoint_origin_commitment
    programmable_private.bytes32_value not null,
  provider_a_call_count smallint not null
    check (provider_a_call_count between 1 and 128),
  provider_b_call_count smallint not null
    check (provider_b_call_count between 1 and 128),
  candidate_batch_size smallint not null
    check (candidate_batch_size between 0 and 4096),
  hard_deadline_ms integer not null
    check (hard_deadline_ms between 10 and 75000),
  maximum_calls_per_provider smallint not null
    check (maximum_calls_per_provider between 1 and 128),
  elapsed_ms integer not null check (elapsed_ms between 0 and 75000),
  execution_trace jsonb not null,
  execution_trace_preimage bytea not null,
  execution_trace_commitment programmable_private.bytes32_value not null,
  encoding_version smallint not null check (encoding_version = 3),
  canonical_preimage bytea not null,
  content_fingerprint programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    safe_head_observation_id, epoch_id, chain_id, pointer_generation
  ) references programmable_private.safe_head_observations(
    observation_id, epoch_id, chain_id, pointer_generation
  ) on delete restrict,
  unique (execution_evidence_id, run_id),
  unique (epoch_id, content_fingerprint),
  check (
    configured_provider_deployment_ids = array[
      envio_provider_deployment_id, provider_a_id, provider_b_id
    ]::uuid[]
  ),
  check (provider_a_id <> provider_b_id),
  check (
    provider_a_vendor = 'alchemy'
    and provider_b_vendor = 'quicknode'
  ),
  check (
    pg_catalog.octet_length(canonical_preimage) >= 35
    and pg_catalog.substring(canonical_preimage, 1, 35) =
      pg_catalog.decode(
        '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76330006',
        'hex'
      )
  )
);

create table programmable_private.reward_snapshot_provider_evidence (
  reward_snapshot_evidence_id uuid primary key,
  run_id uuid not null,
  execution_evidence_id uuid not null,
  safe_head_observation_id uuid not null,
  target_block_evidence_id uuid not null,
  epoch_id uuid not null,
  chain_id programmable_private.chain_id_value not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  vault programmable_private.eth_address not null,
  model_id programmable_private.model_identifier not null,
  reward_model programmable_private.model_identifier not null,
  target_block_number programmable_private.block_number_value not null,
  target_block_hash programmable_private.bytes32_value not null,
  provider_a_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_b_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_a_snapshot_commitment
    programmable_private.bytes32_value not null,
  provider_b_snapshot_commitment
    programmable_private.bytes32_value not null,
  provider_a_call_count integer not null
    check (provider_a_call_count between 1 and 11008),
  provider_b_call_count integer not null
    check (provider_b_call_count between 1 and 11008),
  verification_accounts programmable_private.eth_address[] not null,
  verification_account_chunk_end_offsets integer[] not null,
  provider_a_verification_chunk_commitments
    programmable_private.bytes32_value[] not null,
  provider_b_verification_chunk_commitments
    programmable_private.bytes32_value[] not null,
  provider_a_verification_chunk_call_counts smallint[] not null,
  provider_b_verification_chunk_call_counts smallint[] not null,
  folded_snapshot_preimage bytea not null,
  folded_snapshot_commitment programmable_private.bytes32_value not null,
  execution_trace jsonb not null,
  execution_trace_preimage bytea not null,
  execution_trace_commitment programmable_private.bytes32_value not null,
  encoding_version smallint not null check (encoding_version = 3),
  canonical_preimage bytea not null,
  content_fingerprint programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (execution_evidence_id, run_id)
    references programmable_private.projection_provider_execution_evidence(
      execution_evidence_id, run_id
    ) on delete restrict,
  foreign key (
    target_block_evidence_id, safe_head_observation_id,
    epoch_id, chain_id, pointer_generation
  ) references programmable_private.dual_rpc_block_evidence(
    block_evidence_id, observation_id, epoch_id, chain_id,
    pointer_generation
  ) on delete restrict,
  unique (run_id, vault),
  unique (reward_snapshot_evidence_id, run_id, execution_evidence_id),
  unique (epoch_id, content_fingerprint),
  check (provider_a_id <> provider_b_id),
  check (
    provider_a_snapshot_commitment = provider_b_snapshot_commitment
  ),
  check (provider_a_call_count = provider_b_call_count),
  check (pg_catalog.cardinality(verification_accounts) between 1 and 4096),
  check (
    pg_catalog.cardinality(verification_account_chunk_end_offsets)
      between 1 and 86
    and pg_catalog.cardinality(verification_account_chunk_end_offsets) =
      (
        (pg_catalog.cardinality(verification_accounts) + 47) / 48
      )
    and verification_account_chunk_end_offsets[
      pg_catalog.cardinality(verification_account_chunk_end_offsets)
    ] = pg_catalog.cardinality(verification_accounts)
  ),
  check (
    pg_catalog.cardinality(verification_account_chunk_end_offsets)
      = pg_catalog.cardinality(
        provider_a_verification_chunk_commitments
      )
    and pg_catalog.cardinality(verification_account_chunk_end_offsets)
      = pg_catalog.cardinality(
        provider_b_verification_chunk_commitments
      )
    and pg_catalog.cardinality(verification_account_chunk_end_offsets)
      = pg_catalog.cardinality(
        provider_a_verification_chunk_call_counts
      )
    and pg_catalog.cardinality(verification_account_chunk_end_offsets)
      = pg_catalog.cardinality(
        provider_b_verification_chunk_call_counts
      )
  ),
  check (
    provider_a_verification_chunk_commitments =
      provider_b_verification_chunk_commitments
    and provider_a_verification_chunk_call_counts =
      provider_b_verification_chunk_call_counts
  ),
  check (
    pg_catalog.octet_length(canonical_preimage) >= 35
    and pg_catalog.substring(canonical_preimage, 1, 35) =
      pg_catalog.decode(
        '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76330007',
        'hex'
      )
  )
);

create table programmable_private.projection_publication_provider_bindings (
  provider_binding_id uuid primary key,
  publication_id uuid not null unique
    references programmable_private.projection_publications(publication_id)
    on delete restrict,
  run_id uuid not null unique,
  promotion_mode programmable_private.source_identifier not null,
  execution_evidence_id uuid not null,
  reward_snapshot_evidence_ids uuid[] not null,
  provider_binding_commitment programmable_private.bytes32_value not null,
  bound_at timestamptz not null,
  foreign key (execution_evidence_id, run_id)
    references programmable_private.projection_provider_execution_evidence(
      execution_evidence_id, run_id
    ) on delete restrict,
  check (promotion_mode = 'exact_incremental'),
  check (
    provider_binding_commitment <>
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  )
);

create table programmable_private.projection_publication_reward_evidence (
  provider_binding_id uuid not null
    references programmable_private.projection_publication_provider_bindings(
      provider_binding_id
    ) on delete restrict,
  evidence_ordinal smallint not null check (evidence_ordinal >= 1),
  reward_snapshot_evidence_id uuid not null,
  run_id uuid not null,
  execution_evidence_id uuid not null,
  vault programmable_private.eth_address not null,
  primary key (provider_binding_id, evidence_ordinal),
  unique (provider_binding_id, reward_snapshot_evidence_id),
  unique (provider_binding_id, vault),
  foreign key (
    reward_snapshot_evidence_id, run_id, execution_evidence_id
  ) references programmable_private.reward_snapshot_provider_evidence(
    reward_snapshot_evidence_id, run_id, execution_evidence_id
  ) on delete restrict
);

alter table programmable_private.projection_provider_execution_evidence
  enable row level security;
alter table programmable_private.projection_provider_execution_evidence
  force row level security;
alter table programmable_private.reward_snapshot_provider_evidence
  enable row level security;
alter table programmable_private.reward_snapshot_provider_evidence
  force row level security;
alter table programmable_private.projection_publication_provider_bindings
  enable row level security;
alter table programmable_private.projection_publication_provider_bindings
  force row level security;
alter table programmable_private.projection_publication_reward_evidence
  enable row level security;
alter table programmable_private.projection_publication_reward_evidence
  force row level security;

create policy projection_provider_execution_evidence_migrator_all
on programmable_private.projection_provider_execution_evidence
for all to programmable_migrator using (true) with check (true);

create policy reward_snapshot_provider_evidence_migrator_all
on programmable_private.reward_snapshot_provider_evidence
for all to programmable_migrator using (true) with check (true);

create policy projection_publication_provider_bindings_migrator_all
on programmable_private.projection_publication_provider_bindings
for all to programmable_migrator using (true) with check (true);

create policy projection_publication_reward_evidence_migrator_all
on programmable_private.projection_publication_reward_evidence
for all to programmable_migrator using (true) with check (true);

create trigger projection_provider_execution_evidence_immutable
before update or delete
on programmable_private.projection_provider_execution_evidence
for each row execute function programmable_private.reject_immutable_mutation();

create trigger reward_snapshot_provider_evidence_immutable
before update or delete
on programmable_private.reward_snapshot_provider_evidence
for each row execute function programmable_private.reject_immutable_mutation();

create trigger projection_publication_provider_bindings_immutable
before update or delete
on programmable_private.projection_publication_provider_bindings
for each row execute function programmable_private.reject_immutable_mutation();

create trigger projection_publication_reward_evidence_immutable
before update or delete
on programmable_private.projection_publication_reward_evidence
for each row execute function programmable_private.reject_immutable_mutation();

-- The trace commitment is a frozen structural binary encoding. JSON is only
-- the transport envelope; key order and serializer whitespace never enter the
-- commitment domain.
create function programmable_private.projection_execution_trace_preimage_v1(
  p_execution_trace jsonb
)
returns bytea
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  expected_top_keys text[] := array[
    'calls', 'candidateBatchSize', 'completedAtMs', 'elapsedMs',
    'hardDeadlineMs', 'maxCallsPerProvider', 'providerCallCounts',
    'startedAtMs'
  ];
  expected_call_keys text[] := array[
    'attempt', 'durationMs', 'operation', 'outcome',
    'providerEndpointCommitment', 'providerIdentity',
    'providerOriginCommitment', 'providerVendorGroup',
    'startedOffsetMs'
  ];
  actual_keys text[];
  call_item jsonb;
  call_bytes bytea := ''::bytea;
  identity_bytes bytea;
  vendor_bytes bytea;
  endpoint_bytes bytea;
  origin_bytes bytea;
  operation_tag integer;
  outcome_tag integer;
  started_at numeric;
  completed_at numeric;
  candidate_batch_size numeric;
  hard_deadline numeric;
  maximum_calls numeric;
  elapsed numeric;
  call_count_a numeric;
  call_count_b numeric;
  attempt_number numeric;
  started_offset numeric;
  duration numeric;
begin
  if p_execution_trace is null
     or pg_catalog.jsonb_typeof(p_execution_trace) <> 'object'
  then
    raise exception using
      errcode = '22023', message = 'invalid execution trace encoding';
  end if;
  select pg_catalog.array_agg(key order by key) into actual_keys
  from pg_catalog.jsonb_object_keys(p_execution_trace) as key;
  if actual_keys is distinct from expected_top_keys
     or p_execution_trace ->> 'startedAtMs' !~ '^[0-9]+$'
     or p_execution_trace ->> 'completedAtMs' !~ '^[0-9]+$'
     or p_execution_trace ->> 'candidateBatchSize' !~ '^[0-9]+$'
     or p_execution_trace ->> 'hardDeadlineMs' !~ '^[0-9]+$'
     or p_execution_trace ->> 'maxCallsPerProvider' !~ '^[0-9]+$'
     or p_execution_trace ->> 'elapsedMs' !~ '^[0-9]+$'
     or pg_catalog.jsonb_typeof(
       p_execution_trace -> 'providerCallCounts'
     ) <> 'array'
     or pg_catalog.jsonb_array_length(
       p_execution_trace -> 'providerCallCounts'
     ) <> 2
     or p_execution_trace #>> '{providerCallCounts,0}' !~ '^[0-9]+$'
     or p_execution_trace #>> '{providerCallCounts,1}' !~ '^[0-9]+$'
     or pg_catalog.jsonb_typeof(p_execution_trace -> 'calls') <> 'array'
  then
    raise exception using
      errcode = '22023', message = 'execution trace encoding shape changed';
  end if;

  started_at := (p_execution_trace ->> 'startedAtMs')::numeric;
  completed_at := (p_execution_trace ->> 'completedAtMs')::numeric;
  candidate_batch_size :=
    (p_execution_trace ->> 'candidateBatchSize')::numeric;
  hard_deadline := (p_execution_trace ->> 'hardDeadlineMs')::numeric;
  maximum_calls :=
    (p_execution_trace ->> 'maxCallsPerProvider')::numeric;
  elapsed := (p_execution_trace ->> 'elapsedMs')::numeric;
  call_count_a :=
    (p_execution_trace #>> '{providerCallCounts,0}')::numeric;
  call_count_b :=
    (p_execution_trace #>> '{providerCallCounts,1}')::numeric;
  if started_at not between 0 and 9223372036854775807
     or completed_at not between 0 and 9223372036854775807
     or candidate_batch_size not between 0 and 4096
     or hard_deadline not between 10 and 75000
     or maximum_calls not between 1 and 128
     or elapsed not between 0 and 75000
     or call_count_a not between 0 and 11008
     or call_count_b not between 0 and 11008
     or pg_catalog.trunc(started_at) <> started_at
     or pg_catalog.trunc(completed_at) <> completed_at
     or pg_catalog.trunc(candidate_batch_size) <> candidate_batch_size
     or pg_catalog.trunc(hard_deadline) <> hard_deadline
     or pg_catalog.trunc(maximum_calls) <> maximum_calls
     or pg_catalog.trunc(elapsed) <> elapsed
     or pg_catalog.trunc(call_count_a) <> call_count_a
     or pg_catalog.trunc(call_count_b) <> call_count_b
     or pg_catalog.jsonb_array_length(p_execution_trace -> 'calls') < 1
     or pg_catalog.jsonb_array_length(p_execution_trace -> 'calls') > 256
  then
    raise exception using
      errcode = '22023', message = 'execution trace encoding is out of bounds';
  end if;

  for call_item in
    select value
    from pg_catalog.jsonb_array_elements(p_execution_trace -> 'calls')
      with ordinality as calls(value, ordinality)
    order by ordinality
  loop
    if pg_catalog.jsonb_typeof(call_item) <> 'object' then
      raise exception using
        errcode = '22023', message = 'execution trace call is invalid';
    end if;
    select pg_catalog.array_agg(key order by key) into actual_keys
    from pg_catalog.jsonb_object_keys(call_item) as key;
    if actual_keys is distinct from expected_call_keys
       or call_item ->> 'attempt' !~ '^[0-9]+$'
       or call_item ->> 'startedOffsetMs' !~ '^[0-9]+$'
       or call_item ->> 'durationMs' !~ '^[0-9]+$'
       or call_item ->> 'providerEndpointCommitment'
         !~ '^0x[0-9a-f]{64}$'
       or call_item ->> 'providerOriginCommitment'
         !~ '^0x[0-9a-f]{64}$'
       or coalesce(call_item ->> 'providerIdentity', '') = ''
       or coalesce(call_item ->> 'providerVendorGroup', '') = ''
    then
      raise exception using
        errcode = '22023', message = 'execution trace call shape changed';
    end if;
    identity_bytes := pg_catalog.convert_to(
      call_item ->> 'providerIdentity', 'UTF8'
    );
    vendor_bytes := pg_catalog.convert_to(
      call_item ->> 'providerVendorGroup', 'UTF8'
    );
    endpoint_bytes := pg_catalog.decode(
      pg_catalog.substring(
        call_item ->> 'providerEndpointCommitment', 3
      ), 'hex'
    );
    origin_bytes := pg_catalog.decode(
      pg_catalog.substring(
        call_item ->> 'providerOriginCommitment', 3
      ), 'hex'
    );
    operation_tag := case call_item ->> 'operation'
      when 'getChainId' then 1
      when 'getBlockNumber' then 2
      when 'getBlock' then 3
      when 'getTransactionReceipt' then 4
      when 'getBytecode' then 5
      when 'readRewardSnapshot' then 6
      else 0
    end;
    outcome_tag := case call_item ->> 'outcome'
      when 'success' then 1
      when 'error' then 2
      else 0
    end;
    attempt_number := (call_item ->> 'attempt')::numeric;
    started_offset := (call_item ->> 'startedOffsetMs')::numeric;
    duration := (call_item ->> 'durationMs')::numeric;
    if pg_catalog.octet_length(identity_bytes) not between 1 and 512
       or pg_catalog.octet_length(vendor_bytes) not between 1 and 512
       or operation_tag = 0
       or outcome_tag = 0
       or attempt_number not between 1 and 3
       or started_offset not between 0 and 75000
       or duration not between 0 and 75000
       or pg_catalog.trunc(attempt_number) <> attempt_number
       or pg_catalog.trunc(started_offset) <> started_offset
       or pg_catalog.trunc(duration) <> duration
    then
      raise exception using
        errcode = '22023', message = 'execution trace call is out of bounds';
    end if;
    call_bytes := call_bytes
      || pg_catalog.int4send(pg_catalog.octet_length(identity_bytes))
      || identity_bytes
      || pg_catalog.int4send(pg_catalog.octet_length(vendor_bytes))
      || vendor_bytes
      || endpoint_bytes
      || origin_bytes
      || pg_catalog.decode(pg_catalog.lpad(
        pg_catalog.to_hex(operation_tag), 2, '0'
      ), 'hex')
      || pg_catalog.int4send(attempt_number::integer)
      || pg_catalog.int4send(started_offset::integer)
      || pg_catalog.int4send(duration::integer)
      || pg_catalog.decode(pg_catalog.lpad(
        pg_catalog.to_hex(outcome_tag), 2, '0'
      ), 'hex');
  end loop;

  return pg_catalog.decode(
    '70726f6772616d6d61626c653a70726f6a656374696f6e2d657865637574696f6e2d74726163653a763100',
    'hex'
  )
    || pg_catalog.int8send(started_at::bigint)
    || pg_catalog.int8send(completed_at::bigint)
    || pg_catalog.int4send(candidate_batch_size::integer)
    || pg_catalog.int4send(hard_deadline::integer)
    || pg_catalog.int4send(maximum_calls::integer)
    || pg_catalog.int4send(elapsed::integer)
    || pg_catalog.int4send(call_count_a::integer)
    || pg_catalog.int4send(call_count_b::integer)
    || pg_catalog.int4send(
      pg_catalog.jsonb_array_length(p_execution_trace -> 'calls')
    )
    || call_bytes;
end
$function$;

create function programmable_private.projection_execution_trace_commitment_v1(
  p_execution_trace jsonb
)
returns bytea
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.sha256(
    programmable_private.projection_execution_trace_preimage_v1(
      p_execution_trace
    )
  )
$function$;

create function programmable_private.projection_execution_evidence_preimage_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_id uuid,
  p_pointer_generation bigint,
  p_run_id uuid,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_provider_a_identity text,
  p_provider_b_identity text,
  p_provider_a_vendor_group text,
  p_provider_b_vendor_group text,
  p_provider_a_endpoint_commitment bytea,
  p_provider_b_endpoint_commitment bytea,
  p_provider_a_origin_commitment bytea,
  p_provider_b_origin_commitment bytea,
  p_provider_a_call_count integer,
  p_provider_b_call_count integer,
  p_candidate_batch_size integer,
  p_hard_deadline_ms integer,
  p_maximum_calls_per_provider integer,
  p_elapsed_ms integer,
  p_execution_trace_commitment bytea
)
returns bytea
language sql
immutable
security invoker
set search_path = ''
as $function$
  select
    pg_catalog.decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76330006',
      'hex'
    )
    || pg_catalog.int8send(p_chain_id)
    || pg_catalog.int4send(
      pg_catalog.octet_length(pg_catalog.convert_to(p_release_id, 'UTF8'))
    )
    || pg_catalog.convert_to(p_release_id, 'UTF8')
    || pg_catalog.int4send(
      pg_catalog.octet_length(pg_catalog.convert_to(p_model_id, 'UTF8'))
    )
    || pg_catalog.convert_to(p_model_id, 'UTF8')
    || pg_catalog.int4send(
      pg_catalog.octet_length(pg_catalog.convert_to(p_source_group, 'UTF8'))
    )
    || pg_catalog.convert_to(p_source_group, 'UTF8')
    || pg_catalog.uuid_send(p_epoch_id)
    || pg_catalog.int8send(p_pointer_generation)
    || pg_catalog.uuid_send(p_run_id)
    || pg_catalog.uuid_send(p_provider_a_id)
    || pg_catalog.uuid_send(p_provider_b_id)
    || pg_catalog.int4send(
      pg_catalog.octet_length(pg_catalog.convert_to(p_provider_a_identity, 'UTF8'))
    )
    || pg_catalog.convert_to(p_provider_a_identity, 'UTF8')
    || pg_catalog.int4send(
      pg_catalog.octet_length(pg_catalog.convert_to(p_provider_b_identity, 'UTF8'))
    )
    || pg_catalog.convert_to(p_provider_b_identity, 'UTF8')
    || pg_catalog.int4send(
      pg_catalog.octet_length(
        pg_catalog.convert_to(p_provider_a_vendor_group, 'UTF8')
      )
    )
    || pg_catalog.convert_to(p_provider_a_vendor_group, 'UTF8')
    || pg_catalog.int4send(
      pg_catalog.octet_length(
        pg_catalog.convert_to(p_provider_b_vendor_group, 'UTF8')
      )
    )
    || pg_catalog.convert_to(p_provider_b_vendor_group, 'UTF8')
    || p_provider_a_endpoint_commitment
    || p_provider_b_endpoint_commitment
    || p_provider_a_origin_commitment
    || p_provider_b_origin_commitment
    || pg_catalog.int4send(p_provider_a_call_count)
    || pg_catalog.int4send(p_provider_b_call_count)
    || pg_catalog.int4send(p_candidate_batch_size)
    || pg_catalog.int4send(p_hard_deadline_ms)
    || pg_catalog.int4send(p_maximum_calls_per_provider)
    || pg_catalog.int4send(p_elapsed_ms)
    || p_execution_trace_commitment
$function$;

create function programmable_private.reward_snapshot_evidence_preimage_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_epoch_id uuid,
  p_pointer_generation bigint,
  p_run_id uuid,
  p_execution_evidence_id uuid,
  p_target_block_evidence_id uuid,
  p_vault bytea,
  p_reward_model text,
  p_target_block_number bigint,
  p_target_block_hash bytea,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_provider_a_snapshot_commitment bytea,
  p_provider_b_snapshot_commitment bytea,
  p_provider_a_call_count integer,
  p_provider_b_call_count integer,
  p_verification_accounts bytea[],
  p_verification_account_chunk_end_offsets integer[],
  p_provider_a_verification_chunk_commitments bytea[],
  p_provider_b_verification_chunk_commitments bytea[],
  p_provider_a_verification_chunk_call_counts integer[],
  p_provider_b_verification_chunk_call_counts integer[],
  p_folded_snapshot_commitment bytea,
  p_execution_trace_commitment bytea
)
returns bytea
language sql
immutable
security invoker
set search_path = ''
as $function$
  select
    pg_catalog.decode(
      '70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a76330007',
      'hex'
    )
    || pg_catalog.int8send(p_chain_id)
    || pg_catalog.int4send(
      pg_catalog.octet_length(pg_catalog.convert_to(p_release_id, 'UTF8'))
    )
    || pg_catalog.convert_to(p_release_id, 'UTF8')
    || pg_catalog.int4send(
      pg_catalog.octet_length(pg_catalog.convert_to(p_model_id, 'UTF8'))
    )
    || pg_catalog.convert_to(p_model_id, 'UTF8')
    || pg_catalog.int4send(
      pg_catalog.octet_length(pg_catalog.convert_to(p_source_group, 'UTF8'))
    )
    || pg_catalog.convert_to(p_source_group, 'UTF8')
    || pg_catalog.uuid_send(p_epoch_id)
    || pg_catalog.int8send(p_pointer_generation)
    || pg_catalog.uuid_send(p_run_id)
    || pg_catalog.uuid_send(p_execution_evidence_id)
    || pg_catalog.uuid_send(p_target_block_evidence_id)
    || p_vault
    || pg_catalog.int4send(
      pg_catalog.octet_length(pg_catalog.convert_to(p_reward_model, 'UTF8'))
    )
    || pg_catalog.convert_to(p_reward_model, 'UTF8')
    || pg_catalog.int8send(p_target_block_number)
    || p_target_block_hash
    || pg_catalog.uuid_send(p_provider_a_id)
    || pg_catalog.uuid_send(p_provider_b_id)
    || p_provider_a_snapshot_commitment
    || p_provider_b_snapshot_commitment
    || pg_catalog.int4send(p_provider_a_call_count)
    || pg_catalog.int4send(p_provider_b_call_count)
    || pg_catalog.int4send(pg_catalog.cardinality(p_verification_accounts))
    || (
      select coalesce(
        pg_catalog.string_agg(
          account, ''::bytea order by account_ordinal
        ),
        ''::bytea
      )
      from pg_catalog.unnest(p_verification_accounts)
        with ordinality as accounts(account, account_ordinal)
    )
    || pg_catalog.int4send(pg_catalog.cardinality(
      p_verification_account_chunk_end_offsets
    ))
    || (
      select coalesce(pg_catalog.string_agg(
        pg_catalog.int4send(chunk_end_offset), ''::bytea
        order by chunk_ordinal
      ), ''::bytea)
      from pg_catalog.unnest(p_verification_account_chunk_end_offsets)
        with ordinality as chunks(chunk_end_offset, chunk_ordinal)
    )
    || pg_catalog.int4send(pg_catalog.cardinality(
      p_provider_a_verification_chunk_commitments
    ))
    || (
      select coalesce(pg_catalog.string_agg(
        commitment, ''::bytea order by chunk_ordinal
      ), ''::bytea)
      from pg_catalog.unnest(p_provider_a_verification_chunk_commitments)
        with ordinality as chunks(commitment, chunk_ordinal)
    )
    || pg_catalog.int4send(pg_catalog.cardinality(
      p_provider_b_verification_chunk_commitments
    ))
    || (
      select coalesce(pg_catalog.string_agg(
        commitment, ''::bytea order by chunk_ordinal
      ), ''::bytea)
      from pg_catalog.unnest(p_provider_b_verification_chunk_commitments)
        with ordinality as chunks(commitment, chunk_ordinal)
    )
    || pg_catalog.int4send(pg_catalog.cardinality(
      p_provider_a_verification_chunk_call_counts
    ))
    || (
      select coalesce(pg_catalog.string_agg(
        pg_catalog.int4send(call_count), ''::bytea
        order by chunk_ordinal
      ), ''::bytea)
      from pg_catalog.unnest(p_provider_a_verification_chunk_call_counts)
        with ordinality as chunks(call_count, chunk_ordinal)
    )
    || pg_catalog.int4send(pg_catalog.cardinality(
      p_provider_b_verification_chunk_call_counts
    ))
    || (
      select coalesce(pg_catalog.string_agg(
        pg_catalog.int4send(call_count), ''::bytea
        order by chunk_ordinal
      ), ''::bytea)
      from pg_catalog.unnest(p_provider_b_verification_chunk_call_counts)
        with ordinality as chunks(call_count, chunk_ordinal)
    )
    || p_folded_snapshot_commitment
    || p_execution_trace_commitment
$function$;

create function programmable_private.assert_reward_verification_chunk_manifest_v1(
  p_verification_accounts bytea[],
  p_verification_account_chunk_end_offsets integer[],
  p_provider_a_verification_chunk_commitments bytea[],
  p_provider_b_verification_chunk_commitments bytea[],
  p_provider_a_verification_chunk_call_counts integer[],
  p_provider_b_verification_chunk_call_counts integer[],
  p_provider_a_call_count integer,
  p_provider_b_call_count integer
)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  account_count integer;
  chunk_count integer;
  chunk_index integer;
  chunk_call_total integer := 0;
  ordered_verification_accounts bytea[];
begin
  account_count := coalesce(
    pg_catalog.cardinality(p_verification_accounts), 0
  );
  chunk_count := coalesce(
    pg_catalog.cardinality(p_verification_account_chunk_end_offsets), 0
  );
  if account_count not between 1 and 4096
     or p_provider_a_call_count not between 1 and 11008
     or p_provider_b_call_count is distinct from p_provider_a_call_count
     or chunk_count not between 1 and 86
     or chunk_count <> ((account_count + 47) / 48)
     or coalesce(pg_catalog.cardinality(
       p_provider_a_verification_chunk_commitments
     ), -1) <> chunk_count
     or coalesce(pg_catalog.cardinality(
       p_provider_b_verification_chunk_commitments
     ), -1) <> chunk_count
     or coalesce(pg_catalog.cardinality(
       p_provider_a_verification_chunk_call_counts
     ), -1) <> chunk_count
     or coalesce(pg_catalog.cardinality(
       p_provider_b_verification_chunk_call_counts
     ), -1) <> chunk_count
     or exists (
       select 1
       from pg_catalog.unnest(p_verification_accounts) as account
       where account is null or pg_catalog.octet_length(account) <> 20
     )
  then
    raise exception using
      errcode = '22023',
      message = 'invalid reward verification chunk manifest';
  end if;

  select pg_catalog.array_agg(account order by account)
  into ordered_verification_accounts
  from pg_catalog.unnest(p_verification_accounts) as account;
  if p_verification_accounts is distinct from ordered_verification_accounts
     or account_count <> (
       select pg_catalog.count(distinct account)
       from pg_catalog.unnest(p_verification_accounts) as account
     )
  then
    raise exception using
      errcode = '22023',
      message = 'reward verification accounts are not canonical';
  end if;

  for chunk_index in 1..chunk_count loop
    if p_verification_account_chunk_end_offsets[chunk_index]
         is distinct from pg_catalog.least(chunk_index * 48, account_count)
       or pg_catalog.octet_length(
         p_provider_a_verification_chunk_commitments[chunk_index]
       ) <> 32
       or p_provider_a_verification_chunk_commitments[chunk_index] =
         pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
       or p_provider_b_verification_chunk_commitments[chunk_index]
         is distinct from
         p_provider_a_verification_chunk_commitments[chunk_index]
       or p_provider_a_verification_chunk_call_counts[chunk_index] is null
       or p_provider_a_verification_chunk_call_counts[chunk_index]
         not between 1 and 128
       or p_provider_b_verification_chunk_call_counts[chunk_index]
         is distinct from
         p_provider_a_verification_chunk_call_counts[chunk_index]
    then
      raise exception using
        errcode = '23514',
        message = 'reward verification chunk manifest changed';
    end if;
    chunk_call_total := chunk_call_total
      + p_provider_a_verification_chunk_call_counts[chunk_index];
  end loop;

  if p_verification_account_chunk_end_offsets[chunk_count]
       is distinct from account_count
     or chunk_call_total <> p_provider_a_call_count
  then
    raise exception using
      errcode = '23514',
      message = 'reward verification chunks do not exactly cover reads';
  end if;
end
$function$;

create function programmable_private.reward_snapshot_folded_preimage_v1(
  p_run_id uuid,
  p_vault bytea
)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  staged_vault programmable_private.reward_vault_projections%rowtype;
  release_bytes bytea;
  model_bytes bytea;
  snapshot_kind_bytes bytea;
  vault_row bytea;
  allocation_rows bytea := ''::bytea;
  balance_rows bytea := ''::bytea;
  claim_rows bytea := ''::bytea;
  payout_rows bytea := ''::bytea;
  allocation_count integer;
  balance_count integer;
  claim_count integer;
  payout_count integer;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_run_id is null or pg_catalog.octet_length(p_vault) <> 20 then
    raise exception using
      errcode = '22023', message = 'invalid folded reward snapshot identity';
  end if;
  select staged.* into staged_vault
  from programmable_private.reward_vault_projections as staged
  where staged.projection_run_id = p_run_id
    and staged.vault = p_vault
    and staged.snapshot_kind in ('initial_seed', 'exact_current');
  if not found then
    raise exception using
      errcode = '23503', message = 'exact staged reward snapshot is missing';
  end if;
  release_bytes := pg_catalog.convert_to(staged_vault.release_id, 'UTF8');
  model_bytes := pg_catalog.convert_to(staged_vault.model_id, 'UTF8');
  snapshot_kind_bytes := pg_catalog.convert_to(
    staged_vault.snapshot_kind, 'UTF8'
  );
  vault_row := pg_catalog.decode('01', 'hex')
    || pg_catalog.uuid_send(staged_vault.reward_vault_projection_id)
    || pg_catalog.uuid_send(staged_vault.launch_projection_id)
    || pg_catalog.int8send(staged_vault.chain_id::bigint)
    || pg_catalog.int4send(pg_catalog.octet_length(release_bytes))
    || release_bytes
    || pg_catalog.int4send(pg_catalog.octet_length(model_bytes))
    || model_bytes
    || pg_catalog.uuid_send(staged_vault.epoch_id)
    || pg_catalog.int8send(staged_vault.pointer_generation)
    || staged_vault.vault
    || staged_vault.pool_id
    || case when staged_vault.quote_asset is null
      then pg_catalog.decode('00', 'hex')
      else pg_catalog.decode('01', 'hex') || staged_vault.quote_asset end
    || staged_vault.configuration_hash
    || pg_catalog.uuid_send(staged_vault.current_allocation_fact_id)
    || pg_catalog.uuid_send(staged_vault.last_source_logical_event_id)
    || pg_catalog.uuid_send(staged_vault.last_source_occurrence_id)
    || staged_vault.last_source_occurrence_block_hash
    || pg_catalog.uuid_send(staged_vault.projection_run_id)
    || pg_catalog.int8send(staged_vault.promoted_block_number::bigint)
    || staged_vault.promoted_block_hash
    || pg_catalog.int4send(pg_catalog.octet_length(snapshot_kind_bytes))
    || snapshot_kind_bytes
    || pg_catalog.int8send(staged_vault.configuration_epoch)
    || staged_vault.active_configuration_hash
    || pg_catalog.int4send(pg_catalog.octet_length(
      pg_catalog.convert_to(
        staged_vault.total_creator_fees_received::text, 'UTF8'
      )
    ))
    || pg_catalog.convert_to(
      staged_vault.total_creator_fees_received::text, 'UTF8'
    )
    || case staged_vault.snapshot_kind
      when 'initial_seed' then pg_catalog.decode('00', 'hex')
      else pg_catalog.uuid_send(
          staged_vault.baseline_reward_vault_projection_id
        )
        || pg_catalog.uuid_send(staged_vault.baseline_checkpoint_id)
        || pg_catalog.int8send(staged_vault.baseline_checkpoint_generation)
        || pg_catalog.int8send(staged_vault.baseline_reorg_generation)
      end;

  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.string_agg(
      pg_catalog.decode('02', 'hex')
      || pg_catalog.uuid_send(allocation.reward_allocation_projection_id)
      || pg_catalog.uuid_send(allocation.reward_vault_projection_id)
      || pg_catalog.uuid_send(allocation.allocation_fact_id)
      || pg_catalog.int8send(allocation.chain_id::bigint)
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(allocation.release_id, 'UTF8')
      ))
      || pg_catalog.convert_to(allocation.release_id, 'UTF8')
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(allocation.model_id, 'UTF8')
      ))
      || pg_catalog.convert_to(allocation.model_id, 'UTF8')
      || pg_catalog.uuid_send(allocation.epoch_id)
      || pg_catalog.int8send(allocation.pointer_generation)
      || pg_catalog.int8send(allocation.configuration_epoch)
      || pg_catalog.int4send(allocation.allocation_index)
      || allocation.beneficiary
      || allocation.payout_address
      || pg_catalog.int4send(allocation.share_bps::integer)
      || pg_catalog.int8send(allocation.effective_from_block::bigint)
      || case when allocation.effective_to_block is null
        then pg_catalog.decode('00', 'hex')
        else pg_catalog.decode('01', 'hex')
          || pg_catalog.int8send(allocation.effective_to_block) end
      || pg_catalog.uuid_send(allocation.last_source_logical_event_id)
      || pg_catalog.uuid_send(allocation.last_source_occurrence_id)
      || allocation.last_source_occurrence_block_hash
      || pg_catalog.uuid_send(allocation.projection_run_id)
      || pg_catalog.int8send(allocation.promoted_block_number::bigint)
      || allocation.promoted_block_hash,
      ''::bytea order by allocation.configuration_epoch,
        allocation.allocation_index,
        allocation.reward_allocation_projection_id
    ), ''::bytea)
  into allocation_count, allocation_rows
  from programmable_private.reward_allocation_projections as allocation
  where allocation.projection_run_id = p_run_id
    and allocation.reward_vault_projection_id =
      staged_vault.reward_vault_projection_id;

  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.string_agg(
      pg_catalog.decode('03', 'hex')
      || pg_catalog.uuid_send(balance.account_reward_balance_id)
      || pg_catalog.int8send(balance.chain_id::bigint)
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(balance.release_id, 'UTF8')
      ))
      || pg_catalog.convert_to(balance.release_id, 'UTF8')
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(balance.model_id, 'UTF8')
      ))
      || pg_catalog.convert_to(balance.model_id, 'UTF8')
      || pg_catalog.uuid_send(balance.epoch_id)
      || pg_catalog.int8send(balance.pointer_generation)
      || balance.account
      || balance.vault
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(balance.claimable_accrued::text, 'UTF8')
      ))
      || pg_catalog.convert_to(balance.claimable_accrued::text, 'UTF8')
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(balance.claimed_total::text, 'UTF8')
      ))
      || pg_catalog.convert_to(balance.claimed_total::text, 'UTF8')
      || pg_catalog.uuid_send(balance.last_source_logical_event_id)
      || pg_catalog.uuid_send(balance.last_source_occurrence_id)
      || balance.last_source_occurrence_block_hash
      || pg_catalog.uuid_send(balance.projection_run_id)
      || pg_catalog.int8send(balance.promoted_block_number::bigint)
      || balance.promoted_block_hash
      || case when balance.payout_address is null
        then pg_catalog.decode('00', 'hex')
        else pg_catalog.decode('01', 'hex') || balance.payout_address end,
      ''::bytea order by balance.account, balance.account_reward_balance_id
    ), ''::bytea)
  into balance_count, balance_rows
  from programmable_private.account_reward_balances as balance
  where balance.projection_run_id = p_run_id
    and balance.vault = p_vault;

  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.string_agg(
      pg_catalog.decode('04', 'hex')
      || pg_catalog.uuid_send(claim.claim_projection_id)
      || pg_catalog.int8send(claim.chain_id::bigint)
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(claim.release_id, 'UTF8')
      ))
      || pg_catalog.convert_to(claim.release_id, 'UTF8')
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(claim.model_id, 'UTF8')
      ))
      || pg_catalog.convert_to(claim.model_id, 'UTF8')
      || pg_catalog.uuid_send(claim.epoch_id)
      || pg_catalog.int8send(claim.pointer_generation)
      || claim.vault
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(claim.claimant_kind, 'UTF8')
      ))
      || pg_catalog.convert_to(claim.claimant_kind, 'UTF8')
      || claim.beneficiary
      || claim.recipient
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(claim.amount::text, 'UTF8')
      ))
      || pg_catalog.convert_to(claim.amount::text, 'UTF8')
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(claim.beneficiary_total_claimed::text, 'UTF8')
      ))
      || pg_catalog.convert_to(
        claim.beneficiary_total_claimed::text, 'UTF8'
      )
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(claim.vault_total_received::text, 'UTF8')
      ))
      || pg_catalog.convert_to(claim.vault_total_received::text, 'UTF8')
      || pg_catalog.uuid_send(claim.source_occurrence_id)
      || pg_catalog.uuid_send(claim.source_logical_event_id)
      || claim.source_occurrence_block_hash
      || pg_catalog.uuid_send(claim.projection_run_id)
      || pg_catalog.int8send(claim.promoted_block_number::bigint)
      || claim.promoted_block_hash,
      ''::bytea order by source.block_number,
        source.block_global_log_index, source.transaction_index,
        source.receipt_log_ordinal, claim.source_occurrence_id
    ), ''::bytea)
  into claim_count, claim_rows
  from programmable_private.claim_projections as claim
  join programmable_private.chain_event_occurrences as source
    on source.occurrence_id = claim.source_occurrence_id
  where claim.projection_run_id = p_run_id
    and claim.vault = p_vault;

  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.string_agg(
      pg_catalog.decode('05', 'hex')
      || pg_catalog.uuid_send(payout.payout_change_projection_id)
      || pg_catalog.int8send(payout.chain_id::bigint)
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(payout.release_id, 'UTF8')
      ))
      || pg_catalog.convert_to(payout.release_id, 'UTF8')
      || pg_catalog.int4send(pg_catalog.octet_length(
        pg_catalog.convert_to(payout.model_id, 'UTF8')
      ))
      || pg_catalog.convert_to(payout.model_id, 'UTF8')
      || pg_catalog.uuid_send(payout.epoch_id)
      || pg_catalog.int8send(payout.pointer_generation)
      || payout.vault
      || payout.beneficiary
      || payout.previous_payout_address
      || payout.new_payout_address
      || case when payout.configuration_epoch is null
        then pg_catalog.decode('00', 'hex')
        else pg_catalog.decode('01', 'hex')
          || pg_catalog.int8send(payout.configuration_epoch) end
      || pg_catalog.uuid_send(payout.source_occurrence_id)
      || pg_catalog.uuid_send(payout.source_logical_event_id)
      || payout.source_occurrence_block_hash
      || pg_catalog.uuid_send(payout.projection_run_id)
      || pg_catalog.int8send(payout.promoted_block_number::bigint)
      || payout.promoted_block_hash,
      ''::bytea order by source.block_number,
        source.block_global_log_index, source.transaction_index,
        source.receipt_log_ordinal, payout.source_occurrence_id
    ), ''::bytea)
  into payout_count, payout_rows
  from programmable_private.payout_change_projections as payout
  join programmable_private.chain_event_occurrences as source
    on source.occurrence_id = payout.source_occurrence_id
  where payout.projection_run_id = p_run_id
    and payout.vault = p_vault;

  return pg_catalog.decode(
    '70726f6772616d6d61626c653a7265776172642d736e617073686f742d666f6c643a763100',
    'hex'
  )
    || pg_catalog.uuid_send(p_run_id)
    || p_vault
    || vault_row
    || pg_catalog.int4send(allocation_count) || allocation_rows
    || pg_catalog.int4send(balance_count) || balance_rows
    || pg_catalog.int4send(claim_count) || claim_rows
    || pg_catalog.int4send(payout_count) || payout_rows;
end
$function$;

create function programmable_private.reward_snapshot_folded_commitment_v1(
  p_run_id uuid,
  p_vault bytea
)
returns bytea
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.sha256(
    programmable_private.reward_snapshot_folded_preimage_v1(
      p_run_id, p_vault
    )
  )
$function$;

create function programmable_private.get_staged_reward_folded_commitment_v1(
  p_run_id uuid,
  p_vault bytea
)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind = 'projection';
  if header.run_id is null
     or exists (
       select 1
       from programmable_private.run_lifecycle_outcomes
       where run_id = p_run_id
     )
  then
    raise exception using
      errcode = '55000', message = 'projection run is not open';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id,
    header.source_group, header.epoch_id,
    header.captured_pointer_generation
  );
  return programmable_private.reward_snapshot_folded_commitment_v1(
    p_run_id, p_vault
  );
end
$function$;

comment on function
  programmable_private.get_staged_reward_folded_commitment_v1(uuid, bytea)
is
  'Returns the structural commitment of one exact staged reward snapshot for the open current projection run. It does not expose private rows.';

create function programmable_private.validate_projection_execution_trace_v1(
  p_execution_trace jsonb,
  p_provider_a_id uuid,
  p_provider_b_id uuid
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  expected_top_keys text[] := array[
    'calls', 'candidateBatchSize', 'completedAtMs', 'elapsedMs',
    'hardDeadlineMs', 'maxCallsPerProvider', 'providerCallCounts',
    'startedAtMs'
  ];
  expected_call_keys text[] := array[
    'attempt', 'durationMs', 'operation', 'outcome',
    'providerEndpointCommitment', 'providerIdentity',
    'providerOriginCommitment', 'providerVendorGroup',
    'startedOffsetMs'
  ];
  actual_keys text[];
  actual_call_keys text[];
  provider_ids uuid[] := array[p_provider_a_id, p_provider_b_id];
  provider_id uuid;
  deployment programmable_private.provider_deployments%rowtype;
  metadata programmable_private.rpc_provider_deployment_metadata%rowtype;
  call_item jsonb;
  call_ordinal bigint;
  expected_identity text;
  expected_endpoint text;
  expected_origin text;
  started_at numeric;
  completed_at numeric;
  elapsed numeric;
  hard_deadline numeric;
  maximum_calls numeric;
  candidate_batch_size numeric;
  call_count_a numeric;
  call_count_b numeric;
  call_attempt numeric;
  call_started numeric;
  call_duration numeric;
  counted_calls bigint;
  successful_calls bigint;
begin
  if p_execution_trace is null
     or pg_catalog.jsonb_typeof(p_execution_trace) <> 'object'
     or pg_catalog.octet_length(p_execution_trace::text) > 65536
  then
    raise exception using
      errcode = '22023', message = 'invalid projection execution trace';
  end if;
  select pg_catalog.array_agg(key order by key) into actual_keys
  from pg_catalog.jsonb_object_keys(p_execution_trace) as key;
  if actual_keys is distinct from expected_top_keys
     or p_execution_trace ->> 'startedAtMs' !~ '^[0-9]+$'
     or p_execution_trace ->> 'completedAtMs' !~ '^[0-9]+$'
     or p_execution_trace ->> 'candidateBatchSize' !~ '^[0-9]+$'
     or p_execution_trace ->> 'hardDeadlineMs' !~ '^[0-9]+$'
     or p_execution_trace ->> 'maxCallsPerProvider' !~ '^[0-9]+$'
     or p_execution_trace ->> 'elapsedMs' !~ '^[0-9]+$'
     or pg_catalog.jsonb_typeof(
       p_execution_trace -> 'providerCallCounts'
     ) <> 'array'
     or pg_catalog.jsonb_array_length(
       p_execution_trace -> 'providerCallCounts'
     ) <> 2
     or pg_catalog.jsonb_typeof(p_execution_trace -> 'calls') <> 'array'
  then
    raise exception using
      errcode = '22023', message = 'projection execution trace shape changed';
  end if;

  started_at := (p_execution_trace ->> 'startedAtMs')::numeric;
  completed_at := (p_execution_trace ->> 'completedAtMs')::numeric;
  candidate_batch_size :=
    (p_execution_trace ->> 'candidateBatchSize')::numeric;
  hard_deadline := (p_execution_trace ->> 'hardDeadlineMs')::numeric;
  maximum_calls := (p_execution_trace ->> 'maxCallsPerProvider')::numeric;
  elapsed := (p_execution_trace ->> 'elapsedMs')::numeric;
  if p_execution_trace #>> '{providerCallCounts,0}' !~ '^[0-9]+$'
     or p_execution_trace #>> '{providerCallCounts,1}' !~ '^[0-9]+$'
  then
    raise exception using
      errcode = '22023', message = 'invalid provider call counts';
  end if;
  call_count_a :=
    (p_execution_trace #>> '{providerCallCounts,0}')::numeric;
  call_count_b :=
    (p_execution_trace #>> '{providerCallCounts,1}')::numeric;
  if started_at < 1
     or completed_at < started_at
     or completed_at - started_at <> elapsed
     or elapsed > hard_deadline
     or candidate_batch_size < 0
     or candidate_batch_size > 4096
     or hard_deadline < 10
     or hard_deadline > 75000
     or maximum_calls < 1
     or maximum_calls > 128
     or maximum_calls <> pg_catalog.trunc(maximum_calls)
     or call_count_a < 1
     or call_count_b < 1
     or call_count_a > maximum_calls
     or call_count_b > maximum_calls
     or call_count_a <> pg_catalog.trunc(call_count_a)
     or call_count_b <> pg_catalog.trunc(call_count_b)
     or pg_catalog.jsonb_array_length(p_execution_trace -> 'calls') < 2
     or pg_catalog.jsonb_array_length(p_execution_trace -> 'calls') > 256
     or pg_catalog.jsonb_array_length(p_execution_trace -> 'calls') <>
       call_count_a + call_count_b
  then
    raise exception using
      errcode = '22023', message = 'projection execution trace is out of bounds';
  end if;

  for call_item, call_ordinal in
    select value, ordinality
    from pg_catalog.jsonb_array_elements(p_execution_trace -> 'calls')
      with ordinality as calls(value, ordinality)
  loop
    if pg_catalog.jsonb_typeof(call_item) <> 'object' then
      raise exception using
        errcode = '22023', message = 'projection call trace is not an object';
    end if;
    select pg_catalog.array_agg(key order by key) into actual_call_keys
    from pg_catalog.jsonb_object_keys(call_item) as key;
    if actual_call_keys is distinct from expected_call_keys
       or call_item ->> 'attempt' !~ '^[0-9]+$'
       or call_item ->> 'startedOffsetMs' !~ '^[0-9]+$'
       or call_item ->> 'durationMs' !~ '^[0-9]+$'
       or call_item ->> 'operation' not in (
         'getChainId', 'getBlockNumber', 'getBlock',
         'getTransactionReceipt', 'getBytecode', 'readRewardSnapshot'
       )
       or call_item ->> 'outcome' not in ('success', 'error')
    then
      raise exception using
        errcode = '22023', message = 'projection call trace shape changed';
    end if;
    call_attempt := (call_item ->> 'attempt')::numeric;
    call_started := (call_item ->> 'startedOffsetMs')::numeric;
    call_duration := (call_item ->> 'durationMs')::numeric;
    if call_attempt not between 1 and 3
       or call_attempt <> pg_catalog.trunc(call_attempt)
       or call_started > elapsed
       or call_duration > elapsed
       or call_started + call_duration > elapsed
    then
      raise exception using
        errcode = '22023', message = 'projection call trace is out of bounds';
    end if;

    provider_index := case
      when call_ordinal <= call_count_a then 1 else 2
    end;
    provider_id := provider_ids[provider_index];
    select * into deployment
    from programmable_private.provider_deployments
    where provider_deployment_id = provider_id
      and provider_type = 'rpc_provider';
    select * into metadata
    from programmable_private.rpc_provider_deployment_metadata
    where provider_deployment_id = provider_id
      and chain_id = 1
      and vendor_order = provider_index;
    if deployment.provider_deployment_id is null
       or metadata.provider_deployment_id is null
    then
      raise exception using
        errcode = '23503', message = 'projection trace provider is not registered';
    end if;
    expected_identity := metadata.vendor || '-mainnet-' ||
      pg_catalog.substring(
        pg_catalog.encode(deployment.deployment_commitment, 'hex'), 1, 32
      );
    expected_endpoint := '0x' || pg_catalog.encode(
      metadata.endpoint_url_commitment, 'hex'
    );
    expected_origin := '0x' || pg_catalog.encode(
      metadata.endpoint_origin_commitment, 'hex'
    );
    if call_item ->> 'providerIdentity' <> expected_identity
       or call_item ->> 'providerVendorGroup' <> metadata.vendor
       or call_item ->> 'providerEndpointCommitment' <> expected_endpoint
       or call_item ->> 'providerOriginCommitment' <> expected_origin
    then
      raise exception using
        errcode = '23514', message = 'projection trace provider was substituted';
    end if;
  end loop;

  for provider_index in 1..2 loop
    select pg_catalog.count(*),
      pg_catalog.count(*) filter (where value ->> 'outcome' = 'success')
    into counted_calls, successful_calls
    from pg_catalog.jsonb_array_elements(p_execution_trace -> 'calls')
      with ordinality as calls(value, ordinality)
    where (
      provider_index = 1 and ordinality <= call_count_a
    ) or (
      provider_index = 2 and ordinality > call_count_a
    );
    if (
         provider_index = 1 and counted_calls <> call_count_a
       )
       or (
         provider_index = 2 and counted_calls <> call_count_b
       )
       or successful_calls < 1
    then
      raise exception using
        errcode = '23514',
        message = 'projection trace lacks successful provider evidence';
    end if;
  end loop;
end
$function$;

create function programmable_private.validate_reward_snapshot_execution_trace_v1(
  p_execution_trace jsonb,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_provider_a_call_count integer,
  p_provider_b_call_count integer
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  expected_top_keys text[] := array[
    'calls', 'candidateBatchSize', 'completedAtMs', 'elapsedMs',
    'hardDeadlineMs', 'maxCallsPerProvider', 'providerCallCounts',
    'startedAtMs'
  ];
  expected_call_keys text[] := array[
    'attempt', 'durationMs', 'operation', 'outcome',
    'providerEndpointCommitment', 'providerIdentity',
    'providerOriginCommitment', 'providerVendorGroup',
    'startedOffsetMs'
  ];
  actual_keys text[];
  actual_call_keys text[];
  provider_ids uuid[] := array[p_provider_a_id, p_provider_b_id];
  provider_id uuid;
  deployment programmable_private.provider_deployments%rowtype;
  metadata programmable_private.rpc_provider_deployment_metadata%rowtype;
  call_item jsonb;
  call_ordinal bigint;
  chunk_count integer;
  provider_index integer;
  expected_identity text;
  expected_endpoint text;
  expected_origin text;
  started_at numeric;
  completed_at numeric;
  elapsed numeric;
  hard_deadline numeric;
  maximum_calls numeric;
  call_started numeric;
  call_duration numeric;
begin
  if p_execution_trace is null
     or pg_catalog.jsonb_typeof(p_execution_trace) <> 'object'
     or pg_catalog.octet_length(p_execution_trace::text) > 262144
  then
    raise exception using
      errcode = '22023', message = 'invalid reward execution trace';
  end if;
  select pg_catalog.array_agg(key order by key) into actual_keys
  from pg_catalog.jsonb_object_keys(p_execution_trace) as key;
  if actual_keys is distinct from expected_top_keys
     or p_execution_trace ->> 'startedAtMs' !~ '^[0-9]+$'
     or p_execution_trace ->> 'completedAtMs' !~ '^[0-9]+$'
     or p_execution_trace ->> 'candidateBatchSize' !~ '^[0-9]+$'
     or p_execution_trace ->> 'hardDeadlineMs' !~ '^[0-9]+$'
     or p_execution_trace ->> 'maxCallsPerProvider' !~ '^[0-9]+$'
     or p_execution_trace ->> 'elapsedMs' !~ '^[0-9]+$'
     or pg_catalog.jsonb_typeof(
       p_execution_trace -> 'providerCallCounts'
     ) <> 'array'
     or pg_catalog.jsonb_array_length(
       p_execution_trace -> 'providerCallCounts'
     ) <> 2
     or pg_catalog.jsonb_typeof(p_execution_trace -> 'calls') <> 'array'
     or pg_catalog.jsonb_array_length(p_execution_trace -> 'calls') < 2
     or pg_catalog.jsonb_array_length(p_execution_trace -> 'calls') > 172
     or pg_catalog.mod(
       pg_catalog.jsonb_array_length(p_execution_trace -> 'calls'), 2
     ) <> 0
     or p_execution_trace #>> '{providerCallCounts,0}' !~ '^[0-9]+$'
     or p_execution_trace #>> '{providerCallCounts,1}' !~ '^[0-9]+$'
  then
    raise exception using
      errcode = '22023', message = 'reward execution trace shape changed';
  end if;

  started_at := (p_execution_trace ->> 'startedAtMs')::numeric;
  completed_at := (p_execution_trace ->> 'completedAtMs')::numeric;
  elapsed := (p_execution_trace ->> 'elapsedMs')::numeric;
  hard_deadline := (p_execution_trace ->> 'hardDeadlineMs')::numeric;
  maximum_calls :=
    (p_execution_trace ->> 'maxCallsPerProvider')::numeric;
  chunk_count := pg_catalog.jsonb_array_length(
    p_execution_trace -> 'calls'
  ) / 2;
  if started_at < 1
     or completed_at < started_at
     or completed_at - started_at <> elapsed
     or elapsed > hard_deadline
     or (p_execution_trace ->> 'candidateBatchSize')::numeric <> 0
     or hard_deadline < 10
     or hard_deadline > 75000
     or maximum_calls < 1
     or maximum_calls > 128
     or maximum_calls <> pg_catalog.trunc(maximum_calls)
     or p_provider_a_call_count not between 1 and 11008
     or p_provider_b_call_count not between 1 and 11008
     or p_provider_b_call_count <> p_provider_a_call_count
     or (p_execution_trace #>> '{providerCallCounts,0}')::numeric <>
       p_provider_a_call_count
     or (p_execution_trace #>> '{providerCallCounts,1}')::numeric <>
       p_provider_b_call_count
  then
    raise exception using
      errcode = '22023', message = 'reward execution trace is out of bounds';
  end if;

  for call_item, call_ordinal in
    select value, ordinality
    from pg_catalog.jsonb_array_elements(p_execution_trace -> 'calls')
      with ordinality as calls(value, ordinality)
  loop
    if pg_catalog.jsonb_typeof(call_item) <> 'object' then
      raise exception using
        errcode = '22023', message = 'reward trace call is not an object';
    end if;
    select pg_catalog.array_agg(key order by key) into actual_call_keys
    from pg_catalog.jsonb_object_keys(call_item) as key;
    if actual_call_keys is distinct from expected_call_keys
       or call_item ->> 'attempt' <> '1'
       or call_item ->> 'startedOffsetMs' !~ '^[0-9]+$'
       or call_item ->> 'durationMs' !~ '^[0-9]+$'
       or call_item ->> 'operation' <> 'readRewardSnapshot'
       or call_item ->> 'outcome' <> 'success'
    then
      raise exception using
        errcode = '22023', message = 'reward trace call shape changed';
    end if;
    call_started := (call_item ->> 'startedOffsetMs')::numeric;
    call_duration := (call_item ->> 'durationMs')::numeric;
    if call_started > elapsed
       or call_duration > elapsed
       or call_started + call_duration > elapsed
    then
      raise exception using
        errcode = '22023', message = 'reward trace call is out of bounds';
    end if;

    provider_index := case
      when call_ordinal <= chunk_count then 1
      else 2
    end;
    provider_id := provider_ids[provider_index];
    select * into deployment
    from programmable_private.provider_deployments
    where provider_deployment_id = provider_id
      and provider_type = 'rpc_provider';
    select * into metadata
    from programmable_private.rpc_provider_deployment_metadata
    where provider_deployment_id = provider_id
      and chain_id = 1
      and vendor_order = provider_index;
    if deployment.provider_deployment_id is null
       or metadata.provider_deployment_id is null
    then
      raise exception using
        errcode = '23503', message = 'reward trace provider is not registered';
    end if;
    expected_identity := metadata.vendor || '-mainnet-' ||
      pg_catalog.substring(
        pg_catalog.encode(deployment.deployment_commitment, 'hex'), 1, 32
      );
    expected_endpoint := '0x' || pg_catalog.encode(
      metadata.endpoint_url_commitment, 'hex'
    );
    expected_origin := '0x' || pg_catalog.encode(
      metadata.endpoint_origin_commitment, 'hex'
    );
    if call_item ->> 'providerIdentity' <> expected_identity
       or call_item ->> 'providerVendorGroup' <> metadata.vendor
       or call_item ->> 'providerEndpointCommitment' <> expected_endpoint
       or call_item ->> 'providerOriginCommitment' <> expected_origin
    then
      raise exception using
        errcode = '23514', message = 'reward trace provider was substituted';
    end if;
  end loop;
end
$function$;

create function programmable_private.assert_projection_provider_evidence_v1(
  p_promotion_mode text,
  p_run_id uuid,
  p_safe_head_observation_id uuid,
  p_target_block_evidence_id uuid,
  p_target_block_number bigint,
  p_target_block_hash bytea,
  p_execution_evidence_id uuid,
  p_reward_snapshot_evidence_ids uuid[]
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  execution
    programmable_private.projection_provider_execution_evidence%rowtype;
  expected_reward_ids uuid[];
begin
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind = 'projection';
  if not found then
    raise exception using
      errcode = '23503', message = 'projection run is missing';
  end if;
  select * into execution
  from programmable_private.projection_provider_execution_evidence
  where execution_evidence_id = p_execution_evidence_id
    and run_id = p_run_id
    and safe_head_observation_id = p_safe_head_observation_id
    and epoch_id = header.epoch_id
    and chain_id = header.chain_id
    and pointer_generation = header.captured_pointer_generation;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'promotion provider execution evidence was substituted';
  end if;
  if execution.execution_trace_preimage <>
       programmable_private.projection_execution_trace_preimage_v1(
         execution.execution_trace
       )
     or execution.execution_trace_commitment <>
       pg_catalog.sha256(execution.execution_trace_preimage)
  then
    raise exception using
      errcode = '23514',
      message = 'promotion execution trace evidence changed';
  end if;
  if not exists (
    select 1
    from programmable_private.dual_rpc_block_evidence as evidence
    where evidence.block_evidence_id = p_target_block_evidence_id
      and evidence.observation_id = p_safe_head_observation_id
      and evidence.epoch_id = header.epoch_id
      and evidence.chain_id = header.chain_id
      and evidence.pointer_generation =
        header.captured_pointer_generation
      and evidence.block_number = p_target_block_number
      and evidence.agreed_block_hash = p_target_block_hash
  ) then
    raise exception using
      errcode = '23514', message = 'promotion target evidence was substituted';
  end if;

  if p_promotion_mode <> 'exact_incremental' then
    raise exception using
      errcode = '22023', message = 'unknown projection promotion mode';
  end if;

  select pg_catalog.array_agg(
    evidence.reward_snapshot_evidence_id order by evidence.vault
  ) into expected_reward_ids
  from programmable_private.reward_snapshot_provider_evidence as evidence
  join programmable_private.reward_vault_projections as vault
    on vault.projection_run_id = evidence.run_id
   and vault.vault = evidence.vault
   and vault.model_id = evidence.model_id
  left join programmable_private.launch_projections as launch
    on launch.launch_projection_id = vault.launch_projection_id
   and (
     vault.snapshot_kind = 'exact_current'
     or (
       vault.snapshot_kind = 'initial_seed'
       and launch.projection_run_id = vault.projection_run_id
       and (
         exists (
           select 1
           from programmable_private.creator_fee_checkpoint_facts as fact
           where fact.verification_run_id = evidence.run_id
             and fact.vault = evidence.vault
         )
         or exists (
           select 1
           from programmable_private.reward_configuration_activation_facts
             as fact
           where fact.verification_run_id = evidence.run_id
             and fact.vault = evidence.vault
         )
         or exists (
           select 1
           from programmable_private.claim_projections as claim
           where claim.projection_run_id = evidence.run_id
             and claim.vault = evidence.vault
         )
         or exists (
           select 1
           from programmable_private.payout_change_projections as payout
           where payout.projection_run_id = evidence.run_id
             and payout.vault = evidence.vault
         )
       )
     )
   )
   and vault.promoted_block_number = evidence.target_block_number
   and vault.promoted_block_hash = evidence.target_block_hash
  where evidence.run_id = p_run_id
    and evidence.execution_evidence_id = p_execution_evidence_id
    and evidence.safe_head_observation_id = p_safe_head_observation_id
    and evidence.target_block_evidence_id = p_target_block_evidence_id
    and evidence.target_block_number = p_target_block_number
    and evidence.target_block_hash = p_target_block_hash
    and evidence.execution_trace_preimage =
      programmable_private.projection_execution_trace_preimage_v1(
        evidence.execution_trace
      )
    and evidence.execution_trace_commitment =
      pg_catalog.sha256(evidence.execution_trace_preimage)
    and evidence.folded_snapshot_preimage =
      programmable_private.reward_snapshot_folded_preimage_v1(
        evidence.run_id, evidence.vault
      )
    and evidence.folded_snapshot_commitment =
      pg_catalog.sha256(evidence.folded_snapshot_preimage);
  if p_reward_snapshot_evidence_ids is distinct from
       coalesce(expected_reward_ids, array[]::uuid[])
     or coalesce(pg_catalog.cardinality(expected_reward_ids), 0) <>
       (
         select pg_catalog.count(*)
         from programmable_private.reward_vault_projections as staged
         where staged.projection_run_id = p_run_id
           and (
             staged.snapshot_kind = 'exact_current'
             or (
               staged.snapshot_kind = 'initial_seed'
               and (
                 exists (
                   select 1
                   from programmable_private.creator_fee_checkpoint_facts as fact
                   where fact.verification_run_id = p_run_id
                     and fact.vault = staged.vault
                 )
                 or exists (
                   select 1
                   from programmable_private.reward_configuration_activation_facts
                     as fact
                   where fact.verification_run_id = p_run_id
                     and fact.vault = staged.vault
                 )
                 or exists (
                   select 1
                   from programmable_private.claim_projections as claim
                   where claim.projection_run_id = p_run_id
                     and claim.vault = staged.vault
                 )
                 or exists (
                   select 1
                   from programmable_private.payout_change_projections as payout
                   where payout.projection_run_id = p_run_id
                     and payout.vault = staged.vault
                 )
               )
             )
           )
       )
     or exists (
       select 1
       from pg_catalog.unnest(p_reward_snapshot_evidence_ids) as item
       where item is null
     )
     or pg_catalog.cardinality(p_reward_snapshot_evidence_ids) <>
       (
         select pg_catalog.count(distinct item)
         from pg_catalog.unnest(p_reward_snapshot_evidence_ids) as item
       )
  then
    raise exception using
      errcode = '23514',
      message = 'reward provider evidence does not exactly cover staged vaults';
  end if;
end
$function$;

create function programmable_private.projection_provider_binding_preimage_v1(
  p_publication_id uuid,
  p_run_id uuid,
  p_promotion_mode text,
  p_execution_evidence_id uuid,
  p_reward_snapshot_evidence_ids uuid[],
  p_bound_at timestamptz
)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  mode_bytes bytea;
  execution_fingerprint bytea;
  reward_pairs bytea;
  reward_count integer;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_publication_id is null
     or p_run_id is null
     or p_promotion_mode <> 'exact_incremental'
     or p_execution_evidence_id is null
     or p_reward_snapshot_evidence_ids is null
     or p_bound_at is null
     or pg_catalog.date_part('epoch', p_bound_at) < 0
  then
    raise exception using
      errcode = '22023', message = 'invalid provider binding preimage';
  end if;
  select content_fingerprint into execution_fingerprint
  from programmable_private.projection_provider_execution_evidence
  where execution_evidence_id = p_execution_evidence_id
    and run_id = p_run_id;
  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.string_agg(
      pg_catalog.uuid_send(evidence.reward_snapshot_evidence_id)
        || evidence.content_fingerprint,
      ''::bytea order by requested.evidence_ordinal
    ), ''::bytea)
  into reward_count, reward_pairs
  from pg_catalog.unnest(p_reward_snapshot_evidence_ids)
    with ordinality as requested(evidence_id, evidence_ordinal)
  join programmable_private.reward_snapshot_provider_evidence as evidence
    on evidence.reward_snapshot_evidence_id = requested.evidence_id
   and evidence.run_id = p_run_id
   and evidence.execution_evidence_id = p_execution_evidence_id;
  if execution_fingerprint is null
     or reward_count <> pg_catalog.cardinality(
       p_reward_snapshot_evidence_ids
     )
  then
    raise exception using
      errcode = '23503', message = 'provider binding evidence is incomplete';
  end if;
  mode_bytes := pg_catalog.convert_to(p_promotion_mode, 'UTF8');
  return pg_catalog.decode(
    '70726f6772616d6d61626c653a70726f6a656374696f6e2d70726f76696465722d62696e64696e673a763100',
    'hex'
  )
    || pg_catalog.uuid_send(p_publication_id)
    || pg_catalog.uuid_send(p_run_id)
    || pg_catalog.int4send(pg_catalog.octet_length(mode_bytes))
    || mode_bytes
    || pg_catalog.uuid_send(p_execution_evidence_id)
    || execution_fingerprint
    || pg_catalog.int4send(reward_count)
    || reward_pairs
    || pg_catalog.int8send(
      pg_catalog.floor(
        pg_catalog.date_part('epoch', p_bound_at) * 1000
      )::bigint
    );
end
$function$;

create function programmable_private.projection_provider_binding_commitment_v1(
  p_publication_id uuid,
  p_run_id uuid,
  p_promotion_mode text,
  p_execution_evidence_id uuid,
  p_reward_snapshot_evidence_ids uuid[],
  p_bound_at timestamptz
)
returns bytea
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.sha256(
    programmable_private.projection_provider_binding_preimage_v1(
      p_publication_id, p_run_id, p_promotion_mode,
      p_execution_evidence_id, p_reward_snapshot_evidence_ids,
      p_bound_at
    )
  )
$function$;

create function programmable_private.bind_projection_publication_provider_evidence_v1(
  p_provider_binding_id uuid,
  p_publication_id uuid,
  p_run_id uuid,
  p_promotion_mode text,
  p_execution_evidence_id uuid,
  p_reward_snapshot_evidence_ids uuid[],
  p_provider_binding_commitment bytea,
  p_bound_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  publication programmable_private.projection_publications%rowtype;
  execution
    programmable_private.projection_provider_execution_evidence%rowtype;
  existing
    programmable_private.projection_publication_provider_bindings%rowtype;
  evidence_record record;
  ordinal integer := 0;
  expected_binding_commitment bytea;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_provider_binding_id is null
     or p_publication_id is null
     or p_run_id is null
     or p_execution_evidence_id is null
     or p_promotion_mode <> 'exact_incremental'
     or p_reward_snapshot_evidence_ids is null
     or pg_catalog.octet_length(p_provider_binding_commitment) <> 32
     or p_provider_binding_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  then
    raise exception using
      errcode = '22023', message = 'invalid publication provider binding';
  end if;
  select * into publication
  from programmable_private.projection_publications
  where publication_id = p_publication_id
    and run_id = p_run_id
    and published_at = p_bound_at;
  select * into execution
  from programmable_private.projection_provider_execution_evidence
  where execution_evidence_id = p_execution_evidence_id
    and run_id = p_run_id;
  if publication.publication_id is null
     or execution.execution_evidence_id is null
  then
    raise exception using
      errcode = '23503', message = 'publication provider evidence is missing';
  end if;
  expected_binding_commitment :=
    programmable_private.projection_provider_binding_commitment_v1(
      p_publication_id, p_run_id, p_promotion_mode,
      p_execution_evidence_id, p_reward_snapshot_evidence_ids,
      p_bound_at
    );
  if p_provider_binding_commitment <> expected_binding_commitment then
    raise exception using
      errcode = '23514',
      message = 'publication provider binding commitment changed';
  end if;
  perform programmable_private.assert_projection_provider_evidence_v1(
    p_promotion_mode, p_run_id,
    execution.safe_head_observation_id,
    (
      select checkpoint.target_block_evidence_id
      from programmable_private.projector_checkpoints as checkpoint
      where checkpoint.checkpoint_id = publication.checkpoint_id
    ),
    publication.target_block_number,
    publication.target_block_hash,
    p_execution_evidence_id, p_reward_snapshot_evidence_ids
  );

  select * into existing
  from programmable_private.projection_publication_provider_bindings
  where provider_binding_id = p_provider_binding_id
     or publication_id = p_publication_id
     or run_id = p_run_id;
  if found then
    if existing.provider_binding_id <> p_provider_binding_id
       or existing.publication_id <> p_publication_id
       or existing.run_id <> p_run_id
       or existing.promotion_mode <> p_promotion_mode
       or existing.execution_evidence_id <> p_execution_evidence_id
       or existing.reward_snapshot_evidence_ids <>
         p_reward_snapshot_evidence_ids
       or existing.provider_binding_commitment <>
         p_provider_binding_commitment
    then
      raise exception using
        errcode = '23505',
        message = 'publication provider binding replay changed content';
    end if;
    return existing.provider_binding_id;
  end if;

  insert into programmable_private.projection_publication_provider_bindings (
    provider_binding_id, publication_id, run_id, promotion_mode,
    execution_evidence_id, reward_snapshot_evidence_ids,
    provider_binding_commitment, bound_at
  ) values (
    p_provider_binding_id, p_publication_id, p_run_id,
    p_promotion_mode::programmable_private.source_identifier,
    p_execution_evidence_id, p_reward_snapshot_evidence_ids,
    p_provider_binding_commitment::programmable_private.bytes32_value,
    p_bound_at
  );
  for evidence_record in
    select evidence.*
    from pg_catalog.unnest(p_reward_snapshot_evidence_ids)
      with ordinality as requested(evidence_id, evidence_ordinal)
    join programmable_private.reward_snapshot_provider_evidence as evidence
      on evidence.reward_snapshot_evidence_id = requested.evidence_id
     and evidence.run_id = p_run_id
     and evidence.execution_evidence_id = p_execution_evidence_id
    order by requested.evidence_ordinal
  loop
    ordinal := ordinal + 1;
    insert into programmable_private.projection_publication_reward_evidence (
      provider_binding_id, evidence_ordinal,
      reward_snapshot_evidence_id, run_id,
      execution_evidence_id, vault
    ) values (
      p_provider_binding_id, ordinal,
      evidence_record.reward_snapshot_evidence_id,
      p_run_id, p_execution_evidence_id, evidence_record.vault
    );
  end loop;
  if ordinal <> pg_catalog.cardinality(p_reward_snapshot_evidence_ids) then
    raise exception using
      errcode = '23514',
      message = 'publication reward evidence binding is incomplete';
  end if;
  perform programmable_private.append_mutation_audit(
    'projection.provider_evidence.bind',
    p_provider_binding_commitment, p_run_id, p_bound_at
  );
  return p_provider_binding_id;
end
$function$;

create function programmable_private.append_projection_provider_execution_evidence_v1(
  p_execution_evidence_id uuid,
  p_run_id uuid,
  p_safe_head_observation_id uuid,
  p_configured_provider_deployment_ids uuid[],
  p_execution_trace jsonb,
  p_execution_trace_commitment bytea,
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
  observation programmable_private.safe_head_observations%rowtype;
  existing
    programmable_private.projection_provider_execution_evidence%rowtype;
  envio_provider programmable_private.provider_deployments%rowtype;
  provider_a programmable_private.rpc_provider_deployment_metadata%rowtype;
  provider_b programmable_private.rpc_provider_deployment_metadata%rowtype;
  expected_preimage bytea;
  execution_trace_preimage bytea;
  provider_a_identity text;
  provider_b_identity text;
  provider_a_call_count integer;
  provider_b_call_count integer;
  candidate_batch_size integer;
  hard_deadline_ms integer;
  maximum_calls_per_provider integer;
  elapsed_ms integer;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_provider_evidence_encoding(
    'projection_execution', p_encoding_version,
    p_canonical_preimage, p_content_fingerprint
  );
  if p_execution_evidence_id is null
     or p_run_id is null
     or p_safe_head_observation_id is null
     or coalesce(
       pg_catalog.cardinality(p_configured_provider_deployment_ids), 0
     ) <> 3
     or exists (
       select 1
       from pg_catalog.unnest(p_configured_provider_deployment_ids) as item
       where item is null
     )
     or pg_catalog.cardinality(p_configured_provider_deployment_ids) <>
       (
         select pg_catalog.count(distinct item)
         from pg_catalog.unnest(
           p_configured_provider_deployment_ids
         ) as item
       )
     or pg_catalog.octet_length(p_execution_trace_commitment) <> 32
     or pg_catalog.octet_length(p_content_fingerprint) <> 32
     or p_execution_trace_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_content_fingerprint =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  then
    raise exception using
      errcode = '22023',
      message = 'invalid projection provider execution evidence';
  end if;

  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind = 'projection'
  for share;
  if not found
     or exists (
       select 1
       from programmable_private.run_lifecycle_outcomes
       where run_id = p_run_id
     )
  then
    raise exception using
      errcode = '55000', message = 'projection run is not open';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id,
    header.source_group, header.epoch_id,
    header.captured_pointer_generation
  );

  select * into observation
  from programmable_private.safe_head_observations
  where observation_id = p_safe_head_observation_id
    and epoch_id = header.epoch_id
    and chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and pointer_generation = header.captured_pointer_generation;
  if not found
     or p_configured_provider_deployment_ids[2] <>
       observation.provider_a_id
     or p_configured_provider_deployment_ids[3] <>
       observation.provider_b_id
  then
    raise exception using
      errcode = '23514',
      message = 'execution evidence does not match its safe-head providers';
  end if;

  select * into envio_provider
  from programmable_private.provider_deployments
  where provider_deployment_id =
      p_configured_provider_deployment_ids[1]
    and provider_type = 'envio_deployment';
  select * into provider_a
  from programmable_private.rpc_provider_deployment_metadata
  where provider_deployment_id = observation.provider_a_id
    and chain_id = header.chain_id
    and vendor = 'alchemy'
    and vendor_order = 1;
  select * into provider_b
  from programmable_private.rpc_provider_deployment_metadata
  where provider_deployment_id = observation.provider_b_id
    and chain_id = header.chain_id
    and vendor = 'quicknode'
    and vendor_order = 2;
  if envio_provider.provider_deployment_id is null
     or provider_a.provider_deployment_id is null
     or provider_b.provider_deployment_id is null
  then
    raise exception using
      errcode = '23503',
      message = 'configured projection provider set is not registered';
  end if;

  perform programmable_private.validate_projection_execution_trace_v1(
    p_execution_trace, observation.provider_a_id, observation.provider_b_id
  );
  execution_trace_preimage :=
    programmable_private.projection_execution_trace_preimage_v1(
      p_execution_trace
    );
  if p_execution_trace_commitment <>
     pg_catalog.sha256(execution_trace_preimage)
  then
    raise exception using
      errcode = '23514',
      message = 'projection execution trace commitment changed';
  end if;
  provider_a_identity := provider_a.vendor || '-mainnet-' ||
    pg_catalog.substring(
      pg_catalog.encode(
        (
          select deployment_commitment
          from programmable_private.provider_deployments
          where provider_deployment_id = observation.provider_a_id
        ),
        'hex'
      ),
      1, 32
    );
  provider_b_identity := provider_b.vendor || '-mainnet-' ||
    pg_catalog.substring(
      pg_catalog.encode(
        (
          select deployment_commitment
          from programmable_private.provider_deployments
          where provider_deployment_id = observation.provider_b_id
        ),
        'hex'
      ),
      1, 32
    );
  provider_a_call_count :=
    (p_execution_trace #>> '{providerCallCounts,0}')::integer;
  provider_b_call_count :=
    (p_execution_trace #>> '{providerCallCounts,1}')::integer;
  candidate_batch_size :=
    (p_execution_trace ->> 'candidateBatchSize')::integer;
  hard_deadline_ms :=
    (p_execution_trace ->> 'hardDeadlineMs')::integer;
  maximum_calls_per_provider :=
    (p_execution_trace ->> 'maxCallsPerProvider')::integer;
  elapsed_ms := (p_execution_trace ->> 'elapsedMs')::integer;
  expected_preimage :=
    programmable_private.projection_execution_evidence_preimage_v1(
      header.chain_id, header.release_id, header.model_id,
      header.source_group, header.epoch_id,
      header.captured_pointer_generation, p_run_id,
      observation.provider_a_id, observation.provider_b_id,
      provider_a_identity, provider_b_identity,
      provider_a.vendor, provider_b.vendor,
      provider_a.endpoint_url_commitment,
      provider_b.endpoint_url_commitment,
      provider_a.endpoint_origin_commitment,
      provider_b.endpoint_origin_commitment,
      provider_a_call_count, provider_b_call_count,
      candidate_batch_size, hard_deadline_ms,
      maximum_calls_per_provider, elapsed_ms,
      p_execution_trace_commitment
    );
  if p_canonical_preimage <> expected_preimage then
    raise exception using
      errcode = '23514',
      message = 'projection execution evidence codec mismatch';
  end if;

  select * into existing
  from programmable_private.projection_provider_execution_evidence
  where execution_evidence_id = p_execution_evidence_id
     or run_id = p_run_id;
  if found then
    if existing.execution_evidence_id <> p_execution_evidence_id
       or existing.run_id <> p_run_id
       or existing.safe_head_observation_id <>
         p_safe_head_observation_id
       or existing.configured_provider_deployment_ids <>
         p_configured_provider_deployment_ids
       or existing.execution_trace <> p_execution_trace
       or existing.execution_trace_preimage <> execution_trace_preimage
       or existing.execution_trace_commitment <>
         p_execution_trace_commitment
       or existing.encoding_version <> p_encoding_version
       or existing.canonical_preimage <> p_canonical_preimage
       or existing.content_fingerprint <> p_content_fingerprint
    then
      raise exception using
        errcode = '23505',
        message = 'projection execution evidence replay changed content';
    end if;
    return existing.execution_evidence_id;
  end if;

  insert into programmable_private.projection_provider_execution_evidence (
    execution_evidence_id, run_id, safe_head_observation_id,
    epoch_id, chain_id, pointer_generation,
    configured_provider_deployment_ids,
    envio_provider_deployment_id, provider_a_id, provider_b_id,
    provider_a_vendor, provider_b_vendor,
    provider_a_identity, provider_b_identity,
    provider_a_endpoint_url_commitment,
    provider_b_endpoint_url_commitment,
    provider_a_endpoint_origin_commitment,
    provider_b_endpoint_origin_commitment,
    provider_a_call_count, provider_b_call_count,
    candidate_batch_size, hard_deadline_ms,
    maximum_calls_per_provider, elapsed_ms,
    execution_trace, execution_trace_preimage,
    execution_trace_commitment, encoding_version,
    canonical_preimage, content_fingerprint, verified_at
  ) values (
    p_execution_evidence_id, p_run_id, p_safe_head_observation_id,
    header.epoch_id, header.chain_id,
    header.captured_pointer_generation,
    p_configured_provider_deployment_ids,
    p_configured_provider_deployment_ids[1],
    observation.provider_a_id, observation.provider_b_id,
    provider_a.vendor, provider_b.vendor,
    provider_a_identity, provider_b_identity,
    provider_a.endpoint_url_commitment,
    provider_b.endpoint_url_commitment,
    provider_a.endpoint_origin_commitment,
    provider_b.endpoint_origin_commitment,
    provider_a_call_count, provider_b_call_count,
    candidate_batch_size, hard_deadline_ms,
    maximum_calls_per_provider, elapsed_ms,
    p_execution_trace, execution_trace_preimage,
    p_execution_trace_commitment,
    p_encoding_version, p_canonical_preimage,
    p_content_fingerprint, p_verified_at
  );
  perform programmable_private.append_mutation_audit(
    'projection.provider_execution.append',
    p_content_fingerprint, p_run_id, p_verified_at
  );
  return p_execution_evidence_id;
end
$function$;

create function programmable_private.append_reward_snapshot_provider_evidence_v1(
  p_reward_snapshot_evidence_id uuid,
  p_run_id uuid,
  p_execution_evidence_id uuid,
  p_target_block_evidence_id uuid,
  p_vault bytea,
  p_model_id text,
  p_reward_model text,
  p_target_block_number numeric,
  p_target_block_hash bytea,
  p_provider_a_snapshot_commitment bytea,
  p_provider_b_snapshot_commitment bytea,
  p_provider_a_call_count integer,
  p_provider_b_call_count integer,
  p_verification_accounts bytea[],
  p_verification_account_chunk_end_offsets integer[],
  p_provider_a_verification_chunk_commitments bytea[],
  p_provider_b_verification_chunk_commitments bytea[],
  p_provider_a_verification_chunk_call_counts integer[],
  p_provider_b_verification_chunk_call_counts integer[],
  p_folded_snapshot_commitment bytea,
  p_execution_trace jsonb,
  p_execution_trace_commitment bytea,
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
  execution
    programmable_private.projection_provider_execution_evidence%rowtype;
  block_evidence programmable_private.dual_rpc_block_evidence%rowtype;
  staged_vault programmable_private.reward_vault_projections%rowtype;
  existing programmable_private.reward_snapshot_provider_evidence%rowtype;
  expected_preimage bytea;
  target_block bigint;
  expected_reward_model text;
  ordered_verification_accounts bytea[];
  expected_verification_accounts bytea[];
  folded_snapshot_preimage bytea;
  execution_trace_preimage bytea;
  chunk_count integer;
  chunk_index integer;
  chunk_call_total integer := 0;
begin
  perform programmable_private.assert_caller('programmable_projector');
  perform programmable_private.assert_provider_evidence_encoding(
    'reward_snapshot', p_encoding_version,
    p_canonical_preimage, p_content_fingerprint
  );
  if p_reward_snapshot_evidence_id is null
     or p_run_id is null
     or p_execution_evidence_id is null
     or p_target_block_evidence_id is null
     or pg_catalog.octet_length(p_vault) <> 20
     or p_model_id is null
     or p_reward_model is null
     or p_target_block_number <> pg_catalog.trunc(p_target_block_number)
     or p_target_block_number < 0
     or p_target_block_number > 9223372036854775807
     or pg_catalog.octet_length(p_target_block_hash) <> 32
     or pg_catalog.octet_length(p_provider_a_snapshot_commitment) <> 32
     or pg_catalog.octet_length(p_provider_b_snapshot_commitment) <> 32
     or p_provider_a_snapshot_commitment <>
       p_provider_b_snapshot_commitment
     or p_provider_a_snapshot_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_provider_a_call_count not between 1 and 11008
     or p_provider_b_call_count is distinct from p_provider_a_call_count
     or coalesce(pg_catalog.cardinality(p_verification_accounts), 0)
       not between 1 and 4096
     or exists (
       select 1
       from pg_catalog.unnest(p_verification_accounts) as account
       where account is null or pg_catalog.octet_length(account) <> 20
     )
     or coalesce(pg_catalog.cardinality(
       p_verification_account_chunk_end_offsets
     ), 0) not between 1 and 86
     or coalesce(pg_catalog.cardinality(
       p_provider_a_verification_chunk_commitments
     ), -1) <> pg_catalog.cardinality(
       p_verification_account_chunk_end_offsets
     )
     or coalesce(pg_catalog.cardinality(
       p_provider_b_verification_chunk_commitments
     ), -1) <> pg_catalog.cardinality(
       p_verification_account_chunk_end_offsets
     )
     or coalesce(pg_catalog.cardinality(
       p_provider_a_verification_chunk_call_counts
     ), -1) <> pg_catalog.cardinality(
       p_verification_account_chunk_end_offsets
     )
     or coalesce(pg_catalog.cardinality(
       p_provider_b_verification_chunk_call_counts
     ), -1) <> pg_catalog.cardinality(
       p_verification_account_chunk_end_offsets
     )
     or pg_catalog.octet_length(p_folded_snapshot_commitment) <> 32
     or p_folded_snapshot_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or pg_catalog.octet_length(p_execution_trace_commitment) <> 32
     or p_execution_trace_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or pg_catalog.octet_length(p_content_fingerprint) <> 32
     or p_content_fingerprint =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  then
    raise exception using
      errcode = '22023', message = 'invalid reward snapshot evidence';
  end if;
  chunk_count := pg_catalog.cardinality(
    p_verification_account_chunk_end_offsets
  );
  for chunk_index in 1..chunk_count loop
    if p_verification_account_chunk_end_offsets[chunk_index] < 1
       or p_verification_account_chunk_end_offsets[chunk_index] <>
         pg_catalog.least(
           chunk_index * 48,
           pg_catalog.cardinality(p_verification_accounts)
         )
       or pg_catalog.octet_length(
         p_provider_a_verification_chunk_commitments[chunk_index]
       ) <> 32
       or p_provider_a_verification_chunk_commitments[chunk_index] =
         pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
       or p_provider_b_verification_chunk_commitments[chunk_index]
         is distinct from
         p_provider_a_verification_chunk_commitments[chunk_index]
       or p_provider_a_verification_chunk_call_counts[chunk_index] is null
       or p_provider_a_verification_chunk_call_counts[chunk_index]
         not between 1 and 128
       or p_provider_b_verification_chunk_call_counts[chunk_index]
         is distinct from
         p_provider_a_verification_chunk_call_counts[chunk_index]
    then
      raise exception using
        errcode = '23514',
        message = 'reward verification chunk manifest changed';
    end if;
    chunk_call_total := chunk_call_total
      + p_provider_a_verification_chunk_call_counts[chunk_index];
  end loop;
  if p_verification_account_chunk_end_offsets[chunk_count] <>
       pg_catalog.cardinality(p_verification_accounts)
     or chunk_call_total <> p_provider_a_call_count
  then
    raise exception using
      errcode = '23514',
      message = 'reward verification chunks do not exactly cover reads';
  end if;
  select pg_catalog.array_agg(account order by account)
  into ordered_verification_accounts
  from pg_catalog.unnest(p_verification_accounts) as account;
  if p_verification_accounts is distinct from ordered_verification_accounts
     or pg_catalog.cardinality(p_verification_accounts) <>
       (
         select pg_catalog.count(distinct account)
         from pg_catalog.unnest(p_verification_accounts) as account
       )
  then
    raise exception using
      errcode = '22023',
      message = 'reward verification accounts are not canonical';
  end if;
  target_block := p_target_block_number::bigint;

  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind = 'projection'
  for share;
  if not found
     or header.model_id <> p_model_id
     or exists (
       select 1
       from programmable_private.run_lifecycle_outcomes
       where run_id = p_run_id
     )
  then
    raise exception using
      errcode = '55000', message = 'reward snapshot run is not open';
  end if;
  expected_reward_model := case
    when header.release_id = 'classic-v3' then 'classic-v3'
    when header.release_id in (
      'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
    ) then 'stock-paired'
    else null
  end;
  if p_reward_model is distinct from expected_reward_model then
    raise exception using
      errcode = '23514', message = 'reward snapshot model changed';
  end if;
  select * into execution
  from programmable_private.projection_provider_execution_evidence
  where execution_evidence_id = p_execution_evidence_id
    and run_id = p_run_id
    and epoch_id = header.epoch_id
    and chain_id = header.chain_id
    and pointer_generation = header.captured_pointer_generation;
  if not found then
    raise exception using
      errcode = '23503', message = 'projection execution evidence is missing';
  end if;
  perform programmable_private.validate_reward_snapshot_execution_trace_v1(
    p_execution_trace, execution.provider_a_id, execution.provider_b_id,
    p_provider_a_call_count, p_provider_b_call_count
  );
  execution_trace_preimage :=
    programmable_private.projection_execution_trace_preimage_v1(
      p_execution_trace
    );
  if p_execution_trace_commitment <>
     pg_catalog.sha256(execution_trace_preimage)
  then
    raise exception using
      errcode = '23514',
      message = 'reward execution trace commitment changed';
  end if;
  select * into block_evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_target_block_evidence_id
    and observation_id = execution.safe_head_observation_id
    and epoch_id = header.epoch_id
    and chain_id = header.chain_id
    and pointer_generation = header.captured_pointer_generation
    and block_number = target_block
    and agreed_block_hash = p_target_block_hash;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'reward snapshot target is not dual-RPC evidence';
  end if;

  select * into staged_vault
  from programmable_private.reward_vault_projections
  where projection_run_id = p_run_id
    and vault = p_vault
    and model_id = p_model_id
    and (
      snapshot_kind = 'exact_current'
      or (
        snapshot_kind = 'initial_seed'
        and exists (
          select 1
          from programmable_private.launch_projections as launch
          where launch.projection_run_id = p_run_id
            and launch.launch_projection_id =
              reward_vault_projections.launch_projection_id
            and launch.reward_vault = p_vault
            and (
              exists (
                select 1
                from programmable_private.creator_fee_checkpoint_facts as fact
                where fact.verification_run_id = p_run_id
                  and fact.vault = p_vault
              )
              or exists (
                select 1
                from programmable_private.reward_configuration_activation_facts
                  as fact
                where fact.verification_run_id = p_run_id
                  and fact.vault = p_vault
              )
              or exists (
                select 1
                from programmable_private.claim_projections as claim
                where claim.projection_run_id = p_run_id
                  and claim.vault = p_vault
              )
              or exists (
                select 1
                from programmable_private.payout_change_projections as payout
                where payout.projection_run_id = p_run_id
                  and payout.vault = p_vault
              )
            )
        )
      )
    )
    and promoted_block_number = target_block
    and promoted_block_hash = p_target_block_hash;
  if not found
     or staged_vault.epoch_id <> header.epoch_id
     or staged_vault.pointer_generation <>
       header.captured_pointer_generation
  then
    raise exception using
      errcode = '23514',
      message = 'reward snapshot evidence has no exact staged snapshot';
  end if;
  select pg_catalog.array_agg(required.account order by required.account)
  into expected_verification_accounts
  from (
    select allocation.beneficiary::bytea as account
    from programmable_private.reward_allocation_projections as allocation
    where allocation.projection_run_id = p_run_id
      and allocation.reward_vault_projection_id =
        staged_vault.reward_vault_projection_id
      and allocation.effective_to_block is null
    union
    select staged.account::bytea
    from programmable_private.account_reward_balances as staged
    left join programmable_private.current_account_reward_balances_v1
      as baseline
      on baseline.chain_id = staged.chain_id
     and baseline.release_id = staged.release_id
     and baseline.model_id = staged.model_id
     and baseline.epoch_id = staged.epoch_id
     and baseline.pointer_generation = staged.pointer_generation
     and baseline.vault = staged.vault
     and baseline.account = staged.account
    where staged.projection_run_id = p_run_id
      and staged.vault = p_vault
      and (
        baseline.account_reward_balance_id is null
        or baseline.payout_address is distinct from staged.payout_address
        or baseline.claimable_accrued is distinct from
          staged.claimable_accrued
        or baseline.claimed_total is distinct from staged.claimed_total
      )
  ) as required;
  if p_verification_accounts is distinct from
       expected_verification_accounts
  then
    raise exception using
      errcode = '23514',
      message = 'reward verification account coverage changed';
  end if;
  folded_snapshot_preimage :=
    programmable_private.reward_snapshot_folded_preimage_v1(
      p_run_id, p_vault
    );
  if p_folded_snapshot_commitment <>
     pg_catalog.sha256(folded_snapshot_preimage)
  then
    raise exception using
      errcode = '23514',
      message = 'folded reward snapshot commitment changed';
  end if;
  expected_preimage :=
    programmable_private.reward_snapshot_evidence_preimage_v1(
      header.chain_id, header.release_id, header.model_id,
      header.source_group, header.epoch_id,
      header.captured_pointer_generation,
      p_run_id, p_execution_evidence_id, p_target_block_evidence_id,
      p_vault, p_reward_model, target_block, p_target_block_hash,
      execution.provider_a_id, execution.provider_b_id,
      p_provider_a_snapshot_commitment,
      p_provider_b_snapshot_commitment,
      p_provider_a_call_count, p_provider_b_call_count,
      p_verification_accounts,
      p_verification_account_chunk_end_offsets,
      p_provider_a_verification_chunk_commitments,
      p_provider_b_verification_chunk_commitments,
      p_provider_a_verification_chunk_call_counts,
      p_provider_b_verification_chunk_call_counts,
      p_folded_snapshot_commitment,
      p_execution_trace_commitment
    );
  if p_canonical_preimage <> expected_preimage then
    raise exception using
      errcode = '23514', message = 'reward snapshot evidence codec mismatch';
  end if;

  select * into existing
  from programmable_private.reward_snapshot_provider_evidence
  where reward_snapshot_evidence_id = p_reward_snapshot_evidence_id
     or (run_id = p_run_id and vault = p_vault);
  if found then
    if existing.reward_snapshot_evidence_id <>
         p_reward_snapshot_evidence_id
       or existing.run_id <> p_run_id
       or existing.execution_evidence_id <> p_execution_evidence_id
       or existing.target_block_evidence_id <>
         p_target_block_evidence_id
       or existing.vault <> p_vault
       or existing.model_id <> p_model_id
       or existing.reward_model <> p_reward_model
       or existing.target_block_number <> target_block
       or existing.target_block_hash <> p_target_block_hash
       or existing.provider_a_id <> execution.provider_a_id
       or existing.provider_b_id <> execution.provider_b_id
       or existing.provider_a_snapshot_commitment <>
         p_provider_a_snapshot_commitment
       or existing.provider_b_snapshot_commitment <>
         p_provider_b_snapshot_commitment
       or existing.provider_a_call_count <> p_provider_a_call_count
       or existing.provider_b_call_count <> p_provider_b_call_count
       or existing.verification_accounts <> p_verification_accounts
       or existing.verification_account_chunk_end_offsets <>
         p_verification_account_chunk_end_offsets
       or existing.provider_a_verification_chunk_commitments <>
         p_provider_a_verification_chunk_commitments
       or existing.provider_b_verification_chunk_commitments <>
         p_provider_b_verification_chunk_commitments
       or existing.provider_a_verification_chunk_call_counts <>
         p_provider_a_verification_chunk_call_counts::smallint[]
       or existing.provider_b_verification_chunk_call_counts <>
         p_provider_b_verification_chunk_call_counts::smallint[]
       or existing.folded_snapshot_preimage <>
         folded_snapshot_preimage
       or existing.folded_snapshot_commitment <>
         p_folded_snapshot_commitment
       or existing.execution_trace <> p_execution_trace
       or existing.execution_trace_preimage <> execution_trace_preimage
       or existing.execution_trace_commitment <>
         p_execution_trace_commitment
       or existing.encoding_version <> p_encoding_version
       or existing.canonical_preimage <> p_canonical_preimage
       or existing.content_fingerprint <> p_content_fingerprint
    then
      raise exception using
        errcode = '23505',
        message = 'reward snapshot evidence replay changed content';
    end if;
    return existing.reward_snapshot_evidence_id;
  end if;

  insert into programmable_private.reward_snapshot_provider_evidence (
    reward_snapshot_evidence_id, run_id, execution_evidence_id,
    safe_head_observation_id, target_block_evidence_id,
    epoch_id, chain_id, pointer_generation, vault, model_id, reward_model,
    target_block_number, target_block_hash, provider_a_id, provider_b_id,
    provider_a_snapshot_commitment, provider_b_snapshot_commitment,
    provider_a_call_count, provider_b_call_count,
    verification_accounts, verification_account_chunk_end_offsets,
    provider_a_verification_chunk_commitments,
    provider_b_verification_chunk_commitments,
    provider_a_verification_chunk_call_counts,
    provider_b_verification_chunk_call_counts,
    folded_snapshot_preimage,
    folded_snapshot_commitment, execution_trace,
    execution_trace_preimage, execution_trace_commitment,
    encoding_version, canonical_preimage, content_fingerprint, verified_at
  ) values (
    p_reward_snapshot_evidence_id, p_run_id, p_execution_evidence_id,
    execution.safe_head_observation_id, p_target_block_evidence_id,
    header.epoch_id, header.chain_id,
    header.captured_pointer_generation,
    p_vault::programmable_private.eth_address,
    p_model_id::programmable_private.model_identifier,
    p_reward_model::programmable_private.model_identifier,
    target_block::programmable_private.block_number_value,
    p_target_block_hash::programmable_private.bytes32_value,
    execution.provider_a_id, execution.provider_b_id,
    p_provider_a_snapshot_commitment::programmable_private.bytes32_value,
    p_provider_b_snapshot_commitment::programmable_private.bytes32_value,
    p_provider_a_call_count,
    p_provider_b_call_count,
    p_verification_accounts::programmable_private.eth_address[],
    p_verification_account_chunk_end_offsets,
    p_provider_a_verification_chunk_commitments::
      programmable_private.bytes32_value[],
    p_provider_b_verification_chunk_commitments::
      programmable_private.bytes32_value[],
    p_provider_a_verification_chunk_call_counts::smallint[],
    p_provider_b_verification_chunk_call_counts::smallint[],
    folded_snapshot_preimage,
    p_folded_snapshot_commitment::programmable_private.bytes32_value,
    p_execution_trace, execution_trace_preimage,
    p_execution_trace_commitment::programmable_private.bytes32_value,
    p_encoding_version, p_canonical_preimage,
    p_content_fingerprint, p_verified_at
  );
  perform programmable_private.append_mutation_audit(
    'projection.reward_snapshot_evidence.append',
    p_content_fingerprint, p_run_id, p_verified_at
  );
  return p_reward_snapshot_evidence_id;
end
$function$;

create function programmable_private.assert_classic_reward_block_fold_v1(
  p_run_id uuid,
  p_vault bytea,
  p_occurrence_ids uuid[]
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  staged_vault programmable_private.reward_vault_projections%rowtype;
  baseline_vault programmable_private.reward_vault_projections%rowtype;
  block_event record;
  activation programmable_private.reward_configuration_activation_facts%rowtype;
  allocation_accounts bytea[];
  allocation_shares numeric[];
  balance_accounts bytea[];
  balance_claimable numeric[];
  balance_claimed numeric[];
  configuration_epoch bigint;
  active_configuration_hash bytea;
  received numeric;
  event_amount numeric;
  event_total numeric;
  event_account bytea;
  previous_account bytea;
  next_account bytea;
  beneficiary_total numeric;
  allocation_position integer;
  balance_position integer;
  idx integer;
  non_last_total numeric;
  allocation_credit numeric;
begin
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind = 'projection'
    and release_id = 'classic-v3';
  select * into staged_vault
  from programmable_private.reward_vault_projections
  where projection_run_id = p_run_id
    and vault = p_vault
    and snapshot_kind = 'exact_current';
  if header.run_id is null or staged_vault.reward_vault_projection_id is null
  then
    raise exception using
      errcode = '23503', message = 'Classic reward fold state is missing';
  end if;
  select * into baseline_vault
  from programmable_private.current_reward_vault_projections_v1
  where reward_vault_projection_id =
    staged_vault.baseline_reward_vault_projection_id;
  if baseline_vault.reward_vault_projection_id is null then
    raise exception using
      errcode = '23503', message = 'Classic reward fold baseline is missing';
  end if;
  select
    pg_catalog.array_agg(
      allocation.payout_address::bytea order by allocation.allocation_index
    ),
    pg_catalog.array_agg(
      allocation.share_bps::numeric order by allocation.allocation_index
    )
  into allocation_accounts, allocation_shares
  from programmable_private.reward_allocation_projections as allocation
  where allocation.reward_vault_projection_id =
      baseline_vault.reward_vault_projection_id
    and allocation.projection_run_id = baseline_vault.projection_run_id
    and allocation.effective_to_block is null;
  select
    pg_catalog.array_agg(balance.account::bytea order by balance.account),
    pg_catalog.array_agg(
      balance.claimable_accrued::numeric order by balance.account
    ),
    pg_catalog.array_agg(balance.claimed_total::numeric order by balance.account)
  into balance_accounts, balance_claimable, balance_claimed
  from programmable_private.current_account_reward_balances_v1 as balance
  where balance.chain_id = header.chain_id
    and balance.release_id = header.release_id
    and balance.model_id = header.model_id
    and balance.epoch_id = header.epoch_id
    and balance.pointer_generation = header.captured_pointer_generation
    and balance.vault = p_vault;
  if allocation_accounts is null or balance_accounts is null then
    raise exception using
      errcode = '23514', message = 'Classic reward fold baseline is incomplete';
  end if;
  configuration_epoch := baseline_vault.configuration_epoch;
  active_configuration_hash := baseline_vault.active_configuration_hash;
  received := baseline_vault.total_creator_fees_received;

  for block_event in
    select source.*, materialization.event_type,
      materialization.decoded_payload
    from pg_catalog.unnest(p_occurrence_ids)
      with ordinality as requested(occurrence_id, ordinal)
    join programmable_private.chain_event_occurrences as source
      on source.occurrence_id = requested.occurrence_id
    join programmable_private.chain_event_occurrence_materializations
      as materialization
      on materialization.occurrence_id = source.occurrence_id
     and materialization.chain_id = header.chain_id
     and materialization.release_id = header.release_id
     and materialization.model_id = header.model_id
     and materialization.source_group = header.source_group
     and materialization.epoch_id = header.epoch_id
     and materialization.pointer_generation =
       header.captured_pointer_generation
    where source.source_address = p_vault
    order by requested.ordinal
  loop
    if block_event.event_type = 'CreatorFeesCheckpointed' then
      event_amount :=
        (block_event.decoded_payload ->> 'amount')::numeric;
      event_total :=
        (block_event.decoded_payload ->> 'totalCreatorFeesReceived')::numeric;
      if programmable_private.json_hex_bytes_v1(
           block_event.decoded_payload, 'poolId', 32
         ) is distinct from staged_vault.pool_id
         or (block_event.decoded_payload ->> 'configurationEpoch')::numeric
           is distinct from configuration_epoch::numeric
         or event_amount <= 0
         or event_total <> received + event_amount
      then
        raise exception using
          errcode = '23514',
          message = 'Classic checkpoint does not match ordered state';
      end if;
      non_last_total := 0;
      for idx in 1..pg_catalog.cardinality(allocation_accounts) loop
        if idx < pg_catalog.cardinality(allocation_accounts) then
          allocation_credit := pg_catalog.div(
            event_amount * allocation_shares[idx], 10000
          );
          non_last_total := non_last_total + allocation_credit;
        else
          allocation_credit := event_amount - non_last_total;
        end if;
        balance_position := pg_catalog.array_position(
          balance_accounts, allocation_accounts[idx]
        );
        if balance_position is null then
          balance_accounts := pg_catalog.array_append(
            balance_accounts, allocation_accounts[idx]
          );
          balance_claimable := pg_catalog.array_append(
            balance_claimable, 0::numeric
          );
          balance_claimed := pg_catalog.array_append(
            balance_claimed, 0::numeric
          );
          balance_position := pg_catalog.cardinality(balance_accounts);
        end if;
        balance_claimable[balance_position] :=
          balance_claimable[balance_position] + allocation_credit;
      end loop;
      received := event_total;
    elsif block_event.event_type = 'BeneficiaryFeesClaimed' then
      event_account := programmable_private.json_hex_bytes_v1(
        block_event.decoded_payload, 'beneficiary', 20
      );
      event_amount := (block_event.decoded_payload ->> 'amount')::numeric;
      beneficiary_total := (
        block_event.decoded_payload ->> 'beneficiaryTotalClaimed'
      )::numeric;
      event_total := (
        block_event.decoded_payload ->> 'vaultTotalReceived'
      )::numeric;
      balance_position := pg_catalog.array_position(
        balance_accounts, event_account
      );
      if balance_position is null
         or event_total <> received
         or event_amount <= 0
         or balance_claimable[balance_position] <> event_amount
         or beneficiary_total <>
           balance_claimed[balance_position] + event_amount
      then
        raise exception using
          errcode = '23514',
          message = 'Classic claim does not match ordered state';
      end if;
      balance_claimable[balance_position] := 0;
      balance_claimed[balance_position] := beneficiary_total;
    elsif block_event.event_type = 'PayoutWalletChanged' then
      allocation_position :=
        (block_event.decoded_payload ->> 'allocationIndex')::integer + 1;
      if allocation_position not between 1 and
           pg_catalog.cardinality(allocation_accounts)
      then
        raise exception using
          errcode = '23514', message = 'Classic payout index is invalid';
      end if;
      previous_account := programmable_private.json_hex_bytes_v1(
        block_event.decoded_payload, 'previousPayoutWallet', 20
      );
      next_account := programmable_private.json_hex_bytes_v1(
        block_event.decoded_payload, 'newPayoutWallet', 20
      );
      if programmable_private.json_hex_bytes_v1(
           block_event.decoded_payload, 'poolId', 32
         ) is distinct from staged_vault.pool_id
         or previous_account <> allocation_accounts[allocation_position]
         or next_account = previous_account
         or (block_event.decoded_payload ->> 'shareBps')::numeric <>
           allocation_shares[allocation_position]
         or (block_event.decoded_payload ->> 'configurationEpoch')::numeric
           <> configuration_epoch + 1
         or (block_event.decoded_payload ->>
           'effectiveTotalCreatorFeesReceived')::numeric <> received
      then
        raise exception using
          errcode = '23514',
          message = 'Classic payout change does not match ordered state';
      end if;
      allocation_accounts[allocation_position] := next_account;
      balance_position := pg_catalog.array_position(
        balance_accounts, next_account
      );
      if balance_position is null then
        balance_accounts := pg_catalog.array_append(
          balance_accounts, next_account
        );
        balance_claimable := pg_catalog.array_append(
          balance_claimable, 0::numeric
        );
        balance_claimed := pg_catalog.array_append(
          balance_claimed, 0::numeric
        );
      end if;
      configuration_epoch := configuration_epoch + 1;
      active_configuration_hash :=
        programmable_private.json_hex_bytes_v1(
          block_event.decoded_payload, 'activeConfigurationHash', 32
        );
    elsif block_event.event_type = 'CtoRewardConfigurationActivated' then
      select * into activation
      from programmable_private.reward_configuration_activation_facts
      where source_occurrence_id = block_event.occurrence_id
        and verification_run_id = p_run_id
        and vault = p_vault
        and pool_id = staged_vault.pool_id;
      if activation.reward_configuration_activation_fact_id is null
         or activation.configuration_epoch <> configuration_epoch + 1
         or activation.previous_configuration_hash <>
           active_configuration_hash
         or activation.effective_total_creator_fees_received <> received
      then
        raise exception using
          errcode = '23514',
          message = 'Classic CTO change does not match ordered state';
      end if;
      allocation_accounts := activation.ordered_beneficiaries::bytea[];
      allocation_shares := activation.ordered_shares_bps::numeric[];
      for idx in 1..pg_catalog.cardinality(allocation_accounts) loop
        if pg_catalog.array_position(
          balance_accounts, allocation_accounts[idx]
        ) is null then
          balance_accounts := pg_catalog.array_append(
            balance_accounts, allocation_accounts[idx]
          );
          balance_claimable := pg_catalog.array_append(
            balance_claimable, 0::numeric
          );
          balance_claimed := pg_catalog.array_append(
            balance_claimed, 0::numeric
          );
        end if;
      end loop;
      configuration_epoch := activation.configuration_epoch;
      active_configuration_hash := activation.new_configuration_hash;
    else
      raise exception using
        errcode = '23514', message = 'Classic reward event is unsupported';
    end if;
  end loop;

  if staged_vault.configuration_epoch <> configuration_epoch
     or staged_vault.active_configuration_hash <>
       active_configuration_hash
     or staged_vault.total_creator_fees_received <> received
     or (
       select pg_catalog.count(*)
       from programmable_private.reward_allocation_projections as allocation
       where allocation.projection_run_id = p_run_id
         and allocation.reward_vault_projection_id =
           staged_vault.reward_vault_projection_id
     ) <> pg_catalog.cardinality(allocation_accounts)
     or exists (
       select 1
       from pg_catalog.generate_series(
         1, pg_catalog.cardinality(allocation_accounts)
       ) as position
       where not exists (
         select 1
         from programmable_private.reward_allocation_projections as allocation
         where allocation.projection_run_id = p_run_id
           and allocation.reward_vault_projection_id =
             staged_vault.reward_vault_projection_id
           and allocation.allocation_index = position - 1
           and allocation.beneficiary = allocation_accounts[position]
           and allocation.payout_address = allocation_accounts[position]
           and allocation.share_bps = allocation_shares[position]
           and allocation.configuration_epoch = configuration_epoch
       )
     )
     or (
       select pg_catalog.count(*)
       from programmable_private.account_reward_balances as balance
       where balance.projection_run_id = p_run_id
         and balance.vault = p_vault
     ) <> pg_catalog.cardinality(balance_accounts)
     or exists (
       select 1
       from pg_catalog.generate_series(
         1, pg_catalog.cardinality(balance_accounts)
       ) as position
       where not exists (
         select 1
         from programmable_private.account_reward_balances as balance
         where balance.projection_run_id = p_run_id
           and balance.vault = p_vault
           and balance.account = balance_accounts[position]
           and balance.payout_address = balance_accounts[position]
           and balance.claimable_accrued = balance_claimable[position]
           and balance.claimed_total = balance_claimed[position]
       )
     )
  then
    raise exception using
      errcode = '23514',
      message = 'Classic staged snapshot differs from ordered block fold';
  end if;
end
$function$;

create function programmable_private.assert_stock_reward_block_fold_v1(
  p_run_id uuid,
  p_vault bytea,
  p_occurrence_ids uuid[]
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  staged_vault programmable_private.reward_vault_projections%rowtype;
  baseline_vault programmable_private.reward_vault_projections%rowtype;
  block_event record;
  allocation_accounts bytea[];
  allocation_payouts bytea[];
  allocation_shares numeric[];
  balance_accounts bytea[];
  balance_payouts bytea[];
  balance_claimable numeric[];
  balance_claimed numeric[];
  event_account bytea;
  previous_account bytea;
  next_account bytea;
  event_recipient bytea;
  event_amount numeric;
  event_beneficiary_total numeric;
  event_vault_total numeric;
  allocation_position integer;
  balance_position integer;
  idx integer;
  non_last_total numeric := 0;
  entitlement numeric;
begin
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind = 'projection'
    and release_id in (
      'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
    );
  select * into staged_vault
  from programmable_private.reward_vault_projections
  where projection_run_id = p_run_id
    and vault = p_vault
    and snapshot_kind = 'exact_current';
  if header.run_id is null or staged_vault.reward_vault_projection_id is null
  then
    raise exception using
      errcode = '23503', message = 'Stock reward fold state is missing';
  end if;
  select * into baseline_vault
  from programmable_private.current_reward_vault_projections_v1
  where reward_vault_projection_id =
    staged_vault.baseline_reward_vault_projection_id;
  if baseline_vault.reward_vault_projection_id is null then
    raise exception using
      errcode = '23503', message = 'Stock reward fold baseline is missing';
  end if;
  select
    pg_catalog.array_agg(
      allocation.beneficiary::bytea order by allocation.allocation_index
    ),
    pg_catalog.array_agg(
      allocation.payout_address::bytea order by allocation.allocation_index
    ),
    pg_catalog.array_agg(
      allocation.share_bps::numeric order by allocation.allocation_index
    )
  into allocation_accounts, allocation_payouts, allocation_shares
  from programmable_private.reward_allocation_projections as allocation
  where allocation.reward_vault_projection_id =
      baseline_vault.reward_vault_projection_id
    and allocation.projection_run_id = baseline_vault.projection_run_id
    and allocation.effective_to_block is null;
  select
    pg_catalog.array_agg(balance.account::bytea order by balance.account),
    pg_catalog.array_agg(
      balance.payout_address::bytea order by balance.account
    ),
    pg_catalog.array_agg(
      balance.claimable_accrued::numeric order by balance.account
    ),
    pg_catalog.array_agg(balance.claimed_total::numeric order by balance.account)
  into balance_accounts, balance_payouts, balance_claimable, balance_claimed
  from programmable_private.current_account_reward_balances_v1 as balance
  where balance.chain_id = header.chain_id
    and balance.release_id = header.release_id
    and balance.model_id = header.model_id
    and balance.epoch_id = header.epoch_id
    and balance.pointer_generation = header.captured_pointer_generation
    and balance.vault = p_vault;
  if allocation_accounts is null or balance_accounts is null then
    raise exception using
      errcode = '23514', message = 'Stock reward fold baseline is incomplete';
  end if;

  for block_event in
    select source.*, materialization.event_type,
      materialization.decoded_payload
    from pg_catalog.unnest(p_occurrence_ids)
      with ordinality as requested(occurrence_id, ordinal)
    join programmable_private.chain_event_occurrences as source
      on source.occurrence_id = requested.occurrence_id
    join programmable_private.chain_event_occurrence_materializations
      as materialization
      on materialization.occurrence_id = source.occurrence_id
     and materialization.chain_id = header.chain_id
     and materialization.release_id = header.release_id
     and materialization.model_id = header.model_id
     and materialization.source_group = header.source_group
     and materialization.epoch_id = header.epoch_id
     and materialization.pointer_generation =
       header.captured_pointer_generation
    where source.source_address = p_vault
    order by requested.ordinal
  loop
    if block_event.event_type = 'PayoutAddressUpdated' then
      event_account := programmable_private.json_hex_bytes_v1(
        block_event.decoded_payload, 'beneficiary', 20
      );
      previous_account := programmable_private.json_hex_bytes_v1(
        block_event.decoded_payload, 'previousPayoutAddress', 20
      );
      next_account := programmable_private.json_hex_bytes_v1(
        block_event.decoded_payload, 'newPayoutAddress', 20
      );
      allocation_position := pg_catalog.array_position(
        allocation_accounts, event_account
      );
      balance_position := pg_catalog.array_position(
        balance_accounts, event_account
      );
      if allocation_position is null
         or balance_position is null
         or previous_account <> allocation_payouts[allocation_position]
         or previous_account <> balance_payouts[balance_position]
         or next_account = previous_account
      then
        raise exception using
          errcode = '23514',
          message = 'Stock payout change does not match ordered state';
      end if;
      allocation_payouts[allocation_position] := next_account;
      balance_payouts[balance_position] := next_account;
    elsif block_event.event_type = 'BeneficiaryFeesClaimed' then
      event_account := programmable_private.json_hex_bytes_v1(
        block_event.decoded_payload, 'beneficiary', 20
      );
      event_recipient := programmable_private.json_hex_bytes_v1(
        block_event.decoded_payload, 'payoutAddress', 20
      );
      event_amount := (block_event.decoded_payload ->> 'amount')::numeric;
      event_beneficiary_total := (
        block_event.decoded_payload ->> 'beneficiaryTotalClaimed'
      )::numeric;
      event_vault_total := (
        block_event.decoded_payload ->> 'vaultTotalReceived'
      )::numeric;
      balance_position := pg_catalog.array_position(
        balance_accounts, event_account
      );
      if balance_position is null
         or event_recipient <> balance_payouts[balance_position]
         or event_amount <= 0
         or event_beneficiary_total <>
           balance_claimed[balance_position] + event_amount
         or event_vault_total > staged_vault.total_creator_fees_received
      then
        raise exception using
          errcode = '23514',
          message = 'Stock claim does not match ordered state';
      end if;
      balance_claimed[balance_position] := event_beneficiary_total;
    else
      raise exception using
        errcode = '23514', message = 'Stock reward event is unsupported';
    end if;
  end loop;

  if staged_vault.configuration_epoch <>
       baseline_vault.configuration_epoch
     or staged_vault.active_configuration_hash <>
       baseline_vault.active_configuration_hash
     or staged_vault.total_creator_fees_received <
       baseline_vault.total_creator_fees_received
     or (
       select pg_catalog.count(*)
       from programmable_private.reward_allocation_projections as allocation
       where allocation.projection_run_id = p_run_id
         and allocation.reward_vault_projection_id =
           staged_vault.reward_vault_projection_id
     ) <> pg_catalog.cardinality(allocation_accounts)
     or exists (
       select 1
       from pg_catalog.generate_series(
         1, pg_catalog.cardinality(allocation_accounts)
       ) as position
       where not exists (
         select 1
         from programmable_private.reward_allocation_projections as allocation
         where allocation.projection_run_id = p_run_id
           and allocation.reward_vault_projection_id =
             staged_vault.reward_vault_projection_id
           and allocation.allocation_index = position - 1
           and allocation.beneficiary = allocation_accounts[position]
           and allocation.payout_address = allocation_payouts[position]
           and allocation.share_bps = allocation_shares[position]
           and allocation.configuration_epoch =
             staged_vault.configuration_epoch
       )
     )
  then
    raise exception using
      errcode = '23514',
      message = 'Stock staged allocation differs from ordered block fold';
  end if;

  non_last_total := 0;
  for idx in 1..pg_catalog.cardinality(allocation_accounts) loop
    if idx < pg_catalog.cardinality(allocation_accounts) then
      entitlement := pg_catalog.div(
        staged_vault.total_creator_fees_received * allocation_shares[idx],
        10000
      );
      non_last_total := non_last_total + entitlement;
    else
      entitlement := staged_vault.total_creator_fees_received
        - non_last_total;
    end if;
    balance_position := pg_catalog.array_position(
      balance_accounts, allocation_accounts[idx]
    );
    if balance_position is null
       or entitlement < balance_claimed[balance_position]
    then
      raise exception using
        errcode = '23514', message = 'Stock entitlement is incomplete';
    end if;
    balance_claimable[balance_position] :=
      entitlement - balance_claimed[balance_position];
  end loop;
  if (
       select pg_catalog.count(*)
       from programmable_private.account_reward_balances as balance
       where balance.projection_run_id = p_run_id
         and balance.vault = p_vault
     ) <> pg_catalog.cardinality(balance_accounts)
     or exists (
       select 1
       from pg_catalog.generate_series(
         1, pg_catalog.cardinality(balance_accounts)
       ) as position
       where not exists (
         select 1
         from programmable_private.account_reward_balances as balance
         where balance.projection_run_id = p_run_id
           and balance.vault = p_vault
           and balance.account = balance_accounts[position]
           and balance.payout_address = balance_payouts[position]
           and balance.claimable_accrued = balance_claimable[position]
           and balance.claimed_total = balance_claimed[position]
       )
     )
  then
    raise exception using
      errcode = '23514',
      message = 'Stock staged balances differ from ordered block fold';
  end if;
end
$function$;

create function programmable_private.stage_current_reward_snapshot_v2(
  p_run_id uuid,
  p_vault bytea,
  p_pool_id bytea,
  p_initial_allocation_fact_id uuid,
  p_configuration_epoch bigint,
  p_active_configuration_hash bytea,
  p_total_creator_fees_received numeric,
  p_allocation_indices integer[],
  p_beneficiaries bytea[],
  p_payout_addresses bytea[],
  p_shares_bps numeric[],
  p_balance_accounts bytea[],
  p_balance_payout_addresses bytea[],
  p_claimable_accrued numeric[],
  p_claimed_totals numeric[],
  p_snapshot_source_occurrence_id uuid,
  p_occurrence_ids uuid[],
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
  header programmable_private.run_headers%rowtype;
  scope record;
  baseline record;
  existing_vault programmable_private.reward_vault_projections%rowtype;
  returned_id uuid;
  allocation_id uuid;
  balance_id uuid;
  allocation_count integer;
  balance_count integer;
  total_share_bps numeric := 0;
  total_balance_value numeric := 0;
  normalized_total numeric;
  idx integer;
  prior_idx integer;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind = 'projection'
  for share;
  if not found then
    raise exception using
      errcode = '23503', message = 'invalid reward snapshot run';
  end if;
  if coalesce(pg_catalog.cardinality(p_occurrence_ids), 0) <= 1 then
    return programmable_private.stage_current_reward_snapshot_v1(
      p_run_id, p_vault, p_pool_id, p_initial_allocation_fact_id,
      p_configuration_epoch, p_active_configuration_hash,
      p_total_creator_fees_received, p_allocation_indices,
      p_beneficiaries, p_payout_addresses, p_shares_bps,
      p_balance_accounts, p_balance_payout_addresses,
      p_claimable_accrued, p_claimed_totals,
      p_snapshot_source_occurrence_id, p_promoted_block_number,
      p_promoted_block_hash, p_verified_at
    );
  end if;
  if header.release_id not in (
    'classic-v3',
    'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
  ) then
    raise exception using
      errcode = '55000', message = 'grouped reward release is unsupported';
  end if;

  select * into scope
  from programmable_private.projection_stage_context(
    p_run_id, p_snapshot_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  normalized_total := programmable_private.validate_uint256(
    p_total_creator_fees_received
  );
  allocation_count := coalesce(
    pg_catalog.cardinality(p_allocation_indices), 0
  );
  balance_count := coalesce(pg_catalog.cardinality(p_balance_accounts), 0);
  if pg_catalog.octet_length(p_vault) <> 20
     or pg_catalog.octet_length(p_pool_id) <> 32
     or pg_catalog.octet_length(p_active_configuration_hash) <> 32
     or p_configuration_epoch is null
     or p_configuration_epoch <= 0
     or coalesce(pg_catalog.cardinality(p_occurrence_ids), 0)
       not between 2 and 4096
     or not (p_snapshot_source_occurrence_id = any(p_occurrence_ids))
     or p_snapshot_source_occurrence_id is distinct from (
       select requested.occurrence_id
       from pg_catalog.unnest(p_occurrence_ids)
         with ordinality as requested(occurrence_id, ordinal)
       join programmable_private.chain_event_occurrences as source
         on source.occurrence_id = requested.occurrence_id
       where source.source_address = p_vault
       order by requested.ordinal desc
       limit 1
     )
     or allocation_count not between 1 and (
       case when header.release_id = 'classic-v3' then 5 else 8 end
     )
     or pg_catalog.cardinality(p_beneficiaries) <> allocation_count
     or pg_catalog.cardinality(p_payout_addresses) <> allocation_count
     or pg_catalog.cardinality(p_shares_bps) <> allocation_count
     or balance_count not between 1 and 65535
     or pg_catalog.cardinality(p_balance_payout_addresses) <> balance_count
     or pg_catalog.cardinality(p_claimable_accrued) <> balance_count
     or pg_catalog.cardinality(p_claimed_totals) <> balance_count
  then
    raise exception using
      errcode = '22023', message = 'invalid grouped reward snapshot';
  end if;
  for idx in 1..allocation_count loop
    if p_allocation_indices[idx] <> idx - 1
       or pg_catalog.octet_length(p_beneficiaries[idx]) <> 20
       or pg_catalog.octet_length(p_payout_addresses[idx]) <> 20
       or (
         header.release_id = 'classic-v3'
         and p_beneficiaries[idx] <> p_payout_addresses[idx]
       )
       or p_shares_bps[idx] is null
       or p_shares_bps[idx] <> pg_catalog.trunc(p_shares_bps[idx])
       or p_shares_bps[idx] not between 1 and 10000
    then
      raise exception using
        errcode = '22023', message = 'invalid grouped reward allocation';
    end if;
    if header.release_id <> 'classic-v3' and idx > 1 then
      for prior_idx in 1..idx - 1 loop
        if p_beneficiaries[prior_idx] = p_beneficiaries[idx] then
          raise exception using
            errcode = '22023',
            message = 'grouped Stock beneficiaries must remain unique';
        end if;
      end loop;
    end if;
    total_share_bps := total_share_bps + p_shares_bps[idx];
  end loop;
  if total_share_bps <> 10000 then
    raise exception using
      errcode = '22023', message = 'grouped reward shares do not conserve';
  end if;
  for idx in 1..balance_count loop
    if pg_catalog.octet_length(p_balance_accounts[idx]) <> 20
       or pg_catalog.octet_length(
         p_balance_payout_addresses[idx]
       ) <> 20
       or (
         header.release_id = 'classic-v3'
         and p_balance_accounts[idx] <>
           p_balance_payout_addresses[idx]
       )
       or (
         idx > 1 and
         p_balance_accounts[idx - 1] >= p_balance_accounts[idx]
       )
    then
      raise exception using
        errcode = '22023', message = 'invalid grouped reward balance';
    end if;
    total_balance_value := total_balance_value
      + programmable_private.validate_uint256(p_claimable_accrued[idx])
      + programmable_private.validate_uint256(p_claimed_totals[idx]);
  end loop;
  if total_balance_value <> normalized_total then
    raise exception using
      errcode = '23514', message = 'grouped reward balances do not conserve';
  end if;

  select
    vault.*,
    entity.checkpoint_id as current_checkpoint_id,
    checkpoint.checkpoint_generation as current_checkpoint_generation,
    checkpoint.reorg_generation as current_reorg_generation
  into baseline
  from programmable_private.current_reward_vault_projections_v1 as vault
  join programmable_private.projection_entity_current as entity
    on entity.entity_kind = 'reward_vault'
   and entity.projection_row_id = vault.reward_vault_projection_id
   and entity.projection_run_id = vault.projection_run_id
   and entity.chain_id = vault.chain_id
   and entity.release_id = vault.release_id
   and entity.model_id = vault.model_id
   and entity.source_group = header.source_group
  join programmable_private.projector_checkpoints as baseline_checkpoint
    on baseline_checkpoint.checkpoint_id = entity.checkpoint_id
   and baseline_checkpoint.epoch_id = header.epoch_id
   and baseline_checkpoint.pointer_generation =
     header.captured_pointer_generation
  join programmable_private.projector_checkpoint_current as current_pointer
    on current_pointer.chain_id = baseline_checkpoint.chain_id
   and current_pointer.release_id = baseline_checkpoint.release_id
   and current_pointer.model_id = baseline_checkpoint.model_id
   and current_pointer.source_group = baseline_checkpoint.source_group
   and current_pointer.projector_version =
     baseline_checkpoint.projector_version
  join programmable_private.projector_checkpoints as checkpoint
    on checkpoint.checkpoint_id = current_pointer.checkpoint_id
   and checkpoint.chain_id = baseline_checkpoint.chain_id
   and checkpoint.release_id = baseline_checkpoint.release_id
   and checkpoint.model_id = baseline_checkpoint.model_id
   and checkpoint.source_group = baseline_checkpoint.source_group
   and checkpoint.projector_version = baseline_checkpoint.projector_version
   and checkpoint.epoch_id = header.epoch_id
   and checkpoint.pointer_generation = header.captured_pointer_generation
   and checkpoint.checkpoint_generation =
     current_pointer.checkpoint_generation
   and checkpoint.reorg_generation = current_pointer.reorg_generation
  where vault.chain_id = header.chain_id
    and vault.release_id = header.release_id
    and vault.model_id = header.model_id
    and vault.epoch_id = header.epoch_id
    and vault.pointer_generation = header.captured_pointer_generation
    and vault.vault = p_vault
    and vault.pool_id = p_pool_id;
  if baseline.reward_vault_projection_id is null
     or baseline.snapshot_kind not in ('initial_seed', 'exact_current')
     or baseline.current_allocation_fact_id <>
       p_initial_allocation_fact_id
     or normalized_total < baseline.total_creator_fees_received
  then
    raise exception using
      errcode = '23514', message = 'grouped reward baseline changed';
  end if;

  select * into existing_vault
  from programmable_private.reward_vault_projections
  where projection_run_id = p_run_id
    and vault = p_vault;
  if found then
    if existing_vault.pool_id <> p_pool_id
       or existing_vault.configuration_epoch <> p_configuration_epoch
       or existing_vault.active_configuration_hash <>
         p_active_configuration_hash
       or existing_vault.total_creator_fees_received <> normalized_total
       or existing_vault.last_source_occurrence_id <>
         p_snapshot_source_occurrence_id
    then
      raise exception using
        errcode = '23505',
        message = 'grouped reward snapshot replay changed content';
    end if;
    if header.release_id = 'classic-v3' then
      perform programmable_private.assert_classic_reward_block_fold_v1(
        p_run_id, p_vault, p_occurrence_ids
      );
    else
      perform programmable_private.assert_stock_reward_block_fold_v1(
        p_run_id, p_vault, p_occurrence_ids
      );
    end if;
    return existing_vault.reward_vault_projection_id;
  end if;

  returned_id := pg_catalog.gen_random_uuid();
  insert into programmable_private.reward_vault_projections (
    reward_vault_projection_id, launch_projection_id, chain_id, release_id,
    model_id, epoch_id, pointer_generation, vault, pool_id, quote_asset,
    configuration_hash, current_allocation_fact_id,
    last_source_logical_event_id, last_source_occurrence_id,
    last_source_occurrence_block_hash, projection_run_id,
    promoted_block_number, promoted_block_hash, verified_at,
    snapshot_kind, configuration_epoch, active_configuration_hash,
    total_creator_fees_received, baseline_reward_vault_projection_id,
    baseline_checkpoint_id, baseline_checkpoint_generation,
    baseline_reorg_generation
  ) values (
    returned_id, baseline.launch_projection_id, header.chain_id,
    header.release_id, header.model_id, header.epoch_id,
    header.captured_pointer_generation,
    p_vault::programmable_private.eth_address,
    p_pool_id::programmable_private.bytes32_value, baseline.quote_asset,
    baseline.configuration_hash, p_initial_allocation_fact_id,
    scope.source_logical_event_id, p_snapshot_source_occurrence_id,
    scope.source_occurrence_block_hash, p_run_id,
    scope.promoted_block_number, scope.promoted_block_hash, p_verified_at,
    'exact_current', p_configuration_epoch,
    p_active_configuration_hash::programmable_private.bytes32_value,
    normalized_total::programmable_private.uint256_value,
    baseline.reward_vault_projection_id, baseline.current_checkpoint_id,
    baseline.current_checkpoint_generation, baseline.current_reorg_generation
  );
  for idx in 1..allocation_count loop
    allocation_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.reward_allocation_projections (
      reward_allocation_projection_id, reward_vault_projection_id,
      allocation_fact_id, chain_id, release_id, model_id, epoch_id,
      pointer_generation, configuration_epoch, allocation_index,
      beneficiary, payout_address, share_bps, effective_from_block,
      effective_to_block, last_source_logical_event_id,
      last_source_occurrence_id, last_source_occurrence_block_hash,
      projection_run_id, promoted_block_number, promoted_block_hash,
      verified_at
    ) values (
      allocation_id, returned_id, p_initial_allocation_fact_id,
      header.chain_id, header.release_id, header.model_id, header.epoch_id,
      header.captured_pointer_generation, p_configuration_epoch,
      p_allocation_indices[idx],
      p_beneficiaries[idx]::programmable_private.eth_address,
      p_payout_addresses[idx]::programmable_private.eth_address,
      p_shares_bps[idx]::programmable_private.basis_points,
      scope.promoted_block_number, null, scope.source_logical_event_id,
      p_snapshot_source_occurrence_id, scope.source_occurrence_block_hash,
      p_run_id, scope.promoted_block_number, scope.promoted_block_hash,
      p_verified_at
    );
  end loop;
  for idx in 1..balance_count loop
    balance_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.account_reward_balances (
      account_reward_balance_id, chain_id, release_id, model_id, epoch_id,
      pointer_generation, account, vault, payout_address,
      claimable_accrued, claimed_total, last_source_logical_event_id,
      last_source_occurrence_id, last_source_occurrence_block_hash,
      projection_run_id, promoted_block_number, promoted_block_hash,
      verified_at
    ) values (
      balance_id, header.chain_id, header.release_id, header.model_id,
      header.epoch_id, header.captured_pointer_generation,
      p_balance_accounts[idx]::programmable_private.eth_address,
      p_vault::programmable_private.eth_address,
      p_balance_payout_addresses[idx]::programmable_private.eth_address,
      p_claimable_accrued[idx]::programmable_private.uint256_value,
      p_claimed_totals[idx]::programmable_private.uint256_value,
      scope.source_logical_event_id, p_snapshot_source_occurrence_id,
      scope.source_occurrence_block_hash, p_run_id,
      scope.promoted_block_number, scope.promoted_block_hash, p_verified_at
    );
  end loop;
  if header.release_id = 'classic-v3' then
    perform programmable_private.assert_classic_reward_block_fold_v1(
      p_run_id, p_vault, p_occurrence_ids
    );
  else
    perform programmable_private.assert_stock_reward_block_fold_v1(
      p_run_id, p_vault, p_occurrence_ids
    );
  end if;
  perform programmable_private.append_mutation_audit(
    'reward_snapshot_group.stage', p_active_configuration_hash,
    p_run_id, p_verified_at
  );
  return returned_id;
end
$function$;

create function programmable_private.promote_reward_block_group_v1(
  p_publication_id uuid,
  p_checkpoint_id uuid,
  p_outcome_id uuid,
  p_run_id uuid,
  p_projector_version text,
  p_lease_generation bigint,
  p_lease_token_hash bytea,
  p_expected_checkpoint_generation bigint,
  p_next_checkpoint_generation bigint,
  p_reorg_generation bigint,
  p_safe_head_observation_id uuid,
  p_target_block_evidence_id uuid,
  p_target_block_number numeric,
  p_target_block_hash bytea,
  p_cursor_block_global_log_index numeric,
  p_cursor_candidate_id text,
  p_occurrence_ids uuid[],
  p_allocation_fact_ids uuid[],
  p_allocation_evidence_ids uuid[],
  p_candidate_disposition_ids uuid[],
  p_route_keys text[],
  p_result_commitment bytea,
  p_execution_evidence_id uuid,
  p_reward_snapshot_evidence_ids uuid[],
  p_provider_binding_id uuid,
  p_provider_binding_commitment bytea,
  p_published_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  observation programmable_private.safe_head_observations%rowtype;
  target_evidence programmable_private.dual_rpc_block_evidence%rowtype;
  execution
    programmable_private.projection_provider_execution_evidence%rowtype;
  current_checkpoint
    programmable_private.projector_checkpoint_current%rowtype;
  previous_checkpoint programmable_private.projector_checkpoints%rowtype;
  staged_vault programmable_private.reward_vault_projections%rowtype;
  baseline_vault programmable_private.reward_vault_projections%rowtype;
  group_event record;
  selected_route_key text;
  target_block bigint;
  cursor_log_index bigint;
  audit_id uuid;
  status_id uuid;
  route_history_id uuid;
  ordered_occurrence_ids uuid[];
  complete_group_occurrence_ids uuid[];
  ordered_fact_ids uuid[];
  ordered_disposition_ids uuid[];
  required_disposition_ids uuid[];
  ordered_route_keys text[];
  ordered_projection_rows text[];
  projection_row_count bigint;
  vault_count bigint;
  allocation_count bigint;
  balance_count bigint;
  claim_count bigint;
  claim_event_count bigint;
  payout_count bigint;
  payout_event_count bigint;
  allocation_row_count bigint;
  balance_row_count bigint;
  terminal_event_count bigint;
  baseline_total numeric;
  checkpoint_amount_total numeric;
  checkpoint_terminal_total numeric;
  vault_terminal_occurrence_id uuid;
  total_share_bps numeric;
  total_balance_value numeric;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind = 'projection'
  for update;
  if not found then
    raise exception using
      errcode = '23503', message = 'invalid projection run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id,
    header.source_group, header.epoch_id,
    header.captured_pointer_generation
  );
  if header.release_id not in (
       'classic-v3',
       'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
     )
     or exists (
       select 1
       from programmable_private.run_lifecycle_outcomes
       where run_id = p_run_id
     )
  then
    raise exception using
      errcode = '55000', message = 'reward block run is not promotable';
  end if;
  if not exists (
    select 1
    from programmable_private.projector_lease_current as lease
    where lease.chain_id = header.chain_id
      and lease.release_id = header.release_id
      and lease.model_id = header.model_id
      and lease.source_group = header.source_group
      and lease.projector_version = p_projector_version
      and lease.epoch_id = header.epoch_id
      and lease.pointer_generation = header.captured_pointer_generation
      and lease.lease_generation = p_lease_generation
      and lease.lease_token_hash = p_lease_token_hash
      and lease.expires_at >= p_published_at
  ) then
    raise exception using
      errcode = '40001', message = 'stale projector lease';
  end if;

  select pg_catalog.count(*) into vault_count
  from programmable_private.reward_vault_projections
  where projection_run_id = p_run_id;
  if p_publication_id is null
     or p_checkpoint_id is null
     or p_outcome_id is null
     or p_provider_binding_id is null
     or p_target_block_number <> pg_catalog.trunc(p_target_block_number)
     or p_target_block_number < 0
     or p_target_block_number > 9223372036854775807
     or pg_catalog.octet_length(p_target_block_hash) <> 32
     or p_cursor_block_global_log_index < 0
     or p_cursor_block_global_log_index <>
       pg_catalog.trunc(p_cursor_block_global_log_index)
     or p_cursor_block_global_log_index > 4294967295
     or p_cursor_candidate_id is null
     or pg_catalog.octet_length(p_result_commitment) <> 32
     or pg_catalog.octet_length(p_provider_binding_commitment) <> 32
     or p_provider_binding_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_next_checkpoint_generation <>
       p_expected_checkpoint_generation + 1
     or vault_count not between 1 and 4096
     or coalesce(pg_catalog.cardinality(p_occurrence_ids), 0)
       not between 1 and 4096
     or pg_catalog.cardinality(p_allocation_fact_ids) <> vault_count
     or pg_catalog.cardinality(p_allocation_evidence_ids) <> vault_count
     or pg_catalog.cardinality(p_reward_snapshot_evidence_ids) <>
       vault_count
     or coalesce(pg_catalog.cardinality(p_route_keys), 0)
       not between 1 and 32
  then
    raise exception using
      errcode = '22023', message = 'invalid reward block promotion request';
  end if;

  select pg_catalog.array_agg(item order by item) into ordered_fact_ids
  from (
    select distinct item
    from pg_catalog.unnest(p_allocation_fact_ids) as item
  ) as unique_items;
  select pg_catalog.array_agg(item order by item)
  into ordered_disposition_ids
  from (
    select distinct item
    from pg_catalog.unnest(p_candidate_disposition_ids) as item
  ) as unique_items;
  select pg_catalog.array_agg(item order by item) into ordered_route_keys
  from (
    select distinct item
    from pg_catalog.unnest(p_route_keys) as item
  ) as unique_items;
  if p_allocation_fact_ids is distinct from ordered_fact_ids
     or p_candidate_disposition_ids is distinct from
       coalesce(ordered_disposition_ids, array[]::uuid[])
     or p_route_keys is distinct from ordered_route_keys
     or exists (
       select 1
       from pg_catalog.unnest(p_occurrence_ids) as item
       where item is null
     )
     or pg_catalog.cardinality(p_occurrence_ids) <>
       (
         select pg_catalog.count(distinct item)
         from pg_catalog.unnest(p_occurrence_ids) as item
       )
     or exists (
       select 1
       from pg_catalog.unnest(p_allocation_fact_ids) as item
       where item is null
     )
     or exists (
       select 1
       from pg_catalog.unnest(p_allocation_evidence_ids) as item
       where item is null
     )
     or pg_catalog.cardinality(p_allocation_evidence_ids) <>
       (
         select pg_catalog.count(distinct item)
         from pg_catalog.unnest(p_allocation_evidence_ids) as item
       )
     or exists (
       select 1
       from pg_catalog.unnest(p_candidate_disposition_ids) as item
       where item is null
     )
     or exists (
       select 1
       from pg_catalog.unnest(p_route_keys) as item
       where item is null
     )
  then
    raise exception using
      errcode = '22023',
      message = 'reward block arrays are not canonical';
  end if;

  target_block := p_target_block_number::bigint;
  cursor_log_index := p_cursor_block_global_log_index::bigint;
  select * into observation
  from programmable_private.safe_head_observations
  where observation_id = p_safe_head_observation_id
    and epoch_id = header.epoch_id
    and chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and pointer_generation = header.captured_pointer_generation;
  if not found or target_block > observation.safe_block_number then
    raise exception using
      errcode = '23514', message = 'target is outside accepted safe head';
  end if;
  select * into target_evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_target_block_evidence_id
    and observation_id = p_safe_head_observation_id
    and epoch_id = header.epoch_id
    and chain_id = header.chain_id
    and pointer_generation = header.captured_pointer_generation;
  if not found
     or target_evidence.block_number <> target_block
     or target_evidence.agreed_block_hash <> p_target_block_hash
  then
    raise exception using
      errcode = '23514', message = 'target block evidence changed';
  end if;
  perform programmable_private.assert_projection_provider_evidence_v1(
    'reward_snapshot_delta', p_run_id, p_safe_head_observation_id,
    p_target_block_evidence_id, target_block, p_target_block_hash,
    p_execution_evidence_id, p_reward_snapshot_evidence_ids
  );
  select * into execution
  from programmable_private.projection_provider_execution_evidence
  where execution_evidence_id = p_execution_evidence_id
    and run_id = p_run_id;

  select * into current_checkpoint
  from programmable_private.projector_checkpoint_current
  where chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and projector_version = p_projector_version
  for update;
  if not found
     or current_checkpoint.checkpoint_generation <>
       p_expected_checkpoint_generation
     or current_checkpoint.reorg_generation <> p_reorg_generation
     or p_expected_checkpoint_generation = 0
  then
    raise exception using
      errcode = '40001', message = 'reward block checkpoint CAS lost';
  end if;
  select * into previous_checkpoint
  from programmable_private.projector_checkpoints
  where checkpoint_id = current_checkpoint.checkpoint_id;
  if not found
     or previous_checkpoint.epoch_id <> header.epoch_id
     or previous_checkpoint.pointer_generation <>
       header.captured_pointer_generation
     or (
       target_block, cursor_log_index, p_cursor_candidate_id
     ) <= (
       previous_checkpoint.block_number::bigint,
       previous_checkpoint.cursor_block_global_log_index::bigint,
       previous_checkpoint.cursor_candidate_id::text
     )
  then
    raise exception using
      errcode = '23514', message = 'reward block cursor did not advance';
  end if;
  if not exists (
    select 1
    from programmable_private.envio_candidate_inbox as candidate
    where candidate.candidate_id = p_cursor_candidate_id
      and candidate.chain_id = header.chain_id
      and candidate.provider_deployment_id =
        execution.envio_provider_deployment_id
      and candidate.block_number = target_block
      and candidate.block_hash = p_target_block_hash
      and candidate.block_global_log_index = cursor_log_index
  ) then
    raise exception using
      errcode = '23514',
      message = 'reward block cursor or Envio deployment changed';
  end if;
  if exists (
    select 1
    from programmable_private.envio_candidate_inbox as candidate
    where candidate.chain_id = header.chain_id
      and candidate.provider_deployment_id <>
        execution.envio_provider_deployment_id
      and (
        candidate.block_number::bigint,
        candidate.block_global_log_index::bigint,
        candidate.candidate_id::text
      ) > (
        previous_checkpoint.block_number::bigint,
        previous_checkpoint.cursor_block_global_log_index::bigint,
        previous_checkpoint.cursor_candidate_id::text
      )
      and (
        candidate.block_number::bigint,
        candidate.block_global_log_index::bigint,
        candidate.candidate_id::text
      ) <= (target_block, cursor_log_index, p_cursor_candidate_id)
  ) then
    raise exception using
      errcode = '23514', message = 'Envio provider was substituted in range';
  end if;
  if exists (
    select 1
    from programmable_private.envio_candidate_inbox as candidate
    where candidate.chain_id = header.chain_id
      and candidate.block_number = target_block
      and (
        candidate.block_global_log_index::bigint,
        candidate.candidate_id::text
      ) > (cursor_log_index, p_cursor_candidate_id)
  ) then
    raise exception using
      errcode = '23514', message = 'reward block cursor is not block-terminal';
  end if;
  if exists (
    select 1
    from programmable_private.envio_candidate_inbox as candidate
    left join programmable_private.envio_candidate_status_current as status
      on status.candidate_id = candidate.candidate_id
     and status.epoch_id = header.epoch_id
     and status.pointer_generation = header.captured_pointer_generation
    where candidate.chain_id = header.chain_id
      and (
        candidate.block_number::bigint,
        candidate.block_global_log_index::bigint,
        candidate.candidate_id::text
      ) > (
        previous_checkpoint.block_number::bigint,
        previous_checkpoint.cursor_block_global_log_index::bigint,
        previous_checkpoint.cursor_candidate_id::text
      )
      and (
        candidate.block_number::bigint,
        candidate.block_global_log_index::bigint,
        candidate.candidate_id::text
      ) <= (target_block, cursor_log_index, p_cursor_candidate_id)
      and coalesce(status.status::text, 'pending') not in (
        'resolved', 'ignored', 'quarantined'
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'reward block cursor cannot pass a pending candidate';
  end if;
  select pg_catalog.array_agg(status.decision_id order by status.decision_id)
  into required_disposition_ids
  from programmable_private.envio_candidate_inbox as candidate
  join programmable_private.envio_candidate_status_current as status
    on status.candidate_id = candidate.candidate_id
   and status.epoch_id = header.epoch_id
   and status.pointer_generation = header.captured_pointer_generation
   and status.status in ('resolved', 'ignored', 'quarantined')
  where candidate.chain_id = header.chain_id
    and (
      candidate.block_number::bigint,
      candidate.block_global_log_index::bigint,
      candidate.candidate_id::text
    ) > (
      previous_checkpoint.block_number::bigint,
      previous_checkpoint.cursor_block_global_log_index::bigint,
      previous_checkpoint.cursor_candidate_id::text
    )
    and (
      candidate.block_number::bigint,
      candidate.block_global_log_index::bigint,
      candidate.candidate_id::text
    ) <= (target_block, cursor_log_index, p_cursor_candidate_id);
  if p_candidate_disposition_ids is distinct from
     coalesce(required_disposition_ids, array[]::uuid[])
     or execution.candidate_batch_size <>
       coalesce(pg_catalog.cardinality(required_disposition_ids), 0)
  then
    raise exception using
      errcode = '23514',
      message = 'candidate disposition manifest or execution count changed';
  end if;

  if exists (
       select 1 from programmable_private.launch_projections
       where projection_run_id = p_run_id
     )
     or exists (
       select 1 from programmable_private.pool_projections
       where projection_run_id = p_run_id
     )
     or exists (
       select 1 from programmable_private.pool_fee_configurations
       where projection_run_id = p_run_id
     )
     or exists (
       select 1 from programmable_private.fee_accrual_facts
       where projection_run_id = p_run_id
     )
     or exists (
       select 1 from programmable_private.pool_fee_totals
       where projection_run_id = p_run_id
     )
     or exists (
       select 1 from programmable_private.initial_buy_custody_projections
       where projection_run_id = p_run_id
     )
     or exists (
       select 1 from programmable_private.initial_buy_vesting_projections
       where projection_run_id = p_run_id
     )
  then
    raise exception using
      errcode = '23514',
      message = 'reward block contains another projection mode';
  end if;

  select pg_catalog.array_agg(
    source.occurrence_id
    order by source.block_number, source.block_global_log_index,
      source.transaction_index, source.receipt_log_ordinal,
      source.occurrence_id
  ) into ordered_occurrence_ids
  from pg_catalog.unnest(p_occurrence_ids) as requested(occurrence_id)
  join programmable_private.chain_event_occurrences as source
    on source.occurrence_id = requested.occurrence_id
  join programmable_private.chain_event_occurrence_materializations
    as materialization
    on materialization.occurrence_id = source.occurrence_id
   and materialization.chain_id = header.chain_id
   and materialization.release_id = header.release_id
   and materialization.model_id = header.model_id
   and materialization.source_group = header.source_group
   and materialization.epoch_id = header.epoch_id
   and materialization.pointer_generation =
     header.captured_pointer_generation;
  if ordered_occurrence_ids is distinct from p_occurrence_ids
     or pg_catalog.cardinality(ordered_occurrence_ids) <>
       pg_catalog.cardinality(p_occurrence_ids)
  then
    raise exception using
      errcode = '23514',
      message = 'reward block occurrences are incomplete or misordered';
  end if;

  select pg_catalog.array_agg(
    source.occurrence_id
    order by source.block_number, source.block_global_log_index,
      source.transaction_index, source.receipt_log_ordinal,
      source.occurrence_id
  ) into complete_group_occurrence_ids
  from programmable_private.chain_event_occurrences as source
  join programmable_private.chain_event_occurrence_materializations
    as materialization
    on materialization.occurrence_id = source.occurrence_id
   and materialization.chain_id = header.chain_id
   and materialization.release_id = header.release_id
   and materialization.model_id = header.model_id
   and materialization.source_group = header.source_group
   and materialization.epoch_id = header.epoch_id
   and materialization.pointer_generation =
     header.captured_pointer_generation
  left join programmable_private.release_source_bindings as binding
    on binding.binding_id = materialization.release_binding_id
  left join programmable_private.dynamic_source_attestations as dynamic_source
    on dynamic_source.dynamic_source_attestation_id =
      materialization.dynamic_source_attestation_id
  where source.chain_id = header.chain_id
    and coalesce(
      binding.source_role::text,
      dynamic_source.deployed_source_role::text
    ) = 'reward_vault'
    and (
      source.block_number::bigint,
      source.block_global_log_index::bigint
    ) > (
      previous_checkpoint.block_number::bigint,
      previous_checkpoint.cursor_block_global_log_index::bigint
    )
    and (
      source.block_number::bigint,
      source.block_global_log_index::bigint
    ) <= (target_block, cursor_log_index);
  if complete_group_occurrence_ids is distinct from p_occurrence_ids then
    raise exception using
      errcode = '23514',
      message = 'reward block group omits a reward-vault occurrence';
  end if;

  for group_event in
    select
      source.*,
      materialization.event_type as materialized_event_type,
      materialization.block_evidence_id as materialized_block_evidence_id,
      coalesce(
        binding.source_role::text,
        dynamic_source.deployed_source_role::text
      ) as materialized_source_role
    from pg_catalog.unnest(p_occurrence_ids) as requested(occurrence_id)
    join programmable_private.chain_event_occurrences as source
      on source.occurrence_id = requested.occurrence_id
    join programmable_private.chain_event_occurrence_materializations
      as materialization
      on materialization.occurrence_id = source.occurrence_id
     and materialization.chain_id = header.chain_id
     and materialization.release_id = header.release_id
     and materialization.model_id = header.model_id
     and materialization.source_group = header.source_group
     and materialization.epoch_id = header.epoch_id
     and materialization.pointer_generation =
       header.captured_pointer_generation
    left join programmable_private.release_source_bindings as binding
      on binding.binding_id = materialization.release_binding_id
    left join programmable_private.dynamic_source_attestations as dynamic_source
      on dynamic_source.dynamic_source_attestation_id =
        materialization.dynamic_source_attestation_id
    order by source.block_number, source.block_global_log_index,
      source.transaction_index, source.receipt_log_ordinal,
      source.occurrence_id
  loop
    if group_event.block_number <> target_block
       or group_event.block_hash <> p_target_block_hash
       or group_event.materialized_source_role <> 'reward_vault'
       or not exists (
         select 1
         from programmable_private.reward_vault_projections as vault
         where vault.projection_run_id = p_run_id
           and vault.vault = group_event.source_address
       )
       or not exists (
         select 1
         from programmable_private.dual_rpc_block_evidence as evidence
         where evidence.block_evidence_id =
             group_event.materialized_block_evidence_id
           and evidence.observation_id = p_safe_head_observation_id
           and evidence.epoch_id = header.epoch_id
           and evidence.pointer_generation =
             header.captured_pointer_generation
           and evidence.block_number = group_event.block_number
           and evidence.agreed_block_hash = group_event.block_hash
       )
       or (
         header.release_id = 'classic-v3'
         and group_event.materialized_event_type not in (
           'CreatorFeesCheckpointed', 'BeneficiaryFeesClaimed',
           'PayoutWalletChanged', 'CtoRewardConfigurationActivated'
         )
       )
       or (
         header.release_id in (
           'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
         )
         and group_event.materialized_event_type not in (
           'BeneficiaryFeesClaimed', 'PayoutAddressUpdated'
         )
       )
       or exists (
         select 1
         from programmable_private.chain_event_current_canonical as current
         where current.logical_event_id = group_event.logical_event_id
           and current.occurrence_id <> group_event.occurrence_id
       )
    then
      raise exception using
        errcode = '23514',
        message = 'reward block occurrence lacks exact canonical evidence';
    end if;
  end loop;

  if exists (
    select 1
    from programmable_private.reward_vault_projections as vault
    where vault.projection_run_id = p_run_id
      and (
        vault.snapshot_kind <> 'exact_current'
        or vault.chain_id <> header.chain_id
        or vault.release_id <> header.release_id
        or vault.model_id <> header.model_id
        or vault.epoch_id <> header.epoch_id
        or vault.pointer_generation <>
          header.captured_pointer_generation
        or vault.promoted_block_number <> target_block
        or vault.promoted_block_hash <> p_target_block_hash
        or vault.baseline_checkpoint_id <>
          current_checkpoint.checkpoint_id
        or vault.baseline_checkpoint_generation <>
          current_checkpoint.checkpoint_generation
        or vault.baseline_reorg_generation <>
          current_checkpoint.reorg_generation
        or vault.configuration_epoch is null
        or vault.active_configuration_hash is null
        or vault.total_creator_fees_received is null
        or not (vault.last_source_occurrence_id = any(p_occurrence_ids))
      )
  )
     or (
       select pg_catalog.count(distinct vault)
       from programmable_private.reward_vault_projections
       where projection_run_id = p_run_id
     ) <> vault_count
     or exists (
       select 1
       from programmable_private.reward_vault_projections as vault
       where vault.projection_run_id = p_run_id
         and vault.last_source_occurrence_id is distinct from (
           select source.occurrence_id
           from pg_catalog.unnest(p_occurrence_ids)
             with ordinality as requested(occurrence_id, ordinal)
           join programmable_private.chain_event_occurrences as source
             on source.occurrence_id = requested.occurrence_id
           where source.source_address = vault.vault
           order by requested.ordinal desc
           limit 1
         )
     )
     or exists (
       select 1
       from programmable_private.reward_vault_projections as vault
       where vault.projection_run_id = p_run_id
         and not (vault.current_allocation_fact_id =
           any(p_allocation_fact_ids))
     )
  then
    raise exception using
      errcode = '23514',
      message = 'reward block vault set is not checkpoint-exact';
  end if;

  for staged_vault in
    select *
    from programmable_private.reward_vault_projections
    where projection_run_id = p_run_id
    order by vault
  loop
    select * into baseline_vault
    from programmable_private.current_reward_vault_projections_v1 as baseline
    where baseline.reward_vault_projection_id =
        staged_vault.baseline_reward_vault_projection_id
      and baseline.chain_id = header.chain_id
      and baseline.release_id = header.release_id
      and baseline.model_id = header.model_id
      and baseline.epoch_id = header.epoch_id
      and baseline.pointer_generation =
        header.captured_pointer_generation
      and baseline.vault = staged_vault.vault
      and baseline.pool_id = staged_vault.pool_id;
    if not found
       or baseline_vault.launch_projection_id <>
         staged_vault.launch_projection_id
       or baseline_vault.current_allocation_fact_id <>
         staged_vault.current_allocation_fact_id
       or not programmable_private.has_current_verified_reward_seed(
         baseline_vault.projection_run_id, baseline_vault.vault
       )
       or not exists (
         select 1
         from programmable_private.current_launch_projections_v1 as launch
         where launch.launch_projection_id =
             baseline_vault.launch_projection_id
           and launch.chain_id = header.chain_id
           and launch.release_id = header.release_id
           and launch.model_id = header.model_id
           and launch.epoch_id = header.epoch_id
           and launch.pointer_generation =
             header.captured_pointer_generation
           and launch.reward_vault = baseline_vault.vault
           and launch.pool_id = baseline_vault.pool_id
           and launch.is_complete
       )
    then
      raise exception using
        errcode = '23514',
        message = 'reward block baseline is stale or incomplete';
    end if;
    if not exists (
      select 1
      from pg_catalog.generate_subscripts(
        p_allocation_fact_ids, 1
      ) as position(index)
      join programmable_private.reward_allocation_current_verified
        as seed
        on seed.allocation_fact_id = p_allocation_fact_ids[position.index]
       and seed.allocation_evidence_id =
         p_allocation_evidence_ids[position.index]
       and seed.vault = staged_vault.vault
      where seed.allocation_fact_id =
        staged_vault.current_allocation_fact_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'reward block initial seed is not current verified';
    end if;

    vault_terminal_occurrence_id := staged_vault.last_source_occurrence_id;
    select pg_catalog.count(*),
      coalesce(pg_catalog.sum(allocation.share_bps), 0)
    into allocation_count, total_share_bps
    from programmable_private.reward_allocation_projections as allocation
    where allocation.projection_run_id = p_run_id
      and allocation.reward_vault_projection_id =
        staged_vault.reward_vault_projection_id
      and allocation.allocation_fact_id =
        staged_vault.current_allocation_fact_id
      and allocation.chain_id = header.chain_id
      and allocation.release_id = header.release_id
      and allocation.model_id = header.model_id
      and allocation.epoch_id = header.epoch_id
      and allocation.pointer_generation =
        header.captured_pointer_generation
      and allocation.promoted_block_number = target_block
      and allocation.promoted_block_hash = p_target_block_hash
      and allocation.last_source_occurrence_id =
        vault_terminal_occurrence_id
      and allocation.configuration_epoch =
        staged_vault.configuration_epoch
      and allocation.effective_to_block is null;
    if allocation_count < 1
       or allocation_count > (
         case when header.release_id = 'classic-v3' then 5 else 8 end
       )
       or total_share_bps <> 10000
       or (
         select pg_catalog.count(distinct allocation.allocation_index)
         from programmable_private.reward_allocation_projections as allocation
         where allocation.projection_run_id = p_run_id
           and allocation.reward_vault_projection_id =
             staged_vault.reward_vault_projection_id
       ) <> allocation_count
       or (
         select pg_catalog.min(allocation.allocation_index)
         from programmable_private.reward_allocation_projections as allocation
         where allocation.projection_run_id = p_run_id
           and allocation.reward_vault_projection_id =
             staged_vault.reward_vault_projection_id
       ) <> 0
       or (
         select pg_catalog.max(allocation.allocation_index)
         from programmable_private.reward_allocation_projections as allocation
         where allocation.projection_run_id = p_run_id
           and allocation.reward_vault_projection_id =
             staged_vault.reward_vault_projection_id
       ) <> allocation_count - 1
    then
      raise exception using
        errcode = '23514',
        message = 'reward block allocation set is incomplete';
    end if;

    select pg_catalog.count(*),
      coalesce(pg_catalog.sum(
        balance.claimable_accrued + balance.claimed_total
      ), 0)
    into balance_count, total_balance_value
    from programmable_private.account_reward_balances as balance
    where balance.projection_run_id = p_run_id
      and balance.chain_id = header.chain_id
      and balance.release_id = header.release_id
      and balance.model_id = header.model_id
      and balance.epoch_id = header.epoch_id
      and balance.pointer_generation =
        header.captured_pointer_generation
      and balance.vault = staged_vault.vault
      and balance.promoted_block_number = target_block
      and balance.promoted_block_hash = p_target_block_hash
      and balance.last_source_occurrence_id =
        vault_terminal_occurrence_id;
    if balance_count < 1
       or total_balance_value <>
         staged_vault.total_creator_fees_received
       or (
         select pg_catalog.count(distinct balance.account)
         from programmable_private.account_reward_balances as balance
         where balance.projection_run_id = p_run_id
           and balance.vault = staged_vault.vault
       ) <> balance_count
       or exists (
         select 1
         from programmable_private.current_account_reward_balances_v1
           as prior_balance
         where prior_balance.chain_id = header.chain_id
           and prior_balance.release_id = header.release_id
           and prior_balance.model_id = header.model_id
           and prior_balance.epoch_id = header.epoch_id
           and prior_balance.pointer_generation =
             header.captured_pointer_generation
           and prior_balance.vault = staged_vault.vault
           and not exists (
             select 1
             from programmable_private.account_reward_balances
               as next_balance
             where next_balance.projection_run_id = p_run_id
               and next_balance.vault = staged_vault.vault
               and next_balance.account = prior_balance.account
               and next_balance.claimed_total >=
                 prior_balance.claimed_total
               and next_balance.claimable_accrued +
                 next_balance.claimed_total >=
                 prior_balance.claimable_accrued +
                   prior_balance.claimed_total
           )
       )
    then
      raise exception using
        errcode = '23514',
        message = 'reward block balance set is incomplete or nonmonotonic';
    end if;

    select coalesce(
      baseline_vault.total_creator_fees_received,
      (
        select pg_catalog.sum(
          balance.claimable_accrued + balance.claimed_total
        )
        from programmable_private.current_account_reward_balances_v1
          as balance
        where balance.chain_id = header.chain_id
          and balance.release_id = header.release_id
          and balance.model_id = header.model_id
          and balance.epoch_id = header.epoch_id
          and balance.pointer_generation =
            header.captured_pointer_generation
          and balance.vault = staged_vault.vault
      ),
      0
    ) into baseline_total;
    if header.release_id = 'classic-v3' then
      select
        pg_catalog.count(*),
        coalesce(pg_catalog.sum(
          (materialization.decoded_payload ->> 'amount')::numeric
        ), 0),
        (
          pg_catalog.array_agg(
            (materialization.decoded_payload ->>
              'totalCreatorFeesReceived')::numeric
            order by source.block_global_log_index desc,
              source.occurrence_id desc
          )
        )[1]
      into terminal_event_count, checkpoint_amount_total,
        checkpoint_terminal_total
      from programmable_private.chain_event_occurrence_materializations
        as materialization
      join programmable_private.chain_event_occurrences as source
        on source.occurrence_id = materialization.occurrence_id
      where materialization.occurrence_id = any(p_occurrence_ids)
        and source.source_address = staged_vault.vault
        and materialization.event_type = 'CreatorFeesCheckpointed';
      if checkpoint_amount_total < 0
         or staged_vault.total_creator_fees_received < baseline_total
         or (
           terminal_event_count = 0
           and staged_vault.total_creator_fees_received <> baseline_total
         )
         or (
           terminal_event_count > 0
           and (
             baseline_total + checkpoint_amount_total <>
               staged_vault.total_creator_fees_received
             or checkpoint_terminal_total <>
               staged_vault.total_creator_fees_received
           )
         )
      then
        raise exception using
          errcode = '23514',
          message = 'reward block checkpoint totals do not reconcile';
      end if;

      perform programmable_private.assert_classic_reward_block_fold_v1(
        p_run_id, staged_vault.vault, p_occurrence_ids
      );
    elsif header.release_id in (
      'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
    ) and exists (
      with active_allocations as (
        select
          allocation.allocation_index,
          allocation.beneficiary::bytea as account,
          allocation.share_bps::numeric as share_bps,
          pg_catalog.max(allocation.allocation_index) over () as last_index
        from programmable_private.reward_allocation_projections
          as allocation
        where allocation.projection_run_id = p_run_id
          and allocation.reward_vault_projection_id =
            staged_vault.reward_vault_projection_id
          and allocation.effective_to_block is null
      ), non_last_total as (
        select coalesce(pg_catalog.sum(
          case when allocation_index < last_index then
            pg_catalog.div(
              staged_vault.total_creator_fees_received * share_bps, 10000
            )
          else 0 end
        ), 0) as amount
        from active_allocations
      ), entitlements as (
        select allocation.account,
          case
            when allocation.allocation_index = allocation.last_index
              then staged_vault.total_creator_fees_received
                - non_last_total.amount
            else pg_catalog.div(
              staged_vault.total_creator_fees_received
                * allocation.share_bps, 10000
            )
          end as amount
        from active_allocations as allocation
        cross join non_last_total
      ), block_claims as (
        select claim.beneficiary::bytea as account,
          pg_catalog.sum(claim.amount)::numeric as amount
        from programmable_private.claim_projections as claim
        where claim.projection_run_id = p_run_id
          and claim.vault = staged_vault.vault
        group by claim.beneficiary
      )
      select 1
      from programmable_private.account_reward_balances as next_balance
      left join entitlements as entitlement
        on entitlement.account = next_balance.account
      left join programmable_private.current_account_reward_balances_v1
        as prior_balance
        on prior_balance.chain_id = header.chain_id
       and prior_balance.release_id = header.release_id
       and prior_balance.model_id = header.model_id
       and prior_balance.epoch_id = header.epoch_id
       and prior_balance.pointer_generation =
         header.captured_pointer_generation
       and prior_balance.vault = staged_vault.vault
       and prior_balance.account = next_balance.account
      left join block_claims as block_claim
        on block_claim.account = next_balance.account
      where next_balance.projection_run_id = p_run_id
        and next_balance.vault = staged_vault.vault
        and (
          entitlement.account is null
          or next_balance.claimed_total <>
            coalesce(prior_balance.claimed_total, 0)
              + coalesce(block_claim.amount, 0)
          or next_balance.claimable_accrued <>
            entitlement.amount
              - coalesce(prior_balance.claimed_total, 0)
              - coalesce(block_claim.amount, 0)
        )
    ) then
      raise exception using
        errcode = '23514',
        message = 'Stock-Paired rewards do not match the exact block state';
    end if;
  end loop;

  if exists (
       select 1
       from programmable_private.reward_allocation_projections as allocation
       where allocation.projection_run_id = p_run_id
         and not exists (
           select 1
           from programmable_private.reward_vault_projections as vault
           where vault.projection_run_id = p_run_id
             and vault.reward_vault_projection_id =
               allocation.reward_vault_projection_id
         )
     )
     or exists (
       select 1
       from programmable_private.account_reward_balances as balance
       where balance.projection_run_id = p_run_id
         and not exists (
           select 1
           from programmable_private.reward_vault_projections as vault
           where vault.projection_run_id = p_run_id
             and vault.vault = balance.vault
         )
     )
     or exists (
       select 1
       from programmable_private.claim_projections as claim
       where claim.projection_run_id = p_run_id
         and not exists (
           select 1
           from programmable_private.reward_vault_projections as vault
           where vault.projection_run_id = p_run_id
             and vault.vault = claim.vault
         )
     )
     or exists (
       select 1
       from programmable_private.payout_change_projections as payout
       where payout.projection_run_id = p_run_id
         and not exists (
           select 1
           from programmable_private.reward_vault_projections as vault
           where vault.projection_run_id = p_run_id
             and vault.vault = payout.vault
         )
     )
  then
    raise exception using
      errcode = '23514',
      message = 'reward block contains cross-vault staged rows';
  end if;

  select pg_catalog.count(*) into claim_count
  from programmable_private.claim_projections
  where projection_run_id = p_run_id;
  select pg_catalog.count(*) into claim_event_count
  from programmable_private.chain_event_occurrence_materializations
    as materialization
  where materialization.occurrence_id = any(p_occurrence_ids)
    and materialization.event_type = 'BeneficiaryFeesClaimed';
  if claim_count <> claim_event_count
     or exists (
       select 1
       from programmable_private.claim_projections as claim
       join programmable_private.chain_event_occurrence_materializations
         as materialization
         on materialization.occurrence_id = claim.source_occurrence_id
       join programmable_private.chain_event_occurrences as source
         on source.occurrence_id = materialization.occurrence_id
       join programmable_private.reward_vault_projections as vault
         on vault.projection_run_id = p_run_id
        and vault.vault = claim.vault
       where claim.projection_run_id = p_run_id
         and (
           claim.chain_id <> header.chain_id
           or claim.release_id <> header.release_id
           or claim.model_id <> header.model_id
           or claim.epoch_id <> header.epoch_id
           or claim.pointer_generation <>
             header.captured_pointer_generation
           or claim.claimant_kind <> 'beneficiary'
           or claim.amount <= 0
           or claim.vault_total_received >
             vault.total_creator_fees_received
           or claim.promoted_block_number <> target_block
           or claim.promoted_block_hash <> p_target_block_hash
           or not (claim.source_occurrence_id = any(p_occurrence_ids))
           or source.source_address <> claim.vault
           or materialization.event_type <> 'BeneficiaryFeesClaimed'
           or programmable_private.json_hex_bytes_v1(
             materialization.decoded_payload, 'beneficiary', 20
           ) is distinct from claim.beneficiary
           or (materialization.decoded_payload ->> 'amount')::numeric
             is distinct from claim.amount
           or (
             materialization.decoded_payload ->>
               'beneficiaryTotalClaimed'
           )::numeric is distinct from claim.beneficiary_total_claimed
           or (materialization.decoded_payload ->>
             'vaultTotalReceived')::numeric
               is distinct from claim.vault_total_received
           or (
             header.release_id = 'classic-v3'
             and claim.recipient <> claim.beneficiary
           )
           or (
             header.release_id in (
               'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
             )
             and (
               programmable_private.json_hex_bytes_v1(
                 materialization.decoded_payload, 'payoutAddress', 20
               ) is distinct from claim.recipient
               or programmable_private.json_hex_bytes_v1(
                 materialization.decoded_payload, 'quoteAsset', 20
               ) is distinct from vault.quote_asset
             )
           )
         )
     )
     or exists (
       with ordered_claims as (
         select
           claim.claim_projection_id,
           claim.vault,
           claim.beneficiary,
           claim.beneficiary_total_claimed,
           coalesce(prior.claimed_total, 0) + pg_catalog.sum(claim.amount)
             over (
               partition by claim.vault, claim.beneficiary
               order by source.block_number,
                 source.block_global_log_index,
                 source.transaction_index,
                 source.receipt_log_ordinal,
                 claim.source_occurrence_id
               rows between unbounded preceding and current row
             ) as expected_total_claimed
         from programmable_private.claim_projections as claim
         join programmable_private.chain_event_occurrences as source
           on source.occurrence_id = claim.source_occurrence_id
         left join programmable_private.current_account_reward_balances_v1
           as prior
           on prior.chain_id = header.chain_id
          and prior.release_id = header.release_id
          and prior.model_id = header.model_id
          and prior.epoch_id = header.epoch_id
          and prior.pointer_generation = header.captured_pointer_generation
          and prior.vault = claim.vault
          and prior.account = claim.beneficiary
         where claim.projection_run_id = p_run_id
       )
       select 1
       from ordered_claims
       where beneficiary_total_claimed <> expected_total_claimed
     )
  then
    raise exception using
      errcode = '23514',
      message = 'reward block claims do not reconcile';
  end if;

  select pg_catalog.count(*) into payout_count
  from programmable_private.payout_change_projections
  where projection_run_id = p_run_id;
  select pg_catalog.count(*) into payout_event_count
  from programmable_private.chain_event_occurrence_materializations
    as materialization
  where materialization.occurrence_id = any(p_occurrence_ids)
    and materialization.event_type in (
      'PayoutWalletChanged', 'PayoutAddressUpdated'
    );
  if payout_count <> payout_event_count
     or exists (
       select 1
       from programmable_private.payout_change_projections as payout
       join programmable_private.chain_event_occurrence_materializations
         as materialization
         on materialization.occurrence_id = payout.source_occurrence_id
       join programmable_private.chain_event_occurrences as source
         on source.occurrence_id = payout.source_occurrence_id
       where payout.projection_run_id = p_run_id
         and (
           payout.chain_id <> header.chain_id
           or payout.release_id <> header.release_id
           or payout.model_id <> header.model_id
           or payout.epoch_id <> header.epoch_id
           or payout.pointer_generation <>
             header.captured_pointer_generation
           or payout.promoted_block_number <> target_block
           or payout.promoted_block_hash <> p_target_block_hash
           or not (payout.source_occurrence_id = any(p_occurrence_ids))
           or payout.source_logical_event_id <> source.logical_event_id
           or payout.source_occurrence_block_hash <> source.block_hash
           or source.source_address <> payout.vault
           or (
             header.release_id = 'classic-v3'
             and (
               materialization.event_type <> 'PayoutWalletChanged'
               or programmable_private.json_hex_bytes_v1(
                 materialization.decoded_payload,
                 'previousPayoutWallet', 20
               ) is distinct from payout.previous_payout_address
               or programmable_private.json_hex_bytes_v1(
                 materialization.decoded_payload,
                 'newPayoutWallet', 20
               ) is distinct from payout.new_payout_address
               or (materialization.decoded_payload ->>
                 'configurationEpoch')::numeric is distinct from
                   payout.configuration_epoch::numeric
             )
           )
           or (
             header.release_id in (
               'stock-paired-v1', 'stock-paired-v2', 'stock-paired-v3'
             )
             and (
               materialization.event_type <> 'PayoutAddressUpdated'
               or programmable_private.json_hex_bytes_v1(
                 materialization.decoded_payload, 'beneficiary', 20
               ) is distinct from payout.beneficiary
               or programmable_private.json_hex_bytes_v1(
                 materialization.decoded_payload,
                 'previousPayoutAddress', 20
               ) is distinct from payout.previous_payout_address
               or programmable_private.json_hex_bytes_v1(
                 materialization.decoded_payload,
                 'newPayoutAddress', 20
               ) is distinct from payout.new_payout_address
               or payout.configuration_epoch is not null
             )
           )
         )
     )
  then
    raise exception using
      errcode = '23514',
      message = 'reward block payout changes do not reconcile';
  end if;

  audit_id := programmable_private.append_mutation_audit(
    'projection.promote.reward_block_group',
    p_result_commitment, p_run_id, p_published_at
  );
  select pg_catalog.array_agg(
    pg_catalog.format('%s:%s', staged.row_kind, staged.row_id)
    order by staged.row_kind, staged.row_id
  ), pg_catalog.count(*)
  into ordered_projection_rows, projection_row_count
  from (
    select 'reward_vault'::text as row_kind,
      reward_vault_projection_id as row_id
    from programmable_private.reward_vault_projections
    where projection_run_id = p_run_id
    union all
    select 'reward_allocation', reward_allocation_projection_id
    from programmable_private.reward_allocation_projections
    where projection_run_id = p_run_id
    union all
    select 'account_reward_balance', account_reward_balance_id
    from programmable_private.account_reward_balances
    where projection_run_id = p_run_id
    union all
    select 'claim', claim_projection_id
    from programmable_private.claim_projections
    where projection_run_id = p_run_id
    union all
    select 'payout_change', payout_change_projection_id
    from programmable_private.payout_change_projections
    where projection_run_id = p_run_id
  ) as staged;
  select pg_catalog.count(*) into allocation_row_count
  from programmable_private.reward_allocation_projections
  where projection_run_id = p_run_id;
  select pg_catalog.count(*) into balance_row_count
  from programmable_private.account_reward_balances
  where projection_run_id = p_run_id;
  if projection_row_count <>
       vault_count + allocation_row_count + balance_row_count
         + claim_count + payout_count
  then
    raise exception using
      errcode = '23514', message = 'reward block manifest is incomplete';
  end if;
  insert into programmable_private.projection_fold_manifests (
    run_id, epoch_id, pointer_generation, target_block_number,
    target_block_hash, ordered_occurrence_ids,
    ordered_allocation_fact_ids, ordered_allocation_evidence_ids,
    ordered_candidate_disposition_ids, ordered_route_keys,
    cursor_block_global_log_index, cursor_candidate_id,
    ordered_projection_rows, projection_row_count,
    result_commitment, created_at, audit_id
  ) values (
    p_run_id, header.epoch_id, header.captured_pointer_generation,
    target_block::programmable_private.block_number_value,
    p_target_block_hash::programmable_private.bytes32_value,
    p_occurrence_ids, p_allocation_fact_ids, p_allocation_evidence_ids,
    p_candidate_disposition_ids, p_route_keys,
    cursor_log_index::programmable_private.block_log_index_value,
    p_cursor_candidate_id::programmable_private.envio_candidate_identifier,
    ordered_projection_rows, projection_row_count,
    p_result_commitment::programmable_private.bytes32_value,
    p_published_at, audit_id
  );

  for group_event in
    select source.*, materialization.block_evidence_id
    from pg_catalog.unnest(p_occurrence_ids) as requested(occurrence_id)
    join programmable_private.chain_event_occurrences as source
      on source.occurrence_id = requested.occurrence_id
    join programmable_private.chain_event_occurrence_materializations
      as materialization
      on materialization.occurrence_id = source.occurrence_id
     and materialization.epoch_id = header.epoch_id
     and materialization.pointer_generation =
       header.captured_pointer_generation
    order by source.block_number, source.block_global_log_index,
      source.transaction_index, source.receipt_log_ordinal,
      source.occurrence_id
  loop
    status_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.chain_event_occurrence_status_history (
      status_history_id, occurrence_id, logical_event_id, block_hash,
      status, safe_head_observation_id, block_evidence_id,
      decision_run_id, decision_commitment, decided_at, audit_id
    ) values (
      status_id, group_event.occurrence_id, group_event.logical_event_id,
      group_event.block_hash, 'canonical', p_safe_head_observation_id,
      group_event.block_evidence_id, p_run_id,
      p_result_commitment, p_published_at, audit_id
    );
    insert into programmable_private.chain_event_current_canonical (
      logical_event_id, occurrence_id, block_hash, status_history_id,
      selected_by_run_id, selected_at
    ) values (
      group_event.logical_event_id, group_event.occurrence_id,
      group_event.block_hash, status_id, p_run_id, p_published_at
    )
    on conflict (logical_event_id) do update
      set status_history_id = excluded.status_history_id,
          selected_by_run_id = excluded.selected_by_run_id,
          selected_at = excluded.selected_at
      where programmable_private.chain_event_current_canonical.occurrence_id
        = excluded.occurrence_id;
    if not found then
      raise exception using
        errcode = '23505', message = 'canonical pointer conflict';
    end if;
  end loop;

  insert into programmable_private.run_lifecycle_outcomes (
    outcome_id, run_id, status, result_commitment, caller_role,
    finished_at, audit_id
  ) values (
    p_outcome_id, p_run_id, 'succeeded',
    p_result_commitment::programmable_private.bytes32_value,
    programmable_private.caller_role_name(), p_published_at, audit_id
  );
  insert into programmable_private.projector_checkpoints (
    checkpoint_id, chain_id, release_id, model_id, source_group,
    projector_version, epoch_id, pointer_generation, lease_generation,
    checkpoint_generation, reorg_generation, block_number, block_hash,
    cursor_block_global_log_index, cursor_candidate_id,
    safe_head_observation_id, target_block_evidence_id, run_id,
    terminal_outcome_id, created_at
  ) values (
    p_checkpoint_id, header.chain_id, header.release_id, header.model_id,
    header.source_group,
    p_projector_version::programmable_private.projector_identifier,
    header.epoch_id, header.captured_pointer_generation,
    p_lease_generation, p_next_checkpoint_generation,
    p_reorg_generation,
    target_block::programmable_private.block_number_value,
    p_target_block_hash::programmable_private.bytes32_value,
    cursor_log_index::programmable_private.block_log_index_value,
    p_cursor_candidate_id::programmable_private.envio_candidate_identifier,
    p_safe_head_observation_id, p_target_block_evidence_id,
    p_run_id, p_outcome_id, p_published_at
  );
  update programmable_private.projector_checkpoint_current
  set checkpoint_id = p_checkpoint_id,
      checkpoint_generation = p_next_checkpoint_generation,
      reorg_generation = p_reorg_generation,
      changed_at = p_published_at
  where chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and projector_version = p_projector_version
    and checkpoint_generation = p_expected_checkpoint_generation
    and reorg_generation = p_reorg_generation;
  if not found then
    raise exception using
      errcode = '40001', message = 'checkpoint CAS lost';
  end if;
  insert into programmable_private.projection_publications (
    publication_id, run_id, epoch_id, pointer_generation, checkpoint_id,
    terminal_outcome_id, target_block_number, target_block_hash,
    published_at, audit_id
  ) values (
    p_publication_id, p_run_id, header.epoch_id,
    header.captured_pointer_generation, p_checkpoint_id, p_outcome_id,
    target_block::programmable_private.block_number_value,
    p_target_block_hash::programmable_private.bytes32_value,
    p_published_at, audit_id
  );
  foreach selected_route_key in array p_route_keys loop
    route_history_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.route_eligibility_history (
      route_eligibility_history_id, route_key, chain_id, release_id,
      model_id, source_group, epoch_id, pointer_generation, status,
      route_mode, checkpoint_id, reason_commitment, changed_by_run_id,
      changed_at, audit_id
    ) values (
      route_history_id,
      selected_route_key::programmable_private.source_identifier,
      header.chain_id, header.release_id, header.model_id,
      header.source_group, header.epoch_id,
      header.captured_pointer_generation, 'eligible', 'indexed',
      p_checkpoint_id,
      p_result_commitment::programmable_private.bytes32_value,
      p_run_id, p_published_at, audit_id
    );
    insert into programmable_private.route_eligibility_current (
      route_key, chain_id, release_id, model_id, source_group, epoch_id,
      pointer_generation, status, route_mode, checkpoint_id, history_id,
      changed_at
    ) values (
      selected_route_key::programmable_private.source_identifier,
      header.chain_id, header.release_id, header.model_id,
      header.source_group, header.epoch_id,
      header.captured_pointer_generation, 'eligible', 'indexed',
      p_checkpoint_id, route_history_id, p_published_at
    )
    on conflict (
      route_key, chain_id, release_id, model_id, source_group
    ) do update
      set epoch_id = excluded.epoch_id,
          pointer_generation = excluded.pointer_generation,
          status = excluded.status,
          route_mode = excluded.route_mode,
          checkpoint_id = excluded.checkpoint_id,
          history_id = excluded.history_id,
          changed_at = excluded.changed_at
      where programmable_private.route_eligibility_current
        .pointer_generation <= excluded.pointer_generation;
    if not found then
      raise exception using
        errcode = '40001', message = 'stale route eligibility generation';
    end if;
  end loop;
  perform programmable_private.bind_projection_publication_provider_evidence_v1(
    p_provider_binding_id, p_publication_id, p_run_id,
    'reward_snapshot_delta', p_execution_evidence_id,
    p_reward_snapshot_evidence_ids, p_provider_binding_commitment,
    p_published_at
  );
  return p_publication_id;
end
$function$;

create function programmable_private.promote_projection_run_v3(
  p_promotion_mode text,
  p_publication_id uuid,
  p_checkpoint_id uuid,
  p_outcome_id uuid,
  p_run_id uuid,
  p_projector_version text,
  p_lease_generation bigint,
  p_lease_token_hash bytea,
  p_expected_checkpoint_generation bigint,
  p_next_checkpoint_generation bigint,
  p_reorg_generation bigint,
  p_safe_head_observation_id uuid,
  p_target_block_evidence_id uuid,
  p_target_block_number numeric,
  p_target_block_hash bytea,
  p_cursor_block_global_log_index numeric,
  p_cursor_candidate_id text,
  p_occurrence_ids uuid[],
  p_allocation_fact_ids uuid[],
  p_allocation_evidence_ids uuid[],
  p_candidate_disposition_ids uuid[],
  p_route_keys text[],
  p_result_commitment bytea,
  p_execution_evidence_id uuid,
  p_reward_snapshot_evidence_ids uuid[],
  p_provider_binding_id uuid,
  p_provider_binding_commitment bytea,
  p_published_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  publication_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  if p_target_block_number <> pg_catalog.trunc(p_target_block_number)
     or p_target_block_number < 0
     or p_target_block_number > 9223372036854775807
  then
    raise exception using
      errcode = '22023', message = 'invalid promotion target block';
  end if;
  perform programmable_private.assert_projection_provider_evidence_v1(
    p_promotion_mode, p_run_id, p_safe_head_observation_id,
    p_target_block_evidence_id, p_target_block_number::bigint,
    p_target_block_hash, p_execution_evidence_id,
    p_reward_snapshot_evidence_ids
  );
  if (
       select evidence.candidate_batch_size
       from programmable_private.projection_provider_execution_evidence
         as evidence
       where evidence.execution_evidence_id = p_execution_evidence_id
         and evidence.run_id = p_run_id
     ) <> coalesce(
       pg_catalog.cardinality(p_candidate_disposition_ids), 0
     )
  then
    raise exception using
      errcode = '23514',
      message = 'promotion candidate count changed';
  end if;

  if p_promotion_mode = 'reward_snapshot_delta' then
    return programmable_private.promote_reward_block_group_v1(
      p_publication_id, p_checkpoint_id, p_outcome_id, p_run_id,
      p_projector_version, p_lease_generation, p_lease_token_hash,
      p_expected_checkpoint_generation, p_next_checkpoint_generation,
      p_reorg_generation, p_safe_head_observation_id,
      p_target_block_evidence_id, p_target_block_number,
      p_target_block_hash, p_cursor_block_global_log_index,
      p_cursor_candidate_id, p_occurrence_ids, p_allocation_fact_ids,
      p_allocation_evidence_ids, p_candidate_disposition_ids,
      p_route_keys, p_result_commitment, p_execution_evidence_id,
      p_reward_snapshot_evidence_ids, p_provider_binding_id,
      p_provider_binding_commitment, p_published_at
    );
  end if;

  publication_id := programmable_private.promote_projection_run_v2(
    p_promotion_mode, p_publication_id, p_checkpoint_id,
    p_outcome_id, p_run_id, p_projector_version,
    p_lease_generation, p_lease_token_hash,
    p_expected_checkpoint_generation, p_next_checkpoint_generation,
    p_reorg_generation, p_safe_head_observation_id,
    p_target_block_evidence_id, p_target_block_number,
    p_target_block_hash, p_cursor_block_global_log_index,
    p_cursor_candidate_id, p_occurrence_ids,
    p_allocation_fact_ids, p_allocation_evidence_ids,
    p_candidate_disposition_ids, p_route_keys,
    p_result_commitment, p_published_at
  );
  perform programmable_private.bind_projection_publication_provider_evidence_v1(
    p_provider_binding_id, publication_id, p_run_id,
    p_promotion_mode, p_execution_evidence_id,
    p_reward_snapshot_evidence_ids, p_provider_binding_commitment,
    p_published_at
  );
  return publication_id;
end
$function$;

comment on function programmable_private.promote_projection_run_v3(
  text, uuid, uuid, uuid, uuid, text, bigint, bytea,
  bigint, bigint, bigint, uuid, uuid, numeric, bytea, numeric,
  text, uuid[], uuid[], uuid[], uuid[], text[], bytea, uuid,
  uuid[], uuid, bytea, timestamptz
) is
  'The only projector promotion entrypoint. It atomically binds immutable configured-provider evidence and supports one complete multi-transaction, multi-vault reward block group.';

revoke all on table
  programmable_private.projection_provider_execution_evidence,
  programmable_private.reward_snapshot_provider_evidence,
  programmable_private.projection_publication_provider_bindings,
  programmable_private.projection_publication_reward_evidence
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler,
  programmable_api_reader, programmable_profile_binder,
  programmable_profile_recovery, programmable_profile_writer,
  programmable_maintenance;

revoke all on function
  programmable_private.projection_execution_trace_preimage_v1(jsonb),
  programmable_private.projection_execution_trace_commitment_v1(jsonb),
  programmable_private.reward_snapshot_folded_preimage_v1(uuid, bytea),
  programmable_private.reward_snapshot_folded_commitment_v1(uuid, bytea),
  programmable_private.get_staged_reward_folded_commitment_v1(uuid, bytea),
  programmable_private.projection_provider_binding_preimage_v1(
    uuid, uuid, text, uuid, uuid[], timestamptz
  ),
  programmable_private.projection_provider_binding_commitment_v1(
    uuid, uuid, text, uuid, uuid[], timestamptz
  ),
  programmable_private.projection_execution_evidence_preimage_v1(
    bigint, text, text, text, uuid, bigint, uuid, uuid, uuid,
    text, text, text, text, bytea, bytea, bytea, bytea,
    integer, integer, integer, integer, integer, integer, bytea
  ),
  programmable_private.reward_snapshot_evidence_preimage_v1(
    bigint, text, text, text, uuid, bigint, uuid, uuid, uuid,
    bytea, text, bigint, bytea, uuid, uuid, bytea, bytea,
    integer, integer, bytea[], integer[], bytea[], bytea[],
    integer[], integer[], bytea, bytea
  ),
  programmable_private.assert_reward_verification_chunk_manifest_v1(
    bytea[], integer[], bytea[], bytea[], integer[], integer[],
    integer, integer
  ),
  programmable_private.validate_projection_execution_trace_v1(
    jsonb, uuid, uuid
  ),
  programmable_private.validate_reward_snapshot_execution_trace_v1(
    jsonb, uuid, uuid, integer, integer
  ),
  programmable_private.assert_classic_reward_block_fold_v1(
    uuid, bytea, uuid[]
  ),
  programmable_private.assert_stock_reward_block_fold_v1(
    uuid, bytea, uuid[]
  ),
  programmable_private.stage_current_reward_snapshot_v2(
    uuid, bytea, bytea, uuid, bigint, bytea, numeric,
    integer[], bytea[], bytea[], numeric[], bytea[], bytea[],
    numeric[], numeric[], uuid, uuid[], numeric, bytea, timestamptz
  ),
  programmable_private.assert_projection_provider_evidence_v1(
    text, uuid, uuid, uuid, bigint, bytea, uuid, uuid[]
  ),
  programmable_private.bind_projection_publication_provider_evidence_v1(
    uuid, uuid, uuid, text, uuid, uuid[], bytea, timestamptz
  ),
  programmable_private.promote_reward_block_group_v1(
    uuid, uuid, uuid, uuid, text, bigint, bytea,
    bigint, bigint, bigint, uuid, uuid, numeric, bytea, numeric,
    text, uuid[], uuid[], uuid[], uuid[], text[], bytea, uuid,
    uuid[], uuid, bytea, timestamptz
  ),
  programmable_private.append_projection_provider_execution_evidence_v1(
    uuid, uuid, uuid, uuid[], jsonb, bytea, smallint,
    bytea, bytea, timestamptz
  ),
  programmable_private.append_reward_snapshot_provider_evidence_v1(
    uuid, uuid, uuid, uuid, bytea, text, text, numeric, bytea,
    bytea, bytea, integer, integer, bytea[], integer[], bytea[],
    bytea[], integer[], integer[], bytea, jsonb, bytea, smallint,
    bytea, bytea, timestamptz
  ),
  programmable_private.promote_projection_run_v3(
    text, uuid, uuid, uuid, uuid, text, bigint, bytea,
    bigint, bigint, bigint, uuid, uuid, numeric, bytea, numeric,
    text, uuid[], uuid[], uuid[], uuid[], text[], bytea, uuid,
    uuid[], uuid, bytea, timestamptz
  )
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler,
  programmable_api_reader, programmable_profile_binder,
  programmable_profile_recovery, programmable_profile_writer,
  programmable_maintenance;

grant execute on function
  programmable_private.projection_execution_evidence_preimage_v1(
    bigint, text, text, text, uuid, bigint, uuid, uuid, uuid,
    text, text, text, text, bytea, bytea, bytea, bytea,
    integer, integer, integer, integer, integer, integer, bytea
  ),
  programmable_private.reward_snapshot_evidence_preimage_v1(
    bigint, text, text, text, uuid, bigint, uuid, uuid, uuid,
    bytea, text, bigint, bytea, uuid, uuid, bytea, bytea,
    integer, integer, bytea[], integer[], bytea[], bytea[],
    integer[], integer[], bytea, bytea
  ),
  programmable_private.append_projection_provider_execution_evidence_v1(
    uuid, uuid, uuid, uuid[], jsonb, bytea, smallint,
    bytea, bytea, timestamptz
  ),
  programmable_private.append_reward_snapshot_provider_evidence_v1(
    uuid, uuid, uuid, uuid, bytea, text, text, numeric, bytea,
    bytea, bytea, integer, integer, bytea[], integer[], bytea[],
    bytea[], integer[], integer[], bytea, jsonb, bytea, smallint,
    bytea, bytea, timestamptz
  ),
  programmable_private.get_staged_reward_folded_commitment_v1(uuid, bytea),
  programmable_private.stage_current_reward_snapshot_v2(
    uuid, bytea, bytea, uuid, bigint, bytea, numeric,
    integer[], bytea[], bytea[], numeric[], bytea[], bytea[],
    numeric[], numeric[], uuid, uuid[], numeric, bytea, timestamptz
  ),
  programmable_private.promote_projection_run_v3(
    text, uuid, uuid, uuid, uuid, text, bigint, bytea,
    bigint, bigint, bigint, uuid, uuid, numeric, bytea, numeric,
    text, uuid[], uuid[], uuid[], uuid[], text[], bytea, uuid,
    uuid[], uuid, bytea, timestamptz
  )
to programmable_projector;

-- Older promotion functions cannot bypass provider-evidence binding.
revoke execute on function programmable_private.promote_projection_run(
  uuid, uuid, uuid, uuid, text, bigint, bytea,
  bigint, bigint, bigint, uuid, uuid, numeric, bytea, numeric,
  text, uuid[], uuid[], uuid[], uuid[], text[], bytea, timestamptz
) from programmable_projector;
revoke execute on function programmable_private.promote_projection_run_v2(
  text, uuid, uuid, uuid, uuid, text, bigint, bytea,
  bigint, bigint, bigint, uuid, uuid, numeric, bytea, numeric,
  text, uuid[], uuid[], uuid[], uuid[], text[], bytea, timestamptz
) from programmable_projector;

reset role;
