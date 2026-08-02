-- Stable server-only read surface and final least-privilege closure.

set role programmable_migrator;

create function programmable_private.reject_immutable_mutation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = pg_catalog.format(
      '%s is immutable; append a new fact/history row instead',
      tg_table_schema || '.' || tg_table_name
    );
end
$function$;

do $immutable_triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'fingerprint_encoding_versions',
    'mutation_audits',
    'release_epochs',
    'release_source_bindings',
    'provider_deployments',
    'release_epoch_pointer_history',
    'run_headers',
    'run_lifecycle_outcomes',
    'safe_head_observations',
    'dual_rpc_block_evidence',
    'projector_lease_history',
    'projector_checkpoints',
    'dependency_health_history',
    'envio_candidates',
    'chain_event_identities',
    'chain_event_occurrences',
    'chain_event_occurrence_status_history',
    'reward_allocation_facts',
    'reward_allocation_required_occurrences',
    'reward_allocation_evidence',
    'reward_allocation_mismatch_evidence',
    'reward_allocation_status_history',
    'projection_fold_manifests',
    'projection_publications',
    'route_eligibility_history',
    'profile_hash_version_definitions',
    'profile_hash_version_status_history',
    'profile_subjects',
    'profile_subject_aliases',
    'profile_subject_alias_status_history',
    'profile_owner_binding_history',
    'profile_audit_records',
    'token_project_metadata',
    'project_links',
    'reconciliation_records'
  ]
  loop
    execute pg_catalog.format(
      'create trigger reject_immutable_mutation ' ||
      'before update or delete on programmable_private.%I ' ||
      'for each row execute function programmable_private.reject_immutable_mutation()',
      table_name
    );
  end loop;
end
$immutable_triggers$;

do $append_only_prunable_triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'run_telemetry',
    'parity_records',
    'market_snapshots',
    'market_candles',
    'portfolio_points'
  ]
  loop
    execute pg_catalog.format(
      'create trigger reject_immutable_update ' ||
      'before update on programmable_private.%I ' ||
      'for each row execute function programmable_private.reject_immutable_mutation()',
      table_name
    );
  end loop;
end
$append_only_prunable_triggers$;

-- Global occurrence rows own physical chain identity. Every release-scoped
-- reader consumes this materialized view so decoding, binding and evidence
-- always come from the exact epoch generation rather than the first snapshot.
create view programmable_private.chain_event_materialized_occurrences_v1
with (security_invoker = false, security_barrier = true)
as
select
  occurrence.occurrence_id,
  occurrence.logical_event_id,
  materialization.chain_id,
  occurrence.transaction_hash,
  occurrence.receipt_log_ordinal,
  occurrence.block_number,
  occurrence.block_hash,
  occurrence.block_timestamp,
  occurrence.transaction_index,
  occurrence.source_address,
  occurrence.block_global_log_index,
  occurrence.event_signature,
  materialization.event_type,
  occurrence.ordered_topics,
  occurrence.raw_data,
  materialization.decoded_payload,
  materialization.payload_hash,
  materialization.decoder_version,
  materialization.abi_event_set_commitment,
  materialization.release_binding_id,
  materialization.dynamic_source_attestation_id,
  materialization.release_id,
  materialization.model_id,
  materialization.source_group,
  materialization.epoch_id,
  materialization.pointer_generation,
  materialization.first_seen_envio_candidate_id,
  materialization.first_seen_neutral_candidate_id,
  materialization.candidate_resolution_id,
  materialization.first_seen_provider_cursor,
  materialization.verification_run_id,
  materialization.block_evidence_id,
  materialization.encoding_version,
  materialization.canonical_preimage,
  materialization.content_fingerprint,
  materialization.verified_at
from programmable_private.chain_event_occurrences as occurrence
join programmable_private.chain_event_occurrence_materializations
  as materialization
  on materialization.occurrence_id = occurrence.occurrence_id;

create function programmable_private.has_current_verified_reward_seed(
  p_projection_run_id uuid,
  p_vault bytea
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from programmable_private.run_headers as run
    join programmable_private.release_epoch_current as current_epoch
      on current_epoch.chain_id = run.chain_id
     and current_epoch.release_id = run.release_id
     and current_epoch.model_id = run.model_id
     and current_epoch.source_group = run.source_group
     and current_epoch.epoch_id = run.epoch_id
     and current_epoch.generation = run.captured_pointer_generation
    join programmable_private.reward_allocation_current_verified as verified_seed
      on verified_seed.vault = p_vault
    join programmable_private.reward_allocation_facts as seed_fact
      on seed_fact.allocation_fact_id = verified_seed.allocation_fact_id
     and seed_fact.factory_occurrence_id = verified_seed.factory_occurrence_id
     and seed_fact.vault = verified_seed.vault
     and seed_fact.chain_id = run.chain_id
     and seed_fact.release_id = run.release_id
     and seed_fact.model_id = run.model_id
     and seed_fact.epoch_id = run.epoch_id
     and seed_fact.pointer_generation = run.captured_pointer_generation
    join programmable_private.release_source_bindings as factory_binding
      on factory_binding.binding_id = seed_fact.factory_release_binding_id
     and factory_binding.epoch_id = run.epoch_id
     and factory_binding.source_role = 'vault_factory'
     and factory_binding.binding_commitment
       = seed_fact.factory_release_binding_commitment
    join programmable_private.reward_allocation_evidence as seed_evidence
      on seed_evidence.allocation_evidence_id
       = verified_seed.allocation_evidence_id
     and seed_evidence.allocation_fact_id = seed_fact.allocation_fact_id
     and seed_evidence.is_recomputation_attested
     and seed_evidence.recomputed_allocation_hash = seed_fact.allocation_hash
     and seed_evidence.recomputed_configuration_hash
       = seed_fact.configuration_hash
     and seed_evidence.recomputed_active_configuration_hash
       is not distinct from seed_fact.active_configuration_hash
    join programmable_private.run_headers as evidence_run
      on evidence_run.run_id = seed_evidence.verification_run_id
     and evidence_run.chain_id = seed_fact.chain_id
     and evidence_run.release_id = seed_fact.release_id
     and evidence_run.model_id = seed_fact.model_id
     and evidence_run.epoch_id = seed_fact.epoch_id
     and evidence_run.captured_pointer_generation =
       seed_fact.pointer_generation
    join programmable_private.release_source_bindings as recovery_binding
      on recovery_binding.binding_id
       = seed_evidence.recovery_release_binding_id
     and recovery_binding.epoch_id = run.epoch_id
     and recovery_binding.binding_commitment
       = seed_evidence.recovery_release_binding_commitment
     and recovery_binding.source_role = case seed_evidence.recovery_method
       when 'launcher_calldata' then 'launcher'
       when 'coordinator_calldata' then 'coordinator'
       when 'factory_calldata' then 'factory'
       else 'vault_factory'
     end
    join programmable_private.chain_event_current_canonical as seed_canonical
      on seed_canonical.logical_event_id = seed_fact.factory_logical_event_id
     and seed_canonical.occurrence_id = seed_fact.factory_occurrence_id
     and seed_canonical.block_hash = seed_fact.factory_occurrence_block_hash
    join programmable_private.chain_event_materialized_occurrences_v1
      as seed_occurrence
      on seed_occurrence.occurrence_id = seed_fact.factory_occurrence_id
     and seed_occurrence.logical_event_id = seed_fact.factory_logical_event_id
     and seed_occurrence.block_hash = seed_fact.factory_occurrence_block_hash
     and seed_occurrence.chain_id = run.chain_id
     and seed_occurrence.release_id = run.release_id
     and seed_occurrence.model_id = run.model_id
     and seed_occurrence.source_group = run.source_group
     and seed_occurrence.epoch_id = run.epoch_id
     and seed_occurrence.pointer_generation =
       run.captured_pointer_generation
    where run.run_id = p_projection_run_id
      and run.run_kind = 'projection'
      and not exists (
        select 1
        from programmable_private.reward_allocation_required_occurrences
          as required_source
        join programmable_private.chain_event_materialized_occurrences_v1
          as required_occurrence
          on required_occurrence.occurrence_id = required_source.occurrence_id
        join programmable_private.release_source_bindings
          as required_binding
          on required_binding.binding_id = required_source.release_binding_id
        left join programmable_private.chain_event_current_canonical
          as required_canonical
          on required_canonical.logical_event_id = required_occurrence.logical_event_id
         and required_canonical.occurrence_id = required_occurrence.occurrence_id
         and required_canonical.block_hash = required_occurrence.block_hash
        where required_source.allocation_fact_id = seed_fact.allocation_fact_id
          and (
            required_occurrence.chain_id <> run.chain_id
            or required_occurrence.release_id <> run.release_id
            or required_occurrence.model_id <> run.model_id
            or required_occurrence.epoch_id <> run.epoch_id
            or required_occurrence.pointer_generation
              <> run.captured_pointer_generation
            or required_occurrence.release_binding_id
              <> required_source.release_binding_id
            or required_binding.epoch_id <> run.epoch_id
            or required_binding.source_role <> required_source.occurrence_role
            or required_binding.binding_commitment
              <> required_source.release_binding_commitment
            or required_canonical.occurrence_id is null
          )
      )
  )
