import "server-only";

import { createHash } from "node:crypto";

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

type CanonicalSupplySnapshotV1 = Readonly<{
  blockNumber: bigint;
  blockHash: Hex;
  rpcUrls: readonly string[];
}>;

type CachedValue<T> = Readonly<{
  expiresAtMs: number;
  value: T;
}>;

type SupplyClientFactoryContextV1 = Readonly<{
  signal: AbortSignal;
  timeoutMs: number;
}>;

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const CANONICAL_TOKEN_SUPPLY_PHASE_BUDGET_MS = 1_800;
const CANONICAL_TOKEN_SUPPLY_MAXIMUM_ENTRY_COUNT = 20;
const CANONICAL_TOKEN_SUPPLY_MAXIMUM_PROVIDER_COUNT = 3;
const CANONICAL_TOKEN_SUPPLY_MAXIMUM_CONCURRENCY = 2;
const CANONICAL_TOKEN_SUPPLY_SNAPSHOT_CACHE_TTL_MS = 5_000;
const CANONICAL_TOKEN_SUPPLY_CACHE_TTL_MS = 30_000;
const CANONICAL_TOKEN_SUPPLY_MAXIMUM_CACHE_ENTRIES = 512;
const UINT256_MAX = (1n << 256n) - 1n;

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
    blockHash: Hex;
    requireCanonical: true;
  }>) => Promise<unknown>;
}>;

export type CanonicalTokenSupplyDependencies = Readonly<{
  deployment?: ReadyOnchainDeployment;
  additionalRpcUrls?: readonly string[];
  createClient?: (
    rpcUrl: string,
    context: SupplyClientFactoryContextV1,
  ) => SupplyClient;
  snapshot?: Readonly<{
    blockNumber: string;
    blockHash: Hex;
  }>;
  now?: () => Date;
  deadlineMs?: number;
  providerTimeoutMs?: number;
}>;

export type CanonicalTokenSupplyHydrationWaitV1 = Readonly<{
  signal?: AbortSignal;
  deadlineMs?: number;
  now?: () => Date;
  maximumDurationMs?: number;
}>;

type SupplyLaneWaiter = {
  signal: AbortSignal;
  resolve: () => void;
  reject: (error: unknown) => void;
  onAbort: () => void;
};

const snapshotCache = new Map<
  string,
  CachedValue<CanonicalSupplySnapshotV1>
>();
const snapshotInFlight = new Map<
  string,
  Promise<CanonicalSupplySnapshotV1 | null>
>();
const supplyCache = new Map<string, CachedValue<SupplyObservation>>();
const supplyInFlight = new Map<string, Promise<SupplyObservation | null>>();
const supplyLaneQueue: SupplyLaneWaiter[] = [];
let activeSupplyLanes = 0;

function verifiedEthereumTokenAddress(
  entry: ExploreEntry,
): `0x${string}` | null {
  const tokenAddress = entry.tokenAddress?.toLowerCase();
  if (!tokenAddress || !ADDRESS.test(tokenAddress)) return null;
  if (entry.exploreKind === "custom-project") {
    return entry.chainId === "1" &&
        entry.launchCategoryProvenance.source === "registry.custom-launched"
      ? tokenAddress as `0x${string}`
      : null;
  }
  const provenance = entry.launchCategoryProvenance;
  const ethereumIdentity = provenance.source === "canonical-launch-read-model"
    ? entry.id.startsWith("1:")
    : provenance.source === "canonical-launch-stamp-router" &&
      entry.launchStampProvenance?.chainId === 1;
  return ethereumIdentity ? tokenAddress as `0x${string}` : null;
}

export function canonicalTokenSupplyHydrationRequiredV1(
  entry: ExploreEntry,
): boolean {
  return verifiedEthereumTokenAddress(entry) !== null &&
    (typeof entry.totalSupplyRaw !== "string" ||
      !POSITIVE_INTEGER.test(entry.totalSupplyRaw) ||
      typeof entry.tokenDecimals !== "number" ||
      !Number.isInteger(entry.tokenDecimals) ||
      entry.tokenDecimals < 0 ||
      entry.tokenDecimals > 255);
}

