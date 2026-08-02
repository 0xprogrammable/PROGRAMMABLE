-- Multiple exact Envio pages can be verified beneath one unchanged dual-RPC
-- safe head. Preserve one immutable safe-head row per content fingerprint and
-- let later projector runs reuse it after an exact field-by-field comparison.

set role programmable_migrator;

create function programmable_private.append_or_reuse_safe_head_observation_v1(
  p_observation_id uuid,
  p_run_id uuid,
  p_provider_a_id uuid,
  p_provider_b_id uuid,
  p_reported_chain_id_a bigint,
  p_reported_chain_id_b bigint,
  p_head_a numeric,
  p_head_b numeric,
  p_finality_depth bigint,
  p_safe_block_number numeric,
  p_safe_block_hash_a bytea,
  p_safe_block_hash_b bytea,
  p_encoding_version smallint,
  p_canonical_preimage bytea,
  p_content_fingerprint bytea,
  p_observed_at timestamptz default pg_catalog.clock_timestamp()
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
  existing programmable_private.safe_head_observations%rowtype;
begin
  perform programmable_private.assert_caller('programmable_projector');

  begin
    return programmable_private.append_safe_head_observation(
      p_observation_id,
      p_run_id,
      p_provider_a_id,
      p_provider_b_id,
      p_reported_chain_id_a,
      p_reported_chain_id_b,
      p_head_a,
      p_head_b,
      p_finality_depth,
      p_safe_block_number,
      p_safe_block_hash_a,
      p_safe_block_hash_b,
      p_encoding_version,
      p_canonical_preimage,
      p_content_fingerprint,
      p_observed_at
    );
  exception
    when unique_violation then
      get stacked diagnostics duplicate_constraint = constraint_name;
      if duplicate_constraint <>
          'safe_head_observations_epoch_id_content_fingerprint_key'
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

  select * into existing
  from programmable_private.safe_head_observations
  where epoch_id = header.epoch_id
    and content_fingerprint =
      p_content_fingerprint::programmable_private.bytes32_value
  for key share;
  if not found then
    raise exception using
      errcode = '23505',
      message = 'safe-head fingerprint conflict has no reusable observation';
  end if;

  if existing.chain_id <> header.chain_id
     or existing.release_id <> header.release_id
     or existing.model_id <> header.model_id
     or existing.source_group <> header.source_group
     or existing.pointer_generation <> header.captured_pointer_generation
     or existing.provider_a_id <> p_provider_a_id
     or existing.provider_b_id <> p_provider_b_id
     or existing.reported_chain_id_a <> p_reported_chain_id_a
     or existing.reported_chain_id_b <> p_reported_chain_id_b
     or existing.head_a <> p_head_a
     or existing.head_b <> p_head_b
     or existing.finality_depth <> p_finality_depth
     or existing.safe_block_number <> p_safe_block_number
     or existing.safe_block_hash_a <> p_safe_block_hash_a
     or existing.safe_block_hash_b <> p_safe_block_hash_b
     or existing.agreed_safe_block_hash <> p_safe_block_hash_a
     or existing.encoding_version <> p_encoding_version
     or existing.canonical_preimage <> p_canonical_preimage
     or existing.content_fingerprint <> p_content_fingerprint
  then
    raise exception using
      errcode = '23505',
      message = 'safe-head fingerprint replay conflicts with stored evidence';
  end if;

  return existing.observation_id;
end
$function$;

revoke all on function programmable_private.append_or_reuse_safe_head_observation_v1(
  uuid, uuid, uuid, uuid, bigint, bigint, numeric, numeric, bigint, numeric,
  bytea, bytea, smallint, bytea, bytea, timestamptz
) from public, anon, authenticated, service_role,
  programmable_projector_runtime, programmable_reconciler,
  programmable_api_reader, programmable_profile_binder,
  programmable_profile_recovery, programmable_profile_writer,
  programmable_maintenance, programmable_operator;

grant execute on function programmable_private.append_or_reuse_safe_head_observation_v1(
  uuid, uuid, uuid, uuid, bigint, bigint, numeric, numeric, bigint, numeric,
  bytea, bytea, smallint, bytea, bytea, timestamptz
) to programmable_projector;

reset role;
