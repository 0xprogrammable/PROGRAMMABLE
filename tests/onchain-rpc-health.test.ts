import { HttpRequestError, RpcRequestError } from "viem";
import { describe, expect, it, vi } from "vitest";

import { readRpcHealthFromClients } from "../lib/onchain/rpc-health";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";

const HASH_A = `0x${"11".repeat(32)}` as const;
const HASH_B = `0x${"22".repeat(32)}` as const;
const ADDRESS = "0x0000000000000000000000000000000000000001" as const;

const deployment: ReadyOnchainDeployment = {
  status: "ready",
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  stateView: ADDRESS,
  stateViewRuntimeCodeHash: HASH_A,
  rpcUrl: "https://rpc-a.example",
  rpcUrlSecondary: "https://rpc-b.example",
  confirmations: 12n,
  logBlockRange: 500n,
  launcher: ADDRESS,
  feeHook: ADDRESS,
  launcherRuntimeCodeHash: HASH_A,
  feeHookRuntimeCodeHash: HASH_A,
  deploymentBlock: 1n,
};

function healthyClient(
  hash: typeof HASH_A | typeof HASH_B | null = HASH_A,
) {
  return {
    getChainId: vi.fn(async () => 1),
    getBlockNumber: vi.fn(async () => 1_000n),
    getBlock: vi.fn(async () => ({ hash })),
  };
}

function noWaitRetry() {
  return {
    delaysMs: [0, 0],
    sleep: vi.fn(async () => undefined),
  };
}

function typedHttpError(status: number) {
  return new HttpRequestError({
    body: { method: "eth_blockNumber" },
    status,
    url: "https://rpc-a.example",
  });
}

