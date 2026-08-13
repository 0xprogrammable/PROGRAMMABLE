import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as operationsSourceContracts from "../../scripts/perf/read-model-ops-source-contracts.mjs";
const {
  evaluateReadModelOperationsSourceContracts,
  STAGED_DURABLE_REFRESH_SOURCE_GUARDS,
} = operationsSourceContracts;
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { refreshExactStagedReadModel } from "../../scripts/perf/read-model-staged-refresh.mjs";

const ROOT = process.cwd();
const TARGET_URL = "https://programmable-refresh-test.vercel.app/";
const DEPLOYMENT_ID = "dpl_aaaaaaaaaaaaaaaaaaaaaaaa";
const GIT_HEAD = "b".repeat(40);
const PROJECT_ID = "prj_programmable_test";
const TEAM_ID = "team_programmable_test";
const TOKEN = "vercel-test-token";
const CRON_SECRET = "x".repeat(40);
const AUTOMATION_BYPASS_SECRET = "y".repeat(40);
const BLOCK_NUMBER = "25740000";
const BLOCK_HASH = `0x${"11".repeat(32)}`;

function deploymentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: DEPLOYMENT_ID,
    url: new URL(TARGET_URL).hostname,
    readyState: "READY",
    projectId: PROJECT_ID,
    meta: { githubCommitSha: GIT_HEAD },
    ...overrides,
  };
}

function refreshFixture(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    blockNumber: BLOCK_NUMBER,
    tokenCount: 343,
    updated: true,
    portfolioHistory: {
      status: "recorded",
      blockNumber: BLOCK_NUMBER,
      tokenCount: 343,
      path: "portfolio-history/1/2026-08-13T05.json",
    },
    ...overrides,
  };
}

function prewarmFixture(
  phase: "classic-primary" | "classic-secondary",
  overrides: Record<string, unknown> = {},
) {
  return {
    ok: true,
    phase,
    provider: phase === "classic-primary" ? "primary" : "secondary",
    blockNumber: BLOCK_NUMBER,
    blockHash: BLOCK_HASH,
    ...overrides,
  };
}

function healthFixture(overrides: Record<string, unknown> = {}) {
  return {
    status: "healthy",
    chainId: 1,
    index: {
      ageSeconds: 2,
      blockNumber: BLOCK_NUMBER,
      tokenCount: 343,
    },
    indexSource: "durable",
    indexedReadModel: { status: "disabled" },
    rpc: {
      status: "healthy",
      chainId: 1,
      read: { status: "available" },
      quorum: { status: "verified" },
      confirmedBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH },
      freshness: { maxHeadAgeSeconds: 300 },
      providers: {
        primary: {
          status: "available",
          head: BLOCK_NUMBER,
          headAgeSeconds: 1,
        },
        secondary: {
          status: "available",
          head: BLOCK_NUMBER,
          headAgeSeconds: 1,
        },
      },
    },
    ...overrides,
  };
}

function stagedFetch(
  input: {
    deployment?: Record<string, unknown>;
    refreshBody?: Record<string, unknown>;
    refreshStatus?: number;
    healthBody?: Record<string, unknown>;
    healthStatus?: number;
    requests?: Array<{ headers: Headers; url: URL }>;
  } = {},
) {
  return async (request: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(request));
    input.requests?.push({ headers: new Headers(init?.headers), url });
    if (url.hostname === "api.vercel.com") {
      return Response.json(input.deployment ?? deploymentFixture());
    }
    if (
      url.origin === new URL(TARGET_URL).origin &&
      url.pathname === "/api/ops/index-v2"
    ) {
      const phase = url.searchParams.get("phase");
      if (phase === "classic-primary" || phase === "classic-secondary") {
        return Response.json(prewarmFixture(phase), {
          status: 200,
          headers: { "cache-control": "no-store" },
        });
      }
      return Response.json(input.refreshBody ?? refreshFixture(), {
        status: input.refreshStatus ?? 200,
        headers: { "cache-control": "no-store" },
      });
    }
    if (
      url.origin === new URL(TARGET_URL).origin &&
      url.pathname === "/api/ops/health"
    ) {
      return Response.json(input.healthBody ?? healthFixture(), {
        status: input.healthStatus ?? 200,
        headers: { "cache-control": "no-store" },
      });
    }
    throw new Error(`unexpected staged refresh request: ${url.toString()}`);
  };
}

