import assert from "node:assert/strict";
import test from "node:test";

import {
  createStagedWorkers,
  exactStagedTarget,
  inspectUnexposedStagedDeployment,
} from "./cutover-http.mjs";

const DEPLOYMENT = "dpl_12345678901234567890";
const SECRET = "s".repeat(32);

test("staged target accepts only a deployment-specific Vercel origin", () => {
  assert.equal(
    exactStagedTarget("https://launcher-abc.vercel.app/", DEPLOYMENT).hostname,
    "launcher-abc.vercel.app",
  );
  for (const target of [
    "https://programmable.family/",
    "http://launcher-abc.vercel.app/",
    "https://launcher-abc.vercel.app/path",
    "https://user:secret@launcher-abc.vercel.app/",
  ]) {
    assert.throws(() => exactStagedTarget(target, DEPLOYMENT), /exact Vercel/u);
  }
});

test("staged worker authorization stays in headers and responses must be no-store", async () => {
  const observed = [];
  const workers = createStagedWorkers({
    targetUrl: "https://launcher-abc.vercel.app/",
    deploymentId: DEPLOYMENT,
    cronSecret: SECRET,
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
  assert.equal(observed[0].url.includes(SECRET), false);
  assert.equal(observed[1].options.body.includes(SECRET), false);
});

test("staged worker rejects cacheable and failed responses", async () => {
  const cacheable = createStagedWorkers({
    targetUrl: "https://launcher-abc.vercel.app/",
    deploymentId: DEPLOYMENT,
    cronSecret: SECRET,
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  await assert.rejects(cacheable.runSourceProjector(), /unsafe response/u);

  const failed = createStagedWorkers({
    targetUrl: "https://launcher-abc.vercel.app/",
    deploymentId: DEPLOYMENT,
    cronSecret: SECRET,
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
    alias: ["programmable.family"],
    meta: { githubCommitSha: productionCommit },
  };
  const fetchDeployment = async ({ idOrUrl }) =>
    idOrUrl === DEPLOYMENT ? candidate : production;
  const result = await inspectUnexposedStagedDeployment({
    targetUrl: "https://launcher-abc.vercel.app/",
    deploymentId: DEPLOYMENT,
    productCommit: candidateCommit,
    projectId,
    token: "v".repeat(32),
    teamId: "team_123",
    fetchDeployment,
  });
  assert.equal(result.schedulerExposure, false);
  assert.equal(result.currentProduction.deploymentId, production.id);

  candidate.alias = ["programmable.family"];
  await assert.rejects(
    inspectUnexposedStagedDeployment({
      targetUrl: "https://launcher-abc.vercel.app/",
      deploymentId: DEPLOYMENT,
      productCommit: candidateCommit,
      projectId,
      token: "v".repeat(32),
      teamId: "team_123",
      fetchDeployment,
    }),
    /exposed, aliased or not exactly bound/u,
  );

  candidate.alias = [];
  production.id = DEPLOYMENT;
  await assert.rejects(
    inspectUnexposedStagedDeployment({
      targetUrl: "https://launcher-abc.vercel.app/",
      deploymentId: DEPLOYMENT,
      productCommit: candidateCommit,
      projectId,
      token: "v".repeat(32),
      teamId: "team_123",
      fetchDeployment,
    }),
    /exposed, aliased or not exactly bound/u,
  );
});
