import { describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import {
  classicGasReserve,
  classicPermit2Abi,
  classicQuoterAbi,
  classicTokenAbi,
  createClassicPoolKey,
  getClassicPoolId,
} from "../lib/trade/classic";
import {
  getPinnedOfficialTradeStack,
  parseClassicTradeRequest,
  prepareClassicTrade,
  resolveClassicTradeDeployment,
  resolveTradeDeployment,
  type ClassicTradeRelease,
  type ClassicTradeRuntimeClient,
} from "../lib/trade/server";
import type { LaunchModelReleaseManifest } from "../lib/launch-model-gating";
import type { ExploreReadModel } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";
import { DEEP_V2_MANIFEST_FIXED_POLICY } from "../lib/deep-v2";
import appDeployments from "../contracts/config/app-deployments.v1.json";

vi.mock("@/ops/deep-keeper-v2/reviewed-release-binding.json", () => ({
  default: {
    schemaVersion: 1,
    status: "reviewed",
    manifestPath:
      "contracts/deployments/mainnet-deep-full-range-v2.json",
    model: "deep",
    releaseVersion: "deep-full-range-v2",
    internalContractRelease: "liquidity-growth-full-range-v2",
    sourceCommitment: `0x${"41".repeat(32)}`,
    automationAddress:
      "0x1616161616161616161616161616161616161616",
    automationRuntimeCodeHash:
      "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
    automationFqcn:
      "src/LiquidityGrowthFullRangeAutomationV2.sol:LiquidityGrowthFullRangeAutomationV2",
    coordinatorAddress:
      "0x2424242424242424242424242424242424242424",
    coordinatorRuntimeCodeHash:
      "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
    coordinatorSourceCommitment: `0x${"47".repeat(32)}`,
    coordinatorFqcn:
      "src/DeepKeeperExecutorV1.sol:DeepKeeperExecutorV1",
  },
}));

const OWNER = getAddress("0x5555555555555555555555555555555555555555");
const TOKEN = getAddress("0x69AE118837CFe3BE671f59f3D64bCFB8bf1Dc0e9");
const REHEARSAL_HOOK = getAddress("0x9F943aCeFc675DDE34F3998069A958Eb726Da0cC");
const DEEP_HOOK = getAddress("0x48dC3009eC1d3298BBA31f718A9A29d02fC9B0cC");
const DEEP_V2_HOOK = getAddress(
  "0x1212121212121212121212121212121212121212",
);
const DEEP_V2_LAUNCHER = getAddress(
  "0x1313131313131313131313131313131313131313",
);
const DEEP_V2_FACTORY = getAddress(
  "0x1414141414141414141414141414141414141414",
);
const DEEP_V2_IMPLEMENTATION = getAddress(
  "0x1515151515151515151515151515151515151515",
);
const DEEP_V2_AUTOMATION = getAddress(
  "0x1616161616161616161616161616161616161616",
);
const DEEP_V2_VAULT = getAddress(
  "0x1717171717171717171717171717171717171717",
);
const DEEP_V2_LAUNCH_HASH = `0x${"31".repeat(32)}` as Hex;
const DEEP_V2_CONFIGURATION_HASH = `0x${"32".repeat(32)}` as Hex;
const DEEP_V2_BLOCK_HASH = `0x${"33".repeat(32)}` as Hex;
const DEEP_V2_TRANSACTION_HASH = `0x${"34".repeat(32)}` as Hex;
const MOCK_RUNTIME_CODE = "0x6000" as Hex;
const MOCK_RUNTIME_CODE_HASH = keccak256(MOCK_RUNTIME_CODE);

function rehearsalDeployment(): ClassicTradeRelease {
  return {
    ...getPinnedOfficialTradeStack(11155111),
    launchModel: "classic",
    hook: REHEARSAL_HOOK,
    poolManagerRuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
    v4QuoterRuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
    universalRouterRuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
    permit2RuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
    hookRuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
  };
}

function deepDeployment(): ClassicTradeRelease {
  return {
    ...rehearsalDeployment(),
    launchModel: "deep",
    hook: DEEP_HOOK,
  };
}

function readyRegistry(
  tokenAddress: Address = TOKEN,
  overrides: Partial<ExploreReadModel & { status: "ready" }> = {},
  deployment: ClassicTradeRelease = rehearsalDeployment(),
  tokenOverrides: Partial<LauncherToken> = {},
): ExploreReadModel {
  return {
    status: "ready",
    tokens: [
      {
        id: `${deployment.chainId}:${tokenAddress}`,
        name: "Verified Token",
        symbol: "VER",
        tokenAddress,
        hookAddress: deployment.hook,
        poolId: getClassicPoolId(
          createClassicPoolKey(tokenAddress, deployment),
          deployment,
        ),
        launchedAt: "2026-07-27T00:00:00.000Z",
        totalSwapFeeBps: 100,
        launchModel: deployment.launchModel,
        liquidityPath: "meme",
        ...tokenOverrides,
      },
    ],
    snapshot: {
      chainId: deployment.chainId,
      blockNumber: "100",
      blockHash: `0x${"aa".repeat(32)}`,
      confirmations: 12,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
    ...overrides,
  };
}

function deepV2CompatibilityDeployment(): ClassicTradeRelease {
  return {
    ...rehearsalDeployment(),
    launchModel: "deep",
    hook: DEEP_V2_HOOK,
  };
}

function deepV2Registry(): ExploreReadModel {
  const deployment = deepV2CompatibilityDeployment();
  const poolId = getClassicPoolId(
    createClassicPoolKey(TOKEN, deployment),
    deployment,
  );
  return readyRegistry(TOKEN, {}, deployment, {
    creatorAddress: OWNER,
    growthVaultAddress: DEEP_V2_VAULT,
    launchHash: DEEP_V2_LAUNCH_HASH,
    launchBlockNumber: "123",
    launchTransactionHash: DEEP_V2_TRANSACTION_HASH,
    launchLogIndex: 4,
    deepV2Provenance: {
      deepReleaseVersion: "deep-full-range-v2",
      launcher: DEEP_V2_LAUNCHER,
      creator: OWNER,
      tokenAddress: TOKEN,
      vaultAddress: DEEP_V2_VAULT,
      hookAddress: DEEP_V2_HOOK,
      poolId,
      launchHash: DEEP_V2_LAUNCH_HASH,
      vaultConfigurationHash: DEEP_V2_CONFIGURATION_HASH,
      blockNumber: "123",
      blockHash: DEEP_V2_BLOCK_HASH,
      transactionHash: DEEP_V2_TRANSACTION_HASH,
      logIndex: 4,
    },
  });
}

function eligibleDeepManifest(): LaunchModelReleaseManifest {
  const manifest = structuredClone(appDeployments.production);
  manifest.chainId = 11_155_111;
  Object.assign(manifest.launchModelReleases.deep, {
    status: "deployment-source-and-lifecycle-verified",
    releaseEligible: true,
    feeHook: DEEP_HOOK,
    lifecycleStatus: "verified-current-release",
    lifecycleIndependentRpcCount: 2,
    lifecycleLaunchTransaction: `0x${"22".repeat(32)}`,
    lifecycleOracleTransaction: `0x${"33".repeat(32)}`,
    lifecycleFeeProcessCompoundTransaction: `0x${"44".repeat(32)}`,
    keeperExecutor: "0x1111111111111111111111111111111111111111",
    keeperExecutorRuntimeCodeHash:
      "0xd4a6e8f200bd63ab924f5c4cfb1bbcc07c26c7b7b7abaa1f879418d2435f48e6",
    keeperExecutorSourceCommitment:
      "0x9072fa857d484b944205a969fda41727fa76d0f9e670916451b308615bb82175",
    keeperExecutorDeploymentTransaction: `0x${"55".repeat(32)}`,
    keeperExecutorDeploymentBlock: 25_632_900,
    keeperExecutorSourceVerificationStatus:
      "etherscan-and-sourcify-exact-match",
  });
  manifest.launchModelReleases.deep.runtimeCodeHashes.feeHook =
    MOCK_RUNTIME_CODE_HASH;
  return manifest as LaunchModelReleaseManifest;
}

function eligibleDeepV2Manifest(): LaunchModelReleaseManifest {
  const runtimeHashes = {
    launcher: MOCK_RUNTIME_CODE_HASH,
    hookFactory: MOCK_RUNTIME_CODE_HASH,
    feeHook: MOCK_RUNTIME_CODE_HASH,
    feeSplitVaultFactory: MOCK_RUNTIME_CODE_HASH,
    rangeSourceFactory: MOCK_RUNTIME_CODE_HASH,
    growthVaultFactory: MOCK_RUNTIME_CODE_HASH,
    growthVaultImplementation: MOCK_RUNTIME_CODE_HASH,
    automation: MOCK_RUNTIME_CODE_HASH,
    positionPlanner: MOCK_RUNTIME_CODE_HASH,
    positionForwarderFactory: MOCK_RUNTIME_CODE_HASH,
  };
  return {
    chainId: 11_155_111,
    status: "ready",
    launchModelReleases: {
      deep: {
        schemaVersion: 2,
        model: "deep",
        internalContractRelease: "liquidity-growth-full-range-v2",
        releaseVersion: "deep-full-range-v2",
        releaseCommit: "1".repeat(40),
        sourceCommitment: `0x${"41".repeat(32)}`,
        releaseManifest:
          "contracts/deployments/mainnet-deep-full-range-v2.json",
        status: "deployment-source-and-lifecycle-verified",
        releaseEligible: true,
        sourceVerificationStatus: "verified",
        deploymentVerificationStatus: "verified",
        launcher: DEEP_V2_LAUNCHER,
        hookFactory: getAddress(
          "0x1818181818181818181818181818181818181818",
        ),
        feeHook: DEEP_V2_HOOK,
        feeSplitVaultFactory: getAddress(
          "0x1919191919191919191919191919191919191919",
        ),
        rangeSourceFactory: getAddress(
          "0x2020202020202020202020202020202020202020",
        ),
        growthVaultFactory: DEEP_V2_FACTORY,
        growthVaultImplementation: DEEP_V2_IMPLEMENTATION,
        automation: DEEP_V2_AUTOMATION,
        positionPlanner: getAddress(
          "0x2121212121212121212121212121212121212121",
        ),
        positionForwarderFactory: getAddress(
          "0x2323232323232323232323232323232323232323",
        ),
        startBlock: 100,
        deploymentBlock: 100,
        deploymentTransaction: `0x${"42".repeat(32)}`,
        lifecycleEvidenceHash: `0x${"43".repeat(32)}`,
        lifecycleStatus: "verified-current-release",
        lifecycleIndependentRpcCount: 2,
        lifecycleLaunchTransaction: `0x${"44".repeat(32)}`,
        lifecycleOracleTransaction: `0x${"45".repeat(32)}`,
        lifecycleFeeProcessCompoundTransaction: `0x${"46".repeat(32)}`,
        keeperReleaseVersion: "deep-keeper-v2",
        keeperCompatibilityStatus: "verified-deep-v2",
        keeperExecutor: getAddress(
          "0x2424242424242424242424242424242424242424",
        ),
        keeperExecutorRuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
        keeperExecutorSourceCommitment: `0x${"47".repeat(32)}`,
        keeperExecutorDeploymentTransaction: `0x${"48".repeat(32)}`,
        keeperExecutorDeploymentBlock: 101,
        keeperExecutorSourceVerificationStatus:
          "etherscan-and-sourcify-exact-match",
        fixedPolicy: { ...DEEP_V2_MANIFEST_FIXED_POLICY },
        runtimeCodeHashes: runtimeHashes,
      },
    },
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 11155111,
    owner: OWNER,
    token: TOKEN,
    side: "buy",
    amountIn: "1000",
    slippageBps: 250,
    deadline: "10900",
    ...overrides,
  };
}

function runtimeClient(input?: {
  chainId?: number;
  tokenAllowance?: bigint;
  tokenBalance?: bigint;
  nativeBalance?: bigint;
  gasPrice?: bigint;
  permit2Allowance?: bigint;
  permit2Expiration?: number;
  missingCode?: Address;
  mismatchedCode?: Address;
  swapSimulationFailure?: boolean;
  estimatedSwapGas?: bigint;
}) {
  const codeChecks: Address[] = [];
  const client: ClassicTradeRuntimeClient = {
    async getChainId() {
      return input?.chainId ?? 11155111;
    },
    async getBlock() {
      return { timestamp: 10_000n };
    },
    async getBalance() {
      return input?.nativeBalance ?? 10n ** 18n;
    },
    async getGasPrice() {
      return input?.gasPrice ?? 1n;
    },
    async getCode({ address }) {
      codeChecks.push(address);
      if (input?.missingCode?.toLowerCase() === address.toLowerCase()) {
        return undefined;
      }
      return input?.mismatchedCode?.toLowerCase() === address.toLowerCase()
        ? ("0x6001" as Hex)
        : MOCK_RUNTIME_CODE;
    },
    async readContract({ address, functionName }) {
      throw new Error(`Unexpected read ${address}:${functionName}`);
    },
    async estimateGas(args) {
      const deployment = rehearsalDeployment();
      if (args.to.toLowerCase() !== deployment.universalRouter.toLowerCase()) {
        throw new Error("Only swap gas estimation is expected");
      }
      if (input?.swapSimulationFailure) {
        throw new Error("swap estimate reverted");
      }
      return input?.estimatedSwapGas ?? 300_000n;
    },
    async call(args) {
      if (args.to.toLowerCase() === TOKEN.toLowerCase()) {
        if (args.data.startsWith("0x70a08231")) {
          return {
            data: encodeFunctionResult({
              abi: classicTokenAbi,
              functionName: "balanceOf",
              result: input?.tokenBalance ?? 100_000n,
            }),
          };
        }
        return {
          data: encodeFunctionResult({
            abi: classicTokenAbi,
            functionName: "allowance",
            result: input?.tokenAllowance ?? 0n,
          }),
        };
      }

      const deployment = rehearsalDeployment();
      if (args.to.toLowerCase() === deployment.universalRouter.toLowerCase()) {
        if (input?.swapSimulationFailure) {
          throw new Error("swap simulation reverted");
        }
        return {};
      }
      if (args.to.toLowerCase() === deployment.permit2.toLowerCase()) {
        return {
          data: encodeFunctionResult({
            abi: classicPermit2Abi,
            functionName: "allowance",
            result: [
              input?.permit2Allowance ?? 0n,
              input?.permit2Expiration ?? 0,
              0,
            ],
          }),
        };
      }

      return {
        data: encodeFunctionResult({
          abi: classicQuoterAbi,
          functionName: "quoteExactInputSingle",
          result: [10_000n, 222_000n],
        }),
      };
    },
  };

  return { client, codeChecks };
}

describe("Trade request boundary", () => {
  it("accepts only explicit JSON-safe trade fields", () => {
    expect(parseClassicTradeRequest(request())).toEqual({
      chainId: 11155111,
      owner: OWNER,
      token: TOKEN,
      side: "buy",
      amountIn: 1_000n,
      slippageBps: 250,
      deadline: 10_900n,
    });

    expect(() =>
      parseClassicTradeRequest(request({ integratorFeeBps: 10 })),
    ).toThrow("unsupported field");
    expect(() => parseClassicTradeRequest(request({ amountIn: 1000 }))).toThrow(
      "base-unit integer string",
    );
    expect(() => parseClassicTradeRequest(request({ slippageBps: 0 }))).toThrow(
      "Slippage",
    );
    expect(() =>
      parseClassicTradeRequest(request({ slippageBps: 1_001 })),
    ).toThrow("Slippage");
  });

  it("pins the active routers and enables both verified releases", () => {
    expect(getPinnedOfficialTradeStack(1).universalRouter).toBe(
      getAddress("0xd92A36B0000531EF3063dEd4De20A0783308446C"),
    );

    const rehearsal = rehearsalDeployment();
    expect(rehearsal).toMatchObject({
      chainId: 11155111,
      v4Quoter: getAddress("0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227"),
      universalRouter: getAddress("0x470FFC67b1feEEC31D16C46AC7545C98716a194c"),
      hook: REHEARSAL_HOOK,
    });
    expect(resolveClassicTradeDeployment(1)).toMatchObject({
      chainId: 1,
      hook: getAddress("0x025a386eAa79f6067d29848FD05ccC71bEAb20CC"),
    });
    expect(resolveClassicTradeDeployment(11155111)).toMatchObject({
      chainId: 11155111,
      hook: getAddress("0x0c9De2721F537C311e05ad3671A17136C14a20Cc"),
    });
    expect(() => resolveClassicTradeDeployment(8453)).toThrow("not supported");
  });

  it("selects the Deep hook only from an eligible indexed Deep release", () => {
    const deployment = deepDeployment();
    const registry = readyRegistry(TOKEN, {}, deployment);
    const eligible = eligibleDeepManifest();

    expect(
      resolveTradeDeployment(11_155_111, registry, TOKEN, eligible),
    ).toMatchObject({
      chainId: 11_155_111,
      launchModel: "deep",
      hook: DEEP_HOOK,
      hookRuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
    });

    const ineligible = structuredClone(eligible);
    if (!ineligible.launchModelReleases?.deep) {
      throw new Error("Expected a Deep test release");
    }
    ineligible.launchModelReleases.deep.releaseEligible = false;
    expect(() =>
      resolveTradeDeployment(11_155_111, registry, TOKEN, ineligible),
    ).toThrow("eligible verified release");

    const productionDeep = {
      ...getPinnedOfficialTradeStack(1),
      launchModel: "deep",
      hook: getAddress(
        appDeployments.production.launchModelReleases.deep.feeHook,
      ),
      hookRuntimeCodeHash: appDeployments.production.launchModelReleases.deep
        .runtimeCodeHashes.feeHook as Hex,
    } satisfies ClassicTradeRelease;
    expect(() =>
      resolveTradeDeployment(
        1,
        readyRegistry(TOKEN, {}, productionDeep),
        TOKEN,
      ),
    ).toThrow("eligible verified release");
  });

  it("rejects a Deep registry record with the wrong release hook", () => {
    const deployment = deepDeployment();
    const registry = readyRegistry(TOKEN, {}, deployment);
    registry.tokens[0] = {
      ...registry.tokens[0],
      hookAddress: REHEARSAL_HOOK,
    };

    expect(() =>
      resolveTradeDeployment(
        11_155_111,
        registry,
        TOKEN,
        eligibleDeepManifest(),
      ),
    ).toThrow("verified Programmable pool");
  });

  it("selects Deep V2 only from exact indexed V2 provenance and an eligible V2 manifest", () => {
    const deployment = resolveTradeDeployment(
      11_155_111,
      deepV2Registry(),
      TOKEN,
      eligibleDeepV2Manifest(),
    );
    expect(deployment).toMatchObject({
      launchModel: "deep",
      deepReleaseVersion: "deep-full-range-v2",
      hook: DEEP_V2_HOOK,
      deepV2Release: {
        launcher: DEEP_V2_LAUNCHER,
        growthVaultFactory: DEEP_V2_FACTORY,
      },
      deepV2Candidate: {
        tokenAddress: TOKEN,
        launcher: DEEP_V2_LAUNCHER,
      },
    });

    const registry = deepV2Registry();
    delete registry.tokens[0].deepV2Provenance;
    expect(() =>
      resolveTradeDeployment(
        11_155_111,
        registry,
        TOKEN,
        eligibleDeepV2Manifest(),
      ),
    ).toThrow("provenance");
  });
});

describe("Token trade preparation", () => {
  it("quotes a buy and returns an unsigned native ETH swap transaction", async () => {
    const deployment = rehearsalDeployment();
    const { client, codeChecks } = runtimeClient();
    const prepared = await prepareClassicTrade(
      client,
      deployment,
      parseClassicTradeRequest(request()),
      readyRegistry(),
    );

    expect(prepared).toMatchObject({
      status: "ready",
      chainId: 11155111,
      token: TOKEN,
      side: "buy",
      quote: {
        amountIn: "1000",
        amountOut: "10000",
        amountOutMinimum: "9750",
        gasEstimate: "222000",
        slippageBps: 250,
        deadline: "10900",
      },
      transaction: {
        kind: "swap",
        to: deployment.universalRouter,
        value: "1000",
        gasLimit: "360000",
      },
    });
    expect(Object.keys(prepared.transaction).sort()).toEqual([
      "chainId",
      "data",
      "gasLimit",
      "kind",
      "to",
      "value",
    ]);
    expect(new Set(codeChecks)).toEqual(
      new Set([
        deployment.poolManager,
        deployment.v4Quoter,
        deployment.universalRouter,
        deployment.permit2,
        deployment.hook,
        TOKEN,
      ]),
    );
  });

  it("returns the token approval before the Permit2 approval on a sell", async () => {
    const deployment = rehearsalDeployment();
    const { client } = runtimeClient({
      tokenAllowance: 999n,
      permit2Allowance: 100_000n,
      permit2Expiration: 50_000,
    });
    const prepared = await prepareClassicTrade(
      client,
      deployment,
      parseClassicTradeRequest(request({ side: "sell", amountIn: "1000" })),
      readyRegistry(),
    );

    expect(prepared).toMatchObject({
      status: "approval-required",
      approvalState: "token-to-permit2",
      transaction: {
        kind: "token-to-permit2",
        to: TOKEN,
        value: "0",
      },
    });
    const call = decodeFunctionData({
      abi: classicTokenAbi,
      data: prepared.transaction.data,
    });
    expect(call.args[0]).toBe(deployment.permit2);
    expect(call.args[1]).toBe(1_000n);
  });

  it("returns the Permit2 to Router approval when its allowance is stale", async () => {
    const deployment = rehearsalDeployment();
    const { client } = runtimeClient({
      tokenAllowance: 100_000n,
      permit2Allowance: 100_000n,
      permit2Expiration: 10_600,
    });
    const prepared = await prepareClassicTrade(
      client,
      deployment,
      parseClassicTradeRequest(request({ side: "sell" })),
      readyRegistry(),
    );

    expect(prepared).toMatchObject({
      status: "approval-required",
      approvalState: "permit2-to-router",
      transaction: {
        kind: "permit2-to-router",
        to: deployment.permit2,
        value: "0",
      },
    });
    const call = decodeFunctionData({
      abi: classicPermit2Abi,
      data: prepared.transaction.data,
    });
    expect(call.args[1]).toBe(deployment.universalRouter);
    expect(call.args[2]).toBe(1_000n);
    expect(call.args[3]).toBe(10_900);
  });

  it("returns an unsigned sell swap when both approvals are sufficient", async () => {
    const deployment = rehearsalDeployment();
    const { client } = runtimeClient({
      tokenAllowance: 100_000n,
      permit2Allowance: 100_000n,
      permit2Expiration: 50_000,
    });
    const prepared = await prepareClassicTrade(
      client,
      deployment,
      parseClassicTradeRequest(request({ side: "sell" })),
      readyRegistry(),
    );

    expect(prepared).toMatchObject({
      status: "ready",
      approvalState: "ready",
      transaction: {
        kind: "swap",
        to: deployment.universalRouter,
        value: "0",
      },
    });
  });

  it("quotes a Deep buy through the canonical Deep hook", async () => {
    const deployment = deepDeployment();
    const { client, codeChecks } = runtimeClient();
    const prepared = await prepareClassicTrade(
      client,
      deployment,
      parseClassicTradeRequest(request()),
      readyRegistry(TOKEN, {}, deployment),
    );

    expect(prepared).toMatchObject({
      status: "ready",
      side: "buy",
      poolKey: {
        hooks: DEEP_HOOK,
      },
      transaction: {
        kind: "swap",
        to: deployment.universalRouter,
        value: "1000",
      },
    });
    expect(codeChecks).toContain(DEEP_HOOK);
    expect(codeChecks).not.toContain(REHEARSAL_HOOK);
  });

  it("quotes a Deep sell through the same Permit2 and Router path", async () => {
    const deployment = deepDeployment();
    const { client } = runtimeClient({
      tokenAllowance: 100_000n,
      permit2Allowance: 100_000n,
      permit2Expiration: 50_000,
    });
    const prepared = await prepareClassicTrade(
      client,
      deployment,
      parseClassicTradeRequest(request({ side: "sell" })),
      readyRegistry(TOKEN, {}, deployment),
    );

    expect(prepared).toMatchObject({
      status: "ready",
      side: "sell",
      approvalState: "ready",
      poolKey: {
        hooks: DEEP_HOOK,
      },
      transaction: {
        kind: "swap",
        to: deployment.universalRouter,
        value: "0",
      },
    });
  });

  it("checks the V2 launcher and vault factory runtimes before quoting Deep V2", async () => {
    const registry = deepV2Registry();
    const deployment = resolveTradeDeployment(
      11_155_111,
      registry,
      TOKEN,
      eligibleDeepV2Manifest(),
    );
    deployment.poolManagerRuntimeCodeHash = MOCK_RUNTIME_CODE_HASH;
    deployment.v4QuoterRuntimeCodeHash = MOCK_RUNTIME_CODE_HASH;
    deployment.universalRouterRuntimeCodeHash = MOCK_RUNTIME_CODE_HASH;
    deployment.permit2RuntimeCodeHash = MOCK_RUNTIME_CODE_HASH;
    if (!deployment.deepV2Release) {
      throw new Error("Expected the Deep V2 release");
    }
    deployment.deepV2Release.poolManagerRuntimeCodeHash =
      MOCK_RUNTIME_CODE_HASH;
    const { client, codeChecks } = runtimeClient();
    await expect(
      prepareClassicTrade(
        client,
        deployment,
        parseClassicTradeRequest(request()),
        registry,
      ),
    ).resolves.toMatchObject({
      status: "ready",
      poolKey: { hooks: DEEP_V2_HOOK },
    });
    expect(codeChecks).toContain(DEEP_V2_LAUNCHER);
    expect(codeChecks).toContain(DEEP_V2_FACTORY);
    expect(codeChecks).toContain(DEEP_V2_IMPLEMENTATION);
    expect(codeChecks).toContain(DEEP_V2_AUTOMATION);
  });

  it("rejects a mismatched pinned Deep hook runtime", async () => {
    const deployment = deepDeployment();

    await expect(
      prepareClassicTrade(
        runtimeClient({ mismatchedCode: deployment.hook }).client,
        deployment,
        parseClassicTradeRequest(request()),
        readyRegistry(TOKEN, {}, deployment),
      ),
    ).rejects.toThrow(
      "Deep hook runtime code does not match the pinned release",
    );
  });

  it("rejects a wrong-chain client and missing code at a pinned address", async () => {
    const deployment = rehearsalDeployment();
    await expect(
      prepareClassicTrade(
        runtimeClient({ chainId: 1 }).client,
        deployment,
        parseClassicTradeRequest(request()),
        readyRegistry(),
      ),
    ).rejects.toThrow("RPC chain");

    await expect(
      prepareClassicTrade(
        runtimeClient({ missingCode: deployment.universalRouter }).client,
        deployment,
        parseClassicTradeRequest(request()),
        readyRegistry(),
      ),
    ).rejects.toThrow("Universal Router");
  });

  it("rejects tokens outside the verified launcher registry before RPC work", async () => {
    const deployment = rehearsalDeployment();
    const foreignToken = getAddress(
      "0x9999999999999999999999999999999999999999",
    );
    const { client, codeChecks } = runtimeClient();

    await expect(
      prepareClassicTrade(
        client,
        deployment,
        parseClassicTradeRequest(request({ token: foreignToken })),
        readyRegistry(),
      ),
    ).rejects.toThrow("not a verified Programmable launch");
    expect(codeChecks).toEqual([]);
  });

  it("rejects a pinned protocol runtime-code mismatch", async () => {
    const deployment = rehearsalDeployment();

    await expect(
      prepareClassicTrade(
        runtimeClient({
          mismatchedCode: deployment.universalRouter,
        }).client,
        deployment,
        parseClassicTradeRequest(request()),
        readyRegistry(),
      ),
    ).rejects.toThrow(
      "Universal Router runtime code does not match the pinned release",
    );
  });

  it("fails closed when the exact swap simulation reverts", async () => {
    const deployment = rehearsalDeployment();

    await expect(
      prepareClassicTrade(
        runtimeClient({ swapSimulationFailure: true }).client,
        deployment,
        parseClassicTradeRequest(request()),
        readyRegistry(),
      ),
    ).rejects.toThrow("swap simulation reverted");
  });

  it("rejects a buy above the wallet ETH balance with an actionable error", async () => {
    const deployment = rehearsalDeployment();

    await expect(
      prepareClassicTrade(
        runtimeClient({ nativeBalance: 999n }).client,
        deployment,
        parseClassicTradeRequest(request()),
        readyRegistry(),
      ),
    ).rejects.toThrow("buy amount exceeds the wallet ETH balance");
  });

  it("keeps enough ETH for the buy gas and one later sell", async () => {
    const deployment = rehearsalDeployment();
    const gasLimit = 360_000n;
    const reserve = classicGasReserve({
      gasLimit,
      gasPrice: 1n,
      transactionCount: 2,
    });

    await expect(
      prepareClassicTrade(
        runtimeClient({ nativeBalance: reserve + 999n }).client,
        deployment,
        parseClassicTradeRequest(request()),
        readyRegistry(),
      ),
    ).rejects.toThrow("keeps enough ETH for this buy and a later sell");
  });

  it("rejects a sell above the wallet token balance before approvals", async () => {
    const deployment = rehearsalDeployment();

    await expect(
      prepareClassicTrade(
        runtimeClient({ tokenBalance: 999n }).client,
        deployment,
        parseClassicTradeRequest(request({ side: "sell", amountIn: "1000" })),
        readyRegistry(),
      ),
    ).rejects.toThrow("sell amount exceeds the wallet token balance");
  });

  it("requires enough native ETH to submit a ready sell", async () => {
    const deployment = rehearsalDeployment();

    await expect(
      prepareClassicTrade(
        runtimeClient({
          nativeBalance: 449_999n,
          tokenBalance: 100_000n,
          tokenAllowance: 100_000n,
          permit2Allowance: 100_000n,
          permit2Expiration: 50_000,
        }).client,
        deployment,
        parseClassicTradeRequest(request({ side: "sell" })),
        readyRegistry(),
      ),
    ).rejects.toThrow("wallet needs more ETH to pay for the sell transaction");
  });
});
