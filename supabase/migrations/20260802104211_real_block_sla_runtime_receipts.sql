-- Private, immutable runtime receipts for the organic QuickNode -> optimistic
-- read-model SLA proof. No request signature, secret, raw database URL or
-- additional request body copy is retained.

reset role;
set role programmable_migrator;

create table programmable_wake_private.quicknode_wake_delivery_receipts_v2 (
  delivery_receipt_id bigint generated always as identity primary key,
  wake_id bigint not null
    references programmable_wake_private.quicknode_wake_jobs_v1(wake_id)
    on delete cascade,
  nonce_digest bytea not null,
  stream_id text not null,
  block_number_hint bigint not null,
  payload_digest bytea not null,
  signed_at timestamptz not null,
  handler_received_at timestamptz not null,
  database_received_at timestamptz not null,
  job_persisted_at timestamptz not null,
  enqueued boolean not null,
  queue_row_count_before smallint not null,
  queue_row_count_after smallint not null,
  repository_commit text not null,
  vercel_deployment_id text not null,
  vercel_origin text not null,
  vercel_project_id text not null,
  response_status smallint,
  response_cache_control text,
  acknowledged_at timestamptz,
  expires_at timestamptz not null,
  check (
    pg_catalog.octet_length(nonce_digest) = 32
    and nonce_digest <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and pg_catalog.octet_length(payload_digest) = 32
    and payload_digest <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  ),
  check (
    stream_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    and block_number_hint >= 0
  ),
  check (
    pg_catalog.isfinite(signed_at)
    and pg_catalog.isfinite(handler_received_at)
    and pg_catalog.isfinite(database_received_at)
    and pg_catalog.isfinite(job_persisted_at)
    and pg_catalog.isfinite(expires_at)
    and (acknowledged_at is null or pg_catalog.isfinite(acknowledged_at))
    and handler_received_at = database_received_at
    and signed_at <= handler_received_at + interval '30 seconds'
    and signed_at >= handler_received_at - interval '5 minutes'
    and (
      (
        enqueued
        and database_received_at <= job_persisted_at
        and job_persisted_at <= database_received_at + interval '2 seconds'
      )
      or
      (
        not enqueued
        and job_persisted_at <= database_received_at
      )
    )
    and expires_at = database_received_at + interval '2 hours'
  ),
  check (
    (enqueued and queue_row_count_before = 0 and queue_row_count_after = 1)
    or
    (not enqueued and queue_row_count_before = 1 and queue_row_count_after = 1)
  ),
  check (
    repository_commit ~ '^[0-9a-f]{40}$'
    and repository_commit <> pg_catalog.repeat('0', 40)
    and vercel_deployment_id ~ '^dpl_[A-Za-z0-9]{20,128}$'
    and vercel_origin ~ '^https://[a-z0-9.-]+[.]vercel[.]app$'
    and vercel_project_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
  ),
  check (
    (
      response_status is null
      and response_cache_control is null
      and acknowledged_at is null
    )
    or
    (
      response_status in (202, 503)
      and response_cache_control = 'no-store'
      and acknowledged_at is not null
      and (response_status <> 503 or enqueued)
      and acknowledged_at >= case
        when enqueued then job_persisted_at else database_received_at
      end
      and acknowledged_at <= expires_at
    )
  )
);

create index quicknode_wake_delivery_receipts_v2_capture_idx
on programmable_wake_private.quicknode_wake_delivery_receipts_v2 (
  wake_id,
  nonce_digest,
  delivery_receipt_id
)
where response_status in (202, 503);

create index quicknode_wake_delivery_receipts_v2_expiry_idx
on programmable_wake_private.quicknode_wake_delivery_receipts_v2 (
  expires_at,
  delivery_receipt_id
);

comment on table
  programmable_wake_private.quicknode_wake_delivery_receipts_v2 is
  'Bounded per-delivery receipts. They retain digests and DB/server timing only; HMAC signatures, secrets and a second raw payload copy are forbidden.';

alter table programmable_wake_private.quicknode_wake_delivery_receipts_v2
  enable row level security;
alter table programmable_wake_private.quicknode_wake_delivery_receipts_v2
  force row level security;

create policy quicknode_wake_delivery_receipts_v2_migrator_all
on programmable_wake_private.quicknode_wake_delivery_receipts_v2
for all to programmable_migrator
using (true) with check (true);

