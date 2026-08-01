begin;
select plan(162);

-- Preserve behavioral coverage for the retired v1/v2 promotion bodies while
-- production keeps both capabilities revoked. pgTAP rolls these grants back.
set local role programmable_migrator;
grant execute on function programmable_private.promote_projection_run(
  uuid, uuid, uuid, uuid, text, bigint, bytea,
  bigint, bigint, bigint, uuid, uuid, numeric, bytea, numeric,
  text, uuid[], uuid[], uuid[], uuid[], text[], bytea, timestamptz
) to programmable_projector;
grant execute on function programmable_private.promote_projection_run_v2(
  text, uuid, uuid, uuid, uuid, text, bigint, bytea,
  bigint, bigint, bigint, uuid, uuid, numeric, bytea, numeric,
  text, uuid[], uuid[], uuid[], uuid[], text[], bytea, timestamptz
) to programmable_projector;
reset role;

-- Test-only definer readers let the restricted projector replay a previously
-- stored opaque pair without granting it base-table SELECT. The transaction
-- rollback removes these helpers.
create function public.reward_test_allocation_preimage()
returns bytea
language sql
stable
security definer
set search_path = ''
as $function$
  select fact.canonical_preimage
  from programmable_private.reward_allocation_facts as fact
  where fact.allocation_fact_id = '98000000-0000-0000-0000-000000000001'
$function$;

create function public.reward_test_evidence_preimage()
returns bytea
language sql
stable
security definer
set search_path = ''
as $function$
  select evidence.canonical_preimage
  from programmable_private.reward_allocation_evidence as evidence
  where evidence.allocation_evidence_id =
    '98100000-0000-0000-0000-000000000001'
$function$;

create function public.reward_test_evidence_recovery_binding()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select evidence.recovery_release_binding_id
  from programmable_private.reward_allocation_evidence as evidence
  where evidence.allocation_evidence_id =
    '98100000-0000-0000-0000-000000000004'
$function$;

create function public.reward_test_dynamic_occurrence_provenance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select occurrence.release_binding_id is null
     and occurrence.dynamic_source_attestation_id =
       '91210000-0000-0000-0000-000000000001'::uuid
     and occurrence.first_seen_envio_candidate_id is null
     and occurrence.first_seen_neutral_candidate_id =
       programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14)
     and occurrence.candidate_resolution_id =
       '91220000-0000-0000-0000-000000000001'::uuid
  from programmable_private.chain_event_occurrences as occurrence
  where occurrence.occurrence_id =
    '91240000-0000-0000-0000-000000000001'::uuid
$function$;

create function public.reward_test_orphaned_dynamic_resolution()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  delete from programmable_private.chain_event_current_canonical
  where occurrence_id = '96100000-0000-0000-0000-000000000001'::uuid;
  perform programmable_private.resolve_envio_candidate(
    '91220000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001',
    programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14), null,
    '91210000-0000-0000-0000-000000000001',
    decode(repeat('d2', 32), 'hex'), decode(repeat('d8', 32), 'hex'),
    '2026-07-31T03:03:14Z'
  );
end
$function$;

create function public.reward_test_shared_resolution_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.count(*)
  from programmable_private.envio_candidate_resolutions
  where candidate_id = programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('86', 32), 'hex'), 15)
$function$;

create function public.reward_test_private_call(p_sql text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  execute p_sql;
end
$function$;

create function public.reward_test_quarantine_then_rollback(
  p_sql text,
  p_mismatch_evidence_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  execute p_sql;
  if not exists (
    select 1
    from programmable_private.reward_allocation_mismatch_evidence
    where mismatch_evidence_id = p_mismatch_evidence_id
  ) then
    raise exception using
      errcode = 'P0002',
      message = 'contradictory evidence was not quarantined';
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'rollback expected quarantine fixture';
end
$function$;

create function public.reward_test_stale_reward_balance_reorg(
  p_projection_run_id uuid,
  p_vault bytea
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  update programmable_private.projector_checkpoint_current
  set reorg_generation = reorg_generation + 1
  where chain_id = 1
    and release_id = 'classic-v3'
    and model_id = 'classic-v3'
    and source_group = 'core'
    and projector_version = 'projector-v1';
  if not found then
    raise exception using
      errcode = 'P0002', message = 'checkpoint fixture is absent';
  end if;
  perform balance.account
  from programmable_private.get_projector_reward_balances_by_vault_v1(
    p_projection_run_id, p_vault
  ) as balance;
  raise exception using
    errcode = 'P0001',
    message = 'stale reorg binding unexpectedly returned balances';
end
$function$;

set local role programmable_projector;

select programmable_private.create_release_epoch(
  '91000000-0000-0000-0000-000000000001',
  1, 'classic-v3', 'classic-v3', 'core', 1,
  decode(repeat('91', 32), 'hex'),
  decode(repeat('a4', 32), 'hex'),
  decode(repeat('92', 32), 'hex'),
  '2026-07-31T03:00:00Z'
);
select programmable_private.append_release_source_binding(
  '91100000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  'seed-launcher', 'launcher', 'ethereum_contract',
  decode(repeat('31', 20), 'hex'), decode('bf388406', 'hex'), 25639597,
  decode(repeat('51', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
  decode(repeat('14', 32), 'hex'), decode(repeat('15', 32), 'hex'),
  '2026-07-31T03:00:00.100Z'
);
select programmable_private.append_release_source_binding(
  '91100000-0000-0000-0000-000000000002',
  '91000000-0000-0000-0000-000000000001',
  'seed-vesting-factory', 'vesting_factory', 'ethereum_contract',
  decode(repeat('35', 20), 'hex'), null, 25639598,
  decode(repeat('53', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
  decode(repeat('16', 32), 'hex'), decode(repeat('17', 32), 'hex'),
  '2026-07-31T03:00:00.200Z'
);
select programmable_private.append_release_source_binding(
  '91100000-0000-0000-0000-000000000003',
  '91000000-0000-0000-0000-000000000001',
  'seed-hook', 'hook', 'ethereum_contract',
  decode(repeat('39', 20), 'hex'), null, 25639599,
  decode(repeat('55', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
  decode(repeat('18', 32), 'hex'), decode(repeat('19', 32), 'hex'),
  '2026-07-31T03:00:00.300Z'
);
select programmable_private.append_release_source_binding(
  '91100000-0000-0000-0000-000000000004',
  '91000000-0000-0000-0000-000000000001',
  'seed-vault-factory', 'vault_factory', 'ethereum_contract',
  decode(repeat('3d', 20), 'hex'), null, 25639600,
  decode(repeat('57', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
  decode(repeat('1a', 32), 'hex'), decode(repeat('1b', 32), 'hex'),
  '2026-07-31T03:00:00.400Z'
);
select programmable_private.append_release_source_binding(
  '91100000-0000-0000-0000-000000000005',
  '91000000-0000-0000-0000-000000000001',
  'seed-coordinator', 'coordinator', 'ethereum_contract',
  decode(repeat('3e', 20), 'hex'), decode('deadbeef', 'hex'), 25639597,
  decode(repeat('59', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
  decode(repeat('1c', 32), 'hex'), decode(repeat('1d', 32), 'hex'),
  '2026-07-31T03:00:00.500Z'
);
select programmable_private.append_release_dynamic_source_template(
  '91200000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  '91100000-0000-0000-0000-000000000004',
  'vault_factory', 'ClassicRewardVaultDeployed', 'vault', 'reward_vault',
  decode(repeat('a4', 32), 'hex'), decode(repeat('d1', 32), 'hex'),
  decode(repeat('df', 32), 'hex'),
  '{"factoryConfigurationField":"configurationCommitment","bindings":[{"ordinal":"0","offset":"0","length":"20","source":"deployed_address","encoding":"address"}]}'::jsonb,
  decode(repeat('de', 32), 'hex'), 6543,
  decode(repeat('d2', 32), 'hex'),
  decode(repeat('d3', 32), 'hex'), '2026-07-31T03:00:00.600Z'
);
select programmable_private.append_release_dynamic_source_template(
  '91200000-0000-0000-0000-000000000002',
  '91000000-0000-0000-0000-000000000001',
  '91100000-0000-0000-0000-000000000002',
  'vesting_factory', 'ClassicInitialBuyVestingWalletDeployed',
  'wallet', 'vesting_wallet',
  decode(repeat('a4', 32), 'hex'), decode(repeat('c1', 32), 'hex'),
  decode(repeat('cf', 32), 'hex'),
  '{"factoryConfigurationField":"configurationCommitment","bindings":[{"ordinal":"0","offset":"0","length":"20","source":"deployed_address","encoding":"address"}]}'::jsonb,
  decode(repeat('ce', 32), 'hex'), 1234,
  decode(repeat('c2', 32), 'hex'),
  decode(repeat('c3', 32), 'hex'), '2026-07-31T03:00:00.700Z'
);
select programmable_private.append_release_projection_event_rule(
  rule_id, '91000000-0000-0000-0000-000000000001', projection_kind,
  source_role, event_type, commitment, '2026-07-31T03:00:00.800Z'
)
from (values
  ('91400000-0000-0000-0000-000000000001'::uuid, 'launch', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('01', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000002'::uuid, 'pool', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('02', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000003'::uuid, 'pool_fee_configuration', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('03', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000004'::uuid, 'fee_accrual', 'launcher', 'MemeTokenLaunchedV2', decode(repeat('04', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000005'::uuid, 'pool_fee_total', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('05', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000006'::uuid, 'reward_vault', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('06', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000007'::uuid, 'reward_allocation', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('07', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000008'::uuid, 'claim', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('08', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000009'::uuid, 'payout_change', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('09', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000010'::uuid, 'account_reward_balance', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('0a', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000011'::uuid, 'initial_buy_custody', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('0b', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000012'::uuid, 'initial_buy_vesting', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('0c', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000013'::uuid, 'launch_requirement', 'vault_factory', 'ClassicRewardVaultDeployed', decode(repeat('0d', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000014'::uuid, 'launch_requirement', 'vesting_factory', 'ClassicInitialBuyVestingWalletDeployed', decode(repeat('0e', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000015'::uuid, 'launch_requirement', 'coordinator', 'StockPairedEthTokenLaunched', decode(repeat('0f', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000016'::uuid, 'creator_hook_claim', 'hook', 'CreatorFeesClaimed', decode(repeat('10', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000017'::uuid, 'launcher_hook_claim', 'hook', 'LauncherFeesClaimed', decode(repeat('20', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000018'::uuid, 'creator_fee_checkpoint', 'reward_vault', 'CreatorFeesCheckpointed', decode(repeat('30', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000019'::uuid, 'reward_configuration_activation', 'reward_vault', 'CtoRewardConfigurationActivated', decode(repeat('40', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000020'::uuid, 'reward_vault', 'reward_vault', 'BeneficiaryFeesClaimed', decode(repeat('31', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000021'::uuid, 'claim', 'reward_vault', 'BeneficiaryFeesClaimed', decode(repeat('32', 32), 'hex')),
  ('91400000-0000-0000-0000-000000000022'::uuid, 'reward_vault', 'reward_vault', 'PayoutWalletChanged', decode(repeat('33', 32), 'hex'))
) as rule(rule_id, projection_kind, source_role, event_type, commitment);
select programmable_private.append_release_launch_requirement(
  requirement_id, '91000000-0000-0000-0000-000000000001', ordinal,
  occurrence_role, event_type, required_when, commitment,
  '2026-07-31T03:00:00.900Z'
)
from (values
  ('91500000-0000-0000-0000-000000000001'::uuid, 0, 'vault_factory', 'ClassicRewardVaultDeployed', 'always', decode(repeat('11', 32), 'hex')),
  ('91500000-0000-0000-0000-000000000002'::uuid, 1, 'vault_factory', 'ClassicRewardVaultDeployed', 'reward_vault', decode(repeat('12', 32), 'hex')),
  ('91500000-0000-0000-0000-000000000003'::uuid, 2, 'vesting_factory', 'ClassicInitialBuyVestingWalletDeployed', 'locked_custody', decode(repeat('13', 32), 'hex')),
  ('91500000-0000-0000-0000-000000000004'::uuid, 3, 'coordinator', 'StockPairedEthTokenLaunched', 'eth_funded', decode(repeat('14', 32), 'hex'))
) as requirement(
  requirement_id, ordinal, occurrence_role, event_type, required_when, commitment
);
select programmable_private.activate_release_epoch(
  1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001',
  0, 1, decode(repeat('93', 32), 'hex'),
  '2026-07-31T03:00:01Z'
);
select programmable_private.register_rpc_provider_deployment(
  '92000000-0000-0000-0000-000000000001',
  1, 'alchemy', 'rpc-provider-v1',
  decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('a3', 32), 'hex'),
  decode(repeat('21', 32), 'hex'), decode(repeat('22', 32), 'hex'),
  decode(repeat('23', 32), 'hex'), '2026-07-31T03:00:02Z'
);
select programmable_private.register_rpc_provider_deployment(
  '92000000-0000-0000-0000-000000000002',
  1, 'quicknode', 'rpc-provider-v1',
  decode(repeat('b1', 32), 'hex'), decode(repeat('b2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('b3', 32), 'hex'),
  decode(repeat('24', 32), 'hex'), decode(repeat('25', 32), 'hex'),
  decode(repeat('26', 32), 'hex'), '2026-07-31T03:00:03Z'
);
select programmable_private.register_provider_deployment(
  '92000000-0000-0000-0000-000000000003',
  'envio_deployment', 'seed-envio',
  decode(repeat('27', 32), 'hex'), decode(repeat('28', 32), 'hex'),
  decode(repeat('29', 32), 'hex'), '2026-07-31T03:00:04Z'
);
select programmable_private.open_run(
  '910c0000-0000-0000-0000-000000000001',
  'ingestion', 1, 'envio-control', 'envio-control', 'canonical-events',
  '70000000-0000-0000-0000-000000000002', 1,
  'envio-adapter-v1', decode(repeat('30', 32), 'hex'),
  '2026-07-31T03:00:05Z'
);
select programmable_private.open_run(
  '93000000-0000-0000-0000-000000000001',
  'ingestion', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('31', 32), 'hex'),
  '2026-07-31T03:01:00Z'
);
select programmable_private.append_safe_head_observation(
  '94000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  1, 1, 25639620, 25639620, 12, 25639608,
  decode(repeat('cc', 32), 'hex'), decode(repeat('cc', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000140', 'hex'),
  decode(repeat('41', 32), 'hex'), '2026-07-31T03:01:01Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  '95000000-0000-0000-0000-000000000597',
  '94000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  25639597, decode(repeat('a6', 32), 'hex'), decode(repeat('a6', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000241', 'hex'),
  decode(repeat('42', 32), 'hex'), '2026-07-31T03:01:02Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  '95000000-0000-0000-0000-000000000598',
  '94000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  25639598, decode(repeat('a8', 32), 'hex'), decode(repeat('a8', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000242', 'hex'),
  decode(repeat('43', 32), 'hex'), '2026-07-31T03:01:03Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  '95000000-0000-0000-0000-000000000599',
  '94000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  25639599, decode(repeat('aa', 32), 'hex'), decode(repeat('aa', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000243', 'hex'),
  decode(repeat('44', 32), 'hex'), '2026-07-31T03:01:04Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  '95000000-0000-0000-0000-000000000600',
  '94000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'), decode(repeat('99', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000244', 'hex'),
  decode(repeat('45', 32), 'hex'), '2026-07-31T03:01:05Z'
);

select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('a6', 32), 'hex'), decode(repeat('a5', 32), 'hex'), 10),
  '93000000-0000-0000-0000-000000000001',
  25639597,
  decode(repeat('a6', 32), 'hex'),
  decode(repeat('a5', 32), 'hex'),
  1,
  10,
  decode(repeat('31', 20), 'hex'),
  decode(repeat('32', 32), 'hex'),
  'MemeTokenLaunchedV2',
  array[decode(repeat('32', 32), 'hex')],
  decode('', 'hex'),
  '{"token":"0x7171717171717171717171717171717171717171","poolId":"0x7373737373737373737373737373737373737373737373737373737373737373","hook":"0x3939393939393939393939393939393939393939","quoteAsset":"0x0000000000000000000000000000000000000000"}'::jsonb,
  decode(repeat('33', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('a6', 32), 'hex'), decode(repeat('a5', 32), 'hex'), 10),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('34', 32), 'hex'),
  '2026-07-31T03:01:06Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('a8', 32), 'hex'), decode(repeat('a7', 32), 'hex'), 11),
  '93000000-0000-0000-0000-000000000001',
  25639598,
  decode(repeat('a8', 32), 'hex'),
  decode(repeat('a7', 32), 'hex'),
  2,
  11,
  decode(repeat('35', 20), 'hex'),
  decode(repeat('36', 32), 'hex'),
  'ClassicInitialBuyVestingWalletDeployed',
  array[decode(repeat('36', 32), 'hex')],
  decode('', 'hex'),
  '{"wallet":"0x7676767676767676767676767676767676767676","configurationCommitment":"0xf6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6"}'::jsonb,
  decode(repeat('37', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('a8', 32), 'hex'), decode(repeat('a7', 32), 'hex'), 11),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('38', 32), 'hex'),
  '2026-07-31T03:01:07Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('a9', 32), 'hex'), 12),
  '93000000-0000-0000-0000-000000000001',
  25639599,
  decode(repeat('aa', 32), 'hex'),
  decode(repeat('a9', 32), 'hex'),
  3,
  12,
  decode(repeat('39', 20), 'hex'),
  decode(repeat('3a', 32), 'hex'),
  'PoolRegistered',
  array[decode(repeat('3a', 32), 'hex')],
  decode('', 'hex'),
  '{"poolId":"0x7373737373737373737373737373737373737373737373737373737373737373","token":"0x7171717171717171717171717171717171717171","hook":"0x3939393939393939393939393939393939393939","currency0":"0x0000000000000000000000000000000000000000","currency1":"0x7171717171717171717171717171717171717171","positionRecipient":"0x7272727272727272727272727272727272727272","positionTokenId":"1","tokenLiquidityAmount":"999999999999999999999999","lockedTokenDust":"1","sqrtPriceX96":"79228162514264337593543950336","tick":"0","tickLower":"-887220","tickUpper":"887220"}'::jsonb,
  decode(repeat('3b', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('a9', 32), 'hex'), 12),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('3c', 32), 'hex'),
  '2026-07-31T03:01:08Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('88', 32), 'hex'), 13),
  '93000000-0000-0000-0000-000000000001',
  25639600,
  decode(repeat('99', 32), 'hex'),
  decode(repeat('88', 32), 'hex'),
  4294967295,
  13,
  decode(repeat('3d', 20), 'hex'),
  decode(repeat('3e', 32), 'hex'),
  'ClassicRewardVaultDeployed',
  array[decode(repeat('3e', 32), 'hex')],
  decode('010203', 'hex'),
  '{"vault":"0x7777777777777777777777777777777777777777","configurationCommitment":"0xf7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7"}'::jsonb,
  decode(repeat('3f', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('88', 32), 'hex'), 13),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('40', 32), 'hex'),
  '2026-07-31T03:01:09Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20),
  '93000000-0000-0000-0000-000000000001',
  25639600,
  decode(repeat('99', 32), 'hex'),
  decode(repeat('85', 32), 'hex'),
  11,
  20,
  decode(repeat('3d', 20), 'hex'),
  decode(repeat('3e', 32), 'hex'),
  'ClassicRewardVaultDeployed',
  array[decode(repeat('3e', 32), 'hex')],
  decode('010a', 'hex'),
  '{"vault":"0x7878787878787878787878787878787878787878","configurationCommitment":"0xf8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8"}'::jsonb,
  decode(repeat('41', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('42', 32), 'hex'),
  '2026-07-31T03:01:09.050Z'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20
  ),
  '910c0000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'),
  11, 20, decode(repeat('3d', 20), 'hex'), decode(repeat('3e', 32), 'hex'),
  'ClassicRewardVaultDeployed', array[decode(repeat('3e', 32), 'hex')],
  decode('010a', 'hex'),
  '{"vault":"0x7878787878787878787878787878787878787878","configurationCommitment":"0xf8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8"}'::jsonb,
  decode(repeat('41', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20
  ),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('42', 32), 'hex'), '2026-07-31T03:01:09.060Z',
  'canonical-events', 'ClassicVaultFactory'
);
select programmable_private.resolve_envio_candidate(
  '91220000-0000-0000-0000-000000000020',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20
  ),
  '91100000-0000-0000-0000-000000000004', null,
  decode(repeat('57', 32), 'hex'), decode(repeat('dd', 32), 'hex'),
  '2026-07-31T03:01:09.070Z'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('88', 32), 'hex'), 13
  ),
  '910c0000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'), decode(repeat('88', 32), 'hex'),
  4294967295, 13, decode(repeat('3d', 20), 'hex'),
  decode(repeat('3e', 32), 'hex'), 'ClassicRewardVaultDeployed',
  array[decode(repeat('3e', 32), 'hex')], decode('010203', 'hex'),
  '{"vault":"0x7777777777777777777777777777777777777777","configurationCommitment":"0xf7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7"}'::jsonb,
  decode(repeat('3f', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('88', 32), 'hex'), 13
  ),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('40', 32), 'hex'), '2026-07-31T03:01:09.080Z',
  'canonical-events', 'ClassicVaultFactory'
);
select programmable_private.resolve_envio_candidate(
  '91220000-0000-0000-0000-000000000011',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('88', 32), 'hex'), 13
  ),
  '91100000-0000-0000-0000-000000000004', null,
  decode(repeat('57', 32), 'hex'), decode(repeat('de', 32), 'hex'),
  '2026-07-31T03:01:09.090Z'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('aa', 32), 'hex'), decode(repeat('86', 32), 'hex'), 15
  ),
  '910c0000-0000-0000-0000-000000000001',
  25639599, decode(repeat('aa', 32), 'hex'), decode(repeat('86', 32), 'hex'),
  6, 15, decode(repeat('39', 20), 'hex'), decode(repeat('3a', 32), 'hex'),
  'PoolRegistered', array[decode(repeat('3a', 32), 'hex')],
  decode('0105', 'hex'), '{"releaseVersion":"unresolved"}'::jsonb,
  decode(repeat('da', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('aa', 32), 'hex'), decode(repeat('86', 32), 'hex'), 15
  ),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('db', 32), 'hex'), '2026-07-31T03:01:09.095Z',
  'canonical-events', 'ClassicHook'
);
select programmable_private.resolve_envio_candidate(
  '91220000-0000-0000-0000-000000000010',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('aa', 32), 'hex'), decode(repeat('86', 32), 'hex'), 15
  ),
  '91100000-0000-0000-0000-000000000003', null,
  decode(repeat('55', 32), 'hex'), decode(repeat('dc', 32), 'hex'),
  '2026-07-31T03:01:09.097Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('b1', 32), 'hex'), 16),
  '93000000-0000-0000-0000-000000000001',
  25639599,
  decode(repeat('aa', 32), 'hex'),
  decode(repeat('b1', 32), 'hex'),
  7,
  16,
  decode(repeat('39', 20), 'hex'),
  decode(repeat('f1', 32), 'hex'),
  'CreatorFeesClaimed',
  array[decode(repeat('f1', 32), 'hex')],
  decode('0106', 'hex'),
  '{"poolId":"0x7373737373737373737373737373737373737373737373737373737373737373","rewardVault":"0x7777777777777777777777777777777777777777","caller":"0x7272727272727272727272727272727272727272","amount":"10"}'::jsonb,
  decode(repeat('f3', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('b1', 32), 'hex'), 16),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('f5', 32), 'hex'),
  '2026-07-31T03:01:09.100Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('b2', 32), 'hex'), 17),
  '93000000-0000-0000-0000-000000000001',
  25639599,
  decode(repeat('aa', 32), 'hex'),
  decode(repeat('b2', 32), 'hex'),
  8,
  17,
  decode(repeat('39', 20), 'hex'),
  decode(repeat('f2', 32), 'hex'),
  'LauncherFeesClaimed',
  array[decode(repeat('f2', 32), 'hex')],
  decode('0107', 'hex'),
  '{"treasury":"0x3131313131313131313131313131313131313131","recipient":"0x3232323232323232323232323232323232323232","caller":"0x3333333333333333333333333333333333333333","amount":"20"}'::jsonb,
  decode(repeat('f4', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('b2', 32), 'hex'), 17),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('f6', 32), 'hex'),
  '2026-07-31T03:01:09.200Z'
);

select programmable_private.append_chain_event_occurrence(
  '96000000-0000-0000-0000-000000000002',
  '96100000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('a6', 32), 'hex'), decode(repeat('a5', 32), 'hex'), 10), 1, '2026-07-31T02:58:00Z', 'decoder-v1',
  decode(repeat('51', 32), 'hex'),
  '95000000-0000-0000-0000-000000000597',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310051', 'hex'),
  decode(repeat('52', 32), 'hex'), '2026-07-31T03:01:10Z'
);
select programmable_private.append_chain_event_occurrence(
  '96000000-0000-0000-0000-000000000003',
  '96100000-0000-0000-0000-000000000003',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('a8', 32), 'hex'), decode(repeat('a7', 32), 'hex'), 11), 1, '2026-07-31T02:58:12Z', 'decoder-v1',
  decode(repeat('53', 32), 'hex'),
  '95000000-0000-0000-0000-000000000598',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310052', 'hex'),
  decode(repeat('54', 32), 'hex'), '2026-07-31T03:01:11Z'
);
select programmable_private.append_chain_event_occurrence(
  '96000000-0000-0000-0000-000000000004',
  '96100000-0000-0000-0000-000000000004',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('a9', 32), 'hex'), 12), 1, '2026-07-31T02:58:24Z', 'decoder-v1',
  decode(repeat('55', 32), 'hex'),
  '95000000-0000-0000-0000-000000000599',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310053', 'hex'),
  decode(repeat('56', 32), 'hex'), '2026-07-31T03:01:12Z'
);
select programmable_private.append_chain_event_occurrence(
  '96000000-0000-0000-0000-000000000001',
  '96100000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('88', 32), 'hex'), 13), 4294967295, '2026-07-31T02:58:36Z', 'decoder-v1',
  decode(repeat('57', 32), 'hex'),
  '95000000-0000-0000-0000-000000000600',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310054', 'hex'),
  decode(repeat('58', 32), 'hex'), '2026-07-31T03:01:13Z'
);
select programmable_private.append_chain_event_occurrence(
  '96000000-0000-0000-0000-000000000007',
  '96100000-0000-0000-0000-000000000007',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20), 2, '2026-07-31T02:58:36.100Z',
  'decoder-v1', decode(repeat('57', 32), 'hex'),
  '95000000-0000-0000-0000-000000000600',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310074', 'hex'),
  decode(repeat('59', 32), 'hex'), '2026-07-31T03:01:13.050Z'
);
select programmable_private.append_chain_event_occurrence(
  '96000000-0000-0000-0000-000000000005',
  '96100000-0000-0000-0000-000000000005',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('b1', 32), 'hex'), 16), 1, '2026-07-31T02:58:25Z', 'decoder-v1',
  decode(repeat('55', 32), 'hex'),
  '95000000-0000-0000-0000-000000000599',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310056', 'hex'),
  decode(repeat('f7', 32), 'hex'), '2026-07-31T03:01:13.100Z'
);
select programmable_private.append_chain_event_occurrence(
  '96000000-0000-0000-0000-000000000006',
  '96100000-0000-0000-0000-000000000006',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('b2', 32), 'hex'), 17), 1, '2026-07-31T02:58:26Z', 'decoder-v1',
  decode(repeat('55', 32), 'hex'),
  '95000000-0000-0000-0000-000000000599',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310057', 'hex'),
  decode(repeat('f8', 32), 'hex'), '2026-07-31T03:01:13.200Z'
);

