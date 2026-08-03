import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { evaluateReadModelOperationsSourceContracts } from "../../scripts/perf/read-model-ops-source-contracts.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { verifyPostPromotion } from "../../scripts/perf/read-model-post-promotion.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { resolveProductionBinding } from "../../scripts/perf/read-model-production-binding.mjs";

const ROOT = process.cwd();
const DEPLOYMENT_ID = "dpl_aaaaaaaaaaaaaaaaaaaaaaaa";
const GIT_HEAD = "b".repeat(40);
const PROJECT_ID = "prj_programmable_test";

const AUTHENTICATED_ROUTE = `
  import { timingSafeEqual } from "node:crypto";
  function matchesBearer(request, secret) {
    const authorization = request.headers.get("authorization");
    if (!secret || Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 1_024 || !authorization?.startsWith("Bearer ")) return false;
    const provided = Buffer.from(authorization.slice(7), "utf8");
    const expected = Buffer.from(secret, "utf8");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }
  function authorizationMode(request) {
    const requestedMode = request.headers.get("x-programmable-cutover-mode");
    if (requestedMode !== null) {
      return requestedMode === "raw-backfill-v1" &&
        process.env.PROGRAMMABLE_CUTOVER_BACKFILL_ACTIVE === "true" &&
        matchesBearer(request, process.env.PROGRAMMABLE_CUTOVER_OPERATOR_SECRET)
        ? "cutover" : null;
    }
    return matchesBearer(request, process.env.CRON_SECRET) ? "standard" : null;
  }
  export async function GET(request) {
    const mode = authorizationMode(request);
    if (mode === null) return { status: 401, headers: { "Cache-Control": "no-store" } };
    if (mode === "cutover") runCutover();
    try { return { status: 200, headers: { "Cache-Control": "no-store" } }; }
    catch { return { status: 503, headers: { "Cache-Control": "no-store" } }; }
  }
`;

const SAFE_SOURCE_ACTIVATION = `
  export function projectorRuntimeActivationState(env) {
    const value = env.PROGRAMMABLE_PROJECTOR_ACTIVE;
    if (value === "false" || value === undefined) return "disabled";
    if (value === "true") return "active";
    return invalidRuntimeConfig();
  }
  export async function runConfiguredProjectorCycle(env) {
    if (projectorRuntimeActivationState(env) === "disabled") return { status: "disabled" };
    const leaseController = createProjectorRuntimeLeaseController();
    const acquisition = await leaseController.tryAcquire();
    if (acquisition.status === "busy") return { status: "busy" };
  }
`;

const SAFE_MARKET_ACTIVATION = `
  export async function runConfiguredMarketProjectorCycle(env, store) {
    const value = env.PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE;
    if (value === "false" || value === undefined) return { status: "disabled" };
    if (value !== "true") throw invalidInput("config", "activation");
    const sourceCheckpointGeneration = "1";
    const lease = await store.tryAcquireLease();
    if (!lease) return { status: "busy" };
    try { return { sourceCheckpointGeneration }; }
    finally { await store.releaseLease(lease); }
  }
`;

const PROVIDER_EVIDENCE_MIGRATION = `
  create table programmable_private.projection_provider_execution_evidence();
  create table programmable_private.reward_snapshot_provider_evidence();
  create table programmable_private.projection_publication_provider_bindings();
  alter table programmable_private.projection_provider_execution_evidence force row level security;
`;

const MARKET_MIGRATION = `
  create table programmable_private.market_projector_cursor_history();
  create table programmable_private.market_snapshot_lineage_memberships();
  create table programmable_private.market_candle_lineage_memberships();
  create function programmable_private.try_acquire_market_projector_runtime_lease_v1();
  create function programmable_private.assert_market_projector_runtime_lease_v1();
  create function programmable_private.release_market_projector_runtime_lease_v1();
  select * from programmable_private.projector_checkpoint_current;
  if cursor_block_global_log_index <> 4294967295 then raise exception 'partial'; end if;
  if cursor_candidate_id <> 'empty-page' then raise exception 'partial'; end if;
  alter table programmable_private.market_projector_cursor_history force row level security;
`;

