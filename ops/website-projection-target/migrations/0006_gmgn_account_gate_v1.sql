BEGIN;

CREATE TABLE programmable_website_projection_v1.gmgn_account_gate_v1 (
  gate_id text PRIMARY KEY,
  generation bigint NOT NULL DEFAULT 0,
  next_slot_at timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch',
  blocked_until timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch',
  lease_holder uuid,
  lease_until timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT gmgn_account_gate_v1_singleton_check
    CHECK (gate_id = 'gmgn-openapi-v1'),
  CONSTRAINT gmgn_account_gate_v1_generation_check
    CHECK (generation >= 0),
  CONSTRAINT gmgn_account_gate_v1_time_check
    CHECK (
      next_slot_at >= TIMESTAMPTZ 'epoch'
      AND blocked_until >= TIMESTAMPTZ 'epoch'
      AND lease_until >= TIMESTAMPTZ 'epoch'
      AND updated_at >= TIMESTAMPTZ 'epoch'
      AND (
        (lease_holder IS NULL AND lease_until = TIMESTAMPTZ 'epoch')
        OR (lease_holder IS NOT NULL AND lease_until > TIMESTAMPTZ 'epoch')
      )
    )
);

INSERT INTO programmable_website_projection_v1.gmgn_account_gate_v1 (
  gate_id
) VALUES ('gmgn-openapi-v1');

CREATE TABLE programmable_website_projection_v1.gmgn_account_gate_decisions_v1 (
  gate_id text NOT NULL,
  generation bigint NOT NULL,
  decision_kind text NOT NULL,
  decided_at timestamptz NOT NULL,
  next_slot_at timestamptz NOT NULL,
  blocked_until timestamptz NOT NULL,
  lease_holder uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  interval_ms integer,
  retry_after_ms bigint NOT NULL,
  provider_signal text,
  CONSTRAINT gmgn_account_gate_decisions_v1_pk
    PRIMARY KEY (gate_id, generation, decision_kind),
  CONSTRAINT gmgn_account_gate_decisions_v1_gate_fk
    FOREIGN KEY (gate_id)
    REFERENCES programmable_website_projection_v1.gmgn_account_gate_v1 (gate_id),
  CONSTRAINT gmgn_account_gate_decisions_v1_identity_check
    CHECK (gate_id = 'gmgn-openapi-v1' AND generation >= 1),
  CONSTRAINT gmgn_account_gate_decisions_v1_time_check
    CHECK (
      decided_at >= TIMESTAMPTZ 'epoch'
      AND next_slot_at >= TIMESTAMPTZ 'epoch'
      AND blocked_until >= TIMESTAMPTZ 'epoch'
      AND lease_until >= TIMESTAMPTZ 'epoch'
      AND retry_after_ms >= 0
    ),
  CONSTRAINT gmgn_account_gate_decisions_v1_decision_check
    CHECK (
      (decision_kind = 'reserved'
        AND interval_ms BETWEEN 20 AND 1000
        AND retry_after_ms = 0
        AND provider_signal IS NULL
        AND next_slot_at > decided_at
        AND lease_until > decided_at)
      OR
      (decision_kind = 'completed'
        AND interval_ms IS NULL
        AND retry_after_ms = 0
        AND provider_signal IS NULL
        AND lease_until = TIMESTAMPTZ 'epoch')
      OR
      (decision_kind = 'provider-blocked'
        AND interval_ms IS NULL
        AND provider_signal IN ('http-429', 'provider-envelope')
        AND blocked_until >= decided_at
        AND lease_until = TIMESTAMPTZ 'epoch')
    )
);

CREATE INDEX gmgn_account_gate_decisions_v1_decided_at_idx
  ON programmable_website_projection_v1.gmgn_account_gate_decisions_v1
  (decided_at DESC, generation DESC);

ALTER TABLE programmable_website_projection_v1.gmgn_account_gate_v1
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.gmgn_account_gate_v1
  FORCE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.gmgn_account_gate_decisions_v1
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.gmgn_account_gate_decisions_v1
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON programmable_website_projection_v1.gmgn_account_gate_v1
  FROM PUBLIC;
REVOKE ALL ON programmable_website_projection_v1.gmgn_account_gate_decisions_v1
  FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.gmgn_account_gate_v1, programmable_website_projection_v1.gmgn_account_gate_decisions_v1 FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.gmgn_account_gate_v1, programmable_website_projection_v1.gmgn_account_gate_decisions_v1 FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.gmgn_account_gate_v1, programmable_website_projection_v1.gmgn_account_gate_decisions_v1 FROM service_role';
  END IF;
END
$roles$;

CREATE POLICY gmgn_account_gate_v1_runtime_select
  ON programmable_website_projection_v1.gmgn_account_gate_v1
  AS PERMISSIVE FOR SELECT TO programmable_website_projection_runtime
  USING (gate_id = 'gmgn-openapi-v1');

CREATE POLICY gmgn_account_gate_v1_runtime_update
  ON programmable_website_projection_v1.gmgn_account_gate_v1
  AS PERMISSIVE FOR UPDATE TO programmable_website_projection_runtime
  USING (gate_id = 'gmgn-openapi-v1')
  WITH CHECK (gate_id = 'gmgn-openapi-v1');

CREATE POLICY gmgn_account_gate_decisions_v1_runtime_insert
  ON programmable_website_projection_v1.gmgn_account_gate_decisions_v1
  AS PERMISSIVE FOR INSERT TO programmable_website_projection_runtime
  WITH CHECK (gate_id = 'gmgn-openapi-v1');

GRANT SELECT
  ON programmable_website_projection_v1.gmgn_account_gate_v1
  TO programmable_website_projection_runtime;
GRANT UPDATE (
  generation, next_slot_at, blocked_until, lease_holder, lease_until, updated_at
)
  ON programmable_website_projection_v1.gmgn_account_gate_v1
  TO programmable_website_projection_runtime;
GRANT INSERT
  ON programmable_website_projection_v1.gmgn_account_gate_decisions_v1
  TO programmable_website_projection_runtime;

COMMIT;
