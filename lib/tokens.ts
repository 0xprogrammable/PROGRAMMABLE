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

export type PreviewToken = {
  id: string;
  name: string;
  symbol: string;
  launchType: "Auction" | "Direct";
  liquidity: string;
  behavior: string;
  categories: string[];
  tone: "rose" | "violet" | "mint" | "amber";
};

export const previewTokens: PreviewToken[] = [
  {
    id: "preview-pulse",
    name: "Pulse",
    symbol: "PULSE",
    launchType: "Auction",
    liquidity: "Auction funded",
    behavior: "Dynamic fees",
    categories: ["auction", "fees"],
    tone: "rose",
  },
  {
    id: "preview-atlas",
    name: "Atlas",
    symbol: "ATLAS",
    launchType: "Direct",
    liquidity: "Creator supplied",
    behavior: "Fee split",
    categories: ["direct", "fees"],
    tone: "violet",
  },
  {
    id: "preview-bloom",
    name: "Bloom",
    symbol: "BLOOM",
    launchType: "Auction",
    liquidity: "Auction funded",
    behavior: "NFT membership",
    categories: ["auction", "access"],
    tone: "mint",
  },
  {
    id: "preview-relay",
    name: "Relay",
    symbol: "RELAY",
    launchType: "Direct",
    liquidity: "Creator supplied",
    behavior: "Oracle guard",
    categories: ["direct", "custom"],
    tone: "amber",
  },
] as const;
