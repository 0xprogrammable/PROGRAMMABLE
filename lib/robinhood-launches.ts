export type RobinhoodLaunch = Readonly<{
  routerAddress: string | null;
  launchId: string;
  tokenAddress: string;
  hookAddress: string;
  creator: string;
  poolManager: string;
  poolId: string;
  stampHash: string | null;
  sourceKind?: "module-native-v1";
  sourceAddress?: string;
  sourceReleaseDigest?: string;
  recipeHash?: string;
  runtime?: string;
  launchKey?: string;
  verificationDigest?: string;
  modulePackageIds?: readonly string[];
  moduleFamilyIds?: readonly string[];
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

export type RobinhoodProfileLaunchList = RobinhoodLaunchList & Readonly<{
  account: string;
}>;

/** Module Mode is a separate canonical source; it never receives a fabricated Router stamp. */
export type RobinhoodModuleLaunch = RobinhoodLaunch & Readonly<{
  sourceKind: "module-native-v1";
  routerAddress: null;
  stampHash: null;
  sourceAddress: string;
  sourceReleaseDigest: string;
  recipeHash: string;
  runtime: string;
  launchKey: string;
  verificationDigest: string;
  modulePackageIds: readonly string[];
  moduleFamilyIds: readonly string[];
}>;
