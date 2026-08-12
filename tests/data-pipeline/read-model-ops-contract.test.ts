import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { encodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
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
const GOLDEN_TOKEN_ADDRESS =
  "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce";
const GOLDEN_POOL_ID =
  "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229";
const PUBLIC_TOKEN_ADDRESS =
  "0x1111111111111111111111111111111111111111";
const PUBLIC_POOL_ID = `0x${"44".repeat(32)}`;
const TEST_STATE_VIEW = "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227";
const TEST_ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const TEST_PARITY_BLOCK = 25_731_000n;
const TEST_TOTAL_SUPPLY_RAW = 1_000n * 10n ** 18n;
const TEST_PRICE_USD_WAD = 2_000n * 10n ** 18n;
const TEST_FDV_USD_WAD = 2_000_000n * 10n ** 18n;
const testStateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
const testErc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const testFeedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
]);

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

  it("binds the private manual Router finality cron independently", () => {
    const routePath = "app/api/ops/manual-router-finality/route.ts";
    const runtimePath =
      "lib/server/custom-launch/manual-router-finality-worker-v1.ts";
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        "vercel.json": readFileSync(resolve(ROOT, "vercel.json"), "utf8")
          .replace(
            '"/api/ops/manual-router-finality"',
            '"/api/ops/manual-router-finality-drift"',
          ),
        [routePath]: readFileSync(resolve(ROOT, routePath), "utf8").replace(
          "isManualRouterFinalityCronAuthorizedV1(request)",
          "true",
        ),
        [runtimePath]: readFileSync(resolve(ROOT, runtimePath), "utf8").replace(
          'env.PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED !== "true"',
          'env.PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED === "true"',
        ),
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining([
        "ops-cron-exact-set",
        "ops-manual-router-finality-schedule",
        "ops-manual-router-finality-source-digests",
        "ops-manual-router-finality-route-auth",
        "ops-manual-router-finality-activation",
      ]),
    );
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
    const secretLine =
      "          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n";
    const quickNodeStep =
      "      - name: Gate exact staged QuickNode wake route\n" +
      "        if: needs.release-gate.outputs.verified_read_model == 'true' && steps.read-model-policy.outputs.wake_canary_required == 'true'\n" +
      "        env:\n" +
      "          PROGRAMMABLE_QUICKNODE_STREAM_SECRET: ${{ secrets.PROGRAMMABLE_QUICKNODE_STREAM_SECRET }}\n" +
      secretLine;
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const unsafeWorkflow = workflow.replace(
      quickNodeStep,
      quickNodeStep.replace(secretLine, ""),
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
      "ops-quicknode-stream-stage-gate",
    );
  });

  it("rejects a staged wake bypass secret relocated to another workflow step", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const secretLine =
      "          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const quickNodeStepStart = workflow.indexOf(
      "      - name: Gate exact staged QuickNode wake route",
    );
    const quickNodeStepEnd = workflow.indexOf(
      "      - name: Attest exact staged release policy",
    );
    expect(quickNodeStepStart).toBeGreaterThanOrEqual(0);
    expect(quickNodeStepEnd).toBeGreaterThan(quickNodeStepStart);
    const quickNodeStep = workflow.slice(quickNodeStepStart, quickNodeStepEnd);
    expect(quickNodeStep).toContain(secretLine);
    const unsafeQuickNodeStep = quickNodeStep.replace(secretLine, "");
    const withoutQuickNodeSecret =
      workflow.slice(0, quickNodeStepStart) +
      unsafeQuickNodeStep +
      workflow.slice(quickNodeStepEnd);
    const unsafeWorkflow = withoutQuickNodeSecret.replace(
      "      - name: Pull production configuration\n        env:\n",
      `      - name: Pull production configuration\n        env:\n${secretLine}`,
    );
    expect(unsafeWorkflow).not.toBe(withoutQuickNodeSecret);
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

  it("fails closed when the protected Bitquery staged smoke bypass is missing", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const bitqueryStep =
      "      - name: Smoke staged Bitquery market APIs\n" +
      "        if: needs.release-gate.outputs.verified_read_model == 'true'\n" +
      "        env:\n" +
      "          STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}\n" +
      "          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n";
    const unsafeWorkflow = readFileSync(
      resolve(ROOT, workflowPath),
      "utf8",
    ).replace(
      bitqueryStep,
      bitqueryStep.replace(
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
      "ops-protected-bitquery-stage-smoke",
    );
  });

  it("fails closed when the Bitquery staged smoke stops proving current FDV order", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const unsafeWorkflow = workflow.replace(
      '"staged Bitquery Highest FDV is not monotonically descending"',
      '"staged Bitquery order was not checked"',
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
      "ops-protected-bitquery-stage-smoke",
    );
  });

  it("fails closed when staged release permits zero current public FDVs", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const unsafeWorkflow = workflow.replace(
      "          if (currentFdvCount < 1) {",
      "          if (currentFdvCount < 0) {",
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
      "ops-protected-bitquery-stage-smoke",
    );
  });

  it.each([
    ["positive liquidity", "!positiveInteger(primary.liquidity?.valueUsdWad)"],
    ["liquidity block", "!positiveInteger(primary.liquidity?.asOfBlock)"],
    ["Uniswap v4 protocol", 'primary.identity?.protocol !== "uniswap_v4"'],
    [
      "canonical primary pool identity",
      "primary.identity?.poolId !== token.marketData.primaryPoolId",
    ],
  ])("fails closed when staged release drops %s binding", (_label, needle) => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const unsafeWorkflow = workflow.replace(needle, "false");
    expect(unsafeWorkflow).not.toBe(workflow);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [workflowPath]: unsafeWorkflow,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-bitquery-stage-smoke",
    );
  });

  it("fails closed when post-promotion permits zero current public FDVs", () => {
    const postPromotionPath =
      "scripts/perf/read-model-post-promotion.mjs";
    const postPromotion = readFileSync(
      resolve(ROOT, postPromotionPath),
      "utf8",
    );
    const unsafePostPromotion = postPromotion.replace(
      "  return currentCount > 0 &&",
      "  return currentCount >= 0 &&",
    );
    expect(unsafePostPromotion).not.toBe(postPromotion);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [postPromotionPath]: unsafePostPromotion,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-post-promotion-binding",
    );
  });

  it.each([
    ["positive liquidity", "positiveInteger(liquidity.valueUsdWad)"],
    ["liquidity block", "positiveInteger(liquidity.asOfBlock)"],
    ["Uniswap v4 protocol", 'primary.identity.protocol === "uniswap_v4"'],
    [
      "canonical primary pool identity",
      "primary.identity.poolId === market.primaryPoolId",
    ],
    [
      "valuation equality",
      "poolValuation.valueUsdWad === valuation.valueWad",
    ],
  ])("fails closed when post-promotion drops %s binding", (_label, needle) => {
    const postPromotionPath =
      "scripts/perf/read-model-post-promotion.mjs";
    const postPromotion = readFileSync(
      resolve(ROOT, postPromotionPath),
      "utf8",
    );
    const unsafePostPromotion = postPromotion.replace(needle, "false");
    expect(unsafePostPromotion).not.toBe(postPromotion);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [postPromotionPath]: unsafePostPromotion,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-post-promotion-binding",
    );
  });

  it("fails closed when the historical PCAN gate widens the general stale ceiling", () => {
    const helperPath = "scripts/perf/bitquery-historical-release-gate.mjs";
    const helper = readFileSync(resolve(ROOT, helperPath), "utf8");
    const unsafeHelper = helper.replace(
      "const MAXIMUM_STALE_AGE_MS = 24 * 60 * 60_000",
      "const MAXIMUM_STALE_AGE_MS = 48 * 60 * 60_000",
    );
    expect(unsafeHelper).not.toBe(helper);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [helperPath]: unsafeHelper,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-bitquery-stage-smoke",
    );
  });

  it("fails closed when the historical PCAN deferral ceiling is widened", () => {
    const helperPath = "scripts/perf/bitquery-historical-release-gate.mjs";
    const helper = readFileSync(resolve(ROOT, helperPath), "utf8");
    const unsafeHelper = helper.replace(
      "const MAXIMUM_DEFERRED_PCAN_AGE_MS = 96 * 60 * 60_000",
      "const MAXIMUM_DEFERRED_PCAN_AGE_MS = 365 * 24 * 60 * 60_000",
    );
    expect(unsafeHelper).not.toBe(helper);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [helperPath]: unsafeHelper,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-bitquery-stage-smoke",
    );
  });

  it("fails closed when independent PCAN parity drops exact-block liquidity", () => {
    const parityPath = "scripts/perf/bitquery-golden-market-parity.mjs";
    const parity = readFileSync(resolve(ROOT, parityPath), "utf8");
    const unsafeParity = parity.replace(
      '  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",\n',
      "",
    );
    expect(unsafeParity).not.toBe(parity);
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [parityPath]: unsafeParity,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-bitquery-stage-smoke",
    );
  });

  it("fails closed when the staged PCAN canary becomes discoverable", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const unsafeWorkflow = workflow.replace(
      `            goldenSearch.tokens.some(
              (token) => token?.tokenAddress?.toLowerCase() === goldenTokenAddress,
            ) ||
            goldenSearch.total !== 0`,
      "            false",
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
      "ops-protected-bitquery-stage-smoke",
    );
  });

  it("rejects a Bitquery staged smoke bypass relocated to another workflow step", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const secretLine =
      "          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const bitqueryStepStart = workflow.indexOf(
      "      - name: Smoke staged Bitquery market APIs",
    );
    const bitqueryStepEnd = workflow.indexOf(
      "      - name: Record registry identity and Bitquery market path",
    );
    expect(bitqueryStepStart).toBeGreaterThanOrEqual(0);
    expect(bitqueryStepEnd).toBeGreaterThan(bitqueryStepStart);
    const bitqueryStep = workflow.slice(bitqueryStepStart, bitqueryStepEnd);
    expect(bitqueryStep).toContain(secretLine);
    const unsafeBitqueryStep = bitqueryStep.replace(secretLine, "");
    const unsafeWorkflow =
      workflow.slice(0, bitqueryStepStart) +
      unsafeBitqueryStep +
      workflow
        .slice(bitqueryStepEnd)
        .replace(
          "      - name: Record registry identity and Bitquery market path\n",
          `      - name: Record registry identity and Bitquery market path\n        env:\n${secretLine}`,
        );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        [workflowPath]: unsafeWorkflow,
      },
      expectedSha256Overrides: fixtureDigests(),
    });
    expect(result.failures.map(({ id }: { id: string }) => id)).toContain(
      "ops-protected-bitquery-stage-smoke",
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

  it("fails closed when the Bitquery staged smoke drops the bypass header", () => {
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
      "ops-protected-bitquery-stage-smoke",
    );
  });

  it("rejects comment-only controls and jointly drifted manifests", () => {
    const operations = JSON.parse(
      readFileSync(
        resolve(ROOT, "config/read-model-operations.v1.json"),
        "utf8",
      ),
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
    const workflowPath = resolve(
      ROOT,
      ".github/workflows/deploy-production.yml",
    );
    const result = evaluateReadModelOperationsSourceContracts(ROOT, {
      sourceOverrides: {
        ...integratedOverrides(),
        "scripts/perf/read-model-projector-wake-canary.mjs": `${readFileSync(
          canaryPath,
          "utf8",
        )}\n// unreviewed drift\n`,
        ".env.example": readFileSync(
          resolve(ROOT, ".env.example"),
          "utf8",
        ).replace(
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
    const unboundedOperator = readFileSync(
      resolve(ROOT, operatorPath),
      "utf8",
    ).replace(
      "REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS = 5 * 60 * 1_000",
      "REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS = 10 * 60 * 1_000",
    );
    const bypassedRunbook = readFileSync(
      resolve(ROOT, runbookPath),
      "utf8",
    ).replace(
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
    const missingSlaGate = readFileSync(
      resolve(ROOT, runbookPath),
      "utf8",
    ).replace(
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
    const missingSlaGate = readFileSync(
      resolve(ROOT, runbookPath),
      "utf8",
    ).replace(
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

function publicFetch(
  healthStatus = "healthy",
  goldenMarketAgeMs = 60 * 60_000,
) {
  const fixtureNow = Date.now();
  const goldenMarketAsOf = new Date(
    Math.floor((fixtureNow - goldenMarketAgeMs) / 1_000) * 1_000,
  ).toISOString();
  const publicMarketAsOf = new Date(
    Math.floor((fixtureNow - 2 * 60_000) / 1_000) * 1_000,
  ).toISOString();
  const earlierMarketTime = new Date(
    Date.parse(goldenMarketAsOf) - 60 * 60_000,
  ).toISOString();

  return async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const publicBitqueryHeaders = {
      "X-Programmable-Data-Quality": "complete",
      "X-Programmable-Market-As-Of": publicMarketAsOf,
      "X-Programmable-Market-Source": "bitquery",
      "X-Programmable-Price-Source": "bitquery",
      "X-Programmable-Read-Source": "operational+durable+postgres",
    };
    if (url.hostname === "rpc-a.invalid" || url.hostname === "rpc-b.invalid") {
      const request = JSON.parse(String(init?.body ?? "{}")) as {
        id: number;
        method: string;
        params: readonly unknown[];
      };
      let result: unknown;
      if (request.method === "eth_blockNumber") {
        result = `0x${(TEST_PARITY_BLOCK + 20n).toString(16)}`;
      } else if (request.method === "eth_getBlockByNumber") {
        result = {
          number: `0x${TEST_PARITY_BLOCK.toString(16)}`,
          hash: `0x${"11".repeat(32)}`,
          timestamp: `0x${BigInt(Math.floor(Date.parse(goldenMarketAsOf) / 1_000)).toString(16)}`,
        };
      } else if (request.method === "eth_call") {
        const call = request.params[0] as { to: string; data: string };
        const target = call.to.toLowerCase();
        if (target === TEST_STATE_VIEW.toLowerCase()) {
          const liquiditySelector = encodeFunctionData({
            abi: testStateViewAbi,
            functionName: "getLiquidity",
            args: [GOLDEN_POOL_ID],
          }).slice(0, 10);
          result = call.data.startsWith(liquiditySelector)
            ? encodeFunctionResult({
                abi: testStateViewAbi,
                functionName: "getLiquidity",
                result: 1_000_000n,
              })
            : encodeFunctionResult({
                abi: testStateViewAbi,
                functionName: "getSlot0",
                result: [2n ** 96n, 0, 0, 0],
              });
        } else if (
          target === GOLDEN_TOKEN_ADDRESS &&
          call.data.startsWith("0x313ce567")
        ) {
          result = encodeFunctionResult({
            abi: testErc20Abi,
            functionName: "decimals",
            result: 18,
          });
        } else if (
          target === GOLDEN_TOKEN_ADDRESS &&
          call.data.startsWith("0x18160ddd")
        ) {
          result = encodeFunctionResult({
            abi: testErc20Abi,
            functionName: "totalSupply",
            result: TEST_TOTAL_SUPPLY_RAW,
          });
        } else if (
          target === TEST_ETH_USD_FEED.toLowerCase() &&
          call.data.startsWith("0x313ce567")
        ) {
          result = encodeFunctionResult({
            abi: testFeedAbi,
            functionName: "decimals",
            result: 8,
          });
        } else {
          const timestamp = BigInt(
            Math.floor(Date.parse(goldenMarketAsOf) / 1_000),
          );
          result = encodeFunctionResult({
            abi: testFeedAbi,
            functionName: "latestRoundData",
            result: [1n, 200_000_000_000n, timestamp, timestamp, 1n],
          });
        }
      } else {
        throw new Error("unexpected parity RPC method");
      }
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    }
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
      return Response.json(
        { status: healthStatus },
        {
          status: healthStatus === "healthy" ? 200 : 503,
        },
      );
    }
    if (url.pathname === "/api/explore") {
      if (url.searchParams.get("q") === GOLDEN_TOKEN_ADDRESS) {
        return Response.json({
          status: "ready",
          tokens: [],
          total: 0,
          dataQuality: {
            status: "partial",
            valuation: { asOfTime: null },
          },
        }, {
          headers: {
            "X-Programmable-Data-Quality": "partial",
            "X-Programmable-Market-Source": "bitquery",
            "X-Programmable-Read-Source": "operational+durable+postgres",
          },
        });
      }
      return Response.json({
        status: "ready",
        tokens: [{
          tokenAddress: PUBLIC_TOKEN_ADDRESS,
          fdvUsdWad: TEST_FDV_USD_WAD.toString(),
          valuation: {
            status: "available",
            metric: "fdv",
            supplyBasis: "total",
            currency: "usd",
            source: "bitquery",
            freshness: "current",
            valueWad: TEST_FDV_USD_WAD.toString(),
            asOfTime: publicMarketAsOf,
          },
          marketData: {
            schemaVersion: "programmable.market-data.v1",
            source: "bitquery",
            generatedAt: new Date(fixtureNow).toISOString(),
            status: "current",
            primaryPoolId: PUBLIC_POOL_ID,
            pools: [{
              identity: {
                chainId: "1",
                tokenAddress: PUBLIC_TOKEN_ADDRESS,
                poolId: PUBLIC_POOL_ID,
                protocol: "uniswap_v4",
              },
              source: "bitquery",
              status: "current",
              quality: "complete",
              asOfTime: publicMarketAsOf,
              liquidity: {
                asOfTime: publicMarketAsOf,
                asOfBlock: TEST_PARITY_BLOCK.toString(),
                valueUsdWad: (50_000n * 10n ** 18n).toString(),
                freshness: "current",
              },
              valuation: {
                status: "available",
                metric: "fdv",
                supplyBasis: "total",
                valueUsdWad: TEST_FDV_USD_WAD.toString(),
                fdvUsdWad: TEST_FDV_USD_WAD.toString(),
                totalSupply: "1000",
                asOfTime: publicMarketAsOf,
                freshness: "current",
              },
            }],
          },
        }],
        dataQuality: {
          status: "complete",
          valuation: { asOfTime: publicMarketAsOf },
        },
      }, { headers: publicBitqueryHeaders });
    }
    if (url.pathname === "/api/explore/token") {
      return Response.json({
        status: "ready",
        token: {
          tokenAddress: GOLDEN_TOKEN_ADDRESS,
          totalSupplyRaw: TEST_TOTAL_SUPPLY_RAW.toString(),
          tokenDecimals: 18,
          valuation: {
            status: "available",
            metric: "fdv",
            supplyBasis: "total",
            currency: "usd",
            source: "bitquery",
            freshness: "stale",
            valueWad: TEST_FDV_USD_WAD.toString(),
            asOfTime: goldenMarketAsOf,
          },
          marketData: {
            schemaVersion: "programmable.market-data.v1",
            source: "bitquery",
            generatedAt: new Date().toISOString(),
            status: "stale",
            primaryPoolId: GOLDEN_POOL_ID,
            pools: [{
              identity: {
                chainId: "1",
                tokenAddress: GOLDEN_TOKEN_ADDRESS,
                poolId: GOLDEN_POOL_ID,
                protocol: "uniswap_v4",
              },
              source: "bitquery",
              status: "stale",
              quality: "partial",
              asOfTime: goldenMarketAsOf,
              latestTrade: {
                transactionHash: `0x${"22".repeat(32)}`,
                logIndex: 1,
                blockNumber: TEST_PARITY_BLOCK.toString(),
                time: goldenMarketAsOf,
                tokenSide: "buy",
                priceUsdWad: TEST_PRICE_USD_WAD.toString(),
                rawPriceUsdWad: TEST_PRICE_USD_WAD.toString(),
                priceUsdAsOfTime: goldenMarketAsOf,
                priceUsdSource: "bitquery-token-price-index-v1",
              },
              valuation: {
                status: "available",
                metric: "fdv",
                supplyBasis: "total",
                valueUsdWad: TEST_FDV_USD_WAD.toString(),
                fdvUsdWad: TEST_FDV_USD_WAD.toString(),
                totalSupply: "1000",
                asOfTime: goldenMarketAsOf,
                freshness: "stale",
              },
            }],
          },
        },
        dataQuality: {
          schemaVersion: "programmable.explore-data-quality.v1",
          status: "stale",
        },
      }, {
        headers: {
          "X-Programmable-Market-As-Of": goldenMarketAsOf,
          "X-Programmable-Data-Quality": "stale",
          "X-Programmable-Market-Source": "bitquery",
          "X-Programmable-Read-Source": "operational+durable+postgres",
        },
      });
    }
    if (url.pathname === "/api/explore/token/chart") {
      return Response.json({
        schemaVersion: "programmable.market-chart.v1",
        source: "bitquery",
        readStatus: "live",
        status: "ready",
        range: "all",
        generatedAt: new Date().toISOString(),
        address: GOLDEN_TOKEN_ADDRESS,
        identity: {
          chainId: "1",
          tokenAddress: GOLDEN_TOKEN_ADDRESS,
          poolId: GOLDEN_POOL_ID,
          protocol: "uniswap_v4",
        },
        points: [
          {
            blockNumber: "25730000",
            time: earlierMarketTime,
            priceUsd: "1900",
          },
          {
            blockNumber: "25731000",
            time: goldenMarketAsOf,
            priceUsd: "2000",
          },
        ],
        valuation: {
          status: "available",
          metric: "fdv",
          supplyBasis: "total",
          freshness: "stale",
          valueUsdWad: TEST_FDV_USD_WAD.toString(),
          fdvUsdWad: TEST_FDV_USD_WAD.toString(),
          asOfTime: goldenMarketAsOf,
        },
        asOfTime: goldenMarketAsOf,
      }, {
        headers: {
          "X-Programmable-Data-Quality": "ready",
          "X-Programmable-Market-As-Of": goldenMarketAsOf,
          "X-Programmable-Market-Source": "bitquery",
          "X-Programmable-Price-Source": "bitquery",
        },
      });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };
}

function postPromotionInput(fetchImpl = publicFetch()) {
  return {
    rootDirectory: ROOT,
    targetUrl: "https://programmable.market",
    expectedDeploymentId: DEPLOYMENT_ID,
    expectedGitHead: GIT_HEAD,
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: PROJECT_ID,
    fetchImpl,
    marketParityRpcUrls: ["https://rpc-a.invalid", "https://rpc-b.invalid"],
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
      "production-bitquery-canary-hidden",
      "production-bitquery-detail",
      "production-bitquery-chart",
      "production-bitquery-golden-independent-parity",
    ]);
  });

  it("rejects zero current public FDVs even when exact PCAN history passes", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (
        url.pathname !== "/api/explore" ||
        url.searchParams.has("q")
      ) return response;
      const body = await response.json();
      body.tokens[0].valuation.freshness = "stale";
      delete body.tokens[0].fdvUsdWad;
      return Response.json(body, { headers: response.headers });
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-explore" }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "production-bitquery-golden-independent-parity",
        status: "pass",
      }),
    );
  });

  it("rejects a current public FDV without positive primary-pool liquidity", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (
        url.pathname !== "/api/explore" ||
        url.searchParams.has("q")
      ) return response;
      const body = await response.json();
      body.tokens[0].marketData.pools[0].liquidity.valueUsdWad = "0";
      return Response.json(body, { headers: response.headers });
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-explore" }),
    );
  });

  it("rejects current liquidity from a different observation time", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (
        url.pathname !== "/api/explore" ||
        url.searchParams.has("q")
      ) return response;
      const body = await response.json();
      body.tokens[0].marketData.pools[0].liquidity.asOfTime = new Date(
        Date.parse(body.tokens[0].valuation.asOfTime) - 1_000,
      ).toISOString();
      return Response.json(body, { headers: response.headers });
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-explore" }),
    );
  });

  it("rejects PCAN as the only current public FDV", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (
        url.pathname !== "/api/explore" ||
        url.searchParams.has("q")
      ) return response;
      const body = await response.json();
      body.tokens[0].tokenAddress = GOLDEN_TOKEN_ADDRESS;
      body.tokens[0].marketData.pools[0].identity.tokenAddress =
        GOLDEN_TOKEN_ADDRESS;
      return Response.json(body, { headers: response.headers });
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-explore" }),
    );
  });

  it("accepts PCAN evidence older than 24 hours only after exact independent parity", async () => {
    const result = await verifyPostPromotion(
      postPromotionInput(publicFetch("healthy", 58 * 60 * 60_000)),
    );
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "production-bitquery-golden-independent-parity",
        status: "pass",
      }),
    );
  });

  it("rejects historical PCAN evidence when exact-block pool liquidity is zero", async () => {
    const base = publicFetch("healthy", 58 * 60 * 60_000);
    const liquiditySelector = encodeFunctionData({
      abi: testStateViewAbi,
      functionName: "getLiquidity",
      args: [GOLDEN_POOL_ID],
    }).slice(0, 10);
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname !== "rpc-a.invalid" && url.hostname !== "rpc-b.invalid") {
        return base(input, init);
      }
      const request = JSON.parse(String(init?.body ?? "{}")) as {
        id: number;
        method: string;
        params: readonly [{ data?: string }];
      };
      if (
        request.method === "eth_call" &&
        request.params[0]?.data?.startsWith(liquiditySelector)
      ) {
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: encodeFunctionResult({
            abi: testStateViewAbi,
            functionName: "getLiquidity",
            result: 0n,
          }),
        });
      }
      return base(input, init);
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        id: "production-bitquery-golden-independent-parity",
      }),
    );
  });

  it("rejects a publicly discoverable PCAN release canary", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      if (
        url.pathname !== "/api/explore" ||
        url.searchParams.get("q") !== GOLDEN_TOKEN_ADDRESS
      ) return base(input, init);
      return Response.json({
        status: "ready",
        tokens: [{ tokenAddress: GOLDEN_TOKEN_ADDRESS }],
        total: 1,
        dataQuality: { status: "partial", valuation: { asOfTime: null } },
      }, {
        headers: {
          "X-Programmable-Data-Quality": "partial",
          "X-Programmable-Market-Source": "bitquery",
          "X-Programmable-Read-Source": "operational+durable+postgres",
        },
      });
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-bitquery-canary-hidden" }),
    );
  });

  it("rejects an internally coherent Bitquery price with the wrong onchain scale", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (url.pathname !== "/api/explore/token") return response;
      const body = await response.json();
      const wrongPrice = 20n * 10n ** 18n;
      const wrongFdv = 20_000n * 10n ** 18n;
      body.token.marketData.pools[0].latestTrade.priceUsdWad = wrongPrice.toString();
      body.token.marketData.pools[0].latestTrade.rawPriceUsdWad = wrongPrice.toString();
      body.token.marketData.pools[0].valuation.valueUsdWad = wrongFdv.toString();
      body.token.marketData.pools[0].valuation.fdvUsdWad = wrongFdv.toString();
      body.token.valuation.valueWad = wrongFdv.toString();
      return Response.json(body, { headers: response.headers });
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        id: "production-bitquery-golden-independent-parity",
      }),
    );
  });

  it("rejects a detail response without its exact market freshness header", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (url.pathname !== "/api/explore/token") return response;
      const headers = new Headers(response.headers);
      headers.delete("X-Programmable-Market-As-Of");
      return Response.json(await response.json(), { headers });
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-bitquery-detail" }),
    );
  });

  it("rejects two market parity readers that disagree on the exact block", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (url.hostname !== "rpc-b.invalid") return response;
      const request = JSON.parse(String(init?.body ?? "{}")) as { method: string };
      if (request.method !== "eth_getBlockByNumber") return response;
      const body = await response.json();
      body.result.hash = `0x${"33".repeat(32)}`;
      return Response.json(body);
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        id: "production-bitquery-golden-independent-parity",
      }),
    );
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
        targetUrl: "https://programmable.market/untrusted",
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

  it("rejects missing public Bitquery provenance", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const response = await base(input);
      if (url.pathname !== "/api/explore/token/chart") return response;
      const body = await response.json();
      return Response.json(body, {
        headers: { "X-Programmable-Market-Source": "bitquery" },
      });
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-bitquery-chart" }),
    );
  });

  it("rejects a chart served from cache after the live Bitquery read failed", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (url.pathname !== "/api/explore/token/chart") return response;
      const body = await response.json();
      body.readStatus = "cache-fallback";
      return Response.json(body, { headers: response.headers });
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-bitquery-chart" }),
    );
  });

  it("rejects non-PCAN Explore valuation evidence older than the stale release ceiling", async () => {
    const base = publicFetch();
    const tooOld = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (url.pathname !== "/api/explore" || url.searchParams.has("q")) {
        return response;
      }
      const body = await response.json();
      body.tokens[0].valuation.asOfTime = tooOld;
      body.dataQuality.valuation.asOfTime = tooOld;
      const headers = new Headers(response.headers);
      headers.set("X-Programmable-Market-As-Of", tooOld);
      return Response.json(body, { headers });
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-explore" }),
    );
  });

  it("rejects an old FDV mislabeled as current", async () => {
    const base = publicFetch();
    const tooOld = new Date(Date.now() - 7 * 60_000).toISOString();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (url.pathname !== "/api/explore" || url.searchParams.has("q")) {
        return response;
      }
      const body = await response.json();
      body.tokens[0].valuation.freshness = "current";
      body.tokens[0].valuation.asOfTime = tooOld;
      body.tokens[0].fdvUsdWad = body.tokens[0].valuation.valueWad;
      body.tokens[0].marketData.pools[0].liquidity.asOfTime = tooOld;
      body.tokens[0].marketData.pools[0].valuation.asOfTime = tooOld;
      body.dataQuality.valuation.asOfTime = tooOld;
      const headers = new Headers(response.headers);
      headers.set("X-Programmable-Market-As-Of", tooOld);
      return Response.json(body, { headers });
    };
    const result = await verifyPostPromotion(postPromotionInput(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-explore" }),
    );
  });

  it("captures a rollback binding and detects prior auto-promotion", async () => {
    const binding = await resolveProductionBinding({
      targetUrl: "https://programmable.market",
      token: "vercel-test-token",
      teamId: "team_programmable_test",
      projectId: PROJECT_ID,
      fetchImpl: publicFetch(),
    });
    expect(binding).toEqual(
      expect.objectContaining({
        deploymentId: DEPLOYMENT_ID,
        gitHead: GIT_HEAD,
      }),
    );
    await expect(
      resolveProductionBinding({
        targetUrl: "https://programmable.market",
        rejectGitHead: GIT_HEAD,
        token: "vercel-test-token",
        teamId: "team_programmable_test",
        projectId: PROJECT_ID,
        fetchImpl: publicFetch(),
      }),
    ).rejects.toThrow("automatic production-domain assignment");
  });

  it("accepts Vercel built-in Git commit metadata for the rollback binding", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.hostname === "api.vercel.com") {
        return Response.json({
          id: DEPLOYMENT_ID,
          url: "programmable-tested.vercel.app",
          readyState: "READY",
          projectId: PROJECT_ID,
          meta: { gitCommitSha: GIT_HEAD },
        });
      }
      return base(input);
    };

    await expect(
      resolveProductionBinding({
        targetUrl: "https://programmable.market",
        token: "vercel-test-token",
        teamId: "team_programmable_test",
        projectId: PROJECT_ID,
        fetchImpl,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        deploymentId: DEPLOYMENT_ID,
        gitHead: GIT_HEAD,
      }),
    );
  });
});
