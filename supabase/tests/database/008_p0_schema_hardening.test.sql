begin;

select plan(37);

select ok(
  to_regprocedure(
    'programmable_private.register_rpc_provider_deployment(uuid,bigint,text,text,bytea,bytea,text,bytea,bytea,bytea,bytea,timestamp with time zone)'
  ) is not null,
  'RPC providers have a dedicated metadata-complete registration capability'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.rpc_provider_deployment_metadata'::regclass
      and attribute.attname in (
        'chain_id', 'vendor', 'vendor_order', 'constructor_version',
        'endpoint_url_commitment', 'endpoint_origin_commitment',
        'endpoint_evidence_domain', 'endpoint_evidence_commitment'
      )
      and attribute.attnum > 0
      and not attribute.attisdropped
    group by attribute.attrelid
    having count(*) = 8
  ),
  'RPC deployment metadata records mainnet vendor order, constructor, and endpoint commitments'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.rpc_provider_deployment_metadata'::regclass
      and attribute.attname in (
        'endpoint_url', 'endpoint_origin', 'raw_endpoint_url',
        'raw_endpoint_origin'
      )
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  'production RPC metadata contains no raw endpoint URL or origin fields'
);

select ok(
  exists (
    select 1
    from programmable_private.rpc_endpoint_evidence_domains
    where evidence_domain = 'rpc-endpoint-commitments-v1'
      and enabled
      and definition_commitment <>
        decode(repeat('00', 32), 'hex')
  )
  and exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
      'programmable_private.rpc_provider_deployment_metadata'::regclass
      and constraint_row.contype = 'f'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
        '%endpoint_evidence_domain%rpc_endpoint_evidence_domains%'
  ),
  'endpoint commitments link to a nonzero allowlisted evidence domain'
);

select ok(
  exists (
    select 1
    from programmable_private.fingerprint_encoding_versions
    where fingerprint_domain = 'evidence' and encoding_version = 2
      and definition_commitment = decode(
        '45b8e9d1bf3ffc2e70b7fd612ec2346aef5e74ae08348b699eb68ce0afbc9483',
        'hex'
      )
  )
  and (
    select pg_catalog.jsonb_object_agg(
      evidence_subtype, '0x' || encode(definition_commitment, 'hex')
      order by subtype_tag
    )
    from programmable_private.provider_evidence_encoding_subtypes
    where encoding_version = 2
  ) = jsonb_build_object(
    'safe_head', '0x3a26ae9c9220347568e33b5850ac6f605d120e6443f64e9e8b8742ea8a016f52',
    'block', '0x83948b75a3c05b9d257749f754f09a1b02e658496ba562f36e07bc15be3d7bec',
    'runtime_code', '0x4c191e91130097832a91025e85c2ff3be2705af0e3ea9abc396f09e7cd9dbbc5',
    'dynamic_attestation', '0x206e1f89ad459e55e0591de13eb40856dd94ff62923d76034eba5776706e6de9',
    'log_coverage', '0x4ab7460cb321503613935191917c46872c9e3c9a681b2d4b349b6187f4dc0aec'
  ),
  'SQL allowlist commitments exactly match the independent provider-evidence v2 fixture'
);

select ok(
  to_regprocedure(
    'programmable_private.get_recent_launches_v1(bigint,integer,bigint,bytea,bytea)'
  ) is not null,
  'recent launches exposes a lossless composite cursor'
);

select is(
  (
    select pg_catalog.string_agg(
      procedure.proargnames[argument.ordinality],
      ',' order by argument.ordinality
    )
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.generate_subscripts(
      procedure.proargnames, 1
    ) as argument(ordinality)
    where namespace.nspname = 'programmable_private'
      and procedure.proname = 'get_account_reward_summary_v1'
      and procedure.proargmodes[argument.ordinality] = 't'::"char"
  ),
  'chain_id,account,release_id,model_id,vault,pool_id,hook,quote_asset,entitled,claimable_accrued,claimed_total,promoted_block_number,promoted_block_hash,verified_at',
  'account reward rows carry their authoritative chain and account scope'
);

