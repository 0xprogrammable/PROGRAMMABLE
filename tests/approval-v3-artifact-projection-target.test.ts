import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  canonicalizeJson,
  type JsonValue,
} from "../lib/server/projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "../lib/server/projection-target/hashing";
import {
  createInMemoryProjectionTargetAtomicStoreV1,
  createProjectionTargetCredentialVerifierV1,
  createProjectionTargetReferenceHandlerV1,
  type ProjectionTargetCredentialVerificationRequestV1,
  type ProjectionTargetAtomicStoreV1,
} from "../lib/server/projection-target/protocol";
import {
  PostgresProjectionTargetAtomicStoreV1,
  type ProjectionTargetPostgresClientV1,
  type ProjectionTargetPostgresPoolV1,
  type ProjectionTargetPostgresQueryResultV1,
} from "../lib/server/projection-target/postgres-store";
import { assertApprovalV3ProjectionAdmissionReadyV1 } from
  "../lib/server/projection-target/approval-v3-target";

const TARGET = digest("approval-v3-target");
const AUDIENCE = "programmable.website.approval-v3";
const NOW = new Date("2026-08-13T22:00:00.000Z");
const APPROVAL_ID = hash("1");
const DESCRIPTOR_HASH = hash("2");
const LAUNCH_ID = hash("3");

describe("Approval v3 Website artifact projection target", () => {
  it("fails ingress readiness when the exact Approval capacity fence is absent", async () => {
    const database = new PGlite();
    try {
      await migrate(database);
      const pool = new TestPool(database);
      await expect(assertApprovalV3ProjectionAdmissionReadyV1(pool))
        .resolves.toBeUndefined();
      await database.exec(`
        RESET ROLE;
        GRANT postgres TO service_role;
        SET ROLE programmable_website_projection_runtime;
      `);
      await expect(assertApprovalV3ProjectionAdmissionReadyV1(pool))
        .rejects.toThrow(/admission posture/u);
      await database.exec(`
        RESET ROLE;
        REVOKE postgres FROM service_role;
        DROP TRIGGER projection_records_approval_v3_capacity_v1
          ON programmable_website_projection_v1.projection_records;
        SET ROLE programmable_website_projection_runtime;
      `);
      await expect(assertApprovalV3ProjectionAdmissionReadyV1(pool))
        .rejects.toThrow(/storage posture/u);
    } finally {
      await database.close();
    }
  }, 20_000);

  it("durably acknowledges, exactly replays, and reads one authenticated artifact", async () => {
    const store = createInMemoryProjectionTargetAtomicStoreV1();
    const handler = target(store);
    const write = projectionWrite();

    const created = await handler.handle(putRequest(write, "put-created"));
    const replayed = await handler.handle(putRequest(write, "put-created"));
    const read = await handler.handle(getRequest(write.projectionKey, "get-readback"));

    expect(created.status).toBe(201);
    expect(replayed.status).toBe(200);
    expect(await replayed.text()).toBe(await created.text());
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual(expect.objectContaining({
      schemaVersion: "programmable.approval-v3-artifact-projection-readback.v1",
      projectionKind: "website.approval-v3",
      projectionKey: write.projectionKey,
      approvalId: APPROVAL_ID,
      descriptorHash: DESCRIPTOR_HASH,
      launchId: LAUNCH_ID,
      authorization: write.authorization,
      idempotencyKey: write.idempotencyKey,
      requestDigest: write.requestDigest,
    }));
  });

  it("conflicts when the same approval tuple is delivered with different bytes", async () => {
    const store = createInMemoryProjectionTargetAtomicStoreV1();
    const handler = target(store);
    const original = projectionWrite();
    const changed = projectionWrite({
      registryObservationDigest: digest("changed-observation"),
    });

    expect((await handler.handle(putRequest(original, "put-original"))).status)
      .toBe(201);
    expect((await handler.handle(putRequest(changed, "put-conflict"))).status)
      .toBe(409);
  });

  it("rejects artifact, evidence, tuple, and request hash substitution before persistence", async () => {
    const store = createInMemoryProjectionTargetAtomicStoreV1();
    const handler = target(store);
    const valid = projectionWrite();
    const mutations = [
      { ...valid, approvalEvidenceHash: hash("f") },
      { ...valid, descriptorHash: hash("e") },
      { ...valid, launchId: hash("d") },
      { ...valid, authorizationDigest: digest("forged-authorization") },
      { ...valid, requestDigest: digest("forged-request") },
      {
        ...valid,
        authorization: {
          ...valid.authorization,
          signedReceiptArtifactHash: digest("forged-artifact"),
        },
      },
    ] as const;

    for (const [index, mutation] of mutations.entries()) {
      const response = await handler.handle(putRequest(
        mutation as ApprovalV3ProjectionWrite,
        `put-invalid-${index}`,
      ));
      expect(response.status).toBe(400);
    }
    const absent = await handler.handle(getRequest(valid.projectionKey, "get-absent"));
    expect(absent.status).toBe(404);
  });

  it("requires the exact Approval workload principal and request-bound JWT", async () => {
    const handler = target(createInMemoryProjectionTargetAtomicStoreV1());
    const write = projectionWrite();
    const forged = putRequest(write, "put-forged", "forged-approval-service");

    expect((await handler.handle(forged)).status).toBe(401);
  });

  it("survives a Postgres store restart with an append-only exact readback", async () => {
    const database = new PGlite();
    try {
      await migrate(database);
      const pool = new TestPool(database);
      const write = projectionWrite();
      const first = target(new PostgresProjectionTargetAtomicStoreV1(pool));
      const created = await first.handle(putRequest(write, "postgres-put"));
      expect(created.status).toBe(201);

      const restarted = target(new PostgresProjectionTargetAtomicStoreV1(pool));
      expect((await restarted.handle(putRequest(write, "postgres-put"))).status)
        .toBe(200);
      const read = await restarted.handle(getRequest(
        write.projectionKey,
        "postgres-get",
      ));
      expect(read.status).toBe(200);
      expect((await read.json()).authorization).toEqual(write.authorization);
      await expect(pool.query(`
        UPDATE programmable_website_projection_v1.projection_records
           SET canonical_readback = '{}'
      `)).rejects.toThrow();
    } finally {
      await database.close();
    }
  }, 20_000);
});

