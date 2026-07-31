begin;

set local role programmable_projector;

select programmable_private.create_release_epoch(
  'a1000000-0000-0000-0000-000000000001',
  1, 'classic-v3', 'classic-v3', 'core', 1,
  decode(repeat('10', 32), 'hex'),
  decode(repeat('11', 32), 'hex'),
  decode(repeat('12', 32), 'hex'),
  '2026-07-31T05:00:00Z'
);
select programmable_private.append_release_source_binding(
  'a1100000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'reorg-launcher', 'launcher', 'ethereum_contract',
  decode(repeat('62', 20), 'hex'), null, 70,
  decode(repeat('68', 32), 'hex'), decode(repeat('11', 32), 'hex'),
  decode(repeat('14', 32), 'hex'), decode(repeat('15', 32), 'hex'),
  '2026-07-31T05:00:00.500Z'
);
select programmable_private.append_release_projection_event_rule(
  rule_id, 'a1000000-0000-0000-0000-000000000001', projection_kind,
  'launcher', 'MemeTokenLaunchedV2', commitment, '2026-07-31T05:00:00.600Z'
)
from (values
  ('a1200000-0000-0000-0000-000000000001'::uuid, 'launch', decode(repeat('01', 32), 'hex')),
  ('a1200000-0000-0000-0000-000000000002'::uuid, 'pool', decode(repeat('02', 32), 'hex')),
  ('a1200000-0000-0000-0000-000000000003'::uuid, 'pool_fee_configuration', decode(repeat('03', 32), 'hex')),
  ('a1200000-0000-0000-0000-000000000004'::uuid, 'launch_requirement', decode(repeat('04', 32), 'hex'))
) as rule(rule_id, projection_kind, commitment);
select programmable_private.append_release_launch_requirement(
  'a1300000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001', 0,
  'launcher', 'MemeTokenLaunchedV2', 'always',
  decode(repeat('05', 32), 'hex'), '2026-07-31T05:00:00.700Z'
);
select programmable_private.activate_release_epoch(
  1, 'classic-v3', 'classic-v3', 'core',
  'a1000000-0000-0000-0000-000000000001',
  0, 1, decode(repeat('13', 32), 'hex'),
  '2026-07-31T05:00:01Z'
);
select programmable_private.register_rpc_provider_deployment(
  'b1000000-0000-0000-0000-000000000001',
  1, 'alchemy', 'rpc-provider-v1',
  decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('a3', 32), 'hex'),
  decode(repeat('21', 32), 'hex'), decode(repeat('22', 32), 'hex'),
  decode(repeat('23', 32), 'hex'), '2026-07-31T05:00:02Z'
);
select programmable_private.register_rpc_provider_deployment(
  'b1000000-0000-0000-0000-000000000002',
  1, 'quicknode', 'rpc-provider-v1',
  decode(repeat('b1', 32), 'hex'), decode(repeat('b2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('b3', 32), 'hex'),
  decode(repeat('24', 32), 'hex'), decode(repeat('25', 32), 'hex'),
  decode(repeat('26', 32), 'hex'), '2026-07-31T05:00:03Z'
);
select programmable_private.register_provider_deployment(
  'b1000000-0000-0000-0000-000000000003',
  'envio_deployment', 'reorg-envio',
  decode(repeat('27', 32), 'hex'), decode(repeat('28', 32), 'hex'),
  decode(repeat('29', 32), 'hex'), '2026-07-31T05:00:04Z'
);
select programmable_private.open_run(
  '6c000000-0000-0000-0000-000000000001',
  'ingestion', 1, 'envio-control', 'envio-control', 'canonical-events',
  '70000000-0000-0000-0000-000000000002', 1,
  'envio-adapter-v1', decode(repeat('30', 32), 'hex'),
  '2026-07-31T05:00:05Z'
);
select programmable_private.open_run(
  'c1000000-0000-0000-0000-000000000001',
  'ingestion', 1, 'classic-v3', 'classic-v3', 'core',
  'a1000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('31', 32), 'hex'),
  '2026-07-31T05:01:00Z'
);
select programmable_private.append_safe_head_observation(
  'd1000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000002',
  1, 1, 120, 120, 12, 108,
  decode(repeat('08', 32), 'hex'), decode(repeat('08', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000110', 'hex'),
  decode(repeat('41', 32), 'hex'),
  '2026-07-31T05:01:01Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'e1000000-0000-0000-0000-000000000070',
  'd1000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000001',
  70, decode(repeat('70', 32), 'hex'), decode(repeat('70', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000210', 'hex'),
  decode(repeat('40', 32), 'hex'), '2026-07-31T05:01:01.500Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'e1000000-0000-0000-0000-000000000080',
  'd1000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000001',
  80, decode(repeat('80', 32), 'hex'), decode(repeat('80', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000211', 'hex'),
  decode(repeat('42', 32), 'hex'), '2026-07-31T05:01:02Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'e1000000-0000-0000-0000-000000000081',
  'd1000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000001',
  81, decode(repeat('81', 32), 'hex'), decode(repeat('81', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000212', 'hex'),
  decode(repeat('43', 32), 'hex'), '2026-07-31T05:01:03Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('70', 32), 'hex'), decode(repeat('60', 32), 'hex'), 1
  ),
  'c1000000-0000-0000-0000-000000000001',
  70, decode(repeat('70', 32), 'hex'), decode(repeat('60', 32), 'hex'),
  1, 1, decode(repeat('62', 20), 'hex'), decode(repeat('63', 32), 'hex'),
  'MemeTokenLaunchedV2', array[decode(repeat('63', 32), 'hex')],
  decode('00', 'hex'), '{"amount":"0"}'::jsonb,
  decode(repeat('64', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('70', 32), 'hex'), decode(repeat('60', 32), 'hex'), 1
  ),
  'b1000000-0000-0000-0000-000000000003',
  decode(repeat('65', 32), 'hex'), '2026-07-31T05:01:03.500Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('80', 32), 'hex'), decode(repeat('61', 32), 'hex'), 7),
  'c1000000-0000-0000-0000-000000000001',
  80,
  decode(repeat('80', 32), 'hex'),
  decode(repeat('61', 32), 'hex'),
  2,
  7,
  decode(repeat('62', 20), 'hex'),
  decode(repeat('63', 32), 'hex'),
  'MemeTokenLaunchedV2',
  array[decode(repeat('63', 32), 'hex'), decode(repeat('64', 32), 'hex')],
  decode('010203', 'hex'),
  '{"amount":"1"}'::jsonb,
  decode(repeat('65', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('80', 32), 'hex'), decode(repeat('61', 32), 'hex'), 7),
  'b1000000-0000-0000-0000-000000000003',
  decode(repeat('66', 32), 'hex'),
  '2026-07-31T05:01:04Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('81', 32), 'hex'), decode(repeat('61', 32), 'hex'), 19),
  'c1000000-0000-0000-0000-000000000001',
  81,
  decode(repeat('81', 32), 'hex'),
  decode(repeat('61', 32), 'hex'),
  3,
  19,
  decode(repeat('62', 20), 'hex'),
  decode(repeat('63', 32), 'hex'),
  'MemeTokenLaunchedV2',
  array[decode(repeat('63', 32), 'hex'), decode(repeat('64', 32), 'hex')],
  decode('010203', 'hex'),
  '{"amount":"1"}'::jsonb,
  decode(repeat('65', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('81', 32), 'hex'), decode(repeat('61', 32), 'hex'), 19),
  'b1000000-0000-0000-0000-000000000003',
  decode(repeat('67', 32), 'hex'),
  '2026-07-31T05:01:05Z'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('70', 32), 'hex'), decode(repeat('60', 32), 'hex'), 1
  ),
  '6c000000-0000-0000-0000-000000000001',
  70, decode(repeat('70', 32), 'hex'), decode(repeat('60', 32), 'hex'),
  1, 1, decode(repeat('62', 20), 'hex'), decode(repeat('63', 32), 'hex'),
  'MemeTokenLaunchedV2', array[decode(repeat('63', 32), 'hex')],
  decode('00', 'hex'), '{"amount":"0"}'::jsonb,
  decode(repeat('64', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('70', 32), 'hex'), decode(repeat('60', 32), 'hex'), 1
  ),
  'b1000000-0000-0000-0000-000000000003',
  decode(repeat('65', 32), 'hex'), '2026-07-31T05:01:05.100Z',
  'canonical-events', 'ReorgLauncher'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('80', 32), 'hex'), decode(repeat('61', 32), 'hex'), 7
  ),
  '6c000000-0000-0000-0000-000000000001',
  80, decode(repeat('80', 32), 'hex'), decode(repeat('61', 32), 'hex'),
  2, 7, decode(repeat('62', 20), 'hex'), decode(repeat('63', 32), 'hex'),
  'MemeTokenLaunchedV2',
  array[decode(repeat('63', 32), 'hex'), decode(repeat('64', 32), 'hex')],
  decode('010203', 'hex'), '{"amount":"1"}'::jsonb,
  decode(repeat('65', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('80', 32), 'hex'), decode(repeat('61', 32), 'hex'), 7
  ),
  'b1000000-0000-0000-0000-000000000003',
  decode(repeat('66', 32), 'hex'), '2026-07-31T05:01:05.200Z',
  'canonical-events', 'ReorgLauncher'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('81', 32), 'hex'), decode(repeat('61', 32), 'hex'), 19
  ),
  '6c000000-0000-0000-0000-000000000001',
  81, decode(repeat('81', 32), 'hex'), decode(repeat('61', 32), 'hex'),
  3, 19, decode(repeat('62', 20), 'hex'), decode(repeat('63', 32), 'hex'),
  'MemeTokenLaunchedV2',
  array[decode(repeat('63', 32), 'hex'), decode(repeat('64', 32), 'hex')],
  decode('010203', 'hex'), '{"amount":"1"}'::jsonb,
  decode(repeat('65', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('81', 32), 'hex'), decode(repeat('61', 32), 'hex'), 19
  ),
  'b1000000-0000-0000-0000-000000000003',
  decode(repeat('67', 32), 'hex'), '2026-07-31T05:01:05.300Z',
  'canonical-events', 'ReorgLauncher'
);
select programmable_private.resolve_envio_candidate(
  '6d000000-0000-0000-0000-000000000070',
  'c1000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('70', 32), 'hex'), decode(repeat('60', 32), 'hex'), 1
  ),
  'a1100000-0000-0000-0000-000000000001', null,
  decode(repeat('68', 32), 'hex'), decode(repeat('70', 32), 'hex'),
  '2026-07-31T05:01:05.400Z'
);
select programmable_private.resolve_envio_candidate(
  '6d000000-0000-0000-0000-000000000080',
  'c1000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('80', 32), 'hex'), decode(repeat('61', 32), 'hex'), 7
  ),
  'a1100000-0000-0000-0000-000000000001', null,
  decode(repeat('68', 32), 'hex'), decode(repeat('71', 32), 'hex'),
  '2026-07-31T05:01:05.500Z'
);
select programmable_private.resolve_envio_candidate(
  '6d000000-0000-0000-0000-000000000081',
  'c1000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('81', 32), 'hex'), decode(repeat('61', 32), 'hex'), 19
  ),
  'a1100000-0000-0000-0000-000000000001', null,
  decode(repeat('68', 32), 'hex'), decode(repeat('72', 32), 'hex'),
  '2026-07-31T05:01:05.600Z'
);
select programmable_private.append_chain_event_occurrence(
  'f0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000070',
  'c1000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('70', 32), 'hex'), decode(repeat('60', 32), 'hex'), 1
  ),
  0, '2026-07-31T04:58:00Z', 'decoder-v1',
  decode(repeat('68', 32), 'hex'),
  'e1000000-0000-0000-0000-000000000070', 1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a7631000f', 'hex'),
  decode(repeat('68', 32), 'hex'), '2026-07-31T05:01:05.700Z'
);
select programmable_private.append_chain_event_occurrence(
  'f1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000080',
  'c1000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('80', 32), 'hex'), decode(repeat('61', 32), 'hex'), 7), 0, '2026-07-31T04:59:00Z', 'decoder-v1',
  decode(repeat('68', 32), 'hex'),
  'e1000000-0000-0000-0000-000000000080',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310010', 'hex'),
  decode(repeat('69', 32), 'hex'), '2026-07-31T05:01:06Z'
);
select programmable_private.append_chain_event_occurrence(
  'f1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000081',
  'c1000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('81', 32), 'hex'), decode(repeat('61', 32), 'hex'), 19), 0, '2026-07-31T04:59:12Z', 'decoder-v1',
  decode(repeat('68', 32), 'hex'),
  'e1000000-0000-0000-0000-000000000081',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310011', 'hex'),
  decode(repeat('6a', 32), 'hex'), '2026-07-31T05:01:07Z'
);

