import { encodeFunctionData, getAddress, toHex } from "viem";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^deep-[0-9a-f]{32}$/;

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

export function createPrivyKeeperWallet({
  client,
  walletId,
  signerAddress,
  coordinatorAddress,
  chainId = 1,
}) {
  if (!client?.wallets || typeof client.wallets !== "function") {
    throw new Error("Privy client is required");
  }
  if (!/^[a-z0-9]{24}$/.test(walletId ?? "")) {
    throw new Error("Privy wallet ID is invalid");
  }
  const signer = getAddress(signerAddress);
  const coordinator = getAddress(coordinatorAddress);

  return Object.freeze({
    supportsStableIdempotency: true,
    async writeContract({
      address,
      abi,
      functionName,
      args,
      account,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      idempotencyKey,
    }) {
      if (
        functionName !== "execute" ||
        !sameAddress(address, coordinator) ||
        !sameAddress(account, signer) ||
        !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey ?? "")
      ) {
        throw new Error("Keeper transaction is outside the approved scope");
      }
      const data = encodeFunctionData({
        abi,
        functionName,
        args,
      });
      const response = await client.wallets().rpc(walletId, {
        method: "eth_sendTransaction",
        caip2: `eip155:${chainId}`,
        idempotency_key: idempotencyKey,
        params: {
          transaction: {
            from: signer,
            to: coordinator,
            chain_id: chainId,
            type: 2,
            value: "0x0",
            data,
            gas_limit: toHex(gas),
            max_fee_per_gas: toHex(maxFeePerGas),
            max_priority_fee_per_gas: toHex(maxPriorityFeePerGas),
          },
        },
      });
      const hash = response?.data?.hash;
      if (!HASH_PATTERN.test(hash ?? "")) {
        throw new Error("Privy returned an invalid transaction hash");
      }
      return hash;
    },
  });
}
