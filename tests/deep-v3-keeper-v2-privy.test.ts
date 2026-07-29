import { describe, expect, it, vi } from "vitest";

import { DEEP_V3_V2_EXECUTOR_ABI } from "../ops/deep-keeper-v3/core-v2.mjs";
import { createPrivyDeepV3KeeperV2Wallet } from "../ops/deep-keeper-v3/privy-wallet-v2.mjs";

const signer = "0x0000000000000000000000000000000000000001";
const executor = "0x0000000000000000000000000000000000000002";
const vault = "0x0000000000000000000000000000000000000003";
const transactionHash = `0x${"a".repeat(64)}`;

describe("Deep V3 keeper ops v2 Privy boundary", () => {
  it("returns and verifies Privy's resolved nonce and reconciliation IDs", async () => {
    const rpc = vi.fn().mockImplementation(
      async (_walletId, request) => ({
        data: {
          hash: transactionHash,
          transaction_id: "privy-transaction-1",
          reference_id: "deep-v3-v2-batch-1",
          transaction_request: {
            ...request.params.transaction,
            nonce: 7,
          },
        },
      }),
    );
    const client = { wallets: () => ({ rpc }) };
    const wallet = createPrivyDeepV3KeeperV2Wallet({
      client,
      walletId: "a".repeat(24),
      signerAddress: signer,
      executorAddress: executor,
      chainId: 1,
      now: () => 100_000,
    });

    const result = await wallet.submitBatch({
      candidates: [{ vault, action: 1 }],
      gas: 3_000_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      expectedNonce: 7n,
      requestExpiryMs: 190_000,
      idempotencyKey: `deepv3v2-${"b".repeat(32)}`,
      referenceId: "deep-v3-v2-batch-1",
      abi: DEEP_V3_V2_EXECUTOR_ABI,
    });

    expect(result).toEqual({
      transactionHash,
      transactionId: "privy-transaction-1",
      nonce: 7n,
      referenceId: "deep-v3-v2-batch-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "a".repeat(24),
      expect.objectContaining({
        method: "eth_sendTransaction",
        idempotency_key: `deepv3v2-${"b".repeat(32)}`,
        reference_id: "deep-v3-v2-batch-1",
        params: {
          transaction: expect.objectContaining({
            from: signer,
            to: executor,
            value: "0x0",
            gas_limit: "0x2dc6c0",
          }),
        },
        request_expiry: 190_000,
      }),
    );
  });

  it("accepts Privy's documented minimal response and retains the persisted nonce", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        hash: transactionHash,
        caip2: "eip155:1",
      },
    });
    const wallet = createPrivyDeepV3KeeperV2Wallet({
      client: { wallets: () => ({ rpc }) },
      walletId: "a".repeat(24),
      signerAddress: signer,
      executorAddress: executor,
      chainId: 1,
      now: () => 100_000,
    });

    await expect(
      wallet.submitBatch({
        candidates: [{ vault, action: 1 }],
        gas: 3_000_000n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        expectedNonce: 7n,
        requestExpiryMs: 190_000,
        idempotencyKey: `deepv3v2-${"b".repeat(32)}`,
        referenceId: "deep-v3-v2-batch-1",
        abi: DEEP_V3_V2_EXECUTOR_ABI,
      }),
    ).resolves.toEqual({
      transactionHash,
      transactionId: null,
      nonce: 7n,
      referenceId: "deep-v3-v2-batch-1",
    });
  });

  it.each([
    [{ nonce: 8 }, /nonce/i],
    [{ to: signer }, /scope/i],
    [{ from: executor }, /scope/i],
    [{ chain_id: 10 }, /scope/i],
    [{ type: 0 }, /scope/i],
    [{ data: "0x1234" }, /scope/i],
    [{ value: "0x1" }, /scope/i],
    [{ gas_limit: "0x1" }, /envelope/i],
  ])("rejects response drift after broadcast: %o", async (drift, error) => {
    const client = {
      wallets: () => ({
        rpc: vi.fn().mockImplementation(
          async (_walletId, request) => ({
            data: {
              hash: transactionHash,
              transaction_id: "privy-transaction-1",
              reference_id: "deep-v3-v2-batch-1",
              transaction_request: {
                ...request.params.transaction,
                ...drift,
              },
            },
          }),
        ),
      }),
    };
    const wallet = createPrivyDeepV3KeeperV2Wallet({
      client,
      walletId: "a".repeat(24),
      signerAddress: signer,
      executorAddress: executor,
      chainId: 1,
      now: () => 100_000,
    });

    await expect(
      wallet.submitBatch({
        candidates: [{ vault, action: 1 }],
        gas: 3_000_000n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        expectedNonce: 7n,
        requestExpiryMs: 190_000,
        idempotencyKey: `deepv3v2-${"b".repeat(32)}`,
        referenceId: "deep-v3-v2-batch-1",
        abi: DEEP_V3_V2_EXECUTOR_ABI,
      }),
    ).rejects.toThrow(error);
  });

  it("does not call Privy when the per-attempt expiry elapsed before send", async () => {
    const rpc = vi.fn();
    const wallet = createPrivyDeepV3KeeperV2Wallet({
      client: { wallets: () => ({ rpc }) },
      walletId: "a".repeat(24),
      signerAddress: signer,
      executorAddress: executor,
      chainId: 1,
      now: () => 189_000,
    });

    await expect(
      wallet.submitBatch({
        candidates: [{ vault, action: 1 }],
        gas: 3_000_000n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        expectedNonce: 7n,
        requestExpiryMs: 190_000,
        idempotencyKey: `deepv3v2-${"b".repeat(32)}`,
        referenceId: "deep-v3-v2-batch-1",
        abi: DEEP_V3_V2_EXECUTOR_ABI,
      }),
    ).rejects.toThrow(/expiry/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});
