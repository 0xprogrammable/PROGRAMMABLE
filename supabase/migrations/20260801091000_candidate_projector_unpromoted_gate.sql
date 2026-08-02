-- Candidate backfill must stop once the isolated database has been promoted.
-- This read-only gate binds the projector to the exact reviewed candidate and
-- rejects missing, mixed, or promoted database control state.

set role programmable_migrator;

-- The operator role is created by the bootstrap migration after the original
-- schema grant closure. USAGE is required to invoke its single promotion
-- attestation function; no table privilege is added.
grant usage on schema programmable_private to programmable_operator;

create function programmable_private.verify_candidate_database_unpromoted_v1(
  p_envio_provider_deployment_id uuid,
  p_envio_deployment_commitment bytea,
  p_envio_schema_commitment bytea,
  p_initialization_input_commitment bytea,
  p_initialized_at timestamptz
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

  if control.singleton is null
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
     or control.promotion_attestation_commitment is not null
     or control.promotion_baseline_commitment is not null
     or control.promotion_parity_commitment is not null
     or control.promotion_input_commitment is not null
     or control.promoted_at is not null
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
      message = 'candidate database is not in the exact unpromoted state';
  end if;

  return true;
end
$function$;

comment on function
  programmable_private.verify_candidate_database_unpromoted_v1(
    uuid, bytea, bytea, bytea, timestamptz
  ) is
  'Read-only candidate projector gate. It accepts only the exact isolated and unpromoted Envio candidate database.';

revoke all on function
  programmable_private.verify_candidate_database_unpromoted_v1(
    uuid, bytea, bytea, bytea, timestamptz
  )
from public, anon, authenticated, service_role,
     programmable_projector_runtime, programmable_reconciler,
     programmable_api_reader, programmable_profile_binder,
     programmable_profile_recovery, programmable_profile_writer,
     programmable_maintenance, programmable_operator;

grant execute on function
  programmable_private.verify_candidate_database_unpromoted_v1(
    uuid, bytea, bytea, bytea, timestamptz
  )
to programmable_projector;

reset role;
