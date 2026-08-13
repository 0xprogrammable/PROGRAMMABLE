import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  getBlock: vi.fn(),
  readOperationalRpcHealth: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
  };
});

vi.mock("../lib/onchain/rpc-health", () => ({
  readOperationalRpcHealth: mocks.readOperationalRpcHealth,
}));

import { readVerifiedOperationalMarketSnapshot } from
  "../lib/alchemy/live-market.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";

const BLOCK_HASH = `0x${"55".repeat(32)}` as const;
const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 1n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: "https://primary.example/rpc",
  rpcUrlSecondary: "https://secondary.example/rpc",
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

describe("operational market snapshot replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T08:00:00.000Z"));
    mocks.createPublicClient.mockReturnValue({ getBlock: mocks.getBlock });
    mocks.readOperationalRpcHealth.mockResolvedValue({
      status: "healthy",
      read: { status: "available" },
      quorum: { status: "verified" },
      confirmedBlock: { number: "25630000", hash: BLOCK_HASH },
    });
    mocks.getBlock.mockResolvedValue({
      number: 25_630_000n,
      hash: BLOCK_HASH,
      timestamp: BigInt(Math.floor(Date.now() / 1_000) - 60),
    });
  });

  it("exact-verifies the selected first-page block through both providers", async () => {
    await expect(
      readVerifiedOperationalMarketSnapshot(deployment),
    ).resolves.toMatchObject({
      blockNumber: "25630000",
      blockHash: BLOCK_HASH,
      blockTimestamp: String(Math.floor(Date.now() / 1_000) - 60),
    });
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(2);
    expect(mocks.getBlock).toHaveBeenCalledTimes(2);
    expect(mocks.getBlock).toHaveBeenCalledWith({ blockNumber: 25_630_000n });
  });

  it("normalizes an uppercase health hash before exact verification", async () => {
    const canonicalHash = `0x${"ab".repeat(32)}` as const;
    mocks.readOperationalRpcHealth.mockResolvedValue({
      status: "healthy",
      read: { status: "available" },
      quorum: { status: "verified" },
      confirmedBlock: {
        number: "25630000",
        hash: `0x${"AB".repeat(32)}`,
      },
    });
    mocks.getBlock.mockResolvedValue({
      number: 25_630_000n,
      hash: canonicalHash,
      timestamp: BigInt(Math.floor(Date.now() / 1_000) - 60),
    });

    await expect(
      readVerifiedOperationalMarketSnapshot(deployment),
    ).resolves.toMatchObject({ blockHash: canonicalHash });
  });

  it("rejects an oversized replay block before exact provider reads", async () => {
    await expect(readVerifiedOperationalMarketSnapshot(deployment, {
      blockNumber: "1".repeat(79),
      blockHash: BLOCK_HASH,
    })).resolves.toBeNull();
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
    expect(mocks.getBlock).not.toHaveBeenCalled();
  });

  it.each([
    ["stale", -301, -301],
    ["future", 61, 61],
    ["timestamp disagreement", -60, -61],
  ] as const)("rejects a %s first-page block", async (_label, first, second) => {
    const now = Math.floor(Date.now() / 1_000);
    mocks.getBlock
      .mockResolvedValueOnce({
        number: 25_630_000n,
        hash: BLOCK_HASH,
        timestamp: BigInt(now + first),
      })
      .mockResolvedValueOnce({
        number: 25_630_000n,
        hash: BLOCK_HASH,
        timestamp: BigInt(now + second),
      });

    await expect(
      readVerifiedOperationalMarketSnapshot(deployment),
    ).resolves.toBeNull();
  });
});