select ok(
  to_regprocedure(
    'programmable_private.get_recent_launches_v1(bigint,integer,bigint)'
  ) is null,
  'the lossy block-only pagination overload is removed'
);

select ok(
  to_regprocedure(
    'programmable_private.get_projector_runtime_state_v1(bigint,text,text,text,text,text[],text[],bytea[],bytea[])'
  ) is not null,
  'projector has one exact scoped runtime-state reader'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'programmable_private.checkpoint_summary_v1'::regclass
      and attname in ('checkpoint_id', 'source_group', 'projector_version')
      and attnum > 0 and not attisdropped
    group by attrelid
    having count(*) = 3
  )
  and pg_catalog.pg_get_viewdef(
    'programmable_private.checkpoint_summary_v1'::regclass, true
  ) like '%current_checkpoint.checkpoint_id%',
  'readiness exposes and joins the exact canonical checkpoint identity'
);

select ok(
  to_regprocedure(
    'programmable_private.get_projector_release_manifest_v1(bigint,text,text,text,uuid,bigint)'
  ) is not null
  and has_function_privilege(
    'programmable_projector',
    'programmable_private.get_projector_release_manifest_v1(bigint,text,text,text,uuid,bigint)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'programmable_api_reader',
    'programmable_private.get_projector_release_manifest_v1(bigint,text,text,text,uuid,bigint)',
    'EXECUTE'
  ),
  'exact release manifest reader is fenced to the projector capability'
);

select ok(
  to_regprocedure(
    'programmable_private.get_projector_dynamic_source_attestations_v1(bigint,text,text,text,uuid,bigint)'
  ) is not null
  and has_function_privilege(
    'programmable_projector',
    'programmable_private.get_projector_dynamic_source_attestations_v1(bigint,text,text,text,uuid,bigint)',
    'EXECUTE'
  ),
  'projector can recover only exact current asset-bound dynamic attestations'
);

select ok(
  to_regprocedure(
    'programmable_private.list_projector_candidate_dispositions_v1(bigint,text,text,text,uuid,bigint,text,bigint,bytea,numeric,numeric,text,integer,timestamp with time zone)'
  ) is not null
  and has_function_privilege(
    'programmable_projector',
    'programmable_private.list_projector_candidate_dispositions_v1(bigint,text,text,text,uuid,bigint,text,bigint,bytea,numeric,numeric,text,integer,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'programmable_projector',
    'programmable_private.advance_envio_ingestion_cursor_v1(uuid,uuid,text,bigint,bigint,numeric,bytea,numeric,text,bytea,timestamp with time zone)',
    'EXECUTE'
  ),
  'disposition recovery is available while direct cursor advancement stays fenced'
);

select ok(
  to_regclass('programmable_private.dynamic_source_attestations') is not null,
  'dynamic contract sources have an audited append-only attestation ledger'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.release_dynamic_source_templates'::regclass
      and attribute.attname = 'runtime_code_hash'
      and attribute.attnum > 0
      and not attribute.attisdropped
  )
  and exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.release_dynamic_source_templates'::regclass
      and attribute.attname in (
        'deployed_artifact_creation_code_commitment',
        'normalized_runtime_code_hash',
        'immutable_references_commitment',
        'runtime_code_length'
      )
      and attribute.attnum > 0
      and not attribute.attisdropped
    group by attribute.attrelid
    having count(*) = 4
  ),
  'dynamic templates commit to artifact and immutable-normalized runtime shape, not one instance runtime hash'
);

select ok(
  to_regclass(
    'programmable_private.chain_event_occurrence_materializations'
  ) is not null,
  'one global raw occurrence has an append-only exact-scope materialization ledger'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.chain_event_occurrence_materializations'::regclass
      and attribute.attname in (
        'event_type', 'decoder_version', 'abi_event_set_commitment',
        'decoded_payload', 'payload_hash', 'release_binding_id',
        'dynamic_source_attestation_id', 'block_evidence_id'
      )
      and attribute.attnum > 0
      and not attribute.attisdropped
    group by attribute.attrelid
    having count(*) = 8
  ),
  'release-scoped decoding, source binding, and evidence live on each materialization'
);