function canonicalProviderUrlsV1(
  deployment: ReadyOnchainDeployment,
  dependencies: CanonicalTokenSupplyDependencies,
): readonly string[] {
  const defaultAdditionalRpc = dependencies.deployment
    ? []
    : [getWebsiteChartOnchainDeployment("production").rpcUrlSecondary]
        .filter((value): value is string => typeof value === "string");
  const urls = [
    deployment.rpcUrl,
    deployment.rpcUrlSecondary,
    ...(dependencies.additionalRpcUrls ?? defaultAdditionalRpc),
  ].filter((value): value is string => typeof value === "string");
  return [...new Set(urls)].slice(
    0,
    CANONICAL_TOKEN_SUPPLY_MAXIMUM_PROVIDER_COUNT,
  );
}

function providerSetBindingKeyV1(
  deployment: ReadyOnchainDeployment,
  rpcUrls: readonly string[],
): string {
  const commitment = createHash("sha256").update(JSON.stringify([
    deployment.chainId,
    deployment.confirmations.toString(),
    ...rpcUrls,
  ])).digest("hex");
  return `sha256:${commitment}`;
}

function snapshotRequestBindingKeyV1(
  providerSetKey: string,
  snapshot: CanonicalTokenSupplyDependencies["snapshot"],
): string {
  return snapshot
    ? [
        providerSetKey,
        snapshot.blockNumber,
        snapshot.blockHash.toLowerCase(),
      ].join("\u001f")
    : `${providerSetKey}\u001flive-finalized`;
}

function supplyBindingKeyV1(
  providerSetKey: string,
  snapshot: CanonicalSupplySnapshotV1,
  tokenAddress: `0x${string}`,
): string {
  return [
    providerSetKey,
    snapshot.blockNumber.toString(),
    snapshot.blockHash.toLowerCase(),
    tokenAddress,
  ].join("\u001f");
}

function clientFactoryV1(
  dependencies: CanonicalTokenSupplyDependencies,
): NonNullable<CanonicalTokenSupplyDependencies["createClient"]> {
  return dependencies.createClient ?? ((rpcUrl, context) =>
    createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl, {
        retryCount: 0,
        timeout: context.timeoutMs,
        fetchOptions: { signal: context.signal },
      }),
    }));
}

function currentCacheValue<T>(
  cache: ReadonlyMap<string, CachedValue<T>>,
  key: string,
  nowMs: number,
): T | undefined {
  const cached = cache.get(key);
  return cached && cached.expiresAtMs > nowMs ? cached.value : undefined;
}

function setCacheValue<T>(
  cache: Map<string, CachedValue<T>>,
  key: string,
  value: T,
  expiresAtMs: number,
): void {
  cache.delete(key);
  cache.set(key, { expiresAtMs, value });
  while (cache.size > CANONICAL_TOKEN_SUPPLY_MAXIMUM_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

function validProviderTimeoutMs(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.min(
        Math.ceil(value as number),
        CANONICAL_TOKEN_SUPPLY_PHASE_BUDGET_MS,
      )
    : CANONICAL_TOKEN_SUPPLY_PHASE_BUDGET_MS;
}

function deadlineBoundaryV1(
  deadlineMs: number,
  now: () => Date,
): Readonly<{ signal: AbortSignal; dispose: () => void }> | null {
  const remainingMs = deadlineMs - now().getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Canonical token supply deadline exceeded")),
    Math.min(Math.ceil(remainingMs), 2_147_483_647),
  );
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  };
}

function awaitForSignalV1<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    void pending.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

async function withProviderDeadlineV1<T>(
  deadlineMs: number,
  now: () => Date,
  work: (context: SupplyClientFactoryContextV1) => Promise<T>,
): Promise<T | null> {
  const boundary = deadlineBoundaryV1(deadlineMs, now);
  if (boundary === null) return null;
  try {
    const remainingMs = deadlineMs - now().getTime();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
    return await awaitForSignalV1(work({
      signal: boundary.signal,
      timeoutMs: Math.max(1, Math.ceil(remainingMs)),
    }), boundary.signal);
  } catch {
    return null;
  } finally {
    boundary.dispose();
  }
}