$function$;

create view programmable_private.current_token_project_metadata_v1
with (security_invoker = false, security_barrier = true)
as
select
  metadata.chain_id,
  metadata.token,
  metadata.metadata_id,
  metadata.project_name,
  metadata.description as project_description,
  metadata.logo_reference as project_logo_reference,
  metadata.metadata_revision as project_metadata_revision,
  metadata.created_at as project_metadata_created_at,
  coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'kind', link.link_kind,
        'url', link.https_url,
        'displayOrder', link.display_order
      )
      order by link.display_order, link.project_link_id
    ) filter (where link.project_link_id is not null),
    '[]'::jsonb
  ) as project_links
from programmable_private.token_project_metadata as metadata
left join programmable_private.project_links as link
  on link.metadata_id = metadata.metadata_id
where not exists (
  select 1
  from programmable_private.token_project_metadata as newer
  where newer.chain_id = metadata.chain_id
    and newer.token = metadata.token
    and newer.metadata_revision > metadata.metadata_revision
)
group by
  metadata.chain_id, metadata.token, metadata.metadata_id,
  metadata.project_name, metadata.description, metadata.logo_reference,
  metadata.metadata_revision, metadata.created_at;

-- These route keys are the database identifiers for the independently gated
-- route groups in docs/data-pipeline/ARCHITECTURE.md: Explore list/detail,
-- creator profile (including Stock-Paired), Classic V3 profile, and launch
-- confirmation lookup. Eligibility for one route never implies another.
create view programmable_private.recent_launches_v1
with (security_invoker = false, security_barrier = true)
as
select
  launch.chain_id,
  launch.release_id,
  launch.model_id,
  launch.token,
  launch.creator,
  launch.launch_transaction_hash,
  launch.pool_id,
  launch.reward_vault,
  launch.launch_hash,
  launch.token_name,
  launch.token_symbol,
  launch.total_supply,
  run.source_group,
  launch.epoch_id,
  launch.pointer_generation,
  launch.projection_run_id,
  source_occurrence.block_timestamp as launch_block_timestamp,
  source_occurrence.transaction_index::bigint as launch_transaction_index,
  source_occurrence.receipt_log_ordinal::bigint as launch_receipt_log_ordinal,
  pool.currency0,
  pool.currency1,
  pool.hook,
  pool.pool_key_fee,
  pool.tick_spacing,
  case
    when pool.currency0 = launch.token then pool.currency1
    when pool.currency1 = launch.token then pool.currency0
    else null
  end as quote_asset,
  fee.buy_swap_fee_bps,
  fee.sell_swap_fee_bps,
  fee.buy_creator_fee_bps,
  fee.sell_creator_fee_bps,
  fee.creator_fee_bps,
  fee.launcher_fee_bps,
  fee.transfer_tax_bps,
  fee.lp_fee_pips,
  greatest(fee.buy_swap_fee_bps, fee.sell_swap_fee_bps)
    as total_swap_fee_bps,
  metadata.project_name,
  metadata.project_description,
  metadata.project_logo_reference,
  metadata.project_metadata_revision,
  metadata.project_metadata_created_at,
  coalesce(metadata.project_links, '[]'::jsonb) as project_links,
  launch.promoted_block_number,
  launch.promoted_block_hash,
  launch.verified_at,
  profile.username as creator_username,
  profile.avatar_reference as creator_avatar_reference
from programmable_private.current_launch_projections_v1 as launch
join programmable_private.run_headers as run
  on run.run_id = launch.projection_run_id
 and run.run_kind = 'projection'
 and run.chain_id = launch.chain_id
 and run.release_id = launch.release_id
 and run.model_id = launch.model_id
 and run.epoch_id = launch.epoch_id
 and run.captured_pointer_generation = launch.pointer_generation
join programmable_private.projection_publications as publication
  on publication.run_id = launch.projection_run_id
 and publication.epoch_id = launch.epoch_id
 and publication.pointer_generation = launch.pointer_generation
 and publication.target_block_number = launch.promoted_block_number
 and publication.target_block_hash = launch.promoted_block_hash
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = launch.chain_id
 and current_epoch.release_id = launch.release_id
 and current_epoch.model_id = launch.model_id
 and current_epoch.source_group = run.source_group
 and current_epoch.epoch_id = launch.epoch_id
 and current_epoch.generation = launch.pointer_generation
join programmable_private.route_eligibility_current as route
  on route.route_key = 'explore-list'
 and route.chain_id = launch.chain_id
 and route.release_id = launch.release_id
 and route.model_id = launch.model_id
 and route.source_group = run.source_group
 and route.epoch_id = launch.epoch_id
 and route.pointer_generation = launch.pointer_generation
 and route.checkpoint_id is not null
 and route.status = 'eligible'
 and route.route_mode = 'indexed'
join programmable_private.chain_event_current_canonical as canonical
  on canonical.logical_event_id = launch.last_source_logical_event_id
 and canonical.occurrence_id = launch.last_source_occurrence_id
 and canonical.block_hash = launch.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as source_occurrence
  on source_occurrence.occurrence_id = launch.last_source_occurrence_id
 and source_occurrence.logical_event_id = launch.last_source_logical_event_id
 and source_occurrence.block_hash = launch.last_source_occurrence_block_hash
 and source_occurrence.chain_id = run.chain_id
 and source_occurrence.release_id = run.release_id
 and source_occurrence.model_id = run.model_id
 and source_occurrence.epoch_id = run.epoch_id
 and source_occurrence.pointer_generation = run.captured_pointer_generation
join programmable_private.pool_projections as pool
  on pool.launch_projection_id = launch.launch_projection_id
 and pool.projection_run_id = launch.projection_run_id
 and pool.chain_id = launch.chain_id
 and pool.release_id = launch.release_id
 and pool.model_id = launch.model_id
 and pool.epoch_id = launch.epoch_id
 and pool.pointer_generation = launch.pointer_generation
 and pool.pool_id = launch.pool_id
 and pool.promoted_block_number = launch.promoted_block_number
 and pool.promoted_block_hash = launch.promoted_block_hash
 and (pool.currency0 = launch.token or pool.currency1 = launch.token)
join programmable_private.chain_event_current_canonical as pool_canonical
  on pool_canonical.logical_event_id = pool.last_source_logical_event_id
 and pool_canonical.occurrence_id = pool.last_source_occurrence_id
 and pool_canonical.block_hash = pool.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as pool_source_occurrence
  on pool_source_occurrence.occurrence_id = pool.last_source_occurrence_id
 and pool_source_occurrence.logical_event_id = pool.last_source_logical_event_id
 and pool_source_occurrence.block_hash = pool.last_source_occurrence_block_hash
 and pool_source_occurrence.chain_id = run.chain_id
 and pool_source_occurrence.release_id = run.release_id
 and pool_source_occurrence.model_id = run.model_id
 and pool_source_occurrence.epoch_id = run.epoch_id
 and pool_source_occurrence.pointer_generation = run.captured_pointer_generation
join programmable_private.pool_fee_configurations as fee
  on fee.pool_projection_id = pool.pool_projection_id
 and fee.projection_run_id = pool.projection_run_id
 and fee.chain_id = pool.chain_id
 and fee.release_id = pool.release_id
 and fee.model_id = pool.model_id
 and fee.epoch_id = pool.epoch_id
 and fee.pointer_generation = pool.pointer_generation
 and fee.promoted_block_number = pool.promoted_block_number
 and fee.promoted_block_hash = pool.promoted_block_hash
join programmable_private.chain_event_current_canonical as fee_canonical
  on fee_canonical.logical_event_id = fee.disclosure_source_logical_event_id
 and fee_canonical.occurrence_id = fee.disclosure_source_occurrence_id
 and fee_canonical.block_hash = fee.disclosure_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as fee_source_occurrence
  on fee_source_occurrence.occurrence_id = fee.disclosure_source_occurrence_id
 and fee_source_occurrence.logical_event_id = fee.disclosure_source_logical_event_id
 and fee_source_occurrence.block_hash = fee.disclosure_source_occurrence_block_hash
 and fee_source_occurrence.chain_id = run.chain_id
 and fee_source_occurrence.release_id = run.release_id
 and fee_source_occurrence.model_id = run.model_id
 and fee_source_occurrence.epoch_id = run.epoch_id
 and fee_source_occurrence.pointer_generation = run.captured_pointer_generation
left join programmable_private.current_token_project_metadata_v1 as metadata
  on metadata.chain_id = launch.chain_id
 and metadata.token = launch.token
left join programmable_private.profile_owner_binding_current as owner_binding
  on owner_binding.wallet = launch.creator
 and owner_binding.state in ('active', 'recovered')
left join programmable_private.profiles as profile
  on profile.subject_id = owner_binding.subject_id
 and profile.deleted_at is null
