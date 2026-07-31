\if :setup
drop schema if exists programmable_concurrency_release_probe_nonce cascade;
create schema programmable_concurrency_release_probe_nonce;

create table programmable_concurrency_release_probe_nonce.ready (
  phase text not null,
  actor text not null,
  primary key (phase, actor)
);

create table programmable_concurrency_release_probe_nonce.results (
  phase text not null,
  actor text not null,
  consumed boolean not null,
  primary key (phase, actor)
);

create function programmable_concurrency_release_probe_nonce.arrive(
  p_phase text,
  p_actor text
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into programmable_concurrency_release_probe_nonce.ready (
    phase, actor
  ) values (p_phase, p_actor)
  on conflict (phase, actor) do nothing
$function$;

create function programmable_concurrency_release_probe_nonce.wait_for_peer(
  p_phase text
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
      from programmable_concurrency_release_probe_nonce.ready
      where phase = p_phase
    ) = 2 then
      return;
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
  raise exception 'timed out waiting for release-probe nonce peer';
end
$function$;

create function programmable_concurrency_release_probe_nonce.record_result(
  p_phase text,
  p_actor text,
  p_consumed boolean
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into programmable_concurrency_release_probe_nonce.results (
    phase, actor, consumed
  ) values (p_phase, p_actor, p_consumed)
  on conflict (phase, actor) do update
    set consumed = excluded.consumed
$function$;

grant usage on schema programmable_concurrency_release_probe_nonce
  to programmable_release_probe_nonce;
grant execute on all functions in schema
  programmable_concurrency_release_probe_nonce
  to programmable_release_probe_nonce;

set role programmable_migrator;
delete from programmable_release_probe_private.release_probe_nonce_consumptions_v1
where nonce_digest in (
  decode(repeat('c1', 32), 'hex'),
  decode(repeat('c2', 32), 'hex')
);
reset role;
\endif

\if :same_nonce_a
set session authorization programmable_release_probe_nonce_login;
set role programmable_release_probe_nonce;
select programmable_concurrency_release_probe_nonce.arrive(
  'same-nonce', 'a'
);
select programmable_concurrency_release_probe_nonce.wait_for_peer(
  'same-nonce'
);
select programmable_concurrency_release_probe_nonce.record_result(
  'same-nonce',
  'a',
  programmable_release_probe_private.consume_release_probe_nonce_v1(
    'explore-list', decode(repeat('c1', 32), 'hex'),
    clock_timestamp(), clock_timestamp() + interval '2 minutes'
  )
);
reset role;
reset session authorization;
\endif

\if :same_nonce_b
set session authorization programmable_release_probe_nonce_login;
set role programmable_release_probe_nonce;
select programmable_concurrency_release_probe_nonce.arrive(
  'same-nonce', 'b'
);
select programmable_concurrency_release_probe_nonce.wait_for_peer(
  'same-nonce'
);
select programmable_concurrency_release_probe_nonce.record_result(
  'same-nonce',
  'b',
  programmable_release_probe_private.consume_release_probe_nonce_v1(
    'explore-list', decode(repeat('c1', 32), 'hex'),
    clock_timestamp(), clock_timestamp() + interval '2 minutes'
  )
);
reset role;
reset session authorization;
\endif

\if :different_route_a
set session authorization programmable_release_probe_nonce_login;
set role programmable_release_probe_nonce;
select programmable_concurrency_release_probe_nonce.arrive(
  'different-route', 'a'
);
select programmable_concurrency_release_probe_nonce.wait_for_peer(
  'different-route'
);
select programmable_concurrency_release_probe_nonce.record_result(
  'different-route',
  'a',
  programmable_release_probe_private.consume_release_probe_nonce_v1(
    'explore-token', decode(repeat('c2', 32), 'hex'),
    clock_timestamp(), clock_timestamp() + interval '2 minutes'
  )
);
reset role;
reset session authorization;
\endif

\if :different_route_b
set session authorization programmable_release_probe_nonce_login;
set role programmable_release_probe_nonce;
select programmable_concurrency_release_probe_nonce.arrive(
  'different-route', 'b'
);
select programmable_concurrency_release_probe_nonce.wait_for_peer(
  'different-route'
);
select programmable_concurrency_release_probe_nonce.record_result(
  'different-route',
  'b',
  programmable_release_probe_private.consume_release_probe_nonce_v1(
    'explore-chart', decode(repeat('c2', 32), 'hex'),
    clock_timestamp(), clock_timestamp() + interval '2 minutes'
  )
);
reset role;
reset session authorization;
\endif

\if :verify
do $verify$
begin
  if (
    select pg_catalog.count(*)
    from programmable_concurrency_release_probe_nonce.results
    where phase = 'same-nonce' and consumed
  ) <> 1 or (
    select pg_catalog.count(*)
    from programmable_concurrency_release_probe_nonce.results
    where phase = 'same-nonce' and not consumed
  ) <> 1 then
    raise exception 'same-route nonce race did not have exactly one winner';
  end if;

  if (
    select pg_catalog.count(*)
    from programmable_release_probe_private.release_probe_nonce_consumptions_v1
    where route_key = 'explore-list'
      and nonce_digest = decode(repeat('c1', 32), 'hex')
  ) <> 1 then
    raise exception 'same-route nonce race persisted an invalid row count';
  end if;

  if (
    select pg_catalog.count(*)
    from programmable_concurrency_release_probe_nonce.results
    where phase = 'different-route' and consumed
  ) <> 2 or exists (
    select 1
    from programmable_concurrency_release_probe_nonce.results
    where phase = 'different-route' and not consumed
  ) then
    raise exception 'route-scoped nonce keys blocked independent routes';
  end if;
end
$verify$;
\endif
