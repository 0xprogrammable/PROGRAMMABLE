begin;

select plan(13);

select ok(
  to_regprocedure(
    'programmable_private.list_market_projector_fast_lane_v1(bigint,text,text,integer)'
  ) is not null,
  'fast lane owns a bounded canonical-head discovery function'
);

select ok(
  to_regprocedure(
    'programmable_private.assert_market_projector_fast_lane_v1(bigint,text,text,text,text,text,bytea,uuid,bigint,uuid,bigint,bigint,numeric,bytea,uuid,uuid,bigint,bigint,uuid,uuid,numeric,bytea)'
  ) is not null,
  'fast lane owns an exact source and anchor assertion'
);

select ok(
  to_regprocedure(
    'programmable_private.try_lock_market_projector_pool_v1(bigint,text,text,text,bytea)'
  ) is not null,
  'market writers share a transaction-scoped pool lock'
);

select ok(
  to_regclass(
    'programmable_private.market_block_closes_fast_occurrence_idx'
  ) is not null,
  'fast-lane exact-occurrence exclusion has a scoped lookup index'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.list_market_projector_fast_lane_v1(bigint,text,text,integer)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.list_market_projector_fast_lane_v1(bigint,text,text,integer)'::regprocedure,
    'EXECUTE'
  ),
  'only the reconciler capability can discover fast-lane work'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.assert_market_projector_fast_lane_v1(bigint,text,text,text,text,text,bytea,uuid,bigint,uuid,bigint,bigint,numeric,bytea,uuid,uuid,bigint,bigint,uuid,uuid,numeric,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.assert_market_projector_fast_lane_v1(bigint,text,text,text,text,text,bytea,uuid,bigint,uuid,bigint,bigint,numeric,bytea,uuid,uuid,bigint,bigint,uuid,uuid,numeric,bytea)'::regprocedure,
    'EXECUTE'
  ),
  'only the reconciler capability can assert fast-lane lineage'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_reconciler',
    'programmable_private.try_lock_market_projector_pool_v1(bigint,text,text,text,bytea)'::regprocedure,
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.try_lock_market_projector_pool_v1(bigint,text,text,text,bytea)'::regprocedure,
    'EXECUTE'
  ),
  'only the reconciler capability can take market pool locks'
);

select ok(
  (
    select prosecdef and provolatile = 's'
    from pg_catalog.pg_proc
    where oid =
      'programmable_private.list_market_projector_fast_lane_v1(bigint,text,text,integer)'::regprocedure
  ),
  'fast-lane discovery is stable and security definer'
);

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_fast_lane_v1(bigint,text,text,integer)'::regprocedure
  ), 'where candidate.pool_rank = 1') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_fast_lane_v1(bigint,text,text,integer)'::regprocedure
  ), 'projected_close.release_id = candidate.release_id') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_fast_lane_v1(bigint,text,text,integer)'::regprocedure
  ), 'projected_close.pointer_generation = candidate.pointer_generation') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_fast_lane_v1(bigint,text,text,integer)'::regprocedure
  ), 'projected_close.last_source_occurrence_id') > 0
  and pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'programmable_private.list_market_projector_fast_lane_v1(bigint,text,text,integer)'::regprocedure
  ), 'candidate.anchor_occurrence_id') > 0,
  'discovery ranks the head first and excludes only that current-lineage close'
);

set local role programmable_reconciler;

select throws_ok(
  $sql$
    select * from programmable_private.list_market_projector_fast_lane_v1(
      1, 'runtime-v1', 'market-v1', 0
    )
  $sql$,
  '22023',
  'invalid market projector fast lane page',
  'zero-sized fast-lane pages fail closed'
);

select throws_ok(
  $sql$
    select * from programmable_private.list_market_projector_fast_lane_v1(
      1, 'runtime-v1', 'market-v1', null
    )
  $sql$,
  '22023',
  'invalid market projector fast lane page',
  'null fast-lane limits cannot disable the bound'
);

select throws_ok(
  $sql$
    select programmable_private.try_lock_market_projector_pool_v1(
      1, 'classic-v3', 'classic', 'core', decode(repeat('11', 31), 'hex')
    )
  $sql$,
  '22023',
  'invalid market projector pool lock',
  'malformed pool lock identities fail closed'
);

select ok(
  programmable_private.try_lock_market_projector_pool_v1(
    1, 'classic-v3', 'classic', 'core', decode(repeat('11', 32), 'hex')
  ),
  'a valid pool lock is acquired inside the caller transaction'
);

select * from finish();
rollback;
