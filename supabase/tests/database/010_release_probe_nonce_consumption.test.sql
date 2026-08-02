begin;

select plan(26);

select ok(
  exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'programmable_release_probe_nonce'
      and not rolcanlogin and not rolinherit and not rolsuper
      and not rolcreatedb and not rolcreaterole and not rolreplication
      and not rolbypassrls
  )
  and exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'programmable_release_probe_nonce_login'
      and rolcanlogin and not rolinherit and not rolsuper
      and not rolcreatedb and not rolcreaterole and not rolreplication
      and not rolbypassrls
  )
  and (
    select rolpassword is null
    from pg_catalog.pg_authid
    where rolname = 'programmable_release_probe_nonce_login'
  )
  and not exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    where member_role.rolname = 'programmable_release_probe_nonce'
  ),
  'nonce capability is NOLOGIN and its NOINHERIT gateway starts passwordless'
);

select is(
  (
    select pg_catalog.array_agg(
      member_role.rolname || '->' || granted_role.rolname
      order by member_role.rolname, granted_role.rolname
    )
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    where member_role.rolname = 'programmable_release_probe_nonce_login'
      and not membership.admin_option
      and not membership.inherit_option
      and membership.set_option
  ),
  array[
    'programmable_release_probe_nonce_login->programmable_release_probe_nonce'
  ]::text[],
  'the gateway has one SET-only non-admin capability membership'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_namespace as namespace
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = namespace.nspowner
    where namespace.nspname = 'programmable_release_probe_private'
      and owner_role.rolname = 'programmable_migrator'
  )
  and has_schema_privilege(
    'programmable_release_probe_nonce',
    'programmable_release_probe_private',
    'USAGE'
  )
  and not has_schema_privilege(
    'programmable_release_probe_nonce',
    'programmable_release_probe_private',
    'CREATE'
  )
  and not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_api_reader', 'programmable_projector',
      'programmable_reconciler', 'programmable_profile_binder',
      'programmable_profile_recovery', 'programmable_profile_writer',
      'programmable_maintenance', 'programmable_api_reader_login',
      'programmable_projector_login', 'programmable_reconciler_login',
      'programmable_release_probe_nonce_login'
    ]) as checked_role(role_name)
    where has_schema_privilege(
      checked_role.role_name,
      'programmable_release_probe_private',
      'USAGE'
    ) or has_schema_privilege(
      checked_role.role_name,
      'programmable_release_probe_private',
      'CREATE'
    )
  )
  and not exists (
    select 1
    from pg_catalog.pg_default_acl as defaults
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = defaults.defaclrole
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = defaults.defaclnamespace
    cross join lateral pg_catalog.aclexplode(defaults.defaclacl) as acl
    left join pg_catalog.pg_roles as grantee on grantee.oid = acl.grantee
    where owner_role.rolname = 'programmable_migrator'
      and namespace.nspname = 'programmable_release_probe_private'
      and (
        acl.grantee = 0
        or grantee.rolname <> 'programmable_migrator'
      )
  ),
  'the migrator owns a deny-by-default schema crossed only by the capability'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'programmable_release_probe_private.release_probe_nonce_consumptions_v1'::regclass
      and contype = 'p'
      and pg_catalog.pg_get_constraintdef(oid) =
        'PRIMARY KEY (route_key, nonce_digest)'
  )
  and exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'programmable_release_probe_private'
      and indexname = 'release_probe_nonce_consumptions_v1_expiry_idx'
      and indexdef like '%(route_key, expires_at, nonce_digest)%'
  )
  and (
    select pg_catalog.array_agg(
      enum_value.enumlabel::text order by enum_value.enumsortorder
    )
    from pg_catalog.pg_enum as enum_value
    where enum_value.enumtypid =
      'programmable_release_probe_private.release_probe_route_key_v1'::regtype
  ) = array[
    'explore-list', 'explore-token', 'explore-chart',
    'creator-profile', 'classic-v3-profile', 'launch-lookup'
  ]::text[]
  and not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_api_reader', 'programmable_projector',
      'programmable_reconciler', 'programmable_profile_binder',
      'programmable_profile_recovery', 'programmable_profile_writer',
      'programmable_maintenance', 'programmable_api_reader_login',
      'programmable_projector_login', 'programmable_reconciler_login',
      'programmable_release_probe_nonce',
      'programmable_release_probe_nonce_login'
    ]) as checked_role(role_name)
    where pg_catalog.has_type_privilege(
      checked_role.role_name,
      'programmable_release_probe_private.release_probe_route_key_v1',
      'USAGE'
    )
  ),
  'nonce rows have the exact replay key and bounded-pruning access path'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_class as class
    join pg_catalog.pg_roles as owner_role on owner_role.oid = class.relowner
    where class.oid =
      'programmable_release_probe_private.release_probe_nonce_consumptions_v1'::regclass
      and class.relrowsecurity and class.relforcerowsecurity
      and owner_role.rolname = 'programmable_migrator'
  )
  and exists (
    select 1
    from pg_catalog.pg_policy as policy
    where policy.polrelid =
      'programmable_release_probe_private.release_probe_nonce_consumptions_v1'::regclass
      and policy.polcmd = '*'
      and policy.polroles = array[
        (
          select oid from pg_catalog.pg_roles
          where rolname = 'programmable_migrator'
        )
      ]::oid[]
  ),
  'the private nonce table is migrator-owned with forced owner-only RLS'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_api_reader', 'programmable_projector',
      'programmable_reconciler', 'programmable_profile_binder',
      'programmable_profile_recovery', 'programmable_profile_writer',
      'programmable_maintenance', 'programmable_api_reader_login',
      'programmable_projector_login', 'programmable_reconciler_login',
      'programmable_release_probe_nonce',
      'programmable_release_probe_nonce_login'
    ]) as checked_role(role_name)
    where pg_catalog.has_table_privilege(
      checked_role.role_name,
      'programmable_release_probe_private.release_probe_nonce_consumptions_v1',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
    )
  ),
  'no browser, service, gateway or capability role has base-table access'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = procedure.proowner
    where procedure.oid =
      'programmable_release_probe_private.consume_release_probe_nonce_v1(text,bytea,timestamp with time zone,timestamp with time zone)'::regprocedure
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and 'search_path=""' = any(procedure.proconfig)
      and owner_role.rolname = 'programmable_migrator'
  ),
  'the frozen nonce API is a volatile, empty-search-path migrator definer'
);

