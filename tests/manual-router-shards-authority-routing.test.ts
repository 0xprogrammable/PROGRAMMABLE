import { beforeEach, describe, expect, it, vi } from "vitest";

const routing = vi.hoisted(() => ({
  bearerConstructions: 0,
  quickNodeConstructions: 0,
  factoryRoutes: [] as string[],
  clockRoutes: [] as string[],
  publishRoutes: [] as string[],
  reissueRoutes: [] as string[],
  transactionRoutes: [] as string[],
  finalityRoutes: [] as string[],
}));

vi.mock("server-only", () => ({}));

vi.mock("../lib/server/custom-launch/manual-router-config-v1", async (load) => {
  const actual = await load<typeof import(
    "../lib/server/custom-launch/manual-router-config-v1"
  )>();
  return { ...actual, assertManualRouterProductionConfigurationV1: () => {} };
});

vi.mock(
  "../lib/server/custom-launch/manual-router-shards-v1-compat-v1",
  async (load) => {
    const actual = await load<typeof import(
      "../lib/server/custom-launch/manual-router-shards-v1-compat-v1"
    )>();
    return {
      ...actual,
      manualRouterIsExactShardsV1ArtifactV1: (value: { routeTest?: string }) =>
        value?.routeTest === "exact-shards-v1",
      manualRouterIsExactShardsV1PointerV1: (value: { routeTest?: string }) =>
        value?.routeTest === "exact-shards-v1",
    };
  },
);

vi.mock(
  "../lib/server/custom-launch/manual-router-shards-publish-transport-v1",
  async (load) => {
    const actual = await load<typeof import(
      "../lib/server/custom-launch/manual-router-shards-publish-transport-v1"
    )>();
    return {
      ...actual,
      createShardsManualRouterAlchemyBearerFetchV1(input: { fetch: typeof fetch }) {
        routing.bearerConstructions += 1;
        return input.fetch;
      },
      createShardsManualRouterPublishFetchV1(input: { fetch: typeof fetch }) {
        routing.quickNodeConstructions += 1;
        return input.fetch;
      },
      isExactShardsManualRouterPublishRequestV1(request: {
        signedArtifact?: { routeTest?: string };
      }) {
        return request.signedArtifact?.routeTest === "exact-shards-v1";
      },
    };
  },
);

vi.mock(
  "../lib/vendor/manual-router-authority-v1/manual-router-portable.v1.mjs",
  async (load) => {
    const actual = await load<Record<string, unknown>>();
    class RoutedFinalityVerifier {
      readonly rpc: { routeTest: string };
      constructor(input: { rpc: { routeTest: string } }) {
        this.rpc = input.rpc;
      }
      async finalize() {
        routing.finalityRoutes.push(this.rpc.routeTest);
        return { proofHash: `sha256:${"11".repeat(32)}` };
      }
    }
    return {
      ...actual,
      assertPortableManualRouterSignedPublishRequestV1: (raw: unknown) => raw,
      createPortableManualRouterPublishAuthorityFromEnvV1(input: {
        env: Record<string, string | undefined>;
      }) {
        const routeTest = input.env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL
          === "https://eth-mainnet.g.alchemy.com/v2"
          ? "exact-shards-v1"
          : "generic";
        routing.factoryRoutes.push(routeTest);
        return Object.freeze({
          github: Object.freeze({}),
          rpc: Object.freeze({
            routeTest,
            async observeChainClock() {
              routing.clockRoutes.push(routeTest);
              return { minimumTimestamp: "100", maximumTimestamp: "101" };
            },
            async collectCommonFinalizedAnchor() {
              return {
                blockNumber: "0x64",
                blockHash: `0x${"22".repeat(32)}`,
                timestamp: "99",
              };
            },
            async readConsensus(method: string) {
              if (method === "eth_getTransactionByHash") {
                routing.transactionRoutes.push(routeTest);
              }
              return null;
            },
          }),
        });
      },
      async verifyPortableManualRouterSignedPublishV1(input: {
        composition: { rpc: { routeTest: string } };
        request: unknown;
      }) {
        routing.publishRoutes.push(input.composition.rpc.routeTest);
        return {
          request: input.request,
          nextPointer: {},
          nextApplicantIndex: {},
          idempotent: false,
        };
      },
      async resolvePortableManualRouterReissueStateV1(input: {
        composition: { rpc: { routeTest: string } };
      }) {
        routing.reissueRoutes.push(input.composition.rpc.routeTest);
        return {
          schemaVersion:
            "programmable.manual-router-operator-reissue-state-response.v1",
          disposition: "stale",
          code: "stale_previous_artifact",
        };
      },
      RouterLaunchFinalityVerifierV1: RoutedFinalityVerifier,
    };
  },
);