select ok(
  pg_catalog.pg_get_viewdef(
    'programmable_private.recent_launches_v1'::regclass,
    true
  ) like '%chain_event_materialized_occurrences_v1%'
  and pg_catalog.pg_get_viewdef(
    'programmable_private.classic_v3_vault_history_v1'::regclass,
    true
  ) like '%chain_event_materialized_occurrences_v1%',
  'public read models authorize occurrence scope through exact materializations'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
      'programmable_private.chain_event_occurrence_materializations'::regclass
      and constraint_row.contype = 'u'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
        '%occurrence_id%epoch_id%pointer_generation%'
  ),
  'an occurrence can materialize once per exact epoch generation without duplicating global identity'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.reward_allocation_evidence'::regclass
      and attribute.attname in (
        'constructor_arguments_commitment',
        'local_init_code_hash',
        'create2_salt',
        'local_create2_address'
      )
      and attribute.attnum > 0
      and not attribute.attisdropped
    group by attribute.attrelid
    having count(*) = 4
  ),
  'per-instance CREATE2 evidence keeps constructor arguments, init code, salt, and address separate'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.release_epochs'::regclass
      and attribute.attname = 'artifact_creation_code_commitment'
      and attribute.attnum > 0
      and not attribute.attisdropped
  )
  and not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.release_epochs'::regclass
      and attribute.attname = 'artifact_init_code_commitment'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  'release epochs name the release-wide artifact creation-code commitment precisely'
);

select throws_ok(
  $sql$
    insert into programmable_private.release_dynamic_source_templates (
      dynamic_source_template_id, epoch_id,
      parent_factory_release_binding_id, parent_factory_binding_commitment,
      parent_source_role,
      factory_event_type, deployed_address_field, deployed_source_role,
      deployed_artifact_creation_code_commitment,
      normalized_runtime_code_hash, immutable_references_commitment,
      immutable_binding_spec, immutable_binding_commitment,
      runtime_code_length, abi_event_set_commitment, template_commitment,
      created_at, created_by_audit_id
    ) values (
      '00000000-0000-0000-0000-000000000801',
      '00000000-0000-0000-0000-000000000802',
      '00000000-0000-0000-0000-000000000804',
      decode(repeat('84', 32), 'hex'),
      'vesting_factory', 'VestingWalletDeployed', 'vault', 'vesting_wallet',
      decode(repeat('85', 32), 'hex'), decode(repeat('81', 32), 'hex'),
      decode(repeat('86', 32), 'hex'),
      '{"factoryConfigurationField":"configurationCommitment","bindings":[{"ordinal":"0","offset":"0","length":"20","source":"deployed_address","encoding":"address"}]}'::jsonb,
      decode(repeat('87', 32), 'hex'), 1,
      decode(repeat('82', 32), 'hex'),
      decode(repeat('83', 32), 'hex'), '2026-07-31T00:00:00Z',
      '00000000-0000-0000-0000-000000000803'
    )
  $sql$,
  '23514',
  'dynamic reward vaults and vesting wallets require their exact vault or wallet field'
);

select ok(
  to_regclass('programmable_private.envio_candidate_inbox') is not null,
  'Envio evidence has a release-neutral immutable inbox'
);

select ok(
  to_regclass('programmable_private.envio_candidate_resolutions') is not null,
  'neutral candidates have append-only scoped provenance resolutions'
);

