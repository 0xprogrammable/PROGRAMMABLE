begin;

create function public.ingestion_test_occurrence_preimage()
returns bytea
language sql
stable
security definer
set search_path = ''
as $function$
  select occurrence.canonical_preimage
  from programmable_private.chain_event_occurrences as occurrence
  where occurrence.occurrence_id = '70000000-0000-0000-0000-000000000001'
$function$;

set local role programmable_migrator;
insert into programmable_private.fingerprint_encoding_versions (
  fingerprint_domain, encoding_version, domain_prefix, write_enabled,
  definition_commitment, allowlisted_at
)
values (
  'occurrence', 2,
  decode(
    '70726f6772616d6d61626c653a6f6363757272656e63653a763200',
    'hex'
  ),
  true, decode(repeat('02', 32), 'hex'), '2026-07-31T06:00:00Z'
);
reset role;

set local role programmable_projector;

select programmable_private.create_release_epoch(
  '10000000-0000-0000-0000-000000000001',
  1, 'classic-v3', 'classic-v3', 'core', 1,
  decode(repeat('10', 32), 'hex'),
  decode(repeat('11', 32), 'hex'),
  decode(repeat('12', 32), 'hex'),
  '2026-07-31T06:00:00Z'
);
select programmable_private.append_release_source_binding(
  '11000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'fixture-launcher', 'launcher', 'ethereum_contract',
  decode(repeat('33', 20), 'hex'), null, 25639596,
  decode(repeat('66', 32), 'hex'), decode(repeat('11', 32), 'hex'),
  decode(repeat('14', 32), 'hex'), decode(repeat('15', 32), 'hex'),
  '2026-07-31T06:00:00.500Z'
);
select programmable_private.activate_release_epoch(
  1, 'classic-v3', 'classic-v3', 'core',
  '10000000-0000-0000-0000-000000000001',
  0, 1, decode(repeat('13', 32), 'hex'),
  '2026-07-31T06:00:01Z'
);
select programmable_private.register_rpc_provider_deployment(
  '20000000-0000-0000-0000-000000000001',
  1, 'alchemy', 'rpc-provider-v1',
  decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('a3', 32), 'hex'),
  decode(repeat('21', 32), 'hex'), decode(repeat('22', 32), 'hex'),
  decode(repeat('23', 32), 'hex'), '2026-07-31T06:00:02Z'
);
select programmable_private.register_rpc_provider_deployment(
  '20000000-0000-0000-0000-000000000002',
  1, 'quicknode', 'rpc-provider-v1',
  decode(repeat('b1', 32), 'hex'), decode(repeat('b2', 32), 'hex'),
  'rpc-endpoint-commitments-v1', decode(repeat('b3', 32), 'hex'),
  decode(repeat('24', 32), 'hex'), decode(repeat('25', 32), 'hex'),
  decode(repeat('26', 32), 'hex'), '2026-07-31T06:00:03Z'
);
select programmable_private.register_provider_deployment(
  '20000000-0000-0000-0000-000000000003',
  'envio_deployment', 'envio-mainnet-v1',
  decode(repeat('27', 32), 'hex'), decode(repeat('28', 32), 'hex'),
  decode(repeat('29', 32), 'hex'), '2026-07-31T06:00:04Z'
);
select programmable_private.open_run(
  '30000000-0000-0000-0000-000000000001',
  'ingestion', 1, 'classic-v3', 'classic-v3', 'core',
  '10000000-0000-0000-0000-000000000001', 1,
  'projector-v1', decode(repeat('31', 32), 'hex'),
  '2026-07-31T06:01:00Z'
);
select programmable_private.append_safe_head_observation(
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  1, 1, 25639620, 25639620, 12, 25639608,
  decode(repeat('cc', 32), 'hex'), decode(repeat('cc', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000100', 'hex'),
  decode(repeat('41', 32), 'hex'),
  '2026-07-31T06:01:01Z'
);
select programmable_private.append_dual_rpc_block_evidence(
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  25639596,
  decode(repeat('22', 32), 'hex'), decode(repeat('22', 32), 'hex'),
  2::smallint,
  decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000201', 'hex'),
  decode(repeat('51', 32), 'hex'),
  '2026-07-31T06:01:02Z'
);
select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7),
  '30000000-0000-0000-0000-000000000001',
  25639596,
  decode(repeat('22', 32), 'hex'),
  decode(repeat('11', 32), 'hex'),
  3,
  7,
  decode(repeat('33', 20), 'hex'),
  decode(repeat('44', 32), 'hex'),
  'MemeTokenLaunchedV2',
  array[decode(repeat('aa', 32), 'hex'), decode(repeat('bb', 32), 'hex')],
  decode('010203', 'hex'),
  '{
    "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    "creator": "0x3333333333333333333333333333333333333333",
    "flags": [true, false],
    "nested": {"b": "two", "a": "one"}
  }'::jsonb,
  decode(repeat('55', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7),
  '20000000-0000-0000-0000-000000000003',
  decode(repeat('66', 32), 'hex'),
  '2026-07-31T06:01:03Z'
);
select programmable_private.append_chain_event_occurrence(
  '60000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7), 0, '2026-07-31T02:00:00Z', 'projector-v1.0.0',
  decode(repeat('66', 32), 'hex'),
  '50000000-0000-0000-0000-000000000001',
  1::smallint,
  decode('70726f6772616d6d61626c653a6f6363757272656e63653a76310000000000000000011111111111111111111111111111111111111111111111111111111111111111000000000000000001873aac222222222222222222222222222222222222222222222222222222222222222200000003000000073333333333333333333333333333333333333333444444444444444444444444444444444444444444444444444444444444444400000002aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb00000003010203000000c67b22616d6f756e74223a22313135373932303839323337333136313935343233353730393835303038363837393037383533323639393834363635363430353634303339343537353834303037393133313239363339393335222c2263726561746f72223a22307833333333333333333333333333333333333333333333333333333333333333333333333333333333222c22666c616773223a5b747275652c66616c73655d2c226e6573746564223a7b2261223a226f6e65222c2262223a2274776f227d7d55555555555555555555555555555555555555555555555555555555555555550000001070726f6a6563746f722d76312e302e3066666666666666666666666666666666666666666666666666666666666666660000000a636c61737369632d76330000000a636c61737369632d763300000009313a32323a31313a370000000a32353633393539363a37000000006a6c01a0', 'hex'),
  decode('6fe25eb0a62ea86736aa134ada719976b6166844b98d83b56d478ae409956955', 'hex'),
  '2026-07-31T06:01:04Z'
);