select programmable_private.acquire_projector_lease(
  1, 'classic-v3', 'classic-v3', 'core', 'projector-v1',
  '91000000-0000-0000-0000-000000000001', 1,
  0, 1, decode(repeat('aa', 32), 'hex'), 'seed-worker',
  '2026-07-31T03:02:00Z', '2026-07-31T03:12:00Z',
  decode(repeat('ab', 32), 'hex')
);
select programmable_private.open_run(
  '97000000-0000-0000-0000-000000000001',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('61', 32), 'hex'),
  '2026-07-31T03:02:01Z'
);
select programmable_private.stage_launch_projection(
  '97100000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000001',
  decode(repeat('71', 20), 'hex'), decode(repeat('72', 20), 'hex'),
  decode(repeat('88', 32), 'hex'), decode(repeat('73', 32), 'hex'),
  null, decode(repeat('74', 32), 'hex'),
  'Seed Token', 'SEED', 1000000000000000000000000,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:02:02Z'
);
select programmable_private.stage_pool_projection(
  '97110000-0000-0000-0000-000000000001',
  '97100000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000001',
  decode(repeat('00', 20), 'hex'), decode(repeat('71', 20), 'hex'),
  3000, 60, decode(repeat('39', 20), 'hex'),
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:02:02.100Z'
);
select programmable_private.stage_pool_fee_configuration(
  '97120000-0000-0000-0000-000000000001',
  '97110000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000001',
  30, 40, 20, 10, 0, 3000,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:02:02.200Z'
);
select programmable_private.stage_launch_occurrence_role(
  '97100000-0000-0000-0000-000000000001', 'vault_factory',
  '96100000-0000-0000-0000-000000000001', '2026-07-31T03:02:02.300Z'
);
select programmable_private.stage_launch_projection_conditions(
  '97100000-0000-0000-0000-000000000001', false,
  '2026-07-31T03:02:02.400Z'
);
select throws_ok(
  $$
    select programmable_private.stage_launch_position_liquidity_v1(
      '97105000-0000-0000-0000-000000000099',
      '97100000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000001',
      decode(repeat('72', 20), 'hex'), 1,
      999999999999999999999999, 1,
      79228162514264337593543950336,
      0, 0, 887220,
      '96100000-0000-0000-0000-000000000004',
      decode(repeat('6e', 32), 'hex'),
      '2026-07-31T03:02:02.440Z'
    )
  $$,
  '23514',
  'Classic boundary exception never permits initial_tick = tick_lower'
);
select programmable_private.stage_launch_position_liquidity_v1(
  '97105000-0000-0000-0000-000000000001',
  '97100000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000001',
  decode(repeat('72', 20), 'hex'), 1,
  999999999999999999999999, 1,
  79228162514264337593543950336,
  0, -887220, 0,
  '96100000-0000-0000-0000-000000000004',
  decode(repeat('6f', 32), 'hex'),
  '2026-07-31T03:02:02.450Z'
);
select programmable_private.promote_projection_run(
  '97200000-0000-0000-0000-000000000001',
  '97300000-0000-0000-0000-000000000001',
  '97400000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000001',
  'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
  0, 1, 0,
  '94000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000600',
  25639600, decode(repeat('99', 32), 'hex'),
  13,
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('88', 32), 'hex'), 13
  ),
  array[
    '96100000-0000-0000-0000-000000000001'::uuid,
    '96100000-0000-0000-0000-000000000002'::uuid,
    '96100000-0000-0000-0000-000000000003'::uuid,
    '96100000-0000-0000-0000-000000000004'::uuid,
    '96100000-0000-0000-0000-000000000005'::uuid,
    '96100000-0000-0000-0000-000000000006'::uuid,
    '96100000-0000-0000-0000-000000000007'::uuid
  ],
  array[]::uuid[], array[]::uuid[],
  array[
    '91220000-0000-0000-0000-000000000010'::uuid,
    '91220000-0000-0000-0000-000000000011'::uuid
  ],
  array['explore-list']::text[],
  decode(repeat('75', 32), 'hex'), '2026-07-31T03:02:03Z'
);
select programmable_private.append_dual_rpc_runtime_code_evidence(
  '91205000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  decode(repeat('77', 20), 'hex'),
  '95000000-0000-0000-0000-000000000600',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  decode(repeat('d1', 32), 'hex'), decode(repeat('d1', 32), 'hex'),
  decode(repeat('01', 6543), 'hex'), decode(repeat('01', 6543), 'hex'),
  6543, 6543,
  decode(repeat('d1', 32), 'hex'), decode(repeat('d1', 32), 'hex'),
  decode(repeat('df', 32), 'hex'),
  array[decode(repeat('77', 20), 'hex')],
  decode(repeat('d9', 32), 'hex'),
  decode(repeat('01', 6543), 'hex'),
  decode(repeat('d1', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000361', 'hex'),
  decode(repeat('da', 32), 'hex'),
  decode(repeat('d0', 32), 'hex'), '2026-07-31T03:02:03.050Z'
);
select programmable_private.append_dual_rpc_runtime_code_evidence(
  '91205000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001',
  decode(repeat('76', 20), 'hex'),
  '95000000-0000-0000-0000-000000000598',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  decode(repeat('c1', 32), 'hex'), decode(repeat('c1', 32), 'hex'),
  decode(repeat('02', 1234), 'hex'), decode(repeat('02', 1234), 'hex'),
  1234, 1234,
  decode(repeat('c1', 32), 'hex'), decode(repeat('c1', 32), 'hex'),
  decode(repeat('cf', 32), 'hex'),
  array[decode(repeat('76', 20), 'hex')],
  decode(repeat('c9', 32), 'hex'),
  decode(repeat('02', 1234), 'hex'),
  decode(repeat('c1', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000362', 'hex'),
  decode(repeat('ca', 32), 'hex'),
  decode(repeat('c0', 32), 'hex'), '2026-07-31T03:02:03.060Z'
);
select programmable_private.register_dynamic_source_attestation(
  '91210000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001',
  '91200000-0000-0000-0000-000000000002',
  '96100000-0000-0000-0000-000000000003',
  decode(repeat('76', 20), 'hex'), 25639598,
  '91205000-0000-0000-0000-000000000002',
  decode(repeat('a4', 32), 'hex'),
  decode(repeat('c9', 32), 'hex'),
  decode(repeat('f6', 32), 'hex'),
  decode(repeat('b1', 32), 'hex'), decode(repeat('b2', 32), 'hex'),
  decode(repeat('c1', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000471', 'hex'),
  decode(repeat('cb', 32), 'hex'),
  decode(repeat('c4', 32), 'hex'), '2026-07-31T03:02:03.070Z'
);
select programmable_private.register_dynamic_source_attestation(
  '91210000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  '91200000-0000-0000-0000-000000000001',
  '96100000-0000-0000-0000-000000000001',
  decode(repeat('77', 20), 'hex'), 25639600,
  '91205000-0000-0000-0000-000000000001',
  decode(repeat('a4', 32), 'hex'),
  decode(repeat('d9', 32), 'hex'),
  decode(repeat('f7', 32), 'hex'),
  decode(repeat('b3', 32), 'hex'), decode(repeat('b4', 32), 'hex'),
  decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000472', 'hex'),
  decode(repeat('db', 32), 'hex'),
  decode(repeat('d4', 32), 'hex'), '2026-07-31T03:02:03.100Z'
);
select programmable_private.bind_dynamic_source_release_asset_v1(
  '91215000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  '91210000-0000-0000-0000-000000000001',
  '96100000-0000-0000-0000-000000000002',
  '96100000-0000-0000-0000-000000000004',
  decode(repeat('73', 32), 'hex'),
  decode(repeat('71', 20), 'hex'),
  decode(repeat('39', 20), 'hex'),
  decode(repeat('00', 20), 'hex'),
  decode(repeat('d8', 32), 'hex'),
  '2026-07-31T03:02:03.105Z'
);
select programmable_private.append_dual_rpc_runtime_code_evidence(
  '91205000-0000-0000-0000-000000000003',
  '93000000-0000-0000-0000-000000000001',
  decode(repeat('78', 20), 'hex'),
  '95000000-0000-0000-0000-000000000600',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  decode(repeat('d5', 32), 'hex'), decode(repeat('d5', 32), 'hex'),
  decode(repeat('03', 6543), 'hex'), decode(repeat('03', 6543), 'hex'),
  6543, 6543,
  decode(repeat('d1', 32), 'hex'), decode(repeat('d1', 32), 'hex'),
  decode(repeat('df', 32), 'hex'),
  array[decode(repeat('78', 20), 'hex')],
  decode(repeat('da', 32), 'hex'),
  decode(repeat('03', 6543), 'hex'),
  decode(repeat('d5', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000363', 'hex'),
  decode(repeat('dc', 32), 'hex'),
  decode(repeat('d6', 32), 'hex'), '2026-07-31T03:02:03.110Z'
);
select programmable_private.register_dynamic_source_attestation(
  '91210000-0000-0000-0000-000000000003',
  '93000000-0000-0000-0000-000000000001',
  '91200000-0000-0000-0000-000000000001',
  '96100000-0000-0000-0000-000000000007',
  decode(repeat('78', 20), 'hex'), 25639600,
  '91205000-0000-0000-0000-000000000003',
  decode(repeat('a4', 32), 'hex'),
  decode(repeat('da', 32), 'hex'),
  decode(repeat('f8', 32), 'hex'),
  decode(repeat('b5', 32), 'hex'), decode(repeat('b6', 32), 'hex'),
  decode(repeat('d5', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000473', 'hex'),
  decode(repeat('dd', 32), 'hex'),
  decode(repeat('d7', 32), 'hex'), '2026-07-31T03:02:03.120Z'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14),
  '910c0000-0000-0000-0000-000000000001',
  25639600,
  decode(repeat('99', 32), 'hex'),
  decode(repeat('87', 32), 'hex'),
  5,
  14,
  decode(repeat('77', 20), 'hex'),
  decode(repeat('d5', 32), 'hex'),
  'BeneficiaryFeesClaimed',
  array[decode(repeat('d5', 32), 'hex')],
  decode('0104', 'hex'),
  '{"releaseVersion":"unresolved"}'::jsonb,
  decode(repeat('d6', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('d7', 32), 'hex'),
  '2026-07-31T03:02:03.200Z'
);
select programmable_private.resolve_envio_candidate(
  '91220000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14), null,
  '91210000-0000-0000-0000-000000000001',
  decode(repeat('d2', 32), 'hex'), decode(repeat('d8', 32), 'hex'),
  '2026-07-31T03:02:03.300Z'
);
select programmable_private.append_chain_event_occurrence(
  '91230000-0000-0000-0000-000000000001',
  '91240000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14),
  '91220000-0000-0000-0000-000000000001',
  3, '2026-07-31T02:58:37Z', 'decoder-v1',
  decode(repeat('d2', 32), 'hex'),
  '95000000-0000-0000-0000-000000000600',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310055', 'hex'),
  decode(repeat('d9', 32), 'hex'), '2026-07-31T03:02:03.400Z'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('b3', 32), 'hex'), 18),
  '910c0000-0000-0000-0000-000000000001',
  25639600,
  decode(repeat('99', 32), 'hex'),
  decode(repeat('b3', 32), 'hex'),
  9,
  18,
  decode(repeat('77', 20), 'hex'),
  decode(repeat('e1', 32), 'hex'),
  'CreatorFeesCheckpointed',
  array[decode(repeat('e1', 32), 'hex')],
  decode('0108', 'hex'),
  '{"poolId":"0x7373737373737373737373737373737373737373737373737373737373737373","configurationEpoch":"1","amount":"100","totalCreatorFeesReceived":"1000"}'::jsonb,
  decode(repeat('e3', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('b3', 32), 'hex'), 18),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('ed', 32), 'hex'),
  '2026-07-31T03:02:03.410Z'
);
select programmable_private.resolve_envio_candidate(
  '91220000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('b3', 32), 'hex'), 18), null,
  '91210000-0000-0000-0000-000000000001',
  decode(repeat('d2', 32), 'hex'), decode(repeat('ea', 32), 'hex'),
  '2026-07-31T03:02:03.420Z'
);
select programmable_private.append_chain_event_occurrence(
  '91230000-0000-0000-0000-000000000002',
  '91240000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('b3', 32), 'hex'), 18),
  '91220000-0000-0000-0000-000000000002',
  1, '2026-07-31T02:58:38Z', 'decoder-v1',
  decode(repeat('d2', 32), 'hex'),
  '95000000-0000-0000-0000-000000000600',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310058', 'hex'),
  decode(repeat('ec', 32), 'hex'), '2026-07-31T03:02:03.430Z'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('b4', 32), 'hex'), 19),
  '910c0000-0000-0000-0000-000000000001',
  25639600,
  decode(repeat('99', 32), 'hex'),
  decode(repeat('b4', 32), 'hex'),
  10,
  19,
  decode(repeat('77', 20), 'hex'),
  decode(repeat('e2', 32), 'hex'),
  'CtoRewardConfigurationActivated',
  array[decode(repeat('e2', 32), 'hex')],
  decode('0109', 'hex'),
  '{"poolId":"0x7373737373737373737373737373737373737373737373737373737373737373","approvalReference":"0xafafafafafafafafafafafafafafafafafafafafafafafafafafafafafafafaf","configurationEpoch":"2","previousConfigurationHash":"0xa2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2","newConfigurationHash":"0xa3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3","beneficiaries":["0x1111111111111111111111111111111111111111","0x2222222222222222222222222222222222222222"],"sharesBps":[6000,4000],"effectiveTotalCreatorFeesReceived":"1000"}'::jsonb,
  decode(repeat('e4', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('b4', 32), 'hex'), 19),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('ee', 32), 'hex'),
  '2026-07-31T03:02:03.440Z'
);
select programmable_private.resolve_envio_candidate(
  '91220000-0000-0000-0000-000000000003',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('b4', 32), 'hex'), 19), null,
  '91210000-0000-0000-0000-000000000001',
  decode(repeat('d2', 32), 'hex'), decode(repeat('eb', 32), 'hex'),
  '2026-07-31T03:02:03.450Z'
);
select programmable_private.append_chain_event_occurrence(
  '91230000-0000-0000-0000-000000000003',
  '91240000-0000-0000-0000-000000000003',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('b4', 32), 'hex'), 19),
  '91220000-0000-0000-0000-000000000003',
  1, '2026-07-31T02:58:39Z', 'decoder-v1',
  decode(repeat('d2', 32), 'hex'),
  '95000000-0000-0000-0000-000000000600',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310059', 'hex'),
  decode(repeat('ef', 32), 'hex'), '2026-07-31T03:02:03.460Z'
);

