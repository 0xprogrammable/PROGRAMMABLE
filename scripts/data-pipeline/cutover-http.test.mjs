import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  captureAndGateStagedReadModel,
  createStagedWorkers,
  exactStagedTarget,
  inspectUnexposedStagedDeployment,
} from "./cutover-http.mjs";
import {
  commitReadModelReleaseEvidence,
  readModelReleaseEvidenceCommitment,
} from "../perf/read-model-evidence-commitment.mjs";

const DEPLOYMENT = "dpl_12345678901234567890";
const SECRET = "s".repeat(32);
const BYPASS_SECRET = "b".repeat(32);

function releaseEvidencePayload() {
  return {
    schemaVersion: 1,
    profileId: "programmable-read-model-release-v1",
    evidenceKind: "preview",
    capturedAt: "2026-08-02T10:00:00.000Z",
    captureNonce: `0x${"c".repeat(64)}`,
    target: {
      url: "https://launcher-abc.vercel.app/",
      vercelDeploymentId: DEPLOYMENT,
      gitHead: "a".repeat(40),
    },
    artifacts: {
      datasetManifest: {
        file: "dataset-manifest.v1.json",
        sha256: "1".repeat(64),
      },
      httpSamples: {
        file: "http-samples.v1.jsonl",
        sha256: "2".repeat(64),
      },
      rpcTrace: {
        file: "rpc-trace.v1.json",
        sha256: "3".repeat(64),
      },
    },
  };
}

