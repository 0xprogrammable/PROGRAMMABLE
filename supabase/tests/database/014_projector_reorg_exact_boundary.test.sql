begin;

select plan(16);

select ok(
  to_regprocedure(
    'programmable_private.projector_reorg_invalidates_placement_v1(bigint,bytea,bigint,bigint,bytea,bigint)'
  ) is not null
  and to_regprocedure(
    'programmable_private.projector_reorg_invalidates_projection_run_v1(uuid,bigint,bytea,bigint,bytea,bigint)'
  ) is not null,
  'the exact placement and published-run predicates exist'
);

select ok(
  count(*) = 2
  and pg_catalog.bool_and(
    not procedure_row.prosecdef
    and 'search_path=""' = any(procedure_row.proconfig)
    and (
      (procedure_row.proname =
        'projector_reorg_invalidates_placement_v1'
        and procedure_row.provolatile = 'i')
      or (procedure_row.proname =
        'projector_reorg_invalidates_projection_run_v1'
        and procedure_row.provolatile = 's')
    )
  ),
  'reorg predicates have pinned invoker scope and declared volatility'
)
from pg_catalog.pg_proc as procedure_row
join pg_catalog.pg_namespace as namespace_row
  on namespace_row.oid = procedure_row.pronamespace
where namespace_row.nspname = 'programmable_private'
  and procedure_row.proname in (
    'projector_reorg_invalidates_placement_v1',
    'projector_reorg_invalidates_projection_run_v1'
  );

select ok(
  not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.projector_reorg_invalidates_placement_v1(bigint,bytea,bigint,bigint,bytea,bigint)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.projector_reorg_invalidates_placement_v1(bigint,bytea,bigint,bigint,bytea,bigint)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.projector_reorg_invalidates_projection_run_v1(uuid,bigint,bytea,bigint,bytea,bigint)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.projector_reorg_invalidates_projection_run_v1(uuid,bigint,bytea,bigint,bytea,bigint)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.delete_projector_projection_replay_scope_v1(bigint,text,text,bigint,bytea,bigint)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.delete_projector_projection_replay_scope_v1(bigint,text,text,bigint,bytea,bigint)'::regprocedure,
    'EXECUTE'
  ),
  'internal reorg cleanup helpers are not projector capabilities'
);

select is(
  programmable_private.projector_reorg_invalidates_placement_v1(
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), 7,
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), 7
  ),
  false,
  'a history target preserves its exact chain placement'
);

select is(
  programmable_private.projector_reorg_invalidates_placement_v1(
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), 6,
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), 7
  ),
  false,
  'a history target preserves earlier logs on the same block hash'
);

select is(
  programmable_private.projector_reorg_invalidates_placement_v1(
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), 8,
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), 7
  ),
  true,
  'a history target invalidates later logs on the same block hash'
);

select is(
  programmable_private.projector_reorg_invalidates_placement_v1(
    100, pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'), 7,
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), 7
  ),
  true,
  'a history target invalidates the same log index on another block hash'
);

select is(
  programmable_private.projector_reorg_invalidates_placement_v1(
    100, pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'), 1,
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), 7
  ),
  true,
  'a history target invalidates an earlier log on another block hash'
);

select is(
  programmable_private.projector_reorg_invalidates_placement_v1(
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), 9,
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), null
  ),
  false,
  'a genesis target preserves rows on its exact block hash without a log fence'
);

select is(
  programmable_private.projector_reorg_invalidates_placement_v1(
    100, pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'), 9,
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), null
  ),
  true,
  'a genesis target invalidates same-height rows on another block hash'
);

select is(
  programmable_private.projector_reorg_invalidates_placement_v1(
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), null,
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), null
  ),
  false,
  'materialized state on the ancestor block hash survives replay cleanup'
);

select is(
  programmable_private.projector_reorg_invalidates_placement_v1(
    100, pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'), null,
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), null
  ),
  true,
  'materialized state on a stale same-height fork is rebuilt'
);

