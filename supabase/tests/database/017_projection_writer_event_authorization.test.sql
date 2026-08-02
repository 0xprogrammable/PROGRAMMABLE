begin;

select plan(10);

select ok(
  to_regprocedure(
    'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'
  ) is not null,
  'projection event authorization remains at its frozen signature'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'::regprocedure
  ),
  'projection event authorization is stable, SECURITY DEFINER, and has an empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.assert_projection_event_allowed(uuid,uuid,text)',
    'EXECUTE'
  ),
  'the projector capability can authorize projection writers'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_reconciler', 'programmable_api_reader',
      'programmable_profile_binder', 'programmable_profile_recovery',
      'programmable_profile_writer', 'programmable_maintenance',
      'programmable_operator'
    ]) as denied(role_name)
    where pg_catalog.has_function_privilege(
      denied.role_name,
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)',
      'EXECUTE'
    )
  ),
  'browser, reader, profile, maintenance, reconciler, and operator roles remain denied'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'::regprocedure
    ),
    'release_launch_completeness_requirements'
  ) > 0,
  'launch occurrence roles are authorized by the exact completeness requirement'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'::regprocedure
    ),
    'pool-registration'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'::regprocedure
    ),
    'fee-disclosure'
  ) > 0,
  'pool writers map to their exact semantic event rules'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'::regprocedure
    ),
    'reward-vault-deployment'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'::regprocedure
    ),
    'initial-buy-custody'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'::regprocedure
    ),
    'vesting-wallet-deployment'
  ) > 0,
  'reward and custody writers map to their exact semantic event rules'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'::regprocedure
    ),
    'creator-hook-claim'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'::regprocedure
    ),
    'launcher-hook-claim'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'::regprocedure
    ),
    'creator-fee-checkpoint'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.assert_projection_event_allowed(uuid,uuid,text)'::regprocedure
    ),
    'reward-configuration-activation'
  ) > 0,
  'typed fact writers map their SQL names to reviewed semantic event kinds'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.event_fact_context(uuid,uuid,text)'::regprocedure
    ),
    'verification_run_id = p_run_id'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.event_fact_context(uuid,uuid,text)'::regprocedure
    ),
    'chain_event_current_canonical'
  ) > 0,
  'typed facts accept exact same-run verification or an existing canonical source'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run(uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,timestamp with time zone)'::regprocedure
    ),
    'creator_hook_claim_facts'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run(uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,timestamp with time zone)'::regprocedure
    ),
    'candidate_disposition'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_private.promote_projection_run_v3(text,uuid,uuid,uuid,uuid,text,bigint,bytea,bigint,bigint,bigint,uuid,uuid,numeric,bytea,numeric,text,uuid[],uuid[],uuid[],uuid[],text[],bytea,uuid,uuid[],uuid,bytea,timestamp with time zone)'::regprocedure
    ),
    'cardinality(p_occurrence_ids)'
  ) > 0,
  'occurrence-only pages retain typed facts, dispositions, and canonical sources'
);

select * from finish();

rollback;
