import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";

import { createPrivyKeeperWallet } from "../ops/deep-keeper/privy-wallet.mjs";

const walletId = "yks0kyukdaidxf043xqxgaki";
const signer = "0x2222222222222222222222222222222222222222";
const coordinator = "0x856a8E8421e76f55CD1e0D65B4f3c1b474289b2f";
const vault = "0x3333333333333333333333333333333333333333";
const hash = `0x${"44".repeat(32)}`;
const idempotencyKey = `deep-${"ab".repeat(16)}`;
const abi = parseAbi([
  "function execute((address vault,uint8 expectedAction)[] candidates) returns (bytes32 batchHash,uint256 attempted,uint256 succeeded)",
]);
const candidates: { vault: `0x${string}`; expectedAction: number }[] = [
  { vault, expectedAction: 1 },
];

function mockClient(result: unknown = { data: { hash } }) {
  const rpc = vi.fn(async () => result);
  return {
    rpc,
    client: {
      wallets: () => ({ rpc }),
    },
  };
}

describe("Privy Deep keeper wallet", () => {
  it("sends only the bounded Mainnet executor transaction", async () => {
    const { client, rpc } = mockClient();
    const wallet = createPrivyKeeperWallet({
      client,
      walletId,
      signerAddress: signer,
      coordinatorAddress: coordinator,
    });

    await expect(
      wallet.writeContract({
        address: coordinator,
        abi,
        functionName: "execute",
        args: [candidates],
        account: signer,
        gas: 500_000n,
        maxFeePerGas: 20_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        idempotencyKey,
      }),
    ).resolves.toBe(hash);

    const data = encodeFunctionData({
      abi,
      functionName: "execute",
      args: [candidates],
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      walletId,
      expect.objectContaining({
        method: "eth_sendTransaction",
        caip2: "eip155:1",
        idempotency_key: idempotencyKey,
        params: {
          transaction: {
            from: signer,
            to: coordinator,
            chain_id: 1,
            type: 2,
            value: "0x0",
            data,
            gas_limit: "0x7a120",
            max_fee_per_gas: "0x4a817c800",
            max_priority_fee_per_gas: "0x3b9aca00",
          },
        },
      }),
    );
  });

  it("rejects any different account, contract or function", async () => {
    const { client, rpc } = mockClient();
    const wallet = createPrivyKeeperWallet({
      client,
      walletId,
      signerAddress: signer,
      coordinatorAddress: coordinator,
    });
    const base = {
      address: coordinator,
      abi,
      functionName: "execute",
      args: [candidates],
      account: signer,
      gas: 500_000n,
      maxFeePerGas: 20_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      idempotencyKey,
    };

    await expect(
      wallet.writeContract({
        ...base,
        address: "0x4444444444444444444444444444444444444444",
      }),
    ).rejects.toThrow("outside the approved scope");
    await expect(
      wallet.writeContract({
        ...base,
        account: "0x5555555555555555555555555555555555555555",
      }),
    ).rejects.toThrow("outside the approved scope");
    await expect(
      wallet.writeContract({ ...base, functionName: "scan" }),
    ).rejects.toThrow("outside the approved scope");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when Privy does not return a transaction hash", async () => {
    const { client } = mockClient({ data: {} });
    const wallet = createPrivyKeeperWallet({
      client,
      walletId,
      signerAddress: signer,
      coordinatorAddress: coordinator,
    });

    await expect(
      wallet.writeContract({
        address: coordinator,
        abi,
        functionName: "execute",
        args: [candidates],
        account: signer,
        gas: 500_000n,
        maxFeePerGas: 20_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        idempotencyKey,
      }),
    ).rejects.toThrow("invalid transaction hash");
  });

  it("replays the caller's stable idempotency key without changing it", async () => {
    const { client, rpc } = mockClient();
    const wallet = createPrivyKeeperWallet({
      client,
      walletId,
      signerAddress: signer,
      coordinatorAddress: coordinator,
    });
    const request = {
      address: coordinator,
      abi,
      functionName: "execute",
      args: [candidates],
      account: signer,
      gas: 500_000n,
      maxFeePerGas: 20_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      idempotencyKey,
    };

    await wallet.writeContract(request);
    await wallet.writeContract(request);

    expect(rpc).toHaveBeenCalledTimes(2);
    const calls = rpc.mock.calls as unknown as Array<
      [string, { idempotency_key: string }]
    >;
    expect(calls.map((call) => call[1].idempotency_key)).toEqual(
      [idempotencyKey, idempotencyKey],
    );
  });

  it("rejects a missing or malformed idempotency key", async () => {
    const { client, rpc } = mockClient();
    const wallet = createPrivyKeeperWallet({
      client,
      walletId,
      signerAddress: signer,
      coordinatorAddress: coordinator,
    });
    const request = {
      address: coordinator,
      abi,
      functionName: "execute",
      args: [candidates],
      account: signer,
      gas: 500_000n,
      maxFeePerGas: 20_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    };

    await expect(wallet.writeContract(request)).rejects.toThrow(
      "outside the approved scope",
    );
    await expect(
      wallet.writeContract({
        ...request,
        idempotencyKey: "deep-short",
      }),
    ).rejects.toThrow("outside the approved scope");
    expect(rpc).not.toHaveBeenCalled();
  });
});
