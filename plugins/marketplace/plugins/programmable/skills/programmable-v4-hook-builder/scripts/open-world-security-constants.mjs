export const OPEN_WORLD_SECURITY_SCHEMA_VERSION = "open-world-security-v1";

export const OPEN_WORLD_SECURITY_OUTCOMES = Object.freeze([
  "SAFE_REDESIGN",
  "CHANGES_REQUIRED",
  "TRUST_TIER",
  "INDEPENDENT_REVIEW"
]);

export const LAYERS = Object.freeze(["intent", "config", "source", "runtime"]);
export const ASSESSMENT_STATES = Object.freeze(["unassessed", "partial", "source-assessed"]);
export const IMPLEMENTATION_STAGES = new Set(["prototype", "candidate", "release", "runtime"]);
export const assessmentReasonPattern = /^[A-Z][A-Z0-9_]{0,119}$/u;
export const openSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const gitObjectPattern = /^[0-9a-f]{40}$/u;
export const sha256Pattern = /^sha256:(?!0{64}$)[0-9a-f]{64}$/u;
export const safeRepositoryPathPattern = /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*(?:^|\/)\.git(?:\/|$))(?!.*\\)(?!.*(?:%2[fF]|%5[cC]))(?!.*\/$)[^\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+$/u;
export const MAX_UINT256 = (1n << 256n) - 1n;
export const automatedFindingLanguageIdentifierPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
export const AUTOMATED_FINDING_LANGUAGE_PROFILES = Object.freeze({
  solidity: (repositoryPath) => repositoryPath.endsWith(".sol"),
  rust: (repositoryPath) => repositoryPath.endsWith(".rs"),
  typescript: (repositoryPath) => /\.(?:ts|tsx|mts|cts)$/u.test(repositoryPath),
  javascript: (repositoryPath) => /\.(?:js|jsx|mjs|cjs)$/u.test(repositoryPath),
  python: (repositoryPath) => /\.(?:py|pyi|pyw)$/u.test(repositoryPath),
  go: (repositoryPath) => repositoryPath.endsWith(".go")
});
export const AUTOMATED_FINDING_CONFIDENCE = new Set(["low", "medium", "high"]);
export const AUTOMATED_FINDING_STATUSES = new Set(["automated", "partial", "disputed", "builder-confirmed", "reviewer-confirmed"]);
export const AUTOMATED_FINDING_CATEGORIES = new Set(["drain", "deception", "authorization", "solvency", "privacy", "secret", "path", "liveness", "accounting", "other"]);
export const AUTOMATED_CONFIRMATION_STATUSES = new Set(["builder-confirmed", "reviewer-confirmed"]);

export const PROFILE_FIELDS = Object.freeze({
  callbackAuth: Object.freeze([
    "used",
    "poolManagerOnly",
    "poolManagerImmutable",
    "poolBinding",
    "permissionMaskMatchesAddress",
    "selectorAndReturnShapeValidated",
    "senderTreatedAsEndUser"
  ]),
  privilegedValue: Object.freeze([
    "used",
    "authorityModel",
    "hidden",
    "canMoveUserBacking",
    "canMovePlatformLiability",
    "canRedirectOtherBeneficiaryPayouts",
    "movementAuthorizationBound",
    "backingAndLiabilityBoundsEnforced",
    "payoutBeneficiaryBindingEnforced",
    "canReduceUserBackingBelowEnforceableLiabilities",
    "canReduceReservedPlatformLiabilitiesBelowFloor",
    "canRedirectPayoutOutsidePriorConsentOrImmutableRule",
    "upgradeableValueLogic",
    "upgradeCanBypassInvariants",
    "sweepEnabled",
    "excessOnlySweep",
    "timelockSeconds",
    "userExitBeforeChange"
  ]),
  randomness: Object.freeze([
    "used",
    "economicOutcome",
    "participantValueAtRisk",
    "sourceBiasDisclosed",
    "promisedUnbiasedOutcome",
    "manipulationCanReduceEnforceableUserEntitlement",
    "source",
    "domainBound",
    "replayProtected",
    "withholdingBounded",
    "biasResistance",
    "fallback"
  ]),
  gameSettlement: Object.freeze([
    "used",
    "movesValue",
    "participantConsent",
    "perMatchEscrow",
    "maxLossPerMatch",
    "maxPayoutPerMatch",
    "matchIdBound",
    "participantsBound",
    "nonceBound",
    "expiryBound",
    "singleUse",
    "refundOrDispute",
    "operatorCanMoveUnescrowedFunds",
    "operatorCanChooseRecipientOutsideMatch",
    "lossExposureBounded",
    "payoutExposureBounded",
    "authorizationScopeBound",
    "replayProtectionBound",
    "livenessBounded",
    "failureResolutionDefined",
    "custodyModelDisclosed",
    "custodyAuthorizationBound",
    "operatorCanExceedAuthorizedExposure",
    "operatorCanChooseUnauthorizedRecipient"
  ]),
  returnDelta: Object.freeze([
    "used",
    "noOpReturnDeltaUsed",
    "noOpUsedOnPathClaimingCustomAccounting",
    "canConsumeEntireSpecifiedAmount",
    "zeroOutputPossible",
    "userAuthorizedZeroOutput",
    "outputBalanceBacked",
    "finalCallerDeltaBound",
    "allEnabledQuadrantsCovered",
    "partialFillDefined",
    "settlementCompletesBeforeUnlockEnd",
    "deltaConservationProven"
  ]),
  solvency: Object.freeze([
    "used",
    "liabilitiesBoundedByImmediatelyRealizableAssets",
    "futureRevenueCountedAsBacking",
    "claimIsImmediatelyRedeemableOrGuaranteed",
    "contingencyMaturityAndDefaultDisclosed",
    "lossAllocationEnforced",
    "canCreateUnboundedOrDeceptiveGuaranteedClaim",
    "crossPoolNetting",
    "crossPoolNettingProven",
    "adminCanWithdrawBacking",
    "lossAllocationDefined",
    "claimAssetsSeparated",
    "solvencyInvariantTested"
  ]),
  exitLiveness: Object.freeze([
    "used",
    "userExitExists",
    "outstandingUserEntitlementExists",
    "userAuthorizedIrreversibleDisposition",
    "irreversibleDispositionDisclosed",
    "managedRedemption",
    "managedRedemptionDisclosed",
    "managedRedemptionAuthorizationBound",
    "managedRedemptionRecourseAvailable",
    "authorityCanSeizeOrRedirectOwedValue",
    "autonomousExitPromised",
    "boundedTime",
    "boundedGas",
    "independentOfAdmin",
    "independentOfKeeper",
    "dependencyFailureMode",
    "selectiveBlockingPossible",
    "selectiveBlockingDisclosed",
    "selectiveBlockingScopeBound",
    "selectiveBlockingAuthorizationBound",
    "blockedValueCannotBeRedirectedByPlatformAuthority",
    "selectiveBlockingReviewAvailable",
    "recipientFailureIsolated",
    "unboundedLoop"
  ])
});

function enumRule(values) {
  return { type: "enum", values: new Set(values) };
}

export const FIELD_RULES = Object.freeze({
  callbackAuth: Object.freeze({
    poolBinding: enumRule(["exact-pool-key", "pool-id-registry", "custom-reviewed", "none"])
  }),
  privilegedValue: Object.freeze({
    authorityModel: enumRule(["none", "immutable-rules", "single-key", "multisig", "governance", "custom-reviewed"]),
    timelockSeconds: { type: "seconds" }
  }),
  randomness: Object.freeze({
    source: enumRule(["vrf", "commit-reveal", "threshold-oracle", "signed-server", "block-timestamp", "blockhash", "prevrandao-only", "custom-reviewed", "none"]),
    fallback: enumRule(["fail-closed", "cancel-and-refund", "bounded-reroll", "custom-reviewed", "none"])
  }),
  gameSettlement: Object.freeze({
    maxLossPerMatch: { type: "uint" },
    maxPayoutPerMatch: { type: "uint" }
  }),
  exitLiveness: Object.freeze({
    dependencyFailureMode: enumRule(["fail-closed-no-new-value", "exit-remains-available", "cancel-and-refund", "custom-reviewed", "none"])
  })
});

export const OUTCOME_ORDER = Object.freeze({
  SAFE_REDESIGN: 0,
  CHANGES_REQUIRED: 1,
  TRUST_TIER: 2,
  INDEPENDENT_REVIEW: 3
});

export const ACTIVATION_TRUE_FIELDS = Object.freeze({
  callbackAuth: Object.freeze(["senderTreatedAsEndUser"]),
  privilegedValue: Object.freeze([
    "hidden",
    "canMoveUserBacking",
    "canMovePlatformLiability",
    "canRedirectOtherBeneficiaryPayouts",
    "canReduceUserBackingBelowEnforceableLiabilities",
    "canReduceReservedPlatformLiabilitiesBelowFloor",
    "canRedirectPayoutOutsidePriorConsentOrImmutableRule",
    "upgradeableValueLogic",
    "upgradeCanBypassInvariants",
    "sweepEnabled"
  ]),
  randomness: Object.freeze([
    "economicOutcome",
    "participantValueAtRisk",
    "promisedUnbiasedOutcome",
    "manipulationCanReduceEnforceableUserEntitlement"
  ]),
  gameSettlement: Object.freeze([
    "movesValue",
    "operatorCanMoveUnescrowedFunds",
    "operatorCanChooseRecipientOutsideMatch",
    "operatorCanExceedAuthorizedExposure",
    "operatorCanChooseUnauthorizedRecipient"
  ]),
  returnDelta: Object.freeze([
    "noOpReturnDeltaUsed",
    "noOpUsedOnPathClaimingCustomAccounting",
    "canConsumeEntireSpecifiedAmount",
    "zeroOutputPossible"
  ]),
  solvency: Object.freeze([
    "futureRevenueCountedAsBacking",
    "claimIsImmediatelyRedeemableOrGuaranteed",
    "canCreateUnboundedOrDeceptiveGuaranteedClaim",
    "crossPoolNetting",
    "adminCanWithdrawBacking"
  ]),
  exitLiveness: Object.freeze([
    "outstandingUserEntitlementExists",
    "managedRedemption",
    "authorityCanSeizeOrRedirectOwedValue",
    "autonomousExitPromised",
    "selectiveBlockingPossible",
    "unboundedLoop"
  ])
});
