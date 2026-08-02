import type { LauncherToken } from "@/lib/tokens";

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
}): LauncherToken {
  const tokenAddress = `0x${input.id.toString(16).padStart(40, "0")}` as const;
  const hookAddress = `0x${(input.id + 100).toString(16).padStart(40, "0")}` as const;
  const creatorAddress = `0x${(input.id + 200).toString(16).padStart(40, "0")}` as const;
  const poolId = `0x${(input.id + 300).toString(16).padStart(64, "0")}` as const;

  return {
    id: `interface-preview-${input.id}`,
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

export const EXPLORE_PREVIEW_TOKENS: LauncherToken[] = [
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
