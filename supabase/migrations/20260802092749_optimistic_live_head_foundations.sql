-- Private optimistic live-head control plane.
--
-- This migration does not publish a second public read model. It gives the
-- existing projector immutable dual-RPC block/event evidence and an explicitly
-- replaceable canonical pointer. The existing API reader can only consume bounded
-- SECURITY DEFINER reads.

set role programmable_migrator;

create type programmable_private.optimistic_block_status_v1 as enum (
  'canonical',
  'orphaned'
);

create table programmable_private.optimistic_block_observations_v1 (
  optimistic_block_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  parent_hash programmable_private.bytes32_value not null,
  block_timestamp timestamptz not null,
  provider_a_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_b_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  provider_a_head programmable_private.block_number_value not null,
  provider_b_head programmable_private.block_number_value not null,
  provider_a_block_hash programmable_private.bytes32_value not null,
  provider_b_block_hash programmable_private.bytes32_value not null,
  provider_a_parent_hash programmable_private.bytes32_value not null,
  provider_b_parent_hash programmable_private.bytes32_value not null,
  provider_a_block_timestamp timestamptz not null,
  provider_b_block_timestamp timestamptz not null,
  evidence_commitment programmable_private.bytes32_value not null,
  observed_at timestamptz not null,
  check (provider_a_id <> provider_b_id),
  check (provider_a_head >= block_number and provider_b_head >= block_number),
  check (
    provider_a_block_hash = provider_b_block_hash
    and provider_a_block_hash = block_hash
  ),
  check (
    provider_a_parent_hash = provider_b_parent_hash
    and provider_a_parent_hash = parent_hash
  ),
  check (
    provider_a_block_timestamp = provider_b_block_timestamp
    and provider_a_block_timestamp = block_timestamp
  ),
  check (
    pg_catalog.isfinite(block_timestamp)
    and pg_catalog.isfinite(observed_at)
    and block_timestamp <= observed_at + interval '5 minutes'
  ),
  unique (chain_id, block_hash),
  unique (optimistic_block_id, chain_id, block_number, block_hash)
);

comment on table programmable_private.optimistic_block_observations_v1 is
  'Immutable, dual-RPC-agreed optimistic block observations. They are evidence only until the canonical pointer selects them.';

create function programmable_private.valid_optimistic_market_json_v1(
  p_market jsonb,
  p_block_number bigint,
  p_current_tick integer,
  p_active_liquidity numeric
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  scalar_text text;
  market_key_count integer;
  classic_key text;
  expected_pattern text;
begin
  if p_market is null
     or pg_catalog.jsonb_typeof(p_market) <> 'object'
     or pg_catalog.octet_length(p_market::text) > 32768
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(p_market) as market_key(key_name)
       where market_key.key_name <> all (array[
        'tokenPriceEth',
        'tokenPriceEthWei',
        'tokenPriceUsdWad',
        'marketCapEth',
        'marketCapEthWei',
        'indexedMarketCapEth',
        'indexedMarketCapEthWei',
        'indexedMarketCapUsdWad',
        'indexedValuationBlockNumber',
        'grossVolumeEth',
        'grossVolumeWei',
        'creatorFeesGeneratedEth',
        'creatorFeesGeneratedWei',
        'launcherFeesGeneratedEth',
        'launcherFeesGeneratedWei',
        'creatorFeesAccruedEth',
        'creatorFeesAccruedWei',
        'swapCount',
        'currentTick',
        'activeLiquidity'
      ]::text[])
     )
     or exists (
       select 1
       from pg_catalog.jsonb_each(p_market) as market_entry(key_name, value)
       where pg_catalog.jsonb_typeof(market_entry.value)
         not in ('string', 'number')
     )
  then
    return false;
  end if;

  select pg_catalog.count(*)::integer into market_key_count
  from pg_catalog.jsonb_object_keys(p_market);
  if market_key_count not in (3, 9)
     or not (p_market operator(pg_catalog.?) 'indexedValuationBlockNumber')
     or not (p_market operator(pg_catalog.?) 'currentTick')
     or not (p_market operator(pg_catalog.?) 'activeLiquidity')
     or pg_catalog.jsonb_typeof(
       p_market -> 'indexedValuationBlockNumber'
     ) <> 'string'
     or pg_catalog.jsonb_typeof(p_market -> 'currentTick') <> 'number'
     or pg_catalog.jsonb_typeof(p_market -> 'activeLiquidity') <> 'string'
  then
    return false;
  end if;

  if market_key_count = 9 then
    foreach classic_key in array array[
      'tokenPriceEth',
      'tokenPriceEthWei',
      'marketCapEth',
      'marketCapEthWei',
      'indexedMarketCapEth',
      'indexedMarketCapEthWei'
    ]::text[]
    loop
      if not (p_market operator(pg_catalog.?) classic_key)
         or pg_catalog.jsonb_typeof(p_market -> classic_key) <> 'string'
      then
        return false;
      end if;
      scalar_text := p_market ->> classic_key;
      if classic_key like '%Wei' then
        expected_pattern := '^(0|[1-9][0-9]*)$';
      else
        expected_pattern := '^(0|[1-9][0-9]*)(\.[0-9]+)?$';
      end if;
      if pg_catalog.octet_length(scalar_text) not between 1 and 128
         or not (scalar_text operator(pg_catalog.~) expected_pattern)
      then
        return false;
      end if;
    end loop;
  end if;

  scalar_text := p_market ->> 'indexedValuationBlockNumber';
  if scalar_text is null
     or pg_catalog.octet_length(scalar_text) > 20
     or not scalar_text operator(pg_catalog.~) '^(0|[1-9][0-9]*)$'
  then
    return false;
  end if;
  if scalar_text::numeric <> p_block_number::numeric then
    return false;
  end if;

  if p_market operator(pg_catalog.?) 'currentTick' then
    scalar_text := p_market ->> 'currentTick';
    if scalar_text is null
       or pg_catalog.octet_length(scalar_text) > 8
       or not scalar_text operator(pg_catalog.~) '^-?(0|[1-9][0-9]*)$'
    then
      return false;
    end if;
    if scalar_text::numeric <> p_current_tick::numeric then
      return false;
    end if;
  end if;

  if p_market operator(pg_catalog.?) 'activeLiquidity' then
    scalar_text := p_market ->> 'activeLiquidity';
    if scalar_text is null
       or pg_catalog.octet_length(scalar_text) > 78
       or not scalar_text operator(pg_catalog.~) '^(0|[1-9][0-9]*)$'
    then
      return false;
    end if;
    if scalar_text::numeric <> p_active_liquidity then
      return false;
    end if;
  end if;

  return true;
end
$function$;

create table programmable_private.optimistic_market_state_rows_v1 (
  optimistic_market_state_id uuid primary key,
  version programmable_private.projector_identifier not null
    check (version = 'optimistic-market-state-v1'),
  finality programmable_private.projector_identifier not null
    check (finality = 'optimistic'),
  optimistic_block_id uuid not null,
  chain_id programmable_private.chain_id_value not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  pool_id programmable_private.bytes32_value not null,
  token_address programmable_private.eth_address not null,
  state_view_address programmable_private.eth_address not null,
  state_view_runtime_code_hash programmable_private.bytes32_value not null,
  sqrt_price_x96 programmable_private.uint256_value not null,
  current_tick integer not null check (current_tick between -887272 and 887272),
  active_liquidity programmable_private.uint256_value not null,
  protocol_fee_pips integer not null
    check (
      protocol_fee_pips >= 0
      and (protocol_fee_pips operator(pg_catalog.&) 4095) <= 1000
      and (protocol_fee_pips operator(pg_catalog.>>) 12) <= 1000
    ),
  lp_fee_pips integer not null check (lp_fee_pips between 0 and 1000000),
  provider_a_slot0_result bytea not null,
  provider_b_slot0_result bytea not null,
  slot0_result bytea not null,
  provider_a_liquidity_result bytea not null,
  provider_b_liquidity_result bytea not null,
  liquidity_result bytea not null,
  market jsonb not null,
  market_commitment programmable_private.bytes32_value not null,
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
  provider_a_endpoint_commitment programmable_private.bytes32_value not null,
  provider_b_endpoint_commitment programmable_private.bytes32_value not null,
  provider_a_origin_commitment programmable_private.bytes32_value not null,
  provider_b_origin_commitment programmable_private.bytes32_value not null,
  market_provider_a_head programmable_private.block_number_value not null,
  market_provider_b_head programmable_private.block_number_value not null,
  confirmations smallint not null check (confirmations between 0 and 11),
  block_provider_call_count_a smallint not null
    check (block_provider_call_count_a = 4),
  block_provider_call_count_b smallint not null
    check (block_provider_call_count_b = 4),
  market_provider_call_count_a smallint not null
    check (market_provider_call_count_a = 7),
  market_provider_call_count_b smallint not null
    check (market_provider_call_count_b = 7),
  total_provider_call_count_a smallint not null
    check (total_provider_call_count_a = 11),
  total_provider_call_count_b smallint not null
    check (total_provider_call_count_b = 11),
  evidence_commitment programmable_private.bytes32_value not null,
  observed_at timestamptz not null,
  foreign key (optimistic_block_id, chain_id, block_number, block_hash)
    references programmable_private.optimistic_block_observations_v1(
      optimistic_block_id, chain_id, block_number, block_hash
    )
    on delete restrict,
  check (
    state_view_address =
      pg_catalog.decode('7ffe42c4a5deea5b0fec41c94c136cf115597227', 'hex')
    and state_view_runtime_code_hash =
      pg_catalog.decode(
        'd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878',
        'hex'
      )
    and
    state_view_runtime_code_hash <>
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  ),
  check (
    sqrt_price_x96 <=
      1461501637330902918203684832716283019655932542975
    and active_liquidity <=
      340282366920938463463374607431768211455
  ),
  check (
    pg_catalog.octet_length(provider_a_slot0_result) = 128
    and provider_a_slot0_result = provider_b_slot0_result
    and provider_a_slot0_result = slot0_result
    and pg_catalog.octet_length(provider_a_liquidity_result) = 32
    and provider_a_liquidity_result = provider_b_liquidity_result
    and provider_a_liquidity_result = liquidity_result
  ),
  check (provider_a_id <> provider_b_id),
  check (provider_a_vendor = 'alchemy' and provider_b_vendor = 'quicknode'),
  check (
    confirmations =
      least(market_provider_a_head, market_provider_b_head) - block_number
  ),
  check (
    programmable_private.valid_optimistic_market_json_v1(
      market, block_number, current_tick, active_liquidity
    )
  ),
  check (
    market_commitment <>
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and evidence_commitment <>
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  ),
  check (pg_catalog.isfinite(observed_at)),
  unique (chain_id, block_hash, pool_id)
);

