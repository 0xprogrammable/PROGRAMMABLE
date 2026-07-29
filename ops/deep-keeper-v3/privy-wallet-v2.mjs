import { encodeFunctionData, getAddress, toHex } from "viem";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const IDEMPOTENCY_PATTERN = /^deepv3v2-[0-9a-f]{32}$/;
const ID_PATTERN = /^[a-zA-Z0-9._:-]{1,96}$/;
const MIN_REQUEST_EXPIRY_LEAD_MS = 2_000;

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function parseInteger(value, label) {
  try {
    const parsed =
      typeof value === "string" && value.startsWith("0x")
        ? BigInt(value)
        : BigInt(value);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`Privy returned an invalid ${label}`);
  }
}

export function createPrivyDeepV3KeeperV2Wallet({
  client,
  walletId,
  signerAddress,
  executorAddress,
  chainId,
  now = Date.now,
}) {
  if (!client?.wallets || typeof client.wallets !== "function") {
    throw new Error("Privy client is required");
  }
  if (!/^[a-z0-9]{24}$/.test(walletId ?? "")) {
    throw new Error("Privy wallet ID is invalid");
  }
  const signer = getAddress(signerAddress);
  const executor = getAddress(executorAddress);
  if (typeof now !== "function") {
    throw new Error("Keeper clock is required");
  }

  return Object.freeze({
    supportsStableIdempotency: true,
    async submitBatch({
      candidates,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      expectedNonce,
      requestExpiryMs,
      idempotencyKey,
      referenceId,
      abi,
    }) {
      if (
        !Array.isArray(candidates) ||
        candidates.length < 1 ||
        candidates.length > 4 ||
        !IDEMPOTENCY_PATTERN.test(idempotencyKey ?? "") ||
        !ID_PATTERN.test(referenceId ?? "") ||
        referenceId.length > 64 ||
        gas <= 0n ||
        maxFeePerGas <= 0n ||
        maxPriorityFeePerGas < 0n ||
        maxPriorityFeePerGas > maxFeePerGas ||
        expectedNonce < 0n ||
        !Number.isSafeInteger(requestExpiryMs) ||
        requestExpiryMs <= 0
      ) {
        throw new Error("Keeper transaction is outside the approved scope");
      }
      const currentTimeMs = now();
      if (
        !Number.isSafeInteger(currentTimeMs) ||
        requestExpiryMs - currentTimeMs <
          MIN_REQUEST_EXPIRY_LEAD_MS
      ) {
        throw new Error(
          "Keeper signer request expiry is too close or elapsed",
        );
      }
      const data = encodeFunctionData({
        abi,
        functionName: "execute",
        args: [
          candidates.map(({ vault, action }) => ({
            vault: getAddress(vault),
            expectedAction: action,
          })),
        ],
      });
      const response = await client.wallets().rpc(walletId, {
        method: "eth_sendTransaction",
        caip2: `eip155:${chainId}`,
        chain_type: "ethereum",
        idempotency_key: idempotencyKey,
        reference_id: referenceId,
        request_expiry: requestExpiryMs,
        params: {
          transaction: {
            from: signer,
            to: executor,
            chain_id: chainId,
            type: 2,
            nonce: toHex(expectedNonce),
            value: "0x0",
            data,
            gas_limit: toHex(gas),
            max_fee_per_gas: toHex(maxFeePerGas),
            max_priority_fee_per_gas: toHex(maxPriorityFeePerGas),
          },
        },
      });
      const result = response?.data;
      if (
        !HASH_PATTERN.test(result?.hash ?? "") ||
        (result?.caip2 !== undefined &&
          result.caip2 !== `eip155:${chainId}`) ||
        (result?.transaction_id !== undefined &&
          !ID_PATTERN.test(result.transaction_id)) ||
        (result?.reference_id !== undefined &&
          result.reference_id !== referenceId)
      ) {
        throw new Error("Privy returned incomplete transaction evidence");
      }
      const request = result.transaction_request;
      if (request !== undefined) {
        const nonce = parseInteger(request.nonce, "nonce");
        if (nonce !== expectedNonce) {
          throw new Error("Privy returned an unexpected nonce");
        }
        if (
          !sameAddress(request.from, signer) ||
          !sameAddress(request.to, executor) ||
          parseInteger(request.chain_id, "chain ID") !==
            BigInt(chainId) ||
          parseInteger(request.type, "transaction type") !== 2n ||
          request.data !== data ||
          parseInteger(request.value, "value") !== 0n
        ) {
          throw new Error("Privy response is outside the keeper scope");
        }
        if (
          parseInteger(request.gas_limit, "gas limit") !== gas ||
          parseInteger(request.max_fee_per_gas, "maximum fee") !==
            maxFeePerGas ||
          parseInteger(
            request.max_priority_fee_per_gas,
            "priority fee",
          ) !== maxPriorityFeePerGas
        ) {
          throw new Error("Privy response changed the request envelope");
        }
      }
      return {
        transactionHash: result.hash,
        transactionId: result.transaction_id ?? null,
        nonce: expectedNonce,
        referenceId,
      };
    },
  });
}
