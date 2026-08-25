import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const mocks = vi.hoisted(() => ({
  readCatalog: vi.fn(),
  readDex: vi.fn(),
  identityCommitment: vi.fn(() => `sha256:${"ef".repeat(32)}`),
  mergeEntries: vi.fn((canonical: readonly unknown[], custom: readonly unknown[]) => [
    ...canonical,
    ...custom,
  ]),
  customEnabled: vi.fn(() => false),
  readCustom: vi.fn(),
  readRouter: vi.fn(),
  mergeRouter: vi.fn((existing: readonly unknown[], router: readonly unknown[]) => [
    ...existing,
    ...router,
  ]),
  routerStatus: vi.fn((): "current" | "last-known-good" => "current"),
  readSourceVerification: vi.fn(),
}));

vi.mock("../lib/market-data/envio-classic-v3-catalog.server", () => ({
  readEnvioClassicV3CatalogV1: mocks.readCatalog,
  envioClassicV3IdentityCommitmentV1: mocks.identityCommitment,
  mergeEnvioClassicV3CatalogEntriesV1: mocks.mergeEntries,
}));
vi.mock("../lib/market-data/dexscreener-explore.server", () => ({
  readDexscreenerExploreEntriesV1: mocks.readDex,
}));
vi.mock("../lib/server/custom-launch/public-readiness", () => ({
  isCustomLaunchRegistryPublicReadEnabled: mocks.customEnabled,
}));
vi.mock("../lib/server/custom-launch/explore-directory-v1", () => ({
  readProductionCustomExploreDirectoryV1: mocks.readCustom,
}));
vi.mock("../lib/server/custom-launch/source-verification-display-v1", () => ({
  readProductionSourceVerificationDisplayV1: mocks.readSourceVerification,
}));
vi.mock("../lib/alchemy/router-custom-public.server", () => ({
  ROUTER_CUSTOM_FINALITY_CONFIRMATIONS: 64,
  ROUTER_CUSTOM_LAUNCH_SOURCE: "canonical-launch-stamp-router",
  readFinalizedRouterCustomExploreEntriesV1: mocks.readRouter,
  readFinalizedRouterCustomIdentitySnapshotV1: async (...args: unknown[]) => {
    const entries = await mocks.readRouter(...args);
    return {
      schemaVersion: "programmable.router-custom-identity-snapshot.v1",
      source: "canonical-launch-stamp-router",
      status: mocks.routerStatus(),
      generatedAt: "2026-08-16T08:00:01.000Z",
      asOfBlock: "25740001",
      asOfBlockHash: `0x${"bc".repeat(32)}`,
      finalityConfirmations: 64,
      identityCommitment: `sha256:${"ac".repeat(32)}`,
      entries,
    };
  },
  routerCustomEntriesAtOrBeforeBlockV1: (entries: readonly unknown[]) => entries,
  mergeRouterCustomExploreEntriesV1: mocks.mergeRouter,
  publicLaunchSourceV1: (input: Readonly<{
    envioAvailable?: boolean;
    registryCustomCurrent: boolean;
    routerCustomCurrent: boolean;
  }>) => [
    ...(input.envioAvailable === false ? [] : ["envio-classic-v3"]),
    ...(input.registryCustomCurrent ? ["registry.custom-launched"] : []),
    ...(input.routerCustomCurrent ? ["canonical-launch-stamp-router"] : []),
  ].join("+"),
}));

import { GET } from "../app/api/explore/token/route";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";
import { fadeRouterTradeEntry } from "./fade-router-trade-fixture";

const NOW = "2026-08-16T08:00:00.000Z";

function token(): ExploreEntry {
  const value = {
    id: "1:0x1111111111111111111111111111111111111111",
    name: "Known Token",
    symbol: "KNOWN",
    tokenAddress: "0x1111111111111111111111111111111111111111",
    hookAddress: "0x3333333333333333333333333333333333333333",
    poolId: `0x${"44".repeat(32)}` as const,
    launchedAt: NOW,
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    launchModel: "classic",
    launchModelVersion: "classic-v3",
  } satisfies LauncherToken;
  return {
    ...value,
    exploreKind: "token",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: value.id,
      modelId: "classic",
      modelVersion: "classic-v3",
    },
  };
}

