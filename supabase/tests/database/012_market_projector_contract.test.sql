begin;

select plan(35);

select ok(
  to_regclass(
    'programmable_private.market_projector_runtime_lease_current'
  ) is not null
  and to_regclass(
    'programmable_private.market_projector_runtime_lease_history'
  ) is not null,
  'market projector owns a durable singleton lease and immutable history'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'programmable_private.market_projector_runtime_lease_current'::regclass
  )
  and (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'programmable_private.market_projector_runtime_lease_history'::regclass
  )
  and exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid =
      'programmable_private.market_projector_runtime_lease_history'::regclass
      and tgname = 'reject_immutable_mutation'
      and not tgisinternal
  ),
  'market lease relations force RLS and retain immutable history'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.try_acquire_market_projector_runtime_lease_v1(text,bytea,timestamp with time zone,timestamp with time zone,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.try_acquire_market_projector_runtime_lease_v1(text,bytea,timestamp with time zone,timestamp with time zone,bytea)'::regprocedure,
    'EXECUTE'
  ),
  'only the reconciler capability can acquire the market runtime lease'
);

select ok(
  to_regclass('programmable_private.market_projector_cursor_history')
    is not null
  and to_regclass('programmable_private.market_projector_cursor_current')
    is not null,
  'market projector owns explicit current and append-only cursor relations'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'programmable_private.market_projector_cursor_history'::regclass
  )
  and (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'programmable_private.market_projector_cursor_current'::regclass
  ),
  'market cursor relations force RLS'
);

select ok(
  to_regclass(
    'programmable_private.market_snapshot_lineage_memberships'
  ) is not null
  and to_regclass(
    'programmable_private.market_candle_lineage_memberships'
  ) is not null,
  'snapshot and candle facts have explicit reorg-lineage memberships'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'programmable_private.market_snapshot_lineage_memberships'::regclass
  )
  and (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'programmable_private.market_candle_lineage_memberships'::regclass
  ),
  'market fact lineage relations force RLS'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid =
      'programmable_private.market_projector_cursor_history'::regclass
      and tgname = 'reject_immutable_mutation'
      and not tgisinternal
  ),
  'market cursor history is immutable'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid =
      'programmable_private.market_snapshot_lineage_memberships'::regclass
      and tgname = 'reject_immutable_mutation'
      and not tgisinternal
  )
  and exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid =
      'programmable_private.market_candle_lineage_memberships'::regclass
      and tgname = 'reject_immutable_mutation'
      and not tgisinternal
  ),
  'market fact lineage memberships are immutable'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'programmable_private.global_eth_usd_snapshots'::regclass
      and contype = 'u'
      and pg_catalog.pg_get_constraintdef(oid) =
        'UNIQUE (epoch_id, pointer_generation, block_hash)'
  )
  and exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'programmable_private.global_eth_usd_snapshots'::regclass
      and contype = 'u'
      and pg_catalog.pg_get_constraintdef(oid) =
        'UNIQUE (epoch_id, pointer_generation, result_commitment)'
  ),
  'global prices remain singular for an exact epoch, pointer, and block'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'market_snapshots_reconciliation_fact_key'
      and conrelid = 'programmable_private.market_snapshots'::regclass
      and pg_catalog.strpos(
        pg_catalog.pg_get_constraintdef(oid), 'reconciliation_id'
      ) > 0
  )
  and exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'market_candles_reconciliation_fact_key'
      and conrelid = 'programmable_private.market_candles'::regclass
      and pg_catalog.strpos(
        pg_catalog.pg_get_constraintdef(oid), 'reconciliation_id'
      ) > 0
  )
  and exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'market_block_closes_reconciliation_block_key'
      and conrelid = 'programmable_private.market_block_closes'::regclass
      and pg_catalog.strpos(
        pg_catalog.pg_get_constraintdef(oid), 'reconciliation_id'
      ) > 0
  ),
  'pool market facts can be replayed into a new reconciliation lineage'
);

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_viewdef(
    'programmable_private.market_snapshots_v1'::regclass, true
  ), 'market_snapshot_lineage_memberships') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_viewdef(
    'programmable_private.market_snapshots_v1'::regclass, true
  ), 'current_cursor.reorg_generation = membership.reorg_generation') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_viewdef(
    'programmable_private.market_candles_v1'::regclass, true
  ), 'market_candle_lineage_memberships') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_viewdef(
    'programmable_private.market_candles_v1'::regclass, true
  ), 'current_cursor.reorg_generation = membership.reorg_generation') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_viewdef(
    'programmable_private.market_snapshots_v1'::regclass, true
  ), 'source_tip_checkpoint.reorg_generation = cursor_history.source_reorg_generation') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_viewdef(
    'programmable_private.market_candles_v1'::regclass, true
  ), 'source_tip_checkpoint.reorg_generation = cursor_history.source_reorg_generation') > 0,
  'published market facts require active market and source reorg lineages'
);