where launch.is_complete
  and (
    launch.reward_vault is null
    or programmable_private.has_current_verified_reward_seed(
      run.run_id,
      launch.reward_vault
    )
  );

create view programmable_private.launch_by_token_v1
with (security_invoker = false, security_barrier = true)
as
select
  launch.chain_id,
  launch.release_id,
  launch.model_id,
  launch.token,
  launch.creator,
  launch.launch_transaction_hash,
  launch.pool_id,
  launch.reward_vault,
  launch.launch_hash,
  launch.token_name,
  launch.token_symbol,
  launch.total_supply,
  run.source_group,
  launch.epoch_id,
  launch.pointer_generation,
  launch.projection_run_id,
  source_occurrence.block_timestamp as launch_block_timestamp,
  source_occurrence.transaction_index::bigint as launch_transaction_index,
  source_occurrence.receipt_log_ordinal::bigint as launch_receipt_log_ordinal,
  pool.currency0,
  pool.currency1,
  pool.hook,
  pool.pool_key_fee,
  pool.tick_spacing,
  case
    when pool.currency0 = launch.token then pool.currency1
    when pool.currency1 = launch.token then pool.currency0
    else null
  end as quote_asset,
  fee.buy_swap_fee_bps,
  fee.sell_swap_fee_bps,
  fee.buy_creator_fee_bps,
  fee.sell_creator_fee_bps,
  fee.creator_fee_bps,
  fee.launcher_fee_bps,
  fee.transfer_tax_bps,
  fee.lp_fee_pips,
  greatest(fee.buy_swap_fee_bps, fee.sell_swap_fee_bps)
    as total_swap_fee_bps,
  metadata.project_name,
  metadata.project_description,
  metadata.project_logo_reference,
  metadata.project_metadata_revision,
  metadata.project_metadata_created_at,
  coalesce(metadata.project_links, '[]'::jsonb) as project_links,
  launch.promoted_block_number,
  launch.promoted_block_hash,
  launch.verified_at,
  profile.username as creator_username,
  profile.avatar_reference as creator_avatar_reference
from programmable_private.current_launch_projections_v1 as launch
join programmable_private.run_headers as run
  on run.run_id = launch.projection_run_id
 and run.run_kind = 'projection'
 and run.chain_id = launch.chain_id
 and run.release_id = launch.release_id
 and run.model_id = launch.model_id
 and run.epoch_id = launch.epoch_id
 and run.captured_pointer_generation = launch.pointer_generation
join programmable_private.projection_publications as publication
  on publication.run_id = launch.projection_run_id
 and publication.epoch_id = launch.epoch_id
 and publication.pointer_generation = launch.pointer_generation
 and publication.target_block_number = launch.promoted_block_number
 and publication.target_block_hash = launch.promoted_block_hash
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = launch.chain_id
 and current_epoch.release_id = launch.release_id
 and current_epoch.model_id = launch.model_id
 and current_epoch.source_group = run.source_group
 and current_epoch.epoch_id = launch.epoch_id
 and current_epoch.generation = launch.pointer_generation
join programmable_private.route_eligibility_current as route
  on route.route_key = 'explore-token'
 and route.chain_id = launch.chain_id
 and route.release_id = launch.release_id
 and route.model_id = launch.model_id
 and route.source_group = run.source_group
 and route.epoch_id = launch.epoch_id
 and route.pointer_generation = launch.pointer_generation
 and route.checkpoint_id is not null
 and route.status = 'eligible'
 and route.route_mode = 'indexed'
join programmable_private.chain_event_current_canonical as canonical
  on canonical.logical_event_id = launch.last_source_logical_event_id
 and canonical.occurrence_id = launch.last_source_occurrence_id
 and canonical.block_hash = launch.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as source_occurrence
  on source_occurrence.occurrence_id = launch.last_source_occurrence_id
 and source_occurrence.logical_event_id = launch.last_source_logical_event_id
 and source_occurrence.block_hash = launch.last_source_occurrence_block_hash
 and source_occurrence.chain_id = run.chain_id
 and source_occurrence.release_id = run.release_id
 and source_occurrence.model_id = run.model_id
 and source_occurrence.epoch_id = run.epoch_id
 and source_occurrence.pointer_generation = run.captured_pointer_generation
join programmable_private.pool_projections as pool
  on pool.launch_projection_id = launch.launch_projection_id
 and pool.projection_run_id = launch.projection_run_id
 and pool.chain_id = launch.chain_id
 and pool.release_id = launch.release_id
 and pool.model_id = launch.model_id
 and pool.epoch_id = launch.epoch_id
 and pool.pointer_generation = launch.pointer_generation
 and pool.pool_id = launch.pool_id
 and pool.promoted_block_number = launch.promoted_block_number
 and pool.promoted_block_hash = launch.promoted_block_hash
 and (pool.currency0 = launch.token or pool.currency1 = launch.token)
join programmable_private.chain_event_current_canonical as pool_canonical
  on pool_canonical.logical_event_id = pool.last_source_logical_event_id
 and pool_canonical.occurrence_id = pool.last_source_occurrence_id
 and pool_canonical.block_hash = pool.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as pool_source_occurrence
  on pool_source_occurrence.occurrence_id = pool.last_source_occurrence_id
 and pool_source_occurrence.logical_event_id = pool.last_source_logical_event_id
 and pool_source_occurrence.block_hash = pool.last_source_occurrence_block_hash
 and pool_source_occurrence.chain_id = run.chain_id
 and pool_source_occurrence.release_id = run.release_id
 and pool_source_occurrence.model_id = run.model_id
 and pool_source_occurrence.epoch_id = run.epoch_id
 and pool_source_occurrence.pointer_generation = run.captured_pointer_generation
join programmable_private.pool_fee_configurations as fee
  on fee.pool_projection_id = pool.pool_projection_id
 and fee.projection_run_id = pool.projection_run_id
 and fee.chain_id = pool.chain_id
 and fee.release_id = pool.release_id
 and fee.model_id = pool.model_id
 and fee.epoch_id = pool.epoch_id
 and fee.pointer_generation = pool.pointer_generation
 and fee.promoted_block_number = pool.promoted_block_number
 and fee.promoted_block_hash = pool.promoted_block_hash
join programmable_private.chain_event_current_canonical as fee_canonical
  on fee_canonical.logical_event_id = fee.disclosure_source_logical_event_id
 and fee_canonical.occurrence_id = fee.disclosure_source_occurrence_id
 and fee_canonical.block_hash = fee.disclosure_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as fee_source_occurrence
  on fee_source_occurrence.occurrence_id = fee.disclosure_source_occurrence_id
 and fee_source_occurrence.logical_event_id = fee.disclosure_source_logical_event_id
 and fee_source_occurrence.block_hash = fee.disclosure_source_occurrence_block_hash
 and fee_source_occurrence.chain_id = run.chain_id
 and fee_source_occurrence.release_id = run.release_id
 and fee_source_occurrence.model_id = run.model_id
 and fee_source_occurrence.epoch_id = run.epoch_id
 and fee_source_occurrence.pointer_generation = run.captured_pointer_generation
left join programmable_private.current_token_project_metadata_v1 as metadata
  on metadata.chain_id = launch.chain_id
 and metadata.token = launch.token
left join programmable_private.profile_owner_binding_current as owner_binding
  on owner_binding.wallet = launch.creator
 and owner_binding.state in ('active', 'recovered')
left join programmable_private.profiles as profile
  on profile.subject_id = owner_binding.subject_id
 and profile.deleted_at is null
where launch.is_complete
  and (
    launch.reward_vault is null
    or programmable_private.has_current_verified_reward_seed(
      run.run_id,
      launch.reward_vault
    )
  );

create view programmable_private.launches_by_creator_v1
with (security_invoker = false, security_barrier = true)
as
select
  launch.chain_id,
  launch.release_id,
  launch.model_id,
  launch.token,
  launch.creator,
  launch.launch_transaction_hash,
  launch.pool_id,
  launch.reward_vault,
  launch.launch_hash,
  launch.token_name,
  launch.token_symbol,
  launch.total_supply,
  run.source_group,
  launch.epoch_id,
  launch.pointer_generation,
  launch.projection_run_id,
  source_occurrence.block_timestamp as launch_block_timestamp,
  source_occurrence.transaction_index::bigint as launch_transaction_index,
  source_occurrence.receipt_log_ordinal::bigint as launch_receipt_log_ordinal,
  pool.currency0,
  pool.currency1,
  pool.hook,
  pool.pool_key_fee,
  pool.tick_spacing,
  case
    when pool.currency0 = launch.token then pool.currency1
    when pool.currency1 = launch.token then pool.currency0
    else null
  end as quote_asset,
  fee.buy_swap_fee_bps,
  fee.sell_swap_fee_bps,
  fee.buy_creator_fee_bps,
  fee.sell_creator_fee_bps,
  fee.creator_fee_bps,
  fee.launcher_fee_bps,
  fee.transfer_tax_bps,
  fee.lp_fee_pips,
  greatest(fee.buy_swap_fee_bps, fee.sell_swap_fee_bps)
    as total_swap_fee_bps,
  metadata.project_name,
  metadata.project_description,
  metadata.project_logo_reference,
  metadata.project_metadata_revision,
  metadata.project_metadata_created_at,
  coalesce(metadata.project_links, '[]'::jsonb) as project_links,
  launch.promoted_block_number,
  launch.promoted_block_hash,
  launch.verified_at