const entry = token();
const customAddress = "0x9999999999999999999999999999999999999999" as const;
const customEntry = {
  exploreKind: "custom-project",
  id: `custom:sha256:${"55".repeat(32)}`,
  name: "Custom Project",
  symbol: "CUSTOM",
  links: [],
  launchedAt: NOW,
  finalizedAt: NOW,
  chainId: "1",
  modelId: "custom-model",
  customProjectId: `sha256:${"55".repeat(32)}`,
  customLaunchId: `sha256:${"66".repeat(32)}`,
  launchingWallet: {
    namespace: "eip155:1",
    value: "0x3333333333333333333333333333333333333333",
  },
  postLaunchAuthorityInventory: {},
  postLaunchAuthorityInventoryHash: `sha256:${"77".repeat(32)}`,
  tokenAddress: customAddress,
  tokenDecimals: 18,
  markets: [],
  launchCategoryProvenance: {},
} as unknown as ExploreEntry;

function catalog(
  input: Readonly<{ status?: "current" | "last-known-good" }> = {},
) {
  return {
    source: "envio-classic-v3",
    status: input.status ?? "current",
    generatedAt: NOW,
    asOfBlock: "25740000",
    asOfBlockHash: `0x${"ab".repeat(32)}`,
    entries: [entry],
    completeness: {
      classic: "last-known-good",
      stock: "excluded",
      custom: "unavailable",
    },
    scope: {
      included: [
        "classic-v3",
        "official-main-token",
        "registry.custom-launched",
      ],
      excluded: [
        "classic-v1",
        "classic-v2",
        "stock-paired-v1",
        "stock-paired-v2",
        "stock-paired-v3",
      ],
      publicCategories: ["classic", "custom"],
    },
    evidence: {
      kind: "envio-indexer-state",
      deployment: "production-92f6373",
      sourceCommit: "92f63731ff0a61601a649cf40ceba3e492f63c62",
      progressBlock: "25740000",
      progressOccurrenceId: `1:0x${"11".repeat(32)}:0x${"22".repeat(32)}:0`,
      commitment: `sha256:${"cd".repeat(32)}`,
    },
  };
}

function marketRead(status: "complete" | "partial" | "unavailable") {
  const available = status === "complete";
  return {
    provider: "dexscreener",
    status,
    currency: "USD",
    requestedCount: 1,
    observedCount: available ? 1 : 0,
    qualifiedCount: available ? 1 : 0,
    unavailableCount: available ? 0 : 1,
    oldestFetchedAt: available ? NOW : null,
    newestFetchedAt: available ? NOW : null,
  };
}

function request(address: string = entry.tokenAddress!, extra = "") {
  return new NextRequest(
    `http://localhost/api/explore/token?address=${address}${extra}`,
  );
}

async function json(response: Response) {
  // Test fixtures intentionally inspect several public response variants.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await response.json() as Record<string, any>;
}

