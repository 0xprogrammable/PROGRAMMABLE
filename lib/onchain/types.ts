import type { Address, Hex } from "viem";

import type { LauncherToken } from "../tokens";

export type DeploymentEnvironment = "production" | "rehearsal";
export type ClassicReleaseVersion = "classic-v1" | "classic-v2";

type OnchainDeploymentBase = {
  environment: DeploymentEnvironment;
  releaseVersion: ClassicReleaseVersion;
  chainId: 1 | 11_155_111;
  stateView: Address;
  stateViewRuntimeCodeHash: Hex;
  rpcUrl: string;
  confirmations: bigint;
  logBlockRange: bigint;
};

export type ReadyOnchainDeployment = OnchainDeploymentBase & {
  status: "ready";
  launcher: Address;
  feeHook: Address;
  launcherRuntimeCodeHash: Hex;
  feeHookRuntimeCodeHash: Hex;
  deploymentBlock: bigint;
};

export type OnchainDeployment =
  | ReadyOnchainDeployment
  | (OnchainDeploymentBase & {
      status: "not-deployed";
      launcher: null;
      feeHook: null;
      launcherRuntimeCodeHash: null;
      feeHookRuntimeCodeHash: null;
      deploymentBlock: null;
    });
export type LaunchEventRecord = {
  creator: Address;
  token: Address;
  poolId: Hex;
  feeHook: Address;
  positionRecipient: Address;
  positionTokenId: bigint;
  totalSwapFeeBps: number;
  launchHash: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};

export type LiquidityEventRecord = {
  token: Address;
  totalSupply: bigint;
  tokenLiquidityAmount: bigint;
  lockedTokenDust: bigint;
  initialTick: number;
  tickLower: number;
  tickUpper: number;
  lpFeePips: number;
  launchHash: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};

export type InitialBuyEventRecord = {
  creator: Address;
  token: Address;
  poolId: Hex;
  nativeAmount: bigint;
  tokenAmount: bigint;
  launchHash: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};

export type VerifiedLaunchRecord = LaunchEventRecord & {
  liquidity: LiquidityEventRecord;
  initialBuy: InitialBuyEventRecord;
};

export type FeeVolume = {
  grossNativeAmount: bigint;
  creatorFees: bigint;
  launcherFees: bigint;
  swapCount: number;
};

export type CreatorClaimEventRecord = {
  poolId: Hex;
  creator: Address;
  recipient: Address;
  caller: Address;
  amount: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};

export type CreatorClaim = {
  poolId: Hex;
  tokenAddress: Address;
  creatorAddress: Address;
  recipientAddress: Address;
  callerAddress: Address;
  amountWei: string;
  amountEth: string;
  blockNumber: string;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
  claimedAt: string;
};

export type ExploreSnapshot = {
  chainId: number;
  blockNumber: string;
  blockHash: Hex;
  confirmations: number;
};

export type ExploreReadModel =
  | {
      status: "not-deployed";
      tokens: LauncherToken[];
      snapshot: null;
      creatorClaims: CreatorClaim[];
      launcherFeesAccruedWei: "0";
      launcherFeesAccruedEth: "0";
    }
  | {
      status: "ready";
      tokens: LauncherToken[];
      snapshot: ExploreSnapshot;
      creatorClaims: CreatorClaim[];
      launcherFeesAccruedWei: string;
      launcherFeesAccruedEth: string;
    };

export type ExploreSort = "newest" | "oldest" | "market-cap";

export type ExplorePage = {
  status: ExploreReadModel["status"];
  tokens: LauncherToken[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sort: ExploreSort;
  query: string;
  snapshot: ExploreSnapshot | null;
  launcherFeesAccruedWei: string;
  launcherFeesAccruedEth: string;
};

export type CreatorProfilePool = {
  tokenAddress: Address;
  name: string;
  symbol: string;
  poolId: Hex;
  totalSwapFeeBps: number;
  claimableCreatorFeesWei: string;
  claimableCreatorFeesEth: string;
  generatedCreatorFeesWei: string;
  generatedCreatorFeesEth: string;
};

export type CreatorProfile = {
  status: ExploreReadModel["status"];
  account: Address;
  tokens: LauncherToken[];
  pools: CreatorProfilePool[];
  claims: CreatorClaim[];
  totals: {
    claimableWei: string;
    claimableEth: string;
    generatedWei: string;
    generatedEth: string;
    claimedWei: string;
    claimedEth: string;
  };
  snapshot: ExploreSnapshot | null;
};

export type CreatorClaimRequest = {
  account: Address;
  poolId: Hex;
  chainId: number;
};

export type CreatorClaimIntent = {
  account: Address;
  poolId: Hex;
  tokenAddress: Address;
  hookAddress: Address;
  snapshotClaimableWei: string;
  snapshotClaimableEth: string;
  snapshot: ExploreSnapshot;
  transaction: {
    kind: "claim-creator-fees";
    chainId: number;
    from: Address;
    to: Address;
    data: Hex;
    value: "0";
  };
};

export type PreparedCreatorClaim = {
  status: "ready";
  claim: {
    account: Address;
    poolId: Hex;
    tokenAddress: Address;
    hookAddress: Address;
    snapshotClaimableWei: string;
    snapshotClaimableEth: string;
  };
  snapshot: ExploreSnapshot;
  transaction: CreatorClaimIntent["transaction"] & {
    gasLimit: string;
  };
  gas: {
    estimatedGas: string;
    gasLimit: string;
    gasPriceWei: string;
    estimatedMaxCostWei: string;
    accountBalanceWei: string;
    balanceSufficient: boolean;
  };
  submission: {
    status: "not-submitted";
    transactionHash: null;
    receipt: null;
  };
};

export type CreatorClaimPreparationError = {
  status: "not-deployed" | "blocked";
  error: {
    code: string;
    message: string;
  };
  claim: null;
  snapshot: null;
  transaction: null;
  gas: null;
  submission: {
    status: "not-submitted";
    transactionHash: null;
    receipt: null;
  };
};
