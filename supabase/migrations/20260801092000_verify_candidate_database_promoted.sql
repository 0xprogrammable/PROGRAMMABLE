-- Canonical release mode may consume the promoted Envio candidate only when
-- the database records the exact reviewed bootstrap and promotion evidence.
-- This verifier is read-only and intentionally unavailable to every role
-- except the projection writer capability.

set role programmable_migrator;

create function programmable_private.verify_candidate_database_promoted_v1(
  p_envio_provider_deployment_id uuid,
  p_envio_deployment_commitment bytea,
  p_envio_schema_commitment bytea,
  p_initialization_input_commitment bytea,
  p_initialized_at timestamptz,
  p_promotion_baseline_commitment bytea,
  p_promotion_parity_commitment bytea,
  p_promotion_attestation_commitment bytea,
  p_promotion_input_commitment bytea,
  p_promoted_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  control programmable_private.candidate_database_control%rowtype;
  provider programmable_private.provider_deployments%rowtype;
  envio_provider_count bigint;
  zero_bytes bytea := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
begin
  perform programmable_private.assert_caller('programmable_projector');

  select * into control
  from programmable_private.candidate_database_control
  where singleton;

  select * into provider
  from programmable_private.provider_deployments
  where provider_deployment_id = p_envio_provider_deployment_id;

  select pg_catalog.count(*) into envio_provider_count
  from programmable_private.provider_deployments
  where provider_type = 'envio_deployment';

  if pg_catalog.octet_length(p_envio_deployment_commitment) is distinct from 32
     or pg_catalog.octet_length(p_envio_schema_commitment) is distinct from 32
     or pg_catalog.octet_length(p_initialization_input_commitment) is distinct from 32
     or pg_catalog.octet_length(p_promotion_baseline_commitment) is distinct from 32
     or pg_catalog.octet_length(p_promotion_parity_commitment) is distinct from 32
     or pg_catalog.octet_length(p_promotion_attestation_commitment) is distinct from 32
     or pg_catalog.octet_length(p_promotion_input_commitment) is distinct from 32
     or p_envio_deployment_commitment = zero_bytes
     or p_envio_schema_commitment = zero_bytes
     or p_initialization_input_commitment = zero_bytes
     or p_promotion_baseline_commitment = zero_bytes
     or p_promotion_parity_commitment = zero_bytes
     or p_promotion_attestation_commitment = zero_bytes
     or p_promotion_input_commitment = zero_bytes
     or p_initialized_at is null
     or p_promoted_at is null
     or control.singleton is null
     or control.database_mode is distinct from 'candidate-only'
     or control.envio_provider_deployment_id is distinct from
       p_envio_provider_deployment_id
     or control.envio_deployment_commitment is distinct from
       p_envio_deployment_commitment
     or control.envio_schema_commitment is distinct from
       p_envio_schema_commitment
     or control.initialization_input_commitment is distinct from
       p_initialization_input_commitment
     or control.initialized_at is distinct from p_initialized_at
     or control.promotion_baseline_commitment is distinct from
       p_promotion_baseline_commitment
     or control.promotion_parity_commitment is distinct from
       p_promotion_parity_commitment
     or control.promotion_attestation_commitment is distinct from
       p_promotion_attestation_commitment
     or control.promotion_input_commitment is distinct from
       p_promotion_input_commitment
     or control.promoted_at is distinct from p_promoted_at
     or provider.provider_deployment_id is null
     or provider.provider_type is distinct from 'envio_deployment'
     or provider.redacted_identity is distinct from
       'envio:production-7f24e63'
     or provider.deployment_commitment is distinct from
       p_envio_deployment_commitment
     or provider.schema_commitment is distinct from
       p_envio_schema_commitment
     or provider.created_at is distinct from p_initialized_at
     or envio_provider_count is distinct from 1
  then
    raise exception using
      errcode = '55000',
      message = 'candidate database is not in the exact promoted state';
  end if;

  return true;
end
$function$;

comment on function
  programmable_private.verify_candidate_database_promoted_v1(
    uuid, bytea, bytea, bytea, timestamptz,
    bytea, bytea, bytea, bytea, timestamptz
  ) is
  'Read-only canonical projector gate. It accepts only the exact isolated and promoted Envio candidate database.';

revoke all on function
  programmable_private.verify_candidate_database_promoted_v1(
    uuid, bytea, bytea, bytea, timestamptz,
    bytea, bytea, bytea, bytea, timestamptz
  )
from public, anon, authenticated, service_role,
     programmable_projector_runtime, programmable_reconciler,
     programmable_api_reader, programmable_profile_binder,
     programmable_profile_recovery, programmable_profile_writer,
     programmable_maintenance, programmable_operator;

grant execute on function
  programmable_private.verify_candidate_database_promoted_v1(
    uuid, bytea, bytea, bytea, timestamptz,
    bytea, bytea, bytea, bytea, timestamptz
  )
to programmable_projector;

reset role;
