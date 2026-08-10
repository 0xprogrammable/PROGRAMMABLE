import { describe, expect, it, vi } from "vitest";
import { HttpRequestError } from "viem";

vi.mock("server-only", () => ({}));

import {
  readOperationalRpcHealth,
  type OperationalRpcHealthDependencies,
} from "../lib/onchain/rpc-health";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";

const PRIMARY_URL = "https://primary.example/rpc-key";
const SECONDARY_URL = "https://secondary.example/rpc-key";
const BLOCK_HASH = `0x${"11".repeat(32)}` as const;

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
  rpcUrl: PRIMARY_URL,
  rpcUrlSecondary: SECONDARY_URL,
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

function httpFailure(status: number, url: string) {
  return new HttpRequestError({
    status,
    url,
    body: { method: "eth_blockNumber" },
  });
}

function client(input?: Readonly<{
  chainId?: number;
  head?: bigint;
  blockHash?: `0x${string}`;
  chainError?: unknown;
  blockError?: unknown;
}>) {
  return {
    getChainId: vi.fn(async () => {
      if (input?.chainError) throw input.chainError;
      return input?.chainId ?? 1;
    }),
    getBlockNumber: vi.fn(async () => input?.head ?? 100n),
    getBlock: vi.fn(async () => {
      if (input?.blockError) throw input.blockError;
      return { hash: input?.blockHash ?? BLOCK_HASH };
    }),
  };
}

function dependencies(
  primary: ReturnType<typeof client>,
  secondary: ReturnType<typeof client>,
) {
  const createClient = vi.fn((rpcUrl: string) => {
    if (rpcUrl === PRIMARY_URL) return primary;
    if (rpcUrl === SECONDARY_URL) return secondary;
    throw new Error("Unexpected RPC role");
  });
  return {
    createClient,
  } satisfies OperationalRpcHealthDependencies;
}

describe("operational RPC health", () => {
  it("reports healthy only when both fixed providers agree", async () => {
    const primary = client({ head: 100n });
    const secondary = client({ head: 101n });

    await expect(
      readOperationalRpcHealth(
        deployment,
        dependencies(primary, secondary),
      ),
    ).resolves.toEqual({
      status: "healthy",
      chainId: 1,
      read: {
        status: "available",
        servedBy: "primary",
        failoverUsed: false,
      },
      providers: {
        primary: { status: "available", head: "100" },
        secondary: { status: "available", head: "101" },
      },
      quorum: { status: "verified" },
      confirmedBlock: { number: "88", hash: BLOCK_HASH },
    });
    expect(primary.getBlock).toHaveBeenCalledWith({ blockNumber: 88n });
    expect(secondary.getBlock).toHaveBeenCalledWith({ blockNumber: 88n });
  });

  it("keeps reads available through the fixed secondary after primary 429", async () => {
    const primary = client({
      chainError: httpFailure(429, PRIMARY_URL),
    });
    const secondary = client({ head: 105n });
    const deps = dependencies(primary, secondary);

    const health = await readOperationalRpcHealth(deployment, deps);

    expect(health).toMatchObject({
      status: "degraded",
      read: {
        status: "available",
        servedBy: "secondary",
        failoverUsed: true,
      },
      providers: {
        primary: { status: "unavailable" },
        secondary: { status: "available", head: "105" },
      },
      quorum: { status: "unavailable" },
      confirmedBlock: { number: "93", hash: BLOCK_HASH },
    });
    expect(deps.createClient.mock.calls.map(([url]) => url)).toEqual([
      PRIMARY_URL,
      SECONDARY_URL,
    ]);
    expect(JSON.stringify(health)).not.toContain("primary.example");
    expect(JSON.stringify(health)).not.toContain("secondary.example");
    expect(JSON.stringify(health)).not.toContain("rpc-key");
  });

  it("stays degraded on primary when only the secondary is unavailable", async () => {
    const primary = client({ head: 100n });
    const secondary = client({
      chainError: httpFailure(503, SECONDARY_URL),
    });

    const health = await readOperationalRpcHealth(
      deployment,
      dependencies(primary, secondary),
    );

    expect(health).toMatchObject({
      status: "degraded",
      read: {
        status: "available",
        servedBy: "primary",
        failoverUsed: false,
      },
      providers: {
        primary: { status: "available", head: "100" },
        secondary: { status: "unavailable" },
      },
      quorum: { status: "unavailable" },
    });
  });

  it("uses the secondary when the primary loses capacity at the confirmed read", async () => {
    const primary = client({
      head: 100n,
      blockError: httpFailure(429, PRIMARY_URL),
    });
    const secondary = client({ head: 100n });

    const health = await readOperationalRpcHealth(
      deployment,
      dependencies(primary, secondary),
    );

    expect(health).toMatchObject({
      status: "degraded",
      read: {
        status: "available",
        servedBy: "secondary",
        failoverUsed: true,
      },
      providers: {
        primary: { status: "unavailable" },
        secondary: { status: "available" },
      },
      quorum: { status: "unavailable" },
      confirmedBlock: { number: "88", hash: BLOCK_HASH },
    });
  });

  it("reports unhealthy when both configured providers are down", async () => {
    const primary = client({
      chainError: httpFailure(429, PRIMARY_URL),
    });
    const secondary = client({
      chainError: httpFailure(503, SECONDARY_URL),
    });

    const health = await readOperationalRpcHealth(
      deployment,
      dependencies(primary, secondary),
    );

    expect(health).toEqual({
      status: "unhealthy",
      chainId: 1,
      read: {
        status: "unavailable",
        servedBy: null,
        failoverUsed: false,
      },
      providers: {
        primary: { status: "unavailable", head: null },
        secondary: { status: "unavailable", head: null },
      },
      quorum: { status: "unavailable" },
      confirmedBlock: null,
    });
  });

  it("fails closed when providers disagree on confirmed state", async () => {
    const primary = client();
    const secondary = client({
      blockHash: `0x${"22".repeat(32)}`,
    });

    const health = await readOperationalRpcHealth(
      deployment,
      dependencies(primary, secondary),
    );

    expect(health).toMatchObject({
      status: "unhealthy",
      read: { status: "blocked", servedBy: null },
      providers: {
        primary: { status: "available" },
        secondary: { status: "available" },
      },
      quorum: { status: "mismatch" },
      confirmedBlock: null,
    });
  });

  it("does not rotate after a wrong-chain integrity failure", async () => {
    const primary = client({ chainId: 11_155_111 });
    const secondary = client();
    const deps = dependencies(primary, secondary);

    const health = await readOperationalRpcHealth(deployment, deps);

    expect(health).toMatchObject({
      status: "unhealthy",
      read: { status: "blocked", servedBy: null },
      providers: {
        primary: { status: "invalid", head: "100" },
        secondary: { status: "unknown", head: null },
      },
      quorum: { status: "mismatch" },
    });
    expect(deps.createClient).toHaveBeenCalledTimes(1);
  });
});
