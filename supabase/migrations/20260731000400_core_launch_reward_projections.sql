-- Rebuildable projections remain invisible until an atomic, fenced
-- publication binds them to a terminal run outcome and checkpoint.

set role programmable_migrator;

create table programmable_private.launch_projections (
  launch_projection_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  token programmable_private.eth_address not null,
  creator programmable_private.eth_address not null,
  launch_transaction_hash programmable_private.bytes32_value not null,
  pool_id programmable_private.bytes32_value not null,
  reward_vault programmable_private.eth_address,
  launch_hash programmable_private.bytes32_value not null,
  token_name text not null check (pg_catalog.octet_length(token_name) between 1 and 128),
  token_symbol text not null check (pg_catalog.octet_length(token_symbol) between 1 and 32),
  total_supply programmable_private.uint256_value not null,
  last_source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  last_source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  last_source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  is_complete boolean not null,
  foreign key (projection_run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    )
    on delete restrict,
  foreign key (
    last_source_occurrence_id, last_source_logical_event_id,
    last_source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  unique (chain_id, release_id, token, projection_run_id)
);

create index launch_projection_recent_idx
  on programmable_private.launch_projections (
    chain_id, promoted_block_number desc, launch_transaction_hash desc, token
  );
create index launch_projection_creator_recent_idx
  on programmable_private.launch_projections (
    chain_id, creator, promoted_block_number desc, token
  );
create index launch_projection_lookup_idx
  on programmable_private.launch_projections (
    chain_id, launch_transaction_hash, creator
  );

create table programmable_private.pool_projections (
  pool_projection_id uuid primary key,
  launch_projection_id uuid not null
    references programmable_private.launch_projections(launch_projection_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  pool_id programmable_private.bytes32_value not null,
  currency0 programmable_private.eth_address not null,
  currency1 programmable_private.eth_address not null,
  pool_key_fee bigint not null check (pool_key_fee between 0 and 16777215),
  tick_spacing integer not null,
  hook programmable_private.eth_address not null,
  last_source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  last_source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  last_source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  unique (chain_id, pool_id, projection_run_id),
  foreign key (
    last_source_occurrence_id, last_source_logical_event_id,
    last_source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict
);

create index pool_projection_token_pair_idx
  on programmable_private.pool_projections (chain_id, currency0, currency1, pool_id);

create table programmable_private.pool_fee_configurations (
  pool_fee_configuration_id uuid primary key,
  pool_projection_id uuid not null
    references programmable_private.pool_projections(pool_projection_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  buy_swap_fee_bps programmable_private.basis_points not null,
  sell_swap_fee_bps programmable_private.basis_points not null,
  buy_creator_fee_bps programmable_private.basis_points not null,
  sell_creator_fee_bps programmable_private.basis_points not null,
  creator_fee_bps programmable_private.basis_points,
  launcher_fee_bps programmable_private.basis_points not null,
  transfer_tax_bps programmable_private.basis_points not null,
  lp_fee_pips bigint not null check (lp_fee_pips between 0 and 1000000),
  disclosure_source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  disclosure_source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  disclosure_source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    disclosure_source_occurrence_id, disclosure_source_logical_event_id,
    disclosure_source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  check (
    (buy_creator_fee_bps = sell_creator_fee_bps
      and creator_fee_bps = buy_creator_fee_bps)
    or (buy_creator_fee_bps <> sell_creator_fee_bps
      and creator_fee_bps is null)
  ),
  unique (pool_projection_id, projection_run_id)
);

create table programmable_private.fee_accrual_facts (
  fee_accrual_fact_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  pool_id programmable_private.bytes32_value not null,
  quote_asset programmable_private.eth_address,
  gross_amount programmable_private.uint256_value not null,
  creator_fee programmable_private.uint256_value not null,
  launcher_fee programmable_private.uint256_value not null,
  source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  check (creator_fee + launcher_fee <= gross_amount),
  unique (source_occurrence_id, projection_run_id)
);

create index fee_accrual_pool_block_idx
  on programmable_private.fee_accrual_facts (
    chain_id, pool_id, promoted_block_number, source_occurrence_id
  );

create table programmable_private.pool_fee_totals (
  pool_fee_total_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  pool_id programmable_private.bytes32_value not null,
  quote_asset programmable_private.eth_address,
  gross_total programmable_private.uint256_value not null,
  creator_fee_total programmable_private.uint256_value not null,
  launcher_fee_total programmable_private.uint256_value not null,
  last_source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  last_source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  last_source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    last_source_occurrence_id, last_source_logical_event_id,
    last_source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  check (creator_fee_total + launcher_fee_total <= gross_total),
  unique (chain_id, pool_id, quote_asset, projection_run_id)
);

create table programmable_private.reward_vault_projections (
  reward_vault_projection_id uuid primary key,
  launch_projection_id uuid not null
    references programmable_private.launch_projections(launch_projection_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  vault programmable_private.eth_address not null,
  pool_id programmable_private.bytes32_value not null,
  quote_asset programmable_private.eth_address,
  configuration_hash programmable_private.bytes32_value not null,
  current_allocation_fact_id uuid not null
    references programmable_private.reward_allocation_facts(allocation_fact_id)
    on delete restrict,
  last_source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  last_source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  last_source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    last_source_occurrence_id, last_source_logical_event_id,
    last_source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  unique (chain_id, vault, projection_run_id)
);

create index reward_vault_projection_pool_idx
  on programmable_private.reward_vault_projections (
    chain_id, pool_id, vault, promoted_block_number
  );

create table programmable_private.reward_allocation_projections (
  reward_allocation_projection_id uuid primary key,
  reward_vault_projection_id uuid not null
    references programmable_private.reward_vault_projections(reward_vault_projection_id)
    on delete restrict,
  allocation_fact_id uuid not null
    references programmable_private.reward_allocation_facts(allocation_fact_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  configuration_epoch bigint not null check (configuration_epoch > 0),
  allocation_index integer not null check (allocation_index >= 0),
  beneficiary programmable_private.eth_address not null,
  payout_address programmable_private.eth_address not null,
  share_bps programmable_private.basis_points not null check (share_bps > 0),
  effective_from_block programmable_private.block_number_value not null,
  effective_to_block bigint check (
    effective_to_block is null or effective_to_block >= 0
  ),
  last_source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  last_source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  last_source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    last_source_occurrence_id, last_source_logical_event_id,
    last_source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  check (effective_to_block is null or effective_to_block >= effective_from_block),
  unique (
    reward_vault_projection_id, configuration_epoch,
    allocation_index, projection_run_id
  )
);

create index reward_allocation_beneficiary_idx
  on programmable_private.reward_allocation_projections (
    beneficiary, effective_from_block desc, reward_vault_projection_id
  );

create table programmable_private.claim_projections (
  claim_projection_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  vault programmable_private.eth_address not null,
  claimant_kind programmable_private.source_identifier not null
    check (claimant_kind in ('beneficiary', 'creator', 'launcher')),
  beneficiary programmable_private.eth_address not null,
  recipient programmable_private.eth_address not null,
  amount programmable_private.uint256_value not null,
  beneficiary_total_claimed programmable_private.uint256_value not null,
  vault_total_received programmable_private.uint256_value not null,
  source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  unique (source_occurrence_id, projection_run_id)
);

create index claim_projection_beneficiary_idx
  on programmable_private.claim_projections (
    chain_id, beneficiary, promoted_block_number desc
  );

create table programmable_private.payout_change_projections (
  payout_change_projection_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  vault programmable_private.eth_address not null,
  beneficiary programmable_private.eth_address not null,
  previous_payout_address programmable_private.eth_address not null,
  new_payout_address programmable_private.eth_address not null,
  configuration_epoch bigint,
  source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  unique (source_occurrence_id, projection_run_id)
);

create table programmable_private.account_reward_balances (
  account_reward_balance_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  account programmable_private.eth_address not null,
  vault programmable_private.eth_address not null,
  claimable_accrued programmable_private.uint256_value not null,
  claimed_total programmable_private.uint256_value not null,
  last_source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  last_source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  last_source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    last_source_occurrence_id, last_source_logical_event_id,
    last_source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  unique (chain_id, account, vault, projection_run_id)
);

create index account_reward_balance_account_idx
  on programmable_private.account_reward_balances (
    chain_id, account, release_id, model_id, vault
  );

create table programmable_private.initial_buy_custody_projections (
  custody_projection_id uuid primary key,
  launch_projection_id uuid not null
    references programmable_private.launch_projections(launch_projection_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  custody_address programmable_private.eth_address not null,
  custody_mode smallint not null check (custody_mode between 0 and 255),
  duration_days integer not null check (duration_days between 0 and 65535),
  cliff_days integer not null check (cliff_days between 0 and 65535),
  configuration_hash programmable_private.bytes32_value not null,
  source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  unique (launch_projection_id, projection_run_id)
);

create table programmable_private.initial_buy_vesting_projections (
  vesting_projection_id uuid primary key,
  custody_projection_id uuid not null
    references programmable_private.initial_buy_custody_projections(custody_projection_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  beneficiary programmable_private.eth_address not null,
  token programmable_private.eth_address not null,
  amount programmable_private.uint256_value not null,
  vesting_start timestamptz not null,
  vesting_end timestamptz not null,
  source_occurrence_id uuid not null
    references programmable_private.chain_event_occurrences(occurrence_id)
    on delete restrict,
  source_logical_event_id uuid not null
    references programmable_private.chain_event_identities(logical_event_id)
    on delete restrict,
  source_occurrence_block_hash programmable_private.bytes32_value not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  verified_at timestamptz not null,
  foreign key (
    source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash
  ) references programmable_private.chain_event_occurrences(
    occurrence_id, logical_event_id, block_hash
  ) on delete restrict,
  check (vesting_end >= vesting_start),
  unique (custody_projection_id, beneficiary, projection_run_id)
);

create table programmable_private.projection_publications (
  publication_id uuid primary key,
  run_id uuid not null unique,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  checkpoint_id uuid not null
    references programmable_private.projector_checkpoints(checkpoint_id)
    on delete restrict,
  terminal_outcome_id uuid not null,
  target_block_number programmable_private.block_number_value not null,
  target_block_hash programmable_private.bytes32_value not null,
  published_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (terminal_outcome_id, run_id)
    references programmable_private.run_lifecycle_outcomes(outcome_id, run_id)
    on delete restrict,
  foreign key (run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    )
    on delete restrict
);

-- A publication advances only the entities present in its immutable delta.
-- These pointers keep unrelated prior versions visible without restaging the
-- entire release state.
create table programmable_private.projection_entity_current (
  entity_kind programmable_private.source_identifier not null,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  entity_key text not null check (pg_catalog.octet_length(entity_key) between 1 and 512),
  projection_row_id uuid not null,
  projection_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  publication_id uuid not null
    references programmable_private.projection_publications(publication_id)
    on delete restrict,
  checkpoint_id uuid not null
    references programmable_private.projector_checkpoints(checkpoint_id)
    on delete restrict,
  promoted_block_number programmable_private.block_number_value not null,
  promoted_block_hash programmable_private.bytes32_value not null,
  selected_at timestamptz not null,
  primary key (
    entity_kind, chain_id, release_id, model_id, source_group, entity_key
  )
);

create view programmable_private.current_launch_projections_v1
with (security_invoker = false, security_barrier = true)
as
select launch.*
from programmable_private.projection_entity_current as current_entity
join programmable_private.launch_projections as launch
  on launch.launch_projection_id = current_entity.projection_row_id
 and launch.projection_run_id = current_entity.projection_run_id
where current_entity.entity_kind = 'launch';

create view programmable_private.current_account_reward_balances_v1
with (security_invoker = false, security_barrier = true)
as
select balance.*
from programmable_private.projection_entity_current as current_entity
join programmable_private.account_reward_balances as balance
  on balance.account_reward_balance_id = current_entity.projection_row_id
 and balance.projection_run_id = current_entity.projection_run_id
where current_entity.entity_kind = 'account_reward_balance';

create view programmable_private.current_reward_vault_projections_v1
with (security_invoker = false, security_barrier = true)
as
select vault.*
from programmable_private.projection_entity_current as current_entity
join programmable_private.reward_vault_projections as vault
  on vault.reward_vault_projection_id = current_entity.projection_row_id
 and vault.projection_run_id = current_entity.projection_run_id
where current_entity.entity_kind = 'reward_vault';

create view programmable_private.current_pool_fee_totals_v1
with (security_invoker = false, security_barrier = true)
as
select fee_total.*
from programmable_private.projection_entity_current as current_entity
join programmable_private.pool_fee_totals as fee_total
  on fee_total.pool_fee_total_id = current_entity.projection_row_id
 and fee_total.projection_run_id = current_entity.projection_run_id
where current_entity.entity_kind = 'pool_fee_total';

create table programmable_private.projection_fold_manifests (
  run_id uuid primary key
    references programmable_private.run_headers(run_id)
    on delete restrict,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  target_block_number programmable_private.block_number_value not null,
  target_block_hash programmable_private.bytes32_value not null,
  ordered_occurrence_ids uuid[] not null,
  ordered_allocation_fact_ids uuid[] not null,
  ordered_allocation_evidence_ids uuid[] not null,
  ordered_candidate_disposition_ids uuid[] not null,
  ordered_route_keys text[] not null check (cardinality(ordered_route_keys) > 0),
  cursor_block_global_log_index
    programmable_private.block_log_index_value not null,
  cursor_candidate_id
    programmable_private.envio_candidate_identifier not null,
  ordered_projection_rows text[] not null
    check (cardinality(ordered_projection_rows) > 0),
  projection_row_count bigint not null check (projection_row_count > 0),
  result_commitment programmable_private.bytes32_value not null,
  created_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (run_id, epoch_id, pointer_generation)
    references programmable_private.run_headers(
      run_id, epoch_id, captured_pointer_generation
    ) on delete restrict,
  check (
    cardinality(ordered_allocation_fact_ids)
      = cardinality(ordered_allocation_evidence_ids)
  ),
  check (
    cardinality(ordered_occurrence_ids) > 0
      or cardinality(ordered_candidate_disposition_ids) > 0
  ),
  check (
    cardinality(ordered_projection_rows)::bigint = projection_row_count
  )
);

create table programmable_private.route_eligibility_history (
  route_eligibility_history_id uuid primary key,
  route_key programmable_private.source_identifier not null,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  status programmable_private.route_eligibility_status not null,
  route_mode programmable_private.route_mode not null,
  checkpoint_id uuid not null
    references programmable_private.projector_checkpoints(checkpoint_id)
    on delete restrict,
  reason_commitment programmable_private.bytes32_value not null,
  changed_by_run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  changed_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (
    route_key, chain_id, release_id, model_id, source_group,
    pointer_generation, changed_at
  )
);

create table programmable_private.route_eligibility_current (
  route_key programmable_private.source_identifier not null,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  source_group programmable_private.source_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  status programmable_private.route_eligibility_status not null,
  route_mode programmable_private.route_mode not null,
  checkpoint_id uuid not null
    references programmable_private.projector_checkpoints(checkpoint_id)
    on delete restrict,
  history_id uuid not null unique
    references programmable_private.route_eligibility_history(route_eligibility_history_id)
    on delete restrict,
  changed_at timestamptz not null,
  primary key (route_key, chain_id, release_id, model_id, source_group)
);

-- One scope check is shared by every dedicated projection writer.  It binds
-- the staged row to an open projection run and to an occurrence whose own
-- verification run belongs to the exact same source group.
create function programmable_private.projection_stage_context(
  p_run_id uuid,
  p_source_occurrence_id uuid,
  p_promoted_block_number numeric,
  p_promoted_block_hash bytea
)
returns table (
  chain_id programmable_private.chain_id_value,
  release_id programmable_private.release_identifier,
  model_id programmable_private.model_identifier,
  source_group programmable_private.source_identifier,
  epoch_id uuid,
  pointer_generation bigint,
  source_logical_event_id uuid,
  source_occurrence_block_hash programmable_private.bytes32_value,
  promoted_block_number programmable_private.block_number_value,
  promoted_block_hash programmable_private.bytes32_value
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  source programmable_private.chain_event_occurrences%rowtype;
  materialization programmable_private.chain_event_occurrence_materializations%rowtype;
  target_block bigint;
begin
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'projection'
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'invalid projection run';
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
  if p_promoted_block_number <> pg_catalog.trunc(p_promoted_block_number)
     or p_promoted_block_number < 0
     or p_promoted_block_number > 9223372036854775807
     or pg_catalog.octet_length(p_promoted_block_hash) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid projection target';
  end if;
  target_block := p_promoted_block_number::bigint;
  select * into source
  from programmable_private.chain_event_occurrences
  where occurrence_id = p_source_occurrence_id;
  select * into materialization
  from programmable_private.chain_event_occurrence_materializations
    as scoped_materialization
  where scoped_materialization.occurrence_id = p_source_occurrence_id
    and scoped_materialization.chain_id = header.chain_id
    and scoped_materialization.release_id = header.release_id
    and scoped_materialization.model_id = header.model_id
    and scoped_materialization.source_group = header.source_group
    and scoped_materialization.epoch_id = header.epoch_id
    and scoped_materialization.pointer_generation =
      header.captured_pointer_generation;
  if source.occurrence_id is null
     or source.chain_id <> header.chain_id
     or materialization.materialization_id is null
     or source.block_number > target_block
  then
    raise exception using errcode = '23503', message = 'projection source scope mismatch';
  end if;
  return query
  select header.chain_id, header.release_id, header.model_id,
         header.source_group, header.epoch_id,
         header.captured_pointer_generation, source.logical_event_id,
         source.block_hash, target_block::programmable_private.block_number_value,
         p_promoted_block_hash::programmable_private.bytes32_value;
end
$function$;

create function programmable_private.stage_launch_projection(
  p_launch_projection_id uuid,
  p_run_id uuid,
  p_token bytea,
  p_creator bytea,
  p_launch_transaction_hash bytea,
  p_pool_id bytea,
  p_reward_vault bytea,
  p_launch_hash bytea,
  p_token_name text,
  p_token_symbol text,
  p_total_supply numeric,
  p_last_source_occurrence_id uuid,
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
  source programmable_private.chain_event_occurrences%rowtype;
  scope record;
  supply numeric;
  block_number bigint;
  existing programmable_private.launch_projections%rowtype;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_last_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'projection'
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'invalid projection run';
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
  supply := programmable_private.validate_uint256(p_total_supply);
  if p_promoted_block_number <> pg_catalog.trunc(p_promoted_block_number)
     or p_promoted_block_number < 0
     or p_promoted_block_number > 9223372036854775807
     or pg_catalog.octet_length(p_token) <> 20
     or pg_catalog.octet_length(p_creator) <> 20
     or pg_catalog.octet_length(p_launch_transaction_hash) <> 32
     or pg_catalog.octet_length(p_pool_id) <> 32
     or (p_reward_vault is not null and pg_catalog.octet_length(p_reward_vault) <> 20)
     or pg_catalog.octet_length(p_launch_hash) <> 32
     or pg_catalog.octet_length(p_promoted_block_hash) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid launch projection';
  end if;
  block_number := p_promoted_block_number::bigint;
  select * into source
  from programmable_private.chain_event_occurrences
  where occurrence_id = p_last_source_occurrence_id;
  if not found or source.block_number > block_number
  then
    raise exception using errcode = '23503', message = 'projection source scope mismatch';
  end if;
  select * into existing
  from programmable_private.launch_projections
  where launch_projection_id = p_launch_projection_id;
  if found then
    if existing.projection_run_id <> p_run_id
       or existing.token <> p_token
       or existing.creator <> p_creator
       or existing.launch_transaction_hash <> p_launch_transaction_hash
       or existing.pool_id <> p_pool_id
       or existing.reward_vault is distinct from p_reward_vault
       or existing.launch_hash <> p_launch_hash
       or existing.token_name <> p_token_name
       or existing.token_symbol <> p_token_symbol
       or existing.total_supply <> supply
       or existing.last_source_occurrence_id <> p_last_source_occurrence_id
       or existing.promoted_block_number <> block_number
       or existing.promoted_block_hash <> p_promoted_block_hash
    then
      raise exception using errcode = '23505', message = 'launch projection replay changed content';
    end if;
    return existing.launch_projection_id;
  end if;
  insert into programmable_private.launch_projections (
    launch_projection_id, chain_id, release_id, model_id, epoch_id,
    pointer_generation, token, creator, launch_transaction_hash, pool_id,
    reward_vault, launch_hash, token_name, token_symbol, total_supply,
    last_source_logical_event_id, last_source_occurrence_id,
    last_source_occurrence_block_hash, projection_run_id,
    promoted_block_number, promoted_block_hash, verified_at, is_complete
  )
  values (
    p_launch_projection_id, header.chain_id, header.release_id, header.model_id,
    header.epoch_id, header.captured_pointer_generation,
    p_token::programmable_private.eth_address,
    p_creator::programmable_private.eth_address,
    p_launch_transaction_hash::programmable_private.bytes32_value,
    p_pool_id::programmable_private.bytes32_value,
    case when p_reward_vault is null then null
      else p_reward_vault::programmable_private.eth_address end,
    p_launch_hash::programmable_private.bytes32_value,
    p_token_name, p_token_symbol, supply,
    source.logical_event_id, source.occurrence_id, source.block_hash,
    p_run_id, block_number::programmable_private.block_number_value,
    p_promoted_block_hash::programmable_private.bytes32_value,
    p_verified_at, true
  );
  perform programmable_private.append_mutation_audit(
    'launch_projection.stage', p_launch_hash, p_run_id, p_verified_at
  );
  return p_launch_projection_id;
end
$function$;

create function programmable_private.stage_pool_projection(
  p_pool_projection_id uuid,
  p_launch_projection_id uuid,
  p_run_id uuid,
  p_currency0 bytea,
  p_currency1 bytea,
  p_pool_key_fee numeric,
  p_tick_spacing integer,
  p_hook bytea,
  p_last_source_occurrence_id uuid,
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
  launch programmable_private.launch_projections%rowtype;
  source programmable_private.chain_event_occurrences%rowtype;
  scope record;
  fee bigint;
  block_number bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_last_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  select * into launch
  from programmable_private.launch_projections
  where launch_projection_id = p_launch_projection_id
    and projection_run_id = p_run_id;
  if not found
     or launch.chain_id <> scope.chain_id
     or launch.release_id <> scope.release_id
     or launch.model_id <> scope.model_id
     or launch.epoch_id <> scope.epoch_id
     or launch.pointer_generation <> scope.pointer_generation
     or launch.promoted_block_number <> scope.promoted_block_number
     or launch.promoted_block_hash <> scope.promoted_block_hash
  then
    raise exception using errcode = '23503', message = 'missing staged launch';
  end if;
  if p_pool_key_fee <> pg_catalog.trunc(p_pool_key_fee)
     or p_pool_key_fee < 0 or p_pool_key_fee > 16777215
     or p_promoted_block_number <> pg_catalog.trunc(p_promoted_block_number)
     or p_promoted_block_number < 0
     or p_promoted_block_number > 9223372036854775807
     or pg_catalog.octet_length(p_currency0) <> 20
     or pg_catalog.octet_length(p_currency1) <> 20
     or p_currency0 >= p_currency1
     or (launch.token <> p_currency0 and launch.token <> p_currency1)
     or pg_catalog.octet_length(p_hook) <> 20
     or pg_catalog.octet_length(p_promoted_block_hash) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid PoolKey projection';
  end if;
  fee := p_pool_key_fee::bigint;
  block_number := p_promoted_block_number::bigint;
  select * into source
  from programmable_private.chain_event_occurrences
  where occurrence_id = p_last_source_occurrence_id;
  if not found or source.block_number > block_number then
    raise exception using errcode = '23503', message = 'pool source scope mismatch';
  end if;
  insert into programmable_private.pool_projections (
    pool_projection_id, launch_projection_id, chain_id, release_id, model_id,
    epoch_id, pointer_generation, pool_id, currency0, currency1, pool_key_fee,
    tick_spacing, hook, last_source_logical_event_id,
    last_source_occurrence_id, last_source_occurrence_block_hash,
    projection_run_id, promoted_block_number, promoted_block_hash, verified_at
  )
  values (
    p_pool_projection_id, p_launch_projection_id, launch.chain_id,
    launch.release_id, launch.model_id, launch.epoch_id,
    launch.pointer_generation, launch.pool_id,
    p_currency0::programmable_private.eth_address,
    p_currency1::programmable_private.eth_address,
    fee, p_tick_spacing, p_hook::programmable_private.eth_address,
    source.logical_event_id, source.occurrence_id, source.block_hash,
    p_run_id, block_number::programmable_private.block_number_value,
    p_promoted_block_hash::programmable_private.bytes32_value, p_verified_at
  )
  on conflict (pool_projection_id) do nothing;
  if not found and not exists (
    select 1 from programmable_private.pool_projections
    where pool_projection_id = p_pool_projection_id
      and launch_projection_id = p_launch_projection_id
      and projection_run_id = p_run_id
      and currency0 = p_currency0
      and currency1 = p_currency1
      and pool_key_fee = fee
      and tick_spacing = p_tick_spacing
      and hook = p_hook
      and last_source_occurrence_id = p_last_source_occurrence_id
      and promoted_block_number = block_number
      and promoted_block_hash = p_promoted_block_hash
  ) then
    raise exception using errcode = '23505', message = 'pool projection replay changed content';
  end if;
  perform programmable_private.append_mutation_audit(
    'pool_projection.stage', launch.launch_hash, p_run_id, p_verified_at
  );
  return p_pool_projection_id;
end
$function$;

create function programmable_private.stage_pool_fee_configuration(
  p_pool_fee_configuration_id uuid,
  p_pool_projection_id uuid,
  p_run_id uuid,
  p_buy_swap_fee_bps numeric,
  p_sell_swap_fee_bps numeric,
  p_creator_fee_bps numeric,
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
     or p_buy_swap_fee_bps is null
     or p_buy_swap_fee_bps <> pg_catalog.trunc(p_buy_swap_fee_bps)
     or p_buy_swap_fee_bps < 0 or p_buy_swap_fee_bps > 10000
     or p_sell_swap_fee_bps is null
     or p_sell_swap_fee_bps <> pg_catalog.trunc(p_sell_swap_fee_bps)
     or p_sell_swap_fee_bps < 0 or p_sell_swap_fee_bps > 10000
     or p_creator_fee_bps is null
     or p_creator_fee_bps <> pg_catalog.trunc(p_creator_fee_bps)
     or p_creator_fee_bps < 0 or p_creator_fee_bps > 10000
     or p_launcher_fee_bps is null
     or p_launcher_fee_bps <> pg_catalog.trunc(p_launcher_fee_bps)
     or p_launcher_fee_bps < 0 or p_launcher_fee_bps > 10000
     or p_transfer_tax_bps is null
     or p_transfer_tax_bps <> pg_catalog.trunc(p_transfer_tax_bps)
     or p_transfer_tax_bps < 0 or p_transfer_tax_bps > 10000
     or p_lp_fee_pips is null
     or p_lp_fee_pips <> pg_catalog.trunc(p_lp_fee_pips)
     or p_lp_fee_pips < 0 or p_lp_fee_pips > 1000000
  then
    raise exception using errcode = '23514', message = 'pool fee scope or values mismatch';
  end if;
  insert into programmable_private.pool_fee_configurations as target (
    pool_fee_configuration_id, pool_projection_id, chain_id, release_id,
    model_id, epoch_id, pointer_generation, buy_swap_fee_bps,
    sell_swap_fee_bps, buy_creator_fee_bps, sell_creator_fee_bps,
    creator_fee_bps, launcher_fee_bps, transfer_tax_bps,
    lp_fee_pips, disclosure_source_occurrence_id,
    disclosure_source_logical_event_id,
    disclosure_source_occurrence_block_hash, projection_run_id,
    promoted_block_number, promoted_block_hash, verified_at
  ) values (
    p_pool_fee_configuration_id, p_pool_projection_id, scope.chain_id,
    scope.release_id, scope.model_id, scope.epoch_id, scope.pointer_generation,
    p_buy_swap_fee_bps::programmable_private.basis_points,
    p_sell_swap_fee_bps::programmable_private.basis_points,
    p_creator_fee_bps::programmable_private.basis_points,
    p_creator_fee_bps::programmable_private.basis_points,
    p_creator_fee_bps::programmable_private.basis_points,
    p_launcher_fee_bps::programmable_private.basis_points,
    p_transfer_tax_bps::programmable_private.basis_points,
    p_lp_fee_pips::bigint, p_disclosure_source_occurrence_id,
    scope.source_logical_event_id, scope.source_occurrence_block_hash,
    p_run_id, scope.promoted_block_number, scope.promoted_block_hash,
    p_verified_at
  )
  on conflict (pool_fee_configuration_id) do update
    set pool_fee_configuration_id = excluded.pool_fee_configuration_id
    where target is not distinct from excluded
  returning pool_fee_configuration_id into returned_id;
  if returned_id is null then
    raise exception using errcode = '23505', message = 'pool fee replay changed immutable content';
  end if;
  perform programmable_private.append_mutation_audit(
    'pool_fee_configuration.stage', p_promoted_block_hash, p_run_id, p_verified_at
  );
  return returned_id;
end
$function$;

create function programmable_private.stage_fee_accrual_fact(
  p_fee_accrual_fact_id uuid,
  p_run_id uuid,
  p_pool_id bytea,
  p_quote_asset bytea,
  p_gross_amount numeric,
  p_creator_fee numeric,
  p_launcher_fee numeric,
  p_source_occurrence_id uuid,
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
  gross numeric;
  creator_amount numeric;
  launcher_amount numeric;
  returned_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  gross := programmable_private.validate_uint256(p_gross_amount);
  creator_amount := programmable_private.validate_uint256(p_creator_fee);
  launcher_amount := programmable_private.validate_uint256(p_launcher_fee);
  if pg_catalog.octet_length(p_pool_id) <> 32
     or (p_quote_asset is not null and pg_catalog.octet_length(p_quote_asset) <> 20)
     or creator_amount + launcher_amount > gross
  then
    raise exception using errcode = '22023', message = 'invalid fee accrual';
  end if;
  insert into programmable_private.fee_accrual_facts as target (
    fee_accrual_fact_id, chain_id, release_id, model_id, epoch_id,
    pointer_generation, pool_id, quote_asset, gross_amount, creator_fee,
    launcher_fee, source_occurrence_id, source_logical_event_id,
    source_occurrence_block_hash, projection_run_id, promoted_block_number,
    promoted_block_hash, verified_at
  ) values (
    p_fee_accrual_fact_id, scope.chain_id, scope.release_id, scope.model_id,
    scope.epoch_id, scope.pointer_generation,
    p_pool_id::programmable_private.bytes32_value,
    case when p_quote_asset is null then null
      else p_quote_asset::programmable_private.eth_address end,
    gross, creator_amount, launcher_amount, p_source_occurrence_id,
    scope.source_logical_event_id, scope.source_occurrence_block_hash,
    p_run_id, scope.promoted_block_number, scope.promoted_block_hash,
    p_verified_at
  )
  on conflict (fee_accrual_fact_id) do update
    set fee_accrual_fact_id = excluded.fee_accrual_fact_id
    where target is not distinct from excluded
  returning fee_accrual_fact_id into returned_id;
  if returned_id is null then
    raise exception using errcode = '23505', message = 'fee accrual replay changed immutable content';
  end if;
  perform programmable_private.append_mutation_audit(
    'fee_accrual.stage', p_promoted_block_hash, p_run_id, p_verified_at
  );
  return returned_id;
end
$function$;

create function programmable_private.stage_pool_fee_total(
  p_pool_fee_total_id uuid,
  p_run_id uuid,
  p_pool_id bytea,
  p_quote_asset bytea,
  p_gross_total numeric,
  p_creator_fee_total numeric,
  p_launcher_fee_total numeric,
  p_last_source_occurrence_id uuid,
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
  gross numeric;
  creator_amount numeric;
  launcher_amount numeric;
  returned_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_last_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  gross := programmable_private.validate_uint256(p_gross_total);
  creator_amount := programmable_private.validate_uint256(p_creator_fee_total);
  launcher_amount := programmable_private.validate_uint256(p_launcher_fee_total);
  if pg_catalog.octet_length(p_pool_id) <> 32
     or (p_quote_asset is not null and pg_catalog.octet_length(p_quote_asset) <> 20)
     or creator_amount + launcher_amount > gross
  then
    raise exception using errcode = '22023', message = 'invalid pool fee total';
  end if;
  insert into programmable_private.pool_fee_totals as target (
    pool_fee_total_id, chain_id, release_id, model_id, epoch_id,
    pointer_generation, pool_id, quote_asset, gross_total, creator_fee_total,
    launcher_fee_total, last_source_occurrence_id,
    last_source_logical_event_id, last_source_occurrence_block_hash,
    projection_run_id, promoted_block_number, promoted_block_hash, verified_at
  ) values (
    p_pool_fee_total_id, scope.chain_id, scope.release_id, scope.model_id,
    scope.epoch_id, scope.pointer_generation,
    p_pool_id::programmable_private.bytes32_value,
    case when p_quote_asset is null then null
      else p_quote_asset::programmable_private.eth_address end,
    gross, creator_amount, launcher_amount, p_last_source_occurrence_id,
    scope.source_logical_event_id, scope.source_occurrence_block_hash,
    p_run_id, scope.promoted_block_number, scope.promoted_block_hash,
    p_verified_at
  )
  on conflict (pool_fee_total_id) do update
    set pool_fee_total_id = excluded.pool_fee_total_id
    where target is not distinct from excluded
  returning pool_fee_total_id into returned_id;
  if returned_id is null then
    raise exception using errcode = '23505', message = 'pool fee total replay changed immutable content';
  end if;
  perform programmable_private.append_mutation_audit(
    'pool_fee_total.stage', p_promoted_block_hash, p_run_id, p_verified_at
  );
  return returned_id;
end
$function$;

create function programmable_private.stage_reward_vault_projection(
  p_reward_vault_projection_id uuid,
  p_launch_projection_id uuid,
  p_run_id uuid,
  p_vault bytea,
  p_pool_id bytea,
  p_quote_asset bytea,
  p_configuration_hash bytea,
  p_current_allocation_fact_id uuid,
  p_last_source_occurrence_id uuid,
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
  launch programmable_private.launch_projections%rowtype;
  fact programmable_private.reward_allocation_facts%rowtype;
  returned_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_last_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  select * into launch from programmable_private.launch_projections
  where launch_projection_id = p_launch_projection_id
    and projection_run_id = p_run_id;
  select * into fact from programmable_private.reward_allocation_facts
  where allocation_fact_id = p_current_allocation_fact_id;
  if launch.launch_projection_id is null
     or fact.allocation_fact_id is null
     or launch.chain_id <> scope.chain_id
     or launch.release_id <> scope.release_id
     or launch.model_id <> scope.model_id
     or launch.epoch_id <> scope.epoch_id
     or launch.pointer_generation <> scope.pointer_generation
     or launch.promoted_block_number <> scope.promoted_block_number
     or launch.promoted_block_hash <> scope.promoted_block_hash
     or fact.chain_id <> scope.chain_id
     or fact.release_id <> scope.release_id
     or fact.model_id <> scope.model_id
     or fact.epoch_id <> scope.epoch_id
     or fact.pointer_generation <> scope.pointer_generation
     or fact.vault <> p_vault
     or fact.configuration_hash <> p_configuration_hash
     or launch.reward_vault is distinct from p_vault
     or launch.pool_id <> p_pool_id
     or pg_catalog.octet_length(p_vault) <> 20
     or pg_catalog.octet_length(p_pool_id) <> 32
     or pg_catalog.octet_length(p_configuration_hash) <> 32
     or (p_quote_asset is not null and pg_catalog.octet_length(p_quote_asset) <> 20)
  then
    raise exception using errcode = '23514', message = 'reward vault projection mismatch';
  end if;
  insert into programmable_private.reward_vault_projections as target (
    reward_vault_projection_id, launch_projection_id, chain_id, release_id,
    model_id, epoch_id, pointer_generation, vault, pool_id, quote_asset,
    configuration_hash, current_allocation_fact_id,
    last_source_logical_event_id, last_source_occurrence_id,
    last_source_occurrence_block_hash, projection_run_id,
    promoted_block_number, promoted_block_hash, verified_at
  ) values (
    p_reward_vault_projection_id, p_launch_projection_id, scope.chain_id,
    scope.release_id, scope.model_id, scope.epoch_id, scope.pointer_generation,
    p_vault::programmable_private.eth_address,
    p_pool_id::programmable_private.bytes32_value,
    case when p_quote_asset is null then null
      else p_quote_asset::programmable_private.eth_address end,
    p_configuration_hash::programmable_private.bytes32_value,
    p_current_allocation_fact_id, scope.source_logical_event_id,
    p_last_source_occurrence_id, scope.source_occurrence_block_hash,
    p_run_id, scope.promoted_block_number, scope.promoted_block_hash,
    p_verified_at
  )
  on conflict (reward_vault_projection_id) do update
    set reward_vault_projection_id = excluded.reward_vault_projection_id
    where target is not distinct from excluded
  returning reward_vault_projection_id into returned_id;
  if returned_id is null then
    raise exception using errcode = '23505', message = 'reward vault replay changed immutable content';
  end if;
  perform programmable_private.append_mutation_audit(
    'reward_vault_projection.stage', p_configuration_hash, p_run_id, p_verified_at
  );
  return returned_id;
end
$function$;

create function programmable_private.stage_reward_allocation_projection(
  p_reward_allocation_projection_id uuid,
  p_reward_vault_projection_id uuid,
  p_run_id uuid,
  p_allocation_fact_id uuid,
  p_configuration_epoch bigint,
  p_allocation_index integer,
  p_beneficiary bytea,
  p_payout_address bytea,
  p_share_bps numeric,
  p_effective_from_block numeric,
  p_effective_to_block numeric,
  p_last_source_occurrence_id uuid,
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
  vault programmable_private.reward_vault_projections%rowtype;
  fact programmable_private.reward_allocation_facts%rowtype;
  from_block bigint;
  to_block bigint;
  returned_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_last_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  select * into vault from programmable_private.reward_vault_projections
  where reward_vault_projection_id = p_reward_vault_projection_id
    and projection_run_id = p_run_id;
  select * into fact from programmable_private.reward_allocation_facts
  where allocation_fact_id = p_allocation_fact_id;
  if p_effective_from_block <> pg_catalog.trunc(p_effective_from_block)
     or p_effective_from_block < 0
     or p_effective_from_block > 9223372036854775807
     or (p_effective_to_block is not null and (
       p_effective_to_block <> pg_catalog.trunc(p_effective_to_block)
       or p_effective_to_block < p_effective_from_block
       or p_effective_to_block > 9223372036854775807
     ))
  then
    raise exception using errcode = '22023', message = 'invalid allocation effective range';
  end if;
  from_block := p_effective_from_block::bigint;
  to_block := case when p_effective_to_block is null then null
    else p_effective_to_block::bigint end;
  if vault.reward_vault_projection_id is null
     or fact.allocation_fact_id is null
     or vault.chain_id <> scope.chain_id
     or vault.release_id <> scope.release_id
     or vault.model_id <> scope.model_id
     or vault.epoch_id <> scope.epoch_id
     or vault.pointer_generation <> scope.pointer_generation
     or vault.promoted_block_number <> scope.promoted_block_number
     or vault.promoted_block_hash <> scope.promoted_block_hash
     or vault.current_allocation_fact_id <> p_allocation_fact_id
     or fact.epoch_id <> scope.epoch_id
     or fact.pointer_generation <> scope.pointer_generation
     or p_configuration_epoch <= 0
     or p_allocation_index < 0
     or p_allocation_index >= pg_catalog.array_length(fact.ordered_beneficiaries, 1)
     or fact.ordered_beneficiaries[p_allocation_index + 1] <> p_beneficiary
     or fact.ordered_shares_bps[p_allocation_index + 1] <> p_share_bps
     or pg_catalog.octet_length(p_beneficiary) <> 20
     or pg_catalog.octet_length(p_payout_address) <> 20
     or p_share_bps <> pg_catalog.trunc(p_share_bps)
     or from_block > scope.promoted_block_number
  then
    raise exception using errcode = '23514', message = 'reward allocation projection mismatch';
  end if;
  insert into programmable_private.reward_allocation_projections as target (
    reward_allocation_projection_id, reward_vault_projection_id,
    allocation_fact_id, chain_id, release_id, model_id, epoch_id,
    pointer_generation, configuration_epoch, allocation_index, beneficiary,
    payout_address, share_bps, effective_from_block, effective_to_block,
    last_source_logical_event_id, last_source_occurrence_id,
    last_source_occurrence_block_hash, projection_run_id,
    promoted_block_number, promoted_block_hash, verified_at
  ) values (
    p_reward_allocation_projection_id, p_reward_vault_projection_id,
    p_allocation_fact_id, scope.chain_id, scope.release_id, scope.model_id,
    scope.epoch_id, scope.pointer_generation, p_configuration_epoch,
    p_allocation_index, p_beneficiary::programmable_private.eth_address,
    p_payout_address::programmable_private.eth_address,
    p_share_bps::programmable_private.basis_points,
    from_block::programmable_private.block_number_value,
    to_block,
    scope.source_logical_event_id, p_last_source_occurrence_id,
    scope.source_occurrence_block_hash, p_run_id,
    scope.promoted_block_number, scope.promoted_block_hash, p_verified_at
  )
  on conflict (reward_allocation_projection_id) do update
    set reward_allocation_projection_id = excluded.reward_allocation_projection_id
    where target is not distinct from excluded
  returning reward_allocation_projection_id into returned_id;
  if returned_id is null then
    raise exception using errcode = '23505', message = 'reward allocation replay changed immutable content';
  end if;
  perform programmable_private.append_mutation_audit(
    'reward_allocation_projection.stage', fact.configuration_hash,
    p_run_id, p_verified_at
  );
  return returned_id;
end
$function$;

create function programmable_private.stage_claim_projection(
  p_claim_projection_id uuid,
  p_run_id uuid,
  p_vault bytea,
  p_claimant_kind text,
  p_beneficiary bytea,
  p_recipient bytea,
  p_amount numeric,
  p_beneficiary_total_claimed numeric,
  p_vault_total_received numeric,
  p_source_occurrence_id uuid,
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
  claim_amount numeric;
  claimant_total numeric;
  vault_total numeric;
  returned_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  claim_amount := programmable_private.validate_uint256(p_amount);
  claimant_total := programmable_private.validate_uint256(p_beneficiary_total_claimed);
  vault_total := programmable_private.validate_uint256(p_vault_total_received);
  if p_claimant_kind not in ('beneficiary', 'creator', 'launcher')
     or pg_catalog.octet_length(p_vault) <> 20
     or pg_catalog.octet_length(p_beneficiary) <> 20
     or pg_catalog.octet_length(p_recipient) <> 20
     or claim_amount > claimant_total
     or claim_amount > vault_total
  then
    raise exception using errcode = '22023', message = 'invalid claim projection';
  end if;
  insert into programmable_private.claim_projections as target (
    claim_projection_id, chain_id, release_id, model_id, epoch_id,
    pointer_generation, vault, claimant_kind, beneficiary, recipient, amount,
    beneficiary_total_claimed, vault_total_received, source_occurrence_id,
    source_logical_event_id, source_occurrence_block_hash, projection_run_id,
    promoted_block_number, promoted_block_hash, verified_at
  ) values (
    p_claim_projection_id, scope.chain_id, scope.release_id, scope.model_id,
    scope.epoch_id, scope.pointer_generation,
    p_vault::programmable_private.eth_address,
    p_claimant_kind::programmable_private.source_identifier,
    p_beneficiary::programmable_private.eth_address,
    p_recipient::programmable_private.eth_address, claim_amount,
    claimant_total, vault_total, p_source_occurrence_id,
    scope.source_logical_event_id, scope.source_occurrence_block_hash,
    p_run_id, scope.promoted_block_number, scope.promoted_block_hash,
    p_verified_at
  )
  on conflict (claim_projection_id) do update
    set claim_projection_id = excluded.claim_projection_id
    where target is not distinct from excluded
  returning claim_projection_id into returned_id;
  if returned_id is null then
    raise exception using errcode = '23505', message = 'claim replay changed immutable content';
  end if;
  perform programmable_private.append_mutation_audit(
    'claim_projection.stage', p_promoted_block_hash, p_run_id, p_verified_at
  );
  return returned_id;
end
$function$;

create function programmable_private.stage_payout_change_projection(
  p_payout_change_projection_id uuid,
  p_run_id uuid,
  p_vault bytea,
  p_beneficiary bytea,
  p_previous_payout_address bytea,
  p_new_payout_address bytea,
  p_configuration_epoch bigint,
  p_source_occurrence_id uuid,
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
  returned_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  if pg_catalog.octet_length(p_vault) <> 20
     or pg_catalog.octet_length(p_beneficiary) <> 20
     or pg_catalog.octet_length(p_previous_payout_address) <> 20
     or pg_catalog.octet_length(p_new_payout_address) <> 20
     or p_previous_payout_address = p_new_payout_address
     or (p_configuration_epoch is not null and p_configuration_epoch <= 0)
  then
    raise exception using errcode = '22023', message = 'invalid payout change projection';
  end if;
  insert into programmable_private.payout_change_projections as target (
    payout_change_projection_id, chain_id, release_id, model_id, epoch_id,
    pointer_generation, vault, beneficiary, previous_payout_address,
    new_payout_address, configuration_epoch, source_occurrence_id,
    source_logical_event_id, source_occurrence_block_hash, projection_run_id,
    promoted_block_number, promoted_block_hash, verified_at
  ) values (
    p_payout_change_projection_id, scope.chain_id, scope.release_id,
    scope.model_id, scope.epoch_id, scope.pointer_generation,
    p_vault::programmable_private.eth_address,
    p_beneficiary::programmable_private.eth_address,
    p_previous_payout_address::programmable_private.eth_address,
    p_new_payout_address::programmable_private.eth_address,
    p_configuration_epoch, p_source_occurrence_id,
    scope.source_logical_event_id, scope.source_occurrence_block_hash,
    p_run_id, scope.promoted_block_number, scope.promoted_block_hash,
    p_verified_at
  )
  on conflict (payout_change_projection_id) do update
    set payout_change_projection_id = excluded.payout_change_projection_id
    where target is not distinct from excluded
  returning payout_change_projection_id into returned_id;
  if returned_id is null then
    raise exception using errcode = '23505', message = 'payout change replay changed immutable content';
  end if;
  perform programmable_private.append_mutation_audit(
    'payout_change_projection.stage', p_promoted_block_hash,
    p_run_id, p_verified_at
  );
  return returned_id;
end
$function$;

create function programmable_private.stage_account_reward_balance(
  p_account_reward_balance_id uuid,
  p_run_id uuid,
  p_account bytea,
  p_vault bytea,
  p_claimable_accrued numeric,
  p_claimed_total numeric,
  p_last_source_occurrence_id uuid,
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
  source programmable_private.chain_event_occurrences%rowtype;
  scope record;
  accrued numeric;
  claimed numeric;
  block_number bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_last_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'projection';
  if not found then
    raise exception using errcode = '23503', message = 'invalid projection run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  accrued := programmable_private.validate_uint256(p_claimable_accrued);
  claimed := programmable_private.validate_uint256(p_claimed_total);
  if p_promoted_block_number <> pg_catalog.trunc(p_promoted_block_number)
     or p_promoted_block_number < 0
     or p_promoted_block_number > 9223372036854775807
     or pg_catalog.octet_length(p_account) <> 20
     or pg_catalog.octet_length(p_vault) <> 20
     or pg_catalog.octet_length(p_promoted_block_hash) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid reward balance projection';
  end if;
  block_number := p_promoted_block_number::bigint;
  select * into source
  from programmable_private.chain_event_occurrences
  where occurrence_id = p_last_source_occurrence_id;
  if not found or source.block_number > block_number then
    raise exception using errcode = '23503', message = 'reward balance source mismatch';
  end if;
  insert into programmable_private.account_reward_balances (
    account_reward_balance_id, chain_id, release_id, model_id, epoch_id,
    pointer_generation, account,
    vault, claimable_accrued, claimed_total, last_source_logical_event_id,
    last_source_occurrence_id, last_source_occurrence_block_hash,
    projection_run_id, promoted_block_number, promoted_block_hash, verified_at
  )
  values (
    p_account_reward_balance_id, header.chain_id, header.release_id,
    header.model_id, header.epoch_id, header.captured_pointer_generation,
    p_account::programmable_private.eth_address,
    p_vault::programmable_private.eth_address, accrued, claimed,
    source.logical_event_id, source.occurrence_id, source.block_hash,
    p_run_id, block_number::programmable_private.block_number_value,
    p_promoted_block_hash::programmable_private.bytes32_value, p_verified_at
  )
  on conflict (account_reward_balance_id) do nothing;
  if not found and not exists (
    select 1 from programmable_private.account_reward_balances
    where account_reward_balance_id = p_account_reward_balance_id
      and projection_run_id = p_run_id
      and account = p_account and vault = p_vault
      and claimable_accrued = accrued and claimed_total = claimed
      and last_source_occurrence_id = p_last_source_occurrence_id
      and promoted_block_number = block_number
      and promoted_block_hash = p_promoted_block_hash
  ) then
    raise exception using errcode = '23505', message = 'reward balance replay changed content';
  end if;
  perform programmable_private.append_mutation_audit(
    'account_reward_balance.stage', p_promoted_block_hash, p_run_id, p_verified_at
  );
  return p_account_reward_balance_id;
end
$function$;

create function programmable_private.stage_initial_buy_custody_projection(
  p_custody_projection_id uuid,
  p_launch_projection_id uuid,
  p_run_id uuid,
  p_custody_address bytea,
  p_custody_mode smallint,
  p_duration_days integer,
  p_cliff_days integer,
  p_configuration_hash bytea,
  p_source_occurrence_id uuid,
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
  launch programmable_private.launch_projections%rowtype;
  returned_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  select * into launch from programmable_private.launch_projections
  where launch_projection_id = p_launch_projection_id
    and projection_run_id = p_run_id;
  if launch.launch_projection_id is null
     or launch.chain_id <> scope.chain_id
     or launch.release_id <> scope.release_id
     or launch.model_id <> scope.model_id
     or launch.epoch_id <> scope.epoch_id
     or launch.pointer_generation <> scope.pointer_generation
     or launch.promoted_block_number <> scope.promoted_block_number
     or launch.promoted_block_hash <> scope.promoted_block_hash
     or pg_catalog.octet_length(p_custody_address) <> 20
     or p_custody_mode < 0
     or p_duration_days < 0 or p_duration_days > 65535
     or p_cliff_days < 0 or p_cliff_days > p_duration_days
     or pg_catalog.octet_length(p_configuration_hash) <> 32
  then
    raise exception using errcode = '23514', message = 'custody projection mismatch';
  end if;
  insert into programmable_private.initial_buy_custody_projections as target (
    custody_projection_id, launch_projection_id, chain_id, release_id,
    model_id, epoch_id, pointer_generation, custody_address, custody_mode,
    duration_days, cliff_days, configuration_hash, source_occurrence_id,
    source_logical_event_id, source_occurrence_block_hash, projection_run_id,
    promoted_block_number, promoted_block_hash, verified_at
  ) values (
    p_custody_projection_id, p_launch_projection_id, scope.chain_id,
    scope.release_id, scope.model_id, scope.epoch_id, scope.pointer_generation,
    p_custody_address::programmable_private.eth_address, p_custody_mode,
    p_duration_days, p_cliff_days,
    p_configuration_hash::programmable_private.bytes32_value,
    p_source_occurrence_id, scope.source_logical_event_id,
    scope.source_occurrence_block_hash, p_run_id,
    scope.promoted_block_number, scope.promoted_block_hash, p_verified_at
  )
  on conflict (custody_projection_id) do update
    set custody_projection_id = excluded.custody_projection_id
    where target is not distinct from excluded
  returning custody_projection_id into returned_id;
  if returned_id is null then
    raise exception using errcode = '23505', message = 'custody replay changed immutable content';
  end if;
  perform programmable_private.append_mutation_audit(
    'initial_buy_custody.stage', p_configuration_hash, p_run_id, p_verified_at
  );
  return returned_id;
end
$function$;

create function programmable_private.stage_initial_buy_vesting_projection(
  p_vesting_projection_id uuid,
  p_custody_projection_id uuid,
  p_run_id uuid,
  p_beneficiary bytea,
  p_token bytea,
  p_amount numeric,
  p_vesting_start timestamptz,
  p_vesting_end timestamptz,
  p_source_occurrence_id uuid,
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
  custody programmable_private.initial_buy_custody_projections%rowtype;
  vesting_amount numeric;
  returned_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into scope from programmable_private.projection_stage_context(
    p_run_id, p_source_occurrence_id,
    p_promoted_block_number, p_promoted_block_hash
  );
  select * into custody
  from programmable_private.initial_buy_custody_projections
  where custody_projection_id = p_custody_projection_id
    and projection_run_id = p_run_id;
  vesting_amount := programmable_private.validate_uint256(p_amount);
  if custody.custody_projection_id is null
     or custody.chain_id <> scope.chain_id
     or custody.release_id <> scope.release_id
     or custody.model_id <> scope.model_id
     or custody.epoch_id <> scope.epoch_id
     or custody.pointer_generation <> scope.pointer_generation
     or custody.promoted_block_number <> scope.promoted_block_number
     or custody.promoted_block_hash <> scope.promoted_block_hash
     or pg_catalog.octet_length(p_beneficiary) <> 20
     or pg_catalog.octet_length(p_token) <> 20
     or p_vesting_end < p_vesting_start
  then
    raise exception using errcode = '23514', message = 'vesting projection mismatch';
  end if;
  insert into programmable_private.initial_buy_vesting_projections as target (
    vesting_projection_id, custody_projection_id, chain_id, release_id,
    model_id, epoch_id, pointer_generation, beneficiary, token, amount,
    vesting_start, vesting_end, source_occurrence_id,
    source_logical_event_id, source_occurrence_block_hash, projection_run_id,
    promoted_block_number, promoted_block_hash, verified_at
  ) values (
    p_vesting_projection_id, p_custody_projection_id, scope.chain_id,
    scope.release_id, scope.model_id, scope.epoch_id, scope.pointer_generation,
    p_beneficiary::programmable_private.eth_address,
    p_token::programmable_private.eth_address, vesting_amount,
    p_vesting_start, p_vesting_end, p_source_occurrence_id,
    scope.source_logical_event_id, scope.source_occurrence_block_hash,
    p_run_id, scope.promoted_block_number, scope.promoted_block_hash,
    p_verified_at
  )
  on conflict (vesting_projection_id) do update
    set vesting_projection_id = excluded.vesting_projection_id
    where target is not distinct from excluded
  returning vesting_projection_id into returned_id;
  if returned_id is null then
    raise exception using errcode = '23505', message = 'vesting replay changed immutable content';
  end if;
  perform programmable_private.append_mutation_audit(
    'initial_buy_vesting.stage', p_promoted_block_hash, p_run_id, p_verified_at
  );
  return returned_id;
end
$function$;

create function programmable_private.promote_projection_run(
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
  p_published_at timestamptz default pg_catalog.clock_timestamp()
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
  current_checkpoint programmable_private.projector_checkpoint_current%rowtype;
  previous_checkpoint programmable_private.projector_checkpoints%rowtype;
  occurrence programmable_private.chain_event_occurrences%rowtype;
  occurrence_materialization programmable_private.chain_event_occurrence_materializations%rowtype;
  fact programmable_private.reward_allocation_facts%rowtype;
  selected_evidence_id uuid;
  selected_occurrence_id uuid;
  selected_fact_id uuid;
  selected_route_key text;
  target_block bigint;
  cursor_log_index bigint;
  audit_id uuid;
  status_id uuid;
  route_history_id uuid;
  idx integer;
  ordered_occurrence_ids uuid[];
  ordered_fact_ids uuid[];
  ordered_disposition_ids uuid[];
  required_disposition_ids uuid[];
  ordered_route_keys text[];
  ordered_projection_rows text[];
  projection_row_count bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'projection'
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'invalid projection run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if exists (
    select 1 from programmable_private.run_lifecycle_outcomes where run_id = p_run_id
  ) then
    raise exception using errcode = '55000', message = 'run is already terminal';
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
    raise exception using errcode = '40001', message = 'stale projector lease';
  end if;
  if p_target_block_number <> pg_catalog.trunc(p_target_block_number)
     or p_target_block_number < 0
     or p_target_block_number > 9223372036854775807
     or pg_catalog.octet_length(p_target_block_hash) <> 32
     or p_cursor_block_global_log_index
       <> pg_catalog.trunc(p_cursor_block_global_log_index)
     or p_cursor_block_global_log_index < 0
     or p_cursor_block_global_log_index > 4294967295
     or p_cursor_candidate_id is null
     or pg_catalog.octet_length(p_result_commitment) <> 32
     or p_next_checkpoint_generation <> p_expected_checkpoint_generation + 1
     or (
       coalesce(pg_catalog.array_length(p_occurrence_ids, 1), 0) = 0
       and coalesce(
         pg_catalog.array_length(p_candidate_disposition_ids, 1), 0
       ) = 0
     )
     or coalesce(pg_catalog.array_length(p_route_keys, 1), 0) = 0
     or coalesce(pg_catalog.array_length(p_allocation_fact_ids, 1), 0)
       <> coalesce(pg_catalog.array_length(p_allocation_evidence_ids, 1), 0)
  then
    raise exception using errcode = '22023', message = 'invalid promotion request';
  end if;
  select pg_catalog.array_agg(item order by item)
    into ordered_occurrence_ids
  from (select distinct item from pg_catalog.unnest(p_occurrence_ids) as item) as unique_items;
  select pg_catalog.array_agg(item order by item)
    into ordered_fact_ids
  from (select distinct item from pg_catalog.unnest(p_allocation_fact_ids) as item) as unique_items;
  select pg_catalog.array_agg(item order by item)
    into ordered_disposition_ids
  from (
    select distinct item
    from pg_catalog.unnest(p_candidate_disposition_ids) as item
  ) as unique_items;
  select pg_catalog.array_agg(item order by item)
    into ordered_route_keys
  from (select distinct item from pg_catalog.unnest(p_route_keys) as item) as unique_items;
  if p_occurrence_ids is distinct from
       coalesce(ordered_occurrence_ids, array[]::uuid[])
     or p_allocation_fact_ids is distinct from coalesce(ordered_fact_ids, array[]::uuid[])
     or p_candidate_disposition_ids is distinct from
       coalesce(ordered_disposition_ids, array[]::uuid[])
     or p_route_keys is distinct from ordered_route_keys
     or exists (select 1 from pg_catalog.unnest(p_occurrence_ids) as item where item is null)
     or exists (select 1 from pg_catalog.unnest(p_allocation_fact_ids) as item where item is null)
     or exists (select 1 from pg_catalog.unnest(p_allocation_evidence_ids) as item where item is null)
     or exists (select 1 from pg_catalog.unnest(p_candidate_disposition_ids) as item where item is null)
     or exists (select 1 from pg_catalog.unnest(p_route_keys) as item where item is null)
     or coalesce(pg_catalog.array_length(p_allocation_evidence_ids, 1), 0)
       <> coalesce((
         select pg_catalog.count(distinct item)
         from pg_catalog.unnest(p_allocation_evidence_ids) as item
       ), 0)
  then
    raise exception using
      errcode = '22023',
      message = 'promotion arrays must be non-null, unique and canonically ordered';
  end if;
  target_block := p_target_block_number::bigint;
  cursor_log_index := p_cursor_block_global_log_index::bigint;
  select * into observation
  from programmable_private.safe_head_observations
  where observation_id = p_safe_head_observation_id;
  if not found
     or observation.epoch_id <> header.epoch_id
     or observation.pointer_generation <> header.captured_pointer_generation
     or target_block > observation.safe_block_number
  then
    raise exception using errcode = '23514', message = 'target is outside accepted safe head';
  end if;
  select * into target_evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_target_block_evidence_id
    and observation_id = p_safe_head_observation_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  if not found
     or target_evidence.block_number <> target_block
     or target_evidence.agreed_block_hash <> p_target_block_hash
  then
    raise exception using errcode = '23514', message = 'target/checkpoint hash is not bound evidence';
  end if;
  select * into current_checkpoint
  from programmable_private.projector_checkpoint_current
  where chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and projector_version = p_projector_version
  for update;
  if found then
    if current_checkpoint.checkpoint_generation <> p_expected_checkpoint_generation
       or current_checkpoint.reorg_generation <> p_reorg_generation
    then
      raise exception using errcode = '40001', message = 'checkpoint CAS lost';
    end if;
    select * into previous_checkpoint
    from programmable_private.projector_checkpoints
    where checkpoint_id = current_checkpoint.checkpoint_id;
    if not found then
      raise exception using errcode = '23503', message = 'current checkpoint identity is missing';
    end if;
  elsif p_expected_checkpoint_generation <> 0 or p_reorg_generation <> 0 then
    raise exception using errcode = '40001', message = 'checkpoint CAS lost';
  end if;
  if not exists (
    select 1 from programmable_private.envio_candidate_inbox as candidate
    where candidate.candidate_id = p_cursor_candidate_id
      and candidate.chain_id = header.chain_id
      and candidate.block_number = target_block
      and candidate.block_hash = p_target_block_hash
      and candidate.block_global_log_index = cursor_log_index
  ) then
    raise exception using
      errcode = '23514',
      message = 'checkpoint cursor does not match its exact neutral inbox row';
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
        previous_checkpoint.checkpoint_id is null
        or (
          candidate.block_number::bigint,
          candidate.block_global_log_index::bigint,
          candidate.candidate_id::text
        ) > (
          previous_checkpoint.block_number::bigint,
          previous_checkpoint.cursor_block_global_log_index::bigint,
          previous_checkpoint.cursor_candidate_id::text
        )
      )
      and (
        candidate.block_number::bigint,
        candidate.block_global_log_index::bigint,
        candidate.candidate_id::text
      ) <= (target_block, cursor_log_index, p_cursor_candidate_id)
      and coalesce(status.status::text, 'pending')
        not in ('resolved', 'ignored', 'quarantined')
  ) then
    raise exception using
      errcode = '23514',
      message = 'checkpoint cursor cannot pass a pending or deferred candidate';
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
      previous_checkpoint.checkpoint_id is null
      or (
        candidate.block_number::bigint,
        candidate.block_global_log_index::bigint,
        candidate.candidate_id::text
      ) > (
        previous_checkpoint.block_number::bigint,
        previous_checkpoint.cursor_block_global_log_index::bigint,
        previous_checkpoint.cursor_candidate_id::text
      )
    )
    and (
      candidate.block_number::bigint,
      candidate.block_global_log_index::bigint,
      candidate.candidate_id::text
    ) <= (target_block, cursor_log_index, p_cursor_candidate_id);
  if p_candidate_disposition_ids is distinct from
    coalesce(required_disposition_ids, array[]::uuid[])
  then
    raise exception using
      errcode = '23514',
      message = 'candidate disposition manifest is incomplete or noncanonical';
  end if;
  if not exists (
    select 1
    from programmable_private.launch_projections
    where projection_run_id = p_run_id
      and epoch_id = header.epoch_id
      and pointer_generation = header.captured_pointer_generation
      and promoted_block_number = target_block
      and promoted_block_hash = p_target_block_hash
      and is_complete
  ) then
    raise exception using errcode = '23514', message = 'run has no complete launch projection';
  end if;
  if exists (
    select 1
    from (
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.launch_projections
      union all
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.pool_projections
      union all
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.pool_fee_configurations
      union all
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.fee_accrual_facts
      union all
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.pool_fee_totals
      union all
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.reward_vault_projections
      union all
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.reward_allocation_projections
      union all
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.claim_projections
      union all
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.payout_change_projections
      union all
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.account_reward_balances
      union all
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.initial_buy_custody_projections
      union all
      select projection_run_id, chain_id, release_id, model_id, epoch_id,
             pointer_generation, promoted_block_number, promoted_block_hash
      from programmable_private.initial_buy_vesting_projections
    ) as staged
    where staged.projection_run_id = p_run_id
      and (
        staged.chain_id <> header.chain_id
        or staged.release_id <> header.release_id
        or staged.model_id <> header.model_id
        or staged.epoch_id <> header.epoch_id
        or staged.pointer_generation <> header.captured_pointer_generation
        or staged.promoted_block_number <> target_block
        or staged.promoted_block_hash <> p_target_block_hash
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'every staged projection row must bind the exact promotion scope and target';
  end if;
  if exists (
    select 1
    from programmable_private.launch_projections as launch
    where launch.projection_run_id = p_run_id
      and launch.is_complete
      and not (
        select pg_catalog.count(*) = 1
          and pg_catalog.count(fee.pool_fee_configuration_id) = 1
        from programmable_private.pool_projections as pool
        left join programmable_private.pool_fee_configurations as fee
          on fee.pool_projection_id = pool.pool_projection_id
         and fee.projection_run_id = pool.projection_run_id
         and fee.chain_id = pool.chain_id
         and fee.release_id = pool.release_id
         and fee.model_id = pool.model_id
         and fee.epoch_id = pool.epoch_id
         and fee.pointer_generation = pool.pointer_generation
         and fee.promoted_block_number = pool.promoted_block_number
         and fee.promoted_block_hash = pool.promoted_block_hash
        where pool.projection_run_id = p_run_id
          and pool.launch_projection_id = launch.launch_projection_id
          and pool.pool_id = launch.pool_id
          and (pool.currency0 = launch.token or pool.currency1 = launch.token)
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'each complete launch requires exactly one token-bound PoolKey and fee configuration';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(p_allocation_fact_ids) as selected(allocation_fact_id)
    join programmable_private.reward_allocation_facts as selected_fact
      on selected_fact.allocation_fact_id = selected.allocation_fact_id
    where not exists (
      select 1
      from programmable_private.reward_vault_projections as vault
      where vault.projection_run_id = p_run_id
        and vault.current_allocation_fact_id = selected.allocation_fact_id
        and vault.vault = selected_fact.vault
        and (
          select pg_catalog.count(*)
          from programmable_private.reward_allocation_projections as allocation
          where allocation.projection_run_id = p_run_id
            and allocation.reward_vault_projection_id
              = vault.reward_vault_projection_id
            and allocation.allocation_fact_id = selected.allocation_fact_id
        ) = pg_catalog.array_length(selected_fact.ordered_beneficiaries, 1)
        and (
          select pg_catalog.count(distinct allocation.allocation_index)
          from programmable_private.reward_allocation_projections as allocation
          where allocation.projection_run_id = p_run_id
            and allocation.reward_vault_projection_id
              = vault.reward_vault_projection_id
            and allocation.allocation_fact_id = selected.allocation_fact_id
        ) = pg_catalog.array_length(selected_fact.ordered_beneficiaries, 1)
        and (
          select pg_catalog.count(distinct allocation.configuration_epoch)
          from programmable_private.reward_allocation_projections as allocation
          where allocation.projection_run_id = p_run_id
            and allocation.reward_vault_projection_id
              = vault.reward_vault_projection_id
            and allocation.allocation_fact_id = selected.allocation_fact_id
        ) = 1
        and (
          select coalesce(pg_catalog.sum(allocation.share_bps), 0)
          from programmable_private.reward_allocation_projections as allocation
          where allocation.projection_run_id = p_run_id
            and allocation.reward_vault_projection_id
              = vault.reward_vault_projection_id
            and allocation.allocation_fact_id = selected.allocation_fact_id
        ) = 10000
    )
  ) or exists (
    select 1
    from programmable_private.reward_vault_projections as vault
    where vault.projection_run_id = p_run_id
      and not (vault.current_allocation_fact_id = any(p_allocation_fact_ids))
  ) then
    raise exception using
      errcode = '23514',
      message = 'selected reward facts require complete vault and allocation projections';
  end if;
  if exists (
    with staged_sources(source_occurrence_id) as (
      select last_source_occurrence_id from programmable_private.launch_projections
        where projection_run_id = p_run_id
      union select last_source_occurrence_id from programmable_private.pool_projections
        where projection_run_id = p_run_id
      union select disclosure_source_occurrence_id from programmable_private.pool_fee_configurations
        where projection_run_id = p_run_id
      union select source_occurrence_id from programmable_private.fee_accrual_facts
        where projection_run_id = p_run_id
      union select last_source_occurrence_id from programmable_private.pool_fee_totals
        where projection_run_id = p_run_id
      union select last_source_occurrence_id from programmable_private.reward_vault_projections
        where projection_run_id = p_run_id
      union select last_source_occurrence_id from programmable_private.reward_allocation_projections
        where projection_run_id = p_run_id
      union select source_occurrence_id from programmable_private.claim_projections
        where projection_run_id = p_run_id
      union select source_occurrence_id from programmable_private.payout_change_projections
        where projection_run_id = p_run_id
      union select last_source_occurrence_id from programmable_private.account_reward_balances
        where projection_run_id = p_run_id
      union select source_occurrence_id from programmable_private.initial_buy_custody_projections
        where projection_run_id = p_run_id
      union select source_occurrence_id from programmable_private.initial_buy_vesting_projections
        where projection_run_id = p_run_id
    )
    select 1 from staged_sources
    where not (source_occurrence_id = any(p_occurrence_ids))
      and (
        cardinality(p_occurrence_ids) > 0
        or not exists (
          select 1
          from programmable_private.chain_event_current_canonical as canonical
          join programmable_private.chain_event_occurrence_materializations
            as materialization
            on materialization.occurrence_id = canonical.occurrence_id
           and materialization.chain_id = header.chain_id
           and materialization.release_id = header.release_id
           and materialization.model_id = header.model_id
           and materialization.source_group = header.source_group
           and materialization.epoch_id = header.epoch_id
           and materialization.pointer_generation =
             header.captured_pointer_generation
          where canonical.occurrence_id = staged_sources.source_occurrence_id
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'promotion occurrence fold omits a staged projection source';
  end if;
  foreach selected_occurrence_id in array p_occurrence_ids loop
    select * into occurrence
    from programmable_private.chain_event_occurrences as candidate_occurrence
    where candidate_occurrence.occurrence_id = selected_occurrence_id;
    select * into occurrence_materialization
    from programmable_private.chain_event_occurrence_materializations
    where occurrence_id = selected_occurrence_id
      and chain_id = header.chain_id
      and release_id = header.release_id
      and model_id = header.model_id
      and source_group = header.source_group
      and epoch_id = header.epoch_id
      and pointer_generation = header.captured_pointer_generation;
    if not found
       or occurrence.occurrence_id is null
       or occurrence.chain_id <> header.chain_id
       or occurrence.block_number > target_block
       or not exists (
         select 1
         from programmable_private.dual_rpc_block_evidence as source_evidence
         where source_evidence.block_evidence_id =
             occurrence_materialization.block_evidence_id
           and source_evidence.observation_id = p_safe_head_observation_id
           and source_evidence.epoch_id = header.epoch_id
           and source_evidence.pointer_generation = header.captured_pointer_generation
           and source_evidence.block_number = occurrence.block_number
           and source_evidence.agreed_block_hash = occurrence.block_hash
       )
    then
      raise exception using errcode = '23514', message = 'occurrence lacks promotion-bound block evidence';
    end if;
    if exists (
      select 1
      from programmable_private.chain_event_current_canonical as selected
      where selected.logical_event_id = occurrence.logical_event_id
        and selected.occurrence_id <> occurrence.occurrence_id
    ) then
      raise exception using errcode = '23505', message = 'competing canonical occurrence requires rewind';
    end if;
  end loop;

  audit_id := programmable_private.append_mutation_audit(
    'projection.promote', p_result_commitment, p_run_id, p_published_at
  );
  select
    pg_catalog.array_agg(
      pg_catalog.format('%s:%s', staged_rows.row_kind, staged_rows.row_id)
      order by staged_rows.row_kind, staged_rows.row_id
    ),
    pg_catalog.count(*)
  into ordered_projection_rows, projection_row_count
  from (
    select 'launch'::text as row_kind, launch_projection_id as row_id
      from programmable_private.launch_projections
      where projection_run_id = p_run_id
    union all select 'pool', pool_projection_id
      from programmable_private.pool_projections
      where projection_run_id = p_run_id
    union all select 'pool_fee_configuration', pool_fee_configuration_id
      from programmable_private.pool_fee_configurations
      where projection_run_id = p_run_id
    union all select 'fee_accrual', fee_accrual_fact_id
      from programmable_private.fee_accrual_facts
      where projection_run_id = p_run_id
    union all select 'pool_fee_total', pool_fee_total_id
      from programmable_private.pool_fee_totals
      where projection_run_id = p_run_id
    union all select 'reward_vault', reward_vault_projection_id
      from programmable_private.reward_vault_projections
      where projection_run_id = p_run_id
    union all select 'reward_allocation', reward_allocation_projection_id
      from programmable_private.reward_allocation_projections
      where projection_run_id = p_run_id
    union all select 'claim', claim_projection_id
      from programmable_private.claim_projections
      where projection_run_id = p_run_id
    union all select 'payout_change', payout_change_projection_id
      from programmable_private.payout_change_projections
      where projection_run_id = p_run_id
    union all select 'account_reward_balance', account_reward_balance_id
      from programmable_private.account_reward_balances
      where projection_run_id = p_run_id
    union all select 'initial_buy_custody', custody_projection_id
      from programmable_private.initial_buy_custody_projections
      where projection_run_id = p_run_id
    union all select 'initial_buy_vesting', vesting_projection_id
      from programmable_private.initial_buy_vesting_projections
      where projection_run_id = p_run_id
  ) as staged_rows;
  insert into programmable_private.projection_fold_manifests (
    run_id, epoch_id, pointer_generation, target_block_number,
    target_block_hash, ordered_occurrence_ids, ordered_allocation_fact_ids,
    ordered_allocation_evidence_ids, ordered_candidate_disposition_ids,
    ordered_route_keys, cursor_block_global_log_index, cursor_candidate_id,
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
  foreach selected_occurrence_id in array p_occurrence_ids loop
    select * into occurrence
    from programmable_private.chain_event_occurrences as candidate_occurrence
    where candidate_occurrence.occurrence_id = selected_occurrence_id;
    select * into occurrence_materialization
    from programmable_private.chain_event_occurrence_materializations
    where occurrence_id = selected_occurrence_id
      and epoch_id = header.epoch_id
      and pointer_generation = header.captured_pointer_generation;
    status_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.chain_event_occurrence_status_history (
      status_history_id, occurrence_id, logical_event_id, block_hash, status,
      safe_head_observation_id, block_evidence_id, decision_run_id,
      decision_commitment, decided_at, audit_id
    )
    values (
      status_id, occurrence.occurrence_id, occurrence.logical_event_id,
      occurrence.block_hash, 'canonical', p_safe_head_observation_id,
      occurrence_materialization.block_evidence_id,
      p_run_id, p_result_commitment,
      p_published_at, audit_id
    );
    insert into programmable_private.chain_event_current_canonical (
      logical_event_id, occurrence_id, block_hash, status_history_id,
      selected_by_run_id, selected_at
    )
    values (
      occurrence.logical_event_id, occurrence.occurrence_id,
      occurrence.block_hash, status_id, p_run_id, p_published_at
    )
    on conflict (logical_event_id) do update
      set status_history_id = excluded.status_history_id,
          selected_by_run_id = excluded.selected_by_run_id,
          selected_at = excluded.selected_at
      where programmable_private.chain_event_current_canonical.occurrence_id
        = excluded.occurrence_id;
    if not found then
      raise exception using errcode = '23505', message = 'canonical pointer conflict';
    end if;
  end loop;

  if coalesce(pg_catalog.array_length(p_allocation_fact_ids, 1), 0) > 0 then
    for idx in 1..pg_catalog.array_length(p_allocation_fact_ids, 1) loop
      selected_fact_id := p_allocation_fact_ids[idx];
      selected_evidence_id := p_allocation_evidence_ids[idx];
      select * into fact
      from programmable_private.reward_allocation_facts
      where allocation_fact_id = selected_fact_id;
      if not found
         or fact.epoch_id <> header.epoch_id
         or fact.pointer_generation <> header.captured_pointer_generation
         or not exists (
           select 1
           from programmable_private.reward_allocation_evidence as evidence
           join programmable_private.run_headers as evidence_run
             on evidence_run.run_id = evidence.verification_run_id
            and evidence_run.chain_id = fact.chain_id
            and evidence_run.release_id = fact.release_id
            and evidence_run.model_id = fact.model_id
            and evidence_run.epoch_id = fact.epoch_id
            and evidence_run.captured_pointer_generation
              = fact.pointer_generation
           where evidence.allocation_evidence_id = selected_evidence_id
             and evidence.allocation_fact_id = selected_fact_id
             and evidence.recomputed_allocation_hash = fact.allocation_hash
             and evidence.recomputed_configuration_hash = fact.configuration_hash
             and evidence.is_recomputation_attested
             and evidence.recomputed_active_configuration_hash
               is not distinct from fact.active_configuration_hash
             and recovery_release_binding_commitment = (
               select binding.binding_commitment
               from programmable_private.release_source_bindings as binding
               where binding.binding_id = recovery_release_binding_id
                 and binding.epoch_id = fact.epoch_id
             )
         )
         or not exists (
           select 1
           from programmable_private.chain_event_current_canonical as canonical
           join programmable_private.chain_event_occurrence_materializations
             as factory_materialization
             on factory_materialization.occurrence_id = canonical.occurrence_id
            and factory_materialization.epoch_id = fact.epoch_id
            and factory_materialization.pointer_generation =
              fact.pointer_generation
           where canonical.occurrence_id = fact.factory_occurrence_id
         )
         or exists (
           select 1
           from programmable_private.reward_allocation_status_history
             as rejected_status
           where rejected_status.allocation_fact_id = selected_fact_id
             and rejected_status.status in (
               'quarantined', 'orphaned', 'conflicted', 'revoked'
             )
         )
         or exists (
           select 1
           from programmable_private.reward_allocation_required_occurrences as required
           where required.allocation_fact_id = selected_fact_id
             and not exists (
               select 1
               from programmable_private.chain_event_current_canonical as selected
               join programmable_private.chain_event_occurrences as required_source
                 on required_source.occurrence_id = selected.occurrence_id
               join programmable_private.chain_event_occurrence_materializations
                 as required_materialization
                 on required_materialization.occurrence_id =
                   selected.occurrence_id
                and required_materialization.epoch_id = fact.epoch_id
                and required_materialization.pointer_generation =
                  fact.pointer_generation
               join programmable_private.release_source_bindings as binding
                 on binding.binding_id =
                   required_materialization.release_binding_id
               where selected.occurrence_id = required.occurrence_id
                 and binding.binding_id = required.release_binding_id
                 and binding.binding_commitment
                   = required.release_binding_commitment
                 and binding.source_role = required.occurrence_role
             )
         )
      then
        raise exception using errcode = '23514', message = 'allocation evidence is not promotion eligible';
      end if;
      if exists (
        select 1
        from programmable_private.reward_allocation_current_verified as current_seed
        where current_seed.factory_occurrence_id = fact.factory_occurrence_id
          and current_seed.vault = fact.vault
          and current_seed.allocation_fact_id <> selected_fact_id
      ) then
        raise exception using errcode = '23505', message = 'conflicting verified allocation';
      end if;
      status_id := pg_catalog.gen_random_uuid();
      insert into programmable_private.reward_allocation_status_history (
        seed_status_history_id, allocation_fact_id, allocation_evidence_id,
        status, reason_commitment, decision_run_id, decided_at, audit_id
      )
      values (
        status_id, selected_fact_id, selected_evidence_id, 'verified',
        p_result_commitment::programmable_private.bytes32_value,
        p_run_id, p_published_at, audit_id
      );
      insert into programmable_private.reward_allocation_current_verified (
        factory_occurrence_id, vault, allocation_fact_id,
        allocation_evidence_id, seed_status_history_id,
        selected_by_run_id, selected_at
      )
      values (
        fact.factory_occurrence_id, fact.vault,
        selected_fact_id, selected_evidence_id,
        status_id, p_run_id, p_published_at
      )
      on conflict (factory_occurrence_id, vault) do update
        set allocation_evidence_id = excluded.allocation_evidence_id,
            seed_status_history_id = excluded.seed_status_history_id,
            selected_by_run_id = excluded.selected_by_run_id,
            selected_at = excluded.selected_at
        where programmable_private.reward_allocation_current_verified.allocation_fact_id
          = excluded.allocation_fact_id;
      if not found then
        raise exception using errcode = '23505', message = 'verified seed pointer conflict';
      end if;
    end loop;
  end if;

  insert into programmable_private.run_lifecycle_outcomes (
    outcome_id, run_id, status, result_commitment, caller_role,
    finished_at, audit_id
  )
  values (
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
  )
  values (
    p_checkpoint_id, header.chain_id, header.release_id, header.model_id,
    header.source_group,
    p_projector_version::programmable_private.projector_identifier,
    header.epoch_id, header.captured_pointer_generation, p_lease_generation,
    p_next_checkpoint_generation, p_reorg_generation,
    target_block::programmable_private.block_number_value,
    p_target_block_hash::programmable_private.bytes32_value,
    cursor_log_index::programmable_private.block_log_index_value,
    p_cursor_candidate_id::programmable_private.envio_candidate_identifier,
    p_safe_head_observation_id, p_target_block_evidence_id,
    p_run_id, p_outcome_id, p_published_at
  );
  if p_expected_checkpoint_generation = 0 then
    insert into programmable_private.projector_checkpoint_current (
      chain_id, release_id, model_id, source_group, projector_version,
      checkpoint_id, checkpoint_generation, reorg_generation, changed_at
    )
    values (
      header.chain_id, header.release_id, header.model_id, header.source_group,
      p_projector_version::programmable_private.projector_identifier,
      p_checkpoint_id, p_next_checkpoint_generation, p_reorg_generation,
      p_published_at
    )
    on conflict (
      chain_id, release_id, model_id, source_group, projector_version
    ) do nothing;
  else
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
  end if;
  if not found then
    raise exception using errcode = '40001', message = 'checkpoint CAS lost';
  end if;
  insert into programmable_private.projection_publications (
    publication_id, run_id, epoch_id, pointer_generation, checkpoint_id,
    terminal_outcome_id, target_block_number, target_block_hash,
    published_at, audit_id
  )
  values (
    p_publication_id, p_run_id, header.epoch_id,
    header.captured_pointer_generation, p_checkpoint_id, p_outcome_id,
    target_block::programmable_private.block_number_value,
    p_target_block_hash::programmable_private.bytes32_value,
    p_published_at, audit_id
  );
  foreach selected_route_key in array p_route_keys loop
    route_history_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.route_eligibility_history (
      route_eligibility_history_id, route_key, chain_id, release_id, model_id,
      source_group, epoch_id, pointer_generation, status, route_mode,
      checkpoint_id, reason_commitment, changed_by_run_id, changed_at, audit_id
    )
    values (
      route_history_id,
      selected_route_key::programmable_private.source_identifier,
      header.chain_id, header.release_id, header.model_id, header.source_group,
      header.epoch_id, header.captured_pointer_generation,
      'eligible', 'indexed', p_checkpoint_id,
      p_result_commitment::programmable_private.bytes32_value,
      p_run_id, p_published_at, audit_id
    );
    insert into programmable_private.route_eligibility_current (
      route_key, chain_id, release_id, model_id, source_group, epoch_id,
      pointer_generation, status, route_mode, checkpoint_id, history_id,
      changed_at
    )
    values (
      selected_route_key::programmable_private.source_identifier,
      header.chain_id, header.release_id, header.model_id, header.source_group,
      header.epoch_id, header.captured_pointer_generation,
      'eligible', 'indexed', p_checkpoint_id, route_history_id, p_published_at
    )
    on conflict (route_key, chain_id, release_id, model_id, source_group) do update
      set epoch_id = excluded.epoch_id,
          pointer_generation = excluded.pointer_generation,
          status = excluded.status,
          route_mode = excluded.route_mode,
          checkpoint_id = excluded.checkpoint_id,
          history_id = excluded.history_id,
          changed_at = excluded.changed_at
      where programmable_private.route_eligibility_current.pointer_generation
        <= excluded.pointer_generation;
    if not found then
      raise exception using errcode = '40001', message = 'stale route eligibility generation';
    end if;
  end loop;
  return p_publication_id;
end
$function$;

create function programmable_private.rewind_projection_run(
  p_checkpoint_id uuid,
  p_outcome_id uuid,
  p_run_id uuid,
  p_projector_version text,
  p_lease_generation bigint,
  p_lease_token_hash bytea,
  p_expected_checkpoint_generation bigint,
  p_next_checkpoint_generation bigint,
  p_next_reorg_generation bigint,
  p_safe_head_observation_id uuid,
  p_target_block_evidence_id uuid,
  p_target_block_number numeric,
  p_target_block_hash bytea,
  p_cursor_block_global_log_index numeric,
  p_cursor_candidate_id text,
  p_result_commitment bytea,
  p_rewound_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  current_pointer programmable_private.projector_checkpoint_current%rowtype;
  previous_checkpoint programmable_private.projector_checkpoints%rowtype;
  target_evidence programmable_private.dual_rpc_block_evidence%rowtype;
  target_block bigint;
  cursor_log_index bigint;
  audit_id uuid;
  status_id uuid;
  route_record record;
  occurrence_record record;
  seed_record record;
  route_history_id uuid;
begin
  perform programmable_private.assert_caller('programmable_projector');
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'rewind'
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'invalid rewind run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  select * into current_pointer
  from programmable_private.projector_checkpoint_current
  where chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and projector_version = p_projector_version
  for update;
  if not found
     or current_pointer.checkpoint_generation <> p_expected_checkpoint_generation
     or p_next_checkpoint_generation <> p_expected_checkpoint_generation + 1
     or p_next_reorg_generation <= current_pointer.reorg_generation
  then
    raise exception using errcode = '40001', message = 'rewind checkpoint generation lost';
  end if;
  select * into previous_checkpoint
  from programmable_private.projector_checkpoints
  where checkpoint_id = current_pointer.checkpoint_id;
  if header.captured_pointer_generation <= previous_checkpoint.pointer_generation
     or p_lease_generation <= previous_checkpoint.lease_generation
     or not exists (
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
         and lease.expires_at >= p_rewound_at
     )
  then
    raise exception using errcode = '40001', message = 'rewind requires higher pointer and lease generations';
  end if;
  if p_target_block_number <> pg_catalog.trunc(p_target_block_number)
     or p_target_block_number < 0
     or p_target_block_number >= previous_checkpoint.block_number
     or pg_catalog.octet_length(p_target_block_hash) <> 32
     or p_cursor_block_global_log_index
       <> pg_catalog.trunc(p_cursor_block_global_log_index)
     or p_cursor_block_global_log_index < 0
     or p_cursor_block_global_log_index > 4294967295
     or p_cursor_candidate_id is null
     or pg_catalog.octet_length(p_result_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'rewind target must move backward';
  end if;
  target_block := p_target_block_number::bigint;
  cursor_log_index := p_cursor_block_global_log_index::bigint;
  select * into target_evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_target_block_evidence_id
    and observation_id = p_safe_head_observation_id
    and epoch_id = header.epoch_id
    and pointer_generation = header.captured_pointer_generation;
  if not found
     or target_evidence.block_number <> target_block
     or target_evidence.agreed_block_hash <> p_target_block_hash
  then
    raise exception using errcode = '23514', message = 'rewind target lacks bound evidence';
  end if;
  if not exists (
    select 1
    from programmable_private.projector_checkpoints as ancestor
    where ancestor.chain_id = header.chain_id
      and ancestor.release_id = header.release_id
      and ancestor.model_id = header.model_id
      and ancestor.source_group = header.source_group
      and ancestor.projector_version = p_projector_version
      and ancestor.block_number = target_block
      and ancestor.block_hash = p_target_block_hash
      and ancestor.cursor_block_global_log_index = cursor_log_index
      and ancestor.cursor_candidate_id = p_cursor_candidate_id
      and ancestor.checkpoint_generation < p_expected_checkpoint_generation
  ) or not exists (
    select 1 from programmable_private.envio_candidate_inbox as candidate
    where candidate.candidate_id = p_cursor_candidate_id
      and candidate.chain_id = header.chain_id
      and candidate.block_number = target_block
      and candidate.block_hash = p_target_block_hash
      and candidate.block_global_log_index = cursor_log_index
  ) then
    raise exception using
      errcode = '23514',
      message = 'rewind cursor is not a persisted checkpoint ancestor';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'projection.rewind', p_result_commitment, p_run_id, p_rewound_at
  );
  for route_record in
    select *
    from programmable_private.route_eligibility_current
    where chain_id = header.chain_id
      and release_id = header.release_id
      and model_id = header.model_id
      and source_group = header.source_group
    for update
  loop
    route_history_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.route_eligibility_history (
      route_eligibility_history_id, route_key, chain_id, release_id, model_id,
      source_group, epoch_id, pointer_generation, status, route_mode,
      checkpoint_id, reason_commitment, changed_by_run_id, changed_at, audit_id
    )
    values (
      route_history_id, route_record.route_key, header.chain_id,
      header.release_id, header.model_id, header.source_group, header.epoch_id,
      header.captured_pointer_generation, 'ineligible', 'rpc',
      previous_checkpoint.checkpoint_id,
      p_result_commitment::programmable_private.bytes32_value,
      p_run_id, p_rewound_at, audit_id
    );
    update programmable_private.route_eligibility_current
    set epoch_id = header.epoch_id,
        pointer_generation = header.captured_pointer_generation,
        status = 'ineligible',
        route_mode = 'rpc',
        history_id = route_history_id,
        changed_at = p_rewound_at
    where route_key = route_record.route_key
      and chain_id = header.chain_id
      and release_id = header.release_id
      and model_id = header.model_id
      and source_group = header.source_group;
  end loop;
  for occurrence_record in
    select selected.*, occurrence.block_number,
           scoped_materialization.block_evidence_id
    from programmable_private.chain_event_current_canonical as selected
    join programmable_private.chain_event_occurrences as occurrence
      on occurrence.occurrence_id = selected.occurrence_id
    join lateral (
      select materialization.block_evidence_id
      from programmable_private.chain_event_occurrence_materializations
        as materialization
      where materialization.occurrence_id = occurrence.occurrence_id
        and materialization.chain_id = header.chain_id
        and materialization.release_id = header.release_id
        and materialization.model_id = header.model_id
        and materialization.source_group = header.source_group
      order by materialization.pointer_generation desc,
               materialization.verified_at desc
      limit 1
    ) as scoped_materialization on true
    where occurrence.chain_id = header.chain_id
      and occurrence.block_number > target_block
    for update of selected
  loop
    status_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.chain_event_occurrence_status_history (
      status_history_id, occurrence_id, logical_event_id, block_hash, status,
      safe_head_observation_id, block_evidence_id, decision_run_id,
      decision_commitment, decided_at, audit_id
    )
    values (
      status_id, occurrence_record.occurrence_id,
      occurrence_record.logical_event_id, occurrence_record.block_hash,
      'orphaned', p_safe_head_observation_id,
      occurrence_record.block_evidence_id, p_run_id,
      p_result_commitment::programmable_private.bytes32_value,
      p_rewound_at, audit_id
    );
    delete from programmable_private.chain_event_current_canonical
    where logical_event_id = occurrence_record.logical_event_id
      and occurrence_id = occurrence_record.occurrence_id;
  end loop;
  for seed_record in
    select current_seed.*, fact.verification_run_id,
           evidence.allocation_evidence_id
    from programmable_private.reward_allocation_current_verified as current_seed
    join programmable_private.reward_allocation_facts as fact
      on fact.allocation_fact_id = current_seed.allocation_fact_id
    join programmable_private.reward_allocation_evidence as evidence
      on evidence.allocation_evidence_id = current_seed.allocation_evidence_id
    join programmable_private.run_headers as fact_run
      on fact_run.run_id = fact.verification_run_id
    where fact.chain_id = header.chain_id
      and fact.release_id = header.release_id
      and fact.model_id = header.model_id
      and fact_run.source_group = header.source_group
      and fact.creation_block_number > target_block
    for update of current_seed
  loop
    status_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.reward_allocation_status_history (
      seed_status_history_id, allocation_fact_id, allocation_evidence_id,
      status, reason_commitment, decision_run_id, decided_at, audit_id
    )
    values (
      status_id, seed_record.allocation_fact_id,
      seed_record.allocation_evidence_id, 'orphaned',
      p_result_commitment::programmable_private.bytes32_value,
      p_run_id, p_rewound_at, audit_id
    );
    delete from programmable_private.reward_allocation_current_verified
    where allocation_fact_id = seed_record.allocation_fact_id;
  end loop;

  delete from programmable_private.initial_buy_vesting_projections
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and promoted_block_number > target_block;
  delete from programmable_private.initial_buy_custody_projections
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and promoted_block_number > target_block;
  delete from programmable_private.account_reward_balances
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
        and scoped_run.chain_id = header.chain_id
        and scoped_run.release_id = header.release_id
        and scoped_run.model_id = header.model_id
    )
    and promoted_block_number > target_block;
  delete from programmable_private.payout_change_projections
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and promoted_block_number > target_block;
  delete from programmable_private.claim_projections
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and promoted_block_number > target_block;
  delete from programmable_private.reward_allocation_projections
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and promoted_block_number > target_block;
  delete from programmable_private.reward_vault_projections
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and promoted_block_number > target_block;
  delete from programmable_private.pool_fee_totals
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and promoted_block_number > target_block;
  delete from programmable_private.fee_accrual_facts
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and promoted_block_number > target_block;
  delete from programmable_private.pool_fee_configurations
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and promoted_block_number > target_block;
  delete from programmable_private.pool_projections
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and promoted_block_number > target_block;
  delete from programmable_private.launch_projection_occurrence_roles as role
  using programmable_private.launch_projections as launch
  where role.launch_projection_id = launch.launch_projection_id
    and launch.chain_id = header.chain_id
    and launch.release_id = header.release_id
    and launch.model_id = header.model_id
    and launch.projection_run_id in (
      select scoped_run.run_id
      from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and launch.promoted_block_number > target_block;
  delete from programmable_private.launch_projection_conditions as condition
  using programmable_private.launch_projections as launch
  where condition.launch_projection_id = launch.launch_projection_id
    and launch.chain_id = header.chain_id
    and launch.release_id = header.release_id
    and launch.model_id = header.model_id
    and launch.projection_run_id in (
      select scoped_run.run_id
      from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and launch.promoted_block_number > target_block;
  delete from programmable_private.launch_projections
  where chain_id = header.chain_id and release_id = header.release_id
    and model_id = header.model_id
    and projection_run_id in (
      select scoped_run.run_id from programmable_private.run_headers as scoped_run
      where scoped_run.source_group = header.source_group
    )
    and promoted_block_number > target_block;

  insert into programmable_private.run_lifecycle_outcomes (
    outcome_id, run_id, status, result_commitment, caller_role,
    finished_at, audit_id
  )
  values (
    p_outcome_id, p_run_id, 'succeeded',
    p_result_commitment::programmable_private.bytes32_value,
    programmable_private.caller_role_name(), p_rewound_at, audit_id
  );
  insert into programmable_private.projector_checkpoints (
    checkpoint_id, chain_id, release_id, model_id, source_group,
    projector_version, epoch_id, pointer_generation, lease_generation,
    checkpoint_generation, reorg_generation, block_number, block_hash,
    cursor_block_global_log_index, cursor_candidate_id,
    safe_head_observation_id, target_block_evidence_id, run_id,
    terminal_outcome_id, created_at
  )
  values (
    p_checkpoint_id, header.chain_id, header.release_id, header.model_id,
    header.source_group,
    p_projector_version::programmable_private.projector_identifier,
    header.epoch_id, header.captured_pointer_generation, p_lease_generation,
    p_next_checkpoint_generation, p_next_reorg_generation,
    target_block::programmable_private.block_number_value,
    p_target_block_hash::programmable_private.bytes32_value,
    cursor_log_index::programmable_private.block_log_index_value,
    p_cursor_candidate_id::programmable_private.envio_candidate_identifier,
    p_safe_head_observation_id, p_target_block_evidence_id,
    p_run_id, p_outcome_id, p_rewound_at
  );
  update programmable_private.projector_checkpoint_current
  set checkpoint_id = p_checkpoint_id,
      checkpoint_generation = p_next_checkpoint_generation,
      reorg_generation = p_next_reorg_generation,
      changed_at = p_rewound_at
  where chain_id = header.chain_id
    and release_id = header.release_id
    and model_id = header.model_id
    and source_group = header.source_group
    and projector_version = p_projector_version
    and checkpoint_generation = p_expected_checkpoint_generation;
  if not found then
    raise exception using errcode = '40001', message = 'rewind checkpoint CAS lost';
  end if;
  return p_checkpoint_id;
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

grant execute on function programmable_private.stage_launch_projection(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, bytea, text, text,
  numeric, uuid, numeric, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_pool_projection(
  uuid, uuid, uuid, bytea, bytea, numeric, integer, bytea, uuid,
  numeric, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_account_reward_balance(
  uuid, uuid, bytea, bytea, numeric, numeric, uuid, numeric, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_pool_fee_configuration(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric,
  uuid, numeric, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_fee_accrual_fact(
  uuid, uuid, bytea, bytea, numeric, numeric, numeric, uuid,
  numeric, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_pool_fee_total(
  uuid, uuid, bytea, bytea, numeric, numeric, numeric, uuid,
  numeric, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_reward_vault_projection(
  uuid, uuid, uuid, bytea, bytea, bytea, bytea, uuid, uuid,
  numeric, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_reward_allocation_projection(
  uuid, uuid, uuid, uuid, bigint, integer, bytea, bytea, numeric,
  numeric, numeric, uuid, numeric, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_claim_projection(
  uuid, uuid, bytea, text, bytea, bytea, numeric, numeric, numeric,
  uuid, numeric, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_payout_change_projection(
  uuid, uuid, bytea, bytea, bytea, bytea, bigint, uuid,
  numeric, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_initial_buy_custody_projection(
  uuid, uuid, uuid, bytea, smallint, integer, integer, bytea, uuid,
  numeric, bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.stage_initial_buy_vesting_projection(
  uuid, uuid, uuid, bytea, bytea, numeric, timestamptz, timestamptz,
  uuid, numeric, bytea, timestamptz
) to programmable_projector;

grant execute on function programmable_private.promote_projection_run(
  uuid, uuid, uuid, uuid, text, bigint, bytea, bigint, bigint, bigint,
  uuid, uuid, numeric, bytea, numeric, text, uuid[], uuid[], uuid[], uuid[],
  text[], bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.rewind_projection_run(
  uuid, uuid, uuid, text, bigint, bytea, bigint, bigint, bigint,
  uuid, uuid, numeric, bytea, numeric, text, bytea, timestamptz
) to programmable_projector;

reset role;
