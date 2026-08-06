import type {
  CanonicalTokenExploreEntry,
  CustomProjectExploreEntry,
} from "@/lib/tokens";

type PreviewChartRange = "1h" | "1d" | "1w" | "all";

export type ExplorePreviewProject = {
  teamName: string;
  teamSummary: string;
  contributors: number;
  communityMembers: number;
};

const PROJECT_LINKS = [
  { kind: "website" as const, url: "https://programmable.family" },
  { kind: "x" as const, url: "https://x.com/0xProgrammable" },
  { kind: "telegram" as const, url: "https://t.me/programmable" },
];

function makePreviewToken(input: {
  id: number;
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  launchedAt: string;
  marketCapUsd: string;
  priceUsd: string;
  volumeUsd: string;
  liquidityUsd: string;
  volumeEth: string;
  launchModel: "classic" | "adaptive" | "deep";
  totalSwapFeeBps: number;
}): CanonicalTokenExploreEntry {
  const tokenAddress = `0x${input.id.toString(16).padStart(40, "0")}` as const;
  const hookAddress = `0x${(input.id + 100).toString(16).padStart(40, "0")}` as const;
  const creatorAddress = `0x${(input.id + 200).toString(16).padStart(40, "0")}` as const;
  const poolId = `0x${(input.id + 300).toString(16).padStart(64, "0")}` as const;

  return {
    id: `interface-preview-${input.id}`,
    exploreKind: "token",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: `interface-preview-${input.id}`,
      modelId: input.launchModel,
      modelVersion: input.launchModel === "classic" ? "classic-v3" : null,
    },
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    imageUrl: input.imageUrl,
    links: PROJECT_LINKS,
    tokenAddress,
    hookAddress,
    poolId,
    creatorAddress,
    launchedAt: input.launchedAt,
    launchBlockNumber: String(23_200_000 - input.id * 420),
    launchTransactionIndex: input.id % 3,
    launchLogIndex: 0,
    totalSupply: "1000000000",
    totalSupplyRaw: "1000000000000000000000000000",
    tokenDecimals: 18,
    tokenPriceUsdWad: input.priceUsd,
    indexedMarketCapUsdWad: input.marketCapUsd,
    grossVolumeEth: input.volumeEth,
    grossVolumeWei: `${input.volumeEth.replace(".", "")}0000000000000000`,
    totalSwapFeeBps: input.totalSwapFeeBps,
    launchModel: input.launchModel,
    launchModelVersion:
      input.launchModel === "classic" ? "classic-v3" : undefined,
    quoteAssetSymbol: "ETH",
    liquidityPath: "meme",
    uniswapV4Pool: {
      source: "official-uniswap-v4-subgraph",
      indexedBlockNumber: String(23_100_000 + input.id * 420),
      indexedBlockHash: `0x${(input.id + 400).toString(16).padStart(64, "0")}`,
      volumeUsdWad: input.volumeUsd,
      tvlUsdWad: input.liquidityUsd,
      transactionCount: String(640 + input.id * 187),
      liquidity: `${input.id + 1}00000000000000000000000`,
      sqrtPriceX96: "79228162514264337593543950336",
      tick: 0,
      feeTierPips: String(input.totalSwapFeeBps * 100),
    },
  };
}

