import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequestError } from "viem";

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

import {
  GET,
  POST,
} from "../app/api/profile/classic-v3/route";

const account = "0x1111111111111111111111111111111111111111";
const vault = "0x2222222222222222222222222222222222222222";
const alchemyRpcUrl =
  "https://eth-mainnet.g.alchemy.com/v2/alchemy-classic-key";
const quickNodeRpcUrl =
  "https://classic-mainnet.quiknode.pro/quicknode-classic-key/";

describe("Classic profile release gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPublicClient.mockReturnValue(mocks.client);
    vi.stubEnv("ETHEREUM_RPC_URL", alchemyRpcUrl);
    vi.stubEnv("ETHEREUM_RPC_URL_B", quickNodeRpcUrl);
    vi.stubEnv("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL", alchemyRpcUrl);
    vi.stubEnv("PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL", quickNodeRpcUrl);
    vi.stubEnv(
      "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT",
      rpcProviderCommitment("endpoint", alchemyRpcUrl),
    );
    vi.stubEnv(
      "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT",
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

  it("uses the fixed secondary when the primary rejects capacity", async () => {
    const primary = {
      ...mocks.client,
      getCode: vi.fn(async () => {
        throw new HttpRequestError({
          status: 429,
          url: "https://primary.example/rpc-key",
        });
      }),
    };
    mocks.createPublicClient
      .mockReturnValueOnce(primary)
      .mockReturnValueOnce(mocks.client);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(2);
  });

  it("does not use secondary for an integrity error", async () => {
    const primary = {
      ...mocks.client,
      getCode: vi.fn(async () => {
        throw new Error("Classic runtime integrity mismatch");
      }),
    };
    mocks.createPublicClient.mockReturnValueOnce(primary);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}`,
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      error: {
        kind: "integrity",
        code: "classic_profile_integrity_conflict",
        message: "Classic reward data could not be verified",
      },
    });
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
  });

  it("keeps exhausted provider capacity typed as temporary", async () => {
    const primary = {
      ...mocks.client,
      getCode: vi.fn(async () => {
        throw new HttpRequestError({
          status: 429,
          url: "https://primary.example/rpc-key",
        });
      }),
    };
    const secondary = {
      ...mocks.client,
      getCode: vi.fn(async () => {
        throw new HttpRequestError({
          status: 503,
          url: "https://secondary.example/rpc-key",
        });
      }),
    };
    mocks.createPublicClient
      .mockReturnValueOnce(primary)
      .mockReturnValueOnce(secondary);

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
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(2);
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
