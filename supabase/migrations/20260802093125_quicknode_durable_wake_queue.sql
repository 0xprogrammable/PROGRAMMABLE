-- Durable, coalescing work markers for authenticated QuickNode stream wakes.
--
-- The public route verifies the HMAC envelope before reaching this API. The
-- database independently binds the persisted marker to the signed nonce digest,
-- block hint and issued-at time. A short worker lease makes a crashed invocation
-- retryable without holding a database transaction across projector network I/O.

reset role;

create schema if not exists programmable_wake_private
  authorization programmable_migrator;
alter schema programmable_wake_private owner to programmable_migrator;

revoke all on schema programmable_wake_private
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login,
  programmable_projector_runtime_login;

set role programmable_migrator;

alter default privileges for role programmable_migrator
in schema programmable_wake_private
  revoke all on tables from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler,
    programmable_api_reader, programmable_profile_binder,
    programmable_profile_recovery, programmable_profile_writer,
    programmable_maintenance, programmable_api_reader_login,
    programmable_projector_login, programmable_reconciler_login,
    programmable_projector_runtime,
    programmable_projector_runtime_login;
alter default privileges for role programmable_migrator
in schema programmable_wake_private
  revoke all on sequences from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler,
    programmable_api_reader, programmable_profile_binder,
    programmable_profile_recovery, programmable_profile_writer,
    programmable_maintenance, programmable_api_reader_login,
    programmable_projector_login, programmable_reconciler_login,
    programmable_projector_runtime,
    programmable_projector_runtime_login;
alter default privileges for role programmable_migrator
in schema programmable_wake_private
  revoke execute on functions from public, anon, authenticated, service_role,
    programmable_projector, programmable_reconciler,
    programmable_api_reader, programmable_profile_binder,
    programmable_profile_recovery, programmable_profile_writer,
    programmable_maintenance, programmable_api_reader_login,
    programmable_projector_login, programmable_reconciler_login,
    programmable_projector_runtime,
    programmable_projector_runtime_login;

create table programmable_wake_private.quicknode_wake_jobs_v1 (
  wake_id bigint generated always as identity primary key,
  nonce_digest bytea not null unique,
  block_number_hint bigint not null,
  block_hint text not null,
  payload text not null,
  payload_digest bytea not null,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'completed')),
  received_at timestamptz not null,
  available_at timestamptz not null,
  expires_at timestamptz not null,
  attempt_count smallint not null default 0
    check (attempt_count between 0 and 32),
  lease_generation bigint not null default 0
    check (lease_generation >= 0),
  worker_id text,
  lease_token_digest bytea,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  constraint quicknode_wake_jobs_v1_nonce_digest_check check (
    pg_catalog.octet_length(nonce_digest) = 32
    and nonce_digest <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  ),
  constraint quicknode_wake_jobs_v1_block_hint_check check (
    block_number_hint >= 0
    and pg_catalog.octet_length(block_hint) between 32 and 8192
  ),
  constraint quicknode_wake_jobs_v1_payload_check check (
    pg_catalog.octet_length(payload) between 2 and 131072
    and pg_catalog.octet_length(payload_digest) = 32
    and payload_digest
      <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  ),
  constraint quicknode_wake_jobs_v1_finite_time_check check (
    pg_catalog.isfinite(received_at)
    and pg_catalog.isfinite(available_at)
    and pg_catalog.isfinite(expires_at)
    and (lease_expires_at is null or pg_catalog.isfinite(lease_expires_at))
    and (completed_at is null or pg_catalog.isfinite(completed_at))
  ),
  constraint quicknode_wake_jobs_v1_retention_check check (
    available_at >= received_at
    and expires_at = received_at + interval '2 hours'
  ),
  constraint quicknode_wake_jobs_v1_state_shape_check check (
    (
      state = 'pending'
      and worker_id is null
      and lease_token_digest is null
      and lease_expires_at is null
      and completed_at is null
    )
    or
    (
      state = 'processing'
      and attempt_count between 1 and 32
      and lease_generation > 0
      and worker_id is not null
      and pg_catalog.octet_length(worker_id) between 1 and 128
      and worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
      and lease_token_digest is not null
      and pg_catalog.octet_length(lease_token_digest) = 32
      and lease_token_digest
        <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
      and lease_expires_at is not null
      and lease_expires_at > received_at
      and lease_expires_at <= expires_at
      and completed_at is null
    )
    or
    (
      state = 'completed'
      and attempt_count between 1 and 32
      and lease_generation > 0
      and worker_id is null
      and lease_token_digest is null
      and lease_expires_at is null
      and completed_at is not null
      and completed_at >= received_at
      and completed_at <= expires_at
    )
  )
);

