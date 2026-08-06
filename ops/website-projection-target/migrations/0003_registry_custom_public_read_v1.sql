BEGIN;

CREATE TABLE programmable_website_projection_v1.registry_custom_launch_records (
  project_id text NOT NULL UNIQUE CHECK (
    project_id ~ '^sha256:[0-9a-f]{64}$'
  ),
  launch_id text PRIMARY KEY CHECK (
    launch_id ~ '^sha256:[0-9a-f]{64}$'
  ),
  lifecycle_generation bigint NOT NULL CHECK (lifecycle_generation > 0),
  lifecycle_state text NOT NULL CHECK (
    lifecycle_state IN ('pending', 'finalized', 'corrected', 'revoked', 'reorged')
  ),
  lifecycle_binding_hash text NOT NULL CHECK (
    lifecycle_binding_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  observed_at timestamptz NOT NULL,
  canonical_materialization text NOT NULL CHECK (
    octet_length(canonical_materialization) BETWEEN 2 AND 8388608
    AND jsonb_typeof(canonical_materialization::jsonb) = 'object'
  ),
  canonical_public_record text CHECK (
    canonical_public_record IS NULL
    OR (
      octet_length(canonical_public_record) BETWEEN 2 AND 8388608
      AND jsonb_typeof(canonical_public_record::jsonb) = 'object'
    )
  ),
  record_binding_hash text CHECK (
    record_binding_hash IS NULL
    OR record_binding_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  launch_security_binding_hash text NOT NULL CHECK (
    launch_security_binding_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  launching_wallet_namespace text,
  launching_wallet_value text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (lifecycle_state = 'finalized'
      AND canonical_public_record IS NOT NULL
      AND record_binding_hash IS NOT NULL
      AND launching_wallet_namespace IS NOT NULL
      AND launching_wallet_value IS NOT NULL)
    OR
    (lifecycle_state <> 'finalized'
      AND canonical_public_record IS NULL
      AND record_binding_hash IS NULL
      AND launching_wallet_namespace IS NULL
      AND launching_wallet_value IS NULL)
  ),
  CHECK (
    launching_wallet_namespace IS NULL
    OR launching_wallet_namespace ~ '^eip155:[1-9][0-9]*$'
  ),
  CHECK (
    launching_wallet_value IS NULL
    OR launching_wallet_value ~ '^0x[0-9a-f]{40}$'
  )
);

REVOKE ALL ON TABLE
  programmable_website_projection_v1.registry_custom_launch_records
  FROM PUBLIC;
REVOKE ALL ON TABLE
  programmable_website_projection_v1.registry_custom_launch_records
  FROM anon, authenticated, service_role;

CREATE INDEX registry_custom_launch_public_order_v1
  ON programmable_website_projection_v1.registry_custom_launch_records
    (observed_at DESC, project_id ASC)
  WHERE lifecycle_state = 'finalized';

CREATE INDEX registry_custom_launch_wallet_public_order_v1
  ON programmable_website_projection_v1.registry_custom_launch_records
    (launching_wallet_namespace, launching_wallet_value,
     observed_at DESC, project_id ASC)
  WHERE lifecycle_state = 'finalized';

ALTER TABLE programmable_website_projection_v1.registry_custom_launch_records
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.registry_custom_launch_records
  FORCE ROW LEVEL SECURITY;

CREATE POLICY registry_custom_launch_records_runtime_select
  ON programmable_website_projection_v1.registry_custom_launch_records
  FOR SELECT
  TO programmable_website_projection_runtime
  USING (true);

CREATE POLICY registry_custom_launch_records_runtime_insert
  ON programmable_website_projection_v1.registry_custom_launch_records
  FOR INSERT
  TO programmable_website_projection_runtime
  WITH CHECK (true);

CREATE POLICY registry_custom_launch_records_runtime_update
  ON programmable_website_projection_v1.registry_custom_launch_records
  FOR UPDATE
  TO programmable_website_projection_runtime
  USING (true)
  WITH CHECK (true);

COMMIT;
