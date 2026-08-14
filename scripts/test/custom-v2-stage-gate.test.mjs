import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CUSTOM_V2_AUTHENTICATED_INGRESS_SCHEMA_VERSION,
  CUSTOM_V2_STAGE_EVIDENCE_SCHEMA_VERSION,
  verifyCustomV2StageCandidateV1,
} from "../custom-v2-stage-gate.mjs";

const COMMIT = "6d72fda6ccd22d09ebfeddd29962952d3abb79b4";
const DEPLOYMENT_ID = "dpl_1234567890abcdefghij";
const TARGET = "https://programmable-custom-v2-abc.vercel.app/";
const BINDING = `sha256:${"a".repeat(64)}`;
const DETAIL = `sha256:${"b".repeat(64)}`;
const APPROVAL_ID = `0x${"2".repeat(64)}`;
const IDEMPOTENCY = `sha256:${"c".repeat(64)}`;
const REQUEST = `sha256:${"d".repeat(64)}`;

function baseInput(fetchImpl, overrides = {}) {
  return {
    targetUrl: TARGET,
    deploymentId: DEPLOYMENT_ID,
    gitHead: COMMIT,
    registryMode: "prelaunch",
    genericMode: "disabled",
    approvalAudience: "programmable.website.approval-v3",
    approvalTargetBindingHash: BINDING,
    automationBypassSecret: "b".repeat(32),
    fetchImpl,
    ...overrides,
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function manifest(mode) {
  const live = mode === "live";
  return {
    schemaVersion: "programmable.custom-registry-public-manifest.v2",
    status: mode,
    generation: "2",
    chainId: "1",
    caip2: "eip155:1",
    publicReadEnabled: live,
    indexingEnabled: live,
    registry: live ? {
      address: `0x${"1".repeat(40)}`,
      runtimeCodeKeccak256: `0x${"2".repeat(64)}`,
      deploymentTransactionHash: `0x${"3".repeat(64)}`,
      deploymentBlock: "123",
      deploymentBlockHash: `0x${"4".repeat(64)}`,
    } : {
      address: null,
      runtimeCodeKeccak256: null,
      deploymentTransactionHash: null,
      deploymentBlock: null,
      deploymentBlockHash: null,
    },
    release: live ? {
      sourceCommit: "1".repeat(40),
      sourceTree: "2".repeat(40),
      sourceArtifactSha256: `sha256:${"3".repeat(64)}`,
      abiArtifactSha256: `sha256:${"4".repeat(64)}`,
      eventSetSha256: `sha256:${"5".repeat(64)}`,
    } : {
      sourceCommit: null,
      sourceTree: null,
      sourceArtifactSha256: null,
      abiArtifactSha256: null,
      eventSetSha256: null,
    },
    finality: live ? {
      minimumConfirmations: "64",
      policyBindingHash: `0x${"6".repeat(64)}`,
    } : {
      minimumConfirmations: null,
      policyBindingHash: null,
    },
  };
}

function fetchMatrix({
  live = false,
  ready = false,
  authenticated = false,
  emptyFeed = false,
  approvalUnavailable = false,
  approvalUnexpectedlyAvailable = false,
} = {}) {
  return async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.pathname === "/api/custom-launch/registry/v2/manifest") {
      return json(200, manifest(live ? "live" : "prelaunch"));
    }
    if (url.pathname === "/api/custom-launch/registry/v2/readiness") {
      return live
        ? json(200, {
          schemaVersion: "programmable.custom-registry-readiness.v2",
          status: "ready",
          registryStatus: "live",
          generation: "2",
          chainId: "1",
          manifestPath: "/api/custom-launch/registry/v2/manifest",
          runtimeBindings: "verified",
          providerQuorum: "verified",
          checkedAt: "2026-08-14T10:00:00.000Z",
        })
        : json(503, {
          schemaVersion: "programmable.custom-registry-readiness.v2",
          status: "unready",
          registryStatus: "prelaunch",
          code: "custom_registry_prelaunch",
          checkedAt: "2026-08-14T10:00:00.000Z",
        });
    }
    if (url.pathname.startsWith("/v2/internal/projections/approval-descriptors/")) {
      if (approvalUnavailable) {
        assert.equal(init.headers?.["x-programmable-audience"], undefined);
        assert.equal(init.headers?.["x-programmable-target-binding"], undefined);
        return json(503, {
          schemaVersion: "programmable.projection-target-error.v1",
          code: "target_unavailable",
        });
      }
      if (approvalUnexpectedlyAvailable) {
        assert.equal(init.headers?.["x-programmable-audience"], undefined);
        assert.equal(init.headers?.["x-programmable-target-binding"], undefined);
        return json(401, {
          schemaVersion: "programmable.projection-target-error.v1",
          code: "credential_required",
        });
      }
      assert.equal(
        init.headers?.["x-programmable-audience"],
        "programmable.website.approval-v3",
      );
      assert.equal(init.headers?.["x-programmable-target-binding"], BINDING);
      if (!init.headers?.authorization) {
        return json(401, {
          schemaVersion: "programmable.projection-target-error.v1",
          code: "credential_required",
        });
      }
      if (!authenticated) throw new Error("unexpected authenticated ingress");
      const write = JSON.parse(String(init.body ?? "{}"));
      const common = {
        projectionKey: `approval:${APPROVAL_ID}`,
        approvalId: APPROVAL_ID,
        idempotencyKey: IDEMPOTENCY,
        requestDigest: REQUEST,
      };
      return method === "PUT"
        ? json(201, {
          schemaVersion: "programmable.approval-v3-artifact-projection-write-ack.v1",
          ...common,
        })
        : json(200, {
          schemaVersion: "programmable.approval-v3-artifact-projection-readback.v1",
          ...common,
          authorization: write.authorization,
        });
    }
    if (url.pathname === "/api/ops/custom-launch/generic-v2-projector") {
      if (!init.headers?.authorization) {
        return json(401, {
          schemaVersion: "programmable.generic-launch-projector-error.v2",
          status: "error",
          code: "unauthorized",
        });
      }
      return method === "POST"
        ? json(200, {
          schemaVersion: "programmable.generic-launch-projector-result.v2",
          status: "ok",
        })
        : json(200, {
          schemaVersion: "programmable.generic-launch-reconciliation-result.v2",
          status: "ok",
          scanned: 0,
          succeeded: 0,
          failed: 0,
          results: [],
        });
    }
    if (url.pathname === "/api/custom-launch/generic/v2/readiness") {
      return ready ? json(200, {
        schemaVersion: "programmable.generic-launch-readiness.v2",
        status: "ready",
        generation: "2",
        chainId: "1",
        feedPath: "/api/custom-launch/generic/v2/launches",
        detailPathTemplate: "/api/custom-launch/generic/v2/launches/{recordHash}",
        checkedAt: "2026-08-14T10:00:00.000Z",
      }) : json(503, {
        schemaVersion: "programmable.generic-launch-readiness.v2",
        status: "unready",
        code: "generic_launch_v2_not_active",
        checkedAt: "2026-08-14T10:00:00.000Z",
      });
    }
    if (url.pathname === "/api/custom-launch/generic/v2/launches") {
      return ready ? json(200, {
        schemaVersion: "programmable.generic-launch-feed.v2",
        records: emptyFeed ? [] : [{ recordHash: DETAIL }],
        nextCursor: null,
        total: emptyFeed ? "0" : "1",
      }) : json(503, {
        schemaVersion: "programmable.custom-launch-error.v1",
        code: "generic_launch_v2_not_active",
      });
    }
    if (url.pathname.startsWith("/api/custom-launch/generic/v2/launches/")) {
      if (ready && emptyFeed) {
        return json(404, {
          schemaVersion: "programmable.custom-launch-error.v1",
          code: "generic_launch_v2_not_found",
        });
      }
      return ready ? json(200, {
        schemaVersion: "programmable.generic-launch-view.v2",
        record: { recordHash: DETAIL },
      }) : json(503, {
        schemaVersion: "programmable.custom-launch-error.v1",
        code: "generic_launch_v2_not_active",
      });
    }
    if (url.pathname.startsWith("/custom-launches")) {
      return new Response(`<html><body>${"stable".repeat(30)}</body></html>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    throw new Error(`unexpected request ${method} ${url.pathname}`);
  };
}

test("default prelaunch and disabled matrix proves every fail-closed surface", async () => {
  const evidence = await verifyCustomV2StageCandidateV1(
    baseInput(fetchMatrix()),
  );
  assert.equal(evidence.schemaVersion, CUSTOM_V2_STAGE_EVIDENCE_SCHEMA_VERSION);
  assert.deepEqual(evidence.matrix, {
    registryMode: "prelaunch",
    genericMode: "disabled",
    authenticatedIngress: false,
  });
  assert.ok(evidence.checks.some(({ id }) => id === "generic-v2-disabled"));
  assert.ok(evidence.checks.some(({ id }) => id === "approval-v3-unauthorized"));
  assert.doesNotMatch(JSON.stringify(evidence), /bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/u);
});

test("closed matrix requires unconfigured Approval V3 to fail closed", async () => {
  const evidence = await verifyCustomV2StageCandidateV1(baseInput(
    fetchMatrix({ approvalUnavailable: true }),
    {
      approvalAudience: undefined,
      approvalTargetBindingHash: undefined,
    },
  ));
  assert.ok(evidence.checks.some(({ id }) => id === "approval-v3-unavailable"));
  assert.ok(!evidence.checks.some(({ id }) => id === "approval-v3-unauthorized"));
});

test("explicit live and ready matrix proves Registry, DB, signer, feed and detail", async () => {
  const evidence = await verifyCustomV2StageCandidateV1(baseInput(
    fetchMatrix({ live: true, ready: true }),
    {
      registryMode: "live",
      genericMode: "ready",
      cronSecret: "c".repeat(32),
    },
  ));
  assert.equal(evidence.matrix.genericMode, "ready");
  assert.ok(evidence.checks.some(({ id }) => id === "generic-v2-reconciliation"));
  assert.ok(evidence.checks.some(({ id }) => id === "generic-v2-detail"));
});

test("ready empty feed verifies decimal total and the exact detail miss schema", async () => {
  const evidence = await verifyCustomV2StageCandidateV1(baseInput(
    fetchMatrix({ live: true, ready: true, emptyFeed: true }),
    {
      registryMode: "live",
      genericMode: "ready",
      cronSecret: "c".repeat(32),
    },
  ));
  assert.ok(evidence.checks.some(({ id }) => id === "generic-v2-detail-empty"));
});

test("authenticated ingress is digest-bound, delivered, read back and projected", async () => {
  const canonicalPutBody = JSON.stringify({
    schemaVersion: "programmable.approval-v3-artifact-projection-write.v1",
    projectionKind: "website.approval-v3",
    projectionKey: `approval:${APPROVAL_ID}`,
    approvalId: APPROVAL_ID,
    idempotencyKey: IDEMPOTENCY,
    requestDigest: REQUEST,
  });
  const authenticatedIngressEvidenceJson = JSON.stringify({
    schemaVersion: CUSTOM_V2_AUTHENTICATED_INGRESS_SCHEMA_VERSION,
    projectionKey: `approval:${APPROVAL_ID}`,
    idempotencyKey: IDEMPOTENCY,
    canonicalPutBody,
    putBearerToken: "p".repeat(32),
    getBearerToken: "g".repeat(32),
  });
  const authenticatedIngressEvidenceSha256 = `sha256:${createHash("sha256")
    .update(authenticatedIngressEvidenceJson).digest("hex")}`;
  const evidence = await verifyCustomV2StageCandidateV1(baseInput(
    fetchMatrix({ live: true, ready: true, authenticated: true }),
    {
      registryMode: "live",
      genericMode: "ready",
      cronSecret: "c".repeat(32),
      projectorToken: "j".repeat(32),
      authenticatedIngressEvidenceJson,
      authenticatedIngressEvidenceSha256,
    },
  ));
  assert.equal(evidence.matrix.authenticatedIngress, true);
  assert.doesNotMatch(JSON.stringify(evidence), /pppppppp|gggggggg|jjjjjjjj/u);
  assert.ok(evidence.checks.some(
    ({ id }) => id === "approval-v3-authenticated-delivery",
  ));
});

test("candidate identity and activation matrix fail closed", async () => {
  await assert.rejects(
    verifyCustomV2StageCandidateV1(baseInput(fetchMatrix(), {
      targetUrl: "https://programmable.market/",
    })),
    /exact unaliased Vercel origin/u,
  );
  await assert.rejects(
    verifyCustomV2StageCandidateV1(baseInput(fetchMatrix(), {
      genericMode: "ready",
    })),
    /cannot be ready before Registry V2 is live/u,
  );
  await assert.rejects(
    verifyCustomV2StageCandidateV1(baseInput(fetchMatrix(), {
      approvalAudience: undefined,
    })),
    /Approval V3 audience is invalid/u,
  );
  await assert.rejects(
    verifyCustomV2StageCandidateV1(baseInput(fetchMatrix({ live: true }), {
      registryMode: "live",
      approvalAudience: undefined,
      approvalTargetBindingHash: undefined,
    })),
    /Approval V3 audience is invalid/u,
  );
  await assert.rejects(
    verifyCustomV2StageCandidateV1(baseInput(
      fetchMatrix({ approvalUnexpectedlyAvailable: true }),
      {
        approvalAudience: undefined,
        approvalTargetBindingHash: undefined,
      },
    )),
    /returned 401, expected 503/u,
  );
});
