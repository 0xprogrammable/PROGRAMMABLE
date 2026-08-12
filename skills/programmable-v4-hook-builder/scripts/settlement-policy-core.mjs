import { resolvedText } from "./submission-analysis-helpers.mjs";
import { isObject } from "./submission-value-core.mjs";

export function requireResolvedText(value, path, code, add) {
  if (!resolvedText(value)) add("blocker", code, path, "Required design text is missing or contains a placeholder.", "Replace the placeholder with a specific, testable statement.");
}

export function requireDetailedText(value, path, code, add) {
  if (!resolvedText(value) || value.trim().length < 12) add("blocker", code, path, "Required design text is missing, vague or contains a placeholder.", "Replace it with a specific, testable statement of at least one complete phrase.");
}

export function validateDeltaComponentPolicy(policy, path, currency, add) {
  if (!isObject(policy)) {
    add("blocker", "RETURN_DELTA_COMPONENT_POLICY_MISSING", path, `The ${currency} return-delta component has no signed range and cancellation policy.`, "Declare zero-only, positive-only, negative-only or signed-bounded behavior and its exact settlement actions.");
    return;
  }
  const positiveActions = policy.positiveSettlementActions ?? [];
  const negativeActions = policy.negativeSettlementActions ?? [];
  if (policy.mode === "zero-only") {
    if (policy.formula !== null || policy.minimum !== "0" || policy.maximum !== "0" || policy.minimumSign !== "zero" || policy.maximumSign !== "zero" || positiveActions.length !== 0 || negativeActions.length !== 0) add("blocker", "RETURN_DELTA_ZERO_COMPONENT_CONFLICT", path, "A zero-only component must have exact zero bounds and no settlement path.", "Use formula null, exact zero bounds, zero sign declarations and empty action arrays.");
    return;
  }
  for (const field of ["formula", "minimum", "maximum"]) requireDetailedText(policy[field], `${path}.${field}`, "RETURN_DELTA_COMPONENT_RANGE_INCOMPLETE", add);
  const permittedSigns = {
    "positive-only": { minimum: ["zero", "positive"], maximum: ["positive"] },
    "negative-only": { minimum: ["negative"], maximum: ["negative", "zero"] },
    "signed-bounded": { minimum: ["negative", "zero"], maximum: ["zero", "positive"] }
  }[policy.mode];
  if (!permittedSigns?.minimum.includes(policy.minimumSign) || !permittedSigns?.maximum.includes(policy.maximumSign)) add("blocker", "RETURN_DELTA_COMPONENT_SIGN_RANGE_INVALID", path, "The structured bound signs contradict the selected return-delta component mode.", "Use a nonnegative range for positive-only, a nonpositive range for negative-only, or an ordered negative-to-positive range for signed-bounded.");
  if (policy.mode === "signed-bounded" && policy.minimumSign === "zero" && policy.maximumSign === "zero") add("blocker", "RETURN_DELTA_COMPONENT_SIGN_RANGE_INVALID", path, "A signed-bounded component cannot collapse to an exact zero range.", "Use zero-only, or declare at least one reachable negative or positive bound.");
  if (["positive-only", "signed-bounded"].includes(policy.mode)) validateSettlementActions(positiveActions, `${path}.positiveSettlementActions`, add, { expectedEffect: "negative", allowedCurrencies: [currency] });
  else if (positiveActions.length !== 0) add("blocker", "RETURN_DELTA_COMPONENT_SIGN_CONFLICT", `${path}.positiveSettlementActions`, "This component cannot be positive but declares a positive cancellation path.", "Remove the actions or select a mode that permits positive values.");
  if (["negative-only", "signed-bounded"].includes(policy.mode)) validateSettlementActions(negativeActions, `${path}.negativeSettlementActions`, add, { expectedEffect: "positive", allowedCurrencies: [currency] });
  else if (negativeActions.length !== 0) add("blocker", "RETURN_DELTA_COMPONENT_SIGN_CONFLICT", `${path}.negativeSettlementActions`, "This component cannot be negative but declares a negative cancellation path.", "Remove the actions or select a mode that permits negative values.");
}

