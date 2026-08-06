export const PROTOCOL_REVENUE_GAS_LIMIT_BUFFER_BPS = 12_500n;
export const PROTOCOL_REVENUE_KEEPER_BALANCE_HEADROOM = 2n;
export const PROTOCOL_REVENUE_MIN_GAS_MULTIPLIER = 250n;
export const PROTOCOL_REVENUE_MAX_EXECUTION_GAS = 15_000_000n;
export const PROTOCOL_REVENUE_CLAIM_LEAD_TIME = 5n * 60n;

export type ProtocolRevenueV2ActionDecision =
  | Readonly<{ status: "pending_transaction" }>
  | Readonly<{ status: "process"; revenue: bigint }>
  | Readonly<{ status: "transfer"; amount: bigint }>
  | Readonly<{ status: "claim"; accruedRevenue: bigint }>
  | Readonly<{ status: "not_due"; nextRunAt: bigint }>
  | Readonly<{ status: "accounting_mismatch" }>
  | Readonly<{ status: "permission_exhausted" }>
  | Readonly<{ status: "below_minimum"; minimumRevenue: bigint }>;

export function evaluateProtocolRevenueV2Action(input: Readonly<{
  stateTimestamp: bigint;
  pendingRevenue: bigint;
  vaultNextRunAt: bigint;
  vaultMinimumRevenue: bigint;
  vaultMaximumRevenue: bigint;
  coordinatorTotalClaimed: bigint;
  vaultTotalRevenueDeposited: bigint;
  rewardWalletBalance: bigint;
  permissionAvailable: bigint;
  maximumTransfer: bigint;
  claimReady: boolean;
  claimAccruedRevenue: bigint;
  claimMinimumRevenue: bigint;
  latestNonce: number;
  pendingNonce: number;
}>): ProtocolRevenueV2ActionDecision {
  if (input.pendingNonce !== input.latestNonce) {
    return { status: "pending_transaction" };
  }
  if (input.vaultTotalRevenueDeposited > input.coordinatorTotalClaimed) {
    return { status: "accounting_mismatch" };
  }
  const untransferredClaims =
    input.coordinatorTotalClaimed - input.vaultTotalRevenueDeposited;
  if (
    input.pendingRevenue >= input.vaultMinimumRevenue &&
    input.stateTimestamp >= input.vaultNextRunAt
  ) {
    return { status: "process", revenue: input.pendingRevenue };
  }

  if (untransferredClaims >= input.vaultMinimumRevenue) {
    const remainingVaultCapacity = input.pendingRevenue < input.vaultMaximumRevenue
      ? input.vaultMaximumRevenue - input.pendingRevenue
      : 0n;
    if (
      input.rewardWalletBalance < untransferredClaims ||
      input.permissionAvailable < untransferredClaims ||
      input.maximumTransfer < untransferredClaims ||
      remainingVaultCapacity < untransferredClaims
    ) {
      return { status: "permission_exhausted" };
    }
    return { status: "transfer", amount: untransferredClaims };
  }

  if (
    input.claimReady &&
    input.claimAccruedRevenue >= input.claimMinimumRevenue &&
    input.stateTimestamp + PROTOCOL_REVENUE_CLAIM_LEAD_TIME >=
      input.vaultNextRunAt
  ) {
    return { status: "claim", accruedRevenue: input.claimAccruedRevenue };
  }

  if (input.pendingRevenue >= input.vaultMinimumRevenue) {
    return { status: "not_due", nextRunAt: input.vaultNextRunAt };
  }

  if (input.claimReady && input.claimAccruedRevenue >= input.claimMinimumRevenue) {
    const claimAt = input.vaultNextRunAt > PROTOCOL_REVENUE_CLAIM_LEAD_TIME
      ? input.vaultNextRunAt - PROTOCOL_REVENUE_CLAIM_LEAD_TIME
      : 0n;
    return { status: "not_due", nextRunAt: claimAt };
  }
  return {
    status: "below_minimum",
    minimumRevenue: input.vaultMinimumRevenue,
  };
}

