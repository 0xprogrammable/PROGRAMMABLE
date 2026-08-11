import "server-only";

import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import { buildCreatorProfile } from "../onchain/profile";
import {
  creatorFeeHookReadAbi,
  creatorFeesClaimedEvent,
} from "../onchain/abis";
import {
  isOperationalRpcFailoverEligible,
  withOperationalRpcFailover,
} from "../onchain/operational-rpc-failover.server";
import type {
  CreatorClaim,
  CreatorProfile,
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "../onchain/types";
import type { LauncherToken } from "../tokens";

const CLAIM_LOG_BATCH_CONCURRENCY = 4;
const MAX_PROFILE_CLAIM_CURSORS = 128;

export class AlchemyCreatorProfileIntegrityError extends Error {
  override name = "AlchemyCreatorProfileIntegrityError";

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}

type RecentClaimReadInput = Readonly<{
  account: Address;
  deployment: ReadyOnchainDeployment;
  fromBlock: bigint;
  toBlock: bigint;
  hookAddresses: readonly Address[];
  tokenByPool: ReadonlyMap<string, LauncherToken>;
}>;

type RecentClaimCursor = Readonly<{
  cursorBlock: bigint;
  claims: readonly CreatorClaim[];
}>;

const recentClaimCursors = new Map<string, Promise<RecentClaimCursor>>();

function isUnsignedInteger(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value);
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/iu.test(value);
}

function isVerifiedLegacyDirectReward(
  token: LauncherToken,
  deployment: ReadyOnchainDeployment,
) {
  return (
    token.launchStampProvenance === undefined &&
    token.launchModel === "classic" &&
    token.liquidityPath === "meme" &&
    token.hookAddress.toLowerCase() === deployment.feeHook.toLowerCase() &&
    isBytes32(token.poolId) &&
    isBytes32(token.launchHash) &&
    isBytes32(token.launchTransactionHash) &&
    typeof token.positionRecipient === "string" &&
    /^0x[0-9a-f]{40}$/iu.test(token.positionRecipient) &&
    isUnsignedInteger(token.positionTokenId) &&
    typeof token.totalSwapFeeBps === "number" &&
    Number.isSafeInteger(token.totalSwapFeeBps) &&
    token.totalSwapFeeBps >= 0 &&
    isUnsignedInteger(token.creatorFeesAccruedWei) &&
    isUnsignedInteger(token.creatorFeesGeneratedWei)
  );
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

async function scanRecentClaims(input: RecentClaimReadInput) {
  if (
    input.fromBlock > input.toBlock ||
    input.hookAddresses.length === 0
  ) {
    return [] satisfies CreatorClaim[];
  }
  const client = createPublicClient({
    chain: input.deployment.chainId === 1 ? mainnet : sepolia,
    transport: http(input.deployment.rpcUrl, {
      retryCount: 2,
      timeout: 12_000,
    }),
  });
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (
    let fromBlock = input.fromBlock;
    fromBlock <= input.toBlock;
    fromBlock += input.deployment.logBlockRange
  ) {
    ranges.push({
      fromBlock,
      toBlock: minimum(
        input.toBlock,
        fromBlock + input.deployment.logBlockRange - 1n,
      ),
    });
  }

  const readRange = (range: { fromBlock: bigint; toBlock: bigint }) =>
    client.getLogs({
      address: [...input.hookAddresses],
      event: creatorFeesClaimedEvent,
      args: {
        poolId: [...input.tokenByPool.values()].map(
          (token) => token.poolId as Hex,
        ),
        creator: input.account,
      },
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      strict: true,
    });
  type CreatorClaimLog = Awaited<ReturnType<typeof readRange>>[number];
  const logs: CreatorClaimLog[] = [];
  for (
    let offset = 0;
    offset < ranges.length;
    offset += CLAIM_LOG_BATCH_CONCURRENCY
  ) {
    const results = await Promise.all(
      ranges
        .slice(offset, offset + CLAIM_LOG_BATCH_CONCURRENCY)
        .map(readRange),
    );
    logs.push(...results.flat());
  }

  const canonicalLogs = logs.filter((log) => !log.removed);
  const blockNumbers = [...new Set(
    canonicalLogs
      .map((log) => log.blockNumber)
      .filter((block): block is bigint => block !== null)
      .map(String),
  )].map(BigInt);
  const timestamps = new Map<string, bigint>();
  await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber });
      timestamps.set(blockNumber.toString(), block.timestamp);
    }),
  );

  return canonicalLogs.map((log): CreatorClaim => {
    if (
      log.blockNumber === null ||
      !log.transactionHash ||
      log.transactionIndex === null ||
      log.logIndex === null
    ) {
      throw new AlchemyCreatorProfileIntegrityError(
        "Creator claim log identity is incomplete",
      );
    }
    const token = input.tokenByPool.get(log.args.poolId.toLowerCase());
    if (!token) {
      throw new AlchemyCreatorProfileIntegrityError(
        "Creator claim pool is outside the verified profile",
      );
    }
    const timestamp = timestamps.get(log.blockNumber.toString());
    if (timestamp === undefined) {
      throw new AlchemyCreatorProfileIntegrityError(
        "Creator claim timestamp is unavailable",
      );
    }
    return {
      poolId: log.args.poolId,
      tokenAddress: getAddress(token.tokenAddress),
      creatorAddress: log.args.creator,
      recipientAddress: log.args.recipient,
      callerAddress: log.args.caller,
      amountWei: log.args.amount.toString(),
      amountEth: formatUnits(log.args.amount, 18),
      blockNumber: log.blockNumber.toString(),
      transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex,
      logIndex: log.logIndex,
      claimedAt: new Date(Number(timestamp) * 1_000).toISOString(),
    };
  });
}

