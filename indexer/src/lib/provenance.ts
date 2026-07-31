import type { EvmEvent } from "envio";

import { candidateOccurrenceId } from "./ids.js";

export type EventProvenance = {
  id: string;
  downstreamLogicalId: undefined;
  receiptLogOrdinal: undefined;
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  blockTimestamp: bigint;
  transactionHash: string;
  transactionIndex: bigint;
  blockGlobalLogIndex: bigint;
  sourceAddress: string;
};

export function eventProvenance(event: EvmEvent): EventProvenance {
  const blockHash = event.block.hash.toLowerCase();
  const transactionHash = event.transaction.hash.toLowerCase();
  const transactionIndex = uint32Number(
    event.transaction.transactionIndex,
    "transaction index",
  );
  const blockGlobalLogIndex = uint32Number(
    event.logIndex,
    "block-global log index",
  );

  return {
    id: candidateOccurrenceId({
      chainId: event.chainId,
      blockHash,
      transactionHash,
      blockGlobalLogIndex,
    }),
    downstreamLogicalId: undefined,
    receiptLogOrdinal: undefined,
    chainId: event.chainId,
    blockNumber: BigInt(event.block.number),
    blockHash,
    blockTimestamp: BigInt(event.block.timestamp),
    transactionHash,
    transactionIndex: BigInt(transactionIndex),
    blockGlobalLogIndex: BigInt(blockGlobalLogIndex),
    sourceAddress: lowerAddress(event.srcAddress),
  };
}

function uint32Number(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer`);
  }
  return value;
}

export function lower(value: string): string {
  return value.toLowerCase();
}

export function lowerAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError("address must be a 20-byte hexadecimal value");
  }
  return value.toLowerCase();
}