select programmable_private.acquire_projector_lease(
  1, 'classic-v3', 'classic-v3', 'core', 'projector-v1',
  'a1000000-0000-0000-0000-000000000001', 1,
  0, 1, decode(repeat('aa', 32), 'hex'), 'worker-a',
  '2026-07-31T05:02:00Z', '2026-07-31T05:12:00Z',
  decode(repeat('ab', 32), 'hex')
);
select programmable_private.open_run(
  '70000000-0000-0000-0000-000000000070',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  'a1000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('70', 32), 'hex'),
  '2026-07-31T05:02:00.100Z'
);
select programmable_private.stage_launch_projection(
  '84000000-0000-0000-0000-000000000070',
  '70000000-0000-0000-0000-000000000070',
  decode(repeat('a0', 20), 'hex'), decode(repeat('a2', 20), 'hex'),
  decode(repeat('60', 32), 'hex'), decode(repeat('a0', 32), 'hex'),
  null, decode(repeat('a5', 32), 'hex'),
  'Origin Token', 'ORG', 1000000,
  'f0000000-0000-0000-0000-000000000070',
  70, decode(repeat('70', 32), 'hex'), '2026-07-31T05:02:00.200Z'
);
select programmable_private.stage_pool_projection(
  '84100000-0000-0000-0000-000000000070',
  '84000000-0000-0000-0000-000000000070',
  '70000000-0000-0000-0000-000000000070',
  decode(repeat('00', 20), 'hex'), decode(repeat('a0', 20), 'hex'),
  3000, 60, decode(repeat('a4', 20), 'hex'),
  'f0000000-0000-0000-0000-000000000070',
  70, decode(repeat('70', 32), 'hex'), '2026-07-31T05:02:00.300Z'
);
select programmable_private.stage_pool_fee_configuration(
  '84200000-0000-0000-0000-000000000070',
  '84100000-0000-0000-0000-000000000070',
  '70000000-0000-0000-0000-000000000070',
  100, 100, 90, 10, 0, 0,
  'f0000000-0000-0000-0000-000000000070',
  70, decode(repeat('70', 32), 'hex'), '2026-07-31T05:02:00.400Z'
);
select programmable_private.stage_launch_occurrence_role(
  '84000000-0000-0000-0000-000000000070', 'launcher',
  'f0000000-0000-0000-0000-000000000070', '2026-07-31T05:02:00.500Z'
);
select programmable_private.stage_launch_projection_conditions(
  '84000000-0000-0000-0000-000000000070', false,
  '2026-07-31T05:02:00.600Z'
);
select programmable_private.promote_projection_run(
  '81000000-0000-0000-0000-000000000070',
  '82000000-0000-0000-0000-000000000070',
  '83000000-0000-0000-0000-000000000070',
  '70000000-0000-0000-0000-000000000070',
  'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
  0, 1, 0,
  'd1000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000070',
  70, decode(repeat('70', 32), 'hex'), 1,
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('70', 32), 'hex'), decode(repeat('60', 32), 'hex'), 1
  ),
  array['f0000000-0000-0000-0000-000000000070'::uuid],
  array[]::uuid[], array[]::uuid[],
  array['6d000000-0000-0000-0000-000000000070'::uuid],
  array['explore-list']::text[],
  decode(repeat('84', 32), 'hex'), '2026-07-31T05:02:00.700Z'
);
select programmable_private.open_run(
  '71000000-0000-0000-0000-000000000001',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  'a1000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('71', 32), 'hex'),
  '2026-07-31T05:02:01Z'
);
select programmable_private.stage_launch_projection(
  '84000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  decode(repeat('a1', 20), 'hex'), decode(repeat('a2', 20), 'hex'),
  decode(repeat('61', 32), 'hex'), decode(repeat('a3', 32), 'hex'),
  null, decode(repeat('a5', 32), 'hex'),
  'Reorg Token', 'RGT', 1000000,
  'f1000000-0000-0000-0000-000000000080',
  80, decode(repeat('80', 32), 'hex'), '2026-07-31T05:02:02Z'
);
select programmable_private.stage_pool_projection(
  '84100000-0000-0000-0000-000000000001',
  '84000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  decode(repeat('00', 20), 'hex'), decode(repeat('a1', 20), 'hex'),
  3000, 60, decode(repeat('a4', 20), 'hex'),
  'f1000000-0000-0000-0000-000000000080',
  80, decode(repeat('80', 32), 'hex'), '2026-07-31T05:02:02.100Z'
);
select programmable_private.stage_pool_fee_configuration(
  '84200000-0000-0000-0000-000000000001',
  '84100000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  100, 100, 90, 10, 0, 0,
  'f1000000-0000-0000-0000-000000000080',
  80, decode(repeat('80', 32), 'hex'), '2026-07-31T05:02:02.200Z'
);
select programmable_private.stage_launch_occurrence_role(
  '84000000-0000-0000-0000-000000000001', 'launcher',
  'f1000000-0000-0000-0000-000000000080', '2026-07-31T05:02:02.300Z'
);
select programmable_private.stage_launch_projection_conditions(
  '84000000-0000-0000-0000-000000000001', false,
  '2026-07-31T05:02:02.400Z'
);
select programmable_private.promote_projection_run(
  '81000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
  1, 2, 0,
  'd1000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000080',
  80, decode(repeat('80', 32), 'hex'), 7,
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('80', 32), 'hex'), decode(repeat('61', 32), 'hex'), 7
  ),
  array['f1000000-0000-0000-0000-000000000080'::uuid],
  array[]::uuid[], array[]::uuid[],
  array['6d000000-0000-0000-0000-000000000080'::uuid],
  array['explore-list']::text[],
  decode(repeat('85', 32), 'hex'), '2026-07-31T05:02:03Z'
);

