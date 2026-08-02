-- Stable profile identities, append-only alias/binding history, reconciliation
-- evidence, bounded market analytics and explicit retention entry points.

set role programmable_migrator;

create table programmable_private.profile_hash_version_definitions (
  hash_version smallint primary key check (hash_version > 0),
  algorithm programmable_private.source_identifier not null,
  definition_commitment programmable_private.bytes32_value not null unique,
  created_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict
);

create table programmable_private.profile_hash_version_status_history (
  status_history_id uuid primary key,
  hash_version smallint not null
    references programmable_private.profile_hash_version_definitions(hash_version)
    on delete restrict,
  state programmable_private.profile_hash_version_state not null,
  reason_commitment programmable_private.bytes32_value not null,
  changed_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (hash_version, changed_at)
);

create table programmable_private.profile_hash_version_status_current (
  hash_version smallint primary key
    references programmable_private.profile_hash_version_definitions(hash_version)
    on delete restrict,
  state programmable_private.profile_hash_version_state not null,
  status_history_id uuid not null unique
    references programmable_private.profile_hash_version_status_history(status_history_id)
    on delete restrict,
  changed_at timestamptz not null
);

create unique index profile_one_current_hash_version_idx
  on programmable_private.profile_hash_version_status_current ((state))
  where state = 'current';

create table programmable_private.profile_subjects (
  subject_id uuid primary key,
  created_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict
);

create table programmable_private.profile_subject_aliases (
  alias_id uuid primary key,
  subject_id uuid not null
    references programmable_private.profile_subjects(subject_id)
    on delete restrict,
  hash_version smallint not null
    references programmable_private.profile_hash_version_definitions(hash_version)
    on delete restrict,
  keyed_subject_hash programmable_private.bytes32_value not null,
  created_at timestamptz not null,
  created_by_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (hash_version, keyed_subject_hash),
  unique (alias_id, subject_id)
);

create table programmable_private.profile_subject_alias_status_history (
  alias_status_history_id uuid primary key,
  alias_id uuid not null
    references programmable_private.profile_subject_aliases(alias_id)
    on delete restrict,
  state programmable_private.profile_alias_state not null,
  reason_commitment programmable_private.bytes32_value not null,
  changed_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (alias_id, changed_at)
);

create table programmable_private.profile_subject_alias_status_current (
  alias_id uuid primary key
    references programmable_private.profile_subject_aliases(alias_id)
    on delete restrict,
  state programmable_private.profile_alias_state not null,
  alias_status_history_id uuid not null unique
    references programmable_private.profile_subject_alias_status_history(alias_status_history_id)
    on delete restrict,
  changed_at timestamptz not null
);

create table programmable_private.profile_subject_current_alias (
  subject_id uuid primary key
    references programmable_private.profile_subjects(subject_id)
    on delete restrict,
  alias_id uuid not null unique,
  generation bigint not null check (generation > 0),
  changed_at timestamptz not null,
  foreign key (alias_id, subject_id)
    references programmable_private.profile_subject_aliases(alias_id, subject_id)
    on delete restrict
);

create table programmable_private.profile_owner_binding_history (
  binding_id uuid primary key,
  subject_id uuid not null
    references programmable_private.profile_subjects(subject_id)
    on delete restrict,
  wallet programmable_private.eth_address not null,
  alias_id uuid not null,
  generation bigint not null check (generation > 0),
  state programmable_private.profile_binding_state not null,
  recovery_method programmable_private.profile_recovery_method not null,
  proof_commitment programmable_private.bytes32_value not null,
  previous_binding_id uuid
    references programmable_private.profile_owner_binding_history(binding_id)
    on delete restrict,
  created_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (alias_id, subject_id)
    references programmable_private.profile_subject_aliases(alias_id, subject_id)
    on delete restrict,
  unique (wallet, generation),
  unique (subject_id, generation),
  unique (binding_id, subject_id, wallet, generation)
);

create table programmable_private.profile_owner_binding_current (
  wallet programmable_private.eth_address primary key,
  subject_id uuid not null unique
    references programmable_private.profile_subjects(subject_id)
    on delete restrict,
  binding_id uuid not null unique,
  generation bigint not null check (generation > 0),
  state programmable_private.profile_binding_state not null,
  changed_at timestamptz not null,
  foreign key (binding_id, subject_id, wallet, generation)
    references programmable_private.profile_owner_binding_history(
      binding_id, subject_id, wallet, generation
    )
    on delete restrict
);

create table programmable_private.profiles (
  subject_id uuid primary key
    references programmable_private.profile_subjects(subject_id)
    on delete restrict,
  username text,
  username_key text,
  avatar_reference text,
  display_name text,
  bio text,
  revision bigint not null check (revision >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  last_mutation_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (
    (username is null and username_key is null)
    or (
      username is not null
      and username_key = pg_catalog.lower(username)
      and programmable_private.valid_profile_username(username)
    )
  ),
  check (programmable_private.valid_avatar_reference(avatar_reference)),
  check (display_name is null or pg_catalog.octet_length(display_name) between 1 and 64),
  check (bio is null or pg_catalog.octet_length(bio) <= 280),
  check (updated_at >= created_at)
);

create unique index profiles_username_key_idx
  on programmable_private.profiles (username_key)
  where username_key is not null and deleted_at is null;

create table programmable_private.profile_audit_records (
  profile_audit_id uuid primary key,
  subject_id uuid not null
    references programmable_private.profile_subjects(subject_id)
    on delete restrict,
  wallet programmable_private.eth_address not null,
  action programmable_private.source_identifier not null,
  expected_binding_generation bigint not null check (expected_binding_generation >= 0),
  resulting_binding_generation bigint not null check (resulting_binding_generation >= 0),
  expected_revision bigint,
  resulting_revision bigint,
  proof_commitment programmable_private.bytes32_value not null,
  caller_role name not null,
  occurred_at timestamptz not null,
  mutation_audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (
    (expected_revision is null and resulting_revision is null)
    or (
      expected_revision is not null
      and resulting_revision is not null
      and resulting_revision >= expected_revision
    )
  )
);

create table programmable_private.token_project_metadata (
  metadata_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  token programmable_private.eth_address not null,
  project_name text check (project_name is null or pg_catalog.octet_length(project_name) <= 128),
  description text check (description is null or pg_catalog.octet_length(description) <= 2000),
  logo_reference text check (programmable_private.valid_avatar_reference(logo_reference)),
  metadata_revision bigint not null check (metadata_revision > 0),
  subject_id uuid not null
    references programmable_private.profile_subjects(subject_id)
    on delete restrict,
  created_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (chain_id, token, metadata_revision)
);

create table programmable_private.project_links (
  project_link_id uuid primary key,
  metadata_id uuid not null
    references programmable_private.token_project_metadata(metadata_id)
    on delete restrict,
  link_kind programmable_private.source_identifier not null,
  https_url text not null,
  display_order integer not null check (display_order between 0 and 15),
  check (
    pg_catalog.octet_length(https_url) between 9 and 512
    and https_url ~ '^https://[A-Za-z0-9.-]+(?::[0-9]+)?/'
  ),
  created_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (metadata_id, link_kind),
  unique (metadata_id, display_order)
);

create table programmable_private.reconciliation_records (
  reconciliation_id uuid primary key,
  run_id uuid not null
    references programmable_private.run_headers(run_id)
    on delete restrict,
  chain_id programmable_private.chain_id_value not null,
  release_id programmable_private.release_identifier not null,
  model_id programmable_private.model_identifier not null,
  epoch_id uuid not null,
  pointer_generation bigint not null check (pointer_generation > 0),
  comparison_kind programmable_private.source_identifier not null,
  severity programmable_private.reconciliation_severity not null,
  source_from_block programmable_private.block_number_value not null,
  source_to_block programmable_private.block_number_value not null,
  compared_count bigint not null check (compared_count >= 0),
  mismatch_count bigint not null check (mismatch_count >= 0 and mismatch_count <= compared_count),
  evidence_commitment programmable_private.bytes32_value not null,
  mismatch_identity_commitments bytea[] not null,
  resolved_at timestamptz,
  recorded_at timestamptz not null,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (source_to_block >= source_from_block),
  check (resolved_at is null or resolved_at >= recorded_at),
  check (programmable_private.valid_topics(mismatch_identity_commitments)),
  unique (run_id, comparison_kind, evidence_commitment)
);

create index reconciliation_unresolved_idx
  on programmable_private.reconciliation_records (
    chain_id, release_id, model_id, severity, recorded_at
  )
  where mismatch_count > 0 and resolved_at is null;

create table programmable_private.parity_records (
  parity_record_id uuid primary key,
  reconciliation_id uuid not null
    references programmable_private.reconciliation_records(reconciliation_id)
    on delete restrict,
  route_key programmable_private.source_identifier not null,
  legacy_dto_hash programmable_private.bytes32_value not null,
  indexed_dto_hash programmable_private.bytes32_value not null,
  is_match boolean not null,
  compared_at timestamptz not null,
  resolved_at timestamptz,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  check (
    is_match = (legacy_dto_hash = indexed_dto_hash)
    and (is_match or resolved_at is null or resolved_at >= compared_at)
  ),
  unique (reconciliation_id, route_key)
);

create index parity_retention_idx
  on programmable_private.parity_records (is_match, compared_at, resolved_at);

create table programmable_private.market_snapshots (
  market_snapshot_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  pool_id programmable_private.bytes32_value not null,
  source_deployment_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  block_evidence_id uuid not null,
  block_number programmable_private.block_number_value not null,
  block_hash programmable_private.bytes32_value not null,
  sqrt_price_x96 programmable_private.uint256_value not null,
  liquidity programmable_private.uint256_value not null,
  market_volume_token0 numeric not null check (market_volume_token0 >= 0),
  market_volume_token1 numeric not null check (market_volume_token1 >= 0),
  market_volume_usd numeric check (market_volume_usd is null or market_volume_usd >= 0),
  hook_gross_volume programmable_private.uint256_value,
  observed_at timestamptz not null,
  reconciliation_id uuid not null
    references programmable_private.reconciliation_records(reconciliation_id)
    on delete restrict,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (block_evidence_id, block_hash)
    references programmable_private.dual_rpc_block_evidence(
      block_evidence_id, agreed_block_hash
    )
    on delete restrict,
  unique (chain_id, pool_id, source_deployment_id, block_hash)
);

create index market_snapshot_retention_idx
  on programmable_private.market_snapshots (observed_at, market_snapshot_id);

create table programmable_private.market_candles (
  market_candle_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  pool_id programmable_private.bytes32_value not null,
  source_deployment_id uuid not null
    references programmable_private.provider_deployments(provider_deployment_id)
    on delete restrict,
  source_block_evidence_id uuid not null,
  source_block_number programmable_private.block_number_value not null,
  interval programmable_private.market_interval not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  open numeric not null check (open >= 0),
  high numeric not null check (high >= 0),
  low numeric not null check (low >= 0),
  close numeric not null check (close >= 0),
  volume_token0 numeric not null check (volume_token0 >= 0),
  volume_token1 numeric not null check (volume_token1 >= 0),
  volume_usd numeric check (volume_usd is null or volume_usd >= 0),
  source_block_hash programmable_private.bytes32_value not null,
  reconciliation_id uuid not null
    references programmable_private.reconciliation_records(reconciliation_id)
    on delete restrict,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  foreign key (source_block_evidence_id, source_block_hash)
    references programmable_private.dual_rpc_block_evidence(
      block_evidence_id, agreed_block_hash
    )
    on delete restrict,
  check (interval in ('hour', 'day')),
  check (period_end > period_start and high >= greatest(open, close, low)),
  unique (chain_id, pool_id, interval, period_start, source_block_hash)
);

create index market_candle_retention_idx
  on programmable_private.market_candles (interval, period_start, market_candle_id);

create table programmable_private.portfolio_points (
  portfolio_point_id uuid primary key,
  chain_id programmable_private.chain_id_value not null,
  account programmable_private.eth_address not null,
  interval_minutes integer not null check (interval_minutes in (5, 1440)),
  point_time timestamptz not null,
  exact_reward_total programmable_private.uint256_value not null,
  source_checkpoint_id uuid not null
    references programmable_private.projector_checkpoints(checkpoint_id)
    on delete restrict,
  audit_id uuid not null
    references programmable_private.mutation_audits(audit_id)
    on delete restrict,
  unique (chain_id, account, interval_minutes, point_time)
);

create index portfolio_point_retention_idx
  on programmable_private.portfolio_points (
    interval_minutes, point_time, portfolio_point_id
  );

create function programmable_private.profile_lock_key(p_value bytea, p_salt bigint)
returns bigint
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select pg_catalog.hashtextextended(pg_catalog.encode(p_value, 'hex'), p_salt)
$function$;

create function programmable_private.define_profile_hash_version(
  p_hash_version smallint,
  p_algorithm text,
  p_definition_commitment bytea,
  p_input_commitment bytea,
  p_created_at timestamptz default pg_catalog.clock_timestamp()
)
returns smallint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_profile_recovery');
  if p_hash_version <= 0 or pg_catalog.octet_length(p_definition_commitment) <> 32 then
    raise exception using errcode = '22023', message = 'invalid hash-version definition';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'profile_hash_version.define', p_input_commitment, null, p_created_at
  );
  insert into programmable_private.profile_hash_version_definitions (
    hash_version, algorithm, definition_commitment, created_at,
    created_by_audit_id
  )
  values (
    p_hash_version,
    p_algorithm::programmable_private.source_identifier,
    p_definition_commitment::programmable_private.bytes32_value,
    p_created_at, audit_id
  );
  return p_hash_version;
