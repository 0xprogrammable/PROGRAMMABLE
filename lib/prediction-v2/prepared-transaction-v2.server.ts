import "server-only";

import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import {
  PREDICTION_V2_EXECUTION_ROUTER_ABI,
  PREDICTION_V2_VAULT_ABI,
  type PredictionV2PoolKey,
} from "./abi";
import {
  predictionV2MarketId,
  predictionV2PoolId,
} from "./accounting";
import {
  PREDICTION_V2_ONCHAIN_DEADLINE_MAX_TTL_SECONDS,
  PREDICTION_V2_PREPARED_ACTIONS_V2,
  PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID,
  PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2,
  PREDICTION_V2_PREPARED_TRANSACTION_TTL_SECONDS,
  type PredictionV2PreparedActionV2,
  type PredictionV2PreparedTransactionJsonV2,
} from "./prepared-transaction-v2";
import {
  assertPredictionV2VerifiedEnabledPublicReleaseV2,
  toPredictionV2ReadBindingFromPublicReleaseV2,
  type PredictionV2EnabledPublicReleaseV2,
} from "./public-release-v2.server";
import {
  assertPredictionV2ReadMarketAtSnapshotProvenance,
  type PredictionV2ReadMarket,
  type PredictionV2SafeBlock,
} from "./read-model-v2.server";
import type { PredictionV2PreparedTransaction } from "./transactions";

const UINT64_MAX = (1n << 64n) - 1n;
const UINT80_MAX = (1n << 80n) - 1n;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const CALLDATA_PATTERN = /^0x[0-9a-f]+$/u;
const RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const SHA256_PATTERN = /^sha256:([0-9a-f]{64})$/u;

export type PredictionV2PreparedServerIntentV2 = Readonly<{
  action: PredictionV2PreparedActionV2;
  actionId: Hex;
  account: Address;
  /** The exact leased snapshot used by the action producer. */
  snapshot: PredictionV2SafeBlock;
  transaction: PredictionV2PreparedTransaction;
}>;

export type PredictionV2PreparedServerBindingV2 = Readonly<{
  release: PredictionV2EnabledPublicReleaseV2;
  market: PredictionV2ReadMarket;
  snapshot: PredictionV2SafeBlock;
  intent: PredictionV2PreparedServerIntentV2;
}>;

function invalid(label: string): never {
  throw new Error(`Invalid Protocol V2 prepared transaction ${label}.`);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(label);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(label);
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string") ||
    !fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, field);
      return descriptor !== undefined &&
        descriptor.enumerable &&
        Object.hasOwn(descriptor, "value");
    })
  ) {
    invalid(`${label} fields`);
  }
  return record;
}

function nonzeroAddress(value: unknown, label: string): Address {
  if (
    typeof value !== "string" ||
    !isAddress(value, { strict: false }) ||
    value.toLowerCase() === zeroAddress
  ) {
    invalid(label);
  }
  return getAddress(value);
}

function nonzeroBytes32(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !BYTES32_PATTERN.test(value) ||
    value === ZERO_BYTES32
  ) {
    invalid(label);
  }
  return value as Hex;
}

function nonzeroUint64(value: unknown, label: string): bigint {
  if (typeof value !== "bigint" || value <= 0n || value > UINT64_MAX) {
    invalid(label);
  }
  return value;
}

function calldata(value: unknown): Hex {
  if (
    typeof value !== "string" ||
    !CALLDATA_PATTERN.test(value) ||
    value.length < 10 ||
    value.length % 2 !== 0 ||
    value.length > 65_538
  ) {
    invalid("calldata");
  }
  return value as Hex;
}

function action(value: unknown): PredictionV2PreparedActionV2 {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(PREDICTION_V2_PREPARED_ACTIONS_V2, value)
  ) {
    invalid("action");
  }
  return value as PredictionV2PreparedActionV2;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function samePoolKey(left: PredictionV2PoolKey, right: PredictionV2PoolKey) {
  return sameAddress(left.currency0, right.currency0) &&
    sameAddress(left.currency1, right.currency1) &&
    left.fee === right.fee &&
    left.tickSpacing === right.tickSpacing &&
    sameAddress(left.hooks, right.hooks);
}