select programmable_private.open_run(
  '72000000-0000-0000-0000-000000000001',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  'a1000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('72', 32), 'hex'),
  '2026-07-31T05:03:00Z'
);
select programmable_private.stage_launch_projection(
  '84000000-0000-0000-0000-000000000002',
  '72000000-0000-0000-0000-000000000001',
  decode(repeat('a1', 20), 'hex'), decode(repeat('a2', 20), 'hex'),
  decode(repeat('61', 32), 'hex'), decode(repeat('a3', 32), 'hex'),
  null, decode(repeat('a5', 32), 'hex'),
  'Reorg Token', 'RGT', 1000000,
  'f1000000-0000-0000-0000-000000000081',
  81, decode(repeat('81', 32), 'hex'), '2026-07-31T05:03:01Z'
);
select programmable_private.stage_pool_projection(
  '84100000-0000-0000-0000-000000000002',
  '84000000-0000-0000-0000-000000000002',
  '72000000-0000-0000-0000-000000000001',
  decode(repeat('00', 20), 'hex'), decode(repeat('a1', 20), 'hex'),
  3000, 60, decode(repeat('a4', 20), 'hex'),
  'f1000000-0000-0000-0000-000000000081',
  81, decode(repeat('81', 32), 'hex'), '2026-07-31T05:03:01.100Z'
);
select programmable_private.stage_pool_fee_configuration(
  '84200000-0000-0000-0000-000000000002',
  '84100000-0000-0000-0000-000000000002',
  '72000000-0000-0000-0000-000000000001',
  100, 100, 90, 10, 0, 0,
  'f1000000-0000-0000-0000-000000000081',
  81, decode(repeat('81', 32), 'hex'), '2026-07-31T05:03:01.200Z'
);
select programmable_private.stage_launch_occurrence_role(
  '84000000-0000-0000-0000-000000000002', 'launcher',
  'f1000000-0000-0000-0000-000000000081', '2026-07-31T05:03:01.300Z'
);
select programmable_private.stage_launch_projection_conditions(
  '84000000-0000-0000-0000-000000000002', false,
  '2026-07-31T05:03:01.400Z'
);