function validBlock(
  block: Readonly<{ hash: Hex | null; number: bigint | null }>,
  blockNumber: bigint,
): block is Readonly<{ hash: Hex; number: bigint }> {
  return block.number === blockNumber &&
    typeof block.hash === "string" &&
    /^0x[0-9a-fA-F]{64}$/u.test(block.hash);
}

async function resolveCanonicalSnapshotUncachedV1(
  deployment: ReadyOnchainDeployment,
  rpcUrls: readonly string[],
  dependencies: CanonicalTokenSupplyDependencies,
  deadlineMs: number,
  now: () => Date,
): Promise<CanonicalSupplySnapshotV1 | null> {
  return withProviderDeadlineV1(deadlineMs, now, async (context) => {
    const createClient = clientFactoryV1(dependencies);
    const providers = rpcUrls.map((rpcUrl) => ({
      rpcUrl,
      client: createClient(rpcUrl, context),
    }));
    const requestedSnapshot = dependencies.snapshot;
    let blockNumber: bigint;
    if (requestedSnapshot) {
      blockNumber = BigInt(requestedSnapshot.blockNumber);
    } else {
      const heads = (await Promise.allSettled(providers.map(async (provider) =>
        await awaitForSignalV1(provider.client.getBlockNumber(), context.signal)
      ))).flatMap((result) =>
        result.status === "fulfilled" && result.value >= 0n
          ? [result.value]
          : []
      );
      if (heads.length < 2) return null;
      const lowestHead = heads.reduce((lowest, head) =>
        head < lowest ? head : lowest);
      blockNumber = lowestHead > deployment.confirmations
        ? lowestHead - deployment.confirmations
        : 0n;
    }

    const blocks = await Promise.allSettled(providers.map(async (provider) => ({
      rpcUrl: provider.rpcUrl,
      block: await awaitForSignalV1(
        provider.client.getBlock({ blockNumber }),
        context.signal,
      ),
    })));
    const byHash = new Map<string, string[]>();
    for (const result of blocks) {
      if (
        result.status !== "fulfilled" ||
        !validBlock(result.value.block, blockNumber)
      ) continue;
      const blockHash = result.value.block.hash.toLowerCase();
      if (
        requestedSnapshot &&
        blockHash !== requestedSnapshot.blockHash.toLowerCase()
      ) continue;
      byHash.set(blockHash, [
        ...(byHash.get(blockHash) ?? []),
        result.value.rpcUrl,
      ]);
    }
    const agreed = [...byHash.entries()].find(([, urls]) => urls.length >= 2);
    if (agreed === undefined) return null;
    return {
      blockNumber,
      blockHash: agreed[0] as Hex,
      rpcUrls: Object.freeze([...agreed[1]]),
    };
  });
}

async function readCanonicalSnapshotV1(
  deployment: ReadyOnchainDeployment,
  rpcUrls: readonly string[],
  providerSetKey: string,
  dependencies: CanonicalTokenSupplyDependencies,
  deadlineMs: number,
  now: () => Date,
  callerSignal: AbortSignal,
): Promise<CanonicalSupplySnapshotV1 | null> {
  const key = snapshotRequestBindingKeyV1(
    providerSetKey,
    dependencies.snapshot,
  );
  const nowMs = now().getTime();
  const cached = currentCacheValue(snapshotCache, key, nowMs);
  if (cached !== undefined) return cached;
  const active = snapshotInFlight.get(key);
  if (active) {
    try {
      return await awaitForSignalV1(active, callerSignal);
    } catch {
      return null;
    }
  }
  const pending = resolveCanonicalSnapshotUncachedV1(
    deployment,
    rpcUrls,
    dependencies,
    deadlineMs,
    now,
  ).then((snapshot) => {
    if (snapshot !== null) {
      setCacheValue(
        snapshotCache,
        key,
        snapshot,
        now().getTime() + CANONICAL_TOKEN_SUPPLY_SNAPSHOT_CACHE_TTL_MS,
      );
    }
    return snapshot;
  }).catch(() => null).finally(() => {
    if (snapshotInFlight.get(key) === pending) snapshotInFlight.delete(key);
  });
  snapshotInFlight.set(key, pending);
  try {
    return await awaitForSignalV1(pending, callerSignal);
  } catch {
    return null;
  }
}

