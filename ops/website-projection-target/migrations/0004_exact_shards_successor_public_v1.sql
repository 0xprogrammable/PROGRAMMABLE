BEGIN;

CREATE TABLE programmable_website_projection_v1.registry_exact_shards_canonical_history (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  canonical_generation bigint NOT NULL CHECK (canonical_generation > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO programmable_website_projection_v1.registry_exact_shards_canonical_history
  (singleton, canonical_generation)
VALUES (true, 1);

CREATE TABLE programmable_website_projection_v1.registry_exact_shards_orphaned_blocks (
  block_hash text PRIMARY KEY CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  orphaned_generation bigint NOT NULL CHECK (orphaned_generation > 1),
  orphaned_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE programmable_website_projection_v1.registry_exact_shards_events (
  event_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_binding_sha256 text NOT NULL UNIQUE CHECK (
    event_binding_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  website_project_id text NOT NULL CHECK (
    website_project_id ~ '^sha256:[0-9a-f]{64}$'
  ),
  launch_id text NOT NULL CHECK (launch_id ~ '^0x[0-9a-f]{64}$'),
  event_kind text NOT NULL CHECK (event_kind IN ('finalized', 'revoked')),
  launch_block_hash text CHECK (
    launch_block_hash IS NULL OR launch_block_hash ~ '^0x[0-9a-f]{64}$'
  ),
  finalization_block_hash text CHECK (
    finalization_block_hash IS NULL
    OR finalization_block_hash ~ '^0x[0-9a-f]{64}$'
  ),
  event_block_hash text NOT NULL CHECK (
    event_block_hash ~ '^0x[0-9a-f]{64}$'
  ),
  canonical boolean NOT NULL DEFAULT true,
  record_binding_sha256 text CHECK (
    record_binding_sha256 IS NULL
    OR record_binding_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  canonical_public_record text CHECK (
    canonical_public_record IS NULL
    OR (
      octet_length(canonical_public_record) BETWEEN 2 AND 8388608
      AND jsonb_typeof(canonical_public_record::jsonb) = 'object'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (event_kind = 'finalized'
      AND launch_block_hash IS NOT NULL
      AND finalization_block_hash IS NOT NULL
      AND event_block_hash = finalization_block_hash
      AND record_binding_sha256 IS NOT NULL
      AND canonical_public_record IS NOT NULL)
    OR
    (event_kind = 'revoked'
      AND launch_block_hash IS NULL
      AND finalization_block_hash IS NULL
      AND record_binding_sha256 IS NULL
      AND canonical_public_record IS NULL)
  )
);

CREATE TABLE programmable_website_projection_v1.registry_exact_shards_records (
  website_project_id text NOT NULL UNIQUE CHECK (
    website_project_id ~ '^sha256:[0-9a-f]{64}$'
  ),
  launch_id text PRIMARY KEY CHECK (launch_id ~ '^0x[0-9a-f]{64}$'),
  lifecycle_state text NOT NULL CHECK (
    lifecycle_state IN ('finalized', 'revoked', 'reorged')
  ),
  latest_event_sequence bigint REFERENCES
    programmable_website_projection_v1.registry_exact_shards_events(event_sequence),
  record_binding_sha256 text CHECK (
    record_binding_sha256 IS NULL
    OR record_binding_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  canonical_public_record text CHECK (
    canonical_public_record IS NULL
    OR (
      octet_length(canonical_public_record) BETWEEN 2 AND 8388608
      AND jsonb_typeof(canonical_public_record::jsonb) = 'object'
    )
  ),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (lifecycle_state = 'finalized'
      AND latest_event_sequence IS NOT NULL
      AND record_binding_sha256 IS NOT NULL
      AND canonical_public_record IS NOT NULL)
    OR
    (lifecycle_state = 'revoked'
      AND latest_event_sequence IS NOT NULL
      AND record_binding_sha256 IS NULL
      AND canonical_public_record IS NULL)
    OR
    (lifecycle_state = 'reorged'
      AND latest_event_sequence IS NULL
      AND record_binding_sha256 IS NULL
      AND canonical_public_record IS NULL)
  )
);

CREATE INDEX registry_exact_shards_anchor_blocks_v1
  ON programmable_website_projection_v1.registry_exact_shards_events
    (launch_id, canonical, event_sequence DESC);
CREATE INDEX registry_exact_shards_public_order_v1
  ON programmable_website_projection_v1.registry_exact_shards_records
    (latest_event_sequence DESC, website_project_id ASC)
  WHERE lifecycle_state = 'finalized';

REVOKE ALL ON TABLE
  programmable_website_projection_v1.registry_exact_shards_canonical_history,
  programmable_website_projection_v1.registry_exact_shards_orphaned_blocks,
  programmable_website_projection_v1.registry_exact_shards_events,
  programmable_website_projection_v1.registry_exact_shards_records
  FROM PUBLIC;
REVOKE ALL ON SEQUENCE
  programmable_website_projection_v1.registry_exact_shards_events_event_sequence_seq
  FROM PUBLIC;

GRANT SELECT, UPDATE ON TABLE
  programmable_website_projection_v1.registry_exact_shards_canonical_history
  TO programmable_website_projection_runtime;
GRANT SELECT, INSERT ON TABLE
  programmable_website_projection_v1.registry_exact_shards_orphaned_blocks
  TO programmable_website_projection_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE
  programmable_website_projection_v1.registry_exact_shards_events,
  programmable_website_projection_v1.registry_exact_shards_records
  TO programmable_website_projection_runtime;
GRANT USAGE, SELECT ON SEQUENCE
  programmable_website_projection_v1.registry_exact_shards_events_event_sequence_seq
  TO programmable_website_projection_runtime;

ALTER TABLE programmable_website_projection_v1.registry_exact_shards_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.registry_exact_shards_events
  FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.registry_exact_shards_records
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.registry_exact_shards_records
  FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.registry_exact_shards_canonical_history
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.registry_exact_shards_canonical_history
  FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.registry_exact_shards_orphaned_blocks
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.registry_exact_shards_orphaned_blocks
  FORCE ROW LEVEL SECURITY;

CREATE POLICY registry_exact_shards_events_runtime_all
  ON programmable_website_projection_v1.registry_exact_shards_events
  FOR ALL TO programmable_website_projection_runtime
  USING (true) WITH CHECK (true);
CREATE POLICY registry_exact_shards_records_runtime_all
  ON programmable_website_projection_v1.registry_exact_shards_records
  FOR ALL TO programmable_website_projection_runtime
  USING (true) WITH CHECK (true);
CREATE POLICY registry_exact_shards_canonical_history_runtime_all
  ON programmable_website_projection_v1.registry_exact_shards_canonical_history
  FOR ALL TO programmable_website_projection_runtime
  USING (true) WITH CHECK (true);
CREATE POLICY registry_exact_shards_orphaned_blocks_runtime_all
  ON programmable_website_projection_v1.registry_exact_shards_orphaned_blocks
  FOR ALL TO programmable_website_projection_runtime
  USING (true) WITH CHECK (true);

COMMENT ON TABLE programmable_website_projection_v1.registry_exact_shards_events IS
  'Append-only authenticated ExactShards V2 lifecycle evidence with canonical reorg status.';
COMMENT ON TABLE programmable_website_projection_v1.registry_exact_shards_records IS
  'Current fail-closed ExactShards V2 Website publication state; finalized revision 1 only.';
COMMENT ON TABLE programmable_website_projection_v1.registry_exact_shards_canonical_history IS
  'Singleton monotonic generation fence for ExactShards V2 canonical-history projections.';
COMMENT ON TABLE programmable_website_projection_v1.registry_exact_shards_orphaned_blocks IS
  'Durable exact-block denylist preventing stale post-reorg ExactShards V2 republication.';

COMMIT;