function stagedRefreshInput(
  fetchImpl: ReturnType<typeof stagedFetch>,
  overrides: Record<string, unknown> = {},
) {
  return {
    targetUrl: TARGET_URL,
    expectedDeploymentId: DEPLOYMENT_ID,
    expectedGitHead: GIT_HEAD,
    token: TOKEN,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    cronSecret: CRON_SECRET,
    automationBypassSecret: AUTOMATION_BYPASS_SECRET,
    healthAttempts: 1,
    healthRetryDelayMs: 0,
    sleepImpl: vi.fn(async () => undefined),
    fetchImpl,
    ...overrides,
  };
}

describe("exact staged durable refresh runtime", () => {
  it("refreshes only after exact deployment binding and proves visible freshness", async () => {
    const requests: Array<{ headers: Headers; url: URL }> = [];
    const result = await refreshExactStagedReadModel(
      stagedRefreshInput(stagedFetch({ requests })),
    );

    expect(result).toMatchObject({
      ok: true,
      targetUrl: TARGET_URL,
      deploymentId: DEPLOYMENT_ID,
      gitHead: GIT_HEAD,
      refreshBlockNumber: BLOCK_NUMBER,
      visibleBlockNumber: BLOCK_NUMBER,
      confirmedBlockNumber: BLOCK_NUMBER,
      tokenCount: 343,
      ageSeconds: 2,
    });
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      `/v13/deployments/${new URL(TARGET_URL).hostname}`,
      "/api/ops/index-v2",
      "/api/ops/index-v2",
      "/api/ops/index-v2",
      "/api/ops/health",
    ]);
    expect(requests.slice(1, 3).map(({ url }) => url.searchParams.get("phase")))
      .toEqual(["classic-primary", "classic-secondary"]);
    const refreshRequest = requests[3]!;
    expect(refreshRequest.headers.get("authorization")).toBe(
      `Bearer ${CRON_SECRET}`,
    );
    expect(refreshRequest.headers.get("x-vercel-protection-bypass")).toBe(
      AUTOMATION_BYPASS_SECRET,
    );
    const healthRequest = requests[4]!;
    expect(healthRequest.headers.get("authorization")).toBeNull();
    expect(healthRequest.url.searchParams.get("stage_refresh_proof")).toBe(
      `${GIT_HEAD}-${DEPLOYMENT_ID}`,
    );
  });

  it.each([
    ["deployment id", { id: "dpl_cccccccccccccccccccccccc" }],
    ["deployment origin", { url: "another-candidate.vercel.app" }],
    ["project", { projectId: "prj_another_project" }],
    ["READY state", { readyState: "ERROR" }],
    ["Git commit", { meta: { githubCommitSha: "c".repeat(40) } }],
  ])(
    "fails before a protected write on mismatched %s",
    async (_label, mutation) => {
      const requests: Array<{ headers: Headers; url: URL }> = [];
      await expect(
        refreshExactStagedReadModel(
          stagedRefreshInput(
            stagedFetch({
              deployment: deploymentFixture(mutation),
              requests,
            }),
          ),
        ),
      ).rejects.toThrow("binding verification failed");
      expect(requests.map(({ url }) => url.hostname)).toEqual([
        "api.vercel.com",
      ]);
      expect(
        requests.some(
          ({ headers }) =>
            headers.has("authorization") &&
            headers.get("authorization") !== `Bearer ${TOKEN}`,
        ),
      ).toBe(false);
    },
  );

  it("fails closed on an invalid refresh response without reading health", async () => {
    const requests: Array<{ headers: Headers; url: URL }> = [];
    await expect(
      refreshExactStagedReadModel(
        stagedRefreshInput(
          stagedFetch({
            refreshBody: refreshFixture({
              portfolioHistory: {
                ...refreshFixture().portfolioHistory,
                blockNumber: "25739999",
              },
            }),
            requests,
          }),
        ),
      ),
    ).rejects.toThrow("exact staged durable refresh failed");
    expect(requests.map(({ url }) => url.pathname)).not.toContain(
      "/api/ops/health",
    );
  });

  it("fails closed when the refreshed index is not visibly fresh", async () => {
    const sleepImpl = vi.fn(async () => undefined);
    await expect(
      refreshExactStagedReadModel(
        stagedRefreshInput(
          stagedFetch({
            healthBody: healthFixture({
              index: {
                ageSeconds: 601,
                blockNumber: BLOCK_NUMBER,
                tokenCount: 343,
              },
            }),
          }),
          { healthAttempts: 3, sleepImpl },
        ),
      ),
    ).rejects.toThrow("exact staged durable freshness proof failed");
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a public origin and missing server-only credentials", async () => {
    await expect(
      refreshExactStagedReadModel(
        stagedRefreshInput(stagedFetch(), {
          targetUrl: "https://programmable.market/",
        }),
      ),
    ).rejects.toThrow("exact Vercel origin");
    await expect(
      refreshExactStagedReadModel(
        stagedRefreshInput(stagedFetch(), { cronSecret: "too-short" }),
      ),
    ).rejects.toThrow("refresh credentials are required");
  });
});

