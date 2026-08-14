import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const runtimeCodes = {
    "0x01":
      "0x9cc9723456c471d90ac838c02fa4fc47ed4b7e82c85358e71deec978c48d2dc8",
    "0x02":
      "0x3eba781023d3146ed9b502ac5b402d39cea4c34a14f64c878cb9ea62149590f1",
    "0x03":
      "0x874ec76f396807bfcbbdd88cc2fd534f10201242ad0479a05fe5d2ee937616ee",
  } as const;
  const contractCodes = {
    "0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770": "0x01",
    "0x35fe236ea82f7cf525c9719d7df8f49f94d720cc": "0x02",
    "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a": "0x03",
  } as const;
  const client = {
    getCode: vi.fn(
      async ({ address }: { address: string }) =>
        contractCodes[
          address.toLowerCase() as keyof typeof contractCodes
        ] ?? "0x",
    ),
    getBlockNumber: vi.fn(async () => 25_639_608n),
    getLogs: vi.fn(async () => []),
  };
  return {
    client,
    createPublicClient: vi.fn(() => client),
    readBitqueryClassicV3Launch: vi.fn(),
    readBitqueryClassicV3Profile: vi.fn(),
    runtimeCodes,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("../lib/data-pipeline/action-lookup", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/data-pipeline/action-lookup")>();
  return {
    ...actual,
    lookupActionReward: vi.fn(async () => {
      throw new actual.ActionLookupError("not-found");
    }),
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
    keccak256: vi.fn((value: keyof typeof mocks.runtimeCodes) => {
      const mocked = mocks.runtimeCodes[value];
      return mocked ?? actual.keccak256(value);
    }),
  };
});

vi.mock("../lib/market-data/bitquery-profile.server", () => ({
  readBitqueryClassicV3Launch: mocks.readBitqueryClassicV3Launch,
  readBitqueryClassicV3Profile: mocks.readBitqueryClassicV3Profile,
  safeBitqueryProfileError: vi.fn((error) => error),
}));

import {
  GET,
  POST,
} from "../app/api/profile/classic-v3/route";

const account = "0x1111111111111111111111111111111111111111";
const vault = "0x2222222222222222222222222222222222222222";
const drpcRpcUrl =
  "https://lb.drpc.live/ethereum/drpc-classic-key";
const quickNodeRpcUrl =
  "https://classic-mainnet.ethereum-mainnet.quiknode.pro/quicknode-classic-key/";

describe("Classic profile release gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPublicClient.mockReturnValue(mocks.client);
    mocks.readBitqueryClassicV3Profile.mockResolvedValue({
      status: "ready",
      account,
      chainId: 1,
      rewards: [],
    });
    vi.stubEnv("ETHEREUM_RPC_URL", drpcRpcUrl);
    vi.stubEnv("ETHEREUM_RPC_URL_B", quickNodeRpcUrl);
    vi.stubEnv("PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER", "drpc");
    vi.stubEnv("PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL", drpcRpcUrl);
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT",
      rpcProviderCommitment("endpoint", drpcRpcUrl),
    );
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_PROVIDER",
      "quicknode",
    );
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL",
      quickNodeRpcUrl,
    );
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT",
      rpcProviderCommitment("endpoint", quickNodeRpcUrl),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the verified release with no rewards for an unused wallet", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      account,
      chainId: 1,
      rewards: [],
    });
  });

  it("does not instantiate an RPC client for the public GET", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.readBitqueryClassicV3Profile).toHaveBeenCalledWith(account);
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "bitquery",
    );
  });

  it("returns a temporary error when the Bitquery read fails", async () => {
    mocks.readBitqueryClassicV3Profile.mockRejectedValue(
      new Error("Bitquery unavailable"),
    );

    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}`,
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      error: {
        kind: "temporary",
        code: "classic_profile_temporarily_unavailable",
        message: "Classic rewards are temporarily unavailable",
      },
    });
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });

  it("rejects invalid launch lookup hashes before reading Bitquery", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}&launch=bad`,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Enter a valid launch transaction hash",
    });
    expect(mocks.readBitqueryClassicV3Launch).not.toHaveBeenCalled();
  });

  it("rejects claims from a wallet that does not own the vault", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/profile/classic-v3", {
        method: "POST",
        body: JSON.stringify({
          action: "claim",
          account,
          vaultAddress: vault,
          chainId: 1,
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only a current or historic payout wallet can continue",
    });
  });
});