function grantNextSupplyLaneV1(): void {
  while (
    activeSupplyLanes < CANONICAL_TOKEN_SUPPLY_MAXIMUM_CONCURRENCY &&
    supplyLaneQueue.length > 0
  ) {
    const waiter = supplyLaneQueue.shift()!;
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    if (waiter.signal.aborted) {
      waiter.reject(waiter.signal.reason);
      continue;
    }
    activeSupplyLanes += 1;
    waiter.resolve();
  }
}

function acquireSupplyLaneV1(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (activeSupplyLanes < CANONICAL_TOKEN_SUPPLY_MAXIMUM_CONCURRENCY) {
    activeSupplyLanes += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter: SupplyLaneWaiter = {
      signal,
      resolve,
      reject,
      onAbort: () => {
        const index = supplyLaneQueue.indexOf(waiter);
        if (index >= 0) supplyLaneQueue.splice(index, 1);
        reject(signal.reason);
      },
    };
    signal.addEventListener("abort", waiter.onAbort, { once: true });
    supplyLaneQueue.push(waiter);
  });
}

function releaseSupplyLaneV1(): void {
  activeSupplyLanes = Math.max(0, activeSupplyLanes - 1);
  grantNextSupplyLaneV1();
}

async function withSupplyLaneV1<T>(
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  await acquireSupplyLaneV1(signal);
  try {
    return await work();
  } finally {
    releaseSupplyLaneV1();
  }
}

function supplyObservationV1(
  decimalsValue: unknown,
  totalSupplyValue: unknown,
  blockHash: Hex,
): SupplyObservation | null {
  try {
    const decimals = Number(decimalsValue);
    const totalSupply = BigInt(totalSupplyValue as bigint);
    if (
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 255 ||
      totalSupply <= 0n ||
      totalSupply > UINT256_MAX
    ) return null;
    return {
      blockHash,
      decimals,
      totalSupplyRaw: totalSupply.toString(),
    };
  } catch {
    return null;
  }
}

async function readCanonicalSupplyUncachedV1(
  tokenAddress: `0x${string}`,
  snapshot: CanonicalSupplySnapshotV1,
  dependencies: CanonicalTokenSupplyDependencies,
  deadlineMs: number,
  now: () => Date,
): Promise<SupplyObservation | null> {
  return withProviderDeadlineV1(deadlineMs, now, async (context) =>
    await withSupplyLaneV1(context.signal, async () => {
      const createClient = clientFactoryV1(dependencies);
      const clients = snapshot.rpcUrls.map((rpcUrl) =>
        createClient(rpcUrl, context)
      );
      const observations = (await Promise.allSettled(clients.map(
        async (client) => {
          const [decimalsValue, totalSupplyValue] = await Promise.all([
            awaitForSignalV1(client.readContract({
              address: tokenAddress,
              abi: uerc20ReadAbi,
              functionName: "decimals",
              blockHash: snapshot.blockHash,
              requireCanonical: true,
            }), context.signal),
            awaitForSignalV1(client.readContract({
              address: tokenAddress,
              abi: uerc20ReadAbi,
              functionName: "totalSupply",
              blockHash: snapshot.blockHash,
              requireCanonical: true,
            }), context.signal),
          ]);
          return supplyObservationV1(
            decimalsValue,
            totalSupplyValue,
            snapshot.blockHash,
          );
        },
      ))).flatMap((result) =>
        result.status === "fulfilled" && result.value !== null
          ? [result.value]
          : []
      );
      const groups = new Map<string, SupplyObservation[]>();
      for (const observation of observations) {
        const key = [
          observation.blockHash.toLowerCase(),
          observation.decimals,
          observation.totalSupplyRaw,
        ].join(":");
        groups.set(key, [...(groups.get(key) ?? []), observation]);
      }
      return [...groups.values()].find((group) => group.length >= 2)?.[0] ??
        null;
    })
  );
}

