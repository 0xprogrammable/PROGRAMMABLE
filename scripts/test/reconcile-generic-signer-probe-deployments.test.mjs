import assert from "node:assert/strict";
import test from "node:test";

import { reconcileGenericSignerProbeDeploymentsV1 } from
  "../reconcile-generic-signer-probe-deployments.mjs";

const authority = Object.freeze({
  token: "v".repeat(32),
  teamId: "team_0123456789abcdefghijklmnop",
  projectId: "prj_0123456789abcdefghijklmnop",
  recoveryId:
    "01010101010101010101010101010101.31791628073.1.0202020202020202020202020202020202020202",
  websiteHead: "02".repeat(20),
});

test("deletes every exact metadata match and proves provider, public and list absence", async () => {
  const candidates = [candidate("dpl_0123456789abcdefghijklmnop", "one"),
    candidate("dpl_abcdefghijklmnopqrstuvwxyz1234", "two")];
  let listCalls = 0;
  const providerGets = new Map();
  const publicGets = new Map();
  const deleted = [];
  const result = await reconcileGenericSignerProbeDeploymentsV1({
    ...authority,
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      const target = new URL(url);
      if (target.hostname === "api.vercel.com"
        && target.pathname === "/v6/deployments") {
        assert.equal(target.searchParams.get("projectId"), authority.projectId);
        assert.equal(target.searchParams.get("target"), "production");
        assert.equal(target.searchParams.get("meta-programmableGenericSignerProbe"),
          "one-shot-v1");
        assert.equal(target.searchParams.get("meta-programmableRepositoryId"),
          "1314365508");
        assert.equal(
          target.searchParams.get("meta-programmableGenericSignerProbeRecoveryId"),
          authority.recoveryId,
        );
        assert.equal(target.searchParams.get("meta-githubCommitSha"),
          authority.websiteHead);
        assert.equal(init.headers.authorization, `Bearer ${authority.token}`);
        listCalls += 1;
        return Response.json({
          deployments: listCalls === 1 ? candidates : [],
          pagination: { next: null },
        });
      }
      const deploymentId = target.pathname.split("/").at(-1);
      if (target.hostname === "api.vercel.com" && init.method === "DELETE") {
        deleted.push(deploymentId);
        return new Response(null, { status: deleted.length === 1 ? 200 : 204 });
      }
      if (target.hostname === "api.vercel.com" && init.method === "GET") {
        const count = (providerGets.get(deploymentId) ?? 0) + 1;
        providerGets.set(deploymentId, count);
        return new Response(null, { status: count === 1 ? 200 : 404 });
      }
      const count = (publicGets.get(target.hostname) ?? 0) + 1;
      publicGets.set(target.hostname, count);
      return new Response(null, { status: count === 1 ? 200 : 410 });
    },
  });
  assert.deepEqual(deleted.sort(), candidates.map(({ id }) => id).sort());
  assert.equal(result.providerListAbsent, true);
  assert.equal(result.deletion.length, 2);
  assert.deepEqual(result.deletion.map((value) => value.publicOriginStatus), [410, 410]);
});

test("returns a clean zero-match reconciliation without a mutation", async () => {
  let requests = 0;
  const result = await reconcileGenericSignerProbeDeploymentsV1({
    ...authority,
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      requests += 1;
      assert.equal(new URL(url).pathname, "/v6/deployments");
      assert.equal(init.method, "GET");
      return Response.json({ deployments: [], pagination: { next: null } });
    },
  });
  assert.equal(requests, 3);
  assert.deepEqual(result.matchedDeployments, []);
  assert.deepEqual(result.deletion, []);
});

test("independently clears orphan probes from every prior recovery identity", async () => {
  const old = candidate("dpl_0123456789abcdefghijklmnop", "old");
  old.meta.programmableGenericSignerProbeRecoveryId =
    "03030303030303030303030303030303.100.1.0404040404040404040404040404040404040404";
  old.meta.githubCommitSha = "04".repeat(20);
  let listCalls = 0;
  let deleted = false;
  const result = await reconcileGenericSignerProbeDeploymentsV1({
    token: authority.token,
    teamId: authority.teamId,
    projectId: authority.projectId,
    allProjectProbes: true,
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      const target = new URL(url);
      if (target.pathname === "/v6/deployments") {
        assert.equal(target.searchParams.has(
          "meta-programmableGenericSignerProbeRecoveryId"), false);
        assert.equal(target.searchParams.has("meta-githubCommitSha"), false);
        listCalls += 1;
        return Response.json({
          deployments: listCalls === 1 ? [old] : [],
          pagination: { next: null },
        });
      }
      if (init.method === "DELETE") {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      return new Response(null, {
        status: target.hostname === "api.vercel.com" ? 404 : 410,
      });
    },
  });
  assert.equal(deleted, true);
  assert.equal(result.scope, "all-project-probes");
  assert.equal(result.recoveryId, null);
  assert.equal(result.websiteHead, null);
});

test("deletes a deployment that appears after the first empty recovery list", async () => {
  const delayed = candidate("dpl_0123456789abcdefghijklmnop", "delayed");
  let listCalls = 0;
  let deleteCalls = 0;
  const result = await reconcileGenericSignerProbeDeploymentsV1({
    ...authority,
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      const target = new URL(url);
      if (target.pathname === "/v6/deployments") {
        listCalls += 1;
        return Response.json({
          deployments: listCalls === 2 ? [delayed] : [],
          pagination: { next: null },
        });
      }
      if (init.method === "DELETE") {
        deleteCalls += 1;
        return new Response(null, { status: 204 });
      }
      return new Response(null, {
        status: target.hostname === "api.vercel.com" ? 404 : 410,
      });
    },
  });
  assert.equal(deleteCalls, 1);
  assert.equal(result.matchedDeployments[0].id, delayed.id);
  assert.ok(listCalls >= 5);
});

test("fails closed when an exact metadata match remains after bounded reconciliation", async () => {
  const value = candidate("dpl_0123456789abcdefghijklmnop", "one");
  await assert.rejects(reconcileGenericSignerProbeDeploymentsV1({
    ...authority,
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      const target = new URL(url);
      if (target.pathname === "/v6/deployments") {
        return Response.json({ deployments: [value], pagination: { next: null } });
      }
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (target.hostname === "api.vercel.com") {
        return new Response(null, { status: 404 });
      }
      return new Response(null, { status: 410 });
    },
  }), /did not become empty/u);
});

function candidate(id, prefix) {
  return {
    id,
    url: `${prefix}-probe.vercel.app`,
    target: "production",
    meta: {
      programmableGenericSignerProbe: "one-shot-v1",
      programmableRepositoryId: "1314365508",
      programmableGenericSignerProbeRecoveryId: authority.recoveryId,
      githubCommitSha: authority.websiteHead,
    },
  };
}
