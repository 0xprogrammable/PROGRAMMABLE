import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const account = "0x1111111111111111111111111111111111111111";
  const launcher = "0x2222222222222222222222222222222222222222";
  const hook = "0x3333333333333333333333333333333333333333";
  const token = "0x4444444444444444444444444444444444444444";
  const vault = "0x5555555555555555555555555555555555555555";
  const recipient = "0x6666666666666666666666666666666666666666";
  const transaction = `0x${"12".repeat(32)}`;
  const blockHash = `0x${"34".repeat(32)}`;
  const poolId = `0x${"56".repeat(32)}`;
  const launchHash = `0x${"78".repeat(32)}`;
  const configurationHash = `0x${"9a".repeat(32)}`;
  const clients: unknown[] = [];
  return {
    account,
    launcher,
    hook,
    token,
    vault,
    recipient,
    transaction,
    blockHash,
    poolId,
    launchHash,
    configurationHash,
    clients,
    parseReceipts: vi.fn(),
    readProfile: vi.fn(),
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => mocks.clients.shift()),
  };
});

vi.mock("@/lib/deep-v3-release", () => ({
  configuredMainnetDeepV3Manifest: { schemaVersion: 3 },
}));

vi.mock("@/lib/deep-v3-runtime-binding", () => ({
  requireIndependentDeepV3RpcUrls: () =>
    ["https://rpc-a.example", "https://rpc-b.example"] as const,
}));

vi.mock("@/lib/onchain/deep-v3-read-model", () => ({
  resolveVerifiedDeepV3ReadRelease: () => ({
    startBlock: 100,
    addresses: {
      launcher: mocks.launcher,
      feeHook: mocks.hook,
    },
  }),
}));

vi.mock("@/lib/deep-v3-launch-confirmation", () => ({
  parseDeepV3LaunchReceipts: mocks.parseReceipts,
}));

vi.mock("@/lib/profile/deep-v3-profile.server", () => ({
  readDeepV3ProfileToken: mocks.readProfile,
}));

import { GET } from "../app/api/explore/launch/deep-v3/route";

function request(query = "") {
  return new NextRequest(
    `https://programmable.family/api/explore/launch/deep-v3${query}`,
  );
}

function receipt() {
  return {
    status: "success" as const,
    from: mocks.account,
    to: mocks.launcher,
    blockNumber: 120n,
    blockHash: mocks.blockHash,
    transactionHash: mocks.transaction,
    transactionIndex: 1,
    logs: [],
  };
}

describe("Deep V3 launch confirmation route", () => {
  it("rejects an ambiguous query before RPC access", async () => {
    const response = await GET(
      request(
        `?account=${mocks.account}&account=${mocks.account}&transaction=${mocks.transaction}`,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported query parameters",
    });
    expect(mocks.clients).toHaveLength(0);
  });

  it("waits for twelve confirmations from both RPCs", async () => {
    mocks.clients.push(
      {
        getTransactionReceipt: vi.fn().mockResolvedValue(receipt()),
        getBlockNumber: vi.fn().mockResolvedValue(131n),
      },
      {
        getTransactionReceipt: vi.fn().mockResolvedValue(receipt()),
        getBlockNumber: vi.fn().mockResolvedValue(140n),
      },
    );

    const response = await GET(
      request(
        `?account=${mocks.account}&transaction=${mocks.transaction}`,
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "pending",
      launch: null,
    });
    expect(mocks.parseReceipts).not.toHaveBeenCalled();
  });

  it("returns a token only after receipt agreement and full profile validation", async () => {
    const provenance = {
      deepReleaseVersion: "deep-full-range-v3",
      launchModel: "deep",
      launcher: mocks.launcher,
      creator: mocks.account,
      tokenAddress: mocks.token,
      vaultAddress: mocks.vault,
      hookAddress: mocks.hook,
      positionRecipient: mocks.recipient,
      positionTokenId: "7",
      poolId: mocks.poolId,
      launchHash: mocks.launchHash,
      vaultConfigurationHash: mocks.configurationHash,
      blockNumber: "120",
      blockHash: mocks.blockHash,
      transactionHash: mocks.transaction,
      transactionIndex: 1,
      logIndex: 2,
    };
    mocks.parseReceipts.mockReturnValueOnce(provenance);
    mocks.readProfile.mockResolvedValueOnce({
      snapshot: {
        blockNumber: "140",
        blockHash: `0x${"ab".repeat(32)}`,
      },
      token: {
        tokenAddress: mocks.token,
        tokenName: "Deep Test",
        tokenSymbol: "DEEP",
        deepReleaseVersion: "deep-full-range-v3",
      },
    });
    mocks.clients.push(
      {
        getTransactionReceipt: vi.fn().mockResolvedValue(receipt()),
        getBlockNumber: vi.fn().mockResolvedValue(140n),
      },
      {
        getTransactionReceipt: vi.fn().mockResolvedValue(receipt()),
        getBlockNumber: vi.fn().mockResolvedValue(141n),
      },
    );

    const response = await GET(
      request(
        `?account=${mocks.account}&transaction=${mocks.transaction}`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      launch: {
        tokenAddress: mocks.token,
        name: "Deep Test",
        symbol: "DEEP",
        deepReleaseVersion: "deep-full-range-v3",
        deepV3Provenance: provenance,
      },
      snapshot: {
        blockNumber: "140",
        blockHash: `0x${"ab".repeat(32)}`,
      },
    });
    expect(mocks.parseReceipts).toHaveBeenCalledOnce();
    expect(mocks.readProfile).toHaveBeenCalledOnce();
  });
});