async function readCanonicalSupplyV1(
  tokenAddress: `0x${string}`,
  snapshot: CanonicalSupplySnapshotV1,
  providerSetKey: string,
  dependencies: CanonicalTokenSupplyDependencies,
  deadlineMs: number,
  now: () => Date,
  callerSignal: AbortSignal,
): Promise<SupplyObservation | null> {
  const key = supplyBindingKeyV1(providerSetKey, snapshot, tokenAddress);
  const cached = currentCacheValue(supplyCache, key, now().getTime());
  if (cached !== undefined) return cached;
  const active = supplyInFlight.get(key);
  if (active) {
    try {
      return await awaitForSignalV1(active, callerSignal);
    } catch {
      return null;
    }
  }
  const pending = readCanonicalSupplyUncachedV1(
    tokenAddress,
    snapshot,
    dependencies,
    deadlineMs,
    now,
  ).then((observation) => {
    if (observation !== null) {
      setCacheValue(
        supplyCache,
        key,
        observation,
        now().getTime() + CANONICAL_TOKEN_SUPPLY_CACHE_TTL_MS,
      );
    }
    return observation;
  }).catch(() => null).finally(() => {
    if (supplyInFlight.get(key) === pending) supplyInFlight.delete(key);
  });
  supplyInFlight.set(key, pending);
  try {
    return await awaitForSignalV1(pending, callerSignal);
  } catch {
    return null;
  }
}

async function mapWithConcurrencyV1<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let next = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        output[index] = await mapper(values[index]!);
      }
    },
  ));
  return output;
}

function applySupplyV1<T extends ExploreEntry>(
  entry: T,
  observation: SupplyObservation,
): T {
  return {
    ...entry,
    totalSupplyRaw: observation.totalSupplyRaw,
    tokenDecimals: observation.decimals,
  } as T;
}

/**
 * Completes a bounded set of missing canonical Ethereum supplies for verified
 * Classic, Router and Registry Custom entries. A single finalized BlockHash is
 * first proven by at least two fixed readers; decimals and totalSupply are then
 * read against that exact canonical hash. No single-provider value is cached.
 */
export async function hydrateMissingCanonicalTokenSupplyV1<
  T extends ExploreEntry,
>(
  entries: readonly T[],
  dependencies: CanonicalTokenSupplyDependencies = {},
): Promise<T[]> {
  if (!entries.some(canonicalTokenSupplyHydrationRequiredV1)) {
    return [...entries];
  }

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
    const rpcUrls = canonicalProviderUrlsV1(deployment, dependencies);
    if (rpcUrls.length < 2) return [...entries];
    const requestedSnapshot = dependencies.snapshot;
    if (
      requestedSnapshot &&
      (!/^(?:0|[1-9]\d*)$/u.test(requestedSnapshot.blockNumber) ||
        !/^0x[0-9a-f]{64}$/u.test(requestedSnapshot.blockHash))
    ) return [...entries];

    const now = dependencies.now ?? (() => new Date());
    const startedAtMs = now().getTime();
    const providerTimeoutMs = validProviderTimeoutMs(
      dependencies.providerTimeoutMs,
    );
    const deadlineMs = Math.min(
      dependencies.deadlineMs ?? Number.POSITIVE_INFINITY,
      startedAtMs + providerTimeoutMs,
    );
    const callerBoundary = deadlineBoundaryV1(deadlineMs, now);
    if (callerBoundary === null) return [...entries];
    try {
      const providerSetKey = providerSetBindingKeyV1(deployment, rpcUrls);
      const snapshot = await readCanonicalSnapshotV1(
        deployment,
        rpcUrls,
        providerSetKey,
        dependencies,
        deadlineMs,
        now,
        callerBoundary.signal,
      );
      if (snapshot === null || callerBoundary.signal.aborted) {
        return [...entries];
      }

      const tokenIndexes = new Map<`0x${string}`, number[]>();
      for (const [index, entry] of entries.entries()) {
        if (!canonicalTokenSupplyHydrationRequiredV1(entry)) continue;
        const tokenAddress = verifiedEthereumTokenAddress(entry);
        if (tokenAddress === null) continue;
        tokenIndexes.set(tokenAddress, [
          ...(tokenIndexes.get(tokenAddress) ?? []),
          index,
        ]);
      }

      const output = [...entries];
      const uncached: `0x${string}`[] = [];
      for (const tokenAddress of tokenIndexes.keys()) {
        const key = supplyBindingKeyV1(providerSetKey, snapshot, tokenAddress);
        const cached = currentCacheValue(supplyCache, key, now().getTime());
        if (cached !== undefined) {
          for (const index of tokenIndexes.get(tokenAddress) ?? []) {
            output[index] = applySupplyV1(output[index]!, cached);
          }
        } else if (
          uncached.length < CANONICAL_TOKEN_SUPPLY_MAXIMUM_ENTRY_COUNT
        ) {
          uncached.push(tokenAddress);
        }
      }

      const hydrated = await mapWithConcurrencyV1(
        uncached,
        CANONICAL_TOKEN_SUPPLY_MAXIMUM_CONCURRENCY,
        async (tokenAddress) => {
          if (callerBoundary.signal.aborted) return null;
          return readCanonicalSupplyV1(
            tokenAddress,
            snapshot,
            providerSetKey,
            dependencies,
            deadlineMs,
            now,
            callerBoundary.signal,
          );
        },
      );
      for (const [tokenIndex, observation] of hydrated.entries()) {
        if (observation === null) continue;
        const tokenAddress = uncached[tokenIndex]!;
        for (const index of tokenIndexes.get(tokenAddress) ?? []) {
          output[index] = applySupplyV1(output[index]!, observation);
        }
      }
      return output;
    } finally {
      callerBoundary.dispose();
    }
  } catch {
    return [...entries];
  }
}

