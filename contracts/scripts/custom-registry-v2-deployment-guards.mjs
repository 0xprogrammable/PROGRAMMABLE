export function requireDistinctRpcOrigins(first, second) {
  const origins = [first, second].map((value) => new URL(value).origin.toLowerCase());
  if (origins[0] === origins[1]) throw new Error("preflight RPC origins must be distinct");
  return origins;
}

export function assessDeploymentCost({
  gasLimit,
  blockGasLimit,
  observedFeePerGas,
  maxFeePerGas,
  maxTotalCostWei,
  deployerBalance,
}) {
  for (const value of [gasLimit, blockGasLimit, observedFeePerGas, maxFeePerGas, maxTotalCostWei, deployerBalance]) {
    if (typeof value !== "bigint" || value < 0n) throw new TypeError("deployment cost input is invalid");
  }
  if (gasLimit >= blockGasLimit) throw new Error("deployment gas limit does not fit the current block gas limit");
  if (observedFeePerGas > maxFeePerGas) throw new Error("deployment fee per gas exceeds the reviewed ceiling");
  const maximumCostWei = gasLimit * maxFeePerGas;
  if (maximumCostWei > maxTotalCostWei) throw new Error("deployment maximum cost exceeds the reviewed ceiling");
  if (deployerBalance < maximumCostWei) throw new Error("deployer balance is insufficient for the reviewed maximum cost");
  return maximumCostWei;
}