select ok(
  to_regprocedure(
    'programmable_private.resolve_market_graph_provider_v1(text,bytea,bytea)'
  ) is not null
  and to_regprocedure(
    'programmable_private.list_market_projector_pools_v1(bigint,text,text,text,text,text,integer)'
  ) is not null
  and to_regprocedure(
    'programmable_private.resolve_market_block_evidence_v1(uuid,numeric,bytea,uuid,uuid)'
  ) is not null
  and to_regprocedure(
    'programmable_private.resolve_market_close_anchor_v1(uuid,bytea,numeric,bytea)'
  ) is not null
  and to_regprocedure(
    'programmable_private.get_market_block_evidence_context_v1(uuid,uuid)'
  ) is not null
  and to_regprocedure(
    'programmable_private.get_market_global_snapshot_v1(uuid,uuid)'
  ) is not null
  and to_regprocedure(
    'programmable_private.list_market_close_anchors_v1(bigint,text,text,text,text,bytea,numeric,numeric,integer,numeric)'
  ) is not null
  and to_regprocedure(
    'programmable_private.resolve_market_candle_close_v1(uuid,bytea,timestamp with time zone,timestamp with time zone)'
  ) is not null
  and to_regprocedure(
    'programmable_private.append_market_snapshot_v2(uuid,uuid,uuid,uuid,bytea,numeric,bytea,numeric,numeric,numeric,numeric,numeric,numeric,timestamp with time zone,bytea)'
  ) is not null
  and to_regprocedure(
    'programmable_private.append_market_snapshot_details_v2(uuid,uuid,text,bigint,uuid,integer,numeric,numeric,numeric,numeric,numeric,bigint,bytea,timestamp with time zone)'
  ) is not null
  and to_regprocedure(
    'programmable_private.append_market_block_close_v2(uuid,uuid,uuid,uuid,bytea,uuid,numeric,numeric,integer,numeric,numeric,numeric,numeric,numeric,numeric,numeric,bigint,uuid,bytea,bytea,timestamp with time zone)'
  ) is not null
  and to_regprocedure(
    'programmable_private.get_market_projector_cursor_v1(bigint,text,text,text,text,bytea)'
  ) is not null
  and to_regprocedure(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'
  ) is not null
  and to_regprocedure(
    'programmable_private.append_market_candle_v2(uuid,uuid,uuid,uuid,bytea,text,timestamp with time zone,timestamp with time zone,numeric,numeric,numeric,numeric,numeric,numeric,numeric,bytea,bytea)'
  ) is not null
  and to_regprocedure(
    'programmable_private.append_market_candle_details_v2(uuid,uuid,text,bigint,uuid,numeric,bigint,bytea,timestamp with time zone)'
  ) is not null,
  'the complete narrow market projector contract exists'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname in (
        'resolve_market_graph_provider_v1',
        'list_market_projector_pools_v1',
        'resolve_market_block_evidence_v1',
        'resolve_market_close_anchor_v1',
        'get_market_block_evidence_context_v1',
        'get_market_global_snapshot_v1',
        'list_market_close_anchors_v1',
        'resolve_market_candle_close_v1',
        'append_market_snapshot_v2',
        'append_market_snapshot_details_v2',
        'append_market_block_close_v2',
        'get_market_projector_cursor_v1',
        'advance_market_projector_cursor_v1',
        'append_market_candle_v2',
        'append_market_candle_details_v2'
      )
      and (
        not procedure.prosecdef
        or not ('search_path=""' = any(procedure.proconfig))
      )
  ),
  'all market projector entrypoints are SECURITY DEFINER with empty search path'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'programmable_private.resolve_market_graph_provider_v1(text,bytea,bytea)'::regprocedure,
      'programmable_private.list_market_projector_pools_v1(bigint,text,text,text,text,text,integer)'::regprocedure,
      'programmable_private.resolve_market_block_evidence_v1(uuid,numeric,bytea,uuid,uuid)'::regprocedure,
      'programmable_private.resolve_market_close_anchor_v1(uuid,bytea,numeric,bytea)'::regprocedure,
      'programmable_private.get_market_block_evidence_context_v1(uuid,uuid)'::regprocedure,
      'programmable_private.get_market_global_snapshot_v1(uuid,uuid)'::regprocedure,
      'programmable_private.list_market_close_anchors_v1(bigint,text,text,text,text,bytea,numeric,numeric,integer,numeric)'::regprocedure,
      'programmable_private.resolve_market_candle_close_v1(uuid,bytea,timestamp with time zone,timestamp with time zone)'::regprocedure,
      'programmable_private.append_market_snapshot_v2(uuid,uuid,uuid,uuid,bytea,numeric,bytea,numeric,numeric,numeric,numeric,numeric,numeric,timestamp with time zone,bytea)'::regprocedure,
      'programmable_private.append_market_snapshot_details_v2(uuid,uuid,text,bigint,uuid,integer,numeric,numeric,numeric,numeric,numeric,bigint,bytea,timestamp with time zone)'::regprocedure,
      'programmable_private.append_market_block_close_v2(uuid,uuid,uuid,uuid,bytea,uuid,numeric,numeric,integer,numeric,numeric,numeric,numeric,numeric,numeric,numeric,bigint,uuid,bytea,bytea,timestamp with time zone)'::regprocedure,
      'programmable_private.get_market_projector_cursor_v1(bigint,text,text,text,text,bytea)'::regprocedure,
      'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure,
      'programmable_private.append_market_candle_v2(uuid,uuid,uuid,uuid,bytea,text,timestamp with time zone,timestamp with time zone,numeric,numeric,numeric,numeric,numeric,numeric,numeric,bytea,bytea)'::regprocedure,
      'programmable_private.append_market_candle_details_v2(uuid,uuid,text,bigint,uuid,numeric,bigint,bytea,timestamp with time zone)'::regprocedure
    ]) as function(oid)
    where not pg_catalog.has_function_privilege(
      'programmable_reconciler', function.oid, 'EXECUTE'
    )
  ),
  'reconciler capability can execute every market projector entrypoint'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_projector', 'programmable_api_reader',
      'programmable_projector_runtime', 'programmable_maintenance'
    ]) as denied(role_name)
    cross join pg_catalog.unnest(array[
      'programmable_private.resolve_market_graph_provider_v1(text,bytea,bytea)'::regprocedure,
      'programmable_private.list_market_projector_pools_v1(bigint,text,text,text,text,text,integer)'::regprocedure,
      'programmable_private.resolve_market_block_evidence_v1(uuid,numeric,bytea,uuid,uuid)'::regprocedure,
      'programmable_private.resolve_market_close_anchor_v1(uuid,bytea,numeric,bytea)'::regprocedure,
      'programmable_private.get_market_block_evidence_context_v1(uuid,uuid)'::regprocedure,
      'programmable_private.get_market_global_snapshot_v1(uuid,uuid)'::regprocedure,
      'programmable_private.list_market_close_anchors_v1(bigint,text,text,text,text,bytea,numeric,numeric,integer,numeric)'::regprocedure,
      'programmable_private.resolve_market_candle_close_v1(uuid,bytea,timestamp with time zone,timestamp with time zone)'::regprocedure,
      'programmable_private.append_market_snapshot_v2(uuid,uuid,uuid,uuid,bytea,numeric,bytea,numeric,numeric,numeric,numeric,numeric,numeric,timestamp with time zone,bytea)'::regprocedure,
      'programmable_private.append_market_snapshot_details_v2(uuid,uuid,text,bigint,uuid,integer,numeric,numeric,numeric,numeric,numeric,bigint,bytea,timestamp with time zone)'::regprocedure,
      'programmable_private.append_market_block_close_v2(uuid,uuid,uuid,uuid,bytea,uuid,numeric,numeric,integer,numeric,numeric,numeric,numeric,numeric,numeric,numeric,bigint,uuid,bytea,bytea,timestamp with time zone)'::regprocedure,
      'programmable_private.get_market_projector_cursor_v1(bigint,text,text,text,text,bytea)'::regprocedure,
      'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure,
      'programmable_private.append_market_candle_v2(uuid,uuid,uuid,uuid,bytea,text,timestamp with time zone,timestamp with time zone,numeric,numeric,numeric,numeric,numeric,numeric,numeric,bytea,bytea)'::regprocedure,
      'programmable_private.append_market_candle_details_v2(uuid,uuid,text,bigint,uuid,numeric,bigint,bytea,timestamp with time zone)'::regprocedure
    ]) as protected(function_oid)
    where pg_catalog.has_function_privilege(
      denied.role_name, protected.function_oid, 'EXECUTE'
    )
  ),
  'browser, service, projector, reader, and maintenance roles are denied'
);