/**
 * Gives request routes a bounded, fail-soft view of canonical hydration. The
 * shared provider work owns its shorter deadline and only creates new result
 * arrays, so an aborted caller cannot mutate a response or cancel another
 * caller that is awaiting the same proof.
 */
export async function hydrateMissingCanonicalTokenSupplyBoundedV1<
  T extends ExploreEntry,
>(
  entries: readonly T[],
  wait: CanonicalTokenSupplyHydrationWaitV1 = {},
  dependencies: CanonicalTokenSupplyDependencies = {},
): Promise<T[]> {
  if (entries.length === 0) return [];
  const now = wait.now ?? dependencies.now ?? (() => new Date());
  const nowMs = now().getTime();
  const maximumDurationMs = Math.min(
    wait.maximumDurationMs ?? CANONICAL_TOKEN_SUPPLY_PHASE_BUDGET_MS,
    CANONICAL_TOKEN_SUPPLY_PHASE_BUDGET_MS,
  );
  const deadlineMs = Math.min(
    wait.deadlineMs ?? Number.POSITIVE_INFINITY,
    nowMs + maximumDurationMs,
  );
  const remainingMs = deadlineMs - nowMs;
  if (
    wait.signal?.aborted ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(maximumDurationMs) ||
    maximumDurationMs <= 0 ||
    !Number.isFinite(remainingMs) ||
    remainingMs <= 0
  ) return [...entries];

  const pending = hydrateMissingCanonicalTokenSupplyV1(entries, {
    ...dependencies,
    now,
    deadlineMs: Math.min(
      dependencies.deadlineMs ?? Number.POSITIVE_INFINITY,
      deadlineMs,
    ),
    providerTimeoutMs: Math.min(
      validProviderTimeoutMs(dependencies.providerTimeoutMs),
      maximumDurationMs,
    ),
  });
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (value: readonly T[]) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      wait.signal?.removeEventListener("abort", onAbort);
      resolve([...value]);
    };
    const onAbort = () => finish(entries);
    wait.signal?.addEventListener("abort", onAbort, { once: true });
    if (wait.signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(
      () => finish(entries),
      Math.min(Math.ceil(remainingMs), 2_147_483_647),
    );
    void pending.then(finish, () => finish(entries));
  });
}

export function clearCanonicalTokenSupplyCachesForTests(): void {
  if (
    activeSupplyLanes !== 0 ||
    supplyLaneQueue.length !== 0 ||
    snapshotInFlight.size !== 0 ||
    supplyInFlight.size !== 0
  ) {
    throw new Error("Canonical token supply work is still active");
  }
  snapshotCache.clear();
  snapshotInFlight.clear();
  supplyCache.clear();
  supplyInFlight.clear();
}