create function programmable_wake_private.enqueue_quicknode_wake_v2(
  p_nonce_digest bytea,
  p_block_number_hint bigint,
  p_block_hint text,
  p_issued_at timestamptz,
  p_payload text,
  p_payload_digest bytea,
  p_handler_received_at timestamptz,
  p_stream_id text,
  p_repository_commit text,
  p_vercel_deployment_id text,
  p_vercel_origin text,
  p_vercel_project_id text
)
returns table (
  accepted boolean,
  wake_id bigint,
  enqueued boolean,
  block_number_hint bigint,
  job_state text,
  delivery_receipt_id bigint,
  handler_received_at timestamptz,
  database_received_at timestamptz,
  job_persisted_at timestamptz,
  queue_row_count_before smallint,
  queue_row_count_after smallint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  database_now timestamptz := pg_catalog.clock_timestamp();
  maintenance_now timestamptz;
  enqueued_row record;
  job_row programmable_wake_private.quicknode_wake_jobs_v1%rowtype;
  inserted_receipt_id bigint;
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
  then
    raise exception using
      errcode = '42501',
      message = 'QuickNode wake receipts require their runtime identity';
  end if;

  if p_stream_id is null
     or p_stream_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
     or p_repository_commit is null
     or p_repository_commit !~ '^[0-9a-f]{40}$'
     or p_repository_commit = pg_catalog.repeat('0', 40)
     or p_vercel_deployment_id is null
     or p_vercel_deployment_id !~ '^dpl_[A-Za-z0-9]{20,128}$'
     or p_vercel_origin is null
     or p_vercel_origin !~ '^https://[a-z0-9.-]+[.]vercel[.]app$'
     or p_vercel_project_id is null
     or p_vercel_project_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
  then
    raise exception using errcode = '22023', message = 'invalid QuickNode receipt envelope';
  end if;

  begin
    if (p_block_hint::jsonb ->> 'streamId') is distinct from p_stream_id then
      raise exception using errcode = '22023', message = 'invalid QuickNode receipt envelope';
    end if;
  exception when others then
    raise exception using errcode = '22023', message = 'invalid QuickNode receipt envelope';
  end;

  select * into enqueued_row
  from programmable_wake_private.enqueue_quicknode_wake_v1(
    p_nonce_digest,
    p_block_number_hint,
    p_block_hint,
    p_issued_at,
    p_payload,
    p_payload_digest
  );
  if not found or not enqueued_row.accepted then
    return query select
      false,
      enqueued_row.wake_id::bigint,
      false,
      p_block_number_hint,
      'capacity'::text,
      null::bigint,
      database_now,
      database_now,
      null::timestamptz,
      0::smallint,
      0::smallint;
    return;
  end if;

  maintenance_now := pg_catalog.clock_timestamp();
  with expired as materialized (
    select receipt.delivery_receipt_id
    from programmable_wake_private.quicknode_wake_delivery_receipts_v2 as receipt
    where receipt.expires_at <= maintenance_now
    order by receipt.expires_at, receipt.delivery_receipt_id
    limit 256
    for update skip locked
  )
  delete from programmable_wake_private.quicknode_wake_delivery_receipts_v2 as receipt
  using expired
  where receipt.delivery_receipt_id = expired.delivery_receipt_id
    and receipt.expires_at <= maintenance_now;

  if (
    select pg_catalog.count(*) = 8192
    from (
      select 1
      from programmable_wake_private.quicknode_wake_delivery_receipts_v2
      limit 8192
    ) as bounded_receipts
  ) then
    raise exception using errcode = '53300', message = 'QuickNode receipt capacity exhausted';
  end if;

  select * into job_row
  from programmable_wake_private.quicknode_wake_jobs_v1 as job
  where job.wake_id = enqueued_row.wake_id
  for share;
  if not found
     or job_row.block_number_hint <> p_block_number_hint
     or job_row.payload_digest <> p_payload_digest
  then
    raise exception using errcode = '40001', message = 'QuickNode receipt lost its queue row';
  end if;

  insert into programmable_wake_private.quicknode_wake_delivery_receipts_v2 (
    wake_id,
    nonce_digest,
    stream_id,
    block_number_hint,
    payload_digest,
    signed_at,
    handler_received_at,
    database_received_at,
    job_persisted_at,
    enqueued,
    queue_row_count_before,
    queue_row_count_after,
    repository_commit,
    vercel_deployment_id,
    vercel_origin,
    vercel_project_id,
    expires_at
  ) values (
    enqueued_row.wake_id,
    p_nonce_digest,
    p_stream_id,
    p_block_number_hint,
    p_payload_digest,
    p_issued_at,
    database_now,
    database_now,
    job_row.received_at,
    enqueued_row.enqueued,
    case when enqueued_row.enqueued then 0 else 1 end,
    1,
    p_repository_commit,
    p_vercel_deployment_id,
    p_vercel_origin,
    p_vercel_project_id,
    database_now + interval '2 hours'
  ) returning quicknode_wake_delivery_receipts_v2.delivery_receipt_id
  into inserted_receipt_id;

  return query select
    true,
    enqueued_row.wake_id::bigint,
    enqueued_row.enqueued::boolean,
    enqueued_row.block_number_hint::bigint,
    enqueued_row.job_state::text,
    inserted_receipt_id,
    database_now,
    database_now,
    job_row.received_at,
    (case when enqueued_row.enqueued then 0 else 1 end)::smallint,
    1::smallint;
end
$function$;

create function programmable_wake_private.acknowledge_quicknode_wake_v2(
  p_delivery_receipt_id bigint,
  p_wake_id bigint
)
returns table (
  delivery_receipt_id bigint,
  wake_id bigint,
  response_status smallint,
  response_cache_control text,
  acknowledged_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  receipt programmable_wake_private.quicknode_wake_delivery_receipts_v2%rowtype;
  database_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
  then
    raise exception using
      errcode = '42501',
      message = 'QuickNode wake acknowledgements require their runtime identity';
  end if;
  if p_delivery_receipt_id is null or p_delivery_receipt_id <= 0
     or p_wake_id is null or p_wake_id <= 0
  then
    raise exception using errcode = '22023', message = 'invalid QuickNode acknowledgement';
  end if;

  select * into receipt
  from programmable_wake_private.quicknode_wake_delivery_receipts_v2
  where quicknode_wake_delivery_receipts_v2.delivery_receipt_id = p_delivery_receipt_id
    and quicknode_wake_delivery_receipts_v2.wake_id = p_wake_id
  for update;
  if not found or receipt.expires_at <= database_now then
    raise exception using errcode = '40001', message = 'QuickNode receipt is unavailable';
  end if;

  if receipt.acknowledged_at is null then
    update programmable_wake_private.quicknode_wake_delivery_receipts_v2
    set response_status = 202,
        response_cache_control = 'no-store',
        acknowledged_at = database_now
    where quicknode_wake_delivery_receipts_v2.delivery_receipt_id = p_delivery_receipt_id;
  elsif receipt.response_status <> 202
     or receipt.response_cache_control <> 'no-store'
  then
    raise exception using errcode = '40001', message = 'QuickNode receipt acknowledgement conflicts';
  else
    database_now := receipt.acknowledged_at;
  end if;

  return query select
    p_delivery_receipt_id,
    p_wake_id,
    202::smallint,
    'no-store'::text,
    database_now;
end
$function$;

-- One database-sourced, single-use switch stages the deliberate provider
-- retry used by the real-block SLA probe. No caller supplies release identity
-- or timing facts, and duplicate delivery receipts can never arm it.
create table programmable_wake_private.real_block_sla_provider_retry_arms_v1 (
  arm_id uuid primary key,
  repository_commit text not null,
  vercel_deployment_id text not null,
  vercel_origin text not null,
  vercel_project_id text not null,
  stream_id text not null,
  state text not null check (state in ('armed', 'consumed')),
  armed_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_delivery_receipt_id bigint,
  consumed_wake_id bigint,
  consumed_block_number_hint bigint,
  consumed_payload_digest bytea,
  unique (
    repository_commit, vercel_deployment_id, vercel_origin,
    vercel_project_id, stream_id
  ),
  check (
    repository_commit ~ '^[0-9a-f]{40}$'
    and repository_commit <> pg_catalog.repeat('0', 40)
    and vercel_deployment_id ~ '^dpl_[A-Za-z0-9]{20,128}$'
    and vercel_origin ~ '^https://[a-z0-9.-]+[.]vercel[.]app$'
    and vercel_project_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
    and stream_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    and pg_catalog.isfinite(armed_at)
    and pg_catalog.isfinite(expires_at)
    and expires_at = armed_at + interval '5 minutes'
  ),
  check (
    (
      state = 'armed'
      and consumed_at is null
      and consumed_delivery_receipt_id is null
      and consumed_wake_id is null
      and consumed_block_number_hint is null
      and consumed_payload_digest is null
    )
    or
    (
      state = 'consumed'
      and consumed_at is not null
      and pg_catalog.isfinite(consumed_at)
      and consumed_at between armed_at and expires_at
      and consumed_delivery_receipt_id is not null
      and consumed_wake_id is not null
      and consumed_block_number_hint >= 0
      and pg_catalog.octet_length(consumed_payload_digest) = 32
      and consumed_payload_digest <>
        pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    )
  )
);

create table programmable_wake_private.real_block_sla_provider_retry_consumptions_v1 (
  arm_id uuid not null unique,
  delivery_receipt_id bigint primary key,
  wake_id bigint not null,
  stream_id text not null,
  block_number_hint bigint not null,
  payload_digest bytea not null,
  repository_commit text not null,
  vercel_deployment_id text not null,
  vercel_origin text not null,
  vercel_project_id text not null,
  delivery_received_at timestamptz not null,
  consumed_at timestamptz not null,
  expires_at timestamptz not null,
  unique (
    delivery_receipt_id, wake_id, repository_commit,
    vercel_deployment_id, vercel_origin, vercel_project_id
  ),
  check (
    repository_commit ~ '^[0-9a-f]{40}$'
    and repository_commit <> pg_catalog.repeat('0', 40)
    and vercel_deployment_id ~ '^dpl_[A-Za-z0-9]{20,128}$'
    and vercel_origin ~ '^https://[a-z0-9.-]+[.]vercel[.]app$'
    and vercel_project_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
    and stream_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    and block_number_hint >= 0
    and pg_catalog.octet_length(payload_digest) = 32
    and payload_digest <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and pg_catalog.isfinite(delivery_received_at)
    and pg_catalog.isfinite(consumed_at)
    and pg_catalog.isfinite(expires_at)
    and consumed_at >= delivery_received_at
    and consumed_at <= expires_at
    and expires_at <= delivery_received_at + interval '5 minutes'
  )
);

alter table programmable_wake_private.real_block_sla_provider_retry_arms_v1
  enable row level security;
alter table programmable_wake_private.real_block_sla_provider_retry_arms_v1
  force row level security;
alter table programmable_wake_private.real_block_sla_provider_retry_consumptions_v1
  enable row level security;
alter table programmable_wake_private.real_block_sla_provider_retry_consumptions_v1
  force row level security;

create policy real_block_sla_provider_retry_arms_v1_migrator_all
on programmable_wake_private.real_block_sla_provider_retry_arms_v1
for all to programmable_migrator
using (true) with check (true);

create policy real_block_sla_provider_retry_consumptions_v1_migrator_all
on programmable_wake_private.real_block_sla_provider_retry_consumptions_v1
for all to programmable_migrator
using (true) with check (true);

create function programmable_wake_private.arm_real_block_sla_provider_retry_once_v1(
  p_repository_commit text,
  p_vercel_deployment_id text,
  p_vercel_origin text,
  p_vercel_project_id text,
  p_stream_id text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  database_now timestamptz := pg_catalog.clock_timestamp();
  inserted_arm_id uuid := pg_catalog.gen_random_uuid();
  existing_arm programmable_wake_private.real_block_sla_provider_retry_arms_v1%rowtype;
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
     or p_repository_commit is null
     or p_repository_commit !~ '^[0-9a-f]{40}$'
     or p_repository_commit = pg_catalog.repeat('0', 40)
     or p_vercel_deployment_id is null
     or p_vercel_deployment_id !~ '^dpl_[A-Za-z0-9]{20,128}$'
     or p_vercel_origin is null
     or p_vercel_origin !~ '^https://[a-z0-9.-]+[.]vercel[.]app$'
     or p_vercel_project_id is null
     or p_vercel_project_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
     or p_stream_id is null
     or p_stream_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
  then
    raise exception using errcode = '42501', message = 'invalid SLA provider retry arm identity';
  end if;

  if not exists (
    select 1
    from programmable_private.candidate_database_control as control
    where control.singleton
      and control.database_mode = 'candidate-only'
      and control.promoted_at is null
      and control.promotion_attestation_commitment is null
      and control.promotion_baseline_commitment is null
      and control.promotion_parity_commitment is null
      and control.promotion_input_commitment is null
  ) then
    raise exception using errcode = '55000', message = 'SLA provider retry requires unpromoted candidate database';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1347571539, 2);
  with expired as materialized (
    select arm.arm_id
    from programmable_wake_private.real_block_sla_provider_retry_arms_v1 as arm
    where arm.state = 'armed' and arm.expires_at <= database_now
    order by arm.expires_at, arm.arm_id
    limit 256
    for update skip locked
  )
  delete from programmable_wake_private.real_block_sla_provider_retry_arms_v1 as arm
  using expired
  where arm.arm_id = expired.arm_id
    and arm.state = 'armed'
    and arm.expires_at <= database_now;

  select * into existing_arm
  from programmable_wake_private.real_block_sla_provider_retry_arms_v1 as arm
  where arm.repository_commit = p_repository_commit
    and arm.vercel_deployment_id = p_vercel_deployment_id
    and arm.vercel_origin = p_vercel_origin
    and arm.vercel_project_id = p_vercel_project_id
    and arm.stream_id = p_stream_id
  for update;
  if found then
    if existing_arm.state = 'armed' then
      return existing_arm.arm_id;
    end if;
    raise exception using errcode = '55000', message = 'SLA provider retry arm is already spent';
  end if;
  if (
    select pg_catalog.count(*) = 1024
    from (
      select 1
      from programmable_wake_private.real_block_sla_provider_retry_arms_v1
      limit 1024
    ) as bounded_arms
  ) then
    raise exception using errcode = '53300', message = 'SLA provider retry arm capacity exhausted';
  end if;

  insert into programmable_wake_private.real_block_sla_provider_retry_arms_v1 (
    arm_id, repository_commit, vercel_deployment_id, vercel_origin,
    vercel_project_id, stream_id, state, armed_at, expires_at
  ) values (
    inserted_arm_id, p_repository_commit, p_vercel_deployment_id,
    p_vercel_origin, p_vercel_project_id, p_stream_id,
    'armed', database_now, database_now + interval '5 minutes'
  );
  return inserted_arm_id;
end
$function$;

create function programmable_wake_private.consume_real_block_sla_provider_retry_once_v1(
  p_delivery_receipt_id bigint,
  p_wake_id bigint
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
  receipt programmable_wake_private.quicknode_wake_delivery_receipts_v2%rowtype;
  arm programmable_wake_private.real_block_sla_provider_retry_arms_v1%rowtype;
  inserted_receipt_id bigint;
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
     or p_delivery_receipt_id is null or p_delivery_receipt_id <= 0
     or p_wake_id is null or p_wake_id <= 0
  then
    raise exception using errcode = '42501', message = 'invalid SLA provider retry identity';
  end if;

  select * into receipt
  from programmable_wake_private.quicknode_wake_delivery_receipts_v2
  where delivery_receipt_id = p_delivery_receipt_id
  for update;
  if not found or receipt.wake_id <> p_wake_id then
    raise exception using errcode = '22023', message = 'invalid SLA provider retry receipt binding';
  end if;
  if not receipt.enqueued then
    return false;
  end if;
  if not exists (
    select 1
    from programmable_private.candidate_database_control as control
    where control.singleton
      and control.database_mode = 'candidate-only'
      and control.promoted_at is null
      and control.promotion_attestation_commitment is null
      and control.promotion_baseline_commitment is null
      and control.promotion_parity_commitment is null
      and control.promotion_input_commitment is null
  ) then
    raise exception using errcode = '55000', message = 'SLA provider retry requires unpromoted candidate database';
  end if;
  if receipt.response_status is distinct from 202
     or receipt.response_cache_control is distinct from 'no-store'
     or receipt.acknowledged_at is null
     or database_now > receipt.database_received_at + interval '5 minutes'
  then
    return false;
  end if;

  select * into arm
  from programmable_wake_private.real_block_sla_provider_retry_arms_v1 as candidate_arm
  where candidate_arm.repository_commit = receipt.repository_commit
    and candidate_arm.vercel_deployment_id = receipt.vercel_deployment_id
    and candidate_arm.vercel_origin = receipt.vercel_origin
    and candidate_arm.vercel_project_id = receipt.vercel_project_id
    and candidate_arm.stream_id = receipt.stream_id
    and candidate_arm.state = 'armed'
    and candidate_arm.expires_at >= database_now
  for update;
  if not found then
    return false;
  end if;

  insert into programmable_wake_private.real_block_sla_provider_retry_consumptions_v1 (
    arm_id, delivery_receipt_id, wake_id, stream_id,
    block_number_hint, payload_digest, repository_commit,
    vercel_deployment_id, vercel_origin, vercel_project_id,
    delivery_received_at, consumed_at, expires_at
  ) values (
    arm.arm_id, receipt.delivery_receipt_id, receipt.wake_id, receipt.stream_id,
    receipt.block_number_hint, receipt.payload_digest, receipt.repository_commit,
    receipt.vercel_deployment_id, receipt.vercel_origin, receipt.vercel_project_id,
    receipt.database_received_at, database_now,
    arm.expires_at
  )
  on conflict (delivery_receipt_id) do nothing
  returning delivery_receipt_id into inserted_receipt_id;

  if inserted_receipt_id is null then
    return false;
  end if;

  update programmable_wake_private.quicknode_wake_delivery_receipts_v2
  set response_status = 503
  where delivery_receipt_id = receipt.delivery_receipt_id
    and wake_id = receipt.wake_id
    and enqueued
    and response_status = 202
    and response_cache_control = 'no-store'
    and acknowledged_at is not null;
  if not found then
    raise exception using errcode = '40001', message = 'SLA provider retry response transition failed';
  end if;

  update programmable_wake_private.real_block_sla_provider_retry_arms_v1
  set state = 'consumed',
      consumed_at = database_now,
      consumed_delivery_receipt_id = receipt.delivery_receipt_id,
      consumed_wake_id = receipt.wake_id,
      consumed_block_number_hint = receipt.block_number_hint,
      consumed_payload_digest = receipt.payload_digest
  where arm_id = arm.arm_id
    and state = 'armed'
    and expires_at >= database_now;
  if not found then
    raise exception using errcode = '40001', message = 'SLA provider retry arm transition failed';
  end if;

  return true;
end
$function$;

create function programmable_wake_private.real_block_sla_initial_receipt_is_eligible_v1(
  p_delivery_receipt_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from programmable_wake_private.quicknode_wake_delivery_receipts_v2 as receipt
    where receipt.delivery_receipt_id = p_delivery_receipt_id
      and receipt.enqueued
      and receipt.response_cache_control = 'no-store'
      and receipt.acknowledged_at is not null
      and receipt.response_status = 503
      and exists (
        select 1
        from programmable_wake_private.real_block_sla_provider_retry_consumptions_v1 as retry
        where retry.delivery_receipt_id = receipt.delivery_receipt_id
          and retry.wake_id = receipt.wake_id
          and retry.stream_id = receipt.stream_id
          and retry.block_number_hint = receipt.block_number_hint
          and retry.payload_digest = receipt.payload_digest
          and retry.repository_commit = receipt.repository_commit
          and retry.vercel_deployment_id = receipt.vercel_deployment_id
          and retry.vercel_origin = receipt.vercel_origin
          and retry.vercel_project_id = receipt.vercel_project_id
          and retry.delivery_received_at = receipt.database_received_at
          and retry.consumed_at between retry.delivery_received_at and retry.expires_at
      )
  )
$function$;

revoke all on function
  programmable_wake_private.real_block_sla_initial_receipt_is_eligible_v1(bigint)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_projector_runtime, programmable_projector_runtime_login,
  programmable_api_reader_login, programmable_projector_login;

-- The original v1 append contract fixed the RPC method counts at 4/7/11.
-- v2 retains every v1 identity, provider and payload validation while allowing
-- the measured target+head reads (4/5 and 7/8) and a bundle-wide total.
-- Derive v2 from the complete audited v1 writer so every immutable identity,
-- provider, payload, capacity and replay check stays identical. Only the six
-- measured RPC-count predicates change.
do $migration$
declare
  source_definition text := pg_catalog.pg_get_functiondef(
    'programmable_private.append_optimistic_market_state_v1(uuid,uuid,bytea,bytea,bytea,bytea,numeric,integer,numeric,integer,integer,bytea,bytea,bytea,bytea,jsonb,bytea,uuid,uuid,text,text,bytea,bytea,bytea,bytea,bigint,bigint,smallint,smallint,smallint,smallint,smallint,smallint,smallint,bytea,timestamp with time zone)'::regprocedure
  );
  rewritten_definition text;
begin
  rewritten_definition := pg_catalog.replace(
    source_definition,
    'append_optimistic_market_state_v1(',
    'append_optimistic_market_state_v2('
  );
  if rewritten_definition = source_definition then
    raise exception 'could not derive optimistic market-state v2 writer';
  end if;

  if pg_catalog.strpos(rewritten_definition, 'or p_block_provider_call_count_a <> 4') = 0
     or pg_catalog.strpos(rewritten_definition, 'or p_block_provider_call_count_b <> 4') = 0
     or pg_catalog.strpos(rewritten_definition, 'or p_market_provider_call_count_a <> 7') = 0
     or pg_catalog.strpos(rewritten_definition, 'or p_market_provider_call_count_b <> 7') = 0
     or pg_catalog.strpos(rewritten_definition, 'or p_total_provider_call_count_a <> 11') = 0
     or pg_catalog.strpos(rewritten_definition, 'or p_total_provider_call_count_b <> 11') = 0
  then
    raise exception 'optimistic market-state v1 count contract changed unexpectedly';
  end if;

  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    'or p_block_provider_call_count_a <> 4',
    'or p_block_provider_call_count_a <> (case when block_row.provider_a_head = block_row.block_number then 4 else 5 end)'
  );
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    'or p_block_provider_call_count_b <> 4',
    'or p_block_provider_call_count_b <> (case when block_row.provider_b_head = block_row.block_number then 4 else 5 end)'
  );
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    'or p_market_provider_call_count_a <> 7',
    'or p_market_provider_call_count_a <> (case when p_market_provider_a_head = block_row.block_number then 7 else 8 end)'
  );
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    'or p_market_provider_call_count_b <> 7',
    'or p_market_provider_call_count_b <> (case when p_market_provider_b_head = block_row.block_number then 7 else 8 end)'
  );
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    'or p_total_provider_call_count_a <> 11',
    'or p_total_provider_call_count_a is null or p_total_provider_call_count_a < p_block_provider_call_count_a + p_market_provider_call_count_a'
  );
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    'or p_total_provider_call_count_b <> 11',
    'or p_total_provider_call_count_b is null or p_total_provider_call_count_b < p_block_provider_call_count_b + p_market_provider_call_count_b'
  );

  execute rewritten_definition;
