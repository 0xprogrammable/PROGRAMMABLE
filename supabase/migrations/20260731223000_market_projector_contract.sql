-- Exact control-plane contract for the server-only market projector.
-- Market values remain append-only reconciliation facts. This migration adds
-- only the narrow discovery, anchor-resolution, and CAS cursor surfaces that
-- are required to project them without direct table access or guessed IDs.

set role programmable_migrator;

-- Market evidence is append-only per reconciliation lineage. A source epoch
-- or pointer transition may legitimately observe the same canonical pool fact
-- again. Global ETH/USD snapshots remain singular per epoch, pointer, and
-- canonical block because consumers resolve exactly one snapshot for that
-- context.
alter table programmable_private.global_eth_usd_snapshots
  drop constraint global_eth_usd_snapshots_epoch_id_result_commitment_key,
  add constraint global_eth_usd_snapshots_pointer_result_key
    unique (epoch_id, pointer_generation, result_commitment);

alter table programmable_private.market_snapshots
  drop constraint market_snapshots_chain_id_pool_id_source_deployment_id_bloc_key,
  add constraint market_snapshots_reconciliation_fact_key
    unique (
      chain_id, pool_id, source_deployment_id, block_hash, reconciliation_id
    );

alter table programmable_private.market_candles
  drop constraint market_candles_chain_id_pool_id_interval_period_start_sourc_key,
  add constraint market_candles_reconciliation_fact_key
    unique (
      chain_id, pool_id, interval, period_start, source_block_hash,
      reconciliation_id
    );

alter table programmable_private.market_block_closes
  drop constraint market_block_closes_chain_id_pool_id_block_hash_key,
  drop constraint market_block_closes_epoch_id_close_commitment_key,
  add constraint market_block_closes_reconciliation_block_key
    unique (chain_id, pool_id, block_hash, reconciliation_id),
  add constraint market_block_closes_reconciliation_commitment_key
    unique (epoch_id, close_commitment, reconciliation_id);

-- Pool discovery is event-driven. This index prevents an unrelated release
-- event from turning every launched pool into pending market work.
create index chain_event_materializations_market_pool_idx
  on programmable_private.chain_event_occurrence_materializations (
    chain_id, release_id, model_id, source_group, epoch_id,
    pointer_generation,
    (pg_catalog.lower(decoded_payload ->> 'poolId')),
    occurrence_id
  )
  where event_type in ('NativeSwapFeesAccrued', 'QuoteSwapFeesAccrued');

create function programmable_private.is_market_fee_event_v1(
  p_model_id text,
  p_event_type text
)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $function$
  select case p_model_id
    when 'classic' then p_event_type = 'NativeSwapFeesAccrued'
    when 'stock-paired' then p_event_type = 'QuoteSwapFeesAccrued'
    else false
  end
$function$;

create table programmable_private.market_projector_runtime_lease_current (
  singleton_key text primary key
    check (singleton_key = 'canonical-market-projector-runtime-v1'),
  lease_generation bigint not null default 0
    check (lease_generation >= 0),
  holder_id text,
  lease_token_hash programmable_private.bytes32_value,
  acquired_at timestamptz,
  expires_at timestamptz,
  released_at timestamptz,
  acquisition_commitment programmable_private.bytes32_value,
  release_commitment programmable_private.bytes32_value,
  changed_by_audit_id uuid
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (
    (
      lease_generation = 0
      and holder_id is null
      and lease_token_hash is null
      and acquired_at is null
      and expires_at is null
      and released_at is null
      and acquisition_commitment is null
      and release_commitment is null
      and changed_by_audit_id is null
    )
    or
    (
      lease_generation > 0
      and holder_id is not null
      and pg_catalog.octet_length(holder_id) between 1 and 128
      and holder_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
      and lease_token_hash is not null
      and acquired_at is not null
      and expires_at is not null
      and expires_at > acquired_at
      and expires_at <= acquired_at + interval '90 seconds'
      and acquisition_commitment is not null
      and changed_by_audit_id is not null
      and lease_token_hash <>
        pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
      and acquisition_commitment <>
        pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
      and (
        (released_at is null and release_commitment is null)
        or (
          released_at is not null
          and released_at >= acquired_at
          and release_commitment is not null
          and release_commitment <>
            pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
        )
      )
    )
  )
);

create table programmable_private.market_projector_runtime_lease_history (
  lease_history_id uuid primary key,
  singleton_key text not null
    check (singleton_key = 'canonical-market-projector-runtime-v1'),
  event_kind text not null check (event_kind in ('acquired', 'released')),
  lease_generation bigint not null check (lease_generation > 0),
  holder_id programmable_private.source_identifier not null,
  lease_token_hash programmable_private.bytes32_value not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  event_at timestamptz not null,
  input_commitment programmable_private.bytes32_value not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (expires_at > acquired_at),
  check (expires_at <= acquired_at + interval '90 seconds'),
  check (event_at >= acquired_at),
  unique (singleton_key, lease_generation, event_kind),
  unique (audit_id)
);

insert into programmable_private.market_projector_runtime_lease_current (
  singleton_key
) values ('canonical-market-projector-runtime-v1');

create table programmable_private.market_projector_cursor_history (
  market_cursor_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  projector_version programmable_private.projector_identifier not null,
  pool_id programmable_private.bytes32_value not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  cursor_generation bigint not null check (cursor_generation > 0),
  reorg_generation bigint not null check (reorg_generation >= 0),
  source_checkpoint_id uuid not null
    references programmable_private.projector_checkpoints(checkpoint_id)
    on delete restrict,
  source_checkpoint_generation bigint not null
    check (source_checkpoint_generation > 0),
  source_reorg_generation bigint not null
    check (source_reorg_generation >= 0),
  block_evidence_id uuid not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  provider_cursor text not null,
  hour_coverage_end timestamptz,
  day_coverage_end timestamptz,
  page_commitment programmable_private.bytes32_value not null,
  reconciliation_id uuid not null
    references programmable_private.reconciliation_records(reconciliation_id)
    on delete restrict,
  advanced_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (epoch_id, chain_id, release_id, model_id, source_group)
    references programmable_private.release_epochs(
      epoch_id, chain_id, release_id, model_id, source_group
    ) on delete restrict,
  foreign key (block_evidence_id, block_hash)
    references programmable_private.dual_rpc_block_evidence(
      block_evidence_id, agreed_block_hash
    ) on delete restrict,
  check (
    pg_catalog.octet_length(provider_cursor) between 1 and 256
    and provider_cursor ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]*$'
  ),
  check (
    page_commitment <>
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  ),
  check (
    hour_coverage_end is null
    or hour_coverage_end = pg_catalog.date_trunc('hour', hour_coverage_end)
  ),
  check (
    day_coverage_end is null
    or day_coverage_end = pg_catalog.date_trunc('day', day_coverage_end)
  ),
  unique (
    chain_id, release_id, model_id, source_group, projector_version,
    pool_id, cursor_generation
  ),
  unique (epoch_id, pool_id, page_commitment)
);

create table programmable_private.market_projector_cursor_current (
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  projector_version programmable_private.projector_identifier not null,
  pool_id programmable_private.bytes32_value not null,
  market_cursor_id uuid not null unique
    references programmable_private.market_projector_cursor_history(
      market_cursor_id
    ) on delete restrict,
  cursor_generation bigint not null check (cursor_generation > 0),
  reorg_generation bigint not null check (reorg_generation >= 0),
  changed_at timestamptz not null,
  changed_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  primary key (
    chain_id, release_id, model_id, source_group, projector_version, pool_id
  )
);

create table programmable_private.market_snapshot_lineage_memberships (
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  projector_version programmable_private.projector_identifier not null,
  pool_id programmable_private.bytes32_value not null,
  reorg_generation bigint not null check (reorg_generation >= 0),
  market_snapshot_id uuid not null
    references programmable_private.market_snapshots(market_snapshot_id)
    on delete restrict,
  attached_reconciliation_id uuid not null
    references programmable_private.reconciliation_records(reconciliation_id)
    on delete restrict,
  attached_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  primary key (
    chain_id, release_id, model_id, source_group, projector_version,
    pool_id, reorg_generation, market_snapshot_id
  )
);

create table programmable_private.market_candle_lineage_memberships (
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  projector_version programmable_private.projector_identifier not null,
  pool_id programmable_private.bytes32_value not null,
  reorg_generation bigint not null check (reorg_generation >= 0),
  market_candle_id uuid not null
    references programmable_private.market_candles(market_candle_id)
    on delete restrict,
  attached_reconciliation_id uuid not null
    references programmable_private.reconciliation_records(reconciliation_id)
    on delete restrict,
  attached_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  primary key (
    chain_id, release_id, model_id, source_group, projector_version,
    pool_id, reorg_generation, market_candle_id
  )
);

alter table programmable_private.market_projector_cursor_history
  enable row level security;
alter table programmable_private.market_projector_cursor_history
  force row level security;
create policy market_projector_cursor_history_migrator_all
  on programmable_private.market_projector_cursor_history
  for all to programmable_migrator using (true) with check (true);

alter table programmable_private.market_projector_cursor_current
  enable row level security;
alter table programmable_private.market_projector_cursor_current
  force row level security;
create policy market_projector_cursor_current_migrator_all
  on programmable_private.market_projector_cursor_current
  for all to programmable_migrator using (true) with check (true);

alter table programmable_private.market_snapshot_lineage_memberships
  enable row level security;
alter table programmable_private.market_snapshot_lineage_memberships
  force row level security;
create policy market_snapshot_lineage_memberships_migrator_all
  on programmable_private.market_snapshot_lineage_memberships
  for all to programmable_migrator using (true) with check (true);

alter table programmable_private.market_candle_lineage_memberships
  enable row level security;
alter table programmable_private.market_candle_lineage_memberships
  force row level security;
create policy market_candle_lineage_memberships_migrator_all
  on programmable_private.market_candle_lineage_memberships
  for all to programmable_migrator using (true) with check (true);

alter table programmable_private.market_projector_runtime_lease_current
  enable row level security;
alter table programmable_private.market_projector_runtime_lease_current
  force row level security;
create policy market_projector_runtime_lease_current_migrator_all
  on programmable_private.market_projector_runtime_lease_current
  for all to programmable_migrator using (true) with check (true);

alter table programmable_private.market_projector_runtime_lease_history
  enable row level security;
alter table programmable_private.market_projector_runtime_lease_history
  force row level security;
create policy market_projector_runtime_lease_history_migrator_all
  on programmable_private.market_projector_runtime_lease_history
  for all to programmable_migrator using (true) with check (true);

create trigger reject_immutable_mutation
before update or delete
on programmable_private.market_projector_runtime_lease_history
for each row execute function programmable_private.reject_immutable_mutation();

create function
  programmable_private.try_acquire_market_projector_runtime_lease_v1(
    p_holder_id text,
    p_lease_token_hash bytea,
    p_acquired_at timestamptz,
    p_expires_at timestamptz,
    p_input_commitment bytea
  )