export const EXPLORE_PREVIEW_TOKENS: CanonicalTokenExploreEntry[] = [
  makePreviewToken({
    id: 1,
    name: "Common Ground",
    symbol: "COMMON",
    description:
      "A coordination market for open-source releases and shared infrastructure.",
    imageUrl: "/brand/projects/common-ground-v1.webp",
    launchedAt: "2026-08-02T09:40:00.000Z",
    marketCapUsd: "8400000000000000000000000",
    priceUsd: "8400000000000000",
    volumeUsd: "1240000000000000000000000",
    liquidityUsd: "620000000000000000000000",
    volumeEth: "354.28",
    launchModel: "classic",
    totalSwapFeeBps: 100,
  }),
  makePreviewToken({
    id: 2,
    name: "Daybreak",
    symbol: "DAY",
    description:
      "A community token funding public experiments through programmable fees.",
    imageUrl: "/brand/projects/daybreak-v1.webp",
    launchedAt: "2026-08-01T18:15:00.000Z",
    marketCapUsd: "6100000000000000000000000",
    priceUsd: "6100000000000000",
    volumeUsd: "870000000000000000000000",
    liquidityUsd: "448000000000000000000000",
    volumeEth: "248.57",
    launchModel: "adaptive",
    totalSwapFeeBps: 75,
  }),
  makePreviewToken({
    id: 3,
    name: "North Star",
    symbol: "STAR",
    description:
      "A research collective using dynamic fees to build long-term liquidity.",
    imageUrl: "/brand/projects/north-star-v1.webp",
    launchedAt: "2026-08-01T11:05:00.000Z",
    marketCapUsd: "4700000000000000000000000",
    priceUsd: "4700000000000000",
    volumeUsd: "642000000000000000000000",
    liquidityUsd: "389000000000000000000000",
    volumeEth: "183.43",
    launchModel: "deep",
    totalSwapFeeBps: 125,
  }),
  makePreviewToken({
    id: 4,
    name: "Open Atlas",
    symbol: "ATLAS",
    description:
      "A public index for onchain tools, teams and community-owned products.",
    imageUrl: "/brand/projects/open-atlas-v1.webp",
    launchedAt: "2026-07-31T16:30:00.000Z",
    marketCapUsd: "3200000000000000000000000",
    priceUsd: "3200000000000000",
    volumeUsd: "381000000000000000000000",
    liquidityUsd: "276000000000000000000000",
    volumeEth: "108.86",
    launchModel: "classic",
    totalSwapFeeBps: 100,
  }),
  makePreviewToken({
    id: 5,
    name: "After Hours",
    symbol: "NIGHT",
    description:
      "An independent publishing network with rewards defined at pool level.",
    imageUrl: "/brand/projects/after-hours-v1.webp",
    launchedAt: "2026-07-30T21:20:00.000Z",
    marketCapUsd: "1800000000000000000000000",
    priceUsd: "1800000000000000",
    volumeUsd: "194000000000000000000000",
    liquidityUsd: "158000000000000000000000",
    volumeEth: "55.43",
    launchModel: "adaptive",
    totalSwapFeeBps: 80,
  }),
  makePreviewToken({
    id: 6,
    name: "Field Notes",
    symbol: "NOTES",
    description:
      "A shared market for open research, prototypes and contributor funding.",
    imageUrl: "/brand/projects/field-notes-v1.webp",
    launchedAt: "2026-07-29T14:10:00.000Z",
    marketCapUsd: "980000000000000000000000",
    priceUsd: "980000000000000",
    volumeUsd: "96000000000000000000000",
    liquidityUsd: "112000000000000000000000",
    volumeEth: "27.43",
    launchModel: "deep",
    totalSwapFeeBps: 120,
  }),
];

const CUSTOM_PREVIEW_WALLET = {
  namespace: "eip155:1",
  value: "0x4000000000000000000000000000000000000000",
} as const;
const CUSTOM_PREVIEW_PROJECT_HASH = `sha256:${"1".repeat(64)}` as const;
const CUSTOM_PREVIEW_LAUNCH_HASH = `sha256:${"2".repeat(64)}` as const;
const CUSTOM_PREVIEW_AUTHORITY_HASH = `sha256:${"3".repeat(64)}` as const;
const CUSTOM_PREVIEW_POOL_ID =
  "0x614e282d9da77773822719f0675fc54e61e17db2a0a00af2cb64dede96ea29b6" as const;

function previewDigest(digit: string): `sha256:${string}` {
  return `sha256:${digit.repeat(64)}`;
}

