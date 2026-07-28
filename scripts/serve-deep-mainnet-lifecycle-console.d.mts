export type DeepLifecycleState = {
  launched: boolean;
  cardinality: number;
  cardinalityNext: number;
  creatorFeesAccrued: string;
  oracleReady: boolean;
};

export type DeepLifecycleEvidence = {
  transactions: {
    launch?: unknown;
    deploy_keeper_executor?: unknown;
    grow_oracle?: unknown;
    fee_process_compound?: unknown;
  };
};

export function oracleBatchRepeatCount(
  currentCardinalityNext: number,
  target?: number,
  step?: number,
): number;

export function reviewedKeeperExecutorSourceCommitment(): `0x${string}`;

export function predictKeeperExecutorAddress(
  deployer: `0x${string}`,
  nonce: bigint | number | string,
): `0x${string}`;

export function validateMinedTransactionEnvelope(
  transaction: {
    gas: bigint | number | string;
    value: bigint | number | string;
    maxFeePerGas?: bigint | number | string | null;
    maxPriorityFeePerGas?: bigint | number | string | null;
    gasPrice?: bigint | number | string | null;
  },
  preparedRequest: {
    gas: bigint | number | string;
    maxFeePerGas: bigint | number | string;
    maxPriorityFeePerGas: bigint | number | string;
  },
  preparedMaximumTotalDebitWei: bigint | number | string,
): {
  feeMode: "eip1559" | "legacy";
  minedGasLimit: string;
  minedFeeCeilingWei: string;
  maximumPossibleDebitWei: string;
  preparedMaximumTotalDebitWei: string;
};

export function validatePreparedRevalidation(input: {
  action:
    | "deploy_keeper_executor"
    | "launch"
    | "grow_oracle"
    | "fee_process_compound";
  prepared: {
    action: string;
    preparedDigest: string;
    request: {
      from: string;
      to?: string | null;
      nonce: bigint | number | string;
      value: bigint | number | string;
      data: string;
      gas: bigint | number | string;
      maxFeePerGas: bigint | number | string;
      maxPriorityFeePerGas: bigint | number | string;
    };
    reviewedGasLimit: bigint | number | string;
    reviewedMaxFeePerGasWei: bigint | number | string;
    reviewedMaxPriorityFeePerGasWei: bigint | number | string;
    maximumGasDebitWei: bigint | number | string;
    maximumTotalDebitWei: bigint | number | string;
    details: unknown;
  };
  state: {
    confirmedNonce: bigint | number | string;
    pendingNonce: bigint | number | string;
    balance: bigint | number | string;
    baseFeePerGas: bigint | number | string;
  };
  base: {
    to?: string | null;
    value: bigint | number | string;
    data: string;
    details: unknown;
  };
  simulations: Array<{
    resultHash: string;
    estimatedGas: bigint | number | string;
  }>;
}): {
  action: string;
  preparedDigest: string;
  liveEstimatedGas: string;
  maximumTotalDebitWei: string;
};

export function decideLifecycleAction(
  state: DeepLifecycleState,
  evidence: DeepLifecycleEvidence,
):
  | "launch"
  | "grow_oracle"
  | "wait_twap"
  | "fee_process_compound"
  | "complete";
