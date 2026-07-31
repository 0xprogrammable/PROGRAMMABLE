import "server-only";

import { encodeAbiParameters, keccak256, type Hex } from "viem";

import {
  canonicalAddress,
  canonicalBytes32,
  canonicalRawData,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
  type HexData,
} from "./codecs";
import { invalidInput, validationError } from "./errors";

const UINT32_MAXIMUM = 4_294_967_295n;

export function canonicalUint32DecimalText(
  value: unknown,
  operation = "uint32",
): string {
  let text: string;
  if (typeof value === "bigint") {
    text = value.toString();
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw invalidInput("rpc", operation);
    }
    text = String(value);
  } else {
    try {
      text = parseNonnegativeIntegerText(value);
    } catch {
      throw invalidInput("rpc", operation);
    }
  }
  const parsed = BigInt(text);
  if (parsed > UINT32_MAXIMUM) {
    throw invalidInput("rpc", operation);
  }
  return text;
}

export type CanonicalCoverageLog = Readonly<{
  address: HexAddress;
  blockNumber: string;
  blockHash: HexBytes32;
  transactionHash: HexBytes32;
  transactionIndex: string;
  blockGlobalLogIndex: string;
  topics: readonly HexBytes32[];
  data: HexData;
  commitment: HexBytes32;
}>;

export function canonicalCoverageLog(value: {
  address: Hex;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  transactionIndex: number | null;
  logIndex: number | null;
  removed?: boolean;
  topics: readonly Hex[];
  data: Hex;
}): CanonicalCoverageLog {
  if (
    value === null ||
    typeof value !== "object" ||
    value.blockNumber === null ||
    typeof value.blockNumber !== "bigint" ||
    value.blockNumber < 0n ||
    value.blockHash === null ||
    value.transactionHash === null ||
    value.transactionIndex === null ||
    value.logIndex === null ||
    value.removed !== false ||
    !Array.isArray(value.topics) ||
    value.topics.length < 1 ||
    value.topics.length > 4
  ) {
    throw validationError("rpc", "coverage-log");
  }
  let address: HexAddress;
  let blockHash: HexBytes32;
  let transactionHash: HexBytes32;
  let data: HexData;
  let topics: readonly HexBytes32[];
  let transactionIndex: string;
  let blockGlobalLogIndex: string;
  try {
    address = canonicalAddress(value.address);
    blockHash = canonicalBytes32(value.blockHash);
    transactionHash = canonicalBytes32(value.transactionHash);
    data = canonicalRawData(value.data);
    topics = Object.freeze(value.topics.map(canonicalBytes32));
    transactionIndex = canonicalUint32DecimalText(
      value.transactionIndex,
      "coverage-transaction-index",
    );
    blockGlobalLogIndex = canonicalUint32DecimalText(
      value.logIndex,
      "coverage-log-index",
    );
  } catch {
    throw validationError("rpc", "coverage-log");
  }
  const blockNumber = value.blockNumber.toString();
  const commitment = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint32" },
        { type: "uint32" },
        { type: "bytes32[]" },
        { type: "bytes" },
      ],
      [
        address,
        BigInt(blockNumber),
        blockHash,
        transactionHash,
        Number(transactionIndex),
        Number(blockGlobalLogIndex),
        [...topics],
        data,
      ],
    ),
  );
  return Object.freeze({
    address,
    blockNumber,
    blockHash,
    transactionHash,
    transactionIndex,
    blockGlobalLogIndex,
    topics,
    data,
    commitment,
  });
}

export function coverageLogPlacementKey(log: CanonicalCoverageLog): string {
  return `${log.blockNumber}:${log.blockGlobalLogIndex}`;
}
