export const MAINNET_CANARY_MAX_GAS_PRICE_WEI = 500_000_000n;

export const MAINNET_CANARY_GAS_LIMITS = Object.freeze({
  launch: 4_500_000n,
  buy: 250_000n,
  "token-approval": 100_000n,
  "router-approval": 80_000n,
  sell: 250_000n,
  "creator-claim": 100_000n,
  "launcher-claim": 150_000n,
});

const CANARY_SEQUENCE = [
  "launch",
  "buy",
  "token-approval",
  "router-approval",
  "sell",
  "creator-claim",
  "launcher-claim",
];

export function prepareMainnetCanaryGas({
  actionId,
  estimatedGas,
  quotedGasPriceWei,
  valueWei,
  balanceWei,
}) {
  const reviewedGasLimit = MAINNET_CANARY_GAS_LIMITS[actionId];
  if (!reviewedGasLimit) {
    throw new Error(`No reviewed Mainnet gas limit exists for ${actionId}`);
  }

  const paddedGasLimit = (BigInt(estimatedGas) * 120n + 99n) / 100n;
  if (paddedGasLimit > reviewedGasLimit) {
    throw new Error(
      `${actionId} needs more gas than the reviewed Mainnet limit`,
    );
  }

  const paddedGasPrice =
    (BigInt(quotedGasPriceWei) * 125n + 99n) / 100n;
  if (paddedGasPrice > MAINNET_CANARY_MAX_GAS_PRICE_WEI) {
    throw new Error(
      "Current Mainnet gas is above the reviewed canary ceiling",
    );
  }

  const maximumCostWei =
    reviewedGasLimit * MAINNET_CANARY_MAX_GAS_PRICE_WEI +
    BigInt(valueWei);
  if (BigInt(balanceWei) < maximumCostWei) {
    throw new Error(
      "The wallet balance is below the reviewed transaction ceiling",
    );
  }

  return {
    gasLimit: paddedGasLimit,
    gasPriceWei: paddedGasPrice,
    reviewedGasLimit,
    maximumCostWei,
  };
}

export function shouldPrepareMainnetCanaryBuy(evidence) {
  return !evidence?.transactions?.buy;
}

export function maximumMainnetCanaryOutflowWei(
  initialBuyWei,
  separateBuyWei,
) {
  const reviewedGas = CANARY_SEQUENCE.reduce(
    (total, actionId) => total + MAINNET_CANARY_GAS_LIMITS[actionId],
    0n,
  );
  return (
    reviewedGas * MAINNET_CANARY_MAX_GAS_PRICE_WEI +
    BigInt(initialBuyWei) +
    BigInt(separateBuyWei)
  );
}
