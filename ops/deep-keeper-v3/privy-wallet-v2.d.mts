export function createPrivyDeepV3KeeperV2Wallet(input: {
  client: unknown;
  walletId: string;
  signerAddress: `0x${string}`;
  executorAddress: `0x${string}`;
  chainId: number;
  now?: () => number;
}): {
  readonly supportsStableIdempotency: true;
  submitBatch(input: {
    candidates: readonly {
      vault: `0x${string}`;
      action: 1 | 2;
    }[];
    gas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    expectedNonce: bigint;
    requestExpiryMs: number;
    idempotencyKey: string;
    referenceId: string;
    abi: readonly unknown[];
  }): Promise<{
    transactionHash: `0x${string}`;
    transactionId: string | null;
    nonce: bigint;
    referenceId: string;
  }>;
};