select programmable_private.create_release_epoch(
  '91300000-0000-0000-0000-000000000001',
  1, 'stock-paired-v3', 'stock-paired-v3', 'core', 1,
  decode(repeat('e0', 32), 'hex'), decode(repeat('e1', 32), 'hex'),
  decode(repeat('e2', 32), 'hex'), '2026-07-31T03:02:03.700Z'
);
select programmable_private.append_release_source_binding(
  '91310000-0000-0000-0000-000000000001',
  '91300000-0000-0000-0000-000000000001',
  'shared-hook', 'hook', 'ethereum_contract',
  decode(repeat('39', 20), 'hex'), null, 25639599,
  decode(repeat('55', 32), 'hex'), decode(repeat('e1', 32), 'hex'),
  decode(repeat('e3', 32), 'hex'), decode(repeat('e4', 32), 'hex'),
  '2026-07-31T03:02:03.800Z'
);
select programmable_private.append_release_projection_event_rule(
  '91310000-0000-0000-0000-000000000002',
  '91300000-0000-0000-0000-000000000001',
  'pool', 'hook', 'PoolRegistered', decode(repeat('e6', 32), 'hex'),
  '2026-07-31T03:02:03.850Z'
);
select programmable_private.activate_release_epoch(
  1, 'stock-paired-v3', 'stock-paired-v3', 'core',
  '91300000-0000-0000-0000-000000000001',
  0, 1, decode(repeat('e5', 32), 'hex'), '2026-07-31T03:02:03.900Z'
);
select programmable_private.open_run(
  '91320000-0000-0000-0000-000000000001',
  'ingestion', 1, 'stock-paired-v3', 'stock-paired-v3', 'core',
  '91300000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('e6', 32), 'hex'),
  '2026-07-31T03:02:04Z'
);
select programmable_private.resolve_envio_candidate(
  '91330000-0000-0000-0000-000000000001',
  '91320000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('86', 32), 'hex'), 15),
  '91310000-0000-0000-0000-000000000001', null,
  decode(repeat('55', 32), 'hex'), decode(repeat('e7', 32), 'hex'),
  '2026-07-31T03:02:04.100Z'
);
select programmable_private.append_safe_head_observation(
  '91340000-0000-0000-0000-000000000001',
  '91320000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  1, 1, 25639620, 25639620, 12, 25639608,
  decode(repeat('cc', 32), 'hex'), decode(repeat('cc', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000170', 'hex'),
  decode(repeat('e8', 32), 'hex'), '2026-07-31T03:02:04.200Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  '91350000-0000-0000-0000-000000000001',
  '91340000-0000-0000-0000-000000000001',
  '91320000-0000-0000-0000-000000000001',
  25639599, decode(repeat('aa', 32), 'hex'), decode(repeat('aa', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000271', 'hex'),
  decode(repeat('e9', 32), 'hex'), '2026-07-31T03:02:04.300Z'
);
select programmable_private.append_chain_event_occurrence(
  '91360000-0000-0000-0000-000000000001',
  '91370000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('86', 32), 'hex'), 15),
  '91220000-0000-0000-0000-000000000010',
  4, '2026-07-31T02:58:35Z', 'decoder-v1',
  decode(repeat('55', 32), 'hex'),
  '95000000-0000-0000-0000-000000000599',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310072', 'hex'),
  decode(repeat('ea', 32), 'hex'), '2026-07-31T03:02:04.400Z'
);
select programmable_private.append_chain_event_occurrence(
  '91360000-0000-0000-0000-000000000001',
  '91370000-0000-0000-0000-000000000001',
  '91320000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('aa', 32), 'hex'), decode(repeat('86', 32), 'hex'), 15),
  '91330000-0000-0000-0000-000000000001',
  4, '2026-07-31T02:58:35Z', 'decoder-v2',
  decode(repeat('55', 32), 'hex'),
  '91350000-0000-0000-0000-000000000001',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310073', 'hex'),
  decode(repeat('eb', 32), 'hex'), '2026-07-31T03:02:04.500Z'
);

select programmable_private.open_run(
  '97000000-0000-0000-0000-000000000002',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('62', 32), 'hex'),
  '2026-07-31T03:03:00Z'
);
select programmable_private.append_creator_hook_claim_fact(
  '91600000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  '96100000-0000-0000-0000-000000000005',
  decode(repeat('73', 32), 'hex'), decode(repeat('77', 20), 'hex'),
  null, null, null, decode(repeat('72', 20), 'hex'), 10,
  '2026-07-31T03:03:00.100Z'
);
select programmable_private.append_launcher_hook_claim_fact(
  '91600000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000002',
  '96100000-0000-0000-0000-000000000006',
  decode(repeat('31', 20), 'hex'), decode(repeat('32', 20), 'hex'),
  null, decode(repeat('33', 20), 'hex'), 20,
  '2026-07-31T03:03:00.200Z'
);
select programmable_private.stage_launch_projection(
  '97100000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('71', 20), 'hex'), decode(repeat('72', 20), 'hex'),
  decode(repeat('88', 32), 'hex'), decode(repeat('73', 32), 'hex'),
  decode(repeat('77', 20), 'hex'), decode(repeat('74', 32), 'hex'),
  'Seed Token', 'SEED', 1000000000000000000000000,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:01Z'
);
select programmable_private.stage_pool_projection(
  '97110000-0000-0000-0000-000000000002',
  '97100000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('00', 20), 'hex'), decode(repeat('71', 20), 'hex'),
  3000, 60, decode(repeat('39', 20), 'hex'),
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:01.100Z'
);
select programmable_private.append_reward_allocation_fact(
  '98000000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('77', 20), 'hex'),
  '96100000-0000-0000-0000-000000000001',
  array[
    decode(repeat('11', 20), 'hex'),
    decode(repeat('22', 20), 'hex')
  ],
  array[6000::numeric, 4000::numeric],
  decode(repeat('a1', 32), 'hex'),
  decode(repeat('a2', 32), 'hex'),
  decode(repeat('a3', 32), 'hex'),
  decode(repeat('a4', 32), 'hex'),
  array[
    '96100000-0000-0000-0000-000000000002'::uuid,
    '96100000-0000-0000-0000-000000000001'::uuid,
    '96100000-0000-0000-0000-000000000004'::uuid
  ],
  array['launcher', 'vault_factory', 'hook']::text[],
  1::smallint,
  decode('70726f6772616d6d61626c653a616c6c6f636174696f6e3a76310000000000000000010000000a636c61737369632d76330000000a636c61737369632d7633777777777777777777777777777777777777777788888888888888888888888888888888888888888888888888888888888888880000000299999999999999999999999999999999999999999999999999999999999999990000000001873ab00000000400000002111111111111111111111111111111111111111122222222222222222222222222222222222222220000000217700fa0a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a201a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a400000003a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a500000001a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6000000086c61756e63686572a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a700000001a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a800000007666163746f7279a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a900000001aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00000004686f6f6b', 'hex'),
  decode('760efbc9872c2018c892290c30ca097f4b346240b30c766a22c20568bf4d14f0', 'hex'),
  '2026-07-31T03:03:02Z'
);
select programmable_private.append_reward_allocation_evidence(
  '98100000-0000-0000-0000-000000000001',
  '98000000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  'launcher_calldata', 'seed-verifier-v1.0.0',
  decode(repeat('31', 20), 'hex'), decode('bf388406', 'hex'),
  decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
  decode(repeat('77', 20), 'hex'), 'unavailable',
  null, null, null, null, null,
  null, null,
  decode(repeat('a2', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
  1::smallint,
  decode('70726f6772616d6d61626c653a65766964656e63653a763100760efbc9872c2018c892290c30ca097f4b346240b30c766a22c20568bf4d14f0000000116c61756e636865725f63616c6c6461746100000014736565642d76657269666965722d76312e302e3001b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b201bf38840601b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a477777777777777777777777777777777777777770000000b756e617661696c61626c6500000000000000b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b701b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b801b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b80000000003525252525252525252525252525252525252525252525252525252525252525254545454545454545454545454545454545454545454545454545454545454545656565656565656565656565656565656565656565656565656565656565656', 'hex'),
  decode('db14c9fa42eaedfcf77221edc2861e7f2c0251997313951d7a06c65ca73beea3', 'hex'),
  '2026-07-31T03:03:03Z',
  decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  decode(repeat('a3', 32), 'hex')
);
select programmable_private.append_reward_allocation_evidence(
  '98100000-0000-0000-0000-000000000002',
  '98000000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  'launcher_calldata', 'seed-verifier-v1.0.1',
  decode(repeat('31', 20), 'hex'), decode('bf388406', 'hex'),
  decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
  decode(repeat('77', 20), 'hex'), 'matched',
  decode(repeat('99', 32), 'hex'),
  decode(repeat('a3', 32), 'hex'), decode(repeat('a3', 32), 'hex'),
  decode(repeat('b6', 32), 'hex'), decode(repeat('b6', 32), 'hex'),
  decode(repeat('77', 20), 'hex'), decode(repeat('77', 20), 'hex'),
  decode(repeat('a2', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
  1::smallint,
  decode('70726f6772616d6d61626c653a65766964656e63653a763100760efbc9872c2018c892290c30ca097f4b346240b30c766a22c20568bf4d14f0000000116c61756e636865725f63616c6c6461746100000014736565642d76657269666965722d76312e302e3101b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b201bf38840601b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a47777777777777777777777777777777777777777000000076d61746368656401999999999999999999999999999999999999999999999999999999999999999901b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b501b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b501b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b601b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6017777777777777777777777777777777777777777017777777777777777777777777777777777777777b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b701b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b801b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b80100000008636f6d706c65746500000003525252525252525252525252525252525252525252525252525252525252525254545454545454545454545454545454545454545454545454545454545454545656565656565656565656565656565656565656565656565656565656565656', 'hex'),
  decode('4e99ae66bbff8c7dba24b69f313d30db8c16a059660001195c00df02b9db2c67', 'hex'),
  '2026-07-31T03:03:04Z',
  decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  decode(repeat('a3', 32), 'hex')
);
select programmable_private.append_reward_allocation_evidence(
  '98100000-0000-0000-0000-000000000003',
  '98000000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  'historical_getters', 'seed-verifier-v1.0.2',
  null, null, null, decode(repeat('c0', 32), 'hex'),
  decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
  decode(repeat('77', 20), 'hex'), 'matched',
  decode(repeat('99', 32), 'hex'),
  decode(repeat('a3', 32), 'hex'), decode(repeat('a3', 32), 'hex'),
  decode(repeat('c6', 32), 'hex'), decode(repeat('c6', 32), 'hex'),
  decode(repeat('77', 20), 'hex'), decode(repeat('77', 20), 'hex'),
  decode(repeat('a2', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  null, null,
  1::smallint,
  decode('70726f6772616d6d61626c653a65766964656e63653a76310060', 'hex'),
  decode(repeat('c8', 32), 'hex'), '2026-07-31T03:03:05Z',
  decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  decode(repeat('a3', 32), 'hex')
);
select programmable_private.append_reward_allocation_evidence(
  '98100000-0000-0000-0000-000000000004',
  '98000000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  'coordinator_calldata', 'seed-verifier-v1.0.3',
  decode(repeat('3e', 20), 'hex'), decode('deadbeef', 'hex'),
  decode(repeat('b9', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
  decode(repeat('77', 20), 'hex'), 'unavailable',
  null, null, null, null, null, null, null,
  decode(repeat('a2', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
  1::smallint,
  decode('70726f6772616d6d61626c653a65766964656e63653a76310061', 'hex'),
  decode(repeat('c9', 32), 'hex'), '2026-07-31T03:03:05.100Z',
  decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  decode(repeat('a3', 32), 'hex')
);
select programmable_private.stage_account_reward_balance(
  '98200000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('11', 20), 'hex'), decode(repeat('77', 20), 'hex'),
  593, 0, '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06Z'
);
select programmable_private.stage_account_reward_balance(
  '98200000-0000-0000-0000-000000000003',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('22', 20), 'hex'), decode(repeat('77', 20), 'hex'),
  395, 0, '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.010Z'
);
select programmable_private.stage_account_reward_balance(
  '98200000-0000-0000-0000-000000000004',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('33', 20), 'hex'), decode(repeat('77', 20), 'hex'),
  7, 5, '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.020Z'
);
select programmable_private.stage_reward_vault_projection(
  '98210000-0000-0000-0000-000000000001',
  '97100000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('77', 20), 'hex'), decode(repeat('73', 32), 'hex'),
  null, decode(repeat('a2', 32), 'hex'),
  '98000000-0000-0000-0000-000000000001',
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.100Z'
);
select programmable_private.stage_reward_allocation_projection(
  '98220000-0000-0000-0000-000000000001',
  '98210000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  '98000000-0000-0000-0000-000000000001',
  1, 0, decode(repeat('11', 20), 'hex'), decode(repeat('11', 20), 'hex'),
  6000, 25639600, null,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.200Z'
);
select programmable_private.stage_reward_allocation_projection(
  '98220000-0000-0000-0000-000000000002',
  '98210000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  '98000000-0000-0000-0000-000000000001',
  1, 1, decode(repeat('22', 20), 'hex'), decode(repeat('22', 20), 'hex'),
  4000, 25639600, null,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.300Z'
);

select programmable_private.stage_pool_fee_configuration(
  '98230000-0000-0000-0000-000000000001',
  '97110000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000002',
  30, 40, 200, 100, 0, 3000,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.400Z'
);
select programmable_private.stage_fee_accrual_fact(
  '98240000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('73', 32), 'hex'), null, 1000, 200, 100,
  '96100000-0000-0000-0000-000000000002',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.500Z'
);
select programmable_private.stage_pool_fee_total(
  '98250000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('73', 32), 'hex'), null, 1000, 200, 100,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.600Z'
);
select programmable_private.stage_claim_projection(
  '98260000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('77', 20), 'hex'), 'creator',
  decode(repeat('72', 20), 'hex'), decode(repeat('72', 20), 'hex'),
  10, 10, 100,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.700Z'
);
select programmable_private.stage_payout_change_projection(
  '98270000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('77', 20), 'hex'), decode(repeat('33', 20), 'hex'),
  decode(repeat('33', 20), 'hex'), decode(repeat('34', 20), 'hex'), 1,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.800Z'
);
select programmable_private.stage_initial_buy_custody_projection(
  '98280000-0000-0000-0000-000000000001',
  '97100000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('13', 20), 'hex'), 1::smallint, 30, 7,
  decode(repeat('a9', 32), 'hex'),
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.900Z'
);
select programmable_private.stage_initial_buy_vesting_projection(
  '98290000-0000-0000-0000-000000000001',
  '98280000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000002',
  decode(repeat('11', 20), 'hex'), decode(repeat('71', 20), 'hex'), 100,
  '2026-07-31T03:03:00Z', '2026-08-30T03:03:00Z',
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:06.950Z'
);
reset role;

select is(
  (
    select count(*)
    from programmable_private.chain_event_occurrences
    where occurrence_id = '91370000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'shared raw chain data retains one global occurrence identity'
);

select is(
  (
    select count(*)
    from programmable_private.chain_event_occurrence_materializations
    where occurrence_id = '91370000-0000-0000-0000-000000000001'
      and (epoch_id, pointer_generation) in (
        ('91000000-0000-0000-0000-000000000001'::uuid, 1::bigint),
        ('91300000-0000-0000-0000-000000000001'::uuid, 1::bigint)
      )
  ),
  2::bigint,
  'one raw occurrence materializes independently in two exact release epochs'
);

set local role programmable_projector;
select lives_ok(
  $sql$
    select programmable_private.assert_projection_event_allowed(
      '91320000-0000-0000-0000-000000000001',
      '91370000-0000-0000-0000-000000000001',
      'pool'
    )
  $sql$,
  'the second release authorizes the shared occurrence through its own materialization'
);
reset role;

select is(
  (select count(*) from programmable_private.creator_hook_claim_facts)
    + (select count(*) from programmable_private.launcher_hook_claim_facts),
  2::bigint,
  'creator and launcher hook claims persist as distinct typed facts'
);
set local role programmable_projector;
select is(
  programmable_private.append_creator_hook_claim_fact(
    '91600000-0000-0000-0000-000000000001',
    '97000000-0000-0000-0000-000000000002',
    '96100000-0000-0000-0000-000000000005',
    decode(repeat('73', 32), 'hex'), decode(repeat('77', 20), 'hex'),
    null, null, null, decode(repeat('72', 20), 'hex'), 10,
    '2026-07-31T03:03:00.100Z'
  ),
  '91600000-0000-0000-0000-000000000001'::uuid,
  'exact typed event-fact replay is idempotent'
);
select throws_ok(
  $sql$
    select programmable_private.append_creator_hook_claim_fact(
      '91600000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      '96100000-0000-0000-0000-000000000005',
      decode(repeat('73', 32), 'hex'), decode(repeat('77', 20), 'hex'),
      null, null, null, decode(repeat('72', 20), 'hex'), 11,
      '2026-07-31T03:03:00.100Z'
    )
  $sql$,
  '23505',
  'typed event-fact replay cannot change immutable content'
);
select throws_ok(
  $sql$
    select programmable_private.assert_projection_event_allowed(
      '97000000-0000-0000-0000-000000000002',
      '96100000-0000-0000-0000-000000000002',
      'creator_hook_claim'
    )
  $sql$,
  '23514',
  'wrong event and source role are rejected by the release writer allowlist'
);
select ok(
  (
    select count(*) = 1
       and bool_and(allocation_fact_id =
         '98000000-0000-0000-0000-000000000001'::uuid
       )
       and bool_and(allocation_evidence_id is not null)
       and bool_and(cardinality(ordered_beneficiaries) = 2)
    from programmable_private.get_projector_verified_reward_seed_v1(
      '97000000-0000-0000-0000-000000000002',
      decode(repeat('77', 20), 'hex')
    )
  ),
  'projector reward-seed reader returns the one exact promotable fact/evidence pair'
);
select throws_ok(
  $sql$
    select programmable_private.promote_projection_run(
      '97200000-0000-0000-0000-000000000022',
      '97300000-0000-0000-0000-000000000022',
      '97400000-0000-0000-0000-000000000022',
      '97000000-0000-0000-0000-000000000002',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'), 1, 2, 0,
      '94000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000600',
      25639600, decode(repeat('99', 32), 'hex'),
      20,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20
      ),
      array[
        '96100000-0000-0000-0000-000000000001'::uuid,
        '96100000-0000-0000-0000-000000000002'::uuid,
        '96100000-0000-0000-0000-000000000003'::uuid,
        '96100000-0000-0000-0000-000000000004'::uuid
      ],
      array['98000000-0000-0000-0000-000000000001'::uuid],
      array['98100000-0000-0000-0000-000000000001'::uuid],
      array[
        '91220000-0000-0000-0000-000000000001'::uuid,
        '91220000-0000-0000-0000-000000000002'::uuid,
        '91220000-0000-0000-0000-000000000003'::uuid,
        '91220000-0000-0000-0000-000000000020'::uuid
      ],
      array['explore-list']::text[], decode(repeat('e9', 32), 'hex'),
      '2026-07-31T03:03:06.990Z'
    )
  $sql$,
  '23514',
  'publication rejects a launch whose manifest roles and conditions are missing'
);
select programmable_private.stage_launch_occurrence_role(
  '97100000-0000-0000-0000-000000000002', 'vault_factory',
  '96100000-0000-0000-0000-000000000001', '2026-07-31T03:03:07Z'
);
select programmable_private.stage_launch_occurrence_role(
  '97100000-0000-0000-0000-000000000002', 'vesting_factory',
  '96100000-0000-0000-0000-000000000003', '2026-07-31T03:03:07.010Z'
);
select programmable_private.stage_launch_projection_conditions(
  '97100000-0000-0000-0000-000000000002', false,
  '2026-07-31T03:03:07.020Z'
);

select is(
  public.reward_test_shared_resolution_count(),
  2::bigint,
  'one unresolved shared-source candidate can resolve to two exact release manifests'
);
select throws_ok(
  $sql$
    select programmable_private.resolve_envio_candidate(
      '91330000-0000-0000-0000-000000000002',
      '91320000-0000-0000-0000-000000000001',
      programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14), null,
      '91210000-0000-0000-0000-000000000001',
      decode(repeat('d2', 32), 'hex'), decode(repeat('e8', 32), 'hex'),
      '2026-07-31T03:03:04.200Z'
    )
  $sql$,
  '23514',
  'dynamic source attestation cannot be reused across release scope'
);
select is(
  programmable_private.register_dynamic_source_attestation(
    '91210000-0000-0000-0000-000000000002',
    '93000000-0000-0000-0000-000000000001',
    '91200000-0000-0000-0000-000000000002',
    '96100000-0000-0000-0000-000000000003',
    decode(repeat('76', 20), 'hex'), 25639598,
    '91205000-0000-0000-0000-000000000002',
    decode(repeat('a4', 32), 'hex'),
    decode(repeat('c9', 32), 'hex'),
    decode(repeat('f6', 32), 'hex'),
    decode(repeat('b1', 32), 'hex'), decode(repeat('b2', 32), 'hex'),
    decode(repeat('c1', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
    2::smallint,
    decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000471', 'hex'),
    decode(repeat('cb', 32), 'hex'),
    decode(repeat('c4', 32), 'hex'), '2026-07-31T03:02:03.070Z'
  ),
  '91210000-0000-0000-0000-000000000002'::uuid,
  'vesting-wallet template decodes its pinned wallet field rather than vault'
);
select throws_ok(
  $sql$
    select programmable_private.append_dual_rpc_runtime_code_evidence(
      '91205000-0000-0000-0000-000000000003',
      '93000000-0000-0000-0000-000000000001',
      decode(repeat('79', 20), 'hex'),
      '95000000-0000-0000-0000-000000000600',
      '92000000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000002',
      decode(repeat('ca', 32), 'hex'), decode(repeat('cb', 32), 'hex'),
      decode(repeat('04', 6543), 'hex'), decode(repeat('04', 6543), 'hex'),
      6543, 6543,
      decode(repeat('d1', 32), 'hex'), decode(repeat('d1', 32), 'hex'),
      decode(repeat('df', 32), 'hex'),
      array[decode(repeat('79', 20), 'hex')],
      decode(repeat('c8', 32), 'hex'),
      decode(repeat('04', 6543), 'hex'),
      decode(repeat('ca', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000368', 'hex'),
      decode(repeat('cd', 32), 'hex'),
      decode(repeat('cc', 32), 'hex'), '2026-07-31T03:03:04.300Z'
    )
  $sql$,
  '23514',
  'disagreeing RPC runtime code hashes cannot become deployment evidence'
);
select throws_ok(
  $sql$
    select programmable_private.append_dual_rpc_runtime_code_evidence(
      '91205000-0000-0000-0000-000000000004',
      '93000000-0000-0000-0000-000000000001',
      decode(repeat('79', 20), 'hex'),
      '95000000-0000-0000-0000-000000000600',
      '92000000-0000-0000-0000-000000000002',
      '92000000-0000-0000-0000-000000000001',
      decode(repeat('ca', 32), 'hex'), decode(repeat('ca', 32), 'hex'),
      decode(repeat('04', 6543), 'hex'), decode(repeat('04', 6543), 'hex'),
      6543, 6543,
      decode(repeat('d1', 32), 'hex'), decode(repeat('d1', 32), 'hex'),
      decode(repeat('df', 32), 'hex'),
      array[decode(repeat('79', 20), 'hex')],
      decode(repeat('c8', 32), 'hex'),
      decode(repeat('04', 6543), 'hex'),
      decode(repeat('ca', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000369', 'hex'),
      decode(repeat('ce', 32), 'hex'),
      decode(repeat('cc', 32), 'hex'), '2026-07-31T03:03:04.400Z'
    )
  $sql$,
  '23514',
  'runtime-code evidence must retain the exact ordered safe-head provider pair'
);

select ok(
  public.reward_test_dynamic_occurrence_provenance(),
  'dynamic vault occurrence retains exact attestation and neutral-candidate provenance'
);
select is(
  programmable_private.register_dynamic_source_attestation(
    '91210000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001',
    '91200000-0000-0000-0000-000000000001',
    '96100000-0000-0000-0000-000000000001',
    decode(repeat('77', 20), 'hex'), 25639600,
    '91205000-0000-0000-0000-000000000001',
    decode(repeat('a4', 32), 'hex'),
    decode(repeat('d9', 32), 'hex'),
    decode(repeat('f7', 32), 'hex'),
    decode(repeat('b3', 32), 'hex'), decode(repeat('b4', 32), 'hex'),
    decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
    2::smallint,
    decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000472', 'hex'),
    decode(repeat('db', 32), 'hex'),
    decode(repeat('d4', 32), 'hex'), '2026-07-31T03:02:03.100Z'
  ),
  '91210000-0000-0000-0000-000000000001'::uuid,
  'exact dynamic source attestation replay is idempotent'
);
select throws_ok(
  $sql$
    select programmable_private.register_dynamic_source_attestation(
      '91210000-0000-0000-0000-000000000008',
      '93000000-0000-0000-0000-000000000001',
      '91200000-0000-0000-0000-000000000001',
      '96100000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex'), 25639600,
      '91205000-0000-0000-0000-000000000001',
      decode(repeat('a4', 32), 'hex'),
      decode(repeat('d9', 32), 'hex'),
      decode(repeat('f7', 32), 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
      decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000478', 'hex'),
      decode(repeat('c5', 32), 'hex'),
      decode(repeat('e8', 32), 'hex'), '2026-07-31T03:03:04.500Z'
    )
  $sql$,
  '23514',
  'dynamic instance init code cannot equal its release artifact creation code'
);
select throws_ok(
  $sql$
    select programmable_private.register_dynamic_source_attestation(
      '91210000-0000-0000-0000-000000000002',
      '93000000-0000-0000-0000-000000000001',
      '91200000-0000-0000-0000-000000000001',
      '96100000-0000-0000-0000-000000000001',
      decode(repeat('78', 20), 'hex'), 25639600,
      '91205000-0000-0000-0000-000000000001',
      decode(repeat('a4', 32), 'hex'),
      decode(repeat('d9', 32), 'hex'),
      decode(repeat('f7', 32), 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('b4', 32), 'hex'),
      decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000479', 'hex'),
      decode(repeat('c6', 32), 'hex'),
      decode(repeat('e1', 32), 'hex'), '2026-07-31T03:03:05Z'
    )
  $sql$,
  '23514',
  'forged emitted vault address cannot be attested'
);
select throws_ok(
  $sql$
    select programmable_private.register_dynamic_source_attestation(
      '91210000-0000-0000-0000-000000000003',
      '93000000-0000-0000-0000-000000000001',
      '91200000-0000-0000-0000-000000000001',
      '96100000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex'), 25639600,
      '91205000-0000-0000-0000-000000000001',
      decode(repeat('a4', 32), 'hex'),
      decode(repeat('d9', 32), 'hex'),
      decode(repeat('f7', 32), 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('b4', 32), 'hex'),
      decode(repeat('e2', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200047a', 'hex'),
      decode(repeat('c7', 32), 'hex'),
      decode(repeat('e3', 32), 'hex'), '2026-07-31T03:03:06Z'
    )
  $sql$,
  '23514',
  'wrong dynamic runtime code hash is rejected'
);
select throws_ok(
  $sql$
    select programmable_private.register_dynamic_source_attestation(
      '91210000-0000-0000-0000-000000000004',
      '93000000-0000-0000-0000-000000000001',
      '91200000-0000-0000-0000-000000000001',
      '96100000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex'), 25639600,
      '91205000-0000-0000-0000-000000000001',
      decode(repeat('a4', 32), 'hex'),
      decode(repeat('d9', 32), 'hex'),
      decode(repeat('f7', 32), 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('b4', 32), 'hex'),
      decode(repeat('d1', 32), 'hex'), decode(repeat('e4', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200047b', 'hex'),
      decode(repeat('c8', 32), 'hex'),
      decode(repeat('e5', 32), 'hex'), '2026-07-31T03:03:07Z'
    )
  $sql$,
  '23514',
  'wrong dynamic ABI event-set commitment is rejected'
);
select throws_ok(
  $sql$
    select programmable_private.register_dynamic_source_attestation(
      '91210000-0000-0000-0000-000000000005',
      '93000000-0000-0000-0000-000000000001',
      '91200000-0000-0000-0000-000000000001',
      '96100000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex'), 25639599,
      '91205000-0000-0000-0000-000000000001',
      decode(repeat('a4', 32), 'hex'),
      decode(repeat('d9', 32), 'hex'),
      decode(repeat('f7', 32), 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('b4', 32), 'hex'),
      decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200047c', 'hex'),
      decode(repeat('c9', 32), 'hex'),
      decode(repeat('e6', 32), 'hex'), '2026-07-31T03:03:08Z'
    )
  $sql$,
  '23514',
  'dynamic source cannot start before its factory deployment occurrence'
);
select throws_ok(
  $sql$
    select programmable_private.register_dynamic_source_attestation(
      '91210000-0000-0000-0000-000000000006',
      '93000000-0000-0000-0000-000000000001',
      '91200000-0000-0000-0000-000000000001',
      '96100000-0000-0000-0000-000000000003',
      decode(repeat('77', 20), 'hex'), 25639598,
      '91205000-0000-0000-0000-000000000001',
      decode(repeat('a4', 32), 'hex'),
      decode(repeat('d9', 32), 'hex'),
      decode(repeat('f7', 32), 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('b4', 32), 'hex'),
      decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200047d', 'hex'),
      decode(repeat('ca', 32), 'hex'),
      decode(repeat('e7', 32), 'hex'), '2026-07-31T03:03:09Z'
    )
  $sql$,
  '23503',
  'wrong factory role and event cannot register a dynamic source'
);
select throws_ok(
  $sql$
    select programmable_private.register_dynamic_source_attestation(
      '91210000-0000-0000-0000-000000000009',
      '93000000-0000-0000-0000-000000000001',
      '91200000-0000-0000-0000-000000000001',
      '96100000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex'), 25639600,
      '91205000-0000-0000-0000-000000000001',
      decode(repeat('a4', 32), 'hex'),
      decode(repeat('d9', 32), 'hex'),
      decode(repeat('f7', 32), 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('b4', 32), 'hex'),
      decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200047e', 'hex'),
      decode(repeat('cc', 32), 'hex'),
      decode(repeat('e9', 32), 'hex'), '2026-07-31T03:03:10Z'
    )
  $sql$,
  '23505',
  'same dynamic address cannot replay with a different identity or commitment'
);
select throws_ok(
  $sql$
    select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14),
  '910c0000-0000-0000-0000-000000000001',
  25639600,
  decode(repeat('99', 32), 'hex'),
  decode(repeat('87', 32), 'hex'),
  5,
  14,
  decode(repeat('77', 20), 'hex'),
  decode(repeat('d5', 32), 'hex'),
  'BeneficiaryFeesClaimed',
  array[decode(repeat('d5', 32), 'hex')],
  decode('0105', 'hex'),
  '{"releaseVersion":"unresolved"}'::jsonb,
  decode(repeat('d6', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('d7', 32), 'hex'),
  '2026-07-31T03:03:11Z'
)
  $sql$,
  '23505',
  'neutral candidate replay conflict cannot overwrite raw evidence'
);
select throws_ok(
  $sql$
    select programmable_private.resolve_envio_candidate(
      '91220000-0000-0000-0000-000000000002',
      '93000000-0000-0000-0000-000000000001',
      programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14), null,
      '91210000-0000-0000-0000-000000000001',
      decode(repeat('d2', 32), 'hex'), decode(repeat('ea', 32), 'hex'),
      '2026-07-31T03:03:12Z'
    )
  $sql$,
  '23505',
  'conflicting later resolution cannot replace an audited association'
);
select throws_ok(
  'select public.reward_test_orphaned_dynamic_resolution()',
  '23514',
  'orphaning the factory occurrence immediately revokes dynamic admission'
);
select throws_ok(
  $sql$
    select programmable_private.append_chain_event_occurrence(
      '91230000-0000-0000-0000-000000000001',
      '91240000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000001',
      programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14),
      '91220000-0000-0000-0000-000000000001',
      3, '2026-07-31T02:58:37Z', 'decoder-v1',
      decode(repeat('e8', 32), 'hex'),
      '95000000-0000-0000-0000-000000000600', 1::smallint,
      decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310055', 'hex'),
      decode(repeat('d9', 32), 'hex'), '2026-07-31T03:02:03.400Z'
    )
  $sql$,
  '23503',
  'dynamic occurrence cannot cross-use a resolution under the wrong ABI'
);

select ok(
  not exists (
    with projection_tables(table_name) as (
      values
        ('launch_projections'), ('pool_projections'),
        ('pool_fee_configurations'), ('fee_accrual_facts'),
        ('pool_fee_totals'), ('reward_vault_projections'),
        ('reward_allocation_projections'), ('claim_projections'),
        ('payout_change_projections'), ('account_reward_balances'),
        ('initial_buy_custody_projections'),
        ('initial_buy_vesting_projections')
    )
    select 1
    from projection_tables as expected
    where exists (
      select required.column_name
      from (
        values ('chain_id'), ('release_id'), ('model_id'), ('epoch_id'),
               ('pointer_generation'), ('projection_run_id'),
               ('promoted_block_number'), ('promoted_block_hash'),
               ('verified_at')
      ) as required(column_name)
      where not exists (
        select 1
        from pg_catalog.pg_attribute as attribute
        join pg_catalog.pg_class as relation
          on relation.oid = attribute.attrelid
        join pg_catalog.pg_namespace as namespace
          on namespace.oid = relation.relnamespace
        where namespace.nspname = 'programmable_private'
          and relation.relname = expected.table_name
          and attribute.attname = required.column_name
          and attribute.attnum > 0
          and not attribute.attisdropped
      )
    )
    or not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as relation
        on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'programmable_private'
        and relation.relname = expected.table_name
        and attribute.attname in (
          'last_source_logical_event_id', 'source_logical_event_id',
          'disclosure_source_logical_event_id'
        )
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
    or not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as relation
        on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'programmable_private'
        and relation.relname = expected.table_name
        and attribute.attname in (
          'last_source_occurrence_block_hash',
          'source_occurrence_block_hash',
          'disclosure_source_occurrence_block_hash'
        )
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
  ),
  'every normalized projection carries exact release source run target and verification provenance'
);

select is(
  public.reward_test_evidence_recovery_binding(),
  '91100000-0000-0000-0000-000000000005'::uuid,
  'coordinator calldata evidence resolves the exact manifest address and selector binding'
);

select is(
  programmable_private.append_reward_allocation_fact(
    '98000000-0000-0000-0000-000000000001',
    '97000000-0000-0000-0000-000000000002',
    decode(repeat('77', 20), 'hex'),
    '96100000-0000-0000-0000-000000000001',
    array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
    array[6000::numeric, 4000::numeric],
    decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
    decode(repeat('a3', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
    array[
      '96100000-0000-0000-0000-000000000002'::uuid,
      '96100000-0000-0000-0000-000000000001'::uuid,
      '96100000-0000-0000-0000-000000000004'::uuid
    ],
    array['launcher', 'vault_factory', 'hook']::text[],
    1::smallint,
    public.reward_test_allocation_preimage(),
    decode('760efbc9872c2018c892290c30ca097f4b346240b30c766a22c20568bf4d14f0', 'hex'),
    '2026-07-31T03:03:02Z'
  ),
  '98000000-0000-0000-0000-000000000001'::uuid,
  'exact allocation fact replay is idempotent'
);
select is(
  programmable_private.append_reward_allocation_evidence(
    '98100000-0000-0000-0000-000000000001',
    '98000000-0000-0000-0000-000000000001',
    '97000000-0000-0000-0000-000000000002',
    'launcher_calldata', 'seed-verifier-v1.0.0',
    decode(repeat('31', 20), 'hex'), decode('bf388406', 'hex'),
    decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
    decode(repeat('77', 20), 'hex'), 'unavailable',
    null, null, null, null, null,
    null, null,
    decode(repeat('a2', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
    decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
    1::smallint,
    public.reward_test_evidence_preimage(),
    decode('db14c9fa42eaedfcf77221edc2861e7f2c0251997313951d7a06c65ca73beea3', 'hex'),
    '2026-07-31T03:03:03Z',
    decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
    decode(repeat('a3', 32), 'hex')
  ),
  '98100000-0000-0000-0000-000000000001'::uuid,
  'exact evidence replay is idempotent'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_evidence(
      '98100000-0000-0000-0000-000000000001',
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      'launcher_calldata', 'seed-verifier-v1.0.0',
      decode(repeat('31', 20), 'hex'), decode('bf388406', 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), 'unavailable',
      null, null, null, null, null,
      null, null,
      decode(repeat('a2', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
      decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
      1::smallint,
      public.reward_test_evidence_preimage(),
      decode('db14c9fa42eaedfcf77221edc2861e7f2c0251997313951d7a06c65ca73beea3', 'hex'),
      '2026-07-31T03:03:03Z'
    )
  $sql$,
  '23505',
  'an attested evidence row cannot replay without the immutable recomputation proof'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_fact(
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      decode(repeat('77', 20), 'hex'),
      '96100000-0000-0000-0000-000000000001',
      array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
      array[6000::numeric, 4000::numeric],
      decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
      decode(repeat('a3', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
      array[
        '96100000-0000-0000-0000-000000000002'::uuid,
        '96100000-0000-0000-0000-000000000001'::uuid,
        '96100000-0000-0000-0000-000000000004'::uuid
      ],
      array['launcher', 'vault_factory', 'hook']::text[],
      1::smallint,
      public.reward_test_allocation_preimage() || decode('01', 'hex'),
      decode('760efbc9872c2018c892290c30ca097f4b346240b30c766a22c20568bf4d14f0', 'hex'),
      '2026-07-31T03:03:02Z'
    )
  $sql$,
  '23505',
  'changed allocation preimage with original digest is rejected'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_fact(
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      decode(repeat('77', 20), 'hex'),
      '96100000-0000-0000-0000-000000000001',
      array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
      array[6000::numeric, 4000::numeric],
      decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
      decode(repeat('a3', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
      array[
        '96100000-0000-0000-0000-000000000002'::uuid,
        '96100000-0000-0000-0000-000000000001'::uuid,
        '96100000-0000-0000-0000-000000000004'::uuid
      ],
      array['launcher', 'vault_factory', 'hook']::text[],
      1::smallint,
      public.reward_test_allocation_preimage(),
      decode(repeat('fd', 32), 'hex'),
      '2026-07-31T03:03:02Z'
    )
  $sql$,
  '23505',
  'original allocation preimage with changed digest is rejected'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_fact(
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      decode(repeat('77', 20), 'hex'),
      '96100000-0000-0000-0000-000000000001',
      array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
      array[6000::numeric, 4000::numeric],
      decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
      decode(repeat('a3', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
      array[
        '96100000-0000-0000-0000-000000000002'::uuid,
        '96100000-0000-0000-0000-000000000001'::uuid,
        '96100000-0000-0000-0000-000000000004'::uuid
      ],
      array['launcher', 'vault_factory', 'hook']::text[],
      1::smallint,
      public.reward_test_allocation_preimage() || decode('02', 'hex'),
      decode(repeat('fc', 32), 'hex'),
      '2026-07-31T03:03:02Z'
    )
  $sql$,
  '23505',
  'changed allocation preimage and digest are rejected together'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_evidence(
      '98100000-0000-0000-0000-000000000001',
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      'launcher_calldata', 'seed-verifier-v1.0.0',
      decode(repeat('b2', 20), 'hex'), decode('bf388406', 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), 'unavailable',
      null, null, null, null, null,
      null, null,
      decode(repeat('b7', 32), 'hex'), decode(repeat('b7', 32), 'hex'),
      decode(repeat('b8', 32), 'hex'), decode(repeat('b8', 32), 'hex'),
      1::smallint,
      public.reward_test_evidence_preimage(),
      decode(repeat('ff', 32), 'hex'), '2026-07-31T03:03:03Z'
    )
  $sql$,
  '23505',
  'original evidence preimage with changed digest is rejected'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_evidence(
      '98100000-0000-0000-0000-000000000001',
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      'launcher_calldata', 'seed-verifier-v1.0.0',
      decode(repeat('b2', 20), 'hex'), decode('bf388406', 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), 'unavailable',
      null, null, null, null, null,
      null, null,
      decode(repeat('b7', 32), 'hex'), decode(repeat('b7', 32), 'hex'),
      decode(repeat('b8', 32), 'hex'), decode(repeat('b8', 32), 'hex'),
      1::smallint,
      public.reward_test_evidence_preimage() || decode('01', 'hex'),
      decode('db14c9fa42eaedfcf77221edc2861e7f2c0251997313951d7a06c65ca73beea3', 'hex'),
      '2026-07-31T03:03:03Z'
    )
  $sql$,
  '23505',
  'changed evidence preimage with original digest is rejected'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_evidence(
      '98100000-0000-0000-0000-000000000001',
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      'launcher_calldata', 'seed-verifier-v1.0.0',
      decode(repeat('b2', 20), 'hex'), decode('bf388406', 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), 'unavailable',
      null, null, null, null, null,
      null, null,
      decode(repeat('b7', 32), 'hex'), decode(repeat('b7', 32), 'hex'),
      decode(repeat('b8', 32), 'hex'), decode(repeat('b8', 32), 'hex'),
      1::smallint,
      public.reward_test_evidence_preimage() || decode('02', 'hex'),
      decode(repeat('fe', 32), 'hex'), '2026-07-31T03:03:03Z'
    )
  $sql$,
  '23505',
  'changed evidence preimage and digest are rejected together'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_fact(
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      decode(repeat('77', 20), 'hex'),
      '96100000-0000-0000-0000-000000000001',
      array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
      array[6000::numeric, 4000::numeric],
      decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
      decode(repeat('a3', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
      array[
        '96100000-0000-0000-0000-000000000004'::uuid,
        '96100000-0000-0000-0000-000000000003'::uuid,
        '96100000-0000-0000-0000-000000000002'::uuid
      ],
      array['launcher', 'vault_factory', 'hook']::text[],
      1::smallint,
      public.reward_test_allocation_preimage(),
      decode('760efbc9872c2018c892290c30ca097f4b346240b30c766a22c20568bf4d14f0', 'hex'),
      '2026-07-31T03:03:02Z'
    )
  $sql$,
  '23505',
  'reordered required occurrences cannot replay the fixed allocation vector'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_fact(
      '98000000-0000-0000-0000-000000000002',
      '97000000-0000-0000-0000-000000000002',
      decode(repeat('78', 20), 'hex'),
      '96100000-0000-0000-0000-000000000001',
      array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
      array[6000.5::numeric, 3999.5::numeric],
      decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
      decode(repeat('d3', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
      array['96100000-0000-0000-0000-000000000001'::uuid],
      array['factory']::text[], 1::smallint,
      decode('70726f6772616d6d61626c653a616c6c6f636174696f6e3a76310070', 'hex'),
      decode(repeat('d4', 32), 'hex'), '2026-07-31T03:03:07Z'
    )
  $sql$,
  '22023',
  'fractional beneficiary shares abort before domain assignment'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_fact(
      '98000000-0000-0000-0000-000000000003',
      '97000000-0000-0000-0000-000000000002',
      decode(repeat('79', 20), 'hex'),
      '96100000-0000-0000-0000-000000000001',
      array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
      array[6000::numeric, 4000::numeric],
      decode(repeat('d5', 32), 'hex'), decode(repeat('d6', 32), 'hex'),
      decode(repeat('d7', 32), 'hex'), decode(repeat('ff', 32), 'hex'),
      array['96100000-0000-0000-0000-000000000001'::uuid],
      array['factory']::text[], 1::smallint,
      decode('70726f6772616d6d61626c653a616c6c6f636174696f6e3a76310071', 'hex'),
      decode(repeat('d8', 32), 'hex'), '2026-07-31T03:03:08Z'
    )
  $sql$,
  '23514',
  'allocation fact rejects a mismatched release artifact commitment'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_fact(
      '98000000-0000-0000-0000-000000000004',
      '97000000-0000-0000-0000-000000000002',
      decode(repeat('7a', 20), 'hex'),
      '96100000-0000-0000-0000-000000000001',
      array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
      array[6000::numeric, 4000::numeric],
      decode(repeat('d9', 32), 'hex'), decode(repeat('da', 32), 'hex'),
      decode(repeat('db', 32), 'hex'), decode(repeat('a4', 32), 'hex'),
      array['96100000-0000-0000-0000-000000000003'::uuid],
      array['factory']::text[], 1::smallint,
      decode('70726f6772616d6d61626c653a616c6c6f636174696f6e3a76310072', 'hex'),
      decode(repeat('dc', 32), 'hex'), '2026-07-31T03:03:08.500Z'
    )
  $sql$,
  '23514',
  'allocation fact requires the complete ordered launcher factory and hook set'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_evidence(
      '98100000-0000-0000-0000-000000000009',
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      'launcher_calldata', 'malformed-local-init-code',
      decode(repeat('b2', 20), 'hex'), decode('bf388406', 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'),
      decode(repeat('b4', 31), 'hex'), decode(repeat('c2', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), 'unavailable',
      null, null, null, null, null,
      null, null,
      decode(repeat('b7', 32), 'hex'), decode(repeat('b7', 32), 'hex'),
      decode(repeat('b8', 32), 'hex'), decode(repeat('b8', 32), 'hex'),
      1::smallint,
      decode('70726f6772616d6d61626c653a65766964656e63653a76310071', 'hex'),
      decode(repeat('d9', 32), 'hex'), '2026-07-31T03:03:08Z'
    )
  $sql$,
  '22023',
  'per-instance init-code evidence must be an exact bytes32 without equating it to the release artifact'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_evidence(
      '98100000-0000-0000-0000-000000000010',
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      'launcher_calldata', 'invalid-enrichment',
      decode(repeat('b2', 20), 'hex'), decode('bf388406', 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), 'unavailable',
      decode(repeat('99', 32), 'hex'), null, null, null, null,
      null, null,
      decode(repeat('b7', 32), 'hex'), decode(repeat('b7', 32), 'hex'),
      decode(repeat('b8', 32), 'hex'), decode(repeat('b8', 32), 'hex'),
      1::smallint,
      decode('70726f6772616d6d61626c653a65766964656e63653a76310072', 'hex'),
      decode(repeat('da', 32), 'hex'), '2026-07-31T03:03:09Z'
    )
  $sql$,
  '23514',
  'unavailable enrichment rejects every served getter or prediction field'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_allocation_evidence(
      '98100000-0000-0000-0000-000000000011',
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      'historical_getters', 'incomplete-history',
      null, null, null, decode(repeat('c0', 32), 'hex'),
  decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), 'matched',
      decode(repeat('99', 32), 'hex'),
      decode(repeat('b5', 32), 'hex'), decode(repeat('b5', 32), 'hex'),
      null, null,
      decode(repeat('77', 20), 'hex'), decode(repeat('77', 20), 'hex'),
      decode(repeat('b7', 32), 'hex'), decode(repeat('b7', 32), 'hex'),
      null, null, 1::smallint,
      decode('70726f6772616d6d61626c653a65766964656e63653a76310073', 'hex'),
      decode(repeat('db', 32), 'hex'), '2026-07-31T03:03:10Z'
    )
  $sql$,
  '23514',
  'historical getters require complete paired getter and prediction results'
);
select throws_ok(
  $sql$
    select public.reward_test_quarantine_then_rollback($call$
    select programmable_private.append_reward_allocation_evidence(
      '98100000-0000-0000-0000-000000000012',
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      'launcher_calldata', 'wrong-getter-block',
      decode(repeat('b2', 20), 'hex'), decode('bf388406', 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), 'matched',
      decode(repeat('98', 32), 'hex'),
      decode(repeat('b5', 32), 'hex'), decode(repeat('b5', 32), 'hex'),
      decode(repeat('b6', 32), 'hex'), decode(repeat('b6', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), decode(repeat('77', 20), 'hex'),
      decode(repeat('b7', 32), 'hex'), decode(repeat('b7', 32), 'hex'),
      decode(repeat('b8', 32), 'hex'), decode(repeat('b8', 32), 'hex'),
      1::smallint,
      decode('70726f6772616d6d61626c653a65766964656e63653a76310074', 'hex'),
      decode(repeat('dc', 32), 'hex'), '2026-07-31T03:03:11Z'
    )
    $call$, '98100000-0000-0000-0000-000000000012')
  $sql$,
  'P0001',
  'wrong-block historical evidence is quarantined and the fixture rolls back'
);
select throws_ok(
  $sql$
    select public.reward_test_quarantine_then_rollback($call$
    select programmable_private.append_reward_allocation_evidence(
      '98100000-0000-0000-0000-000000000015',
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      'historical_getters', 'wrong-provider-prediction',
      null, null, null, decode(repeat('c0', 32), 'hex'),
  decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), 'matched',
      decode(repeat('99', 32), 'hex'),
      decode(repeat('b5', 32), 'hex'), decode(repeat('b5', 32), 'hex'),
      decode(repeat('b6', 32), 'hex'), decode(repeat('b6', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), decode(repeat('76', 20), 'hex'),
      decode(repeat('b7', 32), 'hex'), decode(repeat('b7', 32), 'hex'),
      null, null, 1::smallint,
      decode('70726f6772616d6d61626c653a65766964656e63653a76310075', 'hex'),
      decode(repeat('dd', 32), 'hex'), '2026-07-31T03:03:12Z'
    )
    $call$, '98100000-0000-0000-0000-000000000015')
  $sql$,
  'P0001',
  'contradictory provider predictions are quarantined and the fixture rolls back'
);
select throws_ok(
  $sql$
    select public.reward_test_quarantine_then_rollback($call$
    select programmable_private.append_reward_allocation_evidence(
      '98100000-0000-0000-0000-000000000013',
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      'launcher_calldata', 'wrong-create2',
      decode(repeat('b2', 20), 'hex'), decode('bf388406', 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
      decode(repeat('76', 20), 'hex'), 'unavailable',
      null, null, null, null, null,
      null, null,
      decode(repeat('b7', 32), 'hex'), decode(repeat('b7', 32), 'hex'),
      decode(repeat('b8', 32), 'hex'), decode(repeat('b8', 32), 'hex'),
      1::smallint,
      decode('70726f6772616d6d61626c653a65766964656e63653a76310075', 'hex'),
      decode(repeat('dd', 32), 'hex'), '2026-07-31T03:03:12Z'
    )
    $call$, '98100000-0000-0000-0000-000000000013')
  $sql$,
  'P0001',
  'contradictory CREATE2 addresses are quarantined and the fixture rolls back'
);
select throws_ok(
  $sql$
    select public.reward_test_quarantine_then_rollback($call$
    select programmable_private.append_reward_allocation_evidence(
      '98100000-0000-0000-0000-000000000014',
      '98000000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      'launcher_calldata', 'rpc-disagreement',
      decode(repeat('b2', 20), 'hex'), decode('bf388406', 'hex'),
      decode(repeat('b3', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
      decode(repeat('77', 20), 'hex'), 'unavailable',
      null, null, null, null, null,
      null, null,
      decode(repeat('b7', 32), 'hex'), decode(repeat('b6', 32), 'hex'),
      decode(repeat('b8', 32), 'hex'), decode(repeat('b8', 32), 'hex'),
      1::smallint,
      decode('70726f6772616d6d61626c653a65766964656e63653a76310076', 'hex'),
      decode(repeat('de', 32), 'hex'), '2026-07-31T03:03:13Z'
    )
    $call$, '98100000-0000-0000-0000-000000000014')
  $sql$,
  'P0001',
  'selected-authority RPC disagreement is quarantined and the fixture rolls back'
);
select throws_ok(
  $sql$
    select programmable_private.stage_account_reward_balance(
      '98200000-0000-0000-0000-000000000002',
      '97000000-0000-0000-0000-000000000002',
      decode(repeat('11', 20), 'hex'), decode(repeat('77', 20), 'hex'),
      0.1, 0,
      '96100000-0000-0000-0000-000000000001',
      25639600, decode(repeat('99', 32), 'hex'),
      '2026-07-31T03:03:14Z'
    )
  $sql$,
  '22003',
  'fractional projected reward totals are rejected before insert'
);
select throws_ok(
  $sql$
    select programmable_private.stage_pool_fee_configuration(
      '98230000-0000-0000-0000-000000000002',
      '97110000-0000-0000-0000-000000000002',
      '97000000-0000-0000-0000-000000000002',
      0.1, 40, 200, 100, 0, 3000,
      '96100000-0000-0000-0000-000000000001',
      25639600, decode(repeat('99', 32), 'hex'),
      '2026-07-31T03:03:14.100Z'
    )
  $sql$,
  '23514',
  'fractional fee basis points abort before the integer domain can round them'
);

reset role;

select is(
  (select count(*) from programmable_private.reward_allocation_facts),
  1::bigint,
  'failed allocation attempts leave the one fixed fact'
);
select is(
  (select count(*) from programmable_private.reward_allocation_evidence),
  4::bigint,
  'only release-bound calldata and complete historical evidence survive'
);
select is(
  (
    select encode(canonical_preimage, 'hex')
    from programmable_private.reward_allocation_facts
    where allocation_fact_id = '98000000-0000-0000-0000-000000000001'
  ),
  '70726f6772616d6d61626c653a616c6c6f636174696f6e3a76310000000000000000010000000a636c61737369632d76330000000a636c61737369632d7633777777777777777777777777777777777777777788888888888888888888888888888888888888888888888888888888888888880000000299999999999999999999999999999999999999999999999999999999999999990000000001873ab00000000400000002111111111111111111111111111111111111111122222222222222222222222222222222222222220000000217700fa0a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a201a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a400000003a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a500000001a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6000000086c61756e63686572a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a700000001a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a800000007666163746f7279a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a900000001aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00000004686f6f6b',
  'SQL stores the reviewed allocation preimage byte-for-byte'
);
select is(
  (
    select encode(content_fingerprint, 'hex')
    from programmable_private.reward_allocation_evidence
    where allocation_evidence_id = '98100000-0000-0000-0000-000000000001'
  ),
  'db14c9fa42eaedfcf77221edc2861e7f2c0251997313951d7a06c65ca73beea3',
  'SQL stores the reviewed evidence Keccak digest byte-for-byte'
);
select is(
  programmable_private.validate_uint256(
    115792089237316195423570985008687907853269984665640564039457584007913129639935
  ),
  115792089237316195423570985008687907853269984665640564039457584007913129639935::numeric,
  'maximum uint256 validation remains exact without poisoning a live baseline'
);
select is(
  (
    with value(amount) as (
      values (999999999999999999999999999999::numeric)
    )
    select amount
      - pg_catalog.div(amount * 6000, 10000)
      - pg_catalog.div(amount * 4000, 10000)
    from value
  ),
  1::numeric,
  'beneficiary floor allocation preserves an exact one-unit remainder'
);
select is(
  (
    select
      (select count(*) from programmable_private.pool_fee_configurations)
      + (select count(*) from programmable_private.fee_accrual_facts)
      + (select count(*) from programmable_private.pool_fee_totals)
      + (select count(*) from programmable_private.claim_projections)
      + (select count(*) from programmable_private.payout_change_projections)
      + (select count(*) from programmable_private.initial_buy_custody_projections)
      + (select count(*) from programmable_private.initial_buy_vesting_projections)
  ),
  8::bigint,
  'all dedicated fee claim payout custody and vesting writers persist typed rows'
);
select is(
  (
    select count(*)
    from programmable_private.mutation_audits
    where action in (
      'pool_fee_configuration.stage', 'fee_accrual.stage',
      'pool_fee_total.stage', 'claim_projection.stage',
      'payout_change_projection.stage', 'initial_buy_custody.stage',
      'initial_buy_vesting.stage'
    )
  ),
  8::bigint,
  'every dedicated projection writer appends its mutation audit'
);

set local role programmable_projector;

select throws_ok(
  $sql$
    select programmable_private.append_reward_seed_status(
      '98300000-0000-0000-0000-000000000001',
      '98000000-0000-0000-0000-000000000001',
      '98100000-0000-0000-0000-000000000001',
      'verified', decode(repeat('e1', 32), 'hex'),
      '97000000-0000-0000-0000-000000000002',
      '2026-07-31T03:03:15Z'
    )
  $sql$,
  '42501',
  'append-only seed status cannot bypass promotion to verify a seed'
);
select throws_ok(
  $sql$
    select programmable_private.promote_projection_run(
      '97200000-0000-0000-0000-000000000020',
      '97300000-0000-0000-0000-000000000020',
      '97400000-0000-0000-0000-000000000020',
      '97000000-0000-0000-0000-000000000002',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'), 1, 2, 0,
      '94000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000600',
      25639600, decode(repeat('99', 32), 'hex'),
      20,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20
      ),
      array[
        '96100000-0000-0000-0000-000000000002'::uuid,
        '96100000-0000-0000-0000-000000000001'::uuid,
        '96100000-0000-0000-0000-000000000003'::uuid,
        '96100000-0000-0000-0000-000000000004'::uuid
      ],
      array['98000000-0000-0000-0000-000000000001'::uuid],
      array['98100000-0000-0000-0000-000000000001'::uuid],
      array[
        '91220000-0000-0000-0000-000000000001'::uuid,
        '91220000-0000-0000-0000-000000000002'::uuid,
        '91220000-0000-0000-0000-000000000003'::uuid,
        '91220000-0000-0000-0000-000000000020'::uuid
      ],
      array['explore-list']::text[], decode(repeat('e8', 32), 'hex'),
      '2026-07-31T03:03:15.100Z'
    )
  $sql$,
  '22023',
  'promotion rejects a non-canonical occurrence fold order before mutation'
);
select throws_ok(
  $sql$
    select programmable_private.promote_projection_run(
      '97200000-0000-0000-0000-000000000021',
      '97300000-0000-0000-0000-000000000021',
      '97400000-0000-0000-0000-000000000021',
      '97000000-0000-0000-0000-000000000002',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'), 1, 2, 0,
      '94000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000600',
      25639600, decode(repeat('99', 32), 'hex'),
      20,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20
      ),
      array[
        '96100000-0000-0000-0000-000000000001'::uuid,
        '96100000-0000-0000-0000-000000000003'::uuid,
        '96100000-0000-0000-0000-000000000004'::uuid
      ],
      array['98000000-0000-0000-0000-000000000001'::uuid],
      array['98100000-0000-0000-0000-000000000001'::uuid],
      array[
        '91220000-0000-0000-0000-000000000001'::uuid,
        '91220000-0000-0000-0000-000000000002'::uuid,
        '91220000-0000-0000-0000-000000000003'::uuid,
        '91220000-0000-0000-0000-000000000020'::uuid
      ],
      array['explore-list']::text[], decode(repeat('e8', 32), 'hex'),
      '2026-07-31T03:03:15.200Z'
    )
  $sql$,
  '23514',
  'promotion rejects a fold that omits any staged projection source'
);
select programmable_private.promote_projection_run(
  '97200000-0000-0000-0000-000000000002',
  '97300000-0000-0000-0000-000000000002',
  '97400000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000002',
  'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
  1, 2, 0,
  '94000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000600',
  25639600, decode(repeat('99', 32), 'hex'),
  20,
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20
  ),
  array[
    '91240000-0000-0000-0000-000000000002'::uuid,
    '91240000-0000-0000-0000-000000000003'::uuid,
    '96100000-0000-0000-0000-000000000001'::uuid,
    '96100000-0000-0000-0000-000000000002'::uuid,
    '96100000-0000-0000-0000-000000000003'::uuid,
    '96100000-0000-0000-0000-000000000004'::uuid
  ],
  array['98000000-0000-0000-0000-000000000001'::uuid],
  array['98100000-0000-0000-0000-000000000001'::uuid],
  array[
    '91220000-0000-0000-0000-000000000001'::uuid,
    '91220000-0000-0000-0000-000000000002'::uuid,
    '91220000-0000-0000-0000-000000000003'::uuid,
    '91220000-0000-0000-0000-000000000020'::uuid
  ],
  array['explore-list']::text[],
  decode(repeat('e2', 32), 'hex'), '2026-07-31T03:03:16Z'
);
select programmable_private.open_run(
  'a3100000-0000-0000-0000-000000000001',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('a3', 32), 'hex'),
  '2026-07-31T03:03:16.010Z'
);
select is(
  (
    select pg_catalog.count(*)
    from programmable_private.get_projector_reward_balances_by_vault_v1(
      'a3100000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex')
    )
  ),
  3::bigint,
  'all-current balance reader retains active and historical beneficiaries'
);
select ok(
  (
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(claimable_accrued = 7)
       and pg_catalog.bool_and(claimed_total = 5)
    from programmable_private.get_projector_reward_balances_by_vault_v1(
      'a3100000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex')
    )
    where account = decode(repeat('33', 20), 'hex')
  ),
  'historical beneficiary keeps nonzero claimable and claimed totals'
);
select is(
  (
    select pg_catalog.count(*)
    from programmable_private.get_projector_reward_state_by_vault_v1(
      'a3100000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex')
    )
  ),
  2::bigint,
  'active-allocation reader remains a separate two-beneficiary channel'
);
select is(
  (
    select pg_catalog.count(*)
    from programmable_private.get_projector_reward_state_by_vault_v1(
      'a3100000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex')
    )
    where beneficiary = decode(repeat('33', 20), 'hex')
  ),
  0::bigint,
  'historical beneficiary is not misrepresented as an active allocation'
);
select throws_ok(
  $sql$
    select public.reward_test_stale_reward_balance_reorg(
      'a3100000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex')
    )
  $sql$,
  '23514',
  'all-current balance reader rejects stale reorg generation bindings'
);
select programmable_private.append_run_outcome(
  'a3100000-0000-0000-0000-000000000002',
  'a3100000-0000-0000-0000-000000000001',
  'succeeded', decode(repeat('a4', 32), 'hex'),
  '2026-07-31T03:03:16.020Z'
);
select throws_ok(
  $sql$
    select programmable_private.append_creator_hook_claim_fact(
      '91600000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      '96100000-0000-0000-0000-000000000005',
      decode(repeat('73', 32), 'hex'), decode(repeat('77', 20), 'hex'),
      null, null, null, decode(repeat('72', 20), 'hex'), 10,
      '2026-07-31T03:03:00.100Z'
    )
  $sql$,
  '55000',
  'terminal projection runs reject creator-hook claim fact replays'
);
select throws_ok(
  $sql$
    select programmable_private.append_launcher_hook_claim_fact(
      '91600000-0000-0000-0000-000000000002',
      '97000000-0000-0000-0000-000000000002',
      '96100000-0000-0000-0000-000000000006',
      decode(repeat('31', 20), 'hex'), decode(repeat('32', 20), 'hex'),
      null, decode(repeat('33', 20), 'hex'), 20,
      '2026-07-31T03:03:00.200Z'
    )
  $sql$,
  '55000',
  'terminal projection runs reject launcher-hook claim fact replays'
);
reset role;

select is(
  (
    select ordered_projection_rows
    from programmable_private.projection_fold_manifests
    where run_id = '97000000-0000-0000-0000-000000000002'
      and projection_row_count = cardinality(ordered_projection_rows)
  ),
  array[
    'account_reward_balance:98200000-0000-0000-0000-000000000001',
    'account_reward_balance:98200000-0000-0000-0000-000000000003',
    'account_reward_balance:98200000-0000-0000-0000-000000000004',
    'claim:98260000-0000-0000-0000-000000000001',
    'fee_accrual:98240000-0000-0000-0000-000000000001',
    'initial_buy_custody:98280000-0000-0000-0000-000000000001',
    'initial_buy_vesting:98290000-0000-0000-0000-000000000001',
    'launch:97100000-0000-0000-0000-000000000002',
    'payout_change:98270000-0000-0000-0000-000000000001',
    'pool:97110000-0000-0000-0000-000000000002',
    'pool_fee_configuration:98230000-0000-0000-0000-000000000001',
    'pool_fee_total:98250000-0000-0000-0000-000000000001',
    'reward_allocation:98220000-0000-0000-0000-000000000001',
    'reward_allocation:98220000-0000-0000-0000-000000000002',
    'reward_vault:98210000-0000-0000-0000-000000000001'
  ]::text[],
  'promotion persists the complete canonically ordered typed projection fold'
);
select is(
  (
    select allocation_evidence_id
    from programmable_private.reward_allocation_current_verified
    where allocation_fact_id = '98000000-0000-0000-0000-000000000001'
  ),
  '98100000-0000-0000-0000-000000000001'::uuid,
  'promotion alone selects one verified allocation authority'
);
select is(
  (
    select transaction_index::bigint
    from programmable_private.chain_event_occurrences
    where occurrence_id = '96100000-0000-0000-0000-000000000001'
  ),
  4294967295::bigint,
  'full u32 transaction indexes survive candidate ingestion and occurrence materialization'
);
select is(
  (
    select receipt_log_ordinal::bigint
    from programmable_private.chain_event_occurrences
    where occurrence_id = '96100000-0000-0000-0000-000000000001'
  ),
  4294967295::bigint,
  'full u32 receipt ordinals survive candidate ingestion and occurrence materialization'
);
select is(
  (
    select launch_transaction_index
    from programmable_private.recent_launches_v1
    where token = decode(repeat('71', 20), 'hex')
  ),
  4294967295::bigint,
  'full u32 transaction indexes survive projection into the direct read model'
);
select is(
  (
    select launch_receipt_log_ordinal
    from programmable_private.recent_launches_v1
    where token = decode(repeat('71', 20), 'hex')
  ),
  4294967295::bigint,
  'full u32 receipt ordinals survive projection into the direct read model'
);
select is(
  (
    select status::text
    from programmable_private.route_eligibility_current
    where route_key = 'explore-list'
  ),
  'eligible',
  'verified seed publication leaves its named route eligible'
);

savepoint null_recomputation_contradiction;
set local role programmable_projector;
select programmable_private.open_run(
  '97900000-0000-0000-0000-000000000001',
  'ingestion', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v2', decode(repeat('79', 32), 'hex'),
  '2026-07-31T03:03:16.010Z'
);
select programmable_private.append_reward_allocation_evidence(
  '97910000-0000-0000-0000-000000000001',
  '98000000-0000-0000-0000-000000000001',
  '97900000-0000-0000-0000-000000000001',
  'launcher_calldata', 'later-contradiction-v1',
  decode(repeat('31', 20), 'hex'), decode('bf388406', 'hex'),
  decode(repeat('79', 32), 'hex'), decode(repeat('c0', 32), 'hex'),
  decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
  decode(repeat('77', 20), 'hex'), 'unavailable',
  null, null, null, null, null, null, null,
  decode(repeat('ff', 32), 'hex'), decode(repeat('ff', 32), 'hex'),
  decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
  1::smallint,
  decode('70726f6772616d6d61626c653a65766964656e63653a76310090', 'hex'),
  decode(repeat('90', 32), 'hex'), '2026-07-31T03:03:16.020Z'
);
reset role;
select is(
  (
    select count(*)
    from programmable_private.reward_allocation_current_verified
    where allocation_fact_id = '98000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'later contradictory evidence clears the exact verified allocation pointer even without recomputation fields'
);
select is(
  (
    select status::text
    from programmable_private.route_eligibility_current
    where route_key = 'explore-list'
      and epoch_id = '91000000-0000-0000-0000-000000000001'
      and pointer_generation = 1
  ),
  'quarantined',
  'later contradictory evidence quarantines the exact epoch-generation route'
);
select is(
  (
    select count(*)
    from programmable_private.reward_allocation_mismatch_evidence
    where mismatch_evidence_id = '97910000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'later contradiction is retained while non-attested legacy evidence remains non-promotable'
);
rollback to savepoint null_recomputation_contradiction;

-- A later publication is deliberately a delta: it stages a second launch and
-- fee total without restaging the first launch's reward-vault subtree.  Public
-- current reads must retain both independently published entity versions.
set local role programmable_projector;
select programmable_private.open_run(
  '97000000-0000-0000-0000-000000000005',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('65', 32), 'hex'),
  '2026-07-31T03:03:16.100Z'
);
select programmable_private.stage_launch_projection(
  '97100000-0000-0000-0000-000000000005',
  '97000000-0000-0000-0000-000000000005',
  decode(repeat('75', 20), 'hex'), decode(repeat('76', 20), 'hex'),
  decode(repeat('85', 32), 'hex'), decode(repeat('84', 32), 'hex'),
  null, decode(repeat('83', 32), 'hex'),
  'Delta Token', 'DELTA', 1000000000000000000,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:16.200Z'
);
select programmable_private.stage_pool_projection(
  '97110000-0000-0000-0000-000000000005',
  '97100000-0000-0000-0000-000000000005',
  '97000000-0000-0000-0000-000000000005',
  decode(repeat('00', 20), 'hex'), decode(repeat('75', 20), 'hex'),
  3000, 60, decode(repeat('39', 20), 'hex'),
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:16.300Z'
);
select programmable_private.stage_pool_fee_configuration(
  '97120000-0000-0000-0000-000000000005',
  '97110000-0000-0000-0000-000000000005',
  '97000000-0000-0000-0000-000000000005',
  30, 40, 20, 10, 0, 3000,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:16.400Z'
);
select programmable_private.stage_pool_fee_total(
  '98250000-0000-0000-0000-000000000005',
  '97000000-0000-0000-0000-000000000005',
  decode(repeat('84', 32), 'hex'), null,
  100, 60, 40,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:03:16.500Z'
);
select programmable_private.stage_launch_occurrence_role(
  '97100000-0000-0000-0000-000000000005', 'vault_factory',
  '96100000-0000-0000-0000-000000000001', '2026-07-31T03:03:16.510Z'
);
select programmable_private.stage_launch_projection_conditions(
  '97100000-0000-0000-0000-000000000005', false,
  '2026-07-31T03:03:16.520Z'
);
select programmable_private.promote_projection_run(
  '97200000-0000-0000-0000-000000000005',
  '97300000-0000-0000-0000-000000000005',
  '97400000-0000-0000-0000-000000000005',
  '97000000-0000-0000-0000-000000000005',
  'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
  2, 3, 0,
  '94000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000600',
  25639600, decode(repeat('99', 32), 'hex'),
  20,
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20
  ),
  array['96100000-0000-0000-0000-000000000001'::uuid],
  array[]::uuid[], array[]::uuid[], array[]::uuid[],
  array['explore-list']::text[],
  decode(repeat('e5', 32), 'hex'), '2026-07-31T03:03:16.600Z'
);

reset role;

select is(
  (select count(*) from programmable_private.recent_launches_v1),
  2::bigint,
  'delta publication retains the prior launch while adding the new launch'
);
select is(
  (
    select
      (select count(*) from programmable_private.current_reward_vault_projections_v1)
      + (select count(*) from programmable_private.current_account_reward_balances_v1)
      + (select count(*) from programmable_private.current_pool_fee_totals_v1)
  ),
  6::bigint,
  'delta publication retains prior reward pointers and both fee-total pointers'
);
set local role programmable_api_reader;
select is(
  (
    with first_page as (
      select *
      from programmable_private.get_recent_launches_v1(
        1, 1, null, null, null
      )
    ), second_page as (
      select page.*
      from first_page as cursor
      cross join lateral programmable_private.get_recent_launches_v1(
        1, 1, cursor.promoted_block_number,
        cursor.launch_transaction_hash, cursor.token
      ) as page
    ), paged as (
      select 1 as page_number, token from first_page
      union all
      select 2, token from second_page
    )
    select pg_catalog.array_agg(token order by page_number)
    from paged
  ),
  (
    select pg_catalog.array_agg(
      token order by promoted_block_number desc,
      launch_transaction_hash desc, token
    )
    from programmable_private.get_recent_launches_v1(
      1, 100, null, null, null
    )
  ),
  'composite cursor concatenates same-block pages without omission or duplication'
);
reset role;

-- Reward deltas may legitimately follow an unrelated launch publication.  The
-- staged snapshot binds the current global cursor while retaining the immutable
-- reward-vault entity identity, then promotion proves the exact per-beneficiary
-- transition for every event in the same vault transaction.
set local role programmable_projector;
select programmable_private.append_dual_rpc_block_evidence(
  '95000000-0000-0000-0000-000000000601',
  '94000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  25639601, decode(repeat('9a', 32), 'hex'), decode(repeat('9a', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000245', 'hex'),
  decode(repeat('46', 32), 'hex'), '2026-07-31T03:03:17.000Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  '95000000-0000-0000-0000-000000000602',
  '94000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  25639602, decode(repeat('9b', 32), 'hex'), decode(repeat('9b', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000246', 'hex'),
  decode(repeat('47', 32), 'hex'), '2026-07-31T03:03:17.010Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  '95000000-0000-0000-0000-000000000603',
  '94000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  25639603, decode(repeat('99', 32), 'hex'), decode(repeat('99', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000247', 'hex'),
  decode(repeat('48', 32), 'hex'), '2026-07-31T03:03:17.020Z'
);

select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 21
  ),
  '910c0000-0000-0000-0000-000000000001', 25639601,
  decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'),
  12, 21, decode(repeat('77', 20), 'hex'),
  decode(repeat('e6', 32), 'hex'), 'CreatorFeesCheckpointed',
  array[decode(repeat('e6', 32), 'hex')], decode('0201', 'hex'),
  '{"poolId":"0x7373737373737373737373737373737373737373737373737373737373737373","configurationEpoch":"1","amount":"100","totalCreatorFeesReceived":"1100"}'::jsonb,
  decode(repeat('e7', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 21
  ),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('e8', 32), 'hex'), '2026-07-31T03:03:17.100Z'
);
select programmable_private.resolve_envio_candidate(
  'a3210000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 21
  ), null, '91210000-0000-0000-0000-000000000001',
  decode(repeat('d2', 32), 'hex'), decode(repeat('e9', 32), 'hex'),
  '2026-07-31T03:03:17.110Z'
);
select programmable_private.append_chain_event_occurrence(
  'a3230000-0000-0000-0000-000000000001',
  'a3240000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 21
  ),
  'a3210000-0000-0000-0000-000000000001',
  0, '2026-07-31T02:58:41Z', 'decoder-v1',
  decode(repeat('d2', 32), 'hex'),
  '95000000-0000-0000-0000-000000000601', 1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310081', 'hex'),
  decode(repeat('f1', 32), 'hex'), '2026-07-31T03:03:17.120Z'
);

select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 22
  ),
  '910c0000-0000-0000-0000-000000000001', 25639601,
  decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'),
  12, 22, decode(repeat('77', 20), 'hex'),
  decode(repeat('ea', 32), 'hex'), 'BeneficiaryFeesClaimed',
  array[decode(repeat('ea', 32), 'hex')], decode('0202', 'hex'),
  '{"beneficiary":"0x1111111111111111111111111111111111111111","amount":"653","beneficiaryTotalClaimed":"653","vaultTotalReceived":"1100"}'::jsonb,
  decode(repeat('eb', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 22
  ),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('ec', 32), 'hex'), '2026-07-31T03:03:17.200Z'
);
select programmable_private.resolve_envio_candidate(
  'a3210000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 22
  ), null, '91210000-0000-0000-0000-000000000001',
  decode(repeat('d2', 32), 'hex'), decode(repeat('ed', 32), 'hex'),
  '2026-07-31T03:03:17.210Z'
);
select programmable_private.append_chain_event_occurrence(
  'a3230000-0000-0000-0000-000000000002',
  'a3240000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 22
  ),
  'a3210000-0000-0000-0000-000000000002',
  1, '2026-07-31T02:58:41Z', 'decoder-v1',
  decode(repeat('d2', 32), 'hex'),
  '95000000-0000-0000-0000-000000000601', 1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310082', 'hex'),
  decode(repeat('f2', 32), 'hex'), '2026-07-31T03:03:17.220Z'
);

select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'), 23
  ),
  '910c0000-0000-0000-0000-000000000001', 25639602,
  decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'),
  13, 23, decode(repeat('77', 20), 'hex'),
  decode(repeat('ee', 32), 'hex'), 'CreatorFeesCheckpointed',
  array[decode(repeat('ee', 32), 'hex')], decode('0203', 'hex'),
  '{"poolId":"0x7373737373737373737373737373737373737373737373737373737373737373","configurationEpoch":"1","amount":"100","totalCreatorFeesReceived":"1200"}'::jsonb,
  decode(repeat('ef', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'), 23
  ),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('f3', 32), 'hex'), '2026-07-31T03:03:17.300Z'
);
select programmable_private.resolve_envio_candidate(
  'a3310000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'), 23
  ), null, '91210000-0000-0000-0000-000000000001',
  decode(repeat('d2', 32), 'hex'), decode(repeat('f4', 32), 'hex'),
  '2026-07-31T03:03:17.310Z'
);
select programmable_private.append_chain_event_occurrence(
  'a3330000-0000-0000-0000-000000000001',
  'a3340000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'), 23
  ),
  'a3310000-0000-0000-0000-000000000001',
  0, '2026-07-31T02:58:42Z', 'decoder-v1',
  decode(repeat('d2', 32), 'hex'),
  '95000000-0000-0000-0000-000000000602', 1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310083', 'hex'),
  decode(repeat('f5', 32), 'hex'), '2026-07-31T03:03:17.320Z'
);

select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'), 24
  ),
  '910c0000-0000-0000-0000-000000000001', 25639602,
  decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'),
  13, 24, decode(repeat('77', 20), 'hex'),
  decode(repeat('f6', 32), 'hex'), 'PayoutWalletChanged',
  array[decode(repeat('f6', 32), 'hex')], decode('0204', 'hex'),
  '{"poolId":"0x7373737373737373737373737373737373737373737373737373737373737373","allocationIndex":"1","previousPayoutWallet":"0x2222222222222222222222222222222222222222","newPayoutWallet":"0x1111111111111111111111111111111111111111","shareBps":"4000","configurationEpoch":"2","activeConfigurationHash":"0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5","effectiveTotalCreatorFeesReceived":"1200"}'::jsonb,
  decode(repeat('f7', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'), 24
  ),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('f8', 32), 'hex'), '2026-07-31T03:03:17.400Z'
);
select programmable_private.resolve_envio_candidate(
  'a3310000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'), 24
  ), null, '91210000-0000-0000-0000-000000000001',
  decode(repeat('d2', 32), 'hex'), decode(repeat('f9', 32), 'hex'),
  '2026-07-31T03:03:17.410Z'
);
select programmable_private.append_chain_event_occurrence(
  'a3330000-0000-0000-0000-000000000002',
  'a3340000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'), 24
  ),
  'a3310000-0000-0000-0000-000000000002',
  1, '2026-07-31T02:58:42Z', 'decoder-v1',
  decode(repeat('d2', 32), 'hex'),
  '95000000-0000-0000-0000-000000000602', 1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310084', 'hex'),
  decode(repeat('fa', 32), 'hex'), '2026-07-31T03:03:17.420Z'
);

select programmable_private.open_run(
  'a3250000-0000-0000-0000-000000000001',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('b1', 32), 'hex'),
  '2026-07-31T03:03:18.000Z'
);
select is(
  (
    select pg_catalog.count(*)
    from programmable_private.get_projector_reward_state_by_vault_v1(
      'a3250000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex')
    )
  ),
  2::bigint,
  'reward reader survives an unrelated global cursor advance'
);
select programmable_private.stage_current_reward_snapshot_v1(
  'a3250000-0000-0000-0000-000000000001',
  decode(repeat('77', 20), 'hex'), decode(repeat('73', 32), 'hex'),
  '98000000-0000-0000-0000-000000000001',
  1, decode(repeat('a3', 32), 'hex'), 1100,
  array[0, 1],
  array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
  array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
  array[6000::numeric, 4000::numeric],
  array[
    decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex'),
    decode(repeat('33', 20), 'hex')
  ],
  array[
    decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex'),
    decode(repeat('33', 20), 'hex')
  ],
  array[1::numeric, 434::numeric, 7::numeric],
  array[653::numeric, 0::numeric, 5::numeric],
  'a3240000-0000-0000-0000-000000000002',
  25639601, decode(repeat('9a', 32), 'hex'),
  '2026-07-31T03:03:18.100Z'
);
select programmable_private.stage_claim_projection(
  'a3260000-0000-0000-0000-000000000001',
  'a3250000-0000-0000-0000-000000000001',
  decode(repeat('77', 20), 'hex'), 'beneficiary',
  decode(repeat('11', 20), 'hex'), decode(repeat('11', 20), 'hex'),
  653, 653, 1100,
  'a3240000-0000-0000-0000-000000000002',
  25639601, decode(repeat('9a', 32), 'hex'),
  '2026-07-31T03:03:18.110Z'
);
select throws_ok(
  $sql$
    select programmable_private.promote_projection_run_v2(
      'reward_snapshot_delta',
      'a3270000-0000-0000-0000-000000000001',
      'a3270000-0000-0000-0000-000000000002',
      'a3270000-0000-0000-0000-000000000003',
      'a3250000-0000-0000-0000-000000000001',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      3, 4, 0,
      '94000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000601',
      25639601, decode(repeat('9a', 32), 'hex'), 22,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 22
      ),
      array[
        'a3240000-0000-0000-0000-000000000001'::uuid,
        'a3240000-0000-0000-0000-000000000002'::uuid
      ],
      array['98000000-0000-0000-0000-000000000001'::uuid],
      array['98100000-0000-0000-0000-000000000001'::uuid],
      array[
        'a3210000-0000-0000-0000-000000000001'::uuid,
        'a3210000-0000-0000-0000-000000000002'::uuid
      ],
      array['explore-list']::text[], decode(repeat('b2', 32), 'hex'),
      '2026-07-31T03:03:18.200Z'
    )
  $sql$,
  '23514',
  'fabricated per-beneficiary reward movement is rejected'
);
reset role;
select is(
  (
    select checkpoint_generation
    from programmable_private.projector_checkpoint_current
    where chain_id = 1 and release_id = 'classic-v3'
  ),
  3::bigint,
  'fabricated reward movement cannot advance the checkpoint'
);

