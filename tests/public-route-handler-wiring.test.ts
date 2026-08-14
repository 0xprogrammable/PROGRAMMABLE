import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  AlchemyCreatorProfileIntegrityError: class extends Error {
    override name = "AlchemyCreatorProfileIntegrityError";
  },
  coordinatePublicRouteRead: vi.fn(),
  createPublicClient: vi.fn(),
  getWebsiteChartOnchainDeployment: vi.fn(),
  preparePublicRouteRequest: vi.fn(
    async (value: URLSearchParams, headers: Headers, _route: string) => {
      void _route;
      const search = new URLSearchParams(value);
      if (headers.get("x-programmable-shadow-probe") === "error") {
        return {
          searchParams: search,
          probeFailure: Response.json(
            { error: "release_probe_temporarily_unavailable" },
            {
              status: 503,
              headers: { "Cache-Control": "private, no-store" },
            },
          ),
        };
      }
      const authorized =
        headers.get("x-programmable-shadow-probe") === "1";
      if (authorized) {
        search.delete("__read_model_probe");
      }
      return {
        searchParams: search,
        ...(authorized ? { releaseProbe: Object.freeze({}) } : {}),
      };
    },
  ),
  readBitqueryCreatorProfile: vi.fn(),
  readAlchemyCreatorProfile: vi.fn(),
  readAlchemyExploreModel: vi.fn(),
  safeAlchemyError: vi.fn((error) => error),
}));

const rpcFixtures = vi.hoisted(() => {
  const runtimeCodes = {
    "0x01": "0xa459ee6574d8bbd40ddcf9737dc5d1063adb3abbc11d9f367350c7f2a3cf738b",
    "0x02": "0x60fd96af952730792036d43d806046675817a5a2de609d87c06203a8d6037650",
    "0x03": "0xd229555c79c61874549a1991c43df172104e1db3087ba8fca8804675b7440d36",
    "0x04": "0x274e29fb8d19f0607533ac7582827db0236ab546bb393d52049229b2ffe74381",
  } as const;
  const codesByAddress = {
    "0x51d702731db281ee223904a4663e05bfca26c775": "0x01",
    "0x48bb2672c7fd2a12e7fb5d46c441ccd3726520cc": "0x02",
    "0xd240d06f8586eb799f20056054e5b527405e6bad": "0x03",
    "0x025a386eaa79f6067d29848fd05ccc71beab20cc": "0x04",
  } as const;
  const client = {
    getBlockNumber: vi.fn(async () => 25_624_200n),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      hash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
      timestamp: 1_786_704_000n,
    })),
    getCode: vi.fn(async ({ address }: { address: string }) =>
      codesByAddress[address.toLowerCase() as keyof typeof codesByAddress] ?? "0x"
    ),
    getLogs: vi.fn(async (_input?: unknown) => {
      void _input;
      return [] as unknown[];
    }),
    readContract: vi.fn(),
  };
  return { client, runtimeCodes };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
    keccak256: vi.fn((value: keyof typeof rpcFixtures.runtimeCodes) =>
      rpcFixtures.runtimeCodes[value] ?? actual.keccak256(value)
    ),
  };
});

const fixtures = vi.hoisted(() => {
  const discoveryScope = [
    { model: "classic", releaseVersion: "classic-v2" },
    { model: "classic", releaseVersion: "classic-v3" },
    { model: "stock-paired", releaseVersion: "stock-paired-v1" },
    { model: "stock-paired", releaseVersion: "stock-paired-v2" },
    { model: "stock-paired", releaseVersion: "stock-paired-v3" },
  ] as const;
  return {
    discoveryScope,
    stockScope: discoveryScope.filter(
      (scope) => scope.model === "stock-paired",
    ),
  };
});

vi.mock("../lib/data-pipeline/public-route-readiness.server", () => ({
  coordinatePublicRouteRead: mocks.coordinatePublicRouteRead,
  PUBLIC_DISCOVERY_ROUTE_SCOPES: fixtures.discoveryScope,
  STOCK_PAIRED_ROUTE_SCOPES: fixtures.stockScope,
  preparePublicRouteRequest: mocks.preparePublicRouteRequest,
  publicSnapshotCheckpoint: (value: unknown) => value ?? undefined,
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
  safeAlchemyError: mocks.safeAlchemyError,
}));