describe("independent RPC health resilience", () => {
  it("retries a typed HTTP 429 and still requires both observations", async () => {
    const first = healthyClient();
    first.getChainId
      .mockRejectedValueOnce(typedHttpError(429))
      .mockResolvedValue(1);
    const second = healthyClient();
    const retryOptions = noWaitRetry();

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, second],
        retryOptions,
      ),
    ).resolves.toMatchObject({
      chainId: 1,
      heads: ["1000", "1000"],
      confirmedBlock: { number: "988", hash: HASH_A },
    });
    expect(first.getChainId).toHaveBeenCalledTimes(2);
    expect(first.getBlock).toHaveBeenCalledOnce();
    expect(second.getBlock).toHaveBeenCalledOnce();
  });

  it("retries a typed network transport failure", async () => {
    const first = healthyClient();
    first.getChainId
      .mockRejectedValueOnce(
        new HttpRequestError({
          body: { method: "eth_chainId" },
          cause: new TypeError("fetch failed"),
          url: "https://rpc-a.example",
        }),
      )
      .mockResolvedValue(1);

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, healthyClient()],
        noWaitRetry(),
      ),
    ).resolves.toMatchObject({ chainId: 1 });
    expect(first.getChainId).toHaveBeenCalledTimes(2);
  });

  it("does not retry an untyped error based on its message", async () => {
    const first = healthyClient();
    first.getChainId.mockRejectedValue(
      new Error("Can't route your request to suitable provider"),
    );

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, healthyClient()],
        noWaitRetry(),
      ),
    ).rejects.toThrow("Can't route your request to suitable provider");
    expect(first.getChainId).toHaveBeenCalledOnce();
    expect(first.getBlockNumber).not.toHaveBeenCalled();
  });

  it("does not retry or mask a confirmed-block disagreement", async () => {
    const first = healthyClient(HASH_A);
    const second = healthyClient(HASH_B);
    const retryOptions = noWaitRetry();

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, second],
        retryOptions,
      ),
    ).rejects.toThrow("Independent RPCs disagree on the confirmed block");
    expect(first.getBlock).toHaveBeenCalledOnce();
    expect(second.getBlock).toHaveBeenCalledOnce();
    expect(retryOptions.sleep).not.toHaveBeenCalled();
  });

  it("fails immediately when a successful block response omits its hash", async () => {
    const first = healthyClient();
    first.getBlock.mockResolvedValue({ hash: null });
    const retryOptions = noWaitRetry();

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, healthyClient()],
        retryOptions,
      ),
    ).rejects.toThrow("Independent RPCs disagree on the confirmed block");
    expect(first.getBlock).toHaveBeenCalledOnce();
    expect(retryOptions.sleep).not.toHaveBeenCalled();
  });

  it("does not retry a non-transient RPC error", async () => {
    const first = healthyClient();
    first.getBlock.mockRejectedValue(new Error("execution reverted"));
    const retryOptions = noWaitRetry();

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, healthyClient()],
        retryOptions,
      ),
    ).rejects.toThrow("execution reverted");
    expect(first.getBlock).toHaveBeenCalledOnce();
  });

  it("does not retry a typed JSON-RPC semantic error", async () => {
    const first = healthyClient();
    first.getBlockNumber.mockRejectedValue(
      new RpcRequestError({
        body: { method: "eth_blockNumber" },
        error: { code: -32005, message: "rate limited" },
        url: "https://rpc-a.example",
      }),
    );

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, healthyClient()],
        noWaitRetry(),
      ),
    ).rejects.toBeInstanceOf(RpcRequestError);
    expect(first.getBlockNumber).toHaveBeenCalledOnce();
  });

  it("does not retry malformed successful JSON wrapped by the transport", async () => {
    const first = healthyClient();
    first.getChainId.mockRejectedValue(
      new HttpRequestError({
        body: { method: "eth_chainId" },
        cause: new SyntaxError("invalid JSON"),
        url: "https://rpc-a.example",
      }),
    );

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, healthyClient()],
        noWaitRetry(),
      ),
    ).rejects.toBeInstanceOf(HttpRequestError);
    expect(first.getChainId).toHaveBeenCalledOnce();
  });

  it("does not retry an HTTP authentication failure", async () => {
    const first = healthyClient();
    first.getChainId.mockRejectedValue(typedHttpError(401));

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, healthyClient()],
        noWaitRetry(),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(first.getChainId).toHaveBeenCalledOnce();
  });

  it("fails immediately on a wrong chain without reading that provider head", async () => {
    const first = healthyClient();
    first.getChainId.mockResolvedValue(11_155_111);

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, healthyClient()],
        noWaitRetry(),
      ),
    ).rejects.toThrow("RPC chain does not match the deployment manifest");
    expect(first.getChainId).toHaveBeenCalledOnce();
    expect(first.getBlockNumber).not.toHaveBeenCalled();
  });

  it("fails closed after all bounded attempts for either provider", async () => {
    const first = healthyClient();
    first.getBlockNumber.mockRejectedValue(typedHttpError(503));
    const retryOptions = noWaitRetry();

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, healthyClient()],
        retryOptions,
      ),
    ).rejects.toMatchObject({ name: "RpcRetriesExhaustedError" });
    expect(first.getBlockNumber).toHaveBeenCalledTimes(3);
  });

  it("fails closed when both providers exhaust their typed transport budget", async () => {
    const first = healthyClient();
    const second = healthyClient();
    first.getChainId.mockRejectedValue(typedHttpError(503));
    second.getChainId.mockRejectedValue(typedHttpError(503));

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, second],
        noWaitRetry(),
      ),
    ).rejects.toMatchObject({ name: "RpcRetriesExhaustedError" });
    expect(first.getChainId).toHaveBeenCalledTimes(3);
    expect(second.getChainId).toHaveBeenCalledTimes(3);
    expect(first.getBlockNumber).not.toHaveBeenCalled();
    expect(second.getBlockNumber).not.toHaveBeenCalled();
  });

  it("enforces a hard provider deadline", async () => {
    const first = healthyClient();
    first.getChainId.mockImplementation(
      async () => new Promise<number>(() => undefined),
    );

    await expect(
      readRpcHealthFromClients(
        deployment,
        [first, healthyClient()],
        { deadlineMs: 10, delaysMs: [0, 0] },
      ),
    ).rejects.toMatchObject({ name: "RpcDeadlineExceededError" });
    expect(first.getChainId).toHaveBeenCalledOnce();
    expect(first.getBlockNumber).not.toHaveBeenCalled();
  });
});
