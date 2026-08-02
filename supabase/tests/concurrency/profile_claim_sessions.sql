\if :setup
drop schema if exists programmable_concurrency_profile cascade;
create schema programmable_concurrency_profile;

create table programmable_concurrency_profile.ready (
  phase text not null,
  actor text not null,
  primary key (phase, actor)
);

create table programmable_concurrency_profile.results (
  phase text not null,
  actor text not null,
  outcome text not null,
  detail text,
  primary key (phase, actor)
);

create function programmable_concurrency_profile.arrive(
  p_phase text,
  p_actor text
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into programmable_concurrency_profile.ready (phase, actor)
  values (p_phase, p_actor)
  on conflict (phase, actor) do nothing
$function$;

create function programmable_concurrency_profile.wait_for_peers(
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
      from programmable_concurrency_profile.ready
      where phase = p_phase
    ) >= p_expected then
      return;
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
  raise exception 'timed out waiting for phase %', p_phase;
end
$function$;

create function programmable_concurrency_profile.record_result(
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
  insert into programmable_concurrency_profile.results (
    phase, actor, outcome, detail
  )
  values (p_phase, p_actor, p_outcome, pg_catalog.left(p_detail, 512))
  on conflict (phase, actor) do update
    set outcome = excluded.outcome,
        detail = excluded.detail
$function$;

grant usage on schema programmable_concurrency_profile
  to programmable_profile_binder, programmable_profile_recovery,
     programmable_profile_writer;
grant execute on all functions in schema programmable_concurrency_profile
  to programmable_profile_binder, programmable_profile_recovery,
     programmable_profile_writer;

set role programmable_profile_recovery;
select programmable_private.define_profile_hash_version(
  1::smallint, 'hmac-sha256-v1',
  decode(repeat('11', 32), 'hex'), decode(repeat('12', 32), 'hex'),
  '2026-01-01T00:00:00Z'
);
select programmable_private.set_profile_hash_version_state(
  '21000000-0000-0000-0000-000000000001',
  1::smallint, 'current', decode(repeat('13', 32), 'hex'),
  '2026-01-01T00:00:01Z'
);
reset role;

set role programmable_profile_binder;
select programmable_private.bind_profile_subject(
  decode(repeat('33', 20), 'hex'), 1::smallint,
  decode(repeat('33', 32), 'hex'), 'wallet_signature',
  decode(repeat('34', 32), 'hex'), '2026-01-01T00:00:02Z'
);
select programmable_private.bind_profile_subject(
  decode(repeat('44', 20), 'hex'), 1::smallint,
  decode(repeat('44', 32), 'hex'), 'wallet_signature',
  decode(repeat('45', 32), 'hex'), '2026-01-01T00:00:03Z'
);
select programmable_private.bind_profile_subject(
  decode(repeat('55', 20), 'hex'), 1::smallint,
  decode(repeat('55', 32), 'hex'), 'wallet_signature',
  decode(repeat('56', 32), 'hex'), '2026-01-01T00:00:03Z'
);
select programmable_private.bind_profile_subject(
  decode(repeat('66', 20), 'hex'), 1::smallint,
  decode(repeat('66', 32), 'hex'), 'wallet_signature',
  decode(repeat('67', 32), 'hex'), '2026-01-01T00:00:03Z'
);
select programmable_private.bind_profile_subject(
  decode(repeat('77', 20), 'hex'), 1::smallint,
  decode(repeat('77', 32), 'hex'), 'wallet_signature',
  decode(repeat('78', 32), 'hex'), '2026-01-01T00:00:03Z'
);
reset role;

set role programmable_profile_recovery;
select programmable_private.tombstone_profile_binding(
  decode(repeat('33', 20), 'hex'), 1::smallint,
  decode(repeat('33', 32), 'hex'), 1,
  decode(repeat('35', 32), 'hex'), '2026-01-01T00:00:04Z'
);
reset role;
\endif

\if :first_wallet_a
select programmable_concurrency_profile.arrive('first-wallet', 'a');
select programmable_concurrency_profile.wait_for_peers('first-wallet', 2);
set role programmable_profile_binder;
do $session$
declare
  claimed_subject uuid;
begin
  claimed_subject := programmable_private.bind_profile_subject(
    decode(repeat('11', 20), 'hex'), 1::smallint,
    decode(repeat('11', 32), 'hex'), 'wallet_signature',
    decode(repeat('16', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'first-wallet', 'a', 'success', claimed_subject::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'first-wallet', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :first_wallet_b
select programmable_concurrency_profile.arrive('first-wallet', 'b');
select programmable_concurrency_profile.wait_for_peers('first-wallet', 2);
set role programmable_profile_binder;
do $session$
declare
  claimed_subject uuid;
begin
  claimed_subject := programmable_private.bind_profile_subject(
    decode(repeat('11', 20), 'hex'), 1::smallint,
    decode(repeat('12', 32), 'hex'), 'wallet_signature',
    decode(repeat('17', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'first-wallet', 'b', 'success', claimed_subject::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'first-wallet', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :first_alias_a
select programmable_concurrency_profile.arrive('first-alias', 'a');
select programmable_concurrency_profile.wait_for_peers('first-alias', 2);
set role programmable_profile_binder;
do $session$
declare
  claimed_subject uuid;
begin
  claimed_subject := programmable_private.bind_profile_subject(
    decode(repeat('12', 20), 'hex'), 1::smallint,
    decode(repeat('13', 32), 'hex'), 'wallet_signature',
    decode(repeat('18', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'first-alias', 'a', 'success', claimed_subject::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'first-alias', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :first_alias_b
select programmable_concurrency_profile.arrive('first-alias', 'b');
select programmable_concurrency_profile.wait_for_peers('first-alias', 2);
set role programmable_profile_binder;
do $session$
declare
  claimed_subject uuid;
begin
  claimed_subject := programmable_private.bind_profile_subject(
    decode(repeat('13', 20), 'hex'), 1::smallint,
    decode(repeat('13', 32), 'hex'), 'wallet_signature',
    decode(repeat('19', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'first-alias', 'b', 'success', claimed_subject::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'first-alias', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :after_first
do $verify_first$
begin
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'first-wallet' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'first-wallet' and outcome = '23505'
  ) <> 1 then
    raise exception 'same-wallet first-bind race did not have one winner';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'first-alias' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'first-alias' and outcome = '23505'
  ) <> 1 then
    raise exception 'same-alias first-bind race did not have one winner';
  end if;
end
$verify_first$;

set role programmable_profile_recovery;
select programmable_private.define_profile_hash_version(
  2::smallint, 'hmac-sha256-v2',
  decode(repeat('21', 32), 'hex'), decode(repeat('22', 32), 'hex'),
  '2026-01-01T00:01:00Z'
);
select programmable_private.set_profile_hash_version_state(
  '22000000-0000-0000-0000-000000000001',
  2::smallint, 'current', decode(repeat('23', 32), 'hex'),
  '2026-01-01T00:01:01Z'
);
select programmable_private.rekey_profile_subject(
  decode(repeat('44', 20), 'hex'),
  1::smallint, decode(repeat('44', 32), 'hex'),
  2::smallint, decode(repeat('45', 32), 'hex'),
  1, decode(repeat('46', 32), 'hex'),
  '2026-01-01T00:01:02Z'
);
reset role;

set role programmable_profile_binder;
select programmable_private.bind_profile_subject(
  decode(repeat('88', 20), 'hex'), 2::smallint,
  decode(repeat('88', 32), 'hex'), 'wallet_signature',
  decode(repeat('89', 32), 'hex'), '2026-01-01T00:01:03Z'
);
reset role;

set role programmable_profile_recovery;
select programmable_private.tombstone_profile_binding(
  decode(repeat('88', 20), 'hex'), 2::smallint,
  decode(repeat('88', 32), 'hex'), 1,
  decode(repeat('8a', 32), 'hex'), '2026-01-01T00:01:04Z'
);
reset role;
\endif

\if :ownership_a
select programmable_concurrency_profile.arrive('ownership', 'a');
select programmable_concurrency_profile.wait_for_peers('ownership', 2);
set role programmable_profile_recovery;
do $session$
declare
  next_generation bigint;
begin
  next_generation := programmable_private.rekey_profile_subject(
    decode(repeat('55', 20), 'hex'),
    1::smallint, decode(repeat('55', 32), 'hex'),
    2::smallint, decode(repeat('56', 32), 'hex'),
    1, decode(repeat('24', 32), 'hex'),
    pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'ownership', 'a', 'success', next_generation::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'ownership', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :ownership_b
select programmable_concurrency_profile.arrive('ownership', 'b');
select programmable_concurrency_profile.wait_for_peers('ownership', 2);
set role programmable_profile_recovery;
do $session$
declare
  next_generation bigint;
begin
  next_generation := programmable_private.tombstone_profile_binding(
    decode(repeat('55', 20), 'hex'), 1::smallint,
    decode(repeat('55', 32), 'hex'), 1,
    decode(repeat('25', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'ownership', 'b', 'success', next_generation::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'ownership', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :recover_a
select programmable_concurrency_profile.arrive('recover', 'a');
select programmable_concurrency_profile.wait_for_peers('recover', 2);
set role programmable_profile_recovery;
do $session$
declare
  next_generation bigint;
begin
  next_generation := programmable_private.recover_profile_binding(
    decode(repeat('33', 20), 'hex'), 1::smallint,
    decode(repeat('33', 32), 'hex'), 2,
    decode(repeat('36', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'recover', 'a', 'success', next_generation::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'recover', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :recover_b
select programmable_concurrency_profile.arrive('recover', 'b');
select programmable_concurrency_profile.wait_for_peers('recover', 2);
set role programmable_profile_recovery;
do $session$
declare
  next_generation bigint;
begin
  next_generation := programmable_private.recover_profile_binding(
    decode(repeat('33', 20), 'hex'), 1::smallint,
    decode(repeat('33', 32), 'hex'), 2,
    decode(repeat('37', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'recover', 'b', 'success', next_generation::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'recover', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :rekey_a
select programmable_concurrency_profile.arrive('rekey', 'a');
select programmable_concurrency_profile.wait_for_peers('rekey', 2);
set role programmable_profile_recovery;
do $session$
declare
  next_generation bigint;
begin
  next_generation := programmable_private.rekey_profile_subject(
    decode(repeat('66', 20), 'hex'),
    1::smallint, decode(repeat('66', 32), 'hex'),
    2::smallint, decode(repeat('67', 32), 'hex'),
    1, decode(repeat('69', 32), 'hex'),
    pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'rekey', 'a', 'success', next_generation::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'rekey', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :rekey_b
select programmable_concurrency_profile.arrive('rekey', 'b');
select programmable_concurrency_profile.wait_for_peers('rekey', 2);
set role programmable_profile_recovery;
do $session$
declare
  next_generation bigint;
begin
  next_generation := programmable_private.rekey_profile_subject(
    decode(repeat('66', 20), 'hex'),
    1::smallint, decode(repeat('66', 32), 'hex'),
    2::smallint, decode(repeat('68', 32), 'hex'),
    1, decode(repeat('6a', 32), 'hex'),
    pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'rekey', 'b', 'success', next_generation::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'rekey', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :alias_claim_a
select programmable_concurrency_profile.arrive('alias-claim', 'a');
select programmable_concurrency_profile.wait_for_peers('alias-claim', 2);
set role programmable_profile_recovery;
do $session$
declare
  next_generation bigint;
begin
  next_generation := programmable_private.rekey_profile_subject(
    decode(repeat('77', 20), 'hex'),
    1::smallint, decode(repeat('77', 32), 'hex'),
    2::smallint, decode(repeat('78', 32), 'hex'),
    1, decode(repeat('7a', 32), 'hex'),
    pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'alias-claim', 'a', 'success', next_generation::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'alias-claim', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :alias_claim_b
select programmable_concurrency_profile.arrive('alias-claim', 'b');
select programmable_concurrency_profile.wait_for_peers('alias-claim', 2);
set role programmable_profile_binder;
do $session$
declare
  claimed_subject uuid;
begin
  claimed_subject := programmable_private.bind_profile_subject(
    decode(repeat('79', 20), 'hex'), 2::smallint,
    decode(repeat('78', 32), 'hex'), 'wallet_signature',
    decode(repeat('7b', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'alias-claim', 'b', 'success', claimed_subject::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'alias-claim', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :recover_mutate_a
select programmable_concurrency_profile.arrive('recover-mutate', 'a');
select programmable_concurrency_profile.wait_for_peers('recover-mutate', 2);
set role programmable_profile_recovery;
do $session$
declare
  next_generation bigint;
begin
  next_generation := programmable_private.recover_profile_binding(
    decode(repeat('88', 20), 'hex'), 2::smallint,
    decode(repeat('88', 32), 'hex'), 2,
    decode(repeat('8b', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'recover-mutate', 'a', 'success', next_generation::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'recover-mutate', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :recover_mutate_b
select programmable_concurrency_profile.arrive('recover-mutate', 'b');
select programmable_concurrency_profile.wait_for_peers('recover-mutate', 2);
set role programmable_profile_writer;
do $session$
declare
  next_revision bigint;
begin
  next_revision := programmable_private.mutate_profile(
    decode(repeat('88', 20), 'hex'), 2::smallint,
    decode(repeat('88', 32), 'hex'), 2, 1,
    'RaceMutation', null, 'Must not persist', null,
    decode(repeat('8c', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'recover-mutate', 'b', 'success', next_revision::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'recover-mutate', 'b', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :revision_a
select programmable_concurrency_profile.arrive('revision', 'a');
select programmable_concurrency_profile.wait_for_peers('revision', 2);
set role programmable_profile_writer;
do $session$
declare
  next_revision bigint;
begin
  next_revision := programmable_private.mutate_profile(
    decode(repeat('44', 20), 'hex'), 2::smallint,
    decode(repeat('45', 32), 'hex'), 2, 0,
    'RevAlpha', null, 'Revision A', null,
    decode(repeat('47', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'revision', 'a', 'success', next_revision::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'revision', 'a', sqlstate, sqlerrm
  );
end
$session$;
reset role;
\endif

\if :revision_b
select programmable_concurrency_profile.arrive('revision', 'b');
select programmable_concurrency_profile.wait_for_peers('revision', 2);
set role programmable_profile_writer;
do $session$
declare
  next_revision bigint;
begin
  next_revision := programmable_private.mutate_profile(
    decode(repeat('44', 20), 'hex'), 2::smallint,
    decode(repeat('45', 32), 'hex'), 2, 0,
    'RevBeta', null, 'Revision B', null,
    decode(repeat('48', 32), 'hex'), pg_catalog.clock_timestamp()
  );
  perform programmable_concurrency_profile.record_result(
    'revision', 'b', 'success', next_revision::text
  );
exception when others then
  perform programmable_concurrency_profile.record_result(
    'revision', 'b', sqlstate, sqlerrm
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
    from programmable_concurrency_profile.results
    where phase = 'first-wallet' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'first-wallet' and outcome = '23505'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profile_owner_binding_current
    where wallet = decode(repeat('11', 20), 'hex')
      and generation = 1
  ) <> 1 then
    raise exception 'same-wallet first bind did not have one stable winner';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'first-alias' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'first-alias' and outcome = '23505'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profile_subject_aliases
    where hash_version = 1
      and keyed_subject_hash = decode(repeat('13', 32), 'hex')
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profile_owner_binding_current
    where wallet in (
      decode(repeat('12', 20), 'hex'),
      decode(repeat('13', 20), 'hex')
    )
  ) <> 1 then
    raise exception 'same-alias first bind did not have one stable winner';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_private.profile_owner_binding_current
    where wallet = decode(repeat('55', 20), 'hex')
      and generation = 2
  ) <> 1 or (
    select pg_catalog.count(distinct subject_id)
    from programmable_private.profile_owner_binding_history
    where wallet = decode(repeat('55', 20), 'hex')
  ) <> 1 then
    raise exception 'ownership race split or replaced the stable subject';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'ownership' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'ownership' and outcome = '40001'
  ) <> 1 then
    raise exception 'rekey/tombstone race did not have one CAS winner';
  end if;
  if exists (
    select 1
    from programmable_private.profile_owner_binding_current as binding
    left join programmable_private.profile_subject_current_alias as current_alias
      on current_alias.subject_id = binding.subject_id
      and current_alias.generation = binding.generation
    where binding.wallet = decode(repeat('55', 20), 'hex')
      and current_alias.subject_id is null
  ) then
    raise exception 'ownership race left a dangling subject alias';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'recover' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'recover' and outcome = '40001'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profile_owner_binding_current
    where wallet = decode(repeat('33', 20), 'hex')
      and generation = 3 and state = 'recovered'
  ) <> 1 or (
    select pg_catalog.count(distinct subject_id)
    from programmable_private.profile_owner_binding_history
    where wallet = decode(repeat('33', 20), 'hex')
  ) <> 1 then
    raise exception 'recovery race reused or split the tombstoned subject';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'rekey' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'rekey' and outcome = '40001'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profile_owner_binding_current
    where wallet = decode(repeat('66', 20), 'hex')
      and generation = 2 and state = 'recovered'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profile_subject_aliases
    where hash_version = 2
      and keyed_subject_hash in (
        decode(repeat('67', 32), 'hex'),
        decode(repeat('68', 32), 'hex')
      )
  ) <> 1 then
    raise exception 'same-generation rekey race did not have one winner';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'alias-claim' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'alias-claim' and outcome in ('23505', '40001')
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profile_subject_aliases
    where hash_version = 2
      and keyed_subject_hash = decode(repeat('78', 32), 'hex')
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profile_subject_aliases as alias
    join programmable_private.profile_subject_alias_status_current as status
      on status.alias_id = alias.alias_id
    where alias.hash_version = 2
      and alias.keyed_subject_hash = decode(repeat('78', 32), 'hex')
      and status.state = 'current'
  ) <> 1 then
    raise exception 'rekey versus alias claim did not preserve unique ownership';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'recover-mutate' and actor = 'a' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'recover-mutate' and actor = 'b' and outcome = '40001'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profile_owner_binding_current
    where wallet = decode(repeat('88', 20), 'hex')
      and generation = 3 and state = 'recovered'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profiles as profile
    join programmable_private.profile_owner_binding_current as binding
      on binding.subject_id = profile.subject_id
    where binding.wallet = decode(repeat('88', 20), 'hex')
      and profile.revision = 2
      and profile.deleted_at is null
      and profile.username is null
  ) <> 1 then
    raise exception 'recovery versus mutation race admitted a stale mutation';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'revision' and outcome = 'success'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_profile.results
    where phase = 'revision' and outcome = '40001'
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_private.profiles as profile
    join programmable_private.profile_owner_binding_current as binding
      on binding.subject_id = profile.subject_id
    where binding.wallet = decode(repeat('44', 20), 'hex')
      and profile.revision = 1
      and profile.username in ('RevAlpha', 'RevBeta')
  ) <> 1 then
    raise exception 'profile revision CAS did not have one winner';
  end if;
  if (
    select pg_catalog.count(*)
    from programmable_private.profile_audit_records
    where wallet = decode(repeat('11', 20), 'hex')
      and action = 'profile.bind_first'
  ) <> 1 then
    raise exception 'idempotent first-bind duplicated audit history';
  end if;
end
$verify$;

drop schema programmable_concurrency_profile cascade;
\endif
