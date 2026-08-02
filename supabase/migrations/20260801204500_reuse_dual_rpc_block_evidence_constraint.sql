-- PostgreSQL may report either immutable uniqueness fence first when a retry
-- reuses the same observation, block and content fingerprint. Both conflicts
-- enter the same exact-field comparison before an existing row is returned.

set role programmable_migrator;

create or replace function programmable_private.append_or_reuse_dual_rpc_block_evidence_v1(
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
      if duplicate_constraint not in (
        'dual_rpc_block_evidence_epoch_id_content_fingerprint_key',
        'dual_rpc_block_evidence_observation_id_block_number_key'
      ) then
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
