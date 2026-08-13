BEGIN;

CREATE TABLE programmable_website_projection_v1.generic_launch_materializations_v2 (
  approval_id text NOT NULL,
  launch_id text NOT NULL,
  descriptor_hash text NOT NULL,
  lifecycle_generation numeric(78, 0) NOT NULL,
  lifecycle_state text NOT NULL,
  lifecycle_evidence_hash text NOT NULL,
  canonical_record text,
  record_hash text,
  source_projection_hash text,
  finalization_block numeric(78, 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT generic_launch_materializations_v2_pk
    PRIMARY KEY (launch_id, lifecycle_generation),
  CONSTRAINT generic_launch_materializations_v2_approval_check
    CHECK (approval_id ~ '^0x[0-9a-f]{64}$' AND approval_id !~ '^0x0{64}$'),
  CONSTRAINT generic_launch_materializations_v2_launch_check
    CHECK (launch_id ~ '^0x[0-9a-f]{64}$' AND launch_id !~ '^0x0{64}$'),
  CONSTRAINT generic_launch_materializations_v2_descriptor_check
    CHECK (descriptor_hash ~ '^0x[0-9a-f]{64}$' AND descriptor_hash !~ '^0x0{64}$'),
  CONSTRAINT generic_launch_materializations_v2_generation_check
    CHECK (lifecycle_generation >= 1),
  CONSTRAINT generic_launch_materializations_v2_evidence_check
    CHECK (lifecycle_evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT generic_launch_materializations_v2_state_check
    CHECK (
      (lifecycle_state = 'finalized'
        AND canonical_record IS NOT NULL
        AND record_hash ~ '^sha256:[0-9a-f]{64}$'
        AND source_projection_hash ~ '^sha256:[0-9a-f]{64}$'
        AND finalization_block IS NOT NULL)
      OR
      (lifecycle_state IN ('revoked', 'invalidated')
        AND canonical_record IS NULL
        AND record_hash IS NULL
        AND source_projection_hash IS NULL
        AND finalization_block IS NULL)
    )
);

CREATE INDEX generic_launch_materializations_v2_record_hash_idx
  ON programmable_website_projection_v1.generic_launch_materializations_v2
  (record_hash)
  WHERE record_hash IS NOT NULL;

CREATE INDEX generic_launch_materializations_v2_latest_idx
  ON programmable_website_projection_v1.generic_launch_materializations_v2
  (launch_id, lifecycle_generation DESC);

CREATE INDEX generic_launch_materializations_v2_feed_idx
  ON programmable_website_projection_v1.generic_launch_materializations_v2
  (finalization_block DESC, record_hash DESC)
  WHERE lifecycle_state = 'finalized';

CREATE TABLE programmable_website_projection_v1.generic_launch_reconciliations_v2 (
  approval_id text PRIMARY KEY,
  launch_id text NOT NULL,
  descriptor_hash text NOT NULL,
  outcome text NOT NULL,
  observation_common_head numeric(78, 0) NOT NULL,
  observation_common_head_hash text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT generic_launch_reconciliations_v2_identity_check CHECK (
    approval_id ~ '^0x[0-9a-f]{64}$' AND approval_id !~ '^0x0{64}$'
    AND launch_id ~ '^0x[0-9a-f]{64}$' AND launch_id !~ '^0x0{64}$'
    AND descriptor_hash ~ '^0x[0-9a-f]{64}$' AND descriptor_hash !~ '^0x0{64}$'
  ),
  CONSTRAINT generic_launch_reconciliations_v2_outcome_check CHECK (
    outcome IN ('consumed', 'unconsumed')
  ),
  CONSTRAINT generic_launch_reconciliations_v2_observation_check CHECK (
    observation_common_head >= 1
    AND observation_common_head_hash ~ '^0x[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX generic_launch_reconciliations_v2_consumed_launch_unique
  ON programmable_website_projection_v1.generic_launch_reconciliations_v2
  (launch_id)
  WHERE outcome = 'consumed';

CREATE INDEX generic_launch_reconciliations_v2_refresh_idx
  ON programmable_website_projection_v1.generic_launch_reconciliations_v2
  (observed_at, approval_id);

CREATE TABLE programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2 (
  approval_id text PRIMARY KEY,
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT generic_launch_reconciliation_attempts_v2_identity_check CHECK (
    approval_id ~ '^0x[0-9a-f]{64}$' AND approval_id !~ '^0x0{64}$'
  )
);

CREATE INDEX generic_launch_reconciliation_attempts_v2_attempt_idx
  ON programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  (attempted_at, approval_id);

ALTER TABLE programmable_website_projection_v1.generic_launch_materializations_v2
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.generic_launch_materializations_v2
  FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.generic_launch_reconciliations_v2
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.generic_launch_reconciliations_v2
  FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON programmable_website_projection_v1.generic_launch_materializations_v2
  FROM PUBLIC;
REVOKE ALL ON programmable_website_projection_v1.generic_launch_reconciliations_v2
  FROM PUBLIC;
REVOKE ALL ON programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.generic_launch_materializations_v2, programmable_website_projection_v1.generic_launch_reconciliations_v2, programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2 FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.generic_launch_materializations_v2, programmable_website_projection_v1.generic_launch_reconciliations_v2, programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2 FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.generic_launch_materializations_v2, programmable_website_projection_v1.generic_launch_reconciliations_v2, programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2 FROM service_role';
  END IF;
END
$roles$;

CREATE POLICY generic_launch_materializations_v2_runtime_select
  ON programmable_website_projection_v1.generic_launch_materializations_v2
  AS PERMISSIVE FOR SELECT TO programmable_website_projection_runtime
  USING (true);

CREATE POLICY generic_launch_materializations_v2_runtime_insert
  ON programmable_website_projection_v1.generic_launch_materializations_v2
  AS PERMISSIVE FOR INSERT TO programmable_website_projection_runtime
  WITH CHECK (true);

CREATE POLICY generic_launch_reconciliations_v2_runtime_select
  ON programmable_website_projection_v1.generic_launch_reconciliations_v2
  AS PERMISSIVE FOR SELECT TO programmable_website_projection_runtime
  USING (true);

CREATE POLICY generic_launch_reconciliations_v2_runtime_insert
  ON programmable_website_projection_v1.generic_launch_reconciliations_v2
  AS PERMISSIVE FOR INSERT TO programmable_website_projection_runtime
  WITH CHECK (true);

CREATE POLICY generic_launch_reconciliations_v2_runtime_update
  ON programmable_website_projection_v1.generic_launch_reconciliations_v2
  AS PERMISSIVE FOR UPDATE TO programmable_website_projection_runtime
  USING (true) WITH CHECK (true);

CREATE POLICY generic_launch_reconciliation_attempts_v2_runtime_select
  ON programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  AS PERMISSIVE FOR SELECT TO programmable_website_projection_runtime
  USING (true);

CREATE POLICY generic_launch_reconciliation_attempts_v2_runtime_insert
  ON programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  AS PERMISSIVE FOR INSERT TO programmable_website_projection_runtime
  WITH CHECK (true);

CREATE POLICY generic_launch_reconciliation_attempts_v2_runtime_update
  ON programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  AS PERMISSIVE FOR UPDATE TO programmable_website_projection_runtime
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT
  ON programmable_website_projection_v1.generic_launch_materializations_v2
  TO programmable_website_projection_runtime;

GRANT SELECT, INSERT
  ON programmable_website_projection_v1.generic_launch_reconciliations_v2
  TO programmable_website_projection_runtime;
GRANT UPDATE (observation_common_head, observation_common_head_hash, observed_at)
  ON programmable_website_projection_v1.generic_launch_reconciliations_v2
  TO programmable_website_projection_runtime;

GRANT SELECT, INSERT
  ON programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  TO programmable_website_projection_runtime;
GRANT UPDATE (attempted_at)
  ON programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  TO programmable_website_projection_runtime;

COMMIT;
