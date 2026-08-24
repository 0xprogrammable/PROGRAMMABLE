import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  releaseEnabled: false,
  releaseBranded: true,
  releaseError: false,
  assertRelease: vi.fn(),
  providerRouteReady: true,
  readinessBranded: true,
  getReadiness: vi.fn(),
  assertReadiness: vi.fn(),
  loaded: vi.fn(),
  read: vi.fn(),
  capabilityModuleLoaded: vi.fn(),
  issueLogoCapability: vi.fn(),
}));

vi.mock(
  "../lib/market-data/prediction-v2-provider-route-readiness.server",
  () => ({
    getPredictionV2ProviderRouteReadinessV2: () => {
      mocks.getReadiness();
      return { productionReady: mocks.providerRouteReady };
    },
    assertPredictionV2ProviderRouteReadinessV2: (readiness: unknown) => {
      mocks.assertReadiness(readiness);
      if (!mocks.readinessBranded) throw new Error("unbranded readiness");
    },
  }),
);

vi.mock("../lib/prediction-v2/public-release-v2.server", () => ({
  getPredictionV2PublicReleaseV2: () => {
    if (mocks.releaseError) throw new Error("invalid public release");
    return { status: mocks.releaseEnabled ? "enabled" : "disabled" };
  },
  assertPredictionV2VerifiedEnabledPublicReleaseV2: (release: unknown) => {
    mocks.assertRelease(release);
    if (!mocks.releaseBranded) throw new Error("unbranded public release");
  },
}));

vi.mock(
  "../lib/market-data/prediction-asset-auto-discovery-request-control-v2.server",
  () => {
    mocks.loaded();
    return { readControlledPredictionAssetAutoDiscoveryV2: mocks.read };
  },
);

vi.mock(
  "../lib/market-data/prediction-asset-logo-capability-v2.server",
  () => {
    mocks.capabilityModuleLoaded();
    return {
      createConfiguredPredictionAssetLogoCapabilityV2:
        mocks.issueLogoCapability,
    };
  },
);

import { NextRequest } from "next/server";

import { GET } from "../app/api/prediction/asset-auto-discovery/route";

const EVM_ADDRESS = `0x${"ab".repeat(20)}`;
const IMAGE_ASSET_ID = "cd".repeat(32);
const LOGO_CAPABILITY = `v2.preview-1.1800000600.${"a".repeat(43)}`;

function request(query: string) {
  return new NextRequest(
    `http://localhost/api/prediction/asset-auto-discovery?${query}`,
  );
}

function result(status: string) {
  return {
    schemaVersion: 2,
    locator: EVM_ADDRESS,
    status,
    source: status === "unique" || status === "ambiguous"
      ? "dexscreener"
      : null,
    observedAt: "2026-08-23T18:00:00.000Z",
    usage: "informational-only",
  };
}

