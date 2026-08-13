import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { encodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { evaluateReadModelOperationsSourceContracts, POST_PROMOTION_CURRENT_EVIDENCE_SOURCE_GUARDS, POST_PROMOTION_DETAIL_CHART_SOURCE_GUARDS, POST_PROMOTION_GLOBAL_RANKING_SOURCE_GUARDS, STAGED_MARKET_EVIDENCE_SOURCE_GUARDS } from "../../scripts/perf/read-model-ops-source-contracts.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { exactCurrentPublicFdvLiquidity, verifyCurrentPublicOnchainEvidenceV1, verifyPostPromotion } from "../../scripts/perf/read-model-post-promotion.mjs";
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
const GOLDEN_QUOTE_ADDRESS =
  "0x0000000000000000000000000000000000000000";
const PUBLIC_TOKEN_ADDRESS =
  "0x1111111111111111111111111111111111111111";
const PUBLIC_POOL_ID = `0x${"44".repeat(32)}`;
const PUBLIC_HOOK_ADDRESS = "0x2222222222222222222222222222222222222222";
const TEST_STATE_VIEW = "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227";
const TEST_STATE_VIEW_RUNTIME_CODE_HASH =
  "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878";
const TEST_STATE_VIEW_RUNTIME_CODE =
  "0x60806040526004361015610011575f80fd5b5f3560e01c80631c7ccb4c146108ac57806353e9c1fb146107c95780637c40"
  + "f1fe146106ab5780638a2bb9e61461064657806397fd7b421461060b5780639ec538c8146105a2578063c815641c1461050b"
  + "578063caedab54146103f6578063dacf1d2f146102ff578063dc4c90d314610291578063f0928f29146101e65763fa6793d5"
  + "1461009d575f80fd5b346101a25760207ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36"
  + "01126101a2576100d7600435610d2f565b600381018091116101b957604051907f1e2eaeaf00000000000000000000000000"
  + "0000000000000000000000000000008252600482015260208160248173ffffffffffffffffffffffffffffffffffffffff7f"
  + "000000000000000000000000000000000004444c5dc75cb358380d2e3de08a90165afa80156101ae575f90610177575b6020"
  + "906fffffffffffffffffffffffffffffffff60405191168152f35b506020813d6020116101a6575b8161019160209383610a"
  + "2b565b810103126101a2576020905161015a565b5f80fd5b3d9150610184565b6040513d5f823e3d90fd5b7f4e487b710000"
  + "00000000000000000000000000000000000000000000000000005f52601160045260245ffd5b346101a2576101fd6101f736"
  + "6109f7565b90610d8b565b604051907f1e2eaeaf000000000000000000000000000000000000000000000000000000008252"
  + "600482015260208160248173ffffffffffffffffffffffffffffffffffffffff7f0000000000000000000000000000000000"
  + "04444c5dc75cb358380d2e3de08a90165afa80156101ae575f90610177576020906fffffffffffffffffffffffffffffffff"
  + "60405191168152f35b346101a2575f7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601"
  + "126101a257602060405173ffffffffffffffffffffffffffffffffffffffff7f000000000000000000000000000000000004"
  + "444c5dc75cb358380d2e3de08a90168152f35b346101a25760a07fffffffffffffffffffffffffffffffffffffffffffffff"
  + "fffffffffffffffffc3601126101a25760243573ffffffffffffffffffffffffffffffffffffffff811681036101a2576103"
  + "566109e7565b6064358060020b81036101a2576103f2926103c2926040519260843560268501526006840152600383015281"
  + "525f603a600c83012091816040820152816020820152526004357f000000000000000000000000000000000004444c5dc75c"
  + "b358380d2e3de08a90610bc0565b604080516fffffffffffffffffffffffffffffffff909416845260208401929092529082"
  + "01529081906060820190565b0390f35b346101a25760407fffffffffffffffffffffffffffffffffffffffffffffffffffff"
  + "fffffffffffc3601126101a2576104386104306109d7565b600435610d55565b604051907f1e2eaeaf000000000000000000"
  + "000000000000000000000000000000000000008252600482015260208160248173ffffffffffffffffffffffffffffffffff"
  + "ffffff7f000000000000000000000000000000000004444c5dc75cb358380d2e3de08a90165afa80156101ae575f906104d8"
  + "575b6040908151906fffffffffffffffffffffffffffffffff8116825260801d600f0b6020820152f35b506020813d602011"
  + "610503575b816104f260209383610a2b565b810103126101a257604090516104b0565b3d91506104e5565b346101a2576020"
  + "7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126101a257608062ffffff8061056d"
  + "6004357f000000000000000000000000000000000004444c5dc75cb358380d2e3de08a90610c63565b92949173ffffffffff"
  + "ffffffffffffffffffffffffffffff6040519616865260020b6020860152166040840152166060820152f35b346101a25760"
  + "207ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126101a25760406105ff6004357f"
  + "000000000000000000000000000000000004444c5dc75cb358380d2e3de08a90610c58565b82519182526020820152f35b34"
  + "6101a2576103f26103c261061f366109f7565b907f000000000000000000000000000000000004444c5dc75cb358380d2e3d"
  + "e08a90610bc0565b346101a25760407ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601"
  + "126101a25760406105ff6106826109d7565b6004357f000000000000000000000000000000000004444c5dc75cb358380d2e"
  + "3de08a90610b1e565b346101a25760407ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36"
  + "01126101a2576106e56104306109d7565b604051907f35fd631a000000000000000000000000000000000000000000000000"
  + "0000000082526004820152600360248201525f8160448173ffffffffffffffffffffffffffffffffffffffff7f0000000000"
  + "00000000000000000000000004444c5dc75cb358380d2e3de08a90165afa80156101ae576080915f916107a7575b50602081"
  + "0151906060604082015191015190604051926fffffffffffffffffffffffffffffffff81168452841d600f0b602084015260"
  + "408301526060820152f35b6107c391503d805f833e6107bb8183610a2b565b810190610a99565b82610766565b346101a257"
  + "60607ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126101a2576040600435610805"
  + "6109d7565b9061080e6109e7565b7f000000000000000000000000000000000004444c5dc75cb358380d2e3de08a90906108"
  + "3a8383610c58565b90610846868686610b1e565b96909361085f610857828989610b1e565b989097610c63565b5050905060"
  + "020b9160020b82125f14610885575050505003910382519182526020820152f35b95969593949360020b1361089d57505003"
  + "91036105ff565b949392909403039203036105ff565b346101a25760407fffffffffffffffffffffffffffffffffffffffff"
  + "fffffffffffffffffffffffc3601126101a2576024358060010b8091036101a2576108f4600435610d2f565b600581018091"
  + "116101b957604051906020820192835260408201526040815261091e606082610a2b565b519020604051907f1e2eaeaf0000"
  + "00000000000000000000000000000000000000000000000000008252600482015260208160248173ffffffffffffffffffff"
  + "ffffffffffffffffffff7f000000000000000000000000000000000004444c5dc75cb358380d2e3de08a90165afa80156101"
  + "ae575f906109a4575b602090604051908152f35b506020813d6020116109cf575b816109be60209383610a2b565b81010312"
  + "6101a25760209051610999565b3d91506109b1565b602435908160020b82036101a257565b604435908160020b82036101a2"
  + "57565b7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc60409101126101a2576004359060"
  + "243590565b90601f7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0910116810190811067"
  + "ffffffffffffffff821117610a6c57604052565b7f4e487b7100000000000000000000000000000000000000000000000000"
  + "0000005f52604160045260245ffd5b6020818303126101a25780519067ffffffffffffffff82116101a257019080601f8301"
  + "12156101a25781519167ffffffffffffffff8311610a6c578260051b9060405193610aea6020840186610a2b565b84526020"
  + "808501928201019283116101a257602001905b828210610b0e5750505090565b8151815260209182019101610b01565b9291"
  + "610b2991610d55565b600181018091116101b95773ffffffffffffffffffffffffffffffffffffffff9260445f9260405195"
  + "869384927f35fd631a0000000000000000000000000000000000000000000000000000000084526004840152600260248401"
  + "52165afa9182156101ae575f92610ba4575b506040602083015192015190565b610bb99192503d805f833e6107bb8183610a"
  + "2b565b905f610b96565b6044610be273ffffffffffffffffffffffffffffffffffffffff945f94610d8b565b604051948593"
  + "84927f35fd631a00000000000000000000000000000000000000000000000000000000845260048401526003602484015216"
  + "5afa9081156101ae575f91610c3e575b506020810151916060604083015192015190565b610c5291503d805f833e6107bb81"
  + "83610a2b565b5f610c2a565b9190610b2990610d2f565b6020906024610c8773ffffffffffffffffffffffffffffffffffff"
  + "ffff9594610d2f565b60405195869384927f1e2eaeaf00000000000000000000000000000000000000000000000000000000"
  + "84526004840152165afa9182156101ae575f92610cfb575b5073ffffffffffffffffffffffffffffffffffffffff82169180"
  + "60a01c60020b9162ffffff808360b81c169260d01c1690565b9091506020813d602011610d27575b81610d1760209383610a"
  + "2b565b810103126101a25751905f610cc8565b3d9150610d0a565b604051602081019182526006604082015260408152610d"
  + "4f606082610a2b565b51902090565b610d5e90610d2f565b600481018091116101b95760405190602082019260020b835260"
  + "4082015260408152610d4f606082610a2b565b610d9490610d2f565b600681018091116101b9576040519060208201928352"
  + "604082015260408152610d4f606082610a2b56fea164736f6c634300081a000a";
const TEST_ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const TEST_NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";
const TEST_SUBGRAPH_ID =
  "DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G";
const TEST_SUBGRAPH_DEPLOYMENT =
  "QmZsgJLiLQKpb8hxTmQ5LWyrFVvfWzVaL4WK8dfFBn7EeK";
const TEST_PUBLIC_BLOCK_HASH = `0x${"55".repeat(32)}`;
const TEST_PUBLIC_INDEXED_BLOCK_HASH = `0x${"66".repeat(32)}`;
const TEST_PARITY_BLOCK = 25_731_000n;
const TEST_CURRENT_BLOCK = TEST_PARITY_BLOCK + 10n;
const TEST_TOTAL_SUPPLY_RAW = 1_000n * 10n ** 18n;
const TEST_PRICE_USD_WAD = 2_000n * 10n ** 18n;
const TEST_FDV_USD_WAD = 2_000_000n * 10n ** 18n;
const TEST_ACTIVE_LIQUIDITY = 3n * 10n ** 18n;
const TEST_ACTIVE_VIRTUAL_LIQUIDITY_USD_WAD = 12_000n * 10n ** 18n;
const stagedMarketEvidenceGuardCases: ReadonlyArray<readonly [number, string]> =
  (STAGED_MARKET_EVIDENCE_SOURCE_GUARDS as readonly string[]).map(
    (needle: string, index: number) => [index, needle] as const,
  );
const postPromotionGuardCases: ReadonlyArray<readonly [number, string]> = [
  ...(POST_PROMOTION_CURRENT_EVIDENCE_SOURCE_GUARDS as readonly string[]),
  ...(POST_PROMOTION_GLOBAL_RANKING_SOURCE_GUARDS as readonly string[]),
  ...(POST_PROMOTION_DETAIL_CHART_SOURCE_GUARDS as readonly string[]),
].map((needle: string, index: number) => [index, needle] as const);
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

  it("fails closed when the protected market staged smoke bypass is missing", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const bitqueryStep =
      "      - name: Smoke staged public market APIs\n" +
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

  it.each([
    [
      "first independent RPC secret",
      "          MAINNET_RPC_URL_A: ${{ secrets.MAINNET_RPC_URL_A }}\n",
    ],
    [
      "second independent RPC secret",
      "          MAINNET_RPC_URL_B: ${{ secrets.MAINNET_RPC_URL_B }}\n",
    ],
    [
      "Alchemy commitment",
      "          PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT: ${{ vars.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT }}\n",
    ],
    [
      "QuickNode commitment",
      "          PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT: ${{ vars.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT }}\n",
    ],
    [
      "provider binding",
      "            runtimeProductionProviderBindingsFromUrls({\n",
    ],
    [
      "commitment comparison",
      "            if (binding.endpointCommitment !== expectedCommitment) {\n",
    ],
    ["independent reader handoff", "                rpcUrls: independentRpcUrls,\n"],
  ])("fails closed when staged market proof drops the %s", (_label, needle) => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const stepStart = workflow.indexOf(
      "      - name: Smoke staged public market APIs",
    );
    const stepEnd = workflow.indexOf(
      "      - name: Record registry identity and combined market path",
    );
    expect(stepStart).toBeGreaterThanOrEqual(0);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const step = workflow.slice(stepStart, stepEnd);
    expect(step).toContain(needle);
    const unsafeStep = step.replace(needle, "");
    const unsafeWorkflow =
      workflow.slice(0, stepStart) +
      unsafeStep +
      workflow.slice(stepEnd);
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
    ["StateView price source", 'price?.source !== "uniswap-v4-stateview-chainlink-v1"'],
    ["official liquidity source", 'liquidity?.source !== "official-uniswap-v4-subgraph"'],
    ["official subgraph deployment", "provenance?.deployment !== officialV4SubgraphDeployment"],
    ["minimum liquidity", "BigInt(liquidity.tvlUsdWad) <"],
    ["exact reference head", "valuation.asOfBlock === provenance.referenceHeadBlockNumber"],
    ["recomputed FDV", "expectedFdvUsdWad.toString() === valuation.valueWad"],
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

  it.each(stagedMarketEvidenceGuardCases)(
    "mutation %i removes required staged market guard %s",
    (_index, needle) => {
      const workflowPath = ".github/workflows/deploy-production.yml";
      const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
      expect(workflow).toContain(needle);
      const unsafeWorkflow = workflow
        .split(needle)
        .join("MUTATED_RELEASE_GUARD");
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
    },
  );

  it("fails closed when post-promotion permits zero current public FDVs", () => {
    const postPromotionPath =
      "scripts/perf/read-model-post-promotion.mjs";
    const postPromotion = readFileSync(
      resolve(ROOT, postPromotionPath),
      "utf8",
    );
    const unsafePostPromotion = postPromotion.replace(
      "  return currentCount > 0 ? { currentToken, tokens } : null;",
      "  return currentCount >= 0 ? { currentToken, tokens } : null;",
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
    ["StateView price source", 'price?.source !== "uniswap-v4-stateview-chainlink-v1"'],
    ["official liquidity source", 'liquidity?.source !== "official-uniswap-v4-subgraph"'],
    ["official subgraph deployment", "provenance?.deployment !== OFFICIAL_V4_SUBGRAPH_DEPLOYMENT"],
    ["minimum liquidity", "BigInt(liquidity.tvlUsdWad) < MINIMUM_PUBLIC_FDV_LIQUIDITY_USD_WAD"],
    ["exact reference head", "valuation.asOfBlock === provenance.referenceHeadBlockNumber"],
    ["recomputed FDV", "expectedFdvUsdWad.toString() === valuation.valueWad"],
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

  it.each(postPromotionGuardCases)(
    "mutation %i removes required post-promotion guard %s",
    (_index, needle) => {
      const postPromotionPath =
        "scripts/perf/read-model-post-promotion.mjs";
      const postPromotion = readFileSync(
        resolve(ROOT, postPromotionPath),
        "utf8",
      );
      expect(postPromotion).toContain(needle);
      const unsafePostPromotion = postPromotion
        .split(needle)
        .join("MUTATED_RELEASE_GUARD");
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
    },
  );

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

  it("rejects a public market staged smoke bypass relocated to another workflow step", () => {
    const workflowPath = ".github/workflows/deploy-production.yml";
    const secretLine =
      "          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n";
    const workflow = readFileSync(resolve(ROOT, workflowPath), "utf8");
    const bitqueryStepStart = workflow.indexOf(
      "      - name: Smoke staged public market APIs",
    );
    const bitqueryStepEnd = workflow.indexOf(
      "      - name: Record registry identity and combined market path",
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
          "      - name: Record registry identity and combined market path\n",
          `      - name: Record registry identity and combined market path\n        env:\n${secretLine}`,
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

function currentPublicTokenFixture(publicMarketAsOf: string) {
  const blockTimestamp = String(
    Math.floor(Date.parse(publicMarketAsOf) / 1_000),
  );
  const indexedBlockTimestamp = String(BigInt(blockTimestamp) - 12n);
  const indexedBlockTime = new Date(
    Number(BigInt(indexedBlockTimestamp)) * 1_000,
  ).toISOString();
  return {
    id: `1:${PUBLIC_TOKEN_ADDRESS}`,
    exploreKind: "token",
    tokenAddress: PUBLIC_TOKEN_ADDRESS,
    hookAddress: PUBLIC_HOOK_ADDRESS,
    poolId: PUBLIC_POOL_ID,
    launchModel: "classic",
    liquidityPath: "meme",
    totalSupplyRaw: TEST_TOTAL_SUPPLY_RAW.toString(),
    tokenDecimals: 18,
    fdvUsdWad: TEST_FDV_USD_WAD.toString(),
    valuation: {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      source: "stateview-chainlink",
      freshness: "current",
      valueWad: TEST_FDV_USD_WAD.toString(),
      asOfTime: publicMarketAsOf,
      asOfBlock: TEST_CURRENT_BLOCK.toString(),
      asOfBlockHash: TEST_PUBLIC_BLOCK_HASH,
      lagBlocks: "0",
      priceEvidence: {
        schemaVersion: "programmable.stateview-chainlink-price-evidence.v1",
        source: "uniswap-v4-stateview-chainlink-v1",
        chainId: "1",
        poolId: PUBLIC_POOL_ID,
        tokenAddress: PUBLIC_TOKEN_ADDRESS,
        quoteAddress: TEST_NATIVE_CURRENCY,
        stateViewAddress: TEST_STATE_VIEW.toLowerCase(),
        stateViewRuntimeCodeHash: TEST_STATE_VIEW_RUNTIME_CODE_HASH,
        blockNumber: TEST_CURRENT_BLOCK.toString(),
        blockHash: TEST_PUBLIC_BLOCK_HASH,
        blockTimestamp,
        blockTime: publicMarketAsOf,
        sqrtPriceX96: (2n ** 96n).toString(),
        activeLiquidity: TEST_ACTIVE_LIQUIDITY.toString(),
        activeVirtualToken0Wei: TEST_ACTIVE_LIQUIDITY.toString(),
        activeVirtualLiquidityUsdWad:
          TEST_ACTIVE_VIRTUAL_LIQUIDITY_USD_WAD.toString(),
        activeVirtualLiquidityValueBasis:
          "stateview-active-liquidity-virtual-depth-usd",
        tokenPriceEthWei: (10n ** 18n).toString(),
        tokenPriceUsdWad: TEST_PRICE_USD_WAD.toString(),
        totalSupplyRaw: TEST_TOTAL_SUPPLY_RAW.toString(),
        tokenDecimals: 18,
        fdvUsdWad: TEST_FDV_USD_WAD.toString(),
        ethUsdQuote: {
          feedAddress: TEST_ETH_USD_FEED.toLowerCase(),
          roundId: "1",
          answeredInRound: "1",
          answer: "200000000000",
          decimals: 8,
          updatedAt: blockTimestamp,
          updatedAtTime: publicMarketAsOf,
        },
      },
    },
    liquidityEvidence: {
      source: "official-uniswap-v4-subgraph",
      identity: {
        chainId: "1",
        protocol: "uniswap_v4",
        poolId: PUBLIC_POOL_ID,
        tokenAddress: PUBLIC_TOKEN_ADDRESS,
        quoteAddress: TEST_NATIVE_CURRENCY,
      },
      valueBasis: "official-subgraph-pool-tvl-usd",
      tvlUsdWad: (50_000n * 10n ** 18n).toString(),
      reportedPoolBalances: {
        token0: {
          address: TEST_NATIVE_CURRENCY,
          decimals: 18,
          amountDecimal: "10",
        },
        token1: {
          address: PUBLIC_TOKEN_ADDRESS,
          decimals: 18,
          amountDecimal: "100000",
        },
      },
      freshness: "current",
      provenance: {
        subgraphId: TEST_SUBGRAPH_ID,
        deployment: TEST_SUBGRAPH_DEPLOYMENT,
        indexedBlockNumber: (TEST_CURRENT_BLOCK - 1n).toString(),
        indexedBlockHash: TEST_PUBLIC_INDEXED_BLOCK_HASH,
        indexedBlockTimestamp,
        indexedBlockTime,
        referenceHeadBlockNumber: TEST_CURRENT_BLOCK.toString(),
        referenceHeadBlockHash: TEST_PUBLIC_BLOCK_HASH,
        lagBlocks: "1",
      },
    },
    marketData: {
      schemaVersion: "programmable.market-data.v1",
      source: "bitquery",
      generatedAt: new Date().toISOString(),
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
        latestTrade: {
          transactionHash: `0x${"77".repeat(32)}`,
          logIndex: 1,
          blockNumber: TEST_CURRENT_BLOCK.toString(),
          time: publicMarketAsOf,
          tokenSide: "buy",
          priceUsdWad: TEST_PRICE_USD_WAD.toString(),
        },
        valuation: { status: "unavailable", reason: "source-unavailable" },
      }],
    },
  };
}

function currentExploreDataQuality(
  publicMarketAsOf: string,
  available = 1,
  unavailable = 0,
) {
  return {
    schemaVersion: "programmable.explore-data-quality.v1",
    status: unavailable > 0 ? "partial" : "complete",
    valuation: {
      status: unavailable > 0 ? "partial" : "current",
      metric: "fdv",
      available,
      unavailable,
      stale: 0,
      unknown: 0,
      asOfTime: publicMarketAsOf,
      asOfBlock: TEST_CURRENT_BLOCK.toString(),
    },
  };
}

function currentPublicHeaders(
  publicMarketAsOf: string,
  dataQuality = "complete",
) {
  return {
    "X-Programmable-Data-Quality": dataQuality,
    "X-Programmable-Market-As-Of": publicMarketAsOf,
    "X-Programmable-Valuation-Block": TEST_CURRENT_BLOCK.toString(),
    "X-Programmable-Market-Source":
      "stateview-chainlink+official-uniswap-v4-subgraph+bitquery",
    "X-Programmable-Price-Source": "stateview-chainlink",
    "X-Programmable-Read-Source": "operational+durable+postgres",
  };
}

function unavailablePublicTokenFixture(index: number) {
  const address = `0x${index.toString(16).padStart(40, "0")}`;
  return {
    id: `1:${address}`,
    exploreKind: "token",
    tokenAddress: address,
    valuation: { status: "unavailable", reason: "source-unavailable" },
  };
}

function paginatedMarketCapFetch(
  mode: "complete" | "hidden-current" | "missing-page" = "complete",
) {
  const base = publicFetch();
  const publicMarketAsOf = new Date(
    Math.floor((Date.now() - 2 * 60_000) / 1_000) * 1_000,
  ).toISOString();
  const publicToken = currentPublicTokenFixture(publicMarketAsOf);
  const unavailable = Array.from(
    { length: 100 },
    (_, index) => unavailablePublicTokenFixture(index + 10),
  );
  const firstPageTokens = mode === "hidden-current"
    ? unavailable
    : [publicToken, ...unavailable.slice(0, 99)];
  const secondPageToken = mode === "hidden-current"
    ? publicToken
    : unavailable[99];
  return async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    if (
      url.pathname !== "/api/explore" ||
      url.searchParams.has("q")
    ) return base(input, init);
    const page = Number(url.searchParams.get("page") ?? "1");
    if (page === 1) {
      const hasCurrent = mode !== "hidden-current";
      return Response.json({
        status: "ready",
        tokens: firstPageTokens,
        page: 1,
        pageSize: 100,
        total: 101,
        totalPages: 2,
        sort: "market-cap",
        dataQuality: hasCurrent
          ? currentExploreDataQuality(publicMarketAsOf, 1, 99)
          : {
              schemaVersion: "programmable.explore-data-quality.v1",
              status: "partial",
              valuation: {
                status: "unavailable",
                metric: "fdv",
                available: 0,
                unavailable: 100,
                stale: 0,
                unknown: 0,
                asOfTime: null,
                asOfBlock: null,
              },
            },
      }, {
        headers: hasCurrent
          ? currentPublicHeaders(publicMarketAsOf, "partial")
          : {
              "X-Programmable-Data-Quality": "partial",
              "X-Programmable-Market-Source": "bitquery",
              "X-Programmable-Read-Source":
                "operational+durable+postgres",
            },
      });
    }
    const pageTokens = mode === "missing-page" ? [] : [secondPageToken];
    const hasCurrent = mode === "hidden-current";
    return Response.json({
      status: "ready",
      tokens: pageTokens,
      page: 2,
      pageSize: 100,
      total: 101,
      totalPages: 2,
      sort: "market-cap",
      dataQuality: hasCurrent
        ? currentExploreDataQuality(publicMarketAsOf, 1, 0)
        : {
            schemaVersion: "programmable.explore-data-quality.v1",
            status: "partial",
            valuation: {
              status: "unavailable",
              metric: "fdv",
              available: 0,
              unavailable: pageTokens.length,
              stale: 0,
              unknown: 0,
              asOfTime: null,
              asOfBlock: null,
            },
          },
    }, {
      headers: hasCurrent
        ? currentPublicHeaders(publicMarketAsOf)
        : {
            "X-Programmable-Data-Quality": "partial",
            "X-Programmable-Market-Source": "bitquery",
            "X-Programmable-Read-Source":
              "operational+durable+postgres",
          },
    });
  };
}

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
  const earlierPublicMarketTime = new Date(
    Date.parse(publicMarketAsOf) - 60_000,
  ).toISOString();
  const earliestPublicMarketTime = new Date(
    Date.parse(publicMarketAsOf) - 120_000,
  ).toISOString();
  const firstPublicObservedAt = new Date(
    Date.parse(publicMarketAsOf) - 90_000,
  ).toISOString();
  const laterPublicBucketEnd = new Date(
    Date.parse(publicMarketAsOf) + 60_000,
  ).toISOString();
  const publicToken = currentPublicTokenFixture(publicMarketAsOf);

  return async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
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
        const requestedBlock = BigInt(String(request.params[0]));
        const current = requestedBlock === TEST_CURRENT_BLOCK;
        result = {
          number: `0x${requestedBlock.toString(16)}`,
          hash: current ? TEST_PUBLIC_BLOCK_HASH : `0x${"11".repeat(32)}`,
          timestamp: `0x${BigInt(Math.floor(Date.parse(
            current ? publicMarketAsOf : goldenMarketAsOf,
          ) / 1_000)).toString(16)}`,
        };
      } else if (request.method === "eth_getCode") {
        result = TEST_STATE_VIEW_RUNTIME_CODE;
      } else if (request.method === "eth_call") {
        const call = request.params[0] as { to: string; data: string };
        const blockTag = request.params[1] as
          | string
          | { blockHash?: string; requireCanonical?: boolean };
        const current = typeof blockTag === "object"
          ? blockTag.blockHash?.toLowerCase() === TEST_PUBLIC_BLOCK_HASH &&
            blockTag.requireCanonical === true
          : BigInt(blockTag) === TEST_CURRENT_BLOCK;
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
                result: current ? TEST_ACTIVE_LIQUIDITY : 1_000_000n,
              })
            : encodeFunctionResult({
                abi: testStateViewAbi,
                functionName: "getSlot0",
                result: [2n ** 96n, 0, 0, 0],
              });
        } else if (
          (target === GOLDEN_TOKEN_ADDRESS ||
            target === PUBLIC_TOKEN_ADDRESS) &&
          call.data.startsWith("0x313ce567")
        ) {
          result = encodeFunctionResult({
            abi: testErc20Abi,
            functionName: "decimals",
            result: 18,
          });
        } else if (
          (target === GOLDEN_TOKEN_ADDRESS ||
            target === PUBLIC_TOKEN_ADDRESS) &&
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
            Math.floor(Date.parse(
              current ? publicMarketAsOf : goldenMarketAsOf,
            ) / 1_000),
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
        tokens: [publicToken],
        page: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
        sort: "market-cap",
        dataQuality: currentExploreDataQuality(publicMarketAsOf),
      }, { headers: currentPublicHeaders(publicMarketAsOf) });
    }
    if (url.pathname === "/api/explore/token") {
      if (url.searchParams.get("address")?.toLowerCase() === PUBLIC_TOKEN_ADDRESS) {
        return Response.json({
          status: "ready",
          token: publicToken,
          dataQuality: currentExploreDataQuality(publicMarketAsOf),
        }, { headers: currentPublicHeaders(publicMarketAsOf) });
      }
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
      if (url.searchParams.get("address")?.toLowerCase() === PUBLIC_TOKEN_ADDRESS) {
        const range = url.searchParams.get("range") ?? "all";
        return Response.json({
          schemaVersion: "programmable.market-chart.v1",
          source: "bitquery",
          readStatus: "live",
          status: "ready",
          range,
          generatedAt: new Date().toISOString(),
          address: PUBLIC_TOKEN_ADDRESS,
          identity: {
            chainId: "1",
            tokenAddress: PUBLIC_TOKEN_ADDRESS,
            poolId: PUBLIC_POOL_ID,
            quoteAddress: TEST_NATIVE_CURRENCY,
            protocol: "uniswap_v4",
          },
          points: [
            {
              blockNumber: (TEST_CURRENT_BLOCK - 1n).toString(),
              time: earlierPublicMarketTime,
              bucketStart: earliestPublicMarketTime,
              bucketEnd: earlierPublicMarketTime,
              observedAt: firstPublicObservedAt,
              valueSemantics: "period-median",
              priceQuote: "0.95",
              quoteSymbol: "ETH",
              tradeCount: 1,
            },
            {
              blockNumber: TEST_CURRENT_BLOCK.toString(),
              time: laterPublicBucketEnd,
              bucketStart: earlierPublicMarketTime,
              bucketEnd: laterPublicBucketEnd,
              observedAt: publicMarketAsOf,
              valueSemantics: "period-median",
              priceQuote: "1",
              quoteSymbol: "ETH",
              tradeCount: 1,
            },
          ],
          swapCount: 2,
          valuation: {
            status: "unavailable",
            reason: "source-unavailable",
          },
          asOfTime: publicMarketAsOf,
          truncated: false,
        }, {
          headers: {
            "X-Programmable-Data-Quality": "ready",
            "X-Programmable-Market-As-Of": publicMarketAsOf,
            "X-Programmable-Market-Source": "bitquery",
            "X-Programmable-Price-Source": "bitquery",
          },
        });
      }
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
          quoteAddress: GOLDEN_QUOTE_ADDRESS,
          protocol: "uniswap_v4",
        },
        points: [
          {
            blockNumber: "25730000",
            time: goldenMarketAsOf,
            bucketStart: earlierMarketTime,
            bucketEnd: goldenMarketAsOf,
            observedAt: earlierMarketTime,
            valueSemantics: "period-median",
            priceQuote: "0.95",
            quoteSymbol: "ETH",
            tradeCount: 1,
          },
          {
            blockNumber: "25731000",
            time: new Date(
              Date.parse(goldenMarketAsOf) + 60 * 60_000,
            ).toISOString(),
            bucketStart: goldenMarketAsOf,
            bucketEnd: new Date(
              Date.parse(goldenMarketAsOf) + 60 * 60_000,
            ).toISOString(),
            observedAt: goldenMarketAsOf,
            valueSemantics: "period-median",
            priceQuote: "1",
            quoteSymbol: "ETH",
            tradeCount: 1,
          },
        ],
        swapCount: 2,
        valuation: {
          status: "unavailable",
          reason: "source-unavailable",
        },
        asOfTime: goldenMarketAsOf,
        truncated: false,
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
  it("accepts the exact legacy and stamped Classic native/token branches", () => {
    const asOfTime = new Date(
      Math.floor((Date.now() - 2 * 60_000) / 1_000) * 1_000,
    ).toISOString();
    const legacy = currentPublicTokenFixture(asOfTime);
    expect(exactCurrentPublicFdvLiquidity(legacy)).toBe(true);
    const stamped = {
      ...currentPublicTokenFixture(asOfTime),
      hookAddress: PUBLIC_HOOK_ADDRESS.toUpperCase().replace("0X", "0x"),
      liquidityPath: "programmable-v4",
      launchStampProvenance: {
        schemaVersion: "programmable.launch-stamp-provenance.v1",
        kind: "classic",
        chainId: 1,
        poolId: PUBLIC_POOL_ID.toUpperCase().replace("0X", "0x"),
        poolKey: {
          currency0: TEST_NATIVE_CURRENCY,
          currency1: PUBLIC_TOKEN_ADDRESS.toUpperCase().replace("0X", "0x"),
          hooks: PUBLIC_HOOK_ADDRESS,
        },
      },
    };
    expect(exactCurrentPublicFdvLiquidity(stamped)).toBe(true);
  });

  it("rejects stale Chainlink rounds and nested Bitquery numeric FDVs", () => {
    const asOfTime = new Date(
      Math.floor((Date.now() - 2 * 60_000) / 1_000) * 1_000,
    ).toISOString();
    const staleRound = currentPublicTokenFixture(asOfTime);
    staleRound.valuation.priceEvidence.ethUsdQuote.roundId = "2";
    staleRound.valuation.priceEvidence.ethUsdQuote.answeredInRound = "1";
    expect(exactCurrentPublicFdvLiquidity(staleRound)).toBe(false);

    const nestedBitqueryFdv = currentPublicTokenFixture(asOfTime);
    (nestedBitqueryFdv.marketData.pools[0] as { valuation: unknown }).valuation = {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      valueUsdWad: TEST_FDV_USD_WAD.toString(),
      fdvUsdWad: TEST_FDV_USD_WAD.toString(),
      totalSupply: "1000",
      asOfTime,
      freshness: "current",
    };
    expect(exactCurrentPublicFdvLiquidity(nestedBitqueryFdv)).toBe(false);

    const deeplyNestedBitqueryFdv = currentPublicTokenFixture(asOfTime);
    (deeplyNestedBitqueryFdv.marketData as Record<string, unknown>).future = {
      extension: {
        valuation: {
          status: "available",
          metric: "fdv",
          valueUsdWad: TEST_FDV_USD_WAD.toString(),
        },
      },
    };
    expect(exactCurrentPublicFdvLiquidity(deeplyNestedBitqueryFdv)).toBe(false);
  });

  it("rejects stamped Custom Graph and mismatched Classic PoolKey evidence", () => {
    const asOfTime = new Date(
      Math.floor((Date.now() - 2 * 60_000) / 1_000) * 1_000,
    ).toISOString();
    const stamped = {
      ...currentPublicTokenFixture(asOfTime),
      hookAddress: PUBLIC_HOOK_ADDRESS,
      liquidityPath: "programmable-v4",
      launchStampProvenance: {
        schemaVersion: "programmable.launch-stamp-provenance.v1",
        kind: "classic",
        chainId: 1,
        poolId: PUBLIC_POOL_ID,
        poolKey: {
          currency0: TEST_NATIVE_CURRENCY,
          currency1: PUBLIC_TOKEN_ADDRESS,
          hooks: PUBLIC_HOOK_ADDRESS,
        },
      },
    };
    expect(exactCurrentPublicFdvLiquidity({
      ...stamped,
      launchModel: "custom-graph",
      launchStampProvenance: {
        ...stamped.launchStampProvenance,
        kind: "custom-graph",
      },
    })).toBe(false);
    expect(exactCurrentPublicFdvLiquidity({
      ...stamped,
      launchStampProvenance: {
        ...stamped.launchStampProvenance,
        poolKey: {
          ...stamped.launchStampProvenance.poolKey,
          currency0: PUBLIC_HOOK_ADDRESS,
        },
      },
    })).toBe(false);
  });

  it("rejects divergent independent current block, runtime, StateView and Chainlink reads", async () => {
    const base = publicFetch();
    const asOfTime = new Date(
      Math.floor((Date.now() - 2 * 60_000) / 1_000) * 1_000,
    ).toISOString();
    const token = currentPublicTokenFixture(asOfTime);
    const mutations = ["runtime", "slot0", "liquidity", "feed", "block"] as const;
    for (const mutation of mutations) {
      const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.hostname !== "rpc-b.invalid") return base(input, init);
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          id: number;
          method: string;
          params: readonly unknown[];
        };
        if (mutation === "runtime" && request.method === "eth_getCode") {
          return Response.json({ jsonrpc: "2.0", id: request.id, result: "0x6000" });
        }
        if (mutation === "block" && request.method === "eth_getBlockByNumber") {
          const response = await base(input, init);
          const body = await response.json();
          body.result.hash = `0x${"99".repeat(32)}`;
          return Response.json(body);
        }
        if (request.method === "eth_call") {
          const call = request.params[0] as { to: string; data: string };
          if (
            mutation === "slot0" &&
            call.to.toLowerCase() === TEST_STATE_VIEW.toLowerCase() &&
            call.data.startsWith("0xc815641c")
          ) {
            return Response.json({
              jsonrpc: "2.0",
              id: request.id,
              result: encodeFunctionResult({
                abi: testStateViewAbi,
                functionName: "getSlot0",
                result: [2n ** 96n + 1n, 0, 0, 0],
              }),
            });
          }
          if (
            mutation === "liquidity" &&
            call.to.toLowerCase() === TEST_STATE_VIEW.toLowerCase() &&
            !call.data.startsWith("0xc815641c")
          ) {
            return Response.json({
              jsonrpc: "2.0",
              id: request.id,
              result: encodeFunctionResult({
                abi: testStateViewAbi,
                functionName: "getLiquidity",
                result: TEST_ACTIVE_LIQUIDITY + 1n,
              }),
            });
          }
          if (
            mutation === "feed" &&
            call.to.toLowerCase() === TEST_ETH_USD_FEED.toLowerCase() &&
            !call.data.startsWith("0x313ce567")
          ) {
            const timestamp = BigInt(Math.floor(Date.parse(asOfTime) / 1_000));
            return Response.json({
              jsonrpc: "2.0",
              id: request.id,
              result: encodeFunctionResult({
                abi: testFeedAbi,
                functionName: "latestRoundData",
                result: [2n, 200_000_000_000n, timestamp, timestamp, 2n],
              }),
            });
          }
        }
        return base(input, init);
      };
      await expect(verifyCurrentPublicOnchainEvidenceV1({
        token,
        fetchImpl,
        rpcUrls: ["https://rpc-a.invalid", "https://rpc-b.invalid"],
      })).rejects.toThrow();
    }
  });

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
      "production-current-public-detail",
      "production-current-public-bitquery-charts",
      "production-current-public-independent-onchain-proof",
      "production-bitquery-golden-independent-parity",
    ]);
  });

  it("accepts complete stable market-cap coverage across every page", async () => {
    const result = await verifyPostPromotion(
      postPromotionInput(paginatedMarketCapFetch()),
    );
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("rejects a higher current FDV hidden after unavailable page-one entries", async () => {
    const result = await verifyPostPromotion(
      postPromotionInput(paginatedMarketCapFetch("hidden-current")),
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-explore" }),
    );
  });

  it("rejects a missing page from the declared global ranking", async () => {
    const result = await verifyPostPromotion(
      postPromotionInput(paginatedMarketCapFetch("missing-page")),
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "production-explore" }),
    );
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
      body.tokens[0].liquidityEvidence.tvlUsdWad = "0";
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
      body.tokens[0].liquidityEvidence.provenance.indexedBlockTime = new Date(
        Date.parse(
          body.tokens[0].liquidityEvidence.provenance.indexedBlockTime,
        ) - 1_000,
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

  it("rejects a chart whose quote identity is not canonical native ETH", async () => {
    const base = publicFetch();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (url.pathname !== "/api/explore/token/chart") return response;
      const body = await response.json();
      body.identity.quoteAddress =
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
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
