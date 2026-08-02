-- A projector retry can legitimately verify the same block beneath a reused
-- safe-head observation. Keep one immutable evidence row per fingerprint and
-- return it only after an exact comparison of every canonical field.

set role programmable_migrator;

create function programmable_private.append_or_reuse_dual_rpc_block_evidence_v1(
  p_block_evidence_id uuid,
  p_observation_id uuid,
  p_run_id uuid,
  p_block_number numeric,
  p_provider_a_block_hash bytea,
  p_provider_b_block_hash bytea,
  p_encoding_version smallint,
  p_canonical_preimage bytea,
  p_content_fingerprint bytea,
  p_verified_at timestamptz default pg_catalog.clock_timestamp()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  duplicate_constraint text;
  header programmable_private.run_headers%rowtype;
  observation programmable_private.safe_head_observations%rowtype;
  existing programmable_private.dual_rpc_block_evidence%rowtype;
  normalized_block bigint;
begin
  perform programmable_private.assert_caller('programmable_projector');

  begin
    return programmable_private.append_dual_rpc_block_evidence(
      p_block_evidence_id,
      p_observation_id,
      p_run_id,
      p_block_number,
      p_provider_a_block_hash,
      p_provider_b_block_hash,
      p_encoding_version,
      p_canonical_preimage,
      p_content_fingerprint,
      p_verified_at
    );
  exception
    when unique_violation then
      get stacked diagnostics duplicate_constraint = constraint_name;
      if duplicate_constraint <>
          'dual_rpc_block_evidence_epoch_id_content_fingerprint_key'
      then
        raise;
      end if;
  end;

  select * into header
  from programmable_private.run_headers
  where run_id = p_run_id
    and run_kind in ('ingestion', 'projection', 'rewind')
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'invalid projector run';
  end if;

  select * into observation
  from programmable_private.safe_head_observations
  where observation_id = p_observation_id
  for key share;
  if not found
     or observation.epoch_id <> header.epoch_id
     or observation.chain_id <> header.chain_id
     or observation.pointer_generation <> header.captured_pointer_generation
  then
    raise exception using
      errcode = '23503',
      message = 'run and observation scope differ';
  end if;

  if p_block_number <> pg_catalog.trunc(p_block_number)
     or p_block_number < 0
     or p_block_number > 9223372036854775807
  then
    raise exception using errcode = '22023', message = 'invalid block number';
  end if;
  normalized_block := p_block_number::bigint;

  select * into existing
  from programmable_private.dual_rpc_block_evidence
  where epoch_id = header.epoch_id
    and content_fingerprint =
      p_content_fingerprint::programmable_private.bytes32_value
  for key share;
  if not found then
    raise exception using
      errcode = '23505',
      message = 'block-evidence fingerprint conflict has no reusable row';
  end if;

  if existing.observation_id <> p_observation_id
     or existing.epoch_id <> header.epoch_id
     or existing.chain_id <> header.chain_id
     or existing.pointer_generation <> header.captured_pointer_generation
     or existing.block_number <> normalized_block
     or existing.provider_a_block_hash <> p_provider_a_block_hash
     or existing.provider_b_block_hash <> p_provider_b_block_hash
     or existing.agreed_block_hash <> p_provider_a_block_hash
     or existing.encoding_version <> p_encoding_version
     or existing.canonical_preimage <> p_canonical_preimage
     or existing.content_fingerprint <> p_content_fingerprint
  then
    raise exception using
      errcode = '23505',
      message = 'block-evidence fingerprint replay conflicts with stored evidence';
  end if;

  return existing.block_evidence_id;
end
$function$;

revoke all on function programmable_private.append_or_reuse_dual_rpc_block_evidence_v1(
  uuid, uuid, uuid, numeric, bytea, bytea, smallint, bytea, bytea, timestamptz
) from public, anon, authenticated, service_role,
  programmable_projector_runtime, programmable_reconciler,
  programmable_api_reader, programmable_profile_binder,
  programmable_profile_recovery, programmable_profile_writer,
  programmable_maintenance, programmable_operator;

grant execute on function programmable_private.append_or_reuse_dual_rpc_block_evidence_v1(
  uuid, uuid, uuid, numeric, bytea, bytea, smallint, bytea, bytea, timestamptz
) to programmable_projector;

reset role;

do $migration$
declare
  table_owner name;
begin
  select pg_catalog.pg_get_userbyid(table_class.relowner)
  into table_owner
  from pg_catalog.pg_class as table_class
  join pg_catalog.pg_namespace as table_namespace
    on table_namespace.oid = table_class.relnamespace
  where table_namespace.nspname = 'programmable_private'
    and table_class.relname = 'dual_rpc_block_evidence'
    and table_class.relkind in ('r', 'p');

  if table_owner is null then
    raise exception using
      errcode = '42704',
      message = 'dual-RPC block evidence table is missing';
  end if;

  execute pg_catalog.format(
    'alter function programmable_private.' ||
    'append_or_reuse_dual_rpc_block_evidence_v1(' ||
    'uuid,uuid,uuid,numeric,bytea,bytea,smallint,bytea,bytea,timestamptz) ' ||
    'owner to %I',
    table_owner
  );
end
$migration$;

-- Evidence rows record the run that first persisted them. Consumers still
-- bind every reusable row to the current epoch, pointer, observation,
-- providers, block number, and hash; requiring the creator run as well would
-- make an exact immutable replay unusable.

set role programmable_migrator;

do $migration$
declare
  source text;
  rewritten text;
begin
  source := pg_catalog.pg_get_functiondef(
    'programmable_private.append_dual_rpc_log_coverage_evidence(uuid,uuid,uuid,text,bigint,bigint,numeric,numeric,bytea,numeric,text,uuid,uuid,uuid,uuid,bytea,bytea[],bytea[],bytea,smallint,bytea,bytea,bytea,timestamp with time zone)'::regprocedure
  );
  rewritten := pg_catalog.replace(
    source,
    '    on canonical_block.verification_run_id = p_run_id
   and canonical_block.observation_id = p_safe_head_observation_id',
    '    on canonical_block.observation_id = p_safe_head_observation_id'
  );
  if rewritten = source then
    raise exception 'log-coverage block replay fence source changed';
  end if;
  execute rewritten;

  source := pg_catalog.pg_get_functiondef(
    'programmable_private.commit_envio_ingestion_page_v1(uuid,uuid,uuid,uuid,text,bigint,bigint,numeric,programmable_private.envio_candidate_page_item_v1[],uuid,uuid,uuid,uuid,bytea,bytea[],bytea[],bytea,bytea,smallint,bytea,bytea,bytea,timestamp with time zone)'::regprocedure
  );
  rewritten := pg_catalog.replace(
    source,
    '      and verification_run_id = p_run_id
      and chain_id = 1;',
    '      and chain_id = 1;'
  );
  rewritten := pg_catalog.replace(
    rewritten,
    'empty Envio page lacks same-run final block evidence',
    'empty Envio page lacks final block evidence'
  );
  if rewritten = source then
    raise exception 'empty-page block replay fence source changed';
  end if;
  execute rewritten;

  source := pg_catalog.pg_get_functiondef(
    'programmable_private.recover_projector_reorg_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,bigint,bigint,bigint,bigint,numeric,bytea,numeric,text,uuid,text,bigint,bytea,bytea,timestamp with time zone)'::regprocedure
  );
  rewritten := pg_catalog.replace(
    source,
    '    and evidence.verification_run_id = p_run_id
    and evidence.epoch_id = header.epoch_id',
    '    and evidence.epoch_id = header.epoch_id'
  );
  if rewritten = source then
    raise exception 'reorg block replay fence source changed';
  end if;
  execute rewritten;

  source := pg_catalog.pg_get_functiondef(
    'programmable_private.register_envio_ingestion_genesis_v1(uuid,uuid,uuid,text,uuid,bytea,timestamp with time zone)'::regprocedure
  );
  rewritten := pg_catalog.replace(
    source,
    '    and pointer_generation = header.captured_pointer_generation
    and verification_run_id = p_run_id;',
    '    and pointer_generation = header.captured_pointer_generation;'
  );
  rewritten := pg_catalog.replace(
    rewritten,
    'genesis anchor lacks same-run dual-RPC evidence',
    'genesis anchor lacks dual-RPC evidence'
  );
  if rewritten = source then
    raise exception 'genesis block replay fence source changed';
  end if;
  execute rewritten;

  source := pg_catalog.pg_get_functiondef(
    'programmable_private.stage_verified_dynamic_source_activations_v1(uuid,text,uuid,bigint,bigint,bigint,bytea,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure
  );
  rewritten := pg_catalog.replace(
    source,
    '    and block.verification_run_id = p_run_id
    and block.epoch_id = header.epoch_id',
    '    and block.epoch_id = header.epoch_id'
  );
  rewritten := pg_catalog.replace(
    rewritten,
    '    and observation.verification_run_id = p_run_id
    and observation.provider_a_id = p_provider_a_id',
    '    and observation.provider_a_id = p_provider_a_id'
  );
  if rewritten = source then
    raise exception 'dynamic activation block replay fence source changed';
  end if;
  execute rewritten;
end
$migration$;

reset role;
