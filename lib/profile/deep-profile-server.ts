import {
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import type { LauncherToken } from "../tokens";

export const DEEP_PROFILE_CONFIRMATIONS = 12n;
export const DEEP_PROFILE_CANDIDATE_PAGE_SIZE = 32;
export const DEEP_PROFILE_MAX_CANDIDATES = 256;
export const DEEP_PROFILE_MAX_FALLBACK_BLOCKS = 100_000n;

export type DeepProfileSnapshot = {
  blockNumber: bigint;
  blockHash: Hex;
};

export type DeepLaunchCandidate = {
  tokenAddress: Address;
  vaultAddress: Address;
  blockNumber: bigint;
  transactionHash: Hex;
};

export type DeepLaunchLogIdentity = DeepLaunchCandidate & {
  blockHash: Hex;
  removed: boolean;
};

type SnapshotClient = Pick<
  PublicClient,
  "getChainId" | "getBlockNumber" | "getBlock"
>;

function normalizedRpcUrl(value: string | undefined) {
  return value?.trim() || null;
}

export function resolveDeepProfileRpcUrls(
  environment: "production" | "rehearsal",
  env: Record<string, string | undefined> = process.env,
) {
  const primary = normalizedRpcUrl(
    environment === "production" ? env.ETHEREUM_RPC_URL : env.SEPOLIA_RPC_URL,
  );
  const secondary = normalizedRpcUrl(
    environment === "production"
      ? env.ETHEREUM_RPC_URL_B
      : env.SEPOLIA_RPC_URL_B,
  );
  if (!primary || !secondary || primary === secondary) {
    throw new Error(
      "Deep profiles require two distinct configured RPC providers",
    );
  }
  return [primary, secondary] as const;
}

export async function resolveDeepProfileSnapshot(
  clients: readonly SnapshotClient[],
  chainId: number,
  confirmations = DEEP_PROFILE_CONFIRMATIONS,
): Promise<DeepProfileSnapshot> {
  if (clients.length !== 2 || confirmations < 12n) {
    throw new Error("Deep profiles require two independent confirmed views");
  }
  const states = await Promise.all(
    clients.map(async (client) => ({
      chainId: await client.getChainId(),
      head: await client.getBlockNumber(),
    })),
  );
  if (states.some((state) => state.chainId !== chainId)) {
    throw new Error("Deep profile RPC chain does not match the release");
  }
  const lowestHead =
    states[0].head < states[1].head ? states[0].head : states[1].head;
  const blockNumber =
    lowestHead > confirmations ? lowestHead - confirmations : 0n;
  const blocks = await Promise.all(
    clients.map((client) => client.getBlock({ blockNumber })),
  );
  const blockHash = blocks[0].hash;
  if (
    !blockHash ||
    blocks.some(
      (block) =>
        !block.hash || block.hash.toLowerCase() !== blockHash.toLowerCase(),
    )
  ) {
    throw new Error("Independent RPCs disagree on the Deep profile snapshot");
  }
  return { blockNumber, blockHash };
}

function asCandidate(token: LauncherToken): DeepLaunchCandidate | null {
  if (
    token.launchModel !== "deep" ||
    !isAddress(token.tokenAddress) ||
    !token.growthVaultAddress ||
    !isAddress(token.growthVaultAddress) ||
    typeof token.launchBlockNumber !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(token.launchBlockNumber) ||
    !token.launchTransactionHash ||
    !isHex(token.launchTransactionHash, { strict: true }) ||
    token.launchTransactionHash.length !== 66
  ) {
    return null;
  }
  return {
    tokenAddress: getAddress(token.tokenAddress),
    vaultAddress: getAddress(token.growthVaultAddress),
    blockNumber: BigInt(token.launchBlockNumber),
    transactionHash: token.launchTransactionHash,
  };
}

export function deepCandidatesFromDurableTokens(
  tokens: readonly LauncherToken[],
  snapshotBlock: bigint,
) {
  const deepTokens = tokens.filter((token) => token.launchModel === "deep");
  return validateDeepCandidates(
    deepTokens
      .map((token) => {
        const candidate = asCandidate(token);
        if (!candidate) {
          throw new Error(
            "The durable Deep launch catalog contains incomplete provenance",
          );
        }
        return candidate;
      })
      .filter((candidate) => candidate.blockNumber <= snapshotBlock),
  );
}

export function validateDeepCandidates(input: readonly DeepLaunchCandidate[]) {
  const candidates = [...input].sort((left, right) =>
    left.blockNumber === right.blockNumber
      ? left.transactionHash.localeCompare(right.transactionHash)
      : left.blockNumber < right.blockNumber
        ? -1
        : 1,
  );
  const seenTokens = new Set<string>();
  const seenVaults = new Set<string>();
  for (const candidate of candidates) {
    const token = candidate.tokenAddress.toLowerCase();
    const vault = candidate.vaultAddress.toLowerCase();
    if (seenTokens.has(token) || seenVaults.has(vault)) {
      throw new Error("The Deep launch catalog contains duplicate provenance");
    }
    seenTokens.add(token);
    seenVaults.add(vault);
  }
  if (candidates.length > DEEP_PROFILE_MAX_CANDIDATES) {
    throw new Error("The Deep profile catalog exceeds its bounded read limit");
  }
  return candidates;
}

export function paginateDeepCandidates(
  candidates: readonly DeepLaunchCandidate[],
  pageSize = DEEP_PROFILE_CANDIDATE_PAGE_SIZE,
) {
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > DEEP_PROFILE_CANDIDATE_PAGE_SIZE ||
    candidates.length > DEEP_PROFILE_MAX_CANDIDATES
  ) {
    throw new Error("Invalid Deep profile pagination bounds");
  }
  const pages: DeepLaunchCandidate[][] = [];
  for (let offset = 0; offset < candidates.length; offset += pageSize) {
    pages.push(candidates.slice(offset, offset + pageSize));
  }
  return pages;
}

