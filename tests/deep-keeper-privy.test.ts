import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";

import { createPrivyKeeperWallet } from "../ops/deep-keeper/privy-wallet.mjs";

const walletId = "yks0kyukdaidxf043xqxgaki";
const signer = "0x2222222222222222222222222222222222222222";
const coordinator = "0x856a8E8421e76f55CD1e0D65B4f3c1b474289b2f";
const vault = "0x3333333333333333333333333333333333333333";
const hash = `0x${"44".repeat(32)}`;
const abi = parseAbi([
  "function performBatch(address[] candidates) returns (uint256 attempted,uint256 succeeded)",
]);

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
  it("sends only the bounded Mainnet performBatch transaction", async () => {
    const { client, rpc } = mockClient();
    const wallet = createPrivyKeeperWallet({
      client,
      walletId,
      signerAddress: signer,
      coordinatorAddress: coordinator,
      now: () => 1_785_260_000_000,
    });

    await expect(
      wallet.writeContract({
        address: coordinator,
        abi,
        functionName: "performBatch",
        args: [[vault]],
        account: signer,
        gas: 500_000n,
        maxFeePerGas: 20_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      }),
    ).resolves.toBe(hash);

    const data = encodeFunctionData({
      abi,
      functionName: "performBatch",
      args: [[vault]],
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      walletId,
      expect.objectContaining({
        method: "eth_sendTransaction",
        caip2: "eip155:1",
        idempotency_key: expect.stringMatching(
          /^deep-[0-9a-f]{32}-[0-9]+$/,
        ),
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
      functionName: "performBatch",
      args: [[vault]],
      account: signer,
      gas: 500_000n,
      maxFeePerGas: 20_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
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
        functionName: "performBatch",
        args: [[vault]],
        account: signer,
        gas: 500_000n,
        maxFeePerGas: 20_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      }),
    ).rejects.toThrow("invalid transaction hash");
  });
});