export function validateSettlementActions(actions, path, add, { expectedEffect = null, allowedCurrencies = null } = {}) {
  if (!Array.isArray(actions) || actions.length === 0) {
    add("blocker", "RETURN_DELTA_SETTLEMENT_MISSING", path, "No action creates the opposing hook delta required before unlock ends.", "List the exact PoolManager accounting actions, actors, currencies, delta owners and completion deadlines.");
    return;
  }
  const ordered = [...actions].sort((left, right) => (left?.order ?? 0) - (right?.order ?? 0));
  const seenOrders = new Set();
  let hasAccountingAction = false;
  let hasExpectedEffect = expectedEffect === null;
  const operationEffects = {
    sync: "none",
    "transfer-to-pool-manager": "none",
    settle: "positive",
    "settle-for": "positive",
    take: "negative",
    "mint-claim": "negative",
    "burn-claim": "positive",
    "clear-reviewed-dust": "negative",
    "internal-ledger-update": "none"
  };
  for (const [index, action] of ordered.entries()) {
    const actionPath = `${path}[${index}]`;
    if (!Number.isInteger(action?.order) || action.order !== index + 1 || seenOrders.has(action.order)) add("blocker", "SETTLEMENT_ACTION_ORDER_INVALID", `${actionPath}.order`, "Settlement actions need unique contiguous order values beginning at one.", "Renumber the exact execution sequence without gaps or duplicates.");
    seenOrders.add(action?.order);
    if (!resolvedText(action?.amountRule) || action.amountRule.trim().length < 12) add("blocker", "SETTLEMENT_ACTION_AMOUNT_UNRESOLVED", `${actionPath}.amountRule`, "The accounting action has no testable amount rule.", "Bind the amount to an actual returned delta, balance, request or bounded formula.");
    if (allowedCurrencies && !allowedCurrencies.includes(action?.currency)) add("blocker", "SETTLEMENT_ACTION_CURRENCY_INVALID", `${actionPath}.currency`, "The settlement action uses a currency component that this callback cannot return.", `Use only ${allowedCurrencies.join(" or ")} for this return-delta path.`);
    const requiredEffect = operationEffects[action?.operation];
    if (requiredEffect && action?.deltaEffect !== requiredEffect) add("blocker", "SETTLEMENT_ACTION_EFFECT_INVALID", `${actionPath}.deltaEffect`, `${action?.operation} has a fixed PoolManager delta direction.`, `Use deltaEffect ${requiredEffect} and reconcile it with the returned hook delta.`);
    if (expectedEffect && action?.deltaEffect === expectedEffect && ["take", "mint-claim", "burn-claim", "settle", "settle-for"].includes(action?.operation)) hasExpectedEffect = true;
    if (action?.deltaOwner !== "hook") add("blocker", "RETURN_DELTA_OWNER_INVALID", `${actionPath}.deltaOwner`, "A hook return delta must be cancelled against the hook's own PoolManager delta.", "Set deltaOwner to hook; model value recipients separately through the action counterparty and internal liabilities.");
    if (action?.actor === "hook" && action?.operation !== "settle-for" && action?.deltaOwner !== "hook") add("blocker", "HOOK_ACTION_OWNER_INVALID", `${actionPath}.deltaOwner`, "A direct hook accounting action changes the hook's own delta.", "Use hook as the delta owner or specify a valid settle-for recipient.");
    if (["sync", "internal-ledger-update"].includes(action?.operation) && action?.counterparty !== "not-applicable") add("blocker", "SETTLEMENT_COUNTERPARTY_INVALID", `${actionPath}.counterparty`, "This action has no transfer recipient or source address.", "Use not-applicable for the counterparty.");
    if (["transfer-to-pool-manager", "settle"].includes(action?.operation) && action?.counterparty !== "PoolManager") add("blocker", "SETTLEMENT_COUNTERPARTY_INVALID", `${actionPath}.counterparty`, "This action transfers value to or accounts value at PoolManager.", "Use PoolManager as counterparty.");
    if (["take", "mint-claim", "burn-claim", "settle-for"].includes(action?.operation) && action?.counterparty === "not-applicable") add("blocker", "SETTLEMENT_COUNTERPARTY_MISSING", `${actionPath}.counterparty`, "This action changes custody or another account and needs an exact bound counterparty.", "Bind the recipient, claim owner, burn source or settle-for recipient to a declared actor or beneficiary.");
    if (action?.operation === "settle" && action?.actor !== action?.deltaOwner) add("blocker", "SETTLE_ACTOR_OWNER_MISMATCH", actionPath, "PoolManager settle credits the caller, so the actor must be the delta owner being settled.", "Use the same actor and deltaOwner or use settle-for with an exact owner-bound recipient.");
    if (action?.operation === "settle-for" && action?.counterparty !== action?.deltaOwner) add("blocker", "SETTLE_FOR_RECIPIENT_OWNER_MISMATCH", actionPath, "PoolManager settleFor credits its recipient; a different counterparty leaves the declared delta owner's debt uncancelled.", "Set counterparty to the exact deltaOwner whose returned delta is being cancelled.");
    if (["beneficiary", "other-declared"].includes(action?.counterparty) && !resolvedText(action?.authorizationRule)) add("blocker", "SETTLEMENT_AUTHORIZATION_MISSING", `${actionPath}.authorizationRule`, "A beneficiary or other declared counterparty needs an explicit identity and authorization binding.", "Describe how the exact address is selected and why the actor may move value for it.");
    if (action?.operation === "burn-claim" && !resolvedText(action?.authorizationRule)) add("blocker", "ERC6909_BURN_AUTHORIZATION_MISSING", `${actionPath}.authorizationRule`, "Burning a PoolManager claim requires an explicit owner or operator authorization rule.", "Bind the burn to the exact claim owner and approved operator policy.");
    if (action?.assetKind === "native" && action?.operation === "transfer-to-pool-manager") add("blocker", "NATIVE_SETTLEMENT_TRANSFER_INVALID", actionPath, "Native ETH settlement is measured from settle or settleFor msg.value, not a preceding standalone transfer.", "Use sync followed directly by settle or settle-for and bind the exact msg.value.");
    if (action?.assetKind === "native" && ["settle", "settle-for"].includes(action?.operation) && !resolvedText(action?.msgValueRule)) add("blocker", "NATIVE_SETTLEMENT_VALUE_MISSING", `${actionPath}.msgValueRule`, "Native settlement needs an exact msg.value rule.", "Bind msg.value to the precise native debt settled for the declared delta owner.");
    if (action?.assetKind === "erc20" && action?.msgValueRule !== null) add("blocker", "ERC20_SETTLEMENT_MSG_VALUE_CONFLICT", `${actionPath}.msgValueRule`, "ERC-20 settlement must not claim native msg.value.", "Set msgValueRule to null and use sync, token transfer and settle.");
    if (action?.operation === "clear-reviewed-dust") add("blocker", "RETURN_DELTA_CLEAR_USED", `${actionPath}.operation`, "PoolManager clear irreversibly abandons exact positive credit and cannot settle a return delta.", "Use take, mint, burn, settle or settleFor; isolate dust disposal outside the return-delta path.");
    if (["take", "mint-claim", "burn-claim", "settle", "settle-for"].includes(action?.operation)) hasAccountingAction = true;
    if (action?.completionDeadline === "after-hook-return-before-unlock-end") {
      if (!["router", "caller"].includes(action?.actor)) add("blocker", "POST_CALLBACK_SETTLEMENT_ACTOR_INVALID", `${actionPath}.actor`, "The hook cannot execute an action after its callback has returned.", "Use an authenticated outer router or caller and prove the exact unlock sequence, or create the opposing delta inside the callback.");
      if (!["sync", "transfer-to-pool-manager", "settle-for"].includes(action?.operation)) add("blocker", "POST_CALLBACK_SETTLEMENT_OPERATION_INVALID", `${actionPath}.operation`, "This operation cannot safely be delegated to the outer unlock caller after the hook returns.", "Use sync, transfer-to-pool-manager and settle-for for a declared hook debt; credits must be consumed by the hook before returning.");
      if (action?.deltaOwner !== "hook" && action?.deltaOwner !== "other-declared") add("blocker", "POST_CALLBACK_SETTLEMENT_OWNER_INVALID", `${actionPath}.deltaOwner`, "Post-callback settleFor must identify the hook or another exact declared delta owner.", "Bind the recipient of settleFor to the return-delta owner.");
    }
    if (["take", "mint-claim", "burn-claim"].includes(action?.operation) && (action?.actor !== "hook" || action?.completionDeadline !== "before-hook-return")) add("blocker", "HOOK_ACCOUNTING_ACTION_TIMING_INVALID", actionPath, "Hook-owned take, mint or burn accounting must execute by the hook before its callback returns.", "Move the action inside the callback and preserve its exact currency and amount.");
    if (["settle", "settle-for"].includes(action?.operation)) {
      const prior = ordered.slice(0, index);
      const syncIndex = prior.findLastIndex((candidate) => candidate.operation === "sync" && candidate.currency === action.currency && candidate.assetKind === action.assetKind && candidate.actor === action.actor && candidate.completionDeadline === action.completionDeadline);
      const transferIndex = prior.findLastIndex((candidate) => candidate.operation === "transfer-to-pool-manager" && candidate.currency === action.currency && candidate.assetKind === action.assetKind && candidate.actor === action.actor && candidate.completionDeadline === action.completionDeadline);
      if (action.assetKind === "erc20" && (syncIndex < 0 || transferIndex !== syncIndex + 1 || index !== transferIndex + 1)) add("blocker", "ERC20_SETTLEMENT_SEQUENCE_INVALID", actionPath, "ERC-20 settlement needs an uninterrupted sync, token transfer to PoolManager and settle or settle-for sequence for one actor and currency.", "Put the three operations next to each other and do not interleave an action that can overwrite the synced reserve checkpoint.");
      if (action.assetKind === "native" && (syncIndex < 0 || index !== syncIndex + 1 || transferIndex >= syncIndex)) add("blocker", "NATIVE_SETTLEMENT_SEQUENCE_INVALID", actionPath, "Native settlement needs sync followed directly by settle or settle-for with exact msg.value and no standalone transfer.", "Use one uninterrupted native sync and settlement pair.");
    }
  }
  if (!hasAccountingAction) add("blocker", "RETURN_DELTA_OPPOSING_DELTA_MISSING", path, "The action list does not create or settle the opposing hook delta.", "Include an exact take, mint-claim, burn-claim, settle or settle-for accounting action.");
  if (!hasExpectedEffect) add("blocker", "RETURN_DELTA_CANCELLATION_DIRECTION_MISSING", path, "The action list does not create the PoolManager delta direction needed to cancel this returned hook delta.", `Include at least one accounting action with deltaEffect ${expectedEffect}.`);
}

