export type RobinhoodLaunch = Readonly<{
  routerAddress: string;
  launchId: string;
  tokenAddress: string;
  hookAddress: string;
  creator: string;
  poolManager: string;
  poolId: string;
  stampHash: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
  launchedAt: string | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
}>;

export type RobinhoodLaunchList = Readonly<{
  chainId: 4663;
  status: "ready" | "syncing" | "stale" | "unavailable";
  updatedAt: string | null;
  items: readonly RobinhoodLaunch[];
  page: Readonly<{
    number: number;
    size: 50;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
  }>;
}>;
