import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