from programmable_private.current_launch_projections_v1 as launch
join programmable_private.run_headers as run
  on run.run_id = launch.projection_run_id
 and run.run_kind = 'projection'
 and run.chain_id = launch.chain_id
 and run.release_id = launch.release_id
 and run.model_id = launch.model_id
 and run.epoch_id = launch.epoch_id
 and run.captured_pointer_generation = launch.pointer_generation
join programmable_private.projection_publications as publication
  on publication.run_id = launch.projection_run_id
 and publication.epoch_id = launch.epoch_id
 and publication.pointer_generation = launch.pointer_generation
 and publication.target_block_number = launch.promoted_block_number
 and publication.target_block_hash = launch.promoted_block_hash
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = launch.chain_id
 and current_epoch.release_id = launch.release_id
 and current_epoch.model_id = launch.model_id
 and current_epoch.source_group = run.source_group
 and current_epoch.epoch_id = launch.epoch_id
 and current_epoch.generation = launch.pointer_generation
join programmable_private.route_eligibility_current as route
  on route.route_key = 'creator-profile'
 and route.chain_id = launch.chain_id
 and route.release_id = launch.release_id
 and route.model_id = launch.model_id
 and route.source_group = run.source_group
 and route.epoch_id = launch.epoch_id
 and route.pointer_generation = launch.pointer_generation
 and route.checkpoint_id is not null
 and route.status = 'eligible'
 and route.route_mode = 'indexed'
join programmable_private.chain_event_current_canonical as canonical
  on canonical.logical_event_id = launch.last_source_logical_event_id
 and canonical.occurrence_id = launch.last_source_occurrence_id
 and canonical.block_hash = launch.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as source_occurrence
  on source_occurrence.occurrence_id = launch.last_source_occurrence_id
 and source_occurrence.logical_event_id = launch.last_source_logical_event_id
 and source_occurrence.block_hash = launch.last_source_occurrence_block_hash
 and source_occurrence.chain_id = run.chain_id
 and source_occurrence.release_id = run.release_id
 and source_occurrence.model_id = run.model_id
 and source_occurrence.epoch_id = run.epoch_id
 and source_occurrence.pointer_generation = run.captured_pointer_generation
join programmable_private.pool_projections as pool
  on pool.launch_projection_id = launch.launch_projection_id
 and pool.projection_run_id = launch.projection_run_id
 and pool.chain_id = launch.chain_id
 and pool.release_id = launch.release_id
 and pool.model_id = launch.model_id
 and pool.epoch_id = launch.epoch_id
 and pool.pointer_generation = launch.pointer_generation
 and pool.pool_id = launch.pool_id
 and pool.promoted_block_number = launch.promoted_block_number
 and pool.promoted_block_hash = launch.promoted_block_hash
 and (pool.currency0 = launch.token or pool.currency1 = launch.token)
join programmable_private.chain_event_current_canonical as pool_canonical
  on pool_canonical.logical_event_id = pool.last_source_logical_event_id
 and pool_canonical.occurrence_id = pool.last_source_occurrence_id
 and pool_canonical.block_hash = pool.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as pool_source_occurrence
  on pool_source_occurrence.occurrence_id = pool.last_source_occurrence_id
 and pool_source_occurrence.logical_event_id = pool.last_source_logical_event_id
 and pool_source_occurrence.block_hash = pool.last_source_occurrence_block_hash
 and pool_source_occurrence.chain_id = run.chain_id
 and pool_source_occurrence.release_id = run.release_id
 and pool_source_occurrence.model_id = run.model_id
 and pool_source_occurrence.epoch_id = run.epoch_id
 and pool_source_occurrence.pointer_generation = run.captured_pointer_generation
join programmable_private.pool_fee_configurations as fee
  on fee.pool_projection_id = pool.pool_projection_id
 and fee.projection_run_id = pool.projection_run_id
 and fee.chain_id = pool.chain_id
 and fee.release_id = pool.release_id
 and fee.model_id = pool.model_id
 and fee.epoch_id = pool.epoch_id
 and fee.pointer_generation = pool.pointer_generation
 and fee.promoted_block_number = pool.promoted_block_number
 and fee.promoted_block_hash = pool.promoted_block_hash
join programmable_private.chain_event_current_canonical as fee_canonical
  on fee_canonical.logical_event_id = fee.disclosure_source_logical_event_id
 and fee_canonical.occurrence_id = fee.disclosure_source_occurrence_id
 and fee_canonical.block_hash = fee.disclosure_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as fee_source_occurrence
  on fee_source_occurrence.occurrence_id = fee.disclosure_source_occurrence_id
 and fee_source_occurrence.logical_event_id = fee.disclosure_source_logical_event_id
 and fee_source_occurrence.block_hash = fee.disclosure_source_occurrence_block_hash
 and fee_source_occurrence.chain_id = run.chain_id
 and fee_source_occurrence.release_id = run.release_id
 and fee_source_occurrence.model_id = run.model_id
 and fee_source_occurrence.epoch_id = run.epoch_id
 and fee_source_occurrence.pointer_generation = run.captured_pointer_generation
left join programmable_private.current_token_project_metadata_v1 as metadata
  on metadata.chain_id = launch.chain_id
 and metadata.token = launch.token
where launch.is_complete
  and (
    launch.reward_vault is null
    or programmable_private.has_current_verified_reward_seed(
      run.run_id,
      launch.reward_vault
    )
  );

create view programmable_private.market_snapshots_v1
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
 and launch.pool_id = snapshot.pool_id;

create view programmable_private.market_candles_v1
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
 and launch.pool_id = candle.pool_id;

create view programmable_private.account_reward_summaries_v1
with (security_invoker = false, security_barrier = true)
as
select
  balance.chain_id,
  balance.release_id,
  balance.model_id,
  balance.account,
  balance.vault,
  launch.pool_id,
  launch.hook,
  launch.quote_asset,
  balance.claimable_accrued + balance.claimed_total as entitled,
  balance.claimable_accrued,
  balance.claimed_total,
  balance.promoted_block_number,
  balance.promoted_block_hash,
  balance.verified_at,
  launch.token,
  launch.token_name,
  launch.token_symbol,
  launch.creator
from programmable_private.current_account_reward_balances_v1 as balance
join programmable_private.launches_by_creator_v1 as launch
  on launch.chain_id = balance.chain_id
 and launch.release_id = balance.release_id
 and launch.model_id = balance.model_id
 and launch.epoch_id = balance.epoch_id
 and launch.pointer_generation = balance.pointer_generation
 and launch.reward_vault = balance.vault
join programmable_private.run_headers as run
  on run.run_id = balance.projection_run_id
 and run.run_kind = 'projection'
 and run.chain_id = balance.chain_id
 and run.release_id = balance.release_id
 and run.model_id = balance.model_id
 and run.epoch_id = balance.epoch_id
 and run.captured_pointer_generation = balance.pointer_generation
join programmable_private.projection_publications as publication
  on publication.run_id = balance.projection_run_id
 and publication.epoch_id = run.epoch_id
 and publication.pointer_generation = run.captured_pointer_generation
 and publication.target_block_number = balance.promoted_block_number
 and publication.target_block_hash = balance.promoted_block_hash
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = balance.chain_id
 and current_epoch.release_id = balance.release_id
 and current_epoch.model_id = balance.model_id
 and current_epoch.source_group = run.source_group
 and current_epoch.epoch_id = run.epoch_id
 and current_epoch.generation = run.captured_pointer_generation
join programmable_private.route_eligibility_current as route
  on route.route_key = 'creator-profile'
 and route.chain_id = balance.chain_id
 and route.release_id = balance.release_id
 and route.model_id = balance.model_id
 and route.source_group = run.source_group
 and route.epoch_id = run.epoch_id
 and route.pointer_generation = run.captured_pointer_generation
 and route.checkpoint_id is not null
 and route.status = 'eligible'
 and route.route_mode = 'indexed'
join programmable_private.chain_event_current_canonical as canonical
  on canonical.logical_event_id = balance.last_source_logical_event_id
 and canonical.occurrence_id = balance.last_source_occurrence_id
 and canonical.block_hash = balance.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as source_occurrence
  on source_occurrence.occurrence_id = balance.last_source_occurrence_id
 and source_occurrence.logical_event_id = balance.last_source_logical_event_id
 and source_occurrence.block_hash = balance.last_source_occurrence_block_hash
 and source_occurrence.chain_id = run.chain_id
 and source_occurrence.release_id = run.release_id
 and source_occurrence.model_id = run.model_id
 and source_occurrence.epoch_id = run.epoch_id
 and source_occurrence.pointer_generation = run.captured_pointer_generation
where programmable_private.has_current_verified_reward_seed(
  run.run_id,
  balance.vault
);

