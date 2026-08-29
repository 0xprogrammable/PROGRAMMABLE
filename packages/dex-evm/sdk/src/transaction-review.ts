import {
  encodeAbiParameters,
  getAddress,
  isHex,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { ProgrammableSdkError } from "./errors.js";
import { assertExactKeys, snapshotDataRecord } from "./input-snapshot.js";

export interface UnsignedTransactionRequest {
  readonly chainId: number;
  readonly from: Address;
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
  readonly nonce?: bigint;
  readonly gasLimit?: bigint;
  readonly maxFeePerGas?: bigint;
  readonly maxPriorityFeePerGas?: bigint;
}

export interface SimulationObservation {
  readonly schema: "programmable.dex-evm.simulation-observation.v1";
  readonly source: "simulateUnsignedTransaction";
  readonly requestFingerprint: Hex;
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly accountNonce: bigint;
  readonly accountBalance: bigint;
  readonly baseFeePerGas?: bigint;
  readonly success: boolean;
  readonly returnData?: Hex;
  readonly estimatedGas?: bigint;
  readonly errorName?: string;
  readonly errorMessage?: string;
}

export interface TransactionReview {
  readonly request: UnsignedTransactionRequest;
  readonly requestFingerprint: Hex;
  readonly simulation: SimulationObservation;
  readonly simulationObservationProvenance:
    | "module-produced-live-observation"
    | "unauthenticated-caller-input";
  readonly localSimulationChecksPassed: boolean;
  readonly ownerGateSatisfied: false;
  readonly findings: readonly string[];
  readonly signingPerformed: false;
  readonly broadcastingPerformed: false;
  readonly ownerMustRevalidateBlockHashAndCurrentness: true;
}

const UINT256_MAX = (1n << 256n) - 1n;
const MODULE_PRODUCED_SIMULATION_OBSERVATIONS = new WeakSet<object>();
const SIMULATION_OBSERVATION_FIELDS = new Set([
  "schema",
  "source",
  "requestFingerprint",
  "chainId",
  "blockNumber",
  "blockHash",
  "accountNonce",
  "accountBalance",
  "baseFeePerGas",
  "success",
  "returnData",
  "estimatedGas",
  "errorName",
  "errorMessage",
]);

function assertUnsignedRequest(requestValue: UnsignedTransactionRequest): UnsignedTransactionRequest {
  const request = snapshotDataRecord(requestValue, "transactionRequest");
  assertExactKeys(
    request,
    ["chainId", "from", "to", "data", "value"],
    ["nonce", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"],
    "transactionRequest",
  );
  const chainId = request["chainId"];
  const from = request["from"];
  const to = request["to"];
  const data = request["data"];
  const transactionValue = request["value"];
  const nonce = request["nonce"];
  const gasLimit = request["gasLimit"];
  const maxFeePerGas = request["maxFeePerGas"];
  const maxPriorityFeePerGas = request["maxPriorityFeePerGas"];
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new ProgrammableSdkError("TRANSACTION_CHAIN_ID_INVALID", "chainId must be a positive safe integer");
  }
  if (typeof data !== "string" || !isHex(data, { strict: true }) || (data.length - 2) % 2 !== 0) {
    throw new ProgrammableSdkError("TRANSACTION_CALLDATA_INVALID", "data must be strict hexadecimal bytes");
  }
  for (const [label, value] of [
    ["value", transactionValue],
    ["nonce", nonce],
    ["gasLimit", gasLimit],
    ["maxFeePerGas", maxFeePerGas],
    ["maxPriorityFeePerGas", maxPriorityFeePerGas],
  ] as const) {
    if (value !== undefined && (typeof value !== "bigint" || value < 0n || value > UINT256_MAX)) {
      throw new ProgrammableSdkError(
        "TRANSACTION_INTEGER_INVALID",
        `${label} must be a uint256 bigint`,
      );
    }
  }
  if (typeof from !== "string" || typeof to !== "string") {
    throw new ProgrammableSdkError("TRANSACTION_ADDRESS_INVALID", "from and to must be EVM addresses");
  }
  return Object.freeze({
    chainId,
    from: getAddress(from),
    to: getAddress(to),
    data,
    value: transactionValue as bigint,
    ...(nonce === undefined ? {} : { nonce: nonce as bigint }),
    ...(gasLimit === undefined ? {} : { gasLimit: gasLimit as bigint }),
    ...(maxFeePerGas === undefined ? {} : { maxFeePerGas: maxFeePerGas as bigint }),
    ...(maxPriorityFeePerGas === undefined
      ? {}
      : { maxPriorityFeePerGas: maxPriorityFeePerGas as bigint }),
  });
}

function fingerprintNormalizedRequest(request: UnsignedTransactionRequest): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256 chainId, address from, address to, bytes data, uint256 value, bool noncePresent, uint256 nonce, bool gasLimitPresent, uint256 gasLimit, bool maxFeePerGasPresent, uint256 maxFeePerGas, bool maxPriorityFeePerGasPresent, uint256 maxPriorityFeePerGas",
      ),
      [
        BigInt(request.chainId),
        request.from,
        request.to,
        request.data,
        request.value,
        request.nonce !== undefined,
        request.nonce ?? 0n,
        request.gasLimit !== undefined,
        request.gasLimit ?? 0n,
        request.maxFeePerGas !== undefined,
        request.maxFeePerGas ?? 0n,
        request.maxPriorityFeePerGas !== undefined,
        request.maxPriorityFeePerGas ?? 0n,
      ],
    ),
  );
}

