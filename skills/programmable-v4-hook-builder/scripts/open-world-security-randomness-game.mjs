import {
  anyValue,
  hasLayerValue,
  isUintString,
  knownValue,
  observedValues,
  profileActive,
  requireFalse,
  requireKnownBoolean,
  requireOneOf,
  requireTrue
} from "./open-world-security-shared.mjs";

export function analyzeRandomness(input, merged, add) {
  const profile = "randomness";
  if (!profileActive(input, profile)) return;
  const basePath = "$.layers.*.randomness";
  if (!anyValue(input, profile, "economicOutcome", true)) {
    if (!anyValue(input, profile, "economicOutcome", false)) {
      add(
        "CHANGES_REQUIRED",
        "RANDOMNESS_ECONOMIC_SCOPE_UNRESOLVED",
        `${basePath}.economicOutcome`,
        "It is unresolved whether randomness can change ownership, payout, price or another economic outcome.",
        "Declare the economic effect before selecting and reviewing the randomness source."
      );
    }
    return;
  }

  for (const [field, code, message] of [
    ["participantValueAtRisk", "RANDOMNESS_PARTICIPANT_VALUE_SCOPE_UNRESOLVED", "It is unresolved whether participants pay, escrow, burn or otherwise risk value for the randomized outcome."],
    ["sourceBiasDisclosed", "RANDOMNESS_SOURCE_BIAS_DISCLOSURE_SCOPE_UNRESOLVED", "It is unresolved whether source bias and withholding power are disclosed before participation."],
    ["promisedUnbiasedOutcome", "RANDOMNESS_UNBIASED_PROMISE_SCOPE_UNRESOLVED", "It is unresolved whether the product promises an unbiased or trustless outcome."],
    ["manipulationCanReduceEnforceableUserEntitlement", "RANDOMNESS_ENTITLEMENT_MANIPULATION_SCOPE_UNRESOLVED", "It is unresolved whether bias or withholding can reduce an enforceable user entitlement."]
  ]) {
    requireKnownBoolean(merged, profile, field, add, {
      code,
      message,
      remediation: "Declare the exact participant funding, public promise, source-control and enforceable-entitlement boundary."
    });
  }

  const sources = observedValues(input, profile, "source");
  const biasableSource = sources.find((source) => ["signed-server", "block-timestamp", "blockhash", "prevrandao-only"].includes(source));
  const participantValueAtRisk = anyValue(input, profile, "participantValueAtRisk", true);
  const promisedUnbiasedOutcome = anyValue(input, profile, "promisedUnbiasedOutcome", true);
  const entitlementManipulable = anyValue(input, profile, "manipulationCanReduceEnforceableUserEntitlement", true);
  const withholdingUnbounded = anyValue(input, profile, "withholdingBounded", false);
  if (biasableSource) {
    if (participantValueAtRisk) {
      add(
        "SAFE_REDESIGN",
        "ECONOMIC_RANDOMNESS_PARTICIPANT_VALUE_EXPOSED_TO_BIAS",
        `${basePath}.participantValueAtRisk`,
        `${biasableSource} can be influenced or selectively withheld while participant value is at risk.`,
        "Use a source and failure path that cannot let an outcome influencer capture, destroy or strand participant-funded value."
      );
    }
    if (promisedUnbiasedOutcome) {
      add(
        "SAFE_REDESIGN",
        "ECONOMIC_RANDOMNESS_UNBIASED_PROMISE_FALSE",
        `${basePath}.promisedUnbiasedOutcome`,
        `${biasableSource} is presented as unbiased even though an outcome influencer can bias or selectively withhold it.`,
        "Remove the false promise or use and verify a source whose bias and withholding properties satisfy it."
      );
    }
    if (knownValue(merged, profile, "sourceBiasDisclosed") === false) {
      add(
        "CHANGES_REQUIRED",
        "RANDOMNESS_SOURCE_BIAS_DISCLOSURE_MISSING",
        `${basePath}.sourceBiasDisclosed`,
        "The disclosed product flow does not expose the selected source's bias or withholding trust boundary.",
        "Disclose who can influence or withhold outcomes, the maximum consequence, and the exact fallback before participation."
      );
    }
    if (knownValue(merged, profile, "biasResistance") === true) {
      add(
        "CHANGES_REQUIRED",
        "RANDOMNESS_BIAS_RESISTANCE_SOURCE_CONTRADICTION",
        `${basePath}.biasResistance`,
        `${biasableSource} is declared bias-resistant despite its outcome-influencer or selective-withholding boundary.`,
        "Record the source's actual trust boundary; do not label a controllable source bias-resistant."
      );
    }
    if (
      knownValue(merged, profile, "sourceBiasDisclosed") === true
      && knownValue(merged, profile, "participantValueAtRisk") === false
      && knownValue(merged, profile, "promisedUnbiasedOutcome") === false
      && knownValue(merged, profile, "manipulationCanReduceEnforceableUserEntitlement") === false
    ) {
      add(
        "TRUST_TIER",
        "DISCLOSED_BIASABLE_RANDOMNESS_TRUST_TIER",
        `${basePath}.source`,
        "A disclosed outcome influencer can bias or withhold sponsor-funded randomness without reducing a participant-funded or enforceable entitlement.",
        "Disclose the influencer, funding source, maximum sponsor loss, selection power, withholding behavior, logs and fallback.",
        { trustTier: "disclosed-biasable-sponsor-funded-randomness" }
      );
    }
  }
  if (entitlementManipulable) {
    add(
      "SAFE_REDESIGN",
      "ECONOMIC_RANDOMNESS_ENFORCEABLE_ENTITLEMENT_MANIPULABLE",
      `${basePath}.manipulationCanReduceEnforceableUserEntitlement`,
      "Randomness bias or withholding can reduce an enforceable user entitlement.",
      "Make the entitlement independent of an influenceable result or use a source and fallback that cannot reduce it."
    );
  }
  if (withholdingUnbounded && (participantValueAtRisk || entitlementManipulable)) {
    add(
      "SAFE_REDESIGN",
      "ECONOMIC_RANDOMNESS_VALUE_BEARING_WITHHOLDING_UNBOUNDED",
      `${basePath}.withholdingBounded`,
      "Randomness can be withheld without a bounded failure outcome while participant-funded or enforceable value is exposed.",
      "Use a bounded timeout that refunds participant value or settles the enforceable entitlement without outcome-influencer discretion."
    );
  }
  if (sources.length === 0 || (sources.length === 1 && sources[0] === "none")) {
    add(
      "CHANGES_REQUIRED",
      "ECONOMIC_RANDOMNESS_SOURCE_UNRESOLVED",
      `${basePath}.source`,
      "Economic randomness has no resolved source.",
      "Declare the exact source, trust boundary, liveness behavior and verification path."
    );
  }
  if (sources.includes("signed-server")) {
    add(
      "TRUST_TIER",
      "SIGNED_RANDOMNESS_TRUST_TIER",
      `${basePath}.source`,
      "An operator-signed server can influence economic randomness.",
      "Disclose signer control, audit logs, rotation, withholding behavior and the maximum value exposed per result.",
      { trustTier: "operator-signed-economic-randomness" }
    );
  }

  for (const [field, code, message] of [
    ["domainBound", "RANDOMNESS_DOMAIN_BINDING_MISSING", "Economic randomness is not proven bound to chain, contract, game or request context."],
    ["replayProtected", "RANDOMNESS_REPLAY_PROTECTION_MISSING", "Economic randomness is not proven single-use or replay protected."],
    ["withholdingBounded", "RANDOMNESS_WITHHOLDING_UNBOUNDED", "Randomness withholding has no bounded failure outcome."]
  ]) {
    requireTrue(merged, profile, field, add, {
      code,
      message,
      remediation: "Bind, test and document the property in source and adversarial runtime scenarios."
    });
  }
  if (!biasableSource) {
    requireTrue(merged, profile, "biasResistance", add, {
      code: "RANDOMNESS_BIAS_RESISTANCE_UNPROVEN",
      message: "Bias resistance is absent or unresolved.",
      remediation: "Bind, test and document the property in source and adversarial runtime scenarios."
    });
  } else {
    requireKnownBoolean(merged, profile, "biasResistance", add, {
      code: "RANDOMNESS_BIAS_RESISTANCE_SCOPE_UNRESOLVED",
      message: "The selected source's bias-resistance limitation is unresolved.",
      remediation: "Record the actual bias and withholding boundary instead of assuming trustless randomness."
    });
  }
  requireOneOf(merged, profile, "fallback", ["fail-closed", "cancel-and-refund", "bounded-reroll", "custom-reviewed"], add, {
    code: "RANDOMNESS_FAILURE_MODE_MISSING",
    message: "Randomness failure has no bounded fallback.",
    remediation: "Define a timeout outcome that cannot let an operator choose winners or trap participant value."
  });
  add(
    "INDEPENDENT_REVIEW",
    "ECONOMIC_RANDOMNESS_REVIEW",
    basePath,
    "Randomness can change an economic outcome.",
    "Independently review bias, withholding, replay, domain binding, failure and maximum value exposure.",
    { reviewId: "economic-randomness-review" }
  );
}