comment on table programmable_private.optimistic_market_state_rows_v1 is
  'Immutable dual-provider market-state evidence. Rows are capped at 100 per block; current readers expose at most the live 0-11 confirmation window.';

create index optimistic_market_state_rows_keyset_idx
on programmable_private.optimistic_market_state_rows_v1 (
  chain_id,
  block_number,
  pool_id,
  optimistic_market_state_id
);

create table programmable_private.optimistic_event_rows_v1 (
  optimistic_event_id uuid primary key,
  optimistic_block_id uuid not null,
  chain_id programmable_private.chain_id_value not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  transaction_hash programmable_private.bytes32_value not null,
  transaction_index programmable_private.transaction_index_value not null,
  block_global_log_index programmable_private.block_log_index_value not null,
  source_address programmable_private.eth_address not null,
  event_signature programmable_private.bytes32_value not null,
  ordered_topics bytea[] not null,
  raw_data bytea not null,
  normalized_payload jsonb not null,
  payload_commitment programmable_private.bytes32_value not null,
  observed_at timestamptz not null,
  foreign key (optimistic_block_id, chain_id, block_number, block_hash)
    references programmable_private.optimistic_block_observations_v1(
      optimistic_block_id, chain_id, block_number, block_hash
    )
    on delete restrict,
  check (programmable_private.valid_topics(ordered_topics)),
  check (pg_catalog.octet_length(raw_data) <= 65536),
  check (pg_catalog.jsonb_typeof(normalized_payload) = 'object'),
  check (pg_catalog.octet_length(normalized_payload::text) <= 65536),
  check (pg_catalog.isfinite(observed_at)),
  unique (
    chain_id,
    block_hash,
    transaction_hash,
    block_global_log_index
  )
);

comment on table programmable_private.optimistic_event_rows_v1 is
  'Immutable normalized optimistic event rows keyed by chain, block hash, transaction hash, and block-global log index.';

create index optimistic_event_rows_keyset_idx
on programmable_private.optimistic_event_rows_v1 (
  chain_id,
  block_number,
  block_global_log_index,
  optimistic_event_id
);

create table programmable_private.optimistic_block_status_history_v1 (
  status_id uuid primary key,
  optimistic_block_id uuid not null,
  chain_id programmable_private.chain_id_value not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  status programmable_private.optimistic_block_status_v1 not null,
  reorg_generation bigint not null check (reorg_generation >= 0),
  replaced_by_block_id uuid,
  decision_commitment programmable_private.bytes32_value not null,
  decided_at timestamptz not null,
  foreign key (optimistic_block_id, chain_id, block_number, block_hash)
    references programmable_private.optimistic_block_observations_v1(
      optimistic_block_id, chain_id, block_number, block_hash
    )
    on delete restrict,
  foreign key (replaced_by_block_id)
    references programmable_private.optimistic_block_observations_v1(
      optimistic_block_id
    )
    on delete restrict,
  check (
    (status = 'canonical' and replaced_by_block_id is null)
    or (
      status = 'orphaned'
      and replaced_by_block_id is not null
      and replaced_by_block_id <> optimistic_block_id
    )
  ),
  check (pg_catalog.isfinite(decided_at)),
  unique (optimistic_block_id, status, reorg_generation)
);

create table programmable_private.optimistic_block_current_canonical_v1 (
  chain_id programmable_private.chain_id_value not null,
  block_number programmable_private.block_number_value not null,
  optimistic_block_id uuid not null,
  block_hash programmable_private.bytes32_value not null,
  reorg_generation bigint not null check (reorg_generation >= 0),
  status_id uuid not null unique
    references programmable_private.optimistic_block_status_history_v1(status_id)
    on delete restrict,
  updated_at timestamptz not null,
  primary key (chain_id, block_number),
  foreign key (optimistic_block_id, chain_id, block_number, block_hash)
    references programmable_private.optimistic_block_observations_v1(
      optimistic_block_id, chain_id, block_number, block_hash
    )
    on delete restrict,
  check (pg_catalog.isfinite(updated_at))
);

create table programmable_private.optimistic_chain_head_current_v1 (
  chain_id programmable_private.chain_id_value primary key,
  segment_start_block_number
    programmable_private.block_number_value not null,
  optimistic_block_id uuid not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  parent_hash programmable_private.bytes32_value not null,
  reorg_generation bigint not null check (reorg_generation >= 0),
  status_id uuid not null unique
    references programmable_private.optimistic_block_status_history_v1(status_id)
    on delete restrict,
  updated_at timestamptz not null,
  foreign key (optimistic_block_id, chain_id, block_number, block_hash)
    references programmable_private.optimistic_block_observations_v1(
      optimistic_block_id, chain_id, block_number, block_hash
    )
    on delete restrict,
  check (segment_start_block_number <= block_number),
  check (pg_catalog.isfinite(updated_at))
);

comment on table programmable_private.optimistic_block_current_canonical_v1 is
  'Per-height canonical optimistic pointer. Replacements atomically append orphan/canonical status history and advance reorg_generation.';

-- The projector candidate reader orders by exactly this tuple. This avoids a
-- sort/scan on each keyset page while preserving the existing function API.
create index envio_candidate_inbox_projector_keyset_idx
on programmable_private.envio_candidate_inbox (
  chain_id,
  block_number,
  block_global_log_index,
  candidate_id
);

do $rls$
declare
  table_name text;
begin
  foreach table_name in array array[
    'optimistic_block_observations_v1',
    'optimistic_market_state_rows_v1',
    'optimistic_event_rows_v1',
    'optimistic_block_status_history_v1',
    'optimistic_block_current_canonical_v1',
    'optimistic_chain_head_current_v1'
  ]
  loop
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
      table_name || '_migrator_all',
      table_name
    );
  end loop;
end
$rls$;

create trigger reject_immutable_mutation
before update or delete on programmable_private.optimistic_block_observations_v1
for each row execute function programmable_private.reject_immutable_mutation();

create trigger reject_immutable_mutation
before update or delete on programmable_private.optimistic_market_state_rows_v1
for each row execute function programmable_private.reject_immutable_mutation();

create trigger reject_immutable_mutation
before update or delete on programmable_private.optimistic_event_rows_v1
for each row execute function programmable_private.reject_immutable_mutation();

create trigger reject_immutable_mutation
before update or delete on programmable_private.optimistic_block_status_history_v1
for each row execute function programmable_private.reject_immutable_mutation();