export function unsignedTransactionFingerprint(requestValue: UnsignedTransactionRequest): Hex {
  return fingerprintNormalizedRequest(assertUnsignedRequest(requestValue));
}

function errorMessage(error: unknown): { readonly name: string; readonly message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 1_024) };
  return { name: "UnknownSimulationError", message: String(error).slice(0, 1_024) };
}

function sealModuleProducedObservation(observation: SimulationObservation): SimulationObservation {
  const frozen = Object.freeze(observation);
  MODULE_PRODUCED_SIMULATION_OBSERVATIONS.add(frozen);
  return frozen;
}

function snapshotCallerObservation(value: unknown): SimulationObservation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Object.freeze({}) as SimulationObservation;
  }
  const snapshot = snapshotDataRecord(value, "simulationObservation");
  return snapshot as unknown as SimulationObservation;
}

/**
 * Performs only read-only JSON-RPC operations. It never obtains a wallet,
 * signs bytes, sends a raw transaction, or calls `eth_sendTransaction`.
 */
export async function simulateUnsignedTransaction(
  client: PublicClient,
  requestValue: UnsignedTransactionRequest,
): Promise<SimulationObservation> {
  const request = assertUnsignedRequest(requestValue);
  const requestFingerprint = fingerprintNormalizedRequest(request);
  const actualChainId = await client.getChainId();
  if (actualChainId !== request.chainId) {
    throw new ProgrammableSdkError(
      "SIMULATION_CHAIN_MISMATCH",
      `client chain ${actualChainId} does not match requested chain ${request.chainId}`,
    );
  }
  const block = snapshotDataRecord(
    await client.getBlock({ blockTag: "latest" }),
    "simulation.latestBlock",
  );
  const blockNumber = block["number"];
  const blockHash = block["hash"];
  const baseFeePerGas = block["baseFeePerGas"];
  if (
    typeof blockNumber !== "bigint" ||
    blockNumber < 0n ||
    typeof blockHash !== "string" ||
    !exactHash(blockHash) ||
    (baseFeePerGas !== null &&
      baseFeePerGas !== undefined &&
      (typeof baseFeePerGas !== "bigint" || baseFeePerGas < 0n))
  ) {
    throw new ProgrammableSdkError(
      "SIMULATION_BLOCK_INVALID",
      "latest block must have an exact hash, non-negative number, and valid base fee",
    );
  }
  if (request.nonce !== undefined && request.nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProgrammableSdkError(
      "SIMULATION_NONCE_UNREPRESENTABLE",
      "viem requires nonce to fit a safe JavaScript integer",
    );
  }
  const envelope = {
    account: request.from,
    to: request.to,
    data: request.data,
    value: request.value,
    ...(request.nonce === undefined ? {} : { nonce: Number(request.nonce) }),
    ...(request.gasLimit === undefined ? {} : { gas: request.gasLimit }),
    ...(request.maxFeePerGas === undefined ? {} : { maxFeePerGas: request.maxFeePerGas }),
    ...(request.maxPriorityFeePerGas === undefined
      ? {}
      : { maxPriorityFeePerGas: request.maxPriorityFeePerGas }),
  } as const;
  const [accountNonce, accountBalance] = await Promise.all([
    client.getTransactionCount({ address: request.from, blockNumber }),
    client.getBalance({ address: request.from, blockNumber }),
  ]);
  if (!Number.isSafeInteger(accountNonce) || accountNonce < 0) {
    throw new ProgrammableSdkError("SIMULATION_ACCOUNT_NONCE_INVALID", "RPC account nonce is invalid");
  }
  if (typeof accountBalance !== "bigint" || accountBalance < 0n) {
    throw new ProgrammableSdkError("SIMULATION_ACCOUNT_BALANCE_INVALID", "RPC account balance is invalid");
  }
  const observationBase = {
    schema: "programmable.dex-evm.simulation-observation.v1",
    source: "simulateUnsignedTransaction",
    requestFingerprint,
    chainId: actualChainId,
    blockNumber,
    blockHash,
    accountNonce: BigInt(accountNonce),
    accountBalance,
    ...(baseFeePerGas == null ? {} : { baseFeePerGas }),
  } as const;

  const assertCanonicalAnchor = async (): Promise<void> => {
    const current = snapshotDataRecord(
      await client.getBlock({ blockNumber }),
      "simulation.canonicalAnchor",
    );
    const currentHash = current["hash"];
    if (
      typeof currentHash !== "string" ||
      !exactHash(currentHash) ||
      current["number"] !== blockNumber ||
      currentHash.toLowerCase() !== blockHash.toLowerCase()
    ) {
      throw new ProgrammableSdkError(
        "SIMULATION_BLOCK_REORGED",
        "simulation block hash changed during read-only RPC operations",
      );
    }
  };
  await assertCanonicalAnchor();

  try {
    const call = snapshotDataRecord(await client.call({
      ...envelope,
      blockHash,
      requireCanonical: true,
    }), "simulation.callResult");
    await assertCanonicalAnchor();
    let estimatedGas: bigint | undefined;
    try {
      estimatedGas = await client.estimateGas({ ...envelope, blockNumber });
    } catch {
      // The successful block-pinned eth_call remains useful evidence. A missing
      // estimate is surfaced by the review rather than replacing the result.
    }
    await assertCanonicalAnchor();
    return sealModuleProducedObservation({
      ...observationBase,
      success: true,
      ...(call["data"] === undefined ? {} : { returnData: call["data"] as Hex }),
      ...(estimatedGas === undefined ? {} : { estimatedGas }),
    });
  } catch (error) {
    if (error instanceof ProgrammableSdkError && error.code === "SIMULATION_BLOCK_REORGED") throw error;
    await assertCanonicalAnchor();
    const detail = errorMessage(error);
    return sealModuleProducedObservation({
      ...observationBase,
      success: false,
      errorName: detail.name,
      errorMessage: detail.message,
    });
  }
}