create view programmable_private.creator_reward_summaries_v1
with (security_invoker = false, security_barrier = true)
as
select
  account.chain_id,
  account.release_id,
  account.model_id,
  account.account as creator,
  pg_catalog.sum(account.claimable_accrued) as claimable_accrued,
  pg_catalog.sum(account.claimed_total) as claimed_total,
  pg_catalog.max(account.promoted_block_number) as promoted_block_number,
  pg_catalog.max(account.verified_at) as verified_at
from programmable_private.account_reward_summaries_v1 as account
group by account.chain_id, account.release_id, account.model_id, account.account;

create view programmable_private.classic_v3_vault_history_v1
with (security_invoker = false, security_barrier = true)
as
select
  vault.chain_id,
  vault.release_id,
  vault.model_id,
  vault.vault,
  vault.pool_id,
  vault.configuration_hash,
  allocation.configuration_epoch,
  allocation.allocation_index,
  allocation.beneficiary,
  allocation.payout_address,
  allocation.share_bps,
  allocation.effective_from_block,
  allocation.effective_to_block,
  vault.promoted_block_number,
  vault.promoted_block_hash,
  vault.verified_at
from programmable_private.current_reward_vault_projections_v1 as vault
join programmable_private.launch_projections as launch
  on launch.launch_projection_id = vault.launch_projection_id
 and launch.projection_run_id = vault.projection_run_id
 and launch.chain_id = vault.chain_id
 and launch.release_id = vault.release_id
 and launch.model_id = vault.model_id
 and launch.epoch_id = vault.epoch_id
 and launch.pointer_generation = vault.pointer_generation
 and launch.reward_vault = vault.vault
 and launch.pool_id = vault.pool_id
 and launch.promoted_block_number = vault.promoted_block_number
 and launch.promoted_block_hash = vault.promoted_block_hash
 and launch.is_complete
join programmable_private.run_headers as run
  on run.run_id = vault.projection_run_id
 and run.run_kind = 'projection'
 and run.chain_id = vault.chain_id
 and run.release_id = vault.release_id
 and run.model_id = vault.model_id
 and run.epoch_id = vault.epoch_id
 and run.captured_pointer_generation = vault.pointer_generation
join programmable_private.projection_publications as publication
  on publication.run_id = vault.projection_run_id
 and publication.epoch_id = run.epoch_id
 and publication.pointer_generation = run.captured_pointer_generation
 and publication.target_block_number = vault.promoted_block_number
 and publication.target_block_hash = vault.promoted_block_hash
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = run.chain_id
 and current_epoch.release_id = run.release_id
 and current_epoch.model_id = run.model_id
 and current_epoch.source_group = run.source_group
 and current_epoch.epoch_id = run.epoch_id
 and current_epoch.generation = run.captured_pointer_generation
join programmable_private.route_eligibility_current as route
  on route.route_key = 'classic-v3-profile'
 and route.chain_id = run.chain_id
 and route.release_id = run.release_id
 and route.model_id = run.model_id
 and route.source_group = run.source_group
 and route.epoch_id = run.epoch_id
 and route.pointer_generation = run.captured_pointer_generation
 and route.checkpoint_id is not null
 and route.status = 'eligible'
 and route.route_mode = 'indexed'
join programmable_private.chain_event_current_canonical as launch_canonical
  on launch_canonical.logical_event_id = launch.last_source_logical_event_id
 and launch_canonical.occurrence_id = launch.last_source_occurrence_id
 and launch_canonical.block_hash = launch.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as launch_source_occurrence
  on launch_source_occurrence.occurrence_id = launch.last_source_occurrence_id
 and launch_source_occurrence.logical_event_id = launch.last_source_logical_event_id
 and launch_source_occurrence.block_hash = launch.last_source_occurrence_block_hash
 and launch_source_occurrence.chain_id = run.chain_id
 and launch_source_occurrence.release_id = run.release_id
 and launch_source_occurrence.model_id = run.model_id
 and launch_source_occurrence.epoch_id = run.epoch_id
 and launch_source_occurrence.pointer_generation = run.captured_pointer_generation
join programmable_private.reward_allocation_current_verified as verified_seed
  on verified_seed.allocation_fact_id = vault.current_allocation_fact_id
 and verified_seed.vault = vault.vault
join programmable_private.reward_allocation_facts as seed_fact
  on seed_fact.allocation_fact_id = verified_seed.allocation_fact_id
 and seed_fact.factory_occurrence_id = verified_seed.factory_occurrence_id
 and seed_fact.vault = verified_seed.vault
 and seed_fact.chain_id = run.chain_id
 and seed_fact.release_id = run.release_id
 and seed_fact.model_id = run.model_id
 and seed_fact.epoch_id = run.epoch_id
 and seed_fact.pointer_generation = run.captured_pointer_generation
join programmable_private.chain_event_current_canonical as seed_canonical
  on seed_canonical.logical_event_id = seed_fact.factory_logical_event_id
 and seed_canonical.occurrence_id = seed_fact.factory_occurrence_id
 and seed_canonical.block_hash = seed_fact.factory_occurrence_block_hash
join programmable_private.chain_event_current_canonical as vault_canonical
  on vault_canonical.logical_event_id = vault.last_source_logical_event_id
 and vault_canonical.occurrence_id = vault.last_source_occurrence_id
 and vault_canonical.block_hash = vault.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as vault_source_occurrence
  on vault_source_occurrence.occurrence_id = vault.last_source_occurrence_id
 and vault_source_occurrence.logical_event_id = vault.last_source_logical_event_id
 and vault_source_occurrence.block_hash = vault.last_source_occurrence_block_hash
 and vault_source_occurrence.chain_id = run.chain_id
 and vault_source_occurrence.release_id = run.release_id
 and vault_source_occurrence.model_id = run.model_id
 and vault_source_occurrence.epoch_id = run.epoch_id
 and vault_source_occurrence.pointer_generation = run.captured_pointer_generation
join programmable_private.reward_allocation_projections as allocation
  on allocation.reward_vault_projection_id = vault.reward_vault_projection_id
 and allocation.projection_run_id = vault.projection_run_id
 and allocation.allocation_fact_id = seed_fact.allocation_fact_id
 and allocation.chain_id = run.chain_id
 and allocation.release_id = run.release_id
 and allocation.model_id = run.model_id
 and allocation.epoch_id = run.epoch_id
 and allocation.pointer_generation = run.captured_pointer_generation
 and allocation.promoted_block_number = publication.target_block_number
 and allocation.promoted_block_hash = publication.target_block_hash
join programmable_private.chain_event_current_canonical as allocation_canonical
  on allocation_canonical.logical_event_id = allocation.last_source_logical_event_id
 and allocation_canonical.occurrence_id = allocation.last_source_occurrence_id
 and allocation_canonical.block_hash = allocation.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as allocation_source_occurrence
  on allocation_source_occurrence.occurrence_id = allocation.last_source_occurrence_id
 and allocation_source_occurrence.logical_event_id = allocation.last_source_logical_event_id
 and allocation_source_occurrence.block_hash = allocation.last_source_occurrence_block_hash
 and allocation_source_occurrence.chain_id = run.chain_id
 and allocation_source_occurrence.release_id = run.release_id
 and allocation_source_occurrence.model_id = run.model_id
 and allocation_source_occurrence.epoch_id = run.epoch_id
 and allocation_source_occurrence.pointer_generation
   = run.captured_pointer_generation
where vault.model_id like 'classic%'
  and not exists (
    select 1
    from programmable_private.reward_allocation_required_occurrences as required
    join programmable_private.chain_event_materialized_occurrences_v1 as required_occurrence
      on required_occurrence.occurrence_id = required.occurrence_id
    left join programmable_private.chain_event_current_canonical as required_canonical
      on required_canonical.logical_event_id = required_occurrence.logical_event_id
     and required_canonical.occurrence_id = required_occurrence.occurrence_id
     and required_canonical.block_hash = required_occurrence.block_hash
    where required.allocation_fact_id = seed_fact.allocation_fact_id
      and (
        required_occurrence.chain_id <> run.chain_id
        or required_occurrence.release_id <> run.release_id
        or required_occurrence.model_id <> run.model_id
        or required_occurrence.epoch_id <> run.epoch_id
        or required_occurrence.pointer_generation <> run.captured_pointer_generation
        or required_canonical.occurrence_id is null
      )
  );

create view programmable_private.stock_paired_vault_history_v1
with (security_invoker = false, security_barrier = true)
as
select
  vault.chain_id,
  vault.release_id,
  vault.model_id,
  vault.vault,
  vault.pool_id,
  vault.quote_asset,
  vault.configuration_hash,
  allocation.configuration_epoch,
  allocation.allocation_index,
  allocation.beneficiary,
  allocation.payout_address,
  allocation.share_bps,
  allocation.effective_from_block,
  allocation.effective_to_block,
  vault.promoted_block_number,
  vault.promoted_block_hash,
  vault.verified_at
