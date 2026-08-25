import { sha256, stringToHex } from "viem";

import {
  CustomLaunchWalletHandoffErrorV1,
  prepareCustomLaunchWalletActionForAuthorizationSchema,
  type CustomLaunchWalletActionV1,
} from "./wallet-handoff-v1";

const TRANSACTION_PREIMAGE_DOMAIN_V2 =
  "programmable.wallet-transaction-preimage.v2" as const;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SIMULATION_KEYS = Object.freeze([
  "outcome",
  "transactionPreimageHash",
  "profileHash",
  "blockNumber",
  "blockHash",
  "responseDigest",
  "gasEstimate",
]);

export class CustomLaunchWalletHandoffErrorV2 extends Error {
  constructor() {
    super(
      "The simulated transaction failed the wallet safety checks. Refresh the request and try again.",
    );
    this.name = "CustomLaunchWalletHandoffErrorV2";
  }
}

export function customLaunchWalletTransactionPreimageHashV2(
  action: CustomLaunchWalletActionV1,
): `sha256:${string}` {
  if (action.data !== action.data.toLowerCase()) return invalid();
  const preimage = [
    TRANSACTION_PREIMAGE_DOMAIN_V2,
    action.chainId,
    action.from,
    action.to,
    action.valueWei,
    action.data,
  ].join("\0");
  return `sha256:${sha256(stringToHex(preimage)).slice(2)}`;
}

/**
 * V2 reuses the exact Router transaction contract from V1, but exposes it only
 * after a pinned-block simulation. Both bindings must survive the fresh
 * single-resource read immediately before the wallet is opened.
 */
export function prepareCustomLaunchWalletActionV2(
  output: unknown,
  connectedController: string,
  expectedProfileHash: string,
): CustomLaunchWalletActionV1 {
  if (!SHA256.test(expectedProfileHash)) return invalid();
  const result = record(output);
  const simulation = exactRecord(result.simulation, SIMULATION_KEYS);
  let action: CustomLaunchWalletActionV1;
  try {
    action = prepareCustomLaunchWalletActionForAuthorizationSchema(
      output,
      connectedController,
      "programmable.custom-launch-authorization-result.v2",
    );
  } catch (error) {
    if (error instanceof CustomLaunchWalletHandoffErrorV1) return invalid();
    throw error;
  }
  if (
    simulation.outcome !== "passed" ||
    simulation.profileHash !== expectedProfileHash ||
    simulation.transactionPreimageHash !==
      customLaunchWalletTransactionPreimageHashV2(action) ||
    typeof simulation.responseDigest !== "string" ||
    !SHA256.test(simulation.responseDigest) ||
    typeof simulation.blockNumber !== "string" ||
    !UNSIGNED_DECIMAL.test(simulation.blockNumber) ||
    BigInt(simulation.blockNumber) === 0n ||
    typeof simulation.blockHash !== "string" ||
    !BYTES32.test(simulation.blockHash) ||
    typeof simulation.gasEstimate !== "string" ||
    !UNSIGNED_DECIMAL.test(simulation.gasEstimate) ||
    BigInt(simulation.gasEstimate) === 0n
  ) return invalid();
  return action;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  const result = record(value);
  const keys = Object.keys(result);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => !expectedKeys.includes(key))
  ) return invalid();
  return result;
}

function invalid(): never {
  throw new CustomLaunchWalletHandoffErrorV2();
}
