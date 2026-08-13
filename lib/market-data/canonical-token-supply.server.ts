import "server-only";

import { createPublicClient, http, type Hex } from "viem";
import { mainnet } from "viem/chains";

import { uerc20ReadAbi } from "../onchain/abis";
import {
  getWebsiteChartOnchainDeployment,
  getWebsiteReadOnchainDeployment,
} from "../onchain/config";
import type { ReadyOnchainDeployment } from "../onchain/types";
import type { ExploreEntry } from "../tokens";

type SupplyObservation = Readonly<{
  blockHash: Hex;
  decimals: number;
  totalSupplyRaw: string;
}>;

type SupplyClient = Readonly<{
  getBlockNumber: () => Promise<bigint>;
  getBlock: (input: Readonly<{ blockNumber: bigint }>) => Promise<{
    hash: Hex | null;
    number: bigint | null;
  }>;
  readContract: (input: Readonly<{
    address: `0x${string}`;
    abi: typeof uerc20ReadAbi;
    functionName: "decimals" | "totalSupply";
    blockNumber: bigint;
  }>) => Promise<unknown>;
}>;

export type CanonicalTokenSupplyDependencies = Readonly<{
  deployment?: ReadyOnchainDeployment;
  additionalRpcUrls?: readonly string[];
  createClient?: (rpcUrl: string) => SupplyClient;
  snapshot?: Readonly<{
    blockNumber: string;
    blockHash: Hex;
  }>;
}>;

function needsCanonicalSupply(entry: ExploreEntry): boolean {
  return entry.exploreKind === "token" &&
    (typeof entry.totalSupplyRaw !== "string" ||
      !/^[1-9][0-9]*$/u.test(entry.totalSupplyRaw) ||
      typeof entry.tokenDecimals !== "number" ||
      !Number.isInteger(entry.tokenDecimals) ||
      entry.tokenDecimals < 0 ||
      entry.tokenDecimals > 255);
}

async function observeSupply(
  client: SupplyClient,
  tokenAddress: `0x${string}`,
  blockNumber: bigint,
): Promise<SupplyObservation> {
  const [block, decimalsValue, totalSupplyValue] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.readContract({
      address: tokenAddress,
      abi: uerc20ReadAbi,
      functionName: "decimals",
      blockNumber,
    }),
    client.readContract({
      address: tokenAddress,
      abi: uerc20ReadAbi,
      functionName: "totalSupply",
      blockNumber,
    }),
  ]);
  const decimals = Number(decimalsValue);
  const totalSupply = BigInt(totalSupplyValue as bigint);
  if (
    block.number !== blockNumber ||
    !block.hash ||
    !/^0x[0-9a-fA-F]{64}$/u.test(block.hash) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    totalSupply <= 0n
  ) {
    throw new Error("Canonical token supply proof is invalid");
  }
  return {
    blockHash: block.hash,
    decimals,
    totalSupplyRaw: totalSupply.toString(),
  };
}

/**
 * Completes missing Router token supply from two fixed Website readers at the
 * same quorum-verified block. Identity remains usable when the proof is not
 * available, but no numeric FDV is manufactured from a single provider.
 */
export async function hydrateMissingCanonicalTokenSupplyV1<T extends ExploreEntry>(
  entries: readonly T[],
  dependencies: CanonicalTokenSupplyDependencies = {},
): Promise<T[]> {
  if (!entries.some(needsCanonicalSupply)) return [...entries];

  try {
    const configured = dependencies.deployment ??
      getWebsiteReadOnchainDeployment("production");
    const rpcUrlSecondary = configured.rpcUrlSecondary;
    if (
      configured.status !== "ready" ||
      !rpcUrlSecondary ||
      rpcUrlSecondary === configured.rpcUrl
    ) return [...entries];
    const deployment = configured as ReadyOnchainDeployment;
    const createClient = dependencies.createClient ?? ((rpcUrl: string) =>
      createPublicClient({
        chain: mainnet,
        transport: http(rpcUrl, { retryCount: 0, timeout: 12_000 }),
      }));
    const defaultAdditionalRpc = dependencies.deployment
      ? []
      : [getWebsiteChartOnchainDeployment("production").rpcUrlSecondary]
          .filter((value): value is string => typeof value === "string");
    const rpcUrls = [...new Set([
      deployment.rpcUrl,
      rpcUrlSecondary,
      ...(dependencies.additionalRpcUrls ?? defaultAdditionalRpc),
    ])];
    if (rpcUrls.length < 2) return [...entries];
    const clients = rpcUrls.map(createClient);
    const requestedSnapshot = dependencies.snapshot;
    if (
      requestedSnapshot &&
      (!/^(?:0|[1-9]\d*)$/u.test(requestedSnapshot.blockNumber) ||
        !/^0x[0-9a-f]{64}$/u.test(requestedSnapshot.blockHash))
    ) return [...entries];
    let blockNumber: bigint;
    if (requestedSnapshot) {
      blockNumber = BigInt(requestedSnapshot.blockNumber);
    } else {
      const heads = (await Promise.allSettled(clients.map((client) =>
        client.getBlockNumber())))
        .flatMap((result) => result.status === "fulfilled" && result.value >= 0n
          ? [result.value]
          : []);
      if (heads.length < 2) return [...entries];
      const lowestHead = heads.reduce((lowest, head) =>
        head < lowest ? head : lowest);
      blockNumber = lowestHead > deployment.confirmations
        ? lowestHead - deployment.confirmations
        : 0n;
    }

    return await Promise.all(entries.map(async (entry) => {
      if (!needsCanonicalSupply(entry) || entry.exploreKind !== "token") {
        return entry;
      }
      try {
        const observations = (await Promise.allSettled(clients.map((client) =>
          observeSupply(client, entry.tokenAddress, blockNumber))))
          .flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        const groups = new Map<string, SupplyObservation[]>();
        for (const observation of observations) {
          const key = [
            observation.blockHash.toLowerCase(),
            observation.decimals,
            observation.totalSupplyRaw,
          ].join(":");
          groups.set(key, [...(groups.get(key) ?? []), observation]);
        }
        const agreed = [...groups.values()].find((group) => group.length >= 2)?.[0];
        if (
          !agreed ||
          (requestedSnapshot &&
            agreed.blockHash.toLowerCase() !== requestedSnapshot.blockHash)
        ) return entry;
        return {
          ...entry,
          totalSupplyRaw: agreed.totalSupplyRaw,
          tokenDecimals: agreed.decimals,
        } as T;
      } catch {
        return entry;
      }
    }));
  } catch {
    return [...entries];
  }
}
