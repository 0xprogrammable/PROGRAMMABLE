import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExploreEntry } from "../lib/tokens";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ readDurable: vi.fn() }));

vi.mock("../lib/onchain/config", () => ({
  getOnchainDeployment: vi.fn(() => ({
    status: "ready",
    environment: "production",
    chainId: 1,
  })),
}));
vi.mock("../lib/onchain/durable-model", () => ({
  readDurableExploreModel: mocks.readDurable,
}));

const NOW = "2026-08-16T08:00:00.000Z";

function durableToken() {
  return {
    id: "1:0x1111111111111111111111111111111111111111",
    name: "Durable Token",
    symbol: "DUR",
    tokenAddress: "0x1111111111111111111111111111111111111111",
    hookAddress: "0x3333333333333333333333333333333333333333",
    poolId: `0x${"44".repeat(32)}`,
    launchedAt: NOW,
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    launchModel: "classic",
    launchModelVersion: "classic-v3",
  };
}

function envelope() {
  return {
    schemaVersion: "programmable-durable-index-v4",
    contentHash: `0x${"ab".repeat(32)}`,
    payload: {
      generatedAt: NOW,
      model: {
        status: "ready",
        tokens: [durableToken()],
        snapshot: {
          chainId: 1,
          blockNumber: "25740000",
          blockHash: `0x${"cd".repeat(32)}`,
        },
      },
    },
  };
}

async function reader() {
  vi.resetModules();
  return await import("../lib/market-data/last-good-launch-catalog.server");
}

describe("last-good launch catalog", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("uses a content-validated fresh durable envelope", async () => {
    mocks.readDurable.mockResolvedValue({
      status: "ready",
      envelope: envelope(),
      ageMs: 1_000,
    });
    const { readLastGoodLaunchCatalogV1 } = await reader();
    const catalog = await readLastGoodLaunchCatalogV1();
    expect(catalog).toMatchObject({
      source: "durable-blob",
      status: "current",
      generatedAt: NOW,
      asOfBlock: "25740000",
      entries: [{
        exploreKind: "token",
        tokenAddress: "0x1111111111111111111111111111111111111111",
      }],
      evidence: {
        kind: "durable-envelope",
        commitment: `0x${"ab".repeat(32)}`,
      },
    });
  });

  it("serves a stale durable envelope only as last-known-good", async () => {
    mocks.readDurable.mockResolvedValue({
      status: "unavailable",
      reason: "stale",
      detail: "stale",
      envelope: envelope(),
      ageMs: 86_400_000,
    });
    const { readLastGoodLaunchCatalogV1 } = await reader();
    const catalog = await readLastGoodLaunchCatalogV1();
    expect(catalog.status).toBe("last-known-good");
    expect(catalog.entries).toHaveLength(1);
  });

  it("includes only verified Custom results that produced a token or market", async () => {
    const { mergeLastGoodLaunchCatalogEntriesV1 } = await reader();
    const customBase = {
      exploreKind: "custom-project",
      id: `custom:sha256:${"11".repeat(32)}`,
      markets: [],
    } as const;
    const tokenOnly = {
      ...customBase,
      id: `custom:sha256:${"22".repeat(32)}`,
      tokenAddress: "0x2222222222222222222222222222222222222222",
    };
    const marketOnly = {
      ...customBase,
      id: `custom:sha256:${"33".repeat(32)}`,
      markets: [{ marketId: "market-only" }],
    };

    const merged = mergeLastGoodLaunchCatalogEntriesV1(
      [],
      [customBase, tokenOnly, marketOnly] as unknown as readonly ExploreEntry[],
    );

    expect(merged.map((entry) => entry.id)).toEqual([
      tokenOnly.id,
      marketOnly.id,
    ]);
  });

  it("fails closed when the validated durable catalog is missing", async () => {
    mocks.readDurable.mockResolvedValue({
      status: "unavailable",
      reason: "missing",
      detail: "missing",
    });
    const { readLastGoodLaunchCatalogV1 } = await reader();
    await expect(readLastGoodLaunchCatalogV1()).rejects.toThrow(
      "Durable launch catalog is missing",
    );
  });

  it("does not invent an identity fallback when the Blob read throws", async () => {
    mocks.readDurable.mockRejectedValue(new Error("blob transport unavailable"));
    const { readLastGoodLaunchCatalogV1 } = await reader();
    await expect(readLastGoodLaunchCatalogV1()).rejects.toThrow(
      "blob transport unavailable",
    );
  });

  it("cancels and unpins the shared read after its last caller deadline", async () => {
    vi.useFakeTimers();
    let durableSignal: AbortSignal | undefined;
    mocks.readDurable.mockImplementation((_deployment, options) => {
      durableSignal = options.signal;
      return new Promise((resolve) => {
        durableSignal?.addEventListener("abort", () => resolve({
          status: "unavailable",
          reason: "invalid",
          detail: "aborted",
        }), { once: true });
      });
    });
    const { readLastGoodLaunchCatalogV1 } = await reader();

    const first = readLastGoodLaunchCatalogV1({
      deadlineMs: Date.now() + 100,
    });
    const rejected = expect(first).rejects.toThrow(
      "Durable launch catalog deadline exceeded",
    );
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(durableSignal?.aborted).toBe(true);

    await Promise.resolve();
    await Promise.resolve();
    mocks.readDurable.mockResolvedValue({
      status: "ready",
      envelope: envelope(),
      ageMs: 1_000,
    });
    await expect(readLastGoodLaunchCatalogV1()).resolves.toMatchObject({
      source: "durable-blob",
      status: "current",
    });
    expect(mocks.readDurable).toHaveBeenCalledTimes(2);
  });

  it("keeps a shared read alive while another request is still waiting", async () => {
    const firstRequest = new AbortController();
    let durableSignal: AbortSignal | undefined;
    let resolveDurable!: (value: unknown) => void;
    mocks.readDurable.mockImplementation((_deployment, options) => {
      durableSignal = options.signal;
      return new Promise((resolve) => {
        resolveDurable = resolve;
      });
    });
    const { readLastGoodLaunchCatalogV1 } = await reader();

    const first = readLastGoodLaunchCatalogV1({
      signal: firstRequest.signal,
    });
    const second = readLastGoodLaunchCatalogV1();
    firstRequest.abort(new Error("first request disconnected"));
    await expect(first).rejects.toThrow("first request disconnected");
    expect(durableSignal?.aborted).toBe(false);

    resolveDurable({
      status: "ready",
      envelope: envelope(),
      ageMs: 1_000,
    });
    await expect(second).resolves.toMatchObject({ status: "current" });
    expect(mocks.readDurable).toHaveBeenCalledTimes(1);
  });
});