select ok(
  to_regclass('programmable_private.projection_entity_current') is not null,
  'published entity versions have delta-safe current pointers'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'programmable_private.pool_fee_configurations'::regclass
      and attname = 'buy_creator_fee_bps' and attnum > 0 and not attisdropped
  )
  and exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'programmable_private.pool_fee_configurations'::regclass
      and attname = 'sell_creator_fee_bps' and attnum > 0 and not attisdropped
  )
  and to_regprocedure(
    'programmable_private.stage_pool_fee_configuration_v2(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,uuid,numeric,bytea,timestamp with time zone)'
  ) is not null,
  'Classic V3 preserves separate buy and sell creator fee basis points'
);

select ok(
  to_regclass('programmable_private.creator_hook_claim_facts') is not null
  and to_regclass('programmable_private.launcher_hook_claim_facts') is not null
  and to_regclass('programmable_private.creator_fee_checkpoint_facts') is not null
  and to_regclass('programmable_private.reward_configuration_activation_facts') is not null,
  'hook claims checkpoints and reward activations have distinct typed facts'
);

select ok(
  to_regprocedure(
    'programmable_private.append_creator_hook_claim_fact(uuid,uuid,uuid,bytea,bytea,bytea,bytea,bytea,bytea,numeric,timestamp with time zone)'
  ) is not null
  and to_regprocedure(
    'programmable_private.append_launcher_hook_claim_fact(uuid,uuid,uuid,bytea,bytea,bytea,bytea,numeric,timestamp with time zone)'
  ) is not null
  and to_regprocedure(
    'programmable_private.append_creator_fee_checkpoint_fact(uuid,uuid,uuid,bytea,numeric,numeric,numeric,timestamp with time zone)'
  ) is not null
  and to_regprocedure(
    'programmable_private.append_reward_configuration_activation_fact(uuid,uuid,uuid,bytea,bytea,numeric,bytea,bytea,bytea[],numeric[],numeric,timestamp with time zone)'
  ) is not null,
  'typed hook and vault fact writers expose exact capabilities'
);

select ok(
  to_regprocedure(
    'programmable_private.append_release_projection_event_rule(uuid,uuid,text,text,text,bytea,timestamp with time zone)'
  ) is not null
  and to_regprocedure(
    'programmable_private.append_release_launch_requirement(uuid,uuid,integer,text,text,text,bytea,timestamp with time zone)'
  ) is not null,
  'event allowlists and completeness manifests have append-only writers'
);

select ok(
  to_regprocedure(
    'programmable_private.stage_launch_occurrence_role(uuid,text,uuid,timestamp with time zone)'
  ) is not null,
  'launch projections can bind exact manifest occurrence roles'
);

select ok(
  to_regprocedure(
    'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'
  ) is not null,
  'projection writers share a release event-role admission check'
);

select ok(
  to_regclass('programmable_private.release_projection_event_rules') is not null,
  'typed projection writers have immutable release event-role allowlists'
);

select ok(
  to_regclass(
    'programmable_private.release_launch_completeness_requirements'
  ) is not null,
  'launch promotion has immutable release completeness requirements'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.chain_event_occurrences'::regclass
      and attribute.attname = 'dynamic_source_attestation_id'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  'occurrences retain exact dynamic-source provenance'
);

select ok(
  (
    select attribute.atttypid = 'pg_catalog.int8'::regtype
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.launches_by_creator_v1'::regclass
      and attribute.attname = 'launch_transaction_index'
      and attribute.attnum > 0
      and not attribute.attisdropped
  )
  and (
    select attribute.atttypid = 'pg_catalog.int8'::regtype
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.launches_by_creator_v1'::regclass
      and attribute.attname = 'launch_receipt_log_ordinal'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  'creator direct view preserves the full unsigned-32-bit ordinal domain in bigint columns'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
      'programmable_private.chain_event_occurrences'::regclass
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
        '%2147483647%'
  ),
  'occurrence storage has no signed-32-bit narrowing constraint'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid =
      'programmable_private.stock_paired_vault_history_v1'::regclass
      and attribute.attname = 'quote_asset'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  'Stock-Paired vault history exposes quote_asset explicitly'
);

select * from finish();
rollback;