select ok(
  not pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.attach_market_snapshot_lineage_v1(uuid,text,bigint,uuid,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.attach_market_candle_lineage_v1(uuid,text,bigint,uuid,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.market_fact_reconciliation_usable_v1(uuid,uuid)'::regprocedure,
    'EXECUTE'
  ),
  'fact lineage helpers cannot be invoked as standalone runtime capabilities'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_reconciler', 'programmable_projector',
      'programmable_api_reader', 'programmable_projector_runtime'
    ]) as denied(role_name)
    cross join pg_catalog.unnest(array[
      'programmable_private.market_projector_cursor_history'::regclass,
      'programmable_private.market_projector_cursor_current'::regclass,
      'programmable_private.market_snapshot_lineage_memberships'::regclass,
      'programmable_private.market_candle_lineage_memberships'::regclass
    ]) as protected(table_oid)
    where pg_catalog.has_table_privilege(
      denied.role_name, protected.table_oid, 'SELECT,INSERT,UPDATE,DELETE'
    )
  ),
  'no runtime role has direct market cursor table access'
);

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.resolve_market_graph_provider_v1(text,bytea,bytea)'::regprocedure
  ), 'provider_type = ''uniswap_subgraph''') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.resolve_market_graph_provider_v1(text,bytea,bytea)'::regprocedure
  ), 'deployment_commitment = p_deployment_commitment') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.resolve_market_graph_provider_v1(text,bytea,bytea)'::regprocedure
  ), 'schema_commitment = p_schema_commitment') > 0,
  'Graph provider resolution binds type, deployment, and schema commitments'
);

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_pools_v1(bigint,text,text,text,text,text,integer)'::regprocedure
  ), 'projector_checkpoint_current') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_pools_v1(bigint,text,text,text,text,text,integer)'::regprocedure
  ), 'market_projector_cursor_current') > 0
  and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_pools_v1(bigint,text,text,text,text,text,integer)'::regprocedure
  )), 'cursor_history.advanced_at asc nulls first') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_pools_v1(bigint,text,text,text,text,text,integer)'::regprocedure
  ), 'pending_occurrence.block_number > cursor_history.block_number') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_pools_v1(bigint,text,text,text,text,text,integer)'::regprocedure
  ), 'pending_materialization.decoded_payload ->> ''poolId''') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_pools_v1(bigint,text,text,text,text,text,integer)'::regprocedure
  ), 'chain_event_current_canonical') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_pools_v1(bigint,text,text,text,text,text,integer)'::regprocedure
  ), 'projected_close.last_source_occurrence_id') > 0,
  'pool discovery is bounded, fair, and pending only for pool-specific events'
);

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_pools_v1(bigint,text,text,text,text,text,integer)'::regprocedure
  ), 'launch_by_token_v2') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_viewdef(
    'programmable_private.market_snapshots_v1'::regclass, true
  ), 'launch_by_token_v1') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_viewdef(
    'programmable_private.market_candles_v1'::regclass, true
  ), 'launch_by_token_v1') > 0,
  'market discovery requires liquidity-complete launches and publication stays on gated launch views'
);

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.resolve_market_block_evidence_v1(uuid,numeric,bytea,uuid,uuid)'::regprocedure
  ), 'ambiguous market block identity') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.resolve_market_block_evidence_v1(uuid,numeric,bytea,uuid,uuid)'::regprocedure
  ), 'observation.provider_a_id = p_provider_a_id') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.resolve_market_block_evidence_v1(uuid,numeric,bytea,uuid,uuid)'::regprocedure
  ), 'observation.provider_b_id = p_provider_b_id') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.get_market_block_evidence_context_v1(uuid,uuid)'::regprocedure
  ), 'rpc_provider_deployment_metadata') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.get_market_block_evidence_context_v1(uuid,uuid)'::regprocedure
  ), 'metadata_a.vendor_order = 1') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.get_market_block_evidence_context_v1(uuid,uuid)'::regprocedure
  ), 'metadata_b.vendor_order = 2') > 0,
  'block evidence binds hashes and exact ordered RPC endpoint evidence'
);

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.resolve_market_close_anchor_v1(uuid,bytea,numeric,bytea)'::regprocedure
  ), 'chain_event_current_canonical') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.resolve_market_close_anchor_v1(uuid,bytea,numeric,bytea)'::regprocedure
  ), 'is_market_fee_event_v1') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.resolve_market_close_anchor_v1(uuid,bytea,numeric,bytea)'::regprocedure
  ), 'decoded_payload ->> ''poolId''') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_close_anchors_v1(bigint,text,text,text,text,bytea,numeric,numeric,integer,numeric)'::regprocedure
  ), 'chain_event_current_canonical') > 0
  and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_close_anchors_v1(bigint,text,text,text,text,bytea,numeric,numeric,integer,numeric)'::regprocedure
  )), 'order by occurrence.block_number') > 0,
  'close anchors and pages are canonical, exact-pool, and deterministic'
);