set local role programmable_projector;
select programmable_private.open_run(
  'a3250000-0000-0000-0000-000000000002',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('b3', 32), 'hex'),
  '2026-07-31T03:03:18.300Z'
);
select programmable_private.stage_current_reward_snapshot_v1(
  'a3250000-0000-0000-0000-000000000002',
  decode(repeat('77', 20), 'hex'), decode(repeat('73', 32), 'hex'),
  '98000000-0000-0000-0000-000000000001',
  1, decode(repeat('a3', 32), 'hex'), 1100,
  array[0, 1],
  array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
  array[decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')],
  array[6000::numeric, 4000::numeric],
  array[
    decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex'),
    decode(repeat('33', 20), 'hex')
  ],
  array[
    decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex'),
    decode(repeat('33', 20), 'hex')
  ],
  array[0::numeric, 435::numeric, 7::numeric],
  array[653::numeric, 0::numeric, 5::numeric],
  'a3240000-0000-0000-0000-000000000002',
  25639601, decode(repeat('9a', 32), 'hex'),
  '2026-07-31T03:03:18.400Z'
);
select programmable_private.stage_claim_projection(
  'a3260000-0000-0000-0000-000000000002',
  'a3250000-0000-0000-0000-000000000002',
  decode(repeat('77', 20), 'hex'), 'beneficiary',
  decode(repeat('11', 20), 'hex'), decode(repeat('11', 20), 'hex'),
  653, 653, 1100,
  'a3240000-0000-0000-0000-000000000002',
  25639601, decode(repeat('9a', 32), 'hex'),
  '2026-07-31T03:03:18.410Z'
);
select lives_ok(
  $sql$
    select programmable_private.promote_projection_run_v2(
      'reward_snapshot_delta',
      'a3270000-0000-0000-0000-000000000011',
      'a3270000-0000-0000-0000-000000000012',
      'a3270000-0000-0000-0000-000000000013',
      'a3250000-0000-0000-0000-000000000002',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      3, 4, 0,
      '94000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000601',
      25639601, decode(repeat('9a', 32), 'hex'), 22,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('9a', 32), 'hex'), decode(repeat('c4', 32), 'hex'), 22
      ),
      array[
        'a3240000-0000-0000-0000-000000000001'::uuid,
        'a3240000-0000-0000-0000-000000000002'::uuid
      ],
      array['98000000-0000-0000-0000-000000000001'::uuid],
      array['98100000-0000-0000-0000-000000000001'::uuid],
      array[
        'a3210000-0000-0000-0000-000000000001'::uuid,
        'a3210000-0000-0000-0000-000000000002'::uuid
      ],
      array['explore-list']::text[], decode(repeat('b4', 32), 'hex'),
      '2026-07-31T03:03:18.500Z'
    )
  $sql$,
  'exact checkpoint and claim reward movement promotes atomically'
);
reset role;
select is(
  (
    select pg_catalog.array_agg(
      pg_catalog.format(
        '%s:%s:%s', pg_catalog.encode(account, 'hex'),
        claimable_accrued, claimed_total
      ) order by account
    )
    from programmable_private.current_account_reward_balances_v1
    where vault = decode(repeat('77', 20), 'hex')
  ),
  array[
    repeat('11', 20) || ':0:653',
    repeat('22', 20) || ':435:0',
    repeat('33', 20) || ':7:5'
  ]::text[],
  'successful claim snapshot publishes exact active and historical balances'
);
select is(
  (
    select ordered_occurrence_ids
    from programmable_private.projection_fold_manifests
    where run_id = 'a3250000-0000-0000-0000-000000000002'
  ),
  array[
    'a3240000-0000-0000-0000-000000000001'::uuid,
    'a3240000-0000-0000-0000-000000000002'::uuid
  ],
  'claim fold manifest retains the complete transaction group in chain order'
);