select ok(
  programmable_private.projector_reorg_invalidates_placement_v1(
    101, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), 0,
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), null
  )
  and not programmable_private.projector_reorg_invalidates_placement_v1(
    99, pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'), 0,
    100, pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'), null
  ),
  'height ordering still invalidates descendants and preserves ancestors'
);

with definitions as (
  select procedure_row.proname,
    pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure_row.oid))
      as definition
  from pg_catalog.pg_proc as procedure_row
  join pg_catalog.pg_namespace as namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'programmable_private'
    and procedure_row.proname in (
      'recover_projector_reorg_v1',
      'delete_projector_projection_replay_scope_v1',
      'projector_reorg_invalidates_projection_run_v1'
    )
)
select ok(
  (
    select (
      pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(
        definition, 'projector_reorg_invalidates_placement_v1', ''
      ))
    ) / pg_catalog.length('projector_reorg_invalidates_placement_v1') = 2
    from definitions
    where proname = 'recover_projector_reorg_v1'
  )
  and (
    select (
      pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(
        definition, 'projector_reorg_invalidates_projection_run_v1', ''
      ))
    ) / pg_catalog.length(
      'projector_reorg_invalidates_projection_run_v1'
    ) = 16
    from definitions
    where proname = 'delete_projector_projection_replay_scope_v1'
  )
  and (
    select (
      pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(
        definition, 'projector_reorg_invalidates_placement_v1', ''
      ))
    ) / pg_catalog.length('projector_reorg_invalidates_placement_v1') = 1
    from definitions
    where proname = 'projector_reorg_invalidates_projection_run_v1'
  ),
  'recovery and replay cleanup apply exact placement through published run lineage'
);

with definitions as (
  select procedure_row.proname,
    pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure_row.oid))
      as definition
  from pg_catalog.pg_proc as procedure_row
  join pg_catalog.pg_namespace as namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'programmable_private'
    and procedure_row.proname in (
      'recover_projector_reorg_v1',
      'delete_projector_projection_replay_scope_v1'
    )
)
select ok(
  pg_catalog.strpos(
    (select definition from definitions
      where proname = 'recover_projector_reorg_v1'),
    'delete_projector_projection_replay_scope_v1'
  ) > 0
  and pg_catalog.strpos(
    (select definition from definitions
      where proname = 'delete_projector_projection_replay_scope_v1'),
    'launch_position_liquidity_facts'
  ) > 0
  and pg_catalog.strpos(
    (select definition from definitions
      where proname = 'delete_projector_projection_replay_scope_v1'),
    'baseline_reward_vault_projection_id'
  ) > 0,
  'atomic recovery delegates to FK-ordered launch and reward snapshot cleanup'
);

with cleanup as (
  select pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure_row.oid))
    as definition
  from pg_catalog.pg_proc as procedure_row
  join pg_catalog.pg_namespace as namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'programmable_private'
    and procedure_row.proname =
      'delete_projector_projection_replay_scope_v1'
), restricted_children as (
  select child_table.relname as child_table
  from pg_catalog.pg_constraint as constraint_row
  join pg_catalog.pg_class as child_table
    on child_table.oid = constraint_row.conrelid
  join pg_catalog.pg_class as parent_table
    on parent_table.oid = constraint_row.confrelid
  join pg_catalog.pg_namespace as namespace_row
    on namespace_row.oid = child_table.relnamespace
  where constraint_row.contype = 'f'
    and constraint_row.confdeltype = 'r'
    and namespace_row.nspname = 'programmable_private'
    and parent_table.relname in (
      'launch_projections', 'pool_projections',
      'reward_vault_projections', 'initial_buy_custody_projections'
    )
)
select ok(
  pg_catalog.bool_and(
    pg_catalog.strpos(cleanup.definition, restricted_children.child_table) > 0
  ),
  'replay cleanup names every RESTRICT child in the projection dependency graph'
)
from cleanup cross join restricted_children;

select * from finish();
rollback;