vi.mock("../lib/onchain/config", () => ({
  getWebsiteChartOnchainDeployment:
    mocks.getWebsiteChartOnchainDeployment,
}));

vi.mock("../lib/alchemy/profile.server", () => ({
  AlchemyCreatorProfileIntegrityError:
    mocks.AlchemyCreatorProfileIntegrityError,
  readAlchemyCreatorProfile: mocks.readAlchemyCreatorProfile,
}));

vi.mock("../lib/market-data/bitquery-profile.server", () => ({
  readBitqueryCreatorProfile: mocks.readBitqueryCreatorProfile,
  safeBitqueryProfileError: vi.fn((error) => error),
}));

import { GET as creatorProfile } from "../app/api/explore/profile/route";
import { GET as stockLaunchLookup } from "../app/api/explore/launch/stock-paired/route";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const TRANSACTION = `0x${"22".repeat(32)}`;

describe("public route coordinator wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcFixtures.client.getBlockNumber.mockResolvedValue(25_624_200n);
    rpcFixtures.client.getBlock.mockImplementation(
      async ({ blockNumber }: { blockNumber: bigint }) => ({
        hash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
        timestamp: 1_786_704_000n,
      }),
    );
    rpcFixtures.client.getLogs.mockResolvedValue([]);
    mocks.createPublicClient.mockReturnValue(rpcFixtures.client);
    const drpc = "https://lb.drpc.live/ethereum/drpc-profile-key";
    vi.stubEnv("PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER", "drpc");
    vi.stubEnv("PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL", drpc);
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT",
      rpcProviderCommitment("endpoint", drpc),
    );
  });

  it("derives current, generated and claimed totals from sparse dRPC state", async () => {
    const launcher = "0xD240D06f8586eB799f20056054e5b527405E6bAd";
    const hook = "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC";
    const token = "0x3333333333333333333333333333333333333333";
    const poolId = `0x${"44".repeat(32)}`;
    const transactionHash = `0x${"55".repeat(32)}`;
    rpcFixtures.client.getLogs.mockImplementation(async (inputValue?: unknown) => {
      const input = inputValue as {
        address: string;
        event: { name: string };
      };
      if (
        input.address.toLowerCase() === launcher.toLowerCase() &&
        input.event.name === "MemeTokenLaunched"
      ) {
        return [{
          removed: false,
          blockNumber: 25_624_150n,
          transactionHash,
          transactionIndex: 2,
          logIndex: 3,
          args: {
            creator: ACCOUNT,
            token,
            poolId,
            feeHook: hook,
            positionRecipient: ACCOUNT,
            positionTokenId: 7n,
            totalSwapFeeBps: 100,
            launchHash: `0x${"66".repeat(32)}`,
          },
        }];
      }
      if (
        input.address.toLowerCase() === hook.toLowerCase() &&
        input.event.name === "CreatorFeesClaimed"
      ) {
        return [{
          removed: false,
          blockNumber: 25_624_160n,
          transactionHash: `0x${"77".repeat(32)}`,
          transactionIndex: 1,
          logIndex: 4,
          args: {
            poolId,
            creator: ACCOUNT,
            recipient: ACCOUNT,
            caller: ACCOUNT,
            amount: 40n,
          },
        }];
      }
      return [];
    });
    rpcFixtures.client.readContract.mockImplementation(async (input: {
      functionName: string;
    }) => {
      if (input.functionName === "name") return "dRPC Token";
      if (input.functionName === "symbol") return "DRPC";
      if (input.functionName === "poolFeeConfig") {
        return [ACCOUNT, launcher, 100, true, 60n];
      }
      throw new Error(`Unexpected read ${input.functionName}`);
    });

    const response = await creatorProfile(new NextRequest(
      `http://localhost/api/explore/profile?account=${ACCOUNT}`,
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      account: ACCOUNT,
      tokens: [{ tokenAddress: token, creatorFeesAccruedWei: "60" }],
      pools: [{
        tokenAddress: token,
        claimableCreatorFeesWei: "60",
        generatedCreatorFeesWei: "100",
      }],
      claims: [{ amountWei: "40", tokenAddress: token }],
      totals: {
        claimableWei: "60",
        generatedWei: "100",
        claimedWei: "40",
      },
    });
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("reports the single committed dRPC creator profile source", async () => {
    const response = await creatorProfile(
      new NextRequest(
        `http://localhost/api/explore/profile?account=${ACCOUNT}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
    expect(mocks.readBitqueryCreatorProfile).not.toHaveBeenCalled();
    expect(mocks.readAlchemyCreatorProfile).not.toHaveBeenCalled();
    expect(mocks.coordinatePublicRouteRead).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=0, s-maxage=15",
    );
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "drpc",
    );
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "drpc",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBe(
      "drpc-primary",
    );
  });

  it("fails closed with 503 when the sole dRPC read fails", async () => {
    rpcFixtures.client.getBlockNumber.mockRejectedValueOnce(
      new Error("dRPC unavailable"),
    );

    const response = await creatorProfile(
      new NextRequest(
        `http://localhost/api/explore/profile?account=${ACCOUNT}`,
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      error: {
        kind: "temporary",
        code: "creator_profile_temporarily_unavailable",
        message: "Onchain creator data is temporarily unavailable",
      },
    });
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
    expect(mocks.readBitqueryCreatorProfile).not.toHaveBeenCalled();
  });

  it("fails closed before transport on a primary commitment mismatch", async () => {
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT",
      `0x${"00".repeat(32)}`,
    );

    const response = await creatorProfile(
      new NextRequest(
        `http://localhost/api/explore/profile?account=${ACCOUNT}`,
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      error: {
        kind: "temporary",
        code: "creator_profile_temporarily_unavailable",
        message: "Onchain creator data is temporarily unavailable",
      },
    });
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });

  it("wires Stock-Paired confirmation through the shared launch lookup gate", async () => {
    mocks.coordinatePublicRouteRead.mockResolvedValue(
      Response.json({ status: "coordinated" }),
    );

    const response = await stockLaunchLookup(
      new NextRequest(
        `http://localhost/api/explore/launch/stock-paired?account=${ACCOUNT}&transaction=${TRANSACTION}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "coordinated" });
    expect(mocks.coordinatePublicRouteRead).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "launch-lookup",
        scope: fixtures.stockScope,
      }),
    );
  });

  it("strips an authorized probe nonce before validating Stock-Paired lookup input", async () => {
    mocks.coordinatePublicRouteRead.mockResolvedValue(
      Response.json({ status: "coordinated" }),
    );

    const response = await stockLaunchLookup(
      new NextRequest(
        `http://localhost/api/explore/launch/stock-paired?account=${ACCOUNT}&transaction=${TRANSACTION}&__read_model_probe=release-1`,
        { headers: { "x-programmable-shadow-probe": "1" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.preparePublicRouteRequest).toHaveBeenCalledTimes(1);
    expect(mocks.coordinatePublicRouteRead).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "launch-lookup",
        releaseProbe: expect.any(Object),
      }),
    );
  });

  it("rejects invalid Stock-Paired lookup input before coordination", async () => {
    const response = await stockLaunchLookup(
      new NextRequest(
        "http://localhost/api/explore/launch/stock-paired?account=bad&transaction=bad",
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.coordinatePublicRouteRead).not.toHaveBeenCalled();
  });

  it("returns the private probe failure before route validation or coordination", async () => {
    const response = await stockLaunchLookup(
      new NextRequest(
        `http://localhost/api/explore/launch/stock-paired?__read_model_probe=release-1`,
        { headers: { "x-programmable-shadow-probe": "error" } },
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.coordinatePublicRouteRead).not.toHaveBeenCalled();
  });
});
