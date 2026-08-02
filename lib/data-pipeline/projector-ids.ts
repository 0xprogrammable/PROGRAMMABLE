import "server-only";

import { keccak256, toBytes } from "viem";

export function deterministicProjectorUuid(
  domain: string,
  ...values: readonly string[]
): string {
  const digest = keccak256(
    toBytes(`programmable:${domain}:v1\0${values.join("\0")}`),
  )
    .slice(2, 34)
    .split("");
  digest[12] = "8";
  digest[16] = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function projectorOccurrenceUuid(input: Readonly<{
  transactionHash: string;
  receiptLogOrdinal: string;
  blockHash: string;
}>): string {
  const logicalEventId = deterministicProjectorUuid(
    "logical-event",
    "1",
    input.transactionHash,
    input.receiptLogOrdinal,
  );
  return deterministicProjectorUuid(
    "occurrence",
    logicalEventId,
    input.blockHash,
  );
}