function integratedOverrides() {
  return {
    "app/api/ops/projector/route.ts": AUTHENTICATED_ROUTE,
    "lib/data-pipeline/projector-runtime-config.server.ts":
      SAFE_SOURCE_ACTIVATION,
    "supabase/migrations/20260731224000_projector_provider_evidence_binding.sql":
      PROVIDER_EVIDENCE_MIGRATION,
    "app/api/ops/market-projector/route.ts": AUTHENTICATED_ROUTE,
    "lib/data-pipeline/market-projector-runtime.server.ts":
      SAFE_MARKET_ACTIVATION,
    "supabase/migrations/20260731223000_market_projector_contract.sql":
      MARKET_MIGRATION,
  };
}

function fixtureDigests() {
  return Object.fromEntries(
    Object.entries(integratedOverrides()).map(([path, source]) => [
      path,
      createHash("sha256").update(source).digest("hex"),
    ]),
  );
}

describe("read-model operations source contract", () => {
  it("binds the per-minute schedulers, activation gates and release workflow", () => {
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: integratedOverrides(),
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects scheduler, authorization and activation drift", () => {
    const vercelPath = resolve(ROOT, "vercel.json");
    const drift = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        "app/api/ops/index/route.ts":
          'export { GET } from "../index-v2/route";',
        "vercel.json": readFileSync(vercelPath, "utf8")
          .replace('"* * * * *"', '"*/2 * * * *"')
          .replace(
            '"path": "/api/ops/market-projector"',
            '"path": "/api/ops/reconcile-preparity"',
          ),
        "app/api/ops/projector/route.ts": AUTHENTICATED_ROUTE.replace(
          "process.env.CRON_SECRET",
          "process.env.AUTOMATION_SECRET",
        ),
        "lib/data-pipeline/market-projector-runtime.server.ts":
          SAFE_MARKET_ACTIVATION.replace('value !== "true"', "false"),
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(drift.failures.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining([
        "ops-cron-exact-set",
        "ops-legacy-alias-closed",
        "ops-source-projector-schedule",
        "ops-source-projector-route-auth",
        "ops-market-projector-activation",
        "ops-reconciler-unscheduled",
      ]),
    );
  });

  it("binds the exact GitHub commit into the staged deployment runtime", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const unsafeWorkflow = readFileSync(
      resolve(ROOT, workflowPath),
      "utf8",
    ).replace('--env VERCEL_GIT_COMMIT_SHA="$GITHUB_SHA"', "");
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [workflowPath]: unsafeWorkflow,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-exact-release-dependency",
    );
  });

  it("fails closed when the protected staged wake bypass is not bound", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const unsafeWorkflow = readFileSync(resolve(ROOT, workflowPath), "utf8")
      .replace(
        "          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n",
        "",
      );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [workflowPath]: unsafeWorkflow,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-quicknode-stream-stage-gate",
    );
  });

  it("rejects a staged wake bypass secret relocated to another workflow step", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const secretLine =
      "          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const unsafeWorkflow = workflow
      .replace(secretLine, "")
      .replace(
        "      - name: Pull production configuration\n        env:\n",
        `      - name: Pull production configuration\n        env:\n${secretLine}`,
      );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [workflowPath]: unsafeWorkflow,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-quicknode-stream-stage-gate",
    );
  });

  it("fails closed when the protected legacy staged smoke bypass is missing", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const legacyStep =
      "      - name: Smoke legacy staged public APIs\n" +
      "        if: steps.read-model-policy.outputs.evidence_required == 'false'\n" +
      "        env:\n" +
      "          STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}\n" +
      "          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n";
    const unsafeWorkflow = readFileSync(resolve(ROOT, workflowPath), "utf8").replace(
      legacyStep,
      legacyStep.replace(
        "          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n",
        "",
      ),
    );
    expect(unsafeWorkflow).not.toBe(
      readFileSync(resolve(ROOT, workflowPath), "utf8"),
    );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [workflowPath]: unsafeWorkflow,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-legacy-stage-smoke",
    );
  });

  it("rejects a legacy staged smoke bypass relocated to another workflow step", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const secretLine =
      "          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const legacyStepStart = workflow.indexOf(
      "      - name: Smoke legacy staged public APIs",
    );
    const legacyStepEnd = workflow.indexOf(
      "      - name: Record legacy-only read path",
    );
    expect(legacyStepStart).toBeGreaterThanOrEqual(0);
    expect(legacyStepEnd).toBeGreaterThan(legacyStepStart);
    const legacyStep = workflow.slice(legacyStepStart, legacyStepEnd);
    expect(legacyStep).toContain(secretLine);
    const unsafeLegacyStep = legacyStep.replace(secretLine, "");
    const unsafeWorkflow =
      workflow.slice(0, legacyStepStart) +
      unsafeLegacyStep +
      workflow.slice(legacyStepEnd).replace(
        "      - name: Record legacy-only read path\n",
        `      - name: Record legacy-only read path\n        env:\n${secretLine}`,
      );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [workflowPath]: unsafeWorkflow,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-legacy-stage-smoke",
    );
  });

  it("fails closed when the protected indexed staged capture bypass is missing", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const captureStepStart = workflow.indexOf(
      "      - name: Capture staged read-model evidence",
    );
    const captureStepEnd = workflow.indexOf(
      "      - name: Preserve staged read-model evidence",
    );
    expect(captureStepStart).toBeGreaterThanOrEqual(0);
    expect(captureStepEnd).toBeGreaterThan(captureStepStart);
    const captureStep = workflow.slice(captureStepStart, captureStepEnd);
    const secretLine =
      "          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n";
    expect(captureStep).toContain(secretLine);
    const unsafeWorkflow =
      workflow.slice(0, captureStepStart) +
      captureStep.replace(secretLine, "") +
      workflow.slice(captureStepEnd);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [workflowPath]: unsafeWorkflow,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-indexed-stage-capture",
    );
  });

  it("fails closed when the legacy staged smoke drops the bypass header", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const unsafeWorkflow = workflow.replace(
      '            "x-vercel-protection-bypass": automationBypassSecret,\n',
      "",
    );
    expect(unsafeWorkflow).not.toBe(workflow);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [workflowPath]: unsafeWorkflow,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-legacy-stage-smoke",
    );
  });

  it("rejects comment-only controls and jointly drifted manifests", () => {
    const operations = JSON.parse(
      readFileSync(resolve(ROOT, "config/read-model-operations.v1.json"), "utf8"),
    );
    operations.legacyIndexer.schedule = "0 0 * * *";
    operations.workers.forEach((worker: { schedule: string }) => {
      worker.schedule = "0 0 * * *";
    });
    const vercel = JSON.parse(
      readFileSync(resolve(ROOT, "vercel.json"), "utf8"),
    );
    vercel.crons.forEach((cron: { schedule: string }) => {
      cron.schedule = "0 0 * * *";
    });
    const commentsOnly = `
      // process.env.CRON_SECRET request.headers.get("authorization")
      // Buffer.byteLength(secret, "utf8") < 32; Buffer.byteLength(secret, "utf8") > 1_024
      // authorization.startsWith("Bearer "); provided.length === expected.length
      // timingSafeEqual(provided, expected); if (!isAuthorized(request)) {}
      // status: 401; status: 503; "Cache-Control": "no-store"
    `;
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        "config/read-model-operations.v1.json": JSON.stringify(operations),
        "vercel.json": JSON.stringify(vercel),
        "app/api/ops/projector/route.ts": commentsOnly,
      },
      expectedSha256Overrides: {
        ...fixtureDigests(),
        "app/api/ops/projector/route.ts": createHash("sha256")
          .update(commentsOnly)
          .digest("hex"),
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining([
        "ops-config-schema",
        "ops-cron-exact-set",
        "ops-legacy-cron-preserved",
        "ops-source-projector-schedule",
        "ops-source-projector-route-auth",
      ]),
    );
  });

  it("rejects wake canary, secret schema and staged-gate drift", () => {
    const canaryPath = resolve(
      ROOT,
      "scripts/perf/read-model-projector-wake-canary.mjs",
    );
    const workflowPath = resolve(ROOT, ".github/workflows/deploy-production.yml");
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        "scripts/perf/read-model-projector-wake-canary.mjs": `${readFileSync(
          canaryPath,
          "utf8",
        )}\n// unreviewed drift\n`,
        ".env.example": readFileSync(resolve(ROOT, ".env.example"), "utf8")
          .replace(
            "PROGRAMMABLE_QUICKNODE_STREAM_SECRET=",
            "NEXT_PUBLIC_PROGRAMMABLE_QUICKNODE_STREAM_SECRET=exposed",
          ),
        ".github/workflows/deploy-production.yml": readFileSync(
          workflowPath,
          "utf8",
        ).replace(
          "Gate exact staged QuickNode wake route",
          "Skipped staged QuickNode wake route",
        ),
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining([
        "ops-quicknode-stream-wake-binding",
        "ops-quicknode-stream-env-contract",
        "ops-quicknode-stream-stage-gate",
      ]),
    );
  });

  it("keeps auth-only probes separate from real-block SLA evidence", () => {
    const gatePath = "scripts/perf/read-model-real-block-sla-gate.mjs";
    const driftedGate = readFileSync(resolve(ROOT, gatePath), "utf8").replace(
      "REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS = 10_000",
      "REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS = 60_000",
    );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [gatePath]: driftedGate,
      },
      expectedSha256Overrides: {
        ...fixtureDigests(),
        [gatePath]: createHash("sha256").update(driftedGate).digest("hex"),
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-real-block-sla-gate-binding",
    );
  });

  it("binds the bounded exclusive real-block SLA operator before promotion", () => {
    const operatorPath = "scripts/perf/read-model-real-block-sla-operator.mjs";
    const runbookPath = "docs/data-pipeline/PRODUCTION-CUTOVER-OPERATOR.md";
    const unboundedOperator = readFileSync(resolve(ROOT, operatorPath), "utf8")
      .replace(
        "REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS = 5 * 60 * 1_000",
        "REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS = 10 * 60 * 1_000",
      );
    const bypassedRunbook = readFileSync(resolve(ROOT, runbookPath), "utf8")
      .replace(
        "npm run perf:read-model:real-block-sla-operator --",
        "npm run perf:read-model:real-block-sla-operator-skipped --",
      );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [operatorPath]: unboundedOperator,
        [runbookPath]: bypassedRunbook,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining([
        "ops-real-block-sla-operator-binding",
        "ops-post-promotion-binding",
      ]),
    );
  });

  it("keeps the staging workflow unable to bypass the manual real-block SLA gate", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const runbookPath = "docs/operations/read-model-scheduler-cutover.md";
    const unsafeWorkflow = `${readFileSync(resolve(ROOT, workflowPath), "utf8")}
      - name: Unsafe direct promotion
        run: vercel promote "$DEPLOYMENT_ID"
    `;
    const missingSlaGate = readFileSync(resolve(ROOT, runbookPath), "utf8").replace(
      "npm run perf:read-model:real-block-sla --",
      "npm run perf:read-model:real-block-sla-skipped --",
    );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [workflowPath]: unsafeWorkflow,
        [runbookPath]: missingSlaGate,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toEqual([
      "ops-post-promotion-binding",
    ]);
  });

  it("fails when only the scheduler runbook real-block SLA command is missing", () => {
    const runbookPath = "docs/operations/read-model-scheduler-cutover.md";
    const missingSlaGate = readFileSync(resolve(ROOT, runbookPath), "utf8").replace(
      "npm run perf:read-model:real-block-sla --",
      "npm run perf:read-model:real-block-sla-skipped --",
    );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [runbookPath]: missingSlaGate,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toEqual([
      "ops-post-promotion-binding",
    ]);
  });

  it("rejects an alternative promotion command in the canonical cutover runbook", () => {
    const runbookPath = "docs/data-pipeline/PRODUCTION-CUTOVER-OPERATOR.md";
    const bypass = readFileSync(resolve(ROOT, runbookPath), "utf8").replace(
      'vercel promote "$STAGED_DEPLOYMENT_ID" --yes --token="$VERCEL_TOKEN"',
      'npx vercel promote "$UNREVIEWED_DEPLOYMENT_ID" --yes --token="$VERCEL_TOKEN"',
    );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [runbookPath]: bypass,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-post-promotion-binding",
    );
  });
});