type ApprovalV3ProjectionWrite = ReturnType<typeof projectionWrite>;

function target(store: ProjectionTargetAtomicStoreV1) {
  const verifier = createProjectionTargetCredentialVerifierV1({
    verifierBindingHash: digest("approval-v3-verifier"),
    async preflightBearer(input) {
      return input.bearerToken.startsWith("approval-service:");
    },
    async verifyBearer(input) {
      const [principalId, credentialId] = input.bearerToken.split(":");
      if (principalId !== "approval-service" || !credentialId) return null;
      return claims(input, principalId, credentialId);
    },
    now: () => NOW,
  });
  return createProjectionTargetReferenceHandlerV1({
    lanes: [{
      lane: "website.approval-v3",
      targetBindingHash: TARGET,
      audience: AUDIENCE,
    }],
    credentialVerifier: verifier,
    store,
    now: () => NOW,
  });
}

async function migrate(database: PGlite): Promise<void> {
  await database.exec(`
    CREATE ROLE programmable_website_projection_runtime NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
  `);
  for (const path of [
    "../ops/website-projection-target/migrations/0001_projection_records_v1.sql",
    "../ops/website-projection-target/migrations/0002_custom_launch_wallet_profile_v2.sql",
    "../ops/website-projection-target/migrations/0003_registry_custom_public_read_v1.sql",
    "../ops/website-projection-target/migrations/0004_approval_v3_artifacts_v1.sql",
    "../ops/website-projection-target/migrations/0005_generic_launch_materializations_v2.sql",
  ]) {
    await database.exec(await readFile(new URL(path, import.meta.url), "utf8"));
  }
  await database.exec(`
    GRANT USAGE ON SCHEMA programmable_website_projection_v1
      TO programmable_website_projection_runtime;
    GRANT SELECT, INSERT
      ON programmable_website_projection_v1.projection_records,
         programmable_website_projection_v1.credential_uses
      TO programmable_website_projection_runtime;
    SET ROLE programmable_website_projection_runtime;
  `);
}

class TestPool implements ProjectionTargetPostgresPoolV1 {
  constructor(private readonly database: PGlite) {}

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    return Object.freeze({
      query: <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => this.query<Row>(text, values),
      release() {},
    });
  }

  async assertProductionReadiness(): Promise<void> {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    const result = await this.database.query<Row>(text, [...values]);
    return Object.freeze({
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    });
  }
}