reset role;

select plan(21);

select is(
  (select count(*) from programmable_private.chain_event_identities),
  2::bigint,
  'one origin identity plus one logical identity spanning both fork placements'
);
select is(
  (select count(*) from programmable_private.chain_event_occurrences),
  3::bigint,
  'the origin and both fork occurrences are retained'
);
select is(
  (
    select array_agg(block_global_log_index order by block_number)::text
    from programmable_private.chain_event_occurrences
  ),
  '{1,7,19}',
  'block-global log index is retained but is not logical identity'
);
select is(
  (
    select occurrence_id
    from programmable_private.chain_event_current_canonical
    where logical_event_id = 'f1000000-0000-0000-0000-000000000001'
  ),
  'f1000000-0000-0000-0000-000000000080'::uuid,
  'first promotion selects exactly one current placement'
);
set local role programmable_projector;
select throws_ok(
  $sql$
    select programmable_private.promote_projection_run(
      '81000000-0000-0000-0000-000000000002',
      '82000000-0000-0000-0000-000000000002',
      '83000000-0000-0000-0000-000000000002',
      '72000000-0000-0000-0000-000000000001',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      2, 3, 0,
      'd1000000-0000-0000-0000-000000000001',
      'e1000000-0000-0000-0000-000000000081',
      81, decode(repeat('81', 32), 'hex'), 19,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('81', 32), 'hex'), decode(repeat('61', 32), 'hex'), 19
      ),
      array['f1000000-0000-0000-0000-000000000081'::uuid],
      array[]::uuid[], array[]::uuid[],
      array['6d000000-0000-0000-0000-000000000081'::uuid],
      array['explore-list']::text[],
      decode(repeat('86', 32), 'hex'), '2026-07-31T05:03:02Z'
    )
  $sql$,
  '23505',
  'a competing placement cannot replace current state without rewind'
);
reset role;
select is(
  (
    select occurrence_id
    from programmable_private.chain_event_current_canonical
    where logical_event_id = 'f1000000-0000-0000-0000-000000000001'
  ),
  'f1000000-0000-0000-0000-000000000080'::uuid,
  'failed competing promotion leaves the canonical pointer unchanged'
);
select is(
  (
    select checkpoint_generation
    from programmable_private.projector_checkpoint_current
    where chain_id = 1 and release_id = 'classic-v3'
  ),
  2::bigint,
  'failed competing promotion cannot advance the checkpoint'
);
select is(
  (
    select count(*)
    from programmable_private.run_lifecycle_outcomes
    where run_id = '72000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'failed promotion rolls back its terminal outcome'
);

set local role programmable_projector;
select programmable_private.create_release_epoch(
  'a2000000-0000-0000-0000-000000000001',
  1, 'classic-v3', 'classic-v3', 'core', 2,
  decode(repeat('14', 32), 'hex'),
  decode(repeat('11', 32), 'hex'),
  decode(repeat('15', 32), 'hex'),
  '2026-07-31T05:04:00Z'
);
select programmable_private.append_release_source_binding(
  'a2100000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'reorg-launcher-v2', 'launcher', 'ethereum_contract',
  decode(repeat('62', 20), 'hex'), null, 70,
  decode(repeat('68', 32), 'hex'), decode(repeat('11', 32), 'hex'),
  decode(repeat('17', 32), 'hex'), decode(repeat('18', 32), 'hex'),
  '2026-07-31T05:04:00.500Z'
);
select programmable_private.append_release_projection_event_rule(
  rule_id, 'a2000000-0000-0000-0000-000000000001', projection_kind,
  'launcher', 'MemeTokenLaunchedV2', commitment, '2026-07-31T05:04:00.600Z'
)
from (values
  ('a2200000-0000-0000-0000-000000000001'::uuid, 'launch', decode(repeat('06', 32), 'hex')),
  ('a2200000-0000-0000-0000-000000000002'::uuid, 'pool', decode(repeat('07', 32), 'hex')),
  ('a2200000-0000-0000-0000-000000000003'::uuid, 'pool_fee_configuration', decode(repeat('08', 32), 'hex')),
  ('a2200000-0000-0000-0000-000000000004'::uuid, 'launch_requirement', decode(repeat('09', 32), 'hex'))
) as rule(rule_id, projection_kind, commitment);
select programmable_private.append_release_launch_requirement(
  'a2300000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001', 0,
  'launcher', 'MemeTokenLaunchedV2', 'always',
  decode(repeat('0a', 32), 'hex'), '2026-07-31T05:04:00.700Z'
);
select programmable_private.activate_release_epoch(
  1, 'classic-v3', 'classic-v3', 'core',
  'a2000000-0000-0000-0000-000000000001',
  1, 2, decode(repeat('16', 32), 'hex'),
  '2026-07-31T05:04:01Z'
);
select programmable_private.open_run(
  '73000000-0000-0000-0000-000000000001',
  'ingestion', 1, 'classic-v3', 'classic-v3', 'core',
  'a2000000-0000-0000-0000-000000000001', 2,
  'projector-v1', decode(repeat('73', 32), 'hex'),
  '2026-07-31T05:04:02Z'
);
select programmable_private.append_safe_head_observation(
  'd2000000-0000-0000-0000-000000000001',
  '73000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000002',
  1, 1, 120, 120, 12, 108,
  decode(repeat('08', 32), 'hex'), decode(repeat('08', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000120', 'hex'),
  decode(repeat('44', 32), 'hex'), '2026-07-31T05:04:03Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'e2000000-0000-0000-0000-000000000070',
  'd2000000-0000-0000-0000-000000000001',
  '73000000-0000-0000-0000-000000000001',
  70, decode(repeat('70', 32), 'hex'), decode(repeat('70', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000221', 'hex'),
  decode(repeat('45', 32), 'hex'), '2026-07-31T05:04:04Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  'e2000000-0000-0000-0000-000000000082',
  'd2000000-0000-0000-0000-000000000001',
  '73000000-0000-0000-0000-000000000001',
  82, decode(repeat('82', 32), 'hex'), decode(repeat('82', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000222', 'hex'),
  decode(repeat('46', 32), 'hex'), '2026-07-31T05:04:05Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('82', 32), 'hex'), decode(repeat('61', 32), 'hex'), 22),
  '73000000-0000-0000-0000-000000000001',
  82,
  decode(repeat('82', 32), 'hex'),
  decode(repeat('61', 32), 'hex'),
  4,
  22,
  decode(repeat('62', 20), 'hex'),
  decode(repeat('63', 32), 'hex'),
  'MemeTokenLaunchedV2',
  array[decode(repeat('63', 32), 'hex'), decode(repeat('64', 32), 'hex')],
  decode('010203', 'hex'),
  '{"amount":"1"}'::jsonb,
  decode(repeat('65', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('82', 32), 'hex'), decode(repeat('61', 32), 'hex'), 22),
  'b1000000-0000-0000-0000-000000000003',
  decode(repeat('6b', 32), 'hex'),
  '2026-07-31T05:04:06Z'
);
select programmable_private.append_release_neutral_envio_candidate(
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('82', 32), 'hex'), decode(repeat('61', 32), 'hex'), 22
  ),
  '6c000000-0000-0000-0000-000000000001',
  82, decode(repeat('82', 32), 'hex'), decode(repeat('61', 32), 'hex'),
  4, 22, decode(repeat('62', 20), 'hex'), decode(repeat('63', 32), 'hex'),
  'MemeTokenLaunchedV2',
  array[decode(repeat('63', 32), 'hex'), decode(repeat('64', 32), 'hex')],
  decode('010203', 'hex'), '{"amount":"1"}'::jsonb,
  decode(repeat('65', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('82', 32), 'hex'), decode(repeat('61', 32), 'hex'), 22
  ),
  'b1000000-0000-0000-0000-000000000003',
  decode(repeat('6b', 32), 'hex'), '2026-07-31T05:04:06.100Z',
  'canonical-events', 'ReorgLauncher'
);
select programmable_private.resolve_envio_candidate(
  '6e000000-0000-0000-0000-000000000080',
  '73000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('80', 32), 'hex'), decode(repeat('61', 32), 'hex'), 7
  ),
  'a2100000-0000-0000-0000-000000000001', null,
  decode(repeat('68', 32), 'hex'), decode(repeat('73', 32), 'hex'),
  '2026-07-31T05:04:06.200Z'
);
select programmable_private.resolve_envio_candidate(
  '6e000000-0000-0000-0000-000000000081',
  '73000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('81', 32), 'hex'), decode(repeat('61', 32), 'hex'), 19
  ),
  'a2100000-0000-0000-0000-000000000001', null,
  decode(repeat('68', 32), 'hex'), decode(repeat('74', 32), 'hex'),
  '2026-07-31T05:04:06.300Z'
);
select programmable_private.resolve_envio_candidate(
  '6e000000-0000-0000-0000-000000000082',
  '73000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('82', 32), 'hex'), decode(repeat('61', 32), 'hex'), 22
  ),
  'a2100000-0000-0000-0000-000000000001', null,
  decode(repeat('68', 32), 'hex'), decode(repeat('75', 32), 'hex'),
  '2026-07-31T05:04:06.400Z'
);
select programmable_private.append_chain_event_occurrence(
  'f1000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000082',
  '73000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('82', 32), 'hex'), decode(repeat('61', 32), 'hex'), 22), 0, '2026-07-31T04:59:24Z', 'decoder-v1',
  decode(repeat('68', 32), 'hex'),
  'e2000000-0000-0000-0000-000000000082',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310020', 'hex'),
  decode(repeat('6c', 32), 'hex'), '2026-07-31T05:04:07Z'
);
select programmable_private.acquire_projector_lease(
  1, 'classic-v3', 'classic-v3', 'core', 'projector-v1',
  'a2000000-0000-0000-0000-000000000001', 2,
  1, 2, decode(repeat('bb', 32), 'hex'), 'worker-b',
  '2026-07-31T05:05:00Z', '2026-07-31T05:15:00Z',
  decode(repeat('bc', 32), 'hex')
);
select programmable_private.open_run(
  '74000000-0000-0000-0000-000000000001',
  'rewind', 1, 'classic-v3', 'classic-v3', 'core',
  'a2000000-0000-0000-0000-000000000001', 2,
  'projector-v1', decode(repeat('74', 32), 'hex'),
  '2026-07-31T05:05:01Z'
);
select programmable_private.rewind_projection_run(
  '82000000-0000-0000-0000-000000000002',
  '83000000-0000-0000-0000-000000000003',
  '74000000-0000-0000-0000-000000000001',
  'projector-v1', 2, decode(repeat('bb', 32), 'hex'),
  2, 3, 1,
  'd2000000-0000-0000-0000-000000000001',
  'e2000000-0000-0000-0000-000000000070',
  70, decode(repeat('70', 32), 'hex'), 1,
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('70', 32), 'hex'), decode(repeat('60', 32), 'hex'), 1
  ),
  decode(repeat('87', 32), 'hex'), '2026-07-31T05:05:02Z'
);

