begin;

select plan(22);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname like 'programmable_%' and rolbypassrls
  ),
  'no custom role has BYPASSRLS'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname in (
      'programmable_migrator', 'programmable_projector',
      'programmable_reconciler', 'programmable_api_reader',
      'programmable_profile_binder', 'programmable_profile_recovery',
      'programmable_profile_writer', 'programmable_maintenance'
    )
      and rolcanlogin
  )
  and not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname in (
      'programmable_api_reader_login', 'programmable_projector_login',
      'programmable_reconciler_login'
    )
      and (
        not rolcanlogin or rolinherit or rolsuper or rolcreatedb
        or rolcreaterole or rolreplication or rolbypassrls
      )
  ),
  'capability roles are NOLOGIN and gateway roles are unprivileged NOINHERIT logins'
);

select is(
  (
    select pg_catalog.array_agg(
      member_role.rolname || '->' || granted_role.rolname
      order by member_role.rolname
    )
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    where member_role.rolname in (
      'programmable_api_reader_login', 'programmable_projector_login',
      'programmable_reconciler_login'
    )
      and not membership.admin_option
      and not membership.inherit_option
      and membership.set_option
  ),
  array[
    'programmable_api_reader_login->programmable_api_reader',
    'programmable_projector_login->programmable_projector',
    'programmable_reconciler_login->programmable_reconciler'
  ]::text[],
  'each gateway has exactly one SET-only non-admin capability membership'
);

select ok(
  not has_schema_privilege(
    'programmable_api_reader_login', 'programmable_private', 'USAGE'
  )
  and not has_schema_privilege(
    'programmable_projector_login', 'programmable_private', 'USAGE'
  )
  and not has_schema_privilege(
    'programmable_reconciler_login', 'programmable_private', 'USAGE'
  ),
  'gateway sessions have no private-schema capability before explicit SET ROLE'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    join pg_catalog.pg_roles as owner_role on owner_role.oid = class.relowner
    where namespace.nspname = 'programmable_private'
      and class.relkind in ('r', 'p', 'v', 'S')
      and owner_role.rolname <> 'programmable_migrator'
  ),
  'migrator owns every private table, view and sequence'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_type as type
    join pg_catalog.pg_namespace as namespace on namespace.oid = type.typnamespace
    join pg_catalog.pg_roles as owner_role on owner_role.oid = type.typowner
    where namespace.nspname = 'programmable_private'
      and owner_role.rolname <> 'programmable_migrator'
  ),
  'migrator owns every private type and domain'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as function
    join pg_catalog.pg_namespace as namespace on namespace.oid = function.pronamespace
    join pg_catalog.pg_roles as owner_role on owner_role.oid = function.proowner
    where namespace.nspname = 'programmable_private'
      and owner_role.rolname <> 'programmable_migrator'
  ),
  'migrator owns every private function'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'programmable_private'
      and class.relkind in ('r', 'p')
      and (not class.relrowsecurity or not class.relforcerowsecurity)
  ),
  'every private base table enables and forces RLS'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as class on class.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'programmable_private'
      and (
        policy.polroles <> array[
          (select oid from pg_catalog.pg_roles where rolname = 'programmable_migrator')
        ]::oid[]
        or policy.polcmd <> '*'
      )
  ),
  'RLS policies target only the migrator owner'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    cross join unnest(array[
      'anon', 'authenticated', 'service_role',
      'programmable_api_reader', 'programmable_projector',
      'programmable_reconciler', 'programmable_profile_binder',
      'programmable_profile_recovery', 'programmable_profile_writer',
      'programmable_maintenance'
    ]) as checked_role(role_name)
    where namespace.nspname = 'programmable_private'
      and class.relkind in ('r', 'p')
      and (
        has_table_privilege(checked_role.role_name, class.oid, 'SELECT')
        or has_table_privilege(checked_role.role_name, class.oid, 'INSERT')
        or has_table_privilege(checked_role.role_name, class.oid, 'UPDATE')
        or has_table_privilege(checked_role.role_name, class.oid, 'DELETE')
        or has_table_privilege(checked_role.role_name, class.oid, 'TRUNCATE')
      )
  ),
  'browser and runtime roles have no base-table privileges'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    cross join unnest(array[
      'anon', 'authenticated', 'service_role',
      'programmable_api_reader', 'programmable_projector',
      'programmable_reconciler', 'programmable_profile_binder',
      'programmable_profile_recovery', 'programmable_profile_writer',
      'programmable_maintenance'
    ]) as checked_role(role_name)
    where namespace.nspname = 'programmable_private'
      and class.relkind = 'S'
      and (
        has_sequence_privilege(checked_role.role_name, class.oid, 'USAGE')
        or has_sequence_privilege(checked_role.role_name, class.oid, 'SELECT')
        or has_sequence_privilege(checked_role.role_name, class.oid, 'UPDATE')
      )
  ),
  'runtime roles cannot use private sequences'
);