function recentClaimCursorKey(input: RecentClaimReadInput) {
  return [
    input.deployment.chainId,
    input.deployment.rpcUrl,
    input.account.toLowerCase(),
    input.fromBlock.toString(),
    ...input.hookAddresses.map((address) => address.toLowerCase()).sort(),
    ...[...input.tokenByPool.keys()].sort(),
  ].join(":");
}

async function readRecentClaims(input: RecentClaimReadInput) {
  const key = recentClaimCursorKey(input);
  const initial: RecentClaimCursor = {
    cursorBlock: input.fromBlock - 1n,
    claims: [],
  };
  const previous = recentClaimCursors.get(key) ?? Promise.resolve(initial);
  const current = previous.then(async (cursor): Promise<RecentClaimCursor> => {
    if (cursor.cursorBlock >= input.toBlock) return cursor;
    const claims = await scanRecentClaims({
      ...input,
      fromBlock:
        cursor.cursorBlock + 1n > input.fromBlock
          ? cursor.cursorBlock + 1n
          : input.fromBlock,
    });
    const merged = new Map(
      [...cursor.claims, ...claims].map((claim) => [
        `${claim.transactionHash.toLowerCase()}:${claim.logIndex}`,
        claim,
      ]),
    );
    return {
      cursorBlock: input.toBlock,
      claims: [...merged.values()],
    };
  });
  recentClaimCursors.set(key, current);
  current.catch(() => {
    if (recentClaimCursors.get(key) === current) {
      recentClaimCursors.delete(key);
    }
  });
  while (recentClaimCursors.size > MAX_PROFILE_CLAIM_CURSORS) {
    const oldest = recentClaimCursors.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    recentClaimCursors.delete(oldest);
  }
  return (await current).claims;
}