set local role programmable_projector;
select programmable_private.open_run(
  'a3350000-0000-0000-0000-000000000001',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('b5', 32), 'hex'),
  '2026-07-31T03:03:18.600Z'
);
select programmable_private.stage_current_reward_snapshot_v1(
  'a3350000-0000-0000-0000-000000000001',
  decode(repeat('77', 20), 'hex'), decode(repeat('73', 32), 'hex'),
  '98000000-0000-0000-0000-000000000001',
  2, decode(repeat('a5', 32), 'hex'), 1200,
  array[0, 1],
  array[decode(repeat('11', 20), 'hex'), decode(repeat('11', 20), 'hex')],
  array[decode(repeat('11', 20), 'hex'), decode(repeat('11', 20), 'hex')],
  array[6000::numeric, 4000::numeric],
  array[
    decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex'),
    decode(repeat('33', 20), 'hex')
  ],
  array[
    decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex'),
    decode(repeat('33', 20), 'hex')
  ],
  array[60::numeric, 475::numeric, 7::numeric],
  array[653::numeric, 0::numeric, 5::numeric],
  'a3340000-0000-0000-0000-000000000002',
  25639602, decode(repeat('9b', 32), 'hex'),
  '2026-07-31T03:03:18.700Z'
);
reset role;