from programmable_private.current_reward_vault_projections_v1 as vault
join programmable_private.launch_projections as launch
  on launch.launch_projection_id = vault.launch_projection_id
 and launch.projection_run_id = vault.projection_run_id
 and launch.chain_id = vault.chain_id
 and launch.release_id = vault.release_id
 and launch.model_id = vault.model_id
 and launch.epoch_id = vault.epoch_id
 and launch.pointer_generation = vault.pointer_generation
 and launch.reward_vault = vault.vault
 and launch.pool_id = vault.pool_id
 and launch.promoted_block_number = vault.promoted_block_number
 and launch.promoted_block_hash = vault.promoted_block_hash
 and launch.is_complete
join programmable_private.run_headers as run
  on run.run_id = vault.projection_run_id
 and run.run_kind = 'projection'
 and run.chain_id = vault.chain_id
 and run.release_id = vault.release_id
 and run.model_id = vault.model_id
 and run.epoch_id = vault.epoch_id
 and run.captured_pointer_generation = vault.pointer_generation
join programmable_private.projection_publications as publication
  on publication.run_id = vault.projection_run_id
 and publication.epoch_id = run.epoch_id
 and publication.pointer_generation = run.captured_pointer_generation
 and publication.target_block_number = vault.promoted_block_number
 and publication.target_block_hash = vault.promoted_block_hash
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
join programmable_private.chain_event_current_canonical as launch_canonical
  on launch_canonical.logical_event_id = launch.last_source_logical_event_id
 and launch_canonical.occurrence_id = launch.last_source_occurrence_id
 and launch_canonical.block_hash = launch.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as launch_source_occurrence
  on launch_source_occurrence.occurrence_id = launch.last_source_occurrence_id
 and launch_source_occurrence.logical_event_id = launch.last_source_logical_event_id
 and launch_source_occurrence.block_hash = launch.last_source_occurrence_block_hash
 and launch_source_occurrence.chain_id = run.chain_id
 and launch_source_occurrence.release_id = run.release_id
 and launch_source_occurrence.model_id = run.model_id
 and launch_source_occurrence.epoch_id = run.epoch_id
 and launch_source_occurrence.pointer_generation = run.captured_pointer_generation
join programmable_private.reward_allocation_current_verified as verified_seed
  on verified_seed.allocation_fact_id = vault.current_allocation_fact_id
 and verified_seed.vault = vault.vault
join programmable_private.reward_allocation_facts as seed_fact
  on seed_fact.allocation_fact_id = verified_seed.allocation_fact_id
 and seed_fact.factory_occurrence_id = verified_seed.factory_occurrence_id
 and seed_fact.vault = verified_seed.vault
 and seed_fact.chain_id = run.chain_id
 and seed_fact.release_id = run.release_id
 and seed_fact.model_id = run.model_id
 and seed_fact.epoch_id = run.epoch_id
 and seed_fact.pointer_generation = run.captured_pointer_generation
join programmable_private.chain_event_current_canonical as seed_canonical
  on seed_canonical.logical_event_id = seed_fact.factory_logical_event_id
 and seed_canonical.occurrence_id = seed_fact.factory_occurrence_id
 and seed_canonical.block_hash = seed_fact.factory_occurrence_block_hash
join programmable_private.chain_event_current_canonical as vault_canonical
  on vault_canonical.logical_event_id = vault.last_source_logical_event_id
 and vault_canonical.occurrence_id = vault.last_source_occurrence_id
 and vault_canonical.block_hash = vault.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as vault_source_occurrence
  on vault_source_occurrence.occurrence_id = vault.last_source_occurrence_id
 and vault_source_occurrence.logical_event_id = vault.last_source_logical_event_id
 and vault_source_occurrence.block_hash = vault.last_source_occurrence_block_hash
 and vault_source_occurrence.chain_id = run.chain_id
 and vault_source_occurrence.release_id = run.release_id
 and vault_source_occurrence.model_id = run.model_id
 and vault_source_occurrence.epoch_id = run.epoch_id
 and vault_source_occurrence.pointer_generation = run.captured_pointer_generation
join programmable_private.reward_allocation_projections as allocation
  on allocation.reward_vault_projection_id = vault.reward_vault_projection_id
 and allocation.projection_run_id = vault.projection_run_id
 and allocation.allocation_fact_id = seed_fact.allocation_fact_id
 and allocation.chain_id = run.chain_id
 and allocation.release_id = run.release_id
 and allocation.model_id = run.model_id
 and allocation.epoch_id = run.epoch_id
 and allocation.pointer_generation = run.captured_pointer_generation
 and allocation.promoted_block_number = publication.target_block_number
 and allocation.promoted_block_hash = publication.target_block_hash
join programmable_private.chain_event_current_canonical as allocation_canonical
  on allocation_canonical.logical_event_id = allocation.last_source_logical_event_id
 and allocation_canonical.occurrence_id = allocation.last_source_occurrence_id
 and allocation_canonical.block_hash = allocation.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as allocation_source_occurrence
  on allocation_source_occurrence.occurrence_id = allocation.last_source_occurrence_id
 and allocation_source_occurrence.logical_event_id = allocation.last_source_logical_event_id
 and allocation_source_occurrence.block_hash = allocation.last_source_occurrence_block_hash
 and allocation_source_occurrence.chain_id = run.chain_id
 and allocation_source_occurrence.release_id = run.release_id
 and allocation_source_occurrence.model_id = run.model_id
 and allocation_source_occurrence.epoch_id = run.epoch_id
 and allocation_source_occurrence.pointer_generation
   = run.captured_pointer_generation
where vault.model_id like 'stock%'
  and not exists (
    select 1
    from programmable_private.reward_allocation_required_occurrences as required
    join programmable_private.chain_event_materialized_occurrences_v1 as required_occurrence
      on required_occurrence.occurrence_id = required.occurrence_id
    left join programmable_private.chain_event_current_canonical as required_canonical
      on required_canonical.logical_event_id = required_occurrence.logical_event_id
     and required_canonical.occurrence_id = required_occurrence.occurrence_id
     and required_canonical.block_hash = required_occurrence.block_hash
    where required.allocation_fact_id = seed_fact.allocation_fact_id
      and (
        required_occurrence.chain_id <> run.chain_id
        or required_occurrence.release_id <> run.release_id
        or required_occurrence.model_id <> run.model_id
        or required_occurrence.epoch_id <> run.epoch_id
        or required_occurrence.pointer_generation <> run.captured_pointer_generation
        or required_canonical.occurrence_id is null
      )
  );

create view programmable_private.launch_lookup_v1
with (security_invoker = false, security_barrier = true)
as
select
  launch.chain_id,
  launch.release_id,
  launch.model_id,
  launch.token,
  launch.creator,
  launch.launch_transaction_hash,
  launch.pool_id,
  launch.reward_vault,
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
join programmable_private.projection_publications as publication
  on publication.run_id = launch.projection_run_id
 and publication.epoch_id = launch.epoch_id
 and publication.pointer_generation = launch.pointer_generation
 and publication.target_block_number = launch.promoted_block_number
 and publication.target_block_hash = launch.promoted_block_hash
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = launch.chain_id
 and current_epoch.release_id = launch.release_id
 and current_epoch.model_id = launch.model_id
 and current_epoch.source_group = run.source_group
 and current_epoch.epoch_id = launch.epoch_id
 and current_epoch.generation = launch.pointer_generation
join programmable_private.route_eligibility_current as route
  on route.route_key = 'launch-lookup'
 and route.chain_id = launch.chain_id
 and route.release_id = launch.release_id
 and route.model_id = launch.model_id
 and route.source_group = run.source_group
 and route.epoch_id = launch.epoch_id
 and route.pointer_generation = launch.pointer_generation
 and route.checkpoint_id is not null
 and route.status = 'eligible'
 and route.route_mode = 'indexed'
join programmable_private.chain_event_current_canonical as canonical
  on canonical.logical_event_id = launch.last_source_logical_event_id
 and canonical.occurrence_id = launch.last_source_occurrence_id
 and canonical.block_hash = launch.last_source_occurrence_block_hash
join programmable_private.chain_event_materialized_occurrences_v1 as source_occurrence
  on source_occurrence.occurrence_id = launch.last_source_occurrence_id
 and source_occurrence.logical_event_id = launch.last_source_logical_event_id
 and source_occurrence.block_hash = launch.last_source_occurrence_block_hash
 and source_occurrence.chain_id = run.chain_id
 and source_occurrence.release_id = run.release_id
 and source_occurrence.model_id = run.model_id
 and source_occurrence.epoch_id = run.epoch_id
 and source_occurrence.pointer_generation = run.captured_pointer_generation
where launch.is_complete
  and (
    launch.reward_vault is null
    or programmable_private.has_current_verified_reward_seed(
      run.run_id,
      launch.reward_vault
    )
  );

create view programmable_private.checkpoint_summary_v1
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
  checkpoint.created_at
