begin;

select plan(13);

select ok(
  not exists (
    with launch_views(view_name) as (
      values ('recent_launches_v1'), ('launch_by_token_v1'),
             ('launches_by_creator_v1')
    ), required(column_name) as (
      values ('currency0'), ('currency1'), ('hook'), ('pool_key_fee'),
             ('tick_spacing'), ('buy_swap_fee_bps'), ('sell_swap_fee_bps'),
             ('buy_creator_fee_bps'), ('sell_creator_fee_bps'),
             ('creator_fee_bps'), ('launcher_fee_bps'), ('transfer_tax_bps'),
             ('lp_fee_pips'), ('project_description'),
             ('project_logo_reference'), ('project_metadata_revision'),
             ('project_links'), ('launch_block_timestamp')
    )
    select 1
    from launch_views
    cross join required
    where not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'programmable_private'
        and relation.relname = launch_views.view_name
        and attribute.attname = required.column_name
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
  ),
  'every launch read surface exposes PoolKey fees latest metadata and launch time'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'programmable_private.recent_launches_v1'::regclass,
      'programmable_private.launch_by_token_v1'::regclass,
      'programmable_private.launches_by_creator_v1'::regclass
    ]) as checked_view(view_oid)
    cross join lateral (
      select pg_catalog.pg_get_viewdef(checked_view.view_oid, false) as definition
    ) as view_definition
    where pg_catalog.strpos(view_definition.definition, 'pool_projections') = 0
       or pg_catalog.strpos(view_definition.definition, 'pool_fee_configurations') = 0
       or pg_catalog.strpos(view_definition.definition, 'current_token_project_metadata_v1') = 0
       or pg_catalog.strpos(view_definition.definition, 'pool_canonical') = 0
       or pg_catalog.strpos(view_definition.definition, 'fee_canonical') = 0
  ),
  'launch DTO joins are exact-run canonical PoolKey fee and current metadata joins'
);

select ok(
  (
    select pg_catalog.strpos(definition, 'metadata_revision') > 0
       and pg_catalog.strpos(definition, 'project_links') > 0
       and pg_catalog.strpos(definition, 'newer') > 0
    from (
      select pg_catalog.pg_get_viewdef(
        'programmable_private.current_token_project_metadata_v1'::regclass,
        false
      ) as definition
    ) as metadata_view
  ),
  'project metadata read model selects only the latest audited revision and links'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'programmable_private.market_snapshots_v1'::regclass,
      'programmable_private.market_candles_v1'::regclass
    ]) as checked_view(view_oid)
    cross join lateral (
      select pg_catalog.pg_get_viewdef(checked_view.view_oid, false) as definition
    ) as view_definition
    where pg_catalog.strpos(view_definition.definition, 'dual_rpc_block_evidence') = 0
       or pg_catalog.strpos(view_definition.definition, 'safe_head_observations') = 0
       or pg_catalog.strpos(view_definition.definition, 'run_lifecycle_outcomes') = 0
       or pg_catalog.strpos(view_definition.definition, 'mismatch_count') = 0
       or pg_catalog.strpos(view_definition.definition, 'uniswap_subgraph') = 0
       or pg_catalog.strpos(view_definition.definition, 'launch_by_token_v1') = 0
       or not has_table_privilege(
         'programmable_api_reader', checked_view.view_oid, 'SELECT'
       )
  ),
  'server market views require exact canonical block successful reconciliation and token route'
);

select ok(
  not exists (
    select required.column_name
    from (values ('pool_id'), ('hook'), ('quote_asset'), ('entitled'))
      as required(column_name)
    where not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid =
        'programmable_private.account_reward_summaries_v1'::regclass
        and attribute.attname = required.column_name
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
  ),
  'profile reward reads expose pool hook quote asset and exact entitled total'
);

select ok(
  (
    select
      pg_catalog.strpos(definition, 'explore-list') > 0
      and pg_catalog.strpos(definition, 'run_headers') > 0
      and pg_catalog.strpos(definition, 'source_group') > 0
      and pg_catalog.strpos(definition, 'release_epoch_current') > 0
      and pg_catalog.strpos(definition, 'route_eligibility_current') > 0
      and pg_catalog.strpos(definition, 'chain_event_current_canonical') > 0
      and pg_catalog.strpos(
        definition,
        'has_current_verified_reward_seed'
      ) > 0
    from (
      select pg_catalog.pg_get_viewdef(
        'programmable_private.recent_launches_v1'::regclass,
        false
      ) as definition
    ) as view_definition
  ),
  'recent launches require the exact Explore-list route and current source scope'
);

