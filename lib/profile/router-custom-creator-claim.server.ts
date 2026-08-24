import "server-only";

import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import type { CreatorClaim, CreatorProfile } from "../onchain/types";
import { creatorFeesClaimedEvent } from "../onchain/abis";
import type { CanonicalTokenExploreEntry } from "../tokens";
import {
  resolveRouterCustomCreatorClaimCapabilityV1,
  routerCustomCreatorClaimProfileCapabilityV1,
  type RouterCustomCreatorClaimCapabilityV1,
} from "./router-custom-creator-claim";

export const fadeRouterCustomClaimHookAbi = parseAbi([
  "function poolFeeConfig(bytes32 poolId) view returns (address creator,address registrar,uint64 launchTimestamp,bool registered,uint256 creatorFeesAccrued)",
  "function currentTotalSwapFeeBps(bytes32 poolId) view returns (uint16)",
  "function claimCreatorFees(bytes32 poolId) returns (uint256 amount)",
]);

const creatorTokenAbi = parseAbi([
  "function creator() view returns (address)",
]);

const CLAIM_LOG_RANGE = 10_000n;

export class RouterCustomCreatorClaimError extends Error {
  readonly code: "identity-mismatch" | "runtime-mismatch";

  constructor(
    code: "identity-mismatch" | "runtime-mismatch",
    message: string,
  ) {
    super(message);
    this.name = "RouterCustomCreatorClaimError";
    this.code = code;
  }
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function requireCanonicalCapabilityEntry(
  entry: CanonicalTokenExploreEntry,
) {
  const capability = resolveRouterCustomCreatorClaimCapabilityV1(entry);
  const category = entry.launchCategoryProvenance;
  const stamp = entry.launchStampProvenance;
  if (
    !capability ||
    !stamp ||
    entry.exploreKind !== "token" ||
    category.source !== "canonical-launch-stamp-router" ||
    category.category !== "custom" ||
    !sameHex(category.launchId, capability.launchId) ||
    !sameHex(category.stampHash, stamp.stampHash) ||
    !sameHex(category.routerAddress, stamp.routerAddress) ||
    !sameHex(category.transactionHash, stamp.transactionHash) ||
    !sameHex(category.blockHash, stamp.blockHash) ||
    category.blockNumber !== stamp.blockNumber ||
    category.transactionIndex !== stamp.transactionIndex ||
    category.logIndex !== stamp.launchLogIndex
  ) {
    throw new RouterCustomCreatorClaimError(
      "identity-mismatch",
      "The Router Custom creator claim is not bound to its finalized launch stamp",
    );
  }
  return capability;
}

export function requireRouterCustomCreatorClaimEntryV1(input: Readonly<{
  entries: readonly CanonicalTokenExploreEntry[];
  chainId: number;
  poolId: Hex;
}>) {
  const matches = input.entries.filter((entry) =>
    entry.launchStampProvenance?.chainId === input.chainId &&
    sameHex(entry.poolId, input.poolId)
  );
  if (matches.length !== 1) {
    throw new RouterCustomCreatorClaimError(
      "identity-mismatch",
      matches.length === 0
        ? "The Router Custom creator claim has no finalized launch stamp"
        : "The Router Custom creator claim has ambiguous launch provenance",
    );
  }
  const entry = matches[0]!;
  return Object.freeze({
    entry,
    capability: requireCanonicalCapabilityEntry(entry),
  });
}

function requireRuntime(
  code: Hex | undefined,
  expectedHash: Hex,
  label: string,
) {
  if (
    !code ||
    code === "0x" ||
    !sameHex(keccak256(code), expectedHash)
  ) {
    throw new RouterCustomCreatorClaimError(
      "runtime-mismatch",
      `The Router Custom creator claim ${label} runtime is not verified`,
    );
  }
}

export type RouterCustomCreatorClaimStateV1 = Readonly<{
  capability: RouterCustomCreatorClaimCapabilityV1;
  claimable: bigint;
  currentTotalSwapFeeBps: number;
}>;

export async function readRouterCustomCreatorClaimStateV1(input: Readonly<{
  client: PublicClient;
  entry: CanonicalTokenExploreEntry;
  blockNumber: bigint;
}>): Promise<RouterCustomCreatorClaimStateV1> {
  const capability = requireCanonicalCapabilityEntry(input.entry);
  const stamp = input.entry.launchStampProvenance!;
  if (BigInt(stamp.finalizedAtBlockNumber) > input.blockNumber) {
    throw new RouterCustomCreatorClaimError(
      "identity-mismatch",
      "The Router Custom creator claim is not finalized at this snapshot",
    );
  }

  const [
    tokenCode,
    hookCode,
    registrarCode,
    routeLauncherCode,
    recordedTokenCreator,
    config,
    currentTotalSwapFeeBps,
  ] = await Promise.all([
    input.client.getCode({
      address: capability.tokenAddress,
      blockNumber: input.blockNumber,
    }),
    input.client.getCode({
      address: capability.hookAddress,
      blockNumber: input.blockNumber,
    }),
    input.client.getCode({
      address: capability.registrarAddress,
      blockNumber: input.blockNumber,
    }),
    input.client.getCode({
      address: capability.routeLauncherAddress,
      blockNumber: input.blockNumber,
    }),
    input.client.readContract({
      address: capability.tokenAddress,
      abi: creatorTokenAbi,
      functionName: "creator",
      blockNumber: input.blockNumber,
    }),
    input.client.readContract({
      address: capability.hookAddress,
      abi: fadeRouterCustomClaimHookAbi,
      functionName: "poolFeeConfig",
      args: [capability.poolId],
      blockNumber: input.blockNumber,
    }),
    input.client.readContract({
      address: capability.hookAddress,
      abi: fadeRouterCustomClaimHookAbi,
      functionName: "currentTotalSwapFeeBps",
      args: [capability.poolId],
      blockNumber: input.blockNumber,
    }),
  ]);

  requireRuntime(
    tokenCode,
    capability.tokenRuntimeCodeHash,
    "token",
  );
  requireRuntime(
    hookCode,
    capability.hookRuntimeCodeHash,
    "hook",
  );
  requireRuntime(
    registrarCode,
    capability.registrarRuntimeCodeHash,
    "registrar",
  );
  requireRuntime(
    routeLauncherCode,
    capability.routeLauncherRuntimeCodeHash,
    "route launcher",
  );

  const [creator, registrar, launchTimestamp, registered, claimable] = config;
  const currentFee = Number(currentTotalSwapFeeBps);
  if (
    !registered ||
    !sameHex(getAddress(creator), capability.creatorAddress) ||
    !sameHex(getAddress(registrar), capability.registrarAddress) ||
    !sameHex(getAddress(recordedTokenCreator), capability.registrarAddress) ||
    !sameHex(getAddress(recordedTokenCreator), getAddress(registrar)) ||
    launchTimestamp !== capability.launchTimestamp ||
    !Number.isSafeInteger(currentFee) ||
    currentFee < 100 ||
    currentFee > 300
  ) {
    throw new RouterCustomCreatorClaimError(
      "identity-mismatch",
      "The Router Custom creator fee state does not match the reviewed capability",
    );
  }

  return Object.freeze({
    capability,
    claimable,
    currentTotalSwapFeeBps: currentFee,
  });
}

async function readRouterCustomCreatorClaimHistoryV1(input: Readonly<{
  client: PublicClient;
  entry: CanonicalTokenExploreEntry;
  capability: RouterCustomCreatorClaimCapabilityV1;
  blockNumber: bigint;
}>) {
  const fromBlock = BigInt(input.entry.launchStampProvenance!.blockNumber);
  const logs = [];
  for (let start = fromBlock; start <= input.blockNumber; start += CLAIM_LOG_RANGE) {
    const toBlock = start + CLAIM_LOG_RANGE - 1n < input.blockNumber
      ? start + CLAIM_LOG_RANGE - 1n
      : input.blockNumber;
    logs.push(...await input.client.getLogs({
      address: input.capability.hookAddress,
      event: creatorFeesClaimedEvent,
      args: {
        poolId: input.capability.poolId,
        creator: input.capability.creatorAddress,
        recipient: input.capability.creatorAddress,
      },
      fromBlock: start,
      toBlock,
      strict: true,
    }));
  }

  const verified = logs.filter((log) => {
    if (
      log.removed ||
      log.blockNumber === null ||
      log.transactionHash === null ||
      log.transactionIndex === null ||
      log.logIndex === null ||
      !sameHex(log.args.poolId, input.capability.poolId) ||
      !sameHex(log.args.creator, input.capability.creatorAddress) ||
      !sameHex(log.args.recipient, input.capability.creatorAddress) ||
      log.args.amount <= 0n
    ) {
      throw new RouterCustomCreatorClaimError(
        "identity-mismatch",
        "The Router Custom creator claim history is not bound to the reviewed payout",
      );
    }
    return true;
  });
  const blockNumbers = [...new Set(
    verified.map((log) => log.blockNumber!.toString()),
  )];
  const timestamps = new Map<string, bigint>();
  await Promise.all(blockNumbers.map(async (blockNumber) => {
    const block = await input.client.getBlock({
      blockNumber: BigInt(blockNumber),
    });
    timestamps.set(blockNumber, block.timestamp);
  }));

  return verified.map((log): CreatorClaim => {
    const blockNumber = log.blockNumber!;
    const timestamp = timestamps.get(blockNumber.toString());
    if (timestamp === undefined) {
      throw new RouterCustomCreatorClaimError(
        "identity-mismatch",
        "The Router Custom creator claim timestamp is unavailable",
      );
    }
    return {
      poolId: input.capability.poolId,
      tokenAddress: input.capability.tokenAddress,
      creatorAddress: input.capability.creatorAddress,
      recipientAddress: input.capability.creatorAddress,
      callerAddress: getAddress(log.args.caller),
      amountWei: log.args.amount.toString(),
      amountEth: formatUnits(log.args.amount, 18),
      blockNumber: blockNumber.toString(),
      transactionHash: log.transactionHash!,
      transactionIndex: log.transactionIndex!,
      logIndex: log.logIndex!,
      claimedAt: new Date(Number(timestamp) * 1_000).toISOString(),
    };
  }).sort((left, right) => {
    const blockDifference = BigInt(right.blockNumber) - BigInt(left.blockNumber);
    if (blockDifference !== 0n) return blockDifference < 0n ? -1 : 1;
    if (left.transactionIndex !== right.transactionIndex) {
      return right.transactionIndex - left.transactionIndex;
    }
    return right.logIndex - left.logIndex;
  });
}

export function encodeRouterCustomCreatorClaimV1(
  capability: RouterCustomCreatorClaimCapabilityV1,
) {
  const data = encodeFunctionData({
    abi: fadeRouterCustomClaimHookAbi,
    functionName: "claimCreatorFees",
    args: [capability.poolId],
  });
  if (!sameHex(data.slice(0, 10), capability.claimSelector)) {
    throw new RouterCustomCreatorClaimError(
      "runtime-mismatch",
      "The Router Custom creator claim selector is not verified",
    );
  }
  return data;
}

export async function projectRouterCustomCreatorClaimProfileV1(input: Readonly<{
  profile: CreatorProfile;
  account: Address;
  entries: readonly CanonicalTokenExploreEntry[];
  client: PublicClient;
}>): Promise<CreatorProfile> {
  const { profile } = input;
  if (profile.status !== "ready" || profile.snapshot?.chainId !== 1) {
    return profile;
  }

  const snapshotBlock = BigInt(profile.snapshot.blockNumber);
  const existingPools = new Set(
    profile.pools.map((pool) => pool.poolId.toLowerCase()),
  );
  const profileTokens = new Set(
    profile.tokens.map((token) => token.tokenAddress.toLowerCase()),
  );
  const candidates = input.entries.filter((entry) => {
    const capability = resolveRouterCustomCreatorClaimCapabilityV1(entry);
    return capability !== null &&
      sameHex(capability.creatorAddress, input.account) &&
      BigInt(entry.launchStampProvenance!.finalizedAtBlockNumber) <=
        snapshotBlock &&
      profileTokens.has(capability.tokenAddress.toLowerCase()) &&
      !existingPools.has(capability.poolId.toLowerCase());
  });
  if (candidates.length === 0) return profile;
  if (candidates.length !== 1) {
    throw new RouterCustomCreatorClaimError(
      "identity-mismatch",
      "The Router Custom creator claim profile is ambiguous",
    );
  }

  const entry = candidates[0]!;
  const capability = requireCanonicalCapabilityEntry(entry);
  const [state, claims] = await Promise.all([
    readRouterCustomCreatorClaimStateV1({
      client: input.client,
      entry,
      blockNumber: snapshotBlock,
    }),
    readRouterCustomCreatorClaimHistoryV1({
      client: input.client,
      entry,
      capability,
      blockNumber: snapshotBlock,
    }),
  ]);
  const existingClaimIds = new Set(
    profile.claims.map((claim) =>
      `${claim.transactionHash.toLowerCase()}:${claim.logIndex}`
    ),
  );
  if (claims.some((claim) =>
    existingClaimIds.has(
      `${claim.transactionHash.toLowerCase()}:${claim.logIndex}`,
    )
  )) {
    throw new RouterCustomCreatorClaimError(
      "identity-mismatch",
      "The Router Custom creator claim history duplicates another release",
    );
  }
  const claimed = claims.reduce(
    (total, claim) => total + BigInt(claim.amountWei),
    0n,
  );
  const generated = state.claimable + claimed;
  const claimableWei = state.claimable.toString();
  const claimableEth = formatUnits(state.claimable, 18);
  const pool = {
    tokenAddress: state.capability.tokenAddress,
    name: entry.name,
    symbol: entry.symbol,
    poolId: state.capability.poolId,
    totalSwapFeeBps: state.currentTotalSwapFeeBps,
    launchModel: "custom-graph" as const,
    claimCapability: routerCustomCreatorClaimProfileCapabilityV1(
      state.capability,
    ),
    claimableCreatorFeesWei: claimableWei,
    claimableCreatorFeesEth: claimableEth,
    generatedCreatorFeesWei: generated.toString(),
    generatedCreatorFeesEth: formatUnits(generated, 18),
  };

  const totalClaimable = BigInt(profile.totals.claimableWei) + state.claimable;
  const totalGenerated = BigInt(profile.totals.generatedWei) + generated;
  const totalClaimed = BigInt(profile.totals.claimedWei) + claimed;
  return {
    ...profile,
    pools: [...profile.pools, pool],
    claims: [...profile.claims, ...claims],
    totals: {
      ...profile.totals,
      claimableWei: totalClaimable.toString(),
      claimableEth: formatUnits(totalClaimable, 18),
      generatedWei: totalGenerated.toString(),
      generatedEth: formatUnits(totalGenerated, 18),
      claimedWei: totalClaimed.toString(),
      claimedEth: formatUnits(totalClaimed, 18),
    },
  };
}