create unique index quicknode_wake_jobs_v1_payload_delivery_key
on programmable_wake_private.quicknode_wake_jobs_v1 (
  block_number_hint,
  payload_digest
);

comment on table programmable_wake_private.quicknode_wake_jobs_v1 is
  'Durable QuickNode wake markers. Duplicate nonce or identical block-payload deliveries coalesce, jobs expire after two hours, pruning is bounded to 256 rows per enqueue, and retained capacity is capped at 4096 rows.';

alter table programmable_wake_private.quicknode_wake_jobs_v1
  enable row level security;
alter table programmable_wake_private.quicknode_wake_jobs_v1
  force row level security;

create policy quicknode_wake_jobs_v1_migrator_all
on programmable_wake_private.quicknode_wake_jobs_v1
for all
to programmable_migrator
using (true)
with check (true);

create index quicknode_wake_jobs_v1_pending_idx
on programmable_wake_private.quicknode_wake_jobs_v1 (
  available_at,
  wake_id
)
where state = 'pending' and attempt_count < 32;

create index quicknode_wake_jobs_v1_expired_lease_idx
on programmable_wake_private.quicknode_wake_jobs_v1 (
  lease_expires_at,
  wake_id
)
where state = 'processing' and attempt_count < 32;

create index quicknode_wake_jobs_v1_expiry_idx
on programmable_wake_private.quicknode_wake_jobs_v1 (
  expires_at,
  wake_id
);

