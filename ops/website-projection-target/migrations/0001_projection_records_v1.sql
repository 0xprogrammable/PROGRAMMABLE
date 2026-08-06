BEGIN;

CREATE SCHEMA programmable_website_projection_v1;

REVOKE ALL ON SCHEMA programmable_website_projection_v1 FROM PUBLIC;

DO $runtime$
DECLARE
  runtime_role record;
BEGIN
  SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
    INTO runtime_role
    FROM pg_roles
   WHERE rolname = 'programmable_website_projection_runtime';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'programmable_website_projection_runtime must exist before migration';
  END IF;
  IF runtime_role.rolsuper OR runtime_role.rolcreaterole
     OR runtime_role.rolcreatedb OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION 'programmable_website_projection_runtime is over-privileged';
  END IF;
END
$runtime$;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA programmable_website_projection_v1 FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA programmable_website_projection_v1 FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA programmable_website_projection_v1 FROM service_role';
  END IF;
END
$roles$;

CREATE TABLE programmable_website_projection_v1.projection_records (
  lane text NOT NULL,
  target_binding_hash text NOT NULL,
  audience text NOT NULL,
  projection_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL,
  canonical_write text NOT NULL,
  canonical_acknowledgement text NOT NULL,
  canonical_readback text NOT NULL,
  record_binding_hash text NOT NULL,
  github_user_id text,
  github_principal_hash text,
  application_id text,
  application_revision text,
  github_repository_id text,
  launch_entitlement_binding_hash text,
  valid_from timestamptz,
  valid_until timestamptz,
  custom_project_id text,
  custom_launch_id text,
  custom_github_principal_hash text,
  custom_finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT projection_records_lane_key PRIMARY KEY (lane, projection_key),
  CONSTRAINT projection_records_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT projection_records_lane_check CHECK (
    lane IN ('website.entitlement', 'website.custom-launched')
  ),
  CONSTRAINT projection_records_target_hash_check CHECK (
    target_binding_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT projection_records_idempotency_hash_check CHECK (
    idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT projection_records_request_hash_check CHECK (
    request_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT projection_records_record_hash_check CHECK (
    record_binding_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT projection_records_projection_key_check CHECK (
    length(projection_key) BETWEEN 1 AND 512
    AND projection_key !~* '^https?://'
  ),
  CONSTRAINT projection_records_lane_metadata_check CHECK (
    (
      lane = 'website.entitlement'
      AND github_user_id ~ '^[1-9][0-9]{0,63}$'
      AND github_principal_hash ~ '^sha256:[0-9a-f]{64}$'
      AND length(application_id) BETWEEN 1 AND 512
      AND length(application_revision) BETWEEN 1 AND 512
      AND github_repository_id ~ '^[1-9][0-9]{0,63}$'
      AND launch_entitlement_binding_hash ~ '^sha256:[0-9a-f]{64}$'
      AND valid_from IS NOT NULL
      AND valid_until IS NOT NULL
      AND valid_from < valid_until
      AND custom_project_id IS NULL
      AND custom_launch_id IS NULL
      AND custom_github_principal_hash IS NULL
      AND custom_finalized_at IS NULL
    )
    OR (
      lane = 'website.custom-launched'
      AND github_user_id IS NULL
      AND github_principal_hash IS NULL
      AND application_id IS NULL
      AND application_revision IS NULL
      AND github_repository_id IS NULL
      AND launch_entitlement_binding_hash IS NULL
      AND valid_from IS NULL
      AND valid_until IS NULL
      AND custom_project_id ~ '^sha256:[0-9a-f]{64}$'
      AND custom_launch_id ~ '^sha256:[0-9a-f]{64}$'
      AND custom_github_principal_hash ~ '^sha256:[0-9a-f]{64}$'
      AND custom_finalized_at IS NOT NULL
    )
  )
);

CREATE TABLE programmable_website_projection_v1.credential_uses (
  credential_id text PRIMARY KEY,
  request_binding_hash text NOT NULL,
  canonical_use text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT credential_uses_id_check CHECK (
    length(credential_id) BETWEEN 1 AND 512
    AND credential_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT credential_uses_binding_hash_check CHECK (
    request_binding_hash ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE INDEX projection_records_active_entitlement_subject_idx
  ON programmable_website_projection_v1.projection_records
  (github_principal_hash, valid_until, valid_from)
  WHERE lane = 'website.entitlement' AND github_principal_hash IS NOT NULL;

CREATE UNIQUE INDEX projection_records_custom_project_idx
  ON programmable_website_projection_v1.projection_records (custom_project_id)
  WHERE lane = 'website.custom-launched';

CREATE UNIQUE INDEX projection_records_custom_launch_idx
  ON programmable_website_projection_v1.projection_records (custom_launch_id)
  WHERE lane = 'website.custom-launched';

CREATE INDEX projection_records_custom_profile_idx
  ON programmable_website_projection_v1.projection_records
  (custom_github_principal_hash, custom_finalized_at DESC, custom_project_id)
  WHERE lane = 'website.custom-launched';

REVOKE ALL ON ALL TABLES IN SCHEMA programmable_website_projection_v1 FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA programmable_website_projection_v1 FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA programmable_website_projection_v1 FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA programmable_website_projection_v1 FROM service_role';
  END IF;
END
$roles$;

ALTER TABLE programmable_website_projection_v1.projection_records
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.projection_records
  FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.credential_uses
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.credential_uses
  FORCE ROW LEVEL SECURITY;

CREATE POLICY projection_records_runtime_select
  ON programmable_website_projection_v1.projection_records
  FOR SELECT TO programmable_website_projection_runtime
  USING (true);
CREATE POLICY projection_records_runtime_insert
  ON programmable_website_projection_v1.projection_records
  FOR INSERT TO programmable_website_projection_runtime
  WITH CHECK (true);
CREATE POLICY credential_uses_runtime_select
  ON programmable_website_projection_v1.credential_uses
  FOR SELECT TO programmable_website_projection_runtime
  USING (true);
CREATE POLICY credential_uses_runtime_insert
  ON programmable_website_projection_v1.credential_uses
  FOR INSERT TO programmable_website_projection_runtime
  WITH CHECK (true);

COMMENT ON TABLE programmable_website_projection_v1.projection_records IS
  'Immutable Website-owned projection target records. Delivery evidence only; never approval or launch authority.';
COMMENT ON TABLE programmable_website_projection_v1.credential_uses IS
  'Immutable request-bound workload credential replay ledger.';

COMMIT;
