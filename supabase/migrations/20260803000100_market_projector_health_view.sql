-- Narrow API-reader health surface for the event-driven market projector.
-- A row exists for every current launch only when its cursor is on the current
-- release lineage, no canonical market event remains unprojected, and at least
-- one successfully reconciled snapshot belongs to the active market lineage.

set role programmable_migrator;

create index market_snapshot_lineage_health_latest_idx
  on programmable_private.market_snapshot_lineage_memberships (
    chain_id, release_id, model_id, source_group, projector_version,
    pool_id, reorg_generation, attached_at desc, market_snapshot_id
  );

create view programmable_private.market_projector_health_v1
with (security_invoker = false, security_barrier = true)
as
select
  current_cursor.chain_id,
  current_cursor.release_id,
  current_cursor.model_id,
  current_cursor.source_group,
  current_cursor.projector_version as market_projector_version,
  current_cursor.pool_id,
  cursor_history.market_cursor_id,
  cursor_history.epoch_id as cursor_epoch_id,
  cursor_history.pointer_generation as cursor_pointer_generation,
  cursor_history.cursor_generation,
  cursor_history.reorg_generation as cursor_reorg_generation,
  cursor_history.source_checkpoint_id as cursor_source_checkpoint_id,
  cursor_history.source_checkpoint_generation
    as cursor_source_checkpoint_generation,
  cursor_history.source_reorg_generation
    as cursor_source_reorg_generation,
  cursor_history.block_number::bigint as cursor_block_number,
  cursor_history.block_hash::bytea as cursor_block_hash,
  cursor_history.advanced_at as cursor_advanced_at,
  cursor_history.hour_coverage_end,
  cursor_history.day_coverage_end,
  source_checkpoint.projector_version as source_projector_version,
  source_checkpoint.checkpoint_id as source_checkpoint_id,
  source_checkpoint.epoch_id as source_checkpoint_epoch_id,
  source_checkpoint.pointer_generation
    as source_checkpoint_pointer_generation,
  source_checkpoint.checkpoint_generation
    as source_checkpoint_generation,
  source_checkpoint.reorg_generation
    as source_checkpoint_reorg_generation,
  source_checkpoint.block_number::bigint
    as source_checkpoint_block_number,
  source_checkpoint.block_hash::bytea as source_checkpoint_block_hash,
  source_checkpoint.cursor_block_global_log_index::bigint
    as source_checkpoint_cursor_block_global_log_index,
  source_checkpoint.cursor_candidate_id::text
    as source_checkpoint_cursor_candidate_id,
  source_checkpoint.created_at as source_checkpoint_created_at,
  latest_snapshot.block_number::bigint as latest_snapshot_block_number,
  latest_snapshot.observed_at as latest_snapshot_observed_at,
  latest_snapshot.attached_at as latest_snapshot_attached_at,
  latest_snapshot.reconciled_at as latest_snapshot_reconciled_at
from programmable_private.projector_checkpoint_current
  as current_source_checkpoint
join programmable_private.projector_checkpoints as source_checkpoint
  on source_checkpoint.checkpoint_id =
    current_source_checkpoint.checkpoint_id
 and source_checkpoint.chain_id = current_source_checkpoint.chain_id
 and source_checkpoint.release_id = current_source_checkpoint.release_id
 and source_checkpoint.model_id = current_source_checkpoint.model_id
 and source_checkpoint.source_group = current_source_checkpoint.source_group
 and source_checkpoint.projector_version =
    current_source_checkpoint.projector_version
 and source_checkpoint.checkpoint_generation =
    current_source_checkpoint.checkpoint_generation
 and source_checkpoint.reorg_generation =
    current_source_checkpoint.reorg_generation
join programmable_private.release_epoch_current as current_epoch
  on current_epoch.chain_id = source_checkpoint.chain_id
 and current_epoch.release_id = source_checkpoint.release_id
 and current_epoch.model_id = source_checkpoint.model_id
 and current_epoch.source_group = source_checkpoint.source_group
 and current_epoch.epoch_id = source_checkpoint.epoch_id
 and current_epoch.generation = source_checkpoint.pointer_generation
join programmable_private.market_projector_cursor_current as current_cursor
  on current_cursor.chain_id = source_checkpoint.chain_id
 and current_cursor.release_id = source_checkpoint.release_id
 and current_cursor.model_id = source_checkpoint.model_id
 and current_cursor.source_group = source_checkpoint.source_group