create function programmable_wake_private.enqueue_quicknode_wake_v1(
  p_nonce_digest bytea,
  p_block_number_hint bigint,
  p_block_hint text,
  p_issued_at timestamptz,
  p_payload text,
  p_payload_digest bytea
)
returns table (
  accepted boolean,
  wake_id bigint,
  enqueued boolean,
  block_number_hint bigint,
  job_state text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  database_now timestamptz := pg_catalog.clock_timestamp();
  existing_job programmable_wake_private.quicknode_wake_jobs_v1%rowtype;
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
  then
    raise exception using
      errcode = '42501',
      message = 'QuickNode wake queue requires its runtime identity';
  end if;

  if p_nonce_digest is null
     or pg_catalog.octet_length(p_nonce_digest) <> 32
     or p_nonce_digest = pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_block_number_hint is null
     or p_block_number_hint < 0
     or p_block_hint is null
     or pg_catalog.octet_length(p_block_hint) not between 32 and 8192
     or p_issued_at is null
     or not pg_catalog.isfinite(p_issued_at)
     or p_issued_at < database_now - interval '5 minutes'
     or p_issued_at > database_now + interval '30 seconds'
     or p_payload is null
     or pg_catalog.octet_length(p_payload) not between 2 and 131072
     or p_payload_digest is null
     or pg_catalog.octet_length(p_payload_digest) <> 32
     or p_payload_digest =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  then
    raise exception using
      errcode = '22023',
      message = 'invalid QuickNode wake envelope';
  end if;

  -- Exact capacity and duplicate decisions must remain atomic under concurrent
  -- deliveries. The lock is held only for this short database transaction.
  perform pg_catalog.pg_advisory_xact_lock(1347571539, 1);
  database_now := pg_catalog.clock_timestamp();

  if p_issued_at < database_now - interval '5 minutes'
     or p_issued_at > database_now + interval '30 seconds'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid QuickNode wake envelope';
  end if;

  with expired as materialized (
    select job.wake_id
    from programmable_wake_private.quicknode_wake_jobs_v1 as job
    where job.expires_at <= database_now
    order by job.expires_at, job.wake_id
    limit 256
    for update skip locked
  )
  delete from programmable_wake_private.quicknode_wake_jobs_v1 as job
  using expired
  where job.wake_id = expired.wake_id
    and job.expires_at <= database_now;

  select job.* into existing_job
  from programmable_wake_private.quicknode_wake_jobs_v1 as job
  where job.nonce_digest = p_nonce_digest
     or (
       job.block_number_hint = p_block_number_hint
       and job.payload_digest = p_payload_digest
     )
  order by
    (job.nonce_digest = p_nonce_digest) desc,
    job.wake_id
  limit 1
  for update;

  if found then
    if existing_job.nonce_digest = p_nonce_digest
       and (
         existing_job.block_number_hint <> p_block_number_hint
         or existing_job.block_hint <> p_block_hint
         or existing_job.payload_digest <> p_payload_digest
       )
    then
      raise exception using
        errcode = '22023',
        message = 'invalid QuickNode wake envelope';
    end if;
    accepted := true;
    wake_id := existing_job.wake_id;
    enqueued := false;
    block_number_hint := existing_job.block_number_hint;
    job_state := existing_job.state;
    return next;
    return;
  end if;

  if (
    select pg_catalog.count(*) = 4096
    from (
      select 1
      from programmable_wake_private.quicknode_wake_jobs_v1
      limit 4096
    ) as bounded_jobs
  ) then
    accepted := false;
    wake_id := null;
    enqueued := false;
    block_number_hint := p_block_number_hint;
    job_state := 'capacity';
    return next;
    return;
  end if;

  insert into programmable_wake_private.quicknode_wake_jobs_v1 (
    nonce_digest,
    block_number_hint,
    block_hint,
    payload,
    payload_digest,
    received_at,
    available_at,
    expires_at
  ) values (
    p_nonce_digest,
    p_block_number_hint,
    p_block_hint,
    p_payload,
    p_payload_digest,
    database_now,
    database_now,
    database_now + interval '2 hours'
  )
  returning
    quicknode_wake_jobs_v1.wake_id,
    quicknode_wake_jobs_v1.block_number_hint,
    quicknode_wake_jobs_v1.state
  into wake_id, block_number_hint, job_state;

  accepted := true;
  enqueued := true;
  return next;
end
$function$;

create function programmable_wake_private.claim_quicknode_wake_v1(
  p_worker_id text,
  p_lease_token_digest bytea
)
returns table (
  wake_id bigint,
  block_number_hint bigint,
  block_hint text,
  payload text,
  lease_generation bigint,
  lease_expires_at timestamptz,
  attempt_count smallint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  database_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
  then
    raise exception using
      errcode = '42501',
      message = 'QuickNode wake queue requires its runtime identity';
  end if;

  if p_worker_id is null
     or pg_catalog.octet_length(p_worker_id) not between 1 and 128
     or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or p_lease_token_digest is null
     or pg_catalog.octet_length(p_lease_token_digest) <> 32
     or p_lease_token_digest =
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  then
    raise exception using
      errcode = '22023',
      message = 'invalid QuickNode wake claim';
  end if;

  return query
  with claimable as materialized (
    select job.wake_id
    from programmable_wake_private.quicknode_wake_jobs_v1 as job
    where job.expires_at > database_now
      and job.attempt_count < 32
      and (
        (job.state = 'pending' and job.available_at <= database_now)
        or
        (
          job.state = 'processing'
          and job.lease_expires_at <= database_now
        )
      )
    order by job.block_number_hint desc, job.wake_id
    limit 1
    for update skip locked
  )
  update programmable_wake_private.quicknode_wake_jobs_v1 as job
  set state = 'processing',
      attempt_count = job.attempt_count + 1,
      lease_generation = job.lease_generation + 1,
      worker_id = p_worker_id,
      lease_token_digest = p_lease_token_digest,
      lease_expires_at = least(
        database_now + interval '210 seconds',
        job.expires_at
      ),
      completed_at = null
  from claimable
  where job.wake_id = claimable.wake_id
  returning
    job.wake_id,
    job.block_number_hint,
    job.block_hint,
    job.payload,
    job.lease_generation,
    job.lease_expires_at,
    job.attempt_count;
end
$function$;

create function programmable_wake_private.complete_quicknode_wake_v1(
  p_wake_id bigint,
  p_lease_generation bigint,
  p_worker_id text,
  p_lease_token_digest bytea
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  database_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
  then
    raise exception using
      errcode = '42501',
      message = 'QuickNode wake queue requires its runtime identity';
  end if;

  if p_wake_id is null or p_wake_id <= 0
     or p_lease_generation is null or p_lease_generation <= 0
     or p_worker_id is null
     or pg_catalog.octet_length(p_worker_id) not between 1 and 128
     or p_lease_token_digest is null
     or pg_catalog.octet_length(p_lease_token_digest) <> 32
  then
    raise exception using
      errcode = '22023',
      message = 'invalid QuickNode wake completion';
  end if;

  update programmable_wake_private.quicknode_wake_jobs_v1 as job
  set state = 'completed',
      worker_id = null,
      lease_token_digest = null,
      lease_expires_at = null,
      completed_at = database_now
  where job.wake_id = p_wake_id
    and job.state = 'processing'
    and job.lease_generation = p_lease_generation
    and job.worker_id = p_worker_id
    and job.lease_token_digest = p_lease_token_digest
    and job.lease_expires_at > database_now
    and job.expires_at > database_now;

  return found;
end
$function$;

create function programmable_wake_private.retry_quicknode_wake_v1(
  p_wake_id bigint,
  p_lease_generation bigint,
  p_worker_id text,
  p_lease_token_digest bytea,
  p_retry_delay_ms integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  database_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
  then
    raise exception using
      errcode = '42501',
      message = 'QuickNode wake queue requires its runtime identity';
  end if;

  if p_wake_id is null or p_wake_id <= 0
     or p_lease_generation is null or p_lease_generation <= 0
     or p_worker_id is null
     or pg_catalog.octet_length(p_worker_id) not between 1 and 128
     or p_lease_token_digest is null
     or pg_catalog.octet_length(p_lease_token_digest) <> 32
     or p_retry_delay_ms is null
     or p_retry_delay_ms < 0
     or p_retry_delay_ms > 60000
  then
    raise exception using
      errcode = '22023',
      message = 'invalid QuickNode wake retry';
  end if;

  update programmable_wake_private.quicknode_wake_jobs_v1 as job
  set state = 'pending',
      available_at = database_now
        + pg_catalog.make_interval(secs => p_retry_delay_ms / 1000.0),
      worker_id = null,
      lease_token_digest = null,
      lease_expires_at = null,
      completed_at = null
  where job.wake_id = p_wake_id
    and job.state = 'processing'
    and job.lease_generation = p_lease_generation
    and job.worker_id = p_worker_id
    and job.lease_token_digest = p_lease_token_digest
    and job.expires_at > database_now;

  return found;
end
$function$;

comment on function programmable_wake_private.enqueue_quicknode_wake_v1(
  bytea, bigint, text, timestamptz, text, bytea
) is
  'Connect with session_user programmable_projector_runtime_login; SET LOCAL ROLE programmable_projector_runtime and verify it before enqueueing. Returns accepted=false only at the hard 4096-row capacity.';
comment on function programmable_wake_private.claim_quicknode_wake_v1(
  text, bytea
) is
  'Claims one newest-block wake using FOR UPDATE SKIP LOCKED. A crashed worker can be reclaimed after the 210-second lease expires.';

revoke all on table programmable_wake_private.quicknode_wake_jobs_v1
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login, programmable_projector_runtime,
  programmable_projector_runtime_login;

revoke all on sequence
  programmable_wake_private.quicknode_wake_jobs_v1_wake_id_seq
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login, programmable_projector_runtime,
  programmable_projector_runtime_login;

revoke all on function
  programmable_wake_private.enqueue_quicknode_wake_v1(
    bytea, bigint, text, timestamptz, text, bytea
  ),
  programmable_wake_private.claim_quicknode_wake_v1(text, bytea),
  programmable_wake_private.complete_quicknode_wake_v1(
    bigint, bigint, text, bytea
  ),
  programmable_wake_private.retry_quicknode_wake_v1(
    bigint, bigint, text, bytea, integer
  )
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login, programmable_projector_runtime,
  programmable_projector_runtime_login;

grant usage on schema programmable_wake_private
  to programmable_projector_runtime;
grant execute on function
  programmable_wake_private.enqueue_quicknode_wake_v1(
    bytea, bigint, text, timestamptz, text, bytea
  ),
  programmable_wake_private.claim_quicknode_wake_v1(text, bytea),
  programmable_wake_private.complete_quicknode_wake_v1(
    bigint, bigint, text, bytea
  ),
  programmable_wake_private.retry_quicknode_wake_v1(
    bigint, bigint, text, bytea, integer
  )
to programmable_projector_runtime;

reset role;