savepoint stale_reward_delta_reorg;
select public.reward_test_private_call($call$
  update programmable_private.projector_checkpoint_current
  set reorg_generation = reorg_generation + 1
  where chain_id = 1
    and release_id = 'classic-v3'
    and model_id = 'classic-v3'
    and source_group = 'core'
    and projector_version = 'projector-v1'
$call$);
set local role programmable_projector;
select throws_ok(
  $sql$
    select programmable_private.promote_projection_run_v2(
      'reward_snapshot_delta',
      'a3370000-0000-0000-0000-000000000001',
      'a3370000-0000-0000-0000-000000000002',
      'a3370000-0000-0000-0000-000000000003',
      'a3350000-0000-0000-0000-000000000001',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      4, 5, 0,
      '94000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000602',
      25639602, decode(repeat('9b', 32), 'hex'), 24,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'), 24
      ),
      array[
        'a3340000-0000-0000-0000-000000000001'::uuid,
        'a3340000-0000-0000-0000-000000000002'::uuid
      ],
      array['98000000-0000-0000-0000-000000000001'::uuid],
      array['98100000-0000-0000-0000-000000000001'::uuid],
      array[
        'a3310000-0000-0000-0000-000000000001'::uuid,
        'a3310000-0000-0000-0000-000000000002'::uuid
      ],
      array['explore-list']::text[], decode(repeat('b6', 32), 'hex'),
      '2026-07-31T03:03:18.800Z'
    )
  $sql$,
  '40001',
  'reward delta rejects a stale reorg generation'
);
reset role;
rollback to savepoint stale_reward_delta_reorg;
select ok(
  (
    select checkpoint_generation = 4 and reorg_generation = 0
    from programmable_private.projector_checkpoint_current
    where chain_id = 1 and release_id = 'classic-v3'
  ),
  'stale reorg attempt leaves the current checkpoint unchanged'
);

set local role programmable_projector;
select lives_ok(
  $sql$
    select programmable_private.promote_projection_run_v2(
      'reward_snapshot_delta',
      'a3370000-0000-0000-0000-000000000011',
      'a3370000-0000-0000-0000-000000000012',
      'a3370000-0000-0000-0000-000000000013',
      'a3350000-0000-0000-0000-000000000001',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      4, 5, 0,
      '94000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000602',
      25639602, decode(repeat('9b', 32), 'hex'), 24,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('9b', 32), 'hex'), decode(repeat('c5', 32), 'hex'), 24
      ),
      array[
        'a3340000-0000-0000-0000-000000000001'::uuid,
        'a3340000-0000-0000-0000-000000000002'::uuid
      ],
      array['98000000-0000-0000-0000-000000000001'::uuid],
      array['98100000-0000-0000-0000-000000000001'::uuid],
      array[
        'a3310000-0000-0000-0000-000000000001'::uuid,
        'a3310000-0000-0000-0000-000000000002'::uuid
      ],
      array['explore-list']::text[], decode(repeat('b7', 32), 'hex'),
      '2026-07-31T03:03:18.900Z'
    )
  $sql$,
  'checkpoint and duplicate payout-address transition promote atomically'
);
reset role;
select is(
  (
    select pg_catalog.array_agg(
      pg_catalog.format(
        '%s:%s:%s', pg_catalog.encode(beneficiary, 'hex'),
        pg_catalog.encode(payout_address, 'hex'), share_bps
      ) order by allocation_index
    )
    from programmable_private.projection_entity_current as entity
    join programmable_private.reward_vault_projections as vault
      on vault.reward_vault_projection_id = entity.projection_row_id
     and vault.projection_run_id = entity.projection_run_id
    join programmable_private.reward_allocation_projections as allocation
      on allocation.reward_vault_projection_id =
        vault.reward_vault_projection_id
     and allocation.projection_run_id = vault.projection_run_id
     and allocation.effective_to_block is null
    where entity.entity_kind = 'reward_vault'
      and vault.vault = decode(repeat('77', 20), 'hex')
  ),
  array[
    repeat('11', 20) || ':' || repeat('11', 20) || ':6000',
    repeat('11', 20) || ':' || repeat('11', 20) || ':4000'
  ]::text[],
  'active Classic allocations preserve a deliberate duplicate payout wallet'
);
select ok(
  (
    select pg_catalog.count(*) = 2
       and pg_catalog.bool_and(
         case
           when account = decode(repeat('22', 20), 'hex')
             then claimable_accrued = 475 and claimed_total = 0
           when account = decode(repeat('33', 20), 'hex')
             then claimable_accrued = 7 and claimed_total = 5
           else false
         end
       )
    from programmable_private.current_account_reward_balances_v1
    where vault = decode(repeat('77', 20), 'hex')
      and account in (
        decode(repeat('22', 20), 'hex'), decode(repeat('33', 20), 'hex')
      )
  ),
  'payout change retains exact balances for historical accounts'
);
select is(
  (
    select checkpoint_generation
    from programmable_private.projector_checkpoint_current
    where chain_id = 1 and release_id = 'classic-v3'
  ),
  5::bigint,
  'two exact reward deltas advance the checkpoint to generation five'
);