join programmable_private.market_projector_cursor_history as cursor_history
  on cursor_history.market_cursor_id = current_cursor.market_cursor_id
 and cursor_history.chain_id = current_cursor.chain_id
 and cursor_history.release_id = current_cursor.release_id
 and cursor_history.model_id = current_cursor.model_id
 and cursor_history.source_group = current_cursor.source_group
 and cursor_history.projector_version = current_cursor.projector_version
 and cursor_history.pool_id = current_cursor.pool_id
 and cursor_history.cursor_generation = current_cursor.cursor_generation
 and cursor_history.reorg_generation = current_cursor.reorg_generation
join programmable_private.projector_checkpoints as bound_source_checkpoint
  on bound_source_checkpoint.checkpoint_id =
    cursor_history.source_checkpoint_id
 and bound_source_checkpoint.chain_id = cursor_history.chain_id
 and bound_source_checkpoint.release_id = cursor_history.release_id
 and bound_source_checkpoint.model_id = cursor_history.model_id
 and bound_source_checkpoint.source_group = cursor_history.source_group
 and bound_source_checkpoint.projector_version =
    source_checkpoint.projector_version
 and bound_source_checkpoint.epoch_id = cursor_history.epoch_id
 and bound_source_checkpoint.pointer_generation =
    cursor_history.pointer_generation
 and bound_source_checkpoint.checkpoint_generation =
    cursor_history.source_checkpoint_generation
 and bound_source_checkpoint.reorg_generation =
    cursor_history.source_reorg_generation