export type ProtocolRevenueStateDecision =
  | Readonly<{ status: "ready" }>
  | Readonly<{ status: "delegation_missing" }>
  | Readonly<{ status: "not_due"; nextRunAt: bigint }>
  | Readonly<{ status: "below_minimum"; minimumRevenue: bigint }>
  | Readonly<{ status: "pending_transaction" }>;

export type ProtocolRevenueEconomicDecision =
  | Readonly<{
      status: "ready";
      gasLimit: bigint;
      maximumGasCost: bigint;
      keeperFunding: bigint;
    }>
  | Readonly<{ status: "gas_price_too_high"; maximumGasPrice: bigint }>
  | Readonly<{ status: "gas_estimate_too_high"; maximumGas: bigint }>
  | Readonly<{
      status: "uneconomic";
      minimumEconomicRevenue: bigint;
    }>
  | Readonly<{
      status: "keeper_balance_low";
      minimumKeeperBalance: bigint;
    }>;

const ZERO_HASH = `0x${"00".repeat(32)}`;

export function evaluateProtocolRevenueState(input: Readonly<{
  delegationHash: string;
  finalizedTimestamp: bigint;
  nextRunAt: bigint;
  availableRevenue: bigint;
  minimumRevenue: bigint;
  latestNonce: number;
  pendingNonce: number;
}>): ProtocolRevenueStateDecision {
  if (input.delegationHash.toLowerCase() === ZERO_HASH) {
    return { status: "delegation_missing" };
  }
  if (input.pendingNonce > input.latestNonce) {
    return { status: "pending_transaction" };
  }
  if (input.finalizedTimestamp < input.nextRunAt) {
    return { status: "not_due", nextRunAt: input.nextRunAt };
  }
  if (input.availableRevenue < input.minimumRevenue) {
    return {
      status: "below_minimum",
      minimumRevenue: input.minimumRevenue,
    };
  }
  return { status: "ready" };
}

function bufferedGasLimit(gasEstimate: bigint) {
  return (
    (gasEstimate * PROTOCOL_REVENUE_GAS_LIMIT_BUFFER_BPS + 9_999n) / 10_000n
  );
}

export function evaluateProtocolRevenueEconomics(input: Readonly<{
  availableRevenue: bigint;
  gasEstimate: bigint;
  maxFeePerGas: bigint;
  maximumGasPrice: bigint;
  minimumRevenueGasMultiplier: bigint;
  keeperBalance: bigint;
  keeperGasShareBps: bigint;
}>): ProtocolRevenueEconomicDecision {
  if (input.maxFeePerGas > input.maximumGasPrice) {
    return {
      status: "gas_price_too_high",
      maximumGasPrice: input.maximumGasPrice,
    };
  }

  const gasLimit = bufferedGasLimit(input.gasEstimate);
  if (gasLimit > PROTOCOL_REVENUE_MAX_EXECUTION_GAS) {
    return {
      status: "gas_estimate_too_high",
      maximumGas: PROTOCOL_REVENUE_MAX_EXECUTION_GAS,
    };
  }

  const maximumGasCost = gasLimit * input.maxFeePerGas;
  const minimumEconomicRevenue =
    maximumGasCost * input.minimumRevenueGasMultiplier;
  if (input.availableRevenue < minimumEconomicRevenue) {
    return { status: "uneconomic", minimumEconomicRevenue };
  }

  const minimumKeeperBalance =
    maximumGasCost * PROTOCOL_REVENUE_KEEPER_BALANCE_HEADROOM;
  if (input.keeperBalance < minimumKeeperBalance) {
    return { status: "keeper_balance_low", minimumKeeperBalance };
  }

  const keeperFunding =
    (input.availableRevenue * input.keeperGasShareBps) / 10_000n;
  if (keeperFunding < maximumGasCost) {
    return { status: "uneconomic", minimumEconomicRevenue };
  }

  return { status: "ready", gasLimit, maximumGasCost, keeperFunding };
}