function exactHash(value: unknown): value is Hex {
  return typeof value === "string" && isHex(value, { strict: true }) && value.length === 66;
}

function simulationObservationFindings(simulation: SimulationObservation): readonly string[] {
  const findings: string[] = [];
  for (const field of Object.keys(simulation)) {
    if (!SIMULATION_OBSERVATION_FIELDS.has(field)) {
      findings.push("simulation-observation-field-invalid");
      break;
    }
  }
  if (
    simulation.schema !== "programmable.dex-evm.simulation-observation.v1" ||
    simulation.source !== "simulateUnsignedTransaction"
  ) {
    findings.push("simulation-observation-brand-invalid");
  }
  if (!exactHash(simulation.requestFingerprint)) findings.push("simulation-fingerprint-invalid");
  if (!Number.isSafeInteger(simulation.chainId) || simulation.chainId <= 0) {
    findings.push("simulation-chain-id-invalid");
  }
  if (typeof simulation.blockNumber !== "bigint" || simulation.blockNumber < 0n) {
    findings.push("simulation-block-number-invalid");
  }
  if (!exactHash(simulation.blockHash)) findings.push("simulation-block-hash-invalid");
  for (const [label, value, required] of [
    ["simulation-account-nonce-invalid", simulation.accountNonce, true],
    ["simulation-account-balance-invalid", simulation.accountBalance, true],
    ["simulation-base-fee-invalid", simulation.baseFeePerGas, false],
    ["simulation-estimated-gas-invalid", simulation.estimatedGas, false],
  ] as const) {
    if ((required && value === undefined) || (value !== undefined && (typeof value !== "bigint" || value < 0n))) {
      findings.push(label);
    }
  }
  if (typeof simulation.success !== "boolean") findings.push("simulation-success-invalid");
  if (
    simulation.returnData !== undefined &&
    (!isHex(simulation.returnData, { strict: true }) || (simulation.returnData.length - 2) % 2 !== 0)
  ) {
    findings.push("simulation-return-data-invalid");
  }
  for (const [label, value] of [
    ["simulation-error-name-invalid", simulation.errorName],
    ["simulation-error-message-invalid", simulation.errorMessage],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || value.length === 0 || value.length > 1_024)) {
      findings.push(label);
    }
  }
  if (
    (simulation.success === true &&
      (simulation.errorName !== undefined || simulation.errorMessage !== undefined)) ||
    (simulation.success === false &&
      (simulation.errorName === undefined ||
        simulation.errorMessage === undefined ||
        simulation.returnData !== undefined ||
        simulation.estimatedGas !== undefined))
  ) {
    findings.push("simulation-result-incoherent");
  }
  return findings;
}