import {
  createProductionManualRouterAuthorityV1,
} from "../lib/server/custom-launch/manual-router-authority-v1";

const exact = Object.freeze({ routeTest: "exact-shards-v1" });
const nearMiss = Object.freeze({ routeTest: "near-miss-shards-v1" });
const genericV2 = Object.freeze({ routeTest: "generic-v2" });

describe("exact Shards authority composition routing", () => {
  beforeEach(() => {
    for (const key of [
      "factoryRoutes", "clockRoutes", "publishRoutes", "reissueRoutes",
      "transactionRoutes", "finalityRoutes",
    ] as const) routing[key].length = 0;
    routing.bearerConstructions = 0;
    routing.quickNodeConstructions = 0;
  });

  it("routes all six exact V1 authority paths through the Bearer composition", async () => {
    const candidate = createProductionManualRouterAuthorityV1();

    // list and resolve both select the already lineage-validated exact pointer.
    await candidate.website.readChainClock({ pointer: exact as never });
    await candidate.website.readChainClock({ pointer: exact as never });
    await candidate.website.resolveReissueState({
      artifact: exact as never,
      request: {},
      currentApplicantIndex: null,
      currentApplicantPointers: [],
      currentStatus: "reissue-required",
    });
    await candidate.website.verifySignedPublish({
      request: { signedArtifact: exact },
      currentApplicantIndex: null,
      currentApplicantPointers: [],
    });
    await expect(candidate.website.observeExactTransaction({
      artifact: exact as never,
      prepared: {} as never,
      transactionHash: `0x${"33".repeat(32)}`,
    })).rejects.toThrow("transaction_not_observed");
    await candidate.finalityAuthority.finalize({
      artifact: exact as never,
      prepared: { preparationHash: `sha256:${"44".repeat(32)}` } as never,
      transactionHash: `0x${"55".repeat(32)}`,
      deadline: "200",
    });

    expect(routing.factoryRoutes).toEqual(["generic", "exact-shards-v1"]);
    expect(routing.bearerConstructions).toBe(1);
    expect(routing.quickNodeConstructions).toBe(1);
    expect(routing.clockRoutes).toEqual([
      "exact-shards-v1", "exact-shards-v1",
    ]);
    expect(routing.reissueRoutes).toEqual(["exact-shards-v1"]);
    expect(routing.publishRoutes).toEqual(["exact-shards-v1"]);
    expect(routing.transactionRoutes).toEqual(["exact-shards-v1"]);
    expect(routing.finalityRoutes).toEqual(["exact-shards-v1"]);
  });

  it("never constructs Bearer authority for near-miss Shards or generic V2", async () => {
    const candidate = createProductionManualRouterAuthorityV1();
    await candidate.website.readChainClock({ pointer: nearMiss as never });
    await candidate.website.readChainClock({ pointer: genericV2 as never });
    await candidate.website.resolveReissueState({
      artifact: nearMiss as never,
      request: {},
      currentApplicantIndex: null,
      currentApplicantPointers: [],
      currentStatus: "reissue-required",
    });
    await candidate.website.verifySignedPublish({
      request: { signedArtifact: genericV2 },
      currentApplicantIndex: null,
      currentApplicantPointers: [],
    });

    expect(routing.factoryRoutes).toEqual(["generic"]);
    expect(routing.bearerConstructions).toBe(0);
    expect(routing.quickNodeConstructions).toBe(0);
    expect(routing.clockRoutes).toEqual(["generic", "generic"]);
    expect(routing.reissueRoutes).toEqual(["generic"]);
    expect(routing.publishRoutes).toEqual(["generic"]);
  });
});
