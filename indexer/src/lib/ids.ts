export type CandidateOccurrenceIdentity = {
  chainId: number;
  blockHash: string;
  transactionHash: string;
  blockGlobalLogIndex: number;
};

export type DownstreamLogicalIdentity = {
  chainId: number;
  transactionHash: string;
  receiptLogOrdinal: number;
};

export function candidateOccurrenceId(
  identity: CandidateOccurrenceIdentity,
): string;
export function candidateOccurrenceId(
  chainId: number,
  blockHash: string,
  transactionHash: string,
  blockGlobalLogIndex: number,
): string;
export function candidateOccurrenceId(
  identityOrChainId: CandidateOccurrenceIdentity | number,
  blockHash?: string,
  transactionHash?: string,
  blockGlobalLogIndex?: number,
): string {
  const identity =
    typeof identityOrChainId === "number"
      ? {
          chainId: identityOrChainId,
          blockHash: blockHash ?? "",
          transactionHash: transactionHash ?? "",
          blockGlobalLogIndex: blockGlobalLogIndex ?? Number.NaN,
        }
      : identityOrChainId;

  assertNonNegativeInteger("chainId", identity.chainId);
  assertNonNegativeInteger(
    "block-global log index",
    identity.blockGlobalLogIndex,
  );
  assertHash("block hash", identity.blockHash);
  assertHash("transaction hash", identity.transactionHash);

  return [
    identity.chainId,
    identity.blockHash.toLowerCase(),
    identity.transactionHash.toLowerCase(),
    identity.blockGlobalLogIndex,
  ].join(":");
}

export function downstreamLogicalEventId(
  identity: DownstreamLogicalIdentity,
): string {
  return downstreamLogicalId(
    identity.chainId,
    identity.transactionHash,
    identity.receiptLogOrdinal,
  );
}

export function downstreamLogicalId(
  chainId: number,
  transactionHash: string,
  receiptLogOrdinal: number | undefined,
): string {
  assertNonNegativeInteger("chainId", chainId);
  if (receiptLogOrdinal === undefined) {
    throw new TypeError(
      "receipt-local ordinal must be supplied by the downstream verifier",
    );
  }
  assertNonNegativeInteger("receipt-local ordinal", receiptLogOrdinal);
  assertHash("transaction hash", transactionHash);

  return [chainId, transactionHash.toLowerCase(), receiptLogOrdinal].join(":");
}

export function launchEntityId(
  chainId: number,
  releaseVersion: string,
  launchHash: string,
): string {
  assertNonNegativeInteger("chainId", chainId);
  return `${chainId}:${releaseVersion}:${launchHash.toLowerCase()}`;
}

export function poolEntityId(chainId: number, poolId: string): string {
  assertNonNegativeInteger("chainId", chainId);
  return `${chainId}:${poolId.toLowerCase()}`;
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function assertHash(name: string, value: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a 32-byte hexadecimal value`);
  }
}