end
$migration$;

alter table programmable_private.optimistic_market_state_rows_v1
  drop constraint optimistic_market_state_rows__block_provider_call_count_a_check,
  drop constraint optimistic_market_state_rows__block_provider_call_count_b_check,
  drop constraint optimistic_market_state_rows_market_provider_call_count_a_check,
  drop constraint optimistic_market_state_rows_market_provider_call_count_b_check,
  drop constraint optimistic_market_state_rows__total_provider_call_count_a_check,
  drop constraint optimistic_market_state_rows__total_provider_call_count_b_check;

alter table programmable_private.optimistic_market_state_rows_v1
  add constraint optimistic_market_state_block_calls_a_v2_check
    check (block_provider_call_count_a between 4 and 5),
  add constraint optimistic_market_state_block_calls_b_v2_check
    check (block_provider_call_count_b between 4 and 5),
  add constraint optimistic_market_state_market_calls_a_v2_check
    check (market_provider_call_count_a between 7 and 8),
  add constraint optimistic_market_state_market_calls_b_v2_check
    check (market_provider_call_count_b between 7 and 8),
  add constraint optimistic_market_state_total_calls_a_v2_check
    check (
      total_provider_call_count_a between 11 and 32767
      and total_provider_call_count_a >=
        block_provider_call_count_a + market_provider_call_count_a
    ),
  add constraint optimistic_market_state_total_calls_b_v2_check
    check (
      total_provider_call_count_b between 11 and 32767
      and total_provider_call_count_b >=
        block_provider_call_count_b + market_provider_call_count_b
    );

revoke all on function programmable_private.append_optimistic_market_state_v2(
  uuid, uuid, bytea, bytea, bytea, bytea, numeric, integer, numeric,
  integer, integer, bytea, bytea, bytea, bytea, jsonb, bytea,
  uuid, uuid, text, text, bytea, bytea, bytea, bytea, bigint, bigint,
  smallint, smallint, smallint, smallint, smallint, smallint, smallint,
  bytea, timestamptz
)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login, programmable_projector_runtime,
  programmable_projector_runtime_login;

grant execute on function programmable_private.append_optimistic_market_state_v2(
  uuid, uuid, bytea, bytea, bytea, bytea, numeric, integer, numeric,
  integer, integer, bytea, bytea, bytea, bytea, jsonb, bytea,
  uuid, uuid, text, text, bytea, bytea, bytea, bytea, bigint, bigint,
  smallint, smallint, smallint, smallint, smallint, smallint, smallint,
  bytea, timestamptz
)
to programmable_projector;

create table programmable_wake_private.optimistic_sla_bundle_receipts_v1 (
  bundle_receipt_id bigint generated always as identity primary key,
  wake_id bigint not null unique
    references programmable_wake_private.quicknode_wake_jobs_v1(wake_id)
    on delete cascade,
  optimistic_block_id uuid not null unique
    references programmable_private.optimistic_block_observations_v1(optimistic_block_id)
    on delete restrict,
  logs_commitment bytea not null,
  provider_a_endpoint_host text not null,
  provider_b_endpoint_host text not null,
  provider_a_endpoint_url_commitment bytea not null,
  provider_b_endpoint_url_commitment bytea not null,
  block_provider_a_head bigint not null,
  block_provider_a_head_hash bytea not null,
  block_provider_a_observed_at timestamptz not null,
  block_provider_b_head bigint not null,
  block_provider_b_head_hash bytea not null,
  block_provider_b_observed_at timestamptz not null,
  block_provider_call_count_a smallint not null check (block_provider_call_count_a between 4 and 5),
  block_provider_call_count_b smallint not null check (block_provider_call_count_b between 4 and 5),
  event_row_count integer not null check (event_row_count between 0 and 4096),
  metadata_token_count integer not null check (metadata_token_count between 0 and 16),
  metadata_provider_call_count_a smallint not null
    check (metadata_provider_call_count_a between 0 and 32766),
  metadata_provider_call_count_b smallint not null
    check (metadata_provider_call_count_b between 0 and 32766),
  market_row_count integer not null check (market_row_count between 0 and 100),
  reorg_generation bigint not null check (reorg_generation >= 0),
  bundle_visible_at timestamptz not null,
  expires_at timestamptz not null,
  check (
    pg_catalog.octet_length(logs_commitment) = 32
    and logs_commitment <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and pg_catalog.octet_length(provider_a_endpoint_url_commitment) = 32
    and pg_catalog.octet_length(provider_b_endpoint_url_commitment) = 32
    and provider_a_endpoint_url_commitment <> provider_b_endpoint_url_commitment
    and (
      (
        metadata_token_count = 0
        and metadata_provider_call_count_a = 0
        and metadata_provider_call_count_b = 0
      )
      or (
        metadata_token_count > 0
        and metadata_provider_call_count_a between
          2 * metadata_token_count and 6 * metadata_token_count
        and metadata_provider_call_count_b between
          2 * metadata_token_count and 6 * metadata_token_count
      )
    )
    and mod(metadata_provider_call_count_a, 2) = 0
    and mod(metadata_provider_call_count_b, 2) = 0
  ),
  check (
    provider_a_endpoint_host ~ '(^|[.])alchemy[.]com$'
    and (
      provider_b_endpoint_host ~ '(^|[.])quicknode[.]com$'
      or provider_b_endpoint_host ~ '(^|[.])quiknode[.]pro$'
    )
    and provider_a_endpoint_host <> provider_b_endpoint_host
  ),
  check (
    block_provider_a_head >= 0
    and block_provider_b_head >= 0
    and pg_catalog.octet_length(block_provider_a_head_hash) = 32
    and pg_catalog.octet_length(block_provider_b_head_hash) = 32
    and block_provider_a_head_hash <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and block_provider_b_head_hash <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and (
      block_provider_a_head <> block_provider_b_head
      or block_provider_a_head_hash = block_provider_b_head_hash
    )
  ),
  check (
    pg_catalog.isfinite(block_provider_a_observed_at)
    and pg_catalog.isfinite(block_provider_b_observed_at)
    and pg_catalog.isfinite(bundle_visible_at)
    and pg_catalog.isfinite(expires_at)
    and block_provider_a_observed_at <= bundle_visible_at + interval '30 seconds'
    and block_provider_b_observed_at <= bundle_visible_at + interval '30 seconds'
    and expires_at = bundle_visible_at + interval '2 hours'
  )
);

create table programmable_wake_private.optimistic_sla_market_receipts_v1 (
  market_receipt_id bigint generated always as identity primary key,
  bundle_receipt_id bigint not null
    references programmable_wake_private.optimistic_sla_bundle_receipts_v1(bundle_receipt_id)
    on delete cascade,
  optimistic_market_state_id uuid not null
    references programmable_private.optimistic_market_state_rows_v1(optimistic_market_state_id)
    on delete restrict,
  market_provider_a_head bigint not null,
  market_provider_a_head_hash bytea not null,
  market_provider_a_observed_at timestamptz not null,
  market_provider_b_head bigint not null,
  market_provider_b_head_hash bytea not null,
  market_provider_b_observed_at timestamptz not null,
  market_provider_call_count_a smallint not null check (market_provider_call_count_a between 7 and 8),
  market_provider_call_count_b smallint not null check (market_provider_call_count_b between 7 and 8),
  total_provider_call_count_a smallint not null check (total_provider_call_count_a between 11 and 32767),
  total_provider_call_count_b smallint not null check (total_provider_call_count_b between 11 and 32767),
  unique (bundle_receipt_id, optimistic_market_state_id),
  check (
    market_provider_a_head >= 0
    and market_provider_b_head >= 0
    and pg_catalog.octet_length(market_provider_a_head_hash) = 32
    and pg_catalog.octet_length(market_provider_b_head_hash) = 32
    and market_provider_a_head_hash <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and market_provider_b_head_hash <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and (
      market_provider_a_head <> market_provider_b_head
      or market_provider_a_head_hash = market_provider_b_head_hash
    )
    and pg_catalog.isfinite(market_provider_a_observed_at)
    and pg_catalog.isfinite(market_provider_b_observed_at)
  )
);

alter table programmable_wake_private.optimistic_sla_bundle_receipts_v1
  enable row level security;
alter table programmable_wake_private.optimistic_sla_bundle_receipts_v1
  force row level security;
alter table programmable_wake_private.optimistic_sla_market_receipts_v1
  enable row level security;