function currentUnixSeconds(): bigint {
  const milliseconds = Date.now();
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    invalid("current time");
  }
  return BigInt(Math.floor(milliseconds / 1_000));
}

function assertCanonicalCalldata(actual: Hex, canonical: Hex) {
  if (!sameHex(actual, canonical)) invalid("calldata canonicality");
}

function assertOnchainDeadline(
  deadline: bigint,
  issuedAtUnixSeconds: bigint,
  expiresAtUnixSeconds: bigint,
  label: string,
) {
  if (
    deadline < expiresAtUnixSeconds ||
    deadline >
      issuedAtUnixSeconds + PREDICTION_V2_ONCHAIN_DEADLINE_MAX_TTL_SECONDS
  ) {
    invalid(`${label} deadline binding`);
  }
}

function assertPermitSignature(v: number, r: Hex, s: Hex, label: string) {
  if (
    (v !== 27 && v !== 28) ||
    !BYTES32_PATTERN.test(r) ||
    !BYTES32_PATTERN.test(s) ||
    r === ZERO_BYTES32 ||
    s === ZERO_BYTES32
  ) {
    invalid(`${label} permit signature`);
  }
}

function assertCanonicalChainlinkProof(proof: Hex) {
  let beforeRoundId: bigint;
  let afterRoundId: bigint;
  try {
    [beforeRoundId, afterRoundId] = decodeAbiParameters(
      parseAbiParameters("uint80 beforeRoundId, uint80 afterRoundId"),
      proof,
    );
  } catch {
    return invalid("finalize proof");
  }
  const beforePhase = beforeRoundId >> 64n;
  const afterPhase = afterRoundId >> 64n;
  const beforeRound = beforeRoundId & ((1n << 64n) - 1n);
  const afterRound = afterRoundId & ((1n << 64n) - 1n);
  if (
    beforeRoundId <= 0n ||
    beforeRoundId > UINT80_MAX ||
    afterRoundId <= 0n ||
    afterRoundId > UINT80_MAX ||
    beforePhase === 0n ||
    beforeRound === 0n ||
    afterPhase !== beforePhase ||
    afterRound !== beforeRound + 1n
  ) {
    invalid("finalize proof");
  }
  assertCanonicalCalldata(
    proof,
    encodeAbiParameters(
      parseAbiParameters("uint80 beforeRoundId, uint80 afterRoundId"),
      [beforeRoundId, afterRoundId],
    ),
  );
}

