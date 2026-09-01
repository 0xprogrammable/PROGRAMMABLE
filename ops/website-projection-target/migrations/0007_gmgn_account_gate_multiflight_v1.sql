BEGIN;

CREATE TABLE programmable_website_projection_v1.gmgn_account_gate_leases_v1 (
  gate_id text NOT NULL,
  generation bigint NOT NULL,
  lease_holder uuid NOT NULL,
  reserved_at timestamptz NOT NULL,
  lease_until timestamptz NOT NULL,
  CONSTRAINT gmgn_account_gate_leases_v1_pk
    PRIMARY KEY (gate_id, generation),
  CONSTRAINT gmgn_account_gate_leases_v1_holder_unique
    UNIQUE (gate_id, lease_holder),
  CONSTRAINT gmgn_account_gate_leases_v1_gate_fk
    FOREIGN KEY (gate_id)
    REFERENCES programmable_website_projection_v1.gmgn_account_gate_v1 (gate_id),
  CONSTRAINT gmgn_account_gate_leases_v1_identity_check
    CHECK (gate_id = 'gmgn-openapi-v1' AND generation >= 1),
  CONSTRAINT gmgn_account_gate_leases_v1_time_check
    CHECK (
      reserved_at >= TIMESTAMPTZ 'epoch'
      AND lease_until > reserved_at
    )
);

CREATE INDEX gmgn_account_gate_leases_v1_expiry_idx
  ON programmable_website_projection_v1.gmgn_account_gate_leases_v1
  (gate_id, lease_until);

ALTER TABLE programmable_website_projection_v1.gmgn_account_gate_leases_v1
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_website_projection_v1.gmgn_account_gate_leases_v1
  FORCE ROW LEVEL SECURITY;

REVOKE ALL
  ON programmable_website_projection_v1.gmgn_account_gate_leases_v1
  FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.gmgn_account_gate_leases_v1 FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.gmgn_account_gate_leases_v1 FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON programmable_website_projection_v1.gmgn_account_gate_leases_v1 FROM service_role';
  END IF;
END
$roles$;

CREATE POLICY gmgn_account_gate_leases_v1_runtime_select
  ON programmable_website_projection_v1.gmgn_account_gate_leases_v1
  AS PERMISSIVE FOR SELECT TO programmable_website_projection_runtime
  USING (gate_id = 'gmgn-openapi-v1');

CREATE POLICY gmgn_account_gate_leases_v1_runtime_insert
  ON programmable_website_projection_v1.gmgn_account_gate_leases_v1
  AS PERMISSIVE FOR INSERT TO programmable_website_projection_runtime
  WITH CHECK (gate_id = 'gmgn-openapi-v1');

CREATE POLICY gmgn_account_gate_leases_v1_runtime_delete
  ON programmable_website_projection_v1.gmgn_account_gate_leases_v1
  AS PERMISSIVE FOR DELETE TO programmable_website_projection_runtime
  USING (gate_id = 'gmgn-openapi-v1');

GRANT SELECT, INSERT, DELETE
  ON programmable_website_projection_v1.gmgn_account_gate_leases_v1
  TO programmable_website_projection_runtime;

COMMIT;
