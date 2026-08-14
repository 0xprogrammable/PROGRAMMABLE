import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as operationsSourceContracts from "../../scripts/perf/read-model-ops-source-contracts.mjs";
const {
  evaluateReadModelOperationsSourceContracts,
  STAGED_HEALTH_HANDOFF_SOURCE_GUARDS,
} = operationsSourceContracts;
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { verifyStagedHealth } from "../../scripts/perf/read-model-staged-health.mjs";

const ROOT = process.cwd();
const TARGET_URL = "https://programmable-candidate-test.vercel.app/";
const DEPLOYMENT_ID = "dpl_aaaaaaaaaaaaaaaaaaaaaaaa";
const GIT_HEAD = "b".repeat(40);
const PROJECT_ID = "prj_programmable_test";
const TEAM_ID = "team_programmable_test";
const TOKEN = "vercel-test-token";
const AUTOMATION_BYPASS_SECRET = "stage-bypass-secret-at-least-32-bytes";

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

function stagedFetch(
  input: {
    deployment?: Record<string, unknown>;
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
      url.pathname === "/api/ops/health" &&
      url.search === ""
    ) {
      return Response.json(input.healthBody ?? { status: "healthy" }, {
        status: input.healthStatus ?? 200,
      });
    }
    throw new Error(`unexpected staged health request: ${url.toString()}`);
  };
}

function stagedHealthInput(
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
    automationBypassSecret: AUTOMATION_BYPASS_SECRET,
    fetchImpl,
    ...overrides,
  };
}

describe("staged health handoff runtime", () => {
  it("accepts only the exact healthy staged deployment binding", async () => {
    const requests: Array<{ headers: Headers; url: URL }> = [];
    const result = await verifyStagedHealth(
      stagedHealthInput(stagedFetch({ requests })),
    );

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checks.map(({ id }: { id: string }) => id)).toEqual([
      "staged-health-deployment-id",
      "staged-health-deployment-url",
      "staged-health-deployment-project",
      "staged-health-deployment-ready",
      "staged-health-deployment-commit",
      "staged-health-response",
    ]);
    const healthRequest = requests.find(
      ({ url }) => url.hostname !== "api.vercel.com",
    );
    expect(healthRequest?.url.toString()).toBe(
      `${new URL(TARGET_URL).origin}/api/ops/health`,
    );
    expect(healthRequest?.headers.get("x-vercel-protection-bypass")).toBe(
      AUTOMATION_BYPASS_SECRET,
    );
    const vercelRequest = requests.find(
      ({ url }) => url.hostname === "api.vercel.com",
    );
    expect(vercelRequest?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(vercelRequest?.url.searchParams.get("teamId")).toBe(TEAM_ID);
    expect(requests.map(({ url }) => url.hostname)).toEqual([
      "api.vercel.com",
      new URL(TARGET_URL).hostname,
    ]);
  });

  it.each([
    [
      "deployment id",
      { id: "dpl_cccccccccccccccccccccccc" },
      "staged-health-deployment-id",
    ],
    [
      "deployment origin",
      { url: "another-candidate.vercel.app" },
      "staged-health-deployment-url",
    ],
    [
      "project",
      { projectId: "prj_another_project" },
      "staged-health-deployment-project",
    ],
    ["READY state", { readyState: "ERROR" }, "staged-health-deployment-ready"],
    [
      "Git commit",
      { meta: { githubCommitSha: "c".repeat(40) } },
      "staged-health-deployment-commit",
    ],
  ])("fails closed on a mismatched %s", async (_label, mutation, failureId) => {
    const requests: Array<{ headers: Headers; url: URL }> = [];
    const result = await verifyStagedHealth(
      stagedHealthInput(
        stagedFetch({ deployment: deploymentFixture(mutation), requests }),
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: failureId }),
    );
    expect(requests.map(({ url }) => url.hostname)).toEqual(["api.vercel.com"]);
    expect(
      requests.some(
        ({ headers }) =>
          headers.get("x-vercel-protection-bypass") ===
          AUTOMATION_BYPASS_SECRET,
      ),
    ).toBe(false);
  });

  it.each([
    ["unhealthy body", 200, { status: "degraded" }],
    ["failed HTTP response", 503, { status: "healthy" }],
  ])("fails closed on %s", async (_label, healthStatus, healthBody) => {
    const result = await verifyStagedHealth(
      stagedHealthInput(stagedFetch({ healthBody, healthStatus })),
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "staged-health-response" }),
    );
  });

  it("rejects a non-deployment origin and an unavailable bypass secret", async () => {
    await expect(
      verifyStagedHealth(
        stagedHealthInput(stagedFetch(), {
          targetUrl: "https://programmable.market/",
        }),
      ),
    ).rejects.toThrow("exact Vercel origin");
    await expect(
      verifyStagedHealth(
        stagedHealthInput(stagedFetch(), {
          automationBypassSecret: "too-short",
        }),
      ),
    ).rejects.toThrow("exact staged deployment and health credentials");
  });
});