export function deepFallbackScanStart(
  deploymentBlock: bigint,
  snapshotBlock: bigint,
) {
  if (deploymentBlock > snapshotBlock) return snapshotBlock + 1n;
  if (snapshotBlock - deploymentBlock + 1n > DEEP_PROFILE_MAX_FALLBACK_BLOCKS) {
    throw new Error(
      "The durable Deep launch catalog is required for this profile range",
    );
  }
  return deploymentBlock;
}

export function deepConfirmedTailScanStart(
  durableSnapshotBlock: bigint,
  confirmedSnapshotBlock: bigint,
) {
  if (durableSnapshotBlock > confirmedSnapshotBlock) {
    throw new Error("The durable Deep catalog is ahead of the snapshot");
  }
  if (
    confirmedSnapshotBlock - durableSnapshotBlock >
    DEEP_PROFILE_MAX_FALLBACK_BLOCKS
  ) {
    throw new Error("The durable Deep launch catalog is too far behind");
  }
  return durableSnapshotBlock + 1n;
}

function canonicalJson(value: unknown) {
  return JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

export function requireDeepProviderAgreement<T>(
  label: string,
  values: readonly T[],
): T {
  if (
    values.length !== 2 ||
    canonicalJson(values[0]) !== canonicalJson(values[1])
  ) {
    throw new Error(`Independent RPCs disagree on ${label}`);
  }
  return values[0];
}

export function validateCanonicalDeepLaunchIdentities(
  candidate: DeepLaunchCandidate,
  snapshotBlock: bigint,
  providerLogs: readonly DeepLaunchLogIdentity[],
) {
  if (candidate.blockNumber > snapshotBlock) {
    throw new Error("The Deep launch is newer than the confirmed snapshot");
  }
  const canonical = requireDeepProviderAgreement(
    "canonical Deep launch provenance",
    providerLogs,
  );
  if (
    canonical.removed ||
    canonical.blockNumber !== candidate.blockNumber ||
    canonical.transactionHash.toLowerCase() !==
      candidate.transactionHash.toLowerCase() ||
    canonical.tokenAddress.toLowerCase() !==
      candidate.tokenAddress.toLowerCase() ||
    canonical.vaultAddress.toLowerCase() !==
      candidate.vaultAddress.toLowerCase()
  ) {
    throw new Error("The Deep launch event is stale or noncanonical");
  }
  return canonical;
}

export function authorizeDeepRewardVault(
  account: Address,
  requestedVault: Address,
  candidate: DeepLaunchCandidate | undefined,
  providerShares: readonly number[],
) {
  if (
    !candidate ||
    candidate.vaultAddress.toLowerCase() !== requestedVault.toLowerCase()
  ) {
    throw new Error("The requested vault is not a canonical Deep launch");
  }
  const share = requireDeepProviderAgreement(
    "Deep beneficiary ownership",
    providerShares,
  );
  if (share <= 0) {
    throw new Error(
      `The connected beneficiary ${account} does not own this reward action`,
    );
  }
  return candidate;
}
