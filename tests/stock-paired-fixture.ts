import {
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import { STOCK_QUOTE_ASSETS } from "../lib/stock-paired";
import type { VerifiedStockPairedRelease } from "../lib/stock-paired-release";
import {
  getStockPairedEthRoute,
  getStockPairedEthRouteRuntimeCodeHashes,
} from "../lib/trade/stock-paired-route";

export const STOCK_TEST_ACCOUNT = getAddress(
  "0x1111111111111111111111111111111111111111",
);
export const STOCK_TEST_TOKEN = getAddress(
  "0x2222222222222222222222222222222222222222",
);
export const STOCK_TEST_RUNTIME = "0x60006000" as Hex;
export const STOCK_TEST_RUNTIME_HASH = keccak256(STOCK_TEST_RUNTIME);
export const STOCK_TEST_POOL_ID = `0x${"ab".repeat(32)}` as Hex;

const deployedAddresses = {
  quoteRegistry: getAddress(
    "0x3333333333333333333333333333333333333333",
  ),
  positionPlanner: getAddress(
    "0x4444444444444444444444444444444444444444",
  ),
  feeSplitVaultFactory: getAddress(
    "0x5555555555555555555555555555555555555555",
  ),
  hookFactory: getAddress(
    "0x6666666666666666666666666666666666666666",
  ),
  feeHook: getAddress(
    "0x77777777777777777777777777777777777750Cc",
  ),
  launcher: getAddress(
    "0x8888888888888888888888888888888888888888",
  ),
  ethLaunchCoordinator: getAddress(
    "0x9999999999999999999999999999999999999999",
  ),
  positionForwarderFactory: getAddress(
    "0x291a9ff1059d225d02B1659430804486404dB507",
  ),
  deployer: getAddress(
    "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
  ),
  treasury: getAddress(
    "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  ),
} as const;

const officialDependencies = {
  poolManager: getAddress(
    "0x000000000004444c5dc75cB358380D2e3dE08A90",
  ),
  positionManager: getAddress(
    "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
  ),
  stateView: getAddress(
    "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
  ),
  v4Quoter: getAddress(
    "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
  ),
  permit2: getAddress(
    "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  ),
  universalRouter: getAddress(
    "0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA",
  ),
  uerc20Factory: getAddress(
    "0x000000e200088D55C39a11F609E5F667729ad49b",
  ),
  v3Factory: getAddress(
    "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  ),
  v3SwapRouter: getAddress(
    "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  ),
  v3Quoter: getAddress(
    "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  ),
  weth: getAddress(
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  ),
  usdc: getAddress(
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  ),
} as const;

export function stockPairedReleaseFixture(): VerifiedStockPairedRelease {
  return {
    internalContractRelease: "stock-paired-v1",
    chainId: 1,
    releaseCommit: "1".repeat(40),
    sourceCommitment: `0x${"12".repeat(32)}`,
    ethCoordinatorReleaseCommit: "2".repeat(40),
    ethCoordinatorSourceCommitment: `0x${"13".repeat(32)}`,
    ethCoordinatorNonce: 52,
    startBlock: 100,
    addresses: { ...deployedAddresses },
    transactions: {
      quoteRegistry: `0x${"21".repeat(32)}`,
      positionPlanner: `0x${"22".repeat(32)}`,
      feeSplitVaultFactory: `0x${"23".repeat(32)}`,
      hookFactory: `0x${"24".repeat(32)}`,
      feeHook: `0x${"25".repeat(32)}`,
      launcher: `0x${"26".repeat(32)}`,
      ethLaunchCoordinator: `0x${"27".repeat(32)}`,
    },
    runtimeCodeHashes: {
      quoteRegistry: STOCK_TEST_RUNTIME_HASH,
      positionPlanner: STOCK_TEST_RUNTIME_HASH,
      feeSplitVaultFactory: STOCK_TEST_RUNTIME_HASH,
      hookFactory: STOCK_TEST_RUNTIME_HASH,
      feeHook: STOCK_TEST_RUNTIME_HASH,
      launcher: STOCK_TEST_RUNTIME_HASH,
      ethLaunchCoordinator: STOCK_TEST_RUNTIME_HASH,
      positionForwarderFactory: STOCK_TEST_RUNTIME_HASH,
    },
    officialDependencies: Object.fromEntries(
      Object.entries(officialDependencies).map(([field, address]) => [
        field,
        { address, runtimeCodeHash: STOCK_TEST_RUNTIME_HASH },
      ]),
    ) as VerifiedStockPairedRelease["officialDependencies"],
    issuerRuntime: {
      tokenRuntimeCodeHash: STOCK_TEST_RUNTIME_HASH,
      beacon: getAddress(
        "0x985462C9aA4D6c3Ad59Ae6e1e9c0C11347ED1598",
      ),
      beaconRuntimeCodeHash: STOCK_TEST_RUNTIME_HASH,
      implementation: getAddress(
        "0xebBcb2cEE51c2FeE4062c9C1270dcb98B0b22250",
      ),
      implementationRuntimeCodeHash: STOCK_TEST_RUNTIME_HASH,
    },
  };
}
export function stockPairedManifestFixture() {
  const release = stockPairedReleaseFixture();
  return {
    schemaVersion: 1,
    model: "stock-paired",
    internalContractRelease: "stock-paired-v1",
    status: "deployment-source-and-lifecycle-verified",
    chainId: 1,
    releaseCommit: release.releaseCommit,
    sourceCommitment: release.sourceCommitment,
    ethCoordinatorReleaseCommit: release.ethCoordinatorReleaseCommit,
    ethCoordinatorSourceCommitment:
      release.ethCoordinatorSourceCommitment,
    ethCoordinatorNonce: release.ethCoordinatorNonce,
    startingNonce: 46,
    startBlock: release.startBlock,
    addresses: release.addresses,
    transactions: release.transactions,
    runtimeCodeHashes: release.runtimeCodeHashes,
    officialDependencies: release.officialDependencies,
    quoteAssets: STOCK_QUOTE_ASSETS.map(({ symbol, address }) => ({
      symbol,
      address,
    })),
    issuerRuntime: release.issuerRuntime,
    sourceVerification: {
      status: "verified",
      quoteRegistry: "verified",
      positionPlanner: "verified",
      feeSplitVaultFactory: "verified",
      hookFactory: "verified",
      feeHook: "verified",
      launcher: "verified",
      ethLaunchCoordinator: "verified",
    },
    lifecycleEvidence: {
      status: "verified-current-release",
      releaseEligible: true,
      independentRpcCount: 2,
      deploymentTransactionsVerified: true,
      runtimeBindingsVerified: true,
      ethCoordinatorDeploymentVerified: true,
      canaryLaunchTransaction: `0x${"31".repeat(32)}`,
      canaryQuoteAsset: STOCK_QUOTE_ASSETS[0].address,
      positionLockVerified: true,
      buyAndSellVerified: true,
      ethFirstLaunchVerified: true,
      ethBuyAndSellVerified: true,
      creatorClaimVerified: true,
      launcherClaimVerified: true,
    },
  };
}

export function stockTradeDeployment(input?: {
  token?: Address;
  quoteAsset?: Address;
  poolId?: Hex;
}) {
  const release = stockPairedReleaseFixture();
  const quoteAsset = input?.quoteAsset ?? STOCK_QUOTE_ASSETS[0].address;
  const route = getStockPairedEthRoute(quoteAsset);
  const routeRuntime = getStockPairedEthRouteRuntimeCodeHashes(quoteAsset);
  return {
    chainId: 1 as const,
    poolManager: release.officialDependencies.poolManager.address,
    poolManagerRuntimeCodeHash: STOCK_TEST_RUNTIME_HASH,
    v4Quoter: release.officialDependencies.v4Quoter.address,
    v4QuoterRuntimeCodeHash: STOCK_TEST_RUNTIME_HASH,
    universalRouter:
      release.officialDependencies.universalRouter.address,
    universalRouterRuntimeCodeHash: STOCK_TEST_RUNTIME_HASH,
    permit2: release.officialDependencies.permit2.address,
    permit2RuntimeCodeHash: STOCK_TEST_RUNTIME_HASH,
    hook: release.addresses.feeHook,
    hookRuntimeCodeHash: STOCK_TEST_RUNTIME_HASH,
    quoteRegistry: release.addresses.quoteRegistry,
    quoteRegistryRuntimeCodeHash: STOCK_TEST_RUNTIME_HASH,
    quoteAsset,
    quoteAssetRuntimeCodeHash: STOCK_TEST_RUNTIME_HASH,
    ethRouteRuntimeCodeHashes: {
      ...routeRuntime,
      v3Factory: STOCK_TEST_RUNTIME_HASH,
      v3SwapRouter: STOCK_TEST_RUNTIME_HASH,
      v3Quoter: STOCK_TEST_RUNTIME_HASH,
      weth: STOCK_TEST_RUNTIME_HASH,
      usdc: STOCK_TEST_RUNTIME_HASH,
      pools: Object.fromEntries(
        route.buyHops.map((hop) => [
          hop.pool.toLowerCase(),
          STOCK_TEST_RUNTIME_HASH,
        ]),
      ),
    },
    token: input?.token ?? STOCK_TEST_TOKEN,
    poolId: input?.poolId ?? STOCK_TEST_POOL_ID,
    release,
  };
}