describe("exact staged durable refresh source contract", () => {
  it("rejects any unreviewed staged refresh verifier bytes", () => {
    const path = "scripts/perf/read-model-staged-refresh.mjs";
    const source = readFileSync(resolve(ROOT, path), "utf8");
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: `${source}\n// unreviewed drift\n` },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-staged-durable-refresh-gate",
    );
  });

  it.each(
    (STAGED_DURABLE_REFRESH_SOURCE_GUARDS as readonly string[]).map(
      (needle, index) => [index, needle] as const,
    ),
  )(
    "mutation %i removes required staged refresh guard %s",
    (_index, needle) => {
      const path = "scripts/perf/read-model-staged-refresh.mjs";
      const source = readFileSync(resolve(ROOT, path), "utf8");
      expect(source).toContain(needle);
      const result = evaluateReadModelOperationsSourceContracts(ROOT, {
        sourceOverrides: {
          [path]: source.split(needle).join("MUTATED_STAGED_REFRESH_GUARD"),
        },
      });
      expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
        "ops-staged-durable-refresh-gate",
      );
    },
  );

  it.each([
    [
      "drops the cron secret",
      (step: string) =>
        step.replace("          CRON_SECRET: ${{ secrets.CRON_SECRET }}\n", ""),
    ],
    [
      "drops exact Git binding",
      (step: string) =>
        step.replace("          EXPECTED_GIT_HEAD: ${{ github.sha }}\n", ""),
    ],
    [
      "masks failure",
      (step: string) =>
        step.replace(
          '          --git-head "$EXPECTED_GIT_HEAD"\n',
          '          --git-head "$EXPECTED_GIT_HEAD" || true\n',
        ),
    ],
  ])("fails when the workflow %s", (_label, mutate) => {
    const path = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, path), "utf8");
    const stepStart = workflow.indexOf(
      "      - name: Refresh and prove exact staged durable read model",
    );
    const stepEnd = workflow.indexOf(
      "      - name: Smoke staged public market APIs",
    );
    expect(stepStart).toBeGreaterThanOrEqual(0);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const unsafeStep = mutate(workflow.slice(stepStart, stepEnd));
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        [path]:
          workflow.slice(0, stepStart) + unsafeStep + workflow.slice(stepEnd),
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-staged-durable-refresh-gate",
    );
  });
});
