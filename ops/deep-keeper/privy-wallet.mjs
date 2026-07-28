import {
  encodeFunctionData,
  getAddress,
  keccak256,
  toHex,
} from "viem";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

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
  now = () => Date.now(),
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
    async writeContract({
      address,
      abi,
      functionName,
      args,
      account,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
    }) {
      if (
        functionName !== "performBatch" ||
        !sameAddress(address, coordinator) ||
        !sameAddress(account, signer)
      ) {
        throw new Error("Keeper transaction is outside the approved scope");
      }
      const data = encodeFunctionData({
        abi,
        functionName,
        args,
      });
      const timeBucket = Math.floor(now() / 300_000);
      const requestKey =
        `deep-${keccak256(data).slice(2, 34)}-${timeBucket}`;
      const response = await client.wallets().rpc(walletId, {
        method: "eth_sendTransaction",
        caip2: `eip155:${chainId}`,
        idempotency_key: requestKey,
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
