import type {
  CanonicalTokenExploreEntry,
  CustomProjectExploreEntry,
} from "@/lib/tokens";
import {
  CREATOR_ARTICLE_SCHEMA_V1,
  parseCreatorArticleV1,
} from "@/lib/creator-article/contract-v1";
import {
  PROGRAMMABLE_MAIN_TOKEN_ADDRESS,
  programmableCreatorArticleExampleV1,
} from "@/lib/creator-article/programmable-example-v1";

type PreviewChartRange = "1h" | "1d" | "1w" | "all";

export type ExplorePreviewProject = {
  teamName: string;
  teamSummary: string;
  contributors: number;
  communityMembers: number;
};

const PROJECT_LINKS = [
  { kind: "website" as const, url: "https://programmable.market" },
  { kind: "x" as const, url: "https://x.com/ProgrammableHQ" },
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
    name: "Sway",
    symbol: "SWAY",
    description:
      "A market that adjusts its trading rhythm as participation changes.",
    imageUrl: "/brand/atmosphere/programmable-floral-hooks-v1.avif",
    launchedAt: "2026-08-02T09:40:00.000Z",
    marketCapUsd: "184600000000000000000000",
    priceUsd: "18400000000000000",
    volumeUsd: "1240000000000000000000000",
    liquidityUsd: "620000000000000000000000",
    volumeEth: "354.28",
    launchModel: "classic",
    totalSwapFeeBps: 100,
  }),
  makePreviewToken({
    id: 2,
    name: "Lumen",
    symbol: "LMN",
    description:
      "A shared pool whose fee logic responds to liquidity conditions.",
    imageUrl: "/brand/atmosphere/programmable-floral-hooks-v1.avif",
    launchedAt: "2026-08-01T18:15:00.000Z",
    marketCapUsd: "427200000000000000000000",
    priceUsd: "42700000000000000",
    volumeUsd: "870000000000000000000000",
    liquidityUsd: "448000000000000000000000",
    volumeEth: "248.57",
    launchModel: "adaptive",
    totalSwapFeeBps: 75,
  }),
  makePreviewToken({
    id: 3,
    name: "Orbit",
    symbol: "ORBT",
    description:
      "A market built around transparent pool rules and public data.",
    imageUrl: "/brand/atmosphere/programmable-floral-hooks-v1.avif",
    launchedAt: "2026-08-01T11:05:00.000Z",
    marketCapUsd: "96400000000000000000000",
    priceUsd: "9600000000000000",
    volumeUsd: "642000000000000000000000",
    liquidityUsd: "389000000000000000000000",
    volumeEth: "183.43",
    launchModel: "deep",
    totalSwapFeeBps: 125,
  }),
  makePreviewToken({
    id: 4,
    name: "Verdant",
    symbol: "VRDT",
    description:
      "A pool that routes part of its activity toward creator rewards.",
    imageUrl: "/brand/atmosphere/programmable-floral-hooks-v1.avif",
    launchedAt: "2026-07-31T16:30:00.000Z",
    marketCapUsd: "251800000000000000000000",
    priceUsd: "25100000000000000",
    volumeUsd: "381000000000000000000000",
    liquidityUsd: "276000000000000000000000",
    volumeEth: "108.86",
    launchModel: "classic",
    totalSwapFeeBps: 100,
  }),
  makePreviewToken({
    id: 5,
    name: "Halo",
    symbol: "HALO",
    description:
      "A simple fixed-supply launch with permanently locked liquidity.",
    imageUrl: "/brand/atmosphere/programmable-floral-hooks-v1.avif",
    launchedAt: "2026-07-30T21:20:00.000Z",
    marketCapUsd: "138100000000000000000000",
    priceUsd: "13800000000000000",
    volumeUsd: "194000000000000000000000",
    liquidityUsd: "158000000000000000000000",
    volumeEth: "55.43",
    launchModel: "adaptive",
    totalSwapFeeBps: 80,
  }),
  makePreviewToken({
    id: 6,
    name: "Drift",
    symbol: "DRFT",
    description:
      "A market with custom execution rules at the pool level.",
    imageUrl: "/brand/atmosphere/programmable-floral-hooks-v1.avif",
    launchedAt: "2026-07-29T14:10:00.000Z",
    marketCapUsd: "319700000000000000000000",
    priceUsd: "31900000000000000",
    volumeUsd: "96000000000000000000000",
    liquidityUsd: "112000000000000000000000",
    volumeEth: "27.43",
    launchModel: "deep",
    totalSwapFeeBps: 120,
  }),
  makePreviewToken({
    id: 7,
    name: "Ember",
    symbol: "EMBR",
    description: "A compact launch designed around clear, fixed rules.",
    imageUrl: "/brand/atmosphere/programmable-floral-hooks-v1.avif",
    launchedAt: "2026-07-28T13:20:00.000Z",
    marketCapUsd: "67900000000000000000000",
    priceUsd: "6700000000000000",
    volumeUsd: "61000000000000000000000",
    liquidityUsd: "82000000000000000000000",
    volumeEth: "18.25",
    launchModel: "classic",
    totalSwapFeeBps: 100,
  }),
  makePreviewToken({
    id: 8,
    name: "Mosaic",
    symbol: "MSAIC",
    description: "A composable market for experiments with custom Hooks.",
    imageUrl: "/brand/atmosphere/programmable-floral-hooks-v1.avif",
    launchedAt: "2026-07-27T10:30:00.000Z",
    marketCapUsd: "563500000000000000000000",
    priceUsd: "56300000000000000",
    volumeUsd: "172000000000000000000000",
    liquidityUsd: "204000000000000000000000",
    volumeEth: "49.14",
    launchModel: "adaptive",
    totalSwapFeeBps: 200,
  }),
  makePreviewToken({
    id: 9,
    name: "Atlas",
    symbol: "ATLS",
    description: "A public index for onchain markets and their rules.",
    imageUrl: "/brand/atmosphere/programmable-floral-hooks-v1.avif",
    launchedAt: "2026-07-26T08:05:00.000Z",
    marketCapUsd: "216300000000000000000000",
    priceUsd: "21600000000000000",
    volumeUsd: "113000000000000000000000",
    liquidityUsd: "151000000000000000000000",
    volumeEth: "32.29",
    launchModel: "classic",
    totalSwapFeeBps: 100,
  }),
];