const CUSTOM_PREVIEW_TRADE_CAPABILITY = {
  schemaVersion: "programmable.discoverable-market-trade-capability.v1",
  capabilityId: "trade:signal-eth-v4",
  adapterId: "uniswap-v4-universal-router-exact-input:v1",
  chainId: "1",
  chainProfileId: "ethereum-mainnet-v4",
  chainProfileHash: previewDigest("7"),
  marketId: "signal-eth-v4",
  baseAssetId: "signal-token",
  quoteAssetId: "native-eth",
  poolKey: {
    poolId: CUSTOM_PREVIEW_POOL_ID,
    currency0AssetId: "native-eth",
    currency0: {
      namespace: "eip155:1",
      value: "0x0000000000000000000000000000000000000000",
    },
    currency1AssetId: "signal-token",
    currency1: {
      namespace: "eip155:1",
      value: "0x2000000000000000000000000000000000000000",
    },
    feeRaw: "500",
    tickSpacing: "10",
    hooksAssetId: "signal-hook",
    hooks: {
      namespace: "eip155:1",
      value: "0x3000000000000000000000000000000000000000",
    },
  },
  routerGeneration: "universal-router:v2.2",
  dependencies: [
    {
      role: "uniswap-permit2",
      dependencyId: "dependency:uniswap-permit2",
      capabilityId: "capability:uniswap-permit2:v1",
      chainProfileId: "ethereum-mainnet-v4",
      identity: {
        namespace: "eip155:1",
        value: "0x000000000022d473030f116ddee9f6b43ac78ba3",
      },
      runtimeCodeKeccak256: `0x${"1".repeat(64)}`,
      runtimeCodeSha256: previewDigest("1"),
      reviewEvidenceBindingHash: previewDigest("1"),
      interfaceEvidenceBindingHash: previewDigest("1"),
    },
    {
      role: "uniswap-v4-quoter",
      dependencyId: "dependency:uniswap-v4-quoter",
      capabilityId: "capability:uniswap-v4-quoter:v1",
      chainProfileId: "ethereum-mainnet-v4",
      identity: {
        namespace: "eip155:1",
        value: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
      },
      runtimeCodeKeccak256: `0x${"2".repeat(64)}`,
      runtimeCodeSha256: previewDigest("2"),
      reviewEvidenceBindingHash: previewDigest("2"),
      interfaceEvidenceBindingHash: previewDigest("2"),
    },
    {
      role: "uniswap-v4-state-view",
      dependencyId: "dependency:uniswap-v4-state-view",
      capabilityId: "capability:uniswap-v4-state-view:v1",
      chainProfileId: "ethereum-mainnet-v4",
      identity: {
        namespace: "eip155:1",
        value: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
      },
      runtimeCodeKeccak256: `0x${"3".repeat(64)}`,
      runtimeCodeSha256: previewDigest("3"),
      reviewEvidenceBindingHash: previewDigest("3"),
      interfaceEvidenceBindingHash: previewDigest("3"),
    },
    {
      role: "uniswap-v4-universal-router",
      dependencyId: "dependency:uniswap-v4-universal-router-v2.2",
      capabilityId: "capability:uniswap-v4-universal-router:v2.2",
      chainProfileId: "ethereum-mainnet-v4",
      identity: {
        namespace: "eip155:1",
        value: "0xcb640a86855f1a828c27241ba364348de28abe66",
      },
      runtimeCodeKeccak256: `0x${"4".repeat(64)}`,
      runtimeCodeSha256: previewDigest("4"),
      reviewEvidenceBindingHash: previewDigest("4"),
      interfaceEvidenceBindingHash: previewDigest("4"),
    },
  ],
  supportedSides: ["base-to-quote", "quote-to-base"],
  sideBindings: [{
    side: "base-to-quote",
    inputAssetId: "signal-token",
    outputAssetId: "native-eth",
    zeroForOne: false,
    inputCurrencyKind: "erc20",
    settlementAction: "SETTLE_ALL",
    takeAction: "TAKE_ALL",
  }, {
    side: "quote-to-base",
    inputAssetId: "native-eth",
    outputAssetId: "signal-token",
    zeroForOne: true,
    inputCurrencyKind: "native",
    settlementAction: "SETTLE_ALL",
    takeAction: "TAKE_ALL",
  }],
  exactness: "exact-input",
  hookDataPolicy: {
    kind: "fixed",
    data: "0x1234",
    hookDataHash: previewDigest("8"),
  },
  actionPolicy: {
    swapAction: "SWAP_EXACT_IN_SINGLE",
    settleAction: "SETTLE_ALL",
    takeAction: "TAKE_ALL",
    multiHop: false,
    exactOutput: false,
  },
  quotePolicy: {
    adapterId: "uniswap-v4-quoter-exact-input:v1",
    executionMode: "offchain-static-call-only",
    currentStateRequired: true,
    maximumQuoteAgeSeconds: 30,
  },
  slippagePolicy: {
    kind: "user-bounded-minimum-output",
    amountOutMinimumRequired: true,
    maximumSlippageBps: 500,
  },
  deadlinePolicy: {
    kind: "bounded-user-deadline",
    deadlineRequired: true,
    maximumHorizonSeconds: 300,
  },
  approvalPolicy: {
    erc20Input: "erc20-approve-permit2-then-permit2-approve-router",
    nativeInput: "transaction-value",
  },
  recipientPolicy: "connected-wallet-only",
  planBindingHash: previewDigest("9"),
  status: "verified",
  poolKeyEvidenceHash: previewDigest("a"),
  marketVerificationBindingHash: previewDigest("b"),
  hookAssetIdentityEvidenceHash: previewDigest("c"),
  tradeCapabilityBindingHash: previewDigest("d"),
} as const;

