import type {
  CanonicalTokenExploreEntry,
  LaunchStampProvenanceV1,
  LauncherToken,
} from "../lib/tokens";

export const STAMP_TOKEN =
  "0x1111111111111111111111111111111111111111" as const;
export const STAMP_HOOK =
  "0x2222222222222222222222222222222222222222" as const;
export const STAMP_POOL_ID = `0x${"33".repeat(32)}` as const;
export const STAMP_LAUNCH_ID = `0x${"44".repeat(32)}` as const;
export const STAMP_HASH = `0x${"55".repeat(32)}` as const;

export const launchStampProvenance = {
  schemaVersion: "programmable.launch-stamp-provenance.v1",
  chainId: 1,
  routerAddress: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
  routerRuntimeCodeHash:
    "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
  routerStartBlock: "25717612",
  finalityConfirmations: 64,
  kind: "custom-graph",
  launchId: STAMP_LAUNCH_ID,
  stampHash: STAMP_HASH,
  launchWallet: "0x4444444444444444444444444444444444444444",
  transactionHash: `0x${"66".repeat(32)}`,
  blockNumber: "25717953",
  blockHash: `0x${"77".repeat(32)}`,
  transactionIndex: 2,
  routeLogIndex: 3,
  launchLogIndex: 4,
  finalizedAtBlockNumber: "25718017",
  finalizedAtBlockHash: `0x${"88".repeat(32)}`,
  poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  poolId: STAMP_POOL_ID,
  poolKey: {
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: STAMP_TOKEN,
    fee: 3_000,
    tickSpacing: 60,
    hooks: STAMP_HOOK,
  },
  poolKeyHash: `0x${"99".repeat(32)}`,
  componentSetHash: `0x${"aa".repeat(32)}`,
  routePayloadHash: `0x${"bb".repeat(32)}`,
  routeLauncherAddress: "0x5555555555555555555555555555555555555555",
  routeLauncherRuntimeCodeHash: `0x${"cc".repeat(32)}`,
  expectedResultHash: `0x${"dd".repeat(32)}`,
  permitDigest: `0x${"ee".repeat(32)}`,
  components: [
    {
      address: STAMP_TOKEN,
      kind: "token",
      scope: "exclusive",
      runtimeCodeHash: `0x${"12".repeat(32)}`,
      logIndex: 1,
      exclusiveProof: {
        launchId: STAMP_LAUNCH_ID,
        stampHash: STAMP_HASH,
      },
    },
    {
      address: STAMP_HOOK,
      kind: "hook",
      scope: "exclusive",
      runtimeCodeHash: `0x${"23".repeat(32)}`,
      logIndex: 2,
      exclusiveProof: {
        launchId: STAMP_LAUNCH_ID,
        stampHash: STAMP_HASH,
      },
    },
  ],
  tokenProof: {
    tokenAddress: STAMP_TOKEN,
    launchId: STAMP_LAUNCH_ID,
    stampHash: STAMP_HASH,
  },
  poolProof: {
    poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    poolId: STAMP_POOL_ID,
    launchId: STAMP_LAUNCH_ID,
    stampHash: STAMP_HASH,
  },
} as const satisfies LaunchStampProvenanceV1;

export const customGraphToken = {
  id: `1:${STAMP_TOKEN.toLowerCase()}`,
  name: "Custom Graph",
  symbol: "GRAPH",
  tokenAddress: STAMP_TOKEN,
  hookAddress: STAMP_HOOK,
  poolId: STAMP_POOL_ID,
  creatorAddress: launchStampProvenance.launchWallet,
  launchBlockNumber: launchStampProvenance.blockNumber,
  launchTransactionHash: launchStampProvenance.transactionHash,
  launchTransactionIndex: launchStampProvenance.transactionIndex,
  launchLogIndex: launchStampProvenance.launchLogIndex,
  launchedAt: "2026-08-09T12:00:00.000Z",
  totalSupplyRaw: (1_000n * 10n ** 18n).toString(),
  tokenDecimals: 18,
  currentTick: 0,
  activeLiquidity: "1000000",
  totalSwapFeeBps: null,
  launchModel: "custom-graph",
  launchModelVersion: "programmable-launch-stamp-router-v1",
  launchStampProvenance,
  liquidityPath: "programmable-v4",
} as const satisfies LauncherToken;

export const customGraphExploreEntry = {
  ...customGraphToken,
  exploreKind: "token",
  launchCategoryProvenance: {
    schemaVersion: "programmable.explore-launch-category-provenance.v1",
    category: "custom",
    source: "canonical-launch-stamp-router",
    launchId: launchStampProvenance.launchId,
    stampHash: launchStampProvenance.stampHash,
    routerAddress: launchStampProvenance.routerAddress,
    transactionHash: launchStampProvenance.transactionHash,
    blockHash: launchStampProvenance.blockHash,
    blockNumber: launchStampProvenance.blockNumber,
    transactionIndex: launchStampProvenance.transactionIndex,
    logIndex: launchStampProvenance.launchLogIndex,
  },
} as const satisfies CanonicalTokenExploreEntry;

export const classicLaunchStampProvenance = {
  ...launchStampProvenance,
  kind: "classic",
  components: [
    launchStampProvenance.components[0],
    {
      ...launchStampProvenance.components[1],
      scope: "shared-infrastructure",
      exclusiveProof: null,
    },
  ],
} as const satisfies LaunchStampProvenanceV1;

export const stampedClassicToken = {
  ...customGraphToken,
  name: "Stamped Classic",
  symbol: "CLASSIC",
  launchModel: "classic",
  launchStampProvenance: classicLaunchStampProvenance,
} as const satisfies LauncherToken;

export const stampedClassicExploreEntry = {
  ...stampedClassicToken,
  exploreKind: "token",
  launchCategoryProvenance: {
    schemaVersion: "programmable.explore-launch-category-provenance.v1",
    category: "classic",
    source: "canonical-launch-stamp-router",
    launchId: classicLaunchStampProvenance.launchId,
    stampHash: classicLaunchStampProvenance.stampHash,
    routerAddress: classicLaunchStampProvenance.routerAddress,
    transactionHash: classicLaunchStampProvenance.transactionHash,
    blockHash: classicLaunchStampProvenance.blockHash,
    blockNumber: classicLaunchStampProvenance.blockNumber,
    transactionIndex: classicLaunchStampProvenance.transactionIndex,
    logIndex: classicLaunchStampProvenance.launchLogIndex,
  },
} as const satisfies CanonicalTokenExploreEntry;
