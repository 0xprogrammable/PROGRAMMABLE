export function createPrivyKeeperWallet(input: {
  client: unknown;
  walletId: string;
  signerAddress: string;
  coordinatorAddress: string;
  chainId?: number;
  now?: () => number;
}): {
  writeContract(input: Record<string, unknown>): Promise<`0x${string}`>;
};
