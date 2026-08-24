import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  capabilityModuleLoaded: vi.fn(),
  releaseEnabled: false,
  releaseBranded: true,
  releaseError: false,
  assertRelease: vi.fn(),
  providerRouteReady: true,
  readinessBranded: true,
  getReadiness: vi.fn(),
  assertReadiness: vi.fn(),
  verify: vi.fn(),
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
  "../lib/market-data/prediction-asset-logo-capability-v2.server",
  () => {
    mocks.capabilityModuleLoaded();
    return {
      verifyConfiguredPredictionAssetLogoCapabilityV2: mocks.verify,
    };
  },
);

import { GET } from "../app/api/prediction/asset-logo/[asset]/route";

const ASSET = "ab".repeat(32);
const CAPABILITY = `v2.2026-08-a.1800000600.${"a".repeat(43)}`;

function request(query = "") {
  return new Request(
    `https://programmable.market/api/prediction/asset-logo/${ASSET}${query}`,
  );
}

function context(asset = ASSET) {
  return { params: Promise.resolve({ asset }) };
}

describe("Prediction V2 asset logo route capability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.releaseEnabled = false;
    mocks.releaseBranded = true;
    mocks.releaseError = false;
    mocks.providerRouteReady = true;
    mocks.readinessBranded = true;
    mocks.verify.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps the disabled release dark before loading capability secrets", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(request(`?capability=${CAPABILITY}`), context());

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.capabilityModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.getReadiness).not.toHaveBeenCalled();
  });

  it("keeps a malformed public release dark before reading Request or params", async () => {
    mocks.releaseError = true;
    const opaqueRequest = new Proxy({} as Request, {
      get() {
        throw new Error("malformed release must keep Request opaque");
      },
    });
    const opaqueContext = new Proxy(
      {} as { params: Promise<{ asset: string }> },
      {
        get() {
          throw new Error("malformed release must keep params opaque");
        },
      },
    );
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(opaqueRequest, opaqueContext);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.capabilityModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.getReadiness).not.toHaveBeenCalled();
  });

  it("keeps an unbranded enabled release dark before reading route state", async () => {
    mocks.releaseEnabled = true;
    mocks.releaseBranded = false;
    const opaqueRequest = new Proxy({} as Request, {
      get() {
        throw new Error("unbranded release must keep Request opaque");
      },
    });
    const opaqueContext = new Proxy(
      {} as { params: Promise<{ asset: string }> },
      {
        get() {
          throw new Error("unbranded release must keep params opaque");
        },
      },
    );
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(opaqueRequest, opaqueContext);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.assertRelease).toHaveBeenCalledTimes(1);
    expect(mocks.capabilityModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps provider work dark without branded shared route controls", async () => {
    mocks.releaseEnabled = true;
    mocks.providerRouteReady = false;
    const opaqueRequest = new Proxy({} as Request, {
      get() {
        throw new Error("unready provider controls must keep Request opaque");
      },
    });
    const opaqueContext = new Proxy(
      {} as { params: Promise<{ asset: string }> },
      {
        get() {
          throw new Error("unready provider controls must keep params opaque");
        },
      },
    );
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(opaqueRequest, opaqueContext);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.assertRelease).toHaveBeenCalledTimes(1);
    expect(mocks.getReadiness).toHaveBeenCalledTimes(1);
    expect(mocks.assertReadiness).toHaveBeenCalledTimes(1);
    expect(mocks.capabilityModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "?capability=",
    `?capability=${CAPABILITY}&other=1`,
    `?capability=${CAPABILITY}&capability=${CAPABILITY}`,
    `?capability=${"a".repeat(91)}`,
  ])("rejects a missing or unbounded capability before secret or provider work: %s", async (
    query,
  ) => {
    mocks.releaseEnabled = true;
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(request(query), context());

    expect(response.status).toBe(404);
    expect(mocks.capabilityModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-canonical asset before reading the configured key", async () => {
    mocks.releaseEnabled = true;

    const response = await GET(
      request(`?capability=${CAPABILITY}`),
      context(ASSET.toUpperCase()),
    );

    expect(response.status).toBe(400);
    expect(mocks.capabilityModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("fails an invalid asset-bound capability before any upstream fetch", async () => {
    mocks.releaseEnabled = true;
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(request(`?capability=${CAPABILITY}`), context());

    expect(response.status).toBe(404);
    expect(mocks.assertRelease).toHaveBeenCalledTimes(1);
    expect(mocks.assertReadiness).toHaveBeenCalledTimes(1);
    expect(mocks.capabilityModuleLoaded).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledWith(ASSET, CAPABILITY);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed if capability verification cannot complete", async () => {
    mocks.releaseEnabled = true;
    mocks.verify.mockImplementationOnce(() => {
      throw new Error("capability configuration unavailable");
    });
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(request(`?capability=${CAPABILITY}`), context());

    expect(response.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    `https://programmable.market/api/prediction/asset-logo/${ASSET}` +
      `?cap%61bility=${CAPABILITY}`,
    `https://programmable.market/api/prediction/asset-logo/${ASSET}` +
      `?capability=${CAPABILITY.replaceAll(".", "%2E")}`,
    `https://programmable.market/api/prediction/asset-logo/%61${ASSET.slice(1)}` +
      `?capability=${CAPABILITY}`,
  ])("rejects a decoded alias of the canonical capability URL: %s", async (url) => {
    mocks.releaseEnabled = true;
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(new Request(url), context());

    expect(response.status).toBe(404);
    expect(mocks.capabilityModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never caches successful bytes beyond the explicit capability expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000 * 1_000);
    mocks.releaseEnabled = true;
    mocks.verify.mockReturnValue(true);
    const source = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 120, g: 80, b: 210 },
      },
    }).png().toBuffer();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(source, {
      status: 200,
      headers: {
        "content-length": String(source.byteLength),
        "content-type": "image/png",
      },
    }));
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(request(`?capability=${CAPABILITY}`), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control"))
      .toBe("public, max-age=600, s-maxage=600");
    expect(response.headers.get("cache-control")).not.toContain("immutable");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.verify).toHaveBeenCalledWith(ASSET, CAPABILITY);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