select plan(22);

select throws_ok(
  $sql$
    select programmable_private.append_chain_event_occurrence(
      '60000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7), 0, '2026-07-31T02:00:00Z', 'projector-v1.0.0',
      decode(repeat('67', 32), 'hex'),
      '50000000-0000-0000-0000-000000000001',
      1::smallint,
      public.ingestion_test_occurrence_preimage(),
      decode('6fe25eb0a62ea86736aa134ada719976b6166844b98d83b56d478ae409956955', 'hex'),
      '2026-07-31T06:01:04Z'
    )
  $sql$,
  '23514',
  'an occurrence with an ABI commitment outside its release manifest is rejected'
);

select throws_ok(
  $sql$
    select programmable_private.append_release_source_binding(
      '11000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001',
      'late-source', 'launcher', 'ethereum_contract',
      decode(repeat('34', 20), 'hex'), null, 25639596,
      decode(repeat('67', 32), 'hex'), decode(repeat('11', 32), 'hex'),
      decode(repeat('16', 32), 'hex'), decode(repeat('17', 32), 'hex'),
      '2026-07-31T06:01:04.100Z'
    )
  $sql$,
  '55000',
  'an active release epoch cannot acquire another source binding'
);

select throws_ok(
  $sql$
    select programmable_private.append_release_source_binding(
      '11000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000001',
      'wrong-artifact', 'launcher', 'ethereum_contract',
      decode(repeat('35', 20), 'hex'), null, 25639596,
      decode(repeat('68', 32), 'hex'), decode(repeat('19', 32), 'hex'),
      decode(repeat('18', 32), 'hex'), decode(repeat('19', 32), 'hex'),
      '2026-07-31T06:01:04.200Z'
    )
  $sql$,
  '23514',
  'a source binding cannot change its epoch artifact commitment'
);

select is(
  programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7),
  '30000000-0000-0000-0000-000000000001',
  25639596,
  decode(repeat('22', 32), 'hex'),
  decode(repeat('11', 32), 'hex'),
  3,
  7,
  decode(repeat('33', 20), 'hex'),
  decode(repeat('44', 32), 'hex'),
  'MemeTokenLaunchedV2',
  array[decode(repeat('aa', 32), 'hex'), decode(repeat('bb', 32), 'hex')],
  decode('010203', 'hex'),
  '{
      "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      "creator": "0x3333333333333333333333333333333333333333",
      "flags": [true, false],
      "nested": {"b": "two", "a": "one"}
    }'::jsonb,
  decode(repeat('55', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7),
  '20000000-0000-0000-0000-000000000003',
  decode(repeat('66', 32), 'hex'),
  '2026-07-31T06:01:03Z'
),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7),
  'exact candidate replay returns the existing identity'
);