end
$function$;

create function programmable_private.set_profile_hash_version_state(
  p_status_history_id uuid,
  p_hash_version smallint,
  p_state text,
  p_reason_commitment bytea,
  p_changed_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  requested_state programmable_private.profile_hash_version_state;
  audit_id uuid;
  previous_current smallint;
  previous_history_id uuid;
begin
  perform programmable_private.assert_caller('programmable_profile_recovery');
  requested_state := p_state::programmable_private.profile_hash_version_state;
  if pg_catalog.octet_length(p_reason_commitment) <> 32 then
    raise exception using errcode = '22023', message = 'invalid hash-version state';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(172920260731);
  if requested_state = 'current' then
    select hash_version into previous_current
    from programmable_private.profile_hash_version_status_current
    where state = 'current'
    for update;
    if found and previous_current <> p_hash_version then
      previous_history_id := pg_catalog.gen_random_uuid();
      audit_id := programmable_private.append_mutation_audit(
        'profile_hash_version.rotate', p_reason_commitment, null, p_changed_at
      );
      insert into programmable_private.profile_hash_version_status_history (
        status_history_id, hash_version, state, reason_commitment,
        changed_at, audit_id
      )
      values (
        previous_history_id, previous_current, 'verify_only',
        p_reason_commitment::programmable_private.bytes32_value,
        p_changed_at, audit_id
      );
      update programmable_private.profile_hash_version_status_current
      set state = 'verify_only',
          status_history_id = previous_history_id,
          changed_at = p_changed_at
      where hash_version = previous_current;
    end if;
  end if;
  if audit_id is null then
    audit_id := programmable_private.append_mutation_audit(
      'profile_hash_version.state', p_reason_commitment, null, p_changed_at
    );
  end if;
  insert into programmable_private.profile_hash_version_status_history (
    status_history_id, hash_version, state, reason_commitment,
    changed_at, audit_id
  )
  values (
    p_status_history_id, p_hash_version, requested_state,
    p_reason_commitment::programmable_private.bytes32_value,
    p_changed_at, audit_id
  );
  insert into programmable_private.profile_hash_version_status_current (
    hash_version, state, status_history_id, changed_at
  )
  values (
    p_hash_version, requested_state, p_status_history_id, p_changed_at
  )
  on conflict (hash_version) do update
    set state = excluded.state,
        status_history_id = excluded.status_history_id,
        changed_at = excluded.changed_at;
  return p_status_history_id;
end
$function$;

create function programmable_private.bind_profile_subject(
  p_wallet bytea,
  p_hash_version smallint,
  p_keyed_subject_hash bytea,
  p_recovery_method text,
  p_proof_commitment bytea,
  p_bound_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  wallet_key bigint;
  alias_key bigint;
  new_subject_id uuid;
  new_alias_id uuid;
  new_binding_id uuid;
  audit_id uuid;
  alias_status_id uuid;
  existing_alias programmable_private.profile_subject_aliases%rowtype;
  existing_binding programmable_private.profile_owner_binding_current%rowtype;
  method programmable_private.profile_recovery_method;
begin
  perform programmable_private.assert_caller('programmable_profile_binder');
  method := p_recovery_method::programmable_private.profile_recovery_method;
  if method not in ('linked_wallet', 'wallet_signature')
     or pg_catalog.octet_length(p_wallet) <> 20
     or p_wallet = pg_catalog.decode('0000000000000000000000000000000000000000', 'hex')
     or pg_catalog.octet_length(p_keyed_subject_hash) <> 32
     or pg_catalog.octet_length(p_proof_commitment) <> 32
     or not exists (
       select 1
       from programmable_private.profile_hash_version_status_current
       where hash_version = p_hash_version and state = 'current'
     )
  then
    raise exception using errcode = '22023', message = 'invalid first-binding proof';
  end if;
  wallet_key := programmable_private.profile_lock_key(p_wallet, 1);
  alias_key := programmable_private.profile_lock_key(
    pg_catalog.int2send(p_hash_version) || p_keyed_subject_hash, 2
  );
  perform pg_catalog.pg_advisory_xact_lock(least(wallet_key, alias_key));
  if wallet_key <> alias_key then
    perform pg_catalog.pg_advisory_xact_lock(greatest(wallet_key, alias_key));
  end if;
  select * into existing_binding
  from programmable_private.profile_owner_binding_current
  where wallet = p_wallet
  for update;
  select * into existing_alias
  from programmable_private.profile_subject_aliases
  where hash_version = p_hash_version
    and keyed_subject_hash = p_keyed_subject_hash;
  if existing_binding.wallet is not null or existing_alias.alias_id is not null then
    if existing_binding.wallet is not null
       and existing_alias.alias_id is not null
       and existing_binding.subject_id = existing_alias.subject_id
       and existing_binding.state in ('active', 'recovered')
       and exists (
         select 1
         from programmable_private.profile_subject_alias_status_current
         where alias_id = existing_alias.alias_id and state = 'current'
       )
    then
      return existing_binding.subject_id;
    end if;
    raise exception using errcode = '23505', message = 'wallet or alias is already bound or tombstoned';
  end if;
  new_subject_id := pg_catalog.gen_random_uuid();
  new_alias_id := pg_catalog.gen_random_uuid();
  new_binding_id := pg_catalog.gen_random_uuid();
  alias_status_id := pg_catalog.gen_random_uuid();
  audit_id := programmable_private.append_mutation_audit(
    'profile.bind_first', p_proof_commitment, null, p_bound_at
  );
  insert into programmable_private.profile_subjects (
    subject_id, created_at, created_by_audit_id
  ) values (new_subject_id, p_bound_at, audit_id);
  insert into programmable_private.profile_subject_aliases (
    alias_id, subject_id, hash_version, keyed_subject_hash,
    created_at, created_by_audit_id
  )
  values (
    new_alias_id, new_subject_id, p_hash_version,
    p_keyed_subject_hash::programmable_private.bytes32_value,
    p_bound_at, audit_id
  );
  insert into programmable_private.profile_subject_alias_status_history (
    alias_status_history_id, alias_id, state, reason_commitment,
    changed_at, audit_id
  )
  values (
    alias_status_id, new_alias_id, 'current',
    p_proof_commitment::programmable_private.bytes32_value,
    p_bound_at, audit_id
  );
  insert into programmable_private.profile_subject_alias_status_current (
    alias_id, state, alias_status_history_id, changed_at
  ) values (new_alias_id, 'current', alias_status_id, p_bound_at);
  insert into programmable_private.profile_subject_current_alias (
    subject_id, alias_id, generation, changed_at
  ) values (new_subject_id, new_alias_id, 1, p_bound_at);
  insert into programmable_private.profile_owner_binding_history (
    binding_id, subject_id, wallet, alias_id, generation, state,
    recovery_method, proof_commitment, previous_binding_id, created_at, audit_id
  )
  values (
    new_binding_id, new_subject_id, p_wallet::programmable_private.eth_address,
    new_alias_id, 1, 'active', method,
    p_proof_commitment::programmable_private.bytes32_value,
    null, p_bound_at, audit_id
  );
  insert into programmable_private.profile_owner_binding_current (
    wallet, subject_id, binding_id, generation, state, changed_at
  )
  values (
    p_wallet::programmable_private.eth_address,
    new_subject_id, new_binding_id, 1, 'active', p_bound_at
  );
  insert into programmable_private.profiles (
    subject_id, username, username_key, avatar_reference, display_name, bio,
    revision, deleted_at, created_at, updated_at, last_mutation_audit_id
  )
  values (
    new_subject_id, null, null, null, null, null, 0, null,
    p_bound_at, p_bound_at, audit_id
  );
  insert into programmable_private.profile_audit_records (
    profile_audit_id, subject_id, wallet, action,
    expected_binding_generation, resulting_binding_generation,
    expected_revision, resulting_revision, proof_commitment, caller_role,
    occurred_at, mutation_audit_id
  )
  values (
    pg_catalog.gen_random_uuid(), new_subject_id,
    p_wallet::programmable_private.eth_address, 'profile.bind_first',
    0, 1, null, null,
    p_proof_commitment::programmable_private.bytes32_value,
    programmable_private.caller_role_name(), p_bound_at, audit_id
  );
  return new_subject_id;
end
$function$;

create function programmable_private.rekey_profile_subject(
  p_wallet bytea,
  p_old_hash_version smallint,
  p_old_keyed_subject_hash bytea,
  p_new_hash_version smallint,
  p_new_keyed_subject_hash bytea,
  p_expected_binding_generation bigint,
  p_proof_commitment bytea,
  p_rekeyed_at timestamptz default pg_catalog.clock_timestamp()
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  keys bigint[];
  lock_key bigint;
  binding programmable_private.profile_owner_binding_current%rowtype;
  old_alias programmable_private.profile_subject_aliases%rowtype;
  new_alias programmable_private.profile_subject_aliases%rowtype;
  new_alias_id uuid;
  new_binding_id uuid;
  audit_id uuid;
  status_id uuid;
  next_generation bigint;
begin
  perform programmable_private.assert_caller('programmable_profile_recovery');
  if pg_catalog.octet_length(p_wallet) <> 20
     or pg_catalog.octet_length(p_old_keyed_subject_hash) <> 32
     or pg_catalog.octet_length(p_new_keyed_subject_hash) <> 32
     or pg_catalog.octet_length(p_proof_commitment) <> 32
     or p_expected_binding_generation <= 0
     or not exists (
       select 1
       from programmable_private.profile_hash_version_status_current
       where hash_version = p_new_hash_version and state = 'current'
     )
  then
    raise exception using errcode = '22023', message = 'invalid rekey proof';
  end if;
  keys := array[
    programmable_private.profile_lock_key(p_wallet, 1),
    programmable_private.profile_lock_key(
      pg_catalog.int2send(p_old_hash_version) || p_old_keyed_subject_hash, 2
    ),
    programmable_private.profile_lock_key(
      pg_catalog.int2send(p_new_hash_version) || p_new_keyed_subject_hash, 2
    )
  ];
  for lock_key in
    select distinct locked_key.key_value
    from pg_catalog.unnest(keys) as locked_key(key_value)
    order by locked_key.key_value
  loop
    perform pg_catalog.pg_advisory_xact_lock(lock_key);
  end loop;
  select * into binding
  from programmable_private.profile_owner_binding_current
  where wallet = p_wallet
  for update;
  select * into old_alias
  from programmable_private.profile_subject_aliases
  where hash_version = p_old_hash_version
    and keyed_subject_hash = p_old_keyed_subject_hash;
  select * into new_alias
  from programmable_private.profile_subject_aliases
  where hash_version = p_new_hash_version
    and keyed_subject_hash = p_new_keyed_subject_hash;
  if binding.wallet is null
     or binding.state not in ('active', 'recovered')
     or binding.generation <> p_expected_binding_generation
     or old_alias.alias_id is null
     or old_alias.subject_id <> binding.subject_id
     or (new_alias.alias_id is not null and new_alias.subject_id <> binding.subject_id)
  then
    raise exception using errcode = '40001', message = 'rekey generation or subject proof failed';
  end if;
  next_generation := p_expected_binding_generation + 1;
  audit_id := programmable_private.append_mutation_audit(
    'profile.rekey', p_proof_commitment, null, p_rekeyed_at
  );
  if new_alias.alias_id is null then
    new_alias_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.profile_subject_aliases (
      alias_id, subject_id, hash_version, keyed_subject_hash,
      created_at, created_by_audit_id
    )
    values (
      new_alias_id, binding.subject_id, p_new_hash_version,
      p_new_keyed_subject_hash::programmable_private.bytes32_value,
      p_rekeyed_at, audit_id
    );
  else
    new_alias_id := new_alias.alias_id;
  end if;
  status_id := pg_catalog.gen_random_uuid();
  insert into programmable_private.profile_subject_alias_status_history (
    alias_status_history_id, alias_id, state, reason_commitment,
    changed_at, audit_id
  )
  values (
    status_id, new_alias_id, 'current',
    p_proof_commitment::programmable_private.bytes32_value,
    p_rekeyed_at, audit_id
  );
  insert into programmable_private.profile_subject_alias_status_current (
    alias_id, state, alias_status_history_id, changed_at
  )
  values (new_alias_id, 'current', status_id, p_rekeyed_at)
  on conflict (alias_id) do update
    set state = excluded.state,
        alias_status_history_id = excluded.alias_status_history_id,
        changed_at = excluded.changed_at;
  status_id := pg_catalog.gen_random_uuid();
  insert into programmable_private.profile_subject_alias_status_history (
    alias_status_history_id, alias_id, state, reason_commitment,
    changed_at, audit_id
  )
  values (
    status_id, old_alias.alias_id, 'verify_only',
    p_proof_commitment::programmable_private.bytes32_value,
    p_rekeyed_at, audit_id
  );
  update programmable_private.profile_subject_alias_status_current
  set state = 'verify_only',
      alias_status_history_id = status_id,
      changed_at = p_rekeyed_at
  where alias_id = old_alias.alias_id;
  update programmable_private.profile_subject_current_alias
  set alias_id = new_alias_id,
      generation = next_generation,
      changed_at = p_rekeyed_at
  where subject_id = binding.subject_id
    and generation = p_expected_binding_generation;
  if not found then
    raise exception using errcode = '40001', message = 'current alias generation lost';
  end if;
  new_binding_id := pg_catalog.gen_random_uuid();
  insert into programmable_private.profile_owner_binding_history (
    binding_id, subject_id, wallet, alias_id, generation, state,
    recovery_method, proof_commitment, previous_binding_id, created_at, audit_id
  )
  values (
    new_binding_id, binding.subject_id,
    p_wallet::programmable_private.eth_address, new_alias_id,
    next_generation, 'recovered', 'verified_subject_recovery',
    p_proof_commitment::programmable_private.bytes32_value,
    binding.binding_id, p_rekeyed_at, audit_id
  );
  update programmable_private.profile_owner_binding_current
  set binding_id = new_binding_id,
      generation = next_generation,
      state = 'recovered',
      changed_at = p_rekeyed_at
  where wallet = p_wallet
    and generation = p_expected_binding_generation;
  if not found then
    raise exception using errcode = '40001', message = 'binding generation lost';
  end if;
  insert into programmable_private.profile_audit_records (
    profile_audit_id, subject_id, wallet, action,
    expected_binding_generation, resulting_binding_generation,
    expected_revision, resulting_revision, proof_commitment, caller_role,
    occurred_at, mutation_audit_id
  )
  values (
    pg_catalog.gen_random_uuid(), binding.subject_id,
    p_wallet::programmable_private.eth_address, 'profile.rekey',
    p_expected_binding_generation, next_generation, null, null,
    p_proof_commitment::programmable_private.bytes32_value,
    programmable_private.caller_role_name(), p_rekeyed_at, audit_id
  );
  return next_generation;
end
$function$;

create function programmable_private.tombstone_profile_binding(
  p_wallet bytea,
  p_hash_version smallint,
  p_keyed_subject_hash bytea,
  p_expected_binding_generation bigint,
  p_proof_commitment bytea,
  p_tombstoned_at timestamptz default pg_catalog.clock_timestamp()
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  binding programmable_private.profile_owner_binding_current%rowtype;
  supplied_alias programmable_private.profile_subject_aliases%rowtype;
  alias_record record;
  status_id uuid;
  binding_id_next uuid := pg_catalog.gen_random_uuid();
  audit_id uuid;
  next_generation bigint := p_expected_binding_generation + 1;
  current_revision bigint;
begin
  perform programmable_private.assert_caller('programmable_profile_recovery');
  if pg_catalog.octet_length(p_wallet) <> 20
     or pg_catalog.octet_length(p_keyed_subject_hash) <> 32
     or pg_catalog.octet_length(p_proof_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid tombstone proof';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    programmable_private.profile_lock_key(p_wallet, 1)
  );
  select * into binding
  from programmable_private.profile_owner_binding_current
  where wallet = p_wallet
  for update;
  select * into supplied_alias
  from programmable_private.profile_subject_aliases
  where hash_version = p_hash_version
    and keyed_subject_hash = p_keyed_subject_hash;
  if binding.wallet is null
     or binding.state = 'tombstoned'
     or binding.generation <> p_expected_binding_generation
     or supplied_alias.alias_id is null
     or supplied_alias.subject_id <> binding.subject_id
  then
    raise exception using errcode = '40001', message = 'tombstone generation or subject proof failed';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'profile.tombstone', p_proof_commitment, null, p_tombstoned_at
  );
  for alias_record in
    select alias_id
    from programmable_private.profile_subject_aliases
    where subject_id = binding.subject_id
    order by alias_id
    for share
  loop
    status_id := pg_catalog.gen_random_uuid();
    insert into programmable_private.profile_subject_alias_status_history (
      alias_status_history_id, alias_id, state, reason_commitment,
      changed_at, audit_id
    )
    values (
      status_id, alias_record.alias_id, 'tombstoned',
      p_proof_commitment::programmable_private.bytes32_value,
      p_tombstoned_at, audit_id
    );
    update programmable_private.profile_subject_alias_status_current
    set state = 'tombstoned',
        alias_status_history_id = status_id,
        changed_at = p_tombstoned_at
    where alias_id = alias_record.alias_id;
  end loop;
  insert into programmable_private.profile_owner_binding_history (
    binding_id, subject_id, wallet, alias_id, generation, state,
    recovery_method, proof_commitment, previous_binding_id, created_at, audit_id
  )
  values (
    binding_id_next, binding.subject_id,
    p_wallet::programmable_private.eth_address, supplied_alias.alias_id,
    next_generation, 'tombstoned', 'verified_subject_recovery',
    p_proof_commitment::programmable_private.bytes32_value,
    binding.binding_id, p_tombstoned_at, audit_id
  );
  update programmable_private.profile_owner_binding_current
  set binding_id = binding_id_next,
      generation = next_generation,
      state = 'tombstoned',
      changed_at = p_tombstoned_at
  where wallet = p_wallet and generation = p_expected_binding_generation;
  if not found then
    raise exception using errcode = '40001', message = 'tombstone binding generation lost';
  end if;
  update programmable_private.profile_subject_current_alias
  set generation = next_generation,
      changed_at = p_tombstoned_at
  where subject_id = binding.subject_id
    and generation = p_expected_binding_generation;
  if not found then
    raise exception using errcode = '40001', message = 'tombstone alias generation lost';
  end if;
  select revision into current_revision
  from programmable_private.profiles
  where subject_id = binding.subject_id
  for update;
  update programmable_private.profiles
  set revision = current_revision + 1,
      deleted_at = p_tombstoned_at,
      updated_at = p_tombstoned_at,
      last_mutation_audit_id = audit_id
  where subject_id = binding.subject_id and revision = current_revision;
  insert into programmable_private.profile_audit_records (
    profile_audit_id, subject_id, wallet, action,
    expected_binding_generation, resulting_binding_generation,
    expected_revision, resulting_revision, proof_commitment, caller_role,
    occurred_at, mutation_audit_id
  )
  values (
    pg_catalog.gen_random_uuid(), binding.subject_id,
    p_wallet::programmable_private.eth_address, 'profile.tombstone',
    p_expected_binding_generation, next_generation,
    current_revision, current_revision + 1,
    p_proof_commitment::programmable_private.bytes32_value,
    programmable_private.caller_role_name(), p_tombstoned_at, audit_id
  );
  return next_generation;
end
$function$;

create function programmable_private.recover_profile_binding(
  p_wallet bytea,
  p_hash_version smallint,
  p_keyed_subject_hash bytea,
  p_expected_binding_generation bigint,
  p_proof_commitment bytea,
  p_recovered_at timestamptz default pg_catalog.clock_timestamp()
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  binding programmable_private.profile_owner_binding_current%rowtype;
  alias programmable_private.profile_subject_aliases%rowtype;
  status_id uuid := pg_catalog.gen_random_uuid();
  binding_id_next uuid := pg_catalog.gen_random_uuid();
  audit_id uuid;
  next_generation bigint := p_expected_binding_generation + 1;
  current_revision bigint;
begin
  perform programmable_private.assert_caller('programmable_profile_recovery');
  perform pg_catalog.pg_advisory_xact_lock(
    programmable_private.profile_lock_key(p_wallet, 1)
  );
  select * into binding
  from programmable_private.profile_owner_binding_current
  where wallet = p_wallet
  for update;
  select * into alias
  from programmable_private.profile_subject_aliases
  where hash_version = p_hash_version
    and keyed_subject_hash = p_keyed_subject_hash;
  if binding.wallet is null
     or binding.state <> 'tombstoned'
     or binding.generation <> p_expected_binding_generation
     or alias.alias_id is null
     or alias.subject_id <> binding.subject_id
     or not exists (
       select 1
       from programmable_private.profile_hash_version_status_current
       where hash_version = p_hash_version and state in ('current', 'verify_only')
     )
     or pg_catalog.octet_length(p_proof_commitment) <> 32
  then
    raise exception using errcode = '40001', message = 'recovery generation or subject proof failed';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'profile.recover', p_proof_commitment, null, p_recovered_at
  );
  insert into programmable_private.profile_subject_alias_status_history (
    alias_status_history_id, alias_id, state, reason_commitment,
    changed_at, audit_id
  )
  values (
    status_id, alias.alias_id, 'current',
    p_proof_commitment::programmable_private.bytes32_value,
    p_recovered_at, audit_id
  );
  update programmable_private.profile_subject_alias_status_current
  set state = 'current',
      alias_status_history_id = status_id,
      changed_at = p_recovered_at
  where alias_id = alias.alias_id;
  update programmable_private.profile_subject_current_alias
  set alias_id = alias.alias_id,
      generation = next_generation,
      changed_at = p_recovered_at
  where subject_id = binding.subject_id
    and generation = p_expected_binding_generation;
  if not found then
    raise exception using errcode = '40001', message = 'recovery alias generation lost';
  end if;
  insert into programmable_private.profile_owner_binding_history (
    binding_id, subject_id, wallet, alias_id, generation, state,
    recovery_method, proof_commitment, previous_binding_id, created_at, audit_id
  )
  values (
    binding_id_next, binding.subject_id,
    p_wallet::programmable_private.eth_address, alias.alias_id,
    next_generation, 'recovered', 'verified_subject_recovery',
    p_proof_commitment::programmable_private.bytes32_value,
    binding.binding_id, p_recovered_at, audit_id
  );
  update programmable_private.profile_owner_binding_current
  set binding_id = binding_id_next,
      generation = next_generation,
      state = 'recovered',
      changed_at = p_recovered_at
  where wallet = p_wallet and generation = p_expected_binding_generation;
  select revision into current_revision
  from programmable_private.profiles
  where subject_id = binding.subject_id
  for update;
  update programmable_private.profiles
  set revision = current_revision + 1,
      deleted_at = null,
      updated_at = p_recovered_at,
      last_mutation_audit_id = audit_id
  where subject_id = binding.subject_id and revision = current_revision;
  insert into programmable_private.profile_audit_records (
    profile_audit_id, subject_id, wallet, action,
    expected_binding_generation, resulting_binding_generation,
    expected_revision, resulting_revision, proof_commitment, caller_role,
    occurred_at, mutation_audit_id
  )
  values (
    pg_catalog.gen_random_uuid(), binding.subject_id,
    p_wallet::programmable_private.eth_address, 'profile.recover',
    p_expected_binding_generation, next_generation,
    current_revision, current_revision + 1,
    p_proof_commitment::programmable_private.bytes32_value,
    programmable_private.caller_role_name(), p_recovered_at, audit_id
  );
  return next_generation;
end
$function$;

create function programmable_private.mutate_profile(
  p_wallet bytea,
  p_hash_version smallint,
  p_keyed_subject_hash bytea,
  p_expected_binding_generation bigint,
  p_expected_revision bigint,
  p_username text,
  p_avatar_reference text,
  p_display_name text,
  p_bio text,
  p_proof_commitment bytea,
  p_mutated_at timestamptz default pg_catalog.clock_timestamp()
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  binding programmable_private.profile_owner_binding_current%rowtype;
  alias programmable_private.profile_subject_aliases%rowtype;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_profile_writer');
  if pg_catalog.octet_length(p_wallet) <> 20
     or pg_catalog.octet_length(p_keyed_subject_hash) <> 32
     or pg_catalog.octet_length(p_proof_commitment) <> 32
     or p_expected_binding_generation <= 0
     or p_expected_revision < 0
     or not programmable_private.valid_profile_username(p_username)
     or not programmable_private.valid_avatar_reference(p_avatar_reference)
     or (p_display_name is not null and pg_catalog.octet_length(p_display_name) not between 1 and 64)
     or (p_bio is not null and pg_catalog.octet_length(p_bio) > 280)
  then
    raise exception using errcode = '22023', message = 'invalid profile mutation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    programmable_private.profile_lock_key(p_wallet, 1)
  );
  select * into binding
  from programmable_private.profile_owner_binding_current
  where wallet = p_wallet
  for update;
  select * into alias
  from programmable_private.profile_subject_aliases
  where hash_version = p_hash_version
    and keyed_subject_hash = p_keyed_subject_hash;
  if binding.wallet is null
     or binding.state not in ('active', 'recovered')
     or binding.generation <> p_expected_binding_generation
     or alias.alias_id is null
     or alias.subject_id <> binding.subject_id
     or not exists (
       select 1
       from programmable_private.profile_hash_version_status_current
       where hash_version = p_hash_version and state = 'current'
     )
     or not exists (
       select 1
       from programmable_private.profile_subject_current_alias
       where subject_id = binding.subject_id
         and alias_id = alias.alias_id
         and generation = p_expected_binding_generation
     )
  then
    raise exception using errcode = '40001', message = 'profile binding generation or alias is stale';
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'profile.mutate', p_proof_commitment, null, p_mutated_at
  );
  update programmable_private.profiles
  set username = p_username,
      username_key = case when p_username is null then null else pg_catalog.lower(p_username) end,
      avatar_reference = p_avatar_reference,
      display_name = p_display_name,
      bio = p_bio,
      revision = p_expected_revision + 1,
      updated_at = p_mutated_at,
      last_mutation_audit_id = audit_id
  where subject_id = binding.subject_id
    and revision = p_expected_revision
    and deleted_at is null;
  if not found then
    raise exception using errcode = '40001', message = 'profile revision CAS lost';
  end if;
  insert into programmable_private.profile_audit_records (
    profile_audit_id, subject_id, wallet, action,
    expected_binding_generation, resulting_binding_generation,
    expected_revision, resulting_revision, proof_commitment, caller_role,
    occurred_at, mutation_audit_id
  )
  values (
    pg_catalog.gen_random_uuid(), binding.subject_id,
    p_wallet::programmable_private.eth_address, 'profile.mutate',
    p_expected_binding_generation, p_expected_binding_generation,
    p_expected_revision, p_expected_revision + 1,
    p_proof_commitment::programmable_private.bytes32_value,
    programmable_private.caller_role_name(), p_mutated_at, audit_id
  );
  return p_expected_revision + 1;
end
$function$;

create function programmable_private.append_token_project_metadata_revision(
  p_metadata_id uuid,
  p_wallet bytea,
  p_hash_version smallint,
  p_keyed_subject_hash bytea,
  p_expected_binding_generation bigint,
  p_chain_id bigint,
  p_token bytea,
  p_expected_metadata_revision bigint,
  p_project_name text,
  p_description text,
  p_logo_reference text,
  p_input_commitment bytea,
  p_created_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lock_keys bigint[];
  lock_key bigint;
  binding programmable_private.profile_owner_binding_current%rowtype;
  owner_alias programmable_private.profile_subject_aliases%rowtype;
  existing programmable_private.token_project_metadata%rowtype;
  latest programmable_private.token_project_metadata%rowtype;
  audit_id uuid;
  next_revision bigint;
begin
  perform programmable_private.assert_caller('programmable_profile_writer');
  if p_metadata_id is null
     or p_wallet is null
     or pg_catalog.octet_length(p_wallet) <> 20
     or p_wallet = pg_catalog.decode('0000000000000000000000000000000000000000', 'hex')
     or p_hash_version is null
     or p_hash_version <= 0
     or p_keyed_subject_hash is null
     or pg_catalog.octet_length(p_keyed_subject_hash) <> 32
     or p_expected_binding_generation is null
     or p_expected_binding_generation <= 0
     or p_chain_id is null
     or p_chain_id <= 0
     or p_token is null
     or pg_catalog.octet_length(p_token) <> 20
     or p_token = pg_catalog.decode('0000000000000000000000000000000000000000', 'hex')
     or p_expected_metadata_revision is null
     or p_expected_metadata_revision < 0
     or p_expected_metadata_revision = 9223372036854775807
     or (p_project_name is not null and pg_catalog.octet_length(p_project_name) > 128)
     or (p_description is not null and pg_catalog.octet_length(p_description) > 2000)
     or not programmable_private.valid_avatar_reference(p_logo_reference)
     or p_input_commitment is null
     or pg_catalog.octet_length(p_input_commitment) <> 32
     or p_created_at is null
  then
    raise exception using errcode = '22023', message = 'invalid token-project metadata revision';
  end if;
  next_revision := p_expected_metadata_revision + 1;

  lock_keys := array[
    programmable_private.profile_lock_key(p_wallet, 1),
    programmable_private.profile_lock_key(
      pg_catalog.int8send(p_chain_id) || p_token,
      3
    )
  ];
  for lock_key in
    select distinct requested_lock.key_value
    from pg_catalog.unnest(lock_keys) as requested_lock(key_value)
    order by requested_lock.key_value
  loop
    perform pg_catalog.pg_advisory_xact_lock(lock_key);
  end loop;

  select * into binding
  from programmable_private.profile_owner_binding_current
  where wallet = p_wallet
  for update;
  select * into owner_alias
  from programmable_private.profile_subject_aliases
  where hash_version = p_hash_version
    and keyed_subject_hash = p_keyed_subject_hash;
  if binding.wallet is null
     or binding.state not in ('active', 'recovered')
     or binding.generation <> p_expected_binding_generation
     or owner_alias.alias_id is null
     or owner_alias.subject_id <> binding.subject_id
     or not exists (
       select 1
       from programmable_private.profile_hash_version_status_current
       where hash_version = p_hash_version and state = 'current'
     )
     or not exists (
       select 1
       from programmable_private.profile_subject_alias_status_current
       where alias_id = owner_alias.alias_id and state = 'current'
     )
     or not exists (
       select 1
       from programmable_private.profile_subject_current_alias
       where subject_id = binding.subject_id
         and alias_id = owner_alias.alias_id
         and generation = p_expected_binding_generation
     )
     or not exists (
       select 1
       from programmable_private.profiles
       where subject_id = binding.subject_id and deleted_at is null
     )
  then
    raise exception using
      errcode = '40001',
      message = 'metadata owner binding generation or alias is stale';
  end if;

  select * into existing
  from programmable_private.token_project_metadata
  where metadata_id = p_metadata_id;
  if found then
    if existing.chain_id <> p_chain_id
       or existing.token <> p_token
       or existing.project_name is distinct from p_project_name
       or existing.description is distinct from p_description
       or existing.logo_reference is distinct from p_logo_reference
       or existing.metadata_revision <> next_revision
       or existing.subject_id <> binding.subject_id
       or existing.created_at <> p_created_at
       or (
         select audit.input_commitment
         from programmable_private.mutation_audits as audit
         where audit.audit_id = existing.audit_id
       ) is distinct from p_input_commitment
    then
      raise exception using
        errcode = '23505',
        message = 'token-project metadata replay changed content';
    end if;
    return existing.metadata_id;
  end if;

  select * into latest
  from programmable_private.token_project_metadata
  where chain_id = p_chain_id and token = p_token
  order by metadata_revision desc
  limit 1
  for share;
  if found then
    if latest.subject_id <> binding.subject_id then
      raise exception using
        errcode = '42501',
        message = 'token-project metadata belongs to another profile subject';
    end if;
    if latest.metadata_revision <> p_expected_metadata_revision then
      raise exception using
        errcode = '40001',
        message = 'token-project metadata revision CAS lost';
    end if;
  elsif p_expected_metadata_revision <> 0 then
    raise exception using
      errcode = '40001',
      message = 'token-project metadata revision CAS lost';
  end if;

  audit_id := programmable_private.append_mutation_audit(
    'project_metadata.append', p_input_commitment, null, p_created_at
  );
  insert into programmable_private.token_project_metadata (
    metadata_id, chain_id, token, project_name, description,
    logo_reference, metadata_revision, subject_id, created_at, audit_id
  )
  values (
    p_metadata_id,
    p_chain_id::programmable_private.chain_id_value,
    p_token::programmable_private.eth_address,
    p_project_name,
    p_description,
    p_logo_reference,
    next_revision,
    binding.subject_id,
    p_created_at,
    audit_id
  );
  insert into programmable_private.profile_audit_records (
    profile_audit_id, subject_id, wallet, action,
    expected_binding_generation, resulting_binding_generation,
    expected_revision, resulting_revision, proof_commitment, caller_role,
    occurred_at, mutation_audit_id
  )
  values (
    pg_catalog.gen_random_uuid(), binding.subject_id,
    p_wallet::programmable_private.eth_address, 'project_metadata.append',
    p_expected_binding_generation, p_expected_binding_generation,
    null, null,
    p_input_commitment::programmable_private.bytes32_value,
    programmable_private.caller_role_name(), p_created_at, audit_id
  );
  return p_metadata_id;
end
$function$;

create function programmable_private.append_project_metadata_link(
  p_project_link_id uuid,
  p_metadata_id uuid,
  p_wallet bytea,
  p_hash_version smallint,
  p_keyed_subject_hash bytea,
  p_expected_binding_generation bigint,
  p_expected_metadata_revision bigint,
  p_link_kind text,
  p_https_url text,
  p_display_order integer,
  p_input_commitment bytea,
  p_created_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lock_keys bigint[];
  lock_key bigint;
  binding programmable_private.profile_owner_binding_current%rowtype;
  owner_alias programmable_private.profile_subject_aliases%rowtype;
  metadata programmable_private.token_project_metadata%rowtype;
  latest programmable_private.token_project_metadata%rowtype;
  existing programmable_private.project_links%rowtype;
  requested_link_kind text;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_profile_writer');
  if p_project_link_id is null
     or p_metadata_id is null
     or p_wallet is null
     or pg_catalog.octet_length(p_wallet) <> 20
     or p_wallet = pg_catalog.decode('0000000000000000000000000000000000000000', 'hex')
     or p_hash_version is null
     or p_hash_version <= 0
     or p_keyed_subject_hash is null
     or pg_catalog.octet_length(p_keyed_subject_hash) <> 32
     or p_expected_binding_generation is null
     or p_expected_binding_generation <= 0
     or p_expected_metadata_revision is null
     or p_expected_metadata_revision <= 0
     or p_link_kind is null
     or pg_catalog.octet_length(p_link_kind) not between 1 and 128
     or p_link_kind !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     or p_https_url is null
     or pg_catalog.octet_length(p_https_url) not between 9 and 512
     or p_https_url !~ '^https://[A-Za-z0-9.-]+(?::[0-9]+)?/'
     or p_display_order is null
     or p_display_order not between 0 and 15
     or p_input_commitment is null
     or pg_catalog.octet_length(p_input_commitment) <> 32
     or p_created_at is null
  then
    raise exception using errcode = '22023', message = 'invalid project metadata link';
  end if;
  requested_link_kind := p_link_kind;

  select * into metadata
  from programmable_private.token_project_metadata
  where metadata_id = p_metadata_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown token-project metadata revision';
  end if;

  lock_keys := array[
    programmable_private.profile_lock_key(p_wallet, 1),
    programmable_private.profile_lock_key(
      pg_catalog.int8send(metadata.chain_id::bigint) || metadata.token,
      3
    )
  ];
  for lock_key in
    select distinct requested_lock.key_value
    from pg_catalog.unnest(lock_keys) as requested_lock(key_value)
    order by requested_lock.key_value
  loop
    perform pg_catalog.pg_advisory_xact_lock(lock_key);
  end loop;

  select * into binding
  from programmable_private.profile_owner_binding_current
  where wallet = p_wallet
  for update;
  select * into owner_alias
  from programmable_private.profile_subject_aliases
  where hash_version = p_hash_version
    and keyed_subject_hash = p_keyed_subject_hash;
  select * into metadata
  from programmable_private.token_project_metadata
  where metadata_id = p_metadata_id
  for share;
  if binding.wallet is null
     or binding.state not in ('active', 'recovered')
     or binding.generation <> p_expected_binding_generation
     or owner_alias.alias_id is null
     or owner_alias.subject_id <> binding.subject_id
     or metadata.metadata_id is null
     or not exists (
       select 1
       from programmable_private.profile_hash_version_status_current
       where hash_version = p_hash_version and state = 'current'
     )
     or not exists (
       select 1
       from programmable_private.profile_subject_alias_status_current
       where alias_id = owner_alias.alias_id and state = 'current'
     )
     or not exists (
       select 1
       from programmable_private.profile_subject_current_alias
       where subject_id = binding.subject_id
         and alias_id = owner_alias.alias_id
         and generation = p_expected_binding_generation
     )
     or not exists (
       select 1
       from programmable_private.profiles
       where subject_id = binding.subject_id and deleted_at is null
     )
  then
    raise exception using
      errcode = '40001',
      message = 'project-link owner binding generation or alias is stale';
  end if;
  if metadata.subject_id <> binding.subject_id then
    raise exception using
      errcode = '42501',
      message = 'token-project metadata belongs to another profile subject';
  end if;
  if metadata.metadata_revision <> p_expected_metadata_revision then
    raise exception using
      errcode = '40001',
      message = 'project-link metadata revision is stale';
  end if;

  select * into existing
  from programmable_private.project_links
  where project_link_id = p_project_link_id;
  if found then
    if existing.metadata_id <> p_metadata_id
       or existing.link_kind <> requested_link_kind
       or existing.https_url <> p_https_url
       or existing.display_order <> p_display_order
       or existing.created_at <> p_created_at
       or (
         select audit.input_commitment
         from programmable_private.mutation_audits as audit
         where audit.audit_id = existing.audit_id
       ) is distinct from p_input_commitment
    then
      raise exception using
        errcode = '23505',
        message = 'project metadata link replay changed content';
    end if;
    return existing.project_link_id;
  end if;

  select * into latest
  from programmable_private.token_project_metadata
  where chain_id = metadata.chain_id and token = metadata.token
  order by metadata_revision desc
  limit 1
  for share;
  if not found
     or latest.metadata_id <> p_metadata_id
     or latest.metadata_revision <> p_expected_metadata_revision
  then
    raise exception using
      errcode = '40001',
      message = 'project link metadata revision CAS lost';
  end if;

  audit_id := programmable_private.append_mutation_audit(
    'project_metadata_link.append', p_input_commitment, null, p_created_at
  );
  insert into programmable_private.project_links (
    project_link_id, metadata_id, link_kind, https_url, display_order,
    created_at, audit_id
  )
  values (
    p_project_link_id,
    p_metadata_id,
    requested_link_kind::programmable_private.source_identifier,
    p_https_url,
    p_display_order,
    p_created_at,
    audit_id
  );
  insert into programmable_private.profile_audit_records (
    profile_audit_id, subject_id, wallet, action,
    expected_binding_generation, resulting_binding_generation,
    expected_revision, resulting_revision, proof_commitment, caller_role,
    occurred_at, mutation_audit_id
  )
  values (
    pg_catalog.gen_random_uuid(), binding.subject_id,
    p_wallet::programmable_private.eth_address,
    'project_metadata_link.append',
    p_expected_binding_generation, p_expected_binding_generation,
    null, null,
    p_input_commitment::programmable_private.bytes32_value,
    programmable_private.caller_role_name(), p_created_at, audit_id
  );
  return p_project_link_id;
end
$function$;

create function programmable_private.append_reconciliation_record(
  p_reconciliation_id uuid,
  p_run_id uuid,
  p_comparison_kind text,
  p_severity text,
  p_source_from_block numeric,
  p_source_to_block numeric,
  p_compared_count bigint,
  p_mismatch_count bigint,
  p_evidence_commitment bytea,
  p_mismatch_identity_commitments bytea[],
  p_resolved_at timestamptz,
  p_recorded_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  header programmable_private.run_headers%rowtype;
  from_block bigint;
  to_block bigint;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id and run_kind = 'reconciliation';
  if not found then
    raise exception using errcode = '23503', message = 'invalid reconciliation run';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if exists (
    select 1
    from programmable_private.run_lifecycle_outcomes
    where run_id = p_run_id
  ) then
    raise exception using errcode = '55000', message = 'run is terminal';
  end if;
  if p_source_from_block <> pg_catalog.trunc(p_source_from_block)
     or p_source_to_block <> pg_catalog.trunc(p_source_to_block)
     or p_source_from_block < 0
     or p_source_to_block < p_source_from_block
     or p_source_to_block > 9223372036854775807
     or p_compared_count < 0
     or p_mismatch_count < 0
     or p_mismatch_count > p_compared_count
     or pg_catalog.octet_length(p_evidence_commitment) <> 32
     or not programmable_private.valid_topics(p_mismatch_identity_commitments)
  then
    raise exception using errcode = '22023', message = 'invalid reconciliation evidence';
  end if;
  from_block := p_source_from_block::bigint;
  to_block := p_source_to_block::bigint;
  audit_id := programmable_private.append_mutation_audit(
    'reconciliation.append', p_evidence_commitment, p_run_id, p_recorded_at
  );
  insert into programmable_private.reconciliation_records (
    reconciliation_id, run_id, chain_id, release_id, model_id, epoch_id,
    pointer_generation, comparison_kind, severity, source_from_block,
    source_to_block, compared_count, mismatch_count, evidence_commitment,
    mismatch_identity_commitments, resolved_at, recorded_at, audit_id
  )
  values (
    p_reconciliation_id, p_run_id, header.chain_id, header.release_id,
    header.model_id, header.epoch_id, header.captured_pointer_generation,
    p_comparison_kind::programmable_private.source_identifier,
    p_severity::programmable_private.reconciliation_severity,
    from_block::programmable_private.block_number_value,
    to_block::programmable_private.block_number_value,
    p_compared_count, p_mismatch_count,
    p_evidence_commitment::programmable_private.bytes32_value,
    p_mismatch_identity_commitments, p_resolved_at, p_recorded_at, audit_id
  );
  return p_reconciliation_id;
end
$function$;

create function programmable_private.append_parity_record(
  p_parity_record_id uuid,
  p_reconciliation_id uuid,
  p_route_key text,
  p_legacy_dto_hash bytea,
  p_indexed_dto_hash bytea,
  p_compared_at timestamptz,
  p_resolved_at timestamptz default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  reconciliation programmable_private.reconciliation_records%rowtype;
  header programmable_private.run_headers%rowtype;
  existing programmable_private.parity_records%rowtype;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into reconciliation
  from programmable_private.reconciliation_records
  where reconciliation_id = p_reconciliation_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown reconciliation';
  end if;
  select * into header
  from programmable_private.run_headers
  where run_id = reconciliation.run_id
    and run_kind = 'reconciliation';
  if not found then
    raise exception using errcode = '23503', message = 'invalid reconciliation provenance';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if exists (
    select 1
    from programmable_private.run_lifecycle_outcomes
    where run_id = header.run_id
  ) then
    raise exception using errcode = '55000', message = 'run is terminal';
  end if;
  if pg_catalog.octet_length(p_legacy_dto_hash) <> 32
     or pg_catalog.octet_length(p_indexed_dto_hash) <> 32
     or (p_legacy_dto_hash = p_indexed_dto_hash and p_resolved_at is not null)
  then
    raise exception using errcode = '22023', message = 'invalid parity evidence';
  end if;
  select * into existing
  from programmable_private.parity_records
  where parity_record_id = p_parity_record_id;
  if found then
    if existing.reconciliation_id <> p_reconciliation_id
       or existing.route_key <> p_route_key
       or existing.legacy_dto_hash <> p_legacy_dto_hash
       or existing.indexed_dto_hash <> p_indexed_dto_hash
       or existing.compared_at <> p_compared_at
       or existing.resolved_at is distinct from p_resolved_at
    then
      raise exception using errcode = '23505', message = 'parity replay changed content';
    end if;
    return existing.parity_record_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'parity.append', p_indexed_dto_hash, reconciliation.run_id, p_compared_at
  );
  insert into programmable_private.parity_records (
    parity_record_id, reconciliation_id, route_key, legacy_dto_hash,
    indexed_dto_hash, is_match, compared_at, resolved_at, audit_id
  )
  values (
    p_parity_record_id, p_reconciliation_id,
    p_route_key::programmable_private.source_identifier,
    p_legacy_dto_hash::programmable_private.bytes32_value,
    p_indexed_dto_hash::programmable_private.bytes32_value,
    p_legacy_dto_hash = p_indexed_dto_hash,
    p_compared_at, p_resolved_at, audit_id
  );
  return p_parity_record_id;
end
$function$;

create function programmable_private.append_market_snapshot(
  p_market_snapshot_id uuid,
  p_reconciliation_id uuid,
  p_source_deployment_id uuid,
  p_block_evidence_id uuid,
  p_pool_id bytea,
  p_block_number numeric,
  p_block_hash bytea,
  p_sqrt_price_x96 numeric,
  p_liquidity numeric,
  p_market_volume_token0 numeric,
  p_market_volume_token1 numeric,
  p_market_volume_usd numeric,
  p_hook_gross_volume numeric,
  p_observed_at timestamptz,
  p_input_commitment bytea
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  reconciliation programmable_private.reconciliation_records%rowtype;
  header programmable_private.run_headers%rowtype;
  block_evidence programmable_private.dual_rpc_block_evidence%rowtype;
  observation programmable_private.safe_head_observations%rowtype;
  existing programmable_private.market_snapshots%rowtype;
  normalized_block bigint;
  normalized_sqrt numeric;
  normalized_liquidity numeric;
  normalized_hook_volume numeric;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into reconciliation
  from programmable_private.reconciliation_records
  where reconciliation_id = p_reconciliation_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown reconciliation';
  end if;
  select * into header
  from programmable_private.run_headers
  where run_id = reconciliation.run_id
    and run_kind = 'reconciliation';
  if not found then
    raise exception using errcode = '23503', message = 'invalid reconciliation provenance';
  end if;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if exists (
    select 1
    from programmable_private.run_lifecycle_outcomes
    where run_id = header.run_id
  ) then
    raise exception using errcode = '55000', message = 'run is terminal';
  end if;
  if reconciliation.mismatch_count <> 0 or not exists (
    select 1
    from programmable_private.provider_deployments
    where provider_deployment_id = p_source_deployment_id
      and provider_type = 'uniswap_subgraph'
  ) then
    raise exception using errcode = '23503', message = 'invalid market source deployment';
  end if;
  normalized_sqrt := programmable_private.validate_uint256(p_sqrt_price_x96);
  normalized_liquidity := programmable_private.validate_uint256(p_liquidity);
  if p_hook_gross_volume is not null then
    normalized_hook_volume :=
      programmable_private.validate_uint256(p_hook_gross_volume);
  end if;
  if p_block_number <> pg_catalog.trunc(p_block_number)
     or p_block_number < 0
     or p_block_number > 9223372036854775807
     or pg_catalog.octet_length(p_pool_id) <> 32
     or pg_catalog.octet_length(p_block_hash) <> 32
     or p_market_volume_token0 < 0
     or p_market_volume_token1 < 0
     or (p_market_volume_usd is not null and p_market_volume_usd < 0)
     or p_market_volume_token0::text in ('NaN', 'Infinity', '-Infinity')
     or p_market_volume_token1::text in ('NaN', 'Infinity', '-Infinity')
     or p_market_volume_usd::text in ('NaN', 'Infinity', '-Infinity')
     or pg_catalog.octet_length(p_input_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid market snapshot';
  end if;
  normalized_block := p_block_number::bigint;
  select * into block_evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_block_evidence_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown market block evidence';
  end if;
  select * into observation
  from programmable_private.safe_head_observations
  where observation_id = block_evidence.observation_id;
  if not found
     or block_evidence.chain_id <> header.chain_id
     or block_evidence.epoch_id <> header.epoch_id
     or block_evidence.pointer_generation <> header.captured_pointer_generation
     or block_evidence.block_number <> normalized_block
     or block_evidence.agreed_block_hash <> p_block_hash
     or observation.release_id <> header.release_id
     or observation.model_id <> header.model_id
     or observation.source_group <> header.source_group
     or normalized_block < reconciliation.source_from_block
     or normalized_block > reconciliation.source_to_block
  then
    raise exception using errcode = '23514', message = 'market snapshot lacks exact canonical block evidence';
  end if;
  select * into existing
  from programmable_private.market_snapshots
  where market_snapshot_id = p_market_snapshot_id;
  if found then
    if existing.reconciliation_id <> p_reconciliation_id
       or existing.source_deployment_id <> p_source_deployment_id
       or existing.block_evidence_id <> p_block_evidence_id
       or existing.pool_id <> p_pool_id
       or existing.block_number <> normalized_block
       or existing.block_hash <> p_block_hash
       or existing.sqrt_price_x96 <> normalized_sqrt
       or existing.liquidity <> normalized_liquidity
       or existing.market_volume_token0 <> p_market_volume_token0
       or existing.market_volume_token1 <> p_market_volume_token1
       or existing.market_volume_usd is distinct from p_market_volume_usd
       or existing.hook_gross_volume is distinct from normalized_hook_volume
       or existing.observed_at <> p_observed_at
       or (
         select audit.input_commitment
         from programmable_private.mutation_audits as audit
         where audit.audit_id = existing.audit_id
       ) <> p_input_commitment
    then
      raise exception using errcode = '23505', message = 'market snapshot replay changed content';
    end if;
    return existing.market_snapshot_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'market_snapshot.append', p_input_commitment,
    reconciliation.run_id, p_observed_at
  );
  insert into programmable_private.market_snapshots (
    market_snapshot_id, chain_id, pool_id, source_deployment_id,
    block_evidence_id,
    block_number, block_hash, sqrt_price_x96, liquidity,
    market_volume_token0, market_volume_token1, market_volume_usd,
    hook_gross_volume, observed_at, reconciliation_id, audit_id
  )
  values (
    p_market_snapshot_id, reconciliation.chain_id,
    p_pool_id::programmable_private.bytes32_value, p_source_deployment_id,
    p_block_evidence_id,
    normalized_block::programmable_private.block_number_value,
    p_block_hash::programmable_private.bytes32_value,
    normalized_sqrt::programmable_private.uint256_value,
    normalized_liquidity::programmable_private.uint256_value,
    p_market_volume_token0, p_market_volume_token1, p_market_volume_usd,
    normalized_hook_volume::programmable_private.uint256_value,
    p_observed_at, p_reconciliation_id, audit_id
  );
  return p_market_snapshot_id;
end
$function$;

create function programmable_private.append_market_candle(
  p_market_candle_id uuid,
  p_reconciliation_id uuid,
  p_source_deployment_id uuid,
  p_source_block_evidence_id uuid,
  p_pool_id bytea,
  p_interval text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_open numeric,
  p_high numeric,
  p_low numeric,
  p_close numeric,
  p_volume_token0 numeric,
  p_volume_token1 numeric,
  p_volume_usd numeric,
  p_source_block_hash bytea,
  p_input_commitment bytea
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  reconciliation programmable_private.reconciliation_records%rowtype;
  header programmable_private.run_headers%rowtype;
  block_evidence programmable_private.dual_rpc_block_evidence%rowtype;
  observation programmable_private.safe_head_observations%rowtype;
  requested_interval programmable_private.market_interval;
  existing programmable_private.market_candles%rowtype;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into reconciliation
  from programmable_private.reconciliation_records
  where reconciliation_id = p_reconciliation_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown reconciliation';
  end if;
  select * into header
  from programmable_private.run_headers
  where run_id = reconciliation.run_id;
  perform programmable_private.assert_current_epoch(
    header.chain_id, header.release_id, header.model_id, header.source_group,
    header.epoch_id, header.captured_pointer_generation
  );
  if exists (
    select 1
    from programmable_private.run_lifecycle_outcomes
    where run_id = header.run_id
  ) then
    raise exception using errcode = '55000', message = 'run is terminal';
  end if;
  if reconciliation.mismatch_count <> 0 or not exists (
    select 1
    from programmable_private.provider_deployments
    where provider_deployment_id = p_source_deployment_id
      and provider_type = 'uniswap_subgraph'
  ) then
    raise exception using errcode = '23503', message = 'invalid candle source deployment';
  end if;
  select * into block_evidence
  from programmable_private.dual_rpc_block_evidence
  where block_evidence_id = p_source_block_evidence_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown candle block evidence';
  end if;
  select * into observation
  from programmable_private.safe_head_observations
  where observation_id = block_evidence.observation_id;
  if not found
     or block_evidence.chain_id <> header.chain_id
     or block_evidence.epoch_id <> header.epoch_id
     or block_evidence.pointer_generation <> header.captured_pointer_generation
     or block_evidence.agreed_block_hash <> p_source_block_hash
     or observation.release_id <> header.release_id
     or observation.model_id <> header.model_id
     or observation.source_group <> header.source_group
     or block_evidence.block_number < reconciliation.source_from_block
     or block_evidence.block_number > reconciliation.source_to_block
  then
    raise exception using errcode = '23514', message = 'market candle lacks exact canonical block evidence';
  end if;
  requested_interval := p_interval::programmable_private.market_interval;
  if requested_interval not in ('hour', 'day')
     or p_period_end <= p_period_start
     or p_open < 0 or p_high < 0 or p_low < 0 or p_close < 0
     or p_high < greatest(p_open, p_close, p_low)
     or p_volume_token0 < 0 or p_volume_token1 < 0
     or (p_volume_usd is not null and p_volume_usd < 0)
     or p_open::text in ('NaN', 'Infinity', '-Infinity')
     or p_high::text in ('NaN', 'Infinity', '-Infinity')
     or p_low::text in ('NaN', 'Infinity', '-Infinity')
     or p_close::text in ('NaN', 'Infinity', '-Infinity')
     or p_volume_token0::text in ('NaN', 'Infinity', '-Infinity')
     or p_volume_token1::text in ('NaN', 'Infinity', '-Infinity')
     or p_volume_usd::text in ('NaN', 'Infinity', '-Infinity')
     or pg_catalog.octet_length(p_pool_id) <> 32
     or pg_catalog.octet_length(p_source_block_hash) <> 32
     or pg_catalog.octet_length(p_input_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid market candle';
  end if;
  select * into existing
  from programmable_private.market_candles
  where market_candle_id = p_market_candle_id;
  if found then
    if existing.reconciliation_id <> p_reconciliation_id
       or existing.source_deployment_id <> p_source_deployment_id
       or existing.source_block_evidence_id <> p_source_block_evidence_id
       or existing.source_block_number <> block_evidence.block_number
       or existing.pool_id <> p_pool_id
       or existing.interval <> requested_interval
       or existing.period_start <> p_period_start
       or existing.period_end <> p_period_end
       or existing.open <> p_open
       or existing.high <> p_high
       or existing.low <> p_low
       or existing.close <> p_close
       or existing.volume_token0 <> p_volume_token0
       or existing.volume_token1 <> p_volume_token1
       or existing.volume_usd is distinct from p_volume_usd
       or existing.source_block_hash <> p_source_block_hash
       or (
         select audit.input_commitment
         from programmable_private.mutation_audits as audit
         where audit.audit_id = existing.audit_id
       ) <> p_input_commitment
    then
      raise exception using errcode = '23505', message = 'market candle replay changed content';
    end if;
    return existing.market_candle_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'market_candle.append', p_input_commitment,
    reconciliation.run_id, p_period_end
  );
  insert into programmable_private.market_candles (
    market_candle_id, chain_id, pool_id, source_deployment_id,
    source_block_evidence_id, source_block_number,
    interval, period_start, period_end,
    open, high, low, close, volume_token0, volume_token1, volume_usd,
    source_block_hash, reconciliation_id, audit_id
  )
  values (
    p_market_candle_id, reconciliation.chain_id,
    p_pool_id::programmable_private.bytes32_value, p_source_deployment_id,
    p_source_block_evidence_id, block_evidence.block_number, requested_interval,
    p_period_start, p_period_end, p_open, p_high, p_low, p_close,
    p_volume_token0, p_volume_token1, p_volume_usd,
    p_source_block_hash::programmable_private.bytes32_value,
    p_reconciliation_id, audit_id
  );
  return p_market_candle_id;
end
$function$;

create function programmable_private.append_portfolio_point(
  p_portfolio_point_id uuid,
  p_source_checkpoint_id uuid,
  p_account bytea,
  p_interval_minutes integer,
  p_point_time timestamptz,
  p_exact_reward_total numeric,
  p_input_commitment bytea
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  checkpoint programmable_private.projector_checkpoints%rowtype;
  exact_total numeric;
  existing programmable_private.portfolio_points%rowtype;
  audit_id uuid;
begin
  perform programmable_private.assert_caller('programmable_reconciler');
  select * into checkpoint
  from programmable_private.projector_checkpoints
  where checkpoint_id = p_source_checkpoint_id;
  if not found then
    raise exception using errcode = '23503', message = 'unknown source checkpoint';
  end if;
  exact_total := programmable_private.validate_uint256(p_exact_reward_total);
  if pg_catalog.octet_length(p_account) <> 20
     or p_interval_minutes not in (5, 1440)
     or pg_catalog.octet_length(p_input_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid portfolio point';
  end if;
  select * into existing
  from programmable_private.portfolio_points
  where portfolio_point_id = p_portfolio_point_id;
  if found then
    if existing.source_checkpoint_id <> p_source_checkpoint_id
       or existing.account <> p_account
       or existing.interval_minutes <> p_interval_minutes
       or existing.point_time <> p_point_time
       or existing.exact_reward_total <> exact_total
       or (
         select audit.input_commitment
         from programmable_private.mutation_audits as audit
         where audit.audit_id = existing.audit_id
       ) <> p_input_commitment
    then
      raise exception using errcode = '23505', message = 'portfolio point replay changed content';
    end if;
    return existing.portfolio_point_id;
  end if;
  audit_id := programmable_private.append_mutation_audit(
    'portfolio_point.append', p_input_commitment,
    checkpoint.run_id, p_point_time
  );
  insert into programmable_private.portfolio_points (
    portfolio_point_id, chain_id, account, interval_minutes, point_time,
    exact_reward_total, source_checkpoint_id, audit_id
  )
  values (
    p_portfolio_point_id, checkpoint.chain_id,
    p_account::programmable_private.eth_address, p_interval_minutes,
    p_point_time, exact_total::programmable_private.uint256_value,
    p_source_checkpoint_id, audit_id
  );
  return p_portfolio_point_id;
end
$function$;

create function programmable_private.prune_run_telemetry(
  p_now timestamptz,
  p_limit integer,
  p_input_commitment bytea
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  deleted_count integer;
begin
  perform programmable_private.assert_caller('programmable_maintenance');
  if p_limit < 1 or p_limit > 10000
     or pg_catalog.octet_length(p_input_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid retention request';
  end if;
  with doomed as (
    select telemetry_id
    from programmable_private.run_telemetry
    where (
      not failed_or_reorg and sampled_at < p_now - interval '30 days'
    ) or (
      failed_or_reorg and sampled_at < p_now - interval '180 days'
    )
    order by sampled_at, telemetry_id
    limit p_limit
    for update skip locked
  )
  delete from programmable_private.run_telemetry as telemetry
  using doomed
  where telemetry.telemetry_id = doomed.telemetry_id;
  get diagnostics deleted_count = row_count;
  perform programmable_private.append_mutation_audit(
    'retention.run_telemetry', p_input_commitment, null, p_now
  );
  return deleted_count;
end
$function$;

create function programmable_private.prune_market_data(
  p_now timestamptz,
  p_limit integer,
  p_input_commitment bytea
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  remaining integer := p_limit;
  changed integer := 0;
  step_count integer;
begin
  perform programmable_private.assert_caller('programmable_maintenance');
  if p_limit < 1 or p_limit > 10000
     or pg_catalog.octet_length(p_input_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid retention request';
  end if;
  with doomed as (
    select market_snapshot_id
    from programmable_private.market_snapshots
    where observed_at < p_now - interval '7 days'
    order by observed_at, market_snapshot_id
    limit remaining
    for update skip locked
  )
  delete from programmable_private.market_snapshots as snapshot
  using doomed
  where snapshot.market_snapshot_id = doomed.market_snapshot_id;
  get diagnostics step_count = row_count;
  changed := changed + step_count;
  remaining := remaining - step_count;
  if remaining > 0 then
    with doomed as (
      select market_candle_id
      from programmable_private.market_candles
      where interval = 'hour'
        and period_start < p_now - interval '90 days'
      order by period_start, market_candle_id
      limit remaining
      for update skip locked
    )
    delete from programmable_private.market_candles as candle
    using doomed
    where candle.market_candle_id = doomed.market_candle_id;
    get diagnostics step_count = row_count;
    changed := changed + step_count;
    remaining := remaining - step_count;
  end if;
  if remaining > 0 then
    with doomed as (
      select portfolio_point_id
      from programmable_private.portfolio_points
      where interval_minutes = 5
        and point_time < p_now - interval '400 days'
      order by point_time, portfolio_point_id
      limit remaining
      for update skip locked
    )
    delete from programmable_private.portfolio_points as point
    using doomed
    where point.portfolio_point_id = doomed.portfolio_point_id;
    get diagnostics step_count = row_count;
    changed := changed + step_count;
  end if;
  perform programmable_private.append_mutation_audit(
    'retention.market', p_input_commitment, null, p_now
  );
  return changed;
end
$function$;

create function programmable_private.prune_parity_records(
  p_now timestamptz,
  p_limit integer,
  p_input_commitment bytea
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  deleted_count integer;
begin
  perform programmable_private.assert_caller('programmable_maintenance');
  if p_limit < 1 or p_limit > 10000
     or pg_catalog.octet_length(p_input_commitment) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid retention request';
  end if;
  with doomed as (
    select parity_record_id
    from programmable_private.parity_records
    where (
      is_match and compared_at < p_now - interval '30 days'
    ) or (
      not is_match and resolved_at is not null
      and resolved_at < p_now - interval '180 days'
    )
    order by compared_at, parity_record_id
    limit p_limit
    for update skip locked
  )
  delete from programmable_private.parity_records as parity
  using doomed
  where parity.parity_record_id = doomed.parity_record_id;
  get diagnostics deleted_count = row_count;
  perform programmable_private.append_mutation_audit(
    'retention.parity', p_input_commitment, null, p_now
  );
  return deleted_count;
end
$function$;

do $lockdown$
declare
  table_record record;
begin
  for table_record in
    select c.relname
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'programmable_private'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  loop
    execute pg_catalog.format(
      'alter table programmable_private.%I enable row level security',
      table_record.relname
    );
    execute pg_catalog.format(
      'alter table programmable_private.%I force row level security',
      table_record.relname
    );
    execute pg_catalog.format(
      'create policy migrator_owner_all on programmable_private.%I ' ||
      'for all to programmable_migrator using (true) with check (true)',
      table_record.relname
    );
  end loop;
end
$lockdown$;

revoke all on all tables in schema programmable_private
  from public, anon, authenticated, service_role,
       programmable_projector, programmable_reconciler,
       programmable_api_reader, programmable_profile_binder,
       programmable_profile_recovery, programmable_profile_writer,
       programmable_maintenance;
revoke all on all sequences in schema programmable_private
  from public, anon, authenticated, service_role,
       programmable_projector, programmable_reconciler,
       programmable_api_reader, programmable_profile_binder,
       programmable_profile_recovery, programmable_profile_writer,
       programmable_maintenance;
revoke all on all functions in schema programmable_private
  from public, anon, authenticated, service_role,
       programmable_projector, programmable_reconciler,
       programmable_api_reader, programmable_profile_binder,
       programmable_profile_recovery, programmable_profile_writer,
       programmable_maintenance;

grant usage on schema programmable_private
  to programmable_profile_binder, programmable_profile_recovery,
     programmable_profile_writer, programmable_maintenance;

grant execute on function programmable_private.define_profile_hash_version(
  smallint, text, bytea, bytea, timestamptz
) to programmable_profile_recovery;
grant execute on function programmable_private.set_profile_hash_version_state(
  uuid, smallint, text, bytea, timestamptz
) to programmable_profile_recovery;
grant execute on function programmable_private.bind_profile_subject(
  bytea, smallint, bytea, text, bytea, timestamptz
) to programmable_profile_binder;
grant execute on function programmable_private.rekey_profile_subject(
  bytea, smallint, bytea, smallint, bytea, bigint, bytea, timestamptz
) to programmable_profile_recovery;
grant execute on function programmable_private.tombstone_profile_binding(
  bytea, smallint, bytea, bigint, bytea, timestamptz
) to programmable_profile_recovery;
grant execute on function programmable_private.recover_profile_binding(
  bytea, smallint, bytea, bigint, bytea, timestamptz
) to programmable_profile_recovery;
grant execute on function programmable_private.mutate_profile(
  bytea, smallint, bytea, bigint, bigint, text, text, text, text,
  bytea, timestamptz
) to programmable_profile_writer;
grant execute on function programmable_private.append_reconciliation_record(
  uuid, uuid, text, text, numeric, numeric, bigint, bigint, bytea,
  bytea[], timestamptz, timestamptz
) to programmable_reconciler;
grant execute on function programmable_private.append_parity_record(
  uuid, uuid, text, bytea, bytea, timestamptz, timestamptz
) to programmable_reconciler;
grant execute on function programmable_private.append_market_snapshot(
  uuid, uuid, uuid, uuid, bytea, numeric, bytea, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, bytea
) to programmable_reconciler;
grant execute on function programmable_private.append_market_candle(
  uuid, uuid, uuid, uuid, bytea, text, timestamptz, timestamptz, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, bytea, bytea
) to programmable_reconciler;
grant execute on function programmable_private.append_portfolio_point(
  uuid, uuid, bytea, integer, timestamptz, numeric, bytea
) to programmable_reconciler;
grant execute on function programmable_private.prune_run_telemetry(
  timestamptz, integer, bytea
) to programmable_maintenance;
grant execute on function programmable_private.prune_market_data(
  timestamptz, integer, bytea
) to programmable_maintenance;
grant execute on function programmable_private.prune_parity_records(
  timestamptz, integer, bytea
) to programmable_maintenance;

reset role;
