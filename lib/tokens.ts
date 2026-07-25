export type LauncherToken = {
  id: string;
  name: string;
  symbol: string;
  tokenAddress: `0x${string}`;
  hookAddress: `0x${string}`;
  launchedAt: string;
  behavior: string;
  liquidityPath: "auction" | "direct";
};

/**
 * This collection is intentionally empty until a deployed Launcher registry
 * can prove that a token was created through the platform.
 */
export const launcherTokens: LauncherToken[] = [];

export const sampleTokens = [
  {
    id: "sample-pulse",
    name: "Pulse",
    symbol: "PULSE",
    price: "$0.084",
    change: "+38.4%",
    behavior: "Dynamic fees",
    tone: "rose",
  },
  {
    id: "sample-atlas",
    name: "Atlas",
    symbol: "ATLAS",
    price: "$1.28",
    change: "+21.7%",
    behavior: "Fee split",
    tone: "violet",
  },
  {
    id: "sample-bloom",
    name: "Bloom",
    symbol: "BLOOM",
    price: "$0.42",
    change: "+14.2%",
    behavior: "NFT membership",
    tone: "mint",
  },
  {
    id: "sample-relay",
    name: "Relay",
    symbol: "RELAY",
    price: "$2.06",
    change: "+8.6%",
    behavior: "Auction funded",
    tone: "amber",
  },
] as const;