function assertActionCalldata(input: Readonly<{
  action: PredictionV2PreparedActionV2;
  data: Hex;
  account: Address;
  market: PredictionV2ReadMarket;
  issuedAtUnixSeconds: bigint;
  expiresAtUnixSeconds: bigint;
}>) {
  if (input.action === "buy" || input.action === "sell") {
    let decoded;
    try {
      decoded = decodeFunctionData({
        abi: PREDICTION_V2_EXECUTION_ROUTER_ABI,
        data: input.data,
      });
    } catch {
      return invalid(`${input.action} calldata`);
    }
    const expectedFunction = input.action === "buy"
      ? "buyOutcomeWithPermit"
      : "sellOutcomeWithPermit";
    if (
      decoded.functionName !== expectedFunction ||
      !sameAddress(decoded.args[0], input.market.vault) ||
      !samePoolKey(decoded.args[1], input.market.poolKey) ||
      !sameHex(predictionV2PoolId(decoded.args[1]), input.market.poolId)
    ) {
      invalid(`${input.action} market binding`);
    }
    const request = decoded.args[2];
    if (input.action === "buy") {
      if (
        !("collateralAtoms" in request) ||
        request.collateralAtoms <= 0n ||
        request.minOutcomeAtoms <= 0n
      ) {
        invalid("buy amount binding");
      }
    } else {
      if (
        !("outcomeAtoms" in request) ||
        request.outcomeAtoms <= 0n ||
        request.swapAtoms > request.outcomeAtoms ||
        request.minCollateralAtoms <= 0n
      ) {
        invalid("sell amount binding");
      }
    }
    if (request.sqrtPriceLimitX96 <= 0n) {
      invalid(`${input.action} price limit`);
    }
    assertOnchainDeadline(
      request.deadline,
      input.issuedAtUnixSeconds,
      input.expiresAtUnixSeconds,
      `${input.action} trade`,
    );
    assertOnchainDeadline(
      decoded.args[3],
      input.issuedAtUnixSeconds,
      input.expiresAtUnixSeconds,
      `${input.action} permit`,
    );
    assertPermitSignature(
      decoded.args[4],
      decoded.args[5],
      decoded.args[6],
      input.action,
    );
    assertCanonicalCalldata(
      input.data,
      encodeFunctionData({
        abi: PREDICTION_V2_EXECUTION_ROUTER_ABI,
        functionName: expectedFunction,
        args: decoded.args,
      }),
    );
    return;
  }

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      data: input.data,
    });
  } catch {
    return invalid(`${input.action} calldata`);
  }
  if (input.action === "redeem") {
    if (
      decoded.functionName !== "redeem" ||
      (decoded.args[0] === 0n && decoded.args[1] === 0n) ||
      !sameAddress(decoded.args[2], input.account)
    ) {
      invalid("redeem binding");
    }
    assertCanonicalCalldata(
      input.data,
      encodeFunctionData({
        abi: PREDICTION_V2_VAULT_ABI,
        functionName: "redeem",
        args: decoded.args,
      }),
    );
    return;
  }

  const expectedFunction = {
    "finalize-with-proof": "finalize",
    "finalize-unavailable": "finalizeUnavailable",
    "request-unproven-fallback": "requestUnprovenFallback",
    "finalize-unproven": "finalizeUnproven",
    "finalize-resolved": "finalizeResolved",
  }[input.action];
  if (decoded.functionName !== expectedFunction) invalid("finalize selector");
  if (input.action === "finalize-with-proof") {
    const args = decoded.args as readonly [Hex];
    assertCanonicalChainlinkProof(args[0]);
    assertCanonicalCalldata(
      input.data,
      encodeFunctionData({
        abi: PREDICTION_V2_VAULT_ABI,
        functionName: "finalize",
        args,
      }),
    );
    return;
  }
  const canonical = {
    "finalize-unavailable": encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "finalizeUnavailable",
    }),
    "request-unproven-fallback": encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "requestUnprovenFallback",
    }),
    "finalize-unproven": encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "finalizeUnproven",
    }),
    "finalize-resolved": encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "finalizeResolved",
    }),
  }[input.action];
  assertCanonicalCalldata(input.data, canonical);
}

/**
 * Server-only constructor for a closed serializable response. Runtime brands
 * from the signed release parser and the release/snapshot-bound settlement-RPC
 * read model are mandatory; structural clones and cross-release rows fail closed.
 */
