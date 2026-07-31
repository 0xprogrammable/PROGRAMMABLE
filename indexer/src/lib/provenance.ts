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
  transactionIndex: number;
  blockGlobalLogIndex: number;
  sourceAddress: string;
};

export function eventProvenance(event: EvmEvent): EventProvenance {
  const blockHash = event.block.hash.toLowerCase();
  const transactionHash = event.transaction.hash.toLowerCase();

  return {
    id: candidateOccurrenceId({
      chainId: event.chainId,
      blockHash,
      transactionHash,
      blockGlobalLogIndex: event.logIndex,
    }),
    downstreamLogicalId: undefined,
    receiptLogOrdinal: undefined,
    chainId: event.chainId,
    blockNumber: BigInt(event.block.number),
    blockHash,
    blockTimestamp: BigInt(event.block.timestamp),
    transactionHash,
    transactionIndex: event.transaction.transactionIndex,
    blockGlobalLogIndex: event.logIndex,
    sourceAddress: lowerAddress(event.srcAddress),
  };
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
