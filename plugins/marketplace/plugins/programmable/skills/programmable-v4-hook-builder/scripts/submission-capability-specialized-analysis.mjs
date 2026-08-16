import { objectAt } from "./submission-analysis-helpers.mjs";
import {
  requireCapabilityMatch,
  requireDetailedText,
  requirePresent
} from "./settlement-policy-core.mjs";

export function analyzeSubmissionSpecializedCapabilities(context) {
  const {
    submission,
    add,
    gate,
    capabilityProfiles,
    assets,
    model,
    customAccounting
  } = context;
  const externalLiquidity = objectAt(capabilityProfiles, "externalLiquidity");
  const externalLiquidityExpected = (submission.risk?.dimensions?.externalLiquidity ?? 0) > 0 || assets.some((asset) => ["vault-share", "external-wrapper"].includes(asset?.origin)) || /\b(?:vault|external liquidity|hook-held liquidity|inventory|collateral)\b/i.test(`${model.summary ?? ""} ${customAccounting.backingSource ?? ""}`);
  requireCapabilityMatch(externalLiquidity.used, externalLiquidityExpected, "externalLiquidity", "EXTERNAL_LIQUIDITY_PROFILE_MISMATCH", add);
  if (externalLiquidity.used === true) {
    for (const field of ["custody", "ownership", "shareAccounting", "solvencyEquation", "lossAllocation", "donationPolicy", "exitPath", "dependencyFailure"]) requireDetailedText(externalLiquidity[field], `$.capabilities.externalLiquidity.${field}`, "EXTERNAL_LIQUIDITY_POLICY_INCOMPLETE", add);
    gate("external-liquidity-solvency-and-exit-invariants", "prototype", "The model holds or depends on liquidity outside the canonical pool accounting.");
    gate("independent-custody-and-solvency-review", "candidate", "The model holds or depends on external liquidity.");
  }

  const asyncSwap = objectAt(capabilityProfiles, "asyncSwap");
  const asyncExpected = /\b(?:async|asynchronous|queued swap|deferred fill|order queue)\b/i.test(`${model.summary ?? ""} ${model.whyV4 ?? ""}`);
  requireCapabilityMatch(asyncSwap.used, asyncExpected, "asyncSwap", "ASYNC_SWAP_PROFILE_MISMATCH", add);
  if (asyncSwap.used === true) {
    for (const field of ["supportedExactness", "custody", "fillRule", "partialFillRule", "cancellation", "expiry", "refund", "queueBound", "liveness", "failureRule"]) requirePresent(asyncSwap[field], `$.capabilities.asyncSwap.${field}`, "ASYNC_SWAP_POLICY_INCOMPLETE", "Define custody, fills, cancellation, bounded queues, expiry, refunds and failure behavior.", add);
    gate("async-custody-fill-and-liveness-invariants", "prototype", "The model defers swap execution or settlement.");
    gate("independent-async-accounting-review", "candidate", "The model defers swap execution or settlement.");
  }

  const customCurve = objectAt(capabilityProfiles, "customCurve");
  const customCurveExpected = /\b(?:custom curve|constant sum|bonding curve|weighted curve|custom pricing)\b/i.test(`${model.summary ?? ""} ${model.whyV4 ?? ""}`);
  requireCapabilityMatch(customCurve.used, customCurveExpected, "customCurve", "CUSTOM_CURVE_PROFILE_MISMATCH", add);
  if (customCurve.used === true) {
    for (const field of ["invariant", "domain", "rounding", "monotonicity", "discontinuities", "inverse", "differentialReference", "failureRule"]) requireDetailedText(customCurve[field], `$.capabilities.customCurve.${field}`, "CUSTOM_CURVE_POLICY_INCOMPLETE", add);
    gate("custom-curve-differential-and-invariant-tests", "prototype", "The model changes pricing math.");
    gate("independent-mathematical-review", "candidate", "The model changes pricing math.");
  }

}
