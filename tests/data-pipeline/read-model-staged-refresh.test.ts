import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as operationsSourceContracts from "../../scripts/perf/read-model-ops-source-contracts.mjs";
const {
  evaluateReadModelOperationsSourceContracts,
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
  phase: string,
  overrides: Record<string, unknown> = {},
) {
  const match = /^classic-(primary|secondary)-([0-9]{2})$/u.exec(phase);
  if (!match) throw new Error(`invalid prewarm fixture phase: ${phase}`);
  const step = Number(match[2]);
  const coverageStartBlock = 25_624_131n;
  const confirmedBlockNumber = BigInt(BLOCK_NUMBER);
  const coverage = confirmedBlockNumber - coverageStartBlock + 1n;
  const prefixLength = (coverage * BigInt(step) + 31n) / 32n;
  return {
    ok: true,
    phase,
    provider: match[1],
    step,
    stepCount: 32,
    coverageStartBlock: coverageStartBlock.toString(),
    blockNumber: (coverageStartBlock + prefixLength - 1n).toString(),
    confirmedBlockNumber: BLOCK_NUMBER,
    blockHash: BLOCK_HASH,
    ...overrides,
  };
}

function stagedFetch(
  input: {
    deployment?: Record<string, unknown>;
    refreshBody?: Record<string, unknown>;
    refreshStatus?: number;
    prewarmBody?: (
      phase: string,
      body: Record<string, unknown>,
    ) => Record<string, unknown>;
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
      if (/^classic-(?:primary|secondary)-[0-9]{2}$/u.test(phase ?? "")) {
        const body = prewarmFixture(phase as string);
        return Response.json(
          input.prewarmBody?.(phase as string, body) ?? body,
          {
          status: 200,
          headers: { "cache-control": "no-store" },
          },
        );
      }
      return Response.json(input.refreshBody ?? refreshFixture(), {
        status: input.refreshStatus ?? 200,
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
    requestAttempts: 1,
    requestRetryDelayMs: 0,
    prewarmPhaseDelayMs: 0,
    sleepImpl: vi.fn(async () => undefined),
    fetchImpl,
    ...overrides,
  };
}

describe("exact staged durable refresh runtime", () => {
  it("seeds a non-empty catalog only after exact deployment binding and all prewarm phases", async () => {
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
      tokenCount: 343,
      portfolioHistoryStatus: "recorded",
      portfolioHistoryPath: "portfolio-history/1/2026-08-13T05.json",
    });
    expect(requests[0]?.url.pathname).toBe(
      `/v13/deployments/${new URL(TARGET_URL).hostname}`,
    );
    expect(requests.slice(1, 65).map(({ url }) =>
      url.searchParams.get("phase")
    )).toEqual([
      ...Array.from({ length: 32 }, (_, index) => [
        `classic-primary-${String(index + 1).padStart(2, "0")}`,
        `classic-secondary-${String(index + 1).padStart(2, "0")}`,
      ]).flat(),
    ]);
    const refreshRequest = requests[65]!;
    expect(refreshRequest.headers.get("authorization")).toBe(
      `Bearer ${CRON_SECRET}`,
    );
    expect(refreshRequest.headers.get("x-vercel-protection-bypass")).toBe(
      AUTOMATION_BYPASS_SECRET,
    );
    expect(requests).toHaveLength(66);
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

  it("fails closed on an invalid refresh response", async () => {
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
    expect(requests).toHaveLength(66);
  });

  it("fails before the final refresh on a non-exact prewarm prefix", async () => {
    const requests: Array<{ headers: Headers; url: URL }> = [];
    await expect(
      refreshExactStagedReadModel(
        stagedRefreshInput(
          stagedFetch({
            prewarmBody(phase, body) {
              return phase === "classic-primary-05"
                ? {
                    ...body,
                    blockNumber: (BigInt(String(body.blockNumber)) + 1n)
                      .toString(),
                  }
                : body;
            },
            requests,
          }),
        ),
      ),
    ).rejects.toThrow("exact staged classic-primary-05 prewarm failed");
    expect(
      requests.some(({ url }) =>
        url.pathname === "/api/ops/index-v2" &&
        !url.searchParams.has("phase")
      ),
    ).toBe(false);
  });

  it("fails closed when refresh returns an empty catalog", async () => {
    await expect(
      refreshExactStagedReadModel(
        stagedRefreshInput(
          stagedFetch({
            refreshBody: refreshFixture({
              tokenCount: 0,
              portfolioHistory: {
                status: "empty",
                blockNumber: BLOCK_NUMBER,
                tokenCount: 0,
                path: null,
              },
            }),
          }),
        ),
      ),
    ).rejects.toThrow("exact staged durable refresh failed");
  });

  it("serializes provider phases and backs off past a rolling 10-second 429 window", async () => {
    let transientFailures = 0;
    let activePrewarms = 0;
    let maximumActivePrewarms = 0;
    const sleepImpl = vi.fn(async () => undefined);
    const baseFetch = stagedFetch();
    const fetchImpl = async (request: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(request));
      if (/^classic-(?:primary|secondary)-[0-9]{2}$/u.test(
        url.searchParams.get("phase") ?? "",
      )) {
        activePrewarms += 1;
        maximumActivePrewarms = Math.max(
          maximumActivePrewarms,
          activePrewarms,
        );
        try {
          await new Promise((resolve) => setTimeout(resolve, 1));
          if (
            url.searchParams.get("phase") === "classic-primary-01" &&
            transientFailures < 2
          ) {
            transientFailures += 1;
            return Response.json({ ok: false }, {
              status: 503,
              headers: { "cache-control": "no-store" },
            });
          }
          return baseFetch(request, init);
        } finally {
          activePrewarms -= 1;
        }
      }
      return baseFetch(request, init);
    };
    await expect(
      refreshExactStagedReadModel(stagedRefreshInput(fetchImpl, {
        requestAttempts: 3,
        requestRetryDelayMs: 5_000,
        sleepImpl,
      })),
    ).resolves.toMatchObject({ ok: true, tokenCount: 343 });
    expect(transientFailures).toBe(2);
    expect(maximumActivePrewarms).toBe(1);
    expect(sleepImpl).toHaveBeenNthCalledWith(1, 5_000);
    expect(sleepImpl).toHaveBeenNthCalledWith(2, 10_000);
  });

  it("paces successful prewarm phases without overlapping providers", async () => {
    const sleepImpl = vi.fn(async (delayMs: number) => void delayMs);
    await expect(
      refreshExactStagedReadModel(stagedRefreshInput(stagedFetch(), {
        prewarmPhaseDelayMs: 1_000,
        sleepImpl,
      })),
    ).resolves.toMatchObject({ ok: true, tokenCount: 343 });
    expect(sleepImpl).toHaveBeenCalledTimes(63);
    expect(sleepImpl.mock.calls.every(([delay]) => delay === 1_000)).toBe(true);
  });

  it("stops after three bounded transient failures before secondary or final refresh", async () => {
    const requests: URL[] = [];
    const sleepImpl = vi.fn(async () => undefined);
    const baseFetch = stagedFetch();
    const fetchImpl = async (request: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(request));
      requests.push(url);
      if (url.searchParams.get("phase") === "classic-primary-01") {
        return Response.json({ ok: false }, {
          status: 503,
          headers: { "cache-control": "no-store" },
        });
      }
      return baseFetch(request, init);
    };
    await expect(
      refreshExactStagedReadModel(stagedRefreshInput(fetchImpl, {
        requestAttempts: 3,
        requestRetryDelayMs: 5_000,
        sleepImpl,
      })),
    ).rejects.toThrow("classic-primary-01 prewarm failed (503)");
    expect(
      requests.filter((url) =>
        url.searchParams.get("phase") === "classic-primary-01"
      ),
    ).toHaveLength(3);
    expect(
      requests.some((url) =>
        url.searchParams.get("phase") === "classic-secondary-01"
      ),
    ).toBe(false);
    expect(
      requests.some((url) =>
        url.pathname === "/api/ops/index-v2" &&
        !url.searchParams.has("phase")
      ),
    ).toBe(false);
    expect(sleepImpl.mock.calls).toEqual([[5_000], [10_000]]);
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

describe("staged Envio catalog probe source contract", () => {
  it.each([
    [
      "drops the exact Envio source",
      (step: string) =>
        step.replace('            body?.catalog?.source !== "envio-classic-v3" ||\n', ""),
    ],
    [
      "drops Classic catalog completeness",
      (step: string) =>
        step.replace('            body.catalog.completeness?.classic !== "current" ||\n', ""),
    ],
    [
      "allows stock families",
      (step: string) =>
        step.replace('            body.catalog.completeness?.stock !== "excluded" ||\n', ""),
    ],
    [
      "accepts an empty catalog",
      (step: string) =>
        step.replace("            !Number.isSafeInteger(body.total) || body.total < 1 ||\n", ""),
    ],
  ])("fails when the workflow %s", (_label, mutate) => {
    const path = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, path), "utf8");
    const stepStart = workflow.indexOf(
      "      - name: Probe exact staged Envio Classic V3 catalog",
    );
    const stepEnd = workflow.indexOf(
      "      - name: Prove clean candidate carries no Generic signer probe authority",
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
      "ops-staged-envio-catalog-gate",
    );
  });
});