select ok(
  (
    select
      pg_catalog.strpos(definition, 'explore-token') > 0
      and pg_catalog.strpos(definition, 'source_group') > 0
      and pg_catalog.strpos(definition, 'chain_event_current_canonical') > 0
      and pg_catalog.strpos(
        definition,
        'has_current_verified_reward_seed'
      ) > 0
    from (
      select pg_catalog.pg_get_viewdef(
        'programmable_private.launch_by_token_v1'::regclass,
        false
      ) as definition
    ) as view_definition
  ),
  'token detail uses its own exact route instead of inheriting list eligibility'
);

select ok(
  (
    select
      pg_catalog.strpos(definition, 'creator-profile') > 0
      and pg_catalog.strpos(definition, 'source_group') > 0
      and pg_catalog.strpos(definition, 'chain_event_current_canonical') > 0
      and pg_catalog.strpos(
        definition,
        'has_current_verified_reward_seed'
      ) > 0
    from (
      select pg_catalog.pg_get_viewdef(
        'programmable_private.launches_by_creator_v1'::regclass,
        false
      ) as definition
    ) as view_definition
  ),
  'creator launches require creator-profile eligibility and a current source'
);

select ok(
  (
    select
      pg_catalog.strpos(definition, 'creator-profile') > 0
      and pg_catalog.strpos(
        definition,
        'has_current_verified_reward_seed'
      ) > 0
      and pg_catalog.strpos(definition, 'release_epoch_current') > 0
      and pg_catalog.strpos(definition, 'chain_event_current_canonical') > 0
    from (
      select pg_catalog.pg_get_viewdef(
        'programmable_private.account_reward_summaries_v1'::regclass,
        false
      ) as definition
    ) as view_definition
  ),
  'account rewards require route eligibility, a verified seed and canonical sources'
);

select ok(
  (
    select
      pg_catalog.strpos(definition, 'classic-v3-profile') > 0
      and pg_catalog.strpos(definition, 'reward_allocation_current_verified') > 0
      and pg_catalog.strpos(definition, 'release_epoch_current') > 0
      and pg_catalog.strpos(definition, 'chain_event_current_canonical') > 0
    from (
      select pg_catalog.pg_get_viewdef(
        'programmable_private.classic_v3_vault_history_v1'::regclass,
        false
      ) as definition
    ) as view_definition
  ),
  'Classic vault history requires exact profile-route, seed, epoch and canonical gates'
);

select ok(
  (
    select
      pg_catalog.strpos(definition, 'creator-profile') > 0
      and pg_catalog.strpos(definition, 'reward_allocation_current_verified') > 0
      and pg_catalog.strpos(definition, 'release_epoch_current') > 0
      and pg_catalog.strpos(definition, 'chain_event_current_canonical') > 0
    from (
      select pg_catalog.pg_get_viewdef(
        'programmable_private.stock_paired_vault_history_v1'::regclass,
        false
      ) as definition
    ) as view_definition
  ),
  'Stock-Paired vault history uses the creator-profile route and current evidence'
);

select ok(
  (
    select
      pg_catalog.strpos(definition, 'launch-lookup') > 0
      and pg_catalog.strpos(definition, 'source_group') > 0
      and pg_catalog.strpos(definition, 'chain_event_current_canonical') > 0
      and pg_catalog.strpos(
        definition,
        'has_current_verified_reward_seed'
      ) > 0
    from (
      select pg_catalog.pg_get_viewdef(
        'programmable_private.launch_lookup_v1'::regclass,
        false
      ) as definition
    ) as view_definition
  ),
  'launch confirmation lookup has independent route and source eligibility'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'programmable_private.recent_launches_v1'::regclass,
      'programmable_private.launch_by_token_v1'::regclass,
      'programmable_private.launches_by_creator_v1'::regclass,
      'programmable_private.account_reward_summaries_v1'::regclass,
      'programmable_private.classic_v3_vault_history_v1'::regclass,
      'programmable_private.stock_paired_vault_history_v1'::regclass,
      'programmable_private.launch_lookup_v1'::regclass
    ]) as checked_view(view_oid)
    cross join lateral (
      select pg_catalog.pg_get_viewdef(checked_view.view_oid, false) as definition
    ) as view_definition
    where pg_catalog.strpos(view_definition.definition, 'eligible') = 0
       or pg_catalog.strpos(view_definition.definition, 'indexed') = 0
       or pg_catalog.strpos(view_definition.definition, 'checkpoint_id') = 0
  ),
  'every route-specific read view binds eligible indexed mode to its publication checkpoint'
);

select * from finish();
rollback;