async function runCapturedEvidence(
  evidence,
  gateEvidenceSha256 = evidence?.evidenceSha256,
) {
  const directory = mkdtempSync(join(tmpdir(), "programmable-cutover-http-"));
  const evidencePath = join(directory, "read-model-release-evidence.v1.json");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  let call = 0;
  try {
    return await captureAndGateStagedReadModel({
      targetUrl: "https://launcher-abc.vercel.app/",
      deploymentId: DEPLOYMENT,
      outputDirectory: directory,
      workspace: process.cwd(),
      execute: async () => {
        call += 1;
        if (call === 1) {
          return {
            stdout: `${JSON.stringify({
              mode: "capture",
              evidencePath,
              evidenceSha256: evidence?.evidenceSha256,
            })}\n`,
          };
        }
        return {
          stdout: `${JSON.stringify({
            status: "accepted",
            releaseEvidenceAccepted: true,
            evidenceSha256: gateEvidenceSha256,
          })}\n`,
        };
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("staged target accepts only a deployment-specific Vercel origin", () => {
  assert.equal(
    exactStagedTarget("https://launcher-abc.vercel.app/", DEPLOYMENT).hostname,
    "launcher-abc.vercel.app",
  );
  for (const target of [
    "https://programmable.market/",
    "http://launcher-abc.vercel.app/",
    "https://launcher-abc.vercel.app/path",
    "https://user:secret@launcher-abc.vercel.app/",
  ]) {
    assert.throws(() => exactStagedTarget(target, DEPLOYMENT), /exact Vercel/u);
  }
});

test("capture commitment is canonical and cutover accepts the exact bundle", async () => {
  const payload = releaseEvidencePayload();
  const reorderedPayload = {
    artifacts: payload.artifacts,
    target: payload.target,
    captureNonce: payload.captureNonce,
    capturedAt: payload.capturedAt,
    evidenceKind: payload.evidenceKind,
    profileId: payload.profileId,
    schemaVersion: payload.schemaVersion,
  };
  assert.equal(
    readModelReleaseEvidenceCommitment(payload),
    readModelReleaseEvidenceCommitment(reorderedPayload),
  );

  const evidence = commitReadModelReleaseEvidence(payload);
  const result = await runCapturedEvidence(evidence);
  assert.equal(result.status, "accepted");
  assert.equal(result.evidenceSha256, evidence.evidenceSha256);
});

test("cutover rejects missing, stale and zero capture commitments", async () => {
  const payload = releaseEvidencePayload();
  await assert.rejects(
    runCapturedEvidence(payload),
    /capture did not produce evidence/u,
  );

  const tampered = commitReadModelReleaseEvidence(payload);
  tampered.target = { ...tampered.target, gitHead: "b".repeat(40) };
  await assert.rejects(
    runCapturedEvidence(tampered),
    /commitment is invalid/u,
  );

  await assert.rejects(
    runCapturedEvidence({
      ...payload,
      evidenceSha256: `0x${"0".repeat(64)}`,
    }),
    /commitment is invalid/u,
  );

  const acceptedByGate = commitReadModelReleaseEvidence(payload);
  const replacedAfterGate = commitReadModelReleaseEvidence({
    ...payload,
    target: { ...payload.target, gitHead: "b".repeat(40) },
  });
  await assert.rejects(
    runCapturedEvidence(replacedAfterGate, acceptedByGate.evidenceSha256),
    /differs across capture and gate/u,
  );
});

test("staged worker authorization stays in headers and responses must be no-store", async () => {
  const observed = [];
  const workers = createStagedWorkers({
    targetUrl: "https://launcher-abc.vercel.app/",
    deploymentId: DEPLOYMENT,
    cronSecret: SECRET,
    automationBypassSecret: BYPASS_SECRET,
    fetchImpl: async (url, options) => {
      observed.push({ url: String(url), options });
      return new Response(
        JSON.stringify(
          String(url).endsWith("reconcile-preparity")
            ? { ok: true }
            : { ok: true, readiness: { status: "caught-up" } },
        ),
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    },
  });
  await workers.runSourceProjector();
  await workers.runReconciler({ checkpointId: "x" });
  assert.equal(observed.length, 2);
  assert.equal(observed[0].options.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(
    observed[0].options.headers["x-vercel-protection-bypass"],
    BYPASS_SECRET,
  );
  assert.equal(observed[0].url.includes(SECRET), false);
  assert.equal(observed[0].url.includes(BYPASS_SECRET), false);
  assert.equal(observed[1].options.body.includes(SECRET), false);
  assert.equal(observed[1].options.body.includes(BYPASS_SECRET), false);
});

test("staged worker rejects cacheable and failed responses", async () => {
  const cacheable = createStagedWorkers({
    targetUrl: "https://launcher-abc.vercel.app/",
    deploymentId: DEPLOYMENT,
    cronSecret: SECRET,
    automationBypassSecret: BYPASS_SECRET,
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  await assert.rejects(cacheable.runSourceProjector(), /unsafe response/u);

  const failed = createStagedWorkers({
    targetUrl: "https://launcher-abc.vercel.app/",
    deploymentId: DEPLOYMENT,
    cronSecret: SECRET,
    automationBypassSecret: BYPASS_SECRET,
    fetchImpl: async () => new Response("{}", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    }),
  });
  await assert.rejects(failed.runSourceProjector(), /worker failed/u);
});

test("staged exposure gate accepts only the exact unaliased deployment", async () => {
  const candidateCommit = "a".repeat(40);
  const productionCommit = "b".repeat(40);
  const projectId = "prj_12345678";
  const candidate = {
    id: DEPLOYMENT,
    url: "launcher-abc.vercel.app",
    readyState: "READY",
    target: "production",
    projectId,
    alias: [],
    meta: { githubCommitSha: candidateCommit },
  };
  const production = {
    id: "dpl_09876543210987654321",
    url: "launcher-live.vercel.app",
    readyState: "READY",
    target: "production",
    projectId,
    alias: [],
    meta: { githubCommitSha: productionCommit },
  };
  const fetchDeployment = async ({ idOrUrl }) =>
    idOrUrl === DEPLOYMENT ? candidate : production;
  let productionAliasDeploymentId = production.id;
  const resolveAlias = async ({ alias }) => {
    if (candidate.alias.includes(alias)) {
      return { alias, deploymentId: DEPLOYMENT };
    }
    return alias === "programmable.market"
      ? { alias, deploymentId: productionAliasDeploymentId }
      : undefined;
  };
  const result = await inspectUnexposedStagedDeployment({
    targetUrl: "https://launcher-abc.vercel.app/",
    deploymentId: DEPLOYMENT,
    productCommit: candidateCommit,
    projectId,
    token: "v".repeat(32),
    teamId: "team_123",
    fetchDeployment,
    resolveAlias,
  });
  assert.equal(result.schedulerExposure, false);
  assert.equal(result.productionDomain, "programmable.market");
  assert.equal(result.currentProduction.deploymentId, production.id);

  candidate.alias = ["programmable.market"];
  await assert.rejects(
    inspectUnexposedStagedDeployment({
      targetUrl: "https://launcher-abc.vercel.app/",
      deploymentId: DEPLOYMENT,
      productCommit: candidateCommit,
      projectId,
      token: "v".repeat(32),
      teamId: "team_123",
      fetchDeployment,
      resolveAlias,
    }),
    /exposed, aliased or not exactly bound/u,
  );

  candidate.alias = [];
  productionAliasDeploymentId = "dpl_11111111111111111111";
  await assert.rejects(
    inspectUnexposedStagedDeployment({
      targetUrl: "https://launcher-abc.vercel.app/",
      deploymentId: DEPLOYMENT,
      productCommit: candidateCommit,
      projectId,
      token: "v".repeat(32),
      teamId: "team_123",
      fetchDeployment,
      resolveAlias,
    }),
    /exposed, aliased or not exactly bound/u,
  );

  production.id = DEPLOYMENT;
  productionAliasDeploymentId = production.id;
  await assert.rejects(
    inspectUnexposedStagedDeployment({
      targetUrl: "https://launcher-abc.vercel.app/",
      deploymentId: DEPLOYMENT,
      productCommit: candidateCommit,
      projectId,
      token: "v".repeat(32),
      teamId: "team_123",
      fetchDeployment,
      resolveAlias,
    }),
    /exposed, aliased or not exactly bound/u,
  );
});