export function analyzeGameSettlement(input, merged, add) {
  const profile = "gameSettlement";
  if (!profileActive(input, profile)) return;
  const basePath = "$.layers.*.gameSettlement";

  const abusiveOperatorCapabilities = [
    [
      "operatorCanExceedAuthorizedExposure",
      "GAME_OPERATOR_EXCEEDS_AUTHORIZED_EXPOSURE",
      "A game operator can move more participant value than the authorization and declared loss exposure permit.",
      "Make the custody or allowance incapable of exceeding the user's exact authorization and enforce the loss bound across every settlement path."
    ],
    [
      "operatorCanChooseUnauthorizedRecipient",
      "GAME_OPERATOR_UNAUTHORIZED_RECIPIENT",
      "A game operator can route value to a recipient outside the authorization or immutable payout rule.",
      "Bind every recipient and amount to the signed authorization, verified state transition, or immutable distribution rule."
    ]
  ];
  for (const [field, code, message, remediation] of abusiveOperatorCapabilities) {
    if (anyValue(input, profile, field, true)) {
      add("SAFE_REDESIGN", code, `${basePath}.${field}`, message, remediation);
    }
  }

  if (!anyValue(input, profile, "movesValue", true)) {
    if (!anyValue(input, profile, "movesValue", false)) {
      add(
        "CHANGES_REQUIRED",
        "GAME_VALUE_MOVEMENT_UNRESOLVED",
        `${basePath}.movesValue`,
        "It is unresolved whether game settlement can move, burn, mint or award value.",
        "Declare the value movement before review; do not infer safety from the word game."
      );
    }
    return;
  }

  const legacy = {
    lossExposureBounded: isUintString(knownValue(merged, profile, "maxLossPerMatch")),
    payoutExposureBounded: isUintString(knownValue(merged, profile, "maxPayoutPerMatch")),
    authorizationScopeBound: knownValue(merged, profile, "participantConsent") === true
      && knownValue(merged, profile, "participantsBound") === true,
    replayProtectionBound: knownValue(merged, profile, "matchIdBound") === true
      && knownValue(merged, profile, "nonceBound") === true
      && knownValue(merged, profile, "singleUse") === true,
    livenessBounded: knownValue(merged, profile, "expiryBound") === true,
    failureResolutionDefined: knownValue(merged, profile, "refundOrDispute") === true,
    custodyModelDisclosed: knownValue(merged, profile, "perMatchEscrow") === true,
    custodyAuthorizationBound: knownValue(merged, profile, "perMatchEscrow") === true
      && knownValue(merged, profile, "operatorCanMoveUnescrowedFunds") === false
  };
  const propertyRequirements = [
    ["lossExposureBounded", "GAME_LOSS_EXPOSURE_UNRESOLVED", "The maximum participant loss or equivalent enforceable exposure equation is absent or unresolved.", "Declare and prove the loss equation for the chosen architecture; it may be a scalar cap, session allowance, channel balance, sponsored zero-loss rule, or another enforceable bound.", "SAFE_REDESIGN"],
    ["payoutExposureBounded", "GAME_PAYOUT_EXPOSURE_UNRESOLVED", "The maximum payout or equivalent conservation equation is absent or unresolved.", "Declare and prove the payout equation for the chosen architecture, including backing, rounding and failure behavior.", "CHANGES_REQUIRED"],
    ["authorizationScopeBound", "GAME_AUTHORIZATION_SCOPE_UNRESOLVED", "Settlement authority is not proven bound to an explicit user, sponsor, protocol or state-transition authorization.", "Bind amount, assets, actors, actions, validity and revocation to the architecture's actual authorization primitive.", "SAFE_REDESIGN"],
    ["replayProtectionBound", "GAME_REPLAY_PROTECTION_UNRESOLVED", "Settlement replay protection is absent or unresolved.", "Prove single-use settlement through a match id, channel sequence, nullifier, consumed authorization, or another architecture-appropriate replay domain.", "CHANGES_REQUIRED"],
    ["livenessBounded", "GAME_LIVENESS_BOUND_UNRESOLVED", "The value-bearing game has no proven bounded completion, cancellation or safe terminal-state rule.", "Define and test the architecture's timeout, finality, cancellation or fail-closed liveness rule.", "CHANGES_REQUIRED"],
    ["failureResolutionDefined", "GAME_FAILURE_RESOLUTION_UNRESOLVED", "Failed, unavailable or disputed settlement has no explicit finality or recovery rule.", "Declare the exact finality, atomic-revert, refund, dispute, adjudication or cancellation behavior; a dispute mechanism is not mandatory when another safe terminal rule exists.", "CHANGES_REQUIRED"],
    ["custodyModelDisclosed", "GAME_CUSTODY_MODEL_UNRESOLVED", "The custody or no-custody model is absent or unresolved.", "Disclose whether value uses match escrow, a state channel, session allowance, shared vault, direct atomic settlement, sponsored rewards, or another design.", "CHANGES_REQUIRED"],
    ["custodyAuthorizationBound", "GAME_CUSTODY_AUTHORIZATION_UNRESOLVED", "Custody and spending power are not proven unable to exceed the declared authorization and loss exposure.", "Enforce the authorization at the actual custody boundary and test revocation, concurrency, replay and operator compromise.", "SAFE_REDESIGN"]
  ];
  for (const [field, code, message, remediation, explicitFalseOutcome] of propertyRequirements) {
    const signal = merged[profile][field];
    if ((signal.state === "known" && signal.value === true) || (signal.state === "unknown" && legacy[field] === true)) continue;
    const outcome = signal.state === "known" && signal.value === false ? explicitFalseOutcome : "CHANGES_REQUIRED";
    add(outcome, code, `${basePath}.${field}`, message, remediation);
  }

  if (
    knownValue(merged, profile, "authorizationScopeBound") !== true
    && anyValue(input, profile, "participantConsent", false)
  ) {
    add(
      "SAFE_REDESIGN",
      "GAME_PARTICIPANT_CONSENT_MISSING",
      `${basePath}.participantConsent`,
      "The declared design can expose participant value without either participant consent or another explicit authorization scope.",
      "Use a signed session allowance, channel authorization, match consent, sponsor rule, or another bounded authorization appropriate to the design."
    );
  }

  for (const [field, code, controlField] of [
    ["operatorCanMoveUnescrowedFunds", "GAME_SHARED_CUSTODY_OPERATOR_TRUST", "custodyAuthorizationBound"],
    ["operatorCanChooseRecipientOutsideMatch", "GAME_EXTERNAL_RECIPIENT_OPERATOR_TRUST", "authorizationScopeBound"]
  ]) {
    if (!anyValue(input, profile, field, true)) continue;
    if (knownValue(merged, profile, controlField) !== true) {
      add(
        "CHANGES_REQUIRED",
        `${code}_CONTROL_UNRESOLVED`,
        `${basePath}.${field}`,
        "The operator has broader-than-match authority without a proven architecture-level authorization bound.",
        "Bind the operator to exact assets, amounts, recipients, validity, revocation and replay protection before relying on this custody model."
      );
    }
    add(
      "TRUST_TIER",
      code,
      `${basePath}.${field}`,
      "The disclosed game architecture gives an operator authority over shared custody, allowances, or recipients beyond one isolated match.",
      "Disclose the operator, authorization scope, revocation, monitoring, maximum exposure and compromise outcome in the public launch record.",
      { trustTier: "game-shared-custody-or-allowance" }
    );
  }

  for (const [field, code, message, remediation] of abusiveOperatorCapabilities) {
    if (!anyValue(input, profile, field, true)) {
      const legacyNegative = field === "operatorCanExceedAuthorizedExposure"
        ? knownValue(merged, profile, "operatorCanMoveUnescrowedFunds") === false
        : knownValue(merged, profile, "operatorCanChooseRecipientOutsideMatch") === false;
      const signal = merged[profile][field];
      if (!(signal.state === "known" && signal.value === false) && !(signal.state === "unknown" && legacyNegative)) {
        add("CHANGES_REQUIRED", `${code}_UNRESOLVED`, `${basePath}.${field}`, `${message} The negative guarantee is absent or contradictory.`, remediation);
      }
    }
  }
  add(
    "INDEPENDENT_REVIEW",
    "VALUE_BEARING_GAME_SETTLEMENT_REVIEW",
    basePath,
    "The game can settle participant value.",
    "Independently review loss and payout equations, authorization, replay, custody, liveness, finality and failure recovery for the architecture actually selected.",
    { reviewId: "value-bearing-game-settlement-review" }
  );
}