describe("Prediction V2 asset auto-discovery route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.releaseEnabled = false;
    mocks.releaseBranded = true;
    mocks.releaseError = false;
    mocks.providerRouteReady = true;
    mocks.readinessBranded = true;
    mocks.issueLogoCapability.mockReturnValue(null);
  });

  it("keeps a malformed release binding dark", async () => {
    mocks.releaseError = true;
    const opaqueRequest = new Proxy({} as NextRequest, {
      get() {
        throw new Error("malformed release must keep Request opaque");
      },
    });

    const response = await GET(opaqueRequest);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect(mocks.capabilityModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.getReadiness).not.toHaveBeenCalled();
  });

  it("keeps an unbranded enabled release dark", async () => {
    mocks.releaseEnabled = true;
    mocks.releaseBranded = false;
    const opaqueRequest = new Proxy({} as NextRequest, {
      get() {
        throw new Error("unbranded release must keep Request opaque");
      },
    });

    const response = await GET(opaqueRequest);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.assertRelease).toHaveBeenCalledTimes(1);
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect(mocks.capabilityModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.getReadiness).not.toHaveBeenCalled();
  });

  it("keeps provider work dark without branded shared route controls", async () => {
    mocks.releaseEnabled = true;
    mocks.providerRouteReady = false;
    const opaqueRequest = new Proxy({} as NextRequest, {
      get() {
        throw new Error("unready provider controls must keep Request opaque");
      },
    });

    const response = await GET(opaqueRequest);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.assertRelease).toHaveBeenCalledTimes(1);
    expect(mocks.getReadiness).toHaveBeenCalledTimes(1);
    expect(mocks.assertReadiness).toHaveBeenCalledTimes(1);
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect(mocks.capabilityModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([
    "",
    `locator=${EVM_ADDRESS}`,
    `locator=${EVM_ADDRESS}&extra=true`,
  ] as const)("returns a dark, non-cacheable 404 before inspecting query %s", async (
    query,
  ) => {
    const response = await GET(request(query));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([
    "",
    `locator=${EVM_ADDRESS}&locator=${EVM_ADDRESS}`,
    `locator=${EVM_ADDRESS}&network=base`,
    `locator=${"a".repeat(129)}`,
  ])("rejects an invalid enabled query before loading the provider: %s", async (
    query,
  ) => {
    mocks.releaseEnabled = true;

    const response = await GET(request(query));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-identity-source")).toBeNull();
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    expect(response.headers.get("x-programmable-read-purpose")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Enter one exact token address",
    });
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("returns a cacheable informational unique result and forwards cancellation", async () => {
    mocks.releaseEnabled = true;
    mocks.read.mockResolvedValueOnce({
      status: "ok",
      source: "reader",
      result: {
        ...result("unique"),
        candidate: { selection: { sourceNetwork: "base" } },
      },
    });
    const input = request(`locator=%20${EVM_ADDRESS}%20`);

    const response = await GET(input);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=15");
    expect(response.headers.get("x-programmable-market-provider"))
      .toBe("dexscreener");
    expect(response.headers.get("x-programmable-identity-source"))
      .toBe("onchain-rpc");
    expect(response.headers.get("x-programmable-read-purpose"))
      .toBe("informational-only");
    expect(mocks.read).toHaveBeenCalledWith(EVM_ADDRESS, {
      signal: input.signal,
    });
    expect(mocks.assertRelease).toHaveBeenCalledTimes(1);
    expect(mocks.assertReadiness).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      status: "unique",
      candidate: { logoProxy: null },
    });
    expect(mocks.capabilityModuleLoaded).not.toHaveBeenCalled();
  });

  it("issues one exact transient logo capability for a verified enriched candidate", async () => {
    mocks.releaseEnabled = true;
    mocks.issueLogoCapability.mockReturnValue(LOGO_CAPABILITY);
    mocks.read.mockResolvedValueOnce({
      status: "ok",
      source: "reader",
      result: {
        ...result("unique"),
        candidate: {
          selection: { sourceNetwork: "base" },
          provenance: {
            identity: { source: "onchain-rpc" },
            enrichment: { source: "dexscreener" },
          },
          links: {
            imageUrl:
              `https://cdn.dexscreener.com/cms/images/${IMAGE_ASSET_ID}`,
          },
        },
      },
    });

    const response = await GET(request(`locator=${EVM_ADDRESS}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      candidate: {
        logoProxy: {
          assetId: IMAGE_ASSET_ID,
          capability: LOGO_CAPABILITY,
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("cdn.dexscreener.com");
    expect(JSON.stringify(body)).not.toContain("payloadSha256");
    expect(body.candidate.links).toEqual({ websites: [], socials: [] });
    expect(mocks.issueLogoCapability).toHaveBeenCalledWith(IMAGE_ASSET_ID);
    expect(mocks.capabilityModuleLoaded).toHaveBeenCalledTimes(1);
  });

  it("keeps verified discovery available when optional logo issuance fails", async () => {
    mocks.releaseEnabled = true;
    mocks.issueLogoCapability.mockImplementation(() => {
      throw new Error("logo key unavailable");
    });
    mocks.read.mockResolvedValueOnce({
      status: "ok",
      source: "reader",
      result: {
        ...result("unique"),
        candidate: {
          provenance: {
            identity: { source: "onchain-rpc" },
            enrichment: { source: "dexscreener" },
          },
          links: {
            imageUrl:
              `https://cdn.dexscreener.com/cms/images/${IMAGE_ASSET_ID}`,
          },
        },
      },
    });

    const response = await GET(request(`locator=${EVM_ADDRESS}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "unique",
      candidate: { logoProxy: null },
    });
  });

  it("drops a malformed optional capability without exposing the provider URL", async () => {
    mocks.releaseEnabled = true;
    mocks.issueLogoCapability.mockReturnValue(
      `v1.preview-1.${"a".repeat(43)}`,
    );
    mocks.read.mockResolvedValueOnce({
      status: "ok",
      source: "reader",
      result: {
        ...result("unique"),
        candidate: {
          provenance: {
            identity: { source: "onchain-rpc" },
            enrichment: { source: "dexscreener" },
          },
          links: {
            imageUrl:
              `https://cdn.dexscreener.com/cms/images/${IMAGE_ASSET_ID}`,
          },
        },
      },
    });

    const response = await GET(request(`locator=${EVM_ADDRESS}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "unique",
      candidate: { logoProxy: null },
    });
    expect(JSON.stringify(body)).not.toContain("cdn.dexscreener.com");
  });

  it("attributes an identity-only result to RPC without inventing DEX enrichment", async () => {
    mocks.releaseEnabled = true;
    mocks.read.mockResolvedValueOnce({
      status: "ok",
      source: "reader",
      result: {
        ...result("unique"),
        source: null,
        candidate: { selection: { sourceNetwork: "base" } },
      },
    });

    const response = await GET(request(`locator=${EVM_ADDRESS}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-programmable-identity-source"))
      .toBe("onchain-rpc");
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    expect(response.headers.get("x-programmable-read-purpose"))
      .toBe("informational-only");
  });

  it.each([
    ["ambiguous", 200, false],
    ["invalid", 400, false],
    ["not-found", 404, false],
    ["inconclusive", 503, true],
  ] as const)("maps %s to HTTP %i", async (
    discoveryStatus,
    expectedStatus,
    retryable,
  ) => {
    mocks.releaseEnabled = true;
    mocks.read.mockResolvedValueOnce({
      status: "ok",
      source: "reader",
      result: result(discoveryStatus),
    });

    const response = await GET(request(`locator=${EVM_ADDRESS}`));

    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("retry-after")).toBe(retryable ? "5" : null);
    expect(response.headers.get("cache-control")).toBe(
      discoveryStatus === "ambiguous"
        ? "public, max-age=0, s-maxage=15, stale-while-revalidate=30"
        : "no-store",
    );
    expect(response.headers.get("x-programmable-identity-source")).toBe(
      discoveryStatus === "invalid" ? null : "onchain-rpc",
    );
    expect(response.headers.get("x-programmable-market-provider")).toBe(
      discoveryStatus === "ambiguous" ? "dexscreener" : null,
    );
  });

  it("maps the local provider budget to a non-cacheable HTTP 429", async () => {
    mocks.releaseEnabled = true;
    mocks.read.mockResolvedValueOnce({
      status: "rate-limited",
      retryAfterSeconds: 7,
    });

    const response = await GET(request(`locator=${EVM_ADDRESS}`));

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("x-programmable-identity-source")).toBeNull();
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    expect(response.headers.get("x-programmable-read-purpose")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Too many token lookups. Try again shortly.",
    });
  });
});