select ok(
  not has_schema_privilege('anon', 'programmable_private', 'USAGE')
  and not has_schema_privilege('authenticated', 'programmable_private', 'USAGE')
  and not has_schema_privilege('service_role', 'programmable_private', 'USAGE'),
  'Data API roles have no private-schema usage'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as function
    join pg_catalog.pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'programmable_private'
      and has_function_privilege('public', function.oid, 'EXECUTE')
  ),
  'PUBLIC cannot execute any private function'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as function
    join pg_catalog.pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'programmable_private'
      and function.prosecdef
      and not ('search_path=""' = any(function.proconfig))
  ),
  'every SECURITY DEFINER function fixes an empty search_path'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'programmable_private'
      and class.relkind = 'v'
      and not (
        'security_barrier=true' = any(class.reloptions)
        and 'security_invoker=false' = any(class.reloptions)
      )
  ),
  'every stable view is definer-mode and security-barrier'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
    where member_role.rolname in (
      'programmable_projector', 'programmable_reconciler',
      'programmable_api_reader', 'programmable_profile_binder',
      'programmable_profile_recovery', 'programmable_profile_writer',
      'programmable_maintenance'
    )
  ),
  'runtime capability roles inherit no roles'
);

select ok(
  has_table_privilege(
    'programmable_api_reader',
    'programmable_private.recent_launches_v1',
    'SELECT'
  )
  and not has_table_privilege(
    'programmable_api_reader',
    'programmable_private.reconciliation_occurrence_summary_v1',
    'SELECT'
  ),
  'API reader receives only named server views'
);

select ok(
  has_table_privilege(
    'programmable_reconciler',
    'programmable_private.reconciliation_occurrence_summary_v1',
    'SELECT'
  )
  and not has_table_privilege(
    'programmable_reconciler',
    'programmable_private.recent_launches_v1',
    'SELECT'
  ),
  'reconciler receives only named reconciliation views'
);

select ok(
  has_function_privilege(
    'programmable_profile_binder',
    'programmable_private.bind_profile_subject(bytea,smallint,bytea,text,bytea,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'programmable_profile_binder',
    'programmable_private.mutate_profile(bytea,smallint,bytea,bigint,bigint,text,text,text,text,bytea,timestamptz)',
    'EXECUTE'
  ),
  'first binder and ordinary writer are separate capabilities'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_default_acl as defaults
    join pg_catalog.pg_roles as owner_role on owner_role.oid = defaults.defaclrole
    left join pg_catalog.pg_namespace as namespace on namespace.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) as acl
    left join pg_catalog.pg_roles as grantee on grantee.oid = acl.grantee
    where owner_role.rolname = 'programmable_migrator'
      and namespace.nspname = 'programmable_private'
      and (
        acl.grantee = 0
        or grantee.rolname in (
          'anon', 'authenticated', 'service_role',
          'programmable_projector', 'programmable_reconciler',
          'programmable_api_reader', 'programmable_profile_binder',
          'programmable_profile_recovery', 'programmable_profile_writer',
          'programmable_maintenance'
        )
      )
  ),
  'migrator default ACLs grant no runtime or PUBLIC privilege'
);

select ok(
  not has_schema_privilege('service_role', 'programmable_private', 'CREATE')
  and not has_schema_privilege('service_role', 'programmable_private', 'USAGE'),
  'managed service_role has zero private-schema grant'
);

select ok(
  has_function_privilege(
    'programmable_projector',
    'programmable_private.get_projector_runtime_state_v1(bigint,text,text,text,text,text[],text[],bytea[],bytea[])',
    'EXECUTE'
  )
  and not has_function_privilege(
    'programmable_api_reader',
    'programmable_private.get_projector_runtime_state_v1(bigint,text,text,text,text,text[],text[],bytea[],bytea[])',
    'EXECUTE'
  )
  and not has_function_privilege(
    'programmable_reconciler',
    'programmable_private.get_projector_runtime_state_v1(bigint,text,text,text,text,text[],text[],bytea[],bytea[])',
    'EXECUTE'
  ),
  'only the projector can read exact scoped CAS and provider runtime state'
);

select * from finish();
rollback;