alter table programmable_wake_private.optimistic_sla_market_receipts_v1
  force row level security;

create policy optimistic_sla_bundle_receipts_v1_migrator_all
on programmable_wake_private.optimistic_sla_bundle_receipts_v1
for all to programmable_migrator using (true) with check (true);
create policy optimistic_sla_market_receipts_v1_migrator_all
on programmable_wake_private.optimistic_sla_market_receipts_v1
for all to programmable_migrator using (true) with check (true);

create function programmable_wake_private.record_optimistic_sla_bundle_v1(
  p_wake_id bigint,
  p_optimistic_block_id uuid,
  p_logs_commitment bytea,
  p_provider_a_endpoint_host text,
  p_provider_b_endpoint_host text,
  p_block_provider_a_head bigint,
  p_block_provider_a_head_hash bytea,
  p_block_provider_a_observed_at timestamptz,
  p_block_provider_b_head bigint,
  p_block_provider_b_head_hash bytea,
  p_block_provider_b_observed_at timestamptz,
  p_block_provider_call_count_a smallint,
  p_block_provider_call_count_b smallint,
  p_metadata_provider_call_count_a smallint,
  p_metadata_provider_call_count_b smallint
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  database_now timestamptz := pg_catalog.clock_timestamp();
  job programmable_wake_private.quicknode_wake_jobs_v1%rowtype;
  block_row programmable_private.optimistic_block_observations_v1%rowtype;
  pointer programmable_private.optimistic_block_current_canonical_v1%rowtype;
  provider_a record;
  provider_b record;
  first_receipt programmable_wake_private.quicknode_wake_delivery_receipts_v2%rowtype;
  event_count integer;
  metadata_count integer;
  market_count integer;
  inserted_id bigint;
begin
  if session_user::text <> 'programmable_projector_login'
     or active_role is distinct from 'programmable_projector'
  then
    raise exception using errcode = '42501', message = 'optimistic SLA receipts require projector identity';
  end if;

  select * into job
  from programmable_wake_private.quicknode_wake_jobs_v1
  where wake_id = p_wake_id
  for share;
  select * into block_row
  from programmable_private.optimistic_block_observations_v1
  where optimistic_block_id = p_optimistic_block_id
  for share;
  if job.wake_id is null
     or block_row.optimistic_block_id is null
     or job.block_number_hint <> block_row.block_number
  then
    raise exception using errcode = '22023', message = 'invalid optimistic SLA bundle binding';
  end if;

  select * into pointer
  from programmable_private.optimistic_block_current_canonical_v1
  where chain_id = block_row.chain_id
    and block_number = block_row.block_number
    and optimistic_block_id = block_row.optimistic_block_id
    and block_hash = block_row.block_hash;
  if not found then
    raise exception using errcode = '40001', message = 'optimistic SLA block is not canonical';
  end if;

  select * into first_receipt
  from programmable_wake_private.quicknode_wake_delivery_receipts_v2
  where wake_id = p_wake_id
    and programmable_wake_private.real_block_sla_initial_receipt_is_eligible_v1(
      delivery_receipt_id
    )
  order by delivery_receipt_id
  limit 1;
  if not found then return null; end if;
  if not found then
    raise exception using errcode = '40001', message = 'optimistic SLA wake is not acknowledged';
  end if;

  select
    metadata.endpoint_url_commitment::bytea as endpoint_url_commitment,
    metadata.vendor::text as vendor
  into provider_a
  from programmable_private.rpc_provider_deployment_metadata as metadata
  where metadata.provider_deployment_id = block_row.provider_a_id;
  select
    metadata.endpoint_url_commitment::bytea as endpoint_url_commitment,
    metadata.vendor::text as vendor
  into provider_b
  from programmable_private.rpc_provider_deployment_metadata as metadata
  where metadata.provider_deployment_id = block_row.provider_b_id;

  if provider_a.vendor is distinct from 'alchemy'
     or provider_b.vendor is distinct from 'quicknode'
     or p_logs_commitment is null
     or pg_catalog.octet_length(p_logs_commitment) <> 32
     or p_logs_commitment = pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
     or p_provider_a_endpoint_host !~ '(^|[.])alchemy[.]com$'
     or (
       p_provider_b_endpoint_host !~ '(^|[.])quicknode[.]com$'
       and p_provider_b_endpoint_host !~ '(^|[.])quiknode[.]pro$'
     )
     or p_block_provider_a_head <> block_row.provider_a_head
     or p_block_provider_b_head <> block_row.provider_b_head
     or p_block_provider_a_head_hash is null
     or pg_catalog.octet_length(p_block_provider_a_head_hash) <> 32
     or p_block_provider_b_head_hash is null
     or pg_catalog.octet_length(p_block_provider_b_head_hash) <> 32
     or (
       p_block_provider_a_head = block_row.block_number
       and p_block_provider_a_head_hash <> block_row.block_hash
     )
     or (
       p_block_provider_b_head = block_row.block_number
       and p_block_provider_b_head_hash <> block_row.block_hash
     )
     or (
       p_block_provider_a_head = p_block_provider_b_head
       and p_block_provider_a_head_hash <> p_block_provider_b_head_hash
     )
     or p_block_provider_a_observed_at < first_receipt.handler_received_at
     or p_block_provider_b_observed_at < first_receipt.handler_received_at
     or p_block_provider_a_observed_at > database_now + interval '30 seconds'
     or p_block_provider_b_observed_at > database_now + interval '30 seconds'
     or p_block_provider_call_count_a <> (case
       when p_block_provider_a_head = block_row.block_number then 4 else 5
     end)
     or p_block_provider_call_count_b <> (case
       when p_block_provider_b_head = block_row.block_number then 4 else 5
     end)
     or p_metadata_provider_call_count_a is null
     or p_metadata_provider_call_count_b is null
     or p_metadata_provider_call_count_a < 0
     or p_metadata_provider_call_count_b < 0
     or mod(p_metadata_provider_call_count_a, 2) <> 0
     or mod(p_metadata_provider_call_count_b, 2) <> 0
  then
    raise exception using errcode = '22023', message = 'invalid optimistic SLA provider evidence';
  end if;

  select pg_catalog.count(*)::integer into event_count
  from programmable_private.optimistic_event_rows_v1
  where optimistic_block_id = block_row.optimistic_block_id;
  select pg_catalog.count(*)::integer into metadata_count
  from programmable_private.optimistic_event_rows_v1
  where optimistic_block_id = block_row.optimistic_block_id
    and normalized_payload ? 'tokenMetadata';
  select pg_catalog.count(*)::integer into market_count
  from programmable_private.optimistic_market_state_rows_v1
  where optimistic_block_id = block_row.optimistic_block_id;

  if (
       metadata_count = 0
       and (
         p_metadata_provider_call_count_a <> 0
         or p_metadata_provider_call_count_b <> 0
       )
     )
     or (
       metadata_count > 0
       and (
         p_metadata_provider_call_count_a < 2 * metadata_count
         or p_metadata_provider_call_count_b < 2 * metadata_count
         or p_metadata_provider_call_count_a > 6 * metadata_count
         or p_metadata_provider_call_count_b > 6 * metadata_count
       )
     )
  then
    raise exception using errcode = '22023', message = 'invalid optimistic SLA metadata evidence';
  end if;

  insert into programmable_wake_private.optimistic_sla_bundle_receipts_v1 (
    wake_id, optimistic_block_id, logs_commitment,
    provider_a_endpoint_host, provider_b_endpoint_host,
    provider_a_endpoint_url_commitment, provider_b_endpoint_url_commitment,
    block_provider_a_head, block_provider_a_head_hash,
    block_provider_a_observed_at, block_provider_b_head,
    block_provider_b_head_hash, block_provider_b_observed_at,
    block_provider_call_count_a, block_provider_call_count_b,
    event_row_count, metadata_token_count,
    metadata_provider_call_count_a, metadata_provider_call_count_b,
    market_row_count, reorg_generation,
    bundle_visible_at, expires_at
  ) values (
    p_wake_id, p_optimistic_block_id, p_logs_commitment,
    p_provider_a_endpoint_host, p_provider_b_endpoint_host,
    provider_a.endpoint_url_commitment, provider_b.endpoint_url_commitment,
    p_block_provider_a_head, p_block_provider_a_head_hash,
    p_block_provider_a_observed_at, p_block_provider_b_head,
    p_block_provider_b_head_hash, p_block_provider_b_observed_at,
    p_block_provider_call_count_a, p_block_provider_call_count_b,
    event_count, metadata_count,
    p_metadata_provider_call_count_a, p_metadata_provider_call_count_b,
    market_count, pointer.reorg_generation,
    database_now, database_now + interval '2 hours'
  )
  on conflict (wake_id) do nothing
  returning bundle_receipt_id into inserted_id;

  if inserted_id is null then
    select bundle_receipt_id into inserted_id
    from programmable_wake_private.optimistic_sla_bundle_receipts_v1
    where wake_id = p_wake_id
      and optimistic_block_id = p_optimistic_block_id
      and logs_commitment = p_logs_commitment
      and provider_a_endpoint_host = p_provider_a_endpoint_host
      and provider_b_endpoint_host = p_provider_b_endpoint_host
      and provider_a_endpoint_url_commitment = provider_a.endpoint_url_commitment
      and provider_b_endpoint_url_commitment = provider_b.endpoint_url_commitment
      and block_provider_a_head = p_block_provider_a_head
      and block_provider_a_head_hash = p_block_provider_a_head_hash
      and block_provider_a_observed_at = p_block_provider_a_observed_at
      and block_provider_b_head = p_block_provider_b_head
      and block_provider_b_head_hash = p_block_provider_b_head_hash
      and block_provider_b_observed_at = p_block_provider_b_observed_at
      and block_provider_call_count_a = p_block_provider_call_count_a
      and block_provider_call_count_b = p_block_provider_call_count_b
      and metadata_provider_call_count_a = p_metadata_provider_call_count_a
      and metadata_provider_call_count_b = p_metadata_provider_call_count_b;
    if not found then
      raise exception using errcode = '40001', message = 'optimistic SLA bundle receipt conflicts';
    end if;
  end if;
  return inserted_id;
end
$function$;

create function programmable_wake_private.record_optimistic_sla_market_v1(
  p_bundle_receipt_id bigint,
  p_optimistic_market_state_id uuid,
  p_market_provider_a_head bigint,
  p_market_provider_a_head_hash bytea,
  p_market_provider_a_observed_at timestamptz,
  p_market_provider_b_head bigint,
  p_market_provider_b_head_hash bytea,
  p_market_provider_b_observed_at timestamptz,
  p_market_provider_call_count_a smallint,
  p_market_provider_call_count_b smallint,
  p_total_provider_call_count_a smallint,
  p_total_provider_call_count_b smallint
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  bundle programmable_wake_private.optimistic_sla_bundle_receipts_v1%rowtype;
  state_row programmable_private.optimistic_market_state_rows_v1%rowtype;
  block_row programmable_private.optimistic_block_observations_v1%rowtype;
  market_count integer;
  expected_total_calls_a integer;
  expected_total_calls_b integer;
  inserted_id bigint;
begin
  if session_user::text <> 'programmable_projector_login'
     or active_role is distinct from 'programmable_projector'
  then
    raise exception using errcode = '42501', message = 'optimistic SLA market receipts require projector identity';
  end if;
  select * into bundle
  from programmable_wake_private.optimistic_sla_bundle_receipts_v1
  where bundle_receipt_id = p_bundle_receipt_id
  for share;
  select * into state_row
  from programmable_private.optimistic_market_state_rows_v1
  where optimistic_market_state_id = p_optimistic_market_state_id
  for share;
  select * into block_row
  from programmable_private.optimistic_block_observations_v1
  where optimistic_block_id = bundle.optimistic_block_id;
  select
    pg_catalog.count(*)::integer,
    bundle.block_provider_call_count_a + bundle.metadata_provider_call_count_a +
      coalesce(
        pg_catalog.sum(market_row.market_provider_call_count_a), 0::bigint
      )::integer,
    bundle.block_provider_call_count_b + bundle.metadata_provider_call_count_b +
      coalesce(
        pg_catalog.sum(market_row.market_provider_call_count_b), 0::bigint
      )::integer
  into market_count, expected_total_calls_a, expected_total_calls_b
  from programmable_private.optimistic_market_state_rows_v1 as market_row
  where market_row.optimistic_block_id = bundle.optimistic_block_id;
  if bundle.bundle_receipt_id is null
     or state_row.optimistic_market_state_id is null
     or state_row.optimistic_block_id <> bundle.optimistic_block_id
     or p_market_provider_a_head <> state_row.market_provider_a_head
     or p_market_provider_b_head <> state_row.market_provider_b_head
     or p_market_provider_a_head_hash is null
     or pg_catalog.octet_length(p_market_provider_a_head_hash) <> 32
     or p_market_provider_b_head_hash is null
     or pg_catalog.octet_length(p_market_provider_b_head_hash) <> 32
     or (
       p_market_provider_a_head = block_row.block_number
       and p_market_provider_a_head_hash <> block_row.block_hash
     )
     or (
       p_market_provider_b_head = block_row.block_number
       and p_market_provider_b_head_hash <> block_row.block_hash
     )
     or (
       p_market_provider_a_head = p_market_provider_b_head
       and p_market_provider_a_head_hash <> p_market_provider_b_head_hash
     )
     or (
       p_market_provider_a_head = bundle.block_provider_a_head
       and p_market_provider_a_head_hash <> bundle.block_provider_a_head_hash
     )
     or (
       p_market_provider_b_head = bundle.block_provider_b_head
       and p_market_provider_b_head_hash <> bundle.block_provider_b_head_hash
     )
     or (
       p_market_provider_a_head = bundle.block_provider_b_head
       and p_market_provider_a_head_hash <> bundle.block_provider_b_head_hash
     )
     or (
       p_market_provider_b_head = bundle.block_provider_a_head
       and p_market_provider_b_head_hash <> bundle.block_provider_a_head_hash
     )
     or p_market_provider_a_observed_at < bundle.block_provider_a_observed_at
     or p_market_provider_b_observed_at < bundle.block_provider_b_observed_at
     or p_market_provider_a_observed_at > bundle.bundle_visible_at + interval '30 seconds'
     or p_market_provider_b_observed_at > bundle.bundle_visible_at + interval '30 seconds'
     or p_market_provider_call_count_a <> state_row.market_provider_call_count_a
     or p_market_provider_call_count_b <> state_row.market_provider_call_count_b
     or p_market_provider_call_count_a <> (case
       when p_market_provider_a_head = block_row.block_number then 7 else 8
     end)
     or p_market_provider_call_count_b <> (case
       when p_market_provider_b_head = block_row.block_number then 7 else 8
     end)
     or state_row.block_provider_call_count_a <> bundle.block_provider_call_count_a
     or state_row.block_provider_call_count_b <> bundle.block_provider_call_count_b
     or market_count <> bundle.market_row_count
     or p_total_provider_call_count_a <> state_row.total_provider_call_count_a
     or p_total_provider_call_count_b <> state_row.total_provider_call_count_b
     or p_total_provider_call_count_a <> expected_total_calls_a
     or p_total_provider_call_count_b <> expected_total_calls_b
  then
    raise exception using errcode = '22023', message = 'invalid optimistic SLA market evidence';
  end if;

  insert into programmable_wake_private.optimistic_sla_market_receipts_v1 (
    bundle_receipt_id, optimistic_market_state_id,
    market_provider_a_head, market_provider_a_head_hash,
    market_provider_a_observed_at, market_provider_b_head,
    market_provider_b_head_hash, market_provider_b_observed_at,
    market_provider_call_count_a, market_provider_call_count_b,
    total_provider_call_count_a, total_provider_call_count_b
  ) values (
    p_bundle_receipt_id, p_optimistic_market_state_id,
    p_market_provider_a_head, p_market_provider_a_head_hash,
    p_market_provider_a_observed_at, p_market_provider_b_head,
    p_market_provider_b_head_hash, p_market_provider_b_observed_at,
    p_market_provider_call_count_a, p_market_provider_call_count_b,
    p_total_provider_call_count_a, p_total_provider_call_count_b
  )
  on conflict (bundle_receipt_id, optimistic_market_state_id) do nothing
  returning market_receipt_id into inserted_id;
  if inserted_id is null then
    select market_receipt_id into inserted_id
    from programmable_wake_private.optimistic_sla_market_receipts_v1
    where bundle_receipt_id = p_bundle_receipt_id
      and optimistic_market_state_id = p_optimistic_market_state_id
      and market_provider_a_head = p_market_provider_a_head
      and market_provider_a_head_hash = p_market_provider_a_head_hash
      and market_provider_a_observed_at = p_market_provider_a_observed_at
      and market_provider_b_head = p_market_provider_b_head
      and market_provider_b_head_hash = p_market_provider_b_head_hash
      and market_provider_b_observed_at = p_market_provider_b_observed_at
      and market_provider_call_count_a = p_market_provider_call_count_a
      and market_provider_call_count_b = p_market_provider_call_count_b
      and total_provider_call_count_a = p_total_provider_call_count_a
      and total_provider_call_count_b = p_total_provider_call_count_b;
    if not found then
      raise exception using errcode = '40001', message = 'optimistic SLA market receipt conflicts';
    end if;
  end if;
  return inserted_id;
end
$function$;

-- Bundle and every persisted market receipt are one database statement. The
-- projector never receives EXECUTE on either component writer, so a malformed
-- later market cannot leave a bundle or an earlier market receipt committed.
create function programmable_wake_private.record_optimistic_sla_receipt_group_v1(
  p_wake_id bigint,
  p_optimistic_block_id uuid,
  p_logs_commitment bytea,
  p_provider_a_endpoint_host text,
  p_provider_b_endpoint_host text,
  p_block_provider_a_head bigint,
  p_block_provider_a_head_hash bytea,
  p_block_provider_a_observed_at timestamptz,
  p_block_provider_b_head bigint,
  p_block_provider_b_head_hash bytea,
  p_block_provider_b_observed_at timestamptz,
  p_block_provider_call_count_a smallint,
  p_block_provider_call_count_b smallint,
  p_metadata_provider_call_count_a smallint,
  p_metadata_provider_call_count_b smallint,
  p_markets jsonb
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  receipt_group_id bigint;
  market jsonb;
  market_receipt_count integer;
  market_state_id uuid;
  market_provider_a_head bigint;
  market_provider_b_head bigint;
  market_provider_a_observed_at timestamptz;
  market_provider_b_observed_at timestamptz;
  market_provider_call_count_a smallint;
  market_provider_call_count_b smallint;
  total_provider_call_count_a smallint;
  total_provider_call_count_b smallint;
begin
  if session_user::text <> 'programmable_projector_login'
     or active_role is distinct from 'programmable_projector'
  then
    raise exception using errcode = '42501', message = 'optimistic SLA receipt groups require projector identity';
  end if;
  if p_markets is null
     or pg_catalog.jsonb_typeof(p_markets) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_markets) < 1
  then
    raise exception using errcode = '22023', message = 'invalid optimistic SLA market receipt group';
  end if;

  receipt_group_id := programmable_wake_private.record_optimistic_sla_bundle_v1(
    p_wake_id, p_optimistic_block_id, p_logs_commitment,
    p_provider_a_endpoint_host, p_provider_b_endpoint_host,
    p_block_provider_a_head, p_block_provider_a_head_hash,
    p_block_provider_a_observed_at, p_block_provider_b_head,
    p_block_provider_b_head_hash, p_block_provider_b_observed_at,
    p_block_provider_call_count_a, p_block_provider_call_count_b,
    p_metadata_provider_call_count_a, p_metadata_provider_call_count_b
  );
  if receipt_group_id is null then return null; end if;

  for market in
    select element.value
    from pg_catalog.jsonb_array_elements(p_markets) with ordinality as element(value, ordinal)
    order by element.ordinal
  loop
    if pg_catalog.jsonb_typeof(market) is distinct from 'object'
       or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(market)) <> 11
       or not market ?& array[
         'optimisticMarketStateId',
         'marketProviderAHead', 'marketProviderAHeadHash', 'marketProviderAObservedAt',
         'marketProviderBHead', 'marketProviderBHeadHash', 'marketProviderBObservedAt',
         'marketProviderCallCountA', 'marketProviderCallCountB',
         'totalProviderCallCountA', 'totalProviderCallCountB'
       ]
       or pg_catalog.jsonb_typeof(market -> 'optimisticMarketStateId') is distinct from 'string'
       or pg_catalog.jsonb_typeof(market -> 'marketProviderAHead') is distinct from 'string'
       or pg_catalog.jsonb_typeof(market -> 'marketProviderAHeadHash') is distinct from 'string'
       or pg_catalog.jsonb_typeof(market -> 'marketProviderAObservedAt') is distinct from 'string'
       or pg_catalog.jsonb_typeof(market -> 'marketProviderBHead') is distinct from 'string'
       or pg_catalog.jsonb_typeof(market -> 'marketProviderBHeadHash') is distinct from 'string'
       or pg_catalog.jsonb_typeof(market -> 'marketProviderBObservedAt') is distinct from 'string'
       or pg_catalog.jsonb_typeof(market -> 'marketProviderCallCountA') is distinct from 'number'
       or pg_catalog.jsonb_typeof(market -> 'marketProviderCallCountB') is distinct from 'number'
       or pg_catalog.jsonb_typeof(market -> 'totalProviderCallCountA') is distinct from 'number'
       or pg_catalog.jsonb_typeof(market -> 'totalProviderCallCountB') is distinct from 'number'
       or market ->> 'marketProviderAHeadHash' !~ '^0x[0-9a-f]{64}$'
       or market ->> 'marketProviderBHeadHash' !~ '^0x[0-9a-f]{64}$'
    then
      raise exception using errcode = '22023', message = 'invalid optimistic SLA market receipt group';
    end if;

    begin
      market_state_id := (market ->> 'optimisticMarketStateId')::uuid;
      market_provider_a_head := (market ->> 'marketProviderAHead')::bigint;
      market_provider_b_head := (market ->> 'marketProviderBHead')::bigint;
      market_provider_a_observed_at := (market ->> 'marketProviderAObservedAt')::timestamptz;
      market_provider_b_observed_at := (market ->> 'marketProviderBObservedAt')::timestamptz;
      market_provider_call_count_a := (market ->> 'marketProviderCallCountA')::smallint;
      market_provider_call_count_b := (market ->> 'marketProviderCallCountB')::smallint;
      total_provider_call_count_a := (market ->> 'totalProviderCallCountA')::smallint;
      total_provider_call_count_b := (market ->> 'totalProviderCallCountB')::smallint;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid optimistic SLA market receipt group';
    end;

    perform programmable_wake_private.record_optimistic_sla_market_v1(
      receipt_group_id, market_state_id,
      market_provider_a_head,
      pg_catalog.decode(pg_catalog.substr(market ->> 'marketProviderAHeadHash', 3), 'hex'),
      market_provider_a_observed_at,
      market_provider_b_head,
      pg_catalog.decode(pg_catalog.substr(market ->> 'marketProviderBHeadHash', 3), 'hex'),
      market_provider_b_observed_at,
      market_provider_call_count_a, market_provider_call_count_b,
      total_provider_call_count_a, total_provider_call_count_b
    );
  end loop;

  select pg_catalog.count(*)::integer into market_receipt_count
  from programmable_wake_private.optimistic_sla_market_receipts_v1 as receipt
  where receipt.bundle_receipt_id = receipt_group_id;
  if market_receipt_count <> pg_catalog.jsonb_array_length(p_markets)
     or market_receipt_count <> (
       select bundle.market_row_count
       from programmable_wake_private.optimistic_sla_bundle_receipts_v1 as bundle
       where bundle.bundle_receipt_id = receipt_group_id
     )
  then
    raise exception using errcode = '22023', message = 'incomplete optimistic SLA market receipt group';
  end if;
  return receipt_group_id;
end
$function$;

create function programmable_wake_private.get_real_block_sla_runtime_evidence_v1(
  p_delivery_receipt_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  initial programmable_wake_private.quicknode_wake_delivery_receipts_v2%rowtype;
  duplicate_receipt programmable_wake_private.quicknode_wake_delivery_receipts_v2%rowtype;
  bundle programmable_wake_private.optimistic_sla_bundle_receipts_v1%rowtype;
  job programmable_wake_private.quicknode_wake_jobs_v1%rowtype;
  block_row programmable_private.optimistic_block_observations_v1%rowtype;
  market_receipts jsonb;
  event_receipts jsonb;
  active_role text := pg_catalog.current_setting('role', true);
begin
  if not (
    (session_user::text = 'programmable_api_reader_login'
      and active_role = 'programmable_api_reader')
    or
    (session_user::text = 'programmable_projector_runtime_login'
      and active_role = 'programmable_projector_runtime')
  ) then
    raise exception using errcode = '42501', message = 'SLA evidence export requires exact reader identity';
  end if;
  if p_delivery_receipt_id is null or p_delivery_receipt_id <= 0 then
    raise exception using errcode = '22023', message = 'invalid SLA delivery receipt';
  end if;

  select * into initial
  from programmable_wake_private.quicknode_wake_delivery_receipts_v2
  where delivery_receipt_id = p_delivery_receipt_id
    and programmable_wake_private.real_block_sla_initial_receipt_is_eligible_v1(
      delivery_receipt_id
    );
  if not found then return null; end if;

  select * into duplicate_receipt
  from programmable_wake_private.quicknode_wake_delivery_receipts_v2
  where wake_id = initial.wake_id
    and stream_id = initial.stream_id
    and block_number_hint = initial.block_number_hint
    and payload_digest = initial.payload_digest
    and delivery_receipt_id > initial.delivery_receipt_id
    and not enqueued
    and queue_row_count_before = 1
    and queue_row_count_after = 1
    and response_status = 202
    and handler_received_at >= initial.acknowledged_at
    and database_received_at >= initial.acknowledged_at
    and handler_received_at <= initial.database_received_at + interval '10 seconds'
    and database_received_at <= initial.database_received_at + interval '10 seconds'
    and repository_commit = initial.repository_commit
    and vercel_deployment_id = initial.vercel_deployment_id
    and vercel_origin = initial.vercel_origin
    and vercel_project_id = initial.vercel_project_id
  order by delivery_receipt_id
  limit 1;
  if not found then return null; end if;

  select * into bundle
  from programmable_wake_private.optimistic_sla_bundle_receipts_v1
  where wake_id = initial.wake_id;
  if not found or bundle.market_row_count < 1 then return null; end if;
  select * into job
  from programmable_wake_private.quicknode_wake_jobs_v1
  where wake_id = initial.wake_id;
  select * into block_row
  from programmable_private.optimistic_block_observations_v1
  where optimistic_block_id = bundle.optimistic_block_id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'optimisticMarketStateId', state_row.optimistic_market_state_id::text,
        'poolId', '0x' || pg_catalog.encode(state_row.pool_id, 'hex'),
        'tokenAddress', '0x' || pg_catalog.encode(state_row.token_address, 'hex'),
        'releaseVersion', classic_launch.release_id,
        'evidenceCommitment', '0x' || pg_catalog.encode(state_row.evidence_commitment, 'hex'),
        'marketCommitment', '0x' || pg_catalog.encode(state_row.market_commitment, 'hex'),
        'confirmations', state_row.confirmations,
        'marketProviderAHead', market_receipt.market_provider_a_head::text,
        'marketProviderAHeadHash', '0x' || pg_catalog.encode(market_receipt.market_provider_a_head_hash, 'hex'),
        'marketProviderAObservedAt', pg_catalog.to_char(market_receipt.market_provider_a_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'marketProviderBHead', market_receipt.market_provider_b_head::text,
        'marketProviderBHeadHash', '0x' || pg_catalog.encode(market_receipt.market_provider_b_head_hash, 'hex'),
        'marketProviderBObservedAt', pg_catalog.to_char(market_receipt.market_provider_b_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'marketProviderCallCountA', market_receipt.market_provider_call_count_a,
        'marketProviderCallCountB', market_receipt.market_provider_call_count_b,
        'totalProviderCallCountA', market_receipt.total_provider_call_count_a,
        'totalProviderCallCountB', market_receipt.total_provider_call_count_b
      ) order by state_row.token_address, state_row.pool_id
    ),
    '[]'::jsonb
  ) into market_receipts
  from programmable_wake_private.optimistic_sla_market_receipts_v1 as market_receipt
  join programmable_private.optimistic_market_state_rows_v1 as state_row
    on state_row.optimistic_market_state_id = market_receipt.optimistic_market_state_id
  left join lateral (
    select pg_catalog.min(launch.release_id) as release_id
    from programmable_private.current_launch_projections_v1 as launch
    where launch.chain_id = 1
      and launch.token = state_row.token_address
      and launch.pool_id = state_row.pool_id
      and launch.model_id = 'classic'
      and launch.release_id in ('classic-v2', 'classic-v3')
    having pg_catalog.count(*) = 1
  ) as classic_launch on true
  where market_receipt.bundle_receipt_id = bundle.bundle_receipt_id;
  if pg_catalog.jsonb_array_length(market_receipts) <> bundle.market_row_count then
    return null;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'optimisticEventId', event_row.optimistic_event_id::text,
        'payloadCommitment', '0x' || pg_catalog.encode(event_row.payload_commitment, 'hex')
      ) order by event_row.block_global_log_index, event_row.optimistic_event_id
    ),
    '[]'::jsonb
  ) into event_receipts
  from programmable_private.optimistic_event_rows_v1 as event_row
  where event_row.optimistic_block_id = bundle.optimistic_block_id;
  if pg_catalog.jsonb_array_length(event_receipts) <> bundle.event_row_count then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'deliveryReceiptId', initial.delivery_receipt_id::text,
    'wakeId', initial.wake_id::text,
    'initialNonceDigest', '0x' || pg_catalog.encode(initial.nonce_digest, 'hex'),
    'duplicateNonceDigest', '0x' || pg_catalog.encode(duplicate_receipt.nonce_digest, 'hex'),
    'streamId', initial.stream_id,
    'payloadSha256', '0x' || pg_catalog.encode(initial.payload_digest, 'hex'),
    'signedAt', pg_catalog.to_char(initial.signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'requestReceivedAt', pg_catalog.to_char(initial.handler_received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'databaseReceivedAt', pg_catalog.to_char(initial.database_received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'jobPersistedAt', pg_catalog.to_char(initial.job_persisted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'acknowledgedAt', pg_catalog.to_char(initial.acknowledged_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'initialResponseStatus', initial.response_status,
    'duplicateReceivedAt', pg_catalog.to_char(duplicate_receipt.handler_received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'duplicateAcknowledgedAt', pg_catalog.to_char(duplicate_receipt.acknowledged_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'duplicateResponseStatus', duplicate_receipt.response_status,
    'repositoryCommit', initial.repository_commit,
    'deploymentId', initial.vercel_deployment_id,
    'deploymentOrigin', initial.vercel_origin,
    'projectId', initial.vercel_project_id,
    'blockNumber', block_row.block_number::text,
    'blockHash', '0x' || pg_catalog.encode(block_row.block_hash, 'hex'),
    'parentHash', '0x' || pg_catalog.encode(block_row.parent_hash, 'hex'),
    'blockTimestamp', pg_catalog.to_char(block_row.block_timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'blockEvidenceCommitment', '0x' || pg_catalog.encode(block_row.evidence_commitment, 'hex'),
    'logsCommitment', '0x' || pg_catalog.encode(bundle.logs_commitment, 'hex'),
    'providerADeploymentId', block_row.provider_a_id::text,
    'providerBDeploymentId', block_row.provider_b_id::text,
    'providerAEndpointHost', bundle.provider_a_endpoint_host,
    'providerBEndpointHost', bundle.provider_b_endpoint_host,
    'providerAEndpointUrlSha256', '0x' || pg_catalog.encode(bundle.provider_a_endpoint_url_commitment, 'hex'),
    'providerBEndpointUrlSha256', '0x' || pg_catalog.encode(bundle.provider_b_endpoint_url_commitment, 'hex'),
    'blockProviderAHead', bundle.block_provider_a_head::text,
    'blockProviderAHeadHash', '0x' || pg_catalog.encode(bundle.block_provider_a_head_hash, 'hex'),
    'blockProviderAObservedAt', pg_catalog.to_char(bundle.block_provider_a_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'blockProviderBHead', bundle.block_provider_b_head::text,
    'blockProviderBHeadHash', '0x' || pg_catalog.encode(bundle.block_provider_b_head_hash, 'hex'),
    'blockProviderBObservedAt', pg_catalog.to_char(bundle.block_provider_b_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'blockProviderCallCountA', bundle.block_provider_call_count_a,
    'blockProviderCallCountB', bundle.block_provider_call_count_b,
    'eventRowCount', bundle.event_row_count,
    'metadataTokenCount', bundle.metadata_token_count,
    'metadataProviderCallCountA', bundle.metadata_provider_call_count_a,
    'metadataProviderCallCountB', bundle.metadata_provider_call_count_b,
    'marketRowCount', bundle.market_row_count,
    'reorgGeneration', bundle.reorg_generation::text,
    'bundleVisibleAt', pg_catalog.to_char(bundle.bundle_visible_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'events', event_receipts,
    'markets', market_receipts
  );
end
$function$;

revoke all on table
  programmable_wake_private.quicknode_wake_delivery_receipts_v2,
  programmable_wake_private.real_block_sla_provider_retry_arms_v1,
  programmable_wake_private.real_block_sla_provider_retry_consumptions_v1,
  programmable_wake_private.optimistic_sla_bundle_receipts_v1,
  programmable_wake_private.optimistic_sla_market_receipts_v1
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login, programmable_projector_runtime,
  programmable_projector_runtime_login;

revoke all on sequence
  programmable_wake_private.quicknode_wake_delivery_receipts_v2_delivery_receipt_id_seq,
  programmable_wake_private.optimistic_sla_bundle_receipts_v1_bundle_receipt_id_seq,
  programmable_wake_private.optimistic_sla_market_receipts_v1_market_receipt_id_seq
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_projector_login, programmable_projector_runtime,
  programmable_projector_runtime_login;

revoke all on function
  programmable_wake_private.enqueue_quicknode_wake_v2(
    bytea, bigint, text, timestamptz, text, bytea, timestamptz,
    text, text, text, text, text
  ),
  programmable_wake_private.acknowledge_quicknode_wake_v2(bigint, bigint),
  programmable_wake_private.arm_real_block_sla_provider_retry_once_v1(
    text, text, text, text, text
  ),
  programmable_wake_private.consume_real_block_sla_provider_retry_once_v1(
    bigint, bigint
  ),
  programmable_wake_private.record_optimistic_sla_bundle_v1(
    bigint, uuid, bytea, text, text, bigint, bytea, timestamptz,
    bigint, bytea, timestamptz, smallint, smallint, smallint, smallint
  ),
  programmable_wake_private.record_optimistic_sla_market_v1(
    bigint, uuid, bigint, bytea, timestamptz, bigint, bytea,
    timestamptz, smallint, smallint, smallint, smallint
  ),
  programmable_wake_private.record_optimistic_sla_receipt_group_v1(
    bigint, uuid, bytea, text, text, bigint, bytea, timestamptz,
    bigint, bytea, timestamptz, smallint, smallint, smallint, smallint, jsonb
  ),
  programmable_wake_private.get_real_block_sla_runtime_evidence_v1(bigint)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_profile_binder, programmable_profile_recovery,
  programmable_profile_writer, programmable_maintenance,
  programmable_api_reader_login, programmable_projector_login,
  programmable_reconciler_login, programmable_projector_runtime,
  programmable_projector_runtime_login;

grant usage on schema programmable_wake_private
  to programmable_projector_runtime, programmable_projector,
     programmable_api_reader;
grant execute on function
  programmable_wake_private.enqueue_quicknode_wake_v2(
    bytea, bigint, text, timestamptz, text, bytea, timestamptz,
    text, text, text, text, text
  ),
  programmable_wake_private.acknowledge_quicknode_wake_v2(bigint, bigint),
  programmable_wake_private.arm_real_block_sla_provider_retry_once_v1(
    text, text, text, text, text
  ),
  programmable_wake_private.consume_real_block_sla_provider_retry_once_v1(
    bigint, bigint
  )
to programmable_projector_runtime;
grant execute on function
  programmable_wake_private.record_optimistic_sla_receipt_group_v1(
    bigint, uuid, bytea, text, text, bigint, bytea, timestamptz,
    bigint, bytea, timestamptz, smallint, smallint, smallint, smallint, jsonb
  )
to programmable_projector;
grant execute on function
  programmable_wake_private.get_real_block_sla_runtime_evidence_v1(bigint)
to programmable_api_reader;

-- The two public surfaces are captured as exact response bytes. The database
-- owns the observation clock and response digest and verifies the embedded
-- optimistic binder against the persisted market row before accepting it.
create table programmable_wake_private.real_block_sla_api_observations_v1 (
  api_observation_id uuid primary key,
  bundle_receipt_id bigint not null
    references programmable_wake_private.optimistic_sla_bundle_receipts_v1(bundle_receipt_id)
    on delete cascade,
  optimistic_market_state_id uuid not null
    references programmable_private.optimistic_market_state_rows_v1(optimistic_market_state_id)
    on delete restrict,
  surface text not null check (surface in ('explore-token', 'classic-chart')),
  release_version text not null check (release_version in ('classic-v2', 'classic-v3')),
  reorg_generation bigint not null check (reorg_generation >= 0),
  request_url text not null,
  response_status smallint not null check (response_status = 200),
  response_cache_control text not null check (response_cache_control = 'no-store'),
  response_body bytea not null,
  response_body_sha256 bytea not null,
  response_body_size integer not null check (response_body_size between 2 and 1048576),
  observed_at timestamptz not null,
  unique (bundle_receipt_id, surface),
  check (
    pg_catalog.octet_length(response_body) = response_body_size
    and pg_catalog.octet_length(response_body_sha256) = 32
    and response_body_sha256 = pg_catalog.sha256(response_body)
    and pg_catalog.isfinite(observed_at)
  )
);

create table programmable_wake_private.real_block_sla_exports_v1 (
  export_id uuid primary key,
  delivery_receipt_id bigint not null
    references programmable_wake_private.quicknode_wake_delivery_receipts_v2(delivery_receipt_id)
    on delete cascade,
  challenge_sha256 bytea not null unique,
  payload_sha256 bytea not null,
  exported_at timestamptz not null,
  expires_at timestamptz not null,
  check (
    pg_catalog.octet_length(challenge_sha256) = 32
    and challenge_sha256 <> pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
    and pg_catalog.octet_length(payload_sha256) = 32
    and pg_catalog.isfinite(exported_at)
    and expires_at = exported_at + interval '10 minutes'
  )
);

alter table programmable_wake_private.real_block_sla_api_observations_v1
  enable row level security;
alter table programmable_wake_private.real_block_sla_api_observations_v1
  force row level security;
alter table programmable_wake_private.real_block_sla_exports_v1
  enable row level security;
alter table programmable_wake_private.real_block_sla_exports_v1
  force row level security;

create policy real_block_sla_api_observations_v1_migrator_all
on programmable_wake_private.real_block_sla_api_observations_v1
for all to programmable_migrator using (true) with check (true);
create policy real_block_sla_exports_v1_migrator_all
on programmable_wake_private.real_block_sla_exports_v1
for all to programmable_migrator using (true) with check (true);

create function programmable_wake_private.record_real_block_sla_api_observation_v1(
  p_delivery_receipt_id bigint,
  p_optimistic_market_state_id uuid,
  p_surface text,
  p_response_status smallint,
  p_response_cache_control text,
  p_response_body bytea
)
returns table (
  api_observation_id uuid,
  request_url text,
  response_body_sha256 bytea,
  observed_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  database_now timestamptz := pg_catalog.clock_timestamp();
  initial programmable_wake_private.quicknode_wake_delivery_receipts_v2%rowtype;
  bundle programmable_wake_private.optimistic_sla_bundle_receipts_v1%rowtype;
  state_row programmable_private.optimistic_market_state_rows_v1%rowtype;
  current_release_version text;
  body_json jsonb;
  applied jsonb;
  expected_url text;
  inserted_id uuid := pg_catalog.gen_random_uuid();
  inserted_hash bytea;
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
  then
    raise exception using errcode = '42501', message = 'SLA API observation requires runtime identity';
  end if;
  if p_delivery_receipt_id is null or p_delivery_receipt_id <= 0
     or p_optimistic_market_state_id is null
     or p_surface not in ('explore-token', 'classic-chart')
     or p_response_status <> 200
     or p_response_cache_control is distinct from 'no-store'
     or p_response_body is null
     or pg_catalog.octet_length(p_response_body) not between 2 and 1048576
  then
    raise exception using errcode = '22023', message = 'invalid SLA API observation';
  end if;

  select * into initial
  from programmable_wake_private.quicknode_wake_delivery_receipts_v2
  where delivery_receipt_id = p_delivery_receipt_id
    and programmable_wake_private.real_block_sla_initial_receipt_is_eligible_v1(
      delivery_receipt_id
    );
  select bundle_row.* into bundle
  from programmable_wake_private.optimistic_sla_bundle_receipts_v1 as bundle_row
  where bundle_row.wake_id = initial.wake_id;
  select * into state_row
  from programmable_private.optimistic_market_state_rows_v1
  where optimistic_market_state_id = p_optimistic_market_state_id
    and optimistic_block_id = bundle.optimistic_block_id;
  select pg_catalog.min(launch.release_id) into current_release_version
  from programmable_private.current_launch_projections_v1 as launch
  where launch.chain_id = 1
    and launch.token = state_row.token_address
    and launch.pool_id = state_row.pool_id
    and launch.model_id = 'classic'
    and launch.release_id in ('classic-v2', 'classic-v3')
  having pg_catalog.count(*) = 1;
  if initial.delivery_receipt_id is null
     or bundle.bundle_receipt_id is null
     or state_row.optimistic_market_state_id is null
     or current_release_version is null
     or bundle.expires_at <= database_now
     or database_now > initial.database_received_at + interval '10 seconds'
  then
    raise exception using errcode = '40001', message = 'SLA API observation binding unavailable';
  end if;

  begin
    body_json := pg_catalog.convert_from(p_response_body, 'UTF8')::jsonb;
  exception when others then
    raise exception using errcode = '22023', message = 'invalid SLA API response JSON';
  end;
  if pg_catalog.jsonb_typeof(body_json -> 'optimisticOverlay' -> 'applied')
       is distinct from 'array'
  then
    raise exception using errcode = '22023', message = 'missing SLA API optimistic disclosure';
  end if;
  select entry.candidate into applied
  from pg_catalog.jsonb_array_elements(
    body_json -> 'optimisticOverlay' -> 'applied'
  ) as entry(candidate)
  where entry.candidate ->> 'kind' = 'market'
    and entry.candidate ->> 'optimisticMarketStateId' = state_row.optimistic_market_state_id::text
    and pg_catalog.lower(entry.candidate ->> 'poolId') = '0x' || pg_catalog.encode(state_row.pool_id, 'hex')
    and pg_catalog.lower(entry.candidate ->> 'tokenAddress') = '0x' || pg_catalog.encode(state_row.token_address, 'hex')
    and entry.candidate ->> 'blockNumber' = (
      select block_number::text from programmable_private.optimistic_block_observations_v1
      where optimistic_block_id = state_row.optimistic_block_id
    )
    and pg_catalog.lower(entry.candidate ->> 'evidenceCommitment') = '0x' || pg_catalog.encode(state_row.evidence_commitment, 'hex')
    and entry.candidate ->> 'reorgGeneration' = bundle.reorg_generation::text
    and entry.candidate ->> 'releaseVersion' = current_release_version;
  if not found then
    raise exception using errcode = '22023', message = 'SLA API response is not bound to persisted market state';
  end if;

  expected_url := initial.vercel_origin || case p_surface
    when 'explore-token' then '/api/explore/token?address='
    else '/api/explore/token/chart?address='
  end || '0x' || pg_catalog.encode(state_row.token_address, 'hex') ||
    case when p_surface = 'classic-chart' then '&range=1h' else '' end;

  insert into programmable_wake_private.real_block_sla_api_observations_v1 (
    api_observation_id, bundle_receipt_id, optimistic_market_state_id,
    surface, release_version, reorg_generation, request_url,
    response_status, response_cache_control, response_body,
    response_body_sha256, response_body_size, observed_at
  ) values (
    inserted_id, bundle.bundle_receipt_id, state_row.optimistic_market_state_id,
    p_surface, current_release_version, bundle.reorg_generation, expected_url,
    200, 'no-store', p_response_body, pg_catalog.sha256(p_response_body),
    pg_catalog.octet_length(p_response_body), database_now
  )
  on conflict (bundle_receipt_id, surface) do nothing
  returning real_block_sla_api_observations_v1.api_observation_id,
            real_block_sla_api_observations_v1.response_body_sha256
  into inserted_id, inserted_hash;
  if inserted_hash is null then
    select observation.api_observation_id, observation.response_body_sha256
    into inserted_id, inserted_hash
    from programmable_wake_private.real_block_sla_api_observations_v1 as observation
    where observation.bundle_receipt_id = bundle.bundle_receipt_id
      and observation.surface = p_surface
      and observation.optimistic_market_state_id = state_row.optimistic_market_state_id
      and observation.response_body = p_response_body;
    if not found then
      raise exception using errcode = '40001', message = 'SLA API observation conflicts';
    end if;
  end if;
  return query select inserted_id, expected_url, inserted_hash, database_now;
end
$function$;

create function programmable_wake_private.record_real_block_sla_api_observation_pair_v1(
  p_delivery_receipt_id bigint,
  p_optimistic_market_state_id uuid,
  p_token_response_status smallint,
  p_token_response_cache_control text,
  p_token_response_body bytea,
  p_chart_response_status smallint,
  p_chart_response_cache_control text,
  p_chart_response_body bytea
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  perform 1
  from programmable_wake_private.record_real_block_sla_api_observation_v1(
    p_delivery_receipt_id,
    p_optimistic_market_state_id,
    'explore-token',
    p_token_response_status,
    p_token_response_cache_control,
    p_token_response_body
  );
  if not found then
    raise exception using errcode = '40001', message = 'token SLA API observation was not stored';
  end if;

  perform 1
  from programmable_wake_private.record_real_block_sla_api_observation_v1(
    p_delivery_receipt_id,
    p_optimistic_market_state_id,
    'classic-chart',
    p_chart_response_status,
    p_chart_response_cache_control,
    p_chart_response_body
  );
  if not found then
    raise exception using errcode = '40001', message = 'chart SLA API observation was not stored';
  end if;
  if not (
    select pg_catalog.count(*) = 2
      and pg_catalog.count(distinct observation.release_version) = 1
      and pg_catalog.count(distinct observation.reorg_generation) = 1
    from programmable_wake_private.real_block_sla_api_observations_v1 as observation
    join programmable_wake_private.optimistic_sla_bundle_receipts_v1 as bundle
      on bundle.bundle_receipt_id = observation.bundle_receipt_id
    join programmable_wake_private.quicknode_wake_delivery_receipts_v2 as initial
      on initial.wake_id = bundle.wake_id
    where initial.delivery_receipt_id = p_delivery_receipt_id
      and observation.optimistic_market_state_id = p_optimistic_market_state_id
      and observation.surface in ('explore-token', 'classic-chart')
  ) then
    raise exception using errcode = '40001', message = 'SLA API observation pair conflicts';
  end if;
  return true;
end
$function$;

create function programmable_wake_private.get_real_block_sla_capture_target_v1(
  p_delivery_receipt_id bigint
)
returns table (
  optimistic_market_state_id uuid,
  token_address bytea,
  deployment_origin text,
  repository_commit text,
  deployment_id text,
  project_id text,
  database_received_at timestamptz,
  capture_complete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
     or p_delivery_receipt_id is null or p_delivery_receipt_id <= 0
  then
    raise exception using errcode = '42501', message = 'invalid SLA capture target identity';
  end if;
  return query
  select state_row.optimistic_market_state_id,
         state_row.token_address::bytea,
         initial.vercel_origin,
         initial.repository_commit,
         initial.vercel_deployment_id,
         initial.vercel_project_id,
         initial.database_received_at,
         exists (
           select 1
           from programmable_wake_private.real_block_sla_api_observations_v1 as observation
           where observation.bundle_receipt_id = bundle.bundle_receipt_id
             and observation.optimistic_market_state_id = state_row.optimistic_market_state_id
             and observation.surface in ('explore-token', 'classic-chart')
           group by observation.bundle_receipt_id, observation.optimistic_market_state_id
           having pg_catalog.count(*) = 2
             and pg_catalog.count(distinct observation.surface) = 2
             and pg_catalog.count(distinct observation.release_version) = 1
             and pg_catalog.count(distinct observation.reorg_generation) = 1
             and pg_catalog.min(observation.reorg_generation) = bundle.reorg_generation
             and pg_catalog.min(observation.release_version) = classic_launch.release_id
         )
  from programmable_wake_private.quicknode_wake_delivery_receipts_v2 as initial
  join programmable_wake_private.optimistic_sla_bundle_receipts_v1 as bundle
    on bundle.wake_id = initial.wake_id and bundle.expires_at > pg_catalog.clock_timestamp()
  join programmable_private.optimistic_market_state_rows_v1 as state_row
    on state_row.optimistic_block_id = bundle.optimistic_block_id
  join lateral (
    select pg_catalog.min(launch.release_id) as release_id
    from programmable_private.current_launch_projections_v1 as launch
    where launch.chain_id = 1
      and launch.token = state_row.token_address
      and launch.pool_id = state_row.pool_id
      and launch.model_id = 'classic'
      and launch.release_id in ('classic-v2', 'classic-v3')
    having pg_catalog.count(*) = 1
  ) as classic_launch on true
  join programmable_wake_private.optimistic_sla_market_receipts_v1 as market_receipt
    on market_receipt.bundle_receipt_id = bundle.bundle_receipt_id
   and market_receipt.optimistic_market_state_id = state_row.optimistic_market_state_id
  where initial.delivery_receipt_id = p_delivery_receipt_id
    and programmable_wake_private.real_block_sla_initial_receipt_is_eligible_v1(
      initial.delivery_receipt_id
    )
    and (
      select pg_catalog.count(*)
      from programmable_wake_private.optimistic_sla_market_receipts_v1 as complete_receipt
      where complete_receipt.bundle_receipt_id = bundle.bundle_receipt_id
    ) = bundle.market_row_count
  order by state_row.token_address, state_row.pool_id
  limit 1;
end
$function$;

-- One DB-authored state machine prevents runtime code from inferring readiness
-- from nullable columns or from a partially written receipt group.
create function programmable_wake_private.get_real_block_sla_capture_stage_v1(
  p_delivery_receipt_id bigint
)
returns table (
  stage_state text,
  optimistic_market_state_id uuid,
  token_address bytea,
  deployment_origin text,
  repository_commit text,
  deployment_id text,
  project_id text,
  database_received_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
     or p_delivery_receipt_id is null or p_delivery_receipt_id <= 0
  then
    raise exception using errcode = '42501', message = 'invalid SLA capture stage identity';
  end if;

  return query
  with eligible as materialized (
    select initial.*
    from programmable_wake_private.quicknode_wake_delivery_receipts_v2 as initial
    where initial.delivery_receipt_id = p_delivery_receipt_id
      and programmable_wake_private.real_block_sla_initial_receipt_is_eligible_v1(
        initial.delivery_receipt_id
      )
  ), selected as materialized (
    select target.*
    from eligible as initial
    cross join lateral programmable_wake_private.get_real_block_sla_capture_target_v1(
      initial.delivery_receipt_id
    ) as target
  )
  select
    case
      when selected.optimistic_market_state_id is null then 'needs-ingest'
      when selected.capture_complete then 'complete'
      else 'needs-capture'
    end::text,
    selected.optimistic_market_state_id,
    selected.token_address,
    selected.deployment_origin,
    selected.repository_commit,
    selected.deployment_id,
    selected.project_id,
    selected.database_received_at
  from eligible
  left join selected on true;
end
$function$;

create function programmable_wake_private.get_real_block_sla_delivery_receipt_v1(
  p_wake_id bigint
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  receipt_id bigint;
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
     or p_wake_id is null or p_wake_id <= 0
  then
    raise exception using errcode = '42501', message = 'invalid SLA delivery lookup identity';
  end if;
  select receipt.delivery_receipt_id into receipt_id
  from programmable_wake_private.quicknode_wake_delivery_receipts_v2 as receipt
  where receipt.wake_id = p_wake_id
    and programmable_wake_private.real_block_sla_initial_receipt_is_eligible_v1(
      receipt.delivery_receipt_id
    )
  order by receipt.delivery_receipt_id
  limit 1;
  return receipt_id;
end
$function$;

create function programmable_wake_private.get_real_block_sla_retry_schedule_v1(
  p_wake_id bigint
)
returns table (
  available_at timestamptz,
  deadline_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  database_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
     or p_wake_id is null or p_wake_id <= 0
  then
    raise exception using errcode = '42501', message = 'invalid SLA retry schedule identity';
  end if;

  return query
  select job.available_at,
         initial.database_received_at + interval '10 seconds'
  from programmable_wake_private.quicknode_wake_jobs_v1 as job
  join programmable_wake_private.quicknode_wake_delivery_receipts_v2 as initial
    on initial.wake_id = job.wake_id
   and programmable_wake_private.real_block_sla_initial_receipt_is_eligible_v1(
     initial.delivery_receipt_id
   )
  where job.wake_id = p_wake_id
    and job.state = 'pending'
    and job.attempt_count < 32
    and job.expires_at > database_now
    and job.available_at <= initial.database_received_at + interval '10 seconds'
    and database_now <= initial.database_received_at + interval '10 seconds'
  order by initial.delivery_receipt_id
  limit 1;
end
$function$;

-- The export is DB-authored and challenge-bound. Its receipt hash covers the
-- complete DB runtime receipt plus both exact-byte API observation receipts.
create function programmable_wake_private.create_real_block_sla_export_v1(
  p_delivery_receipt_id bigint,
  p_challenge_sha256 bytea
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_role text := pg_catalog.current_setting('role', true);
  database_now timestamptz := pg_catalog.clock_timestamp();
  runtime_receipt jsonb;
  observations jsonb;
  export_id uuid := pg_catalog.gen_random_uuid();
  payload jsonb;
  payload_hash bytea;
begin
  if session_user::text <> 'programmable_projector_runtime_login'
     or active_role is distinct from 'programmable_projector_runtime'
     or p_delivery_receipt_id is null or p_delivery_receipt_id <= 0
     or p_challenge_sha256 is null
     or pg_catalog.octet_length(p_challenge_sha256) <> 32
     or p_challenge_sha256 = pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
  then
    raise exception using errcode = '42501', message = 'invalid SLA export identity or challenge';
  end if;

  perform 1
  from programmable_wake_private.get_real_block_sla_capture_target_v1(
    p_delivery_receipt_id
  ) as target
  where target.capture_complete;
  if not found then return null; end if;

  runtime_receipt := programmable_wake_private.get_real_block_sla_runtime_evidence_v1(
    p_delivery_receipt_id
  );
  if runtime_receipt is null then return null; end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'apiObservationId', observation.api_observation_id::text,
    'surface', observation.surface,
    'optimisticMarketStateId', observation.optimistic_market_state_id::text,
    'releaseVersion', observation.release_version,
    'reorgGeneration', observation.reorg_generation::text,
    'requestUrl', observation.request_url,
    'responseStatus', observation.response_status,
    'cacheControl', observation.response_cache_control,
    'responseBodySha256', '0x' || pg_catalog.encode(observation.response_body_sha256, 'hex'),
    'responseBodySize', observation.response_body_size,
    'observedAt', pg_catalog.to_char(observation.observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by observation.surface) into observations
  from programmable_wake_private.real_block_sla_api_observations_v1 as observation
  join programmable_wake_private.optimistic_sla_bundle_receipts_v1 as bundle
    on bundle.bundle_receipt_id = observation.bundle_receipt_id
  join programmable_wake_private.quicknode_wake_delivery_receipts_v2 as initial
    on initial.wake_id = bundle.wake_id
  where initial.delivery_receipt_id = p_delivery_receipt_id;
  if pg_catalog.jsonb_array_length(coalesce(observations, '[]'::jsonb)) <> 2
     or (observations -> 0 ->> 'optimisticMarketStateId') is distinct from
        (observations -> 1 ->> 'optimisticMarketStateId')
     or (observations -> 0 ->> 'releaseVersion') is distinct from
        (observations -> 1 ->> 'releaseVersion')
     or (observations -> 0 ->> 'reorgGeneration') is distinct from
        (observations -> 1 ->> 'reorgGeneration')
  then return null; end if;

  payload := pg_catalog.jsonb_build_object(
    'kind', 'programmable-real-block-sla-db-attestation',
    'schemaVersion', 2,
    'exportId', export_id::text,
    'challengeSha256', '0x' || pg_catalog.encode(p_challenge_sha256, 'hex'),
    'exportedAt', pg_catalog.to_char(database_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'runtimeReceipt', runtime_receipt,
    'apiObservations', observations
  );
  payload_hash := pg_catalog.sha256(pg_catalog.convert_to(payload::text, 'UTF8'));
  insert into programmable_wake_private.real_block_sla_exports_v1 (
    export_id, delivery_receipt_id, challenge_sha256, payload_sha256,
    exported_at, expires_at
  ) values (
    export_id, p_delivery_receipt_id, p_challenge_sha256, payload_hash,
    database_now, database_now + interval '10 minutes'
  );
  return payload || pg_catalog.jsonb_build_object(
    'receiptSha256', '0x' || pg_catalog.encode(payload_hash, 'hex')
  );
end
$function$;

revoke all on table
  programmable_wake_private.real_block_sla_api_observations_v1,
  programmable_wake_private.real_block_sla_exports_v1
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_projector_runtime, programmable_projector_runtime_login,
  programmable_api_reader_login, programmable_projector_login;
revoke all on function
  programmable_wake_private.record_real_block_sla_api_observation_v1(
    bigint, uuid, text, smallint, text, bytea
  ),
  programmable_wake_private.record_real_block_sla_api_observation_pair_v1(
    bigint, uuid, smallint, text, bytea, smallint, text, bytea
  ),
  programmable_wake_private.get_real_block_sla_capture_target_v1(bigint),
  programmable_wake_private.get_real_block_sla_capture_stage_v1(bigint),
  programmable_wake_private.get_real_block_sla_delivery_receipt_v1(bigint),
  programmable_wake_private.get_real_block_sla_retry_schedule_v1(bigint),
  programmable_wake_private.create_real_block_sla_export_v1(bigint, bytea)
from public, anon, authenticated, service_role,
  programmable_projector, programmable_reconciler, programmable_api_reader,
  programmable_projector_runtime, programmable_projector_runtime_login,
  programmable_api_reader_login, programmable_projector_login;
grant execute on function
  programmable_wake_private.record_real_block_sla_api_observation_pair_v1(
    bigint, uuid, smallint, text, bytea, smallint, text, bytea
  ),
  programmable_wake_private.get_real_block_sla_capture_target_v1(bigint),
  programmable_wake_private.get_real_block_sla_capture_stage_v1(bigint),
  programmable_wake_private.get_real_block_sla_delivery_receipt_v1(bigint),
  programmable_wake_private.get_real_block_sla_retry_schedule_v1(bigint),
  programmable_wake_private.create_real_block_sla_export_v1(bigint, bytea)
to programmable_projector_runtime;

reset role;
