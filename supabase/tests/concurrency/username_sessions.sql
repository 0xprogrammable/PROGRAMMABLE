\if :setup
drop schema if exists programmable_concurrency_username cascade;
create schema programmable_concurrency_username;

create table programmable_concurrency_username.ready (
  phase text not null,
  actor text not null,
  primary key (phase, actor)
);

create table programmable_concurrency_username.results (
  phase text not null,
  actor text not null,
  outcome text not null,
  detail text,
  primary key (phase, actor)
);

create function programmable_concurrency_username.arrive(
  p_phase text,
  p_actor text
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into programmable_concurrency_username.ready (phase, actor)
  values (p_phase, p_actor)
  on conflict (phase, actor) do nothing
$function$;

create function programmable_concurrency_username.wait_for_peers(
  p_phase text,
  p_expected integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  attempt integer;
begin
  for attempt in 1..200 loop
    if (
      select pg_catalog.count(*)
      from programmable_concurrency_username.ready
      where phase = p_phase
    ) >= p_expected then
      return;
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
  raise exception 'timed out waiting for phase %', p_phase;
end
$function$;

create function programmable_concurrency_username.record_result(
  p_phase text,
  p_actor text,
  p_outcome text,
  p_detail text
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into programmable_concurrency_username.results (
    phase, actor, outcome, detail
  )
  values (p_phase, p_actor, p_outcome, pg_catalog.left(p_detail, 512))
  on conflict (phase, actor) do update
    set outcome = excluded.outcome,
        detail = excluded.detail
$function$;

grant usage on schema programmable_concurrency_username
  to programmable_profile_writer;
grant execute on all functions in schema programmable_concurrency_username
  to programmable_profile_writer;

set role programmable_profile_recovery;
select programmable_private.define_profile_hash_version(
  10::smallint, 'hmac-sha256-v10',
  decode(repeat('91', 32), 'hex'), decode(repeat('92', 32), 'hex'),
  '2026-01-01T01:00:00Z'
);
select programmable_private.set_profile_hash_version_state(
  '91000000-0000-0000-0000-000000000010',
  10::smallint, 'current', decode(repeat('93', 32), 'hex'),
  '2026-01-01T01:00:01Z'
);
reset role;

set role programmable_profile_binder;
select programmable_private.bind_profile_subject(
  decode(repeat('aa', 20), 'hex'), 10::smallint,
  decode(repeat('aa', 32), 'hex'), 'wallet_signature',
  decode(repeat('a1', 32), 'hex'), '2026-01-01T01:00:02Z'
);
select programmable_private.bind_profile_subject(
  decode(repeat('bb', 20), 'hex'), 10::smallint,
  decode(repeat('bb', 32), 'hex'), 'wallet_signature',
  decode(repeat('b1', 32), 'hex'), '2026-01-01T01:00:03Z'
);
reset role;
\endif

\if :collision_a
select programmable_concurrency_username.arrive('collision', 'a');
select programmable_concurrency_username.wait_for_peers('collision', 2);
set role programmable_profile_writer;
do $session$
declare
  next_revision bigint;
begin
  next_revision := programmable_private.mutate_profile(
    decode(repeat('aa', 20), 'hex'), 10::smallint,
    decode(repeat('aa', 32), 'hex'), 1, 0,
    'CaseName', null, null, null,
    decode(repeat('a2', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_username.record_result(
    'collision', 'a', 'success', next_revision::text
  );
exception when others then
  perform programmable_concurrency_username.record_result(
    'collision', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :collision_b
select programmable_concurrency_username.arrive('collision', 'b');
select programmable_concurrency_username.wait_for_peers('collision', 2);
set role programmable_profile_writer;
do $session$
declare
  next_revision bigint;
begin
  next_revision := programmable_private.mutate_profile(
    decode(repeat('bb', 20), 'hex'), 10::smallint,
    decode(repeat('bb', 32), 'hex'), 1, 0,
    'casename', null, null, null,
    decode(repeat('b2', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_username.record_result(
    'collision', 'b', 'success', next_revision::text
  );
exception when others then
  perform programmable_concurrency_username.record_result(
    'collision', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :verify
do $verify$
begin
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_username.results
    where phase = 'collision' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_username.results
    where phase = 'collision' and outcome = '23505'
  ) <> 1 then
    raise exception 'case-insensitive username race did not have one winner';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_private.profiles
    where username_key = 'casename' and revision = 1
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profiles as profile
    join programmable_private.profile_owner_binding_current as binding
      on binding.subject_id = profile.subject_id
    where binding.wallet in (
      decode(repeat('aa', 20), 'hex'),
      decode(repeat('bb', 20), 'hex')
    ) and profile.revision = 0 and profile.username is null
  ) <> 1 then
    raise exception 'username collision left split or partially mutated profiles';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_private.profile_audit_records
    where wallet in (
      decode(repeat('aa', 20), 'hex'),
      decode(repeat('bb', 20), 'hex')
    ) and action = 'profile.mutate'
  ) <> 1 then
    raise exception 'losing username mutation left audit side effects';
  end if;
end
$verify$;

drop schema programmable_concurrency_username cascade;
\endif