async function readAlchemyCreatorProfileFromRpc(input: {
  account: Address;
  deployment: ReadyOnchainDeployment;
  model: ExploreReadModel;
}): Promise<CreatorProfile> {
  if (input.model.status !== "ready") {
    return buildCreatorProfile(input.model, input.account, new Set());
  }

  const normalizedAccount = input.account.toLowerCase();
  const ownedTokens = input.model.tokens.filter(
    (token) =>
      token.creatorAddress?.toLowerCase() === normalizedAccount,
  );
  const directRewardTokens = ownedTokens.filter((token) =>
    isVerifiedLegacyDirectReward(token, input.deployment),
  );
  const tokenByPool = new Map(
    directRewardTokens.map((token) => [token.poolId.toLowerCase(), token]),
  );
  const directRewardPoolIds = new Set(tokenByPool.keys());
  const liveSnapshot =
    input.model.launchDiscoverySnapshot ?? input.model.snapshot;
  const liveBlock = BigInt(liveSnapshot.blockNumber);
  const baseBlock = BigInt(input.model.snapshot.blockNumber);
  if (liveBlock < baseBlock) {
    throw new AlchemyCreatorProfileIntegrityError(
      "Creator profile snapshot moved behind its verified base",
    );
  }
  const client = createPublicClient({
    chain: input.deployment.chainId === 1 ? mainnet : sepolia,
    transport: http(input.deployment.rpcUrl, {
      retryCount: 2,
      timeout: 12_000,
    }),
  });

  const [poolStates, recentClaims] = await Promise.all([
    directRewardTokens.length
      ? client.multicall({
          allowFailure: true,
          blockNumber: liveBlock,
          contracts: directRewardTokens.map((token) => ({
            address: getAddress(token.hookAddress),
            abi: creatorFeeHookReadAbi,
            functionName: "poolFeeConfig" as const,
            args: [token.poolId as Hex],
          })),
        })
      : Promise.resolve([]),
    readRecentClaims({
      account: input.account,
      deployment: input.deployment,
      fromBlock: baseBlock + 1n,
      toBlock: liveBlock,
      hookAddresses: [...new Set(
        directRewardTokens.map((token) => token.hookAddress.toLowerCase()),
      )].map((address) => getAddress(address)),
      tokenByPool,
    }),
  ]);

  if (poolStates.length !== directRewardTokens.length) {
    throw new AlchemyCreatorProfileIntegrityError(
      "Creator reward pool results are incomplete",
    );
  }

  const claims = new Map(
    [...input.model.creatorClaims, ...recentClaims]
      .filter(
        (claim) =>
          claim.creatorAddress.toLowerCase() === normalizedAccount &&
          tokenByPool.has(claim.poolId.toLowerCase()),
      )
      .map((claim) => [
        `${claim.transactionHash.toLowerCase()}:${claim.logIndex}`,
        claim,
      ]),
  );
  const claimedByPool = new Map<string, bigint>();
  for (const claim of claims.values()) {
    const key = claim.poolId.toLowerCase();
    claimedByPool.set(
      key,
      (claimedByPool.get(key) ?? 0n) + BigInt(claim.amountWei),
    );
  }

  const refreshed = new Map<string, LauncherToken>();
  directRewardTokens.forEach((token, index) => {
    const result = poolStates[index];
    if (result?.status !== "success") {
      throw new AlchemyCreatorProfileIntegrityError(
        "Creator reward pool state could not be verified",
        result?.error,
      );
    }
    const [creator, , , registered, accrued] = result.result;
    if (!registered || creator.toLowerCase() !== normalizedAccount) {
      throw new AlchemyCreatorProfileIntegrityError(
        "Creator reward pool ownership does not match",
      );
    }
    const claimed = claimedByPool.get(token.poolId.toLowerCase()) ?? 0n;
    refreshed.set(token.tokenAddress.toLowerCase(), {
      ...token,
      creatorFeesAccruedWei: accrued.toString(),
      creatorFeesAccruedEth: formatUnits(accrued, 18),
      creatorFeesGeneratedWei: (claimed + accrued).toString(),
      creatorFeesGeneratedEth: formatUnits(claimed + accrued, 18),
    });
  });

  const scopedModel: ExploreReadModel = {
    ...input.model,
    tokens: input.model.tokens
      .map(
        (token) =>
          refreshed.get(token.tokenAddress.toLowerCase()) ?? token,
      ),
    creatorClaims: [...claims.values()],
    snapshot: {
      ...liveSnapshot,
      ethUsdQuote: input.model.snapshot.ethUsdQuote,
    },
  };
  return buildCreatorProfile(
    scopedModel,
    input.account,
    directRewardPoolIds,
  );
}

export async function readAlchemyCreatorProfile(input: {
  account: Address;
  deployment: ReadyOnchainDeployment;
  model: ExploreReadModel;
}): Promise<CreatorProfile> {
  return withOperationalRpcFailover(
    input.deployment,
    async (deployment) => {
      try {
        return await readAlchemyCreatorProfileFromRpc({
          ...input,
          deployment,
        });
      } catch (error) {
        if (isOperationalRpcFailoverEligible(error)) throw error;
        if (error instanceof AlchemyCreatorProfileIntegrityError) throw error;
        throw new AlchemyCreatorProfileIntegrityError(
          "Creator reward data could not be verified",
          error,
        );
      }
    },
  );
}