from programmable_private.projector_checkpoint_current as current_checkpoint
join programmable_private.projector_checkpoints as checkpoint
  on checkpoint.checkpoint_id = current_checkpoint.checkpoint_id
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = checkpoint.chain_id
 and current_epoch.release_id = checkpoint.release_id
 and current_epoch.model_id = checkpoint.model_id
 and current_epoch.source_group = checkpoint.source_group
 and current_epoch.epoch_id = checkpoint.epoch_id
 and current_epoch.generation = checkpoint.pointer_generation;

create view programmable_private.parity_summary_v1
with (security_invoker = false, security_barrier = true)
as
select
  parity.route_key,
  reconciliation.chain_id,
  reconciliation.release_id,
  reconciliation.model_id,
  pg_catalog.count(*) as comparison_count,
  pg_catalog.count(*) filter (where parity.is_match) as matching_count,
  pg_catalog.count(*) filter (where not parity.is_match) as mismatch_count,
  pg_catalog.max(parity.compared_at) as last_compared_at,
  pg_catalog.max(parity.resolved_at) as last_resolved_at
from programmable_private.parity_records as parity
join programmable_private.reconciliation_records as reconciliation
  on reconciliation.reconciliation_id = parity.reconciliation_id
group by
  parity.route_key,
  reconciliation.chain_id,
  reconciliation.release_id,
  reconciliation.model_id;

create view programmable_private.health_summary_v1
with (security_invoker = false, security_barrier = true)
as
select
  health.dependency,
  health.circuit_status,
  health.observed_at,
  history.failure_count,
  history.retry_after
from programmable_private.dependency_health_current as health
join programmable_private.dependency_health_history as history
  on history.health_event_id = health.health_event_id;

create view programmable_private.reconciliation_occurrence_summary_v1
with (security_invoker = false, security_barrier = true)
as
select
  occurrence.chain_id,
  occurrence.release_id,
  occurrence.model_id,
  occurrence.epoch_id,
  occurrence.block_number,
  occurrence.event_type,
  status.status,
  pg_catalog.count(*) as occurrence_count
from programmable_private.chain_event_materialized_occurrences_v1 as occurrence
join programmable_private.chain_event_occurrence_status_history as status
  on status.occurrence_id = occurrence.occurrence_id
group by
  occurrence.chain_id,
  occurrence.release_id,
  occurrence.model_id,
  occurrence.epoch_id,
  occurrence.block_number,
  occurrence.event_type,
  status.status;

create view programmable_private.reconciliation_projection_summary_v1
with (security_invoker = false, security_barrier = true)
as
select
  launch.chain_id,
  launch.release_id,
  launch.model_id,
  launch.epoch_id,
  launch.pointer_generation,
  launch.projection_run_id,
  launch.promoted_block_number,
  launch.promoted_block_hash,
  pg_catalog.count(*) as launch_count
from programmable_private.launch_projections as launch
group by
  launch.chain_id,
  launch.release_id,
  launch.model_id,
  launch.epoch_id,
  launch.pointer_generation,
  launch.projection_run_id,
  launch.promoted_block_number,
  launch.promoted_block_hash;