set local role programmable_projector;
select programmable_private.open_run(
  '97000000-0000-0000-0000-000000000003',
  'ingestion', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('63', 32), 'hex'),
  '2026-07-31T03:04:00Z'
);
select programmable_private.append_reward_allocation_fact(
  '98000000-0000-0000-0000-000000000010',
  '97000000-0000-0000-0000-000000000003',
  decode(repeat('77', 20), 'hex'),
  '96100000-0000-0000-0000-000000000001',
  array[
    decode(repeat('11', 20), 'hex'),
    decode(repeat('22', 20), 'hex')
  ],
  array[5000::numeric, 5000::numeric],
  decode(repeat('f1', 32), 'hex'),
  decode(repeat('f2', 32), 'hex'),
  decode(repeat('f3', 32), 'hex'),
  decode(repeat('a4', 32), 'hex'),
  array[
    '96100000-0000-0000-0000-000000000002'::uuid,
    '96100000-0000-0000-0000-000000000001'::uuid,
    '96100000-0000-0000-0000-000000000004'::uuid
  ],
  array['launcher', 'vault_factory', 'hook']::text[],
  1::smallint,
  decode(
    '70726f6772616d6d61626c653a616c6c6f636174696f6e3a76310080',
    'hex'
  ),
  decode(repeat('f4', 32), 'hex'),
  '2026-07-31T03:04:01Z'
);
select programmable_private.append_reward_allocation_evidence(
  '98100000-0000-0000-0000-000000000010',
  '98000000-0000-0000-0000-000000000010',
  '97000000-0000-0000-0000-000000000003',
  'launcher_calldata', 'seed-verifier-v1.1.0',
  decode(repeat('31', 20), 'hex'), decode('bf388406', 'hex'),
  decode(repeat('f5', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('b4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
  decode(repeat('77', 20), 'hex'), 'unavailable',
  null, null, null, null, null,
  null, null,
  decode(repeat('f2', 32), 'hex'), decode(repeat('f2', 32), 'hex'),
  decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
  1::smallint,
  decode(
    '70726f6772616d6d61626c653a65766964656e63653a76310081',
    'hex'
  ),
  decode(repeat('f8', 32), 'hex'),
  '2026-07-31T03:04:02Z',
  decode(repeat('f1', 32), 'hex'), decode(repeat('f2', 32), 'hex'),
  decode(repeat('f3', 32), 'hex')
);
select programmable_private.quarantine_conflicting_reward_allocations(
  '98300000-0000-0000-0000-000000000002',
  '98300000-0000-0000-0000-000000000003',
  '98000000-0000-0000-0000-000000000001',
  '98100000-0000-0000-0000-000000000001',
  '98000000-0000-0000-0000-000000000010',
  '98100000-0000-0000-0000-000000000010',
  '97000000-0000-0000-0000-000000000003',
  decode(repeat('e3', 32), 'hex'),
  '2026-07-31T03:04:03Z'
);
select programmable_private.append_reward_allocation_evidence(
  '98100000-0000-0000-0000-000000000011',
  '98000000-0000-0000-0000-000000000010',
  '97000000-0000-0000-0000-000000000003',
  'launcher_calldata', 'seed-verifier-v1.1.1',
  decode(repeat('31', 20), 'hex'), decode('bf388406', 'hex'),
  decode(repeat('f5', 32), 'hex'), decode(repeat('c0', 32), 'hex'), decode(repeat('a4', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
  decode(repeat('77', 20), 'hex'), 'unavailable',
  null, null, null, null, null, null, null,
  decode(repeat('f2', 32), 'hex'), decode(repeat('f2', 32), 'hex'),
  decode(repeat('88', 32), 'hex'), decode(repeat('88', 32), 'hex'),
  1::smallint,
  decode('70726f6772616d6d61626c653a65766964656e63653a76310082', 'hex'),
  decode(repeat('e9', 32), 'hex'), '2026-07-31T03:04:04Z',
  decode(repeat('f1', 32), 'hex'), decode(repeat('ee', 32), 'hex'),
  decode(repeat('f3', 32), 'hex')
);

reset role;

select is(
  (select count(*) from programmable_private.reward_allocation_mismatch_evidence
   where mismatch_evidence_id = '98100000-0000-0000-0000-000000000011'),
  1::bigint,
  'attested configuration mismatch is retained as immutable evidence'
);
select is(
  (select count(*) from programmable_private.reward_allocation_status_history
   where allocation_fact_id = '98000000-0000-0000-0000-000000000010'
     and allocation_evidence_id is null and status = 'quarantined'),
  1::bigint,
  'attested mismatch appends quarantine status instead of rolling back'
);

select is(
  (select count(*) from programmable_private.reward_allocation_current_verified),
  0::bigint,
  'conflicting valid evidence removes the selected seed without deleting facts'
);
select is(
  (
    select status::text
    from programmable_private.route_eligibility_current
    where route_key = 'explore-list'
  ),
  'quarantined',
  'conflicting allocation evidence quarantines route eligibility atomically'
);

set local role programmable_projector;
select programmable_private.open_run(
  '97000000-0000-0000-0000-000000000004',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('64', 32), 'hex'),
  '2026-07-31T03:05:00Z'
);
select programmable_private.stage_launch_projection(
  '97100000-0000-0000-0000-000000000004',
  '97000000-0000-0000-0000-000000000004',
  decode(repeat('71', 20), 'hex'), decode(repeat('72', 20), 'hex'),
  decode(repeat('88', 32), 'hex'), decode(repeat('73', 32), 'hex'),
  null, decode(repeat('74', 32), 'hex'),
  'Seed Token', 'SEED', 1000000000000000000000000,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:05:01Z'
);
select programmable_private.stage_pool_projection(
  '97110000-0000-0000-0000-000000000004',
  '97100000-0000-0000-0000-000000000004',
  '97000000-0000-0000-0000-000000000004',
  decode(repeat('00', 20), 'hex'), decode(repeat('71', 20), 'hex'),
  3000, 60, decode(repeat('39', 20), 'hex'),
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:05:01.100Z'
);
select programmable_private.stage_pool_fee_configuration(
  '97120000-0000-0000-0000-000000000004',
  '97110000-0000-0000-0000-000000000004',
  '97000000-0000-0000-0000-000000000004',
  30, 40, 20, 10, 0, 3000,
  '96100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:05:01.200Z'
);
select throws_ok(
  $sql$
    select programmable_private.promote_projection_run(
      '97200000-0000-0000-0000-000000000004',
      '97300000-0000-0000-0000-000000000004',
      '97400000-0000-0000-0000-000000000004',
      '97000000-0000-0000-0000-000000000004',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      5, 6, 0,
      '94000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000600',
      25639600, decode(repeat('99', 32), 'hex'),
      20,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'), decode(repeat('85', 32), 'hex'), 20
      ),
      array['96100000-0000-0000-0000-000000000001'::uuid],
      array['98000000-0000-0000-0000-000000000001'::uuid],
      array['98100000-0000-0000-0000-000000000001'::uuid],
      array[]::uuid[],
      array['explore-list']::text[],
      decode(repeat('e4', 32), 'hex'), '2026-07-31T03:05:02Z'
    )
  $sql$,
  '23514',
  'quarantined evidence cannot be re-promoted'
);

reset role;

select is(
  (
    select checkpoint_generation
    from programmable_private.projector_checkpoint_current
    where chain_id = 1 and release_id = 'classic-v3'
  ),
  5::bigint,
  'failed re-promotion cannot advance the checkpoint'
);
select is(
  (
    select count(*)
    from programmable_private.run_lifecycle_outcomes
    where run_id = '97000000-0000-0000-0000-000000000004'
  ),
  0::bigint,
  'failed re-promotion rolls back its outcome'
);
select is(
  (
    select count(*)
    from programmable_private.reward_allocation_status_history
    where allocation_fact_id in (
      '98000000-0000-0000-0000-000000000001',
      '98000000-0000-0000-0000-000000000010'
    )
      and status = 'conflicted'
  ),
  2::bigint,
  'both independently valid conflicting allocations retain conflict history'
);

set local role programmable_projector;
select throws_ok(
  $sql$
    select public.reward_test_private_call($call$
    select programmable_private.append_reward_allocation_fact(
      fact.allocation_fact_id, fact.verification_run_id, fact.vault,
      fact.factory_occurrence_id, fact.ordered_beneficiaries,
      fact.ordered_shares_bps::numeric[], fact.allocation_hash,
      fact.configuration_hash, fact.active_configuration_hash,
      fact.manifest_artifact_creation_code_commitment,
      (select array_agg(required.occurrence_id order by required.occurrence_ordinal)
       from programmable_private.reward_allocation_required_occurrences as required
       where required.allocation_fact_id = fact.allocation_fact_id),
      (select array_agg(required.occurrence_role::text order by required.occurrence_ordinal)
       from programmable_private.reward_allocation_required_occurrences as required
       where required.allocation_fact_id = fact.allocation_fact_id),
      fact.encoding_version, fact.canonical_preimage,
      fact.content_fingerprint, fact.created_at
    )
    from programmable_private.reward_allocation_facts as fact
    where fact.allocation_fact_id = '98000000-0000-0000-0000-000000000001'
    $call$)
  $sql$,
  '55000',
  'terminal projection runs reject allocation-fact replays'
);
select throws_ok(
  $sql$
    select public.reward_test_private_call($call$
    select programmable_private.append_reward_allocation_evidence(
      evidence.allocation_evidence_id, evidence.allocation_fact_id,
      evidence.verification_run_id, evidence.recovery_method::text,
      evidence.evidence_version::text, evidence.top_level_destination,
      evidence.method_selector, evidence.transaction_input_hash,
      evidence.constructor_arguments_commitment,
      evidence.local_init_code_hash, evidence.create2_salt,
      evidence.local_create2_address,
      evidence.historical_enrichment_status::text, evidence.getter_block_hash,
      evidence.getter_result_hash_a, evidence.getter_result_hash_b,
      evidence.predict_result_hash_a, evidence.predict_result_hash_b,
      evidence.predicted_vault_a, evidence.predicted_vault_b,
      evidence.selected_rpc_result_hash_a,
      evidence.selected_rpc_result_hash_b,
      evidence.selected_rpc_transaction_receipt_hash_a,
      evidence.selected_rpc_transaction_receipt_hash_b,
      evidence.encoding_version, evidence.canonical_preimage,
      evidence.content_fingerprint, evidence.verified_at,
      evidence.recomputed_allocation_hash,
      evidence.recomputed_configuration_hash,
      evidence.recomputed_active_configuration_hash
    )
    from programmable_private.reward_allocation_evidence as evidence
    where evidence.allocation_evidence_id =
      '98100000-0000-0000-0000-000000000001'
    $call$)
  $sql$,
  '55000',
  'terminal projection runs reject allocation-evidence replays'
);
select throws_ok(
  $sql$
    select programmable_private.stage_pool_fee_total(
      '98250000-0000-0000-0000-000000000001',
      '97000000-0000-0000-0000-000000000002',
      decode(repeat('73', 32), 'hex'), null, 1000, 200, 100,
      '96100000-0000-0000-0000-000000000001',
      25639600, decode(repeat('99', 32), 'hex'),
      '2026-07-31T03:06:00Z'
    )
  $sql$,
  '55000',
  'terminal projection runs reject typed projection replays'
);

select programmable_private.append_creator_fee_checkpoint_fact(
  '91600000-0000-0000-0000-000000000003',
  '93000000-0000-0000-0000-000000000001',
  '91240000-0000-0000-0000-000000000002',
  decode(repeat('73', 32), 'hex'), 1, 100, 1000,
  '2026-07-31T03:06:00.100Z'
);
select programmable_private.append_reward_configuration_activation_fact(
  '91600000-0000-0000-0000-000000000004',
  '93000000-0000-0000-0000-000000000001',
  '91240000-0000-0000-0000-000000000003',
  decode(repeat('73', 32), 'hex'), decode(repeat('af', 32), 'hex'), 2,
  decode(repeat('a2', 32), 'hex'), decode(repeat('a3', 32), 'hex'),
  array[
    decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')
  ],
  array[6000::numeric, 4000::numeric], 1000,
  '2026-07-31T03:06:00.200Z'
);
reset role;
select is(
  (select count(*) from programmable_private.creator_hook_claim_facts)
    + (select count(*) from programmable_private.launcher_hook_claim_facts)
    + (select count(*) from programmable_private.creator_fee_checkpoint_facts)
    + (select count(*) from programmable_private.reward_configuration_activation_facts),
  4::bigint,
  'hook claims checkpoints and reward activations persist as distinct typed facts'
);
set local role programmable_projector;
select is(
  programmable_private.append_creator_fee_checkpoint_fact(
    '91600000-0000-0000-0000-000000000003',
    '93000000-0000-0000-0000-000000000001',
    '91240000-0000-0000-0000-000000000002',
    decode(repeat('73', 32), 'hex'), 1, 100, 1000,
    '2026-07-31T03:06:00.100Z'
  ),
  '91600000-0000-0000-0000-000000000003'::uuid,
  'exact dynamic-source event-fact replay is idempotent'
);

-- Three release-neutral candidates intentionally share one block and global
-- log position.  Their canonical identifiers are the final lossless ordering
-- component for projector pagination and checkpoint advancement.
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('c1', 32), 'hex'), 21
  ),
  '910c0000-0000-0000-0000-000000000001',
  25639603, decode(repeat('99', 32), 'hex'), decode(repeat('c1', 32), 'hex'),
  21, 21, decode(repeat('3d', 20), 'hex'), decode(repeat('3e', 32), 'hex'),
  'ClassicRewardVaultDeployed', array[decode(repeat('3e', 32), 'hex')],
  decode('0201', 'hex'), '{}'::jsonb, decode(repeat('d1', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('c1', 32), 'hex'), 21
  ),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('e1', 32), 'hex'), '2026-07-31T03:06:00.210Z',
  'canonical-events', 'ClassicVaultFactory'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('c2', 32), 'hex'), 21
  ),
  '910c0000-0000-0000-0000-000000000001',
  25639603, decode(repeat('99', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
  22, 21, decode(repeat('3d', 20), 'hex'), decode(repeat('3e', 32), 'hex'),
  'ClassicRewardVaultDeployed', array[decode(repeat('3e', 32), 'hex')],
  decode('0202', 'hex'), '{}'::jsonb, decode(repeat('d2', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('c2', 32), 'hex'), 21
  ),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('e2', 32), 'hex'), '2026-07-31T03:06:00.220Z',
  'canonical-events', 'ClassicVaultFactory'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('c3', 32), 'hex'), 21
  ),
  '910c0000-0000-0000-0000-000000000001',
  25639603, decode(repeat('99', 32), 'hex'), decode(repeat('c3', 32), 'hex'),
  23, 21, decode(repeat('3d', 20), 'hex'), decode(repeat('3e', 32), 'hex'),
  'ClassicRewardVaultDeployed', array[decode(repeat('3e', 32), 'hex')],
  decode('0203', 'hex'), '{}'::jsonb, decode(repeat('d3', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('c3', 32), 'hex'), 21
  ),
  '92000000-0000-0000-0000-000000000003',
  decode(repeat('e3', 32), 'hex'), '2026-07-31T03:06:00.230Z',
  'canonical-events', 'ClassicVaultFactory'
);
select is(
  (
    select count(*)
    from programmable_private.list_projector_candidate_page_v1(
      1, 'classic-v3', 'classic-v3', 'core',
      '91000000-0000-0000-0000-000000000001', 1,
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      null, null, null, 500, '2026-07-31T03:06:00.300Z'
    )
  ),
  3::bigint,
  'candidate page exposes each pending release-neutral candidate once'
);
select is(
  (
    with first_page as (
      select *
      from programmable_private.list_projector_candidate_page_v1(
        1, 'classic-v3', 'classic-v3', 'core',
        '91000000-0000-0000-0000-000000000001', 1,
        'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
        null, null, null, 2, '2026-07-31T03:06:00.310Z'
      )
    ), cursor_row as (
      select * from first_page
      order by block_number desc, block_global_log_index desc,
               candidate_id desc
      limit 1
    ), all_pages as (
      select candidate_id from first_page
      union all
      select page.candidate_id
      from cursor_row as cursor
      cross join lateral programmable_private.list_projector_candidate_page_v1(
        1, 'classic-v3', 'classic-v3', 'core',
        '91000000-0000-0000-0000-000000000001', 1,
        'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
        cursor.block_number, cursor.block_global_log_index,
        cursor.candidate_id, 2, '2026-07-31T03:06:00.310Z'
      ) as page
    )
    select count(distinct candidate_id) from all_pages
  ),
  3::bigint,
  'full block-log-candidate cursor paginates same-position candidates losslessly'
);
select programmable_private.defer_envio_candidate_v1(
  'a1000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('c1', 32), 'hex'), 21
  ),
  0, 1, '2026-07-31T03:10:00Z', 'retryable-decode',
  decode(repeat('f1', 32), 'hex'), '2026-07-31T03:06:01Z'
);
select is(
  (
    select count(*)
    from programmable_private.list_projector_candidate_page_v1(
      1, 'classic-v3', 'classic-v3', 'core',
      '91000000-0000-0000-0000-000000000001', 1,
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      null, null, null, 500, '2026-07-31T03:07:00Z'
    )
  ),
  2::bigint,
  'a deferred candidate is excluded before its retry time'
);
select is(
  (
    select count(*)
    from programmable_private.list_projector_candidate_page_v1(
      1, 'classic-v3', 'classic-v3', 'core',
      '91000000-0000-0000-0000-000000000001', 1,
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      null, null, null, 500, '2026-07-31T03:11:00Z'
    )
  ),
  3::bigint,
  'a deferred candidate returns to the page only when due'
);
select throws_ok(
  $sql$
    select programmable_private.defer_envio_candidate_v1(
      'a1000000-0000-0000-0000-000000000099',
      '93000000-0000-0000-0000-000000000001',
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'), decode(repeat('c1', 32), 'hex'), 21
      ),
      0, 1, '2026-07-31T03:10:01Z', 'stale-retry',
      decode(repeat('f2', 32), 'hex'), '2026-07-31T03:06:01.100Z'
    )
  $sql$,
  '40001',
  'candidate deferral rejects a stale attempt generation'
);
select programmable_private.quarantine_envio_candidate_v1(
  'a2000000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('c2', 32), 'hex'), 21
  ),
  0, 'unsupported-payload', decode(repeat('f3', 32), 'hex'),
  '2026-07-31T03:06:02Z'
);
select programmable_private.ignore_envio_candidate_v1(
  'a2000000-0000-0000-0000-000000000003',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('c3', 32), 'hex'), 21
  ),
  0, 'known-nonrelease-event', decode(repeat('f4', 32), 'hex'),
  '2026-07-31T03:06:02.100Z'
);
select programmable_private.open_run(
  'a2f00000-0000-0000-0000-000000000001',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('9d', 32), 'hex'),
  '2026-07-31T03:06:02.110Z'
);
select programmable_private.stage_launch_projection(
  'a2f10000-0000-0000-0000-000000000001',
  'a2f00000-0000-0000-0000-000000000001',
  decode(repeat('71', 20), 'hex'), decode(repeat('72', 20), 'hex'),
  decode(repeat('88', 32), 'hex'), decode(repeat('73', 32), 'hex'),
  null, decode(repeat('74', 32), 'hex'),
  'Seed Token', 'SEED', 1000000000000000000000000,
  '96100000-0000-0000-0000-000000000001',
  25639603, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:06:02.120Z'
);
select programmable_private.stage_pool_projection(
  'a2f20000-0000-0000-0000-000000000001',
  'a2f10000-0000-0000-0000-000000000001',
  'a2f00000-0000-0000-0000-000000000001',
  decode(repeat('00', 20), 'hex'), decode(repeat('71', 20), 'hex'),
  3000, 60, decode(repeat('39', 20), 'hex'),
  '96100000-0000-0000-0000-000000000001',
  25639603, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:06:02.130Z'
);
select programmable_private.stage_pool_fee_configuration(
  'a2f30000-0000-0000-0000-000000000001',
  'a2f20000-0000-0000-0000-000000000001',
  'a2f00000-0000-0000-0000-000000000001',
  30, 40, 20, 10, 0, 3000,
  '96100000-0000-0000-0000-000000000001',
  25639603, decode(repeat('99', 32), 'hex'),
  '2026-07-31T03:06:02.140Z'
);
select programmable_private.stage_launch_occurrence_role(
  'a2f10000-0000-0000-0000-000000000001', 'vault_factory',
  '96100000-0000-0000-0000-000000000001', '2026-07-31T03:06:02.200Z'
);
select programmable_private.stage_launch_projection_conditions(
  'a2f10000-0000-0000-0000-000000000001', false,
  '2026-07-31T03:06:02.300Z'
);
select throws_ok(
  $sql$
    select programmable_private.promote_projection_run(
      'a3000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000002',
      'a3000000-0000-0000-0000-000000000003',
      'a2f00000-0000-0000-0000-000000000001',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'), 5, 6, 0,
      '94000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000603',
      25639603, decode(repeat('99', 32), 'hex'), 21,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'), decode(repeat('c3', 32), 'hex'), 21
      ),
      array[]::uuid[], array[]::uuid[], array[]::uuid[],
      array[
        'a2000000-0000-0000-0000-000000000002'::uuid,
        'a2000000-0000-0000-0000-000000000003'::uuid
      ],
      array['explore-list']::text[], decode(repeat('a1', 32), 'hex'),
      '2026-07-31T03:06:03Z'
    )
  $sql$,
  '23514',
  'a deferred candidate blocks checkpoint promotion'
);
select programmable_private.resolve_envio_candidate(
  'a2000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('99', 32), 'hex'), decode(repeat('c1', 32), 'hex'), 21
  ),
  '91100000-0000-0000-0000-000000000004', null,
  decode(repeat('57', 32), 'hex'), decode(repeat('f5', 32), 'hex'),
  '2026-07-31T03:06:04Z'
);
reset role;
select is(
  (
    select array_agg(status::text order by changed_at)
    from programmable_private.envio_candidate_status_history
    where candidate_id = programmable_private.derive_envio_candidate_id(
      1, decode(repeat('99', 32), 'hex'), decode(repeat('c1', 32), 'hex'), 21
    )
      and epoch_id = '91000000-0000-0000-0000-000000000001'
  ),
  array['deferred', 'resolved']::text[],
  'candidate history retains deferred and terminal transitions'
);
select is(
  (
    select array_agg(status::text order by candidate_id)
    from programmable_private.envio_candidate_status_current
    where candidate_id in (
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'), decode(repeat('c1', 32), 'hex'), 21
      ),
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'), decode(repeat('c2', 32), 'hex'), 21
      ),
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'), decode(repeat('c3', 32), 'hex'), 21
      )
    )
      and epoch_id = '91000000-0000-0000-0000-000000000001'
  ),
  array['resolved', 'quarantined', 'ignored']::text[],
  'release-scoped current state preserves all three terminal dispositions'
);
set local role programmable_projector;
select is(
  (
    select count(*)
    from programmable_private.list_projector_candidate_page_v1(
      1, 'classic-v3', 'classic-v3', 'core',
      '91000000-0000-0000-0000-000000000001', 1,
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      null, null, null, 500, '2026-07-31T03:11:00Z'
    )
  ),
  0::bigint,
  'terminal candidates are absent from projector work pages'
);
select lives_ok(
  $sql$
    select programmable_private.promote_projection_run(
      'a3000000-0000-0000-0000-000000000011',
      'a3000000-0000-0000-0000-000000000012',
      'a3000000-0000-0000-0000-000000000013',
      'a2f00000-0000-0000-0000-000000000001',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'), 5, 6, 0,
      '94000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000603',
      25639603, decode(repeat('99', 32), 'hex'), 21,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'), decode(repeat('c3', 32), 'hex'), 21
      ),
      array[]::uuid[], array[]::uuid[], array[]::uuid[],
      array[
        'a2000000-0000-0000-0000-000000000001'::uuid,
        'a2000000-0000-0000-0000-000000000002'::uuid,
        'a2000000-0000-0000-0000-000000000003'::uuid
      ],
      array['explore-list']::text[], decode(repeat('a2', 32), 'hex'),
      '2026-07-31T03:06:05Z'
    )
  $sql$,
  'cursor-only promotion accepts an empty occurrence fold only with exact terminal dispositions'
);
reset role;
select ok(
  (
    select cardinality(ordered_occurrence_ids) = 0
       and ordered_candidate_disposition_ids = array[
         'a2000000-0000-0000-0000-000000000001'::uuid,
         'a2000000-0000-0000-0000-000000000002'::uuid,
         'a2000000-0000-0000-0000-000000000003'::uuid
       ]
    from programmable_private.projection_fold_manifests
    where run_id = 'a2f00000-0000-0000-0000-000000000001'
  ),
  'cursor-only fold manifest records no occurrence IDs and every terminal decision ID'
);
set local role programmable_projector;
select ok(
  (
    select pg_catalog.jsonb_array_length(source_bindings) = 5
       and pg_catalog.jsonb_array_length(dynamic_source_templates) = 2
       and pg_catalog.jsonb_array_length(projection_event_rules) = 22
       and pg_catalog.jsonb_array_length(
         launch_completeness_requirements
       ) = 4
       and epoch_id = '91000000-0000-0000-0000-000000000001'::uuid
       and pointer_generation = 1
    from programmable_private.get_projector_release_manifest_v1(
      1, 'classic-v3', 'classic-v3', 'core',
      '91000000-0000-0000-0000-000000000001', 1
    )
  ),
  'projector release manifest returns every exact current immutable component'
);
select ok(
  (
    select count(*) = 1
       and min(token) = decode(repeat('71', 20), 'hex')
       and min(pool_id) = decode(repeat('73', 32), 'hex')
       and min(hook) = decode(repeat('39', 20), 'hex')
    from programmable_private.get_projector_dynamic_source_attestations_v1(
      1, 'classic-v3', 'classic-v3', 'core',
      '91000000-0000-0000-0000-000000000001', 1
    )
  ),
  'dynamic-source reader returns only exact asset-bound current attestations'
);
select is(
  (
    select pg_catalog.array_agg(decision_id order by candidate_id)
    from programmable_private.list_projector_candidate_dispositions_v1(
      1, 'classic-v3', 'classic-v3', 'core',
      '91000000-0000-0000-0000-000000000001', 1,
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      null, null, null, 500, '2026-07-31T03:11:00Z'
    )
    where candidate_id in (
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'),
        decode(repeat('c1', 32), 'hex'), 21
      ),
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'),
        decode(repeat('c2', 32), 'hex'), 21
      ),
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('99', 32), 'hex'),
        decode(repeat('c3', 32), 'hex'), 21
      )
    )
  ),
  array[
    'a2000000-0000-0000-0000-000000000001'::uuid,
    'a2000000-0000-0000-0000-000000000002'::uuid,
    'a2000000-0000-0000-0000-000000000003'::uuid
  ],
  'terminal disposition reader reconstructs exact ordered promotion decision IDs'
);
select programmable_private.open_run(
  'a4000000-0000-0000-0000-000000000001',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  '91000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('a4', 32), 'hex'),
  '2026-07-31T03:06:05.100Z'
);
select is(
  (
    select count(*)
    from programmable_private.get_projector_launch_baseline_v1(
      'a4000000-0000-0000-0000-000000000001',
      decode(repeat('71', 20), 'hex')
    )
  ),
  1::bigint,
  'projector launch fold reader returns the exact current launch baseline'
);
select ok(
  (
    select count(*) = 1
       and bool_and(token = decode(repeat('71', 20), 'hex'))
       and bool_and(pool_projection_id =
         'a2f20000-0000-0000-0000-000000000001'::uuid)
       and bool_and(pool_fee_configuration_id =
         'a2f30000-0000-0000-0000-000000000001'::uuid)
    from programmable_private.get_projector_pool_baseline_by_id_v1(
      'a4000000-0000-0000-0000-000000000001',
      decode(repeat('73', 32), 'hex')
    )
  ),
  'fee-only pool baseline resolves one exact release-scoped current pool'
);
select is(
  (
    select count(*)
    from programmable_private.get_projector_pool_fee_total_v1(
      'a4000000-0000-0000-0000-000000000001',
      decode(repeat('73', 32), 'hex'), null
    )
  ),
  1::bigint,
  'projector pool-fee fold reader returns the exact current total'
);
select is(
  (
    select count(*)
    from programmable_private.get_projector_vault_baseline_v1(
      'a4000000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex')
    )
  ),
  1::bigint,
  'projector vault fold reader returns the exact current vault baseline'
);
select is(
  (
    select count(*)
    from programmable_private.list_projector_vault_allocations_v1(
      'a4000000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex')
    )
  ),
  2::bigint,
  'projector allocation fold reader returns the complete ordered allocation set'
);
select is(
  (
    select count(*)
    from programmable_private.get_projector_account_reward_balance_v1(
      'a4000000-0000-0000-0000-000000000001',
      decode(repeat('77', 20), 'hex'), decode(repeat('11', 20), 'hex')
    )
  ),
  1::bigint,
  'projector account fold reader returns the exact current reward balance'
);
select programmable_private.append_run_outcome(
  'a4000000-0000-0000-0000-000000000002',
  'a4000000-0000-0000-0000-000000000001',
  'succeeded', decode(repeat('a5', 32), 'hex'),
  '2026-07-31T03:06:05.200Z'
);
select throws_ok(
  $sql$
    select *
    from programmable_private.get_projector_launch_baseline_v1(
      'a4000000-0000-0000-0000-000000000001',
      decode(repeat('71', 20), 'hex')
    )
  $sql$,
  '55000',
  'fold readers reject terminal projection runs'
);
select is(
  (
    select count(*)
    from programmable_private.list_projector_checkpoint_ancestors_v1(
      1, 'classic-v3', 'classic-v3', 'core', 'projector-v1', 100
    )
  ),
  6::bigint,
  'checkpoint ancestors retain every promoted full cursor generation'
);
select programmable_private.append_run_outcome(
  '91600000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  'succeeded', decode(repeat('16', 32), 'hex'),
  '2026-07-31T03:06:01Z'
);
select programmable_private.append_run_outcome(
  '91610000-0000-0000-0000-000000000001',
  '910c0000-0000-0000-0000-000000000001',
  'succeeded', decode(repeat('17', 32), 'hex'),
  '2026-07-31T03:06:01.010Z'
);