export function buildPredictionV2PreparedTransactionEnvelopeV2(
  input: PredictionV2PreparedServerBindingV2,
): PredictionV2PreparedTransactionJsonV2 {
  assertPredictionV2VerifiedEnabledPublicReleaseV2(input.release);
  const readBinding = toPredictionV2ReadBindingFromPublicReleaseV2(input.release);
  assertPredictionV2ReadMarketAtSnapshotProvenance(
    input.market,
    input.snapshot,
    readBinding,
  );
  const intent = exactRecord(
    input.intent,
    ["action", "actionId", "account", "snapshot", "transaction"],
    "server intent",
  );
  if (intent.snapshot !== input.snapshot) {
    invalid("intent snapshot capability");
  }
  const transaction = exactRecord(
    intent.transaction,
    ["chainId", "to", "data", "value"],
    "server intent transaction",
  );
  const preparedAction = action(intent.action);
  const specification = PREDICTION_V2_PREPARED_ACTIONS_V2[preparedAction];
  const actionId = nonzeroBytes32(intent.actionId, "action id");
  const account = nonzeroAddress(intent.account, "account");
  if (
    transaction.chainId !== PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID ||
    transaction.value !== 0n
  ) {
    invalid("chain/value binding");
  }
  const data = calldata(transaction.data);
  if (data.slice(0, 10) !== specification.selector) {
    invalid("selector binding");
  }
  const target = preparedAction === "buy" || preparedAction === "sell"
    ? readBinding.router
    : input.market.vault;
  if (!sameAddress(nonzeroAddress(transaction.to, "target"), target)) {
    invalid("target binding");
  }
  if (!sameAddress(input.market.poolKey.hooks, readBinding.hook)) {
    invalid("release hook binding");
  }
  if (
    !sameHex(predictionV2PoolId(input.market.poolKey), input.market.poolId) ||
    !sameHex(
      predictionV2MarketId(
        input.market.economicKey,
        input.market.registrySnapshotHash,
      ),
      input.market.marketId,
    )
  ) {
    invalid("market identity binding");
  }
  const tokenAddresses = new Set([
    input.market.yesToken.toLowerCase(),
    input.market.noToken.toLowerCase(),
  ]);
  if (
    tokenAddresses.size !== 2 ||
    !tokenAddresses.has(input.market.poolKey.currency0.toLowerCase()) ||
    !tokenAddresses.has(input.market.poolKey.currency1.toLowerCase())
  ) {
    invalid("outcome token binding");
  }
  if (
    (preparedAction === "buy" || preparedAction === "sell") &&
    !input.market.lifecycle.tradable
  ) {
    invalid("market tradability binding");
  }
  if (
    preparedAction === "redeem" &&
    input.market.lifecycle.protocolState === "OPEN"
  ) {
    invalid("market redemption state");
  }
  if (
    specification.kind === "finalize" &&
    (
      input.market.lifecycle.protocolState !== "OPEN" ||
      input.snapshot.timestamp < input.market.predicate.observationTime
    )
  ) {
    invalid("market finalization state");
  }
  nonzeroUint64(input.snapshot.number, "snapshot block number");
  const snapshotHash = nonzeroBytes32(
    input.snapshot.hash,
    "snapshot block hash",
  );
  const issuedAtUnixSeconds = currentUnixSeconds();
  const expiresAtUnixSeconds =
    issuedAtUnixSeconds + PREDICTION_V2_PREPARED_TRANSACTION_TTL_SECONDS;
  assertActionCalldata({
    action: preparedAction,
    data,
    account,
    market: input.market,
    issuedAtUnixSeconds,
    expiresAtUnixSeconds,
  });

  return Object.freeze({
    schemaVersion: PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2,
    releaseId: RELEASE_ID_PATTERN.test(input.release.release.releaseId)
      ? input.release.release.releaseId
      : invalid("release id"),
    releaseBindingHash: (() => {
      const match = SHA256_PATTERN.exec(input.release.attestation.payloadSha256);
      return match ? `0x${match[1]}` as Hex : invalid("release binding hash");
    })(),
    chainId: PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID,
    action: preparedAction,
    actionId,
    calldataHash: keccak256(data),
    kind: specification.kind,
    confirmedBlockNumber: input.snapshot.number.toString(),
    confirmedBlockHash: snapshotHash,
    marketId: input.market.marketId,
    marketVault: getAddress(input.market.vault),
    account,
    issuedAtUnixSeconds: issuedAtUnixSeconds.toString(),
    expiresAtUnixSeconds: expiresAtUnixSeconds.toString(),
    transaction: Object.freeze({
      to: getAddress(target),
      data,
      value: "0" as const,
      gasLimit: specification.gasLimit.toString(),
    }),
  });
}