create function programmable_private.append_optimistic_block_observation_v1(
  p_optimistic_block_id uuid,
  p_chain_id bigint,
  p_block_number bigint,
  p_block_hash_a bytea,
  p_block_hash_b bytea,
  p_parent_hash_a bytea,
  p_parent_hash_b bytea,
  p_block_timestamp_a timestamptz,
  p_block_timestamp_b timestamptz,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_provider_a_head bigint,
  p_provider_b_head bigint,
  p_evidence_commitment bytea,
  p_observed_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  existing programmable_private.optimistic_block_observations_v1%rowtype;
  inserted_id uuid;
  rpc_chain_a bigint;
  rpc_chain_b bigint;
  vendor_a text;
  vendor_b text;
  vendor_order_a smallint;
  vendor_order_b smallint;
begin
  perform programmable_private.assert_caller('programmable_projector');

  if p_optimistic_block_id is null
     or p_chain_id <= 0
     or p_block_number < 0
     or p_block_hash_a is null
     or p_block_hash_b is null
     or p_block_hash_a <> p_block_hash_b
     or pg_catalog.octet_length(p_block_hash_a) <> 32
     or p_parent_hash_a is null
     or p_parent_hash_b is null
     or p_parent_hash_a <> p_parent_hash_b
     or pg_catalog.octet_length(p_parent_hash_a) <> 32
     or p_block_timestamp_a is null
     or p_block_timestamp_b is null
     or p_block_timestamp_a <> p_block_timestamp_b
     or not pg_catalog.isfinite(p_block_timestamp_a)
     or p_block_timestamp_a > p_observed_at + interval '5 minutes'
     or p_provider_a_id is null
     or p_provider_b_id is null
     or p_provider_a_id = p_provider_b_id
     or p_provider_a_head < p_block_number
     or p_provider_b_head < p_block_number
     or p_evidence_commitment is null
     or pg_catalog.octet_length(p_evidence_commitment) <> 32
     or p_observed_at is null
     or not pg_catalog.isfinite(p_observed_at)
     or p_observed_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid optimistic dual-RPC block envelope';
  end if;

  select metadata.chain_id, metadata.vendor, metadata.vendor_order
  into rpc_chain_a, vendor_a, vendor_order_a
  from programmable_private.provider_deployments as deployment
  join programmable_private.rpc_provider_deployment_metadata as metadata
    on metadata.provider_deployment_id = deployment.provider_deployment_id
  where deployment.provider_deployment_id = p_provider_a_id
    and deployment.provider_type = 'rpc_provider';
  if not found then
    raise exception using errcode = '22023', message = 'invalid first RPC deployment';
  end if;

  select metadata.chain_id, metadata.vendor, metadata.vendor_order
  into rpc_chain_b, vendor_b, vendor_order_b
  from programmable_private.provider_deployments as deployment
  join programmable_private.rpc_provider_deployment_metadata as metadata
    on metadata.provider_deployment_id = deployment.provider_deployment_id
  where deployment.provider_deployment_id = p_provider_b_id
    and deployment.provider_type = 'rpc_provider';
  if not found then
    raise exception using errcode = '22023', message = 'invalid second RPC deployment';
  end if;

  if rpc_chain_a <> p_chain_id
     or rpc_chain_b <> p_chain_id
     or vendor_a <> 'alchemy'
     or vendor_order_a <> 1
     or vendor_b <> 'quicknode'
     or vendor_order_b <> 2
  then
    raise exception using
      errcode = '22023',
      message = 'RPC deployments violate canonical chain/vendor order';
  end if;

  insert into programmable_private.optimistic_block_observations_v1 (
    optimistic_block_id,
    chain_id,
    block_number,
    block_hash,
    parent_hash,
    block_timestamp,
    provider_a_id,
    provider_b_id,
    provider_a_head,
    provider_b_head,
    provider_a_block_hash,
    provider_b_block_hash,
    provider_a_parent_hash,
    provider_b_parent_hash,
    provider_a_block_timestamp,
    provider_b_block_timestamp,
    evidence_commitment,
    observed_at
  ) values (
    p_optimistic_block_id,
    p_chain_id::programmable_private.chain_id_value,
    p_block_number::programmable_private.block_number_value,
    p_block_hash_a::programmable_private.bytes32_value,
    p_parent_hash_a::programmable_private.bytes32_value,
    p_block_timestamp_a,
    p_provider_a_id,
    p_provider_b_id,
    p_provider_a_head::programmable_private.block_number_value,
    p_provider_b_head::programmable_private.block_number_value,
    p_block_hash_a::programmable_private.bytes32_value,
    p_block_hash_b::programmable_private.bytes32_value,
    p_parent_hash_a::programmable_private.bytes32_value,
    p_parent_hash_b::programmable_private.bytes32_value,
    p_block_timestamp_a,
    p_block_timestamp_b,
    p_evidence_commitment::programmable_private.bytes32_value,
    p_observed_at
  )
  on conflict do nothing
  returning optimistic_block_id into inserted_id;

  if inserted_id is not null then
    return inserted_id;
  end if;

  select * into existing
  from programmable_private.optimistic_block_observations_v1 as block_row
  where block_row.optimistic_block_id = p_optimistic_block_id;
  if not found then
    select * into existing
    from programmable_private.optimistic_block_observations_v1 as block_row
    where block_row.chain_id = p_chain_id
      and block_row.block_hash = p_block_hash_a;
  end if;

  if found
     and existing.optimistic_block_id = p_optimistic_block_id
     and existing.chain_id = p_chain_id
     and existing.block_number = p_block_number
     and existing.block_hash = p_block_hash_a
     and existing.parent_hash = p_parent_hash_a
     and existing.block_timestamp = p_block_timestamp_a
     and existing.provider_a_id = p_provider_a_id
     and existing.provider_b_id = p_provider_b_id
     and existing.provider_a_head = p_provider_a_head
     and existing.provider_b_head = p_provider_b_head
     and existing.provider_a_block_hash = p_block_hash_a
     and existing.provider_b_block_hash = p_block_hash_b
     and existing.provider_a_parent_hash = p_parent_hash_a
     and existing.provider_b_parent_hash = p_parent_hash_b
     and existing.provider_a_block_timestamp = p_block_timestamp_a
     and existing.provider_b_block_timestamp = p_block_timestamp_b
     and existing.evidence_commitment = p_evidence_commitment
  then
    return existing.optimistic_block_id;
  end if;

  raise exception using
    errcode = '23505',
    message = 'optimistic block id or physical identity mismatch';
end
$function$;

create function programmable_private.append_optimistic_market_state_v1(
  p_optimistic_market_state_id uuid,
  p_optimistic_block_id uuid,
  p_pool_id bytea,
  p_token_address bytea,
  p_state_view_address bytea,
  p_state_view_runtime_code_hash bytea,
  p_sqrt_price_x96 numeric,
  p_current_tick integer,
  p_active_liquidity numeric,
  p_protocol_fee_pips integer,
  p_lp_fee_pips integer,
  p_slot0_result_a bytea,
  p_slot0_result_b bytea,
  p_liquidity_result_a bytea,
  p_liquidity_result_b bytea,
  p_market jsonb,
  p_market_commitment bytea,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_provider_a_identity text,
  p_provider_b_identity text,
  p_provider_a_endpoint_commitment bytea,
  p_provider_b_endpoint_commitment bytea,
  p_provider_a_origin_commitment bytea,
  p_provider_b_origin_commitment bytea,
  p_market_provider_a_head bigint,
  p_market_provider_b_head bigint,
  p_block_provider_call_count_a smallint,
  p_block_provider_call_count_b smallint,
  p_market_provider_call_count_a smallint,
  p_market_provider_call_count_b smallint,
  p_total_provider_call_count_a smallint,
  p_total_provider_call_count_b smallint,
  p_confirmations smallint,
  p_evidence_commitment bytea,
  p_observed_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  block_row programmable_private.optimistic_block_observations_v1%rowtype;
  existing programmable_private.optimistic_market_state_rows_v1%rowtype;
  inserted_id uuid;
  provider_a_context record;
  provider_b_context record;
begin
  perform programmable_private.assert_caller('programmable_projector');

  select * into block_row
  from programmable_private.optimistic_block_observations_v1
  where optimistic_block_id = p_optimistic_block_id
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'optimistic block is unknown';
  end if;

  if p_optimistic_market_state_id is null
     or p_pool_id is null
     or pg_catalog.octet_length(p_pool_id) <> 32
     or p_token_address is null
     or pg_catalog.octet_length(p_token_address) <> 20
     or p_state_view_address is null
     or p_state_view_address <>
       pg_catalog.decode('7ffe42c4a5deea5b0fec41c94c136cf115597227', 'hex')
     or p_state_view_runtime_code_hash is null
     or p_state_view_runtime_code_hash <>
       pg_catalog.decode(
         'd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878',
         'hex'
       )
     or p_sqrt_price_x96 is null
     or p_sqrt_price_x96 <> pg_catalog.trunc(p_sqrt_price_x96)
     or p_sqrt_price_x96 < 0
     or p_sqrt_price_x96 >
       1461501637330902918203684832716283019655932542975
     or p_current_tick is null
     or p_current_tick < -887272
     or p_current_tick > 887272
     or p_active_liquidity is null
     or p_active_liquidity <> pg_catalog.trunc(p_active_liquidity)
     or p_active_liquidity < 0
     or p_active_liquidity > 340282366920938463463374607431768211455
     or p_protocol_fee_pips is null
     or p_protocol_fee_pips < 0
     or (p_protocol_fee_pips operator(pg_catalog.&) 4095) > 1000
     or (p_protocol_fee_pips operator(pg_catalog.>>) 12) > 1000
     or p_lp_fee_pips is null
     or p_lp_fee_pips < 0
     or p_lp_fee_pips > 1000000
     or p_slot0_result_a is null
     or pg_catalog.octet_length(p_slot0_result_a) <> 128
     or p_slot0_result_b is null
     or p_slot0_result_a <> p_slot0_result_b
     or p_liquidity_result_a is null
     or pg_catalog.octet_length(p_liquidity_result_a) <> 32
     or p_liquidity_result_b is null
     or p_liquidity_result_a <> p_liquidity_result_b
     or not programmable_private.valid_optimistic_market_json_v1(
       p_market, block_row.block_number, p_current_tick, p_active_liquidity
     )
     or p_market_commitment is null
     or pg_catalog.octet_length(p_market_commitment) <> 32
     or p_market_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_provider_a_id is null
     or p_provider_b_id is null
     or p_provider_a_id = p_provider_b_id
     or p_provider_a_identity is null
     or p_provider_b_identity is null
     or p_provider_a_endpoint_commitment is null
     or pg_catalog.octet_length(p_provider_a_endpoint_commitment) <> 32
     or p_provider_b_endpoint_commitment is null
     or pg_catalog.octet_length(p_provider_b_endpoint_commitment) <> 32
     or p_provider_a_origin_commitment is null
     or pg_catalog.octet_length(p_provider_a_origin_commitment) <> 32
     or p_provider_b_origin_commitment is null
     or pg_catalog.octet_length(p_provider_b_origin_commitment) <> 32
     or p_market_provider_a_head is null
     or p_market_provider_b_head is null
     or p_market_provider_a_head < block_row.provider_a_head
     or p_market_provider_b_head < block_row.provider_b_head
     or p_market_provider_a_head < block_row.block_number
     or p_market_provider_b_head < block_row.block_number
     or p_confirmations is null
     or p_confirmations < 0
     or p_confirmations > 11
     or p_confirmations <>
       least(
         p_market_provider_a_head, p_market_provider_b_head
       ) - block_row.block_number
     or p_block_provider_call_count_a <> 4
     or p_block_provider_call_count_b <> 4
     or p_market_provider_call_count_a <> 7
     or p_market_provider_call_count_b <> 7
     or p_total_provider_call_count_a <> 11
     or p_total_provider_call_count_b <> 11
     or p_evidence_commitment is null
     or pg_catalog.octet_length(p_evidence_commitment) <> 32
     or p_evidence_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_observed_at is null
     or not pg_catalog.isfinite(p_observed_at)
     or p_observed_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid optimistic market-state envelope';
  end if;

  select
    deployment.redacted_identity::text as redacted_identity,
    deployment.deployment_commitment::bytea as deployment_commitment,
    metadata.chain_id::bigint as chain_id,
    metadata.vendor::text as vendor,
    metadata.vendor_order,
    metadata.endpoint_url_commitment::bytea as endpoint_url_commitment,
    metadata.endpoint_origin_commitment::bytea as endpoint_origin_commitment
  into provider_a_context
  from programmable_private.provider_deployments as deployment
  join programmable_private.rpc_provider_deployment_metadata as metadata
    on metadata.provider_deployment_id = deployment.provider_deployment_id
  where deployment.provider_deployment_id = p_provider_a_id
    and deployment.provider_type = 'rpc_provider';
  if not found then
    raise exception using errcode = '22023', message = 'invalid first market RPC deployment';
  end if;

  select
    deployment.redacted_identity::text as redacted_identity,
    deployment.deployment_commitment::bytea as deployment_commitment,
    metadata.chain_id::bigint as chain_id,
    metadata.vendor::text as vendor,
    metadata.vendor_order,
    metadata.endpoint_url_commitment::bytea as endpoint_url_commitment,
    metadata.endpoint_origin_commitment::bytea as endpoint_origin_commitment
  into provider_b_context
  from programmable_private.provider_deployments as deployment
  join programmable_private.rpc_provider_deployment_metadata as metadata
    on metadata.provider_deployment_id = deployment.provider_deployment_id
  where deployment.provider_deployment_id = p_provider_b_id
    and deployment.provider_type = 'rpc_provider';
  if not found then
    raise exception using errcode = '22023', message = 'invalid second market RPC deployment';
  end if;

  if p_provider_a_id <> block_row.provider_a_id
     or p_provider_b_id <> block_row.provider_b_id
     or provider_a_context.chain_id <> block_row.chain_id
     or provider_b_context.chain_id <> block_row.chain_id
     or provider_a_context.vendor <> 'alchemy'
     or provider_a_context.vendor_order <> 1
     or provider_b_context.vendor <> 'quicknode'
     or provider_b_context.vendor_order <> 2
     or provider_a_context.redacted_identity <>
       'rpc:1:' || provider_a_context.vendor
     or provider_b_context.redacted_identity <>
       'rpc:1:' || provider_b_context.vendor
     or p_provider_a_identity <>
       provider_a_context.vendor || '-mainnet-' || pg_catalog.substr(
         pg_catalog.encode(provider_a_context.deployment_commitment, 'hex'),
         1,
         32
       )
     or p_provider_b_identity <>
       provider_b_context.vendor || '-mainnet-' || pg_catalog.substr(
         pg_catalog.encode(provider_b_context.deployment_commitment, 'hex'),
         1,
         32
       )
     or provider_a_context.endpoint_url_commitment <>
       p_provider_a_endpoint_commitment
     or provider_b_context.endpoint_url_commitment <>
       p_provider_b_endpoint_commitment
     or provider_a_context.endpoint_origin_commitment <>
       p_provider_a_origin_commitment
     or provider_b_context.endpoint_origin_commitment <>
       p_provider_b_origin_commitment
  then
    raise exception using
      errcode = '22023',
      message = 'market RPC evidence violates block deployment binding';
  end if;

  -- One lock per physical block makes the 100-row bound exact under concurrent
  -- serverless projector invocations without coupling it to the wake queue.
  perform pg_catalog.pg_advisory_xact_lock(
    1347571541,
    pg_catalog.hashtext(pg_catalog.encode(block_row.block_hash, 'hex'))
  );

  select * into existing
  from programmable_private.optimistic_market_state_rows_v1 as state_row
  where state_row.optimistic_market_state_id = p_optimistic_market_state_id;
  if not found then
    select * into existing
    from programmable_private.optimistic_market_state_rows_v1 as state_row
    where state_row.chain_id = block_row.chain_id
      and state_row.block_hash = block_row.block_hash
      and state_row.pool_id = p_pool_id;
  end if;

  if found then
    if existing.optimistic_market_state_id = p_optimistic_market_state_id
       and existing.version = 'optimistic-market-state-v1'
       and existing.finality = 'optimistic'
       and existing.optimistic_block_id = block_row.optimistic_block_id
       and existing.chain_id = block_row.chain_id
       and existing.block_number = block_row.block_number
       and existing.block_hash = block_row.block_hash
       and existing.pool_id = p_pool_id
       and existing.token_address = p_token_address
       and existing.state_view_address = p_state_view_address
       and existing.state_view_runtime_code_hash =
         p_state_view_runtime_code_hash
       and existing.sqrt_price_x96 = p_sqrt_price_x96
       and existing.current_tick = p_current_tick
       and existing.active_liquidity = p_active_liquidity
       and existing.protocol_fee_pips = p_protocol_fee_pips
       and existing.lp_fee_pips = p_lp_fee_pips
       and existing.provider_a_slot0_result = p_slot0_result_a
       and existing.provider_b_slot0_result = p_slot0_result_b
       and existing.slot0_result = p_slot0_result_a
       and existing.provider_a_liquidity_result = p_liquidity_result_a
       and existing.provider_b_liquidity_result = p_liquidity_result_b
       and existing.liquidity_result = p_liquidity_result_a
       and existing.market = p_market
       and existing.market_commitment = p_market_commitment
       and existing.provider_a_id = p_provider_a_id
       and existing.provider_b_id = p_provider_b_id
       and existing.provider_a_identity = p_provider_a_identity
       and existing.provider_b_identity = p_provider_b_identity
       and existing.provider_a_vendor = provider_a_context.vendor
       and existing.provider_b_vendor = provider_b_context.vendor
       and existing.provider_a_endpoint_commitment =
         p_provider_a_endpoint_commitment
       and existing.provider_b_endpoint_commitment =
         p_provider_b_endpoint_commitment
       and existing.provider_a_origin_commitment =
         p_provider_a_origin_commitment
       and existing.provider_b_origin_commitment =
         p_provider_b_origin_commitment
       and existing.market_provider_a_head = p_market_provider_a_head
       and existing.market_provider_b_head = p_market_provider_b_head
       and existing.block_provider_call_count_a =
         p_block_provider_call_count_a
       and existing.block_provider_call_count_b =
         p_block_provider_call_count_b
       and existing.market_provider_call_count_a =
         p_market_provider_call_count_a
       and existing.market_provider_call_count_b =
         p_market_provider_call_count_b
       and existing.total_provider_call_count_a =
         p_total_provider_call_count_a
       and existing.total_provider_call_count_b =
         p_total_provider_call_count_b
       and existing.confirmations = p_confirmations
       and existing.evidence_commitment = p_evidence_commitment
    then
      -- Receipt time is deliberately excluded from replay identity.
      return existing.optimistic_market_state_id;
    end if;
    raise exception using
      errcode = '23505',
      message = 'optimistic market-state id or physical identity mismatch';
  end if;

  if (
    select pg_catalog.count(*)
    from programmable_private.optimistic_market_state_rows_v1 as state_row
    where state_row.chain_id = block_row.chain_id
      and state_row.block_hash = block_row.block_hash
  ) >= 100 then
    raise exception using
      errcode = '54000',
      message = 'optimistic market-state block capacity reached';
  end if;

  insert into programmable_private.optimistic_market_state_rows_v1 (
    optimistic_market_state_id, version, finality,
    optimistic_block_id, chain_id, block_number, block_hash,
    pool_id, token_address, state_view_address,
    state_view_runtime_code_hash, sqrt_price_x96, current_tick,
    active_liquidity, protocol_fee_pips, lp_fee_pips,
    provider_a_slot0_result, provider_b_slot0_result, slot0_result,
    provider_a_liquidity_result, provider_b_liquidity_result,
    liquidity_result, market, market_commitment,
    provider_a_id, provider_b_id, provider_a_identity, provider_b_identity,
    provider_a_vendor, provider_b_vendor,
    provider_a_endpoint_commitment, provider_b_endpoint_commitment,
    provider_a_origin_commitment, provider_b_origin_commitment,
    market_provider_a_head, market_provider_b_head, confirmations,
    block_provider_call_count_a, block_provider_call_count_b,
    market_provider_call_count_a, market_provider_call_count_b,
    total_provider_call_count_a, total_provider_call_count_b,
    evidence_commitment, observed_at
  ) values (
    p_optimistic_market_state_id, 'optimistic-market-state-v1', 'optimistic',
    block_row.optimistic_block_id, block_row.chain_id,
    block_row.block_number, block_row.block_hash,
    p_pool_id, p_token_address, p_state_view_address,
    p_state_view_runtime_code_hash, p_sqrt_price_x96, p_current_tick,
    p_active_liquidity, p_protocol_fee_pips, p_lp_fee_pips,
    p_slot0_result_a, p_slot0_result_b, p_slot0_result_a,
    p_liquidity_result_a, p_liquidity_result_b, p_liquidity_result_a,
    p_market, p_market_commitment,
    p_provider_a_id, p_provider_b_id,
    p_provider_a_identity, p_provider_b_identity,
    provider_a_context.vendor, provider_b_context.vendor,
    p_provider_a_endpoint_commitment, p_provider_b_endpoint_commitment,
    p_provider_a_origin_commitment, p_provider_b_origin_commitment,
    p_market_provider_a_head, p_market_provider_b_head, p_confirmations,
    p_block_provider_call_count_a, p_block_provider_call_count_b,
    p_market_provider_call_count_a, p_market_provider_call_count_b,
    p_total_provider_call_count_a, p_total_provider_call_count_b,
    p_evidence_commitment, p_observed_at
  )
  returning optimistic_market_state_id into inserted_id;

  return inserted_id;
end
$function$;

create function programmable_private.append_optimistic_event_row_v1(
  p_optimistic_event_id uuid,
  p_optimistic_block_id uuid,
  p_transaction_hash bytea,
  p_transaction_index bigint,
  p_block_global_log_index bigint,
  p_source_address bytea,
  p_event_signature bytea,
  p_ordered_topics bytea[],
  p_raw_data bytea,
  p_normalized_payload jsonb,
  p_payload_commitment bytea,
  p_observed_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  block_row programmable_private.optimistic_block_observations_v1%rowtype;
  existing programmable_private.optimistic_event_rows_v1%rowtype;
  inserted_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');

  select * into block_row
  from programmable_private.optimistic_block_observations_v1
  where optimistic_block_id = p_optimistic_block_id
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'optimistic block is unknown';
  end if;

  if p_optimistic_event_id is null
     or p_transaction_hash is null
     or pg_catalog.octet_length(p_transaction_hash) <> 32
     or p_transaction_index < 0
     or p_transaction_index > 4294967295
     or p_block_global_log_index < 0
     or p_block_global_log_index > 4294967295
     or p_source_address is null
     or pg_catalog.octet_length(p_source_address) <> 20
     or p_event_signature is null
     or pg_catalog.octet_length(p_event_signature) <> 32
     or not programmable_private.valid_topics(p_ordered_topics)
     or p_raw_data is null
     or pg_catalog.octet_length(p_raw_data) > 65536
     or p_normalized_payload is null
     or pg_catalog.jsonb_typeof(p_normalized_payload) <> 'object'
     or pg_catalog.octet_length(p_normalized_payload::text) > 65536
     or p_payload_commitment is null
     or pg_catalog.octet_length(p_payload_commitment) <> 32
     or p_observed_at is null
     or not pg_catalog.isfinite(p_observed_at)
     or p_observed_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid optimistic event envelope';
  end if;

  insert into programmable_private.optimistic_event_rows_v1 (
    optimistic_event_id,
    optimistic_block_id,
    chain_id,
    block_number,
    block_hash,
    transaction_hash,
    transaction_index,
    block_global_log_index,
    source_address,
    event_signature,
    ordered_topics,
    raw_data,
    normalized_payload,
    payload_commitment,
    observed_at
  ) values (
    p_optimistic_event_id,
    block_row.optimistic_block_id,
    block_row.chain_id,
    block_row.block_number,
    block_row.block_hash,
    p_transaction_hash::programmable_private.bytes32_value,
    p_transaction_index::programmable_private.transaction_index_value,
    p_block_global_log_index::programmable_private.block_log_index_value,
    p_source_address::programmable_private.eth_address,
    p_event_signature::programmable_private.bytes32_value,
    p_ordered_topics,
    p_raw_data,
    p_normalized_payload,
    p_payload_commitment::programmable_private.bytes32_value,
    p_observed_at
  )
  on conflict do nothing
  returning optimistic_event_id into inserted_id;

  if inserted_id is not null then
    return inserted_id;
  end if;

  select * into existing
  from programmable_private.optimistic_event_rows_v1 as event_row
  where event_row.optimistic_event_id = p_optimistic_event_id;
  if not found then
    select * into existing
    from programmable_private.optimistic_event_rows_v1 as event_row
    where event_row.chain_id = block_row.chain_id
      and event_row.block_hash = block_row.block_hash
      and event_row.transaction_hash = p_transaction_hash
      and event_row.block_global_log_index = p_block_global_log_index;
  end if;

  if found
     and existing.optimistic_event_id = p_optimistic_event_id
     and existing.optimistic_block_id = block_row.optimistic_block_id
     and existing.chain_id = block_row.chain_id
     and existing.block_number = block_row.block_number
     and existing.block_hash = block_row.block_hash
     and existing.transaction_hash = p_transaction_hash
     and existing.transaction_index = p_transaction_index
     and existing.block_global_log_index = p_block_global_log_index
     and existing.source_address = p_source_address
     and existing.event_signature = p_event_signature
     and existing.ordered_topics = p_ordered_topics
     and existing.raw_data = p_raw_data
     and existing.normalized_payload = p_normalized_payload
     and existing.payload_commitment = p_payload_commitment
  then
    return existing.optimistic_event_id;
  end if;

  raise exception using
    errcode = '23505',
    message = 'optimistic event id or physical identity mismatch';
end
$function$;

create function programmable_private.get_optimistic_promotion_plan_v1(
  p_optimistic_block_id uuid
)
returns table (
  mode text,
  can_promote boolean,
  expected_current_block_id uuid,
  orphan_required boolean,
  requires_rebootstrap boolean,
  target_height_current_block_id uuid,
  chain_tip_block_id uuid,
  chain_tip_block_number bigint,
  segment_start_block_number bigint,
  reorg_generation bigint,
  canonical_status_id uuid,
  orphan_status_id uuid,
  stored_decision_commitment bytea,
  stored_decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  target programmable_private.optimistic_block_observations_v1%rowtype;
  height_pointer programmable_private.optimistic_block_current_canonical_v1%rowtype;
  previous_pointer programmable_private.optimistic_block_current_canonical_v1%rowtype;
  chain_head programmable_private.optimistic_chain_head_current_v1%rowtype;
  canonical_history programmable_private.optimistic_block_status_history_v1%rowtype;
  replay_orphan programmable_private.optimistic_block_status_history_v1%rowtype;
  has_height_pointer boolean;
  has_chain_head boolean;
begin
  perform programmable_private.assert_caller('programmable_projector');

  if p_optimistic_block_id is null then
    raise exception using errcode = '22023', message = 'optimistic block id is required';
  end if;

  select * into target
  from programmable_private.optimistic_block_observations_v1 as block_row
  where block_row.optimistic_block_id = p_optimistic_block_id;
  if not found then
    raise exception using errcode = '23503', message = 'optimistic block is unknown';
  end if;

  select * into chain_head
  from programmable_private.optimistic_chain_head_current_v1 as head
  where head.chain_id = target.chain_id;
  has_chain_head := found;

  select * into height_pointer
  from programmable_private.optimistic_block_current_canonical_v1 as pointer
  where pointer.chain_id = target.chain_id
    and pointer.block_number = target.block_number;
  has_height_pointer := found;

  mode := 'inconsistent-state';
  can_promote := false;
  expected_current_block_id := null;
  orphan_required := false;
  requires_rebootstrap := false;
  target_height_current_block_id := case
    when has_height_pointer then height_pointer.optimistic_block_id
    else null
  end;
  chain_tip_block_id := case
    when has_chain_head then chain_head.optimistic_block_id
    else null
  end;
  chain_tip_block_number := case
    when has_chain_head then chain_head.block_number::bigint
    else null
  end;
  segment_start_block_number := case
    when has_chain_head then chain_head.segment_start_block_number::bigint
    else null
  end;
  reorg_generation := case
    when has_chain_head then chain_head.reorg_generation
    else null
  end;
  canonical_status_id := null;
  orphan_status_id := null;
  stored_decision_commitment := null;
  stored_decided_at := null;

  if not has_chain_head then
    if has_height_pointer then
      requires_rebootstrap := true;
    else
      mode := 'bootstrap';
      can_promote := true;
    end if;
    return next;
    return;
  end if;

  if target.block_number < chain_head.segment_start_block_number then
    mode := 'outside-segment';
    requires_rebootstrap := true;
    return next;
    return;
  end if;

  if target.block_number > chain_head.block_number + 1 then
    mode := 'gap';
    return next;
    return;
  end if;

  if target.block_number = chain_head.block_number + 1 then
    if target.parent_hash <> chain_head.block_hash then
      mode := 'parent-mismatch';
      return next;
      return;
    end if;

    can_promote := true;
    if has_height_pointer then
      expected_current_block_id := height_pointer.optimistic_block_id;
      if height_pointer.optimistic_block_id = target.optimistic_block_id then
        mode := 'extend-existing';
      else
        mode := 'replace-stale-child';
        orphan_required := true;
      end if;
    else
      mode := 'extend';
      expected_current_block_id := chain_head.optimistic_block_id;
    end if;
    return next;
    return;
  end if;

  if not has_height_pointer then
    requires_rebootstrap := true;
    return next;
    return;
  end if;

  if height_pointer.optimistic_block_id = target.optimistic_block_id then
    if chain_head.optimistic_block_id <> target.optimistic_block_id then
      mode := 'already-canonical-below-tip';
      return next;
      return;
    end if;

    -- Recover the exact expected-current shape for a retry after a successful
    -- decision. Replacement decisions have one matching orphan row; initial
    -- bootstrap has neither; a normal extension expects the previous height.
    select * into canonical_history
    from programmable_private.optimistic_block_status_history_v1 as history
    where history.status_id = chain_head.status_id;

    select * into replay_orphan
    from programmable_private.optimistic_block_status_history_v1 as history
    where history.status = 'orphaned'
      and history.reorg_generation = chain_head.reorg_generation
      and history.replaced_by_block_id = target.optimistic_block_id
      and history.decision_commitment = canonical_history.decision_commitment
      and history.decided_at = canonical_history.decided_at
    order by history.status_id
    limit 1;

    mode := 'replay';
    can_promote := true;
    canonical_status_id := canonical_history.status_id;
    stored_decision_commitment := canonical_history.decision_commitment;
    stored_decided_at := canonical_history.decided_at;
    if found then
      expected_current_block_id := replay_orphan.optimistic_block_id;
      orphan_required := true;
      orphan_status_id := replay_orphan.status_id;
    elsif target.block_number = chain_head.segment_start_block_number
          and chain_head.reorg_generation = 0
    then
      expected_current_block_id := null;
    else
      select * into previous_pointer
      from programmable_private.optimistic_block_current_canonical_v1 as pointer
      where pointer.chain_id = target.chain_id
        and pointer.block_number = target.block_number - 1;
      if not found or previous_pointer.block_hash <> target.parent_hash then
        mode := 'inconsistent-state';
        can_promote := false;
        requires_rebootstrap := true;
      else
        expected_current_block_id := previous_pointer.optimistic_block_id;
      end if;
    end if;
    return next;
    return;
  end if;

  if target.block_number > chain_head.segment_start_block_number then
    select * into previous_pointer
    from programmable_private.optimistic_block_current_canonical_v1 as pointer
    where pointer.chain_id = target.chain_id
      and pointer.block_number = target.block_number - 1;
    if not found or previous_pointer.block_hash <> target.parent_hash then
      mode := 'parent-continuity-failure';
      return next;
      return;
    end if;
  end if;

  mode := 'replace';
  can_promote := true;
  expected_current_block_id := height_pointer.optimistic_block_id;
  orphan_required := true;
  return next;
end
$function$;

comment on function programmable_private.get_optimistic_promotion_plan_v1(uuid) is
  'Projector-only fail-closed plan for promote_optimistic_block_canonical_v1. The promote call rechecks all state under its advisory lock. outside-segment requires a controlled segment rebootstrap.';

create function programmable_private.promote_optimistic_block_canonical_v1(
  p_optimistic_block_id uuid,
  p_expected_current_block_id uuid,
  p_canonical_status_id uuid,
  p_orphan_status_id uuid,
  p_decision_commitment bytea,
  p_decided_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  target programmable_private.optimistic_block_observations_v1%rowtype;
  height_pointer programmable_private.optimistic_block_current_canonical_v1%rowtype;
  previous_pointer programmable_private.optimistic_block_current_canonical_v1%rowtype;
  chain_head programmable_private.optimistic_chain_head_current_v1%rowtype;
  canonical_history programmable_private.optimistic_block_status_history_v1%rowtype;
  orphan_history programmable_private.optimistic_block_status_history_v1%rowtype;
  next_generation bigint;
  has_height_pointer boolean;
  has_chain_head boolean;
begin
  perform programmable_private.assert_caller('programmable_projector');

  if p_optimistic_block_id is null
     or p_canonical_status_id is null
     or p_canonical_status_id = p_orphan_status_id
     or p_decision_commitment is null
     or pg_catalog.octet_length(p_decision_commitment) <> 32
     or p_decided_at is null
     or not pg_catalog.isfinite(p_decided_at)
     or p_decided_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid optimistic canonical decision';
  end if;

  select * into target
  from programmable_private.optimistic_block_observations_v1
  where optimistic_block_id = p_optimistic_block_id;
  if not found then
    raise exception using errcode = '23503', message = 'optimistic block is unknown';
  end if;

  -- Canonical decisions are rare and correctness-sensitive. A single DB lock
  -- gives exact replay and reorg behavior across distributed projectors.
  perform pg_catalog.pg_advisory_xact_lock(1347571540, 1);

  select * into chain_head
  from programmable_private.optimistic_chain_head_current_v1
  where chain_id = target.chain_id
  for update;
  has_chain_head := found;

  select * into height_pointer
  from programmable_private.optimistic_block_current_canonical_v1
  where chain_id = target.chain_id
    and block_number = target.block_number
  for update;
  has_height_pointer := found;

  -- Repeating the exact decision that produced the current chain tip is a
  -- no-op. The caller must replay the same canonical row and, for a
  -- replacement, the exact orphan row as well.
  if has_chain_head
     and has_height_pointer
     and chain_head.optimistic_block_id = target.optimistic_block_id
     and height_pointer.optimistic_block_id = target.optimistic_block_id
  then
    select * into canonical_history
    from programmable_private.optimistic_block_status_history_v1
    where status_id = p_canonical_status_id;

    if not found
       or canonical_history.optimistic_block_id <> target.optimistic_block_id
       or canonical_history.status <> 'canonical'
       or canonical_history.reorg_generation <> chain_head.reorg_generation
       or canonical_history.replaced_by_block_id is not null
       or canonical_history.decision_commitment <> p_decision_commitment
       or height_pointer.status_id <> p_canonical_status_id
       or chain_head.status_id <> p_canonical_status_id
    then
      raise exception using
        errcode = '23505',
        message = 'optimistic canonical replay mismatch';
    end if;

    if p_expected_current_block_id is null then
      if p_orphan_status_id is not null
         or chain_head.reorg_generation <> 0
         or chain_head.segment_start_block_number <> target.block_number
      then
        raise exception using
          errcode = '23505',
          message = 'optimistic canonical replay mismatch';
      end if;
    elsif p_orphan_status_id is not null then
      select * into orphan_history
      from programmable_private.optimistic_block_status_history_v1
      where status_id = p_orphan_status_id;
      if not found
         or orphan_history.optimistic_block_id <> p_expected_current_block_id
         or orphan_history.status <> 'orphaned'
         or orphan_history.reorg_generation <> chain_head.reorg_generation
         or orphan_history.replaced_by_block_id <> target.optimistic_block_id
         or orphan_history.decision_commitment <> p_decision_commitment
      then
        raise exception using
          errcode = '23505',
          message = 'optimistic reorg replay mismatch';
      end if;
    else
      select * into previous_pointer
      from programmable_private.optimistic_block_current_canonical_v1
      where chain_id = target.chain_id
        and block_number = target.block_number - 1;
      if not found
         or previous_pointer.optimistic_block_id <>
              p_expected_current_block_id
         or previous_pointer.block_hash <> target.parent_hash
      then
        raise exception using
          errcode = '23505',
          message = 'optimistic extension replay mismatch';
      end if;
    end if;

    return target.optimistic_block_id;
  end if;

  if not has_chain_head then
    if has_height_pointer
       or p_expected_current_block_id is not null
       or p_orphan_status_id is not null
    then
      raise exception using
        errcode = '40001',
        message = 'optimistic canonical expectation mismatch';
    end if;

    insert into programmable_private.optimistic_block_status_history_v1 (
      status_id,
      optimistic_block_id,
      chain_id,
      block_number,
      block_hash,
      status,
      reorg_generation,
      replaced_by_block_id,
      decision_commitment,
      decided_at
    ) values (
      p_canonical_status_id,
      target.optimistic_block_id,
      target.chain_id,
      target.block_number,
      target.block_hash,
      'canonical',
      0,
      null,
      p_decision_commitment,
      p_decided_at
    );

    insert into programmable_private.optimistic_block_current_canonical_v1 (
      chain_id,
      block_number,
      optimistic_block_id,
      block_hash,
      reorg_generation,
      status_id,
      updated_at
    ) values (
      target.chain_id,
      target.block_number,
      target.optimistic_block_id,
      target.block_hash,
      0,
      p_canonical_status_id,
      p_decided_at
    );

    insert into programmable_private.optimistic_chain_head_current_v1 (
      chain_id,
      segment_start_block_number,
      optimistic_block_id,
      block_number,
      block_hash,
      parent_hash,
      reorg_generation,
      status_id,
      updated_at
    ) values (
      target.chain_id,
      target.block_number,
      target.optimistic_block_id,
      target.block_number,
      target.block_hash,
      target.parent_hash,
      0,
      p_canonical_status_id,
      p_decided_at
    );

    return target.optimistic_block_id;
  end if;

  if target.block_number < chain_head.segment_start_block_number
     or target.block_number > chain_head.block_number + 1
  then
    raise exception using
      errcode = '40001',
      message = 'optimistic block is outside the contiguous live segment';
  end if;

  if target.block_number = chain_head.block_number + 1 then
    -- Extending the live chain is legal only when both RPCs persisted the
    -- exact parent hash of the current single-chain tip.
    if target.parent_hash <> chain_head.block_hash then
      raise exception using
        errcode = '40001',
        message = 'optimistic block does not extend the current chain tip';
    end if;

    next_generation := chain_head.reorg_generation;

    if has_height_pointer then
      -- The height is above the reset tip but retains a stale pointer from the
      -- previous fork. Replaying this height replaces and orphans that stale
      -- descendant without incrementing the already-advanced generation.
      if height_pointer.optimistic_block_id = target.optimistic_block_id then
        if p_expected_current_block_id is distinct from target.optimistic_block_id
           or p_orphan_status_id is not null
        then
          raise exception using
            errcode = '40001',
            message = 'optimistic child expectation mismatch';
        end if;
      else
        if p_expected_current_block_id is distinct from
             height_pointer.optimistic_block_id
           or p_orphan_status_id is null
        then
          raise exception using
            errcode = '40001',
            message = 'optimistic child expectation mismatch';
        end if;

        insert into programmable_private.optimistic_block_status_history_v1 (
          status_id,
          optimistic_block_id,
          chain_id,
          block_number,
          block_hash,
          status,
          reorg_generation,
          replaced_by_block_id,
          decision_commitment,
          decided_at
        ) values (
          p_orphan_status_id,
          height_pointer.optimistic_block_id,
          height_pointer.chain_id,
          height_pointer.block_number,
          height_pointer.block_hash,
          'orphaned',
          next_generation,
          target.optimistic_block_id,
          p_decision_commitment,
          p_decided_at
        );
      end if;
    elsif p_expected_current_block_id is distinct from chain_head.optimistic_block_id
          or p_orphan_status_id is not null
    then
      raise exception using
        errcode = '40001',
        message = 'optimistic child expectation mismatch';
    end if;
  else
    -- Replacing the current tip or any ancestor resets the visible chain tip
    -- to this height. Higher pointers remain immutable evidence but are
    -- outside the live bound until matching children are replayed.
    if not has_height_pointer
       or height_pointer.optimistic_block_id = target.optimistic_block_id
       or p_expected_current_block_id is distinct from
            height_pointer.optimistic_block_id
       or p_orphan_status_id is null
    then
      raise exception using
        errcode = '40001',
        message = 'optimistic canonical expectation mismatch';
    end if;

    if target.block_number > chain_head.segment_start_block_number then
      select * into previous_pointer
      from programmable_private.optimistic_block_current_canonical_v1
      where chain_id = target.chain_id
        and block_number = target.block_number - 1;
      if not found or previous_pointer.block_hash <> target.parent_hash then
        raise exception using
          errcode = '40001',
          message = 'optimistic replacement breaks parent continuity';
      end if;
    end if;

    next_generation := chain_head.reorg_generation + 1;

    insert into programmable_private.optimistic_block_status_history_v1 (
      status_id,
      optimistic_block_id,
      chain_id,
      block_number,
      block_hash,
      status,
      reorg_generation,
      replaced_by_block_id,
      decision_commitment,
      decided_at
    ) values (
      p_orphan_status_id,
      height_pointer.optimistic_block_id,
      height_pointer.chain_id,
      height_pointer.block_number,
      height_pointer.block_hash,
      'orphaned',
      next_generation,
      target.optimistic_block_id,
      p_decision_commitment,
      p_decided_at
    );
  end if;

  insert into programmable_private.optimistic_block_status_history_v1 (
    status_id,
    optimistic_block_id,
    chain_id,
    block_number,
    block_hash,
    status,
    reorg_generation,
    replaced_by_block_id,
    decision_commitment,
    decided_at
  ) values (
    p_canonical_status_id,
    target.optimistic_block_id,
    target.chain_id,
    target.block_number,
    target.block_hash,
    'canonical',
    next_generation,
    null,
    p_decision_commitment,
    p_decided_at
  );

  if has_height_pointer then
    update programmable_private.optimistic_block_current_canonical_v1
    set optimistic_block_id = target.optimistic_block_id,
        block_hash = target.block_hash,
        reorg_generation = next_generation,
        status_id = p_canonical_status_id,
        updated_at = p_decided_at
    where chain_id = target.chain_id
      and block_number = target.block_number;
  else
    insert into programmable_private.optimistic_block_current_canonical_v1 (
      chain_id,
      block_number,
      optimistic_block_id,
      block_hash,
      reorg_generation,
      status_id,
      updated_at
    ) values (
      target.chain_id,
      target.block_number,
      target.optimistic_block_id,
      target.block_hash,
      next_generation,
      p_canonical_status_id,
      p_decided_at
    );
  end if;

  update programmable_private.optimistic_chain_head_current_v1
  set optimistic_block_id = target.optimistic_block_id,
      block_number = target.block_number,
      block_hash = target.block_hash,
      parent_hash = target.parent_hash,
      reorg_generation = next_generation,
      status_id = p_canonical_status_id,
      updated_at = p_decided_at
  where chain_id = target.chain_id;

  return target.optimistic_block_id;
end
$function$;

create function programmable_private.get_optimistic_live_head_v1(
  p_chain_id bigint
)
returns table (
  optimistic_block_id uuid,
  chain_id bigint,
  block_number bigint,
  block_hash bytea,
  parent_hash bytea,
  block_timestamp timestamptz,
  provider_a_id uuid,
  provider_b_id uuid,
  provider_a_head bigint,
  provider_b_head bigint,
  reorg_generation bigint,
  status text,
  observed_at timestamptz,
  canonical_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id is null or p_chain_id <= 0 then
    raise exception using errcode = '22023', message = 'invalid chain id';
  end if;

  return query
  select
    block_row.optimistic_block_id,
    block_row.chain_id::bigint,
    block_row.block_number::bigint,
    block_row.block_hash::bytea,
    block_row.parent_hash::bytea,
    block_row.block_timestamp,
    block_row.provider_a_id,
    block_row.provider_b_id,
    block_row.provider_a_head::bigint,
    block_row.provider_b_head::bigint,
    current_pointer.reorg_generation,
    'canonical'::text,
    block_row.observed_at,
    current_pointer.updated_at
  from programmable_private.optimistic_chain_head_current_v1 as current_pointer
  join programmable_private.optimistic_block_observations_v1 as block_row
    on block_row.optimistic_block_id = current_pointer.optimistic_block_id
  where current_pointer.chain_id = p_chain_id
  limit 1;
end
$function$;

create function programmable_private.list_optimistic_canonical_events_v1(
  p_chain_id bigint,
  p_after_block_number bigint,
  p_after_block_global_log_index bigint,
  p_after_optimistic_event_id uuid,
  p_limit integer
)
returns table (
  optimistic_event_id uuid,
  optimistic_block_id uuid,
  chain_id bigint,
  block_number bigint,
  block_hash bytea,
  transaction_hash bytea,
  transaction_index bigint,
  block_global_log_index bigint,
  source_address bytea,
  event_signature bytea,
  ordered_topics bytea[],
  raw_data bytea,
  normalized_payload jsonb,
  payload_commitment bytea,
  reorg_generation bigint,
  observed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  live_head programmable_private.optimistic_chain_head_current_v1%rowtype;
  window_start_block_number bigint;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id is null
     or p_chain_id <= 0
     or p_limit is null
     or p_limit < 1
     or p_limit > 500
     or (
       (p_after_block_number is null)
       <> (p_after_block_global_log_index is null)
     )
     or (
       (p_after_block_number is null)
       <> (p_after_optimistic_event_id is null)
     )
     or p_after_block_number < 0
     or p_after_block_global_log_index < 0
     or p_after_block_global_log_index > 4294967295
  then
    raise exception using errcode = '22023', message = 'invalid optimistic event cursor';
  end if;

  select * into live_head
  from programmable_private.optimistic_chain_head_current_v1 as head
  where head.chain_id = p_chain_id;
  if not found then
    if p_after_block_number is not null then
      raise exception using
        errcode = '40001',
        message = 'optimistic event cursor is outside the live window';
    end if;
    return;
  end if;

  window_start_block_number := greatest(
    live_head.segment_start_block_number,
    live_head.block_number - 11
  );
  if p_after_block_number is not null
     and (
       p_after_block_number < window_start_block_number
       or p_after_block_number > live_head.block_number
     )
  then
    raise exception using
      errcode = '40001',
      message = 'optimistic event cursor is outside the live window';
  end if;

  return query
  with recursive live_chain as (
    select
      head.chain_id,
      greatest(
        head.segment_start_block_number,
        head.block_number - 11
      ) as window_start_block_number,
      block_row.optimistic_block_id,
      block_row.block_number,
      block_row.block_hash,
      block_row.parent_hash,
      head.reorg_generation
    from programmable_private.optimistic_chain_head_current_v1 as head
    join programmable_private.optimistic_block_observations_v1 as block_row
      on block_row.optimistic_block_id = head.optimistic_block_id
    where head.chain_id = p_chain_id

    union all

    select
      parent_pointer.chain_id,
      live_chain.window_start_block_number,
      parent_block.optimistic_block_id,
      parent_block.block_number,
      parent_block.block_hash,
      parent_block.parent_hash,
      live_chain.reorg_generation
    from live_chain
    join programmable_private.optimistic_block_current_canonical_v1
      as parent_pointer
      on parent_pointer.chain_id = live_chain.chain_id
     and parent_pointer.block_number = live_chain.block_number - 1
    join programmable_private.optimistic_block_observations_v1 as parent_block
      on parent_block.optimistic_block_id =
           parent_pointer.optimistic_block_id
     and parent_block.block_hash = live_chain.parent_hash
    where live_chain.block_number > live_chain.window_start_block_number
  )
  select
    event_row.optimistic_event_id,
    event_row.optimistic_block_id,
    event_row.chain_id::bigint,
    event_row.block_number::bigint,
    event_row.block_hash::bytea,
    event_row.transaction_hash::bytea,
    event_row.transaction_index::bigint,
    event_row.block_global_log_index::bigint,
    event_row.source_address::bytea,
    event_row.event_signature::bytea,
    event_row.ordered_topics,
    event_row.raw_data,
    event_row.normalized_payload,
    event_row.payload_commitment::bytea,
    live_chain.reorg_generation,
    event_row.observed_at
  from programmable_private.optimistic_event_rows_v1 as event_row
  join live_chain
    on live_chain.chain_id = event_row.chain_id
   and live_chain.block_number = event_row.block_number
   and live_chain.optimistic_block_id = event_row.optimistic_block_id
  where event_row.chain_id = p_chain_id
    and (
      p_after_block_number is null
      or (
        event_row.block_number::bigint,
        event_row.block_global_log_index::bigint,
        event_row.optimistic_event_id
      ) > (
        p_after_block_number,
        p_after_block_global_log_index,
        p_after_optimistic_event_id
      )
    )
  order by
    event_row.block_number,
    event_row.block_global_log_index,
    event_row.optimistic_event_id
  limit p_limit;
end
$function$;

comment on function programmable_private.list_optimistic_canonical_events_v1(
  bigint, bigint, bigint, uuid, integer
) is
  'Returns only the contiguous current chain from max(segment start, head - 11) through head. Cursors outside that 12-height live window fail with SQLSTATE 40001.';

create function programmable_private.list_optimistic_canonical_market_states_v1(
  p_chain_id bigint,
  p_after_block_number bigint,
  p_after_pool_id bytea,
  p_after_optimistic_market_state_id uuid,
  p_limit integer
)
returns table (
  optimistic_market_state_id uuid,
  optimistic_block_id uuid,
  version text,
  finality text,
  chain_id bigint,
  block_number bigint,
  block_hash bytea,
  confirmations smallint,
  pool_id bytea,
  token_address bytea,
  state_view_address bytea,
  state_view_runtime_code_hash bytea,
  sqrt_price_x96 numeric,
  current_tick integer,
  active_liquidity numeric,
  protocol_fee_pips integer,
  lp_fee_pips integer,
  slot0_result bytea,
  liquidity_result bytea,
  market jsonb,
  market_commitment bytea,
  evidence_commitment bytea,
  provider_a_id uuid,
  provider_b_id uuid,
  provider_a_identity text,
  provider_b_identity text,
  provider_a_vendor text,
  provider_b_vendor text,
  provider_a_endpoint_commitment bytea,
  provider_b_endpoint_commitment bytea,
  provider_a_origin_commitment bytea,
  provider_b_origin_commitment bytea,
  market_provider_a_head bigint,
  market_provider_b_head bigint,
  block_provider_call_count_a smallint,
  block_provider_call_count_b smallint,
  market_provider_call_count_a smallint,
  market_provider_call_count_b smallint,
  total_provider_call_count_a smallint,
  total_provider_call_count_b smallint,
  reorg_generation bigint,
  observed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  live_head programmable_private.optimistic_chain_head_current_v1%rowtype;
  window_start_block_number bigint;
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id is null
     or p_chain_id <= 0
     or p_limit is null
     or p_limit < 1
     or p_limit > 100
     or (
       (p_after_block_number is null) <> (p_after_pool_id is null)
     )
     or (
       (p_after_block_number is null)
       <> (p_after_optimistic_market_state_id is null)
     )
     or p_after_block_number < 0
     or (
       p_after_pool_id is not null
       and pg_catalog.octet_length(p_after_pool_id) <> 32
     )
  then
    raise exception using
      errcode = '22023',
      message = 'invalid optimistic market-state cursor';
  end if;

  select * into live_head
  from programmable_private.optimistic_chain_head_current_v1 as head
  where head.chain_id = p_chain_id;
  if not found then
    if p_after_block_number is not null then
      raise exception using
        errcode = '40001',
        message = 'optimistic market-state cursor is outside the live window';
    end if;
    return;
  end if;

  window_start_block_number := greatest(
    live_head.segment_start_block_number,
    live_head.block_number - 11
  );
  if p_after_block_number is not null
     and (
       p_after_block_number < window_start_block_number
       or p_after_block_number > live_head.block_number
     )
  then
    raise exception using
      errcode = '40001',
      message = 'optimistic market-state cursor is outside the live window';
  end if;

  return query
  with recursive live_chain as (
    select
      head.chain_id,
      greatest(
        head.segment_start_block_number,
        head.block_number - 11
      ) as window_start_block_number,
      block_row.optimistic_block_id,
      block_row.block_number,
      block_row.block_hash,
      block_row.parent_hash,
      head.reorg_generation
    from programmable_private.optimistic_chain_head_current_v1 as head
    join programmable_private.optimistic_block_observations_v1 as block_row
      on block_row.optimistic_block_id = head.optimistic_block_id
    where head.chain_id = p_chain_id

    union all

    select
      parent_pointer.chain_id,
      live_chain.window_start_block_number,
      parent_block.optimistic_block_id,
      parent_block.block_number,
      parent_block.block_hash,
      parent_block.parent_hash,
      live_chain.reorg_generation
    from live_chain
    join programmable_private.optimistic_block_current_canonical_v1
      as parent_pointer
      on parent_pointer.chain_id = live_chain.chain_id
     and parent_pointer.block_number = live_chain.block_number - 1
    join programmable_private.optimistic_block_observations_v1 as parent_block
      on parent_block.optimistic_block_id =
           parent_pointer.optimistic_block_id
     and parent_block.block_hash = live_chain.parent_hash
    where live_chain.block_number > live_chain.window_start_block_number
  )
  select
    state_row.optimistic_market_state_id,
    state_row.optimistic_block_id,
    state_row.version::text,
    state_row.finality::text,
    state_row.chain_id::bigint,
    state_row.block_number::bigint,
    state_row.block_hash::bytea,
    state_row.confirmations,
    state_row.pool_id::bytea,
    state_row.token_address::bytea,
    state_row.state_view_address::bytea,
    state_row.state_view_runtime_code_hash::bytea,
    state_row.sqrt_price_x96::numeric,
    state_row.current_tick,
    state_row.active_liquidity::numeric,
    state_row.protocol_fee_pips,
    state_row.lp_fee_pips,
    state_row.slot0_result,
    state_row.liquidity_result,
    state_row.market,
    state_row.market_commitment::bytea,
    state_row.evidence_commitment::bytea,
    state_row.provider_a_id,
    state_row.provider_b_id,
    state_row.provider_a_identity::text,
    state_row.provider_b_identity::text,
    state_row.provider_a_vendor::text,
    state_row.provider_b_vendor::text,
    state_row.provider_a_endpoint_commitment::bytea,
    state_row.provider_b_endpoint_commitment::bytea,
    state_row.provider_a_origin_commitment::bytea,
    state_row.provider_b_origin_commitment::bytea,
    state_row.market_provider_a_head::bigint,
    state_row.market_provider_b_head::bigint,
    state_row.block_provider_call_count_a,
    state_row.block_provider_call_count_b,
    state_row.market_provider_call_count_a,
    state_row.market_provider_call_count_b,
    state_row.total_provider_call_count_a,
    state_row.total_provider_call_count_b,
    live_chain.reorg_generation,
    state_row.observed_at
  from programmable_private.optimistic_market_state_rows_v1 as state_row
  join live_chain
    on live_chain.chain_id = state_row.chain_id
   and live_chain.block_number = state_row.block_number
   and live_chain.optimistic_block_id = state_row.optimistic_block_id
  where state_row.chain_id = p_chain_id
    and (
      p_after_block_number is null
      or (
        state_row.block_number::bigint,
        state_row.pool_id::bytea,
        state_row.optimistic_market_state_id
      ) > (
        p_after_block_number,
        p_after_pool_id,
        p_after_optimistic_market_state_id
      )
    )
  order by
    state_row.block_number,
    state_row.pool_id,
    state_row.optimistic_market_state_id
  limit p_limit;
end
$function$;

comment on function
  programmable_private.list_optimistic_canonical_market_states_v1(
    bigint, bigint, bytea, uuid, integer
  ) is
  'Returns only current-chain market evidence from max(segment start, head - 11) through head, keyset-paged at at most 100 rows. Stale descendants and cursors outside the live window fail closed.';

revoke all on type programmable_private.optimistic_block_status_v1
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login;

revoke all on table
  programmable_private.optimistic_block_observations_v1,
  programmable_private.optimistic_market_state_rows_v1,
  programmable_private.optimistic_event_rows_v1,
  programmable_private.optimistic_block_status_history_v1,
  programmable_private.optimistic_block_current_canonical_v1,
  programmable_private.optimistic_chain_head_current_v1
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login;

revoke all on function
  programmable_private.valid_optimistic_market_json_v1(
    jsonb, bigint, integer, numeric
  ),
  programmable_private.get_optimistic_promotion_plan_v1(uuid),
  programmable_private.append_optimistic_block_observation_v1(
    uuid, bigint, bigint, bytea, bytea, bytea, bytea,
    timestamptz, timestamptz, uuid, uuid, bigint, bigint, bytea, timestamptz
  ),
  programmable_private.append_optimistic_event_row_v1(
    uuid, uuid, bytea, bigint, bigint, bytea, bytea, bytea[], bytea,
    jsonb, bytea, timestamptz
  ),
  programmable_private.append_optimistic_market_state_v1(
    uuid, uuid, bytea, bytea, bytea, bytea, numeric, integer, numeric,
    integer, integer, bytea, bytea, bytea, bytea, jsonb, bytea,
    uuid, uuid, text, text, bytea, bytea, bytea, bytea, bigint, bigint,
    smallint, smallint, smallint, smallint, smallint, smallint, smallint,
    bytea, timestamptz
  ),
  programmable_private.promote_optimistic_block_canonical_v1(
    uuid, uuid, uuid, uuid, bytea, timestamptz
  ),
  programmable_private.get_optimistic_live_head_v1(bigint),
  programmable_private.list_optimistic_canonical_events_v1(
    bigint, bigint, bigint, uuid, integer
  ),
  programmable_private.list_optimistic_canonical_market_states_v1(
    bigint, bigint, bytea, uuid, integer
  )
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login;

grant execute on function
  programmable_private.get_optimistic_promotion_plan_v1(uuid),
  programmable_private.append_optimistic_block_observation_v1(
    uuid, bigint, bigint, bytea, bytea, bytea, bytea,
    timestamptz, timestamptz, uuid, uuid, bigint, bigint, bytea, timestamptz
  ),
  programmable_private.append_optimistic_event_row_v1(
    uuid, uuid, bytea, bigint, bigint, bytea, bytea, bytea[], bytea,
    jsonb, bytea, timestamptz
  ),
  programmable_private.append_optimistic_market_state_v1(
    uuid, uuid, bytea, bytea, bytea, bytea, numeric, integer, numeric,
    integer, integer, bytea, bytea, bytea, bytea, jsonb, bytea,
    uuid, uuid, text, text, bytea, bytea, bytea, bytea, bigint, bigint,
    smallint, smallint, smallint, smallint, smallint, smallint, smallint,
    bytea, timestamptz
  ),
  programmable_private.promote_optimistic_block_canonical_v1(
    uuid, uuid, uuid, uuid, bytea, timestamptz
  )
to programmable_projector;

grant execute on function
  programmable_private.get_optimistic_live_head_v1(bigint),
  programmable_private.list_optimistic_canonical_events_v1(
    bigint, bigint, bigint, uuid, integer
  ),
  programmable_private.list_optimistic_canonical_market_states_v1(
    bigint, bigint, bytea, uuid, integer
  )
to programmable_api_reader;

reset role;