describe.skip("retired staged health handoff source contract", () => {
  it("rejects any unreviewed staged health verifier bytes", () => {
    const path = "scripts/perf/read-model-staged-health.mjs";
    const source = readFileSync(resolve(ROOT, path), "utf8");
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: `${source}\n// unreviewed drift\n` },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-staged-health-handoff-gate",
    );
  });

  it.each(
    (STAGED_HEALTH_HANDOFF_SOURCE_GUARDS as readonly string[]).map(
      (needle, index) => [index, needle] as const,
    ),
  )("mutation %i removes required staged health guard %s", (_index, needle) => {
    const path = "scripts/perf/read-model-staged-health.mjs";
    const source = readFileSync(resolve(ROOT, path), "utf8");
    expect(source).toContain(needle);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        [path]: source.split(needle).join("MUTATED_STAGED_HEALTH_GUARD"),
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-staged-health-handoff-gate",
    );
  });

  it("fails when the workflow drops exact Git binding from the pre-handoff health gate", () => {
    const path = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, path), "utf8");
    const stepStart = workflow.indexOf(
      "      - name: Gate exact staged operational health",
    );
    const stepEnd = workflow.indexOf(
      "      - name: Record staged candidate handoff",
    );
    expect(stepStart).toBeGreaterThanOrEqual(0);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const step = workflow.slice(stepStart, stepEnd);
    const unsafeStep = step.replace(
      "          EXPECTED_GIT_HEAD: ${{ github.sha }}\n",
      "",
    );
    expect(unsafeStep).not.toBe(step);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        [path]:
          workflow.slice(0, stepStart) + unsafeStep + workflow.slice(stepEnd),
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-staged-health-handoff-gate",
    );
  });

  it("fails when the staged health gate leaves the exact read-model scope", () => {
    const path = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, path), "utf8");
    const conditional = workflow.replace(
      "      - name: Gate exact staged operational health\n        if: needs.release-gate.outputs.verified_read_model == 'true'\n        env:\n",
      "      - name: Gate exact staged operational health\n        if: false\n        env:\n",
    );
    expect(conditional).not.toBe(workflow);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: { [path]: conditional },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-staged-health-handoff-gate",
    );
  });

  it.each([
    [
      "continues on error",
      (workflow: string) =>
        workflow.replace(
          "      - name: Gate exact staged operational health\n        if: needs.release-gate.outputs.verified_read_model == 'true'\n        env:\n",
          "      - name: Gate exact staged operational health\n        if: needs.release-gate.outputs.verified_read_model == 'true'\n        continue-on-error: true\n        env:\n",
        ),
    ],
    [
      "masks the command with OR true",
      (workflow: string) =>
        workflow.replace(
          '          --git-head "$EXPECTED_GIT_HEAD"\n',
          '          --git-head "$EXPECTED_GIT_HEAD" || true\n',
        ),
    ],
    [
      "masks the command with a successful final command",
      (workflow: string) =>
        workflow.replace(
          '          --git-head "$EXPECTED_GIT_HEAD"\n',
          '          --git-head "$EXPECTED_GIT_HEAD"; true\n',
        ),
    ],
    [
      "changes an exact environment binding",
      (workflow: string) =>
        workflow.replace(
          "          STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}",
          "          STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.deployment_id }}",
        ),
    ],
    [
      "reorders the exact environment",
      (workflow: string) =>
        workflow.replace(
          [
            "          STAGED_DEPLOYMENT_ID: ${{ steps.staged-deployment.outputs.deployment_id }}",
            "          STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}",
          ].join("\n"),
          [
            "          STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}",
            "          STAGED_DEPLOYMENT_ID: ${{ steps.staged-deployment.outputs.deployment_id }}",
          ].join("\n"),
        ),
    ],
    [
      "reorders the exact arguments",
      (workflow: string) =>
        workflow.replace(
          [
            '          --target-url "$STAGED_TARGET_URL"',
            '          --deployment-id "$STAGED_DEPLOYMENT_ID"',
          ].join("\n"),
          [
            '          --deployment-id "$STAGED_DEPLOYMENT_ID"',
            '          --target-url "$STAGED_TARGET_URL"',
          ].join("\n"),
        ),
    ],
    [
      "changes an exact argument binding",
      (workflow: string) =>
        workflow.replace(
          '          --git-head "$EXPECTED_GIT_HEAD"',
          '          --git-head "$STAGED_DEPLOYMENT_ID"',
        ),
    ],
  ] as const)("fails when the workflow %s", (_label, mutate) => {
    const path = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, path), "utf8");
    const stepStart = workflow.indexOf(
      "      - name: Gate exact staged operational health",
    );
    const stepEnd = workflow.indexOf(
      "      - name: Record staged candidate handoff",
    );
    expect(stepStart).toBeGreaterThanOrEqual(0);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const step = workflow.slice(stepStart, stepEnd);
    const unsafeStep = mutate(step);
    expect(unsafeStep).not.toBe(step);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        [path]:
          workflow.slice(0, stepStart) + unsafeStep + workflow.slice(stepEnd),
      },
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-staged-health-handoff-gate",
    );
  });
});