export function reviewUnsignedTransaction(
  requestValue: UnsignedTransactionRequest,
  simulationValue: SimulationObservation,
): TransactionReview {
  const request = assertUnsignedRequest(requestValue);
  const moduleProduced =
    typeof simulationValue === "object" &&
    simulationValue !== null &&
    MODULE_PRODUCED_SIMULATION_OBSERVATIONS.has(simulationValue);
  const simulation = moduleProduced ? simulationValue : snapshotCallerObservation(simulationValue);
  const findings: string[] = [];
  if (!moduleProduced) findings.push("simulation-observation-provenance-unauthenticated");
  if (Object.keys(simulation).length === 0) findings.push("simulation-observation-object-invalid");
  const requestFingerprint = fingerprintNormalizedRequest(request);
  findings.push(...simulationObservationFindings(simulation));
  if (simulation.requestFingerprint !== requestFingerprint) findings.push("simulation-request-mismatch");
  if (simulation.chainId !== request.chainId) findings.push("simulation-chain-mismatch");
  if (!simulation.success) findings.push("simulation-reverted");
  if (simulation.estimatedGas === undefined) findings.push("gas-estimate-unavailable");
  if (request.gasLimit === undefined) findings.push("gas-limit-unresolved");
  if (
    request.gasLimit !== undefined &&
    typeof simulation.estimatedGas === "bigint" &&
    request.gasLimit < simulation.estimatedGas
  ) {
    findings.push("gas-limit-below-estimate");
  }
  if (request.maxFeePerGas === undefined) findings.push("maximum-fee-unresolved");
  if (request.maxPriorityFeePerGas === undefined) findings.push("priority-fee-unresolved");
  if (
    request.maxFeePerGas !== undefined &&
    request.maxPriorityFeePerGas !== undefined &&
    request.maxPriorityFeePerGas > request.maxFeePerGas
  ) {
    findings.push("priority-fee-exceeds-maximum-fee");
  }
  if (request.nonce === undefined) findings.push("nonce-unresolved");
  if (
    request.nonce !== undefined &&
    (typeof simulation.accountNonce !== "bigint" || simulation.accountNonce !== request.nonce)
  ) {
    findings.push("simulation-nonce-mismatch");
  }
  if (
    request.maxFeePerGas !== undefined &&
    typeof simulation.baseFeePerGas === "bigint" &&
    request.maxFeePerGas < simulation.baseFeePerGas
  ) {
    findings.push("maximum-fee-below-simulated-base-fee");
  }
  if (
    request.gasLimit !== undefined &&
    request.maxFeePerGas !== undefined &&
    typeof simulation.accountBalance === "bigint" &&
    simulation.accountBalance < request.value + request.gasLimit * request.maxFeePerGas
  ) {
    findings.push("balance-below-maximum-transaction-cost");
  }
  return Object.freeze({
    request,
    requestFingerprint,
    simulation,
    simulationObservationProvenance: moduleProduced
      ? "module-produced-live-observation"
      : "unauthenticated-caller-input",
    localSimulationChecksPassed: findings.length === 0,
    ownerGateSatisfied: false,
    findings: Object.freeze(findings),
    signingPerformed: false,
    broadcastingPerformed: false,
    ownerMustRevalidateBlockHashAndCurrentness: true,
  });
}
