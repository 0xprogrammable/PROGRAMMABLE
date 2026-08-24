import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PREDICTION_ASSET_DISCOVERY_CONTROL_SCOPE_V2,
  PREDICTION_ASSET_DISCOVERY_SHARED_LIMITS_REQUIRED_FOR_ACTIVATION_V2,
  createPredictionAssetAutoDiscoveryRequestControllerV2,
} from "../lib/market-data/prediction-asset-auto-discovery-request-control-v2.server";
import type {
  PredictionAssetAutoDiscoveryResultV2,
} from "../lib/market-data/prediction-asset-auto-discovery-v2.server";

const OBSERVED_AT = "2026-08-23T18:00:00.000Z";
const EVM_A = `0x${"ab".repeat(20)}`;
const EVM_B = `0x${"cd".repeat(20)}`;
const EVM_C = `0x${"ef".repeat(20)}`;
const SOLANA_LOCATORS = Object.freeze([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "So11111111111111111111111111111111111111112",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
]);

function indexedEvmAddress(index: number) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function result(
  locator: string,
  status: "not-found" | "inconclusive" = "not-found",
): PredictionAssetAutoDiscoveryResultV2 {
  const base = {
    schemaVersion: 2 as const,
    locator,
    source: null,
    observedAt: OBSERVED_AT,
    usage: "informational-only" as const,
  };
  return status === "not-found"
    ? { ...base, status }
    : {
      ...base,
      status,
      candidates: [],
      failures: [{ sourceNetwork: "base", reason: "identity-unavailable" }],
    };
}

