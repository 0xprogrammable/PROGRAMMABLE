import { collectOperationNames, objectAt } from "./submission-analysis-helpers.mjs";
import {
  requireDetailedText,
  validateDeltaComponentPolicy
} from "./settlement-policy-core.mjs";

export function analyzeSubmissionHookAccounting(context) {
  const { submission, add, gate, hook, hookUsed, permissions } = context;
  const customAccounting = objectAt(hook, "customAccounting");
  if (hookUsed !== false && typeof customAccounting.used !== "boolean") add("blocker", "CUSTOM_ACCOUNTING_USAGE_UNRESOLVED", "$.hook.customAccounting.used", "Custom accounting usage is unresolved.", "State whether the hook changes PoolManager deltas or settles value itself.");
  if (hookUsed !== false && customAccounting.used === true) {
    for (const field of ["backingSource", "conservationEquation", "settlement", "partialFillBehavior", "liabilityNamespace", "duplicateCurrencyPolicy", "failureIsolation", "withdrawalOrdering"]) requireDetailedText(customAccounting[field], `$.hook.customAccounting.${field}`, "CUSTOM_ACCOUNTING_INCOMPLETE", add);
    if (!Array.isArray(customAccounting.liabilityKeyDimensions)) add("blocker", "LIABILITY_KEY_DIMENSIONS_UNRESOLVED", "$.hook.customAccounting.liabilityKeyDimensions", "Custom-accounting liability keys are not structurally declared.", "List the exact dimensions used in every liability key.");
    if (typeof customAccounting.crossPoolNetting !== "boolean") add("blocker", "CROSS_POOL_NETTING_UNRESOLVED", "$.hook.customAccounting.crossPoolNetting", "Cross-pool netting must be explicit.", "Default to false and prove PoolId-scoped liabilities.");
    gate("delta-conservation-invariants", "prototype", "The hook uses custom accounting.");
    gate("specialist-accounting-review", "candidate", "The hook uses custom accounting.");
    if (hook.sharedAcrossPools === true) {
      if (customAccounting.crossPoolNetting !== false) add("blocker", "SHARED_ACCOUNTING_NETTING", "$.hook.customAccounting.crossPoolNetting", "Shared custom accounting cannot net liabilities across pools by default.", "Set crossPoolNetting to false and prove PoolId-scoped liabilities, duplicate-currency handling and failure isolation.");
      for (const dimension of ["poolId", "currency", "beneficiary"]) if (!(customAccounting.liabilityKeyDimensions ?? []).includes(dimension)) add("blocker", "SHARED_ACCOUNTING_KEY_INCOMPLETE", "$.hook.customAccounting.liabilityKeyDimensions", `Shared custom accounting omits ${dimension} from the liability key.`, "Key liabilities by PoolId, currency and beneficiary; an aggregate token balance is not pool isolation.");
      if (customAccounting.crossPoolNetting === false) add("warning", "SHARED_CUSTOM_ACCOUNTING", "$.hook.sharedAcrossPools", "Shared custom accounting carries correlated exposure even with PoolId-scoped liabilities.", "Prefer one hook instance per pool and retain cross-pool solvency invariants if sharing is required.");
      gate("cross-pool-solvency-invariants", "prototype", "Custom accounting is shared across pools.");
    }
  }

  const returnDeltaAccounting = objectAt(hook, "returnDeltaAccounting");
  const beforeSwapReturnDelta = permissions.beforeSwapReturnDelta === true;
  const anyReturnDelta = ["beforeSwapReturnDelta", "afterSwapReturnDelta", "afterAddLiquidityReturnDelta", "afterRemoveLiquidityReturnDelta"].some((name) => permissions[name] === true);
  if (hookUsed !== false && typeof returnDeltaAccounting.used !== "boolean") add("blocker", "RETURN_DELTA_USAGE_UNRESOLVED", "$.hook.returnDeltaAccounting.used", "Return-delta accounting usage is unresolved.", "Match this field to the enabled return-delta permission bits.");
  if (hookUsed !== false && returnDeltaAccounting.used !== beforeSwapReturnDelta) add("blocker", "RETURN_DELTA_USAGE_MISMATCH", "$.hook.returnDeltaAccounting.used", "The before-swap return-delta policy does not match beforeSwapReturnDelta.", "Enable this policy exactly when beforeSwapReturnDelta is enabled; use the post-action policies for other return-delta permissions.");
  if (hookUsed !== false && returnDeltaAccounting.used === true) {
    const expectedQuadrants = {
      zeroForOneExactInput: ["currency0", "currency1", "negative-exact-input", "zeroForOne-exactInput"],
      zeroForOneExactOutput: ["currency1", "currency0", "positive-exact-output", "zeroForOne-exactOutput"],
      oneForZeroExactInput: ["currency1", "currency0", "negative-exact-input", "oneForZero-exactInput"],
      oneForZeroExactOutput: ["currency0", "currency1", "positive-exact-output", "oneForZero-exactOutput"]
    };
    const quadrants = objectAt(returnDeltaAccounting, "quadrants");
    for (const [name, [specified, unspecified, sign, swapMode]] of Object.entries(expectedQuadrants)) {
      const quadrant = objectAt(quadrants, name);
      if (typeof quadrant.supported !== "boolean") add("blocker", "RETURN_DELTA_QUADRANT_UNRESOLVED", `$.hook.returnDeltaAccounting.quadrants.${name}.supported`, "Quadrant support must be explicit.", "State whether this path executes or reverts.");
      if (quadrant.specifiedCurrency !== specified || quadrant.unspecifiedCurrency !== unspecified || quadrant.amountSign !== sign) {
        add("blocker", "RETURN_DELTA_CURRENCY_MAPPING_INVALID", `$.hook.returnDeltaAccounting.quadrants.${name}`, "Specified currency, unspecified currency or amount sign does not match Uniswap v4 swap semantics.", `Use specified=${specified}, unspecified=${unspecified}, amountSign=${sign}.`);
      }
      if (quadrant.supported !== submission.integration?.swapModes?.includes(swapMode)) {
        add("blocker", "RETURN_DELTA_SWAP_MODE_MISMATCH", `$.hook.returnDeltaAccounting.quadrants.${name}.supported`, "Quadrant support disagrees with integration.swapModes.", "Keep router/UI support and hook accounting on the same four-quadrant matrix.");
      }
      if (quadrant.supported === true) {
        for (const field of ["rounding", "partialFillRule", "slippageInvariant", "failureRule"]) requireDetailedText(quadrant[field], `$.hook.returnDeltaAccounting.quadrants.${name}.${field}`, "RETURN_DELTA_QUADRANT_INCOMPLETE", add);
        validateDeltaComponentPolicy(quadrant.specifiedComponent, `$.hook.returnDeltaAccounting.quadrants.${name}.specifiedComponent`, "specified", add);
        validateDeltaComponentPolicy(quadrant.unspecifiedComponent, `$.hook.returnDeltaAccounting.quadrants.${name}.unspecifiedComponent`, "unspecified", add);
        if (quadrant.residualAmmEquation !== "amountSpecified-plus-specifiedDelta") add("blocker", "RETURN_DELTA_RESIDUAL_EQUATION_INVALID", `$.hook.returnDeltaAccounting.quadrants.${name}.residualAmmEquation`, "The residual AMM amount does not match the core equation.", "Use amountSpecified-plus-specifiedDelta and prove its signed bounds.");
        if (quadrant.finalCallerDeltaEquation !== "pool-manager-swap-delta-minus-hook-delta") add("blocker", "RETURN_DELTA_CALLER_EQUATION_INVALID", `$.hook.returnDeltaAccounting.quadrants.${name}.finalCallerDeltaEquation`, "The final caller delta does not match core accounting.", "Use pool-manager-swap-delta-minus-hook-delta and bind router slippage to the final result.");
        if (!["forbidden", "allowed-reviewed"].includes(quadrant.zeroAmmLeg)) add("blocker", "ZERO_AMM_POLICY_UNRESOLVED", `$.hook.returnDeltaAccounting.quadrants.${name}.zeroAmmLeg`, "A supported quadrant must forbid a zero AMM leg or use the separately reviewed custom-curve path.", "Choose forbidden or allowed-reviewed and keep the full-consumption declaration consistent.");
        if (quadrant.zeroAmmLeg === "forbidden" && quadrant.specifiedDeltaCanConsumeEntireAmount !== false) add("blocker", "ZERO_AMM_POLICY_CONTRADICTION", `$.hook.returnDeltaAccounting.quadrants.${name}.specifiedDeltaCanConsumeEntireAmount`, "The policy forbids a zero AMM leg but still allows the hook delta to consume the complete specified amount.", "Set this to false and enforce a nonzero residual bound, or choose the separately reviewed zero-AMM path.");
        if (quadrant.zeroAmmLeg === "allowed-reviewed" && quadrant.specifiedDeltaCanConsumeEntireAmount !== true) add("blocker", "ZERO_AMM_POLICY_CONTRADICTION", `$.hook.returnDeltaAccounting.quadrants.${name}.specifiedDeltaCanConsumeEntireAmount`, "The reviewed zero-AMM policy and full-consumption declaration disagree.", "Keep the structured declarations consistent and supply the custom-curve review path.");
        if (quadrant.zeroAmmLeg === "allowed-reviewed" && submission.capabilities?.customCurve?.used !== true) add("blocker", "ZERO_AMM_CUSTOM_CURVE_PROFILE_MISSING", `$.hook.returnDeltaAccounting.quadrants.${name}.zeroAmmLeg`, "A zero-AMM custom leg is enabled without the custom-curve invariant profile.", "Enable and complete capabilities.customCurve, differential tests and independent mathematical review.");
      } else if (quadrant.supported === false && (quadrant.zeroAmmLeg !== "not-applicable" || quadrant.specifiedComponent !== null || quadrant.unspecifiedComponent !== null)) {
        add("blocker", "UNSUPPORTED_QUADRANT_POLICY_CONFLICT", `$.hook.returnDeltaAccounting.quadrants.${name}`, "An unsupported quadrant must not declare an AMM-leg or settlement path.", "Use zeroAmmLeg not-applicable, no settlement actions, and reject the mode in the router and UI.");
      }
    }
    requireDetailedText(returnDeltaAccounting.executionEvent, "$.hook.returnDeltaAccounting.executionEvent", "RETURN_DELTA_EVENT_MISSING", add);
    gate("return-delta-execution-event", "prototype", "Core Swap events do not fully describe the custom leg.");
  }

  const postPolicies = objectAt(hook, "postReturnDeltaAccounting");
  for (const [policyName, permissionName, expectedShape] of [
    ["afterSwap", "afterSwapReturnDelta", "unspecified-currency-int128"],
    ["afterAddLiquidity", "afterAddLiquidityReturnDelta", "currency0-and-currency1-balance-delta"],
    ["afterRemoveLiquidity", "afterRemoveLiquidityReturnDelta", "currency0-and-currency1-balance-delta"]
  ]) {
    const policy = objectAt(postPolicies, policyName);
    const enabled = permissions[permissionName] === true;
    const basePath = `$.hook.postReturnDeltaAccounting.${policyName}`;
    if (hookUsed === false) continue;
    if (typeof policy.used !== "boolean") add("blocker", "POST_RETURN_DELTA_USAGE_UNRESOLVED", `${basePath}.used`, `${policyName} return-delta usage is unresolved.`, `Match this policy to ${permissionName}.`);
    if (policy.used !== enabled) add("blocker", "POST_RETURN_DELTA_USAGE_MISMATCH", `${basePath}.used`, `${policyName} policy does not match ${permissionName}.`, "Enable the policy and permission together or disable both.");
    if (policy.used === true) {
      if (policy.returnedDeltaShape !== expectedShape) add("blocker", "POST_RETURN_DELTA_SHAPE_INVALID", `${basePath}.returnedDeltaShape`, `${policyName} uses the wrong core return-delta shape.`, `Use ${expectedShape}.`);
      if (policy.positiveMeaning !== "hook-credit-caller-debit" || policy.negativeMeaning !== "hook-debt-caller-credit") add("blocker", "POST_RETURN_DELTA_SIGN_INVALID", basePath, "Positive and negative return-delta meanings do not match core accounting.", "Declare the hook-credit/caller-debit and hook-debt/caller-credit mapping.");
      if (policy.callerDeltaEquation !== "protocol-delta-minus-hook-delta") add("blocker", "POST_RETURN_DELTA_CALLER_EQUATION_INVALID", `${basePath}.callerDeltaEquation`, "The caller-delta equation does not match core accounting.", "Use protocol-delta-minus-hook-delta.");
      for (const field of ["backingSource", "bounds", "rounding", "slippageOrMinimums", "failureRule", "executionEvent"]) requireDetailedText(policy[field], `${basePath}.${field}`, "POST_RETURN_DELTA_POLICY_INCOMPLETE", add);
      const componentPolicies = objectAt(policy, "componentPolicies");
      if (policyName === "afterSwap") {
        validateDeltaComponentPolicy(componentPolicies.unspecified, `${basePath}.componentPolicies.unspecified`, "unspecified", add);
        if (componentPolicies.currency0 !== null || componentPolicies.currency1 !== null) add("blocker", "POST_RETURN_DELTA_COMPONENT_CONFLICT", `${basePath}.componentPolicies`, "afterSwap returns one unspecified-currency scalar, not independent currency0 and currency1 components.", "Define only the unspecified component policy.");
      } else {
        validateDeltaComponentPolicy(componentPolicies.currency0, `${basePath}.componentPolicies.currency0`, "currency0", add);
        validateDeltaComponentPolicy(componentPolicies.currency1, `${basePath}.componentPolicies.currency1`, "currency1", add);
        if (componentPolicies.unspecified !== null) add("blocker", "POST_RETURN_DELTA_COMPONENT_CONFLICT", `${basePath}.componentPolicies.unspecified`, "Liquidity callbacks return a BalanceDelta with currency0 and currency1 components, not an unspecified swap currency.", "Set unspecified to null and define both currency components.");
      }
      gate(`${policyName.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)}-return-delta-invariants`, "prototype", `${permissionName} is enabled.`);
    }
  }

  if (hookUsed !== false && anyReturnDelta && customAccounting.used !== true) add("blocker", "RETURN_DELTA_WITHOUT_ACCOUNTING_MODEL", "$.hook.customAccounting", "A return-delta permission is enabled without an explicit custom-accounting model.", "Define backing, conservation, settlement, caller deltas and partial-fill or liquidity-minimum behavior for that permission.");

  const claims = objectAt(hook, "erc6909Claims");
  if (hookUsed !== false && typeof claims.used !== "boolean") add("blocker", "ERC6909_USAGE_UNRESOLVED", "$.hook.erc6909Claims.used", "ERC-6909 claim usage is unresolved.", "State whether the hook mints, burns, transfers or redeems PoolManager claims.");
  if (hookUsed !== false && claims.used === true) {
    for (const field of ["owner", "operatorPolicy", "mintFlow", "burnFlow", "takeSettleFlow", "liabilityKeys", "transferPolicy", "redemption", "roundingDust", "aggregateSolvencyEquation"]) requireDetailedText(claims[field], `$.hook.erc6909Claims.${field}`, "ERC6909_POLICY_INCOMPLETE", add);
    if (claims.currencyIdDerivation !== "currency-address-uint160" || claims.claimBalanceScope !== "claim-owner-and-currency" || claims.poolIdIncludedInClaimId !== false) add("blocker", "ERC6909_ID_IS_NOT_POOLID", "$.hook.erc6909Claims", "PoolManager claim ids derive from the currency address and claim balances aggregate by owner and currency, not PoolId.", "Use the fixed currency-address rule and keep PoolId only in a separate internal liability ledger.");
    for (const dimension of ["poolId", "currency", "beneficiary"]) if (!(claims.liabilityKeyDimensions ?? []).includes(dimension)) add("blocker", "ERC6909_LIABILITY_KEY_INCOMPLETE", "$.hook.erc6909Claims.liabilityKeyDimensions", `ERC-6909 liabilities omit ${dimension}.`, "Key the internal ledger by PoolId, currency and beneficiary even though the PoolManager claim balance is aggregated.");
    if (claims.crossPoolNetting !== false) add("blocker", "ERC6909_CROSS_POOL_NETTING", "$.hook.erc6909Claims.crossPoolNetting", "PoolManager claim ids identify currency, not PoolId, so shared balances cannot be treated as pool-isolated.", "Set crossPoolNetting to false and maintain a separate PoolId and beneficiary liability ledger.");
    gate("erc6909-liability-solvency-invariants", "prototype", "The model uses PoolManager ERC-6909 claims.");
  }
  const claimActions = collectOperationNames(hook);
  if (hookUsed !== false && (claimActions.has("mint-claim") || claimActions.has("burn-claim")) && claims.used !== true) add("blocker", "ERC6909_ACTION_PROFILE_MISSING", "$.hook.erc6909Claims.used", "Settlement actions use PoolManager ERC-6909 claims while the claim ownership and solvency profile is disabled.", "Enable and complete the ERC-6909 profile or remove every mint-claim and burn-claim action.");

  const nestedActions = objectAt(hook, "nestedActions");
  if (hookUsed !== false && typeof nestedActions.used !== "boolean") add("blocker", "NESTED_ACTION_USAGE_UNRESOLVED", "$.hook.nestedActions.used", "Nested PoolManager or router action usage is unresolved.", "State whether callbacks initiate any direct or router-mediated action.");
  if (hookUsed !== false && nestedActions.used === true) {
    if (typeof nestedActions.directPoolManagerCalls !== "boolean" || typeof nestedActions.routerCalls !== "boolean") add("blocker", "NESTED_ACTION_PATH_UNRESOLVED", "$.hook.nestedActions", "Direct PoolManager and router-mediated nested paths must be distinguished.", "Declare each path and its callback behavior.");
    if (!Array.isArray(nestedActions.allowedActions) || nestedActions.allowedActions.length === 0) add("blocker", "NESTED_ACTIONS_UNRESOLVED", "$.hook.nestedActions.allowedActions", "Allowed nested actions are unresolved.", "List the exact PoolManager actions and pools.");
    if (nestedActions.directPoolManagerCalls !== true && nestedActions.routerCalls !== true) add("blocker", "NESTED_ACTION_PATH_MISSING", "$.hook.nestedActions", "Nested actions are enabled without a direct or router-mediated call path.", "Enable at least one exact path or set nestedActions.used to false.");
    if (nestedActions.directPoolManagerCalls === true && nestedActions.directCallbackBehavior !== "self-call-hook-callbacks-skipped") add("blocker", "DIRECT_NESTED_CALLBACK_MODEL_INVALID", "$.hook.nestedActions.directCallbackBehavior", "Direct hook-to-PoolManager actions skip callbacks to the same hook.", "Use the fixed self-call callback behavior and test state ordering around the skipped callback.");
    if (nestedActions.routerCalls === true && nestedActions.routerCallbackBehavior !== "hook-callbacks-can-reenter") add("blocker", "ROUTER_NESTED_CALLBACK_MODEL_INVALID", "$.hook.nestedActions.routerCallbackBehavior", "Router-mediated nested actions can re-enter the hook.", "Use the fixed router re-entry behavior and prove depth, state ordering and failure atomicity.");
    for (const field of ["samePoolPolicy", "crossPoolPolicy", "callbackSuppression", "stateCommitOrder", "transientDeltaOwner", "syncInterleaving", "slippageAggregation", "failureAtomicity"]) requireDetailedText(nestedActions[field], `$.hook.nestedActions.${field}`, "NESTED_ACTION_POLICY_INCOMPLETE", add);
    if (!Number.isInteger(nestedActions.maximumDepth)) add("blocker", "NESTED_ACTION_DEPTH_UNRESOLVED", "$.hook.nestedActions.maximumDepth", "Nested action depth is unbounded or unresolved.", "Set and enforce a small maximum depth.");
    gate("nested-action-reentrancy-tests", "prototype", "The hook initiates nested actions.");
  } else if (hookUsed !== false && nestedActions.used === false) {
    if (nestedActions.directPoolManagerCalls !== false || nestedActions.routerCalls !== false || (nestedActions.allowedActions?.length ?? 0) !== 0) add("blocker", "NESTED_ACTION_DISABLED_CONFLICT", "$.hook.nestedActions", "Nested actions are disabled but call paths or allowed actions remain declared.", "Set both call paths to false and allowedActions to an empty array, or fully enable and specify nested actions.");
  }

  if (hookUsed !== false && permissions.beforeSwapReturnDelta === true) {
    add("warning", "BEFORE_SWAP_RETURN_DELTA_CRITICAL", "$.hook.permissions.beforeSwapReturnDelta", "beforeSwapReturnDelta can bypass concentrated-liquidity swap math and create a no-op swap.", "Prove all four swap quadrants, backing, partial fills, slippage and zero-sum settlement with specialist review.");
    gate("before-swap-delta-four-quadrant-proof", "prototype", "beforeSwapReturnDelta is enabled.");
    gate("independent-specialist-review", "candidate", "beforeSwapReturnDelta is enabled.");
  }

  Object.assign(context, { customAccounting, anyReturnDelta, claims });
}