function publicFetch(healthStatus = "healthy") {
  return async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    if (url.hostname === "api.vercel.com") {
      return Response.json({
        id: DEPLOYMENT_ID,
        url: "programmable-tested.vercel.app",
        readyState: "READY",
        projectId: PROJECT_ID,
        meta: { githubCommitSha: GIT_HEAD },
      });
    }
    if (url.pathname === "/") {
      return new Response("<html>Programmable</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.pathname === "/api/ops/health") {
      return Response.json({ status: healthStatus }, {
        status: healthStatus === "healthy" ? 200 : 503,
      });
    }
    if (url.pathname === "/api/explore") {
      return Response.json({ status: "ready", tokens: [{}] });
    }
    if (url.pathname === "/api/indexers/v1/token-list") {
      return Response.json({ tokens: [{}] });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };
}

function postPromotionInput(fetchImpl = publicFetch()) {
  return {
    rootDirectory: ROOT,
    targetUrl: "https://programmable.family",
    expectedDeploymentId: DEPLOYMENT_ID,
    expectedGitHead: GIT_HEAD,
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: PROJECT_ID,
    fetchImpl,
  };
}

describe("post-promotion route verification", () => {
  it("accepts a healthy public production surface", async () => {
    const result = await verifyPostPromotion(postPromotionInput());
    expect(result.ok).toBe(true);
    expect(result.checks.map(({ id }: { id: string }) => id)).toEqual([
      "production-deployment-id",
      "production-deployment-project",
      "production-deployment-ready",
      "production-deployment-commit",
      "production-root",
      "production-health",
      "production-explore",
      "production-token-list",
    ]);
  });

  it("fails closed when production health is not healthy", async () => {
    const result = await verifyPostPromotion(
      postPromotionInput(publicFetch("unhealthy")),
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-health" }),
    );
  });

  it("rejects a target that is not an exact HTTPS origin", async () => {
    await expect(
      verifyPostPromotion({
        ...postPromotionInput(),
        targetUrl: "https://programmable.family/untrusted",
      }),
    ).rejects.toThrow("HTTPS origin");
  });

  it("fails if production does not resolve to the staged deployment", async () => {
    const result = await verifyPostPromotion({
      ...postPromotionInput(),
      expectedDeploymentId: "dpl_cccccccccccccccccccccccc",
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-deployment-id" }),
    );
  });

  it("rejects an empty Explore response", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/explore") {
        return Response.json({ status: "ready", tokens: [] });
      }
      return base(input);
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-explore" }),
    );
  });

  it("captures a rollback binding and detects prior auto-promotion", async () => {
    const binding = await resolveProductionBinding({
      targetUrl: "https://programmable.family",
      token: "vercel-test-token",
      teamId: "team_programmable_test",
      projectId: PROJECT_ID,
      fetchImpl: publicFetch(),
    });
    expect(binding).toEqual(
      expect.objectContaining({ deploymentId: DEPLOYMENT_ID, gitHead: GIT_HEAD }),
    );
    await expect(
      resolveProductionBinding({
        targetUrl: "https://programmable.family",
        rejectGitHead: GIT_HEAD,
        token: "vercel-test-token",
        teamId: "team_programmable_test",
        projectId: PROJECT_ID,
        fetchImpl: publicFetch(),
      }),
    ).rejects.toThrow("automatic production-domain assignment");
  });
});