join lateral (
  select
    snapshot.block_number,
    snapshot.observed_at,
    membership.attached_at,
    fact_outcome.finished_at as reconciled_at
  from programmable_private.market_snapshot_lineage_memberships as membership
  join programmable_private.market_snapshots as snapshot
    on snapshot.market_snapshot_id = membership.market_snapshot_id
   and snapshot.chain_id = membership.chain_id
   and snapshot.pool_id = membership.pool_id
  join programmable_private.reconciliation_records as fact_reconciliation
    on fact_reconciliation.reconciliation_id = snapshot.reconciliation_id
   and fact_reconciliation.chain_id = snapshot.chain_id
   and fact_reconciliation.mismatch_count = 0
  join programmable_private.run_headers as fact_run
    on fact_run.run_id = fact_reconciliation.run_id
   and fact_run.run_kind = 'reconciliation'
   and fact_run.chain_id = membership.chain_id
   and fact_run.release_id = membership.release_id
   and fact_run.model_id = membership.model_id
   and fact_run.source_group = membership.source_group
   and fact_run.epoch_id = cursor_history.epoch_id
   and fact_run.captured_pointer_generation =
      cursor_history.pointer_generation
  join programmable_private.run_lifecycle_outcomes as fact_outcome
    on fact_outcome.run_id = fact_run.run_id
   and fact_outcome.status = 'succeeded'
  join programmable_private.reconciliation_records as attached_reconciliation
    on attached_reconciliation.reconciliation_id =
      membership.attached_reconciliation_id
   and attached_reconciliation.chain_id = membership.chain_id
   and attached_reconciliation.mismatch_count = 0
  join programmable_private.run_headers as attached_run
    on attached_run.run_id = attached_reconciliation.run_id
   and attached_run.run_kind = 'reconciliation'
   and attached_run.chain_id = membership.chain_id
   and attached_run.release_id = membership.release_id
   and attached_run.model_id = membership.model_id
   and attached_run.source_group = membership.source_group
   and attached_run.epoch_id = cursor_history.epoch_id
   and attached_run.captured_pointer_generation =
      cursor_history.pointer_generation
  join programmable_private.run_lifecycle_outcomes as attached_outcome
    on attached_outcome.run_id = attached_run.run_id
   and attached_outcome.status = 'succeeded'
  where membership.chain_id = current_cursor.chain_id
    and membership.release_id = current_cursor.release_id
    and membership.model_id = current_cursor.model_id
    and membership.source_group = current_cursor.source_group
    and membership.projector_version = current_cursor.projector_version
    and membership.pool_id = current_cursor.pool_id
    and membership.reorg_generation = current_cursor.reorg_generation
    and snapshot.block_number <= cursor_history.block_number
  order by membership.attached_at desc, membership.market_snapshot_id desc
  limit 1
) as latest_snapshot on true
where source_checkpoint.cursor_block_global_log_index = 4294967295
  and source_checkpoint.cursor_candidate_id = 'empty-page'
  and cursor_history.epoch_id = source_checkpoint.epoch_id
  and cursor_history.pointer_generation = source_checkpoint.pointer_generation
  and cursor_history.source_reorg_generation >=
    source_checkpoint.reorg_generation
  and cursor_history.block_number <= source_checkpoint.block_number
  and not exists (
    select 1
    from (
      select distinct on (
        occurrence.block_number, occurrence.block_hash
      )
        occurrence.occurrence_id,
        occurrence.block_number,
        occurrence.block_hash
      from programmable_private.chain_event_occurrences as occurrence
      join programmable_private.chain_event_occurrence_materializations
        as materialization
        on materialization.occurrence_id = occurrence.occurrence_id
       and materialization.chain_id = source_checkpoint.chain_id
       and materialization.release_id = source_checkpoint.release_id
       and materialization.model_id = source_checkpoint.model_id
       and materialization.source_group = source_checkpoint.source_group
       and materialization.epoch_id = source_checkpoint.epoch_id
       and materialization.pointer_generation =
          source_checkpoint.pointer_generation
       and case source_checkpoint.model_id
         when 'classic'
           then materialization.event_type = 'NativeSwapFeesAccrued'
         when 'stock-paired'
           then materialization.event_type = 'QuoteSwapFeesAccrued'
         else false
       end
      join programmable_private.chain_event_current_canonical as canonical
        on canonical.occurrence_id = occurrence.occurrence_id
       and canonical.logical_event_id = occurrence.logical_event_id
       and canonical.block_hash = occurrence.block_hash
      where occurrence.chain_id = source_checkpoint.chain_id
        and occurrence.block_number <= source_checkpoint.block_number
        and pg_catalog.lower(materialization.decoded_payload ->> 'poolId') =
          '0x' || pg_catalog.encode(current_cursor.pool_id, 'hex')
      order by occurrence.block_number, occurrence.block_hash,
        occurrence.transaction_index desc,
        occurrence.block_global_log_index desc,
        occurrence.occurrence_id desc
    ) as required_close
    where required_close.block_number > cursor_history.block_number
      or (
        required_close.block_number = cursor_history.block_number
        and not exists (
          select 1
          from programmable_private.market_block_closes as projected_close
          join programmable_private.reconciliation_records
            as close_reconciliation
            on close_reconciliation.reconciliation_id =
              projected_close.reconciliation_id
           and close_reconciliation.mismatch_count = 0
          join programmable_private.run_headers as close_run
            on close_run.run_id = close_reconciliation.run_id
           and close_run.run_kind = 'reconciliation'
          join programmable_private.run_lifecycle_outcomes as close_outcome
            on close_outcome.run_id = close_run.run_id
           and close_outcome.status = 'succeeded'
          where projected_close.chain_id = source_checkpoint.chain_id
            and projected_close.release_id = source_checkpoint.release_id
            and projected_close.model_id = source_checkpoint.model_id
            and projected_close.source_group = source_checkpoint.source_group
            and projected_close.epoch_id = source_checkpoint.epoch_id
            and projected_close.pointer_generation =
              source_checkpoint.pointer_generation
            and projected_close.pool_id = current_cursor.pool_id
            and projected_close.last_source_occurrence_id =
              required_close.occurrence_id
            and projected_close.block_number = required_close.block_number
            and projected_close.block_hash = required_close.block_hash
        )
      )
  );

comment on view programmable_private.market_projector_health_v1 is
  'Fail-closed event-driven market cursor, terminal source checkpoint, and reconciled latest-snapshot health for exact API launch-corpus evaluation.';

revoke all on programmable_private.market_projector_health_v1
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler,
  programmable_api_reader, programmable_profile_binder,
  programmable_profile_recovery, programmable_profile_writer,
  programmable_maintenance, programmable_operator,
  programmable_projector_runtime, programmable_release_probe_nonce,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login, programmable_projector_runtime_login,
  programmable_release_probe_nonce_login;

grant select on programmable_private.market_projector_health_v1
to programmable_api_reader;

reset role;
