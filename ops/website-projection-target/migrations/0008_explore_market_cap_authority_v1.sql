BEGIN;

CREATE TABLE programmable_website_projection_v1.explore_market_cap_authority_heads_v1 (
  authority_key text PRIMARY KEY,
  input_commitment text NOT NULL,
  direction text NOT NULL,
  current_generation bigint NOT NULL DEFAULT 0,
  lease_generation bigint,
  lease_holder uuid,
  lease_until timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch',
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT explore_market_cap_authority_heads_v1_key_check
    CHECK (authority_key ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT explore_market_cap_authority_heads_v1_input_check
    CHECK (input_commitment ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT explore_market_cap_authority_heads_v1_direction_check
    CHECK (direction IN ('asc', 'desc')),
  CONSTRAINT explore_market_cap_authority_heads_v1_generation_check
    CHECK (
      current_generation >= 0
      AND (
        (lease_generation IS NULL AND lease_holder IS NULL)
        OR (
          lease_generation = current_generation + 1
          AND lease_holder IS NOT NULL
          AND lease_until > TIMESTAMPTZ 'epoch'
        )
      )
    )
);

CREATE TABLE programmable_website_projection_v1.explore_market_cap_authority_generations_v1 (
  authority_key text NOT NULL,
  generation bigint NOT NULL,
  authority_commitment text NOT NULL,
  ranking_commitment text NOT NULL,
  gmgn_status text NOT NULL,
  generated_at timestamptz NOT NULL,
  refresh_after timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  canonical_authority text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT explore_market_cap_authority_generations_v1_pk
    PRIMARY KEY (authority_key, generation),
  CONSTRAINT explore_market_cap_authority_generations_v1_head_fk
    FOREIGN KEY (authority_key)
    REFERENCES programmable_website_projection_v1.explore_market_cap_authority_heads_v1
    (authority_key)
    ON DELETE CASCADE,
  CONSTRAINT explore_market_cap_authority_generations_v1_generation_check
    CHECK (generation >= 1),
  CONSTRAINT explore_market_cap_authority_generations_v1_commitments_check
    CHECK (
      authority_commitment ~ '^sha256:[0-9a-f]{64}$'
      AND ranking_commitment ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT explore_market_cap_authority_generations_v1_status_check
    CHECK (gmgn_status IN ('complete', 'partial', 'unavailable')),
  CONSTRAINT explore_market_cap_authority_generations_v1_time_check
    CHECK (
      generated_at >= TIMESTAMPTZ 'epoch'
      AND refresh_after > generated_at
      AND valid_until >= refresh_after
      AND valid_until <= generated_at + INTERVAL '235 seconds'
    ),
  CONSTRAINT explore_market_cap_authority_generations_v1_size_check
    CHECK (octet_length(canonical_authority) BETWEEN 2 AND 16777216)
);

CREATE INDEX explore_market_cap_authority_generations_v1_expiry_idx
  ON programmable_website_projection_v1.explore_market_cap_authority_generations_v1
  (valid_until);

CREATE INDEX explore_market_cap_authority_generations_v1_ranking_idx
  ON programmable_website_projection_v1.explore_market_cap_authority_generations_v1
  (authority_key, ranking_commitment, generation DESC);

ALTER TABLE programmable_website_projection_v1.explore_market_cap_authority_heads_v1
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.explore_market_cap_authority_heads_v1
  FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.explore_market_cap_authority_generations_v1
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.explore_market_cap_authority_generations_v1
  FORCE ROW LEVEL SECURITY;

REVOKE ALL
  ON programmable_website_projection_v1.explore_market_cap_authority_heads_v1,
     programmable_website_projection_v1.explore_market_cap_authority_generations_v1
  FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.explore_market_cap_authority_heads_v1, programmable_website_projection_v1.explore_market_cap_authority_generations_v1 FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.explore_market_cap_authority_heads_v1, programmable_website_projection_v1.explore_market_cap_authority_generations_v1 FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.explore_market_cap_authority_heads_v1, programmable_website_projection_v1.explore_market_cap_authority_generations_v1 FROM service_role';
  END IF;
END
$roles$;

CREATE POLICY explore_market_cap_authority_heads_v1_runtime_select
  ON programmable_website_projection_v1.explore_market_cap_authority_heads_v1
  AS PERMISSIVE FOR SELECT TO programmable_website_projection_runtime
  USING (true);
CREATE POLICY explore_market_cap_authority_heads_v1_runtime_insert
  ON programmable_website_projection_v1.explore_market_cap_authority_heads_v1
  AS PERMISSIVE FOR INSERT TO programmable_website_projection_runtime
  WITH CHECK (true);
CREATE POLICY explore_market_cap_authority_heads_v1_runtime_update
  ON programmable_website_projection_v1.explore_market_cap_authority_heads_v1
  AS PERMISSIVE FOR UPDATE TO programmable_website_projection_runtime
  USING (true) WITH CHECK (true);
CREATE POLICY explore_market_cap_authority_heads_v1_runtime_delete
  ON programmable_website_projection_v1.explore_market_cap_authority_heads_v1
  AS PERMISSIVE FOR DELETE TO programmable_website_projection_runtime
  USING (true);

CREATE POLICY explore_market_cap_authority_generations_v1_runtime_select
  ON programmable_website_projection_v1.explore_market_cap_authority_generations_v1
  AS PERMISSIVE FOR SELECT TO programmable_website_projection_runtime
  USING (true);
CREATE POLICY explore_market_cap_authority_generations_v1_runtime_insert
  ON programmable_website_projection_v1.explore_market_cap_authority_generations_v1
  AS PERMISSIVE FOR INSERT TO programmable_website_projection_runtime
  WITH CHECK (true);
CREATE POLICY explore_market_cap_authority_generations_v1_runtime_delete
  ON programmable_website_projection_v1.explore_market_cap_authority_generations_v1
  AS PERMISSIVE FOR DELETE TO programmable_website_projection_runtime
  USING (true);

GRANT SELECT, INSERT, DELETE
  ON programmable_website_projection_v1.explore_market_cap_authority_heads_v1
  TO programmable_website_projection_runtime;
GRANT UPDATE (
  current_generation, lease_generation, lease_holder, lease_until, updated_at
) ON programmable_website_projection_v1.explore_market_cap_authority_heads_v1
  TO programmable_website_projection_runtime;
GRANT SELECT, INSERT, DELETE
  ON programmable_website_projection_v1.explore_market_cap_authority_generations_v1
  TO programmable_website_projection_runtime;

COMMIT;