reset role;

select is(
  (
    select count(*) from programmable_private.chain_event_current_canonical
    where logical_event_id = 'f1000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'higher-generation rewind removes the old canonical pointer'
);
select is(
  (
    select count(*)
    from programmable_private.chain_event_occurrence_status_history
    where occurrence_id = 'f1000000-0000-0000-0000-000000000080'
      and status = 'orphaned'
  ),
  1::bigint,
  'rewind appends an orphan decision without deleting the occurrence'
);
select is(
  (select count(*) from programmable_private.launch_projections),
  1::bigint,
  'rewind preserves its checkpoint baseline and removes rows above the target'
);
select is(
  (
    select concat_ws(
      '/', current.checkpoint_generation, current.reorg_generation,
      checkpoint.block_number,
      checkpoint.pointer_generation
    )
    from programmable_private.projector_checkpoint_current as current
    join programmable_private.projector_checkpoints as checkpoint
      on checkpoint.checkpoint_id = current.checkpoint_id
    where current.chain_id = 1 and current.release_id = 'classic-v3'
  ),
  '3/1/70/2',
  'rewind advances checkpoint and reorg generations under the new pointer'
);
select is(
  (
    select status::text
    from programmable_private.route_eligibility_current
    where route_key = 'explore-list'
  ),
  'ineligible',
  'rewind revokes route eligibility before later publication'
);
set local role programmable_projector;
select throws_ok(
  $sql$
    select programmable_private.promote_projection_run(
      '81000000-0000-0000-0000-000000000003',
      '82000000-0000-0000-0000-000000000003',
      '83000000-0000-0000-0000-000000000004',
      '72000000-0000-0000-0000-000000000001',
      'projector-v1', 1, decode(repeat('aa', 32), 'hex'),
      2, 3, 1,
      'd1000000-0000-0000-0000-000000000001',
      'e1000000-0000-0000-0000-000000000081',
      81, decode(repeat('81', 32), 'hex'), 19,
      programmable_private.derive_envio_candidate_id(
        1, decode(repeat('81', 32), 'hex'), decode(repeat('61', 32), 'hex'), 19
      ),
      array['f1000000-0000-0000-0000-000000000081'::uuid],
      array[]::uuid[], array[]::uuid[],
      array['6d000000-0000-0000-0000-000000000081'::uuid],
      array['explore-list']::text[],
      decode(repeat('88', 32), 'hex'), '2026-07-31T05:05:03Z'
    )
  $sql$,
  '40001',
  'stale pre-reorg run cannot restore its projection or checkpoint'
);

reset role;
set local role programmable_projector;
select programmable_private.open_run(
  '75000000-0000-0000-0000-000000000001',
  'projection', 1, 'classic-v3', 'classic-v3', 'core',
  'a2000000-0000-0000-0000-000000000001', 2,
  'projector-v1', decode(repeat('75', 32), 'hex'),
  '2026-07-31T05:06:00Z'
);
select programmable_private.stage_launch_projection(
  '84000000-0000-0000-0000-000000000003',
  '75000000-0000-0000-0000-000000000001',
  decode(repeat('a1', 20), 'hex'), decode(repeat('a2', 20), 'hex'),
  decode(repeat('61', 32), 'hex'), decode(repeat('a3', 32), 'hex'),
  null, decode(repeat('a5', 32), 'hex'),
  'Reorg Token', 'RGT', 1000000,
  'f2000000-0000-0000-0000-000000000082',
  82, decode(repeat('82', 32), 'hex'), '2026-07-31T05:06:01Z'
);
select programmable_private.stage_pool_projection(
  '84100000-0000-0000-0000-000000000003',
  '84000000-0000-0000-0000-000000000003',
  '75000000-0000-0000-0000-000000000001',
  decode(repeat('00', 20), 'hex'), decode(repeat('a1', 20), 'hex'),
  3000, 60, decode(repeat('a4', 20), 'hex'),
  'f2000000-0000-0000-0000-000000000082',
  82, decode(repeat('82', 32), 'hex'), '2026-07-31T05:06:01.100Z'
);
select programmable_private.stage_pool_fee_configuration(
  '84200000-0000-0000-0000-000000000003',
  '84100000-0000-0000-0000-000000000003',
  '75000000-0000-0000-0000-000000000001',
  100, 100, 90, 10, 0, 0,
  'f2000000-0000-0000-0000-000000000082',
  82, decode(repeat('82', 32), 'hex'), '2026-07-31T05:06:01.200Z'
);
select programmable_private.stage_launch_occurrence_role(
  '84000000-0000-0000-0000-000000000003', 'launcher',
  'f2000000-0000-0000-0000-000000000082', '2026-07-31T05:06:01.300Z'
);
select programmable_private.stage_launch_projection_conditions(
  '84000000-0000-0000-0000-000000000003', false,
  '2026-07-31T05:06:01.400Z'
);
select programmable_private.promote_projection_run(
  '81000000-0000-0000-0000-000000000004',
  '82000000-0000-0000-0000-000000000004',
  '83000000-0000-0000-0000-000000000005',
  '75000000-0000-0000-0000-000000000001',
  'projector-v1', 2, decode(repeat('bb', 32), 'hex'),
  3, 4, 1,
  'd2000000-0000-0000-0000-000000000001',
  'e2000000-0000-0000-0000-000000000082',
  82, decode(repeat('82', 32), 'hex'), 22,
  programmable_private.derive_envio_candidate_id(
    1, decode(repeat('82', 32), 'hex'), decode(repeat('61', 32), 'hex'), 22
  ),
  array['f2000000-0000-0000-0000-000000000082'::uuid],
  array[]::uuid[], array[]::uuid[],
  array[
    '6e000000-0000-0000-0000-000000000080'::uuid,
    '6e000000-0000-0000-0000-000000000081'::uuid,
    '6e000000-0000-0000-0000-000000000082'::uuid
  ],
  array['explore-list']::text[],
  decode(repeat('89', 32), 'hex'), '2026-07-31T05:06:02Z'
);

reset role;

select is(
  (
    select occurrence_id
    from programmable_private.chain_event_current_canonical
    where logical_event_id = 'f1000000-0000-0000-0000-000000000001'
  ),
  'f2000000-0000-0000-0000-000000000082'::uuid,
  'post-rewind promotion switches canonicality to the new occurrence'
);
select is(
  (select count(*) from programmable_private.chain_event_occurrences),
  4::bigint,
  'all historical fork placements survive canonical switching'
);
select is(
  (
    select count(*)
    from programmable_private.chain_event_occurrence_status_history
    where status = 'canonical'
  ),
  3::bigint,
  'canonical choices are append-only history'
);
select is(
  (
    select count(*)
    from programmable_private.chain_event_occurrence_status_history
    where status = 'orphaned'
  ),
  1::bigint,
  'orphan history is retained after replacement promotion'
);
select is(
  (
    select concat_ws(
      '/', current.checkpoint_generation, current.reorg_generation,
      checkpoint.block_number,
      checkpoint.pointer_generation
    )
    from programmable_private.projector_checkpoint_current as current
    join programmable_private.projector_checkpoints as checkpoint
      on checkpoint.checkpoint_id = current.checkpoint_id
    where current.chain_id = 1 and current.release_id = 'classic-v3'
  ),
  '4/1/82/2',
  'post-reorg checkpoint remains fenced by higher pointer and reorg generations'
);
select is(
  (
    select status::text
    from programmable_private.route_eligibility_current
    where route_key = 'explore-list'
  ),
  'eligible',
  'only the new fenced publication restores route eligibility'
);
select is(
  (
    select concat_ws(
      '/', last_source_occurrence_id, pointer_generation, promoted_block_number
    )
    from programmable_private.launch_projections
    where launch_projection_id = '84000000-0000-0000-0000-000000000003'
  ),
  'f2000000-0000-0000-0000-000000000082/2/82',
  'visible launch data is rebuilt from the replacement occurrence'
);

reset role;

select * from finish();
rollback;