select is(
  programmable_private.append_chain_event_occurrence(
    '60000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7), 0, '2026-07-31T02:00:00Z', 'projector-v1.0.0',
    decode(repeat('66', 32), 'hex'),
    '50000000-0000-0000-0000-000000000001',
    1::smallint,
    public.ingestion_test_occurrence_preimage(),
    decode('6fe25eb0a62ea86736aa134ada719976b6166844b98d83b56d478ae409956955', 'hex'),
    '2026-07-31T06:01:04Z'
  ),
  '70000000-0000-0000-0000-000000000001'::uuid,
  'exact occurrence replay returns the existing occurrence'
);

select throws_ok(
  $sql$
    select programmable_private.append_chain_event_occurrence(
      '60000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7), 0, '2026-07-31T02:00:00Z', 'projector-v1.0.0',
      decode(repeat('66', 32), 'hex'),
      '50000000-0000-0000-0000-000000000001',
      1::smallint,
      public.ingestion_test_occurrence_preimage() || decode('01', 'hex'),
      decode('6fe25eb0a62ea86736aa134ada719976b6166844b98d83b56d478ae409956955', 'hex'),
      '2026-07-31T06:01:04Z'
    )
  $sql$,
  '23505',
  'changed preimage with original digest is rejected'
);

select throws_ok(
  $sql$
    select programmable_private.append_chain_event_occurrence(
      '60000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7), 0, '2026-07-31T02:00:00Z', 'projector-v1.0.0',
      decode(repeat('66', 32), 'hex'),
      '50000000-0000-0000-0000-000000000001',
      1::smallint,
      public.ingestion_test_occurrence_preimage(),
      decode(repeat('69', 32), 'hex'), '2026-07-31T06:01:04Z'
    )
  $sql$,
  '23505',
  'original preimage with changed digest is rejected'
);

select throws_ok(
  $sql$
    select programmable_private.append_chain_event_occurrence(
      '60000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7), 0, '2026-07-31T02:00:00Z', 'projector-v1.0.0',
      decode(repeat('66', 32), 'hex'),
      '50000000-0000-0000-0000-000000000001',
      1::smallint,
      public.ingestion_test_occurrence_preimage() || decode('02', 'hex'),
      decode(repeat('6a', 32), 'hex'), '2026-07-31T06:01:04Z'
    )
  $sql$,
  '23505',
  'changed occurrence preimage and digest are rejected together'
);

select throws_ok(
  $sql$
    select programmable_private.append_chain_event_occurrence(
      '60000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7), 0, '2026-07-31T02:00:00Z', 'projector-v1.0.0',
      decode(repeat('66', 32), 'hex'),
      '50000000-0000-0000-0000-000000000001',
      2::smallint,
      decode(
        '70726f6772616d6d61626c653a6f6363757272656e63653a76320000',
        'hex'
      ),
      decode(repeat('6b', 32), 'hex'), '2026-07-31T06:01:04Z'
    )
  $sql$,
  '23505',
  'a newly allowlisted version cannot rewrite an existing v1 logical key'
);

select throws_ok(
  $sql$
    select programmable_private.append_chain_event_occurrence(
      '60000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7), 0, '2026-07-31T02:00:00Z', 'projector-v1.0.0',
      decode(repeat('66', 32), 'hex'),
      '50000000-0000-0000-0000-000000000001',
      3::smallint,
      decode(
        '70726f6772616d6d61626c653a6f6363757272656e63653a76330000',
        'hex'
      ),
      decode(repeat('6c', 32), 'hex'), '2026-07-31T06:01:04Z'
    )
  $sql$,
  '22023',
  'an unknown fingerprint encoding version is rejected before replay'
);

select throws_ok(
  $sql$
    select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('81', 32), 'hex'), decode(repeat('71', 32), 'hex'), 8),
  '30000000-0000-0000-0000-000000000001',
  80.1,
  decode(repeat('81', 32), 'hex'),
  decode(repeat('71', 32), 'hex'),
  2,
  8,
  decode(repeat('62', 20), 'hex'),
  decode(repeat('63', 32), 'hex'),
  'MemeTokenLaunchedV2',
  array[decode(repeat('63', 32), 'hex')],
  decode('', 'hex'),
  '{}'::jsonb,
  decode(repeat('65', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('81', 32), 'hex'), decode(repeat('71', 32), 'hex'), 8),
  '20000000-0000-0000-0000-000000000003',
  decode(repeat('72', 32), 'hex'),
  '2026-07-31T06:01:05Z'
)
  $sql$,
  '22023',
  'fractional block number aborts at function entry'
);