returns table (
  acquired boolean,
  lease_generation bigint,
  acquired_at timestamptz,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  current_lease
    programmable_private.market_projector_runtime_lease_current%rowtype;
  server_now timestamptz := pg_catalog.clock_timestamp();
  requested_ttl interval := p_expires_at - p_acquired_at;
  next_generation bigint;
  server_expires_at timestamptz;
  acquisition_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_holder_id is null
     or pg_catalog.octet_length(p_holder_id) not between 1 and 128
     or p_holder_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or p_lease_token_hash is null
     or pg_catalog.octet_length(p_lease_token_hash) <> 32
     or p_lease_token_hash =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_input_commitment is null
     or pg_catalog.octet_length(p_input_commitment) <> 32
     or p_input_commitment =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_acquired_at is null
     or p_expires_at is null
     or requested_ttl <= interval '0 seconds'
     or requested_ttl > interval '90 seconds'
     or p_acquired_at < server_now - interval '30 seconds'
     or p_acquired_at > server_now + interval '30 seconds'
  then
    raise exception using errcode = '22023',
      message = 'invalid market projector lease acquisition';
  end if;

  select lease.* into strict current_lease
  from programmable_private.market_projector_runtime_lease_current as lease
  where lease.singleton_key = 'canonical-market-projector-runtime-v1'
  for update;
  if current_lease.lease_generation > 0
     and current_lease.released_at is null
     and current_lease.expires_at > server_now
  then
    acquired := false;
    lease_generation := current_lease.lease_generation;
    acquired_at := current_lease.acquired_at;
    expires_at := current_lease.expires_at;
    return next;
    return;
  end if;

  next_generation := current_lease.lease_generation + 1;
  server_expires_at := server_now + requested_ttl;
  acquisition_audit_id := programmable_private.append_mutation_audit(
    'market_projector_runtime_lease.acquire', p_input_commitment,
    null, server_now
  );
  update programmable_private.market_projector_runtime_lease_current as lease
  set lease_generation = next_generation,
      holder_id = p_holder_id::programmable_private.source_identifier,
      lease_token_hash =
        p_lease_token_hash::programmable_private.bytes32_value,
      acquired_at = server_now,
      expires_at = server_expires_at,
      released_at = null,
      acquisition_commitment =
        p_input_commitment::programmable_private.bytes32_value,
      release_commitment = null,
      changed_by_audit_id = acquisition_audit_id
  where lease.singleton_key = 'canonical-market-projector-runtime-v1';
  insert into programmable_private.market_projector_runtime_lease_history (
    lease_history_id, singleton_key, event_kind, lease_generation,
    holder_id, lease_token_hash, acquired_at, expires_at, event_at,
    input_commitment, audit_id
  ) values (
    pg_catalog.gen_random_uuid(), 'canonical-market-projector-runtime-v1',
    'acquired', next_generation,
    p_holder_id::programmable_private.source_identifier,
    p_lease_token_hash::programmable_private.bytes32_value,
    server_now, server_expires_at, server_now,
    p_input_commitment::programmable_private.bytes32_value,
    acquisition_audit_id
  );
  acquired := true;
  lease_generation := next_generation;
  acquired_at := server_now;
  expires_at := server_expires_at;
  return next;
end
$function$;

create function programmable_private.assert_market_projector_runtime_lease_v1(
  p_holder_id text,
  p_lease_generation bigint,
  p_lease_token_hash bytea
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  current_lease
    programmable_private.market_projector_runtime_lease_current%rowtype;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select lease.* into strict current_lease
  from programmable_private.market_projector_runtime_lease_current as lease
  where lease.singleton_key = 'canonical-market-projector-runtime-v1'
  for update;
  return p_holder_id is not null
    and p_lease_generation is not null
    and p_lease_token_hash is not null
    and current_lease.lease_generation = p_lease_generation
    and current_lease.holder_id = p_holder_id
    and current_lease.lease_token_hash = p_lease_token_hash
    and current_lease.released_at is null
    and current_lease.expires_at > pg_catalog.clock_timestamp();
end
$function$;

create function
  programmable_private.release_market_projector_runtime_lease_v1(
    p_holder_id text,
    p_lease_generation bigint,
    p_lease_token_hash bytea,
    p_released_at timestamptz,
    p_input_commitment bytea
  )
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  current_lease
    programmable_private.market_projector_runtime_lease_current%rowtype;
  server_now timestamptz := pg_catalog.clock_timestamp();
  release_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_released_at is null
     or p_released_at < server_now - interval '30 seconds'
     or p_released_at > server_now + interval '30 seconds'
     or p_input_commitment is null
     or pg_catalog.octet_length(p_input_commitment) <> 32
  then
    raise exception using errcode = '22023',
      message = 'invalid market projector lease release';
  end if;
  select lease.* into strict current_lease
  from programmable_private.market_projector_runtime_lease_current as lease
  where lease.singleton_key = 'canonical-market-projector-runtime-v1'
  for update;
  if current_lease.lease_generation <> p_lease_generation
     or current_lease.holder_id <> p_holder_id
     or current_lease.lease_token_hash <> p_lease_token_hash
     or current_lease.released_at is not null
  then
    return false;
  end if;
  release_audit_id := programmable_private.append_mutation_audit(
    'market_projector_runtime_lease.release', p_input_commitment,
    null, server_now
  );
  update programmable_private.market_projector_runtime_lease_current as lease
  set released_at = server_now,
      release_commitment =
        p_input_commitment::programmable_private.bytes32_value,
      changed_by_audit_id = release_audit_id
  where lease.singleton_key = 'canonical-market-projector-runtime-v1';
  insert into programmable_private.market_projector_runtime_lease_history (
    lease_history_id, singleton_key, event_kind, lease_generation,
    holder_id, lease_token_hash, acquired_at, expires_at, event_at,
    input_commitment, audit_id
  ) values (
    pg_catalog.gen_random_uuid(), 'canonical-market-projector-runtime-v1',
    'released', current_lease.lease_generation,
    current_lease.holder_id::programmable_private.source_identifier,
    current_lease.lease_token_hash,
    current_lease.acquired_at, current_lease.expires_at, server_now,
    p_input_commitment::programmable_private.bytes32_value,
    release_audit_id
  );
  return true;
end
$function$;

create trigger reject_immutable_mutation
before update or delete
on programmable_private.market_projector_cursor_history
for each row execute function programmable_private.reject_immutable_mutation();

create trigger reject_immutable_mutation
before update or delete
on programmable_private.market_snapshot_lineage_memberships
for each row execute function programmable_private.reject_immutable_mutation();

create trigger reject_immutable_mutation
before update or delete
on programmable_private.market_candle_lineage_memberships
for each row execute function programmable_private.reject_immutable_mutation();

create index market_projector_cursor_fact_visibility_idx
  on programmable_private.market_projector_cursor_history (
    reconciliation_id, pool_id, reorg_generation, cursor_generation
  );

-- Successful facts remain visible only while their page belongs to the active
-- market-projector reorg lineage. This keeps append-only evidence auditable
-- without exposing a same-epoch orphan after the cursor rewinds.
create or replace view programmable_private.market_snapshots_v1
with (security_invoker = false, security_barrier = true)
as
select
  launch.chain_id,
  launch.release_id,
  launch.model_id,
  launch.token,
  launch.pool_id,
  snapshot.market_snapshot_id,
  snapshot.source_deployment_id,
  provider.deployment_commitment as source_deployment_commitment,
  provider.schema_commitment as source_schema_commitment,
  snapshot.block_evidence_id,
  snapshot.block_number,
  snapshot.block_hash,
  snapshot.sqrt_price_x96,
  snapshot.liquidity,
  snapshot.market_volume_token0,
  snapshot.market_volume_token1,
  snapshot.market_volume_usd,
  snapshot.hook_gross_volume,
  snapshot.observed_at,
  reconciliation.reconciliation_id,
  reconciliation.evidence_commitment as reconciliation_evidence_commitment,
  outcome.finished_at as reconciled_at
from programmable_private.market_snapshots as snapshot
join programmable_private.reconciliation_records as reconciliation
  on reconciliation.reconciliation_id = snapshot.reconciliation_id
 and reconciliation.chain_id = snapshot.chain_id
 and reconciliation.mismatch_count = 0
 and snapshot.block_number between
   reconciliation.source_from_block and reconciliation.source_to_block
join programmable_private.run_headers as run
  on run.run_id = reconciliation.run_id
 and run.run_kind = 'reconciliation'
 and run.chain_id = reconciliation.chain_id
 and run.release_id = reconciliation.release_id
 and run.model_id = reconciliation.model_id
 and run.epoch_id = reconciliation.epoch_id
 and run.captured_pointer_generation = reconciliation.pointer_generation
join programmable_private.run_lifecycle_outcomes as outcome
  on outcome.run_id = run.run_id
 and outcome.status = 'succeeded'
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = run.chain_id
 and current_epoch.release_id = run.release_id
 and current_epoch.model_id = run.model_id
 and current_epoch.source_group = run.source_group
 and current_epoch.epoch_id = run.epoch_id
 and current_epoch.generation = run.captured_pointer_generation
join programmable_private.provider_deployments as provider
  on provider.provider_deployment_id = snapshot.source_deployment_id
 and provider.provider_type = 'uniswap_subgraph'
join programmable_private.dual_rpc_block_evidence as block_evidence
  on block_evidence.block_evidence_id = snapshot.block_evidence_id
 and block_evidence.chain_id = run.chain_id
 and block_evidence.epoch_id = run.epoch_id
 and block_evidence.pointer_generation = run.captured_pointer_generation
 and block_evidence.block_number = snapshot.block_number
 and block_evidence.agreed_block_hash = snapshot.block_hash
join programmable_private.run_lifecycle_outcomes as evidence_outcome
  on evidence_outcome.run_id = block_evidence.verification_run_id
 and evidence_outcome.status = 'succeeded'
join programmable_private.safe_head_observations as observation
  on observation.observation_id = block_evidence.observation_id
 and observation.chain_id = run.chain_id
 and observation.release_id = run.release_id
 and observation.model_id = run.model_id
 and observation.source_group = run.source_group
 and observation.epoch_id = run.epoch_id
 and observation.pointer_generation = run.captured_pointer_generation
join programmable_private.launch_by_token_v1 as launch
  on launch.chain_id = run.chain_id
 and launch.release_id = run.release_id
 and launch.model_id = run.model_id
 and launch.source_group = run.source_group
 and launch.epoch_id = run.epoch_id
 and launch.pointer_generation = run.captured_pointer_generation
 and launch.pool_id = snapshot.pool_id
where not exists (
  select 1
  from programmable_private.market_projector_cursor_current as current_cursor
  where current_cursor.chain_id = run.chain_id
    and current_cursor.release_id = run.release_id
    and current_cursor.model_id = run.model_id
    and current_cursor.source_group = run.source_group
    and current_cursor.pool_id = snapshot.pool_id
) or exists (
  select 1
  from programmable_private.market_snapshot_lineage_memberships as membership
  join programmable_private.market_projector_cursor_current as current_cursor
    on current_cursor.chain_id = membership.chain_id
   and current_cursor.release_id = membership.release_id
   and current_cursor.model_id = membership.model_id
   and current_cursor.source_group = membership.source_group
   and current_cursor.projector_version = membership.projector_version
   and current_cursor.pool_id = membership.pool_id
   and current_cursor.reorg_generation = membership.reorg_generation
  join programmable_private.market_projector_cursor_history as cursor_history
    on cursor_history.market_cursor_id = current_cursor.market_cursor_id
  join programmable_private.projector_checkpoints as bound_source_checkpoint
    on bound_source_checkpoint.checkpoint_id =
      cursor_history.source_checkpoint_id
  join programmable_private.projector_checkpoint_current as source_tip
    on source_tip.chain_id = cursor_history.chain_id
   and source_tip.release_id = cursor_history.release_id
   and source_tip.model_id = cursor_history.model_id
   and source_tip.source_group = cursor_history.source_group
   and source_tip.projector_version =
     bound_source_checkpoint.projector_version
  join programmable_private.projector_checkpoints as source_tip_checkpoint
    on source_tip_checkpoint.checkpoint_id = source_tip.checkpoint_id
   and source_tip_checkpoint.epoch_id = cursor_history.epoch_id
   and source_tip_checkpoint.pointer_generation =
     cursor_history.pointer_generation
   and source_tip_checkpoint.reorg_generation =
     cursor_history.source_reorg_generation
   and source_tip_checkpoint.cursor_block_global_log_index = 4294967295
   and source_tip_checkpoint.cursor_candidate_id = 'empty-page'
  where membership.market_snapshot_id = snapshot.market_snapshot_id
    and membership.chain_id = run.chain_id
    and membership.release_id = run.release_id
    and membership.model_id = run.model_id
    and membership.source_group = run.source_group
    and membership.pool_id = snapshot.pool_id
);

create or replace view programmable_private.market_candles_v1
with (security_invoker = false, security_barrier = true)
as
select
  launch.chain_id,
  launch.release_id,
  launch.model_id,
  launch.token,
  launch.pool_id,
  candle.market_candle_id,
  candle.source_deployment_id,
  provider.deployment_commitment as source_deployment_commitment,
  provider.schema_commitment as source_schema_commitment,
  candle.source_block_evidence_id,
  candle.source_block_number,
  candle.source_block_hash,
  candle.interval,
  candle.period_start,
  candle.period_end,
  candle.open,
  candle.high,
  candle.low,
  candle.close,
  candle.volume_token0,
  candle.volume_token1,
  candle.volume_usd,
  reconciliation.reconciliation_id,
  reconciliation.evidence_commitment as reconciliation_evidence_commitment,
  outcome.finished_at as reconciled_at
from programmable_private.market_candles as candle
join programmable_private.reconciliation_records as reconciliation
  on reconciliation.reconciliation_id = candle.reconciliation_id
 and reconciliation.chain_id = candle.chain_id
 and reconciliation.mismatch_count = 0
 and candle.source_block_number between
   reconciliation.source_from_block and reconciliation.source_to_block
join programmable_private.run_headers as run
  on run.run_id = reconciliation.run_id
 and run.run_kind = 'reconciliation'
 and run.chain_id = reconciliation.chain_id
 and run.release_id = reconciliation.release_id
 and run.model_id = reconciliation.model_id
 and run.epoch_id = reconciliation.epoch_id
 and run.captured_pointer_generation = reconciliation.pointer_generation
join programmable_private.run_lifecycle_outcomes as outcome
  on outcome.run_id = run.run_id
 and outcome.status = 'succeeded'
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = run.chain_id
 and current_epoch.release_id = run.release_id
 and current_epoch.model_id = run.model_id
 and current_epoch.source_group = run.source_group
 and current_epoch.epoch_id = run.epoch_id
 and current_epoch.generation = run.captured_pointer_generation
join programmable_private.provider_deployments as provider
  on provider.provider_deployment_id = candle.source_deployment_id
 and provider.provider_type = 'uniswap_subgraph'
join programmable_private.dual_rpc_block_evidence as block_evidence
  on block_evidence.block_evidence_id = candle.source_block_evidence_id
 and block_evidence.chain_id = run.chain_id
 and block_evidence.epoch_id = run.epoch_id
 and block_evidence.pointer_generation = run.captured_pointer_generation
 and block_evidence.block_number = candle.source_block_number
 and block_evidence.agreed_block_hash = candle.source_block_hash
join programmable_private.run_lifecycle_outcomes as evidence_outcome
  on evidence_outcome.run_id = block_evidence.verification_run_id
 and evidence_outcome.status = 'succeeded'
join programmable_private.safe_head_observations as observation
  on observation.observation_id = block_evidence.observation_id
 and observation.chain_id = run.chain_id
 and observation.release_id = run.release_id
 and observation.model_id = run.model_id
 and observation.source_group = run.source_group
 and observation.epoch_id = run.epoch_id
 and observation.pointer_generation = run.captured_pointer_generation
join programmable_private.launch_by_token_v1 as launch
  on launch.chain_id = run.chain_id
 and launch.release_id = run.release_id
 and launch.model_id = run.model_id
 and launch.source_group = run.source_group
 and launch.epoch_id = run.epoch_id
 and launch.pointer_generation = run.captured_pointer_generation
 and launch.pool_id = candle.pool_id
where not exists (
  select 1
  from programmable_private.market_projector_cursor_current as current_cursor
  where current_cursor.chain_id = run.chain_id
    and current_cursor.release_id = run.release_id
    and current_cursor.model_id = run.model_id
    and current_cursor.source_group = run.source_group
    and current_cursor.pool_id = candle.pool_id
) or exists (
  select 1
  from programmable_private.market_candle_lineage_memberships as membership
  join programmable_private.market_projector_cursor_current as current_cursor
    on current_cursor.chain_id = membership.chain_id
   and current_cursor.release_id = membership.release_id
   and current_cursor.model_id = membership.model_id
   and current_cursor.source_group = membership.source_group
   and current_cursor.projector_version = membership.projector_version
   and current_cursor.pool_id = membership.pool_id
   and current_cursor.reorg_generation = membership.reorg_generation
  join programmable_private.market_projector_cursor_history as cursor_history
    on cursor_history.market_cursor_id = current_cursor.market_cursor_id
  join programmable_private.projector_checkpoints as bound_source_checkpoint
    on bound_source_checkpoint.checkpoint_id =
      cursor_history.source_checkpoint_id
  join programmable_private.projector_checkpoint_current as source_tip
    on source_tip.chain_id = cursor_history.chain_id
   and source_tip.release_id = cursor_history.release_id
   and source_tip.model_id = cursor_history.model_id
   and source_tip.source_group = cursor_history.source_group
   and source_tip.projector_version =
     bound_source_checkpoint.projector_version
  join programmable_private.projector_checkpoints as source_tip_checkpoint
    on source_tip_checkpoint.checkpoint_id = source_tip.checkpoint_id
   and source_tip_checkpoint.epoch_id = cursor_history.epoch_id
   and source_tip_checkpoint.pointer_generation =
     cursor_history.pointer_generation
   and source_tip_checkpoint.reorg_generation =
     cursor_history.source_reorg_generation
   and source_tip_checkpoint.cursor_block_global_log_index = 4294967295
   and source_tip_checkpoint.cursor_candidate_id = 'empty-page'
  where membership.market_candle_id = candle.market_candle_id
    and membership.chain_id = run.chain_id
    and membership.release_id = run.release_id
    and membership.model_id = run.model_id
    and membership.source_group = run.source_group
    and membership.pool_id = candle.pool_id
);

-- A block may contain more than one fee event for the same pool. The state
-- query is block-wide, so only the last canonical occurrence is a valid close.
-- Earlier same-block observations stay in the audit ledger but never become a
-- second public chart point.
create or replace view programmable_private.market_block_closes_v1
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
 and launch.pool_id = close_fact.pool_id
where not exists (
  select 1
  from programmable_private.market_block_closes as later_close
  join programmable_private.reconciliation_records as later_reconciliation
    on later_reconciliation.reconciliation_id = later_close.reconciliation_id
   and later_reconciliation.mismatch_count = 0
  join programmable_private.run_headers as later_run
    on later_run.run_id = later_reconciliation.run_id
   and later_run.run_kind = 'reconciliation'
  join programmable_private.run_lifecycle_outcomes as later_outcome
    on later_outcome.run_id = later_run.run_id
   and later_outcome.status = 'succeeded'
  join programmable_private.chain_event_current_canonical as later_canonical
    on later_canonical.occurrence_id = later_close.last_source_occurrence_id
   and later_canonical.logical_event_id =
     later_close.last_source_logical_event_id
   and later_canonical.block_hash =
     later_close.last_source_occurrence_block_hash
  where later_close.chain_id = close_fact.chain_id
    and later_close.release_id = close_fact.release_id
    and later_close.model_id = close_fact.model_id
    and later_close.source_group = close_fact.source_group
    and later_close.epoch_id = close_fact.epoch_id
    and later_close.pointer_generation = close_fact.pointer_generation
    and later_close.pool_id = close_fact.pool_id
    and later_close.block_hash = close_fact.block_hash
    and (
      later_close.last_transaction_index,
      later_close.last_block_global_log_index,
      later_close.market_block_close_id
    ) > (
      close_fact.last_transaction_index,
      close_fact.last_block_global_log_index,
      close_fact.market_block_close_id
    )
);

create function programmable_private.resolve_market_graph_provider_v1(
  p_redacted_identity text,
  p_deployment_commitment bytea,
  p_schema_commitment bytea
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  resolved_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_redacted_identity is null
     or pg_catalog.octet_length(p_deployment_commitment) <> 32
     or pg_catalog.octet_length(p_schema_commitment) <> 32
  then
    raise exception using
      errcode = '22023', message = 'invalid exact market provider identity';
  end if;
  select provider.provider_deployment_id into strict resolved_id
  from programmable_private.provider_deployments as provider
  where provider.provider_type = 'uniswap_subgraph'
    and provider.redacted_identity = p_redacted_identity
    and provider.deployment_commitment = p_deployment_commitment
    and provider.schema_commitment = p_schema_commitment;
  return resolved_id;
exception
  when no_data_found then
    raise exception using
      errcode = '23503', message = 'exact market provider is not registered';
  when too_many_rows then
    raise exception using
      errcode = '23514', message = 'ambiguous exact market provider identity';
end
$function$;

create function programmable_private.list_market_projector_pools_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_source_projector_version text,
  p_market_projector_version text,
  p_limit integer
)
returns table (
  epoch_id uuid,
  pointer_generation bigint,
  source_checkpoint_id uuid,
  source_checkpoint_generation bigint,
  source_reorg_generation bigint,
  source_checkpoint_block_number bigint,
  source_checkpoint_block_hash bytea,
  source_checkpoint_block_evidence_id uuid,
  token bytea,
  pool_id bytea,
  currency0 bytea,
  currency1 bytea,
  hook bytea,
  pool_key_fee bigint,
  tick_spacing integer,
  token0_decimals smallint,
  token1_decimals smallint,
  total_supply numeric,
  launch_block_number bigint,
  launch_block_timestamp timestamptz,
  market_cursor_id uuid,
  cursor_epoch_id uuid,
  cursor_pointer_generation bigint,
  cursor_generation bigint,
  cursor_reorg_generation bigint,
  cursor_source_checkpoint_id uuid,
  cursor_source_checkpoint_generation bigint,
  cursor_source_reorg_generation bigint,
  cursor_block_evidence_id uuid,
  cursor_block_number bigint,
  cursor_block_hash bytea,
  provider_cursor text,
  hour_coverage_end timestamptz,
  day_coverage_end timestamptz,
  page_commitment bytea,
  advanced_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_chain_id <= 0 or p_limit not between 1 and 20
     or p_market_projector_version is null
     or pg_catalog.octet_length(p_market_projector_version) not between 1 and 128
     or p_market_projector_version !~ '^[A-Za-z0-9][A-Za-z0-9._+:/-]*$'
  then
    raise exception using
      errcode = '22023', message = 'invalid market pool page';
  end if;
  if not exists (
    select 1
    from programmable_private.projector_checkpoint_current as current_pointer
    join programmable_private.projector_checkpoints as checkpoint
      on checkpoint.checkpoint_id = current_pointer.checkpoint_id
    join programmable_private.release_epoch_current as current_epoch
      on current_epoch.chain_id = checkpoint.chain_id
     and current_epoch.release_id = checkpoint.release_id
     and current_epoch.model_id = checkpoint.model_id
     and current_epoch.source_group = checkpoint.source_group
     and current_epoch.epoch_id = checkpoint.epoch_id
     and current_epoch.generation = checkpoint.pointer_generation
    where current_pointer.chain_id = p_chain_id
      and current_pointer.release_id = p_release_id
      and current_pointer.model_id = p_model_id
      and current_pointer.source_group = p_source_group
      and current_pointer.projector_version = p_source_projector_version
      and checkpoint.cursor_block_global_log_index = 4294967295
      and checkpoint.cursor_candidate_id = 'empty-page'
  ) then
    raise exception using
      errcode = '23503', message = 'market source checkpoint is unavailable';
  end if;
  return query
  select
    checkpoint.epoch_id,
    checkpoint.pointer_generation,
    checkpoint.checkpoint_id,
    checkpoint.checkpoint_generation,
    checkpoint.reorg_generation,
    checkpoint.block_number::bigint,
    checkpoint.block_hash::bytea,
    checkpoint.target_block_evidence_id,
    launch.token::bytea,
    launch.pool_id::bytea,
    launch.currency0::bytea,
    launch.currency1::bytea,
    launch.hook::bytea,
    launch.pool_key_fee::bigint,
    launch.tick_spacing::integer,
    18::smallint,
    18::smallint,
    launch.total_supply::numeric,
    launch.promoted_block_number::bigint,
    launch.launch_block_timestamp,
    cursor_history.market_cursor_id,
    cursor_history.epoch_id,
    cursor_history.pointer_generation,
    cursor_history.cursor_generation,
    cursor_history.reorg_generation,
    cursor_history.source_checkpoint_id,
    cursor_history.source_checkpoint_generation,
    cursor_history.source_reorg_generation,
    cursor_history.block_evidence_id,
    cursor_history.block_number::bigint,
    cursor_history.block_hash::bytea,
    cursor_history.provider_cursor,
    cursor_history.hour_coverage_end,
    cursor_history.day_coverage_end,
    cursor_history.page_commitment::bytea,
    cursor_history.advanced_at
  from programmable_private.projector_checkpoint_current as current_pointer
  join programmable_private.projector_checkpoints as checkpoint
    on checkpoint.checkpoint_id = current_pointer.checkpoint_id
  join programmable_private.launch_by_token_v2 as launch
    on launch.chain_id = checkpoint.chain_id
   and launch.release_id = checkpoint.release_id
   and launch.model_id = checkpoint.model_id
   and launch.source_group = checkpoint.source_group
   and launch.epoch_id = checkpoint.epoch_id
   and launch.pointer_generation = checkpoint.pointer_generation
  left join programmable_private.market_projector_cursor_current as current_cursor
    on current_cursor.chain_id = checkpoint.chain_id
   and current_cursor.release_id = checkpoint.release_id
   and current_cursor.model_id = checkpoint.model_id
   and current_cursor.source_group = checkpoint.source_group
   and current_cursor.projector_version = p_market_projector_version
   and current_cursor.pool_id = launch.pool_id
  left join programmable_private.market_projector_cursor_history as cursor_history
    on cursor_history.market_cursor_id = current_cursor.market_cursor_id
  where current_pointer.chain_id = p_chain_id
    and current_pointer.release_id = p_release_id
    and current_pointer.model_id = p_model_id
    and current_pointer.source_group = p_source_group
    and current_pointer.projector_version = p_source_projector_version
    and checkpoint.cursor_block_global_log_index = 4294967295
    and checkpoint.cursor_candidate_id = 'empty-page'
    and (
      cursor_history.market_cursor_id is null
      or cursor_history.epoch_id <> checkpoint.epoch_id
      or cursor_history.pointer_generation <> checkpoint.pointer_generation
      or cursor_history.source_reorg_generation < checkpoint.reorg_generation
      or exists (
        select 1
        from programmable_private.chain_event_occurrence_materializations
          as pending_materialization
        join programmable_private.chain_event_occurrences
          as pending_occurrence
          on pending_occurrence.occurrence_id =
            pending_materialization.occurrence_id
         and pending_occurrence.chain_id = checkpoint.chain_id
        join programmable_private.chain_event_current_canonical
          as pending_canonical
          on pending_canonical.occurrence_id = pending_occurrence.occurrence_id
         and pending_canonical.logical_event_id =
           pending_occurrence.logical_event_id
         and pending_canonical.block_hash = pending_occurrence.block_hash
        where pending_materialization.chain_id = checkpoint.chain_id
          and pending_materialization.release_id = checkpoint.release_id
          and pending_materialization.model_id = checkpoint.model_id
          and pending_materialization.source_group = checkpoint.source_group
          and pending_materialization.epoch_id = checkpoint.epoch_id
          and pending_materialization.pointer_generation =
            checkpoint.pointer_generation
          and programmable_private.is_market_fee_event_v1(
            checkpoint.model_id, pending_materialization.event_type
          )
          and pg_catalog.lower(
            pending_materialization.decoded_payload ->> 'poolId'
          ) = '0x' || pg_catalog.encode(launch.pool_id, 'hex')
          and pending_occurrence.block_number <= checkpoint.block_number
          and (
            cursor_history.market_cursor_id is null
            or pending_occurrence.block_number > cursor_history.block_number
            or (
              pending_occurrence.block_number = cursor_history.block_number
              and not exists (
                select 1
                from programmable_private.market_block_closes
                  as projected_close
                where projected_close.chain_id = checkpoint.chain_id
                  and projected_close.release_id = checkpoint.release_id
                  and projected_close.model_id = checkpoint.model_id
                  and projected_close.source_group = checkpoint.source_group
                  and projected_close.epoch_id = checkpoint.epoch_id
                  and projected_close.pointer_generation =
                    checkpoint.pointer_generation
                  and projected_close.pool_id = launch.pool_id
                  and projected_close.last_source_occurrence_id =
                    pending_occurrence.occurrence_id
              )
            )
          )
      )
    )
  order by
    case
      when cursor_history.market_cursor_id is not null and (
        cursor_history.epoch_id <> checkpoint.epoch_id
        or cursor_history.pointer_generation <> checkpoint.pointer_generation
        or cursor_history.source_reorg_generation < checkpoint.reorg_generation
      ) then 0
      when cursor_history.market_cursor_id is null then 1
      else 2
    end,
    cursor_history.advanced_at asc nulls first,
    (
      checkpoint.block_number - coalesce(
        cursor_history.block_number, launch.promoted_block_number
      )
    ) desc,
    launch.pool_id
  limit p_limit;
end
$function$;

create function programmable_private.resolve_market_block_evidence_v1(
  p_reconciliation_id uuid,
  p_block_number numeric,
  p_block_hash bytea,
  p_provider_a_id uuid,
  p_provider_b_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  reconciliation programmable_private.reconciliation_records%rowtype;
  header programmable_private.run_headers%rowtype;
  normalized_block bigint;
  resolved_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_block_number <> pg_catalog.trunc(p_block_number)
     or p_block_number < 0
     or p_block_number > 9223372036854775807
     or pg_catalog.octet_length(p_block_hash) <> 32
     or p_provider_a_id is null or p_provider_b_id is null
     or p_provider_a_id = p_provider_b_id
  then
    raise exception using
      errcode = '22023', message = 'invalid market block evidence lookup';
  end if;
  normalized_block := p_block_number::bigint;
  select record.* into reconciliation
  from programmable_private.reconciliation_records as record
  where record.reconciliation_id = p_reconciliation_id
    and record.mismatch_count = 0;
  select run.* into header
  from programmable_private.run_headers as run
  where run.run_id = reconciliation.run_id
    and run.run_kind = 'reconciliation';
  if header.run_id is null
     or exists (
       select 1 from programmable_private.run_lifecycle_outcomes as outcome
       where outcome.run_id = header.run_id
     )
     or normalized_block not between reconciliation.source_from_block
       and reconciliation.source_to_block
  then
    raise exception using
      errcode = '23514', message = 'market evidence lookup lacks open reconciliation';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if exists (
    select 1
    from programmable_private.dual_rpc_block_evidence as evidence
    join programmable_private.safe_head_observations as observation
      on observation.observation_id = evidence.observation_id
    where evidence.chain_id = header.chain_id
      and evidence.epoch_id = header.epoch_id
      and evidence.pointer_generation = header.captured_pointer_generation
      and evidence.block_number = normalized_block
      and observation.release_id = header.release_id
      and observation.model_id = header.model_id
      and observation.source_group = header.source_group
      and observation.provider_a_id = p_provider_a_id
      and observation.provider_b_id = p_provider_b_id
      and evidence.agreed_block_hash <> p_block_hash
  ) then
    raise exception using
      errcode = '23514', message = 'ambiguous market block identity';
  end if;
  select evidence.block_evidence_id into resolved_id
  from programmable_private.dual_rpc_block_evidence as evidence
  join programmable_private.safe_head_observations as observation
    on observation.observation_id = evidence.observation_id
  where evidence.chain_id = header.chain_id
    and evidence.epoch_id = header.epoch_id
    and evidence.pointer_generation = header.captured_pointer_generation
    and evidence.block_number = normalized_block
    and evidence.agreed_block_hash = p_block_hash
    and observation.release_id = header.release_id
    and observation.model_id = header.model_id
    and observation.source_group = header.source_group
    and observation.provider_a_id = p_provider_a_id
    and observation.provider_b_id = p_provider_b_id
  order by evidence.verified_at desc, evidence.block_evidence_id desc
  limit 1;
  if resolved_id is null then
    raise exception using
      errcode = '23503', message = 'exact market block evidence is unavailable';
  end if;
  return resolved_id;
end
$function$;

create function programmable_private.resolve_market_close_anchor_v1(
  p_reconciliation_id uuid,
  p_pool_id bytea,
  p_block_number numeric,
  p_block_hash bytea
)
returns table (
  occurrence_id uuid,
  logical_event_id uuid,
  block_evidence_id uuid,
  block_timestamp timestamptz,
  transaction_hash bytea,
  transaction_index bigint,
  block_global_log_index bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  reconciliation programmable_private.reconciliation_records%rowtype;
  header programmable_private.run_headers%rowtype;
  normalized_block bigint;
  candidate_count bigint;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if pg_catalog.octet_length(p_pool_id) <> 32
     or p_block_number <> pg_catalog.trunc(p_block_number)
     or p_block_number < 0
     or p_block_number > 9223372036854775807
     or pg_catalog.octet_length(p_block_hash) <> 32
  then
    raise exception using
      errcode = '22023', message = 'invalid market close anchor lookup';
  end if;
  normalized_block := p_block_number::bigint;
  select record.* into reconciliation
  from programmable_private.reconciliation_records as record
  where record.reconciliation_id = p_reconciliation_id
    and record.mismatch_count = 0;
  select run.* into header
  from programmable_private.run_headers as run
  where run.run_id = reconciliation.run_id
    and run.run_kind = 'reconciliation';
  if header.run_id is null
     or exists (
       select 1 from programmable_private.run_lifecycle_outcomes as outcome
       where outcome.run_id = header.run_id
     )
     or normalized_block not between reconciliation.source_from_block
       and reconciliation.source_to_block
  then
    raise exception using
      errcode = '23514', message = 'market close lookup lacks open reconciliation';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  select pg_catalog.count(*) into candidate_count
  from programmable_private.chain_event_occurrences as occurrence
  join programmable_private.chain_event_occurrence_materializations as materialization
    on materialization.occurrence_id = occurrence.occurrence_id
   and materialization.chain_id = header.chain_id
   and materialization.release_id = header.release_id
   and materialization.model_id = header.model_id
   and materialization.source_group = header.source_group
   and materialization.epoch_id = header.epoch_id
   and materialization.pointer_generation = header.captured_pointer_generation
   and programmable_private.is_market_fee_event_v1(
     header.model_id, materialization.event_type
   )
  join programmable_private.chain_event_current_canonical as canonical
    on canonical.occurrence_id = occurrence.occurrence_id
   and canonical.logical_event_id = occurrence.logical_event_id
   and canonical.block_hash = occurrence.block_hash
  where occurrence.chain_id = header.chain_id
    and occurrence.block_number = normalized_block
    and occurrence.block_hash = p_block_hash
    and pg_catalog.lower(materialization.decoded_payload ->> 'poolId') =
      '0x' || pg_catalog.encode(p_pool_id, 'hex');
  if candidate_count = 0 then
    raise exception using
      errcode = '23503', message = 'canonical market close anchor is unavailable';
  end if;
  return query
  select
    occurrence.occurrence_id,
    occurrence.logical_event_id,
    materialization.block_evidence_id,
    occurrence.block_timestamp,
    occurrence.transaction_hash::bytea,
    occurrence.transaction_index::bigint,
    occurrence.block_global_log_index::bigint
  from programmable_private.chain_event_occurrences as occurrence
  join programmable_private.chain_event_occurrence_materializations as materialization
    on materialization.occurrence_id = occurrence.occurrence_id
   and materialization.chain_id = header.chain_id
   and materialization.release_id = header.release_id
   and materialization.model_id = header.model_id
   and materialization.source_group = header.source_group
   and materialization.epoch_id = header.epoch_id
   and materialization.pointer_generation = header.captured_pointer_generation
   and programmable_private.is_market_fee_event_v1(
     header.model_id, materialization.event_type
   )
  join programmable_private.chain_event_current_canonical as canonical
    on canonical.occurrence_id = occurrence.occurrence_id
   and canonical.logical_event_id = occurrence.logical_event_id
   and canonical.block_hash = occurrence.block_hash
  where occurrence.chain_id = header.chain_id
    and occurrence.block_number = normalized_block
    and occurrence.block_hash = p_block_hash
    and pg_catalog.lower(materialization.decoded_payload ->> 'poolId') =
      '0x' || pg_catalog.encode(p_pool_id, 'hex')
  order by occurrence.transaction_index desc,
    occurrence.block_global_log_index desc, occurrence.occurrence_id desc
  limit 1;
end
$function$;

create function programmable_private.get_market_block_evidence_context_v1(
  p_reconciliation_id uuid,
  p_block_evidence_id uuid
)
returns table (
  provider_a_id uuid,
  provider_b_id uuid,
  provider_a_identity text,
  provider_b_identity text,
  provider_a_endpoint_commitment bytea,
  provider_b_endpoint_commitment bytea,
  provider_a_origin_commitment bytea,
  provider_b_origin_commitment bytea,
  block_number bigint,
  block_hash bytea,
  safe_block_number bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  evidence programmable_private.dual_rpc_block_evidence%rowtype;
  context record;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_block_evidence_id;
  select * into context
  from programmable_private.market_reconciliation_context_v1(
    p_reconciliation_id, p_block_evidence_id, evidence.agreed_block_hash
  );
  if context.run_id is null then
    raise exception using
      errcode = '23514', message = 'market evidence context is unavailable';
  end if;
  return query
  select observation.provider_a_id, observation.provider_b_id,
    provider_a.redacted_identity::text,
    provider_b.redacted_identity::text,
    metadata_a.endpoint_url_commitment::bytea,
    metadata_b.endpoint_url_commitment::bytea,
    metadata_a.endpoint_origin_commitment::bytea,
    metadata_b.endpoint_origin_commitment::bytea,
    evidence.block_number::bigint, evidence.agreed_block_hash::bytea,
    observation.safe_block_number::bigint
  from programmable_private.safe_head_observations as observation
  join programmable_private.provider_deployments as provider_a
    on provider_a.provider_deployment_id = observation.provider_a_id
   and provider_a.provider_type = 'rpc_provider'
  join programmable_private.provider_deployments as provider_b
    on provider_b.provider_deployment_id = observation.provider_b_id
   and provider_b.provider_type = 'rpc_provider'
  join programmable_private.rpc_provider_deployment_metadata as metadata_a
    on metadata_a.provider_deployment_id = provider_a.provider_deployment_id
   and metadata_a.chain_id = context.chain_id
   and metadata_a.vendor = 'alchemy'
   and metadata_a.vendor_order = 1
  join programmable_private.rpc_provider_deployment_metadata as metadata_b
    on metadata_b.provider_deployment_id = provider_b.provider_deployment_id
   and metadata_b.chain_id = context.chain_id
   and metadata_b.vendor = 'quicknode'
   and metadata_b.vendor_order = 2
  where observation.observation_id = context.safe_head_observation_id;
end
$function$;

create function programmable_private.get_market_global_snapshot_v1(
  p_reconciliation_id uuid,
  p_block_evidence_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  evidence programmable_private.dual_rpc_block_evidence%rowtype;
  context record;
  resolved_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_block_evidence_id;
  select * into context
  from programmable_private.market_reconciliation_context_v1(
    p_reconciliation_id, p_block_evidence_id, evidence.agreed_block_hash
  );
  select snapshot.global_market_snapshot_id into resolved_id
  from programmable_private.global_eth_usd_snapshots_v1 as snapshot
  where snapshot.chain_id = context.chain_id
    and snapshot.release_id = context.release_id
    and snapshot.model_id = context.model_id
    and snapshot.source_group = context.source_group
    and snapshot.epoch_id = context.epoch_id
    and snapshot.pointer_generation = context.pointer_generation
    and snapshot.block_evidence_id = p_block_evidence_id
    and snapshot.block_hash = evidence.agreed_block_hash;
  return resolved_id;
end
$function$;

create function programmable_private.list_market_close_anchors_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_source_projector_version text,
  p_pool_id bytea,
  p_from_block_exclusive numeric,
  p_to_block_inclusive numeric,
  p_limit integer,
  p_after_block numeric default null
)
returns table (
  occurrence_id uuid,
  logical_event_id uuid,
  block_evidence_id uuid,
  block_number bigint,
  block_hash bytea,
  block_timestamp timestamptz,
  transaction_hash bytea,
  transaction_index bigint,
  block_global_log_index bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_from bigint;
  normalized_to bigint;
  normalized_after bigint;
  checkpoint programmable_private.projector_checkpoints%rowtype;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_chain_id <= 0 or pg_catalog.octet_length(p_pool_id) <> 32
     or p_from_block_exclusive <> pg_catalog.trunc(p_from_block_exclusive)
     or p_to_block_inclusive <> pg_catalog.trunc(p_to_block_inclusive)
     or p_from_block_exclusive < 0
     or p_to_block_inclusive < p_from_block_exclusive
     or p_to_block_inclusive > 9223372036854775807
     or p_limit not between 1 and 128
     or (
       p_after_block is not null
       and (
         p_after_block <> pg_catalog.trunc(p_after_block)
         or p_after_block < p_from_block_exclusive
         or p_after_block > p_to_block_inclusive
       )
     )
  then
    raise exception using
      errcode = '22023', message = 'invalid market close anchor page';
  end if;
  normalized_from := p_from_block_exclusive::bigint;
  normalized_to := p_to_block_inclusive::bigint;
  normalized_after := coalesce(p_after_block::bigint, normalized_from);
  select stored.* into checkpoint
  from programmable_private.projector_checkpoint_current as current_checkpoint
  join programmable_private.projector_checkpoints as stored
    on stored.checkpoint_id = current_checkpoint.checkpoint_id
  join programmable_private.release_epoch_current as current_epoch
    on current_epoch.chain_id = stored.chain_id
   and current_epoch.release_id = stored.release_id
   and current_epoch.model_id = stored.model_id
   and current_epoch.source_group = stored.source_group
   and current_epoch.epoch_id = stored.epoch_id
   and current_epoch.generation = stored.pointer_generation
  where current_checkpoint.chain_id = p_chain_id
    and current_checkpoint.release_id = p_release_id
    and current_checkpoint.model_id = p_model_id
    and current_checkpoint.source_group = p_source_group
    and current_checkpoint.projector_version = p_source_projector_version;
  if checkpoint.checkpoint_id is null
     or normalized_to > checkpoint.block_number
  then
    raise exception using
      errcode = '23514', message = 'market close page exceeds current checkpoint';
  end if;
  return query
  select selected.occurrence_id, selected.logical_event_id,
    selected.block_evidence_id, selected.block_number,
    selected.block_hash, selected.block_timestamp,
    selected.transaction_hash, selected.transaction_index,
    selected.block_global_log_index
  from (
    select distinct on (occurrence.block_number, occurrence.block_hash)
      occurrence.occurrence_id,
      occurrence.logical_event_id,
      materialization.block_evidence_id,
      occurrence.block_number::bigint,
      occurrence.block_hash::bytea,
      occurrence.block_timestamp,
      occurrence.transaction_hash::bytea,
      occurrence.transaction_index::bigint,
      occurrence.block_global_log_index::bigint
    from programmable_private.chain_event_occurrences as occurrence
    join programmable_private.chain_event_occurrence_materializations as materialization
      on materialization.occurrence_id = occurrence.occurrence_id
     and materialization.chain_id = checkpoint.chain_id
     and materialization.release_id = checkpoint.release_id
     and materialization.model_id = checkpoint.model_id
     and materialization.source_group = checkpoint.source_group
     and materialization.epoch_id = checkpoint.epoch_id
     and materialization.pointer_generation = checkpoint.pointer_generation
     and programmable_private.is_market_fee_event_v1(
       checkpoint.model_id, materialization.event_type
     )
    join programmable_private.chain_event_current_canonical as canonical
      on canonical.occurrence_id = occurrence.occurrence_id
     and canonical.logical_event_id = occurrence.logical_event_id
     and canonical.block_hash = occurrence.block_hash
    where occurrence.chain_id = checkpoint.chain_id
      and occurrence.block_number > normalized_after
      and occurrence.block_number <= normalized_to
      and pg_catalog.lower(materialization.decoded_payload ->> 'poolId') =
        '0x' || pg_catalog.encode(p_pool_id, 'hex')
    order by occurrence.block_number, occurrence.block_hash,
      occurrence.transaction_index desc,
      occurrence.block_global_log_index desc,
      occurrence.occurrence_id desc
  ) as selected
  order by selected.block_number, selected.block_global_log_index
  limit p_limit;
end
$function$;

create function programmable_private.resolve_market_candle_close_v1(
  p_reconciliation_id uuid,
  p_pool_id bytea,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  reconciliation programmable_private.reconciliation_records%rowtype;
  header programmable_private.run_headers%rowtype;
  resolved_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if pg_catalog.octet_length(p_pool_id) <> 32
     or p_period_end <= p_period_start
     or p_period_end > p_period_start + interval '1 day'
  then
    raise exception using
      errcode = '22023', message = 'invalid market candle close lookup';
  end if;
  select record.* into reconciliation
  from programmable_private.reconciliation_records as record
  where record.reconciliation_id = p_reconciliation_id
    and record.mismatch_count = 0;
  select run.* into header
  from programmable_private.run_headers as run
  where run.run_id = reconciliation.run_id
    and run.run_kind = 'reconciliation';
  if header.run_id is null
     or exists (
       select 1 from programmable_private.run_lifecycle_outcomes as outcome
       where outcome.run_id = header.run_id
     )
  then
    raise exception using
      errcode = '23514', message = 'market candle close lookup lacks open reconciliation';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  select close_fact.market_block_close_id into resolved_id
  from programmable_private.market_block_closes as close_fact
  join programmable_private.chain_event_current_canonical as canonical
    on canonical.occurrence_id = close_fact.last_source_occurrence_id
   and canonical.logical_event_id = close_fact.last_source_logical_event_id
   and canonical.block_hash = close_fact.last_source_occurrence_block_hash
  join programmable_private.reconciliation_records as close_reconciliation
    on close_reconciliation.reconciliation_id = close_fact.reconciliation_id
   and close_reconciliation.mismatch_count = 0
  join programmable_private.run_headers as close_run
    on close_run.run_id = close_reconciliation.run_id
   and close_run.run_kind = 'reconciliation'
  left join programmable_private.run_lifecycle_outcomes as close_outcome
    on close_outcome.run_id = close_run.run_id
  where close_fact.chain_id = header.chain_id
    and close_fact.release_id = header.release_id
    and close_fact.model_id = header.model_id
    and close_fact.source_group = header.source_group
    and close_fact.epoch_id = header.epoch_id
    and close_fact.pointer_generation = header.captured_pointer_generation
    and close_fact.pool_id = p_pool_id
    and close_fact.block_timestamp >= p_period_start
    and close_fact.block_timestamp < p_period_end
    and (
      close_fact.reconciliation_id = p_reconciliation_id
      or close_outcome.status = 'succeeded'
    )
  order by close_fact.block_number desc,
    close_fact.last_block_global_log_index desc,
    close_fact.market_block_close_id desc
  limit 1;
  if resolved_id is null then
    raise exception using
      errcode = '23503', message = 'market candle has no canonical closing swap';
  end if;
  return resolved_id;
end
$function$;

create function programmable_private.market_fact_reconciliation_usable_v1(
  p_fact_reconciliation_id uuid,
  p_current_reconciliation_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select p_fact_reconciliation_id = p_current_reconciliation_id
    or exists (
      select 1
      from programmable_private.reconciliation_records as reconciliation
      join programmable_private.run_headers as run
        on run.run_id = reconciliation.run_id
       and run.run_kind = 'reconciliation'
      join programmable_private.run_lifecycle_outcomes as outcome
        on outcome.run_id = run.run_id
       and outcome.status = 'succeeded'
      where reconciliation.reconciliation_id = p_fact_reconciliation_id
        and reconciliation.mismatch_count = 0
    )
$function$;

create function programmable_private.attach_market_snapshot_lineage_v1(
  p_reconciliation_id uuid,
  p_projector_version text,
  p_reorg_generation bigint,
  p_market_snapshot_id uuid,
  p_membership_commitment bytea,
  p_attached_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  snapshot programmable_private.market_snapshots%rowtype;
  context record;
  existing programmable_private.market_snapshot_lineage_memberships%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select candidate.* into snapshot
  from programmable_private.market_snapshots as candidate
  where candidate.market_snapshot_id = p_market_snapshot_id;
  if snapshot.market_snapshot_id is null then
    raise exception using
      errcode = '23503', message = 'market snapshot is unavailable';
  end if;
  select * into context
  from programmable_private.market_reconciliation_context_v1(
    p_reconciliation_id, snapshot.block_evidence_id, snapshot.block_hash
  );
  if context.run_id is null
     or p_reorg_generation < 0
     or p_projector_version is null
     or pg_catalog.octet_length(p_projector_version) not between 1 and 128
     or p_projector_version !~ '^[A-Za-z0-9][A-Za-z0-9._+:/-]*$'
     or pg_catalog.octet_length(p_membership_commitment) <> 32
     or snapshot.chain_id <> context.chain_id
     or not programmable_private.market_fact_reconciliation_usable_v1(
       snapshot.reconciliation_id, p_reconciliation_id
     )
     or not exists (
       select 1
       from programmable_private.launch_by_token_v2 as launch
       where launch.chain_id = context.chain_id
         and launch.release_id = context.release_id
         and launch.model_id = context.model_id
         and launch.source_group = context.source_group
         and launch.epoch_id = context.epoch_id
         and launch.pointer_generation = context.pointer_generation
         and launch.pool_id = snapshot.pool_id
     )
  then
    raise exception using
      errcode = '23514', message = 'invalid snapshot lineage membership';
  end if;
  select membership.* into existing
  from programmable_private.market_snapshot_lineage_memberships as membership
  where membership.chain_id = context.chain_id
    and membership.release_id = context.release_id
    and membership.model_id = context.model_id
    and membership.source_group = context.source_group
    and membership.projector_version = p_projector_version
    and membership.pool_id = snapshot.pool_id
    and membership.reorg_generation = p_reorg_generation
    and membership.market_snapshot_id = p_market_snapshot_id;
  if found then
    if (
      select audit.input_commitment
      from programmable_private.mutation_audits as audit
      where audit.audit_id = existing.audit_id
    ) <> p_membership_commitment
    then
      raise exception using
        errcode = '23505', message = 'snapshot lineage replay conflict';
    end if;
    return p_market_snapshot_id;
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'market_snapshot_lineage.attach', p_membership_commitment,
    context.run_id, p_attached_at
  );
  insert into programmable_private.market_snapshot_lineage_memberships (
    chain_id, release_id, model_id, source_group, projector_version,
    pool_id, reorg_generation, market_snapshot_id,
    attached_reconciliation_id, attached_at, audit_id
  ) values (
    context.chain_id,
    context.release_id::programmable_private.release_identifier,
    context.model_id::programmable_private.model_identifier,
    context.source_group::programmable_private.source_identifier,
    p_projector_version::programmable_private.projector_identifier,
    snapshot.pool_id, p_reorg_generation, p_market_snapshot_id,
    p_reconciliation_id, p_attached_at, created_audit_id
  );
  return p_market_snapshot_id;
end
$function$;

create function programmable_private.attach_market_candle_lineage_v1(
  p_reconciliation_id uuid,
  p_projector_version text,
  p_reorg_generation bigint,
  p_market_candle_id uuid,
  p_membership_commitment bytea,
  p_attached_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  candle programmable_private.market_candles%rowtype;
  context record;
  existing programmable_private.market_candle_lineage_memberships%rowtype;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select candidate.* into candle
  from programmable_private.market_candles as candidate
  where candidate.market_candle_id = p_market_candle_id;
  if candle.market_candle_id is null then
    raise exception using
      errcode = '23503', message = 'market candle is unavailable';
  end if;
  select * into context
  from programmable_private.market_reconciliation_context_v1(
    p_reconciliation_id, candle.source_block_evidence_id,
    candle.source_block_hash
  );
  if context.run_id is null
     or p_reorg_generation < 0
     or p_projector_version is null
     or pg_catalog.octet_length(p_projector_version) not between 1 and 128
     or p_projector_version !~ '^[A-Za-z0-9][A-Za-z0-9._+:/-]*$'
     or pg_catalog.octet_length(p_membership_commitment) <> 32
     or candle.chain_id <> context.chain_id
     or not programmable_private.market_fact_reconciliation_usable_v1(
       candle.reconciliation_id, p_reconciliation_id
     )
     or not exists (
       select 1
       from programmable_private.launch_by_token_v2 as launch
       where launch.chain_id = context.chain_id
         and launch.release_id = context.release_id
         and launch.model_id = context.model_id
         and launch.source_group = context.source_group
         and launch.epoch_id = context.epoch_id
         and launch.pointer_generation = context.pointer_generation
         and launch.pool_id = candle.pool_id
     )
  then
    raise exception using
      errcode = '23514', message = 'invalid candle lineage membership';
  end if;
  select membership.* into existing
  from programmable_private.market_candle_lineage_memberships as membership
  where membership.chain_id = context.chain_id
    and membership.release_id = context.release_id
    and membership.model_id = context.model_id
    and membership.source_group = context.source_group
    and membership.projector_version = p_projector_version
    and membership.pool_id = candle.pool_id
    and membership.reorg_generation = p_reorg_generation
    and membership.market_candle_id = p_market_candle_id;
  if found then
    if (
      select audit.input_commitment
      from programmable_private.mutation_audits as audit
      where audit.audit_id = existing.audit_id
    ) <> p_membership_commitment
    then
      raise exception using
        errcode = '23505', message = 'candle lineage replay conflict';
    end if;
    return p_market_candle_id;
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    'market_candle_lineage.attach', p_membership_commitment,
    context.run_id, p_attached_at
  );
  insert into programmable_private.market_candle_lineage_memberships (
    chain_id, release_id, model_id, source_group, projector_version,
    pool_id, reorg_generation, market_candle_id,
    attached_reconciliation_id, attached_at, audit_id
  ) values (
    context.chain_id,
    context.release_id::programmable_private.release_identifier,
    context.model_id::programmable_private.model_identifier,
    context.source_group::programmable_private.source_identifier,
    p_projector_version::programmable_private.projector_identifier,
    candle.pool_id, p_reorg_generation, p_market_candle_id,
    p_reconciliation_id, p_attached_at, created_audit_id
  );
  return p_market_candle_id;
end
$function$;

create function programmable_private.append_market_snapshot_v2(
  p_market_snapshot_id uuid,
  p_reconciliation_id uuid,
  p_source_deployment_id uuid,
  p_block_evidence_id uuid,
  p_pool_id bytea,
  p_block_number numeric,
  p_block_hash bytea,
  p_sqrt_price_x96 numeric,
  p_liquidity numeric,
  p_market_volume_token0 numeric,
  p_market_volume_token1 numeric,
  p_market_volume_usd numeric,
  p_hook_gross_volume numeric,
  p_observed_at timestamptz,
  p_input_commitment bytea
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  existing programmable_private.market_snapshots%rowtype;
  context record;
  normalized_sqrt numeric;
  normalized_liquidity numeric;
  normalized_hook_volume numeric;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into context
  from programmable_private.market_reconciliation_context_v1(
    p_reconciliation_id, p_block_evidence_id, p_block_hash
  );
  normalized_sqrt := programmable_private.validate_uint256(p_sqrt_price_x96);
  normalized_liquidity := programmable_private.validate_uint256(p_liquidity);
  if p_hook_gross_volume is not null then
    normalized_hook_volume :=
      programmable_private.validate_uint256(p_hook_gross_volume);
  end if;
  select candidate.* into existing
  from programmable_private.market_snapshots as candidate
  where candidate.market_snapshot_id = p_market_snapshot_id;
  if found then
    if context.run_id is null
       or not programmable_private.market_fact_reconciliation_usable_v1(
         existing.reconciliation_id, p_reconciliation_id
       )
       or existing.chain_id <> context.chain_id
       or existing.source_deployment_id <> p_source_deployment_id
       or existing.block_evidence_id <> p_block_evidence_id
       or existing.pool_id <> p_pool_id
       or existing.block_number <> p_block_number
       or existing.block_hash <> p_block_hash
       or existing.sqrt_price_x96 <> normalized_sqrt
       or existing.liquidity <> normalized_liquidity
       or existing.market_volume_token0 <> p_market_volume_token0
       or existing.market_volume_token1 <> p_market_volume_token1
       or existing.market_volume_usd is distinct from p_market_volume_usd
       or existing.hook_gross_volume is distinct from normalized_hook_volume
       or existing.observed_at <> p_observed_at
       or (
         select audit.input_commitment
         from programmable_private.mutation_audits as audit
         where audit.audit_id = existing.audit_id
       ) <> p_input_commitment
    then
      raise exception using
        errcode = '23505', message = 'market snapshot replay changed content';
    end if;
    return p_market_snapshot_id;
  end if;
  return programmable_private.append_market_snapshot(
    p_market_snapshot_id, p_reconciliation_id, p_source_deployment_id,
    p_block_evidence_id, p_pool_id, p_block_number, p_block_hash,
    p_sqrt_price_x96, p_liquidity, p_market_volume_token0,
    p_market_volume_token1, p_market_volume_usd, p_hook_gross_volume,
    p_observed_at, p_input_commitment
  );
end
$function$;

create function programmable_private.append_market_candle_v2(
  p_market_candle_id uuid,
  p_reconciliation_id uuid,
  p_source_deployment_id uuid,
  p_source_block_evidence_id uuid,
  p_pool_id bytea,
  p_interval text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_open numeric,
  p_high numeric,
  p_low numeric,
  p_close numeric,
  p_volume_token0 numeric,
  p_volume_token1 numeric,
  p_volume_usd numeric,
  p_source_block_hash bytea,
  p_input_commitment bytea
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  existing programmable_private.market_candles%rowtype;
  context record;
  requested_interval programmable_private.market_interval;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into context
  from programmable_private.market_reconciliation_context_v1(
    p_reconciliation_id, p_source_block_evidence_id, p_source_block_hash
  );
  requested_interval := p_interval::programmable_private.market_interval;
  select candidate.* into existing
  from programmable_private.market_candles as candidate
  where candidate.market_candle_id = p_market_candle_id;
  if found then
    if context.run_id is null
       or not programmable_private.market_fact_reconciliation_usable_v1(
         existing.reconciliation_id, p_reconciliation_id
       )
       or existing.chain_id <> context.chain_id
       or existing.source_deployment_id <> p_source_deployment_id
       or existing.source_block_evidence_id <> p_source_block_evidence_id
       or existing.source_block_number <> context.block_number
       or existing.pool_id <> p_pool_id
       or existing.interval <> requested_interval
       or existing.period_start <> p_period_start
       or existing.period_end <> p_period_end
       or existing.open <> p_open
       or existing.high <> p_high
       or existing.low <> p_low
       or existing.close <> p_close
       or existing.volume_token0 <> p_volume_token0
       or existing.volume_token1 <> p_volume_token1
       or existing.volume_usd is distinct from p_volume_usd
       or existing.source_block_hash <> p_source_block_hash
       or (
         select audit.input_commitment
         from programmable_private.mutation_audits as audit
         where audit.audit_id = existing.audit_id
       ) <> p_input_commitment
    then
      raise exception using
        errcode = '23505', message = 'market candle replay changed content';
    end if;
    return p_market_candle_id;
  end if;
  return programmable_private.append_market_candle(
    p_market_candle_id, p_reconciliation_id, p_source_deployment_id,
    p_source_block_evidence_id, p_pool_id, p_interval, p_period_start,
    p_period_end, p_open, p_high, p_low, p_close, p_volume_token0,
    p_volume_token1, p_volume_usd, p_source_block_hash,
    p_input_commitment
  );
end
$function$;

-- V1 allowed a market fact to reuse any earlier ETH/USD observation from the
-- same release epoch. The projector requires an exact observation for the
-- fact's block, so V2 narrows the capability before delegating the append.
create function programmable_private.append_market_snapshot_details_v2(
  p_market_snapshot_id uuid,
  p_reconciliation_id uuid,
  p_projector_version text,
  p_reorg_generation bigint,
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
  context record;
  existing programmable_private.market_snapshot_details%rowtype;
  exact_global_id uuid;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select candidate.* into snapshot
  from programmable_private.market_snapshots as candidate
  where candidate.market_snapshot_id = p_market_snapshot_id;
  if snapshot.market_snapshot_id is null then
    raise exception using
      errcode = '23503', message = 'market snapshot is unavailable';
  end if;
  select * into context
  from programmable_private.market_reconciliation_context_v1(
    p_reconciliation_id, snapshot.block_evidence_id,
    snapshot.block_hash
  );
  select global_snapshot.global_market_snapshot_id into exact_global_id
  from programmable_private.global_eth_usd_snapshots as global_snapshot
  join programmable_private.reconciliation_records as global_reconciliation
    on global_reconciliation.reconciliation_id =
      global_snapshot.reconciliation_id
   and global_reconciliation.mismatch_count = 0
  join programmable_private.run_headers as global_run
    on global_run.run_id = global_reconciliation.run_id
   and global_run.run_kind = 'reconciliation'
  left join programmable_private.run_lifecycle_outcomes as global_outcome
    on global_outcome.run_id = global_run.run_id
  where global_snapshot.global_market_snapshot_id =
      p_global_market_snapshot_id
    and global_snapshot.chain_id = snapshot.chain_id
    and global_snapshot.release_id = context.release_id
    and global_snapshot.model_id = context.model_id
    and global_snapshot.source_group = context.source_group
    and global_snapshot.epoch_id = context.epoch_id
    and global_snapshot.pointer_generation = context.pointer_generation
    and global_snapshot.block_evidence_id = snapshot.block_evidence_id
    and global_snapshot.block_number = snapshot.block_number
    and global_snapshot.block_hash = snapshot.block_hash
    and (
      global_snapshot.reconciliation_id = p_reconciliation_id
      or global_outcome.status = 'succeeded'
    );
  if context.run_id is null
     or exact_global_id is null
     or not programmable_private.market_fact_reconciliation_usable_v1(
       snapshot.reconciliation_id, p_reconciliation_id
     )
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
    raise exception using
      errcode = '23514', message = 'snapshot lacks exact ETH/USD block evidence';
  end if;
  select detail.* into existing
  from programmable_private.market_snapshot_details as detail
  where detail.market_snapshot_id = p_market_snapshot_id;
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
      raise exception using
        errcode = '23505', message = 'market snapshot detail replay conflict';
    end if;
  else
    created_audit_id := programmable_private.append_mutation_audit(
      'market_snapshot_detail_v2.append', p_detail_commitment,
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
  end if;
  perform programmable_private.attach_market_snapshot_lineage_v1(
    p_reconciliation_id, p_projector_version, p_reorg_generation,
    p_market_snapshot_id, p_detail_commitment, p_recorded_at
  );
  return p_market_snapshot_id;
end
$function$;

create function programmable_private.append_market_block_close_v2(
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
  existing programmable_private.market_block_closes%rowtype;
  normalized_sqrt numeric;
  normalized_liquidity numeric;
  exact_global_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select candidate.* into evidence
  from programmable_private.dual_rpc_block_evidence as candidate
  where candidate.block_evidence_id = p_block_evidence_id;
  select * into context
  from programmable_private.market_reconciliation_context_v1(
    p_reconciliation_id, p_block_evidence_id, evidence.agreed_block_hash
  );
  select global_snapshot.global_market_snapshot_id into exact_global_id
  from programmable_private.global_eth_usd_snapshots as global_snapshot
  join programmable_private.reconciliation_records as global_reconciliation
    on global_reconciliation.reconciliation_id =
      global_snapshot.reconciliation_id
   and global_reconciliation.mismatch_count = 0
  join programmable_private.run_headers as global_run
    on global_run.run_id = global_reconciliation.run_id
   and global_run.run_kind = 'reconciliation'
  left join programmable_private.run_lifecycle_outcomes as global_outcome
    on global_outcome.run_id = global_run.run_id
  where global_snapshot.global_market_snapshot_id =
      p_global_market_snapshot_id
    and global_snapshot.chain_id = context.chain_id
    and global_snapshot.release_id = context.release_id
    and global_snapshot.model_id = context.model_id
    and global_snapshot.source_group = context.source_group
    and global_snapshot.epoch_id = context.epoch_id
    and global_snapshot.pointer_generation = context.pointer_generation
    and global_snapshot.block_evidence_id = p_block_evidence_id
    and global_snapshot.block_number = evidence.block_number
    and global_snapshot.block_hash = evidence.agreed_block_hash
    and (
      global_snapshot.reconciliation_id = p_reconciliation_id
      or global_outcome.status = 'succeeded'
    );
  select source_occurrence.* into occurrence
  from programmable_private.chain_event_occurrences as source_occurrence
  join programmable_private.chain_event_occurrence_materializations as materialization
    on materialization.occurrence_id = source_occurrence.occurrence_id
   and materialization.chain_id = context.chain_id
   and materialization.release_id = context.release_id
   and materialization.model_id = context.model_id
   and materialization.source_group = context.source_group
   and materialization.epoch_id = context.epoch_id
   and materialization.pointer_generation = context.pointer_generation
   and programmable_private.is_market_fee_event_v1(
     context.model_id, materialization.event_type
   )
  join programmable_private.chain_event_current_canonical as canonical
    on canonical.occurrence_id = source_occurrence.occurrence_id
   and canonical.logical_event_id = source_occurrence.logical_event_id
   and canonical.block_hash = source_occurrence.block_hash
  where source_occurrence.occurrence_id = p_last_source_occurrence_id
    and source_occurrence.chain_id = context.chain_id
    and source_occurrence.block_number = evidence.block_number
    and source_occurrence.block_hash = evidence.agreed_block_hash
    and pg_catalog.lower(materialization.decoded_payload ->> 'poolId') =
      '0x' || pg_catalog.encode(p_pool_id, 'hex');
  normalized_sqrt := programmable_private.validate_uint256(p_sqrt_price_x96);
  normalized_liquidity := programmable_private.validate_uint256(p_liquidity);
  if context.run_id is null
     or exact_global_id is null
     or occurrence.occurrence_id is null
     or not exists (
       select 1
       from programmable_private.provider_deployments as provider
       where provider.provider_deployment_id = p_source_deployment_id
         and provider.provider_type = 'uniswap_subgraph'
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
    raise exception using
      errcode = '23514', message = 'close lacks exact canonical block evidence';
  end if;
  select candidate.* into existing
  from programmable_private.market_block_closes as candidate
  where candidate.market_block_close_id = p_market_block_close_id;
  if found then
    if not programmable_private.market_fact_reconciliation_usable_v1(
         existing.reconciliation_id, p_reconciliation_id
       )
       or existing.chain_id <> context.chain_id
       or existing.release_id <> context.release_id
       or existing.model_id <> context.model_id
       or existing.source_group <> context.source_group
       or existing.epoch_id <> context.epoch_id
       or existing.pointer_generation <> context.pointer_generation
       or existing.pool_id <> p_pool_id
       or existing.source_deployment_id <> p_source_deployment_id
       or existing.block_evidence_id <> p_block_evidence_id
       or existing.block_number <> evidence.block_number
       or existing.block_hash <> evidence.agreed_block_hash
       or existing.block_timestamp <> occurrence.block_timestamp
       or existing.last_transaction_hash <> occurrence.transaction_hash
       or existing.last_transaction_index <> occurrence.transaction_index
       or existing.last_block_global_log_index <>
         occurrence.block_global_log_index
       or existing.last_source_occurrence_id <> occurrence.occurrence_id
       or existing.last_source_logical_event_id <> occurrence.logical_event_id
       or existing.last_source_occurrence_block_hash <> occurrence.block_hash
       or existing.sqrt_price_x96 <> normalized_sqrt
       or existing.liquidity <> normalized_liquidity
       or existing.tick <> p_tick
       or existing.token0_price <> p_token0_price
       or existing.token1_price <> p_token1_price
       or existing.volume_token0 <> p_volume_token0
       or existing.volume_token1 <> p_volume_token1
       or existing.volume_usd <> p_volume_usd
       or existing.fees_usd <> p_fees_usd
       or existing.tvl_usd <> p_tvl_usd
       or existing.transaction_count <> p_transaction_count
       or existing.global_market_snapshot_id <> p_global_market_snapshot_id
       or existing.source_query_commitment <> p_source_query_commitment
       or existing.close_commitment <> p_close_commitment
       or existing.observed_at <> p_observed_at
       or (
         select audit.input_commitment
         from programmable_private.mutation_audits as audit
         where audit.audit_id = existing.audit_id
       ) <> p_close_commitment
    then
      raise exception using
        errcode = '23505', message = 'market block close replay conflict';
    end if;
    return p_market_block_close_id;
  end if;
  return programmable_private.append_market_block_close_v1(
    p_market_block_close_id, p_reconciliation_id,
    p_source_deployment_id, p_block_evidence_id, p_pool_id,
    p_last_source_occurrence_id, p_sqrt_price_x96, p_liquidity,
    p_tick, p_token0_price, p_token1_price, p_volume_token0,
    p_volume_token1, p_volume_usd, p_fees_usd, p_tvl_usd,
    p_transaction_count, p_global_market_snapshot_id,
    p_source_query_commitment, p_close_commitment, p_observed_at
  );
end
$function$;

create function programmable_private.get_market_projector_cursor_v1(
  p_chain_id bigint,
  p_release_id text,
  p_model_id text,
  p_source_group text,
  p_projector_version text,
  p_pool_id bytea
)
returns table (
  market_cursor_id uuid,
  epoch_id uuid,
  pointer_generation bigint,
  cursor_generation bigint,
  reorg_generation bigint,
  source_checkpoint_id uuid,
  source_checkpoint_generation bigint,
  source_reorg_generation bigint,
  block_evidence_id uuid,
  block_number bigint,
  block_hash bytea,
  provider_cursor text,
  hour_coverage_end timestamptz,
  day_coverage_end timestamptz,
  page_commitment bytea,
  advanced_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_chain_id <= 0 or pg_catalog.octet_length(p_pool_id) <> 32 then
    raise exception using
      errcode = '22023', message = 'invalid market cursor identity';
  end if;
  return query
  select
    history.market_cursor_id,
    history.epoch_id,
    history.pointer_generation,
    history.cursor_generation,
    history.reorg_generation,
    history.source_checkpoint_id,
    history.source_checkpoint_generation,
    history.source_reorg_generation,
    history.block_evidence_id,
    history.block_number::bigint,
    history.block_hash::bytea,
    history.provider_cursor,
    history.hour_coverage_end,
    history.day_coverage_end,
    history.page_commitment::bytea,
    history.advanced_at
  from programmable_private.market_projector_cursor_current as current_cursor
  join programmable_private.market_projector_cursor_history as history
    on history.market_cursor_id = current_cursor.market_cursor_id
  where current_cursor.chain_id = p_chain_id
    and current_cursor.release_id = p_release_id
    and current_cursor.model_id = p_model_id
    and current_cursor.source_group = p_source_group
    and current_cursor.projector_version = p_projector_version
    and current_cursor.pool_id = p_pool_id;
end
$function$;

create function programmable_private.advance_market_projector_cursor_v1(
  p_market_cursor_id uuid,
  p_reconciliation_id uuid,
  p_source_projector_version text,
  p_market_projector_version text,
  p_pool_id bytea,
  p_expected_cursor_generation bigint,
  p_next_cursor_generation bigint,
  p_expected_reorg_generation bigint,
  p_next_reorg_generation bigint,
  p_source_checkpoint_id uuid,
  p_source_checkpoint_generation bigint,
  p_source_reorg_generation bigint,
  p_target_block_evidence_id uuid,
  p_target_block_number numeric,
  p_target_block_hash bytea,
  p_provider_cursor text,
  p_hour_coverage_end timestamptz,
  p_day_coverage_end timestamptz,
  p_page_commitment bytea,
  p_advanced_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  reconciliation programmable_private.reconciliation_records%rowtype;
  header programmable_private.run_headers%rowtype;
  source_checkpoint programmable_private.projector_checkpoints%rowtype;
  target_evidence programmable_private.dual_rpc_block_evidence%rowtype;
  current_pointer programmable_private.market_projector_cursor_current%rowtype;
  previous_cursor programmable_private.market_projector_cursor_history%rowtype;
  launch record;
  normalized_target bigint;
  is_rewind boolean;
  coverage_from_exclusive bigint;
  snapshot_backfill_audit_id uuid;
  candle_backfill_audit_id uuid;
  created_audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  if p_market_cursor_id is null
     or pg_catalog.octet_length(p_pool_id) <> 32
     or p_expected_cursor_generation < 0
     or p_next_cursor_generation <> p_expected_cursor_generation + 1
     or p_expected_reorg_generation < 0
     or p_next_reorg_generation < p_expected_reorg_generation
     or p_source_checkpoint_generation <= 0
     or p_source_reorg_generation < 0
     or p_target_block_number <> pg_catalog.trunc(p_target_block_number)
     or p_target_block_number < 0
     or p_target_block_number > 9223372036854775807
     or pg_catalog.octet_length(p_target_block_hash) <> 32
     or pg_catalog.octet_length(p_provider_cursor) not between 1 and 256
     or p_provider_cursor !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]*$'
     or pg_catalog.octet_length(p_page_commitment) <> 32
     or p_page_commitment = pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or (p_hour_coverage_end is not null and
       p_hour_coverage_end <> pg_catalog.date_trunc('hour', p_hour_coverage_end))
     or (p_day_coverage_end is not null and
       p_day_coverage_end <> pg_catalog.date_trunc('day', p_day_coverage_end))
  then
    raise exception using
      errcode = '22023', message = 'invalid market cursor CAS request';
  end if;
  normalized_target := p_target_block_number::bigint;
  select record.* into reconciliation
  from programmable_private.reconciliation_records as record
  where record.reconciliation_id = p_reconciliation_id
    and record.mismatch_count = 0;
  select run.* into header
  from programmable_private.run_headers as run
  where run.run_id = reconciliation.run_id
    and run.run_kind = 'reconciliation'
  for update;
  if header.run_id is null
     or exists (
       select 1 from programmable_private.run_lifecycle_outcomes as outcome
       where outcome.run_id = header.run_id
     )
     or normalized_target not between reconciliation.source_from_block
       and reconciliation.source_to_block
  then
    raise exception using
      errcode = '23514', message = 'market cursor lacks open exact reconciliation';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  select checkpoint.* into source_checkpoint
  from programmable_private.projector_checkpoint_current as current_checkpoint
  join programmable_private.projector_checkpoints as checkpoint
    on checkpoint.checkpoint_id = current_checkpoint.checkpoint_id
  where current_checkpoint.chain_id = header.chain_id
    and current_checkpoint.release_id = header.release_id
    and current_checkpoint.model_id = header.model_id
    and current_checkpoint.source_group = header.source_group
    and current_checkpoint.projector_version = p_source_projector_version
    and current_checkpoint.checkpoint_id = p_source_checkpoint_id
    and current_checkpoint.checkpoint_generation = p_source_checkpoint_generation
    and current_checkpoint.reorg_generation = p_source_reorg_generation;
  if source_checkpoint.checkpoint_id is null
     or source_checkpoint.epoch_id <> header.epoch_id
     or source_checkpoint.pointer_generation <>
       header.captured_pointer_generation
     or source_checkpoint.cursor_block_global_log_index <> 4294967295
     or source_checkpoint.cursor_candidate_id <> 'empty-page'
     or normalized_target > source_checkpoint.block_number
  then
    raise exception using
      errcode = '40001', message = 'stale market source checkpoint';
  end if;
  select evidence.* into target_evidence
  from programmable_private.dual_rpc_block_evidence as evidence
  where evidence.block_evidence_id = p_target_block_evidence_id
    and evidence.chain_id = header.chain_id
    and evidence.epoch_id = header.epoch_id
    and evidence.pointer_generation = header.captured_pointer_generation
    and evidence.block_number = normalized_target
    and evidence.agreed_block_hash = p_target_block_hash;
  if target_evidence.block_evidence_id is null then
    raise exception using
      errcode = '23514', message = 'market cursor target lacks exact block evidence';
  end if;
  select launch_row.* into launch
  from programmable_private.launch_by_token_v2 as launch_row
  where launch_row.chain_id = header.chain_id
    and launch_row.release_id = header.release_id
    and launch_row.model_id = header.model_id
    and launch_row.source_group = header.source_group
    and launch_row.epoch_id = header.epoch_id
    and launch_row.pointer_generation = header.captured_pointer_generation
    and launch_row.pool_id = p_pool_id;
  if launch.pool_id is null
     or normalized_target < launch.promoted_block_number
  then
    raise exception using
      errcode = '23503', message = 'market cursor pool is not a current launch';
  end if;
  select * into current_pointer
  from programmable_private.market_projector_cursor_current
  where chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and projector_version = p_market_projector_version
    and pool_id = p_pool_id
  for update;
  if found then
    if current_pointer.cursor_generation <> p_expected_cursor_generation
       or current_pointer.reorg_generation <> p_expected_reorg_generation
       or p_expected_cursor_generation = 0
    then
      raise exception using
        errcode = '40001', message = 'market cursor CAS lost';
    end if;
    select * into previous_cursor
    from programmable_private.market_projector_cursor_history
    where market_cursor_id = current_pointer.market_cursor_id;
    if previous_cursor.market_cursor_id is null then
      raise exception using
        errcode = '23503', message = 'market cursor history is missing';
    end if;
  elsif p_expected_cursor_generation <> 0
        or p_expected_reorg_generation <> 0
        or p_next_reorg_generation <> 0
  then
    raise exception using
      errcode = '40001', message = 'market cursor CAS lost';
  end if;
  is_rewind := previous_cursor.market_cursor_id is not null
    and p_next_reorg_generation > p_expected_reorg_generation;
  coverage_from_exclusive := case
    when previous_cursor.market_cursor_id is null or is_rewind
      then launch.promoted_block_number - 1
    when p_source_checkpoint_generation >
         previous_cursor.source_checkpoint_generation
      and source_checkpoint.block_number = previous_cursor.block_number
      then previous_cursor.block_number - 1
    else previous_cursor.block_number
  end;
  -- The first V2 cursor is the atomic cutover point for an already populated
  -- database. Preserve every complete legacy fact that is visible before the
  -- pointer exists, then fail closed if the backfill is incomplete. New/open
  -- facts are attached by the V2 detail append entrypoints.
  if previous_cursor.market_cursor_id is null then
    if exists (
      select 1
      from programmable_private.market_snapshots_v1 as snapshot
      join programmable_private.market_snapshot_details as detail
        on detail.market_snapshot_id = snapshot.market_snapshot_id
      where snapshot.chain_id = header.chain_id
        and snapshot.release_id = header.release_id
        and snapshot.model_id = header.model_id
        and snapshot.pool_id = p_pool_id
    ) then
      snapshot_backfill_audit_id := programmable_private.append_mutation_audit(
        'market_snapshot_lineage.backfill', p_page_commitment,
        header.run_id, p_advanced_at
      );
      insert into programmable_private.market_snapshot_lineage_memberships (
        chain_id, release_id, model_id, source_group, projector_version,
        pool_id, reorg_generation, market_snapshot_id,
        attached_reconciliation_id, attached_at, audit_id
      )
      select
        snapshot.chain_id,
        snapshot.release_id,
        snapshot.model_id,
        header.source_group,
        p_market_projector_version::programmable_private.projector_identifier,
        snapshot.pool_id,
        0,
        snapshot.market_snapshot_id,
        p_reconciliation_id,
        p_advanced_at,
        snapshot_backfill_audit_id
      from programmable_private.market_snapshots_v1 as snapshot
      join programmable_private.market_snapshot_details as detail
        on detail.market_snapshot_id = snapshot.market_snapshot_id
      where snapshot.chain_id = header.chain_id
        and snapshot.release_id = header.release_id
        and snapshot.model_id = header.model_id
        and snapshot.pool_id = p_pool_id
      on conflict do nothing;
    end if;
    if exists (
      select 1
      from programmable_private.market_candles_v1 as candle
      join programmable_private.market_candle_details as detail
        on detail.market_candle_id = candle.market_candle_id
      where candle.chain_id = header.chain_id
        and candle.release_id = header.release_id
        and candle.model_id = header.model_id
        and candle.pool_id = p_pool_id
    ) then
      candle_backfill_audit_id := programmable_private.append_mutation_audit(
        'market_candle_lineage.backfill', p_page_commitment,
        header.run_id, p_advanced_at
      );
      insert into programmable_private.market_candle_lineage_memberships (
        chain_id, release_id, model_id, source_group, projector_version,
        pool_id, reorg_generation, market_candle_id,
        attached_reconciliation_id, attached_at, audit_id
      )
      select
        candle.chain_id,
        candle.release_id,
        candle.model_id,
        header.source_group,
        p_market_projector_version::programmable_private.projector_identifier,
        candle.pool_id,
        0,
        candle.market_candle_id,
        p_reconciliation_id,
        p_advanced_at,
        candle_backfill_audit_id
      from programmable_private.market_candles_v1 as candle
      join programmable_private.market_candle_details as detail
        on detail.market_candle_id = candle.market_candle_id
      where candle.chain_id = header.chain_id
        and candle.release_id = header.release_id
        and candle.model_id = header.model_id
        and candle.pool_id = p_pool_id
      on conflict do nothing;
    end if;
    if exists (
      select 1
      from programmable_private.market_snapshots_v1 as snapshot
      join programmable_private.market_snapshot_details as detail
        on detail.market_snapshot_id = snapshot.market_snapshot_id
      where snapshot.chain_id = header.chain_id
        and snapshot.release_id = header.release_id
        and snapshot.model_id = header.model_id
        and snapshot.pool_id = p_pool_id
        and not exists (
          select 1
          from programmable_private.market_snapshot_lineage_memberships as membership
          where membership.chain_id = header.chain_id
            and membership.release_id = header.release_id
            and membership.model_id = header.model_id
            and membership.source_group = header.source_group
            and membership.projector_version = p_market_projector_version
            and membership.pool_id = p_pool_id
            and membership.reorg_generation = 0
            and membership.market_snapshot_id = snapshot.market_snapshot_id
        )
    ) or exists (
      select 1
      from programmable_private.market_candles_v1 as candle
      join programmable_private.market_candle_details as detail
        on detail.market_candle_id = candle.market_candle_id
      where candle.chain_id = header.chain_id
        and candle.release_id = header.release_id
        and candle.model_id = header.model_id
        and candle.pool_id = p_pool_id
        and not exists (
          select 1
          from programmable_private.market_candle_lineage_memberships as membership
          where membership.chain_id = header.chain_id
            and membership.release_id = header.release_id
            and membership.model_id = header.model_id
            and membership.source_group = header.source_group
            and membership.projector_version = p_market_projector_version
            and membership.pool_id = p_pool_id
            and membership.reorg_generation = 0
            and membership.market_candle_id = candle.market_candle_id
        )
    ) then
      raise exception using
        errcode = '23514', message = 'legacy market lineage backfill is incomplete';
    end if;
  end if;
  if previous_cursor.market_cursor_id is not null then
    if is_rewind then
      if p_next_reorg_generation <> p_expected_reorg_generation + 1
         or (
           header.epoch_id = previous_cursor.epoch_id
           and header.captured_pointer_generation <
             previous_cursor.pointer_generation
         )
         or not (
           header.epoch_id <> previous_cursor.epoch_id
           or header.captured_pointer_generation >
             previous_cursor.pointer_generation
           or p_source_reorg_generation >
             previous_cursor.source_reorg_generation
         )
      then
        raise exception using
          errcode = '23514', message = 'market rewind lacks a newer canonical generation';
      end if;
    elsif p_next_reorg_generation <> p_expected_reorg_generation
       or header.epoch_id <> previous_cursor.epoch_id
       or header.captured_pointer_generation <>
         previous_cursor.pointer_generation
       or p_source_reorg_generation <> previous_cursor.source_reorg_generation
       or p_source_checkpoint_generation <
         previous_cursor.source_checkpoint_generation
       or (
         p_source_checkpoint_generation =
           previous_cursor.source_checkpoint_generation
         and (normalized_target, p_provider_cursor) <= (
           previous_cursor.block_number::bigint,
           previous_cursor.provider_cursor
         )
       )
       or normalized_target < previous_cursor.block_number
       or (
         normalized_target = previous_cursor.block_number
         and p_target_block_hash <> previous_cursor.block_hash
       )
       or (
         p_hour_coverage_end is not null
         and previous_cursor.hour_coverage_end is not null
         and p_hour_coverage_end < previous_cursor.hour_coverage_end
       )
       or (
         p_day_coverage_end is not null
         and previous_cursor.day_coverage_end is not null
         and p_day_coverage_end < previous_cursor.day_coverage_end
       )
    then
      raise exception using
        errcode = '23514', message = 'market cursor did not advance canonically';
    end if;
  end if;
  if not exists (
    select 1
    from programmable_private.market_snapshots as snapshot
    join programmable_private.market_snapshot_details as detail
      on detail.market_snapshot_id = snapshot.market_snapshot_id
    join programmable_private.market_snapshot_lineage_memberships as membership
      on membership.chain_id = header.chain_id
     and membership.release_id = header.release_id
     and membership.model_id = header.model_id
     and membership.source_group = header.source_group
     and membership.projector_version = p_market_projector_version
     and membership.pool_id = p_pool_id
     and membership.reorg_generation = p_next_reorg_generation
     and membership.market_snapshot_id = snapshot.market_snapshot_id
     and programmable_private.market_fact_reconciliation_usable_v1(
       membership.attached_reconciliation_id, p_reconciliation_id
     )
    join programmable_private.global_eth_usd_snapshots as global_snapshot
      on global_snapshot.global_market_snapshot_id =
        detail.global_market_snapshot_id
    where snapshot.chain_id = header.chain_id
      and snapshot.pool_id = p_pool_id
      and snapshot.block_number = normalized_target
      and snapshot.block_hash = p_target_block_hash
      and programmable_private.market_fact_reconciliation_usable_v1(
        snapshot.reconciliation_id, p_reconciliation_id
      )
      and global_snapshot.block_evidence_id = snapshot.block_evidence_id
      and global_snapshot.block_number = snapshot.block_number
      and global_snapshot.block_hash = snapshot.block_hash
      and global_snapshot.chain_id = header.chain_id
      and global_snapshot.release_id = header.release_id
      and global_snapshot.model_id = header.model_id
      and global_snapshot.source_group = header.source_group
      and global_snapshot.epoch_id = header.epoch_id
      and global_snapshot.pointer_generation =
        header.captured_pointer_generation
  ) then
    raise exception using
      errcode = '23514', message = 'market cursor target lineage is incomplete';
  end if;
  if exists (
    select 1
    from programmable_private.market_snapshots as snapshot
    join programmable_private.market_snapshot_details as detail
      on detail.market_snapshot_id = snapshot.market_snapshot_id
    where snapshot.chain_id = header.chain_id
      and snapshot.pool_id = p_pool_id
      and snapshot.reconciliation_id = p_reconciliation_id
      and not exists (
        select 1
        from programmable_private.market_snapshot_lineage_memberships as membership
        where membership.chain_id = header.chain_id
          and membership.release_id = header.release_id
          and membership.model_id = header.model_id
          and membership.source_group = header.source_group
          and membership.projector_version = p_market_projector_version
          and membership.pool_id = p_pool_id
          and membership.reorg_generation = p_next_reorg_generation
          and membership.market_snapshot_id = snapshot.market_snapshot_id
          and membership.attached_reconciliation_id = p_reconciliation_id
      )
  ) or exists (
    select 1
    from programmable_private.market_candles as candle
    join programmable_private.market_candle_details as detail
      on detail.market_candle_id = candle.market_candle_id
    where candle.chain_id = header.chain_id
      and candle.pool_id = p_pool_id
      and candle.reconciliation_id = p_reconciliation_id
      and not exists (
        select 1
        from programmable_private.market_candle_lineage_memberships as membership
        where membership.chain_id = header.chain_id
          and membership.release_id = header.release_id
          and membership.model_id = header.model_id
          and membership.source_group = header.source_group
          and membership.projector_version = p_market_projector_version
          and membership.pool_id = p_pool_id
          and membership.reorg_generation = p_next_reorg_generation
          and membership.market_candle_id = candle.market_candle_id
          and membership.attached_reconciliation_id = p_reconciliation_id
      )
  ) then
    raise exception using
      errcode = '23514', message = 'market page lineage is incomplete';
  end if;
  if exists (
    select 1
    from (
      select distinct on (occurrence.block_number, occurrence.block_hash)
        occurrence.occurrence_id,
        occurrence.block_number,
        occurrence.block_hash
      from programmable_private.chain_event_occurrences as occurrence
      join programmable_private.chain_event_occurrence_materializations as materialization
        on materialization.occurrence_id = occurrence.occurrence_id
       and materialization.chain_id = header.chain_id
       and materialization.release_id = header.release_id
       and materialization.model_id = header.model_id
       and materialization.source_group = header.source_group
       and materialization.epoch_id = header.epoch_id
       and materialization.pointer_generation = header.captured_pointer_generation
       and programmable_private.is_market_fee_event_v1(
         header.model_id, materialization.event_type
       )
      join programmable_private.chain_event_current_canonical as canonical
        on canonical.occurrence_id = occurrence.occurrence_id
       and canonical.logical_event_id = occurrence.logical_event_id
       and canonical.block_hash = occurrence.block_hash
      where occurrence.chain_id = header.chain_id
        and occurrence.block_number > coverage_from_exclusive
        and occurrence.block_number <= normalized_target
        and pg_catalog.lower(materialization.decoded_payload ->> 'poolId') =
          '0x' || pg_catalog.encode(p_pool_id, 'hex')
      order by occurrence.block_number, occurrence.block_hash,
        occurrence.transaction_index desc,
        occurrence.block_global_log_index desc,
        occurrence.occurrence_id desc
    ) as required_close
    where not exists (
      select 1
      from programmable_private.market_block_closes as close_fact
      join programmable_private.reconciliation_records as close_reconciliation
        on close_reconciliation.reconciliation_id =
          close_fact.reconciliation_id
       and close_reconciliation.mismatch_count = 0
      join programmable_private.run_headers as close_run
        on close_run.run_id = close_reconciliation.run_id
       and close_run.run_kind = 'reconciliation'
      left join programmable_private.run_lifecycle_outcomes as close_outcome
        on close_outcome.run_id = close_run.run_id
      where close_fact.chain_id = header.chain_id
        and close_fact.release_id = header.release_id
        and close_fact.model_id = header.model_id
        and close_fact.source_group = header.source_group
        and close_fact.epoch_id = header.epoch_id
        and close_fact.pointer_generation = header.captured_pointer_generation
        and close_fact.pool_id = p_pool_id
        and close_fact.last_source_occurrence_id = required_close.occurrence_id
        and close_fact.block_number = required_close.block_number
        and close_fact.block_hash = required_close.block_hash
        and (
          close_fact.reconciliation_id = p_reconciliation_id
          or close_outcome.status = 'succeeded'
        )
    )
  ) then
    raise exception using
      errcode = '23514', message = 'market cursor coverage contains a close gap';
  end if;
  created_audit_id := programmable_private.append_mutation_audit(
    case when is_rewind then 'market_cursor.rewind'
      else 'market_cursor.advance' end,
    p_page_commitment, header.run_id, p_advanced_at
  );
  insert into programmable_private.market_projector_cursor_history (
    market_cursor_id, chain_id, release_id, model_id, source_group,
    projector_version, pool_id, epoch_id, pointer_generation,
    cursor_generation, reorg_generation, source_checkpoint_id,
    source_checkpoint_generation, source_reorg_generation,
    block_evidence_id, block_number, block_hash, provider_cursor,
    hour_coverage_end, day_coverage_end, page_commitment,
    reconciliation_id, advanced_at, audit_id
  ) values (
    p_market_cursor_id, header.chain_id, header.release_id,
    header.model_id, header.source_group,
    p_market_projector_version::programmable_private.projector_identifier,
    p_pool_id::programmable_private.bytes32_value,
    header.epoch_id, header.captured_pointer_generation,
    p_next_cursor_generation, p_next_reorg_generation,
    p_source_checkpoint_id, p_source_checkpoint_generation,
    p_source_reorg_generation, p_target_block_evidence_id,
    normalized_target::programmable_private.block_number_value,
    p_target_block_hash::programmable_private.bytes32_value,
    p_provider_cursor, p_hour_coverage_end, p_day_coverage_end,
    p_page_commitment::programmable_private.bytes32_value,
    p_reconciliation_id, p_advanced_at, created_audit_id
  );
  if p_expected_cursor_generation = 0 then
    insert into programmable_private.market_projector_cursor_current (
      chain_id, release_id, model_id, source_group, projector_version,
      pool_id, market_cursor_id, cursor_generation, reorg_generation,
      changed_at, changed_by_audit_id
    ) values (
      header.chain_id, header.release_id, header.model_id,
      header.source_group,
      p_market_projector_version::programmable_private.projector_identifier,
      p_pool_id::programmable_private.bytes32_value,
      p_market_cursor_id, p_next_cursor_generation,
      p_next_reorg_generation, p_advanced_at, created_audit_id
    ) on conflict (
      chain_id, release_id, model_id, source_group, projector_version, pool_id
    ) do nothing;
  else
    update programmable_private.market_projector_cursor_current
    set market_cursor_id = p_market_cursor_id,
        cursor_generation = p_next_cursor_generation,
        reorg_generation = p_next_reorg_generation,
        changed_at = p_advanced_at,
        changed_by_audit_id = created_audit_id
    where chain_id = header.chain_id
      and release_id = header.release_id
      and model_id = header.model_id
      and source_group = header.source_group
      and projector_version = p_market_projector_version
      and pool_id = p_pool_id
      and cursor_generation = p_expected_cursor_generation
      and reorg_generation = p_expected_reorg_generation;
  end if;
  if not found then
    raise exception using
      errcode = '40001', message = 'market cursor CAS lost';
  end if;
  return p_market_cursor_id;
end
$function$;

-- V1 required the candle and its closing block to be written by one
-- reconciliation. That prevents finalizing a candle after its closing block
-- was safely projected by an earlier run. V2 binds the exact current-epoch
-- close instead, while requiring it to be the last close in the period.
create function programmable_private.append_market_candle_details_v2(
  p_market_candle_id uuid,
  p_reconciliation_id uuid,
  p_projector_version text,
  p_reorg_generation bigint,
  p_closing_market_block_close_id uuid,
  p_fees_usd numeric,
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
    p_reconciliation_id, candle.source_block_evidence_id,
    candle.source_block_hash
  );
  select candidate.* into close_fact
  from programmable_private.market_block_closes as candidate
  join programmable_private.chain_event_current_canonical as canonical
    on canonical.occurrence_id = candidate.last_source_occurrence_id
   and canonical.logical_event_id = candidate.last_source_logical_event_id
   and canonical.block_hash = candidate.last_source_occurrence_block_hash
  join programmable_private.reconciliation_records as close_reconciliation
    on close_reconciliation.reconciliation_id = candidate.reconciliation_id
   and close_reconciliation.mismatch_count = 0
  join programmable_private.run_headers as close_run
    on close_run.run_id = close_reconciliation.run_id
   and close_run.run_kind = 'reconciliation'
  left join programmable_private.run_lifecycle_outcomes as close_outcome
    on close_outcome.run_id = close_run.run_id
  where candidate.market_block_close_id = p_closing_market_block_close_id
    and candidate.chain_id = candle.chain_id
    and candidate.release_id = context.release_id
    and candidate.model_id = context.model_id
    and candidate.source_group = context.source_group
    and candidate.epoch_id = context.epoch_id
    and candidate.pointer_generation = context.pointer_generation
    and candidate.pool_id = candle.pool_id
    and candidate.block_timestamp >= candle.period_start
    and candidate.block_timestamp < candle.period_end
    and (
      candidate.reconciliation_id = p_reconciliation_id
      or close_outcome.status = 'succeeded'
    );
  if candle.market_candle_id is null or context.run_id is null
     or close_fact.market_block_close_id is null
     or not programmable_private.market_fact_reconciliation_usable_v1(
       candle.reconciliation_id, p_reconciliation_id
     )
     or p_fees_usd < 0
     or p_fees_usd::text in ('NaN', 'Infinity', '-Infinity')
     or p_transaction_count < 0
     or pg_catalog.octet_length(p_detail_commitment) <> 32
     or exists (
       select 1
       from programmable_private.market_block_closes as later_close
       join programmable_private.chain_event_current_canonical as later_canonical
         on later_canonical.occurrence_id =
           later_close.last_source_occurrence_id
        and later_canonical.logical_event_id =
           later_close.last_source_logical_event_id
        and later_canonical.block_hash =
           later_close.last_source_occurrence_block_hash
       join programmable_private.reconciliation_records as later_reconciliation
         on later_reconciliation.reconciliation_id =
           later_close.reconciliation_id
        and later_reconciliation.mismatch_count = 0
       join programmable_private.run_headers as later_run
         on later_run.run_id = later_reconciliation.run_id
        and later_run.run_kind = 'reconciliation'
       left join programmable_private.run_lifecycle_outcomes as later_outcome
         on later_outcome.run_id = later_run.run_id
       where later_close.chain_id = candle.chain_id
         and later_close.release_id = context.release_id
         and later_close.model_id = context.model_id
         and later_close.source_group = context.source_group
         and later_close.epoch_id = context.epoch_id
         and later_close.pointer_generation = context.pointer_generation
         and later_close.pool_id = candle.pool_id
         and later_close.block_timestamp >= candle.period_start
         and later_close.block_timestamp < candle.period_end
         and (
           later_close.reconciliation_id = p_reconciliation_id
           or later_outcome.status = 'succeeded'
         )
         and (
           later_close.block_number,
           later_close.last_block_global_log_index,
           later_close.market_block_close_id
         ) > (
           close_fact.block_number,
           close_fact.last_block_global_log_index,
           close_fact.market_block_close_id
         )
     )
  then
    raise exception using
      errcode = '23514', message = 'invalid exact candle close detail';
  end if;
  select * into existing from programmable_private.market_candle_details
  where market_candle_id = p_market_candle_id;
  if found then
    if existing.closing_market_block_close_id <>
       p_closing_market_block_close_id
       or existing.fees_usd <> p_fees_usd
       or existing.transaction_count <> p_transaction_count
       or existing.detail_commitment <> p_detail_commitment
    then
      raise exception using
        errcode = '23505', message = 'market candle detail replay conflict';
    end if;
  else
    created_audit_id := programmable_private.append_mutation_audit(
      'market_candle_detail_v2.append', p_detail_commitment,
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
      p_fees_usd, p_transaction_count,
      close_fact.global_market_snapshot_id,
      p_detail_commitment::programmable_private.bytes32_value,
      created_audit_id
    );
  end if;
  perform programmable_private.attach_market_candle_lineage_v1(
    p_reconciliation_id, p_projector_version, p_reorg_generation,
    p_market_candle_id, p_detail_commitment, p_recorded_at
  );
  return p_market_candle_id;
end
$function$;

revoke all on programmable_private.market_projector_cursor_history,
  programmable_private.market_projector_cursor_current,
  programmable_private.market_snapshot_lineage_memberships,
  programmable_private.market_candle_lineage_memberships,
  programmable_private.market_projector_runtime_lease_current,
  programmable_private.market_projector_runtime_lease_history
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_projector_runtime;

revoke all on function
  programmable_private.try_acquire_market_projector_runtime_lease_v1(
    text,bytea,timestamptz,timestamptz,bytea
  ),
  programmable_private.assert_market_projector_runtime_lease_v1(
    text,bigint,bytea
  ),
  programmable_private.release_market_projector_runtime_lease_v1(
    text,bigint,bytea,timestamptz,bytea
  ),
  programmable_private.resolve_market_graph_provider_v1(text,bytea,bytea),
  programmable_private.list_market_projector_pools_v1(
    bigint,text,text,text,text,text,integer
  ),
  programmable_private.resolve_market_block_evidence_v1(
    uuid,numeric,bytea,uuid,uuid
  ),
  programmable_private.resolve_market_close_anchor_v1(
    uuid,bytea,numeric,bytea
  ),
  programmable_private.get_market_block_evidence_context_v1(uuid,uuid),
  programmable_private.get_market_global_snapshot_v1(uuid,uuid),
  programmable_private.list_market_close_anchors_v1(
    bigint,text,text,text,text,bytea,numeric,numeric,integer,numeric
  ),
  programmable_private.resolve_market_candle_close_v1(
    uuid,bytea,timestamptz,timestamptz
  ),
  programmable_private.append_market_snapshot_v2(
    uuid,uuid,uuid,uuid,bytea,numeric,bytea,numeric,numeric,numeric,
    numeric,numeric,numeric,timestamptz,bytea
  ),
  programmable_private.append_market_snapshot_details_v2(
    uuid,uuid,text,bigint,uuid,integer,numeric,numeric,numeric,numeric,
    numeric,bigint,bytea,timestamptz
  ),
  programmable_private.append_market_block_close_v2(
    uuid,uuid,uuid,uuid,bytea,uuid,numeric,numeric,integer,numeric,
    numeric,numeric,numeric,numeric,numeric,numeric,bigint,uuid,
    bytea,bytea,timestamptz
  ),
  programmable_private.get_market_projector_cursor_v1(
    bigint,text,text,text,text,bytea
  ),
  programmable_private.advance_market_projector_cursor_v1(
    uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,
    bigint,uuid,numeric,bytea,text,timestamptz,timestamptz,bytea,timestamptz
  ),
  programmable_private.append_market_candle_v2(
    uuid,uuid,uuid,uuid,bytea,text,timestamptz,timestamptz,numeric,
    numeric,numeric,numeric,numeric,numeric,numeric,bytea,bytea
  ),
  programmable_private.append_market_candle_details_v2(
    uuid,uuid,text,bigint,uuid,numeric,bigint,bytea,timestamptz
  )
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_projector_runtime;

-- The wider V1 append capabilities accept earlier price observations and are
-- not part of the exact-block market projector contract.
revoke execute on function
  programmable_private.append_market_snapshot_details_v1(
    uuid,uuid,integer,numeric,numeric,numeric,numeric,numeric,
    bigint,bytea,timestamptz
  ),
  programmable_private.append_market_block_close_v1(
    uuid,uuid,uuid,uuid,bytea,uuid,numeric,numeric,integer,numeric,
    numeric,numeric,numeric,numeric,numeric,numeric,bigint,uuid,
    bytea,bytea,timestamptz
  ),
  programmable_private.append_market_candle_details_v1(
    uuid,uuid,bytea,timestamptz
  )
from programmable_reconciler;

revoke all on function
  programmable_private.is_market_fee_event_v1(text,text),
  programmable_private.market_fact_reconciliation_usable_v1(uuid,uuid),
  programmable_private.attach_market_snapshot_lineage_v1(
    uuid,text,bigint,uuid,bytea,timestamptz
  ),
  programmable_private.attach_market_candle_lineage_v1(
    uuid,text,bigint,uuid,bytea,timestamptz
  )
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_projector_runtime;

grant execute on function
  programmable_private.try_acquire_market_projector_runtime_lease_v1(
    text,bytea,timestamptz,timestamptz,bytea
  ),
  programmable_private.assert_market_projector_runtime_lease_v1(
    text,bigint,bytea
  ),
  programmable_private.release_market_projector_runtime_lease_v1(
    text,bigint,bytea,timestamptz,bytea
  ),
  programmable_private.resolve_market_graph_provider_v1(text,bytea,bytea),
  programmable_private.list_market_projector_pools_v1(
    bigint,text,text,text,text,text,integer
  ),
  programmable_private.resolve_market_block_evidence_v1(
    uuid,numeric,bytea,uuid,uuid
  ),
  programmable_private.resolve_market_close_anchor_v1(
    uuid,bytea,numeric,bytea
  ),
  programmable_private.get_market_block_evidence_context_v1(uuid,uuid),
  programmable_private.get_market_global_snapshot_v1(uuid,uuid),
  programmable_private.list_market_close_anchors_v1(
    bigint,text,text,text,text,bytea,numeric,numeric,integer,numeric
  ),
  programmable_private.resolve_market_candle_close_v1(
    uuid,bytea,timestamptz,timestamptz
  ),
  programmable_private.append_market_snapshot_v2(
    uuid,uuid,uuid,uuid,bytea,numeric,bytea,numeric,numeric,numeric,
    numeric,numeric,numeric,timestamptz,bytea
  ),
  programmable_private.append_market_snapshot_details_v2(
    uuid,uuid,text,bigint,uuid,integer,numeric,numeric,numeric,numeric,
    numeric,bigint,bytea,timestamptz
  ),
  programmable_private.append_market_block_close_v2(
    uuid,uuid,uuid,uuid,bytea,uuid,numeric,numeric,integer,numeric,
    numeric,numeric,numeric,numeric,numeric,numeric,bigint,uuid,
    bytea,bytea,timestamptz
  ),
  programmable_private.get_market_projector_cursor_v1(
    bigint,text,text,text,text,bytea
  ),
  programmable_private.advance_market_projector_cursor_v1(
    uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,
    bigint,uuid,numeric,bytea,text,timestamptz,timestamptz,bytea,timestamptz
  ),
  programmable_private.append_market_candle_v2(
    uuid,uuid,uuid,uuid,bytea,text,timestamptz,timestamptz,numeric,
    numeric,numeric,numeric,numeric,numeric,numeric,bytea,bytea
  ),
  programmable_private.append_market_candle_details_v2(
    uuid,uuid,text,bigint,uuid,numeric,bigint,bytea,timestamptz
  )
to programmable_reconciler;

reset role;