select ok(
  pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure
  )), 'for update') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure
  ), 'market cursor CAS lost') > 0,
  'cursor advancement locks and uses explicit CAS generations'
);

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure
  ), 'market cursor target lineage is incomplete') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure
  ), 'market cursor coverage contains a close gap') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure
  ), 'legacy market lineage backfill is incomplete') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure
  ), 'market page lineage is incomplete') > 0,
  'cursor fails closed on missing facts, closes, or lineage membership'
);

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure
  ), 'global_snapshot.block_evidence_id = snapshot.block_evidence_id') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure
  ), 'close_outcome.status = ''succeeded''') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.append_market_snapshot_details_v2(uuid,uuid,text,bigint,uuid,integer,numeric,numeric,numeric,numeric,numeric,bigint,bytea,timestamp with time zone)'::regprocedure
  ), 'global_snapshot.block_evidence_id = snapshot.block_evidence_id') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.append_market_block_close_v2(uuid,uuid,uuid,uuid,bytea,uuid,numeric,numeric,integer,numeric,numeric,numeric,numeric,numeric,numeric,numeric,bigint,uuid,bytea,bytea,timestamp with time zone)'::regprocedure
  ), 'is_market_fee_event_v1') > 0
  and not pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.append_market_snapshot_details_v1(uuid,uuid,integer,numeric,numeric,numeric,numeric,numeric,bigint,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.append_market_block_close_v1(uuid,uuid,uuid,uuid,bytea,uuid,numeric,numeric,integer,numeric,numeric,numeric,numeric,numeric,numeric,numeric,bigint,uuid,bytea,bytea,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'market facts require exact block prices and only usable canonical closes'
);

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure
  ), 'header.epoch_id <> previous_cursor.epoch_id') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure
  ), 'p_source_reorg_generation >') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.advance_market_projector_cursor_v1(uuid,uuid,text,text,bytea,bigint,bigint,bigint,bigint,uuid,bigint,bigint,uuid,numeric,bytea,text,timestamp with time zone,timestamp with time zone,bytea,timestamp with time zone)'::regprocedure
  ), 'p_next_reorg_generation <> p_expected_reorg_generation + 1') > 0,
  'rebuilds require a current epoch, pointer, or source reorg transition plus one cursor generation'
);

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.append_market_candle_details_v2(uuid,uuid,text,bigint,uuid,numeric,bigint,bytea,timestamp with time zone)'::regprocedure
  ), 'candidate.reconciliation_id = p_reconciliation_id') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.append_market_candle_details_v2(uuid,uuid,text,bigint,uuid,numeric,bigint,bytea,timestamp with time zone)'::regprocedure
  ), 'canonical.occurrence_id = candidate.last_source_occurrence_id') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.append_market_candle_details_v2(uuid,uuid,text,bigint,uuid,numeric,bigint,bytea,timestamp with time zone)'::regprocedure
  ), 'close_outcome.status = ''succeeded''') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.append_market_candle_details_v2(uuid,uuid,text,bigint,uuid,numeric,bigint,bytea,timestamp with time zone)'::regprocedure
  ), 'later_close.market_block_close_id') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.append_market_candle_details_v2(uuid,uuid,text,bigint,uuid,numeric,bigint,bytea,timestamp with time zone)'::regprocedure
  ), 'p_fees_usd, p_transaction_count') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.append_market_candle_details_v2(uuid,uuid,text,bigint,uuid,numeric,bigint,bytea,timestamp with time zone)'::regprocedure
  ), 'close_fact.fees_usd, close_fact.transaction_count') = 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.resolve_market_candle_close_v1(uuid,bytea,timestamp with time zone,timestamp with time zone)'::regprocedure
  ), 'close_fact.reconciliation_id = p_reconciliation_id') > 0,
  'candle finalization accepts current or succeeded closes and only the last close in-period'
);