describe("Token detail static identity and Dexscreener market contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readCatalog.mockResolvedValue(catalog());
    mocks.customEnabled.mockReturnValue(false);
    mocks.readCustom.mockResolvedValue([]);
    mocks.readRouter.mockResolvedValue([]);
    mocks.mergeRouter.mockImplementation(
      (existing: readonly unknown[], router: readonly unknown[]) => [
        ...existing,
        ...router,
      ],
    );
    mocks.routerStatus.mockReturnValue("current");
    mocks.readSourceVerification.mockResolvedValue({
      schemaVersion: "programmable.source-verification-display.v1",
      status: "not-verified",
      label: "Source not verified",
      updatedAt: null,
    });
    mocks.readDex.mockResolvedValue({
      entries: [{
        ...entry,
        valuation: {
          status: "available",
          metric: "fdv",
          supplyBasis: "total",
          currency: "usd",
          valueWad: "9000000000000000000000",
          freshness: "provider-recent",
          source: "dexscreener",
          asOfTime: NOW,
        },
      }],
      marketRead: marketRead("complete"),
    });
  });

  it("serves an independently verified Custom Registry identity fail-soft", async () => {
    mocks.customEnabled.mockReturnValue(true);
    mocks.readCustom.mockResolvedValue([customEntry]);
    mocks.readDex.mockResolvedValueOnce({
      entries: [{
        ...customEntry,
        valuation: { status: "unavailable", reason: "no-market" },
      }],
      marketRead: {
        ...marketRead("complete"),
        requestedCount: 0,
        observedCount: 0,
        qualifiedCount: 0,
        unavailableCount: 0,
      },
    });

    const response = await GET(request(customAddress));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.customProject).toMatchObject({
      id: customEntry.id,
      tokenAddress: customAddress,
      valuation: { status: "unavailable", reason: "no-market" },
    });
    expect(body.token).toBeNull();
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router",
    );
  });

  it("preserves a verified Custom identity when the market adapter throws", async () => {
    mocks.customEnabled.mockReturnValue(true);
    mocks.readCustom.mockResolvedValue([customEntry]);
    mocks.readDex.mockRejectedValueOnce(new Error("Dex transport failed"));

    const response = await GET(request(customAddress));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.token).toBeNull();
    expect(body.customProject).toMatchObject({
      id: customEntry.id,
      tokenAddress: customAddress,
      valuation: { status: "unavailable", reason: "source-unavailable" },
    });
    expect(body.catalog).toMatchObject({
      launchSource:
        "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router",
      completeness: { custom: "current" },
    });
  });

  it("resolves a finalized Router Custom identity from its Explore card URL", async () => {
    mocks.readRouter.mockResolvedValue([customGraphExploreEntry]);
    mocks.mergeRouter.mockReturnValue([customGraphExploreEntry]);
    mocks.readDex.mockResolvedValueOnce({
      entries: [{
        ...customGraphExploreEntry,
        valuation: { status: "unavailable", reason: "source-unavailable" },
      }],
      marketRead: marketRead("unavailable"),
    });

    const response = await GET(request(customGraphExploreEntry.tokenAddress));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.token).toMatchObject({
      tokenAddress: customGraphExploreEntry.tokenAddress,
      launchModel: "custom-graph",
      launchCategoryProvenance: {
        source: "canonical-launch-stamp-router",
      },
    });
    expect(body.catalog.routerStamp).toMatchObject({
      status: "current",
      verifiedIdentityCount: 1,
      projectedIdentityCount: 1,
    });
    expect(body.sourceVerification).toEqual({
      schemaVersion: "programmable.source-verification-display.v1",
      status: "not-verified",
      label: "Source not verified",
      updatedAt: null,
    });
    expect(mocks.readSourceVerification).toHaveBeenCalledWith(
      customGraphExploreEntry.tokenAddress,
      expect.any(AbortSignal),
    );
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "envio-classic-v3+canonical-launch-stamp-router",
    );
  });

  it("serves the exact Router token when Envio is unavailable", async () => {
    mocks.readCatalog.mockRejectedValue(new Error("Envio unavailable"));
    mocks.readRouter.mockResolvedValue([customGraphExploreEntry]);
    mocks.readDex.mockResolvedValueOnce({
      entries: [{
        ...customGraphExploreEntry,
        valuation: { status: "unavailable", reason: "source-unavailable" },
      }],
      marketRead: marketRead("unavailable"),
    });

    const response = await GET(request(customGraphExploreEntry.tokenAddress));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.token).toMatchObject({
      tokenAddress: customGraphExploreEntry.tokenAddress,
      launchModel: "custom-graph",
    });
    expect(body.catalog).toMatchObject({
      launchSource: "canonical-launch-stamp-router",
      completeness: {
        classic: "unavailable",
        routerCustom: "current",
      },
    });
    expect(response.headers.get("x-programmable-canonical-read-status")).toBe(
      "unavailable",
    );
  });

  it("fails closed when a requested Router identity conflicts during merge", async () => {
    mocks.customEnabled.mockReturnValue(true);
    mocks.readCustom.mockResolvedValue([customEntry]);
    mocks.readRouter.mockResolvedValue([{
      ...customGraphExploreEntry,
      tokenAddress: customAddress,
    }]);
    mocks.mergeRouter.mockImplementationOnce(() => {
      throw new Error("Registry and Router disagree on token pool binding");
    });

    const response = await GET(request(customAddress));

    expect(response.status).toBe(503);
    expect(response.headers.get("x-programmable-router-read-status")).toBe(
      "unavailable",
    );
    expect(mocks.readDex).not.toHaveBeenCalled();
  });

  it("does not publish a Registry-only identity without an onchain boundary", async () => {
    mocks.readCatalog.mockRejectedValue(new Error("Envio unavailable"));
    mocks.customEnabled.mockReturnValue(true);
    mocks.readCustom.mockResolvedValue([customEntry]);
    mocks.readRouter.mockRejectedValue(new Error("Router unavailable"));

    const response = await GET(request(customAddress));

    expect(response.status).toBe(503);
    expect(mocks.readDex).not.toHaveBeenCalled();
  });

  it("attaches a trade project only to the exact finalized FADE Router stamp", async () => {
    mocks.readRouter.mockResolvedValue([fadeRouterTradeEntry]);
    mocks.readDex.mockResolvedValueOnce({
      entries: [{
        ...fadeRouterTradeEntry,
        valuation: { status: "unavailable", reason: "source-unavailable" },
      }],
      marketRead: marketRead("unavailable"),
    });

    const response = await GET(request(fadeRouterTradeEntry.tokenAddress));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.token.tokenAddress).toBe(fadeRouterTradeEntry.tokenAddress);
    expect(body.customProject).toBeNull();
    expect(body.routerTradeProject).toMatchObject({
      customProjectId:
        "sha256:e7bf1306fc05ef655e3ebebe9566ff86c74b4de21465c3d836cbf3f497865c2d",
      markets: [{
        marketId: "fade-eth-v4",
        poolId: fadeRouterTradeEntry.poolId,
        tradeCapability: {
          tradeCapabilityBindingHash:
            "sha256:2bf52e6d8c476c5d7aa0cbb4724ef9e2e9e132b60c4ffdb5cb9522f89749bbff",
          hookDataPolicy: { kind: "empty", data: "0x" },
        },
      }],
    });
  });

  it("keeps known Envio identity visible when Router discovery fails", async () => {
    mocks.readRouter.mockRejectedValue(new Error("router unavailable"));
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect((await json(response)).token.id).toBe(entry.id);
    expect(response.headers.get("x-programmable-router-read-status")).toBe(
      "unavailable",
    );
  });

  it("returns 503 for an unknown identity while Router discovery is unavailable", async () => {
    mocks.readRouter.mockRejectedValue(new Error("router unavailable"));
    const response = await GET(
      request("0x8888888888888888888888888888888888888888"),
    );

    expect(response.status).toBe(503);
    expect(mocks.readDex).not.toHaveBeenCalled();
  });

  it("does not claim absence from a last-known-good Router snapshot", async () => {
    mocks.routerStatus.mockReturnValue("last-known-good");
    const response = await GET(
      request("0x8888888888888888888888888888888888888888"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("x-programmable-router-read-status")).toBe(
      "last-known-good",
    );
    expect(mocks.readDex).not.toHaveBeenCalled();
  });

  it("does not claim absence from a last-known-good Envio catalog", async () => {
    mocks.readCatalog.mockResolvedValue(catalog({
      status: "last-known-good",
    }));
    const response = await GET(
      request("0x8888888888888888888888888888888888888888"),
    );

    expect(response.status).toBe(503);
    expect(mocks.readDex).not.toHaveBeenCalled();
  });

  it("keeps a canonical identity visible when the Custom Registry is unavailable", async () => {
    mocks.customEnabled.mockReturnValue(true);
    mocks.readCustom.mockRejectedValue(new Error("custom unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await json(response)).token.id).toBe(entry.id);
  });

  it("serves a known identity with Dexscreener FDV", async () => {
    const response = await GET(request());
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      token: {
        id: entry.id,
        tokenAddress: entry.tokenAddress,
        valuation: {
          status: "available",
          source: "dexscreener",
          valueWad: "9000000000000000000000",
        },
      },
      customProject: null,
      snapshot: { chainId: 1 },
    });
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "envio-classic-v3+canonical-launch-stamp-router+dexscreener",
    );
    expect(response.headers.get("x-programmable-price-source")).toBe(
      "dexscreener",
    );
  });

  it("retains the requested identity when Dexscreener has no exact pair", async () => {
    mocks.readDex.mockResolvedValueOnce({
      entries: [{
        ...entry,
        valuation: { status: "unavailable", reason: "source-unavailable" },
      }],
      marketRead: marketRead("unavailable"),
    });
    const response = await GET(request());
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.token).toMatchObject({
      id: entry.id,
      tokenAddress: entry.tokenAddress,
      valuation: { status: "unavailable", reason: "source-unavailable" },
    });
    expect(response.headers.get("x-programmable-market-source")).toBeNull();
    expect(response.headers.get("x-programmable-price-source")).toBeNull();
    expect(response.headers.get("x-programmable-market-read-status")).toBe(
      "unavailable",
    );
  });

  it("retains the identity when the market adapter unexpectedly throws", async () => {
    mocks.readDex.mockRejectedValueOnce(new Error("Dex outage"));
    const response = await GET(request());
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.token.id).toBe(entry.id);
    expect(body.token.valuation).toEqual({
      status: "unavailable",
      reason: "source-unavailable",
    });
  });

  it("returns 404 without invoking Dex for an unknown identity", async () => {
    const response = await GET(
      request("0x9999999999999999999999999999999999999999"),
    );
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ token: null, customProject: null });
    expect(mocks.readDex).not.toHaveBeenCalled();
  });

  it.each([
    ["0x1234", ""],
    [entry.tokenAddress!, "&unexpected=true"],
    [entry.tokenAddress!, `&address=${entry.tokenAddress}`],
  ])("rejects malformed or repeated input", async (address, extra) => {
    const response = await GET(request(address, extra));
    expect(response.status).toBe(400);
    expect(mocks.readCatalog).not.toHaveBeenCalled();
    expect(mocks.readDex).not.toHaveBeenCalled();
  });

  it("returns 503 only when no validated identity catalog can be read", async () => {
    mocks.readCatalog.mockRejectedValueOnce(new Error("catalog unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({
      error: "Token data is temporarily unavailable",
    });
    expect(mocks.readDex).not.toHaveBeenCalled();
  });
});