const PROGRAMMABLE_MAIN_PREVIEW_TOKEN: CanonicalTokenExploreEntry = {
  ...EXPLORE_PREVIEW_TOKENS[0]!,
  id: `interface-preview:${PROGRAMMABLE_MAIN_TOKEN_ADDRESS.toLowerCase()}`,
  name: "Programmable",
  symbol: "V4",
  description: "Launch tokens that work the way you imagine on Uniswap",
  imageUrl: "/brand/programmable-final-x-pfp-v4-800.png",
  tokenAddress: PROGRAMMABLE_MAIN_TOKEN_ADDRESS,
};

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
  links: [{ kind: "website", url: "https://programmable.market" }],
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
  [
    EXPLORE_PREVIEW_TOKENS[6].tokenAddress.toLowerCase(),
    {
      teamName: "Ember Works",
      teamSummary: "Simple market tools and public documentation.",
      contributors: 3,
      communityMembers: 548,
    },
  ],
  [
    EXPLORE_PREVIEW_TOKENS[7].tokenAddress.toLowerCase(),
    {
      teamName: "Mosaic Studio",
      teamSummary: "Composable market experiments and Hook research.",
      contributors: 5,
      communityMembers: 1_124,
    },
  ],
  [
    EXPLORE_PREVIEW_TOKENS[8].tokenAddress.toLowerCase(),
    {
      teamName: "Atlas Index",
      teamSummary: "Public indexing for onchain markets and their rules.",
      contributors: 4,
      communityMembers: 972,
    },
  ],
]);

export function getExplorePreviewToken(address: string) {
  if (address.toLowerCase() === PROGRAMMABLE_MAIN_TOKEN_ADDRESS.toLowerCase()) {
    return PROGRAMMABLE_MAIN_PREVIEW_TOKEN;
  }
  return EXPLORE_PREVIEW_TOKENS.find(
    (token) => token.tokenAddress.toLowerCase() === address.toLowerCase(),
  );
}

export function getExplorePreviewCreatorArticle(address: string) {
  if (address.toLowerCase() !== PROGRAMMABLE_MAIN_TOKEN_ADDRESS.toLowerCase()) {
    return null;
  }
  const draft = programmableCreatorArticleExampleV1();
  return parseCreatorArticleV1({
    ...draft,
    schemaVersion: CREATOR_ARTICLE_SCHEMA_V1,
    revision: 1,
    status: "published",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  });
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
