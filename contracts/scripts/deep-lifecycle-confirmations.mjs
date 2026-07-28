export const DEEP_LIFECYCLE_MINIMUM_CONFIRMATIONS = 12n;

export function validateDeepLifecycleConfirmationDepth({
  heads,
  transactionBlocks,
  minimumConfirmations = DEEP_LIFECYCLE_MINIMUM_CONFIRMATIONS,
}) {
  if (
    !Array.isArray(heads) ||
    heads.length !== 2 ||
    heads.some((head) => typeof head !== "bigint" || head < 0n)
  ) {
    throw new Error(
      "Deep final lifecycle requires exactly two valid RPC heads",
    );
  }
  if (
    !Array.isArray(transactionBlocks) ||
    transactionBlocks.length === 0 ||
    transactionBlocks.some(
      (blockNumber) => typeof blockNumber !== "bigint" || blockNumber <= 0n,
    )
  ) {
    throw new Error("Deep final lifecycle transaction blocks are malformed");
  }
  if (typeof minimumConfirmations !== "bigint" || minimumConfirmations <= 0n) {
    throw new Error("Deep final lifecycle confirmation policy is malformed");
  }

  const finalTransactionBlock = transactionBlocks.reduce(
    (highest, blockNumber) => (blockNumber > highest ? blockNumber : highest),
    0n,
  );
  const requiredHead = finalTransactionBlock + minimumConfirmations;
  for (const [index, head] of heads.entries()) {
    if (head < requiredHead) {
      throw new Error(
        `Deep final lifecycle RPC ${index + 1} is inside the ${minimumConfirmations}-block confirmation window`,
      );
    }
  }
}