function uniqueResult(locator: string): PredictionAssetAutoDiscoveryResultV2 {
  return {
    schemaVersion: 2,
    locator,
    source: "dexscreener",
    observedAt: OBSERVED_AT,
    usage: "informational-only",
    status: "unique",
    candidate: {
      selectionKey: `evm:8453:${locator}`,
      selection: { mode: "custom", sourceNetwork: "base", assetLocator: locator },
      namespace: "evm",
      chainReference: "8453",
      providerChainId: "base",
      provenance: {
        identity: { source: "onchain-rpc" },
        enrichment: { source: "dexscreener" },
      },
      token: { address: locator, name: "Example", symbol: "EXM" },
      currentPriceUsd: 1,
      marketCapUsd: null,
      fdvUsd: null,
      matchingPairCount: 1,
      pair: {
        dexId: "uniswap",
        pairAddress: `0x${"12".repeat(20)}`,
        matchedSide: "base",
        liquidityUsd: 100_000,
        volume24hUsd: 50_000,
        pairCreatedAt: 1_700_000_000_000,
      },
      links: { imageUrl: null, websites: [], socials: [] },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("prediction asset auto-discovery request control V2", () => {
  it("keeps its bulkhead explicitly per-runtime and activation-gated", () => {
    expect(PREDICTION_ASSET_DISCOVERY_CONTROL_SCOPE_V2)
      .toBe("single-runtime-only");
    expect(PREDICTION_ASSET_DISCOVERY_SHARED_LIMITS_REQUIRED_FOR_ACTIVATION_V2)
      .toBe(true);
  });

  it("coalesces normalized EVM locators before spending another budget unit", async () => {
    const pending = deferred<PredictionAssetAutoDiscoveryResultV2>();
    const read = vi.fn(async () => pending.promise);
    const controller = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      budgetCapacity: 4,
      budgetIntervalMs: 60_000,
      nowMs: () => 1_000,
    });

    const first = controller.read(`  0x${"AB".repeat(20)}  `);
    const second = controller.read(EVM_A);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    pending.resolve(result(EVM_A));

    await expect(first).resolves.toMatchObject({ status: "ok", source: "reader" });
    await expect(second).resolves.toMatchObject({
      status: "ok",
      source: "coalesced",
    });
    expect(read).toHaveBeenCalledWith(EVM_A, {
      signal: expect.any(AbortSignal),
    });
  });

  it("uses a short negative cache but never caches inconclusive reads", async () => {
    let now = 10_000;
    const read = vi.fn(async (locator: string) => result(locator));
    const controller = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      budgetCapacity: 20,
      budgetIntervalMs: 60_000,
      positiveCacheTtlMs: 100,
      negativeCacheTtlMs: 50,
      nowMs: () => now,
    });

    await expect(controller.read(EVM_A)).resolves.toMatchObject({ source: "reader" });
    await expect(controller.read(EVM_A)).resolves.toMatchObject({ source: "cache" });
    now += 51;
    await expect(controller.read(EVM_A)).resolves.toMatchObject({ source: "reader" });
    expect(read).toHaveBeenCalledTimes(2);

    read.mockImplementation(async (locator: string) => result(locator, "inconclusive"));
    await controller.read(EVM_B);
    await controller.read(EVM_B);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("uses a separately bounded positive cache", async () => {
    let now = 15_000;
    const read = vi.fn(async (locator: string) => uniqueResult(locator));
    const controller = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      budgetCapacity: 10,
      budgetIntervalMs: 60_000,
      positiveCacheTtlMs: 100,
      negativeCacheTtlMs: 50,
      nowMs: () => now,
    });

    await expect(controller.read(EVM_A)).resolves.toMatchObject({ source: "reader" });
    await expect(controller.read(EVM_A)).resolves.toMatchObject({ source: "cache" });
    now += 101;
    await expect(controller.read(EVM_A)).resolves.toMatchObject({ source: "reader" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("enforces a bounded refillable global budget and returns a retry delay", async () => {
    let now = 20_000;
    const read = vi.fn(async (locator: string) => result(locator));
    const controller = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      budgetCapacity: 8,
      budgetIntervalMs: 1_000,
      nowMs: () => now,
    });

    await expect(controller.read(EVM_A)).resolves.toMatchObject({ status: "ok" });
    await expect(controller.read(EVM_B)).resolves.toMatchObject({ status: "ok" });
    await expect(controller.read(EVM_C)).resolves.toEqual({
      status: "rate-limited",
      retryAfterSeconds: 1,
    });
    expect(read).toHaveBeenCalledTimes(2);

    now += 500;
    await expect(controller.read(EVM_C)).resolves.toMatchObject({ status: "ok" });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("charges four DEX calls for EVM discovery and one for Solana", async () => {
    const read = vi.fn(async (locator: string) => result(locator));
    const evmController = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      budgetCapacity: 4,
      budgetIntervalMs: 60_000,
      nowMs: () => 25_000,
    });

    await expect(evmController.read(EVM_A)).resolves.toMatchObject({ status: "ok" });
    await expect(evmController.read(EVM_B)).resolves.toMatchObject({
      status: "rate-limited",
    });

    const solanaController = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      budgetCapacity: 4,
      budgetIntervalMs: 60_000,
      nowMs: () => 25_000,
    });
    for (const locator of SOLANA_LOCATORS.slice(0, 4)) {
      await expect(solanaController.read(locator)).resolves.toMatchObject({
        status: "ok",
      });
    }
    await expect(solanaController.read(SOLANA_LOCATORS[4]!)).resolves
      .toMatchObject({ status: "rate-limited" });
    expect(read).toHaveBeenCalledTimes(5);
  });

  it("keeps a full burst plus one minute of refill below 300 DEX calls", async () => {
    let now = 50_000;
    const read = vi.fn(async (locator: string) => result(locator));
    const controller = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      nowMs: () => now,
    });

    for (let index = 1; index <= 36; index += 1) {
      await expect(controller.read(indexedEvmAddress(index))).resolves
        .toMatchObject({ status: "ok" });
    }
    await expect(controller.read(indexedEvmAddress(37))).resolves
      .toMatchObject({ status: "rate-limited" });

    now += 60_000;
    for (let index = 37; index <= 72; index += 1) {
      await expect(controller.read(indexedEvmAddress(index))).resolves
        .toMatchObject({ status: "ok" });
    }
    await expect(controller.read(indexedEvmAddress(73))).resolves
      .toMatchObject({ status: "rate-limited" });

    const outboundDexCalls = read.mock.calls.length * 4;
    expect(outboundDexCalls).toBe(288);
    expect(outboundDexCalls).toBeLessThan(300);
  });

  it("bounds distinct active reads without queueing or charging a rejected read", async () => {
    const pendingA = deferred<PredictionAssetAutoDiscoveryResultV2>();
    const pendingB = deferred<PredictionAssetAutoDiscoveryResultV2>();
    const pendingC = deferred<PredictionAssetAutoDiscoveryResultV2>();
    const pending = new Map([
      [EVM_A, pendingA],
      [EVM_B, pendingB],
      [EVM_C, pendingC],
    ]);
    const read = vi.fn(async (locator: string) => pending.get(locator)!.promise);
    const controller = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      budgetCapacity: 12,
      budgetIntervalMs: 60_000,
      maximumConcurrentReads: 2,
      nowMs: () => 27_000,
    });

    const first = controller.read(EVM_A);
    const second = controller.read(EVM_B);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await expect(controller.read(EVM_C)).resolves.toEqual({
      status: "rate-limited",
      retryAfterSeconds: 1,
    });
    expect(read).toHaveBeenCalledTimes(2);

    const coalesced = controller.read(EVM_A);
    expect(read).toHaveBeenCalledTimes(2);
    pendingA.resolve(result(EVM_A));
    await expect(first).resolves.toMatchObject({ source: "reader" });
    await expect(coalesced).resolves.toMatchObject({ source: "coalesced" });

    const third = controller.read(EVM_C);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    pendingB.resolve(result(EVM_B));
    pendingC.resolve(result(EVM_C));
    await expect(second).resolves.toMatchObject({ status: "ok" });
    await expect(third).resolves.toMatchObject({ status: "ok" });
  });

  it("holds a permit after subscriber abort until an abort-ignoring reader settles", async () => {
    const pendingA = deferred<PredictionAssetAutoDiscoveryResultV2>();
    const pendingB = deferred<PredictionAssetAutoDiscoveryResultV2>();
    let readerSignal: AbortSignal | undefined;
    const read = vi.fn(async (
      locator: string,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => {
      if (locator === EVM_A) {
        readerSignal = options?.signal;
        return pendingA.promise;
      }
      return pendingB.promise;
    });
    const controller = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      budgetCapacity: 8,
      budgetIntervalMs: 60_000,
      maximumConcurrentReads: 1,
      nowMs: () => 28_000,
    });
    const caller = new AbortController();
    const first = controller.read(EVM_A, { signal: caller.signal });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    caller.abort();
    expect(readerSignal?.aborted).toBe(true);

    await expect(controller.read(EVM_B)).resolves.toEqual({
      status: "rate-limited",
      retryAfterSeconds: 1,
    });
    pendingA.resolve(result(EVM_A, "inconclusive"));
    await expect(first).resolves.toMatchObject({ status: "ok" });

    const second = controller.read(EVM_B);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    pendingB.resolve(result(EVM_B));
    await expect(second).resolves.toMatchObject({ status: "ok" });
  });

  it("releases a permit when the reader rejects", async () => {
    const pendingA = deferred<PredictionAssetAutoDiscoveryResultV2>();
    const pendingB = deferred<PredictionAssetAutoDiscoveryResultV2>();
    const read = vi.fn(async (locator: string) =>
      locator === EVM_A ? pendingA.promise : pendingB.promise
    );
    const controller = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      budgetCapacity: 8,
      budgetIntervalMs: 60_000,
      maximumConcurrentReads: 1,
      nowMs: () => 29_000,
    });

    const first = controller.read(EVM_A);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    pendingA.reject(new Error("reader failed"));
    await expect(first).rejects.toThrow("reader failed");

    const second = controller.read(EVM_B);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    pendingB.resolve(result(EVM_B));
    await expect(second).resolves.toMatchObject({ status: "ok" });
  });

  it.each([0, 33, 1.5])(
    "rejects invalid maximum concurrency %s",
    (maximumConcurrentReads) => {
      expect(() => createPredictionAssetAutoDiscoveryRequestControllerV2({
        maximumConcurrentReads,
      })).toThrow(/maximumConcurrentReads/u);
    },
  );

  it("does not let one cancelled subscriber abort a shared read", async () => {
    const completed = deferred<PredictionAssetAutoDiscoveryResultV2>();
    let sharedSignal: AbortSignal | undefined;
    const read = vi.fn(async (
      _locator: string,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => {
      sharedSignal = options?.signal;
      return completed.promise;
    });
    const controller = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      nowMs: () => 30_000,
    });
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();

    const first = controller.read(EVM_A, { signal: firstAbort.signal });
    const second = controller.read(EVM_A, { signal: secondAbort.signal });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    firstAbort.abort();
    expect(sharedSignal?.aborted).toBe(false);
    completed.resolve(result(EVM_A));

    await expect(first).resolves.toMatchObject({ status: "ok" });
    await expect(second).resolves.toMatchObject({ status: "ok" });
  });

  it("aborts the shared reader after every subscriber cancels", async () => {
    let sharedSignal: AbortSignal | undefined;
    const read = vi.fn(async (
      locator: string,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => {
      sharedSignal = options?.signal;
      await new Promise<void>((resolve) => {
        options?.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return result(locator, "inconclusive");
    });
    const controller = createPredictionAssetAutoDiscoveryRequestControllerV2({
      reader: { read },
      nowMs: () => 40_000,
    });
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();

    const first = controller.read(EVM_A, { signal: firstAbort.signal });
    const second = controller.read(EVM_A, { signal: secondAbort.signal });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    firstAbort.abort();
    expect(sharedSignal?.aborted).toBe(false);
    secondAbort.abort();

    await expect(first).resolves.toMatchObject({ status: "ok" });
    await expect(second).resolves.toMatchObject({ status: "ok" });
    expect(sharedSignal?.aborted).toBe(true);
  });
});
