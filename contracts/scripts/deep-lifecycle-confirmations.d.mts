export const DEEP_LIFECYCLE_MINIMUM_CONFIRMATIONS: 12n;

export function validateDeepLifecycleConfirmationDepth(input: {
  heads: bigint[];
  transactionBlocks: bigint[];
  minimumConfirmations?: bigint;
}): void;