set local role programmable_reconciler;

select ok(
  (
    select acquired
    from programmable_private.try_acquire_market_projector_runtime_lease_v1(
      'market-projector:test', decode(repeat('31', 32), 'hex'),
      statement_timestamp(), statement_timestamp() + interval '90 seconds',
      decode(repeat('32', 32), 'hex')
    )
  )
  and not (
    select acquired
    from programmable_private.try_acquire_market_projector_runtime_lease_v1(
      'market-projector:overlap', decode(repeat('33', 32), 'hex'),
      statement_timestamp(), statement_timestamp() + interval '90 seconds',
      decode(repeat('34', 32), 'hex')
    )
  )
  and programmable_private.assert_market_projector_runtime_lease_v1(
    'market-projector:test', 1, decode(repeat('31', 32), 'hex')
  )
  and programmable_private.release_market_projector_runtime_lease_v1(
    'market-projector:test', 1, decode(repeat('31', 32), 'hex'),
    clock_timestamp(), decode(repeat('35', 32), 'hex')
  ),
  'market lease serializes overlapping runs and fences the active holder'
);

select throws_ok(
  $sql$
    select * from programmable_private.list_market_projector_pools_v1(
      1, 'classic-v3', 'classic', 'core', 'runtime-v1', 'market-v1', 0
    )
  $sql$,
  '22023',
  'invalid market pool page',
  'zero-sized pool pages fail closed'
);