create function programmable_private.get_recent_launches_v1(
  p_chain_id bigint,
  p_limit integer,
  p_before_block bigint default null,
  p_before_transaction_hash bytea default null,
  p_after_token bytea default null
)
returns table (
  chain_id bigint,
  release_id text,
  model_id text,
  token bytea,
  creator bytea,
  launch_transaction_hash bytea,
  pool_id bytea,
  reward_vault bytea,
  launch_hash bytea,
  token_name text,
  token_symbol text,
  total_supply numeric,
  launch_block_timestamp timestamptz,
  launch_transaction_index bigint,
  launch_receipt_log_ordinal bigint,
  currency0 bytea,
  currency1 bytea,
  hook bytea,
  quote_asset bytea,
  pool_key_fee bigint,
  tick_spacing integer,
  buy_swap_fee_bps integer,
  sell_swap_fee_bps integer,
  buy_creator_fee_bps integer,
  sell_creator_fee_bps integer,
  creator_fee_bps integer,
  launcher_fee_bps integer,
  transfer_tax_bps integer,
  lp_fee_pips bigint,
  total_swap_fee_bps integer,
  project_name text,
  project_description text,
  project_logo_reference text,
  project_metadata_revision bigint,
  project_metadata_created_at timestamptz,
  project_links jsonb,
  promoted_block_number bigint,
  promoted_block_hash bytea,
  verified_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id <= 0
     or p_limit < 1
     or p_limit > 100
     or (p_before_block is not null and p_before_block < 0)
     or (
       (p_before_block is null)::integer
       + (p_before_transaction_hash is null)::integer
       + (p_after_token is null)::integer
     ) not in (0, 3)
     or (
       p_before_transaction_hash is not null
       and pg_catalog.octet_length(p_before_transaction_hash) <> 32
     )
     or (
       p_after_token is not null
       and pg_catalog.octet_length(p_after_token) <> 20
     )
  then
    raise exception using errcode = '22023', message = 'invalid recent-launch query';
  end if;
  return query
  select
    launch.chain_id::bigint,
    launch.release_id::text,
    launch.model_id::text,
    launch.token::bytea,
    launch.creator::bytea,
    launch.launch_transaction_hash::bytea,
    launch.pool_id::bytea,
    launch.reward_vault::bytea,
    launch.launch_hash::bytea,
    launch.token_name,
    launch.token_symbol,
    launch.total_supply::numeric,
    launch.launch_block_timestamp,
    launch.launch_transaction_index::bigint,
    launch.launch_receipt_log_ordinal::bigint,
    launch.currency0::bytea,
    launch.currency1::bytea,
    launch.hook::bytea,
    launch.quote_asset::bytea,
    launch.pool_key_fee::bigint,
    launch.tick_spacing,
    launch.buy_swap_fee_bps::integer,
    launch.sell_swap_fee_bps::integer,
    launch.buy_creator_fee_bps::integer,
    launch.sell_creator_fee_bps::integer,
    launch.creator_fee_bps::integer,
    launch.launcher_fee_bps::integer,
    launch.transfer_tax_bps::integer,
    launch.lp_fee_pips,
    launch.total_swap_fee_bps::integer,
    launch.project_name,
    launch.project_description,
    launch.project_logo_reference,
    launch.project_metadata_revision,
    launch.project_metadata_created_at,
    launch.project_links,
    launch.promoted_block_number::bigint,
    launch.promoted_block_hash::bytea,
    launch.verified_at
  from programmable_private.recent_launches_v1 as launch
  where launch.chain_id = p_chain_id
    and (
      p_before_block is null
      or launch.promoted_block_number < p_before_block
      or (
        launch.promoted_block_number = p_before_block
        and launch.launch_transaction_hash < p_before_transaction_hash
      )
      or (
        launch.promoted_block_number = p_before_block
        and launch.launch_transaction_hash = p_before_transaction_hash
        and launch.token > p_after_token
      )
    )
  order by
    launch.promoted_block_number desc,
    launch.launch_transaction_hash desc,
    launch.token
  limit p_limit;
end
$function$;

create function programmable_private.get_launch_by_token_v1(
  p_chain_id bigint,
  p_token bytea
)
returns table (
  chain_id bigint,
  release_id text,
  model_id text,
  token bytea,
  creator bytea,
  launch_transaction_hash bytea,
  pool_id bytea,
  reward_vault bytea,
  launch_hash bytea,
  token_name text,
  token_symbol text,
  total_supply numeric,
  launch_block_timestamp timestamptz,
  launch_transaction_index bigint,
  launch_receipt_log_ordinal bigint,
  currency0 bytea,
  currency1 bytea,
  hook bytea,
  quote_asset bytea,
  pool_key_fee bigint,
  tick_spacing integer,
  buy_swap_fee_bps integer,
  sell_swap_fee_bps integer,
  buy_creator_fee_bps integer,
  sell_creator_fee_bps integer,
  creator_fee_bps integer,
  launcher_fee_bps integer,
  transfer_tax_bps integer,
  lp_fee_pips bigint,
  total_swap_fee_bps integer,
  project_name text,
  project_description text,
  project_logo_reference text,
  project_metadata_revision bigint,
  project_metadata_created_at timestamptz,
  project_links jsonb,
  promoted_block_number bigint,
  promoted_block_hash bytea,
  verified_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id <= 0 or pg_catalog.octet_length(p_token) <> 20 then
    raise exception using errcode = '22023', message = 'invalid token lookup';
  end if;
  return query
  select
    launch.chain_id::bigint,
    launch.release_id::text,
    launch.model_id::text,
    launch.token::bytea,
    launch.creator::bytea,
    launch.launch_transaction_hash::bytea,
    launch.pool_id::bytea,
    launch.reward_vault::bytea,
    launch.launch_hash::bytea,
    launch.token_name,
    launch.token_symbol,
    launch.total_supply::numeric,
    launch.launch_block_timestamp,
    launch.launch_transaction_index::bigint,
    launch.launch_receipt_log_ordinal::bigint,
    launch.currency0::bytea,
    launch.currency1::bytea,
    launch.hook::bytea,
    launch.quote_asset::bytea,
    launch.pool_key_fee::bigint,
    launch.tick_spacing,
    launch.buy_swap_fee_bps::integer,
    launch.sell_swap_fee_bps::integer,
    launch.buy_creator_fee_bps::integer,
    launch.sell_creator_fee_bps::integer,
    launch.creator_fee_bps::integer,
    launch.launcher_fee_bps::integer,
    launch.transfer_tax_bps::integer,
    launch.lp_fee_pips,
    launch.total_swap_fee_bps::integer,
    launch.project_name,
    launch.project_description,
    launch.project_logo_reference,
    launch.project_metadata_revision,
    launch.project_metadata_created_at,
    launch.project_links,
    launch.promoted_block_number::bigint,
    launch.promoted_block_hash::bytea,
    launch.verified_at
  from programmable_private.launch_by_token_v1 as launch
  where launch.chain_id = p_chain_id and launch.token = p_token
  order by launch.promoted_block_number desc
  limit 1;
end
$function$;

create function programmable_private.get_account_reward_summary_v1(
  p_chain_id bigint,
  p_account bytea
)
returns table (
  chain_id bigint,
  account bytea,
  release_id text,
  model_id text,
  vault bytea,
  pool_id bytea,
  hook bytea,
  quote_asset bytea,
  entitled numeric,
  claimable_accrued numeric,
  claimed_total numeric,
  promoted_block_number bigint,
  promoted_block_hash bytea,
  verified_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_api_reader');
  if p_chain_id <= 0 or pg_catalog.octet_length(p_account) <> 20 then
    raise exception using errcode = '22023', message = 'invalid account reward query';
  end if;
  return query
  select
    reward.chain_id::bigint,
    reward.account::bytea,
    reward.release_id::text,
    reward.model_id::text,
    reward.vault::bytea,
    reward.pool_id::bytea,
    reward.hook::bytea,
    reward.quote_asset::bytea,
    reward.entitled::numeric,
    reward.claimable_accrued::numeric,
    reward.claimed_total::numeric,
    reward.promoted_block_number::bigint,
    reward.promoted_block_hash::bytea,
    reward.verified_at
  from programmable_private.account_reward_summaries_v1 as reward
  where reward.chain_id = p_chain_id and reward.account = p_account
  order by reward.release_id, reward.model_id, reward.vault;
end
$function$;

-- Re-close the complete schema before applying exact final grants. This also
-- prevents an earlier migration's temporary grants from widening the surface.
revoke all on schema programmable_private
  from public, anon, authenticated, service_role,
       programmable_projector, programmable_reconciler,
       programmable_api_reader, programmable_profile_binder,
       programmable_profile_recovery, programmable_profile_writer,
       programmable_maintenance;
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
do $revoke_private_type_usage$
declare
  private_type record;
begin
  for private_type in
    select type_row.typname
    from pg_catalog.pg_type as type_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = type_row.typnamespace
    where namespace_row.nspname = 'programmable_private'
      and type_row.typtype in ('d', 'e')
  loop
    execute pg_catalog.format(
      'revoke all on type programmable_private.%I from public, anon, authenticated, service_role, programmable_projector, programmable_reconciler, programmable_api_reader, programmable_profile_binder, programmable_profile_recovery, programmable_profile_writer, programmable_maintenance',
      private_type.typname
    );
  end loop;
end
$revoke_private_type_usage$;

grant usage on schema programmable_private
  to programmable_projector, programmable_reconciler,
     programmable_api_reader, programmable_profile_binder,
     programmable_profile_recovery, programmable_profile_writer,
     programmable_maintenance;

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
) to programmable_projector, programmable_reconciler,
     programmable_profile_recovery, programmable_maintenance;
grant execute on function programmable_private.append_run_outcome(
  uuid, uuid, text, bytea, timestamptz
) to programmable_projector, programmable_reconciler,
     programmable_profile_recovery, programmable_maintenance;
grant execute on function programmable_private.append_run_telemetry(
  uuid, uuid, text, timestamptz, bigint, bigint, jsonb, boolean
) to programmable_projector, programmable_reconciler,
     programmable_profile_recovery, programmable_maintenance;
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

grant execute on function programmable_private.append_dependency_health(
  uuid, uuid, text, text, integer, timestamptz, timestamptz, bytea
) to programmable_reconciler;
grant execute on function programmable_private.append_reconciliation_record(
  uuid, uuid, text, text, numeric, numeric, bigint, bigint, bytea,
  bytea[], timestamptz, timestamptz
) to programmable_reconciler;
grant execute on function programmable_private.append_parity_record(
  uuid, uuid, text, bytea, bytea, timestamptz, timestamptz
) to programmable_reconciler;
grant execute on function programmable_private.append_market_snapshot(
  uuid, uuid, uuid, uuid, bytea, numeric, bytea, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, bytea
) to programmable_reconciler;
grant execute on function programmable_private.append_market_candle(
  uuid, uuid, uuid, uuid, bytea, text, timestamptz, timestamptz, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, bytea, bytea
) to programmable_reconciler;
grant execute on function programmable_private.append_portfolio_point(
  uuid, uuid, bytea, integer, timestamptz, numeric, bytea
) to programmable_reconciler;
grant select on programmable_private.reconciliation_occurrence_summary_v1,
  programmable_private.reconciliation_projection_summary_v1,
  programmable_private.checkpoint_summary_v1
  to programmable_reconciler;

grant execute on function programmable_private.define_profile_hash_version(
  smallint, text, bytea, bytea, timestamptz
) to programmable_profile_recovery;
grant execute on function programmable_private.set_profile_hash_version_state(
  uuid, smallint, text, bytea, timestamptz
) to programmable_profile_recovery;
grant execute on function programmable_private.bind_profile_subject(
  bytea, smallint, bytea, text, bytea, timestamptz
) to programmable_profile_binder;
grant execute on function programmable_private.rekey_profile_subject(
  bytea, smallint, bytea, smallint, bytea, bigint, bytea, timestamptz
) to programmable_profile_recovery;
grant execute on function programmable_private.tombstone_profile_binding(
  bytea, smallint, bytea, bigint, bytea, timestamptz
) to programmable_profile_recovery;
grant execute on function programmable_private.recover_profile_binding(
  bytea, smallint, bytea, bigint, bytea, timestamptz
) to programmable_profile_recovery;
grant execute on function programmable_private.mutate_profile(
  bytea, smallint, bytea, bigint, bigint, text, text, text, text,
  bytea, timestamptz
) to programmable_profile_writer;
grant execute on function programmable_private.append_token_project_metadata_revision(
  uuid, bytea, smallint, bytea, bigint, bigint, bytea, bigint,
  text, text, text, bytea, timestamptz
) to programmable_profile_writer;
grant execute on function programmable_private.append_project_metadata_link(
  uuid, uuid, bytea, smallint, bytea, bigint, bigint,
  text, text, integer, bytea, timestamptz
) to programmable_profile_writer;

grant execute on function programmable_private.prune_run_telemetry(
  timestamptz, integer, bytea
) to programmable_maintenance;
grant execute on function programmable_private.prune_market_data(
  timestamptz, integer, bytea
) to programmable_maintenance;
grant execute on function programmable_private.prune_parity_records(
  timestamptz, integer, bytea
) to programmable_maintenance;

grant select on programmable_private.recent_launches_v1,
  programmable_private.launch_by_token_v1,
  programmable_private.launches_by_creator_v1,
  programmable_private.market_snapshots_v1,
  programmable_private.market_candles_v1,
  programmable_private.account_reward_summaries_v1,
  programmable_private.creator_reward_summaries_v1,
  programmable_private.classic_v3_vault_history_v1,
  programmable_private.stock_paired_vault_history_v1,
  programmable_private.launch_lookup_v1,
  programmable_private.checkpoint_summary_v1,
  programmable_private.parity_summary_v1,
  programmable_private.health_summary_v1
  to programmable_api_reader;
grant execute on function programmable_private.get_recent_launches_v1(
  bigint, integer, bigint, bytea, bytea
) to programmable_api_reader;
grant execute on function programmable_private.get_launch_by_token_v1(
  bigint, bytea
) to programmable_api_reader;
grant execute on function programmable_private.get_account_reward_summary_v1(
  bigint, bytea
) to programmable_api_reader;

alter default privileges for role programmable_migrator in schema programmable_private
  revoke all on tables from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler, programmable_api_reader,
    programmable_profile_binder, programmable_profile_recovery,
    programmable_profile_writer, programmable_maintenance;
alter default privileges for role programmable_migrator in schema programmable_private
  revoke all on sequences from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler, programmable_api_reader,
    programmable_profile_binder, programmable_profile_recovery,
    programmable_profile_writer, programmable_maintenance;
alter default privileges for role programmable_migrator in schema programmable_private
  revoke execute on functions from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler, programmable_api_reader,
    programmable_profile_binder, programmable_profile_recovery,
    programmable_profile_writer, programmable_maintenance;
alter default privileges for role programmable_migrator in schema programmable_private
  revoke usage on types from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler, programmable_api_reader,
    programmable_profile_binder, programmable_profile_recovery,
    programmable_profile_writer, programmable_maintenance;

reset role;