reset role;

select is(
  (
    select count(*)
    from programmable_private.release_source_bindings
    where epoch_id = '10000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'failed binding calls leave the immutable source manifest unchanged'
);
select is(
  (
    select count(*)
    from programmable_private.fingerprint_encoding_versions
    where fingerprint_domain = 'occurrence' and encoding_version = 2
  ),
  1::bigint,
  'new codec version is allowlisted without rewriting the stored v1 pair'
);
select is(
  (select count(*) from programmable_private.envio_candidates),
  1::bigint,
  'candidate replay and failed input leave one fact'
);
select is(
  (select count(*) from programmable_private.chain_event_identities),
  1::bigint,
  'logical identity is insert-once'
);
select is(
  (select count(*) from programmable_private.chain_event_occurrences),
  1::bigint,
  'occurrence replay leaves one immutable placement'
);
select is(
  (select count(*) from programmable_private.chain_event_occurrence_status_history),
  1::bigint,
  'exact replay does not duplicate observed status'
);
select is(
  (select raw_data from programmable_private.chain_event_occurrences limit 1),
  decode('010203', 'hex'),
  'raw event data is retained byte-for-byte'
);

set local role programmable_projector;
select programmable_private.append_run_outcome(
  '80000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'succeeded', decode(repeat('80', 32), 'hex'),
  '2026-07-31T06:02:00Z'
);
select throws_ok(
  $sql$
    select programmable_private.append_safe_head_observation(
      '40000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      1, 1, 25639620, 25639620, 12, 25639608,
      decode(repeat('cc', 32), 'hex'), decode(repeat('cc', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000100', 'hex'),
      decode(repeat('41', 32), 'hex'), '2026-07-31T06:02:01Z'
    )
  $sql$,
  '55000',
  'terminal ingestion runs reject safe-head evidence replays'
);
select throws_ok(
  $sql$
    select programmable_private.append_dual_rpc_block_evidence(
      '50000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001', 25639596,
      decode(repeat('22', 32), 'hex'), decode(repeat('22', 32), 'hex'),
      2::smallint,
      decode('70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7632000201', 'hex'),
      decode(repeat('51', 32), 'hex'), '2026-07-31T06:02:02Z'
    )
  $sql$,
  '55000',
  'terminal ingestion runs reject block-evidence replays'
);
select throws_ok(
  $sql$
    select programmable_private.append_envio_candidate(
  programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7),
  '30000000-0000-0000-0000-000000000001',
  25639596,
  decode(repeat('22', 32), 'hex'),
  decode(repeat('11', 32), 'hex'),
  3,
  7,
  decode(repeat('33', 20), 'hex'),
  decode(repeat('44', 32), 'hex'),
  'MemeTokenLaunchedV2',
  array[decode(repeat('aa', 32), 'hex'), decode(repeat('bb', 32), 'hex')],
  decode('010203', 'hex'),
  '{"amount":"115792089237316195423570985008687907853269984665640564039457584007913129639935","creator":"0x3333333333333333333333333333333333333333","flags":[true,false],"nested":{"a":"one","b":"two"}}'::jsonb,
  decode(repeat('55', 32), 'hex'),
  programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7),
  '20000000-0000-0000-0000-000000000003',
  decode(repeat('66', 32), 'hex'),
  '2026-07-31T06:02:03Z'
)
  $sql$,
  '55000',
  'terminal ingestion runs reject raw candidate replays'
);
select throws_ok(
  $sql$
    select programmable_private.append_chain_event_occurrence(
      '60000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      programmable_private.derive_envio_candidate_id(1, decode(repeat('22', 32), 'hex'), decode(repeat('11', 32), 'hex'), 7), 0, '2026-07-31T02:00:00Z', 'projector-v1.0.0',
      decode(repeat('66', 32), 'hex'),
      '50000000-0000-0000-0000-000000000001', 1::smallint,
      public.ingestion_test_occurrence_preimage(),
      decode('6fe25eb0a62ea86736aa134ada719976b6166844b98d83b56d478ae409956955', 'hex'),
      '2026-07-31T06:02:04Z'
    )
  $sql$,
  '55000',
  'terminal ingestion runs reject occurrence replays'
);
reset role;

select * from finish();
rollback;