export function requirePresent(value, path, code, remediation, add) {
  const present = typeof value === "string" ? resolvedText(value) : value !== null && value !== undefined;
  if (!present) add("blocker", code, path, "A required capability field is unresolved.", remediation);
}

export function requireNonEmptyArray(value, path, code, remediation, add) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !resolvedText(entry))) add("blocker", code, path, "A required capability list is empty or unresolved.", remediation);
}

export function requireCapabilityMatch(actual, expected, name, code, add) {
  if (expected === true && actual !== true) add("blocker", code, `$.capabilities.${name}.used`, `The ${name} capability is required by the structured design but its policy is not enabled.`, "Set used to true and complete the corresponding structured policy. An explicitly enabled policy is authoritative and is never disabled merely because free text lacks a keyword.");
}

export function usesReviewedFullConsumptionZeroAmm(submission) {
  const returnDeltaAccounting = submission?.hook?.returnDeltaAccounting;
  const quadrants = isObject(returnDeltaAccounting?.quadrants)
    ? Object.values(returnDeltaAccounting.quadrants)
    : [];
  const supportedQuadrants = quadrants.filter((quadrant) => quadrant?.supported === true);
  return submission?.hook?.used === true
    && submission?.hook?.customAccounting?.used === true
    && returnDeltaAccounting?.used === true
    && submission?.capabilities?.customCurve?.used === true
    && supportedQuadrants.length > 0
    && supportedQuadrants.every((quadrant) => (
      quadrant?.zeroAmmLeg === "allowed-reviewed"
      && quadrant?.specifiedDeltaCanConsumeEntireAmount === true
    ));
}