export const EXPLORE_PREVIEW_CUSTOM_PROJECT: CustomProjectExploreEntry = {
  exploreKind: "custom-project",
  id: "interface-preview-custom-signal-garden",
  name: "Signal Garden",
  symbol: "SIGNAL",
  description: "A reviewed Custom Hook launch with explicit post-launch authority.",
  imageUrl: "/brand/projects/common-ground-v1.webp",
  links: [{ kind: "website", url: "https://programmable.family" }],
  launchedAt: "2026-08-06T12:00:00.000Z",
  finalizedAt: "2026-08-06T12:02:00.000Z",
  chainId: "1",
  modelId: "custom-hook-v1",
  customProjectId: CUSTOM_PREVIEW_PROJECT_HASH,
  customLaunchId: CUSTOM_PREVIEW_LAUNCH_HASH,
  tokenAddress: "0x2000000000000000000000000000000000000000",
  launchingWallet: CUSTOM_PREVIEW_WALLET,
  postLaunchAuthorityInventoryHash: CUSTOM_PREVIEW_AUTHORITY_HASH,
  postLaunchAuthorityInventory: {
    schemaVersion: "programmable.post-launch-authority-inventory.v1",
    launchingWallet: CUSTOM_PREVIEW_WALLET,
    addressBindings: [],
    declaredIdentityBindings: [],
    postLaunchAuthorities: [{
      authorityId: "launch-wallet",
      role: "project-owner",
      authorityKind: "eoa",
      identity: CUSTOM_PREVIEW_WALLET,
      source: { kind: "launching-wallet" },
      postLaunchActions: ["configure-hook"],
      feeRole: "project",
      disclosure: {
        label: "Launch wallet",
        description: "Can perform the declared post-launch hook action.",
      },
      authorization: "declared-onchain-authority-only",
    }],
    confirmation: {
      mode: "artifact-bound-launching-wallet-intent",
      confirmingIdentity: CUSTOM_PREVIEW_WALLET,
      userVisibleDisclosureRequired: true,
    },
    postLaunchActionPolicy: "declared-onchain-authority-only",
    githubAuthority: "provenance-only-never-post-launch-authority",
    postLaunchAuthorityInventoryHash: CUSTOM_PREVIEW_AUTHORITY_HASH,
  },
  markets: [{
    marketId: "signal-eth-v4",
    kind: "uniswap-v4",
    status: "active",
    poolId: CUSTOM_PREVIEW_POOL_ID,
    baseAsset: {
      assetId: "signal-token",
      identity: {
        namespace: "eip155:1",
        value: "0x2000000000000000000000000000000000000000",
      },
      name: "Signal Garden",
      symbol: "SIGNAL",
      decimals: 18,
    },
    quoteAsset: {
      assetId: "native-eth",
      identity: {
        namespace: "eip155:1",
        value: "0x0000000000000000000000000000000000000000",
      },
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    tradeCapability: CUSTOM_PREVIEW_TRADE_CAPABILITY,
  }],
  launchCategoryProvenance: {
    schemaVersion: "programmable.explore-launch-category-provenance.v1",
    category: "custom",
    source: "interface-preview",
    projectId: CUSTOM_PREVIEW_PROJECT_HASH,
    launchId: CUSTOM_PREVIEW_LAUNCH_HASH,
    sourceRecordBindingHash: `sha256:${"5".repeat(64)}`,
    finalizedLaunchBindingHash: `sha256:${"6".repeat(64)}`,
  },
};

export const EXPLORE_PREVIEW_CUSTOM_PROJECT_NO_TRADE: CustomProjectExploreEntry = {
  ...EXPLORE_PREVIEW_CUSTOM_PROJECT,
  id: "interface-preview-custom-signal-garden-unbound",
  name: "Signal Garden Unbound",
  customProjectId: previewDigest("e"),
  customLaunchId: previewDigest("f"),
  tokenAddress: "0x2100000000000000000000000000000000000000",
  markets: EXPLORE_PREVIEW_CUSTOM_PROJECT.markets.map((market) => ({
    marketId: market.marketId,
    kind: market.kind,
    status: market.status,
    poolId: `0x${"62".repeat(32)}`,
    baseAsset: {
      ...market.baseAsset,
      identity: {
        ...market.baseAsset.identity,
        value: "0x2100000000000000000000000000000000000000",
      },
    },
    quoteAsset: market.quoteAsset,
  })),
  launchCategoryProvenance: {
    ...EXPLORE_PREVIEW_CUSTOM_PROJECT.launchCategoryProvenance,
    projectId: previewDigest("e"),
    launchId: previewDigest("f"),
  },
};

const EXPLORE_PREVIEW_PROJECTS = new Map<string, ExplorePreviewProject>([
  [
    EXPLORE_PREVIEW_TOKENS[0].tokenAddress.toLowerCase(),
    {
      teamName: "Common Ground Core",
      teamSummary: "Protocol design and open-source infrastructure.",
      contributors: 4,
      communityMembers: 1_842,
    },
  ],
  [
    EXPLORE_PREVIEW_TOKENS[1].tokenAddress.toLowerCase(),
    {
      teamName: "Daybreak Labs",
      teamSummary: "Public-goods funding and mechanism design.",
      contributors: 3,
      communityMembers: 1_268,
    },
  ],
  [
    EXPLORE_PREVIEW_TOKENS[2].tokenAddress.toLowerCase(),
    {
      teamName: "North Star Research",
      teamSummary: "Market structure and liquidity research.",
      contributors: 5,
      communityMembers: 934,
    },
  ],
  [
    EXPLORE_PREVIEW_TOKENS[3].tokenAddress.toLowerCase(),
    {
      teamName: "Atlas Collective",
      teamSummary: "Product research and ecosystem indexing.",
      contributors: 6,
      communityMembers: 2_104,
    },
  ],
  [
    EXPLORE_PREVIEW_TOKENS[4].tokenAddress.toLowerCase(),
    {
      teamName: "After Hours Studio",
      teamSummary: "Independent publishing and community operations.",
      contributors: 3,
      communityMembers: 786,
    },
  ],
  [
    EXPLORE_PREVIEW_TOKENS[5].tokenAddress.toLowerCase(),
    {
      teamName: "Field Notes Cooperative",
      teamSummary: "Open research and contributor programs.",
      contributors: 4,
      communityMembers: 612,
    },
  ],
]);

export function getExplorePreviewToken(address: string) {
  return EXPLORE_PREVIEW_TOKENS.find(
    (token) => token.tokenAddress.toLowerCase() === address.toLowerCase(),
  );
}

export function getExplorePreviewProject(address: string) {
  return EXPLORE_PREVIEW_PROJECTS.get(address.toLowerCase());
}

export function getExplorePreviewCustomProject(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === EXPLORE_PREVIEW_CUSTOM_PROJECT.tokenAddress?.toLowerCase()) {
    return EXPLORE_PREVIEW_CUSTOM_PROJECT;
  }
  if (normalized === EXPLORE_PREVIEW_CUSTOM_PROJECT_NO_TRADE.tokenAddress?.toLowerCase()) {
    return EXPLORE_PREVIEW_CUSTOM_PROJECT_NO_TRADE;
  }
  return undefined;
}

