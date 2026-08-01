-- Bind candidate promotion to the immutable product artifact that was staged
-- and reviewed before cutover. Runtime release mode supplies only its platform
-- Git commit and deployment ID; private promotion evidence stays in the DB.

set role programmable_migrator;

alter table programmable_private.candidate_database_control
  add column product_commit text,
  add column staged_deployment_id text;

alter table programmable_private.candidate_database_control
  add constraint candidate_database_control_product_binding
  check (
    (
      promoted_at is null
      and product_commit is null
      and staged_deployment_id is null
    )
    or (
      promoted_at is not null
      and product_commit ~ '^[0-9a-f]{40}$'
      and product_commit <> pg_catalog.repeat('0', 40)
      and staged_deployment_id ~ '^dpl_[A-Za-z0-9]{20,128}$'
    )
  ) not valid;

alter table programmable_private.candidate_database_control
  validate constraint candidate_database_control_product_binding;

-- Keep the old signature fail-closed so an older operator cannot produce a
-- promoted row without binding it to one immutable Vercel artifact.
create or replace function programmable_private.attest_candidate_database_promotion(
  p_expected_envio_provider_deployment_id uuid,
  p_baseline_commitment bytea,
  p_parity_commitment bytea,
  p_promotion_attestation_commitment bytea,
  p_input_commitment bytea,
  p_promoted_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  perform programmable_private.assert_caller('programmable_operator');
  raise exception using
    errcode = '55000',
    message = 'product-bound candidate promotion is required';
end
$function$;

revoke all on function programmable_private.attest_candidate_database_promotion(
  uuid, bytea, bytea, bytea, bytea, timestamptz
)
from public, anon, authenticated, service_role,
     programmable_projector, programmable_projector_runtime,
     programmable_reconciler, programmable_api_reader,
     programmable_profile_binder, programmable_profile_recovery,
     programmable_profile_writer, programmable_maintenance,
     programmable_operator;

create function programmable_private.attest_candidate_database_promotion(
  p_expected_envio_provider_deployment_id uuid,
  p_baseline_commitment bytea,
  p_parity_commitment bytea,
  p_promotion_attestation_commitment bytea,
  p_input_commitment bytea,
  p_product_commit text,
  p_staged_deployment_id text,
  p_promoted_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  existing programmable_private.candidate_database_control%rowtype;
  zero_bytes bytea := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
  affected bigint;
begin
  perform programmable_private.assert_caller('programmable_operator');

  select * into existing
  from programmable_private.candidate_database_control
  where singleton
  for update;

  if not found
     or existing.envio_provider_deployment_id is distinct from
       p_expected_envio_provider_deployment_id
     or pg_catalog.octet_length(p_baseline_commitment) is distinct from 32
     or pg_catalog.octet_length(p_parity_commitment) is distinct from 32
     or pg_catalog.octet_length(p_promotion_attestation_commitment) is distinct from 32
     or pg_catalog.octet_length(p_input_commitment) is distinct from 32
     or p_baseline_commitment = zero_bytes
     or p_parity_commitment = zero_bytes
     or p_promotion_attestation_commitment = zero_bytes
     or p_input_commitment = zero_bytes
     or p_product_commit is null
     or p_product_commit !~ '^[0-9a-f]{40}$'
     or p_product_commit = pg_catalog.repeat('0', 40)
     or p_staged_deployment_id is null
     or p_staged_deployment_id !~ '^dpl_[A-Za-z0-9]{20,128}$'
     or p_promoted_at is null
     or p_promoted_at <= existing.initialized_at
  then
    raise exception using
      errcode = '23514',
      message = 'candidate product-bound promotion evidence is incomplete';
  end if;

  if existing.promoted_at is not null then
    if existing.promotion_baseline_commitment is distinct from
         p_baseline_commitment
       or existing.promotion_parity_commitment is distinct from
         p_parity_commitment
       or existing.promotion_attestation_commitment is distinct from
         p_promotion_attestation_commitment
       or existing.promotion_input_commitment is distinct from
         p_input_commitment
       or existing.product_commit is distinct from p_product_commit
       or existing.staged_deployment_id is distinct from
         p_staged_deployment_id
       or existing.promoted_at is distinct from p_promoted_at
    then
      raise exception using
        errcode = '23505',
        message = 'candidate product-bound promotion replay conflict';
    end if;
    return false;
  end if;

  update programmable_private.candidate_database_control
  set promotion_baseline_commitment = p_baseline_commitment,
      promotion_parity_commitment = p_parity_commitment,
      promotion_attestation_commitment =
        p_promotion_attestation_commitment,
      promotion_input_commitment = p_input_commitment,
      product_commit = p_product_commit,
      staged_deployment_id = p_staged_deployment_id,
      promoted_at = p_promoted_at
  where singleton
    and promoted_at is null
    and product_commit is null
    and staged_deployment_id is null;

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception using
      errcode = '40001',
      message = 'candidate product-bound promotion CAS lost';
  end if;
  return true;
end
$function$;

comment on function programmable_private.attest_candidate_database_promotion(
  uuid, bytea, bytea, bytea, bytea, text, text, timestamptz
) is
  'Atomically binds private promotion evidence to one immutable product commit and staged Vercel deployment.';

revoke all on function programmable_private.attest_candidate_database_promotion(
  uuid, bytea, bytea, bytea, bytea, text, text, timestamptz
)
from public, anon, authenticated, service_role,
     programmable_projector, programmable_projector_runtime,
     programmable_reconciler, programmable_api_reader,
     programmable_profile_binder, programmable_profile_recovery,
     programmable_profile_writer, programmable_maintenance;

grant execute on function programmable_private.attest_candidate_database_promotion(
  uuid, bytea, bytea, bytea, bytea, text, text, timestamptz
)
to programmable_operator;

-- Replace the post-deployment env-based gate with a product-bound verifier.
revoke all on function programmable_private.verify_candidate_database_promoted_v1(
  uuid, bytea, bytea, bytea, timestamptz,
  bytea, bytea, bytea, bytea, timestamptz
)
from public, anon, authenticated, service_role,
     programmable_projector, programmable_projector_runtime,
     programmable_reconciler, programmable_api_reader,
     programmable_profile_binder, programmable_profile_recovery,
     programmable_profile_writer, programmable_maintenance,
     programmable_operator;

create function programmable_private.verify_candidate_database_promoted_v2(
  p_envio_provider_deployment_id uuid,
  p_envio_deployment_commitment bytea,
  p_envio_schema_commitment bytea,
  p_initialization_input_commitment bytea,
  p_initialized_at timestamptz,
  p_product_commit text,
  p_staged_deployment_id text
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
     or p_envio_deployment_commitment = zero_bytes
     or p_envio_schema_commitment = zero_bytes
     or p_initialization_input_commitment = zero_bytes
     or p_initialized_at is null
     or p_product_commit is null
     or p_product_commit !~ '^[0-9a-f]{40}$'
     or p_product_commit = pg_catalog.repeat('0', 40)
     or p_staged_deployment_id is null
     or p_staged_deployment_id !~ '^dpl_[A-Za-z0-9]{20,128}$'
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
     or pg_catalog.octet_length(control.promotion_baseline_commitment)
       is distinct from 32
     or pg_catalog.octet_length(control.promotion_parity_commitment)
       is distinct from 32
     or pg_catalog.octet_length(control.promotion_attestation_commitment)
       is distinct from 32
     or pg_catalog.octet_length(control.promotion_input_commitment)
       is distinct from 32
     or control.promotion_baseline_commitment = zero_bytes
     or control.promotion_parity_commitment = zero_bytes
     or control.promotion_attestation_commitment = zero_bytes
     or control.promotion_input_commitment = zero_bytes
     or control.product_commit is distinct from p_product_commit
     or control.staged_deployment_id is distinct from
       p_staged_deployment_id
     or control.promoted_at is null
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
      message = 'candidate database is not bound to this promoted product';
  end if;

  return true;
end
$function$;

comment on function programmable_private.verify_candidate_database_promoted_v2(
  uuid, bytea, bytea, bytea, timestamptz, text, text
) is
  'Read-only release gate binding complete private promotion evidence to the executing immutable product artifact.';

revoke all on function programmable_private.verify_candidate_database_promoted_v2(
  uuid, bytea, bytea, bytea, timestamptz, text, text
)
from public, anon, authenticated, service_role,
     programmable_projector_runtime, programmable_reconciler,
     programmable_api_reader, programmable_profile_binder,
     programmable_profile_recovery, programmable_profile_writer,
     programmable_maintenance, programmable_operator;

grant execute on function programmable_private.verify_candidate_database_promoted_v2(
  uuid, bytea, bytea, bytea, timestamptz, text, text
)
to programmable_projector;

reset role;