select ok(
  pg_catalog.has_function_privilege(
    'programmable_release_probe_nonce',
    'programmable_release_probe_private.consume_release_probe_nonce_v1(text,bytea,timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  )
  and not exists (
    select 1
    from pg_catalog.unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'programmable_api_reader', 'programmable_projector',
      'programmable_reconciler', 'programmable_profile_binder',
      'programmable_profile_recovery', 'programmable_profile_writer',
      'programmable_maintenance', 'programmable_api_reader_login',
      'programmable_projector_login', 'programmable_reconciler_login',
      'programmable_release_probe_nonce_login'
    ]) as checked_role(role_name)
    where pg_catalog.has_function_privilege(
      checked_role.role_name,
      'programmable_release_probe_private.consume_release_probe_nonce_v1(text,bytea,timestamp with time zone,timestamp with time zone)',
      'EXECUTE'
    )
  ),
  'only the dedicated capability can execute nonce consumption'
);

select ok(
  pg_catalog.obj_description(
    'programmable_release_probe_private.consume_release_probe_nonce_v1(text,bytea,timestamp with time zone,timestamp with time zone)'::regprocedure,
    'pg_proc'
  ) like '%session_user programmable_release_probe_nonce_login%'
  and pg_catalog.obj_description(
    'programmable_release_probe_private.consume_release_probe_nonce_v1(text,bytea,timestamp with time zone,timestamp with time zone)'::regprocedure,
    'pg_proc'
  ) like '%verify current_role%'
  and pg_catalog.obj_description(
    'programmable_release_probe_private.consume_release_probe_nonce_v1(text,bytea,timestamp with time zone,timestamp with time zone)'::regprocedure,
    'pg_proc'
  ) like '%SET LOCAL ROLE programmable_release_probe_nonce%',
  'database documentation freezes the exact gateway session and role preflight'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_release_probe_private.consume_release_probe_nonce_v1(text,bytea,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'on conflict (route_key, nonce_digest) do nothing'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_release_probe_private.consume_release_probe_nonce_v1(text,bytea,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'pg_catalog.pg_advisory_xact_lock(1347571538, route_lock_slot)'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_release_probe_private.consume_release_probe_nonce_v1(text,bytea,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'limit 256'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'programmable_release_probe_private.consume_release_probe_nonce_v1(text,bytea,timestamp with time zone,timestamp with time zone)'::regprocedure
    ),
    'limit 4096'
  ) > 0,
  'atomic insert, route serialization, bounded prune and hard capacity are structural'
);

set role programmable_release_probe_nonce;
select throws_ok(
  $sql$
    select programmable_release_probe_private.consume_release_probe_nonce_v1(
      'explore-list', decode(repeat('01', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '2 minutes'
    )
  $sql$,
  '42501',
  'a privileged postgres session cannot impersonate only the capability role'
);
reset role;

set session authorization programmable_release_probe_nonce_login;
set role programmable_release_probe_nonce;

select ok(
  session_user::text = 'programmable_release_probe_nonce_login'
  and current_role::text = 'programmable_release_probe_nonce',
  'runtime preflight observes the exact login and explicitly selected role'
);

select ok(
  programmable_release_probe_private.consume_release_probe_nonce_v1(
    'explore-list', decode(repeat('11', 32), 'hex'),
    clock_timestamp(), clock_timestamp() + interval '2 minutes'
  ),
  'a fresh valid nonce is consumed once'
);

select ok(
  not programmable_release_probe_private.consume_release_probe_nonce_v1(
    'explore-list', decode(repeat('11', 32), 'hex'),
    clock_timestamp(), clock_timestamp() + interval '2 minutes'
  ),
  'a replay on the same route returns false'
);

select ok(
  programmable_release_probe_private.consume_release_probe_nonce_v1(
    'explore-token', decode(repeat('11', 32), 'hex'),
    clock_timestamp(), clock_timestamp() + interval '2 minutes'
  ),
  'the same digest is independent across supported routes'
);

select throws_ok(
  $sql$
    select programmable_release_probe_private.consume_release_probe_nonce_v1(
      'unsupported', decode(repeat('12', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '2 minutes'
    )
  $sql$,
  '22023',
  'unsupported routes are rejected'
);

select throws_ok(
  $sql$
    select programmable_release_probe_private.consume_release_probe_nonce_v1(
      'explore-list', decode(repeat('12', 31), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '2 minutes'
    )
  $sql$,
  '22023',
  'non-SHA-256 digest lengths are rejected'
);

select throws_ok(
  $sql$
    select programmable_release_probe_private.consume_release_probe_nonce_v1(
      'explore-list', decode(repeat('13', 32), 'hex'),
      clock_timestamp() - interval '2 minutes',
      clock_timestamp() - interval '1 minute'
    )
  $sql$,
  '22023',
  'expired envelopes are rejected using database time'
);

select throws_ok(
  $sql$
    select programmable_release_probe_private.consume_release_probe_nonce_v1(
      'explore-list', decode(repeat('14', 32), 'hex'),
      clock_timestamp() + interval '31 seconds',
      clock_timestamp() + interval '2 minutes'
    )
  $sql$,
  '22023',
  'issued-at future skew is limited to thirty seconds'
);

select throws_ok(
  $sql$
    select programmable_release_probe_private.consume_release_probe_nonce_v1(
      'explore-list', decode(repeat('15', 32), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '5 minutes 1 second'
    )
  $sql$,
  '22023',
  'nonce TTL is capped at five minutes'
);

reset role;
set session authorization postgres;

set role programmable_migrator;
insert into programmable_release_probe_private.release_probe_nonce_consumptions_v1 (
  route_key, nonce_digest, issued_at, expires_at, consumed_at
)
select
  'explore-chart',
  decode(pg_catalog.lpad(pg_catalog.to_hex(series.value), 64, '0'), 'hex'),
  clock_timestamp() - interval '10 minutes',
  clock_timestamp() - interval '9 minutes',
  clock_timestamp() - interval '9 minutes 30 seconds'
from pg_catalog.generate_series(1, 300) as series(value);

insert into programmable_release_probe_private.release_probe_nonce_consumptions_v1 (
  route_key, nonce_digest, issued_at, expires_at, consumed_at
) values (
  'explore-chart', decode(repeat('ab', 32), 'hex'),
  clock_timestamp(), clock_timestamp() + interval '4 minutes',
  clock_timestamp()
);
reset role;

set session authorization programmable_release_probe_nonce_login;
set role programmable_release_probe_nonce;
select ok(
  programmable_release_probe_private.consume_release_probe_nonce_v1(
    'explore-chart', decode(repeat('ee', 32), 'hex'),
    clock_timestamp(), clock_timestamp() + interval '2 minutes'
  ),
  'a valid call runs the bounded expiry prune before consumption'
);
reset role;
set session authorization postgres;

select is(
  (
    select pg_catalog.count(*)
    from programmable_release_probe_private.release_probe_nonce_consumptions_v1
    where route_key = 'explore-chart'
      and expires_at <= clock_timestamp()
  ),
  44::bigint,
  'one call prunes at most 256 of 300 expired rows'
);

select ok(
  exists (
    select 1
    from programmable_release_probe_private.release_probe_nonce_consumptions_v1
    where route_key = 'explore-chart'
      and nonce_digest = decode(repeat('ab', 32), 'hex')
      and expires_at > clock_timestamp()
  ),
  'bounded pruning never removes an unexpired row'
);

set role programmable_migrator;
insert into programmable_release_probe_private.release_probe_nonce_consumptions_v1 (
  route_key, nonce_digest, issued_at, expires_at, consumed_at
)
select
  'launch-lookup',
  decode(pg_catalog.lpad(pg_catalog.to_hex(series.value), 64, '0'), 'hex'),
  clock_timestamp(),
  clock_timestamp() + interval '4 minutes',
  clock_timestamp()
from pg_catalog.generate_series(1, 4096) as series(value);
reset role;

set session authorization programmable_release_probe_nonce_login;
set role programmable_release_probe_nonce;
select ok(
  not programmable_release_probe_private.consume_release_probe_nonce_v1(
    'launch-lookup', decode(repeat('ff', 32), 'hex'),
    clock_timestamp(), clock_timestamp() + interval '2 minutes'
  ),
  'the per-route hard ceiling rejects growth beyond 4096 retained rows'
);
reset role;
set session authorization postgres;

select is(
  (
    select pg_catalog.count(*)
    from programmable_release_probe_private.release_probe_nonce_consumptions_v1
    where route_key = 'launch-lookup'
  ),
  4096::bigint,
  'capacity rejection leaves the bounded route state unchanged'
);

set role programmable_migrator;
select throws_ok(
  $sql$
    insert into programmable_release_probe_private.release_probe_nonce_consumptions_v1 (
      route_key, nonce_digest, issued_at, expires_at, consumed_at
    ) values (
      'explore-list', decode(repeat('99', 32), 'hex'),
      '-infinity', clock_timestamp() + interval '1 minute',
      clock_timestamp()
    )
  $sql$,
  '23514',
  'table constraints reject non-finite timestamp state'
);
reset role;

select * from finish();
rollback;