select throws_ok(
  $sql$
    select programmable_private.resolve_market_block_evidence_v1(
      gen_random_uuid(), -1, decode(repeat('11', 32), 'hex'),
      gen_random_uuid(), gen_random_uuid()
    )
  $sql$,
  '22023',
  'invalid market block evidence lookup',
  'negative evidence blocks fail before any lookup'
);

select throws_ok(
  $sql$
    select * from programmable_private.get_market_projector_cursor_v1(
      1, 'classic-v3', 'classic', 'core', 'market-v1',
      decode(repeat('11', 31), 'hex')
    )
  $sql$,
  '22023',
  'invalid market cursor identity',
  'malformed pool identities fail closed'
);

select throws_ok(
  $sql$
    select programmable_private.resolve_market_graph_provider_v1(
      'missing-provider', decode(repeat('11', 32), 'hex'),
      decode(repeat('22', 32), 'hex')
    )
  $sql$,
  '23503',
  'exact market provider is not registered',
  'unregistered Graph commitments cannot be substituted'
);

select throws_ok(
  $sql$
    select * from programmable_private.market_projector_cursor_current
  $sql$,
  '42501',
  null,
  'reconciler cannot bypass the cursor API with direct reads'
);

reset role;

select ok(
  (
    select count(*) = 0
    from programmable_private.market_projector_cursor_history
  ) and (
    select count(*) = 0
    from programmable_private.market_projector_cursor_current
  ),
  'failed adversarial calls leave no cursor state'
);

select * from finish();
rollback;
