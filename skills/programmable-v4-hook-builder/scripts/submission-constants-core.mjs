export const REPORT_VERSION = 3;
export const STANDARD_VERSION = "1.6.0";
export const PROGRAMMABLE_FEE_POLICY_ID = "programmable-volume-fee-v1";
export const PROGRAMMABLE_FEE_POLICY_VERSION = "1.1.0";
export const PROGRAMMABLE_FEE_OWNER = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP = 1000;
export const PROGRAMMABLE_FEE_MAX_SELECTED_HUNDREDTHS_OF_BIP = 100000;
export const PROGRAMMABLE_LAUNCH_CHAIN_ID = 1;
export const UINT128_MAX = 340282366920938463463374607431768211455n;
export const KNOWN_EVM_NETWORKS = Object.freeze({
  1: "ethereum",
  130: "unichain",
  8453: "base",
  11155111: "sepolia"
});

export const PERMISSION_BITS = Object.freeze({
  beforeInitialize: 0x2000,
  afterInitialize: 0x1000,
  beforeAddLiquidity: 0x0800,
  afterAddLiquidity: 0x0400,
  beforeRemoveLiquidity: 0x0200,
  afterRemoveLiquidity: 0x0100,
  beforeSwap: 0x0080,
  afterSwap: 0x0040,
  beforeDonate: 0x0020,
  afterDonate: 0x0010,
  beforeSwapReturnDelta: 0x0008,
  afterSwapReturnDelta: 0x0004,
  afterAddLiquidityReturnDelta: 0x0002,
  afterRemoveLiquidityReturnDelta: 0x0001
});

export const RISK_DIMENSION_MAX = Object.freeze({
  complexity: 5,
  customMath: 5,
  externalDependencies: 3,
  externalLiquidity: 3,
  valueAtRisk: 5,
  teamMaturity: 3,
  upgradeability: 3,
  autonomy: 3,
  priceImpact: 3
});

export const severityOrder = Object.freeze({ hard: 0, blocker: 1, warning: 2 });
export const implementationOnlyFindingCodes = new Set([
  "PROGRAMMABLE_FEE_INTEGRATION_PENDING"
]);