function claims(
  input: ProjectionTargetCredentialVerificationRequestV1,
  principalId: string,
  credentialId: string,
) {
  return {
    schemaVersion: "programmable.projection-target-credential-claims.v2" as const,
    principalId,
    credentialId,
    credentialTokenHash: digest(`credential:${credentialId}`),
    method: input.method,
    lane: input.lane,
    audience: input.audience,
    targetBindingHash: input.targetBindingHash,
    projectionKey: input.projectionKey,
    idempotencyKey: input.idempotencyKey,
    requestDigest: input.requestDigest,
    issuedAt: "2026-08-13T21:59:30.000Z",
    expiresAt: "2026-08-13T22:05:00.000Z",
  };
}

function projectionWrite(overrides: Readonly<{
  registryObservationDigest?: Sha256Digest;
}> = {}) {
  const authorization = approvalAuthorization();
  const signedReceiptArtifactHash = authorization.signedReceiptArtifactHash;
  const approvalEvidenceHash = authorization.approvalEvidenceHash;
  const authorizationDigest = rawDigest(authorization);
  const registryObservationDigest =
    overrides.registryObservationDigest ?? digest("registry-observation");
  const idempotencyKey = canonicalSha256(
    "programmable.approval-v3-website-artifact-idempotency.v1",
    {
      approvalId: APPROVAL_ID,
      descriptorHash: DESCRIPTOR_HASH,
      launchId: LAUNCH_ID,
      signedReceiptArtifactHash,
    },
  );
  const preimage = {
    schemaVersion: "programmable.approval-v3-artifact-projection-write.v1" as const,
    targetBindingHash: TARGET,
    projectionKind: "website.approval-v3" as const,
    projectionKey: `approval:${APPROVAL_ID}`,
    approvalId: APPROVAL_ID,
    descriptorHash: DESCRIPTOR_HASH,
    launchId: LAUNCH_ID,
    signedReceiptArtifactHash,
    approvalEvidenceHash,
    authorizationDigest,
    registryObservationDigest,
    idempotencyKey,
    authorization,
  };
  return {
    ...preimage,
    requestDigest: canonicalSha256(preimage.schemaVersion, preimage),
  };
}

function approvalAuthorization() {
  const artifact = {
    payload: {
      schemaVersion: "programmable.approval-registry-descriptor-binding.v3",
      authorization: { approvalId: APPROVAL_ID },
      descriptorHash: DESCRIPTOR_HASH,
      launchId: LAUNCH_ID,
    },
    envelope: {
      schemaVersion: "1.0.0",
      domain: "programmable.approval-registry-descriptor-binding.v3",
      audience: "programmable.custom-registry.v2",
    },
  };
  return {
    artifact,
    signedReceiptArtifactHash: rawDigest(artifact),
    approvalEvidenceHash: `0x${rawDigest(artifact).slice(7)}`,
  };
}

function putRequest(
  write: ApprovalV3ProjectionWrite,
  credentialId: string,
  principal = "approval-service",
): Request {
  return new Request(
    `https://website.invalid/v2/internal/projections/approval-descriptors/${encodeURIComponent(write.projectionKey)}`,
    {
      method: "PUT",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${principal}:${credentialId}`,
        "content-type": "application/json; charset=utf-8",
        "idempotency-key": write.idempotencyKey,
        "x-programmable-audience": AUDIENCE,
        "x-programmable-projection-kind": "website.approval-v3",
        "x-programmable-target-binding": TARGET,
      },
      body: canonicalizeJson(write as unknown as JsonValue),
    },
  );
}

function getRequest(projectionKey: string, credentialId: string): Request {
  return new Request(
    `https://website.invalid/v2/internal/projections/approval-descriptors/${encodeURIComponent(projectionKey)}`,
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer approval-service:${credentialId}`,
        "x-programmable-audience": AUDIENCE,
        "x-programmable-projection-kind": "website.approval-v3",
        "x-programmable-target-binding": TARGET,
      },
    },
  );
}

function digest(label: string): Sha256Digest {
  return canonicalSha256("programmable.approval-v3-target-test.v1", { label });
}

function hash(character: string): `0x${string}` {
  return `0x${character.repeat(64)}`;
}

function rawDigest(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256")
    .update(canonicalizeJson(value as JsonValue), "utf8")
    .digest("hex")}`;
}