export function getExplorePreviewChart(
  address: string,
  range: PreviewChartRange,
) {
  const token = getExplorePreviewToken(address);
  if (!token) return null;

  const basePrice = Number(BigInt(token.tokenPriceUsdWad ?? "0")) / 1e18;
  const seed = Number.parseInt(token.tokenAddress.slice(-2), 16) || 1;
  const rangeScale = { "1h": 0.012, "1d": 0.035, "1w": 0.072, all: 0.12 }[
    range
  ];
  const curve = [-0.58, -0.32, -0.41, -0.08, 0.05, -0.02, 0.24, 0.18, 0.43];
  const points = curve.map((offset, index) => {
    const value = basePrice * (1 + offset * rangeScale + seed * 0.0015);
    return {
      blockNumber: String(23_100_000 + seed * 420 + index * 52),
      priceEth: (value / 3_500).toFixed(10),
      priceUsd: value.toFixed(8),
    };
  });
  const volumeFactorBps = { "1h": 150n, "1d": 1_800n, "1w": 6_200n, all: 10_000n }[
    range
  ];
  const volumeUsdWad = (
    (BigInt(token.uniswapV4Pool?.volumeUsdWad ?? "0") * volumeFactorBps) /
    10_000n
  ).toString();
  const volumeEth = (
    (Number(token.grossVolumeEth ?? "0") * Number(volumeFactorBps)) /
    10_000
  ).toFixed(2);
  const volumeWei = (
    BigInt(Math.round(Number(volumeEth) * 100)) * 10n ** 16n
  ).toString();

  return {
    status: "ready" as const,
    points,
    swapCount: Math.max(
      8,
      Math.round(
        ((640 + seed * 187) * Number(volumeFactorBps)) / 10_000,
      ),
    ),
    volumeWei,
    volumeEth,
    volumeUsdWad,
  };
}
