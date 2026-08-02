begin;
select plan(19);

create function public.substring_count_v1(p_haystack text, p_needle text)
returns integer
language sql
immutable
strict
set search_path = ''
as $function$
  select (
    (pg_catalog.length(p_haystack) - pg_catalog.length(
      pg_catalog.replace(p_haystack, p_needle, '')
    )) / pg_catalog.length(p_needle)
  )::integer
$function$;

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'programmable_private'
      and class.relname in (
        'provisional_dynamic_parent_receipt_ordinals',
        'dynamic_source_activation_staging',
        'dynamic_source_activation_model_evidence',
        'dynamic_source_activation_consumptions'
      )
      and class.relrowsecurity
      and class.relforcerowsecurity
  ),
  4,
  'all dynamic activation tables force RLS'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as class
      on class.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'programmable_private'
      and class.relname = 'dynamic_source_activation_staging'
      and constraint_record.contype = 'u'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        like '%staging_run_id%'
  ),
  0,
  'one staging run may contain multiple verified activations'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_record.oid)
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as class
      on class.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'programmable_private'
      and class.relname = 'dynamic_source_activation_staging'
      and constraint_record.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        like '%launch_transaction_hash%parent_transaction_hash%'
  ) like '%launch_block_number%parent_block_number%',
  'earlier-block parents fail closed at the storage boundary'
);

select is(
  public.substring_count_v1(
    (
      select pg_catalog.pg_get_functiondef(procedure.oid)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'programmable_private'
        and procedure.proname =
          'resolve_pending_dynamic_source_activations_v1'
    ),
    'staged.reorg_generation = p_expected_reorg_generation'
  ),
  1,
  'resolver excludes staged rows only in the same reorg generation'
);

select is(
  public.substring_count_v1(
    (
      select pg_catalog.pg_get_functiondef(procedure.oid)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'programmable_private'
        and procedure.proname =
          'resolve_pending_dynamic_source_activations_v1'
    ),
    'staged.parent_block_hash = source.factory_block_hash'
  ),
  1,
  'same-address stale-fork staging does not suppress a replacement hash'
);

select ok(
  (
    select pg_catalog.pg_get_functiondef(procedure.oid)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname =
        'stage_verified_dynamic_source_activations_v1'
  ) like '%jsonb_array_length(p_activations) not between 1 and 32%',
  'the atomic stage contract accepts a bounded multi-activation batch'
);

select is(
  public.substring_count_v1(
    (
      select pg_catalog.pg_get_functiondef(procedure.oid)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'programmable_private'
        and procedure.proname =
          'stage_verified_dynamic_source_activations_v1'
    ),
    'inserted_count := inserted_count + 1'
  ),
  2,
  'exact immutable replays count toward the all-or-nothing stage result'
);

select ok(
  (
    select pg_catalog.pg_get_functiondef(procedure.oid)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname =
        'stage_verified_dynamic_source_activations_v1'
  ) like '%provider_b_endpoint_origin_commitment%',
  'stage validation binds the full provider B tuple'
);

select ok(
  (
    select pg_catalog.pg_get_functiondef(procedure.oid)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname =
        'stage_verified_dynamic_source_activations_v1'
  ) like '%dual_rpc_block_evidence%safe_head_observations%',
  'stage validation binds the safe-head observation to block evidence'
);

select is(
  public.substring_count_v1(
    (
      select pg_catalog.pg_get_functiondef(procedure.oid)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'programmable_private'
        and procedure.proname = 'get_projector_verified_reward_seed_v1'
    ),
    'factory_occurrence.verification_run_id = header.run_id'
  ),
  1,
  'factory seed selection binds a noncanonical occurrence to the exact run'
);

select is(
  public.substring_count_v1(
    (
      select pg_catalog.pg_get_functiondef(procedure.oid)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'programmable_private'
        and procedure.proname = 'get_projector_verified_reward_seed_v1'
    ),
    'required_occurrence.verification_run_id = header.run_id'
  ),
  1,
  'every noncanonical required occurrence is bound to the exact run'
);

select ok(
  (
    select pg_catalog.pg_get_functiondef(procedure.oid)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname = 'get_dynamic_activation_seed_requests_v1'
  ) like '%staged.launch_block_hash = p_target_block_hash%'
    and (
      select pg_catalog.pg_get_functiondef(procedure.oid)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'programmable_private'
        and procedure.proname = 'get_dynamic_activation_seed_requests_v1'
    ) like '%launcher.verification_run_id = p_projection_run_id%',
  'same-height old-hash activation rows are not materialization eligible'
);

select ok(
  (
    select pg_catalog.pg_get_functiondef(procedure.oid)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname =
        'consume_matching_dynamic_activations_v1'
  ) like '%Starting from staged activations%'
    and (
      select pg_catalog.pg_get_functiondef(procedure.oid)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'programmable_private'
        and procedure.proname =
          'consume_matching_dynamic_activations_v1'
    ) like '%activation.launch_block_hash = publication.target_block_hash%',
  'consumption counts every exact eligible activation before fact joins'
);

select ok(
  (
    select pg_catalog.pg_get_functiondef(procedure.oid)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'programmable_private'
      and procedure.proname =
        'consume_matching_dynamic_activations_v1'
  ) like '%selected_evidence_id%allocation_evidence_id = selected_evidence_id%',
  'consumption uses the exact current verified evidence row'
);

select is(
  public.substring_count_v1(
    (
      select pg_catalog.pg_get_functiondef(procedure.oid)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'programmable_private'
        and procedure.proname = 'promote_projection_run_v3'
    ),
    'consume_matching_dynamic_activations_v1'
  ),
  1,
  'promotion was extended exactly once'
);

select ok(
  not pg_catalog.has_function_privilege(
    'public',
    'programmable_private.stage_verified_dynamic_source_activations_v1(uuid,text,uuid,bigint,bigint,bigint,bytea,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'PUBLIC cannot stage dynamic activations'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.stage_verified_dynamic_source_activations_v1(uuid,text,uuid,bigint,bigint,bigint,bytea,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'only the projector capability can call the stage contract'
);

select ok(
  not pg_catalog.has_function_privilege(
    'programmable_projector',
    'programmable_private.consume_matching_dynamic_activations_v1(uuid,uuid,uuid,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'activation consumption remains internal to promotion'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'programmable_private'
      and class.relname in (
        'dynamic_source_activation_staging',
        'dynamic_source_activation_model_evidence',
        'dynamic_source_activation_consumptions'
      )
      and pg_catalog.has_table_privilege('public', class.oid, 'SELECT')
  ),
  0,
  'dynamic activation evidence is not publicly readable'
);

select * from finish();
rollback;
