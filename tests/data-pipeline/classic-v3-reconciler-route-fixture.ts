import type { CanonicalJsonValue } from "../../lib/data-pipeline/canonical-fingerprint";
import {
  assembleClassicV3ReconcilerRoutes,
  type ClassicV3ReconcilerRouteParts,
} from "../../lib/data-pipeline/classic-v3-reconciler-route-contract";

export const ROUTE_FIXTURE_ADDRESS = `0x${"11".repeat(20)}`;
export const ROUTE_FIXTURE_CREATOR = `0x${"22".repeat(20)}`;
export const ROUTE_FIXTURE_HOOK = `0x${"33".repeat(20)}`;
export const ROUTE_FIXTURE_VAULT = `0x${"44".repeat(20)}`;
export const ROUTE_FIXTURE_RECIPIENT = `0x${"55".repeat(20)}`;
export const ROUTE_FIXTURE_TRANSACTION = `0x${"66".repeat(32)}`;
export const ROUTE_FIXTURE_BLOCK_HASH = `0x${"77".repeat(32)}`;
export const ROUTE_FIXTURE_POOL = `0x${"88".repeat(32)}`;
export const ROUTE_FIXTURE_LAUNCH_HASH = `0x${"99".repeat(32)}`;

const token: CanonicalJsonValue = {
  tokenAddress: ROUTE_FIXTURE_ADDRESS,
  creatorAddress: ROUTE_FIXTURE_CREATOR,
  launchTransactionHash: ROUTE_FIXTURE_TRANSACTION,
  launchBlockNumber: "25700000",
  launchTransactionIndex: 3,
  launchLogIndex: 4,
  launchedAt: "2026-07-31T12:34:56.000Z",
  poolId: ROUTE_FIXTURE_POOL,
  hookAddress: ROUTE_FIXTURE_HOOK,
  rewardVaultAddress: ROUTE_FIXTURE_VAULT,
  positionRecipient: ROUTE_FIXTURE_RECIPIENT,
  positionTokenId: "42",
  launchHash: ROUTE_FIXTURE_LAUNCH_HASH,
  name: "Fixture Token",
  symbol: "FIX",
  decimals: 18,
  totalSupplyRaw: "1000000000000000000000000000",
  fees: {
    buySwapFeeBps: 100,
    sellSwapFeeBps: 100,
    buyCreatorFeeBps: 90,
    sellCreatorFeeBps: 90,
    launcherFeeBps: 10,
    transferTaxBps: 0,
    lpFeePips: 0,
  },
  liquidity: {
    tokenLiquidityAmountRaw: "999999999999999999999999999",
    lockedTokenDustRaw: "1",
    initialTick: 120,
    tickLower: -887220,
    tickUpper: 120,
  },
};

const chart: CanonicalJsonValue = {
  tokenAddress: ROUTE_FIXTURE_ADDRESS,
  poolId: ROUTE_FIXTURE_POOL,
  state: {
    blockNumber: "25700001",
    blockHash: ROUTE_FIXTURE_BLOCK_HASH,
    transactionHash: ROUTE_FIXTURE_TRANSACTION,
    transactionIndex: 5,
    logIndex: 8,
    sqrtPriceX96: "79228162514264337593543950336",
    liquidity: "123456789",
    tick: 0,
    lpFeePips: 0,
  },
  volume: {
    grossNativeWei: "1000000000000000000",
    creatorFeeWei: "9000000000000000",
    launcherFeeWei: "1000000000000000",
  },
};

const reward: CanonicalJsonValue = {
  vaultAddress: ROUTE_FIXTURE_VAULT,
  poolId: ROUTE_FIXTURE_POOL,
  tokenAddress: ROUTE_FIXTURE_ADDRESS,
  tokenName: "Fixture Token",
  tokenSymbol: "FIX",
  launchTransactionHash: ROUTE_FIXTURE_TRANSACTION,
  buySwapFeeBps: 100,
  sellSwapFeeBps: 100,
  launcherFeeBps: 10,
  allocations: [{
    allocationIndex: 0,
    payoutAddress: ROUTE_FIXTURE_RECIPIENT,
    shareBps: 10000,
    claimableWei: "9000000000000000",
    claimedWei: "0",
  }],
};

export const CLASSIC_V3_RECONCILER_ROUTE_FIXTURE_PARTS:
  ClassicV3ReconcilerRouteParts = Object.freeze({
    tokens: Object.freeze([token]),
    charts: Object.freeze([chart]),
    profiles: Object.freeze([{
      account: ROUTE_FIXTURE_CREATOR,
      tokens: [{
        tokenAddress: ROUTE_FIXTURE_ADDRESS,
        launchTransactionHash: ROUTE_FIXTURE_TRANSACTION,
      }],
    }]),
    rewards: Object.freeze([reward]),
    launches: Object.freeze([{
      account: ROUTE_FIXTURE_CREATOR,
      launchTransactionHash: ROUTE_FIXTURE_TRANSACTION,
      tokenAddress: ROUTE_FIXTURE_ADDRESS,
    }]),
  });

export function classicV3ReconcilerRouteFixture() {
  return assembleClassicV3ReconcilerRoutes(
    CLASSIC_V3_RECONCILER_ROUTE_FIXTURE_PARTS,
  );
}
