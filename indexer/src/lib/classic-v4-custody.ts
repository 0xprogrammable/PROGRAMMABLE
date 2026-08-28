export type ClassicV4CustodyEvidence = Readonly<{
  mode: number;
  durationDays: number;
  cliffDays: number;
  custody: string;
  token: string;
  deployer: string;
  configurationHash: string;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  transactionIndex: bigint;
  blockGlobalLogIndex: bigint;
}>;

export type ClassicV4VestingEvidence = Readonly<{
  wallet: string;
  token: string;
  beneficiary: string;
  configurationHash: string;
  sourceAddress: string;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  transactionIndex: bigint;
  blockGlobalLogIndex: bigint;
}>;

export type ClassicV4CustodyVerification = Readonly<{
  complete: boolean;
  conflict: boolean;
  matchingWalletIndex?: number;
}>;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function sameValue(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function verifyClassicV4CustodyEvidence(
  custody: ClassicV4CustodyEvidence,
  wallets: readonly ClassicV4VestingEvidence[],
  vestingFactory: string,
): ClassicV4CustodyVerification {
  if (custody.mode === 0) {
    const complete =
      sameValue(custody.custody, ZERO_ADDRESS) &&
      custody.durationDays === 0 &&
      custody.cliffDays === 0 &&
      wallets.length === 0;
    return { complete, conflict: !complete };
  }

  const scheduleValid =
    custody.mode >= 1 &&
    custody.mode <= 3 &&
    custody.durationDays >= (custody.mode === 3 ? 2 : 1) &&
    custody.durationDays <= 3_650 &&
    (custody.mode === 3
      ? custody.cliffDays >= 1 && custody.cliffDays < custody.durationDays
      : custody.cliffDays === 0) &&
    !sameValue(custody.custody, ZERO_ADDRESS);
  if (!scheduleValid) {
    return { complete: false, conflict: true };
  }
  if (wallets.length === 0) {
    return { complete: false, conflict: false };
  }

  const matchingWalletIndexes = wallets.flatMap((wallet, index) =>
    sameValue(wallet.wallet, custody.custody) &&
      sameValue(wallet.token, custody.token) &&
      sameValue(wallet.beneficiary, custody.deployer) &&
      sameValue(wallet.configurationHash, custody.configurationHash) &&
      sameValue(wallet.sourceAddress, vestingFactory) &&
      wallet.blockNumber === custody.blockNumber &&
      sameValue(wallet.blockHash, custody.blockHash) &&
      sameValue(wallet.transactionHash, custody.transactionHash) &&
      wallet.transactionIndex === custody.transactionIndex &&
      wallet.blockGlobalLogIndex < custody.blockGlobalLogIndex
      ? [index]
      : []
  );
  return matchingWalletIndexes.length === 1 && wallets.length === 1
    ? {
        complete: true,
        conflict: false,
        matchingWalletIndex: matchingWalletIndexes[0],
      }
    : { complete: false, conflict: true };
}
