import { assertExactKeys } from "./io.mjs";

export const ROBINHOOD_FUNDING_PLAN_SCHEMA_V1 = "programmable.robinhood-funding-plan.v1";
export const ROBINHOOD_FUNDING_ALLOCATION_KEYS_V1 = Object.freeze([
  "initialLiquidityWei", "initialBuyWei", "reserveWei", "otherLaunchValueWei",
]);
const UINT256 = /^(?:0|[1-9][0-9]*)$/u;
const UINT256_LIMIT = 1n << 256n;

function nativeUint(value, label) {
  if (typeof value !== "string" || value.length > 78 || !UINT256.test(value)
    || BigInt(value) >= UINT256_LIMIT) {
    throw new TypeError(`${label} must be a canonical uint256 decimal string`);
  }
  return value;
}

/** Reviewed native budgets are declarations, never proof of available funds. */
export function normalizeRobinhoodFundingPlanV1(value, funding) {
  assertExactKeys(value, ["schemaVersion", "capitalSource", "pricingModel", "nativeAllocations",
    "maxLaunchValueWei", "maxGasCostWei", "launchMode"], "fundingPlan");
  if (value.schemaVersion !== ROBINHOOD_FUNDING_PLAN_SCHEMA_V1
    || !["buyer-funded", "creator-funded", "hybrid", "custom"].includes(value.capitalSource)
    || !["concentrated-liquidity", "custom-curve", "auction", "custom"].includes(value.pricingModel)
    || !["fund-and-launch", "build-only"].includes(value.launchMode)) {
    throw new TypeError("fundingPlan must name an exact supported declaration and launch mode");
  }
  assertExactKeys(value.nativeAllocations, ROBINHOOD_FUNDING_ALLOCATION_KEYS_V1, "fundingPlan.nativeAllocations");
  const nativeAllocations = Object.fromEntries(ROBINHOOD_FUNDING_ALLOCATION_KEYS_V1.map((key) =>
    [key, nativeUint(value.nativeAllocations[key], `fundingPlan.nativeAllocations.${key}`)]));
  const total = Object.values(nativeAllocations).reduce((sum, amount) => sum + BigInt(amount), 0n);
  const maxLaunchValueWei = nativeUint(value.maxLaunchValueWei, "fundingPlan.maxLaunchValueWei");
  const maxGasCostWei = nativeUint(value.maxGasCostWei, "fundingPlan.maxGasCostWei");
  const valueWei = nativeUint(funding?.valueWei, "funding.valueWei");
  if (total >= UINT256_LIMIT || total !== BigInt(valueWei)) {
    throw new TypeError("fundingPlan native allocations must sum exactly to funding.valueWei without uint256 overflow");
  }
  if (total > BigInt(maxLaunchValueWei)) {
    throw new TypeError("funding.valueWei exceeds the reviewed fundingPlan.maxLaunchValueWei");
  }
  if (value.launchMode === "fund-and-launch" && maxGasCostWei === "0") {
    throw new TypeError("fund-and-launch requires a positive maxGasCostWei; zero native launch value does not mean zero gas");
  }
  return { schemaVersion: ROBINHOOD_FUNDING_PLAN_SCHEMA_V1, capitalSource: value.capitalSource,
    pricingModel: value.pricingModel, nativeAllocations, maxLaunchValueWei, maxGasCostWei,
    launchMode: value.launchMode };
}

export function assertRobinhoodFundingPlanDeployableV1(value, funding) {
  const plan = normalizeRobinhoodFundingPlanV1(value, funding);
  if (plan.launchMode === "build-only") {
    const error = new TypeError("FUNDING_PLAN_BUILD_ONLY: This request is for local build and preflight only. Confirm a fund-and-launch plan with the user, set a positive gas budget, and repack before submitting.");
    error.code = "FUNDING_PLAN_BUILD_ONLY";
    throw error;
  }
  return plan;
}