-- The neutral cursor has one explicit, dual-RPC-attested genesis and advances
-- only through the atomic page commit. The fresh cursor candidates below are
-- deliberately isolated from the earlier inbox fixtures so the coverage
-- arrays prove the exact page boundary without relying on test-side reads of
-- FORCE-RLS tables.
select programmable_private.open_run(
  'a4100000-0000-0000-0000-000000000001',
  'ingestion', 1, 'envio-control', 'envio-control', 'canonical-events',
  '70000000-0000-0000-0000-000000000002', 1,
  'envio-adapter-v1', decode(repeat('60', 32), 'hex'),
  '2026-07-31T03:06:05.300Z'
);
select programmable_private.append_safe_head_observation(
  'a4100000-0000-0000-0000-000000000002',
  'a4100000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  1, 1, 25639620, 25639620, 12, 25639608,
  decode(repeat('cc', 32), 'hex'), decode(repeat('cc', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000160', 'hex'),
  decode(repeat('61', 32), 'hex'), '2026-07-31T03:06:05.310Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'a4100000-0000-0000-0000-000000000003',
  'a4100000-0000-0000-0000-000000000002',
  'a4100000-0000-0000-0000-000000000001',
  25639600, decode(repeat('99', 32), 'hex'), decode(repeat('99', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000261', 'hex'),
  decode(repeat('62', 32), 'hex'), '2026-07-31T03:06:05.320Z'
);
select programmable_private.append_run_outcome(
  'a4100000-0000-0000-0000-000000000004',
  'a4100000-0000-0000-0000-000000000001',
  'succeeded', decode(repeat('63', 32), 'hex'),
  '2026-07-31T03:06:05.330Z'
);
select programmable_private.register_envio_ingestion_genesis_v1(
  'a4100000-0000-0000-0000-000000000005',
  'a4100000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000003', 'canonical-events',
  'a4100000-0000-0000-0000-000000000003',
  decode(repeat('64', 32), 'hex'), '2026-07-31T03:06:05.340Z'
);

select programmable_private.open_run(
  'a4200000-0000-0000-0000-000000000001',
  'ingestion', 1, 'envio-control', 'envio-control', 'canonical-events',
  '70000000-0000-0000-0000-000000000002', 1,
  'envio-adapter-v1', decode(repeat('65', 32), 'hex'),
  '2026-07-31T03:06:05.400Z'
);
select programmable_private.append_safe_head_observation(
  'a4200000-0000-0000-0000-000000000002',
  'a4200000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  1, 1, 25639620, 25639620, 12, 25639608,
  decode(repeat('cc', 32), 'hex'), decode(repeat('cc', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000162', 'hex'),
  decode(repeat('66', 32), 'hex'), '2026-07-31T03:06:05.410Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'a4200000-0000-0000-0000-000000000003',
  'a4200000-0000-0000-0000-000000000002',
  'a4200000-0000-0000-0000-000000000001',
  25639601, decode(repeat('98', 32), 'hex'), decode(repeat('98', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000263', 'hex'),
  decode(repeat('67', 32), 'hex'), '2026-07-31T03:06:05.420Z'
);
select programmable_private.commit_envio_ingestion_page_v1(
  'a4200000-0000-0000-0000-000000000004',
  'a4200000-0000-0000-0000-000000000005',
  'a4200000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000003', 'canonical-events',
  0, 1, 25639601,
  array[
    row(
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('98', 32), 'hex'),
        decode(repeat('d1', 32), 'hex'), 31
      )::text,
      25639601, decode(repeat('98', 32), 'hex'),
      decode(repeat('d1', 32), 'hex'), 31, 31,
      decode(repeat('3d', 20), 'hex'), decode(repeat('3e', 32), 'hex'),
      'CursorTestEvent', array[decode(repeat('3e', 32), 'hex')],
      decode('0301', 'hex'), '{}'::jsonb, decode(repeat('d4', 32), 'hex'),
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('98', 32), 'hex'),
        decode(repeat('d1', 32), 'hex'), 31
      )::text,
      decode(repeat('e5', 32), 'hex'), '2026-07-31T03:06:05.430Z',
      'ClassicVaultFactory'
    )::programmable_private.envio_candidate_page_item_v1
  ],
  'a4200000-0000-0000-0000-000000000002',
  'a4200000-0000-0000-0000-000000000003',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  decode(repeat('68', 32), 'hex'),
  array[decode(repeat('e5', 32), 'hex')],
  array[decode(repeat('e5', 32), 'hex')],
  decode(repeat('b1', 32), 'hex'), decode(repeat('69', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000564', 'hex'),
  decode(repeat('6a', 32), 'hex'), decode(repeat('6b', 32), 'hex'),
  '2026-07-31T03:06:05.440Z'
);

select programmable_private.open_run(
  'a4300000-0000-0000-0000-000000000001',
  'ingestion', 1, 'envio-control', 'envio-control', 'canonical-events',
  '70000000-0000-0000-0000-000000000002', 1,
  'envio-adapter-v1', decode(repeat('6c', 32), 'hex'),
  '2026-07-31T03:06:05.500Z'
);
select programmable_private.append_safe_head_observation(
  'a4300000-0000-0000-0000-000000000002',
  'a4300000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  1, 1, 25639620, 25639620, 12, 25639608,
  decode(repeat('cc', 32), 'hex'), decode(repeat('cc', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000165', 'hex'),
  decode(repeat('6d', 32), 'hex'), '2026-07-31T03:06:05.510Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'a4300000-0000-0000-0000-000000000003',
  'a4300000-0000-0000-0000-000000000002',
  'a4300000-0000-0000-0000-000000000001',
  25639601, decode(repeat('98', 32), 'hex'), decode(repeat('98', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000266', 'hex'),
  decode(repeat('6e', 32), 'hex'), '2026-07-31T03:06:05.520Z'
);
select is(
  programmable_private.commit_envio_ingestion_page_v1(
    'a4300000-0000-0000-0000-000000000004',
    'a4300000-0000-0000-0000-000000000005',
    'a4300000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000003', 'canonical-events',
    1, 2, 25639601,
    array[
      row(
        programmable_private.derive_envio_candidate_id(
          1, decode(repeat('98', 32), 'hex'),
          decode(repeat('d2', 32), 'hex'), 31
        )::text,
        25639601, decode(repeat('98', 32), 'hex'),
        decode(repeat('d2', 32), 'hex'), 32, 31,
        decode(repeat('3d', 20), 'hex'), decode(repeat('3e', 32), 'hex'),
        'CursorTestEvent', array[decode(repeat('3e', 32), 'hex')],
        decode('0302', 'hex'), '{}'::jsonb, decode(repeat('d5', 32), 'hex'),
        programmable_private.derive_envio_candidate_id(
          1, decode(repeat('98', 32), 'hex'),
          decode(repeat('d2', 32), 'hex'), 31
        )::text,
        decode(repeat('e6', 32), 'hex'), '2026-07-31T03:06:05.530Z',
        'ClassicVaultFactory'
      )::programmable_private.envio_candidate_page_item_v1,
      row(
        programmable_private.derive_envio_candidate_id(
          1, decode(repeat('98', 32), 'hex'),
          decode(repeat('d3', 32), 'hex'), 31
        )::text,
        25639601, decode(repeat('98', 32), 'hex'),
        decode(repeat('d3', 32), 'hex'), 33, 31,
        decode(repeat('3d', 20), 'hex'), decode(repeat('3e', 32), 'hex'),
        'CursorTestEvent', array[decode(repeat('3e', 32), 'hex')],
        decode('0303', 'hex'), '{}'::jsonb, decode(repeat('d6', 32), 'hex'),
        programmable_private.derive_envio_candidate_id(
          1, decode(repeat('98', 32), 'hex'),
          decode(repeat('d3', 32), 'hex'), 31
        )::text,
        decode(repeat('e7', 32), 'hex'), '2026-07-31T03:06:05.540Z',
        'ClassicVaultFactory'
      )::programmable_private.envio_candidate_page_item_v1
    ],
    'a4300000-0000-0000-0000-000000000002',
    'a4300000-0000-0000-0000-000000000003',
    '92000000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000002',
    decode(repeat('6f', 32), 'hex'),
    array[decode(repeat('e6', 32), 'hex'), decode(repeat('e7', 32), 'hex')],
    array[decode(repeat('e6', 32), 'hex'), decode(repeat('e7', 32), 'hex')],
    decode(repeat('b2', 32), 'hex'), decode(repeat('70', 32), 'hex'),
    2::smallint,
    decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000567', 'hex'),
    decode(repeat('71', 32), 'hex'), decode(repeat('72', 32), 'hex'),
    '2026-07-31T03:06:05.550Z'
  ),
  2::bigint,
  'atomic release-neutral page commit advances across candidate-ID tie breaks'
);
select throws_ok(
  $sql$
    select programmable_private.advance_envio_ingestion_cursor_v1(
      'a4300000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000003', 'canonical-events',
      1, 2, 25639601, decode(repeat('98', 32), 'hex'), 31,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('98', 32), 'hex'), decode(repeat('d3', 32), 'hex'), 31
      ),
      decode(repeat('b3', 32), 'hex'), '2026-07-31T03:06:06.200Z'
    )
  $sql$,
  '42501',
  'projector cannot bypass atomic log coverage with direct cursor advancement'
);
select is(
  (
    select generation::text || ':' || candidate_id
    from programmable_private.get_envio_ingestion_cursor_v1(
      1, '92000000-0000-0000-0000-000000000003', 'canonical-events'
    )
  ),
  '2:' || programmable_private.derive_envio_candidate_id(
    1, decode(repeat('98', 32), 'hex'), decode(repeat('d3', 32), 'hex'), 31
  )::text,
  'cursor reader returns the exact generation and full candidate identifier'
);
select is(
  (
    select count(*)
    from programmable_private.list_envio_ingestion_cursor_ancestors_v1(
      1, '92000000-0000-0000-0000-000000000003',
      'canonical-events', 100
    )
  ),
  2::bigint,
  'release-neutral cursor retains both forward ancestors'
);

select programmable_private.open_run(
  'a4400000-0000-0000-0000-000000000001',
  'ingestion', 1, 'envio-control', 'envio-control', 'canonical-events',
  '70000000-0000-0000-0000-000000000002', 1,
  'envio-adapter-v1', decode(repeat('73', 32), 'hex'),
  '2026-07-31T03:06:05.600Z'
);
select programmable_private.append_safe_head_observation(
  'a4400000-0000-0000-0000-000000000002',
  'a4400000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  1, 1, 25639620, 25639620, 12, 25639608,
  decode(repeat('cc', 32), 'hex'), decode(repeat('cc', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000173', 'hex'),
  decode(repeat('74', 32), 'hex'), '2026-07-31T03:06:05.610Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'a4400000-0000-0000-0000-000000000003',
  'a4400000-0000-0000-0000-000000000002',
  'a4400000-0000-0000-0000-000000000001',
  25639602, decode(repeat('97', 32), 'hex'),
  decode(repeat('97', 32), 'hex'), 2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000274', 'hex'),
  decode(repeat('75', 32), 'hex'), '2026-07-31T03:06:05.620Z'
);
select throws_ok(
  $sql$
    select programmable_private.commit_envio_ingestion_page_v1(
      'a4400000-0000-0000-0000-000000000004',
      'a4400000-0000-0000-0000-000000000005',
      'a4400000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000003', 'canonical-events',
      2, 3, 25639601,
      array[]::programmable_private.envio_candidate_page_item_v1[],
      'a4400000-0000-0000-0000-000000000002',
      'a4400000-0000-0000-0000-000000000003',
      '92000000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000002',
      decode(repeat('76', 32), 'hex'),
      array[decode(repeat('77', 32), 'hex')], array[]::bytea[],
      decode(repeat('78', 32), 'hex'), decode(repeat('79', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000575', 'hex'),
      decode(repeat('7a', 32), 'hex'), decode(repeat('7b', 32), 'hex'),
      '2026-07-31T03:06:05.630Z'
    )
  $sql$,
  '22023',
  'empty page rejects disagreement between the two RPC log arrays'
);
select throws_ok(
  $sql$
    select programmable_private.commit_envio_ingestion_page_v1(
      'a4400000-0000-0000-0000-000000000004',
      'a4400000-0000-0000-0000-000000000005',
      'a4400000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000003', 'canonical-events',
      2, 3, 25639601,
      array[]::programmable_private.envio_candidate_page_item_v1[],
      'a4400000-0000-0000-0000-000000000002',
      'a4400000-0000-0000-0000-000000000003',
      '92000000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000002',
      decode(repeat('76', 32), 'hex'),
      array[decode(repeat('77', 32), 'hex')],
      array[decode(repeat('77', 32), 'hex')],
      decode(repeat('78', 32), 'hex'), decode(repeat('79', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000575', 'hex'),
      decode(repeat('7a', 32), 'hex'), decode(repeat('7b', 32), 'hex'),
      '2026-07-31T03:06:05.630Z'
    )
  $sql$,
  '22023',
  'empty page rejects any RPC log even when providers agree'
);
select is(
  programmable_private.commit_envio_ingestion_page_v1(
    'a4400000-0000-0000-0000-000000000004',
    'a4400000-0000-0000-0000-000000000005',
    'a4400000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000003', 'canonical-events',
    2, 3, 25639601,
    array[]::programmable_private.envio_candidate_page_item_v1[],
    'a4400000-0000-0000-0000-000000000002',
    'a4400000-0000-0000-0000-000000000003',
    '92000000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000002',
    decode(repeat('76', 32), 'hex'), array[]::bytea[], array[]::bytea[],
    decode(repeat('78', 32), 'hex'), decode(repeat('79', 32), 'hex'),
    2::smallint,
    decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000575', 'hex'),
    decode(repeat('7a', 32), 'hex'), decode(repeat('7b', 32), 'hex'),
    '2026-07-31T03:06:05.630Z'
  ),
  3::bigint,
  'atomic empty page advances with exact same-run block evidence'
);
select is(
  programmable_private.commit_envio_ingestion_page_v1(
    'a4400000-0000-0000-0000-000000000004',
    'a4400000-0000-0000-0000-000000000005',
    'a4400000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000003', 'canonical-events',
    2, 3, 25639601,
    array[]::programmable_private.envio_candidate_page_item_v1[],
    'a4400000-0000-0000-0000-000000000002',
    'a4400000-0000-0000-0000-000000000003',
    '92000000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000002',
    decode(repeat('76', 32), 'hex'), array[]::bytea[], array[]::bytea[],
    decode(repeat('78', 32), 'hex'), decode(repeat('79', 32), 'hex'),
    2::smallint,
    decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000575', 'hex'),
    decode(repeat('7a', 32), 'hex'), decode(repeat('7b', 32), 'hex'),
    '2026-07-31T03:06:05.630Z'
  ),
  3::bigint,
  'exact terminal retry returns the already committed next generation'
);
select throws_ok(
  $sql$
    select programmable_private.commit_envio_ingestion_page_v1(
      'a4400000-0000-0000-0000-000000000004',
      'a4400000-0000-0000-0000-000000000005',
      'a4400000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000003', 'canonical-events',
      2, 3, 25639601,
      array[]::programmable_private.envio_candidate_page_item_v1[],
      'a4400000-0000-0000-0000-000000000002',
      'a4400000-0000-0000-0000-000000000003',
      '92000000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000002',
      decode(repeat('76', 32), 'hex'), array[]::bytea[], array[]::bytea[],
      decode(repeat('7c', 32), 'hex'), decode(repeat('79', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000575', 'hex'),
      decode(repeat('7a', 32), 'hex'), decode(repeat('7b', 32), 'hex'),
      '2026-07-31T03:06:05.630Z'
    )
  $sql$,
  '23505',
  'terminal retry with any changed immutable page field fails closed'
);
select ok(
  (
    select generation = 3 and block_number = 25639602
       and block_hash = decode(repeat('97', 32), 'hex')
       and block_global_log_index is null and candidate_id is null
    from programmable_private.get_envio_ingestion_cursor_v1(
      1, '92000000-0000-0000-0000-000000000003', 'canonical-events'
    )
  ),
  'empty-page cursor persists the covered block/hash with a NULL log point'
);
select programmable_private.open_run(
  'a4500000-0000-0000-0000-000000000001',
  'ingestion', 1, 'envio-control', 'envio-control', 'canonical-events',
  '70000000-0000-0000-0000-000000000002', 1,
  'envio-adapter-v1', decode(repeat('7d', 32), 'hex'),
  '2026-07-31T03:06:05.700Z'
);
select programmable_private.append_safe_head_observation(
  'a4500000-0000-0000-0000-000000000002',
  'a4500000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  1, 1, 25639620, 25639620, 12, 25639608,
  decode(repeat('cc', 32), 'hex'), decode(repeat('cc', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200017d', 'hex'),
  decode(repeat('7e', 32), 'hex'), '2026-07-31T03:06:05.710Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'a4500000-0000-0000-0000-000000000003',
  'a4500000-0000-0000-0000-000000000002',
  'a4500000-0000-0000-0000-000000000001',
  25639603, decode(repeat('96', 32), 'hex'),
  decode(repeat('96', 32), 'hex'), 2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200027e', 'hex'),
  decode(repeat('7f', 32), 'hex'), '2026-07-31T03:06:05.720Z'
);
select throws_ok(
  $sql$
    select programmable_private.commit_envio_ingestion_page_v1(
      'a4500000-0000-0000-0000-000000000004',
      'a4500000-0000-0000-0000-000000000005',
      'a4500000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000003', 'canonical-events',
      2, 3, 25639602,
      array[]::programmable_private.envio_candidate_page_item_v1[],
      'a4500000-0000-0000-0000-000000000002',
      'a4500000-0000-0000-0000-000000000003',
      '92000000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000002',
      decode(repeat('80', 32), 'hex'), array[]::bytea[], array[]::bytea[],
      decode(repeat('81', 32), 'hex'), decode(repeat('82', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a763200057f', 'hex'),
      decode(repeat('83', 32), 'hex'), decode(repeat('84', 32), 'hex'),
      '2026-07-31T03:06:05.730Z'
    )
  $sql$,
  '40001',
  'stale empty-page CAS cannot advance a newer cursor generation'
);
reset role;
select ok(
  not exists (
    select 1 from programmable_private.run_lifecycle_outcomes
    where run_id = 'a4500000-0000-0000-0000-000000000001'
  ) and not exists (
    select 1 from programmable_private.dual_rpc_log_coverage_evidence
    where verification_run_id = 'a4500000-0000-0000-0000-000000000001'
  ),
  'failed stale CAS rolls back terminal outcome and coverage evidence atomically'
);
set local role programmable_projector;
select programmable_private.open_run(
  'a5000000-0000-0000-0000-000000000001',
  'rewind', 1, 'envio-control', 'envio-control', 'canonical-events',
  '70000000-0000-0000-0000-000000000002', 1,
  'envio-adapter-v1', decode(repeat('b4', 32), 'hex'),
  '2026-07-31T03:06:06.300Z'
);
select programmable_private.append_safe_head_observation(
  'a5000000-0000-0000-0000-000000000002',
  'a5000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000002',
  1, 1, 25639620, 25639620, 12, 25639608,
  decode(repeat('cc', 32), 'hex'), decode(repeat('cc', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000150', 'hex'),
  decode(repeat('b5', 32), 'hex'), '2026-07-31T03:06:06.400Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'a5000000-0000-0000-0000-000000000003',
  'a5000000-0000-0000-0000-000000000002',
  'a5000000-0000-0000-0000-000000000001',
  25639601, decode(repeat('98', 32), 'hex'), decode(repeat('98', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000251', 'hex'),
  decode(repeat('b6', 32), 'hex'), '2026-07-31T03:06:06.500Z'
);
select programmable_private.append_run_outcome(
  'a5000000-0000-0000-0000-000000000004',
  'a5000000-0000-0000-0000-000000000001',
  'succeeded', decode(repeat('b7', 32), 'hex'),
  '2026-07-31T03:06:06.600Z'
);
select is(
  programmable_private.rewind_envio_ingestion_cursor_v1(
    'a5000000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000003', 'canonical-events',
    3, 4, 1, decode(repeat('b8', 32), 'hex'),
    '2026-07-31T03:06:06.700Z'
  ),
  4::bigint,
  'dual-RPC evidence permits an exact ancestor rewind'
);
select throws_ok(
  $sql$
    select programmable_private.rewind_envio_ingestion_cursor_v1(
      'a5000000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000003', 'canonical-events',
      3, 4, 1, decode(repeat('b9', 32), 'hex'),
      '2026-07-31T03:06:06.800Z'
    )
  $sql$,
  '40001',
  'neutral rewind rejects a stale cursor generation'
);
select is(
  (
    select generation::text || ':' || candidate_id
    from programmable_private.get_envio_ingestion_cursor_v1(
      1, '92000000-0000-0000-0000-000000000003', 'canonical-events'
    )
  ),
  '4:' || programmable_private.derive_envio_candidate_id(
    1, decode(repeat('98', 32), 'hex'), decode(repeat('d1', 32), 'hex'), 31
  )::text,
  'rewind restores the exact ancestor candidate while advancing generation'
);
reset role;
select ok(
  exists (
    select 1
    from programmable_private.envio_ingestion_cursor_history
    where generation = 4 and is_rewind and rewound_from_generation = 3
      and candidate_id = programmable_private.derive_envio_candidate_id(
        1, decode(repeat('98', 32), 'hex'), decode(repeat('d1', 32), 'hex'), 31
      )
  ),
  'rewind history is append-only and records its prior generation'
);
set local role programmable_projector;
select throws_ok(
  $sql$
    select programmable_private.append_creator_fee_checkpoint_fact(
      '91600000-0000-0000-0000-000000000003',
      '93000000-0000-0000-0000-000000000001',
      '91240000-0000-0000-0000-000000000002',
      decode(repeat('73', 32), 'hex'), 1, 100, 1000,
      '2026-07-31T03:06:00.100Z'
    )
  $sql$,
  '55000',
  'terminal ingestion runs reject creator-fee checkpoint fact replays'
);
select throws_ok(
  $sql$
    select programmable_private.append_reward_configuration_activation_fact(
      '91600000-0000-0000-0000-000000000004',
      '93000000-0000-0000-0000-000000000001',
      '91240000-0000-0000-0000-000000000003',
      decode(repeat('73', 32), 'hex'), decode(repeat('af', 32), 'hex'), 2,
      decode(repeat('a2', 32), 'hex'), decode(repeat('a3', 32), 'hex'),
      array[
        decode(repeat('11', 20), 'hex'), decode(repeat('22', 20), 'hex')
      ],
      array[6000::numeric, 4000::numeric], 1000,
      '2026-07-31T03:06:00.200Z'
    )
  $sql$,
  '55000',
  'terminal ingestion runs reject reward-configuration activation replays'
);
select throws_ok(
  $sql$
    select public.reward_test_private_call($call$
    select programmable_private.append_dual_rpc_runtime_code_evidence(
      evidence.runtime_code_evidence_id, evidence.verification_run_id,
      evidence.source_address, evidence.deployment_block_evidence_id,
      evidence.provider_a_id, evidence.provider_b_id,
      evidence.runtime_code_hash_a, evidence.runtime_code_hash_b,
      evidence.runtime_code_a, evidence.runtime_code_b,
      evidence.runtime_code_length_a, evidence.runtime_code_length_b,
      evidence.normalized_runtime_code_hash_a,
      evidence.normalized_runtime_code_hash_b,
      evidence.immutable_references_commitment,
      evidence.immutable_values,
      evidence.immutable_values_commitment,
      evidence.reconstructed_runtime_code,
      evidence.reconstructed_runtime_code_hash,
      evidence.encoding_version,
      evidence.canonical_preimage,
      evidence.content_fingerprint,
      evidence.evidence_commitment, evidence.verified_at
    )
    from programmable_private.dual_rpc_runtime_code_evidence as evidence
    where evidence.runtime_code_evidence_id =
      '91205000-0000-0000-0000-000000000001'
    $call$)
  $sql$,
  '55000',
  'terminal ingestion runs reject runtime-code evidence replays'
);
select throws_ok(
  $sql$
    select public.reward_test_private_call($call$
    select programmable_private.register_dynamic_source_attestation(
      attestation.dynamic_source_attestation_id,
      attestation.verification_run_id,
      attestation.dynamic_source_template_id,
      attestation.parent_factory_occurrence_id,
      attestation.deployed_source_address,
      attestation.deployment_block_number,
      attestation.runtime_code_evidence_id,
      attestation.deployed_artifact_creation_code_commitment,
      attestation.expected_immutable_values_commitment,
      attestation.factory_configuration_commitment,
      attestation.constructor_arguments_commitment,
      attestation.local_init_code_hash,
      attestation.runtime_code_hash,
      attestation.abi_event_set_commitment,
      attestation.encoding_version,
      attestation.canonical_preimage,
      attestation.content_fingerprint,
      attestation.attestation_commitment, attestation.created_at
    )
    from programmable_private.dynamic_source_attestations as attestation
    where attestation.dynamic_source_attestation_id =
      '91210000-0000-0000-0000-000000000001'
    $call$)
  $sql$,
  '55000',
  'terminal ingestion runs reject dynamic-source attestation replays'
);
select throws_ok(
  $sql$
    select public.reward_test_private_call($call$
    select programmable_private.append_release_neutral_envio_candidate(
      candidate.candidate_id, candidate.first_seen_run_id,
      candidate.block_number, candidate.block_hash,
      candidate.transaction_hash, candidate.transaction_index,
      candidate.block_global_log_index, candidate.source_address,
      candidate.event_signature, candidate.event_type,
      candidate.ordered_topics, candidate.raw_data,
      candidate.decoded_payload, candidate.payload_hash,
      candidate.provider_cursor, candidate.provider_deployment_id,
      candidate.content_commitment, candidate.first_seen_at
    )
    from programmable_private.envio_candidate_inbox as candidate
    where candidate.candidate_id = programmable_private.derive_envio_candidate_id(1, decode(repeat('99', 32), 'hex'), decode(repeat('87', 32), 'hex'), 14)
    $call$)
  $sql$,
  '55000',
  'terminal ingestion runs reject release-neutral candidate replays'
);
select throws_ok(
  $sql$
    select public.reward_test_private_call($call$
    select programmable_private.resolve_envio_candidate(
      resolution.candidate_resolution_id, resolution.resolved_by_run_id,
      resolution.candidate_id, resolution.release_binding_id,
      resolution.dynamic_source_attestation_id,
      resolution.abi_event_set_commitment,
      resolution.resolution_commitment, resolution.resolved_at
    )
    from programmable_private.envio_candidate_resolutions as resolution
    where resolution.candidate_resolution_id =
      '91220000-0000-0000-0000-000000000001'
    $call$)
  $sql$,
  '55000',
  'terminal ingestion runs reject candidate-resolution replays'
);
select throws_ok(
  $sql$
    select public.reward_test_private_call($call$
    select programmable_private.append_chain_event_occurrence(
      occurrence.logical_event_id, occurrence.occurrence_id,
      occurrence.verification_run_id,
      occurrence.first_seen_neutral_candidate_id,
      occurrence.candidate_resolution_id, occurrence.receipt_log_ordinal,
      occurrence.block_timestamp, occurrence.decoder_version,
      occurrence.abi_event_set_commitment, occurrence.block_evidence_id,
      occurrence.encoding_version, occurrence.canonical_preimage,
      occurrence.content_fingerprint, occurrence.verified_at
    )
    from programmable_private.chain_event_occurrences as occurrence
    where occurrence.occurrence_id =
      '91240000-0000-0000-0000-000000000001'
    $call$)
  $sql$,
  '55000',
  'terminal ingestion runs reject resolved occurrence replays'
);
reset role;

set local role programmable_api_reader;
select ok(
  exists (
    select 1
    from programmable_private.route_snapshot_readiness_v1
    where route_key = 'explore-list'
      and route_status = 'eligible'
      and route_mode = 'indexed'
      and parity_status = 'missing'
      and checkpoint_confirmations >= 0
  ),
  'route readiness exposes only an exact current checkpoint and measured confirmations'
);
reset role;
set local role programmable_migrator;
update programmable_private.route_eligibility_current as route
set checkpoint_id = (
  select checkpoint.checkpoint_id
  from programmable_private.projector_checkpoints as checkpoint
  where checkpoint.chain_id = route.chain_id
    and checkpoint.release_id = route.release_id
    and checkpoint.model_id = route.model_id
    and checkpoint.source_group = route.source_group
    and checkpoint.checkpoint_id <> route.checkpoint_id
  order by checkpoint.checkpoint_generation
  limit 1
)
where route.route_key = 'explore-list'
  and route.chain_id = 1
  and route.release_id = 'classic-v3'
  and route.model_id = 'classic-v3'
  and route.source_group = 'core';
reset role;
set local role programmable_api_reader;
select ok(
  not exists (
    select 1
    from programmable_private.route_snapshot_readiness_v1
    where route_key = 'explore-list'
      and chain_id = 1 and release_id = 'classic-v3'
  ),
  'readiness hides a route whose checkpoint ID is no longer exact-current'
);
select is(
  (
    select count(*)
    from programmable_private.get_recent_launches_v1(
      1, 100, null, null, null
    )
  ),
  0::bigint,
  'published route DTO view fails closed with the same stale checkpoint'
);
reset role;

select ok(
  exists (
    select 1
    from programmable_private.launch_position_liquidity_facts as position
    join programmable_private.launch_projections as launch
      on launch.launch_projection_id = position.launch_projection_id
    where launch.chain_id = 1
      and launch.release_id = 'classic-v3'
      and launch.model_id = 'classic-v3'
      and launch.promoted_block_number > 25639599
  )
  and exists (
    select 1
    from programmable_private.reward_vault_projections as current_snapshot
    join programmable_private.reward_vault_projections as baseline_snapshot
      on baseline_snapshot.reward_vault_projection_id =
        current_snapshot.baseline_reward_vault_projection_id
    where current_snapshot.chain_id = 1
      and current_snapshot.release_id = 'classic-v3'
      and current_snapshot.model_id = 'classic-v3'
      and current_snapshot.snapshot_kind = 'exact_current'
      and baseline_snapshot.snapshot_kind in ('initial_seed', 'exact_current')
  ),
  'reorg cleanup fixture contains launch liquidity and a reward snapshot chain'
);

select ok(
  exists (
    select 1
    from programmable_private.launch_projections as launch
    join programmable_private.launch_position_liquidity_facts as position
      on position.launch_projection_id = launch.launch_projection_id
    join programmable_private.launch_projection_occurrence_roles as role
      on role.launch_projection_id = launch.launch_projection_id
    join programmable_private.launch_projection_conditions as condition
      on condition.launch_projection_id = launch.launch_projection_id
    where launch.projection_run_id =
      '97000000-0000-0000-0000-000000000001'
  )
  and exists (
    select 1
    from programmable_private.launch_projections as launch
    join programmable_private.launch_projection_occurrence_roles as role
      on role.launch_projection_id = launch.launch_projection_id
    join programmable_private.launch_projection_conditions as condition
      on condition.launch_projection_id = launch.launch_projection_id
    where launch.projection_run_id in (
      '97000000-0000-0000-0000-000000000002',
      '97000000-0000-0000-0000-000000000005'
    )
  ),
  'mid-block replay fixture contains earlier and later published launch graphs'
);

set local role programmable_migrator;
select lives_ok(
  $sql$
    select programmable_private.delete_projector_projection_replay_scope_v1(
      1, 'classic-v3', 'classic-v3', 25639600,
      pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'), 13
    )
  $sql$,
  'projection replay cleanup accepts an exact legacy mid-block ancestor'
);
reset role;

select ok(
  exists (
    select 1
    from programmable_private.launch_projections as launch
    join programmable_private.launch_position_liquidity_facts as position
      on position.launch_projection_id = launch.launch_projection_id
    join programmable_private.launch_projection_occurrence_roles as role
      on role.launch_projection_id = launch.launch_projection_id
    join programmable_private.launch_projection_conditions as condition
      on condition.launch_projection_id = launch.launch_projection_id
    where launch.projection_run_id =
      '97000000-0000-0000-0000-000000000001'
  )
  and not exists (
    select 1
    from programmable_private.launch_projections
    where projection_run_id in (
      '97000000-0000-0000-0000-000000000002',
      '97000000-0000-0000-0000-000000000005'
    )
  )
  and not exists (
    select 1
    from programmable_private.launch_projection_occurrence_roles
    where projection_run_id in (
      '97000000-0000-0000-0000-000000000002',
      '97000000-0000-0000-0000-000000000005'
    )
  )
  and not exists (
    select 1
    from programmable_private.launch_projection_conditions
    where projection_run_id in (
      '97000000-0000-0000-0000-000000000002',
      '97000000-0000-0000-0000-000000000005'
    )
  ),
  'mid-block cleanup preserves the ancestor launch graph and removes later runs'
);

set local role programmable_migrator;
select lives_ok(
  $sql$
    select programmable_private.delete_projector_projection_replay_scope_v1(
      1, 'classic-v3', 'classic-v3', 25639599,
      pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), 0
    )
  $sql$,
  'projection replay cleanup removes populated FK graphs in dependency order'
);
reset role;

select ok(
  not exists (
    select 1
    from programmable_private.launch_position_liquidity_facts
    where chain_id = 1 and release_id = 'classic-v3'
      and model_id = 'classic-v3'
  )
  and not exists (
    select 1
    from programmable_private.reward_vault_projections
    where chain_id = 1 and release_id = 'classic-v3'
      and model_id = 'classic-v3'
      and promoted_block_number > 25639599
  )
  and not exists (
    select 1
    from programmable_private.launch_projections
    where chain_id = 1 and release_id = 'classic-v3'
      and model_id = 'classic-v3'
      and promoted_block_number > 25639599
  ),
  'replay cleanup leaves no invalid launch-liquidity or reward snapshot rows'
);

select * from finish();
rollback;
