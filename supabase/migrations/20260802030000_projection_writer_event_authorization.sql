-- Bind internal projection writers to the semantic event rule that authorizes
-- their source occurrence. Writer table names and event semantic names are
-- deliberately separate domains.
create or replace function programmable_private.assert_projection_event_allowed(
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
  if not found or occurrence.chain_id <> header.chain_id then
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

  if resolved_source_role is null then
    raise exception using errcode = '23514', message = 'event/source role is outside the release writer allowlist';
  end if;

  if p_projection_kind = 'launch_requirement' then
    if not exists (
      select 1
      from programmable_private.release_launch_completeness_requirements as requirement
      where requirement.epoch_id = header.epoch_id
        and requirement.occurrence_role = resolved_source_role
        and requirement.event_type = materialization.event_type
    ) then
      raise exception using errcode = '23514', message = 'event/source role is outside the release writer allowlist';
    end if;
    return;
  end if;

  if not exists (
    select 1
    from programmable_private.release_projection_event_rules as rule
    where rule.epoch_id = header.epoch_id
      and rule.source_role = resolved_source_role
      and rule.event_type = materialization.event_type
      and (
        rule.projection_kind = p_projection_kind
        or (p_projection_kind = 'pool' and rule.projection_kind = 'pool-registration')
        or (p_projection_kind = 'pool_fee_configuration' and rule.projection_kind = 'fee-disclosure')
        or (p_projection_kind = 'fee_accrual' and rule.projection_kind = 'fee-accrual')
        or (p_projection_kind = 'pool_fee_total' and rule.projection_kind = 'fee-accrual')
        or (p_projection_kind = 'reward_vault' and rule.projection_kind = 'reward-vault-deployment')
        or (p_projection_kind = 'reward_allocation' and rule.projection_kind = 'reward-vault-deployment')
        or (p_projection_kind = 'claim' and rule.projection_kind = 'beneficiary-claim')
        or (p_projection_kind = 'payout_change' and rule.projection_kind = 'payout-change')
        or (
          p_projection_kind = 'account_reward_balance'
          and rule.projection_kind in (
            'reward-vault-deployment', 'creator-fee-checkpoint',
            'beneficiary-claim', 'payout-change',
            'reward-configuration-activation'
          )
        )
        or (p_projection_kind = 'initial_buy_custody' and rule.projection_kind = 'initial-buy-custody')
        or (p_projection_kind = 'initial_buy_vesting' and rule.projection_kind = 'vesting-wallet-deployment')
      )
  ) then
    raise exception using errcode = '23514', message = 'event/source role is outside the release writer allowlist';
  end if;
end
$function$;

comment on function programmable_private.assert_projection_event_allowed(
  uuid, uuid, text
) is
  'Authorizes a projection writer against the exact semantic event rule or launch completeness requirement for its source occurrence.';

revoke all on function programmable_private.assert_projection_event_allowed(
  uuid, uuid, text
) from public, anon, authenticated, service_role,
  programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_operator;

grant execute on function programmable_private.assert_projection_event_allowed(
  uuid, uuid, text
) to programmable_projector;
