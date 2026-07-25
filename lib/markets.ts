export type LauncherMarket = {
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
 * can prove that a market was created through the platform.
 */
export const launcherMarkets: LauncherMarket[] = [];
